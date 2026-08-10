#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  EFFECTIVE_MODEL_READBACK_SCHEMA,
  FALLBACK_BOUNDARY_SCHEMA,
  SAFE_FALLBACK_TRIGGERS,
  compileEffectiveModelReadback,
  compileHostCapabilityAttestation,
  compileHostCapabilityCatalog,
  compileTaskModelPolicy,
  compileTaskProfile,
  requireVerifiedEffectiveModel,
  selectExecutionRoute,
  selectFallbackRoute,
  validateEffectiveModelReadback,
  validateFallbackBoundary,
  validateRoute,
} from "../control/task-model-routing.mjs";
import {compileTaskContextItem, compileTaskContextPolicy, selectTaskContext} from "../control/task-context-firewall.mjs";
import {admitExecutionRoute} from "../control/task-routing-admission.mjs";
import {compileTaskRoutingEvaluation, replayTaskRouting} from "../control/task-routing-evaluation.mjs";
import {scanPersistedRecord} from "../control/content-addressing.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const NOW = "2026-08-06T12:00:00.000Z";
const SAFE_TOOLS = ["read_source", "write_assigned_worktree"];
const SAFE_PERMISSIONS = ["EMIT_EVIDENCE", "READ_SOURCE", "WRITE_ASSIGNED_WORKTREE"];

function model({
  model: name,
  reasoning_effort: reasoningEffort,
  context_tokens: contextTokens,
  verifier_strength: verifierStrength,
  expected_cost: expectedCost,
  estimated_wall_seconds: wallSeconds,
  estimated_success_probability: successProbability,
  capabilities = ["code"],
  tools = SAFE_TOOLS,
  permissions = SAFE_PERMISSIONS,
  spawnable = true,
  worker_shapes = ["INDEPENDENT_REVIEW_TEAM", "SINGLE_BOUNDED_WORKER", "SMALL_PARALLEL_TEAM"],
  workspace_capabilities = ["ASSIGNED_WORKTREE", "HOST_BOUND_WORKSPACE", "READ_ONLY_SOURCE"],
  evidence_paths = ["CAMPAIGN_HANDOFF_RECORD", "INDEPENDENT_REVIEW_RECORD", "TASK_EVIDENCE_RECORD"],
}) {
  return {
    model: name,
    reasoning_effort: reasoningEffort,
    capabilities: [...capabilities].sort(),
    context_tokens: contextTokens,
    tools: [...tools].sort(),
    verifier_strength: verifierStrength,
    permissions: [...permissions].sort(),
    expected_cost: expectedCost,
    estimated_wall_seconds: wallSeconds,
    estimated_success_probability: successProbability,
    cost_unit: "RELATIVE_ACCEPTED_RESULT_UNIT",
    spawnable,
    worker_shapes: [...worker_shapes].sort(),
    workspace_capabilities: [...workspace_capabilities].sort(),
    evidence_paths: [...evidence_paths].sort(),
  };
}

const catalog = compileHostCapabilityCatalog({
  attachmentRefSha256: SHA_A,
  observedAtUtc: NOW,
  models: [
    model({
      model: "HOST_DEFAULT",
      reasoning_effort: "max",
      context_tokens: 128000,
      verifier_strength: "INDEPENDENT_AUDITOR",
      expected_cost: 4,
      estimated_wall_seconds: 100,
      estimated_success_probability: 0.99,
    }),
    model({
      model: "HOST_RESERVE",
      reasoning_effort: "max",
      context_tokens: 100000,
      verifier_strength: "INDEPENDENT_AUDITOR",
      expected_cost: 5,
      estimated_wall_seconds: 120,
      estimated_success_probability: 0.99,
    }),
    model({
      model: "HOST_ECO",
      reasoning_effort: "medium",
      context_tokens: 32000,
      verifier_strength: "DETERMINISTIC",
      expected_cost: 1,
      estimated_wall_seconds: 40,
      estimated_success_probability: 0.9,
    }),
    model({
      model: "HOST_FRONTIER",
      reasoning_effort: "max",
      context_tokens: 256000,
      verifier_strength: "HIGH_ASSURANCE",
      expected_cost: 12,
      estimated_wall_seconds: 180,
      estimated_success_probability: 0.995,
    }),
    model({
      model: "HOST_OFFLINE",
      reasoning_effort: "max",
      context_tokens: 128000,
      verifier_strength: "INDEPENDENT_AUDITOR",
      expected_cost: 3,
      estimated_wall_seconds: 90,
      estimated_success_probability: 0.99,
      spawnable: false,
    }),
    model({
      model: "HOST_READONLY",
      reasoning_effort: "max",
      context_tokens: 128000,
      verifier_strength: "INDEPENDENT_AUDITOR",
      expected_cost: 2,
      estimated_wall_seconds: 80,
      estimated_success_probability: 0.99,
      tools: ["read_source"],
      permissions: ["EMIT_EVIDENCE", "READ_SOURCE"],
    }),
  ],
});

const hostAttestation = compileHostCapabilityAttestation({
  catalog,
  sourceBindingSha256: SHA_E,
  projectContextSha256: SHA_D,
  hostRefSha256: SHA_A,
  observedAtUtc: NOW,
  expiresAtUtc: "2026-08-07T12:00:00.000Z",
});

const sensitiveProfile = compileTaskProfile({
  taskRefSha256: SHA_B,
  goalRefSha256: SHA_C,
  projectContextSha256: SHA_D,
  role: "INDEPENDENT_AUDITOR",
  lane: "security-privacy",
  taskClass: "SENSITIVE_REVIEW",
  sensitivity: "SENSITIVE",
  requiredCapabilities: ["code"],
  requiredContextTokens: 50000,
  requiredTools: SAFE_TOOLS,
  requiredPermissions: SAFE_PERMISSIONS,
  permissionCeiling: SAFE_PERMISSIONS,
  maxExpectedCost: 6,
  deadlineSeconds: 200,
  fallbackAllowed: true,
  fallbackTriggers: ["MODEL_UNAVAILABLE", "RATE_LIMITED", "CAPACITY_UNAVAILABLE", "CONTEXT_UNAVAILABLE", "BUDGET_EXCEEDED"],
});

const contextPolicy = compileTaskContextPolicy({
  sourceBindingSha256: SHA_E,
  projectContextSha256: SHA_D,
  taskRefSha256: SHA_B,
  goalRefSha256: SHA_C,
});
const contextItems = [
  compileTaskContextItem({
    itemRefSha256: SHA_A,
    sourceBindingSha256: SHA_E,
    projectContextSha256: SHA_D,
    taskRefSha256: SHA_B,
    goalRefSha256: SHA_C,
    authority: "TASK_AUTHORITY",
    contentClass: "TASK_INPUT",
    capturedAtUtc: NOW,
    expiresAtUtc: "2026-08-07T12:00:00.000Z",
    tokenCount: 30000,
    safeLabel: "task-input",
  }),
  compileTaskContextItem({
    itemRefSha256: SHA_B,
    sourceBindingSha256: SHA_E,
    projectContextSha256: SHA_D,
    taskRefSha256: SHA_B,
    goalRefSha256: SHA_C,
    authority: "PROJECT_AUTHORITY",
    contentClass: "SOURCE_METADATA",
    capturedAtUtc: NOW,
    expiresAtUtc: "2026-08-07T12:00:00.000Z",
    tokenCount: 25000,
    safeLabel: "source-metadata",
  }),
];
const contextSelection = selectTaskContext({taskProfile: sensitiveProfile, policy: contextPolicy, items: contextItems, nowUtc: NOW});

const defaultPolicy = compileTaskModelPolicy({
  fallback: {ordered_models: ["HOST_RESERVE"]},
});

assert.equal(defaultPolicy.default_model, DEFAULT_MODEL);
assert.equal(defaultPolicy.default_reasoning_effort, DEFAULT_REASONING_EFFORT);
assert.deepEqual(defaultPolicy.fallback.allowed_triggers, [...SAFE_FALLBACK_TRIGGERS].sort());

const defaultRoute = selectExecutionRoute({
  taskProfile: sensitiveProfile,
  policy: defaultPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  sourceBindingSha256: SHA_E,
  observedAtUtc: NOW,
});
assert.equal(defaultRoute.model, DEFAULT_MODEL);
assert.equal(defaultRoute.reasoning_effort, DEFAULT_REASONING_EFFORT);
assert.equal(defaultRoute.selection_source, "POLICY_DEFAULT");
assert.equal(defaultRoute.verifier.selected, "INDEPENDENT_AUDITOR");
assert.equal(defaultRoute.context.required_tokens, 50000);
assert.ok(defaultRoute.fallback_candidates.some((candidate) => candidate.model === "HOST_RESERVE"));
const economicalRejection = defaultRoute.excluded_candidates.find((candidate) => candidate.model === "HOST_ECO");
assert.ok(economicalRejection.reasons.includes("REASONING_TOO_WEAK"));
assert.ok(economicalRejection.reasons.includes("VERIFIER_TOO_WEAK"));
const frontierRejection = defaultRoute.excluded_candidates.find((candidate) => candidate.model === "HOST_FRONTIER");
assert.ok(frontierRejection.reasons.includes("BUDGET_EXCEEDED"));
const readonlyRejection = defaultRoute.excluded_candidates.find((candidate) => candidate.model === "HOST_READONLY");
assert.ok(readonlyRejection.reasons.includes("TOOL_UNAVAILABLE"));
assert.ok(readonlyRejection.reasons.includes("PERMISSION_UNAVAILABLE"));
validateRoute(defaultRoute);

const reorderedCatalog = compileHostCapabilityCatalog({
  attachmentRefSha256: SHA_A,
  observedAtUtc: NOW,
  models: [...catalog.models].reverse(),
});
assert.equal(reorderedCatalog.digest, catalog.digest);

const overridePolicy = compileTaskModelPolicy({
  overrides: [{scope: "ROLE", scope_ref: "INDEPENDENT_AUDITOR", model: "HOST_RESERVE", reasoning_effort: "max"}],
});
const overrideRoute = selectExecutionRoute({
  taskProfile: sensitiveProfile,
  policy: overridePolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  sourceBindingSha256: SHA_E,
  observedAtUtc: NOW,
});
assert.equal(overrideRoute.model, "HOST_RESERVE");
assert.equal(overrideRoute.selection_source, "OWNER_ROLE_OVERRIDE");

const economicalProfile = compileTaskProfile({
  taskRefSha256: SHA_B,
  goalRefSha256: SHA_C,
  projectContextSha256: SHA_D,
  role: "NAMED_LANE_WORKER",
  lane: "code-hygiene",
  taskClass: "ROUTINE_BUILD",
  requiredContextTokens: 20000,
  requiredTools: SAFE_TOOLS,
  requiredPermissions: SAFE_PERMISSIONS,
  permissionCeiling: SAFE_PERMISSIONS,
});
const economicalPolicy = compileTaskModelPolicy({preference: "SAVE_EFFORT"});
const economicalRoute = selectExecutionRoute({
  taskProfile: economicalProfile,
  policy: economicalPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection: selectTaskContext({taskProfile: economicalProfile, policy: contextPolicy, items: contextItems, nowUtc: NOW}),
  hostAttestation,
  sourceBindingSha256: SHA_E,
  observedAtUtc: NOW,
});
assert.equal(economicalRoute.model, "HOST_ECO");
assert.equal(economicalRoute.reasoning_effort, "medium");

const safeFallback = selectFallbackRoute({
  route: defaultRoute,
  taskProfile: sensitiveProfile,
  policy: defaultPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  observedAtUtc: NOW,
  trigger: "RATE_LIMITED",
});
assert.equal(safeFallback.status, "ADMITTED");
assert.equal(safeFallback.model, "HOST_RESERVE");
assert.equal(safeFallback.selection_source, "FALLBACK");
assert.equal(safeFallback.attempt, 1);
assert.equal(safeFallback.predecessor_route_sha256, defaultRoute.digest);
assert.notEqual(safeFallback.digest, defaultRoute.digest);

const hardBoundaryFallback = selectFallbackRoute({
  route: defaultRoute,
  taskProfile: sensitiveProfile,
  policy: defaultPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  observedAtUtc: NOW,
  trigger: "READBACK_MISMATCH",
});
assert.equal(hardBoundaryFallback.schema, FALLBACK_BOUNDARY_SCHEMA);
assert.equal(hardBoundaryFallback.status, "BLOCKED");
assert.equal(hardBoundaryFallback.reason_code, "FALLBACK_FORBIDDEN_HARD_BOUNDARY");
validateFallbackBoundary(hardBoundaryFallback);

const tightPolicy = compileTaskModelPolicy({maxExpectedCost: 4, fallback: {ordered_models: []}});
const tightRoute = selectExecutionRoute({
  taskProfile: sensitiveProfile,
  policy: tightPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  sourceBindingSha256: SHA_E,
  observedAtUtc: NOW,
});
const noSafeFallback = selectFallbackRoute({
  route: tightRoute,
  taskProfile: sensitiveProfile,
  policy: tightPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  observedAtUtc: NOW,
  trigger: "MODEL_UNAVAILABLE",
});
assert.equal(noSafeFallback.status, "BLOCKED");
assert.equal(noSafeFallback.reason_code, "NO_SAFE_FALLBACK");

function readbackFor(route, executionRefSha256, overrides = {}) {
  return {
    execution_ref_sha256: executionRefSha256,
    route_sha256: route.digest,
    model: route.model,
    reasoning_effort: route.reasoning_effort,
    capability_catalog_sha256: route.capability_catalog_sha256,
    tools: [...route.tools.allowed],
    context_tokens: route.context.selected_tokens,
    permissions: [...route.permissions.granted],
    ...overrides,
  };
}

const verifiedReadback = compileEffectiveModelReadback({
  route: defaultRoute,
  hostReadback: readbackFor(defaultRoute, SHA_A),
  sessionReadback: readbackFor(defaultRoute, SHA_B),
  observedAtUtc: NOW,
});
assert.equal(verifiedReadback.schema, EFFECTIVE_MODEL_READBACK_SCHEMA);
assert.equal(verifiedReadback.status, "VERIFIED");
assert.equal(verifiedReadback.acceptance, true);
assert.equal(verifiedReadback.effective_model, defaultRoute.model);
assert.equal(verifiedReadback.effective_reasoning_effort, defaultRoute.reasoning_effort);
assert.equal(verifiedReadback.protected_actions_enabled, false);
requireVerifiedEffectiveModel(verifiedReadback, defaultRoute);
validateEffectiveModelReadback(verifiedReadback);

const unknownReadback = compileEffectiveModelReadback({route: defaultRoute, observedAtUtc: NOW});
assert.equal(unknownReadback.status, "UNKNOWN");
assert.equal(unknownReadback.acceptance, false);
assert.equal(unknownReadback.effective_model, null);
assert.ok(unknownReadback.missing_fields.includes("host.model"));
assert.throws(() => requireVerifiedEffectiveModel(unknownReadback, defaultRoute), /HOST_EXECUTION_READBACK_UNAVAILABLE/u);

const mismatchReadback = compileEffectiveModelReadback({
  route: defaultRoute,
  hostReadback: readbackFor(defaultRoute, SHA_A, {model: "HOST_RESERVE"}),
  sessionReadback: readbackFor(defaultRoute, SHA_B),
  observedAtUtc: NOW,
});
assert.equal(mismatchReadback.status, "MISMATCH");
assert.equal(mismatchReadback.acceptance, false);
assert.ok(mismatchReadback.mismatch_fields.includes("host.model"));
assert.throws(() => requireVerifiedEffectiveModel(mismatchReadback, defaultRoute), /HOST_SESSION_EXECUTION_MISMATCH/u);

const admitted = admitExecutionRoute({
  route: defaultRoute,
  hostReadback: readbackFor(defaultRoute, SHA_A),
  sessionReadback: readbackFor(defaultRoute, SHA_B),
  observedAtUtc: NOW,
});
assert.equal(admitted.admission.status, "ADMITTED");
assert.equal(admitted.admission.product_acceptance, false);

const evaluation = compileTaskRoutingEvaluation({
  taskClass: "SENSITIVE_REVIEW",
  taskProfileSha256: sensitiveProfile.digest,
  routeSha256: defaultRoute.digest,
  contextSelectionSha256: contextSelection.digest,
  evaluatorRefSha256: SHA_A,
  observedAtUtc: NOW,
  qualityScore: 0.95,
  expectedCost: defaultRoute.cost.expected,
  observedLatencySeconds: defaultRoute.cost.estimated_wall_seconds,
  contextSufficiency: 1,
  policyCompliant: true,
  acceptedResult: true,
});
assert.equal(evaluation.status, "OBSERVED");
const replay = replayTaskRouting({
  taskProfile: sensitiveProfile,
  policy: defaultPolicy,
  contextPolicy,
  capabilityCatalog: catalog,
  contextSelection,
  hostAttestation,
  sourceBindingSha256: SHA_E,
  observedAtUtc: NOW,
  expectedRouteSha256: defaultRoute.digest,
  builderRefSha256: SHA_C,
  evaluatorRefSha256: SHA_D,
});
assert.equal(replay.status, "MATCH");

assert.throws(() => compileTaskProfile({
  taskRefSha256: SHA_B,
  goalRefSha256: SHA_C,
  projectContextSha256: SHA_D,
  role: "NAMED_LANE_WORKER",
  lane: "security-privacy",
  taskClass: "SENSITIVE_REVIEW",
  sensitivity: "SENSITIVE",
  requiredContextTokens: 1,
  requiredTools: [],
  requiredPermissions: [],
  permissionCeiling: ["PROTECTED_EXTERNAL_ACTION"],
}), /cannot grant protected/u);

assert.throws(() => compileTaskModelPolicy({
  allowedPermissions: ["PROTECTED_EXTERNAL_ACTION"],
}), /cannot grant protected/u);

assert.equal(scanPersistedRecord(defaultRoute).safe, true);
assert.equal(scanPersistedRecord(verifiedReadback).safe, true);
assert.equal(scanPersistedRecord(contextSelection).safe, true);
assert.equal(scanPersistedRecord(hostAttestation).safe, true);
assert.equal(scanPersistedRecord(admitted.admission).safe, true);
assert.equal(scanPersistedRecord(evaluation).safe, true);
assert.equal(scanPersistedRecord(replay).safe, true);
assert.doesNotMatch(JSON.stringify(verifiedReadback), /(?:\/Users\/|\\Users\\|api[_-]?key|password|secret)/iu);

for (const schemaPath of [
  "schemas/task-profile.v1.json",
  "schemas/task-model-policy.v1.json",
  "schemas/host-capability-catalog.v1.json",
  "schemas/host-capability-attestation.v1.json",
  "schemas/task-context-policy.v1.json",
  "schemas/task-context-item.v1.json",
  "schemas/task-context-selection.v1.json",
  "schemas/execution-route.v1.json",
  "schemas/effective-model-readback.v1.json",
  "schemas/fallback-boundary.v1.json",
  "schemas/routing-unavailable.v1.json",
  "schemas/execution-admission.v1.json",
  "schemas/task-routing-evaluation.v1.json",
  "schemas/task-routing-replay.v1.json",
]) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
}

console.log("PASS task/model routing: deterministic capability matching, owner overrides, safe fallback, privacy-safe records, and authoritative readback boundaries");
