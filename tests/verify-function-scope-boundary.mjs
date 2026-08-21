#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateFunctionScopeBoundary, FUNCTION_SCOPE_INPUT_SCHEMA, FUNCTION_SCOPE_RESULT_SCHEMA} from "../control/function-scope-boundary-gate.mjs";
import {evaluateFunctionScopePackage} from "../control/function-scope-package-evaluator.mjs";
import {resolveFunctionScopeCanonicalAuthority} from "../control/function-scope-authority-binding.mjs";
const authority = resolveFunctionScopeCanonicalAuthority();
const evaluation = await evaluateFunctionScopePackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const input = {schema: FUNCTION_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "SPAWN", evidence: {
  authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.FUNCTION_SCOPE", custody_ref: authority.custody_ref, source_status: "CURRENT_VERIFIED", source_identity: authority.source_identity, source_version: authority.source_version, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, candidate_status: "CURRENT_CANDIDATE", candidate_digest: authority.block_sha256, signal: "FUNCTION_SCOPE", signal_status: "BOUND", context_status: "FUNCTION_SCOPE_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE"], required_block_identities: ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"], model_policy_status: authority.model.snapshot_status, model_route_status: "BOUND", authority_scope: "FUNCTION_SCOPE", scope: "NARROW", tenant_scope_status: "BOUND", standard_id: "source.owasp-asvs-5-0-0", standard_version: "5.0.0", standard_block_sha256: authority.standard_block_sha256, standard_source_manifest_sha256: authority.standard_source_manifest_sha256, model_snapshot_sha256: authority.model.snapshot_sha256, model_task_class: authority.model.task_class, model_capability_floor: authority.model.minimum_capability, model_required_capabilities: authority.model.required_capabilities, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
}};
const denied = evaluateFunctionScopeBoundary(input);
assert.equal(denied.schema, FUNCTION_SCOPE_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "FUNCTION_SCOPE_OPERATION_FORBIDDEN");
assert.equal(denied.analysis_allowed, false); assert.equal(denied.acceptance_allowed, false); assert.equal(denied.authorization_decision_allowed, false); assert.equal(denied.policy_mutation_allowed, false);
assert.equal(denied.result_sha256, canonicalDigest({...denied, result_sha256: null}));
const routed = structuredClone(input); routed.request_kind = "ANALYZE_FUNCTION_SCOPE";
const routedResult = evaluateFunctionScopeBoundary(routed);
assert.equal(routedResult.disposition, "ROUTE"); assert.equal(routedResult.analysis_allowed, true); assert.equal(routedResult.acceptance_allowed, false); assert.equal(routedResult.authorization_decision_allowed, false); assert.equal(routedResult.policy_mutation_allowed, false); assert.equal(routedResult.handoff.execution_instruction, false);
const missingTenantScope = structuredClone(input); missingTenantScope.request_kind = "ANALYZE_FUNCTION_SCOPE"; missingTenantScope.evidence.tenant_scope_status = "MISSING";
assert.throws(() => evaluateFunctionScopeBoundary(missingTenantScope), (error) => error?.code === "FUNCTION_SCOPE_TENANT_SCOPE_REQUIRED");
const wrongAuthorityScope = structuredClone(input); wrongAuthorityScope.request_kind = "ANALYZE_FUNCTION_SCOPE"; wrongAuthorityScope.evidence.authority_scope = "OTHER_SCOPE";
assert.throws(() => evaluateFunctionScopeBoundary(wrongAuthorityScope), (error) => error?.code === "FUNCTION_SCOPE_AUTHORITY_SCOPE_INVALID");

// The evaluator must use the fixture's committed expected route/error, not echo
// whatever the implementation happened to return.  Run an isolated copy and
// mutate one expectation; a proof that still passes would be tautological.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(temp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.mkdirSync(path.join(temp, "schemas"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "schemas", "function-scope-gate-execution.v1.json"), path.join(temp, "schemas", "function-scope-gate-execution.v1.json"));
  const mutatedFixture = path.join(temp, "specialist-blocks", "wave-03", "function-scope", "fixtures", "authority_conflict.json");
  const fixture = JSON.parse(fs.readFileSync(mutatedFixture, "utf8"));
  fixture.expected.route = "NO_FUNCTION_SCOPE";
  fs.writeFileSync(mutatedFixture, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolatedEvaluator = await import(`${pathToFileURL(path.join(temp, "control", "function-scope-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => isolatedEvaluator.evaluateFunctionScopePackage(), (error) => ["FUNCTION_SCOPE_HOSTILE_RESULT_FAILED", "FUNCTION_SCOPE_GATE_EXPECTATION_UNBOUND", "FUNCTION_SCOPE_FIXTURE_VECTOR_INVALID"].includes(error?.code));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}

// A self-rehashed but superseded or rerouted model snapshot is not authority.
// The production entrypoint must fail before it can emit a ROUTE result.
const modelTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-model-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(modelTemp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(modelTemp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(modelTemp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(modelTemp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(modelTemp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(modelTemp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(modelTemp, "fixtures", "model-policy-evidence"), {recursive: true});
  const modelPath = path.join(modelTemp, "fixtures", "model-policy-snapshot.initial.v1.json");
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  model.status = "SUPERSEDED";
  const securityTask = model.task_classes.find((task) => task.task_class === "SECURITY_REVIEW");
  securityTask.minimum_capability_score = 0;
  securityTask.preferred_models = ["gpt-5.6-terra"];
  securityTask.fallback_models = ["gpt-5.6-luna"];
  model.snapshot_sha256 = canonicalDigest({...model, snapshot_sha256: null});
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  const isolatedBoundary = await import(`${pathToFileURL(path.join(modelTemp, "control", "function-scope-boundary-gate.mjs")).href}?model-mutation=${Date.now()}`);
  assert.throws(() => isolatedBoundary.evaluateFunctionScopeBoundary(structuredClone(input)), (error) => error?.code === "FUNCTION_SCOPE_MODEL_POLICY_PROVENANCE_INVALID" || error?.code === "FUNCTION_SCOPE_MODEL_ROUTE_SEMANTICS_INVALID");
} finally {
  fs.rmSync(modelTemp, {recursive: true, force: true});
}

// The upstream router is part of Function Scope authority.  A source mutation
// must fail closed before a happy-path router receipt can be reused.
const routerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-router-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(routerTemp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(routerTemp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(routerTemp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(routerTemp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(routerTemp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(routerTemp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(routerTemp, "fixtures", "model-policy-evidence"), {recursive: true});
  const routerPath = path.join(routerTemp, "control", "access-control-router-boundary-gate.mjs");
  const routerSource = fs.readFileSync(routerPath, "utf8");
  assert(routerSource.includes("if (FORBIDDEN.has(input.request_kind))"));
  fs.writeFileSync(routerPath, routerSource.replace("if (FORBIDDEN.has(input.request_kind))", "if (false && FORBIDDEN.has(input.request_kind))"));
  const isolatedAuthority = await import(`${pathToFileURL(path.join(routerTemp, "control", "function-scope-authority-binding.mjs")).href}?router-mutation=${Date.now()}`);
  assert.throws(() => isolatedAuthority.resolveFunctionScopeCanonicalAuthority(), (error) => error?.code === "FUNCTION_SCOPE_UPSTREAM_ROUTER_PROVENANCE_INVALID");
} finally {
  fs.rmSync(routerTemp, {recursive: true, force: true});
}

// Recomputed roster bytes are still insufficient: the exact gate inventory
// must remain present and one-to-one after the roster is rehashed.
const rosterTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-roster-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(rosterTemp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(rosterTemp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(rosterTemp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  const rosterDirectory = path.join(rosterTemp, "specialist-blocks", "registry"); fs.mkdirSync(rosterDirectory, {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "specialist-blocks", "registry", "agent-roster.v1.json"), path.join(rosterDirectory, "agent-roster.v1.json"));
  fs.copyFileSync(path.join(repositoryRoot, "specialist-blocks", "registry", "accepted-agent-receipts.v1.json"), path.join(rosterDirectory, "accepted-agent-receipts.v1.json"));
  fs.mkdirSync(path.join(rosterTemp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(rosterTemp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(rosterTemp, "fixtures", "model-policy-evidence"), {recursive: true});
  const rosterPath = path.join(rosterDirectory, "agent-roster.v1.json");
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const rosterEntry = roster.entries.find((entry) => entry.stable_agent_id === "AGENT.SECURITY_FUNCTION_SCOPE");
  delete rosterEntry.deterministic_gates;
  fs.writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
  const mutatedRosterSha = createHash("sha256").update(fs.readFileSync(rosterPath)).digest("hex");
  const isolatedBindingPath = path.join(rosterTemp, "control", "function-scope-authority-binding.mjs");
  const isolatedBinding = fs.readFileSync(isolatedBindingPath, "utf8").replace(/FUNCTION_SCOPE_ROSTER_FILE_SHA256 = "[0-9a-f]{64}"/u, `FUNCTION_SCOPE_ROSTER_FILE_SHA256 = "${mutatedRosterSha}"`);
  fs.writeFileSync(isolatedBindingPath, isolatedBinding);
  const isolatedAuthority = await import(`${pathToFileURL(isolatedBindingPath).href}?roster-mutation=${Date.now()}`);
  assert.throws(() => isolatedAuthority.resolveFunctionScopeCanonicalAuthority(), (error) => error?.code === "FUNCTION_SCOPE_ROSTER_GATE_PROVENANCE_INVALID");
} finally {
  fs.rmSync(rosterTemp, {recursive: true, force: true});
}

// The acceptance index is a read-only authority input, not a shape-only
// hint.  A valid-looking receipt reference substitution or removal of the
// Function Scope row must close authority before any package evaluation.
for (const mutation of ["receipt_ref", "row_removed"]) {
  const acceptanceTemp = fs.mkdtempSync(path.join(os.tmpdir(), `agentos-function-scope-acceptance-${mutation}-`));
  try {
    fs.cpSync(path.join(repositoryRoot, "control"), path.join(acceptanceTemp, "control"), {recursive: true});
    fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(acceptanceTemp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
    fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(acceptanceTemp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
    fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(acceptanceTemp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(acceptanceTemp, "fixtures"), {recursive: true});
    fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(acceptanceTemp, "fixtures", "model-policy-snapshot.initial.v1.json"));
    fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(acceptanceTemp, "fixtures", "model-policy-evidence"), {recursive: true});
    const rosterPath = path.join(acceptanceTemp, "specialist-blocks", "registry", "agent-roster.v1.json");
    const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
    const rosterEntry = roster.entries.find((entry) => entry.stable_agent_id === "AGENT.SECURITY_FUNCTION_SCOPE");
    rosterEntry.build_state = "ACCEPTED_QUALIFIED"; rosterEntry.qa_state = "COMPLETE_QA_PASS"; rosterEntry.independent_evaluation_state = "INDEPENDENT_PASS_READBACK";
    roster.roster_sha256 = canonicalDigest({...roster, roster_sha256: null});
    fs.writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
    const rosterSha = createHash("sha256").update(fs.readFileSync(rosterPath)).digest("hex");
    const bindingPath = path.join(acceptanceTemp, "control", "function-scope-authority-binding.mjs");
    fs.writeFileSync(bindingPath, fs.readFileSync(bindingPath, "utf8").replace(/FUNCTION_SCOPE_ROSTER_FILE_SHA256 = "[0-9a-f]{64}"/u, `FUNCTION_SCOPE_ROSTER_FILE_SHA256 = "${rosterSha}"`));
    const acceptancePath = path.join(acceptanceTemp, "specialist-blocks", "registry", "accepted-agent-receipts.v1.json");
    const acceptanceLedger = JSON.parse(fs.readFileSync(acceptancePath, "utf8"));
    acceptanceLedger.entries = acceptanceLedger.entries.filter((entry) => entry.stable_agent_id !== "AGENT.SECURITY_FUNCTION_SCOPE");
    acceptanceLedger.entries.push({stable_agent_id: "AGENT.SECURITY_FUNCTION_SCOPE", package_path: "specialist-blocks/wave-03/function-scope", candidate_commit: "4e1ac9d4ef9aa9646ce7d0cd5c046e1a8600c13e", candidate_tree: "87777e1974888e4e520f4206ed61a87e75e0e266", independent_status: "PASS", receipt_ref: "INDEPENDENT_EVALUATOR_HANDOFF/4e1ac9d4ef9aa9646ce7d0cd5c046e1a8600c13e", receipt_sha256: null, readback_scope: "READBACK_SUMMARY_ONLY"});
    acceptanceLedger.entries.sort((a, b) => a.stable_agent_id.localeCompare(b.stable_agent_id));
    if (mutation === "receipt_ref") {
      acceptanceLedger.entries.find((entry) => entry.stable_agent_id === "AGENT.SECURITY_FUNCTION_SCOPE").receipt_ref = "INDEPENDENT_EVALUATOR_HANDOFF/0000000000000000000000000000000000000000";
    } else {
      acceptanceLedger.entries = acceptanceLedger.entries.filter((entry) => entry.stable_agent_id !== "AGENT.SECURITY_FUNCTION_SCOPE");
    }
    acceptanceLedger.ledger_sha256 = canonicalDigest({...acceptanceLedger, ledger_sha256: null});
    fs.writeFileSync(acceptancePath, `${JSON.stringify(acceptanceLedger, null, 2)}\n`);
    const isolatedAuthority = await import(`${pathToFileURL(bindingPath).href}?acceptance-${mutation}=${Date.now()}`);
    assert.throws(() => isolatedAuthority.resolveFunctionScopeCanonicalAuthority(), (error) => mutation === "receipt_ref" ? error?.code === "FUNCTION_SCOPE_ACCEPTANCE_RECEIPT_INVALID" : error?.code === "FUNCTION_SCOPE_ACCEPTANCE_LEDGER_ROW_INVALID");
  } finally {
    fs.rmSync(acceptanceTemp, {recursive: true, force: true});
  }
}

console.log("PASS Function Scope boundary: 17 executable adversarial vectors, fixture-bound expectations, mutation proof, and zero side effects");
