#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileBootstrapContext,
  verifySourceBinding,
} from "../../control/rapid-prototype/bootstrap-context.mjs";

const expected = {
  project_id: "PROJECT-BOUND",
  cwd: "/private/agentos/project",
  git_top_level: "/private/agentos/project",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
};

const observed = structuredClone(expected);
const exact = verifySourceBinding({expected, observed});
assert.equal(exact.status, "MATCH");
assert.equal(exact.ok, true);
assert.deepEqual(exact.mismatch_fields, []);
assert.equal(exact.missing_fields.length, 0);
assert.equal(exact.checked_fields.length, 5);
assert.equal(exact.result_sha256.length, 64);
assert(!JSON.stringify(exact).includes("/private/agentos/project"), "source verifier leaked a private path");

for (const [field, value] of [
  ["project_id", "PROJECT-OTHER"],
  ["cwd", "/private/other/project"],
  ["git_top_level", "/private/other/project"],
  ["source_commit", "c".repeat(40)],
  ["source_tree", "d".repeat(40)],
]) {
  const mismatch = structuredClone(observed);
  mismatch[field] = value;
  const result = verifySourceBinding(expected, mismatch);
  assert.equal(result.status, "SOURCE_BINDING_MISMATCH", `${field} mismatch did not fail closed`);
  assert.equal(result.ok, false);
  assert(result.mismatch_fields.includes(field), `${field} mismatch was not identified`);
  assert.equal(result.failure, "WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH");
}

for (const field of ["project_id", "cwd", "git_top_level", "source_commit", "source_tree"]) {
  const incomplete = structuredClone(observed);
  delete incomplete[field];
  const result = verifySourceBinding({expected, observed: incomplete});
  assert.equal(result.status, "UNAVAILABLE", `${field} omission was not unavailable`);
  assert(result.missing_fields.includes(`observed.${field}`), `${field} omission was not recorded`);
  assert.equal(result.ok, false);
}

const planDigest = "1".repeat(64);
const contractDigest = "2".repeat(64);
const controllerDigest = "3".repeat(64);
const context = compileBootstrapContext({
  expected,
  observed,
  plan_digest: planDigest,
  contract_digest: contractDigest,
  native_session_controller_digest: controllerDigest,
  bounded_checks: [
    {name: "source-binding", status: "PASS", evidence_digest: "4".repeat(64)},
    {name: "plan-contract-readback", status: "PASS"},
  ],
});
assert.equal(context.status, "READY");
assert.equal(context.plan_digest, planDigest);
assert.equal(context.contract_digest, contractDigest);
assert.equal(context.native_session_controller_digest, controllerDigest);
assert.equal(context.source_binding.status, "MATCH");
assert.deepEqual(context.check_summary, {total: 2, pass: 2, fail: 0, timeout: 0, unavailable: 0});
assert.equal(context.context_sha256.length, 64);
assert.equal(context.private_paths_included, false);
assert(!JSON.stringify(context).includes("/private/agentos/project"), "bootstrap context leaked a private path");

const boundedVerifierResult = compileBootstrapContext({
  expected,
  observed,
  planDigest,
  contractDigest,
  boundedChecks: Array.from({length: 16}, (_, index) => ({name: `check-${index}`, status: "PASS"})),
});
assert.equal(boundedVerifierResult.status, "READY");
assert.equal(boundedVerifierResult.bounded_checks.length, 16);
assert.throws(() => compileBootstrapContext({
  expected,
  observed,
  planDigest,
  contractDigest,
  boundedChecks: Array.from({length: 17}, (_, index) => ({name: `check-${index}`, status: "PASS"})),
}), /bounded checks exceed/u);
assert.throws(() => compileBootstrapContext({
  expected,
  observed,
  planDigest,
  contractDigest,
  boundedChecks: [{name: "/private/agentos/leak", status: "PASS"}],
}), /private absolute path/u);

const mismatchContext = compileBootstrapContext({
  expected,
  observed: {...observed, source_tree: "e".repeat(40)},
  planDigest,
  contractDigest,
  boundedChecks: [{name: "source-binding", status: "PASS"}],
});
assert.equal(mismatchContext.status, "SOURCE_BINDING_MISMATCH");
assert.equal(mismatchContext.source_binding.ok, false);
assert(mismatchContext.source_binding.mismatch_fields.includes("source_tree"));

console.log("PASS AgentOS rapid bootstrap context: exact binding, all hostile identity mismatches, incomplete readback, bounded checks, and private-path protection");
