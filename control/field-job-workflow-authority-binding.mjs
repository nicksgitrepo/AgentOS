#!/usr/bin/env node

/*
 * Repository-bound authority for the Field Job Workflow atomic specialist.
 *
 * The public boundary may receive a serialized request, but the package,
 * sources, model route, context contract, invalidation graph, upstream
 * router, and registry are resolved from this repository.  Caller-provided
 * copies of those facts are read back and compared; they are never authority.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateWorkflowRouterBoundary} from "./workflow-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const FIELD_JOB_WORKFLOW_PACKAGE_PATH = "specialist-blocks/wave-06/field-job-workflow";
export const FIELD_JOB_WORKFLOW_BLOCK_ID = "specialist.domain.field-job-workflow";
export const FIELD_JOB_WORKFLOW_AGENT_ID = "AGENT.DOMAIN_FIELD_JOB_WORKFLOW";
export const FIELD_JOB_WORKFLOW_MODEL_TASK_CLASS = "NARROW_CODING";
export const FIELD_JOB_WORKFLOW_MODEL_ID = "gpt-5.6-luna";
export const FIELD_JOB_WORKFLOW_MODEL_CAPABILITY_FLOOR = 49;
export const FIELD_JOB_WORKFLOW_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const FIELD_JOB_WORKFLOW_CUSTODY_REF = "opaque:FIELD_JOB_WORKFLOW.CUSTODY";
export const FIELD_JOB_WORKFLOW_SHARED_REGISTRY_DRIFT_CODE = "SHARED_REGISTRY_SPAWNER_INTEGRATION_DRIFT";
export const FIELD_JOB_WORKFLOW_TOOLS = Object.freeze([
  "READ_SIGNAL",
  "READ_SOURCE_LOCK",
  "READ_WORKFLOW_CATALOG",
  "READ_CONTEXT",
  "READ_SAFETY_BOUNDARY",
]);
export const FIELD_JOB_WORKFLOW_REQUIRED_BLOCKS = Object.freeze([
  "specialist.domain.workflow-router",
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
]);
export const FIELD_JOB_WORKFLOW_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const FIELD_JOB_WORKFLOW_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim",
  "data_limit", "duplicate_sibling_authority", "false_positive", "handoff",
  "missing_context", "narrowness", "router_self_accept", "routing",
  "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority",
  "unrelated_scope", "unsafe_action",
]);
export const FIELD_JOB_WORKFLOW_FLAG_NAMES = Object.freeze([
  "authority_conflict", "scope_expanded", "data_limit", "protected_data", "stale_source",
  "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope",
  "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive",
  "handoff_incomplete", "lifecycle_invalid",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, FIELD_JOB_WORKFLOW_PACKAGE_PATH);
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const AGENT_ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const SPECIALIST_ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/roster.v1.json");
const ROUTING_INDEX_PATH = path.join(ROOT, "specialist-blocks/registry/routing-index.v1.json");
const ATOMIC_INVENTORY_PATH = path.join(ROOT, "specialist-blocks/registry/atomic-inventory.v1.json");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/workflow-router-boundary-gate.mjs");
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;

function fail(message, code = "FIELD_JOB_WORKFLOW_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "FIELD_JOB_WORKFLOW_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "FIELD_JOB_WORKFLOW_SCHEMA_INVALID");
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "FIELD_JOB_WORKFLOW_DIGEST_INVALID");
}

function fileSha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function body(value, field) {
  const copy = structuredClone(value);
  copy[field] = null;
  return copy;
}

function readRegular(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "FIELD_JOB_WORKFLOW_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "FIELD_JOB_WORKFLOW_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readRegular(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "FIELD_JOB_WORKFLOW_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}

function validDate(value, label, nowMs, {allowNull = false, maxAgeDays = null} = {}) {
  if (allowNull && value === null) return null;
  assert(typeof value === "string" && ISO_DATE.test(value), `${label} is not an ISO date`, "FIELD_JOB_WORKFLOW_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(Number.isFinite(time) && time <= nowMs, `${label} is future-dated`, "FIELD_JOB_WORKFLOW_SOURCE_FUTURE");
  if (maxAgeDays !== null) assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "FIELD_JOB_WORKFLOW_SOURCE_STALE");
  return time;
}

function checkBlock(artifact) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1, "Field Job Workflow block schema differs", "FIELD_JOB_WORKFLOW_BLOCK_INVALID");
  assert(block.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Field Job Workflow block state differs", "FIELD_JOB_WORKFLOW_BLOCK_STATE_INVALID");
  sha(block.block_sha256, "Field Job Workflow block digest");
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), "Field Job Workflow block digest does not match its bytes", "FIELD_JOB_WORKFLOW_BLOCK_DIGEST_INVALID");
  assert(block.required_upstream_router === "specialist.domain.workflow-router", "Field Job Workflow upstream router differs", "FIELD_JOB_WORKFLOW_ROUTER_BINDING_INVALID");
  assert(block.maximum_authority === "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION", "Field Job Workflow authority is widened", "FIELD_JOB_WORKFLOW_AUTHORITY_INVALID");
  return block;
}

function checkSources(artifact, nowMs) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID, "Field Job Workflow source lock identity differs", "FIELD_JOB_WORKFLOW_SOURCE_LOCK_INVALID");
  sha(source.manifest_sha256, "Field Job Workflow source manifest");
  assert(source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "Field Job Workflow source manifest digest differs", "FIELD_JOB_WORKFLOW_SOURCE_LOCK_INVALID");
  assert(/(?:DENY|STALE|EXPIRE|REFRESH)/iu.test(source.freshness_rule), "Field Job Workflow source freshness rule is not fail-closed", "FIELD_JOB_WORKFLOW_SOURCE_FRESHNESS_INVALID");
  const byId = new Map((source.sources ?? []).map((item) => [item.source_id, item]));
  const atomic = byId.get("source.atomic-specialization-law");
  const site = byId.get("source.osha-oil-gas-site-preparation");
  const well = byId.get("source.osha-oil-gas-well-etool");
  assert(atomic && site && well, "Field Job Workflow source lock is incomplete", "FIELD_JOB_WORKFLOW_SOURCE_COVERAGE_INVALID");
  assert(atomic.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE", "Atomic specialization source identity differs", "FIELD_JOB_WORKFLOW_SOURCE_IDENTITY_INVALID");
  assert(site.immutable_identity === "osha-oil-gas-site-preparation-current-2026-06-10" && site.authority_class === "PRIMARY_DESCRIPTIVE", "OSHA site-preparation source identity differs", "FIELD_JOB_WORKFLOW_SOURCE_IDENTITY_INVALID");
  assert(well.immutable_identity === "osha-oil-gas-well-etool-current-2026-08-11" && well.authority_class === "PRIMARY_DESCRIPTIVE", "OSHA well-etool source identity differs", "FIELD_JOB_WORKFLOW_SOURCE_IDENTITY_INVALID");
  for (const item of [atomic, site, well]) validDate(item.retrieved_date, `${item.source_id} retrieved date`, nowMs, {maxAgeDays: 31});
  validDate(atomic.effective_date, "Atomic source effective date", nowMs);
  assert(site.effective_date === null && well.effective_date === null, "OSHA source effective-date status was hidden", "FIELD_JOB_WORKFLOW_SOURCE_DATE_STATUS_INVALID");
  return {manifest: source, source, byId, atomic, site, well};
}

function checkModel(artifact, routeArtifact, nowUtc) {
  const snapshot = artifact.value;
  validateModelPolicySnapshot(snapshot, {nowUtc, requireActive: false});
  assert(snapshot.schema === "agentos.model_policy_snapshot.v1" && snapshot.status === "PREPARED_INACTIVE", "Field Job Workflow model snapshot is not the prepared candidate snapshot", "FIELD_JOB_WORKFLOW_MODEL_POLICY_INVALID");
  const task = snapshot.task_classes.find((item) => item.task_class === FIELD_JOB_WORKFLOW_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === FIELD_JOB_WORKFLOW_MODEL_CAPABILITY_FLOOR && task.minimum_context_tokens === 64_000, "Field Job Workflow task class policy differs", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(JSON.stringify(task.required_capabilities) === JSON.stringify(FIELD_JOB_WORKFLOW_MODEL_CAPABILITIES), "Field Job Workflow model capabilities differ", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  const model = snapshot.models.find((item) => item.model_id === FIELD_JOB_WORKFLOW_MODEL_ID);
  assert(model && model.host_available === true && model.capability_score >= FIELD_JOB_WORKFLOW_MODEL_CAPABILITY_FLOOR && model.context_tokens >= task.minimum_context_tokens, "Field Job Workflow model is unavailable or below floor", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(FIELD_JOB_WORKFLOW_MODEL_CAPABILITIES.every((capability) => model.capabilities.includes(capability)), "Field Job Workflow model capability evidence is incomplete", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(model.host_supported_reasoning_efforts.includes(task.preferred_reasoning_effort), "Field Job Workflow model reasoning mode is unavailable", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  const route = routeArtifact.value;
  exactKeys(route, ["schema", "version", "status", "route_source", "task_class", "model_id", "reasoning_effort", "capability_floor", "required_capabilities", "context_floor_tokens", "snapshot_sha256", "route_sha256"], "Field Job Workflow model route");
  assert(route.schema === "agentos.field_job_workflow_model_route.v1" && route.version === 1 && route.status === "BOUND" && route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Field Job Workflow model route identity differs", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(route.task_class === task.task_class && route.model_id === model.model_id && route.reasoning_effort === task.preferred_reasoning_effort, "Field Job Workflow model route selection differs", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(route.capability_floor === task.minimum_capability_score && route.context_floor_tokens === task.minimum_context_tokens && JSON.stringify(route.required_capabilities) === JSON.stringify(task.required_capabilities), "Field Job Workflow model route floor differs", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(route.snapshot_sha256 === snapshot.snapshot_sha256, "Field Job Workflow route is bound to a stale model snapshot", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_STALE");
  sha(route.route_sha256, "Field Job Workflow model route digest");
  assert(route.route_sha256 === canonicalDigest(body(route, "route_sha256")), "Field Job Workflow model route digest differs", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  return {snapshot, task, model, route};
}

function checkContext(contextArtifact, invalidationArtifact, source, model, nowMs) {
  const context = contextArtifact.value;
  exactKeys(context, ["schema", "version", "block_id", "status", "context_contract_id", "required_fields", "source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "memory_scope", "memory_write_allowed", "dependency_artifacts", "invalidation_triggers", "context_sha256"], "Field Job Workflow context");
  assert(context.schema === "agentos.specialist_context_projection.v1" && context.version === 1 && context.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && context.status === "BOUND_CANDIDATE_CONTEXT", "Field Job Workflow context identity differs", "FIELD_JOB_WORKFLOW_CONTEXT_INVALID");
  assert(Array.isArray(context.required_fields) && context.required_fields.length >= 10 && new Set(context.required_fields).size === context.required_fields.length, "Field Job Workflow context contract is incomplete", "FIELD_JOB_WORKFLOW_CONTEXT_INVALID");
  assert(context.source_manifest_sha256 === source.manifest.manifest_sha256 && context.model_snapshot_sha256 === model.snapshot.snapshot_sha256 && context.model_route_sha256 === model.route.route_sha256, "Field Job Workflow context is bound to stale authority", "FIELD_JOB_WORKFLOW_CONTEXT_STALE");
  assert(context.memory_scope === "TYPED_HANDOFF_ONLY" && context.memory_write_allowed === false, "Field Job Workflow context permits memory mutation", "FIELD_JOB_WORKFLOW_MEMORY_AUTHORITY_INVALID");
  sha(context.context_sha256, "Field Job Workflow context digest");
  assert(context.context_sha256 === canonicalDigest(body(context, "context_sha256")), "Field Job Workflow context digest differs", "FIELD_JOB_WORKFLOW_CONTEXT_INVALID");
  const graph = invalidationArtifact.value;
  exactKeys(graph, ["schema", "version", "block_id", "status", "memory_scope", "write_allowed", "edges", "closure_policy", "graph_sha256"], "Field Job Workflow invalidation graph");
  assert(graph.schema === "agentos.specialist_memory_context_invalidation.v1" && graph.version === 1 && graph.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && graph.status === "BOUND_CANDIDATE", "Field Job Workflow invalidation graph identity differs", "FIELD_JOB_WORKFLOW_INVALIDATION_INVALID");
  assert(graph.memory_scope === "TYPED_HANDOFF_ONLY" && graph.write_allowed === false, "Field Job Workflow invalidation graph permits memory writes", "FIELD_JOB_WORKFLOW_MEMORY_AUTHORITY_INVALID");
  assert(Array.isArray(graph.edges) && graph.edges.length >= 6, "Field Job Workflow invalidation graph is incomplete", "FIELD_JOB_WORKFLOW_INVALIDATION_INVALID");
  sha(graph.graph_sha256, "Field Job Workflow invalidation graph digest");
  assert(graph.graph_sha256 === canonicalDigest(body(graph, "graph_sha256")), "Field Job Workflow invalidation graph digest differs", "FIELD_JOB_WORKFLOW_INVALIDATION_INVALID");
  const edgeKeys = new Set(graph.edges.map((edge) => edge.changed));
  for (const key of ["candidate_block", "source_manifest", "model_policy_snapshot", "model_route", "upstream_router_result", "custody_ref", "context_contract"]) assert(edgeKeys.has(key), `Field Job Workflow invalidation trigger is missing: ${key}`, "FIELD_JOB_WORKFLOW_INVALIDATION_INVALID");
  return {context, graph};
}

function canonicalUpstreamResult(candidateDigest) {
  const flags = Object.fromEntries([
    "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
    "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
    "broad_claim", "cross_provider", "false_positive",
  ].map((key) => [key, false]));
  const input = {
    schema: "agentos.workflow_router_boundary_input.v1",
    version: 1,
    request_kind: "CLASSIFY_WORKFLOW_SIGNAL",
    evidence: {
      authority_status: "CURRENT", workflow_domain: "FIELD_WORKFLOW", workflow_phase: "PLANNING", workflow_task: "TYPED_CLASSIFICATION",
      workflow_ref: "ref:WORKFLOW/EXTERNAL/1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.OSHA_OIL_GAS_WELL_ETOOL", source_version: "current",
      candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, workflow_signal: "DOMAIN.FIELD_JOB_WORKFLOW", signal_status: "BOUND",
      task_status: "WORKFLOW_CLASSIFICATION", context_status: "WORKFLOW_ROUTER_CONTEXT", context_complete: true, requested_action: "CLASSIFY",
      requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_WORKFLOW_CATALOG", "READ_CONTEXT", "READ_SAFETY_BOUNDARY"],
      required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"],
      model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "DOMAIN_WORKFLOW_ROUTER", new_findings: false,
      project_data_present: false, secret_data_present: false, adversarial_flags: flags,
    },
  };
  const result = evaluateWorkflowRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "WORKFLOW_ATOMIC_HANDOFF" && result.routing_allowed === true, "Canonical upstream workflow router did not produce a route", "FIELD_JOB_WORKFLOW_UPSTREAM_ROUTER_INVALID");
  return result;
}

function relativeRegularFileSha(relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return null;
  const file = path.resolve(ROOT, relativePath);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file) !== file) return null;
    return fileSha(file);
  } catch {
    return null;
  }
}

function sharedPinMismatches(pins, identityKey) {
  return (Array.isArray(pins) ? pins : []).flatMap((pin, index) => {
    const expected = typeof pin?.file_sha256 === "string" ? pin.file_sha256 : null;
    const actual = relativeRegularFileSha(pin?.path);
    return expected && actual === expected ? [] : [{
      identity: pin?.[identityKey] ?? pin?.class ?? pin?.fixture_id ?? `index:${index}`,
      path: pin?.path ?? null,
      expected_sha256: expected,
      actual_sha256: actual,
    }];
  });
}

function inspectSharedRegistryIntegration(agentRosterArtifact, agentEntry, packageRegistry) {
  const gatePinMismatches = sharedPinMismatches(agentEntry?.deterministic_gates?.gates, "gate_id");
  const fixturePinMismatches = sharedPinMismatches(agentEntry?.hostile_fixtures?.fixtures, "fixture_id");
  const handoffPin = agentEntry?.required_evidence_handoff;
  const handoffActual = relativeRegularFileSha(handoffPin?.handoff_path);
  const handoffPinMismatch = !handoffPin?.handoff_file_sha256 || handoffActual !== handoffPin.handoff_file_sha256;
  const packageEvaluation = readJson(path.join(PACKAGE, "evaluation.json"), "Field Job Workflow evaluation dossier").value;
  const reviewStateMismatch = agentEntry?.independent_evaluation_state !== packageEvaluation.disposition;
  const drift = gatePinMismatches.length > 0 || fixturePinMismatches.length > 0 || handoffPinMismatch || reviewStateMismatch;
  return Object.freeze({
    schema: "agentos.field_job_workflow_shared_registry_integration_result.v1",
    verdict: drift ? "BLOCKED_EXACT" : "ALIGNED",
    finding_code: drift ? FIELD_JOB_WORKFLOW_SHARED_REGISTRY_DRIFT_CODE : null,
    severity: drift ? "HIGH" : null,
    owning_layer: "shared reusable-agent roster / Spawner integration",
    repair_route: "ISOLATED_SPAWNER_GLOBAL_REPAIR:RUN_REUSABLE_AGENT_ROSTER_COMPILER_THEN_RERUN_SPECIALIST_COMPILER_EVALUATOR_VERIFIER_AND_SEALED_EXTERNAL_REVIEW",
    residual_ceiling: "NO_CONSUME_ADMIT_ACTIVATE_DEPLOY_OR_PRODUCTION_CLEARANCE;_PUBLIC_BOUNDARY_REMAINS_CANDIDATE_ONLY_READ_ONLY",
    evidence: {
      agent_roster_path: "specialist-blocks/registry/agent-roster.v1.json",
      agent_roster_sha256: agentRosterArtifact.file_sha256,
      gate_pin_mismatch_count: gatePinMismatches.length,
      gate_pin_mismatches: gatePinMismatches,
      fixture_pin_mismatch_count: fixturePinMismatches.length,
      fixture_pin_mismatches: fixturePinMismatches,
      handoff_pin_mismatch: handoffPinMismatch,
      handoff_path: handoffPin?.handoff_path ?? null,
      handoff_expected_sha256: handoffPin?.handoff_file_sha256 ?? null,
      handoff_actual_sha256: handoffActual,
      shared_independent_evaluation_state: agentEntry?.independent_evaluation_state ?? null,
      package_evaluation_disposition: packageEvaluation.disposition ?? null,
      review_state_mismatch: reviewStateMismatch,
      package_registry_evaluation_disposition: packageRegistry?.evaluation?.disposition ?? null,
    },
  });
}

function checkRegistry(block, source, model, context, graph) {
  const agentRosterArtifact = readJson(AGENT_ROSTER_PATH, "Reusable agent roster");
  const agentRoster = agentRosterArtifact.value;
  const agentEntry = agentRoster.entries?.find((entry) => entry.stable_agent_id === FIELD_JOB_WORKFLOW_AGENT_ID);
  assert(agentEntry && agentEntry.canonical_block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && agentEntry.package_path === FIELD_JOB_WORKFLOW_PACKAGE_PATH, "Field Job Workflow reusable-agent registry entry is missing or substituted", "FIELD_JOB_WORKFLOW_REGISTRY_BINDING_INVALID");
  assert(agentEntry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" && agentEntry.qa_state === "STATIC_PASS_REVIEW_REQUIRED" && agentEntry.independent_evaluation_state === "STATIC_PASS_REVIEW_REQUIRED", "Field Job Workflow registry entry claims unsupported admission", "FIELD_JOB_WORKFLOW_REGISTRY_STATE_INVALID");
  assert(agentEntry.model_route?.task_class === FIELD_JOB_WORKFLOW_MODEL_TASK_CLASS && agentEntry.model_route.minimum_capability === FIELD_JOB_WORKFLOW_MODEL_CAPABILITY_FLOOR && JSON.stringify(agentEntry.model_route.required_capabilities) === JSON.stringify(FIELD_JOB_WORKFLOW_MODEL_CAPABILITIES) && agentEntry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Field Job Workflow registry model route differs", "FIELD_JOB_WORKFLOW_REGISTRY_MODEL_ROUTE_INVALID");
  const packageRegistryArtifact = readJson(path.join(PACKAGE, "registry-entry.json"), "Field Job Workflow package registry entry");
  const packageRegistry = packageRegistryArtifact.value;
  exactKeys(packageRegistry, ["schema", "version", "stable_agent_id", "block_id", "package_path", "lifecycle", "activation", "build_state", "qa_state", "independent_evaluation_state", "block_sha256", "source_lock", "model_route", "context_projection", "memory_invalidation", "gates", "hostile_fixtures", "handoff", "evaluation", "focused_test", "custody_ref", "rollback_rule", "independent_review_required", "registry_sha256"], "Field Job Workflow package registry entry");
  assert(packageRegistry.schema === "agentos.field_job_workflow_registry_entry.v1" && packageRegistry.version === 1 && packageRegistry.stable_agent_id === FIELD_JOB_WORKFLOW_AGENT_ID && packageRegistry.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && packageRegistry.package_path === FIELD_JOB_WORKFLOW_PACKAGE_PATH, "Field Job Workflow package registry identity differs", "FIELD_JOB_WORKFLOW_REGISTRY_BINDING_INVALID");
  assert(packageRegistry.lifecycle === "CANDIDATE" && packageRegistry.activation === "OFF" && packageRegistry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" && packageRegistry.qa_state === "STATIC_PASS_REVIEW_REQUIRED" && packageRegistry.independent_evaluation_state === "STATIC_PASS_REVIEW_REQUIRED" && packageRegistry.independent_review_required === true, "Field Job Workflow package registry claims unsupported admission", "FIELD_JOB_WORKFLOW_REGISTRY_STATE_INVALID");
  assert(packageRegistry.block_sha256 === block.block_sha256 && packageRegistry.registry_sha256 === canonicalDigest(body(packageRegistry, "registry_sha256")), "Field Job Workflow package registry digest is stale", "FIELD_JOB_WORKFLOW_REGISTRY_DIGEST_INVALID");
  assert(packageRegistry.source_lock?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/sources.lock` && packageRegistry.source_lock.manifest_sha256 === source.source.manifest_sha256, "Field Job Workflow package registry source binding is stale", "FIELD_JOB_WORKFLOW_REGISTRY_SOURCE_STALE");
  assert(packageRegistry.model_route?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/model-route.json` && packageRegistry.model_route.task_class === model.route.task_class && packageRegistry.model_route.model_id === model.route.model_id && packageRegistry.model_route.snapshot_sha256 === model.snapshot.snapshot_sha256 && packageRegistry.model_route.route_sha256 === model.route.route_sha256, "Field Job Workflow package registry model binding is stale", "FIELD_JOB_WORKFLOW_REGISTRY_MODEL_ROUTE_INVALID");
  assert(packageRegistry.context_projection?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/context.json` && packageRegistry.context_projection.context_sha256 === context.context.context_sha256 && packageRegistry.context_projection.memory_scope === context.context.memory_scope && packageRegistry.context_projection.memory_write_allowed === false, "Field Job Workflow package registry context binding is stale", "FIELD_JOB_WORKFLOW_REGISTRY_CONTEXT_INVALID");
  assert(packageRegistry.memory_invalidation?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/memory-invalidation.json` && packageRegistry.memory_invalidation.graph_sha256 === graph.graph_sha256 && packageRegistry.memory_invalidation.write_allowed === false, "Field Job Workflow package registry invalidation binding is stale", "FIELD_JOB_WORKFLOW_REGISTRY_INVALIDATION_INVALID");
  assert(packageRegistry.gates?.manifest_path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/gates/manifest.json` && packageRegistry.gates.execution_path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/gates/execution.json` && SHA256.test(packageRegistry.gates.execution_sha256), "Field Job Workflow package registry gate execution binding is missing", "FIELD_JOB_WORKFLOW_REGISTRY_GATE_INVALID");
  const gateEntries = new Map((packageRegistry.gates.ordered ?? []).map((entry) => [entry.gate_id, entry]));
  for (const gateId of FIELD_JOB_WORKFLOW_GATE_IDS) {
    const file = path.join(PACKAGE, "gates", `${gateId}.gate`);
    const item = gateEntries.get(gateId);
    assert(item && item.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/gates/${gateId}.gate` && item.file_sha256 === fileSha(file), `Field Job Workflow registry gate digest is stale: ${gateId}`, "FIELD_JOB_WORKFLOW_REGISTRY_GATE_STALE");
  }
  const fixtureEntries = new Map((packageRegistry.hostile_fixtures ?? []).map((entry) => [entry.class, entry]));
  for (const className of FIELD_JOB_WORKFLOW_FIXTURE_CLASSES) {
    const relative = `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/fixtures/${className}.json`;
    const item = fixtureEntries.get(className);
    assert(item && item.file_sha256 === fileSha(path.join(ROOT, relative)), `Field Job Workflow registry fixture digest is stale: ${className}`, "FIELD_JOB_WORKFLOW_REGISTRY_FIXTURE_STALE");
  }
  const handoffPath = path.join(PACKAGE, "handoff.json");
  assert(packageRegistry.handoff?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/handoff.json` && packageRegistry.handoff.file_sha256 === fileSha(handoffPath) && packageRegistry.handoff.independent_review_required === true, "Field Job Workflow registry handoff digest is stale", "FIELD_JOB_WORKFLOW_REGISTRY_HANDOFF_STALE");
  assert(packageRegistry.evaluation?.path === `${FIELD_JOB_WORKFLOW_PACKAGE_PATH}/evaluation.json` && packageRegistry.evaluation.disposition === "EXECUTED_REVIEW_REQUIRED" && packageRegistry.evaluation.canonical_external_admission === "BLOCKED_EXACT:SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED", "Field Job Workflow registry evaluation binding is stale", "FIELD_JOB_WORKFLOW_REGISTRY_EVALUATION_INVALID");
  assert(packageRegistry.focused_test === "tests/verify-field-job-workflow-boundary.mjs" && fs.existsSync(path.join(ROOT, packageRegistry.focused_test)) && packageRegistry.custody_ref === FIELD_JOB_WORKFLOW_CUSTODY_REF && packageRegistry.rollback_rule.includes("isolated lane branch"), "Field Job Workflow registry custody binding is incomplete", "FIELD_JOB_WORKFLOW_REGISTRY_CUSTODY_INVALID");
  const sharedRegistryIntegration = inspectSharedRegistryIntegration(agentRosterArtifact, agentEntry, packageRegistry);

  const specialistRoster = readJson(SPECIALIST_ROSTER_PATH, "Compiled specialist roster").value;
  const specialistEntry = specialistRoster.blocks?.find((entry) => entry.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID);
  assert(specialistEntry && specialistEntry.candidate_digest === block.block_sha256 && specialistEntry.activation === "OFF" && specialistEntry.lifecycle === "NOT_ADMITTED", "Compiled specialist roster binding is stale or widened", "FIELD_JOB_WORKFLOW_REGISTRY_BINDING_INVALID");
  const routing = readJson(ROUTING_INDEX_PATH, "Compiled specialist routing index").value;
  const routeEntry = routing.routes?.find((entry) => entry.route_id === "route.domain.field-job-workflow");
  assert(routeEntry && JSON.stringify(routeEntry.select) === JSON.stringify([FIELD_JOB_WORKFLOW_BLOCK_ID]), "Compiled specialist routing entry is missing or substituted", "FIELD_JOB_WORKFLOW_ROUTING_REGISTRY_INVALID");
  const atomic = readJson(ATOMIC_INVENTORY_PATH, "Atomic specialist inventory").value;
  const atomicEntry = atomic.atomic_specialists?.find((entry) => entry.generic_id === "DOMAIN.FIELD_JOB_WORKFLOW");
  assert(atomicEntry && atomicEntry.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && atomicEntry.router === "specialist.domain.workflow-router", "Atomic specialist inventory binding is missing", "FIELD_JOB_WORKFLOW_REGISTRY_BINDING_INVALID");
  return {agentRoster, agentEntry, packageRegistry, shared_registry_integration: sharedRegistryIntegration, specialistRoster, routing, atomic};
}

function packageFiles() {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => compareUtf8(a.name, b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else {
        assert(entry.isFile() && !entry.isSymbolicLink(), `Field Job Workflow package contains a non-regular file: ${target}`, "FIELD_JOB_WORKFLOW_ARTIFACT_INVALID");
        files.push({relative_path: path.relative(ROOT, target).split(path.sep).join("/"), file_sha256: fileSha(target)});
      }
    }
  };
  visit(PACKAGE);
  return files;
}

export function computeFieldJobWorkflowInvalidationClosure(changedKeys, graph) {
  assert(Array.isArray(changedKeys) && changedKeys.length > 0, "Field Job Workflow invalidation requires changed keys", "FIELD_JOB_WORKFLOW_INVALIDATION_INPUT_INVALID");
  const edges = graph?.edges;
  assert(Array.isArray(edges), "Field Job Workflow invalidation graph is missing", "FIELD_JOB_WORKFLOW_INVALIDATION_INPUT_INVALID");
  const invalidated = new Set(changedKeys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (invalidated.has(edge.changed)) for (const target of edge.invalidates) if (!invalidated.has(target)) { invalidated.add(target); changed = true; }
    }
  }
  return [...invalidated].sort(compareUtf8);
}

export function resolveFieldJobWorkflowCanonicalAuthority({nowUtc = new Date().toISOString()} = {}) {
  const nowMs = Date.parse(nowUtc);
  assert(Number.isFinite(nowMs), "Field Job Workflow authority time is invalid", "FIELD_JOB_WORKFLOW_TIME_INVALID");
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Field Job Workflow block");
  const block = checkBlock(blockArtifact);
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Field Job Workflow source lock");
  const source = checkSources(sourceArtifact, nowMs);
  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  const modelRouteArtifact = readJson(path.join(PACKAGE, "model-route.json"), "Field Job Workflow model route");
  const model = checkModel(modelArtifact, modelRouteArtifact, nowUtc);
  const contextArtifact = readJson(path.join(PACKAGE, "context.json"), "Field Job Workflow context");
  const invalidationArtifact = readJson(path.join(PACKAGE, "memory-invalidation.json"), "Field Job Workflow invalidation graph");
  const context = checkContext(contextArtifact, invalidationArtifact, source, model, nowMs);
  const upstreamResult = canonicalUpstreamResult(block.block_sha256);
  const registry = checkRegistry(block, source, model, context, context.graph);
  const evidence = {
    authority_status: "CURRENT_CANDIDATE",
    custody_status: "ISOLATED_BUILDER",
    custody_ref: FIELD_JOB_WORKFLOW_CUSTODY_REF,
    workflow_domain: "FIELD_WORKFLOW",
    workflow_phase: "PLANNING",
    workflow_task: "TYPED_CLASSIFICATION",
    workflow_ref: "ref:WORKFLOW/EXTERNAL/1",
    workflow_dependencies: ["TASK_DEPENDENCY_EVIDENCE"],
    source_status: "CURRENT_VERIFIED",
    source_identity: "SOURCE.OSHA_OIL_GAS_WELL_ETOOL",
    source_version: "current",
    source_effective_date: null,
    source_retrieved_date: source.well.retrieved_date,
    source_manifest_sha256: source.source.manifest_sha256,
    candidate_status: "CURRENT_CANDIDATE",
    candidate_digest: block.block_sha256,
    workflow_signal: "DOMAIN.FIELD_JOB_WORKFLOW",
    signal_status: "BOUND",
    task_status: "FIELD_WORKFLOW_CLASSIFICATION",
    context_status: "FIELD_JOB_WORKFLOW_CONTEXT",
    context_complete: true,
    context_receipt_sha256: context.context.context_sha256,
    requested_action: "ANALYZE",
    requested_tools: [...FIELD_JOB_WORKFLOW_TOOLS],
    required_block_identities: [...FIELD_JOB_WORKFLOW_REQUIRED_BLOCKS],
    model_policy_status: "PREPARED_INACTIVE",
    model_route_status: "BOUND",
    model_task_class: model.route.task_class,
    model_snapshot_sha256: model.snapshot.snapshot_sha256,
    model_route_sha256: model.route.route_sha256,
    model_capability_floor: model.route.capability_floor,
    model_required_capabilities: [...model.route.required_capabilities],
    authority_scope: "FIELD_JOB_WORKFLOW",
    memory_binding_sha256: context.graph.graph_sha256,
    upstream_router_file_sha256: fileSha(UPSTREAM_ROUTER_PATH),
    upstream_router_result_sha256: upstreamResult.result_sha256,
    project_data_present: false,
    secret_data_present: false,
    adversarial_flags: Object.fromEntries(FIELD_JOB_WORKFLOW_FLAG_NAMES.map((key) => [key, false])),
  };
  return Object.freeze({
    package_path: FIELD_JOB_WORKFLOW_PACKAGE_PATH,
    block,
    source,
    model,
    context,
    invalidation: context.graph,
    upstream_result: upstreamResult,
    registry,
    evidence,
    artifact_digests: packageFiles(),
    package_root_sha256: canonicalDigest(packageFiles()),
  });
}
