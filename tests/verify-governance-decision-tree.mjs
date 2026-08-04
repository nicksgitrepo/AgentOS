#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ROOTS,
  compileGovernanceDecisionTree,
  evaluateGovernanceDecisionTree,
  validateGovernanceDecisionTree,
} from "../control/governance-decision-tree.mjs";

const SHA = "a".repeat(64);
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const files = [
  "control/governance-decision-tree.mjs",
  "control/local-campaign-admission.mjs",
  "control/local-agent-runtime.mjs",
  "tests/verify-governance-decision-tree.mjs",
].sort();

const tree = compileGovernanceDecisionTree({sourceCommit: COMMIT, sourceTree: TREE, ownerIntentSha256: SHA, scopeSha256: SHA, featureFiles: files});
validateGovernanceDecisionTree(tree);
assert.deepEqual(tree.ordered_roots, ROOTS);

function evidence(gate) {
  return Object.fromEntries(gate.evidence_requirements.map((key) => [key, `${gate.gate_id}:${key}`]));
}

function yesAnswers() {
  return Object.fromEntries(tree.gates.map((gate) => [gate.gate_id, {answer: "YES", evidence: evidence(gate), failure: null, recheck: null}]));
}

assert.equal(evaluateGovernanceDecisionTree({tree, answers: yesAnswers()}).status, "PASS");

const ambiguous = yesAnswers();
ambiguous["G-FUNCTIONALITY-ROOT"].answer = "Y";
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: ambiguous}), /explicit YES or NO/u);

const numeric = yesAnswers();
numeric["G-FUNCTIONALITY-ROOT"].answer = 1;
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: numeric}), /explicit YES or NO/u);

const missingEvidence = yesAnswers();
missingEvidence["G-DESIGN-ROOT"].evidence = {};
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: missingEvidence}), /exactly the declared evidence/u);

const missingFailureTree = yesAnswers();
missingFailureTree["G-CODE-QUALITY-ROOT"] = {answer: "NO", evidence: {}, failure: null, recheck: null};
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: missingFailureTree}), /failure tree and exact re-check/u);

const repairable = yesAnswers();
repairable["G-CODE-QUALITY-ROOT"] = {
  answer: "NO",
  evidence: {},
  failure: {
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    reason: "The focused check found one bounded implementation defect.",
    repair_path: "FEATURE_AGENT_REPAIR_AND_FOCUSED_CHECK",
    required_recheck_gate_id: "G-CODE-QUALITY-ROOT",
  },
  recheck: {gate_id: "G-CODE-QUALITY-ROOT", answer: "YES", evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-CODE-QUALITY-ROOT"))},
};
assert.equal(evaluateGovernanceDecisionTree({tree, answers: repairable}).status, "PASS");

const hardBlocker = yesAnswers();
hardBlocker["G-SECURITY-ROOT"] = {
  answer: "NO",
  evidence: {},
  failure: {
    classification: "OWNER_OR_HARD_BLOCKER",
    reason: "The local adapter cannot prove the requested identity.",
    repair_path: "HOLD_AND_ESCALATE",
    required_recheck_gate_id: "G-SECURITY-ROOT",
  },
  recheck: {gate_id: "G-SECURITY-ROOT", answer: "YES", evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-SECURITY-ROOT"))},
};
assert.equal(evaluateGovernanceDecisionTree({tree, answers: hardBlocker}).status, "BLOCKED");

const wrongOrder = structuredClone(tree);
wrongOrder.ordered_roots = [...ROOTS].reverse();
wrongOrder.tree_sha256 = "b".repeat(64);
assert.throws(() => validateGovernanceDecisionTree(wrongOrder), /root order/u);

console.log("PASS executable four-root governance tree (typed answers, YES evidence, NO failure trees, exact re-checks, and hostile ambiguity coverage)");

