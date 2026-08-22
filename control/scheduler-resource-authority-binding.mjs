#!/usr/bin/env node

/* Canonical, read-only authority binding for the Resource Scheduler candidate. */

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {DEFAULT_AGENT_MODEL, DEFAULT_AGENT_REASONING_EFFORT} from "./native-host-contract.mjs";

export const SCHEDULER_RESOURCE_PACKAGE_PATH = "specialist-blocks/wave-01/resource-scheduler";
export const SCHEDULER_RESOURCE_BLOCK_ID = "specialist.control.resource-scheduler";
export const SCHEDULER_RESOURCE_CUSTODY_REF = "opaque:RESOURCE_SCHEDULER.CUSTODY";
export const SCHEDULER_RESOURCE_MODEL = DEFAULT_AGENT_MODEL;
export const SCHEDULER_RESOURCE_REASONING_EFFORT = DEFAULT_AGENT_REASONING_EFFORT;
export const SCHEDULER_RESOURCE_TASK_CLASS = "RESOURCE_SCHEDULING";
export const SCHEDULER_RESOURCE_REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evaluation-admission-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
]);
export const SCHEDULER_RESOURCE_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const SCHEDULER_RESOURCE_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
export const SCHEDULER_RESOURCE_REQUIRED_TOOLS = Object.freeze([
  "READ_TYPED_RESOURCE_EVIDENCE", "READ_SOURCE_LOCK", "READ_CONTEXT", "READ_ROUTE",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, SCHEDULER_RESOURCE_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message, code = "SCHEDULER_RESOURCE_AUTHORITY_INVALID") {
  const error = new Error(message); error.code = code; throw error;
}
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "SCHEDULER_RESOURCE_DIGEST_INVALID"); }
function gitObject(value, label) { assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`, "SCHEDULER_RESOURCE_GIT_ID_INVALID"); }
function fileSha(file) { return createHash("sha256").update(readRegular(file)).digest("hex"); }
function readRegular(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`missing artifact: ${file}`, "SCHEDULER_RESOURCE_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `artifact is not a canonical regular file: ${file}`, "SCHEDULER_RESOURCE_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readRegular(file);
  try { return Object.freeze({value: JSON.parse(bytes.toString("utf8")), file_sha256: createHash("sha256").update(bytes).digest("hex")}); }
  catch { fail(`${label} is not valid JSON`, "SCHEDULER_RESOURCE_ARTIFACT_INVALID"); }
}
function without(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "SCHEDULER_RESOURCE_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "SCHEDULER_RESOURCE_SCHEMA_INVALID");
}
function validDate(value, label) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "SCHEDULER_RESOURCE_SOURCE_DATE_INVALID");
  assert(Date.parse(`${value}T00:00:00.000Z`) <= Date.now(), `${label} is future-dated`, "SCHEDULER_RESOURCE_SOURCE_FUTURE");
}

function checkBlock(artifact) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === SCHEDULER_RESOURCE_BLOCK_ID, "Resource Scheduler block identity differs", "SCHEDULER_RESOURCE_BLOCK_INVALID");
  assert(block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Resource Scheduler candidate is not inert", "SCHEDULER_RESOURCE_LIFECYCLE_INVALID");
  sha(block.block_sha256, "Resource Scheduler block digest");
  assert(block.block_sha256 === canonicalDigest(without(block, "block_sha256")), "Resource Scheduler block digest is invalid", "SCHEDULER_RESOURCE_BLOCK_DIGEST_INVALID");
  assert(JSON.stringify(block.dependencies) === JSON.stringify(SCHEDULER_RESOURCE_REQUIRED_BLOCKS), "Resource Scheduler dependencies are not canonical", "SCHEDULER_RESOURCE_DEPENDENCY_INVALID");
  assert(block.evaluation?.receipt_id === "specialist-eval.resource-scheduler.v1" && block.evaluation?.independent_reviewer_required === true, "Resource Scheduler evaluation binding is invalid", "SCHEDULER_RESOURCE_EVALUATION_BINDING_INVALID");
  return block;
}

function checkSource(artifact) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === SCHEDULER_RESOURCE_BLOCK_ID, "Resource Scheduler source lock identity differs", "SCHEDULER_RESOURCE_SOURCE_LOCK_INVALID");
  sha(source.manifest_sha256, "Resource Scheduler source manifest digest");
  assert(source.manifest_sha256 === canonicalDigest(without(source, "manifest_sha256")), "Resource Scheduler source manifest digest is invalid", "SCHEDULER_RESOURCE_SOURCE_LOCK_INVALID");
  assert(Array.isArray(source.sources) && source.sources.length >= 1, "Resource Scheduler source lock is empty", "SCHEDULER_RESOURCE_SOURCE_LOCK_INVALID");
  const identities = new Set();
  for (const entry of source.sources) {
    assert(typeof entry.source_id === "string" && !identities.has(entry.source_id), "Resource Scheduler source identity is duplicated", "SCHEDULER_RESOURCE_SOURCE_IDENTITY_INVALID");
    identities.add(entry.source_id);
    assert(typeof entry.version === "string" && entry.version.length > 0 && typeof entry.immutable_identity === "string" && entry.immutable_identity.length > 0, `Resource Scheduler source ${entry.source_id} lacks identity/version`, "SCHEDULER_RESOURCE_SOURCE_IDENTITY_INVALID");
    validDate(entry.retrieved_date, `Resource Scheduler source ${entry.source_id} retrieved date`);
    assert(Object.prototype.hasOwnProperty.call(entry, "effective_date"), `Resource Scheduler source ${entry.source_id} omits effective-date status`, "SCHEDULER_RESOURCE_SOURCE_IDENTITY_INVALID");
  }
  return source;
}

function checkGates() {
  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Resource Scheduler gate manifest");
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === SCHEDULER_RESOURCE_BLOCK_ID, "Resource Scheduler gate manifest identity differs", "SCHEDULER_RESOURCE_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(SCHEDULER_RESOURCE_GATE_IDS), "Resource Scheduler gate order differs", "SCHEDULER_RESOURCE_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(SCHEDULER_RESOURCE_GATE_IDS.map((id) => `gates/${id}.gate`)), "Resource Scheduler gate paths differ", "SCHEDULER_RESOURCE_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Resource Scheduler gate outcomes differ", "SCHEDULER_RESOURCE_GATE_SEMANTICS_INVALID");
  sha(manifest.manifest_sha256, "Resource Scheduler gate manifest digest");
  assert(manifest.manifest_sha256 === canonicalDigest(without(manifest, "manifest_sha256")), "Resource Scheduler gate manifest digest is invalid", "SCHEDULER_RESOURCE_GATE_MANIFEST_INVALID");
  const gates = SCHEDULER_RESOURCE_GATE_IDS.map((id) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${id}.gate`), `Resource Scheduler gate ${id}`);
    const gate = artifact.value;
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Resource Scheduler gate ${id}`);
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === id && gate.block_id === SCHEDULER_RESOURCE_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Resource Scheduler gate ${id} is not executable`, "SCHEDULER_RESOURCE_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Resource Scheduler gate ${id} outcome set differs`, "SCHEDULER_RESOURCE_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Resource Scheduler gate ${id}`);
    assert(gate.gate_sha256 === canonicalDigest(without(gate, "gate_sha256")), `Resource Scheduler gate ${id} digest is invalid`, "SCHEDULER_RESOURCE_GATE_DIGEST_INVALID");
    return Object.freeze({...gate, file_sha256: artifact.file_sha256});
  });
  return Object.freeze({manifest, manifest_file_sha256: manifestArtifact.file_sha256, gates: Object.freeze(gates), semantic_sha256: canonicalDigest(gates.map((gate) => ({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence}))) });
}

function checkExecution(fileSha256) {
  const artifact = readJson(path.join(PACKAGE, "gates/execution.json"), "Resource Scheduler gate execution manifest");
  const execution = artifact.value;
  assert(execution.schema === "agentos.scheduler_resource_gate_execution.v1" && execution.version === 1 && execution.block_id === SCHEDULER_RESOURCE_BLOCK_ID, "Resource Scheduler gate execution identity differs", "SCHEDULER_RESOURCE_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/scheduler-resource-package-evaluator.mjs#evaluateSchedulerResourcePackage" && execution.boundary_entrypoint === "control/scheduler-resource-boundary-gate.mjs#evaluateSchedulerResourceBoundary", "Resource Scheduler gate execution entrypoint differs", "SCHEDULER_RESOURCE_GATE_EXECUTION_INVALID");
  assert(Array.isArray(execution.executions) && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(SCHEDULER_RESOURCE_GATE_IDS) && execution.executions.length === SCHEDULER_RESOURCE_GATE_IDS.length, "Resource Scheduler gate execution coverage is incomplete", "SCHEDULER_RESOURCE_GATE_EXECUTION_INVALID");
  assert(fileSha256 === artifact.file_sha256, "Resource Scheduler gate execution digest is unstable", "SCHEDULER_RESOURCE_GATE_EXECUTION_INVALID");
  return Object.freeze({execution, file_sha256: artifact.file_sha256});
}

export function resolveSchedulerResourceCanonicalAuthority() {
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Resource Scheduler block");
  const block = checkBlock(blockArtifact);
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Resource Scheduler source lock");
  const source = checkSource(sourceArtifact);
  const gates = checkGates();
  const execution = checkExecution(fileSha(path.join(PACKAGE, "gates/execution.json")));
  const boundaryFile = path.join(ROOT, "control/scheduler-resource-boundary-gate.mjs");
  const evaluatorFile = path.join(ROOT, "control/scheduler-resource-package-evaluator.mjs");
  const inputSchemaFile = path.join(ROOT, "schemas/scheduler-resource-boundary-input.v1.json");
  const resultSchemaFile = path.join(ROOT, "schemas/scheduler-resource-boundary-result.v1.json");
  const modelRoute = Object.freeze({task_class: SCHEDULER_RESOURCE_TASK_CLASS, model: SCHEDULER_RESOURCE_MODEL, reasoning_effort: SCHEDULER_RESOURCE_REASONING_EFFORT, route_source: "control/native-host-contract.mjs#DEFAULT_AGENT_MODEL", route_file: "control/native-host-contract.mjs", route_file_sha256: fileSha(path.join(ROOT, "control/native-host-contract.mjs"))});
  const modelRouteSha256 = canonicalDigest(modelRoute);
  const route = Object.freeze({schema: "agentos.scheduler_resource_route_binding.v1", version: 1, route: "RESOURCE_OWNER_HANDOFF", target_role: "TYPED_RESOURCE_OWNER", entrypoint: "control/scheduler-resource-boundary-gate.mjs#evaluateSchedulerResourceBoundary", action_set: ["CLASSIFY_ADMISSION", "CLASSIFY_PRESSURE", "CLASSIFY_ROUTING"], side_effects: "READ_ONLY"});
  const routeSha256 = canonicalDigest(route);
  const context = Object.freeze({schema: "agentos.scheduler_resource_context_binding.v1", version: 1, block_id: SCHEDULER_RESOURCE_BLOCK_ID, block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, source_lock_file_sha256: sourceArtifact.file_sha256, boundary_file_sha256: fileSha(boundaryFile), evaluator_file_sha256: fileSha(evaluatorFile), input_schema_file_sha256: fileSha(inputSchemaFile), result_schema_file_sha256: fileSha(resultSchemaFile), gate_manifest_file_sha256: gates.manifest_file_sha256, gate_semantic_inventory_sha256: gates.semantic_sha256, gate_execution_file_sha256: execution.file_sha256, model_route_sha256: modelRouteSha256, route_sha256: routeSha256, authority_scope: SCHEDULER_RESOURCE_TASK_CLASS, scope: "NARROW", custody_ref: SCHEDULER_RESOURCE_CUSTODY_REF, memory_binding: "TYPED_HANDOFF_ONLY;_NO_PROJECT_MEMORY_WRITE", lifecycle: "CANDIDATE;_ACTIVATION_OFF"});
  const contextSha256 = canonicalDigest(context);
  return Object.freeze({repository_root: ROOT, package_path: SCHEDULER_RESOURCE_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identities: Object.freeze(source.sources.map((entry) => entry.immutable_identity).sort(compareUtf8)), source_versions: Object.freeze(source.sources.map((entry) => entry.version).sort(compareUtf8)), gates: gates.gates, gate_manifest_sha256: gates.manifest.manifest_sha256, gate_manifest_file_sha256: gates.manifest_file_sha256, gate_execution_file_sha256: execution.file_sha256, gate_semantic_inventory_sha256: gates.semantic_sha256, boundary_file_sha256: fileSha(boundaryFile), evaluator_file_sha256: fileSha(evaluatorFile), input_schema_file_sha256: fileSha(inputSchemaFile), result_schema_file_sha256: fileSha(resultSchemaFile), model_route: modelRoute, model_route_sha256: modelRouteSha256, route, route_sha256: routeSha256, context, context_sha256: contextSha256, custody_ref: SCHEDULER_RESOURCE_CUSTODY_REF});
}

export function assertSchedulerResourceCanonicalEvidence(evidence, authority = resolveSchedulerResourceCanonicalAuthority()) {
  assert(evidence && typeof evidence === "object" && !Array.isArray(evidence), "Resource Scheduler evidence is not an object", "SCHEDULER_RESOURCE_EVIDENCE_INVALID");
  assert(evidence.authority_status === "CURRENT" && evidence.owner_role === "AGENTOS_CONTROLLER" && evidence.owner_identity === "OWNER.TYPED.RESOURCE" && evidence.owner_intent_status === "BOUND" && evidence.intent_provenance_status === "EXACT_TYPED_RECORD", "Typed resource-owner authority is not bound", "SCHEDULER_RESOURCE_AUTHORITY_UNBOUND");
  sha(evidence.owner_intent_digest, "owner intent digest");
  assert(evidence.candidate_status === "CURRENT_CANDIDATE" && evidence.candidate_digest === authority.block_sha256, "Resource Scheduler candidate digest is not canonical", "SCHEDULER_RESOURCE_CANDIDATE_BINDING_INVALID");
  assert(evidence.source_status === "CURRENT_VERIFIED" && evidence.source_manifest_sha256 === authority.source_manifest_sha256 && evidence.source_lock_sha256 === authority.source_file_sha256 && JSON.stringify(evidence.source_identities) === JSON.stringify(authority.source_identities) && JSON.stringify(evidence.source_versions) === JSON.stringify(authority.source_versions), "Resource Scheduler source binding is not canonical", "SCHEDULER_RESOURCE_SOURCE_BINDING_INVALID");
  assert(evidence.model_policy_status === "CURRENT" && evidence.model_route_status === "BOUND" && evidence.model === authority.model_route.model && evidence.reasoning_effort === authority.model_route.reasoning_effort && evidence.model_route_sha256 === authority.model_route_sha256, "Resource Scheduler model route is not canonical", "SCHEDULER_RESOURCE_MODEL_ROUTE_INVALID");
  assert(evidence.context_receipt_sha256 === authority.context_sha256 && evidence.route_receipt_sha256 === authority.route_sha256, "Resource Scheduler context or route receipt is not canonical", "SCHEDULER_RESOURCE_CONTEXT_ROUTE_INVALID");
  assert(evidence.signal === "EXPLICIT_TYPED_RESOURCE_SIGNAL" && evidence.signal_status === "BOUND" && evidence.context_status === "RESOURCE_SCHEDULER_CONTEXT" && evidence.context_complete === true && evidence.task_status === SCHEDULER_RESOURCE_TASK_CLASS, "Resource Scheduler context is incomplete", "SCHEDULER_RESOURCE_CONTEXT_INCOMPLETE");
  assert(evidence.authority_scope === SCHEDULER_RESOURCE_TASK_CLASS && evidence.scope === "NARROW", "Resource Scheduler scope is not narrow", "SCHEDULER_RESOURCE_SCOPE_INVALID");
  assert(evidence.custody_status === "BOUND" && evidence.custody_owner === "AGENTOS.CONTROL.RESOURCE_SCHEDULER" && evidence.custody_ref === authority.custody_ref, "Resource Scheduler custody is not canonical", "SCHEDULER_RESOURCE_CUSTODY_INVALID");
  assert(JSON.stringify(evidence.requested_tools) === JSON.stringify(SCHEDULER_RESOURCE_REQUIRED_TOOLS), "Resource Scheduler requested tools exceed read-only scope", "SCHEDULER_RESOURCE_TOOL_SCOPE_INVALID");
  assert(evidence.project_data_present === false && evidence.secret_data_present === false, "Resource Scheduler evidence contains protected data", "SCHEDULER_RESOURCE_PRIVACY_INVALID");
  return authority;
}

export function assertSchedulerResourceCommittedHandoff({authority = resolveSchedulerResourceCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256, rollbackFileSha256, rollbackReceiptSha256} = {}) {
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "pre_admission_evaluator", "implementation_entrypoint", "implementation_artifacts", "authority_status", "cases", "results", "disposition", "independence_rule"], "Resource Scheduler evaluation dossier");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.resource-scheduler.v1" && evaluation.block_id === SCHEDULER_RESOURCE_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.model_requirement === `${authority.model_route.model}/${authority.model_route.reasoning_effort}` && evaluation.authority_status === "NON_AUTHORITATIVE_OPERATIONAL_EVIDENCE_ONLY", "Resource Scheduler evaluation dossier is not bound", "SCHEDULER_RESOURCE_EVALUATION_INVALID");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === SCHEDULER_RESOURCE_FIXTURE_CLASSES.length && new Set(evaluation.cases.map((entry) => entry.class)).size === SCHEDULER_RESOURCE_FIXTURE_CLASSES.length && evaluation.cases.every((entry) => SCHEDULER_RESOURCE_FIXTURE_CLASSES.includes(entry.class) && entry.observed === "PENDING"), "Resource Scheduler evaluation case coverage is incomplete", "SCHEDULER_RESOURCE_EVALUATION_INVALID");
  assert(evaluation.results?.passed === 0 && evaluation.results?.failed === 0 && evaluation.results?.pending === SCHEDULER_RESOURCE_FIXTURE_CLASSES.length && evaluation.disposition === "UTILITY_HARM_PENDING", "Resource Scheduler evaluation disposition is not inert", "SCHEDULER_RESOURCE_EVALUATION_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Resource Scheduler handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.resource-scheduler.v1" && handoff.block_id === SCHEDULER_RESOURCE_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Resource Scheduler handoff identity differs", "SCHEDULER_RESOURCE_HANDOFF_INVALID");
  assert(typeof evaluationFileSha256 === "string" && typeof handoffFileSha256 === "string" && typeof rollbackFileSha256 === "string" && typeof rollbackReceiptSha256 === "string", "Resource Scheduler handoff receipts are missing", "SCHEDULER_RESOURCE_HANDOFF_BINDING_INVALID");
  const proof = new Set(handoff.proof ?? []);
  for (const item of [
    // A handoff cannot safely contain its own final file hash; all other
    // receipts are bound below and the handoff file itself is checked by the
    // caller as a canonical regular file.
    `evaluation_file_sha256:${evaluationFileSha256}`,
    `candidate_block_file_sha256:${authority.block_file_sha256}`, `block_file_sha256:${authority.block_file_sha256}`, `source_lock_file_sha256:${authority.source_file_sha256}`,
    `gate_manifest_file_sha256:${authority.gate_manifest_file_sha256}`, `gate_execution_file_sha256:${authority.gate_execution_file_sha256}`,
    `gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`, `boundary_file_sha256:${authority.boundary_file_sha256}`,
    `evaluator_file_sha256:${authority.evaluator_file_sha256}`, `model_route_sha256:${authority.model_route_sha256}`,
    `context_receipt_sha256:${authority.context_sha256}`, `route_receipt_sha256:${authority.route_sha256}`,
    `rollback_file_sha256:${rollbackFileSha256}`, `rollback_receipt_sha256:${rollbackReceiptSha256}`,
  ]) assert(proof.has(item), `Resource Scheduler handoff proof omits ${item.split(":")[0]}`, "SCHEDULER_RESOURCE_HANDOFF_BINDING_INVALID");
  return true;
}

export {SCHEDULER_RESOURCE_PACKAGE_PATH as PACKAGE_PATH};
