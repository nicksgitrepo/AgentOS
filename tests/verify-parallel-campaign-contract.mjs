#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PARALLEL_CAMPAIGN_AUDIT_SCHEMA,
  PARALLEL_CAMPAIGN_EVENT_SCHEMA,
  PARALLEL_CAMPAIGN_FAILURE_SCHEMA,
  PARALLEL_CAMPAIGN_HANDOFF_SCHEMA,
  PARALLEL_CAMPAIGN_LEASE_SCHEMA,
  PARALLEL_CAMPAIGN_PLAN_SCHEMA,
  PARALLEL_CAMPAIGN_PROGRESS_SCHEMA,
  PARALLEL_CAMPAIGN_STATE_SCHEMA,
  PARALLEL_CAMPAIGN_WORKER_SCHEMA,
  compileParallelCampaignPlan,
  createParallelCampaignLifecycle,
  opaqueSessionRef,
  validateParallelCampaignAudit,
  validateParallelCampaignHandoff,
  validateParallelCampaignPlan,
  validateParallelCampaignProgress,
  validateParallelCampaignState,
} from "../control/parallel-campaign-lifecycle.mjs";
import {assertPersistedRecordSafe} from "../control/content-addressing.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const START = "2026-08-06T12:00:00.000Z";
const SOURCE = {commit: "commit-contract", tree: "tree-contract", worktree_id: "campaign-contract"};

const KEYS = Object.freeze({
  plan: [
    "schema", "version", "status", "campaign_id", "campaign_version", "logical_lineage_id",
    "goal_id", "goal_sha256", "source", "policy", "lanes", "plan_sha256",
  ],
  state: [
    "schema", "version", "status", "campaign_id", "campaign_version", "logical_lineage_id",
    "goal_id", "goal_sha256", "source", "plan_sha256", "policy", "workers", "events",
    "closed_at_utc", "state_sha256",
  ],
  worker: [
    "schema", "version", "worker_ref", "display_name", "role", "lane_id", "campaign_id",
    "campaign_version", "logical_lineage_id", "goal_id", "goal_sha256", "source",
    "dependencies", "writable_scope", "task_sha256", "attempt", "state", "lease",
    "session_ref", "progress", "handoff", "autonomous_handoff", "audit", "failure",
  ],
  lease: [
    "schema", "version", "lease_id", "campaign_id", "campaign_version", "worker_ref",
    "lane_id", "goal_id", "goal_sha256", "source", "epoch", "status", "acquired_at_utc",
    "expires_at_utc", "renewed_at_utc", "released_at_utc", "release_reason", "lease_sha256",
  ],
  progress: [
    "schema", "version", "worker_ref", "session_ref", "campaign_id", "campaign_version",
    "logical_lineage_id", "goal_id", "goal_sha256", "source", "result_type", "summary",
    "artifact_sha256", "evidence_sha256", "observed_at_utc", "progress_sha256",
  ],
  handoff: [
    "schema", "version", "worker_ref", "session_ref", "campaign_id", "campaign_version",
    "logical_lineage_id", "goal_id", "goal_sha256", "source", "result_type", "summary",
    "artifact_sha256", "evidence_sha256", "progress_sha256", "observed_at_utc", "handoff_sha256",
  ],
  audit: [
    "schema", "version", "worker_ref", "auditor_ref", "session_ref", "auditor_session_ref",
    "campaign_id", "campaign_version", "logical_lineage_id", "goal_id", "goal_sha256",
    "source", "handoff_sha256", "accepted", "evidence_sha256", "observed_at_utc", "audit_sha256",
  ],
  failure: [
    "schema", "version", "worker_ref", "lease_id", "campaign_id", "campaign_version",
    "code", "error_sha256", "observed_at_utc", "failure_sha256",
  ],
  event: [
    "schema", "version", "sequence", "event_type", "campaign_id", "campaign_version",
    "worker_ref", "lease_id", "from_campaign_status", "to_campaign_status",
    "prior_event_sha256", "payload_sha256", "observed_at_utc", "event_sha256",
  ],
});

const SCHEMAS = Object.freeze([
  ["plan", "parallel-campaign-plan.v1.json", PARALLEL_CAMPAIGN_PLAN_SCHEMA],
  ["state", "parallel-campaign-state.v1.json", PARALLEL_CAMPAIGN_STATE_SCHEMA],
  ["worker", "parallel-campaign-worker.v1.json", PARALLEL_CAMPAIGN_WORKER_SCHEMA],
  ["lease", "parallel-campaign-lease.v1.json", PARALLEL_CAMPAIGN_LEASE_SCHEMA],
  ["progress", "parallel-campaign-progress.v1.json", PARALLEL_CAMPAIGN_PROGRESS_SCHEMA],
  ["handoff", "parallel-campaign-handoff.v1.json", PARALLEL_CAMPAIGN_HANDOFF_SCHEMA],
  ["audit", "parallel-campaign-audit.v1.json", PARALLEL_CAMPAIGN_AUDIT_SCHEMA],
  ["failure", "parallel-campaign-failure.v1.json", PARALLEL_CAMPAIGN_FAILURE_SCHEMA],
  ["event", "parallel-campaign-event.v1.json", PARALLEL_CAMPAIGN_EVENT_SCHEMA],
]);

function planFixture(campaignId = "CAMPAIGN-CONTRACT-1") {
  return compileParallelCampaignPlan({
    campaignId,
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-CONTRACT-1",
    goalId: "GOAL-CONTRACT-1",
    goalSha256: SHA_A,
    source: SOURCE,
    lanes: [{
      lane_id: "contract-lane",
      dependencies: [],
      writable_scope: "SCOPE-CONTRACT",
      task_sha256: SHA_B,
    }],
  });
}

function schemaAt(fileName) {
  return JSON.parse(fs.readFileSync(new URL("../schemas/" + fileName, import.meta.url), "utf8"));
}

function assertExactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label + " keys");
}

function assertSchemaParity() {
  for (const [name, fileName, schemaId] of SCHEMAS) {
    const schema = schemaAt(fileName);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name + " draft");
    assert.equal(schema.$id, schemaId, name + " schema identity");
    assert.equal(schema.type, "object", name + " type");
    assert.equal(schema.additionalProperties, false, name + " rejects unknown fields");
    assert.deepEqual([...schema.required].sort(), [...KEYS[name]].sort(), name + " required fields");
    assertExactKeys(schema.properties, KEYS[name], name + " properties");
    for (const [definitionName, definition] of Object.entries(schema.$defs)) {
      if (definition.type === "object") {
        assert.equal(definition.additionalProperties, false, name + " nested " + definitionName + " rejects unknown fields");
      }
    }
  }
}

function assertRecordMatchesSchema(value, name) {
  const schema = schemaAt(SCHEMAS.find(([candidate]) => candidate === name)[1]);
  assertExactKeys(value, KEYS[name], name + " runtime record");
  assert.equal(value.schema, schema.$id, name + " runtime schema identity");
  assertPersistedRecordSafe(value);
}

function main() {
  assertSchemaParity();

  const plan = planFixture();
  validateParallelCampaignPlan(plan);
  assertRecordMatchesSchema(plan, "plan");
  assert.throws(
    () => validateParallelCampaignPlan({...plan, unexpected_field: "rejected"}),
    /fields mismatch/u,
    "parallel plan must reject unknown fields",
  );

  const lifecycle = createParallelCampaignLifecycle({plan, clock: () => START});
  let state = lifecycle.snapshot();
  assertRecordMatchesSchema(state, "state");
  assertRecordMatchesSchema(state.workers[0], "worker");

  state = lifecycle.acquireWorker("contract-lane", {atUtc: START});
  const leaseId = state.workers[0].lease.lease_id;
  assertRecordMatchesSchema(state.workers[0].lease, "lease");

  state = lifecycle.startWorker("contract-lane", leaseId, opaqueSessionRef("worker:contract"), {atUtc: START});
  state = lifecycle.recordProgress("contract-lane", leaseId, {
    result_type: "VERIFIED_BEHAVIOR",
    summary: "The contract lane produced a bounded verified result.",
    artifact_sha256: SHA_B,
    evidence_sha256: SHA_C,
  }, {atUtc: START});
  const workerAfterProgress = state.workers[0];
  validateParallelCampaignProgress(workerAfterProgress.progress, plan, workerAfterProgress);
  assertRecordMatchesSchema(workerAfterProgress.progress, "progress");

  state = lifecycle.recordHandoff("contract-lane", leaseId, {atUtc: START});
  const workerAfterHandoff = state.workers[0];
  validateParallelCampaignHandoff(
    workerAfterHandoff.handoff,
    plan,
    workerAfterHandoff,
    workerAfterHandoff.progress,
  );
  assertRecordMatchesSchema(workerAfterHandoff.handoff, "handoff");

  state = lifecycle.acceptHandoff("contract-lane", leaseId, {
    auditor_ref: "opaque-auditor-contract",
    auditor_session_ref: opaqueSessionRef("auditor:contract"),
    accepted: true,
    evidence_sha256: SHA_A,
  }, {atUtc: START});
  const workerAfterAudit = state.workers[0];
  validateParallelCampaignAudit(
    workerAfterAudit.audit,
    plan,
    workerAfterAudit,
    workerAfterAudit.handoff,
  );
  assertRecordMatchesSchema(workerAfterAudit.audit, "audit");

  state = lifecycle.closeWorker("contract-lane", leaseId, {atUtc: START});
  validateParallelCampaignState(state, plan);
  assertRecordMatchesSchema(state, "state");
  assertRecordMatchesSchema(state.workers[0], "worker");
  assertRecordMatchesSchema(state.workers[0].lease, "lease");
  for (const event of state.events) assertRecordMatchesSchema(event, "event");

  const failedPlan = planFixture("CAMPAIGN-CONTRACT-FAILURE");
  const failedLifecycle = createParallelCampaignLifecycle({plan: failedPlan, clock: () => START});
  const failedLeaseState = failedLifecycle.acquireWorker("contract-lane", {atUtc: START});
  const failedLeaseId = failedLeaseState.workers[0].lease.lease_id;
  const failedState = failedLifecycle.failWorker(
    "contract-lane",
    failedLeaseId,
    new Error("synthetic lane failure"),
    {atUtc: START},
  );
  validateParallelCampaignState(failedState, failedPlan);
  assertRecordMatchesSchema(failedState.workers[0].failure, "failure");
  for (const event of failedState.events) assertRecordMatchesSchema(event, "event");

  console.log(JSON.stringify({
    status: "PASS",
    schemas: SCHEMAS.length,
    runtime_records: 9,
    unknown_field_rejected: true,
    privacy_checked: true,
  }));
}

main();
