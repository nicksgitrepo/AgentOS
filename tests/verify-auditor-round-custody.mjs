#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {assessAuditorRound, validateAuditorRound, AUDITOR_ROUND_SCHEMA, AUDITOR_ROUND_RESULT_SCHEMA} from "../control/auditor-round-custody.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const digest = (value) => canonicalDigest(value);
const sideEffects = () => ({candidate_writes: 0, builder_writes: 0, memory_writes: 0, project_writes: 0, credential_accesses: 0, merge_calls: 0, deploy_calls: 0, state_changes: 0});
const sha1 = (char) => char.repeat(39) + (char === "a" ? "1" : char === "b" ? "2" : char === "c" ? "3" : "4");
const taskRef = (task) => `opaque:task:${task}`;

function makeRound(overrides = {}) {
  const candidate = {
    candidate_ref: "opaque:candidate:AGENTOS.ROUND.1",
    commit_sha1: sha1("a"), tree_sha1: sha1("b"),
    package_sha256: digest("package"), gate_inventory_sha256: digest("gates"), fixture_inventory_sha256: digest("fixtures"), context_sha256: digest("context"),
    rollback_commit_sha1: sha1("c"), rollback_tree_sha1: sha1("d"), status: "FROZEN_IMMUTABLE",
  };
  const fixtureBase = {fixture_id: "FIXTURE.ADVERSARIAL.1", fixture_sha256: digest("fixture-bytes"), input_sha256: digest("fixture-input"), entrypoint: "control/independent-auditor-boundary-gate.mjs#evaluateIndependentAuditorBoundary", invoked: true, expected_disposition: "DENY", observed_disposition: "DENY", expected_error_code: "INDEPENDENT_AUDITOR_OPERATION_FORBIDDEN", observed_error_code: "INDEPENDENT_AUDITOR_OPERATION_FORBIDDEN", negative_assertions: ["adapter_invocations=0", "state_changes=0"], side_effects: sideEffects(), result_sha256: null};
  fixtureBase.result_sha256 = digest({...fixtureBase, result_sha256: null});
  const gate = {gate_id: "GATE.ADVERSARIAL.1", gate_sha256: digest("gate-bytes"), fixture_ids: [fixtureBase.fixture_id], entrypoint: "control/independent-auditor-boundary-gate.mjs#evaluateIndependentAuditorBoundary", executed: true, observed_status: "DENY", negative_assertions: ["unsafe-route-denied"], execution_receipt_sha256: digest("gate-execution"), result_sha256: null};
  gate.result_sha256 = digest({...gate, result_sha256: null});
  const command = {command_sha256: digest("command"), cwd_ref: "opaque:worktree:AUDITOR.ROUND.1", entrypoint: "control/independent-auditor-boundary-gate.mjs#evaluateIndependentAuditorBoundary", status: "COMPLETE", target_write_attempts: 0, candidate_tree_before_sha1: candidate.tree_sha1, candidate_tree_after_sha1: candidate.tree_sha1, readback_sha256: null}; command.readback_sha256 = digest({...command, readback_sha256: null});
  const execution = {status: "COMPLETE", entrypoints_real: true, metadata_only: false, timeout_or_silence: false, fixture_inventory_complete: true, gate_inventory_complete: true, fixtures: [fixtureBase], gates: [gate], side_effects: sideEffects(), auditor_cwd_ref: "opaque:worktree:AUDITOR.ROUND.1", candidate_custody_readback_sha256: digest("candidate-custody-readback"), write_attempts: 0, target_write_attempts: 0, command_receipts: [command], execution_sha256: null};
  execution.execution_sha256 = digest({...execution, execution_sha256: null});
  const builderTask = "TASK.BUILDER.ROUND.1";
  const auditorTask = "TASK.AUDITOR.ROUND.1";
  const round = {
    schema: AUDITOR_ROUND_SCHEMA, version: 1, round_id: "ROUND.ADVERSARIAL.1", round_kind: "ADVERSARIAL_AUDIT",
    builder_task_id: builderTask, auditor_task_id: auditorTask, builder_identity: "AGENT.BUILDER.1", auditor_identity: "AGENT.AUDITOR.1",
    candidate, model_policy: {snapshot_sha256: "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27", projection_sha256: digest({snapshot_sha256: "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04", role_class: "WORKING_AGENT", model_id: "gpt-5.6-luna", reasoning_effort: "max"}), model_id: "gpt-5.6-luna", reasoning_effort: "max", availability: "CURRENT_HOST_AVAILABLE", status: "CURRENT_BOUND"},
    custody: {builder_worktree_ref: "opaque:worktree:BUILDER.ROUND.1", auditor_worktree_ref: "opaque:worktree:AUDITOR.ROUND.1", builder_custody_receipt_sha256: digest("builder-custody"), auditor_spawn_receipt_sha256: digest("auditor-spawn"), auditor_task_readback_ref: taskRef(auditorTask), candidate_snapshot_sha256: digest(candidate), read_only: true, candidate_mutation_allowed: false, merge_allowed: false, deploy_allowed: false},
    execution, verdict: "PASS", issued_at_utc: new Date(Date.now() - 1000).toISOString(), expires_at_utc: new Date(Date.now() + 60 * 60 * 1000).toISOString(), round_sha256: null,
  };
  round.round_sha256 = digest({...round, round_sha256: null});
  return structuredClone({...round, ...overrides});
}

const valid = makeRound();
validateAuditorRound(valid);
const assessed = assessAuditorRound(valid);
assert.equal(assessed.schema, AUDITOR_ROUND_RESULT_SCHEMA);
assert.equal(assessed.ready_for_spawner_review, false);
assert.equal(assessed.error_code, "AUDITOR_ROUND_EXTERNAL_REVIEW_REQUIRED");
assert.equal(assessed.disposition, "PASS");
assert.equal(assessed.integration_allowed, false);
assert.equal(assessed.independent_clearance, false);

const expectBlocked = (name, mutate, code) => {
  const candidate = makeRound(); mutate(candidate); const result = assessAuditorRound(candidate); assert.equal(result.disposition, "BLOCKED_EXACT", name); if (code) assert.equal(result.error_code, code, name);
};

expectBlocked("builder may not audit itself", (round) => { round.auditor_task_id = round.builder_task_id; round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_SELF_REVIEW");
expectBlocked("shared worktree is denied", (round) => { round.custody.auditor_worktree_ref = round.custody.builder_worktree_ref; round.custody.candidate_snapshot_sha256 = digest(round.candidate); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_SHARED_WORKTREE");
expectBlocked("metadata-only PASS is denied", (round) => { round.execution.metadata_only = true; round.execution.execution_sha256 = digest({...round.execution, execution_sha256: null}); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_EXECUTION_UNTRUSTED");
expectBlocked("fixture claims are not execution", (round) => { round.execution.fixtures[0].invoked = false; round.execution.fixtures[0].result_sha256 = digest({...round.execution.fixtures[0], result_sha256: null}); round.execution.execution_sha256 = digest({...round.execution, execution_sha256: null}); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_FIXTURE_NOT_EXECUTED");
expectBlocked("a forged side effect counter is denied", (round) => { round.execution.side_effects.candidate_writes = 1; round.execution.execution_sha256 = digest({...round.execution, execution_sha256: null}); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_SIDE_EFFECT_DETECTED");
expectBlocked("stale or silent audit is denied", (round) => { round.execution.timeout_or_silence = true; round.execution.execution_sha256 = digest({...round.execution, execution_sha256: null}); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_EXECUTION_UNTRUSTED");
expectBlocked("unavailable model is denied", (round) => { round.model_policy.availability = "UNKNOWN"; round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_MODEL_POLICY_INVALID");
expectBlocked("mismatched candidate binding is denied", (round) => { round.custody.candidate_snapshot_sha256 = digest("other-candidate"); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_CANDIDATE_BINDING_MISMATCH");
expectBlocked("fixture mismatch cannot be called PASS", (round) => { round.execution.fixtures[0].observed_disposition = "PASS"; round.execution.fixtures[0].result_sha256 = digest({...round.execution.fixtures[0], result_sha256: null}); round.execution.execution_sha256 = digest({...round.execution, execution_sha256: null}); round.round_sha256 = digest({...round, round_sha256: null}); }, "AUDITOR_ROUND_PASS_UNPROVEN");

const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/auditor-round-custody.v1.json"), "utf8"));
assert.equal(schema.properties.schema.const, AUDITOR_ROUND_SCHEMA);
assert.equal(schema.properties.execution.properties.metadata_only.const, false);
console.log("PASS auditor round custody: distinct builder/auditor tasks, frozen candidate, read-only custody, real fixture/gate execution, zero-side-effect proof, freshness, and hostile fail-closed coverage");
