#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileEvidenceReceipt,
  verifyEvidenceReceipt,
} from "../../control/rapid-prototype/evidence-identity.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = "c".repeat(64);
const LEAKED_PRIVATE_PATH = ["/", "private", "/", "synthetic", "/", "project"].join("");
const CHANGED_PATHS = [
  "control/rapid-prototype/evidence-identity.mjs",
  "tests/rapid-prototype/evidence-identity.mjs",
];

const input = {
  sourceReadback: {
    readbackStatus: "MATCH",
    pwd: "project-root",
    gitTopLevel: "project-root",
    head: COMMIT,
    tree: TREE,
    gitStatus: " M existing-owner-change",
  },
  projectIdentity: {
    projectId: "PROJECT-LOCAL-TEST",
    projectRoot: "project-root",
    gitTopLevel: "project-root",
    environment: "LOCAL_PROJECT",
  },
  task: {
    taskId: "TASK-EVIDENCE-IDENTITY",
    role: "IMPLEMENTATION_EVIDENCE_AND_IDENTITY",
    allowedChangedPaths: CHANGED_PATHS,
  },
  goal: {
    goalId: "GOAL-EVIDENCE-IDENTITY",
    summary: "Compile and verify bounded evidence receipts.",
  },
  changedPaths: CHANGED_PATHS,
  behaviorResult: {
    status: "PASS",
    summary: "Typed evidence receipt behavior is available for independent review.",
  },
  focusedCheck: {
    test: "node tests/rapid-prototype/evidence-identity.mjs",
    status: "PASS",
    summary: "Compile, verify, tamper, identity, scope, test, and privacy cases passed.",
  },
  hostileCoverage: [
    {id: "H-01", disposition: "different project identity rejected"},
    {id: "H-02", disposition: "changed path mismatch rejected"},
    {id: "H-03", disposition: "altered receipt rejected"},
    {id: "H-04", disposition: "missing focused test rejected"},
    {id: "H-05", disposition: "private data rejected"},
  ],
  handoff: {
    status: "READY_FOR_INDEPENDENT_CLEARANCE",
    independentCheck: "REQUESTED",
    nextHandoff: "FOUNDATION_CLEARANCE_AUDITOR",
  },
  relevantDigests: {
    launch_plan: DIGEST,
    rapid_machine_contract: DIGEST,
    native_session_controller: DIGEST,
  },
};

const receipt = compileEvidenceReceipt(input);
assert.equal(verifyEvidenceReceipt(receipt), receipt);
assert.match(receipt.receipt_sha256, /^[0-9a-f]{64}$/u);
assert.equal("pwd" in receipt.source_readback, false);
assert.equal("git_top_level" in receipt.source_readback, false);
assert.equal("project_root" in receipt.project_identity, false);
assert.match(receipt.source_readback.cwd_sha256, /^[0-9a-f]{64}$/u);
assert.match(receipt.project_identity.project_root_sha256, /^[0-9a-f]{64}$/u);
assert.deepEqual(receipt.changed_paths, [...CHANGED_PATHS].sort());
assert.equal(receipt.focused_check.status, "PASS");
assert.equal(receipt.handoff.independent_check, "REQUESTED");

const realPathReceipt = compileEvidenceReceipt({
  ...input,
  sourceReadback: {...input.sourceReadback, pwd: LEAKED_PRIVATE_PATH, gitTopLevel: LEAKED_PRIVATE_PATH},
  projectIdentity: {...input.projectIdentity, projectRoot: LEAKED_PRIVATE_PATH, gitTopLevel: LEAKED_PRIVATE_PATH},
});
assert.equal("pwd" in realPathReceipt.source_readback, false);
assert.equal("project_root" in realPathReceipt.project_identity, false);

const altered = structuredClone(receipt);
altered.behavior_result.summary = "altered result";
assert.throws(() => verifyEvidenceReceipt(altered), /digest mismatch/u);

assert.throws(
  () => compileEvidenceReceipt({...input, changedPaths: [CHANGED_PATHS[0]]}),
  /changed paths do not match task scope/u,
);
assert.throws(
  () => compileEvidenceReceipt({...input, projectIdentity: undefined}),
  /project identity/u,
);
assert.throws(
  () => compileEvidenceReceipt({
    ...input,
    sourceReadback: {...input.sourceReadback, readbackStatus: "MISMATCH"},
  }),
  /source readback identity/u,
);
assert.throws(
  () => compileEvidenceReceipt({
    ...input,
    projectIdentity: {...input.projectIdentity, projectRoot: "other-project-root"},
  }),
  /project identity root does not match/u,
);
assert.throws(
  () => compileEvidenceReceipt({...input, focusedCheck: {status: "PASS"}}),
  /focused check test/u,
);
assert.throws(
  () => compileEvidenceReceipt({
    ...input,
    behaviorResult: {status: "PASS", summary: `${LEAKED_PRIVATE_PATH} leaked`},
  }),
  /private data is not allowed/u,
);

console.log("PASS Evidence identity: compile, verify, tamper, identity, changed-path, missing-test, and private-data hostile cases passed");
