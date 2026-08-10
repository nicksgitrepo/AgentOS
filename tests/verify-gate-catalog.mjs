#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  ANSWERS,
  FAILURE_CLASSIFICATIONS,
  compileGateCatalog,
  evaluateGateDecisionTree,
  loadGateCatalog,
  validateCompiledGateTree,
  validateGateCatalog,
} from "../control/gate-catalog-compiler.mjs";

const CATALOG_PATH = new URL("../governance/gate-catalog.v1.json", import.meta.url);
const SCHEMA_PATH = new URL("../schemas/gate-catalog.v1.json", import.meta.url);
const IDENTITY = {
  source_ref: "REF_SOURCE_001",
  worktree_ref: "REF_WORKTREE_001",
  session_ref: "REF_WORKER_001",
  goal_ref: "REF_GOAL_001",
  environment_ref: "REF_ENVIRONMENT_001",
};

const catalog = await loadGateCatalog(CATALOG_PATH);
const tree = compileGateCatalog(catalog);
validateGateCatalog(catalog);
validateCompiledGateTree(tree);

const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
assert.equal(schema.schema, "agentos.gate_catalog_schema.v1");
assert.equal(schema.record_schema, "agentos.gate_catalog.v1");
assert.deepEqual(schema.answer_contract.values, ANSWERS);
assert.equal(schema.answer_contract.unknown_behavior, "NEVER_PASSES");
assert.equal(schema.answer_contract.not_applicable_behavior, "REQUIRES_APPLICABILITY_JUSTIFICATION");

assert.equal(catalog.status, "PREPARED_NOT_ACTIVATED");
assert.deepEqual(catalog.answer_values, ANSWERS);
assert.deepEqual([...catalog.failure_classifications].sort(), [...FAILURE_CLASSIFICATIONS].sort());
assert.equal(tree.graphs.length, 20);
assert.equal(tree.gates.length, 90);
assert.equal(tree.categories.length, 13);
assert.equal(new Set(tree.gates.map((gate) => gate.gate_id)).size, 90);

const requiredCategories = new Set([
  "FUNCTIONALITY",
  "UI_UX_DESIGN_BIBLE",
  "CODE_HYGIENE",
  "SECURITY_PRIVACY",
  "EVIDENCE_IDENTITY",
  "RESPONSE_HANDOFF",
  "SCOPE_BOUNDARIES",
  "RECOVERY",
  "DELIVERY",
]);
for (const category of requiredCategories) assert(tree.categories.some((item) => item.category_id === category), `missing ${category} category`);

function evidenceRecord(gate, slot, issuerKind = "INDEPENDENT_AUDITOR", identity = IDENTITY) {
  const record = {
    evidence_id: `EVIDENCE_${gate.gate_id.replaceAll("-", "_")}_${slot.toUpperCase()}`,
    evidence_digest: null,
    issuer_kind: issuerKind,
    issuer_ref: issuerKind === "INDEPENDENT_AUDITOR" ? "REF_AUDITOR_001" : "REF_HOST_001",
    source_kind: issuerKind,
    observed_identity: structuredClone(identity),
    supports_answer: true,
  };
  record.evidence_digest = canonicalDigest(record);
  return record;
}

function evidenceFor(gate, answer, options = {}) {
  const slots = [...gate.evidence, ...(answer === "NOT_APPLICABLE" ? gate.not_applicable_requires : [])];
  return Object.fromEntries(slots.map((slot) => [
    slot,
    evidenceRecord(gate, slot, options.issuerKind ?? "INDEPENDENT_AUDITOR", options.identity ?? IDENTITY),
  ]));
}

function allYesAnswers(graphId) {
  const graph = tree.graphs.find((item) => item.graph_id === graphId);
  assert(graph, `missing graph ${graphId}`);
  return Object.fromEntries(graph.gate_ids.map((gateId) => {
    const gate = tree.gates.find((item) => item.gate_id === gateId);
    return [gateId, {answer: "YES", evidence: evidenceFor(gate, "YES")}];
  }));
}

for (const graph of tree.graphs) {
  const result = evaluateGateDecisionTree({tree, graphId: graph.graph_id, answers: allYesAnswers(graph.graph_id), expectedIdentity: IDENTITY});
  assert.equal(result.status, "COMPLETE", `${graph.graph_id} YES path did not complete`);
  assert.equal(result.trace.at(-1).answer, "YES", `${graph.graph_id} completed without a YES answer`);
  assert.equal(result.trace.length, graph.gate_ids.length, `${graph.graph_id} trace length differs from its named gates`);
}

const functionality = tree.gates.find((gate) => gate.gate_id === "FUNC-001");
const security = tree.gates.find((gate) => gate.gate_id === "SECURITY-001");
const progress = tree.gates.find((gate) => gate.gate_id === "GENERAL-PROGRESS-001");
const ui = tree.gates.find((gate) => gate.gate_id === "UI-001");
assert(functionality && security && progress && ui);

const softFailure = evaluateGateDecisionTree({
  tree,
  graphId: "FUNCTIONALITY",
  answers: {"FUNC-001": {answer: "NO", evidence: evidenceFor(functionality, "NO")}},
});
assert.equal(softFailure.status, "SOFT_REVIEW");
assert.equal(functionality.failure_policy.NO.classification, "SOFT_BOUNDARY_REVIEW");
assert.equal(functionality.failure_policy.NO.route, "ORCHESTRATOR_REVIEW");

const hardFailure = evaluateGateDecisionTree({
  tree,
  graphId: "SECURITY_PRIVACY",
  answers: {"SECURITY-001": {answer: "NO", evidence: evidenceFor(security, "NO")}},
});
assert.equal(hardFailure.status, "HARD_STOP");
assert.equal(security.failure_policy.NO.classification, "OWNER_OR_HARD_BLOCKER");
assert.equal(security.failure_policy.NO.route, "HARD_STOP");

const unknownFailure = evaluateGateDecisionTree({
  tree,
  graphId: "GENERAL_PROGRESS",
  answers: {"GENERAL-PROGRESS-001": {answer: "UNKNOWN", evidence: evidenceFor(progress, "UNKNOWN")}},
});
assert.equal(unknownFailure.status, "UNPROVEN");
assert.notEqual(unknownFailure.status, "COMPLETE");

const notApplicable = evaluateGateDecisionTree({
  tree,
  graphId: "UI_UX",
  answers: {"UI-001": {answer: "NOT_APPLICABLE", evidence: evidenceFor(ui, "NOT_APPLICABLE")}},
});
assert.equal(notApplicable.status, "SOFT_REVIEW");

assert.throws(
  () => evaluateGateDecisionTree({
    tree,
    graphId: "UI_UX",
    answers: {"UI-001": {answer: "NOT_APPLICABLE", evidence: evidenceFor(ui, "YES")}},
  }),
  /fields mismatch|justification/u,
);

const invalidAnswer = allYesAnswers("FUNCTIONALITY");
invalidAnswer["FUNC-001"].answer = "Y";
assert.throws(() => evaluateGateDecisionTree({tree, graphId: "FUNCTIONALITY", answers: invalidAnswer}), /explicit YES, NO, UNKNOWN, or NOT_APPLICABLE/u);

const agentOnly = allYesAnswers("FUNCTIONALITY");
agentOnly["FUNC-001"].evidence[functionality.evidence[0]].issuer_kind = "AGENT";
assert.throws(() => evaluateGateDecisionTree({tree, graphId: "FUNCTIONALITY", answers: agentOnly}), /issuer_kind/u);

const mismatchedIdentity = allYesAnswers("FUNCTIONALITY");
mismatchedIdentity["FUNC-002"].evidence[tree.gates.find((gate) => gate.gate_id === "FUNC-002").evidence[0]].observed_identity.session_ref = "REF_OTHER_WORKER_001";
assert.throws(() => evaluateGateDecisionTree({tree, graphId: "FUNCTIONALITY", answers: mismatchedIdentity}), /execution identity/u);

const privateReference = allYesAnswers("FUNCTIONALITY");
privateReference["FUNC-001"].evidence[functionality.evidence[0]].issuer_ref = "/private/path";
assert.throws(() => evaluateGateDecisionTree({tree, graphId: "FUNCTIONALITY", answers: privateReference}), /opaque reference/u);

const extraAgentStatement = allYesAnswers("FUNCTIONALITY");
extraAgentStatement["FUNC-001"].statement = "The agent says this passed.";
assert.throws(() => evaluateGateDecisionTree({tree, graphId: "FUNCTIONALITY", answers: extraAgentStatement}), /fields mismatch/u);

const brokenQuestion = structuredClone(catalog);
brokenQuestion.gates[0].question = brokenQuestion.gates[0].question.replace(/\?$/u, "!");
assert.throws(() => compileGateCatalog(brokenQuestion), /question must end with/u);

const brokenUnknownPolicy = structuredClone(catalog);
brokenUnknownPolicy.semantics.unknown_behavior = "PASSES";
assert.throws(() => compileGateCatalog(brokenUnknownPolicy), /UNKNOWN must never pass/u);

const brokenFailureRoute = structuredClone(catalog);
delete brokenFailureRoute.gates[0].failure_policy.NO;
assert.throws(() => compileGateCatalog(brokenFailureRoute), /failure_policy fields mismatch/u);

for (const gate of tree.gates) {
  assert.deepEqual(Object.keys(gate.failure_policy).sort(), ["NO", "NOT_APPLICABLE", "UNKNOWN"]);
  for (const answer of ["NO", "UNKNOWN", "NOT_APPLICABLE"]) {
    assert.notEqual(gate.terminal_behavior[answer], "COMPLETE", `${gate.gate_id}.${answer} can pass`);
    assert(gate.failure_policy[answer].classification);
    assert(gate.failure_policy[answer].route);
    assert(gate.failure_policy[answer].target);
  }
}

console.log(JSON.stringify({
  status: "PASS",
  graphs: tree.graphs.length,
  gates: tree.gates.length,
  categories: tree.categories.length,
  hostile_cases: 10,
}));
