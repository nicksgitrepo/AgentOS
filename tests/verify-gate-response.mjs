#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {loadQuestionCatalog, renderGateQuestion, validateRenderedGate} from "../control/question-catalog.mjs";
import {createGateResponse, validateGateResponse} from "../control/gate-response.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = await compileGateFile(path.join(ROOT, "governance/lanes/functionality.gate"));
const catalog = await loadQuestionCatalog(ROOT);
const rendered = renderGateQuestion(graph, "FUNC-001", catalog);
validateRenderedGate(rendered, {graph, catalog});
const identity = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", session_id: "WORKER-SESSION-001", goal_id: "GOAL-001", environment_id: "ENV-001"};
const evidence = {baseline: {observation: "The admitted behavior has a baseline"}, assignment: {observation: "The success and failure conditions are recorded"}};
const pass = createGateResponse({rendered, answer: "YES", evidence, identity, issuer_session_id: "AUDITOR-SESSION-001", issuer_kind: "INDEPENDENT_AUDITOR"});
assert.equal(pass.gate_name, "Observable Behavior Contract");
assert.equal(pass.statement, "Gate \"Observable Behavior Contract\" passed successfully.");
assert.equal(pass.status, "PASS");
validateGateResponse(pass, rendered, {evidence, expectedIdentity: identity, requireIndependent: true});

const routed = createGateResponse({rendered, answer: "UNKNOWN", evidence, identity, issuer_session_id: "AUDITOR-SESSION-001", issuer_kind: "INDEPENDENT_AUDITOR"});
assert.equal(routed.status, "ROUTED");
assert.notEqual(routed.statement, pass.statement);

for (const tamper of [
  (value) => ({...value, gate_name: "Different Gate", digest: null}),
  (value) => ({...value, statement: "Gate passed successfully.", digest: null}),
  (value) => ({...value, evidence_digest: "f".repeat(64), digest: null}),
  (value) => ({...value, issuer_session_id: identity.session_id, digest: null}),
  (value) => ({...value, issuer_kind: "HOST_READBACK", digest: null}),
]) {
  const candidate = tamper(pass);
  candidate.digest = candidate.digest ?? pass.digest;
  assert.throws(() => validateGateResponse(candidate, rendered, {evidence, expectedIdentity: identity, requireIndependent: true}));
}

const unbound = {...pass, identity: {...identity, goal_id: "OTHER-GOAL"}, digest: null};
unbound.digest = pass.digest;
assert.throws(() => validateGateResponse(unbound, rendered, {evidence, expectedIdentity: identity}));
console.log(JSON.stringify({status: "PASS", named_gate: pass.gate_name, routed_answer: routed.answer}));
