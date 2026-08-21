#!/usr/bin/env node

/* Canonical, read-only authority binding for the OpenAPI HTTP Contract lane. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, canonicalJson, compareUtf8, scanPersistedRecord} from "./content-addressing.mjs";
import {auditModelPolicyEvidenceStore} from "./eco-model-policy.mjs";
import {evaluateProductClientRouterBoundary} from "./product-client-router-boundary-gate.mjs";

export const OPENAPI_CONTRACTS_CONTEXT_SCHEMA = "agentos.openapi_contracts_context_binding.v1";
export const OPENAPI_CONTRACTS_MODEL_ROUTE_SCHEMA = "agentos.openapi_contracts_model_route.v1";
export const OPENAPI_CONTRACTS_BLOCK_ID = "specialist.product-client.openapi-contracts";
export const OPENAPI_CONTRACTS_PACKAGE = "specialist-blocks/wave-02/openapi-contracts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_LOCK = path.join(ROOT, OPENAPI_CONTRACTS_PACKAGE, "sources.lock");
const MODEL_SNAPSHOT = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const MODEL_EVIDENCE_MANIFEST = "fixtures/model-policy-evidence/manifest.json";
const STANDARD_PACKAGE = path.join(ROOT, "specialist-blocks/standards/openapi-3-1-1");
const ROUTER_PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/product-client-router");
const REQUIRED_CONTEXT = Object.freeze([
  "api.contract", "api.version", "authority", "candidate.identity", "custody", "request", "signals", "source_lock",
]);
const INVALIDATION_TRIGGERS = Object.freeze([
  "block_digest_changed", "source_lock_digest_changed", "standard_block_digest_changed", "standard_source_manifest_changed",
  "upstream_router_digest_changed", "upstream_router_receipt_changed", "model_policy_snapshot_changed", "model_route_changed",
  "context_schema_changed", "candidate_commit_changed", "candidate_tree_changed", "custody_changed", "review_receipt_stale",
]);

function fail(message, code = "OPENAPI_CONTRACTS_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) { if (!condition) fail(message, code); }
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function fileSha(file) { return sha(fs.readFileSync(file)); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} is not a SHA-256`, "OPENAPI_CONTRACTS_AUTHORITY_DIGEST_INVALID"); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`); }

function canonicalRouterReceipt() {
  const fixture = json(path.join(ROUTER_PACKAGE, "fixtures/narrowness.json"));
  const observed = evaluateProductClientRouterBoundary(fixture.vector.input);
  assert(observed.disposition === "ROUTE" && observed.route === "SPECIALIST_HANDOFF", "upstream router canonical receipt is not route-ready", "OPENAPI_CONTRACTS_ROUTER_RECEIPT_INVALID");
  requireSha(observed.result_sha256, "upstream router result");
  return observed.result_sha256;
}

function compilePreparedModelRoute(snapshot) {
  const task = snapshot.task_classes.find((entry) => entry.task_class === "NARROW_CODING");
  const model = snapshot.models.find((entry) => entry.model_id === "gpt-5.6-luna");
  assert(task && model, "OpenAPI model-policy task or Luna model is missing", "OPENAPI_CONTRACTS_MODEL_POLICY_INVALID");
  assert(snapshot.status === "PREPARED_INACTIVE", "OpenAPI model-policy snapshot is not the prepared candidate snapshot", "OPENAPI_CONTRACTS_MODEL_POLICY_INVALID");
  assert(model.host_available === true && model.host_supported_reasoning_efforts.includes("max"), "Luna max is not host-attested", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(model.capability_score >= task.minimum_capability_score && model.context_tokens >= task.minimum_context_tokens, "Luna does not satisfy the narrow coding floor", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(task.required_capabilities.every((capability) => model.capabilities.includes(capability)), "Luna does not satisfy the narrow coding capabilities", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  const route = {
    schema: OPENAPI_CONTRACTS_MODEL_ROUTE_SCHEMA,
    version: 1,
    status: "PREPARED_INACTIVE",
    task_class: task.task_class,
    model_id: model.model_id,
    reasoning_effort: "max",
    policy_reasoning_preference: task.preferred_reasoning_effort,
    capability_floor: task.minimum_capability_score,
    required_capabilities: [...task.required_capabilities].sort(compareUtf8),
    selected_capability_score: model.capability_score,
    context_floor_tokens: task.minimum_context_tokens,
    selected_context_tokens: model.context_tokens,
    host_available: model.host_available,
    host_supports_requested_reasoning: true,
    spawn_eligible: false,
    snapshot_sha256: snapshot.snapshot_sha256,
    route_sha256: null,
  };
  route.route_sha256 = canonicalDigest(digestBody(route, "route_sha256"));
  return route;
}

export function compileOpenApiContractsContext({authority, candidateCommit = null, candidateTree = null, custodyStatus = "BOUND"} = {}) {
  assert(authority && typeof authority === "object", "OpenAPI authority is required", "OPENAPI_CONTRACTS_CONTEXT_INVALID");
  const context = {
    schema: OPENAPI_CONTRACTS_CONTEXT_SCHEMA,
    version: 1,
    block_id: OPENAPI_CONTRACTS_BLOCK_ID,
    package: OPENAPI_CONTRACTS_PACKAGE,
    required_context: [...REQUIRED_CONTEXT],
    optional_context: ["evaluation_receipt", "project_context", "runtime_readback"],
    source_lock: {
      source_id: authority.source_id,
      source_version: authority.source_version,
      manifest_sha256: authority.source_manifest_sha256,
      effective_date: authority.source_effective_date,
      retrieved_date: authority.source_retrieved_date,
    },
    standard: {
      block_id: "specialist.standard.openapi-3-1-1",
      block_sha256: authority.standard_block_sha256,
      source_manifest_sha256: authority.standard_source_manifest_sha256,
      version: "3.1.1",
    },
    upstream_router: {
      block_id: "specialist.product-client.router",
      block_sha256: authority.router_block_sha256,
      receipt_sha256: authority.router_result_sha256,
    },
    model_policy: {
      snapshot_sha256: authority.model.snapshot_sha256,
      route_sha256: authority.model_route_sha256,
      task_class: authority.model.task_class,
      model_id: authority.model.model_id,
      reasoning_effort: authority.model.reasoning_effort,
      spawn_eligible: authority.model.spawn_eligible,
    },
    candidate: {
      block_sha256: authority.block_sha256,
      commit: candidateCommit,
      tree: candidateTree,
    },
    custody: {
      status: custodyStatus,
      owner: "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS",
      builder_only: true,
      independent_auditor_read_only: true,
    },
    invalidation_triggers: [...INVALIDATION_TRIGGERS],
    invalidation_rule: "INVALIDATE_DEPENDENT_CONTEXT;_PRESERVE_HISTORY;_REQUIRE_FRESH_BINDING",
    context_sha256: null,
  };
  assert(scanPersistedRecord(context).safe, "OpenAPI context contains protected data", "OPENAPI_CONTRACTS_PRIVACY_DENIED");
  context.context_sha256 = canonicalDigest(digestBody(context, "context_sha256"));
  return context;
}

export function resolveOpenApiContractsCanonicalAuthority() {
  const packageRoot = path.join(ROOT, OPENAPI_CONTRACTS_PACKAGE);
  const block = json(path.join(packageRoot, "block.json"));
  const sources = json(SOURCE_LOCK);
  const standardBlock = json(path.join(STANDARD_PACKAGE, "block.json"));
  const standardSources = json(path.join(STANDARD_PACKAGE, "sources.lock"));
  const routerBlock = json(path.join(ROUTER_PACKAGE, "block.json"));
  const snapshot = json(MODEL_SNAPSHOT);
  auditModelPolicyEvidenceStore(snapshot, {authorityRoot: ROOT, evidenceManifestPath: MODEL_EVIDENCE_MANIFEST});
  assert(block.block_id === OPENAPI_CONTRACTS_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "OpenAPI candidate state is invalid", "OPENAPI_CONTRACTS_PACKAGE_STATE_INVALID");
  assert(block.block_sha256 === canonicalDigest(digestBody(block, "block_sha256")), "OpenAPI block digest is invalid", "OPENAPI_CONTRACTS_AUTHORITY_DIGEST_INVALID");
  assert(sources.manifest_sha256 === canonicalDigest(digestBody(sources, "manifest_sha256")), "OpenAPI source manifest digest is invalid", "OPENAPI_CONTRACTS_AUTHORITY_DIGEST_INVALID");
  assert(standardBlock.block_id === "specialist.standard.openapi-3-1-1" && standardBlock.reuse.standard_identity?.edition === "3.1.1", "OpenAPI standard binding is invalid", "OPENAPI_CONTRACTS_STANDARD_BINDING_INVALID");
  assert(standardSources.manifest_sha256 === canonicalDigest(digestBody(standardSources, "manifest_sha256")), "OpenAPI standard source manifest digest is invalid", "OPENAPI_CONTRACTS_STANDARD_BINDING_INVALID");
  assert(routerBlock.block_id === "specialist.product-client.router", "Product Client router binding is invalid", "OPENAPI_CONTRACTS_ROUTER_BINDING_INVALID");
  const source = sources.sources.find((entry) => entry.source_id === "source.atomic-specialization-law");
  assert(source && source.version === "1" && source.immutable_identity === "agentos-atomic-specialization-law-v1", "OpenAPI source lock identity is invalid", "OPENAPI_CONTRACTS_SOURCE_BINDING_INVALID");
  const modelRoute = compilePreparedModelRoute(snapshot);
  const authority = {
    block_id: block.block_id,
    block_sha256: block.block_sha256,
    source_id: source.source_id,
    source_version: source.version,
    source_effective_date: source.effective_date,
    source_retrieved_date: source.retrieved_date,
    source_manifest_sha256: sources.manifest_sha256,
    standard_block_sha256: standardBlock.block_sha256,
    standard_source_manifest_sha256: standardSources.manifest_sha256,
    router_block_sha256: routerBlock.block_sha256,
    router_result_sha256: canonicalRouterReceipt(),
    model: {
      snapshot_sha256: snapshot.snapshot_sha256,
      snapshot_status: snapshot.status,
      task_class: modelRoute.task_class,
      model_id: modelRoute.model_id,
      reasoning_effort: modelRoute.reasoning_effort,
      capability_floor: modelRoute.capability_floor,
      required_capabilities: modelRoute.required_capabilities,
      route_sha256: modelRoute.route_sha256,
      spawn_eligible: modelRoute.spawn_eligible,
    },
    model_route_sha256: modelRoute.route_sha256,
    model_route: modelRoute,
    required_block_identities: [
      "specialist.foundation.authority-jurisdiction-gate",
      "specialist.foundation.evidence-freshness-gate",
      "specialist.foundation.role-intake-classifier",
      "specialist.foundation.scope-non-goal-gate",
      "specialist.foundation.tool-custody-gate",
      "specialist.product-client.router",
      "specialist.standard.openapi-3-1-1",
    ],
    package_file_sha256: fileSha(path.join(packageRoot, "block.json")),
  };
  authority.context = compileOpenApiContractsContext({authority});
  authority.context_sha256 = authority.context.context_sha256;
  assert(scanPersistedRecord(authority).safe, "OpenAPI authority binding contains protected data", "OPENAPI_CONTRACTS_PRIVACY_DENIED");
  return Object.freeze(authority);
}

export function validateOpenApiContractsContext(context, authority) {
  exact(context, [
    "schema", "version", "block_id", "package", "required_context", "optional_context", "source_lock", "standard", "upstream_router",
    "model_policy", "candidate", "custody", "invalidation_triggers", "invalidation_rule", "context_sha256",
  ], "OpenAPI context");
  assert(context.schema === OPENAPI_CONTRACTS_CONTEXT_SCHEMA && context.version === 1, "OpenAPI context identity is invalid", "OPENAPI_CONTRACTS_CONTEXT_INVALID");
  requireSha(context.context_sha256, "OpenAPI context");
  assert(context.context_sha256 === canonicalDigest(digestBody(context, "context_sha256")), "OpenAPI context digest is invalid", "OPENAPI_CONTRACTS_CONTEXT_DIGEST_INVALID");
  assert(context.block_id === OPENAPI_CONTRACTS_BLOCK_ID && context.package === OPENAPI_CONTRACTS_PACKAGE, "OpenAPI context package binding is invalid", "OPENAPI_CONTRACTS_CONTEXT_INVALID");
  assert(JSON.stringify(context.required_context) === JSON.stringify(REQUIRED_CONTEXT), "OpenAPI context required fields differ", "OPENAPI_CONTRACTS_CONTEXT_INVALID");
  assert(JSON.stringify(context.invalidation_triggers) === JSON.stringify(INVALIDATION_TRIGGERS), "OpenAPI context invalidation closure differs", "OPENAPI_CONTRACTS_INVALIDATION_INVALID");
  assert(context.invalidation_rule === "INVALIDATE_DEPENDENT_CONTEXT;_PRESERVE_HISTORY;_REQUIRE_FRESH_BINDING", "OpenAPI context invalidation rule is not fail-closed", "OPENAPI_CONTRACTS_INVALIDATION_INVALID");
  if (authority) {
    assert(context.source_lock.manifest_sha256 === authority.source_manifest_sha256, "OpenAPI context source binding is stale", "OPENAPI_CONTRACTS_CONTEXT_STALE");
    assert(context.standard.block_sha256 === authority.standard_block_sha256 && context.standard.source_manifest_sha256 === authority.standard_source_manifest_sha256, "OpenAPI context standard binding is stale", "OPENAPI_CONTRACTS_CONTEXT_STALE");
    assert(context.upstream_router.block_sha256 === authority.router_block_sha256 && context.upstream_router.receipt_sha256 === authority.router_result_sha256, "OpenAPI context router binding is stale", "OPENAPI_CONTRACTS_CONTEXT_STALE");
    assert(context.model_policy.snapshot_sha256 === authority.model.snapshot_sha256 && context.model_policy.route_sha256 === authority.model_route_sha256, "OpenAPI context model binding is stale", "OPENAPI_CONTRACTS_CONTEXT_STALE");
    assert(context.candidate.block_sha256 === authority.block_sha256, "OpenAPI context candidate binding is stale", "OPENAPI_CONTRACTS_CONTEXT_STALE");
  }
  return context;
}

export function invalidationReadback({context, authority, observed = {}} = {}) {
  validateOpenApiContractsContext(context);
  const changed = [];
  const checks = {
    block_digest_changed: observed.block_sha256 !== undefined && observed.block_sha256 !== context.candidate.block_sha256,
    source_lock_digest_changed: observed.source_manifest_sha256 !== undefined && observed.source_manifest_sha256 !== context.source_lock.manifest_sha256,
    standard_block_digest_changed: observed.standard_block_sha256 !== undefined && observed.standard_block_sha256 !== context.standard.block_sha256,
    standard_source_manifest_changed: observed.standard_source_manifest_sha256 !== undefined && observed.standard_source_manifest_sha256 !== context.standard.source_manifest_sha256,
    upstream_router_digest_changed: observed.router_block_sha256 !== undefined && observed.router_block_sha256 !== context.upstream_router.block_sha256,
    upstream_router_receipt_changed: observed.router_result_sha256 !== undefined && observed.router_result_sha256 !== context.upstream_router.receipt_sha256,
    model_policy_snapshot_changed: observed.model_snapshot_sha256 !== undefined && observed.model_snapshot_sha256 !== context.model_policy.snapshot_sha256,
    model_route_changed: observed.model_route_sha256 !== undefined && observed.model_route_sha256 !== context.model_policy.route_sha256,
    context_schema_changed: observed.context_schema !== undefined && observed.context_schema !== context.schema,
    candidate_commit_changed: observed.candidate_commit !== undefined && observed.candidate_commit !== context.candidate.commit,
    candidate_tree_changed: observed.candidate_tree !== undefined && observed.candidate_tree !== context.candidate.tree,
    custody_changed: observed.custody_status !== undefined && observed.custody_status !== context.custody.status,
    review_receipt_stale: observed.review_receipt_stale === true,
  };
  for (const [trigger, isChanged] of Object.entries(checks)) if (isChanged) changed.push(trigger);
  const invalidated = changed.length > 0;
  return Object.freeze({
    schema: "agentos.openapi_contracts_invalidation_readback.v1",
    version: 1,
    context_sha256: context.context_sha256,
    invalidated,
    changed_triggers: changed,
    reuse_allowed: !invalidated,
    action: invalidated ? "INVALIDATE_DEPENDENT_CONTEXT" : "REUSE_WITH_BOUND_CONTEXT",
    history_preserved: true,
    fresh_binding_required: invalidated,
    authority_bound: Boolean(authority),
    readback_sha256: canonicalDigest({context_sha256: context.context_sha256, invalidated, changed_triggers: changed, reuse_allowed: !invalidated, action: invalidated ? "INVALIDATE_DEPENDENT_CONTEXT" : "REUSE_WITH_BOUND_CONTEXT", history_preserved: true, fresh_binding_required: invalidated, authority_bound: Boolean(authority)}),
  });
}

