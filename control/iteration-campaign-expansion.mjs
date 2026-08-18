#!/usr/bin/env node

/*
 * Pure continuation gate for the typed ITER-003 campaign expansion.
 *
 * The gate classifies a source-bound request only.  It never performs the
 * continuation, changes authority, completes a Finalizer, or activates a
 * release candidate.
 */

import crypto from "node:crypto";
import {assertUniversalDevelopmentMode, universalTaskCloseoutPolicy} from "./governance-library.mjs";

export const ITERATION_CAMPAIGN_EXPANSION_SCHEMA = "agentos.iteration_campaign_expansion_admission.v1";
export const ITERATION_CAMPAIGN_EXPANSION_VERSION = 1;
export const ITERATION_CAMPAIGN_ID = "ITER-003-CASCADE-FINALIZER-GATE";
export const ITERATION_CAMPAIGN_VERSION = "v1";
export const ITERATION_CAMPAIGN_ROLE = "ITERATION_CASCADE_FINALIZER_GATE_BUILDER";
export const ITERATION_CAMPAIGN_SCOPE = "INTERNAL_AGENTOS";
export const PREPARED_RELEASE_STATE = "PREPARED_NOT_ACTIVATED";

export const PROTECTED_ACTION_FLAGS = Object.freeze([
  "external_action",
  "authority_change",
  "destructive_action",
  "new_product_scope",
  "finalizer_completion",
  "push",
  "publication",
  "deployment",
  "activation",
  "self_acceptance",
]);

const REQUIRED_INPUT_ACTIONS = new Set(PROTECTED_ACTION_FLAGS);
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_ROLE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const URL_OR_ABSOLUTE_PATH = /(?:https?:\/\/|^(?:\/|[A-Za-z]:[\\/]|\\\\))/u;
const SECRET_SHAPE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const FORBIDDEN_CONTEXT_KEY = /(?:^|_)(?:project|product|provider|private|credential|secret|password|token|chat|thread|path|cwd|root|account|tenant|remote|url)(?:_|$)/u;

const ROOT_INPUT_KEYS = new Set([
  "campaignId", "campaign_id", "campaignVersion", "campaign_version",
  "scopeClass", "scope_class", "dependencySatisfied", "dependency_satisfied",
  "ownerIntentResolved", "owner_intent_resolved", "identityMatch", "identity_match",
  "identityMismatch", "identity_mismatch", "capabilityAvailable", "capability_available",
  "role", "roleId", "role_id", "identity", "capability",
  "sourceBinding", "source_binding", "source", "source_readback",
  "expectedSourceBinding", "expected_source_binding",
  "sourceCommit", "source_commit", "sourceTree", "source_tree",
  "expectedSourceCommit", "expected_source_commit", "expectedSourceTree", "expected_source_tree",
  "protectedActions", "protected_actions", "releaseCandidateState", "release_candidate_state",
  "releaseCandidateActive", "release_candidate_active",
  ...PROTECTED_ACTION_FLAGS,
  ...PROTECTED_ACTION_FLAGS.map((key) => key.replaceAll(/_([a-z])/gu, (_match, letter) => letter.toUpperCase())),
  "external", "authority", "destructive", "newProduct", "finalizerComplete",
  "externalPush", "externalPublication", "externalDeployment", "releaseCandidateActivation",
  "release_candidate_activation", "selfAccept",
]);

const SOURCE_KEYS = new Set([
  "sourceCommit", "source_commit", "commit", "sourceTree", "source_tree", "tree",
  "expectedSourceCommit", "expected_source_commit", "expectedCommit", "expected_commit",
  "expectedSourceTree", "expected_source_tree", "expectedTree", "expected_tree", "status",
  "current", "observed", "actual", "expected", "baseline",
]);

const IDENTITY_KEYS = new Set(["match", "matches", "identityMatch", "identity_match"]);
const CAPABILITY_KEYS = new Set(["available", "capabilityAvailable", "capability_available"]);

const ACTION_ALIASES = Object.freeze({
  external_action: ["external_action", "externalAction", "external"],
  authority_change: ["authority_change", "authorityChange", "authority"],
  destructive_action: ["destructive_action", "destructiveAction", "destructive"],
  new_product_scope: ["new_product_scope", "newProductScope", "newProduct", "new_product"],
  finalizer_completion: ["finalizer_completion", "finalizerCompletion", "finalizerComplete"],
  push: ["push", "externalPush", "external_push"],
  publication: ["publication", "externalPublication", "external_publication"],
  deployment: ["deployment", "externalDeployment", "external_deployment"],
  activation: ["activation", "releaseCandidateActivation", "release_candidate_activation"],
  self_acceptance: ["self_acceptance", "selfAcceptance", "selfAccept"],
});

const ACTION_INPUT_KEYS = new Set(Object.values(ACTION_ALIASES).flat());

const ACTION_CLASSIFICATIONS = Object.freeze([
  ["external_action", "EXTERNAL_ACTION", "STOP_EXTERNAL_ACTION", "An external action crosses the internal continuation boundary.", true],
  ["authority_change", "AUTHORITY_CHANGE", "STOP_AUTHORITY_CHANGE", "An authority change requires a separate authorized decision.", true],
  ["destructive_action", "DESTRUCTIVE_ACTION", "STOP_DESTRUCTIVE_ACTION", "A destructive action is not admitted by the internal continuation gate.", true],
  ["new_product_scope", "NEW_PRODUCT_SCOPE", "STOP_NEW_PRODUCT_SCOPE", "New product scope requires a separate source-bound admission.", true],
  ["finalizer_completion", "FINALIZER_COMPLETION", "STOP_FINALIZER_COMPLETION", "Finalizer completion is explicitly outside this classification-only gate.", false],
  ["push", "PUSH", "STOP_PUSH", "Push is an external side effect and is never performed by this gate.", true],
  ["publication", "PUBLICATION", "STOP_PUBLICATION", "Publication is an external side effect and is never performed by this gate.", true],
  ["deployment", "DEPLOYMENT", "STOP_DEPLOYMENT", "Deployment is an external side effect and is never performed by this gate.", true],
  ["activation", "ACTIVATION", "STOP_ACTIVATION", "Activation is not admitted; the prepared release remains inactive.", true],
  ["self_acceptance", "SELF_ACCEPTANCE", "STOP_SELF_ACCEPTANCE", "Self-acceptance is prohibited; an independent check remains required.", false],
]);

const EMPTY_ACTIONS = Object.freeze(Object.fromEntries(PROTECTED_ACTION_FLAGS.map((key) => [key, false])));
const EMPTY_EFFECTS = Object.freeze({
  external_action_performed: false,
  authority_changed: false,
  destructive_action_performed: false,
  finalizer_completed: false,
  pushed: false,
  published: false,
  deployed: false,
  activated: false,
  self_accepted: false,
  release_candidate_active: false,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value) {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireRecord(value, label) {
  assert(isPlainRecord(value), `${label} must be a plain object`);
  return value;
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value.trim();
}

function requireIdentifier(value, label) {
  const normalized = requireString(value, label);
  assert(IDENTIFIER.test(normalized), `${label} is not a stable identifier`);
  return normalized;
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a lowercase Git object identity`);
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value, seen = new Set(), label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${label} contains a non-finite number`);
    return value;
  }
  assert(value !== undefined && typeof value !== "function" && typeof value !== "symbol" && typeof value !== "bigint", `${label} contains a non-JSON value`);
  if (Array.isArray(value)) {
    assert(!seen.has(value), `${label} contains a cycle`);
    seen.add(value);
    const result = value.map((item, index) => canonicalize(item, seen, `${label}[${index}]`));
    seen.delete(value);
    return result;
  }
  requireRecord(value, label);
  assert(!seen.has(value), `${label} contains a cycle`);
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key], seen, `${label}.${key}`)]));
  seen.delete(value);
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digestBody(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return body;
}

export function iterationCampaignExpansionDigest(admission) {
  return crypto.createHash("sha256").update(canonicalJson(digestBody(admission, "admission_sha256")), "utf8").digest("hex");
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.hasOwn(value, key);
}

function equivalent(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function pickFrom(record, keys, label) {
  if (!isRecord(record)) return undefined;
  const present = keys.filter((key) => hasOwn(record, key));
  if (present.length === 0) return undefined;
  const value = record[present[0]];
  for (const key of present.slice(1)) assert(equivalent(value, record[key]), `${label} aliases disagree`);
  return value;
}

function pickFromSources(sources, keys, label) {
  const values = [];
  for (const source of sources) {
    const value = pickFrom(source, keys, label);
    if (value !== undefined) values.push(value);
  }
  if (values.length === 0) return undefined;
  for (const value of values.slice(1)) assert(equivalent(values[0], value), `${label} bindings disagree`);
  return values[0];
}

function normalizedKey(key) {
  return key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
}

function assertAllowedKeys(value, allowed, label) {
  requireRecord(value, label);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unsupported field ${key}`);
}

function findForbiddenContext(value, location = "input", seen = new Set()) {
  if (value === undefined) return null;
  if (typeof value === "string") {
    if (URL_OR_ABSOLUTE_PATH.test(value) || SECRET_SHAPE.test(value)) return location;
    return null;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return null;
  if (!isRecord(value) && !Array.isArray(value)) return location;
  if (seen.has(value)) return location;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenContext(value[index], `${location}[${index}]`, seen);
      if (found !== null) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const actionKey = ACTION_INPUT_KEYS.has(key) || ACTION_INPUT_KEYS.has(normalized);
    if (!actionKey && FORBIDDEN_CONTEXT_KEY.test(normalized)) return `${location}.${key}`;
    const found = findForbiddenContext(child, `${location}.${key}`, seen);
    if (found !== null) return found;
  }
  return null;
}

function emptySourceBinding() {
  return {
    status: "INVALID",
    source_commit: null,
    source_tree: null,
    expected_source_commit: null,
    expected_source_tree: null,
  };
}

function emptyCampaignBinding() {
  return {
    campaign_id: ITERATION_CAMPAIGN_ID,
    campaign_version: ITERATION_CAMPAIGN_VERSION,
    kind: "CAMPAIGN_EXPANSION",
    scope_class: ITERATION_CAMPAIGN_SCOPE,
    dependency_id: "ITER-002",
    admitted_role: ITERATION_CAMPAIGN_ROLE,
    persistent_coordinator: "AGENTOS_CONTROLLER",
  };
}

function emptyEffects() {
  return {...EMPTY_EFFECTS};
}

function actionObject(actions) {
  return Object.fromEntries(PROTECTED_ACTION_FLAGS.map((key) => [key, actions?.[key] ?? false]));
}

function baseDecision({sourceBinding = emptySourceBinding(), identityMatch = null, capabilityAvailable = null, dependencySatisfied = null, ownerIntentResolved = null, role = null, protectedActions = EMPTY_ACTIONS} = {}) {
  return {
    classification: "MISSING_OR_UNTYPED_INPUT",
    decision: "STOP",
    route: "FAIL_CLOSED",
    reason: "Typed admission input is missing, malformed, or unsupported; continuation stops safely.",
    continuation: "STOP",
    source_binding: sourceBinding,
    campaign_binding: emptyCampaignBinding(),
    owner_choice_required: false,
    identity_match: identityMatch,
    capability_available: capabilityAvailable,
    dependency_satisfied: dependencySatisfied,
    owner_intent_resolved: ownerIntentResolved,
    role,
    scope_class: null,
    protected_actions: actionObject(protectedActions),
    release_candidate_state: PREPARED_RELEASE_STATE,
    effects: emptyEffects(),
    universal_closeout: universalTaskCloseoutPolicy("ITERATION"),
  };
}

function stopDecision(normalized, classification, route, reason, ownerChoiceRequired = false) {
  return {
    classification,
    decision: "STOP",
    route,
    reason,
    continuation: "STOP",
    source_binding: normalized.source_binding,
    campaign_binding: emptyCampaignBinding(),
    owner_choice_required: ownerChoiceRequired,
    identity_match: normalized.identity_match,
    capability_available: normalized.capability_available,
    dependency_satisfied: normalized.dependency_satisfied,
    owner_intent_resolved: normalized.owner_intent_resolved,
    role: normalized.role,
    scope_class: normalized.scope_class,
    protected_actions: {...normalized.protected_actions},
    release_candidate_state: PREPARED_RELEASE_STATE,
    effects: emptyEffects(),
    universal_closeout: universalTaskCloseoutPolicy("ITERATION"),
  };
}

function admittedDecision(normalized) {
  return {
    classification: "INTERNAL_AGENTOS_CONTINUATION",
    decision: "CONTINUE_WITHOUT_OWNER_APPROVAL",
    route: "CONTROLLER_CONTINUE",
    reason: "Typed internal AgentOS campaign work remains source-bound and may continue without a new owner approval pause.",
    continuation: "CONTINUE",
    source_binding: normalized.source_binding,
    campaign_binding: emptyCampaignBinding(),
    owner_choice_required: false,
    identity_match: true,
    capability_available: true,
    dependency_satisfied: true,
    owner_intent_resolved: true,
    role: ITERATION_CAMPAIGN_ROLE,
    scope_class: ITERATION_CAMPAIGN_SCOPE,
    protected_actions: {...normalized.protected_actions},
    release_candidate_state: PREPARED_RELEASE_STATE,
    effects: emptyEffects(),
    universal_closeout: universalTaskCloseoutPolicy("ITERATION"),
  };
}

function normalizeSourceBinding(input) {
  const nestedBinding = pickFrom(input, ["sourceBinding", "source_binding"], "source binding");
  if (nestedBinding !== undefined) requireRecord(nestedBinding, "source binding");
  const expectedBinding = pickFrom(input, ["expectedSourceBinding", "expected_source_binding"], "expected source binding");
  if (expectedBinding !== undefined) requireRecord(expectedBinding, "expected source binding");
  const root = nestedBinding ?? pickFrom(input, ["source", "source_readback"], "source readback") ?? input;
  requireRecord(root, "source binding");
  if (root !== input) assertAllowedKeys(root, SOURCE_KEYS, "source binding");
  if (expectedBinding !== undefined) assertAllowedKeys(expectedBinding, SOURCE_KEYS, "expected source binding");
  const current = pickFrom(root, ["current", "observed", "actual"], "current source binding") ?? root;
  const expected = pickFrom(root, ["expected", "baseline"], "expected source binding") ?? expectedBinding ?? input;
  if (current !== null && current !== undefined) requireRecord(current, "current source binding");
  if (expected !== null && expected !== undefined) requireRecord(expected, "expected source binding");
  const sourceCommit = pickFromSources([current, root, input], ["sourceCommit", "source_commit", "commit"], "source commit");
  const sourceTree = pickFromSources([current, root, input], ["sourceTree", "source_tree", "tree"], "source tree");
  const explicitExpectedCommit = pickFromSources([expected, root, expectedBinding, input], ["expectedSourceCommit", "expected_source_commit", "expectedCommit", "expected_commit"], "expected source commit");
  const explicitExpectedTree = pickFromSources([expected, root, expectedBinding, input], ["expectedSourceTree", "expected_source_tree", "expectedTree", "expected_tree"], "expected source tree");
  const expectedCommit = explicitExpectedCommit ?? pickFromSources([expected, root, expectedBinding, input], ["sourceCommit", "source_commit", "commit"], "expected source commit");
  const expectedTree = explicitExpectedTree ?? pickFromSources([expected, root, expectedBinding, input], ["sourceTree", "source_tree", "tree"], "expected source tree");
  const providedStatus = pickFromSources([nestedBinding, root], ["status"], "source binding status");
  const valid = [sourceCommit, sourceTree, expectedCommit, expectedTree].every((value) => typeof value === "string" && GIT_OBJECT.test(value));
  const status = !valid || (providedStatus !== undefined && providedStatus !== "MATCH")
    ? "INVALID"
    : sourceCommit === expectedCommit && sourceTree === expectedTree ? "MATCH" : "MISMATCH";
  return {
    status,
    source_commit: valid ? sourceCommit : null,
    source_tree: valid ? sourceTree : null,
    expected_source_commit: valid ? expectedCommit : null,
    expected_source_tree: valid ? expectedTree : null,
  };
}

function normalizeBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
  return value;
}

function normalizeProtectedActions(input) {
  const nested = pickFrom(input, ["protectedActions", "protected_actions"], "protected actions");
  if (nested !== undefined) {
    requireRecord(nested, "protected actions");
    assertAllowedKeys(nested, new Set([...ACTION_INPUT_KEYS]), "protected actions");
  }
  const result = {};
  for (const [canonical, aliases] of Object.entries(ACTION_ALIASES)) {
    const raw = pickFromSources([nested, input], aliases, `protected action ${canonical}`);
    result[canonical] = normalizeBoolean(raw, `protected action ${canonical}`);
  }
  return result;
}

function normalizeInput(input) {
  requireRecord(input, "iteration admission input");
  const forbidden = findForbiddenContext(input);
  if (forbidden !== null) return {forbiddenContext: forbidden};
  assertAllowedKeys(input, ROOT_INPUT_KEYS, "iteration admission input");
  const campaignId = requireIdentifier(pickFrom(input, ["campaignId", "campaign_id"], "campaign ID"), "campaign ID");
  const campaignVersion = requireIdentifier(pickFrom(input, ["campaignVersion", "campaign_version"], "campaign version"), "campaign version");
  const scopeClass = requireString(pickFrom(input, ["scopeClass", "scope_class"], "scope class"), "scope class").toUpperCase();
  const dependencySatisfied = normalizeBoolean(pickFrom(input, ["dependencySatisfied", "dependency_satisfied"], "dependency satisfied"), "dependency satisfied");
  const ownerIntentResolved = normalizeBoolean(pickFrom(input, ["ownerIntentResolved", "owner_intent_resolved"], "owner intent resolved"), "owner intent resolved");
  let identityMatch = pickFrom(input, ["identityMatch", "identity_match"], "identity match");
  const identityMismatch = pickFrom(input, ["identityMismatch", "identity_mismatch"], "identity mismatch");
  if (identityMatch === undefined && identityMismatch !== undefined) identityMatch = !normalizeBoolean(identityMismatch, "identity mismatch");
  if (identityMatch === undefined && isRecord(input.identity)) {
    assertAllowedKeys(input.identity, IDENTITY_KEYS, "identity");
    identityMatch = pickFrom(input.identity, ["match", "matches", "identityMatch", "identity_match"], "identity match");
  }
  identityMatch = normalizeBoolean(identityMatch, "identity match");
  if (identityMismatch !== undefined && identityMatch !== !normalizeBoolean(identityMismatch, "identity mismatch")) {
    // A matching identity and an explicit mismatch flag disagree.
    throw new Error("identity match and identity mismatch disagree");
  }
  let capabilityAvailable = pickFrom(input, ["capabilityAvailable", "capability_available"], "capability available");
  if (capabilityAvailable === undefined && isRecord(input.capability)) {
    assertAllowedKeys(input.capability, CAPABILITY_KEYS, "capability");
    capabilityAvailable = pickFrom(input.capability, ["available", "capabilityAvailable", "capability_available"], "capability available");
  }
  capabilityAvailable = normalizeBoolean(capabilityAvailable, "capability available");
  const role = requireString(pickFrom(input, ["role", "roleId", "role_id"], "role"), "role");
  assert(SAFE_ROLE.test(role), "role is not a stable identifier");
  const sourceBinding = normalizeSourceBinding(input);
  const protectedActions = normalizeProtectedActions(input);
  const releaseCandidateState = pickFrom(input, ["releaseCandidateState", "release_candidate_state"], "release candidate state") ?? PREPARED_RELEASE_STATE;
  assert(releaseCandidateState === PREPARED_RELEASE_STATE || releaseCandidateState === "ACTIVE", "release candidate state is unsupported");
  const releaseCandidateActive = pickFrom(input, ["releaseCandidateActive", "release_candidate_active"], "release candidate active");
  if (releaseCandidateActive !== undefined) normalizeBoolean(releaseCandidateActive, "release candidate active");
  if (releaseCandidateState === "ACTIVE" || releaseCandidateActive === true) protectedActions.activation = true;
  return {
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    scope_class: scopeClass,
    dependency_satisfied: dependencySatisfied,
    owner_intent_resolved: ownerIntentResolved,
    identity_match: identityMatch,
    capability_available: capabilityAvailable,
    role,
    source_binding: sourceBinding,
    protected_actions: protectedActions,
  };
}

function withAliases(value) {
  Object.defineProperties(value, {
    campaignId: {enumerable: false, get: () => value.campaign_id},
    campaignVersion: {enumerable: false, get: () => value.campaign_version},
    scopeClass: {enumerable: false, get: () => value.scope_class},
    sourceBinding: {enumerable: false, get: () => value.source_binding},
    campaignBinding: {enumerable: false, get: () => value.campaign_binding},
    ownerChoiceRequired: {enumerable: false, get: () => value.owner_choice_required},
    protectedActions: {enumerable: false, get: () => value.protected_actions},
    identityMatch: {enumerable: false, get: () => value.identity_match},
    capabilityAvailable: {enumerable: false, get: () => value.capability_available},
    dependencySatisfied: {enumerable: false, get: () => value.dependency_satisfied},
    ownerIntentResolved: {enumerable: false, get: () => value.owner_intent_resolved},
  });
  return value;
}

export function classifyIterationCampaignExpansion(input = {}) {
  assertUniversalDevelopmentMode("ITERATION");
  if (!isPlainRecord(input)) return withAliases(baseDecision());
  try {
    const normalized = normalizeInput(input);
    if (normalized.forbiddenContext !== undefined) {
      return withAliases({...baseDecision(), classification: "PRODUCT_OR_PRIVATE_CONTEXT", route: "FAIL_CLOSED_CONTEXT", reason: "Product-specific or private context is not admitted by the portable continuation gate."});
    }
    if (normalized.source_binding.status === "INVALID") return withAliases(stopDecision(normalized, "SOURCE_BINDING_INVALID", "FAIL_CLOSED_SOURCE_BINDING", "The source commit/tree binding is missing or invalid."));
    if (normalized.source_binding.status === "MISMATCH") return withAliases(stopDecision(normalized, "SOURCE_BINDING_MISMATCH", "FAIL_CLOSED_SOURCE_BINDING", "The observed source commit/tree does not match the expected binding."));
    if (normalized.identity_match === false) return withAliases(stopDecision(normalized, "IDENTITY_MISMATCH", "FAIL_CLOSED_IDENTITY", "The execution identity does not match the typed admission binding."));
    if (normalized.capability_available === false) return withAliases(stopDecision(normalized, "CAPABILITY_UNAVAILABLE", "FAIL_CLOSED_CAPABILITY", "A required host capability is unavailable; continuation stops safely."));
    if (normalized.campaign_id !== ITERATION_CAMPAIGN_ID || normalized.campaign_version !== ITERATION_CAMPAIGN_VERSION) return withAliases(stopDecision(normalized, "CAMPAIGN_BINDING_MISMATCH", "FAIL_CLOSED_CAMPAIGN", "The request is not bound to the admitted ITER-003 campaign."));
    const roleToken = normalized.role.toUpperCase().replaceAll(/[\s-]+/gu, "_");
    if (roleToken.includes("FEATURE_AGENT")) return withAliases(stopDecision(normalized, "GENERIC_FEATURE_AGENT_ROLE", "FAIL_CLOSED_ROLE", "Generic Feature Agent-style roles are not admitted for this named continuation lane."));
    if (normalized.role !== ITERATION_CAMPAIGN_ROLE) return withAliases(stopDecision(normalized, "ROLE_NOT_ADMITTED", "FAIL_CLOSED_ROLE", "The role is not the named ITER-003 continuation role."));
    for (const [flag, classification, route, reason, ownerChoiceRequired] of ACTION_CLASSIFICATIONS) {
      if (normalized.protected_actions[flag] === true) return withAliases(stopDecision(normalized, classification, route, reason, ownerChoiceRequired));
    }
    if (normalized.scope_class !== ITERATION_CAMPAIGN_SCOPE) return withAliases(stopDecision(normalized, "SCOPE_OUT_OF_BOUNDS", "FAIL_CLOSED_SCOPE", "Only typed internal AgentOS scope may use this continuation gate.", true));
    if (normalized.dependency_satisfied === false) return withAliases(stopDecision(normalized, "DEPENDENCY_UNSATISFIED", "HOLD_DEPENDENCY", "A required campaign dependency is unsatisfied; the dependent continuation remains stopped."));
    if (normalized.owner_intent_resolved === false) return withAliases(stopDecision(normalized, "OWNER_INTENT_UNRESOLVED", "OWNER_CHOICE_REQUIRED", "Owner intent is unresolved; continuation requires an explicit owner choice.", true));
    return withAliases(admittedDecision(normalized));
  } catch {
    return withAliases(baseDecision());
  }
}

const ADMISSION_FIELDS = [
  "schema", "version", "status", "classification", "decision", "route", "reason", "continuation",
  "source_binding", "campaign_binding", "owner_choice_required", "identity_match", "capability_available",
  "dependency_satisfied", "owner_intent_resolved", "role", "scope_class", "protected_actions",
  "release_candidate_state", "effects", "universal_closeout", "admission_sha256",
];

function validateSourceBinding(binding) {
  exactKeys(binding, ["status", "source_commit", "source_tree", "expected_source_commit", "expected_source_tree"], "iteration source binding");
  assert(["MATCH", "MISMATCH", "INVALID"].includes(binding.status), "iteration source binding status is invalid");
  if (binding.status === "INVALID") {
    for (const field of ["source_commit", "source_tree", "expected_source_commit", "expected_source_tree"]) assert(binding[field] === null || (typeof binding[field] === "string" && GIT_OBJECT.test(binding[field])), `invalid iteration source binding ${field}`);
  } else {
    for (const field of ["source_commit", "source_tree", "expected_source_commit", "expected_source_tree"]) requireGitObject(binding[field], `iteration source binding ${field}`);
    const match = binding.source_commit === binding.expected_source_commit && binding.source_tree === binding.expected_source_tree;
    assert((binding.status === "MATCH") === match, "iteration source binding status does not match its values");
  }
  return binding;
}

function validateCampaignBinding(binding) {
  exactKeys(binding, ["campaign_id", "campaign_version", "kind", "scope_class", "dependency_id", "admitted_role", "persistent_coordinator"], "iteration campaign binding");
  assert(binding.campaign_id === ITERATION_CAMPAIGN_ID && binding.campaign_version === ITERATION_CAMPAIGN_VERSION, "iteration campaign binding identity is invalid");
  assert(binding.kind === "CAMPAIGN_EXPANSION" && binding.scope_class === ITERATION_CAMPAIGN_SCOPE, "iteration campaign binding kind or scope is invalid");
  assert(binding.dependency_id === "ITER-002" && binding.admitted_role === ITERATION_CAMPAIGN_ROLE && binding.persistent_coordinator === "AGENTOS_CONTROLLER", "iteration campaign binding governance is invalid");
  return binding;
}

function validateActions(actions) {
  exactKeys(actions, PROTECTED_ACTION_FLAGS, "iteration protected actions");
  for (const flag of PROTECTED_ACTION_FLAGS) assert(typeof actions[flag] === "boolean", `iteration protected action ${flag} must be boolean`);
  return actions;
}

function validateEffects(effects) {
  exactKeys(effects, Object.keys(EMPTY_EFFECTS), "iteration gate effects");
  for (const [field, value] of Object.entries(effects)) assert(value === false, `iteration gate effect ${field} must remain false`);
  return effects;
}

export function validateIterationCampaignExpansionAdmission(admission) {
  assertUniversalDevelopmentMode("ITERATION");
  exactKeys(admission, ADMISSION_FIELDS, "iteration campaign expansion admission");
  assert(admission.schema === ITERATION_CAMPAIGN_EXPANSION_SCHEMA && admission.version === ITERATION_CAMPAIGN_EXPANSION_VERSION, "iteration campaign expansion schema mismatch");
  assert(admission.status === "ADMITTED" || admission.status === "BLOCKED", "iteration campaign expansion status is invalid");
  assert(typeof admission.classification === "string" && admission.classification.length > 0, "iteration classification is invalid");
  assert(admission.decision === (admission.status === "ADMITTED" ? "CONTINUE_WITHOUT_OWNER_APPROVAL" : "STOP"), "iteration decision does not match status");
  assert(admission.continuation === (admission.status === "ADMITTED" ? "CONTINUE" : "STOP"), "iteration continuation does not match status");
  requireString(admission.route, "iteration route");
  requireString(admission.reason, "iteration reason");
  validateSourceBinding(admission.source_binding);
  validateCampaignBinding(admission.campaign_binding);
  assert(typeof admission.owner_choice_required === "boolean", "iteration owner-choice state is invalid");
  for (const field of ["identity_match", "capability_available", "dependency_satisfied", "owner_intent_resolved"]) assert(admission[field] === null || typeof admission[field] === "boolean", `iteration ${field} is invalid`);
  if (admission.status === "ADMITTED") {
    assert(admission.classification === "INTERNAL_AGENTOS_CONTINUATION" && admission.route === "CONTROLLER_CONTINUE", "admitted iteration classification is invalid");
    assert(admission.source_binding.status === "MATCH", "admitted iteration source is not matched");
    assert(admission.identity_match === true && admission.capability_available === true && admission.dependency_satisfied === true && admission.owner_intent_resolved === true, "admitted iteration conditions are not satisfied");
    assert(admission.role === ITERATION_CAMPAIGN_ROLE && admission.scope_class === ITERATION_CAMPAIGN_SCOPE, "admitted iteration role or scope is invalid");
    assert(admission.owner_choice_required === false, "admitted internal iteration unexpectedly requires owner choice");
  }
  assert(admission.role === null || typeof admission.role === "string", "iteration role is invalid");
  if (admission.status === "ADMITTED") requireString(admission.role, "iteration role");
  assert(admission.scope_class === null || typeof admission.scope_class === "string", "iteration scope class is invalid");
  assert(admission.release_candidate_state === PREPARED_RELEASE_STATE, "prepared release candidate crossed its inactive boundary");
  validateActions(admission.protected_actions);
  validateEffects(admission.effects);
  assert(JSON.stringify(admission.universal_closeout) === JSON.stringify(universalTaskCloseoutPolicy("ITERATION")),
    "iteration admission universal closeout policy differs from general governance");
  assert(typeof admission.admission_sha256 === "string" && SHA256.test(admission.admission_sha256), "iteration admission digest is invalid");
  assert(admission.admission_sha256 === iterationCampaignExpansionDigest(admission), "iteration admission digest mismatch");
  return admission;
}

export function compileIterationCampaignExpansionAdmission(input = {}) {
  const classification = classifyIterationCampaignExpansion(input);
  const admission = {
    schema: ITERATION_CAMPAIGN_EXPANSION_SCHEMA,
    version: ITERATION_CAMPAIGN_EXPANSION_VERSION,
    status: classification.decision === "CONTINUE_WITHOUT_OWNER_APPROVAL" ? "ADMITTED" : "BLOCKED",
    ...classification,
    admission_sha256: null,
  };
  admission.admission_sha256 = iterationCampaignExpansionDigest(admission);
  return withAliases(validateIterationCampaignExpansionAdmission(admission));
}

export const classifyIterationCampaignAdmission = classifyIterationCampaignExpansion;
export const compileIterationCampaignAdmission = compileIterationCampaignExpansionAdmission;
