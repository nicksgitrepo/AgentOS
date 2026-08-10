#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
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

const directNode = runDirectNodeCheck({
  cwd: ROOT,
  script: "control/rapid-prototype/verification-handoff.mjs",
  env: {PATH: ""},
});
assert.equal(directNode.execution, "PROCESS_EXEC_PATH");
assert.equal(directNode.status, 0, "direct Node check must use the host runtime executable, not PATH lookup");
assert.equal(directNode.error_code, null);
assert.throws(
  () => runDirectNodeCheck({cwd: ROOT, script: "../outside.mjs"}),
  /stay inside the bound project/u,
);

function passingCheck(name, source) {
  return {
    status: "PASS",
    name,
    source_commit: source.source_commit,
    source_tree: source.source_tree,
    evidence_sha256: EVIDENCE,
    exit_code: 0,
  };
}

const calls = [];
const pass = await runBoundedVerification({
  sourceBinding: SOURCE,
  observedAtUtc: NOW,
  runCheck: async (name, source) => {
    calls.push(name);
    return passingCheck(name, source);
  },
});
assert.equal(pass.status, "PASS");
assert.equal(pass.terminal, true);
assert.deepEqual(calls, [...VERIFICATION_CHECKS]);
assert.deepEqual(Object.values(pass.checks).map((check) => check.status), ["PASS", "PASS", "PASS"]);
assert.equal(pass.acceptance, false);

const failedCommand = await runBoundedVerification({
  sourceBinding: SOURCE,
  observedAtUtc: NOW,
  runCheck: async (name, source) => {
    if (name === "focused_hostile") throw new Error("raw command output must never enter a handoff");
    return passingCheck(name, source);
  },
});
assert.equal(failedCommand.status, "FAILURE");
assert.equal(failedCommand.terminal, true, "a failed command must force a terminal handoff");
assert.equal(failedCommand.checks.bounded_scan.status, "PASS");
assert.equal(failedCommand.checks.focused_hostile.status, "FAILURE");
assert.equal(failedCommand.checks.focused_hostile.code, "CHECK_EXECUTION_FAILED");
assert.equal(failedCommand.checks.full_direct_node_suite.status, "UNKNOWN");
assert.equal(failedCommand.checks.full_direct_node_suite.code, "NOT_RUN_AFTER_TERMINAL_FAILURE");
assert.equal(failedCommand.failure.check, "focused_hostile");
assert.equal(failedCommand.next_action, "ROUTE_ONE_BOUNDED_REPAIR_THEN_FRESH_VERIFICATION");
assert.doesNotMatch(JSON.stringify(failedCommand), /raw command output/u);

const stale = await runBoundedVerification({
  sourceBinding: SOURCE,
  observedAtUtc: NOW,
  runCheck: async (name, source) => ({
    ...passingCheck(name, source),
    source_tree: "d".repeat(40),
  }),
});
assert.equal(stale.status, "FAILURE");
assert.equal(stale.checks.bounded_scan.code, "STALE_SOURCE_EVIDENCE");
assert.equal(stale.checks.focused_hostile.status, "UNKNOWN");
assert.equal(stale.stale_evidence_rejected, true);

const missing = await runBoundedVerification({
  sourceBinding: SOURCE,
  observedAtUtc: NOW,
  runCheck: async () => undefined,
});
assert.equal(missing.status, "UNKNOWN");
assert.equal(missing.terminal, true);
assert.equal(missing.checks.bounded_scan.code, "CHECK_RESULT_UNAVAILABLE");
assert.equal(missing.next_action, "ROUTE_VERIFICATION_CAPABILITY_REPAIR");

console.log("PASS verification handoff finalizer: failed commands, stale source, missing results, and terminal typed handoff are fail-closed");
