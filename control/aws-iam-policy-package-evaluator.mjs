#!/usr/bin/env node

/* Operational evaluator for the AWS IAM Policy Elements candidate.  It reads
 * committed fixture expectations, invokes the public boundary for every real
 * vector, executes one representative vector per gate, and proves that a
 * weakened boundary is observable. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateAwsIamPolicyBoundary, AWS_IAM_POLICY_INPUT_SCHEMA} from "./aws-iam-policy-boundary-gate.mjs";
import {AWS_IAM_POLICY_CANONICAL_ARTIFACT_SHA256, assertAwsIamPolicyCanonicalEvidence, resolveAwsIamPolicyCanonicalAuthority} from "./aws-iam-policy-authority-binding.mjs";

export const AWS_IAM_POLICY_EVALUATION_SCHEMA = "agentos.specialist_aws_iam_policy_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/aws-iam-policy";
const BLOCK_ID = "specialist.platform.aws-iam-policy";
const ENTRYPOINT = "control/aws-iam-policy-boundary-gate.mjs#evaluateAwsIamPolicyBoundary";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
const REQUIRED_BLOCKS = ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.platform.provider-edge-router", "specialist.standard.aws-iam-current"];
const SHA256 = /^[0-9a-f]{64}$/u;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "AWS_IAM_POLICY_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function digest(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} is not a digest`, "AWS_IAM_POLICY_DIGEST_INVALID"); }
function resultKeys(expected) { const base = ["schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed", "policy_mutation_allowed", "credential_issue_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"]; return expected.disposition === "ROUTE" ? [...base, "selected_specialist", "handoff"] : base; }
function assertBoundaryResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "AWS_IAM_POLICY_RESULT_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(resultKeys(expected).sort()), `${label} result fields differ`, "AWS_IAM_POLICY_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.aws_iam_policy_boundary_result.v1" && actual.version === 1, `${label} result identity differs`, "AWS_IAM_POLICY_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result disposition/route/error differs`, "AWS_IAM_POLICY_HOSTILE_RESULT_FAILED");
  assert(actual.analysis_allowed === (expected.disposition === "ROUTE") && actual.routing_allowed === (expected.disposition === "ROUTE"), `${label} capability is not derived from the committed expectation`, "AWS_IAM_POLICY_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.policy_mutation_allowed === false && actual.credential_issue_allowed === false && actual.memory_write_allowed === false, `${label} result exposes forbidden capability`, "AWS_IAM_POLICY_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && Object.keys(actual.external_side_effects).sort().join("\0") === ["candidate_reads", "source_reads", "protected_data_reads", "policy_mutations", "project_writes", "memory_writes", "credential_accesses", "state_changes"].sort().join("\0"), `${label} side-effect readback shape differs`, "AWS_IAM_POLICY_RESULT_SCHEMA_INVALID");
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), `${label} side-effect readback is non-zero`, "AWS_IAM_POLICY_RESULT_SIDE_EFFECT");
  digest(actual.input_sha256, `${label}.input_sha256`); digest(actual.result_sha256, `${label}.result_sha256`);
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "AWS_IAM_POLICY_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") assert(actual.selected_specialist === BLOCK_ID && actual.handoff?.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} handoff widens authority`, "AWS_IAM_POLICY_RESULT_CAPABILITY_INVALID");
  return actual;
}
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length && new Set(names).size === CLASSES.length, "AWS IAM Policy fixture inventory is invalid", "AWS_IAM_POLICY_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.block_id === BLOCK_ID && fixture.hostile === true && CLASSES.includes(fixture.class), `AWS IAM Policy fixture is not a bound hostile vector: ${name}`, "AWS_IAM_POLICY_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `aws-iam-policy-${fixture.class}`, `AWS IAM Policy fixture ID is not class-bound: ${name}`, "AWS_IAM_POLICY_FIXTURE_ID_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `AWS IAM Policy fixture expectation shape is invalid: ${name}`, "AWS_IAM_POLICY_FIXTURE_EXPECTATION_INVALID");
    assert(["DENY", "ESCALATE", "ROUTE"].includes(fixture.expected.disposition), `AWS IAM Policy fixture disposition is invalid: ${name}`, "AWS_IAM_POLICY_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector?.entrypoint === ENTRYPOINT && fixture.vector.input?.schema === AWS_IAM_POLICY_INPUT_SCHEMA && fixture.vector.input.version === 1 && typeof fixture.vector.input.request_kind === "string" && fixture.vector.input.evidence_overrides && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `AWS IAM Policy fixture vector is not executable: ${name}`, "AWS_IAM_POLICY_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Duplicate AWS IAM Policy fixture class: ${name}`, "AWS_IAM_POLICY_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "AWS IAM Policy fixture classes are incomplete", "AWS_IAM_POLICY_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function baseInput(authority) {
  return {schema: AWS_IAM_POLICY_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_AWS_IAM_POLICY", evidence: {
    authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.PLATFORM_AWS_IAM_POLICY", custody_ref: authority.custody_ref,
    provider_identity: "AWS", provider_version: "CURRENT", policy_identity: "IAM_POLICY_ELEMENTS", policy_scope: "IAM_POLICY_ELEMENTS", policy_status: "BOUND",
    source_status: "CURRENT_VERIFIED", source_identity: authority.source_identity, source_version: authority.source_version, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date,
    candidate_status: "CURRENT_CANDIDATE", candidate_digest: authority.block_sha256, signal: "CLOUD.AWS_IAM", signal_status: "BOUND", context_status: "AWS_IAM_POLICY_CONTEXT", context_complete: true,
    requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: [...REQUIRED_BLOCKS], model_policy_status: authority.model.snapshot_status, model_route_status: "BOUND", authority_scope: "AWS_IAM_POLICY", scope: "NARROW",
    standard_id: "source.aws-iam-policy-elements", standard_version: "current", standard_block_sha256: authority.standard_block_sha256, standard_source_manifest_sha256: authority.standard_source_manifest_sha256,
    model_snapshot_sha256: authority.model.snapshot_sha256, model_task_class: authority.model.task_class, model_capability_floor: authority.model.minimum_capability, model_required_capabilities: [...authority.model.required_capabilities], model_route_sha256: authority.model_route_sha256,
    context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, project_data_present: false, secret_data_present: false, policy_mutation_requested: false, credential_issue_requested: false,
    adversarial_flags: Object.fromEntries(FLAGS.map((key) => [key, false])),
  }};
}
function inputFor(fixture, authority) {
  const input = baseInput(authority); const vector = fixture.vector.input; const overrides = vector.evidence_overrides ?? {};
  input.request_kind = vector.request_kind;
  if (overrides.adversarial_flags) Object.assign(input.evidence.adversarial_flags, overrides.adversarial_flags);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "adversarial_flags") continue;
    assert(["requested_tools", "policy_mutation_requested", "credential_issue_requested", "context_complete", "project_data_present", "secret_data_present"].includes(key), `Fixture ${fixture.fixture_id} attempts an unbounded evidence override`, "AWS_IAM_POLICY_FIXTURE_OVERRIDE_INVALID");
    input.evidence[key] = structuredClone(value);
  }
  return input;
}
function gateExecutions(root, authority, map) {
  const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.aws_iam_policy_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID && execution.evaluator_entrypoint === "control/aws-iam-policy-package-evaluator.mjs#evaluateAwsIamPolicyPackage" && execution.boundary_entrypoint === ENTRYPOINT, "AWS IAM Policy gate execution manifest is invalid", "AWS_IAM_POLICY_GATE_EXECUTION_MANIFEST_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"]), "AWS IAM Policy gate execution order differs", "AWS_IAM_POLICY_GATE_EXECUTION_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === 12, "AWS IAM Policy gate executions are incomplete", "AWS_IAM_POLICY_GATE_EXECUTION_INVENTORY_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && execution.ordered_gate_ids.includes(entry.gate_id), `AWS IAM Policy gate execution is duplicated or unknown: ${entry.gate_id}`, "AWS_IAM_POLICY_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    const gate = json(path.join(root, "gates", `${entry.gate_id}.gate`)); assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `AWS IAM Policy gate is not executable: ${entry.gate_id}`, "AWS_IAM_POLICY_GATE_NOT_EXECUTABLE");
    const fixtureEntry = map.get(entry.fixture_class); assert(fixtureEntry, `AWS IAM Policy gate fixture is missing: ${entry.fixture_class}`, "AWS_IAM_POLICY_GATE_FIXTURE_MISSING");
    assert(JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.expected), `AWS IAM Policy gate expected result is not fixture-bound: ${entry.gate_id}`, "AWS_IAM_POLICY_GATE_EXPECTATION_UNBOUND");
    const actual = evaluateAwsIamPolicyBoundary(inputFor(fixtureEntry.fixture, authority)); assertBoundaryResult(actual, entry.expected, `AWS IAM Policy gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: ENTRYPOINT, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  assert(seen.size === 12, "AWS IAM Policy gate execution coverage is incomplete", "AWS_IAM_POLICY_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}
async function mutation(authority) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-aws-iam-policy-mutation-"));
  try {
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "wave-02", "aws-iam-policy"), path.join(temp, "specialist-blocks", "wave-02", "aws-iam-policy"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "standards", "aws-iam-current"), path.join(temp, "specialist-blocks", "standards", "aws-iam-current"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true}); fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    const target = path.join(temp, "control", "aws-iam-policy-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/aws-iam-policy-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "AWS_IAM_POLICY_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "AWS IAM Policy mutation anchor missing", "AWS_IAM_POLICY_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "AWS_IAM_POLICY_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.platform.aws-iam-policy", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});');
    fs.writeFileSync(target, source);
    const authorityModule = await import(`${pathToFileURL(path.join(temp, "control", "aws-iam-policy-authority-binding.mjs")).href}?mutation-authority=${Date.now()}`); const tempAuthority = authorityModule.resolveAwsIamPolicyCanonicalAuthority();
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const fixture = json(path.join(ROOT, PACKAGE_RELATIVE, "fixtures/broad_when_narrow_exists.json")); const observed = module.evaluateAwsIamPolicyBoundary(inputFor(fixture, tempAuthority));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
function assertCommittedDossier(root, authority) {
  const evaluation = json(path.join(root, "evaluation.json")); const handoff = json(path.join(root, "handoff.json"));
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.aws-iam-policy.v1" && evaluation.block_id === BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.harness === "deterministic-executable-atomic-p1-harness.v1" && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "EXECUTABLE_PASS_REVIEW_REQUIRED", "AWS IAM Policy evaluation dossier is stale", "AWS_IAM_POLICY_EVALUATION_DOSSIER_INVALID");
  assert(new Set(evaluation.cases?.map((entry) => entry.class)).size === 17 && evaluation.cases.every((entry) => CLASSES.includes(entry.class) && entry.observed === "PASS"), "AWS IAM Policy evaluation dossier coverage is incomplete", "AWS_IAM_POLICY_EVALUATION_DOSSIER_INVALID");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.aws-iam-policy.v1" && handoff.block_id === BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "AWS IAM Policy handoff is not bounded", "AWS_IAM_POLICY_HANDOFF_INVALID");
  assert(Array.isArray(handoff.proof) && handoff.proof.some((item) => item.startsWith("gate_semantic_inventory_sha256:")) && handoff.proof.some((item) => item.startsWith("model_route_sha256:")) && handoff.proof.some((item) => item.startsWith("context_receipt_sha256:")) && handoff.proof.some((item) => item.startsWith("upstream_router_file_sha256:")), "AWS IAM Policy handoff proof is incomplete", "AWS_IAM_POLICY_HANDOFF_INVALID");
}

export async function evaluateAwsIamPolicyPackage() {
  const authority = resolveAwsIamPolicyCanonicalAuthority(); const root = path.join(ROOT, PACKAGE_RELATIVE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "AWS IAM Policy package state or identity is invalid", "AWS_IAM_POLICY_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE_RELATIVE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "AWS IAM Policy gate inventory is incomplete", "AWS_IAM_POLICY_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const gateExecution = gateExecutions(root, authority, map); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const boundInput = inputFor(fixture, authority); const actual = evaluateAwsIamPolicyBoundary(boundInput); assertBoundaryResult(actual, fixture.vector.expected_readback, `AWS IAM Policy vector ${fixture.class}`); assertAwsIamPolicyCanonicalEvidence(boundInput.evidence, authority);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  assertCommittedDossier(root, authority); const sensitivity = await mutation(authority); assert(sensitivity.mutation_detected, "AWS IAM Policy mutation proof did not execute", "AWS_IAM_POLICY_MUTATION_PROOF_MISSING");
  const evaluationArtifact = {file_sha256: sha(fs.readFileSync(path.join(root, "evaluation.json")))}; const handoffArtifact = {file_sha256: sha(fs.readFileSync(path.join(root, "handoff.json")))};
  const evaluation = {schema: AWS_IAM_POLICY_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), source_manifest_sha256: authority.source_manifest_sha256, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, model_snapshot_sha256: authority.model.snapshot_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(await evaluateAwsIamPolicyPackage(), null, 2)}\n`);
