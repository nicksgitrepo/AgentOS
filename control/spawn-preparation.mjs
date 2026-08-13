#!/usr/bin/env node

/*
 * Fail-closed Agent Spawner transaction.  This controller prepares and
 * evaluates a role package; it does not create a session or a seed.  A caller
 * may create a seed/working clone only after the returned package is accepted
 * and its exact readback is verified.
 */

import crypto from "node:crypto";

export const SPAWN_PREPARATION_SCHEMA = "agentos.spawn_preparation.v1";
export const ROLE_CONTEXT_MANIFEST_SCHEMA = "agentos.role_context_manifest.v1";
export const SPAWN_STATUSES = Object.freeze([
  "SPAWN_PREPARATION_IN_PROGRESS",
  "BLOCK_BUILD_ACTIVE",
  "BLOCK_QA_FAILED_REPAIRING",
  "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP",
  "SPAWN_PACKAGE_ACCEPTED",
  "SEED_CREATED_IDLE",
  "WORKING_AGENT_CREATED_READY",
  "SPAWN_READBACK_FAILED",
  "BLOCKED_EXACT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const PRIVATE_PATH = /(?:^|[\\/])(?:Users|home|private|tmp|var)[\\/]/u;
const SECRET = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key)\s*[:=]/iu;
const BLOCK_STATUSES = new Set(["CANDIDATE", "ACCEPTED", "SUPERSEDED"]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`); }
function requireId(value, label) { requireString(value, label); assert(SAFE_ID.test(value), `${label} has an unsafe identity`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function sorted(values, label, {minItems = 0} = {}) {
  assert(Array.isArray(values) && values.length >= minItems, `${label} must contain at least ${minItems} item(s)`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const copy = [...new Set(values)].sort();
  assert(JSON.stringify(values) === JSON.stringify(copy), `${label} must be sorted and unique`);
  return values;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!PRIVATE_PATH.test(text), `${label} contains a private filesystem path`);
  assert(!SECRET.test(text), `${label} contains raw secret-like material`);
}
function digestBody(value) { const body = structuredClone(value); delete body.digest; return canonicalDigest(body); }
function digestWithout(value, field) { const body = structuredClone(value); delete body[field]; return canonicalDigest(body); }

function validateRequest(request) {
  requireRecord(request, "spawn request");
  for (const field of ["role_id", "task_id", "project_context_digest", "task_scope", "completion_definition"]) requireString(request[field], `spawn request.${field}`);
  requireSha(request.project_context_digest, "spawn request.project_context_digest");
  requireRecord(request.authority, "spawn request.authority");
  sorted(request.authority.allowed, "spawn request.authority.allowed", {minItems: 1});
  sorted(request.authority.prohibited, "spawn request.authority.prohibited", {minItems: 1});
  requireRecord(request.evidence_contract, "spawn request.evidence_contract");
  sorted(request.evidence_contract.required, "spawn request.evidence_contract.required", {minItems: 1});
  requireString(request.evidence_contract.claim_boundary, "spawn request.evidence_contract.claim_boundary");
  sorted(request.non_goals, "spawn request.non_goals", {minItems: 1});
  requireRecord(request.model_duty, "spawn request.model_duty");
  requireString(request.model_duty.model, "spawn request.model_duty.model");
  requireString(request.model_duty.reasoning_effort, "spawn request.model_duty.reasoning_effort");
  requireString(request.model_duty.duty, "spawn request.model_duty.duty");
  assert(request.no_subagents === true, "spawn request must prohibit subagents");
  const luna = request.model_duty.model === "gpt-5.6-luna" && request.model_duty.reasoning_effort === "max";
  const ownerSpawnerException = request.role_id === "AGENT_SPAWNER_COMPILER"
    && request.model_duty.model === "gpt-5.6-sol"
    && request.model_duty.reasoning_effort === "medium"
    && request.model_duty.duty === "CONTEXT_EXTRACTION_AND_GOVERNANCE_BLOCK_COMPILATION"
    && request.model_duty.owner_exception === true;
  assert(luna || ownerSpawnerException, "spawn request model/duty is not permitted by the model law");
  secretFree(request, "spawn request");
  return request;
}

function validateBlock(block, label) {
  requireRecord(block, label);
  for (const field of ["block_id", "version", "digest", "source_digest", "authority", "privacy_classification"]) requireString(block[field], `${label}.${field}`);
  requireId(block.block_id, `${label}.block_id`);
  requireSha(block.digest, `${label}.digest`);
  requireSha(block.source_digest, `${label}.source_digest`);
  assert(BLOCK_STATUSES.has(block.status), `${label}.status is invalid`);
  requireRecord(block.freshness, `${label}.freshness`);
  assert(["FRESH", "STALE", "UNKNOWN"].includes(block.freshness.status), `${label}.freshness.status is invalid`);
  requireRecord(block.applicability, `${label}.applicability`);
  assert(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"].includes(block.applicability.outcome), `${label}.applicability.outcome is invalid`);
  if (block.applicability.outcome === "NOT_APPLICABLE") assert(block.applicability.evidence_status === "PROVEN", `${label} applicability is unproven`);
  sorted(block.dependencies ?? [], `${label}.dependencies`);
  sorted(block.conflicts ?? [], `${label}.conflicts`);
  sorted(block.aliases ?? [], `${label}.aliases`);
  requireRecord(block.authority_contract, `${label}.authority_contract`);
  sorted(block.authority_contract.allowed, `${label}.authority_contract.allowed`, {minItems: 1});
  sorted(block.authority_contract.prohibited, `${label}.authority_contract.prohibited`, {minItems: 1});
  requireRecord(block.quality, `${label}.quality`);
  assert(block.quality.hostile_fixtures_passed === true, `${label} hostile fixtures are not passed`);
  requireRecord(block.evaluation, `${label}.evaluation`);
  assert(block.evaluation.independent === true && block.evaluation.status === "ACCEPTED", `${label} lacks independent acceptance`);
  requireSha(block.evaluation.receipt_sha256, `${label}.evaluation.receipt_sha256`);
  assert(block.privacy_classification !== "RESTRICTED" || block.privacy_redaction_proof === true, `${label} restricted context lacks redaction proof`);
  assert(block.raw_secret_detected !== true, `${label} contains a privacy leak`);
  assert(block.digest === digestBody(block), `${label} digest is not content-addressed`);
  secretFree(block, label);
  return block;
}

function dependencyClosure(requiredIds, catalog) {
  const byId = new Map();
  for (const block of catalog) {
    if (byId.has(block.block_id)) throw new Error(`DUPLICATE_BLOCK_ID: ${block.block_id}`);
    byId.set(block.block_id, block);
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`DEPENDENCY_CYCLE: ${id}`);
    const block = byId.get(id);
    if (!block) throw new Error(`MISSING_REQUIRED_BLOCK: ${id}`);
    visiting.add(id);
    for (const dep of block.dependencies ?? []) walk(dep);
    visiting.delete(id); visited.add(id); ordered.push(block);
  };
  for (const id of requiredIds) walk(id);
  return ordered;
}

function compositionFailures(request, blocks) {
  const failures = [];
  const selected = new Set(blocks.map((block) => block.block_id));
  for (const block of blocks) {
    for (const conflict of block.conflicts ?? []) if (selected.has(conflict)) failures.push({code: "COMPOSITION_CONFLICT", block_id: block.block_id, related_block_id: conflict});
    if (block.authority_contract.overlap_with?.some((value) => selected.has(value))) failures.push({code: "AUTHORITY_OVERLAP", block_id: block.block_id});
    if (block.composition_status && block.composition_status !== "PASS") failures.push({code: "COMPOSITION_QA_FAILED", block_id: block.block_id, reason: block.composition_status});
  }
  const aliases = new Map();
  for (const block of blocks) for (const alias of block.aliases ?? []) {
    const prior = aliases.get(alias);
    if (prior && prior !== block.block_id) failures.push({code: "ALIAS_DUPLICATE", alias, block_id: block.block_id, related_block_id: prior});
    aliases.set(alias, block.block_id);
  }
  if (request.composition_qa?.status !== "PASS") failures.push({code: "COMPOSITION_QA_REQUIRED", reason: "composition-level QA must explicitly pass"});
  if (request.composition_qa) {
    for (const field of ["contradictions", "missing_seams", "context_leaks", "impossible_completion", "unsafe_fallback", "non_deterministic_handoff"]) {
      if ((request.composition_qa[field] ?? []).length > 0) failures.push({code: `COMPOSITION_${field.toUpperCase()}`, details: request.composition_qa[field]});
    }
  }
  return failures;
}

function manifestFor({request, blocks}) {
  const body = {
    schema: ROLE_CONTEXT_MANIFEST_SCHEMA,
    version: 1,
    status: "ACCEPTED",
    role_id: request.role_id,
    task_id: request.task_id,
    project_context_digest: request.project_context_digest,
    model_duty: request.model_duty,
    task_scope: request.task_scope,
    non_goals: request.non_goals,
    authority: request.authority,
    block_refs: blocks.map((block) => ({block_id: block.block_id, version: block.version, digest: block.digest})),
    inputs_outputs: request.inputs_outputs ?? {inputs: [], outputs: []},
    evidence_contract: request.evidence_contract,
    handoff: request.handoff ?? {schema: "TYPED_HANDOFF_REQUIRED", statuses: ["WAITING_WITH_RECEIPT", "ACCEPTED", "BLOCKED_EXACT"]},
    escalation: request.escalation ?? "Escalate protected authority, contradictions, and exhausted bounded repair paths.",
    invalidation_triggers: request.invalidation_triggers ?? ["block_digest_changed", "source_stale", "project_context_changed", "authority_changed"],
    completion_definition: request.completion_definition,
    independent_acceptance: request.independent_acceptance,
    no_subagents: true,
    manifest_sha256: null,
  };
  body.manifest_sha256 = digestWithout(body, "manifest_sha256");
  return body;
}

export function compileSpawnPreparation({request, catalog = [], nowUtc = "1970-01-01T00:00:00.000Z", repairInProgress = false, exhaustedBlocker = false} = {}) {
  validateRequest(request);
  assert(Array.isArray(catalog) && catalog.length > 0, "spawn block catalog must be nonempty");
  const requiredIds = request.required_block_ids;
  sorted(requiredIds, "spawn request.required_block_ids", {minItems: 1});
  const failures = [];
  let closure = [];
  try {
    closure = dependencyClosure(requiredIds, catalog);
  } catch (error) {
    failures.push({code: error.message.split(":", 1)[0], reason: error.message});
  }
  for (const [index, block] of catalog.entries()) {
    try { validateBlock(block, `catalog[${index}]`); } catch (error) { failures.push({code: "BLOCK_INVALID", block_id: block?.block_id ?? null, reason: error.message}); }
  }
  for (const block of closure) {
    if (block.status !== "ACCEPTED") failures.push({code: "BLOCK_NOT_ACCEPTED", block_id: block.block_id});
    if (block.freshness.status !== "FRESH") failures.push({code: "STALE_OR_UNKNOWN_SOURCE", block_id: block.block_id});
    if (block.applicability.outcome === "NO") failures.push({code: "BLOCK_NOT_APPLICABLE", block_id: block.block_id});
    if (block.applicability.outcome === "UNKNOWN") failures.push({code: "UNPROVEN_APPLICABILITY", block_id: block.block_id});
    if (block.required_model && (block.required_model.model !== request.model_duty.model || block.required_model.reasoning_effort !== request.model_duty.reasoning_effort)) failures.push({code: "MODEL_DUTY_MISMATCH", block_id: block.block_id});
  }
  failures.push(...compositionFailures(request, closure));
  const contradiction = failures.some((failure) => ["COMPOSITION_CONFLICT", "COMPOSITION_CONTRADICTIONS", "AUTHORITY_OVERLAP", "ALIAS_DUPLICATE"].includes(failure.code));
  const status = failures.length === 0
    ? "SPAWN_PACKAGE_ACCEPTED"
    : exhaustedBlocker ? "BLOCKED_EXACT"
      : contradiction ? "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP"
        : repairInProgress ? "BLOCK_BUILD_ACTIVE" : "BLOCK_QA_FAILED_REPAIRING";
  const manifest = failures.length === 0 ? manifestFor({request, blocks: closure}) : null;
  const body = {
    schema: SPAWN_PREPARATION_SCHEMA,
    version: 1,
    status,
    request: structuredClone(request),
    required_block_ids: [...requiredIds],
    resolved_block_refs: closure.map((block) => ({block_id: block.block_id, version: block.version, digest: block.digest})),
    failures,
    work_plan: failures.length === 0 ? [] : ["Repair or replace each failed block in isolated governance custody.", "Re-run block-local hostile QA and independent evaluation.", "Re-run dependency closure and composition QA before considering spawn."],
    role_context_manifest: manifest,
    spawn_allowed: failures.length === 0,
    mutation: "NONE",
    activation: "OFF",
    created_at_utc: nowUtc,
    checkpoint_sha256: null,
  };
  body.checkpoint_sha256 = digestWithout(body, "checkpoint_sha256");
  return body;
}

export function validateSpawnPreparation(receipt) {
  requireRecord(receipt, "spawn preparation receipt");
  assert(receipt.schema === SPAWN_PREPARATION_SCHEMA && receipt.version === 1, "spawn preparation schema is invalid");
  assert(SPAWN_STATUSES.includes(receipt.status), "spawn preparation status is invalid");
  assert(receipt.mutation === "NONE" && receipt.activation === "OFF", "spawn preparation performed a side effect");
  assert(receipt.spawn_allowed === (receipt.status === "SPAWN_PACKAGE_ACCEPTED"), "spawn preparation permission is inconsistent");
  requireSha(receipt.checkpoint_sha256, "spawn preparation checkpoint");
  assert(receipt.checkpoint_sha256 === digestWithout(receipt, "checkpoint_sha256"), "spawn preparation receipt is not content-addressed");
  if (receipt.status === "SPAWN_PACKAGE_ACCEPTED") {
    requireRecord(receipt.role_context_manifest, "accepted role context manifest");
    assert(receipt.role_context_manifest.status === "ACCEPTED", "accepted spawn package has no accepted manifest");
    requireSha(receipt.role_context_manifest.manifest_sha256, "role context manifest");
  } else assert(receipt.role_context_manifest === null, "incomplete spawn package carries a manifest");
  secretFree(receipt, "spawn preparation receipt");
  return receipt;
}

export function verifySpawnReadback({acceptedPackage, readback, kind = "WORKING_AGENT"} = {}) {
  validateSpawnPreparation(acceptedPackage);
  assert(acceptedPackage.status === "SPAWN_PACKAGE_ACCEPTED", "spawn readback requires an accepted package");
  requireRecord(readback, "spawn readback");
  const failures = [];
  for (const field of ["role_id", "task_id", "model", "reasoning_effort", "manifest_sha256", "project_control_plane_ref", "first_handoff_sha256"]) {
    if (typeof readback[field] !== "string" || readback[field].length === 0) failures.push(`MISSING_${field.toUpperCase()}`);
  }
  if (readback.role_id !== acceptedPackage.role_context_manifest.role_id) failures.push("ROLE_ID_MISMATCH");
  if (readback.task_id !== acceptedPackage.role_context_manifest.task_id) failures.push("TASK_ID_MISMATCH");
  if (readback.model !== acceptedPackage.role_context_manifest.model_duty.model || readback.reasoning_effort !== acceptedPackage.role_context_manifest.model_duty.reasoning_effort) failures.push("MODEL_MISMATCH");
  if (readback.manifest_sha256 !== acceptedPackage.role_context_manifest.manifest_sha256) failures.push("MANIFEST_DIGEST_MISMATCH");
  if (readback.no_subagents !== true) failures.push("SUBAGENT_RULE_MISMATCH");
  const status = failures.length === 0 ? (kind === "SEED" ? "SEED_CREATED_IDLE" : "WORKING_AGENT_CREATED_READY") : "SPAWN_READBACK_FAILED";
  return {schema: "agentos.spawn_readback_receipt.v1", version: 1, status, role_id: readback.role_id ?? null, task_id: readback.task_id ?? null, manifest_sha256: readback.manifest_sha256 ?? null, failures, mutation: "NONE", activation: status === "WORKING_AGENT_CREATED_READY" ? "READY_ONLY" : "OFF", receipt_sha256: canonicalDigest({status, role_id: readback.role_id ?? null, task_id: readback.task_id ?? null, manifest_sha256: readback.manifest_sha256 ?? null, failures, mutation: "NONE", activation: status === "WORKING_AGENT_CREATED_READY" ? "READY_ONLY" : "OFF"})};
}
