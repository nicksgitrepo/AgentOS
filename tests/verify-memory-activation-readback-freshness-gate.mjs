#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import * as publicKernel from "../control/agentos.mjs";
import {
  MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA,
  MEMORY_ACTIVATION_READBACK_HOSTILE_FIXTURE_REFS,
  compileMemoryActivationReadbackFreshnessGate,
  validateMemoryActivationReadbackFreshnessGate,
} from "../control/memory-activation-readback-freshness-gate.mjs";

const digest = (value) => canonicalDigest({value});
const baseline = {
  activation_receipt_ref: "ref:memory/activation",
  activation_receipt_sha256: digest("activation-receipt"),
  event_count: 5,
  ledger_head_sha256: digest("ledger-head-5"),
  snapshot_sha256: digest("snapshot-5"),
};
const liveReadback = {
  ledger_ref: "ref:memory/ledger",
  ledger_event_count: 11,
  ledger_head_sha256: digest("ledger-head-11"),
  snapshot_ref: "ref:memory/snapshot",
  snapshot_event_cursor: 11,
  snapshot_head_sha256: digest("ledger-head-11"),
  snapshot_sha256: digest("snapshot-11"),
  ledger_snapshot_consistent: true,
  readback_sha256: digest("live-readback-11"),
};
liveReadback.readback_sha256 = canonicalDigest({...liveReadback, readback_sha256: null});
const custody = {
  compiler_only: true,
  controller_approval_required: false,
  execution_owner: "LANE_AGENT",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  product_mutation: false,
  provider_access: false,
  credential_access: false,
  spend: false,
  destructive_work: false,
  worker_activation: false,
  wave_activation: false,
};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.MEMORY.ACTIVATION_BASELINE", reference: "ref:evidence/activation", sha256: digest("activation")},
  {evidence_id: "EVIDENCE.MEMORY.LIVE_SNAPSHOT", reference: "ref:evidence/live-snapshot", sha256: digest("live-snapshot")},
].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));

const gate = compileMemoryActivationReadbackFreshnessGate({
  gateId: "GATE.MEMORY.ACTIVATION.READBACK.FRESHNESS.001",
  defectId: "DEFECT.WORKFLOW.MEMORY.ACTIVATION_BASELINE_STALE.001",
  activationBaseline: baseline,
  liveReadback,
  custody,
  evidenceRefs,
});
assert.equal(typeof publicKernel.compileMemoryActivationReadbackFreshnessGate, "function");
assert.equal(typeof publicKernel.memoryActivationReadbackFreshnessGate.validateMemoryActivationReadbackFreshnessGate, "function");
validateMemoryActivationReadbackFreshnessGate(gate);
assert.equal(gate.schema, MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA);
assert.deepEqual(gate.hostile_fixture_refs, MEMORY_ACTIVATION_READBACK_HOSTILE_FIXTURE_REFS);

const rejects = (candidate, pattern) => {
  candidate.gate_sha256 = canonicalDigest({...candidate, gate_sha256: null});
  assert.throws(() => validateMemoryActivationReadbackFreshnessGate(candidate), pattern);
};

const baselineAsLive = structuredClone(gate);
baselineAsLive.live_readback.ledger_event_count = baselineAsLive.activation_baseline.event_count;
baselineAsLive.live_readback.snapshot_event_cursor = baselineAsLive.activation_baseline.event_count;
baselineAsLive.live_readback.ledger_head_sha256 = baselineAsLive.activation_baseline.ledger_head_sha256;
baselineAsLive.live_readback.snapshot_head_sha256 = baselineAsLive.activation_baseline.ledger_head_sha256;
baselineAsLive.live_readback.snapshot_sha256 = baselineAsLive.activation_baseline.snapshot_sha256;
rejects(baselineAsLive, /activation baseline was incorrectly presented as live/u);

const ledgerDrift = structuredClone(gate);
ledgerDrift.live_readback.snapshot_head_sha256 = digest("different-head");
rejects(ledgerDrift, /ledger and snapshot heads diverge/u);

const cursorDrift = structuredClone(gate);
cursorDrift.live_readback.snapshot_event_cursor = 10;
rejects(cursorDrift, /snapshot cursor does not match/u);

const equalCountDrift = structuredClone(gate);
equalCountDrift.live_readback.ledger_event_count = equalCountDrift.activation_baseline.event_count;
equalCountDrift.live_readback.snapshot_event_cursor = equalCountDrift.activation_baseline.event_count;
equalCountDrift.live_readback.ledger_head_sha256 = digest("rewritten-head");
equalCountDrift.live_readback.snapshot_head_sha256 = equalCountDrift.live_readback.ledger_head_sha256;
equalCountDrift.live_readback.readback_sha256 = canonicalDigest({...equalCountDrift.live_readback, readback_sha256: null});
rejects(equalCountDrift, /did not advance beyond the activation baseline/u);

const readbackDigestDrift = structuredClone(gate);
readbackDigestDrift.live_readback.readback_sha256 = digest("forged-readback");
rejects(readbackDigestDrift, /readback digest mismatch/u);

const snapshotDrift = structuredClone(gate);
snapshotDrift.live_readback.snapshot_sha256 = null;
rejects(snapshotDrift, /must be a lowercase SHA-256/u);

const activationDigestDrift = structuredClone(gate);
activationDigestDrift.activation_baseline.activation_receipt_sha256 = null;
rejects(activationDigestDrift, /must be a lowercase SHA-256/u);

const fixtureCoverage = structuredClone(gate);
fixtureCoverage.hostile_fixture_refs = fixtureCoverage.hostile_fixture_refs.slice(1);
rejects(fixtureCoverage, /coverage is incomplete/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/memory-activation-readback-freshness-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA);
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.limitations.properties.snapshot_status.const, "PARTIAL");
assert.equal(schema.properties.limitations.properties.graph_projection.const, "ADVISORY_ONLY_REBUILDABLE");

console.log("PASS memory activation/readback freshness gate: historical baseline vs current ledger/snapshot distinction, consistency checks, partial/advisory/null limitations, stale rejection, and hostile coverage");
