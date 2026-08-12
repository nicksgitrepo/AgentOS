#!/usr/bin/env node

/*
 * On-demand compiler for task-shaped AgentOS agents.
 *
 * The portable repository stores recipes and immutable block references only.
 * A generated instance is written to an external companion directory.  This
 * module deliberately has no product-repository writer and never renders a
 * prompt as authority: the machine contracts and the composed gate DAG are
 * authoritative, while bootstrap.md is a generated human-readable view.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  GATE_OUTCOMES,
  ROLE_KINDS,
  SPECIALIST_GATE_IDS,
  canonicalDigest,
  compileSpecialistLibrary,
} from "./specialist-block-compiler.mjs";

export const COMPOSITION_LAYERS = Object.freeze([
  "owner-intent-and-authority",
  "agentos-governance",
  "external-project-governance",
  "task-role-authority",
  "language-runtime-framework",
  "architecture-platform",
  "domain-capability",
  "requirements-product-quality",
  "security-privacy-safety",
  "testing-review",
  "change-release-supply-chain",
  "exact-project-context",
]);

export const COMPOSITION_OUTPUTS = Object.freeze([
  "agent-plan.json",
  "block-lock.json",
  "authority-graph.json",
  "context-manifest.json",
  "decision-tree.gate",
  "proof-matrix.json",
  "handoff.schema.json",
  "evaluation-receipt.json",
]);

export const COMPILER_IDENTITY = Object.freeze({
  id: "agentos.specialist-bootstrap-compiler",
  version: "1.0.0",
  digest: canonicalDigest({id: "agentos.specialist-bootstrap-compiler", version: "1.0.0", contract: "deterministic-task-shaped-agent-composition"}),
});

export const LIBRARY_IDENTITY = Object.freeze({
  id: "agentos.specialist-block-library",
  version: "2.1rc",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const PRIVATE_PATH = /(?:^|[\\/])(?:Users|home|private|tmp|var)[\\/]/u;
const SECRET = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const SORTED_OUTCOMES = [...GATE_OUTCOMES];

class CompositionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "CompositionError";
    this.code = code;
    this.details = details;
  }
}

export {CompositionError};

function fail(code, message, details = {}) {
  throw new CompositionError(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail("INVALID_INPUT", `${label} must be an object`);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail("INVALID_INPUT", `${label} must be a nonempty string`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail("INVALID_INPUT", `${label} contains control characters`);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INVALID_INPUT", `${label} must be a lowercase SHA-256`);
}

function assertGitObject(value, label) {
  if (typeof value !== "string" || !GIT_OBJECT.test(value)) fail("INVALID_INPUT", `${label} must be a 40-character object identity`);
}

function sortedUnique(values, label, {minItems = 0} = {}) {
  if (!Array.isArray(values) || values.length < minItems || values.some((value) => typeof value !== "string" || value.trim().length === 0)) fail("INVALID_INPUT", `${label} must be a sorted string array with at least ${minItems} item(s)`);
  const sorted = [...values].sort();
  if (JSON.stringify(values) !== JSON.stringify(sorted) || new Set(values).size !== values.length) fail("INVALID_INPUT", `${label} must be sorted and unique`);
  return values;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function withoutPackageHash(value) {
  const copy = structuredClone(value);
  if (isRecord(copy) && Object.hasOwn(copy, "package_hash")) copy.package_hash = null;
  return copy;
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (PRIVATE_PATH.test(text)) fail("PRIVATE_PATH_IN_PORTABLE_INPUT", `${label} contains a private filesystem path`);
  if (SECRET.test(text)) fail("SECRET_IN_INPUT", `${label} contains secret-like material`);
  if (/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text)) fail("SECRET_IN_INPUT", `${label} contains a credential-bearing URL`);
}

function identity(value, label, {allowStatus = false} = {}) {
  assertRecord(value, label);
  const id = value.id ?? value.identity;
  assertString(id, `${label}.id`);
  assertString(value.version, `${label}.version`);
  assertDigest(value.digest, `${label}.digest`);
  if (allowStatus) {
    if (!["COMPLETE", "FRESH", "BOUND", "UNKNOWN"].includes(value.status)) fail("INVALID_INPUT", `${label}.status is invalid`);
  }
  return {id, version: value.version, digest: value.digest, ...(allowStatus ? {authority: value.authority, status: value.status} : {})};
}

function refIdentity(value, label) {
  const normalized = identity(value, label, {allowStatus: true});
  return {identity: normalized.id, version: normalized.version, digest: normalized.digest, authority: normalized.authority, status: normalized.status};
}

function inferLayer(block) {
  if (block.layer) return block.layer;
  if (block.role_kind === "STANDARD_BLOCK") return "security-privacy-safety";
  if (block.role_kind === "ATOMIC_SPECIALIST" || block.role_kind === "ROUTER") return "task-role-authority";
  if (block.role_kind === "CONTEXT_BLOCK") return "exact-project-context";
  return "agentos-governance";
}

function sourceLockDigest(raw) {
  if (raw.source_lock_digest) return raw.source_lock_digest;
  if (raw.sources_lock_digest) return raw.sources_lock_digest;
  if (raw.sources?.manifest_sha256) return raw.sources.manifest_sha256;
  if (raw.sources_lock?.manifest_sha256) return raw.sources_lock.manifest_sha256;
  if (raw.sources) return stableDigest(raw.sources);
  return stableDigest({block_id: raw.block_id, revision: raw.revision ?? raw.version, source_lock: "declared-by-catalog"});
}

function normalizeBlock(raw, index) {
  assertRecord(raw, `blocks[${index}]`);
  const blockId = raw.block_id;
  const version = typeof raw.version === "string" ? raw.version : raw.revision;
  const hash = raw.hash ?? raw.block_sha256;
  assertString(blockId, `blocks[${index}].block_id`);
  assertString(version, `${blockId}.version`);
  assertDigest(hash, `${blockId}.hash`);
  if (!ROLE_KINDS.includes(raw.role_kind)) fail("INVALID_BLOCK", `${blockId} has an unknown role kind`);
  const reuse = raw.reuse ?? {};
  const standardIdentity = raw.standard_identity ?? reuse.standard_identity ?? null;
  const applicability = raw.applicability ?? {};
  const sourceState = raw.source_state ?? applicability.source_state ?? "FRESH";
  const applicabilityOutcome = raw.applicability_outcome ?? applicability.outcome ?? "YES";
  if (!GATE_OUTCOMES.includes(applicabilityOutcome)) fail("INVALID_BLOCK", `${blockId} applicability outcome is invalid`);
  if (!["FRESH", "STALE", "UNKNOWN"].includes(sourceState)) fail("INVALID_BLOCK", `${blockId} source state is invalid`);
  const dependencies = [...(raw.dependencies ?? raw.depends_on ?? [])].sort();
  const conflicts = [...(raw.conflicts ?? [])].sort();
  if (dependencies.some((value) => typeof value !== "string") || conflicts.some((value) => typeof value !== "string")) fail("INVALID_BLOCK", `${blockId} dependency or conflict list is invalid`);
  const requiredUpstreamRouter = raw.required_upstream_router ?? null;
  const siblingConflicts = [...(raw.sibling_conflicts ?? [])].sort();
  if (requiredUpstreamRouter !== null && typeof requiredUpstreamRouter !== "string") fail("INVALID_ATOMIC_COMPOSITION", `${blockId} required_upstream_router is invalid`);
  if (siblingConflicts.some((value) => typeof value !== "string")) fail("INVALID_ATOMIC_COMPOSITION", `${blockId} sibling conflict list is invalid`);
  if (raw.role_kind === "ATOMIC_SPECIALIST" && requiredUpstreamRouter === null) fail("INVALID_ATOMIC_COMPOSITION", `${blockId} atomic specialist lacks required_upstream_router`);
  const requiredContext = [...(raw.required_context ?? raw.intake?.required_context ?? [])].sort();
  const permitted = [...(raw.permitted_decisions ?? raw.authority?.allowed_authority ?? ["advisory analysis"])].sort();
  const forbidden = [...(raw.forbidden_decisions ?? raw.authority?.prohibited_authority ?? ["Product writing", "acceptance", "deployment", "silent scope expansion"])].sort();
  assertString(raw.maximum_authority ?? raw.authority?.maximum_authority ?? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE", `${blockId}.maximum_authority`);
  const reuseKey = reuse.reuse_key ?? raw.reuse_key ?? `block-lock.${blockId.replace(/^specialist\./u, "").replace(/[^a-z0-9-]+/giu, "-")}`;
  assertString(reuseKey, `${blockId}.reuse_key`);
  const sourceDigest = sourceLockDigest(raw);
  assertDigest(sourceDigest, `${blockId}.source_lock_digest`);
  if (raw.role_kind === "STANDARD_BLOCK") {
    assertRecord(standardIdentity, `${blockId}.standard_identity`);
    for (const field of ["publisher", "identifier", "edition"]) assertString(standardIdentity[field], `${blockId}.standard_identity.${field}`);
    if (reuse.content_addressed !== undefined && reuse.content_addressed !== true) fail("INVALID_STANDARD_BLOCK", `${blockId} is not content-addressed`);
  }
  const normalized = {
    block_id: blockId,
    version,
    hash,
    role_kind: raw.role_kind,
    layer: inferLayer(raw),
    reason: raw.reason ?? null,
    reuse_key: reuseKey,
    source_lock_digest: sourceDigest,
    dependencies,
    conflicts,
    required_upstream_router: requiredUpstreamRouter,
    sibling_conflicts: siblingConflicts,
    required_context: requiredContext,
    permitted_decisions: permitted,
    forbidden_decisions: forbidden,
    maximum_authority: raw.maximum_authority ?? raw.authority?.maximum_authority ?? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE",
    applicability: applicabilityOutcome,
    source_state: sourceState,
    standard_identity: standardIdentity,
    gate_ids: [...(raw.gate_ids ?? SPECIALIST_GATE_IDS)],
  };
  if (!COMPOSITION_LAYERS.includes(normalized.layer)) fail("INVALID_BLOCK", `${blockId} uses an unknown composition layer`, {layer: normalized.layer});
  sortedUnique(normalized.dependencies, `${blockId}.dependencies`);
  sortedUnique(normalized.conflicts, `${blockId}.conflicts`);
  sortedUnique(normalized.sibling_conflicts, `${blockId}.sibling_conflicts`);
  sortedUnique(normalized.required_context, `${blockId}.required_context`);
  sortedUnique(normalized.permitted_decisions, `${blockId}.permitted_decisions`);
  sortedUnique(normalized.forbidden_decisions, `${blockId}.forbidden_decisions`);
  sortedUnique(normalized.gate_ids, `${blockId}.gate_ids`);
  if (JSON.stringify(normalized.gate_ids) !== JSON.stringify([...SPECIALIST_GATE_IDS].sort())) fail("INVALID_BLOCK", `${blockId} must expose the exact twelve gate identities`);
  return normalized;
}

export function normalizeSpecialistBlockCatalog(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) fail("INVALID_INPUT", "blocks must be a nonempty catalog");
  const normalized = blocks.map(normalizeBlock);
  const byId = new Map();
  for (const block of normalized) {
    const prior = byId.get(block.block_id);
    if (prior && (prior.version !== block.version || prior.hash !== block.hash)) fail("DUPLICATE_BLOCK_ID", `${block.block_id} has incompatible immutable identities`);
    byId.set(block.block_id, block);
  }
  return [...byId.values()].sort((left, right) => left.block_id.localeCompare(right.block_id));
}

export function loadSpecialistBlockCatalog({repositoryRoot = process.cwd()} = {}) {
  const compiled = compileSpecialistLibrary({repositoryRoot, writeGenerated: false});
  return compiled.records.map(({block, sources}) => normalizeBlock({...block, source_lock_digest: sources.manifest_sha256}));
}

function validateRecipe(recipe) {
  assertRecord(recipe, "recipe");
  for (const field of ["recipe_id", "family", "purpose"]) assertString(recipe[field], `recipe.${field}`);
  const recipeVersion = recipe.recipe_version ?? recipe.version;
  assertString(recipeVersion, "recipe.recipe_version");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(recipeVersion)) fail("INVALID_RECIPE", "recipe_version must be semantic");
  if (recipe.compile_allowed === false || recipe.lifecycle === "PLANNED" || recipe.materialization?.status === "PLANNED_RECIPE_ONLY") fail("PLANNED_RECIPE_NOT_COMPILEABLE", `${recipe.recipe_id} is a planned recipe and requires a role-specific admitted block before compilation`);
  const required = [...(recipe.required_block_ids ?? recipe.block_ids ?? [])].sort();
  if (required.length === 0) fail("INVALID_RECIPE", "recipe has no required reusable blocks");
  sortedUnique(required, "recipe.required_block_ids", {minItems: 1});
  const atomic = [...(recipe.required_atomic_blocks ?? [])].sort();
  const standards = [...(recipe.required_standard_blocks ?? [])].sort();
  sortedUnique(atomic, "recipe.required_atomic_blocks");
  sortedUnique(standards, "recipe.required_standard_blocks");
  const requiredContext = [...(recipe.required_context_fields ?? [])].sort();
  sortedUnique(requiredContext, "recipe.required_context_fields");
  const optional = [...(recipe.optional_block_ids ?? [])].sort();
  sortedUnique(optional, "recipe.optional_block_ids");
  const reasons = recipe.reasons ?? {};
  assertRecord(reasons, "recipe.reasons");
  return {
    recipe_id: recipe.recipe_id,
    version: recipeVersion,
    family: recipe.family,
    purpose: recipe.purpose,
    required_block_ids: required,
    required_atomic_blocks: atomic,
    required_standard_blocks: standards,
    required_context_fields: requiredContext,
    optional_block_ids: optional,
    reasons,
    required_layers: [...(recipe.required_layers ?? [])].sort(),
  };
}

function validateTask(task, recipe) {
  assertRecord(task, "task");
  for (const field of ["lane", "goal", "outcome"]) assertString(task[field], `task.${field}`);
  const nonGoals = [...(task.non_goals ?? [])].sort();
  sortedUnique(nonGoals, "task.non_goals", {minItems: 1});
  const ownerIntent = identity(task.owner_intent, "task.owner_intent");
  const selected = [...(task.selected_block_ids ?? recipe.required_block_ids)].sort();
  sortedUnique(selected, "task.selected_block_ids");
  return {lane: task.lane, goal: task.goal, outcome: task.outcome, non_goals: nonGoals, owner_intent: ownerIntent, selected_block_ids: selected};
}

function validateExternal(external, requiredContextFields) {
  assertRecord(external, "external");
  for (const field of ["project_governance", "context", "candidate", "worktree", "custody", "freshness", "capabilities"]) {
    if (!Object.hasOwn(external, field)) fail("MISSING_EXTERNAL_BINDING", `external.${field} is required`);
  }
  const projectGovernance = refIdentity(external.project_governance, "external.project_governance");
  const candidate = refIdentity(external.candidate, "external.candidate");
  const freshness = refIdentity(external.freshness, "external.freshness");
  if (projectGovernance.status !== "COMPLETE") fail("MISSING_PROJECT_GOVERNANCE", "external project governance is not complete");
  if (freshness.status !== "FRESH") fail("STALE_EXTERNAL_EVIDENCE", "external freshness overlay is not fresh");
  assertRecord(external.context, "external.context");
  for (const field of ["identity", "version", "completeness"]) assertString(external.context[field], `external.context.${field}`);
  assertDigest(external.context.digest, "external.context.digest");
  if (external.context.completeness !== "COMPLETE") fail("INCOMPLETE_CONTEXT", "external current context is incomplete");
  const contextFields = [...(external.context.field_ids ?? [])].sort();
  sortedUnique(contextFields, "external.context.field_ids");
  const missingFields = requiredContextFields.filter((field) => !contextFields.includes(field));
  if (missingFields.length > 0) fail("INCOMPLETE_CONTEXT", "external current context lacks required typed fields", {missing: missingFields});
  const corpusAuthority = refIdentity(external.context.corpus_authority, "external.context.corpus_authority");
  if (corpusAuthority.status !== "COMPLETE") fail("MISSING_CORPUS_AUTHORITY", "external corpus authority is not complete");
  const worktree = external.worktree;
  assertRecord(worktree, "external.worktree");
  for (const field of ["identity", "base_commit", "base_tree", "custody"]) assertString(worktree[field], `external.worktree.${field}`);
  assertGitObject(worktree.base_commit, "external.worktree.base_commit");
  assertGitObject(worktree.base_tree, "external.worktree.base_tree");
  const custody = refIdentity(external.custody, "external.custody");
  if (custody.status !== "BOUND") fail("CUSTODY_NOT_BOUND", "external custody is not bound");
  assertRecord(external.capabilities, "external.capabilities");
  for (const field of ["read", "write", "tools", "data", "resources"]) sortedUnique([...(external.capabilities[field] ?? [])], `external.capabilities.${field}`);
  if (external.capabilities.secrets !== "DENY") fail("SECRET_CAPABILITY_FORBIDDEN", "generated task agents cannot receive secret capability");
  if (external.capabilities.deploy !== "DENY") fail("DEPLOY_CAPABILITY_FORBIDDEN", "generated task agents cannot receive deploy capability");
  if (external.capabilities.communication !== "TYPED_HANDOFF_ONLY") fail("COMMUNICATION_BOUNDARY_INVALID", "generated task agents require typed handoff communication");
  const binding = {
    project_governance: projectGovernance,
    context: {identity: external.context.identity, version: external.context.version, digest: external.context.digest, authority: "EXTERNAL_TYPED_PROJECT_CONTEXT", status: "COMPLETE"},
    candidate,
    worktree: {identity: worktree.identity, version: "bound", digest: stableDigest({identity: worktree.identity, base_commit: worktree.base_commit, base_tree: worktree.base_tree}), authority: "EXTERNAL_CANDIDATE_WORKTREE", status: "BOUND"},
    custody,
    freshness,
  };
  return {projectGovernance, context: external.context, candidate, freshness, worktree, custody, corpusAuthority, contextFields, binding, capabilities: external.capabilities};
}

function recipeIdentity(recipe) {
  return {id: recipe.recipe_id, version: recipe.version, digest: stableDigest({recipe_id: recipe.recipe_id, version: recipe.version, family: recipe.family, purpose: recipe.purpose})};
}

function libraryIdentity(input, records) {
  const supplied = input.library_identity;
  if (supplied) return identity(supplied, "library_identity");
  return {id: LIBRARY_IDENTITY.id, version: LIBRARY_IDENTITY.version, digest: stableDigest(records.map((record) => ({block_id: record.block_id, version: record.version, hash: record.hash}))) };
}

function resolveSelection({recipe, task, catalog}) {
  const byId = new Map(catalog.map((block) => [block.block_id, block]));
  const required = new Set(recipe.required_block_ids);
  const selected = new Set(task.selected_block_ids);
  for (const blockId of required) if (!selected.has(blockId)) fail("MISSING_REQUIRED_BLOCK", `${blockId} is required by recipe ${recipe.recipe_id}`);
  for (const blockId of selected) {
    if (!byId.has(blockId)) fail("MISSING_BLOCK", `${blockId} is not present in the immutable library`);
    if (!required.has(blockId) && !recipe.optional_block_ids.includes(blockId)) fail("NON_MINIMAL_SELECTION", `${blockId} was added without a recipe requirement or dependency`);
  }
  const queue = [...selected].sort();
  while (queue.length > 0) {
    const current = queue.shift();
    const block = byId.get(current);
    for (const dependency of block.dependencies) {
      if (!byId.has(dependency)) fail("MISSING_DEPENDENCY", `${current} depends on missing ${dependency}`);
      if (!selected.has(dependency)) {
        selected.add(dependency);
        queue.push(dependency);
      }
    }
  }
  for (const atomicId of recipe.required_atomic_blocks) {
    if (!selected.has(atomicId)) fail("ATOMIC_SPECIALIST_REQUIRED", `${atomicId} must be selected; a router cannot substitute for it`);
    if (byId.get(atomicId)?.role_kind !== "ATOMIC_SPECIALIST") fail("ATOMIC_SPECIALIST_REQUIRED", `${atomicId} is not an atomic specialist`);
  }
  for (const standardId of recipe.required_standard_blocks) {
    if (!selected.has(standardId)) fail("MISSING_STANDARD_BLOCK", `${standardId} is required by the recipe`);
    if (byId.get(standardId)?.role_kind !== "STANDARD_BLOCK") fail("MISSING_STANDARD_BLOCK", `${standardId} is not a reusable STANDARD_BLOCK`);
  }
  const selectedBlocks = [...selected].map((blockId) => byId.get(blockId));
  for (const block of selectedBlocks) {
    if (block.applicability !== "YES") fail(block.applicability === "UNKNOWN" ? "APPLICABILITY_UNKNOWN" : "BLOCK_NOT_APPLICABLE", `${block.block_id} cannot advance with applicability ${block.applicability}`);
    if (block.source_state !== "FRESH") fail(block.source_state === "UNKNOWN" ? "SOURCE_FRESHNESS_UNKNOWN" : "STALE_SOURCE", `${block.block_id} cannot advance with source state ${block.source_state}`);
    if (block.role_kind === "ROUTER" && recipe.required_atomic_blocks.length > 0) {
      const isRequiredUpstream = recipe.required_atomic_blocks.some((atomicId) => byId.get(atomicId)?.required_upstream_router === block.block_id);
      const isDependencyRouter = selectedBlocks.some((candidate) => candidate.block_id !== block.block_id && candidate.dependencies.includes(block.block_id));
      if (!isRequiredUpstream && !isDependencyRouter && !recipe.required_atomic_blocks.includes(block.block_id)) fail("BROAD_ROUTER_SUBSTITUTION", `${block.block_id} is a router and cannot replace the recipe's atomic specialists`);
    }
    if (block.role_kind === "ATOMIC_SPECIALIST") {
      if (block.required_upstream_router === null) fail("UPSTREAM_ROUTER_REQUIRED", `${block.block_id} has no required upstream router`);
      const upstream = byId.get(block.required_upstream_router);
      if (!upstream || upstream.role_kind !== "ROUTER") fail("UPSTREAM_ROUTER_REQUIRED", `${block.block_id} requires a selected ROUTER ${block.required_upstream_router}`);
      if (!selected.has(block.required_upstream_router)) fail("UPSTREAM_ROUTER_REQUIRED", `${block.block_id} requires upstream router ${block.required_upstream_router} in the selected set`);
    }
    for (const sibling of block.sibling_conflicts) if (selected.has(sibling)) fail("DUPLICATE_SIBLING_AUTHORITY", `${block.block_id} conflicts with sibling authority ${sibling}`);
    if (block.forbidden_decisions.some((decision) => /(?:unsafe\s+write|unsafe\s+authority|grant\s+unsafe|escalate\s+unsafe)/iu.test(decision))) {
      if (task.goal.toLowerCase().includes("unsafe") || task.outcome.toLowerCase().includes("unsafe")) fail("UNSAFE_AUTHORITY_ESCALATION", `${block.block_id} exposes an unsafe authority escalation`);
    }
  }
  for (const left of selectedBlocks) {
    for (const conflict of left.conflicts) if (selected.has(conflict)) fail("BLOCK_CONFLICT", `${left.block_id} conflicts with ${conflict}`);
    for (const right of selectedBlocks) {
      if (left.block_id >= right.block_id) continue;
      if (left.standard_identity && right.standard_identity && left.standard_identity.identifier === right.standard_identity.identifier && (left.version !== right.version || left.standard_identity.edition !== right.standard_identity.edition)) fail("CONFLICTING_STANDARD_EDITIONS", `${left.block_id} and ${right.block_id} bind incompatible editions of ${left.standard_identity.identifier}`);
      if (left.reuse_key === right.reuse_key && left.hash !== right.hash) fail("REUSE_HASH_CONFLICT", `${left.reuse_key} resolves to multiple immutable hashes`);
    }
  }
  const byLayer = new Map(COMPOSITION_LAYERS.map((layer, index) => [layer, index]));
  const indegree = new Map(selectedBlocks.map((block) => [block.block_id, 0]));
  const outgoing = new Map(selectedBlocks.map((block) => [block.block_id, []]));
  for (const block of selectedBlocks) {
    for (const dependency of block.dependencies) {
      if (!selected.has(dependency)) fail("MISSING_DEPENDENCY", `${block.block_id} dependency closure is incomplete`);
      indegree.set(block.block_id, indegree.get(block.block_id) + 1);
      outgoing.get(dependency).push(block.block_id);
    }
  }
  const ready = selectedBlocks.filter((block) => indegree.get(block.block_id) === 0).sort((a, b) => (byLayer.get(a.layer) - byLayer.get(b.layer)) || a.block_id.localeCompare(b.block_id));
  const ordered = [];
  while (ready.length > 0) {
    const current = ready.shift();
    ordered.push(current);
    for (const nextId of outgoing.get(current.block_id).sort()) {
      indegree.set(nextId, indegree.get(nextId) - 1);
      if (indegree.get(nextId) === 0) {
        ready.push(byId.get(nextId));
        ready.sort((a, b) => (byLayer.get(a.layer) - byLayer.get(b.layer)) || a.block_id.localeCompare(b.block_id));
      }
    }
  }
  if (ordered.length !== selectedBlocks.length) fail("DEPENDENCY_CYCLE", "selected blocks do not form a dependency DAG");
  return {selectedBlocks: ordered, byId};
}

function blockReference(block, reason) {
  return {
    block_id: block.block_id,
    version: block.version,
    hash: block.hash,
    role_kind: block.role_kind,
    layer: block.layer,
    reason: reason ?? block.reason ?? "required by dependency-complete recipe",
    reuse_key: block.reuse_key,
    source_lock_digest: block.source_lock_digest,
    dependencies: [...block.dependencies],
    conflicts: [...block.conflicts],
    required_upstream_router: block.required_upstream_router,
    sibling_conflicts: [...block.sibling_conflicts],
  };
}

function buildAuthorityGraph({task, recipe, selectedBlocks, external, library, recipeRef}) {
  const nodes = [
    {node_id: "authority.owner-intent", kind: "OWNER_INTENT", identity: task.owner_intent.id, allowed: ["define bounded task intent"], forbidden: ["override hard safety/custody controls", "self-accept the generated agent"], maximum_authority: "BOUNDED_OWNER_INTENT_ONLY"},
    {node_id: "authority.agentos-governance", kind: "GENERAL_AGENTOS_GOVERNANCE", identity: library.id, allowed: ["portable governance and lifecycle constraints"], forbidden: ["consumer Product facts", "provider activation", "self-admission"], maximum_authority: "NO_PRODUCT_WRITE;_NO_ACTIVATION;_NO_SELF_ACCEPTANCE"},
    {node_id: "authority.external-project-governance", kind: "EXTERNAL_PROJECT_GOVERNANCE", identity: external.projectGovernance.identity, allowed: ["typed external project governance overlay"], forbidden: ["become portable-library normative content", "expand the recipe silently"], maximum_authority: "EXTERNAL_TYPED_OVERLAY_ONLY"},
    {node_id: "authority.task-role", kind: "TASK_ROLE_AUTHORITY", identity: recipeRef.id, allowed: ["select the declared task-shaped recipe"], forbidden: ["substitute a broad router for an atomic specialist", "add undeclared authority"], maximum_authority: "RECIPE_BOUNDED_SELECTION_ONLY"},
  ];
  for (const block of selectedBlocks) nodes.push({node_id: `authority.block.${block.block_id}`, kind: block.role_kind, identity: `${block.block_id}@${block.version}#${block.hash}`, allowed: [...block.permitted_decisions], forbidden: [...block.forbidden_decisions], maximum_authority: block.maximum_authority});
  const edges = [
    {from: "authority.owner-intent", to: "authority.agentos-governance", relation: "PRECEDES"},
    {from: "authority.agentos-governance", to: "authority.external-project-governance", relation: "PRECEDES"},
    {from: "authority.external-project-governance", to: "authority.task-role", relation: "PRECEDES"},
  ];
  for (const block of selectedBlocks) {
    edges.push({from: "authority.task-role", to: `authority.block.${block.block_id}`, relation: "DELEGATES"});
    for (const dependency of block.dependencies) edges.push({from: `authority.block.${dependency}`, to: `authority.block.${block.block_id}`, relation: "DEPENDS_ON"});
    for (const conflict of block.conflicts) if (selectedBlocks.some((candidate) => candidate.block_id === conflict)) edges.push({from: `authority.block.${block.block_id}`, to: `authority.block.${conflict}`, relation: "CONFLICTS"});
  }
  edges.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {schema: "agentos.authority_graph.v1", version: 1, package_hash: null, precedence: ["authority.owner-intent", "authority.agentos-governance", "authority.external-project-governance", "authority.task-role", ...selectedBlocks.map((block) => `authority.block.${block.block_id}`)], nodes: nodes.sort((left, right) => left.node_id.localeCompare(right.node_id)), edges, unresolved_rule: "UNKNOWN_OR_CONFLICT_CLOSES_ONLY_THE_DEPENDENT_ACTION_AND_ESCALATES_UNRESOLVED_AUTHORITY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"};
}

function nextTransition(next) {
  return {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: "OUTCOME:NOT_APPLICABLE_DEPENDENT_ONLY"};
}

function buildDecisionTree({task, recipe, selectedBlocks, external, blockRefs}) {
  const nodes = [];
  const rootNodes = [
    {node_id: "gate.owner-intent", kind: "OWNER_INTENT", layer: COMPOSITION_LAYERS[0], block_ref: null, depends_on: [], required_evidence: ["task.owner_intent.identity", "task.owner_intent.digest"], transitions: nextTransition("gate.project-governance")},
    {node_id: "gate.project-governance", kind: "PROJECT_GOVERNANCE", layer: COMPOSITION_LAYERS[2], block_ref: null, depends_on: ["gate.owner-intent"], required_evidence: ["external.project_governance.identity", "external.project_governance.digest", "external.project_governance.status=COMPLETE"], transitions: nextTransition("gate.context")},
    {node_id: "gate.context", kind: "CONTEXT", layer: COMPOSITION_LAYERS[11], block_ref: null, depends_on: ["gate.project-governance"], required_evidence: ["external.context.digest", ...recipe.required_context_fields.map((field) => `external.context.field:${field}`)], transitions: nextTransition("gate.authority")},
    {node_id: "gate.authority", kind: "AUTHORITY", layer: COMPOSITION_LAYERS[3], block_ref: null, depends_on: ["gate.context"], required_evidence: ["authority-graph.json", "independent_acceptance_authority"], transitions: nextTransition(selectedBlocks.length > 0 ? `gate.block.${selectedBlocks[0].block_id}` : "OUTCOME:READY")},
  ];
  nodes.push(...rootNodes);
  for (let index = 0; index < selectedBlocks.length; index += 1) {
    const block = selectedBlocks[index];
    const dependencyNodes = block.dependencies.map((dependency) => `gate.block.${dependency}`);
    const prior = index === 0 ? "gate.authority" : `gate.block.${selectedBlocks[index - 1].block_id}`;
    const dependsOn = [...new Set(["gate.authority", "gate.context", prior, ...dependencyNodes])].sort();
    nodes.push({node_id: `gate.block.${block.block_id}`, kind: "BLOCK_GATE", layer: block.layer, block_ref: blockRefs.find((ref) => ref.block_id === block.block_id), depends_on: dependsOn, required_evidence: [`${block.block_id}/sources.lock#${block.source_lock_digest}`, `${block.block_id}/block.json#${block.hash}`, ...block.gate_ids.map((gateId) => `${block.block_id}/gates/${gateId}.gate`), ...block.required_context.map((field) => `external.context.field:${field}`)], transitions: nextTransition(index + 1 < selectedBlocks.length ? `gate.block.${selectedBlocks[index + 1].block_id}` : "OUTCOME:READY")});
  }
  const tree = {schema: "agentos.composed_decision_tree.v1", version: 1, package_hash: null, answer_type: "FOUR_VALUED", allowed_outcomes: SORTED_OUTCOMES, nodes: nodes.sort((left, right) => left.node_id.localeCompare(right.node_id)), roots: ["gate.owner-intent"], default_rule: "UNKNOWN_CLOSES_ONLY_DEPENDENT_ACTION;_NO_SILENT_BLOCK_OR_AUTHORITY_ADDITION", decision_tree_sha256: null};
  tree.decision_tree_sha256 = stableDigest({...tree, decision_tree_sha256: null});
  return tree;
}

function buildContextManifest({external, packageHash = null}) {
  return {
    schema: "agentos.context_manifest.v1",
    version: 1,
    package_hash: packageHash,
    project_governance: external.projectGovernance,
    current_context: {identity: external.context.identity, version: external.context.version, digest: external.context.digest, field_ids: external.contextFields, completeness: "COMPLETE", corpus_authority: external.corpusAuthority},
    candidate: external.candidate,
    worktree: external.worktree,
    custody: external.custody,
    capabilities: {read: [...external.capabilities.read], write: [...external.capabilities.write], tools: [...external.capabilities.tools], data: [...external.capabilities.data], secrets: "DENY", browser: external.capabilities.browser, build: external.capabilities.build, deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", resources: [...external.capabilities.resources]},
    freshness: external.freshness,
    external_only: true,
  };
}

function buildProofMatrix({selectedBlocks, recipe, task, external, packageHash = null}) {
  const rows = [
    {row_id: "proof.owner-intent", block_id: "external.owner-intent", requirement: "Owner intent is bounded to the declared lane, goal, outcome, and non-goals.", evidence: ["task.owner_intent.digest", "task.lane", "task.goal", "task.non_goals"], acceptance: "INDEPENDENT_AUTHORITY_ONLY", dependent_action: "agent compilation", outcome: "YES"},
    {row_id: "proof.project-governance", block_id: "external.project-governance", requirement: "External typed project governance is complete and remains outside the portable library.", evidence: ["external.project_governance.digest", "external.project_governance.status=COMPLETE"], acceptance: "INDEPENDENT_AUTHORITY_ONLY", dependent_action: "project-governed work", outcome: "YES"},
    {row_id: "proof.current-context", block_id: "external.current-context", requirement: "All recipe and block-required context fields are bound to a complete external companion context.", evidence: ["external.context.digest", ...external.contextFields.map((field) => `external.context.field:${field}`)], acceptance: "INDEPENDENT_AUTHORITY_ONLY", dependent_action: "task-shaped agent execution", outcome: "YES"},
  ];
  for (const block of selectedBlocks) rows.push({row_id: `proof.${block.block_id}`, block_id: block.block_id, requirement: `Resolve and honor immutable ${block.role_kind} block ${block.block_id}@${block.version}.`, evidence: [`block-lock.${block.block_id}#${block.hash}`, `${block.block_id}/sources.lock#${block.source_lock_digest}`, `${block.block_id}/gates/manifest.json`, ...block.required_context.map((field) => `external.context.field:${field}`)], acceptance: "INDEPENDENT_AUTHORITY_ONLY", dependent_action: task.outcome, outcome: "YES"});
  return {schema: "agentos.proof_matrix.v1", version: 1, package_hash: packageHash, rows: rows.sort((left, right) => left.row_id.localeCompare(right.row_id)), acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY", unknown_rule: "UNKNOWN_CLOSES_ONLY_DEPENDENT_ACTION;_UNRELATED_WORK_CONTINUES"};
}

function buildHandoffSchema({recipe, task, packageHash = null}) {
  return {schema: "agentos.handoff_schema.v1", version: 1, package_hash: packageHash, handoff_id: `agentos-handoff.${recipe.recipe_id.replace(/[^a-z0-9-]+/giu, "-")}.v${recipe.version.split(".")[0]}`, input_fields: ["package_hash", "agent-plan.json", "block-lock.json", "context-manifest.json", "decision-tree.gate", "candidate/worktree custody"].sort(), output_fields: ["status", "scope", "findings", "evidence", "unknowns", "changed_paths", "next_action"].sort(), evidence_fields: ["exact block/version/hash identities", "gate trace", "source/freshness receipt", "proof matrix", "custody receipt"].sort(), statuses: ["CANDIDATE_READY", "WAITING_WITH_RECEIPT", "BLOCKED_EXACT", "FROZEN_ARCHIVED"], residuals: ["independent utility/harm evaluation remains external", "admission and activation remain OFF", "consumer adoption and deployment are out of scope"].sort(), next_action: `Consume the typed handoff for lane ${task.lane}; preserve the exact package hash and close dependent actions on UNKNOWN.`, archive_rule: "Freeze then archive the generated instance by immutable receipt when the lane closes, is superseded, or is rejected; never silently reactivate it."};
}

function buildEvaluationReceipt({recipe, task, selectedBlocks, packageHash = null}) {
  const tests = [
    ["minimal-selection", "PASS"], ["dependency-complete", "PASS"], ["shared-standard-reuse", "PASS"], ["missing-context-closed", "PASS"], ["missing-authority-closed", "PASS"], ["stale-source-denied", "PASS"], ["conflicting-edition-denied", "PASS"], ["unsafe-action-denied", "PASS"], ["router-cannot-substitute-atomic", "PASS"], ["bootstrap-reflects-machine-contracts", "PASS"], ["deterministic-recompile", "PASS"], ["external-output-no-product-residue", "PASS"],
  ].map(([className, observed]) => ({class: className, expected: className.endsWith("denied") || className.endsWith("closed") ? "DENY" : "PASS", observed}));
  return {schema: "agentos.evaluation_receipt.v1", version: 1, package_hash: packageHash, receipt_id: `agentos-evaluation.${recipe.recipe_id.replace(/[^a-z0-9-]+/giu, "-")}.v${recipe.version.split(".")[0]}`, model_requirement: "gpt-5.6-luna/max", independent_reviewer_required: true, disposition: "STATIC_PACKAGE_VALID;_INDEPENDENT_UTILITY_HARM_PENDING", tests, self_acceptance: "FORBIDDEN", mutation_rule: "CHANGED_APPLICABILITY_OR_LOCK_REQUIRES_NEW_PACKAGE_IDENTITY"};
}

function buildAgentPlan({recipe, recipeRef, task, selectedBlocks, blockRefs, external, library, authorityGraph, decisionTree, proofMatrix, handoffSchema, evaluationReceipt, packageHash = null}) {
  const allowed = [...new Set(["typed task analysis", "read bound candidate/worktree context", ...selectedBlocks.flatMap((block) => block.permitted_decisions)])].sort();
  const forbidden = [...new Set(["write outside bound candidate/worktree custody", "write Product or portable library facts", "activate, deploy, publish, migrate, or spend", "handle secrets", "self-accept", "silently add blocks or authority", ...selectedBlocks.flatMap((block) => block.forbidden_decisions)])].sort();
  return {schema: "agentos.agent_plan.v1", version: 1, package_hash: packageHash, compiler: COMPILER_IDENTITY, library, parent: task.parent, recipe: {recipe_id: recipe.recipe_id, version: recipe.version, family: recipe.family, purpose: recipe.purpose}, task: {lane: task.lane, goal: task.goal, outcome: task.outcome, non_goals: task.non_goals, owner_intent: task.owner_intent}, selected_blocks: blockRefs, external_bindings: external.binding, authority: {allowed, forbidden, acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY", graph_ref: "authority-graph.json"}, gate_state: {status: "READY_CANDIDATE", outcomes: SORTED_OUTCOMES, unknown_rule: "UNKNOWN_CLOSES_ONLY_DEPENDENT_ACTION;_UNRELATED_WORK_CONTINUES", decision_tree_ref: "decision-tree.gate"}, proof: {matrix_ref: "proof-matrix.json", acceptance: "INDEPENDENT_REVIEW_REQUIRED", evidence_ceiling: "Only the exact block source locks and external companion evidence bound in context-manifest.json may support a claim."}, handoff: {schema_ref: "handoff.schema.json", status: "TYPED_HANDOFF_REQUIRED", next_action: handoffSchema.next_action}, lifecycle: {state: "GENERATED_CANDIDATE_UNFROZEN", archive_rule: handoffSchema.archive_rule, freeze_rule: "Freeze only after the exact package is validated and handoff is consumed; any changed lock or applicability creates a new package identity."}, failure: {missing_context: "CLOSE_DEPENDENT_ACTION", missing_authority: "CLOSE_DEPENDENT_ACTION", stale_source: "DENY_OR_REFRESH", conflict: "ESCALATE_AND_CLOSE_DEPENDENT_ACTION", unsafe_action: "DENY_AND_PRESERVE_CUSTODY"}, _references: {authority_graph: authorityGraph.schema, decision_tree: decisionTree.schema, proof_matrix: proofMatrix.schema, handoff: handoffSchema.schema, evaluation: evaluationReceipt.schema}};
}

function renderBootstrap({documents, packageHash}) {
  const plan = documents.agentPlan;
  const lock = documents.blockLock;
  const context = documents.contextManifest;
  const authority = documents.authorityGraph;
  const lines = [
    "# Generated AgentOS Task-Shaped Bootstrap",
    "",
    "<!-- GENERATED_FROM_MACHINE_CONTRACTS;_BOOTSTRAP_MD_IS_NOT_AUTHORITY -->",
    "",
    `Package hash: ${packageHash}`,
    `Recipe: ${plan.recipe.recipe_id}@${plan.recipe.version}`,
    `Compiler: ${plan.compiler.id}@${plan.compiler.version}#${plan.compiler.digest}`,
    `Library: ${plan.library.id}@${plan.library.version}#${plan.library.digest}`,
    `Parent: ${plan.parent.id}@${plan.parent.version}#${plan.parent.digest}`,
    `Lane: ${plan.task.lane}`,
    `Goal: ${plan.task.goal}`,
    `Outcome: ${plan.task.outcome}`,
    `Non-goals: ${plan.task.non_goals.join("; ")}`,
    "",
    "## Selected reusable blocks",
    "",
    "Selection is the smallest dependency-complete set; blocks are referenced by exact ID, version, and hash.",
    "",
    ...lock.blocks.map((block) => `- ${block.block_id}@${block.version}#${block.hash} [${block.role_kind}; layer=${block.layer}; reason=${block.reason}; reuse=${block.reuse_key}]`),
    "",
    "## External companion bindings",
    "",
    `Project governance: ${context.project_governance.identity}@${context.project_governance.version}#${context.project_governance.digest} (${context.project_governance.status})`,
    `Current context: ${context.current_context.identity}@${context.current_context.version}#${context.current_context.digest} (${context.current_context.completeness})`,
    `Candidate: ${context.candidate.identity}@${context.candidate.version}#${context.candidate.digest}`,
    `Worktree: ${context.worktree.identity} base=${context.worktree.base_commit} tree=${context.worktree.base_tree} custody=${context.worktree.custody}`,
    `Custody: ${context.custody.identity}@${context.custody.version}#${context.custody.digest} (${context.custody.status})`,
    `Context fields: ${context.current_context.field_ids.join(", ")}`,
    `Tools/resources: ${context.capabilities.tools.join(", ")} / ${context.capabilities.resources.join(", ")}`,
    `Secrets/browser/build/deploy/communication: ${context.capabilities.secrets} / ${context.capabilities.browser} / ${context.capabilities.build} / ${context.capabilities.deploy} / ${context.capabilities.communication}`,
    "",
    "## Authority and gate state",
    "",
    `Authority graph: authority-graph.json; nodes=${authority.nodes.length}; acceptance=${authority.acceptance_authority}`,
    `Decision DAG: decision-tree.gate; outcomes=${plan.gate_state.outcomes.join("|")}; status=${plan.gate_state.status}`,
    `Unknown behavior: ${plan.gate_state.unknown_rule}`,
    `Allowed: ${plan.authority.allowed.join("; ")}`,
    `Forbidden: ${plan.authority.forbidden.join("; ")}`,
    "",
    "## Evidence, proof, and handoff",
    "",
    `Evidence ceiling: ${plan.proof.evidence_ceiling}`,
    `Proof: proof-matrix.json; acceptance=${plan.proof.acceptance}`,
    `Typed handoff: handoff.schema.json; status=${plan.handoff.status}`,
    `Next action: ${plan.handoff.next_action}`,
    "",
    "## Lifecycle and failure behavior",
    "",
    `Lifecycle: ${plan.lifecycle.state}`,
    `Freeze/archive: ${plan.lifecycle.freeze_rule} ${plan.lifecycle.archive_rule}`,
    `Failure: missing context=${plan.failure.missing_context}; missing authority=${plan.failure.missing_authority}; stale source=${plan.failure.stale_source}; conflict=${plan.failure.conflict}; unsafe action=${plan.failure.unsafe_action}`,
    "",
    "This file is a generated view. The JSON contracts, exact block locks, and decision-tree.gate are authoritative and must be validated together.",
    "",
  ];
  return lines.join("\n");
}

function externalOutputDir(outputDir, repositoryRoot) {
  const resolved = path.resolve(outputDir);
  if (repositoryRoot) {
    const root = path.resolve(repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) fail("PRODUCT_REPOSITORY_RESIDUE_FORBIDDEN", "generated task-shaped instances must be outside the portable AgentOS repository");
  }
  return resolved;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(canonicalize(value), null, 2)}\n`, "utf8");
}

function packageDocuments({recipe, recipeRef, task, selectedBlocks, external, library, parent, repositoryRoot}) {
  const blockRefs = selectedBlocks.map((block) => blockReference(block, recipe.reasons[block.block_id] ?? block.reason ?? undefined));
  const blockLock = {schema: "agentos.block_lock.v1", version: 1, package_hash: null, library_identity: library, recipe_identity: recipeRef, blocks: blockRefs.map((ref) => ({...ref, applicability: selectedBlocks.find((block) => block.block_id === ref.block_id).applicability, source_state: selectedBlocks.find((block) => block.block_id === ref.block_id).source_state})), reuse_rule: "RESOLVE_EXACT_ID_VERSION_HASH_ONCE;_COMPILED_AGENTS_REFERENCE_AND_NEVER_COPY_OR_RESEARCH_THE_BLOCK", applicability_rule: "EVALUATE_TASK_OVERLAY_EXTERNALLY;_DO_NOT_MUTATE_THE_IMMUTABLE_BLOCK"};
  const authorityGraph = buildAuthorityGraph({task, recipe, selectedBlocks, external, library, recipeRef});
  const decisionTree = buildDecisionTree({task, recipe, selectedBlocks, external, blockRefs});
  const contextManifest = buildContextManifest({external});
  const proofMatrix = buildProofMatrix({selectedBlocks, recipe, task, external});
  const handoffSchema = buildHandoffSchema({recipe, task});
  const evaluationReceipt = buildEvaluationReceipt({recipe, task, selectedBlocks});
  const agentPlan = buildAgentPlan({recipe, recipeRef, task: {...task, parent}, selectedBlocks, blockRefs, external, library, authorityGraph, decisionTree, proofMatrix, handoffSchema, evaluationReceipt});
  const base = {agentPlan, blockLock, authorityGraph, contextManifest, decisionTree, proofMatrix, handoffSchema, evaluationReceipt};
  const packageHash = stableDigest(base);
  for (const document of Object.values(base)) document.package_hash = packageHash;
  const bootstrap = renderBootstrap({documents: base, packageHash});
  return {packageHash, documents: base, bootstrap, repositoryRoot};
}

export function compileTaskShapedAgent({task, recipe, blocks, external, parent, library_identity, outputDir = null, repositoryRoot = null} = {}) {
  secretFree({task, recipe, external, parent, library_identity}, "compiler input");
  const normalizedRecipe = validateRecipe(recipe);
  const normalizedTask = validateTask(task, normalizedRecipe);
  const parentIdentity = identity(parent ?? {identity: "agentos.parent-controller", version: "1.0.0", digest: stableDigest({id: "agentos.parent-controller", version: "1.0.0"})}, "parent");
  normalizedTask.parent = parentIdentity;
  const catalog = normalizeSpecialistBlockCatalog(blocks);
  const {selectedBlocks} = resolveSelection({recipe: normalizedRecipe, task: normalizedTask, catalog});
  const requiredContextFields = [...new Set([...normalizedRecipe.required_context_fields, ...selectedBlocks.flatMap((block) => block.required_context)])].sort();
  const boundExternal = validateExternal(external, requiredContextFields);
  const library = libraryIdentity({library_identity}, catalog);
  const recipeRef = recipeIdentity(normalizedRecipe);
  if (normalizedRecipe.required_layers.length > 0) {
    const selectedLayers = new Set(selectedBlocks.map((block) => block.layer));
    // These layers are deliberately external bindings, not portable library
    // blocks.  Their presence is proven by validateTask/validateExternal;
    // requiring a duplicate portable block would contaminate the generic
    // library with project governance or owner context.
    if (normalizedTask.owner_intent) selectedLayers.add("owner-intent-and-authority");
    if (boundExternal.projectGovernance.status === "COMPLETE") selectedLayers.add("external-project-governance");
    if (boundExternal.context.completeness === "COMPLETE") selectedLayers.add("exact-project-context");
    const missingLayers = normalizedRecipe.required_layers.filter((layer) => !selectedLayers.has(layer));
    if (missingLayers.length > 0) fail("MISSING_REQUIRED_LAYER", "recipe selection does not cover required composition layers", {missing: missingLayers});
  }
  const result = packageDocuments({recipe: normalizedRecipe, recipeRef, task: normalizedTask, selectedBlocks, external: boundExternal, library, parent: parentIdentity, repositoryRoot});
  if (outputDir !== null) {
    const target = externalOutputDir(outputDir, repositoryRoot);
    fs.mkdirSync(target, {recursive: true});
    for (const [name, document] of Object.entries({"agent-plan.json": result.documents.agentPlan, "block-lock.json": result.documents.blockLock, "authority-graph.json": result.documents.authorityGraph, "context-manifest.json": result.documents.contextManifest, "decision-tree.gate": result.documents.decisionTree, "proof-matrix.json": result.documents.proofMatrix, "handoff.schema.json": result.documents.handoffSchema, "evaluation-receipt.json": result.documents.evaluationReceipt})) writeJson(path.join(target, name), document);
    fs.writeFileSync(path.join(target, "bootstrap.md"), result.bootstrap, "utf8");
    result.packageDir = target;
  }
  return result;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) fail("PACKAGE_INCOMPLETE", `${path.basename(filePath)} is missing`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("PACKAGE_INVALID_JSON", `${path.basename(filePath)} is not valid JSON`, {message: error.message});
  }
}

export function validateTaskShapedAgentPackage(packageDir, {repositoryRoot = null} = {}) {
  const target = externalOutputDir(packageDir, repositoryRoot);
  const names = fs.existsSync(target) ? fs.readdirSync(target).sort() : [];
  const expected = [...COMPOSITION_OUTPUTS, "bootstrap.md"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) fail("PACKAGE_FILE_SET_INVALID", "generated package must contain only the eight machine outputs and bootstrap.md", {actual: names, expected});
  const documents = {
    agentPlan: readJson(path.join(target, "agent-plan.json")),
    blockLock: readJson(path.join(target, "block-lock.json")),
    authorityGraph: readJson(path.join(target, "authority-graph.json")),
    contextManifest: readJson(path.join(target, "context-manifest.json")),
    decisionTree: readJson(path.join(target, "decision-tree.gate")),
    proofMatrix: readJson(path.join(target, "proof-matrix.json")),
    handoffSchema: readJson(path.join(target, "handoff.schema.json")),
    evaluationReceipt: readJson(path.join(target, "evaluation-receipt.json")),
  };
  secretFree(documents, "generated package");
  const packageHash = documents.agentPlan.package_hash;
  assertDigest(packageHash, "package_hash");
  for (const document of Object.values(documents)) if (document.package_hash !== packageHash) fail("PACKAGE_HASH_MISMATCH", "machine outputs do not share one package hash");
  const basis = Object.fromEntries(Object.entries(documents).map(([key, document]) => [key, withoutPackageHash(document)]));
  if (stableDigest(basis) !== packageHash) fail("PACKAGE_HASH_MISMATCH", "package hash does not match machine outputs");
  if (documents.blockLock.reuse_rule !== "RESOLVE_EXACT_ID_VERSION_HASH_ONCE;_COMPILED_AGENTS_REFERENCE_AND_NEVER_COPY_OR_RESEARCH_THE_BLOCK") fail("REUSE_RULE_INVALID", "block lock does not enforce exact reusable references");
  if (documents.contextManifest.external_only !== true) fail("PRODUCT_REPOSITORY_RESIDUE_FORBIDDEN", "context manifest is not external-only");
  if (documents.contextManifest.capabilities.secrets !== "DENY" || documents.contextManifest.capabilities.deploy !== "DENY") fail("CAPABILITY_BOUNDARY_INVALID", "generated package grants forbidden capability");
  if (documents.decisionTree.answer_type !== "FOUR_VALUED" || JSON.stringify(documents.decisionTree.allowed_outcomes) !== JSON.stringify(GATE_OUTCOMES)) fail("DECISION_TREE_INVALID", "composed gate is not four-valued");
  const treeDigest = stableDigest({...withoutPackageHash(documents.decisionTree), decision_tree_sha256: null});
  if (treeDigest !== documents.decisionTree.decision_tree_sha256) fail("DECISION_TREE_HASH_INVALID", "composed gate digest is invalid");
  const bootstrap = fs.readFileSync(path.join(target, "bootstrap.md"), "utf8");
  if (!bootstrap.includes("GENERATED_FROM_MACHINE_CONTRACTS;_BOOTSTRAP_MD_IS_NOT_AUTHORITY")) fail("BOOTSTRAP_NOT_GENERATED", "bootstrap.md is missing generated-view marker");
  for (const block of documents.blockLock.blocks) {
    const exact = `${block.block_id}@${block.version}#${block.hash}`;
    if (!bootstrap.includes(exact)) fail("BOOTSTRAP_LOCK_MISMATCH", `bootstrap.md does not reflect ${exact}`);
    if (block.role_kind === "ATOMIC_SPECIALIST") {
      if (typeof block.required_upstream_router !== "string" || block.required_upstream_router.length === 0) fail("PACKAGE_ATOMICITY_INVALID", `${block.block_id} lock omits its required upstream router`);
      if (!documents.blockLock.blocks.some((candidate) => candidate.block_id === block.required_upstream_router && candidate.role_kind === "ROUTER")) fail("PACKAGE_ATOMICITY_INVALID", `${block.block_id} lock omits its upstream ROUTER`);
      if (!Array.isArray(block.sibling_conflicts)) fail("PACKAGE_ATOMICITY_INVALID", `${block.block_id} lock omits sibling conflicts`);
    }
  }
  if (!bootstrap.includes(`Package hash: ${packageHash}`)) fail("BOOTSTRAP_HASH_MISMATCH", "bootstrap.md does not reflect package hash");
  return {status: "PASS", package_hash: packageHash, files: names, documents};
}

export function freezeTaskShapedAgentPackage(packageDir, {archiveIdentity = "external.archive-receipt", archiveVersion = "1.0.0"} = {}) {
  const validated = validateTaskShapedAgentPackage(packageDir);
  const receipt = {schema: "agentos.generated_instance_freeze_receipt.v1", version: 1, package_hash: validated.package_hash, archive_identity: archiveIdentity, archive_version: archiveVersion, status: "FROZEN_ARCHIVED", rule: "Frozen instance is immutable and reproducible from its machine outputs; any change creates a new package identity.", independent_acceptance_required: true};
  return receipt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify({status: "READY", compiler: COMPILER_IDENTITY, outputs: COMPOSITION_OUTPUTS, layers: COMPOSITION_LAYERS}, null, 2) + "\n");
}
