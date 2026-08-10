#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const plan = readJson("schemas/rapid-prototype-plan.v1.json");
const declared = plan.implementation_phase?.lanes ?? [];
assert.equal(declared.length, 12, "rapid prototype plan must declare all twelve implementation lanes");
const supportingChecks = plan.implementation_phase?.supporting_checks ?? [];
assert(Array.isArray(supportingChecks), "rapid prototype supporting checks must be an array");
const supportingTests = supportingChecks.map((check) => {
  assert(typeof check?.check_id === "string" && check.check_id.length > 0, "rapid prototype supporting check has no ID");
  assert(typeof check.test === "string" && check.test.startsWith("tests/rapid-prototype/"), `rapid supporting check has no canonical test: ${check.check_id}`);
  assert.equal(check.counts_as_implementation_lane, false, `rapid supporting check must not become an implementation lane: ${check.check_id}`);
  return check.test;
}).sort(compareUtf8);
assert.equal(new Set(supportingTests).size, supportingTests.length, "rapid supporting check tests must be unique");
const handoffContract = plan.implementation_phase?.lane_handoff_contract;
const verificationExecution = plan.implementation_phase?.verification_execution_contract;
assert.equal(verificationExecution?.source_snapshot_validator, "control/rapid-prototype/verification-handoff.mjs", "verification source snapshot validator is missing");
assert.equal(verificationExecution?.source_snapshot_required, "CLEAN_EXACT_SOURCE", "verification must require a clean exact source snapshot");
assert.equal(verificationExecution?.dirty_snapshot_action, "FAIL_CLOSED_BEFORE_CHECKS", "dirty verification snapshots must fail closed");
assert.equal(verificationExecution?.node_executable_source, "process.execPath", "verification must use the host Node executable");
assert.equal(verificationExecution?.bare_executable_path_lookup_forbidden, true, "verification must not resolve a bare Node name through PATH");
assert.equal(verificationExecution?.runtime_unavailable_code, "NODE_EXECUTABLE_UNAVAILABLE", "verification runtime failure code is missing");
assert.deepEqual(verificationExecution?.sequence, ["SOURCE_SNAPSHOT", "BOUNDED_SCAN", "FOCUSED_HOSTILE", "FULL_DIRECT_NODE_SUITE"], "verification sequence is incomplete");
assert.equal(handoffContract?.schema, "agentos.native_implementation_lane_handoff.v1", "implementation lane handoff schema binding is missing");
assert.deepEqual(handoffContract?.required_worker_profile, {model: "gpt-5.6-luna", reasoning_effort: "max"}, "implementation lane worker profile contract is incomplete");
assert.deepEqual(handoffContract?.required_source_identity_fields, ["project_root", "cwd", "git_top_level", "source_commit", "source_tree"], "implementation lane source identity contract is incomplete");
assert.equal(handoffContract?.git_object_pattern, "^[0-9a-f]{40}$", "implementation lane Git identity contract is incomplete");
assert.equal(handoffContract?.path_sha256_pattern, "^[0-9a-f]{64}$", "implementation lane path digest contract is incomplete");
assert.equal(handoffContract?.shortened_or_ellipsized_values_rejected, true, "implementation lane handoff must reject shortened values");
assert.deepEqual(handoffContract?.required_host_receipts, ["create_thread", "pin", "send", "wait", "read", "unpin", "archive", "post_close_read", "active_list_absent"], "implementation lane host receipt contract is incomplete");
assert.equal(handoffContract?.self_acceptance_allowed, false, "implementation lane self-acceptance must remain forbidden");

const expected = declared.map((lane) => {
  assert(typeof lane.test === "string" && lane.test.startsWith("tests/rapid-prototype/"), `rapid lane has no canonical test: ${lane.role}`);
  return lane.test;
}).sort(compareUtf8);
assert.equal(new Set(expected).size, expected.length, "rapid prototype lane tests must be unique");

const actual = fs.readdirSync(path.join(root, "tests/rapid-prototype"), {withFileTypes: true})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
  .map((entry) => `tests/rapid-prototype/${entry.name}`)
  .sort(compareUtf8);
const declaredTests = [...expected, ...supportingTests].sort(compareUtf8);
assert.deepEqual(actual, declaredTests, "rapid prototype test directory and plan manifest differ");

for (const relativePath of declaredTests) {
  const result = spawnSync(process.execPath, [relativePath], {cwd: root, encoding: "utf8"});
  assert.equal(result.status, 0, `${relativePath} failed\n${result.stdout}\n${result.stderr}`);
}

console.log(`PASS Rapid Prototype canonical runner: ${expected.length} implementation lane tests and ${supportingTests.length} supporting checks executed from the versioned plan`);
