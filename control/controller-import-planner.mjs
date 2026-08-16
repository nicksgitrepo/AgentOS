#!/usr/bin/env node

/*
 * Project-agnostic Controller planner for imported projects.
 *
 * Bootstrap supplies an owner-bound project contract and preserved source
 * identity.  The persistent Controller supplies typed observations about the
 * imported architecture, features, environments, and host.  This compiler
 * derives the campaign roster and ordered audit/repair pyramid.  It does not
 * inspect a repository, spawn an agent, grant Product custody, or perform an
 * external action.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_IMPORT_CONTEXT_SCHEMA = "agentos.controller_import_planning_context.v1";
export const CONTROLLER_IMPORT_PLAN_SCHEMA = "agentos.controller_import_campaign_plan.v1";
export const CONTROLLER_IMPORT_RUN_STATE_SCHEMA = "agentos.controller_import_run_state.v1";
export const CONTROLLER_IMPORT_ROSTER_SCHEMA = "agentos.controller_import_roster_projection.v1";
export const CONTROLLER_IMPORT_CLOSEOUT_SCHEMA = "agentos.controller_import_closeout.v1";
export const CONTROLLER_IMPORT_PLANNER_VERSION = 1;
export const CONTROLLER_IMPORT_MAX_COGNITIVE_LANES = 6;
export const CONTROLLER_IMPORT_NEXT_ACTIONS = Object.freeze({
  START_AVAILABLE_WAVE: "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION",
  START_PENDING_BLOCK_REPAIR: "START_NEXT_LOCAL_BLOCK_REPAIR",
  WAIT_PROTECTED_WAVE_ACTIVATION: "WAIT_FOR_PROTECTED_WAVE_ACTIVATION",
  PREPARE_REVIEW: "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW",
});
export const CONTROLLER_IMPORT_PHASES = Object.freeze([
  "FOUNDATION",
  "FUNCTIONALITY",
  "ARCHITECTURE",
  "EXPERIENCE",
  "DATA_INTEGRITY",
  "SECURITY_PRIVACY",
  "OPERATIONS_RELIABILITY",
  "STANDARDS_ASSURANCE",
  "HYGIENE_PROVENANCE",
  "FINAL_INTEGRATION",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const COMPONENT_KINDS = new Set(["CLIENT", "API", "SERVICE", "DATA", "IDENTITY", "RUNTIME", "AI_SEARCH", "GRAPHICS_3D", "DOMAIN", "SHARED"]);
const ENVIRONMENT_KINDS = new Set(["LOCAL", "TEST", "DEVELOPMENT", "STAGING", "PRODUCTION"]);
const GPU_CLASSES = new Set(["NONE", "INTEGRATED", "DISCRETE", "UNKNOWN"]);
const NETWORK_MODES = new Set(["OFFLINE", "RESTRICTED", "CONNECTED", "UNKNOWN"]);
const STANDARD_STATUSES = new Set(["REQUIRED", "CONDITIONAL", "NOT_APPLICABLE"]);
const RUN_STATUSES = new Set(["SPAWNER_QA_PENDING", "SPECIALIST_WAVE_ACTIVE", "PLATFORM_REVIEW_PENDING", "CENTRAL_INTEGRATION_PENDING", "INDEPENDENT_REAUDIT_PENDING", "BLOCKED_RECOVERY", "BLOCKED_PROTECTED", "COMPLETE"]);
const RUN_EVENTS = new Set(["SPAWNER_QA_PASSED", "SPAWNER_QA_NOT_READY", "BLOCK_QA_REPAIRED", "SPECIALIST_WAVE_PASSED", "PLATFORM_REVIEW_PASSED", "CENTRAL_INTEGRATION_PASSED", "INDEPENDENT_REAUDIT_PASSED", "RECOVERY_FAILED", "PROTECTED_BOUNDARY_REACHED", "PROTECTED_BOUNDARY_RESOLVED"]);
const QA_STATUSES = new Set(["READY", "NOT_READY", "UNKNOWN"]);
const PHASE_RANK = new Map(CONTROLLER_IMPORT_PHASES.map((phase, index) => [phase, index]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable uppercase identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function sortedUnique(values, label, {allowEmpty = false, validator = requireIdentifier} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value) => validator(value, `${label} item`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

function normalizeIdentifiers(values, label, {allowEmpty = true} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value) => {
    requireIdentifier(value, `${label} item`);
    return value;
  }).sort(compareUtf8);
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  if (!allowEmpty) assert(normalized.length > 0, `${label} must not be empty`);
  return normalized;
}

function normalizeTextList(values, label, {allowEmpty = true} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value) => {
    requireString(value, `${label} item`);
    return value.trim();
  }).sort(compareUtf8);
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  if (!allowEmpty) assert(normalized.length > 0, `${label} must not be empty`);
  return normalized;
}

function normalizeProjectPaths(values, label) {
  return normalizeTextList(values, label).map((value) => {
    assert(!value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..") && !value.includes("\0"), `${label} contains an unsafe path`);
    return value;
  });
}

function normalizeGoal(goal, index) {
  exactKeys(goal, ["goal_id", "priority", "outcome", "success_conditions"], `planning goal ${index}`);
  requireIdentifier(goal.goal_id, `planning goal ${index} ID`);
  assert(Number.isSafeInteger(goal.priority) && goal.priority >= 1 && goal.priority <= 100, `planning goal ${index} priority is invalid`);
  requireString(goal.outcome, `planning goal ${index} outcome`);
  return {
    goal_id: goal.goal_id,
    priority: goal.priority,
    outcome: goal.outcome.trim(),
    success_conditions: normalizeTextList(goal.success_conditions, `planning goal ${index} success conditions`, {allowEmpty: false}),
  };
}

function normalizeComponent(component, index) {
  exactKeys(component, ["component_id", "kind", "platform_domain", "paths", "languages", "frameworks", "capabilities", "depends_on"], `planning component ${index}`);
  requireIdentifier(component.component_id, `planning component ${index} ID`);
  assert(COMPONENT_KINDS.has(component.kind), `planning component ${index} kind is invalid`);
  requireIdentifier(component.platform_domain, `planning component ${index} platform domain`);
  return {
    component_id: component.component_id,
    kind: component.kind,
    platform_domain: component.platform_domain,
    paths: normalizeProjectPaths(component.paths, `planning component ${index} paths`),
    languages: normalizeIdentifiers(component.languages, `planning component ${index} languages`),
    frameworks: normalizeIdentifiers(component.frameworks, `planning component ${index} frameworks`),
    capabilities: normalizeIdentifiers(component.capabilities, `planning component ${index} capabilities`),
    depends_on: normalizeIdentifiers(component.depends_on, `planning component ${index} dependencies`),
  };
}

function normalizeFeature(feature, index) {
  exactKeys(feature, ["feature_id", "priority", "outcome", "component_ids", "workflow_tags", "risk_tags", "acceptance_ids"], `planning feature ${index}`);
  requireIdentifier(feature.feature_id, `planning feature ${index} ID`);
  assert(Number.isSafeInteger(feature.priority) && feature.priority >= 1 && feature.priority <= 100, `planning feature ${index} priority is invalid`);
  requireString(feature.outcome, `planning feature ${index} outcome`);
  return {
    feature_id: feature.feature_id,
    priority: feature.priority,
    outcome: feature.outcome.trim(),
    component_ids: normalizeIdentifiers(feature.component_ids, `planning feature ${index} components`, {allowEmpty: false}),
    workflow_tags: normalizeIdentifiers(feature.workflow_tags, `planning feature ${index} workflow tags`),
    risk_tags: normalizeIdentifiers(feature.risk_tags, `planning feature ${index} risk tags`),
    acceptance_ids: normalizeIdentifiers(feature.acceptance_ids, `planning feature ${index} acceptance IDs`, {allowEmpty: false}),
  };
}

function normalizeEnvironment(environment, index) {
  exactKeys(environment, ["environment_id", "kind", "provider_ids", "capabilities", "protected"], `planning environment ${index}`);
  requireIdentifier(environment.environment_id, `planning environment ${index} ID`);
  assert(ENVIRONMENT_KINDS.has(environment.kind), `planning environment ${index} kind is invalid`);
  assert(typeof environment.protected === "boolean", `planning environment ${index} protected flag is invalid`);
  return {
    environment_id: environment.environment_id,
    kind: environment.kind,
    provider_ids: normalizeIdentifiers(environment.provider_ids, `planning environment ${index} providers`),
    capabilities: normalizeIdentifiers(environment.capabilities, `planning environment ${index} capabilities`),
    protected: environment.protected,
  };
}

function normalizeHardware(hardware) {
  exactKeys(hardware, ["logical_cpu_count", "memory_mib", "disk_free_mib", "gpu_class", "network_mode"], "planning hardware");
  for (const field of ["logical_cpu_count", "memory_mib", "disk_free_mib"]) assert(Number.isSafeInteger(hardware[field]) && hardware[field] >= 0, `planning hardware ${field} is invalid`);
  assert(hardware.logical_cpu_count >= 1, "planning hardware must report at least one logical CPU");
  assert(GPU_CLASSES.has(hardware.gpu_class), "planning hardware GPU class is invalid");
  assert(NETWORK_MODES.has(hardware.network_mode), "planning hardware network mode is invalid");
  return structuredClone(hardware);
}

function normalizeStandard(standard, index) {
  exactKeys(standard, ["standard_id", "status", "source_lock_sha256"], `planning standard ${index}`);
  requireIdentifier(standard.standard_id, `planning standard ${index} ID`);
  assert(STANDARD_STATUSES.has(standard.status), `planning standard ${index} status is invalid`);
  if (standard.source_lock_sha256 !== null) requireSha(standard.source_lock_sha256, `planning standard ${index} source lock`);
  if (standard.status === "REQUIRED") assert(standard.source_lock_sha256 !== null, `required planning standard ${standard.standard_id} lacks a source lock`);
  return structuredClone(standard);
}

function contextBody(context) {
  const body = structuredClone(context);
  body.context_sha256 = null;
  return body;
}

export function compileControllerImportPlanningContext({
  projectContractSha256,
  goals,
  architecture,
  features,
  environments,
  hardware,
  standards = [],
  unknowns = [],
} = {}) {
  requireSha(projectContractSha256, "planning context project contract");
  assert(Array.isArray(goals) && goals.length > 0, "planning context goals are required");
  assert(Array.isArray(architecture) && architecture.length > 0, "planning context architecture is required");
  assert(Array.isArray(features) && features.length > 0, "planning context feature inventory is required");
  assert(Array.isArray(environments) && environments.length > 0, "planning context environments are required");
  const context = {
    schema: CONTROLLER_IMPORT_CONTEXT_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status: "SOURCE_BOUND_READY",
    project_contract_sha256: projectContractSha256,
    goals: goals.map(normalizeGoal).sort((left, right) => right.priority - left.priority || compareUtf8(left.goal_id, right.goal_id)),
    architecture: architecture.map(normalizeComponent).sort((left, right) => compareUtf8(left.component_id, right.component_id)),
    features: features.map(normalizeFeature).sort((left, right) => right.priority - left.priority || compareUtf8(left.feature_id, right.feature_id)),
    environments: environments.map(normalizeEnvironment).sort((left, right) => compareUtf8(left.environment_id, right.environment_id)),
    hardware: normalizeHardware(hardware),
    standards: standards.map(normalizeStandard).sort((left, right) => compareUtf8(left.standard_id, right.standard_id)),
    unknowns: normalizeIdentifiers(unknowns, "planning context unknowns"),
    context_sha256: null,
  };
  context.context_sha256 = canonicalDigest(contextBody(context));
  return validateControllerImportPlanningContext(context);
}

export function validateControllerImportPlanningContext(context) {
  exactKeys(context, ["schema", "version", "status", "project_contract_sha256", "goals", "architecture", "features", "environments", "hardware", "standards", "unknowns", "context_sha256"], "Controller import planning context");
  assert(context.schema === CONTROLLER_IMPORT_CONTEXT_SCHEMA && context.version === CONTROLLER_IMPORT_PLANNER_VERSION, "Controller import planning context identity is invalid");
  assert(context.status === "SOURCE_BOUND_READY", "Controller import planning context is not ready");
  requireSha(context.project_contract_sha256, "Controller import planning context project contract");
  const normalized = {
    schema: CONTROLLER_IMPORT_CONTEXT_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status: "SOURCE_BOUND_READY",
    project_contract_sha256: context.project_contract_sha256,
    goals: context.goals.map(normalizeGoal).sort((left, right) => right.priority - left.priority || compareUtf8(left.goal_id, right.goal_id)),
    architecture: context.architecture.map(normalizeComponent).sort((left, right) => compareUtf8(left.component_id, right.component_id)),
    features: context.features.map(normalizeFeature).sort((left, right) => right.priority - left.priority || compareUtf8(left.feature_id, right.feature_id)),
    environments: context.environments.map(normalizeEnvironment).sort((left, right) => compareUtf8(left.environment_id, right.environment_id)),
    hardware: normalizeHardware(context.hardware),
    standards: context.standards.map(normalizeStandard).sort((left, right) => compareUtf8(left.standard_id, right.standard_id)),
    unknowns: normalizeIdentifiers(context.unknowns, "planning context unknowns"),
    context_sha256: context.context_sha256,
  };
  assert(normalized.goals.length > 0, "Controller import planning context goals are required");
  requireSha(context.context_sha256, "Controller import planning context digest");
  assert(context.context_sha256 === canonicalDigest(contextBody(context)), "Controller import planning context digest mismatch");
  assert(JSON.stringify(context) === JSON.stringify(normalized), "Controller import planning context is not canonical");
  const componentIds = new Set(context.architecture.map((component) => component.component_id));
  for (const component of context.architecture) assert(component.depends_on.every((dependency) => componentIds.has(dependency) && dependency !== component.component_id), `component ${component.component_id} has an invalid dependency`);
  for (const feature of context.features) assert(feature.component_ids.every((componentId) => componentIds.has(componentId)), `feature ${feature.feature_id} names an unknown component`);
  return context;
}

function detectedSignals(context) {
  const componentKinds = new Set(context.architecture.map((component) => component.kind));
  const languages = new Set(context.architecture.flatMap((component) => component.languages));
  const capabilities = new Set([
    ...context.architecture.flatMap((component) => component.capabilities),
    ...context.environments.flatMap((environment) => environment.capabilities),
    ...context.features.flatMap((feature) => [...feature.workflow_tags, ...feature.risk_tags]),
  ]);
  const providers = new Set(context.environments.flatMap((environment) => environment.provider_ids));
  return {componentKinds, languages, capabilities, providers};
}

function compilePlatforms(context) {
  const grouped = new Map();
  for (const component of context.architecture) {
    const current = grouped.get(component.platform_domain) ?? [];
    current.push(component.component_id);
    grouped.set(component.platform_domain, current);
  }
  return [...grouped.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([platformId, componentIds]) => ({
    platform_id: platformId,
    owner_role_address: `PLATFORM.${platformId}.OWNER`,
    component_ids: componentIds.sort(compareUtf8),
    acceptance_role: "AGENT.INDEPENDENT_AUDITOR",
    integration_authority: "PLATFORM_SCOPED_REVIEW_TEST_AND_TYPED_HANDOFF_ONLY",
  }));
}

function requestAccumulator() {
  const requests = new Map();
  return {
    add({roleAddress, phase, priority, platformId, subjectRefs = [], routerIds = [], standardIds = [], reasonCodes = []}) {
      requireIdentifier(roleAddress, "Controller role request address");
      assert(PHASE_RANK.has(phase), `Controller role request phase is invalid: ${phase}`);
      requireIdentifier(platformId, "Controller role request platform");
      const current = requests.get(roleAddress);
      const candidate = {
        request_id: `REQUEST.${roleAddress}`,
        role_address: roleAddress,
        phase,
        priority,
        applicability: "REQUIRED",
        platform_id: platformId,
        subject_refs: [...new Set(subjectRefs)].sort(compareUtf8),
        required_router_ids: [...new Set(routerIds)].sort(compareUtf8),
        required_standard_ids: [...new Set(standardIds)].sort(compareUtf8),
        reason_codes: [...new Set(reasonCodes)].sort(compareUtf8),
      };
      if (current === undefined) requests.set(roleAddress, candidate);
      else {
        current.priority = Math.max(current.priority, priority);
        if (PHASE_RANK.get(phase) < PHASE_RANK.get(current.phase)) current.phase = phase;
        current.subject_refs = [...new Set([...current.subject_refs, ...candidate.subject_refs])].sort(compareUtf8);
        current.required_router_ids = [...new Set([...current.required_router_ids, ...candidate.required_router_ids])].sort(compareUtf8);
        current.required_standard_ids = [...new Set([...current.required_standard_ids, ...candidate.required_standard_ids])].sort(compareUtf8);
        current.reason_codes = [...new Set([...current.reason_codes, ...candidate.reason_codes])].sort(compareUtf8);
      }
    },
    values() {
      return [...requests.values()].sort((left, right) => PHASE_RANK.get(left.phase) - PHASE_RANK.get(right.phase) || right.priority - left.priority || compareUtf8(left.role_address, right.role_address));
    },
  };
}

function deriveRoleRequests(context, platforms) {
  const accumulator = requestAccumulator();
  const controlPlatform = "CONTROL";
  for (const roleAddress of [
    "AGENT.ARCHITECTURE_DISCOVERY",
    "AGENT.ENVIRONMENT_DISCOVERY",
    "AGENT.FEATURE_INVENTORY",
    "AGENT.IMPORT_SOURCE_CUSTODY",
    "AGENT.INDEPENDENT_BASELINE_AUDITOR",
    "AGENT.SPECIALIST_APPLICABILITY",
  ]) accumulator.add({roleAddress, phase: "FOUNDATION", priority: 100, platformId: controlPlatform, reasonCodes: ["IMPORT_FOUNDATION_REQUIRED"]});

  for (const platform of platforms) accumulator.add({roleAddress: platform.owner_role_address, phase: "FOUNDATION", priority: 95, platformId: platform.platform_id, subjectRefs: platform.component_ids, reasonCodes: ["DISCOVERED_PLATFORM_DOMAIN"]});

  const componentById = new Map(context.architecture.map((component) => [component.component_id, component]));
  for (const feature of context.features) {
    const components = feature.component_ids.map((componentId) => componentById.get(componentId));
    const platformIds = [...new Set(components.map((component) => component.platform_domain))].sort(compareUtf8);
    const primaryPlatform = platformIds[0];
    accumulator.add({roleAddress: `FEATURE.${feature.feature_id}.FUNCTIONALITY`, phase: "FUNCTIONALITY", priority: feature.priority, platformId: primaryPlatform, subjectRefs: [feature.feature_id, ...feature.component_ids, ...feature.acceptance_ids], reasonCodes: ["OWNER_GOAL_AND_FEATURE_OUTCOME"]});
    if (components.some((component) => component.kind === "CLIENT")) {
      accumulator.add({roleAddress: `FEATURE.${feature.feature_id}.UX_NAVIGATION`, phase: "EXPERIENCE", priority: feature.priority, platformId: primaryPlatform, subjectRefs: [feature.feature_id, ...feature.component_ids], routerIds: ["ARCH.PRODUCT_CLIENT_ROUTER"], reasonCodes: ["CLIENT_WORKFLOW_PRESENT"]});
      accumulator.add({roleAddress: `FEATURE.${feature.feature_id}.ACCESSIBILITY`, phase: "EXPERIENCE", priority: feature.priority, platformId: primaryPlatform, subjectRefs: [feature.feature_id, ...feature.component_ids], routerIds: ["ARCH.PRODUCT_CLIENT_ROUTER"], reasonCodes: ["CLIENT_ACCESSIBILITY_REQUIRED"]});
    }
  }

  for (const component of context.architecture) {
    accumulator.add({roleAddress: `ARCH.${component.component_id}.BOUNDARY`, phase: "ARCHITECTURE", priority: 80, platformId: component.platform_domain, subjectRefs: [component.component_id, ...component.paths, ...component.depends_on], routerIds: component.languages.length > 0 ? ["ENG.LANGUAGE_RUNTIME_ROUTER"] : [], reasonCodes: ["COMPONENT_BOUNDARY_DISCOVERED"]});
    if (component.kind === "DATA") {
      accumulator.add({roleAddress: `DATA.${component.component_id}.INTEGRITY`, phase: "DATA_INTEGRITY", priority: 90, platformId: component.platform_domain, subjectRefs: [component.component_id, ...component.paths], routerIds: ["DATA.DATA_ROUTER"], reasonCodes: ["PERSISTENT_DATA_COMPONENT"]});
      accumulator.add({roleAddress: `DATA.${component.component_id}.MIGRATION`, phase: "DATA_INTEGRITY", priority: 85, platformId: component.platform_domain, subjectRefs: [component.component_id], routerIds: ["DATA.DATA_ROUTER"], reasonCodes: ["DATA_MIGRATION_BOUNDARY"]});
    }
  }

  const {componentKinds, languages, capabilities, providers} = detectedSignals(context);
  const allPlatform = platforms[0]?.platform_id ?? controlPlatform;
  if (languages.size > 0) accumulator.add({roleAddress: "ENG.LANGUAGE_RUNTIME_ROUTER", phase: "ARCHITECTURE", priority: 85, platformId: allPlatform, subjectRefs: [...languages], reasonCodes: ["LANGUAGE_RUNTIME_DISCOVERED"]});
  if (componentKinds.has("CLIENT")) {
    accumulator.add({roleAddress: "ARCH.PRODUCT_CLIENT_ROUTER", phase: "EXPERIENCE", priority: 85, platformId: allPlatform, reasonCodes: ["CLIENT_COMPONENT_DISCOVERED"]});
    accumulator.add({roleAddress: "SEC.OWASP_WEB_TOP10", phase: "SECURITY_PRIVACY", priority: 90, platformId: allPlatform, reasonCodes: ["WEB_OR_CLIENT_ATTACK_SURFACE"]});
    accumulator.add({roleAddress: "SEC.OWASP_ASVS", phase: "SECURITY_PRIVACY", priority: 90, platformId: allPlatform, reasonCodes: ["APPLICATION_SECURITY_VERIFICATION_REQUIRED"]});
  }
  if (componentKinds.has("API")) accumulator.add({roleAddress: "SEC.OWASP_API_TOP10", phase: "SECURITY_PRIVACY", priority: 95, platformId: allPlatform, reasonCodes: ["API_ATTACK_SURFACE"]});
  if (componentKinds.has("DATA") || componentKinds.has("IDENTITY")) {
    accumulator.add({roleAddress: "DATA.DATA_ROUTER", phase: "DATA_INTEGRITY", priority: 95, platformId: allPlatform, reasonCodes: ["DATA_OR_IDENTITY_COMPONENT"]});
    accumulator.add({roleAddress: "SEC.TENANT_ACCESS_CONTROL", phase: "SECURITY_PRIVACY", priority: 100, platformId: allPlatform, reasonCodes: ["DATA_OR_IDENTITY_BOUNDARY"]});
    accumulator.add({roleAddress: "PRIVACY.DATA_LIFECYCLE", phase: "SECURITY_PRIVACY", priority: 90, platformId: allPlatform, reasonCodes: ["PERSISTENT_DATA_PRESENT"]});
  }
  if (componentKinds.has("AI_SEARCH")) accumulator.add({roleAddress: "AI.SEARCH_ROUTER", phase: "FUNCTIONALITY", priority: 85, platformId: allPlatform, reasonCodes: ["AI_OR_SEARCH_COMPONENT"]});
  if (componentKinds.has("GRAPHICS_3D")) accumulator.add({roleAddress: "GRAPHICS.INDUSTRIAL_3D_ROUTER", phase: "FUNCTIONALITY", priority: 85, platformId: allPlatform, reasonCodes: ["THREE_DIMENSIONAL_COMPONENT"]});
  if (componentKinds.has("DOMAIN")) accumulator.add({roleAddress: "DOMAIN.WORKFLOW_ROUTER", phase: "FUNCTIONALITY", priority: 90, platformId: allPlatform, reasonCodes: ["DOMAIN_WORKFLOW_COMPONENT"]});
  if (componentKinds.has("RUNTIME") || context.environments.some((environment) => environment.kind !== "LOCAL")) accumulator.add({roleAddress: "INTERNAL.SRE_OBSERVABILITY_ROUTER", phase: "OPERATIONS_RELIABILITY", priority: 85, platformId: allPlatform, reasonCodes: ["RUNTIME_OR_DEPLOYED_ENVIRONMENT"]});
  if (providers.size > 0) accumulator.add({roleAddress: "PLATFORM.PROVIDER_EDGE_ROUTER", phase: "OPERATIONS_RELIABILITY", priority: 85, platformId: allPlatform, subjectRefs: [...providers], reasonCodes: ["EXTERNAL_PROVIDER_DISCOVERED"]});
  accumulator.add({roleAddress: "SEC.SECURITY_ROUTER", phase: "SECURITY_PRIVACY", priority: 100, platformId: allPlatform, reasonCodes: ["IMPORT_SECURITY_APPLICABILITY_REQUIRED"]});
  accumulator.add({roleAddress: "SEC.SECRETS_CRYPTO_SUPPLY_CHAIN", phase: "SECURITY_PRIVACY", priority: 90, platformId: allPlatform, subjectRefs: [...capabilities], reasonCodes: ["DEPENDENCY_AND_PROVENANCE_SURFACE"]});

  for (const roleAddress of ["QUALITY.MODULARITY", "QUALITY.DUPLICATION", "QUALITY.TYPES_CONTRACTS", "QUALITY.CONCURRENCY_STATE", "QUALITY.TESTABILITY", "QUALITY.PERFORMANCE_RESOURCES"]) accumulator.add({roleAddress, phase: "ARCHITECTURE", priority: 70, platformId: allPlatform, reasonCodes: ["STRUCTURAL_QUALITY_REQUIRED"]});
  for (const roleAddress of ["HYGIENE.READABILITY_NAMING", "HYGIENE.DOCUMENTATION", "HYGIENE.DEAD_CODE", "HYGIENE.FORMAT_LINT", "HYGIENE.COMMIT_VERSIONING", "HYGIENE.LICENSE_SBOM_PROVENANCE"]) accumulator.add({roleAddress, phase: "HYGIENE_PROVENANCE", priority: 60, platformId: allPlatform, reasonCodes: ["RELEASE_HYGIENE_REQUIRED"]});

  for (const standard of context.standards.filter((entry) => entry.status === "REQUIRED")) accumulator.add({roleAddress: `STANDARD.${standard.standard_id}.ASSURANCE`, phase: "STANDARDS_ASSURANCE", priority: 80, platformId: allPlatform, standardIds: [standard.standard_id], reasonCodes: ["REQUIRED_STANDARD_APPLICABILITY"]});

  for (const roleAddress of ["AGENT.CENTRAL_INTEGRATOR", "AGENT.INDEPENDENT_RELEASE_AUDITOR", "AGENT.RELEASE_MANAGER"]) accumulator.add({roleAddress, phase: "FINAL_INTEGRATION", priority: 100, platformId: controlPlatform, reasonCodes: ["TERMINAL_INTEGRATION_AND_ACCEPTANCE"]});
  return accumulator.values();
}

function compileResourcePlan(hardware) {
  const constrainedMemory = hardware.memory_mib <= 16 * 1024;
  const constrainedDisk = hardware.disk_free_mib < 20 * 1024;
  return {
    max_parallel_cognitive_lanes: CONTROLLER_IMPORT_MAX_COGNITIVE_LANES,
    max_parallel_heavyweight_jobs: constrainedMemory || constrainedDisk ? 1 : 2,
    max_rust_heavyweight_jobs: constrainedMemory ? 1 : 2,
    max_node_or_render_heavyweight_jobs: constrainedMemory ? 1 : 2,
    cargo_build_jobs: constrainedMemory ? 1 : Math.min(2, hardware.logical_cpu_count),
    freeze_new_heavyweight_admissions_on_pressure: true,
    require_scheduler_job_process_provenance: true,
    network_mode: hardware.network_mode,
    disk_pressure_threshold_mib: Math.max(4096, Math.min(20480, Math.floor(hardware.disk_free_mib / 4))),
  };
}

function compileWaves(roleRequests, maxLanes) {
  const waves = [];
  let sequence = 1;
  for (const phase of CONTROLLER_IMPORT_PHASES) {
    const phaseRequests = roleRequests.filter((request) => request.phase === phase);
    for (let offset = 0; offset < phaseRequests.length; offset += maxLanes) {
      const batch = phaseRequests.slice(offset, offset + maxLanes);
      waves.push({
        wave_id: `WAVE.${String(sequence).padStart(3, "0")}.${phase}`,
        sequence,
        phase,
        role_request_ids: batch.map((request) => request.request_id).sort(compareUtf8),
        entry_gate: sequence === 1 ? "PRESERVATION_AND_SOURCE_BINDING_PASS" : "PRIOR_WAVE_INDEPENDENT_REAUDIT_PASS",
        specialist_cycle: "AUDIT_THEN_REPAIR_CANDIDATE_IN_ISOLATED_WORKTREE",
        platform_cycle: "INDEPENDENT_PLATFORM_REVIEW_TEST_AND_INTEGRATION",
        central_cycle: "CENTRAL_INTEGRATOR_CONSUMES_ONLY_ACCEPTED_PLATFORM_HANDOFFS",
        exit_gate: "ALL_FINDINGS_DISPOSITIONED;_NO_OPEN_CATASTROPHIC_FINDING;_PLATFORM_INTEGRATION_PASS;_INDEPENDENT_REAUDIT_PASS",
      });
      sequence += 1;
    }
  }
  return waves;
}

function validateRoleRequest(request, platformIds) {
  exactKeys(request, ["request_id", "role_address", "phase", "priority", "applicability", "platform_id", "subject_refs", "required_router_ids", "required_standard_ids", "reason_codes"], "Controller role request");
  requireIdentifier(request.request_id, "Controller role request ID");
  requireIdentifier(request.role_address, "Controller role request address");
  assert(PHASE_RANK.has(request.phase), "Controller role request phase is invalid");
  assert(Number.isSafeInteger(request.priority) && request.priority >= 1 && request.priority <= 100, "Controller role request priority is invalid");
  assert(request.applicability === "REQUIRED", "Controller role request applicability is invalid");
  requireIdentifier(request.platform_id, "Controller role request platform");
  assert(platformIds.has(request.platform_id) || request.platform_id === "CONTROL", "Controller role request platform is unknown");
  sortedUnique(request.subject_refs, "Controller role request subjects", {allowEmpty: true, validator: requireString});
  sortedUnique(request.required_router_ids, "Controller role request routers", {allowEmpty: true});
  sortedUnique(request.required_standard_ids, "Controller role request standards", {allowEmpty: true});
  sortedUnique(request.reason_codes, "Controller role request reasons", {allowEmpty: false});
}

function planBody(plan) {
  const body = structuredClone(plan);
  body.plan_sha256 = null;
  return body;
}

export function compileControllerImportCampaignPlan({projectId, projectImportPlan, planningContext} = {}) {
  requireIdentifier(projectId, "Controller import project ID");
  assert(isRecord(projectImportPlan), "Controller import project plan is required");
  requireSha(projectImportPlan.plan_sha256, "Controller import project plan digest");
  assert(["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(projectImportPlan.mode), "Controller dynamic pyramid requires a full-audit import mode");
  assert(projectImportPlan.source_identity && isRecord(projectImportPlan.source_identity), "Controller import source identity is required");
  if (projectImportPlan.source_identity.source_commit !== null) assert(GIT_OBJECT.test(projectImportPlan.source_identity.source_commit), "Controller import source commit is invalid");
  if (projectImportPlan.source_identity.source_tree !== null) assert(GIT_OBJECT.test(projectImportPlan.source_identity.source_tree), "Controller import source tree is invalid");
  requireSha(projectImportPlan.source_identity.source_content_sha256, "Controller import source content");
  requireSha(projectImportPlan.source_identity.source_observation_sha256, "Controller import source observation");
  validateControllerImportPlanningContext(planningContext);
  const platforms = compilePlatforms(planningContext);
  const roleRequests = deriveRoleRequests(planningContext, platforms);
  const resourcePlan = compileResourcePlan(planningContext.hardware);
  const waves = compileWaves(roleRequests, resourcePlan.max_parallel_cognitive_lanes);
  const plan = {
    schema: CONTROLLER_IMPORT_PLAN_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status: "CONTROLLER_GENERATED_READY_FOR_SPAWNER_QA",
    project_id: projectId,
    planning_authority: "AGENTOS_CONTROLLER",
    project_import_plan_sha256: projectImportPlan.plan_sha256,
    project_contract_sha256: planningContext.project_contract_sha256,
    planning_context_sha256: planningContext.context_sha256,
    source_identity: {
      source_commit: projectImportPlan.source_identity.source_commit,
      source_tree: projectImportPlan.source_identity.source_tree,
      source_content_sha256: projectImportPlan.source_identity.source_content_sha256,
      source_observation_sha256: projectImportPlan.source_identity.source_observation_sha256,
    },
    platforms,
    role_requests: roleRequests,
    waves,
    resource_plan: resourcePlan,
    spawner_contract: {
      role: "AGENT.SPAWNER_COMPILER",
      selection_rule: "SMALLEST_DEPENDENCY_COMPLETE_PROJECT_APPLICABLE_BLOCK_SET",
      incomplete_block_behavior: "RETURN_NOT_READY;_BUILD_SOURCE_LOCK_AND_QA_MISSING_BLOCKS;_NEVER_SPAWN_INCOMPLETE_SEED_OR_AGENT",
      seed_rule: "SEED_IS_IMMUTABLE_AND_NEVER_WORKS;_ONLY_A_GOVERNED_CLONE_MAY_WORK",
      background_rule: "PREPARE_AND_INDEPENDENTLY_EVALUATE_THE_NEXT_TWO_WAVES_WHILE_CURRENT_WAVE_RUNS",
      invalidation_rule: "GOVERNING_BLOCK_CHANGE_INVALIDATES_AND_REBUILDS_EVERY_DEPENDENT_SEED",
      incremental_library_rule: "BUILD_MISSING_BLOCKS_AND_PUBLISH_TYPED_ROSTER_PROJECTIONS_AS_ROUTES_BECOME_READY",
      roster_projection_contract: "schemas/controller-import-roster-projection.v1.json",
      controller_consumes_only_typed_roster_projection: true,
      independent_evaluation_required: true,
    },
    continuation: {
      mode: "EVENT_DRIVEN_AUTOMATIC",
      routine_gate_pass: "START_NEXT_ELIGIBLE_TRANSITION_BEFORE_ENDING_THE_CONTROLLER_TURN",
      no_progress: "INSPECT_EXACT_BLOCKER;_RUN_ONE_BOUNDED_RECOVERY;_VERIFY_RESULT;_CONTINUE_UNAFFECTED_WORK",
      replan_triggers: ["ACCEPTED_FINDING", "ARCHITECTURE_CHANGE", "BLOCK_LIBRARY_CHANGE", "ENVIRONMENT_CHANGE", "FEATURE_INVENTORY_CHANGE", "HARDWARE_PRESSURE_CHANGE", "OWNER_INTENT_OR_SCOPE_CHANGE", "SOURCE_IDENTITY_CHANGE"],
      owner_only_boundaries: ["CREDENTIAL_OR_PROTECTED_HUMAN_INTERACTION", "DESTRUCTIVE_USER_WORK_RISK", "IRREVERSIBLE_OR_PUBLIC_RELEASE", "MATERIAL_UNEXPECTED_COST_LEGAL_OR_SAFETY_RISK", "PRODUCTION_PROMOTION", "ROUTE_CHANGING_EQUAL_AUTHORITY_CONFLICT"],
      routine_owner_review_forbidden: true,
    },
    acceptance: {
      cycle: "SPECIALIST_AUDIT_REPAIR_THEN_PLATFORM_REVIEW_TEST_INTEGRATE_THEN_CENTRAL_INTEGRATION_THEN_INDEPENDENT_REAUDIT",
      self_acceptance_forbidden: true,
      platform_review_after_every_wave: true,
      central_integration_after_every_wave: true,
      independent_reaudit_after_every_wave: true,
      final_development_proof_required: true,
      production_promotion_owner_only: true,
    },
    zero_trace: {
      control_plane_external_to_product: true,
      agentos_artifacts_forbidden_in_product: true,
      source_roots_unchanged_until_accepted_cutover: true,
    },
    plan_sha256: null,
  };
  plan.plan_sha256 = canonicalDigest(planBody(plan));
  return validateControllerImportCampaignPlan(plan);
}

export function validateControllerImportCampaignPlan(plan) {
  exactKeys(plan, ["schema", "version", "status", "project_id", "planning_authority", "project_import_plan_sha256", "project_contract_sha256", "planning_context_sha256", "source_identity", "platforms", "role_requests", "waves", "resource_plan", "spawner_contract", "continuation", "acceptance", "zero_trace", "plan_sha256"], "Controller import campaign plan");
  assert(plan.schema === CONTROLLER_IMPORT_PLAN_SCHEMA && plan.version === CONTROLLER_IMPORT_PLANNER_VERSION, "Controller import campaign plan identity is invalid");
  assert(plan.status === "CONTROLLER_GENERATED_READY_FOR_SPAWNER_QA" && plan.planning_authority === "AGENTOS_CONTROLLER", "Controller import campaign plan authority is invalid");
  requireIdentifier(plan.project_id, "Controller import campaign project ID");
  for (const field of ["project_import_plan_sha256", "project_contract_sha256", "planning_context_sha256", "plan_sha256"]) requireSha(plan[field], `Controller import campaign ${field}`);
  exactKeys(plan.source_identity, ["source_commit", "source_tree", "source_content_sha256", "source_observation_sha256"], "Controller import campaign source identity");
  for (const field of ["source_content_sha256", "source_observation_sha256"]) requireSha(plan.source_identity[field], `Controller import campaign source ${field}`);
  for (const field of ["source_commit", "source_tree"]) assert(plan.source_identity[field] === null || GIT_OBJECT.test(plan.source_identity[field]), `Controller import campaign source ${field} is invalid`);
  assert(Array.isArray(plan.platforms) && plan.platforms.length > 0, "Controller import campaign platforms are required");
  const platformIds = new Set();
  for (const platform of plan.platforms) {
    exactKeys(platform, ["platform_id", "owner_role_address", "component_ids", "acceptance_role", "integration_authority"], "Controller import platform");
    requireIdentifier(platform.platform_id, "Controller import platform ID");
    assert(!platformIds.has(platform.platform_id), "Controller import platform is duplicated");
    platformIds.add(platform.platform_id);
    requireIdentifier(platform.owner_role_address, "Controller import platform owner");
    sortedUnique(platform.component_ids, "Controller import platform components");
    assert(platform.acceptance_role === "AGENT.INDEPENDENT_AUDITOR", "Controller import platform acceptance role is invalid");
    assert(platform.integration_authority === "PLATFORM_SCOPED_REVIEW_TEST_AND_TYPED_HANDOFF_ONLY", "Controller import platform authority is excessive");
  }
  assert(Array.isArray(plan.role_requests) && plan.role_requests.length > 0, "Controller import campaign roster is required");
  plan.role_requests.forEach((request) => validateRoleRequest(request, platformIds));
  assert(new Set(plan.role_requests.map((request) => request.request_id)).size === plan.role_requests.length, "Controller import role requests are duplicated");
  const requestIds = new Set(plan.role_requests.map((request) => request.request_id));
  assert(Array.isArray(plan.waves) && plan.waves.length > 0, "Controller import campaign waves are required");
  const covered = [];
  plan.waves.forEach((wave, index) => {
    exactKeys(wave, ["wave_id", "sequence", "phase", "role_request_ids", "entry_gate", "specialist_cycle", "platform_cycle", "central_cycle", "exit_gate"], `Controller import wave ${index}`);
    requireIdentifier(wave.wave_id, `Controller import wave ${index} ID`);
    assert(wave.sequence === index + 1 && PHASE_RANK.has(wave.phase), `Controller import wave ${index} order is invalid`);
    sortedUnique(wave.role_request_ids, `Controller import wave ${index} role requests`);
    assert(wave.role_request_ids.length <= CONTROLLER_IMPORT_MAX_COGNITIVE_LANES, `Controller import wave ${index} exceeds six lanes`);
    assert(wave.role_request_ids.every((requestId) => requestIds.has(requestId)), `Controller import wave ${index} names an unknown role request`);
    covered.push(...wave.role_request_ids);
    assert(wave.platform_cycle.includes("PLATFORM_REVIEW_TEST_AND_INTEGRATION"), `Controller import wave ${index} lacks Platform integration`);
    assert(wave.central_cycle.includes("ACCEPTED_PLATFORM_HANDOFFS"), `Controller import wave ${index} lacks central integration`);
    assert(wave.exit_gate.includes("INDEPENDENT_REAUDIT_PASS"), `Controller import wave ${index} lacks independent re-audit`);
  });
  assert(covered.length === requestIds.size && new Set(covered).size === requestIds.size, "Controller import waves do not cover the roster exactly once");
  exactKeys(plan.resource_plan, ["max_parallel_cognitive_lanes", "max_parallel_heavyweight_jobs", "max_rust_heavyweight_jobs", "max_node_or_render_heavyweight_jobs", "cargo_build_jobs", "freeze_new_heavyweight_admissions_on_pressure", "require_scheduler_job_process_provenance", "network_mode", "disk_pressure_threshold_mib"], "Controller import resource plan");
  assert(plan.resource_plan.max_parallel_cognitive_lanes === CONTROLLER_IMPORT_MAX_COGNITIVE_LANES, "Controller import cognitive lane ceiling is invalid");
  assert(plan.resource_plan.freeze_new_heavyweight_admissions_on_pressure === true && plan.resource_plan.require_scheduler_job_process_provenance === true, "Controller import resource safety is weakened");
  assert(plan.spawner_contract.role === "AGENT.SPAWNER_COMPILER" && plan.spawner_contract.incomplete_block_behavior.includes("NEVER_SPAWN_INCOMPLETE"), "Controller import Spawner contract is incomplete");
  assert(plan.spawner_contract.seed_rule.includes("SEED_IS_IMMUTABLE_AND_NEVER_WORKS") && plan.spawner_contract.independent_evaluation_required === true, "Controller import seed QA is weakened");
  assert(plan.spawner_contract.incremental_library_rule === "BUILD_MISSING_BLOCKS_AND_PUBLISH_TYPED_ROSTER_PROJECTIONS_AS_ROUTES_BECOME_READY" && plan.spawner_contract.roster_projection_contract === "schemas/controller-import-roster-projection.v1.json" && plan.spawner_contract.controller_consumes_only_typed_roster_projection === true, "Controller import incremental Spawner contract is incomplete");
  assert(plan.continuation.mode === "EVENT_DRIVEN_AUTOMATIC" && plan.continuation.routine_owner_review_forbidden === true, "Controller import routine continuation is not automatic");
  assert(plan.continuation.routine_gate_pass.includes("START_NEXT_ELIGIBLE_TRANSITION"), "Controller import may end a turn without starting eligible work");
  assert(plan.acceptance.platform_review_after_every_wave === true && plan.acceptance.central_integration_after_every_wave === true && plan.acceptance.independent_reaudit_after_every_wave === true && plan.acceptance.self_acceptance_forbidden === true, "Controller import pyramid acceptance is incomplete");
  assert(plan.zero_trace.control_plane_external_to_product === true && plan.zero_trace.agentos_artifacts_forbidden_in_product === true && plan.zero_trace.source_roots_unchanged_until_accepted_cutover === true, "Controller import zero-trace boundary is weakened");
  assert(plan.plan_sha256 === canonicalDigest(planBody(plan)), "Controller import campaign plan digest mismatch");
  return plan;
}

function rosterProjectionBody(projection) {
  const body = structuredClone(projection);
  body.projection_sha256 = null;
  return body;
}

function expectedRosterNextAction(projection) {
  if (projection.available_wave_ids.length > 0) return CONTROLLER_IMPORT_NEXT_ACTIONS.START_AVAILABLE_WAVE;
  if (projection.pending_role_request_ids.length > 0) return CONTROLLER_IMPORT_NEXT_ACTIONS.START_PENDING_BLOCK_REPAIR;
  if (projection.activation_blocked_wave_ids.length > 0) return CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION;
  return CONTROLLER_IMPORT_NEXT_ACTIONS.PREPARE_REVIEW;
}

function validateQaRecord(record, requestIds) {
  exactKeys(record, ["request_id", "status", "block_set_sha256", "independent_evaluation_sha256"], "Controller import Spawner QA record");
  requireIdentifier(record.request_id, "Controller import Spawner QA request");
  assert(requestIds.has(record.request_id), `Controller import Spawner QA names an unknown request: ${record.request_id}`);
  assert(QA_STATUSES.has(record.status), "Controller import Spawner QA status is invalid");
  for (const field of ["block_set_sha256", "independent_evaluation_sha256"]) {
    if (record.status === "READY") requireSha(record[field], `Controller import ready QA ${field}`);
    else assert(record[field] === null, `Controller import non-ready QA ${field} must be null`);
  }
}

export function validateControllerImportRosterProjection(projection, {plan = null} = {}) {
  exactKeys(projection, ["schema", "version", "status", "campaign_plan_sha256", "source", "available_role_request_ids", "pending_role_request_ids", "blocked_role_request_ids", "available_wave_ids", "activation_blocked_wave_ids", "completed_wave_ids", "active_wave_ids", "wave_activation_allowed", "next_action", "controller_decision_inputs", "incomplete_never_admitted", "projection_sha256"], "Controller import roster projection");
  assert(projection.schema === CONTROLLER_IMPORT_ROSTER_SCHEMA && projection.version === CONTROLLER_IMPORT_PLANNER_VERSION, "Controller import roster projection identity is invalid");
  assert(["PARTIAL_READY", "READY_COMPLETE"].includes(projection.status), "Controller import roster projection status is invalid");
  requireSha(projection.campaign_plan_sha256, "Controller import roster campaign plan");
  assert(projection.source === "AGENT.SPAWNER_COMPILER", "Controller import roster source is not Spawner");
  assert(typeof projection.wave_activation_allowed === "boolean", "Controller import roster wave activation eligibility is invalid");
  for (const field of ["available_role_request_ids", "pending_role_request_ids", "blocked_role_request_ids", "available_wave_ids", "activation_blocked_wave_ids", "completed_wave_ids", "active_wave_ids"]) sortedUnique(projection[field], `Controller import roster ${field}`, {allowEmpty: true});
  assert(projection.wave_activation_allowed || projection.available_wave_ids.length === 0, "Controller import roster exposes an activatable wave while activation is held");
  assert(projection.wave_activation_allowed || projection.next_action !== CONTROLLER_IMPORT_NEXT_ACTIONS.START_AVAILABLE_WAVE, "Controller import roster starts a wave while activation is held");
  assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.every((waveId) => !projection.available_wave_ids.includes(waveId)), "Controller import roster overlaps activatable and activation-blocked waves");
  assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.length > 0 || projection.pending_role_request_ids.length > 0 || projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.PREPARE_REVIEW, "Controller import roster loses held wave or local block work");
  assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.length === 0 || projection.next_action !== CONTROLLER_IMPORT_NEXT_ACTIONS.PREPARE_REVIEW, "Controller import roster closes while held wave work remains");
  assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.length === 0 || projection.next_action !== CONTROLLER_IMPORT_NEXT_ACTIONS.START_AVAILABLE_WAVE, "Controller import roster starts held wave work");
  assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.length === 0 || projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.START_PENDING_BLOCK_REPAIR || projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION, "Controller import roster uses an invalid held-wave action");
  exactKeys(projection.controller_decision_inputs, ["available_wave_ids", "activation_blocked_wave_ids", "pending_role_request_ids", "blocked_role_request_ids", "wave_activation_allowed", "replan_required"], "Controller import roster decision inputs");
  assert(JSON.stringify(projection.controller_decision_inputs.available_wave_ids) === JSON.stringify(projection.available_wave_ids), "Controller import roster decision waves are stale");
  assert(JSON.stringify(projection.controller_decision_inputs.activation_blocked_wave_ids) === JSON.stringify(projection.activation_blocked_wave_ids), "Controller import roster activation-blocked waves are stale");
  assert(JSON.stringify(projection.controller_decision_inputs.pending_role_request_ids) === JSON.stringify(projection.pending_role_request_ids), "Controller import roster decision pending routes are stale");
  assert(JSON.stringify(projection.controller_decision_inputs.blocked_role_request_ids) === JSON.stringify(projection.blocked_role_request_ids), "Controller import roster decision blocked routes are stale");
  assert(projection.controller_decision_inputs.wave_activation_allowed === projection.wave_activation_allowed, "Controller import roster activation eligibility is stale");
  assert(projection.controller_decision_inputs.replan_required === (projection.status === "PARTIAL_READY"), "Controller import roster replan signal is invalid");
  requireIdentifier(projection.next_action, "Controller import roster next action");
  assert(projection.next_action === expectedRosterNextAction(projection), "Controller import roster next action must start eligible work immediately");
  assert(projection.incomplete_never_admitted === true, "Controller import roster may admit incomplete work");
  requireSha(projection.projection_sha256, "Controller import roster projection digest");
  assert(projection.projection_sha256 === canonicalDigest(rosterProjectionBody(projection)), "Controller import roster projection digest mismatch");
  if (plan !== null) {
    validateControllerImportCampaignPlan(plan);
    assert(projection.campaign_plan_sha256 === plan.plan_sha256, "Controller import roster is bound to a different campaign plan");
    const requestIds = new Set(plan.role_requests.map((request) => request.request_id));
    const all = new Set([...projection.available_role_request_ids, ...projection.pending_role_request_ids]);
    assert(all.size === requestIds.size && [...all].every((requestId) => requestIds.has(requestId)), "Controller import roster does not cover the plan exactly");
    assert(projection.blocked_role_request_ids.every((requestId) => projection.pending_role_request_ids.includes(requestId)), "Controller import blocked route is not pending");
    const waveIds = new Set(plan.waves.map((wave) => wave.wave_id));
    for (const field of ["available_wave_ids", "activation_blocked_wave_ids", "completed_wave_ids", "active_wave_ids"]) assert(projection[field].every((waveId) => waveIds.has(waveId)), `Controller import roster ${field} names an unknown wave`);
    assert(projection.available_wave_ids.every((waveId) => !projection.completed_wave_ids.includes(waveId) && !projection.active_wave_ids.includes(waveId)), "Controller import roster exposes a completed or active wave as available");
    assert(projection.activation_blocked_wave_ids.every((waveId) => !projection.completed_wave_ids.includes(waveId) && !projection.active_wave_ids.includes(waveId)), "Controller import roster exposes a completed or active wave as activation-blocked");
    assert(projection.wave_activation_allowed || projection.available_wave_ids.length === 0, "Controller import roster exposes a wave while activation is held");
    assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.every((waveId) => !projection.available_wave_ids.includes(waveId)), "Controller import roster overlaps available and activation-blocked waves");
    assert(projection.wave_activation_allowed || projection.activation_blocked_wave_ids.length > 0 || projection.available_wave_ids.length === 0, "Controller import roster lost wave work while activation is held");
  }
  return projection;
}

export function compileControllerImportRosterProjection({plan, qaRecords = [], completedWaveIds = [], activeWaveIds = [], waveActivationAllowed = true} = {}) {
  validateControllerImportCampaignPlan(plan);
  assert(typeof waveActivationAllowed === "boolean", "Controller import wave activation eligibility must be boolean");
  const requestIds = new Set(plan.role_requests.map((request) => request.request_id));
  assert(Array.isArray(qaRecords), "Controller import Spawner QA records must be an array");
  const seen = new Set();
  for (const record of qaRecords) {
    validateQaRecord(record, requestIds);
    assert(!seen.has(record.request_id), `Controller import Spawner QA duplicates request ${record.request_id}`);
    seen.add(record.request_id);
  }
  const ready = [...seen].filter((requestId) => qaRecords.find((record) => record.request_id === requestId)?.status === "READY").sort(compareUtf8);
  const pending = [...requestIds].filter((requestId) => !ready.includes(requestId)).sort(compareUtf8);
  const blocked = qaRecords.filter((record) => ["NOT_READY", "UNKNOWN"].includes(record.status)).map((record) => record.request_id).sort(compareUtf8);
  const completed = [...new Set(completedWaveIds)].sort(compareUtf8);
  const active = [...new Set(activeWaveIds)].sort(compareUtf8);
  const completeWaves = plan.waves.filter((wave) => !completed.includes(wave.wave_id) && !active.includes(wave.wave_id) && wave.role_request_ids.every((requestId) => ready.includes(requestId))).map((wave) => wave.wave_id);
  const availableWaves = waveActivationAllowed ? completeWaves : [];
  const activationBlockedWaves = waveActivationAllowed ? [] : completeWaves;
  const projection = {
    schema: CONTROLLER_IMPORT_ROSTER_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status: pending.length === 0 ? "READY_COMPLETE" : "PARTIAL_READY",
    campaign_plan_sha256: plan.plan_sha256,
    source: "AGENT.SPAWNER_COMPILER",
    available_role_request_ids: ready,
    pending_role_request_ids: pending,
    blocked_role_request_ids: blocked,
    available_wave_ids: availableWaves,
    activation_blocked_wave_ids: activationBlockedWaves,
    completed_wave_ids: completed,
    active_wave_ids: active,
    wave_activation_allowed: waveActivationAllowed,
    next_action: availableWaves.length > 0 ? CONTROLLER_IMPORT_NEXT_ACTIONS.START_AVAILABLE_WAVE : pending.length > 0 ? CONTROLLER_IMPORT_NEXT_ACTIONS.START_PENDING_BLOCK_REPAIR : activationBlockedWaves.length > 0 ? CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION : CONTROLLER_IMPORT_NEXT_ACTIONS.PREPARE_REVIEW,
    controller_decision_inputs: {
      available_wave_ids: availableWaves,
      activation_blocked_wave_ids: activationBlockedWaves,
      pending_role_request_ids: pending,
      blocked_role_request_ids: blocked,
      wave_activation_allowed: waveActivationAllowed,
      replan_required: pending.length > 0,
    },
    incomplete_never_admitted: true,
    projection_sha256: null,
  };
  projection.projection_sha256 = canonicalDigest(rosterProjectionBody(projection));
  return validateControllerImportRosterProjection(projection, {plan});
}

function runStateBody(state) {
  const body = structuredClone(state);
  body.state_sha256 = null;
  return body;
}

function validateRunFindingIds(values, label) {
  return sortedUnique(values, label, {allowEmpty: true});
}

export function validateControllerImportRunState(state, {plan = null} = {}) {
  exactKeys(state, ["schema", "version", "status", "campaign_plan_sha256", "wave_index", "current_wave_id", "next_action", "open_finding_ids", "recovery_attempts", "protected_boundary_id", "transition_sequence", "state_sha256"], "Controller import run state");
  assert(state.schema === CONTROLLER_IMPORT_RUN_STATE_SCHEMA && state.version === CONTROLLER_IMPORT_PLANNER_VERSION, "Controller import run state identity is invalid");
  assert(RUN_STATUSES.has(state.status), "Controller import run status is invalid");
  requireSha(state.campaign_plan_sha256, "Controller import run campaign plan");
  assert(Number.isSafeInteger(state.wave_index) && state.wave_index >= 0, "Controller import run wave index is invalid");
  if (state.current_wave_id !== null) requireIdentifier(state.current_wave_id, "Controller import current wave");
  requireIdentifier(state.next_action, "Controller import next action");
  validateRunFindingIds(state.open_finding_ids, "Controller import open findings");
  assert(Number.isSafeInteger(state.recovery_attempts) && state.recovery_attempts >= 0 && state.recovery_attempts <= 3, "Controller import recovery count is invalid");
  if (state.protected_boundary_id !== null) requireIdentifier(state.protected_boundary_id, "Controller import protected boundary");
  assert(Number.isSafeInteger(state.transition_sequence) && state.transition_sequence >= 0, "Controller import transition sequence is invalid");
  requireSha(state.state_sha256, "Controller import run state digest");
  assert(state.state_sha256 === canonicalDigest(runStateBody(state)), "Controller import run state digest mismatch");
  assert(state.status !== "COMPLETE" || state.next_action === "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW", "Controller import completion action is invalid");
  assert(state.status !== "BLOCKED_PROTECTED" || (state.protected_boundary_id !== null && state.next_action === "WAIT_FOR_EXACT_PROTECTED_BOUNDARY_RESOLUTION"), "Controller import protected boundary is not exact");
  assert(state.status === "BLOCKED_PROTECTED" || state.protected_boundary_id === null, "Controller import retained a stale protected boundary");
  if (plan !== null) {
    validateControllerImportCampaignPlan(plan);
    assert(state.campaign_plan_sha256 === plan.plan_sha256, "Controller import run state is bound to a different campaign plan");
    assert(state.wave_index <= plan.waves.length, "Controller import run state exceeds the campaign waves");
    const expectedWave = state.wave_index < plan.waves.length ? plan.waves[state.wave_index].wave_id : null;
    assert(state.current_wave_id === expectedWave, "Controller import run state is bound to the wrong wave");
  }
  return state;
}

export function compileControllerImportRunState({plan} = {}) {
  validateControllerImportCampaignPlan(plan);
  const state = {
    schema: CONTROLLER_IMPORT_RUN_STATE_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status: "SPAWNER_QA_PENDING",
    campaign_plan_sha256: plan.plan_sha256,
    wave_index: 0,
    current_wave_id: plan.waves[0].wave_id,
    next_action: "REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE",
    open_finding_ids: [],
    recovery_attempts: 0,
    protected_boundary_id: null,
    transition_sequence: 0,
    state_sha256: null,
  };
  state.state_sha256 = canonicalDigest(runStateBody(state));
  return validateControllerImportRunState(state, {plan});
}

function nextRunState(state, patch, plan) {
  const next = {...state, ...patch, transition_sequence: state.transition_sequence + 1, state_sha256: null};
  next.state_sha256 = canonicalDigest(runStateBody(next));
  return validateControllerImportRunState(next, {plan});
}

export function advanceControllerImportRunState({state, plan, event} = {}) {
  validateControllerImportRunState(state, {plan});
  exactKeys(event, ["event_type", "finding_ids", "protected_boundary_id"], "Controller import run event");
  assert(RUN_EVENTS.has(event.event_type), "Controller import run event type is invalid");
  const findingIds = normalizeIdentifiers(event.finding_ids, "Controller import event findings");
  if (event.protected_boundary_id !== null) requireIdentifier(event.protected_boundary_id, "Controller import event protected boundary");
  const withFindings = [...new Set([...state.open_finding_ids, ...findingIds])].sort(compareUtf8);

  if (event.event_type === "PROTECTED_BOUNDARY_REACHED") {
    assert(event.protected_boundary_id !== null, "Controller import protected-boundary event lacks identity");
    assert(findingIds.length === 0 && state.open_finding_ids.length === 0, "protected authority cannot silently disposition engineering findings");
    return nextRunState(state, {status: "BLOCKED_PROTECTED", next_action: "WAIT_FOR_EXACT_PROTECTED_BOUNDARY_RESOLUTION", open_finding_ids: withFindings, protected_boundary_id: event.protected_boundary_id}, plan);
  }
  if (event.event_type === "PROTECTED_BOUNDARY_RESOLVED") {
    assert(state.status === "BLOCKED_PROTECTED" && event.protected_boundary_id === state.protected_boundary_id, "Controller import protected-boundary resolution is stale");
    return nextRunState(state, {status: "SPAWNER_QA_PENDING", next_action: "REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE", protected_boundary_id: null, recovery_attempts: 0}, plan);
  }
  if (event.event_type === "SPAWNER_QA_NOT_READY") {
    assert(state.status === "SPAWNER_QA_PENDING", "Spawner QA failure is out of order");
    return nextRunState(state, {status: "BLOCKED_RECOVERY", next_action: "BUILD_SOURCE_LOCK_AND_QA_MISSING_BLOCKS", open_finding_ids: withFindings, recovery_attempts: state.recovery_attempts + 1}, plan);
  }
  if (event.event_type === "RECOVERY_FAILED") {
    assert(state.status === "BLOCKED_RECOVERY" && state.recovery_attempts < 3, "Controller import recovery failure is exhausted or out of order");
    return nextRunState(state, {next_action: state.recovery_attempts + 1 === 3 ? "RECORD_BLOCKED_EXACT_AND_CONTINUE_UNAFFECTED_WORK" : "RUN_NEXT_BOUNDED_RECOVERY", recovery_attempts: state.recovery_attempts + 1, open_finding_ids: withFindings}, plan);
  }
  if (event.event_type === "BLOCK_QA_REPAIRED") {
    assert(state.status === "BLOCKED_RECOVERY", "block QA recovery is out of order");
    return nextRunState(state, {status: "SPAWNER_QA_PENDING", next_action: "REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE", open_finding_ids: [], recovery_attempts: 0}, plan);
  }
  if (event.event_type === "SPAWNER_QA_PASSED") {
    assert(state.status === "SPAWNER_QA_PENDING", "Spawner QA pass is out of order");
    return nextRunState(state, {status: "SPECIALIST_WAVE_ACTIVE", next_action: "START_CURRENT_SPECIALIST_AUDIT_REPAIR_WAVE", recovery_attempts: 0}, plan);
  }
  if (event.event_type === "SPECIALIST_WAVE_PASSED") {
    assert(state.status === "SPECIALIST_WAVE_ACTIVE", "specialist wave pass is out of order");
    assert(findingIds.length === 0 && state.open_finding_ids.length === 0, "specialist wave cannot pass with open findings");
    return nextRunState(state, {status: "PLATFORM_REVIEW_PENDING", next_action: "START_PLATFORM_REVIEW_TEST_AND_INTEGRATION", open_finding_ids: withFindings}, plan);
  }
  if (event.event_type === "PLATFORM_REVIEW_PASSED") {
    assert(state.status === "PLATFORM_REVIEW_PENDING", "Platform review pass is out of order");
    assert(findingIds.length === 0 && state.open_finding_ids.length === 0, "Platform review cannot pass with open findings");
    return nextRunState(state, {status: "CENTRAL_INTEGRATION_PENDING", next_action: "START_CENTRAL_INTEGRATION_OF_ACCEPTED_PLATFORM_HANDOFFS", open_finding_ids: withFindings}, plan);
  }
  if (event.event_type === "CENTRAL_INTEGRATION_PASSED") {
    assert(state.status === "CENTRAL_INTEGRATION_PENDING", "central integration pass is out of order");
    assert(findingIds.length === 0 && state.open_finding_ids.length === 0, "central integration cannot pass with open findings");
    return nextRunState(state, {status: "INDEPENDENT_REAUDIT_PENDING", next_action: "START_INDEPENDENT_REAUDIT_OF_CUMULATIVE_CANDIDATE", open_finding_ids: withFindings}, plan);
  }
  assert(event.event_type === "INDEPENDENT_REAUDIT_PASSED" && state.status === "INDEPENDENT_REAUDIT_PENDING", "independent re-audit pass is out of order");
  assert(findingIds.length === 0 && state.open_finding_ids.length === 0, "Controller import cannot advance with open findings");
  const waveIndex = state.wave_index + 1;
  if (waveIndex === plan.waves.length) return nextRunState(state, {status: "COMPLETE", wave_index: waveIndex, current_wave_id: null, next_action: "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW", open_finding_ids: [], recovery_attempts: 0}, plan);
  return nextRunState(state, {status: "SPAWNER_QA_PENDING", wave_index: waveIndex, current_wave_id: plan.waves[waveIndex].wave_id, next_action: "REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE", open_finding_ids: [], recovery_attempts: 0}, plan);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller import planner loaded\n");
