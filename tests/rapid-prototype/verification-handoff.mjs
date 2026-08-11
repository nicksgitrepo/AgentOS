#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../../control/content-addressing.mjs";
import {compileSchedulerAdmissionReceipt} from "../../control/scheduler-admission.mjs";
import {
  normalizeVerificationSourceBinding,
  runDirectNodeCheck,
  runBoundedVerification,
  validateCleanVerificationSnapshot,
  VERIFICATION_CHECKS,
} from "../../control/rapid-prototype/verification-handoff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = "2026-08-06T12:00:00.000Z";
const SOURCE = Object.freeze({
  project_ref: "opaque:project:test",
  host_ref: "opaque:host:local",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
});
const EVIDENCE = "c".repeat(64);
const REQUEST_ID = "request:verification-test";
const SCHEDULER_ADMISSION = compileSchedulerAdmissionReceipt({
  requestId: REQUEST_ID,
  candidateCommit: SOURCE.source_commit,
  candidateTree: SOURCE.source_tree,
  candidateGeneration: 1,
  effectiveArgv: ["node", "verification-handoff"],
  workingDirectoryRef: "opaque:cwd:verification-test",
  dependencyPreflight: {closure_sha256: "d".repeat(64)},
  runtimePreflight: {closure_sha256: "e".repeat(64)},
  executionUnitId: "unit:verification-test",
  laneCursorRef: "lane:verification-test",
  queueCursorRef: "queue:verification-test",
});

assert.deepEqual(normalizeVerificationSourceBinding(SOURCE), SOURCE);
assert.deepEqual(
  validateCleanVerificationSnapshot({
    expected: SOURCE,
    observed: {...SOURCE, working_tree_status: ""},
  }),
  {source_binding: SOURCE, clean: true},
);
assert.throws(
  () => validateCleanVerificationSnapshot({expected: SOURCE, observed: {...SOURCE, working_tree_status: " M control/example.mjs"}}),
  /source snapshot is not clean/u,
);
assert.throws(
  () => validateCleanVerificationSnapshot({expected: SOURCE, observed: {...SOURCE, source_tree: "d".repeat(40), working_tree_status: ""}}),
  /source snapshot source_tree differs/u,
);
for (const malformedTree of [
  "b".repeat(39),
  "b".repeat(41),
  "B".repeat(40),
  "g".repeat(40),
]) {
  assert.throws(
    () => normalizeVerificationSourceBinding({...SOURCE, source_tree: malformedTree}),
    /exact 40-character lowercase Git identity/u,
    `malformed source tree must be rejected: ${malformedTree.length}`,
  );
}

const malformedCalls = [];
await assert.rejects(
  () => runBoundedVerification({
    sourceBinding: {...SOURCE, source_tree: `${SOURCE.source_tree}x`},
    runCheck: async () => {
      malformedCalls.push("unexpected");
      return passingCheck("unexpected", SOURCE);
    },
  }),
  /exact 40-character lowercase Git identity/u,
);
assert.deepEqual(malformedCalls, [], "malformed source identity must stop before any check runs");

assert.throws(
  () => runDirectNodeCheck({
    cwd: ROOT,
    script: "control/rapid-prototype/verification-handoff.mjs",
    env: {PATH: ""},
  }),
  /hybrid scheduler boundary/u,
  "direct checks must fail closed when the required scheduler boundary is unavailable",
);
assert.throws(
  () => runDirectNodeCheck({cwd: ROOT, script: "../outside.mjs"}),
  /hybrid scheduler boundary/u,
);

function schedulerReceipt(overrides = {}) {
  return VERIFICATION_CHECKS.map((name) => {
    const override = overrides[name] ?? {};
    const record = {
      schema: "agentos.hybrid_scheduler_result.v1",
      version: 1,
      status: "SUCCEEDED",
      result: "PASS",
      exit_code: 0,
      candidate_commit: override.candidate_commit ?? SOURCE.source_commit,
      candidate_tree_or_digest: override.candidate_tree_or_digest ?? SOURCE.source_tree,
      result_sha256: null,
      request_id: REQUEST_ID,
      job_id: `job:${name}`,
      proof_scope: name,
    };
    return {...record, ...override, result_sha256: canonicalDigest({...record, ...override, result_sha256: null})};
  });
}

const pass = await runBoundedVerification({
  sourceBinding: SOURCE,
  schedulerAdmissionReceipt: SCHEDULER_ADMISSION,
  schedulerReceipt: schedulerReceipt(),
  observedAtUtc: NOW,
});
assert.equal(pass.status, "PASS");
assert.equal(pass.terminal, true);
assert.deepEqual(Object.values(pass.checks).map((check) => check.status), ["PASS", "PASS", "PASS"]);
assert.equal(pass.acceptance, false);

await assert.rejects(
  () => runBoundedVerification({
    sourceBinding: SOURCE,
    schedulerAdmissionReceipt: SCHEDULER_ADMISSION,
    schedulerReceipt: schedulerReceipt({focused_hostile: {status: "FAILED"}}),
    observedAtUtc: NOW,
  }),
  /scheduler terminal record did not pass/u,
);

await assert.rejects(
  () => runBoundedVerification({
    sourceBinding: SOURCE,
    schedulerAdmissionReceipt: SCHEDULER_ADMISSION,
    schedulerReceipt: schedulerReceipt({bounded_scan: {candidate_tree_or_digest: "d".repeat(40)}}),
    observedAtUtc: NOW,
  }),
  /scheduler terminal record is not source-bound/u,
);

await assert.rejects(
  () => runBoundedVerification({
    sourceBinding: SOURCE,
    schedulerAdmissionReceipt: SCHEDULER_ADMISSION,
    observedAtUtc: NOW,
  }),
  /scheduler terminal receipt is required/u,
);

console.log("PASS verification handoff finalizer: scheduler admission, source binding, and terminal proof receipts fail closed");
