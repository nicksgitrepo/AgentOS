#!/usr/bin/env node

/*
 * Repository-bound authority for the intent-regulator candidate.
 *
 * This module is deliberately boring: callers provide evidence, but the
 * package, source lock, runtime entry points, model route, context receipt,
 * and route receipt are resolved from this AgentOS checkout.  Nothing here
 * grants activation, admission, Product custody, or external authority.
 */

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {DEFAULT_AGENT_MODEL, DEFAULT_AGENT_REASONING_EFFORT} from "./native-host-contract.mjs";

export const INTENT_REGULATOR_PACKAGE_PATH = "specialist-blocks/wave-01/intent-regulator";
export const INTENT_REGULATOR_BLOCK_ID = "specialist.control.intent-regulator";
export const INTENT_REGULATOR_CUSTODY_REF = "opaque:INTENT_REGULATOR.CUSTODY";
export const INTENT_REGULATOR_MODEL = DEFAULT_AGENT_MODEL;
export const INTENT_REGULATOR_REASONING_EFFORT = DEFAULT_AGENT_REASONING_EFFORT;
export const INTENT_REGULATOR_SOURCE_ID = "source.agentos-portable-intent-control";
export const INTENT_REGULATOR_SOURCE_VERSION = "1";
export const INTENT_REGULATOR_ROUTE = "PERSISTENT_RUNTIME_ROUTE";
export const INTENT_REGULATOR_RUNTIME_ROLE = "RUNTIME";
export const INTENT_REGULATOR_REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evaluation-admission-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
]);
export const INTENT_REGULATOR_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const INTENT_REGULATOR_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
export const INTENT_REGULATOR_FLAG_KEYS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive", "unknown_owner", "owner_chat_only",
  "acceptance_requested", "activation_requested", "product_write_requested", "memory_write_requested",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, INTENT_REGULATOR_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const READ_ONLY_TOOLS = Object.freeze([
  "READ_TYPED_INTENT", "READ_RUNTIME_STATE", "READ_SOURCE_LOCK", "READ_CONTEXT", "READ_ROUTE",
]);

function fail(message, code = "INTENT_REGULATOR_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "INTENT_REGULATOR_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function without(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "INTENT_REGULATOR_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "INTENT_REGULATOR_SCHEMA_INVALID");
}
function readRegular(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "INTENT_REGULATOR_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "INTENT_REGULATOR_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readRegular(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "INTENT_REGULATOR_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function validDate(value, label) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "INTENT_REGULATOR_SOURCE_DATE_INVALID");
  assert(Date.parse(`${value}T00:00:00.000Z`) <= Date.now(), `${label} is future dated`, "INTENT_REGULATOR_SOURCE_FUTURE");
}
function checkBlock(artifact) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === INTENT_REGULATOR_BLOCK_ID, "Intent-regulator block identity differs", "INTENT_REGULATOR_BLOCK_INVALID");
  assert(block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Intent-regulator candidate is not inert", "INTENT_REGULATOR_LIFECYCLE_INVALID");
  sha(block.block_sha256, "Intent-regulator block digest");
  assert(block.block_sha256 === canonicalDigest(without(block, "block_sha256")), "Intent-regulator block digest is invalid", "INTENT_REGULATOR_BLOCK_DIGEST_INVALID");
  assert(JSON.stringify(block.dependencies) === JSON.stringify(INTENT_REGULATOR_REQUIRED_BLOCKS), "Intent-regulator dependencies are not canonical", "INTENT_REGULATOR_DEPENDENCY_INVALID");
  assert(block.evaluation?.receipt_id === "specialist-eval.intent-regulator.v1" && block.evaluation?.independent_reviewer_required === true, "Intent-regulator evaluation binding is invalid", "INTENT_REGULATOR_EVALUATION_BINDING_INVALID");
  return block;
}
function checkSource(artifact) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === INTENT_REGULATOR_BLOCK_ID, "Intent-regulator source lock identity differs", "INTENT_REGULATOR_SOURCE_LOCK_INVALID");
  sha(source.manifest_sha256, "Intent-regulator source manifest digest");
  assert(source.manifest_sha256 === canonicalDigest(without(source, "manifest_sha256")), "Intent-regulator source manifest digest is invalid", "INTENT_REGULATOR_SOURCE_LOCK_INVALID");
  const portable = source.sources?.find((entry) => entry.source_id === INTENT_REGULATOR_SOURCE_ID);
  assert(portable?.version === INTENT_REGULATOR_SOURCE_VERSION && portable.immutable_identity === "agentos-portable-intent-control-v1" && portable.authority_class === "AGENTOS_PORTABLE", "Portable intent source identity is not canonical", "INTENT_REGULATOR_SOURCE_IDENTITY_INVALID");
  assert(portable.effective_date === null, "Portable intent source effective date is mutable", "INTENT_REGULATOR_SOURCE_IDENTITY_INVALID");
  for (const entry of source.sources ?? []) if (entry.retrieved_date) validDate(entry.retrieved_date, `${entry.source_id} retrieved date`);
  return source;
}
function checkGates() {
  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Intent-regulator gate manifest");
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === INTENT_REGULATOR_BLOCK_ID, "Intent-regulator gate manifest identity differs", "INTENT_REGULATOR_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(INTENT_REGULATOR_GATE_IDS), "Intent-regulator gate order differs", "INTENT_REGULATOR_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(INTENT_REGULATOR_GATE_IDS.map((id) => `gates/${id}.gate`)), "Intent-regulator gate paths differ", "INTENT_REGULATOR_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Intent-regulator gate outcomes differ", "INTENT_REGULATOR_GATE_SEMANTICS_INVALID");
  const gates = INTENT_REGULATOR_GATE_IDS.map((id) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${id}.gate`), `Intent-regulator gate ${id}`);
    const gate = artifact.value;
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Intent-regulator gate ${id}`);
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === id && gate.block_id === INTENT_REGULATOR_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Intent-regulator gate ${id} is not executable`, "INTENT_REGULATOR_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Intent-regulator gate ${id} outcome set differs`, "INTENT_REGULATOR_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Intent-regulator gate ${id}`);
    assert(gate.gate_sha256 === canonicalDigest(without(gate, "gate_sha256")), `Intent-regulator gate ${id} digest is invalid`, "INTENT_REGULATOR_GATE_DIGEST_INVALID");
    return Object.freeze({...gate, file_sha256: artifact.file_sha256});
  });
  return {manifest, manifest_file_sha256: manifestArtifact.file_sha256, gates: Object.freeze(gates), semantic_sha256: canonicalDigest(gates.map((gate) => ({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence})))};
}

export function resolveIntentRegulatorCanonicalAuthority() {
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Intent-regulator block");
  const block = checkBlock(blockArtifact);
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Intent-regulator source lock");
  const source = checkSource(sourceArtifact);
  const runtimeFiles = Object.freeze({
    contract: "control/persistent-intent-runtime-contract.mjs",
    integration: "control/persistent-intent-runtime-integration.mjs",
    runtime: "control/persistent-intent-runtime.mjs",
    storage: "control/persistent-intent-runtime-storage.mjs",
  });
  const runtimeSha = Object.freeze(Object.fromEntries(Object.entries(runtimeFiles).map(([key, relative]) => [key, fileSha(path.join(ROOT, relative))])));
  const modelRoute = Object.freeze({task_class: "INTENT_REGULATION", model: INTENT_REGULATOR_MODEL, reasoning_effort: INTENT_REGULATOR_REASONING_EFFORT, route_source: "control/native-host-contract.mjs#DEFAULT_AGENT_MODEL", route_file: "control/native-host-contract.mjs", route_file_sha256: fileSha(path.join(ROOT, "control/native-host-contract.mjs"))});
  const modelRouteSha256 = canonicalDigest(modelRoute);
  const route = Object.freeze({schema: "agentos.intent_regulator_route_binding.v1", version: 1, route: INTENT_REGULATOR_ROUTE, target_role: INTENT_REGULATOR_RUNTIME_ROLE, entrypoint: "control/persistent-intent-runtime-integration.mjs#compilePersistentRuntimeRoute", route_file_sha256: runtimeSha.integration, action_set: ["CONTINUE_CAMPAIGN", "STOP_HARD_BOUNDARY", "REASSESS_AND_REPLACE_GOAL", "ORCHESTRATOR_REVIEW", "REPLACE_STALLED_WORKER", "AWAIT_ACCEPTANCE"], side_effects: "READ_ONLY"});
  const routeSha256 = canonicalDigest(route);
  const context = Object.freeze({schema: "agentos.intent_regulator_context_binding.v1", version: 1, block_id: INTENT_REGULATOR_BLOCK_ID, block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, source_lock_file_sha256: sourceArtifact.file_sha256, runtime_contract_file_sha256: runtimeSha.contract, runtime_integration_file_sha256: runtimeSha.integration, runtime_file_sha256: runtimeSha.runtime, runtime_storage_file_sha256: runtimeSha.storage, model_route_sha256: modelRouteSha256, route_sha256: routeSha256, authority_scope: "INTENT_REGULATION", scope: "NARROW", custody_ref: INTENT_REGULATOR_CUSTODY_REF, memory_binding: "TYPED_HANDOFF_ONLY;_NO_PROJECT_MEMORY_WRITE", lifecycle: "CANDIDATE;_ACTIVATION_OFF"});
  const contextSha256 = canonicalDigest(context);
  const gates = checkGates();
  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "Intent-regulator gate execution manifest");
  assert(executionArtifact.value.schema === "agentos.intent_regulator_gate_execution.v1" && executionArtifact.value.version === 1 && executionArtifact.value.block_id === INTENT_REGULATOR_BLOCK_ID, "Intent-regulator gate execution binding is invalid", "INTENT_REGULATOR_GATE_EXECUTION_INVALID");
  return Object.freeze({repository_root: ROOT, package_path: INTENT_REGULATOR_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: INTENT_REGULATOR_SOURCE_ID, source_version: INTENT_REGULATOR_SOURCE_VERSION, source_retrieved_date: source.sources.find((entry) => entry.source_id === INTENT_REGULATOR_SOURCE_ID).retrieved_date, runtime_files: runtimeFiles, runtime_sha256: runtimeSha, model_route: modelRoute, model_route_sha256: modelRouteSha256, route, route_sha256: routeSha256, context, context_sha256: contextSha256, custody_ref: INTENT_REGULATOR_CUSTODY_REF, gate_manifest_sha256: gates.manifest.manifest_sha256, gate_manifest_file_sha256: gates.manifest_file_sha256, gate_execution_file_sha256: executionArtifact.file_sha256, gate_semantic_inventory_sha256: gates.semantic_sha256, gates: gates.gates, fixture_classes: INTENT_REGULATOR_FIXTURE_CLASSES});
}

export function assertIntentRegulatorCanonicalEvidence(evidence, authority = resolveIntentRegulatorCanonicalAuthority()) {
  assert(evidence && typeof evidence === "object" && !Array.isArray(evidence), "Intent-regulator evidence is not an object", "INTENT_REGULATOR_EVIDENCE_INVALID");
  assert(evidence.authority_status === "CURRENT" && evidence.owner_role === "AGENTOS_CONTROLLER" && evidence.owner_identity === "OWNER.TYPED.INTENT" && evidence.owner_intent_status === "BOUND" && evidence.intent_provenance_status === "EXACT_TYPED_RECORD", "Typed owner-intent authority is not bound", "INTENT_REGULATOR_AUTHORITY_UNBOUND");
  sha(evidence.owner_intent_digest, "owner intent digest");
  assert(evidence.candidate_status === "CURRENT_CANDIDATE" && evidence.candidate_digest === authority.block_sha256, "Intent-regulator candidate digest is not canonical", "INTENT_REGULATOR_CANDIDATE_BINDING_INVALID");
  assert(evidence.source_status === "CURRENT_VERIFIED" && evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_manifest_sha256 === authority.source_manifest_sha256 && evidence.source_lock_sha256 === authority.source_file_sha256, "Intent-regulator source binding is not canonical", "INTENT_REGULATOR_SOURCE_BINDING_INVALID");
  assert(evidence.model_policy_status === "CURRENT" && evidence.model_route_status === "BOUND" && evidence.model === authority.model_route.model && evidence.reasoning_effort === authority.model_route.reasoning_effort && evidence.model_route_sha256 === authority.model_route_sha256, "Intent-regulator model route is not canonical", "INTENT_REGULATOR_MODEL_ROUTE_INVALID");
  assert(evidence.context_receipt_sha256 === authority.context_sha256 && evidence.route_receipt_sha256 === authority.route_sha256, "Intent-regulator context or route receipt is not canonical", "INTENT_REGULATOR_CONTEXT_ROUTE_INVALID");
  assert(evidence.signal === "EXPLICIT_TYPED_OWNER_INTENT" && evidence.signal_status === "BOUND" && evidence.context_status === "INTENT_REGULATOR_RUNTIME_CONTEXT" && evidence.context_complete === true && evidence.task_status === "INTENT_REGULATION", "Intent-regulator context is incomplete", "INTENT_REGULATOR_CONTEXT_INCOMPLETE");
  assert(JSON.stringify(evidence.required_block_identities) === JSON.stringify(INTENT_REGULATOR_REQUIRED_BLOCKS), "Intent-regulator dependency identities differ", "INTENT_REGULATOR_DEPENDENCY_INVALID");
  assert(evidence.authority_scope === "INTENT_REGULATION" && evidence.scope === "NARROW", "Intent-regulator scope is not narrow", "INTENT_REGULATOR_SCOPE_INVALID");
  assert(evidence.custody_status === "BOUND" && evidence.custody_owner === "AGENTOS.CONTROL.INTENT_REGULATOR" && evidence.custody_ref === authority.custody_ref, "Intent-regulator custody is not canonical", "INTENT_REGULATOR_CUSTODY_INVALID");
  assert(JSON.stringify(evidence.requested_tools) === JSON.stringify(READ_ONLY_TOOLS), "Intent-regulator requested tools exceed read-only scope", "INTENT_REGULATOR_TOOL_SCOPE_INVALID");
  assert(evidence.project_data_present === false && evidence.secret_data_present === false, "Intent-regulator evidence contains protected data", "INTENT_REGULATOR_PRIVACY_INVALID");
  return authority;
}

export function assertIntentRegulatorCommittedHandoff({authority = resolveIntentRegulatorCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Intent-regulator evaluation dossier");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.intent-regulator.v1" && evaluation.block_id === INTENT_REGULATOR_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Intent-regulator evaluation dossier is not a complete candidate receipt", "INTENT_REGULATOR_EVALUATION_INVALID");
  assert(evaluation.cases.length === INTENT_REGULATOR_FIXTURE_CLASSES.length && evaluation.cases.every((entry) => INTENT_REGULATOR_FIXTURE_CLASSES.includes(entry.class) && entry.observed === "PASS"), "Intent-regulator evaluation case coverage is incomplete", "INTENT_REGULATOR_EVALUATION_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Intent-regulator handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.intent-regulator.v1" && handoff.block_id === INTENT_REGULATOR_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Intent-regulator handoff identity differs", "INTENT_REGULATOR_HANDOFF_INVALID");
  assert(typeof evaluationFileSha256 === "string" && typeof handoffFileSha256 === "string" && handoff.proof.includes(`evaluation_file_sha256:${evaluationFileSha256}`) && handoff.proof.includes(`model_route_sha256:${authority.model_route_sha256}`) && handoff.proof.includes(`context_receipt_sha256:${authority.context_sha256}`) && handoff.proof.includes(`route_receipt_sha256:${authority.route_sha256}`) && handoff.proof.some((proof) => /^rollback_(?:file|receipt)_sha256:[0-9a-f]{64}$/u.test(proof)), "Intent-regulator handoff is not bound to current receipts", "INTENT_REGULATOR_HANDOFF_BINDING_INVALID");
  return true;
}

export {INTENT_REGULATOR_PACKAGE_PATH as PACKAGE_PATH};
