#!/usr/bin/env node

import crypto from "node:crypto";
import {
  applyPolicyAmendment,
  compilePolicyAmendment,
  compilePolicyApproval,
  getPolicyValue,
  MODEL_CLASSES,
  POLICY_CHANGE_CLASSES,
  validatePolicyAmendment,
  validatePolicyState,
} from "./global-policy-state.mjs";
import {writePolicyStateCompareAndSwap} from "./global-policy-store.mjs";
import {writeProjectContextCompareAndSwap} from "./project-context-store.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ACCEPTANCE_ROOTS = Object.freeze(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
const MODEL_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT",
  "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME",
]);
const QUESTION_ROOTS = Object.freeze(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);

export const REVIEW_TYPE = "PRE_CAMPAIGN_OWNER_REVIEW";
export const REVIEW_PHASES = Object.freeze([
  "ORIENTATION", "INTENT", "DESIRED_CHANGES", "CAMPAIGN_SHAPE", "MODEL_PLAN", "REVIEW_SUMMARY",
]);
export const REVIEW_TRANSPORTS = Object.freeze([
  "PRIVATE_MARKDOWN", "PRIVATE_GIT", "CONNECTED_PRIVATE_CHAT", "SHARED_LINK_ADVISORY",
]);
export const MEMORY_POSTURES = Object.freeze(["PROJECT_ONLY", "DEFAULT", "NONE"]);
export const APPROVAL_ROUTES = Object.freeze([
  "DIRECT_AGENTOS_CONFIRMATION", "AUTHENTICATED_CONNECTOR", "AUTHORIZED_SIGNED_GIT",
]);
export const APPROVAL_STATES = Object.freeze([
  "OWNER_CONVERSATIONALLY_CONFIRMED", "OWNER_STATED_EXACT_APPROVAL", "OWNER_AUTHENTICATED_EXACT_APPROVAL",
]);
export const REVIEW_CLASSIFICATIONS = Object.freeze([...POLICY_CHANGE_CLASSES]);
export const CHANGE_BUCKETS = Object.freeze([
  "required", "desired_if_economical", "preserve", "remove", "defer", "non_goals",
]);
const MODEL_GUIDANCE_ECONOMY = Object.freeze(["LOW", "MEDIUM", "HIGH"]);
const MODEL_GUIDANCE_SPEED = Object.freeze(["SLOW", "MEDIUM", "FAST"]);
const MODEL_GUIDANCE_DIFFICULTY = Object.freeze(["ROUTINE", "SUBSTANTIAL", "HIGH_CONSEQUENCE"]);
const MODEL_GUIDANCE_FIT = Object.freeze(["GOOD", "CONDITIONAL", "INSUFFICIENT"]);
const TASK_TIME_SENSITIVITY = Object.freeze(["LOW", "MEDIUM", "HIGH"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be an exact Git object identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be a valid UTC timestamp`);
}

function safeText(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  requireString(value, label);
  assert(!/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(value), `${label} contains secret material`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function ownerReviewDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function sortedStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value) => safeText(value, `${label} item`));
  const sorted = [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted by UTF-8`);
  return sorted;
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function validateTextArray(value, label, {allowEmpty = true} = {}) {
  return sortedStrings(value, label, {allowEmpty});
}

function validateSourceBinding(binding) {
  exactKeys(binding, [
    "policy_epoch", "policy_state_sha256", "project_context_sha256", "source_commit", "source_tree",
    "current_campaign_id", "next_campaign_candidate_sha256",
  ], "owner review source binding");
  assert(Number.isSafeInteger(binding.policy_epoch) && binding.policy_epoch >= 1, "owner review policy epoch is invalid");
  requireSha(binding.policy_state_sha256, "owner review policy state");
  requireSha(binding.project_context_sha256, "owner review project context");
  requireGitObject(binding.source_commit, "owner review source commit");
  requireGitObject(binding.source_tree, "owner review source tree");
  if (binding.current_campaign_id !== null) requireIdentifier(binding.current_campaign_id, "owner review current campaign");
  if (binding.next_campaign_candidate_sha256 !== null) requireSha(binding.next_campaign_candidate_sha256, "owner review current candidate");
}

function safeLocator(value, label) {
  requireString(value, label);
  assert(!value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), `${label} is not a contained locator`);
}

function validateTransportBinding(binding, transport) {
  exactKeys(binding, [
    "kind", "handoff_locator", "return_locator", "repository_digest_sha256", "branch", "commit", "tree",
    "connector_identity_sha256", "conversation_identity_sha256", "user_authorized",
  ], "owner review transport binding");
  assert(binding.kind === transport, "owner review transport binding kind mismatch");
  safeLocator(binding.handoff_locator, "owner review handoff locator");
  safeLocator(binding.return_locator, "owner review return locator");
  assert(typeof binding.user_authorized === "boolean", "owner review transport authorization is invalid");
  for (const field of ["repository_digest_sha256", "connector_identity_sha256", "conversation_identity_sha256"]) {
    if (binding[field] !== null) requireSha(binding[field], `owner review transport ${field}`);
  }
  if (binding.branch !== null) requireString(binding.branch, "owner review transport branch");
  for (const field of ["commit", "tree"]) if (binding[field] !== null) requireGitObject(binding[field], `owner review transport ${field}`);
  if (transport === "PRIVATE_MARKDOWN") {
    assert(binding.repository_digest_sha256 === null && binding.branch === null && binding.commit === null && binding.tree === null, "private Markdown transport carries Git identity unexpectedly");
    assert(binding.connector_identity_sha256 === null && binding.conversation_identity_sha256 === null && binding.user_authorized === true, "private Markdown transport binding is invalid");
  } else if (transport === "PRIVATE_GIT") {
    requireSha(binding.repository_digest_sha256, "private Git repository digest");
    requireString(binding.branch, "private Git branch");
    requireGitObject(binding.commit, "private Git handoff commit");
    requireGitObject(binding.tree, "private Git handoff tree");
    assert(binding.connector_identity_sha256 === null && binding.conversation_identity_sha256 === null && binding.user_authorized === true, "private Git transport binding is invalid");
  } else if (transport === "CONNECTED_PRIVATE_CHAT") {
    requireSha(binding.connector_identity_sha256, "connected Chat connector identity");
    requireSha(binding.conversation_identity_sha256, "connected Chat conversation identity");
    assert(binding.repository_digest_sha256 === null && binding.branch === null && binding.commit === null && binding.tree === null && binding.user_authorized === true, "connected Chat transport binding is invalid");
  } else {
    assert(binding.user_authorized === false, "shared-link advisory transport cannot claim authenticated user authority");
    assert(binding.repository_digest_sha256 === null && binding.branch === null && binding.commit === null && binding.tree === null && binding.connector_identity_sha256 === null && binding.conversation_identity_sha256 === null, "shared-link advisory transport carries authority identity");
  }
}

function validateCurrentProject(currentProject) {
  exactKeys(currentProject, [
    "summary", "north_star", "users", "accepted_capabilities", "working_unaccepted", "unavailable",
    "known_flaws", "deferred", "current_recommendation",
  ], "owner review current project");
  safeText(currentProject.summary, "current project summary");
  safeText(currentProject.north_star, "current project North Star", {nullable: true});
  for (const field of ["users", "accepted_capabilities", "working_unaccepted", "unavailable", "known_flaws", "deferred"]) {
    validateTextArray(currentProject[field], `current project ${field}`);
  }
  safeText(currentProject.current_recommendation, "current project recommendation");
}

function validateQuestionInventory(inventory) {
  exactKeys(inventory, QUESTION_ROOTS, "owner review question inventory");
  for (const root of QUESTION_ROOTS) {
    validateTextArray(inventory[root], `owner review ${root} question inventory`);
    assert(inventory[root].every((questionId) => questionId.startsWith({
      FUNCTION_REQUIREMENTS: "FR-",
      DESIGN_BIBLE: "DB-",
      SECURITY: "SEC-",
    }[root])), `owner review ${root} question inventory contains an ID from another root`);
  }
  assert(QUESTION_ROOTS.some((root) => inventory[root].length > 0), "owner review question inventory is empty");
  return inventory;
}

function validateReviewScope(scope) {
  exactKeys(scope, ["may_change", "may_not_change", "protected_boundaries", "owner_only_decisions"], "owner review scope");
  for (const field of Object.keys(scope)) validateTextArray(scope[field], `owner review ${field}`);
}

function validateCampaignShape(shape) {
  exactKeys(shape, ["owner_outcome", "first_useful_workflow", "proposed_features", "dependencies", "excluded_scope", "campaign_mode", "release_stop", "task_profile"], "owner review campaign shape");
  for (const field of ["owner_outcome", "first_useful_workflow", "campaign_mode", "release_stop"]) safeText(shape[field], `campaign ${field}`);
  for (const field of ["proposed_features", "dependencies", "excluded_scope"]) validateTextArray(shape[field], `campaign ${field}`);
  exactKeys(shape.task_profile, ["difficulty", "time_sensitivity", "cost_sensitivity"], "owner review task profile");
  assert(MODEL_GUIDANCE_DIFFICULTY.includes(shape.task_profile.difficulty), "owner review task difficulty is invalid");
  assert(TASK_TIME_SENSITIVITY.includes(shape.task_profile.time_sensitivity), "owner review task time sensitivity is invalid");
  assert(TASK_TIME_SENSITIVITY.includes(shape.task_profile.cost_sensitivity), "owner review task cost sensitivity is invalid");
}

function validateModelCandidate(candidate, label, {roleRequired = false} = {}) {
  const keys = roleRequired
    ? ["role", "model_class", "available", "completion_floor", "meets_floor", "economics_sha256", "rationale", "guidance", "recommended"]
    : ["level", "model_class", "available", "completion_floor", "meets_floor", "economics_sha256", "rationale", "guidance", "recommended"];
  exactKeys(candidate, keys, label);
  if (roleRequired) assert(MODEL_ROLES.includes(candidate.role), `${label} role is invalid`);
  else assert(["MEDIUM", "HIGH", "EXTRA_HIGH", "PRO"].includes(candidate.level), `${label} review level is invalid`);
  assert(MODEL_CLASSES.includes(candidate.model_class), `${label} model class is invalid`);
  assert(candidate.available === true, `${label} is unavailable`);
  assert(typeof candidate.completion_floor === "number" && candidate.completion_floor >= 0 && candidate.completion_floor <= 1, `${label} completion floor is invalid`);
  assert(candidate.meets_floor === true, `${label} is below its completion floor`);
  requireSha(candidate.economics_sha256, `${label} economics`);
  safeText(candidate.rationale, `${label} rationale`);
  exactKeys(candidate.guidance, ["economy", "speed", "difficulty", "task_fit", "reason"], `${label} guidance`);
  assert(MODEL_GUIDANCE_ECONOMY.includes(candidate.guidance.economy), `${label} guidance economy is invalid`);
  assert(MODEL_GUIDANCE_SPEED.includes(candidate.guidance.speed), `${label} guidance speed is invalid`);
  assert(MODEL_GUIDANCE_DIFFICULTY.includes(candidate.guidance.difficulty), `${label} guidance difficulty is invalid`);
  assert(MODEL_GUIDANCE_FIT.includes(candidate.guidance.task_fit), `${label} guidance task fit is invalid`);
  safeText(candidate.guidance.reason, `${label} guidance reason`);
  assert(typeof candidate.recommended === "boolean", `${label} recommendation flag is invalid`);
}

function validateModelCandidates(modelCandidates) {
  exactKeys(modelCandidates, ["chat_review_levels", "campaign_role_candidates", "economics_snapshot_sha256", "host_catalog_sha256"], "owner review model candidates");
  assert(Array.isArray(modelCandidates.chat_review_levels) && modelCandidates.chat_review_levels.length > 0, "owner review chat model candidates are missing");
  assert(Array.isArray(modelCandidates.campaign_role_candidates) && modelCandidates.campaign_role_candidates.length > 0, "owner review role model candidates are missing");
  modelCandidates.chat_review_levels.forEach((candidate) => validateModelCandidate(candidate, "owner review chat candidate"));
  modelCandidates.campaign_role_candidates.forEach((candidate) => validateModelCandidate(candidate, "owner review role candidate", {roleRequired: true}));
  const recommendedChat = modelCandidates.chat_review_levels.filter((candidate) => candidate.recommended);
  assert(recommendedChat.length === 1, "owner review must have exactly one recommended Chat review level");
  for (const role of MODEL_ROLES) {
    const roleCandidates = modelCandidates.campaign_role_candidates.filter((candidate) => candidate.role === role);
    assert(roleCandidates.length > 0 && roleCandidates.filter((candidate) => candidate.recommended).length === 1, `owner review lacks one recommendation for ${role}`);
  }
  requireSha(modelCandidates.economics_snapshot_sha256, "owner review economics snapshot");
  requireSha(modelCandidates.host_catalog_sha256, "owner review host catalog");
}

function validateReviewEnvelope(review) {
  exactKeys(review, ["review_id", "project_id", "review_type", "created_at", "expires_at"], "owner review envelope");
  requireIdentifier(review.review_id, "owner review ID");
  requireIdentifier(review.project_id, "owner review project ID");
  assert(review.review_type === REVIEW_TYPE, "owner review type is invalid");
  requireUtc(review.created_at, "owner review creation time");
  requireUtc(review.expires_at, "owner review expiry time");
  assert(new Date(review.expires_at) > new Date(review.created_at), "owner review expires before it is created");
}

function packetBody(packet) {
  const body = structuredClone(packet);
  body.packet_sha256 = null;
  return body;
}

export function validateOwnerReviewPacket(packet) {
  exactKeys(packet, [
    "schema", "review", "source_binding", "current_project", "review_scope", "question_ids_by_root", "candidate_campaign", "model_candidates",
    "review_phases", "memory_posture", "voice_recommended", "review_transport", "policy_binding", "transport_binding", "return_contract", "packet_sha256",
  ], "owner review packet");
  assert(packet.schema === "agentos.user_review_handoff.v1", "owner review packet schema mismatch");
  validateReviewEnvelope(packet.review);
  validateSourceBinding(packet.source_binding);
  validateCurrentProject(packet.current_project);
  validateReviewScope(packet.review_scope);
  validateQuestionInventory(packet.question_ids_by_root);
  validateCampaignShape(packet.candidate_campaign);
  validateModelCandidates(packet.model_candidates);
  assert(JSON.stringify(packet.review_phases) === JSON.stringify(REVIEW_PHASES), "owner review phases are not the canonical six phases");
  assert(MEMORY_POSTURES.includes(packet.memory_posture), "owner review memory posture is invalid");
  assert(typeof packet.voice_recommended === "boolean", "owner review voice recommendation is invalid");
  assert(REVIEW_TRANSPORTS.includes(packet.review_transport), "owner review transport is invalid");
  exactKeys(packet.policy_binding, ["policy_epoch", "policy_state_sha256", "transport", "memory_posture", "voice_recommended", "model_profile", "role_models", "binding_sha256"], "owner review policy binding");
  assert(Number.isSafeInteger(packet.policy_binding.policy_epoch) && packet.policy_binding.policy_epoch >= 1, "owner review policy binding epoch is invalid");
  requireSha(packet.policy_binding.policy_state_sha256, "owner review policy binding state");
  assert(packet.policy_binding.policy_epoch === packet.source_binding.policy_epoch && packet.policy_binding.policy_state_sha256 === packet.source_binding.policy_state_sha256, "owner review policy binding differs from source binding");
  assert(packet.policy_binding.transport === packet.review_transport && packet.policy_binding.memory_posture === packet.memory_posture && packet.policy_binding.voice_recommended === packet.voice_recommended, "owner review policy binding differs from packet settings");
  assert(REVIEW_TRANSPORTS.includes(packet.policy_binding.transport) && MEMORY_POSTURES.includes(packet.policy_binding.memory_posture) && typeof packet.policy_binding.voice_recommended === "boolean", "owner review policy binding settings are invalid");
  assert(MODEL_CLASSES.includes(packet.policy_binding.model_profile), "owner review policy model profile is invalid");
  assert(Array.isArray(packet.policy_binding.role_models) && packet.policy_binding.role_models.length === MODEL_ROLES.length, "owner review policy role models are incomplete");
  for (const roleModel of packet.policy_binding.role_models) {
    exactKeys(roleModel, ["role", "model_class"], "owner review policy role model");
    assert(MODEL_ROLES.includes(roleModel.role) && MODEL_CLASSES.includes(roleModel.model_class), "owner review policy role model is invalid");
  }
  assert(packet.policy_binding.binding_sha256 === ownerReviewDigest({...packet.policy_binding, binding_sha256: null}), "owner review policy binding digest mismatch");
  validateTransportBinding(packet.transport_binding, packet.review_transport);
  exactKeys(packet.return_contract, ["schema", "advisory_only", "approval_not_included", "one_json_payload"], "owner review return contract");
  assert(packet.return_contract.schema === "agentos.user_review_return.v1");
  assert(packet.return_contract.advisory_only === true && packet.return_contract.approval_not_included === true && packet.return_contract.one_json_payload === true, "owner review return contract is unsafe");
  requireSha(packet.packet_sha256, "owner review packet digest");
  assert(packet.packet_sha256 === ownerReviewDigest(packetBody(packet)), "owner review packet digest mismatch");
  return packet;
}

export function compileOwnerReviewPacket({
  reviewId,
  projectId,
  createdAtUtc,
  expiresAtUtc,
  sourceBinding,
  currentProject,
  reviewScope,
  questionIdsByRoot,
  candidateCampaign,
  modelCandidates,
  policyState,
  transport = "PRIVATE_MARKDOWN",
  memoryPosture = "PROJECT_ONLY",
  voiceRecommended = true,
  transportBinding = null,
}) {
  requireIdentifier(reviewId, "owner review ID");
  requireIdentifier(projectId, "owner review project ID");
  assert(REVIEW_TRANSPORTS.includes(transport), "owner review transport is invalid");
  assert(MEMORY_POSTURES.includes(memoryPosture), "owner review memory posture is invalid");
  validatePolicyState(policyState);
  validateQuestionInventory(questionIdsByRoot);
  assert(getPolicyValue(policyState, "REVIEW.TRANSPORT") === transport, "owner review transport is not the current global policy value");
  assert(getPolicyValue(policyState, "REVIEW.MEMORY_POSTURE") === memoryPosture, "owner review memory posture is not the current global policy value");
  assert(getPolicyValue(policyState, "REVIEW.VOICE_RECOMMENDED") === voiceRecommended, "owner review voice setting is not the current global policy value");
  const roleModels = MODEL_ROLES.map((role) => ({role, model_class: getPolicyValue(policyState, `MODEL.ROLE.${role}`)}));
  const policyBinding = {
    policy_epoch: policyState.policy_epoch,
    policy_state_sha256: policyState.policy_state_sha256,
    transport,
    memory_posture: memoryPosture,
    voice_recommended: voiceRecommended,
    model_profile: getPolicyValue(policyState, "MODEL.PROFILE"),
    role_models: roleModels,
    binding_sha256: null,
  };
  policyBinding.binding_sha256 = ownerReviewDigest({...policyBinding, binding_sha256: null});
  for (const roleModel of roleModels) {
    const recommended = modelCandidates.campaign_role_candidates.find((candidate) => candidate.role === roleModel.role && candidate.recommended);
    assert(recommended?.model_class === roleModel.model_class, `owner review recommendation for ${roleModel.role} differs from the current global policy`);
  }
  const packet = {
    schema: "agentos.user_review_handoff.v1",
    review: {
      review_id: reviewId,
      project_id: projectId,
      review_type: REVIEW_TYPE,
      created_at: createdAtUtc,
      expires_at: expiresAtUtc,
    },
    source_binding: structuredClone(sourceBinding),
    current_project: structuredClone(currentProject),
    review_scope: structuredClone(reviewScope),
    question_ids_by_root: structuredClone(questionIdsByRoot),
    candidate_campaign: structuredClone(candidateCampaign),
    model_candidates: structuredClone(modelCandidates),
    review_phases: [...REVIEW_PHASES],
    memory_posture: memoryPosture,
    voice_recommended: voiceRecommended,
    review_transport: transport,
    policy_binding: policyBinding,
    transport_binding: transportBinding ?? (transport === "PRIVATE_MARKDOWN" ? {
      kind: transport,
      handoff_locator: `${reviewId}.md`,
      return_locator: `${reviewId}-RETURN.md`,
      repository_digest_sha256: null,
      branch: null,
      commit: null,
      tree: null,
      connector_identity_sha256: null,
      conversation_identity_sha256: null,
      user_authorized: true,
    } : transport === "SHARED_LINK_ADVISORY" ? {
      kind: transport,
      handoff_locator: `${reviewId}.advisory`,
      return_locator: `${reviewId}-RETURN.advisory`,
      repository_digest_sha256: null,
      branch: null,
      commit: null,
      tree: null,
      connector_identity_sha256: null,
      conversation_identity_sha256: null,
      user_authorized: false,
    } : null),
    return_contract: {
      schema: "agentos.user_review_return.v1",
      advisory_only: true,
      approval_not_included: true,
      one_json_payload: true,
    },
    packet_sha256: null,
  };
  packet.packet_sha256 = ownerReviewDigest(packetBody(packet));
  validateOwnerReviewPacket(packet);
  return packet;
}

function validateChanges(changes) {
  exactKeys(changes, CHANGE_BUCKETS, "owner review changes");
  for (const bucket of CHANGE_BUCKETS) validateTextArray(changes[bucket], `owner review ${bucket}`);
}

function validateReviewReturn(returnValue, packet) {
  exactKeys(returnValue, [
    "schema", "review_id", "project_id", "source_policy_epoch", "source_policy_state_sha256", "source_campaign_candidate_sha256",
    "orientation", "intent", "changes", "campaign", "model_preferences", "policy_changes", "owner_soft_confirmations",
    "unresolved", "advisory_only", "source_markdown_sha256", "return_sha256",
  ], "owner review return");
  assert(returnValue.schema === "agentos.user_review_return.v1", "owner review return schema mismatch");
  assert(returnValue.review_id === packet.review.review_id && returnValue.project_id === packet.review.project_id, "owner review return identity mismatch");
  assert(returnValue.source_policy_epoch === packet.source_binding.policy_epoch, "owner review return policy epoch mismatch");
  assert(returnValue.source_policy_state_sha256 === packet.source_binding.policy_state_sha256, "owner review return policy snapshot mismatch");
  assert(returnValue.source_campaign_candidate_sha256 === packet.source_binding.next_campaign_candidate_sha256, "owner review return candidate snapshot mismatch");
  exactKeys(returnValue.orientation, ["owner_confirmed_current_summary", "corrections"], "owner review orientation");
  assert(typeof returnValue.orientation.owner_confirmed_current_summary === "boolean", "owner review orientation confirmation invalid");
  validateTextArray(returnValue.orientation.corrections, "owner review orientation corrections");
  exactKeys(returnValue.intent, ["desired_outcome", "user_and_moment", "rationale", "north_star_change_requested"], "owner review intent");
  for (const field of ["desired_outcome", "user_and_moment", "rationale"]) safeText(returnValue.intent[field], `owner review intent ${field}`);
  safeText(returnValue.intent.north_star_change_requested, "owner review North Star change", {nullable: true});
  validateChanges(returnValue.changes);
  exactKeys(returnValue.campaign, ["proposed_boundary", "first_useful_workflow", "priorities", "deadline", "risk_posture", "task_profile"], "owner review campaign return");
  for (const field of ["proposed_boundary", "first_useful_workflow", "risk_posture"]) safeText(returnValue.campaign[field]);
  validateTextArray(returnValue.campaign.priorities, "owner review campaign priorities");
  safeText(returnValue.campaign.deadline, "owner review deadline", {nullable: true});
  exactKeys(returnValue.campaign.task_profile, ["difficulty", "time_sensitivity", "cost_sensitivity"], "owner review return task profile");
  assert(MODEL_GUIDANCE_DIFFICULTY.includes(returnValue.campaign.task_profile.difficulty), "owner review return task difficulty is invalid");
  assert(TASK_TIME_SENSITIVITY.includes(returnValue.campaign.task_profile.time_sensitivity), "owner review return task time sensitivity is invalid");
  assert(TASK_TIME_SENSITIVITY.includes(returnValue.campaign.task_profile.cost_sensitivity), "owner review return task cost sensitivity is invalid");
  exactKeys(returnValue.model_preferences, ["cost_priority", "speed_priority", "quality_priority", "accepted_chat_level", "campaign_role_preferences"], "owner review model preferences");
  for (const field of ["cost_priority", "speed_priority", "quality_priority"]) assert(typeof returnValue.model_preferences[field] === "number" && returnValue.model_preferences[field] >= 0 && returnValue.model_preferences[field] <= 1, `owner review ${field} invalid`);
  if (returnValue.model_preferences.accepted_chat_level !== null) assert(["MEDIUM", "HIGH", "EXTRA_HIGH", "PRO"].includes(returnValue.model_preferences.accepted_chat_level), "owner review chat level invalid");
  assert(Array.isArray(returnValue.model_preferences.campaign_role_preferences), "owner review role preferences missing");
  const rolePreferences = returnValue.model_preferences.campaign_role_preferences;
  const roleIds = rolePreferences.map((item) => item.role);
  assert(JSON.stringify(roleIds) === JSON.stringify([...roleIds].sort()), "owner review role preferences must be sorted");
  assert(new Set(roleIds).size === roleIds.length, "owner review role preferences contain duplicates");
  for (const preference of rolePreferences) {
    exactKeys(preference, ["role", "model_class"], "owner review role preference");
    assert(MODEL_ROLES.includes(preference.role) && MODEL_CLASSES.includes(preference.model_class), "owner review role preference is invalid");
  }
  assert(Array.isArray(returnValue.policy_changes), "owner review policy changes missing");
  const policyIds = returnValue.policy_changes.map((item) => item.variable_id);
  assert(JSON.stringify(policyIds) === JSON.stringify([...policyIds].sort()), "owner review policy changes must be sorted");
  for (const change of returnValue.policy_changes) {
    exactKeys(change, ["variable_id", "new_value"], "owner review policy change");
    requireIdentifier(change.variable_id, "owner review policy variable");
  }
  exactKeys(returnValue.owner_soft_confirmations, ["intent_confirmed", "change_set_confirmed", "campaign_shape_confirmed", "model_plan_confirmed"], "owner review soft confirmations");
  for (const value of Object.values(returnValue.owner_soft_confirmations)) assert(typeof value === "boolean", "owner review soft confirmation is invalid");
  validateTextArray(returnValue.unresolved, "owner review unresolved items");
  assert(returnValue.advisory_only === true, "owner review return is not advisory-only");
  requireSha(returnValue.source_markdown_sha256, "owner review source Markdown");
  requireSha(returnValue.return_sha256, "owner review return digest");
  assert(returnValue.return_sha256 === ownerReviewDigest({...returnValue, return_sha256: null}), "owner review return digest mismatch");
  return returnValue;
}

export function renderOwnerReviewMarkdown(packet) {
  validateOwnerReviewPacket(packet);
  const chat = recommendedChat(packet);
  const friendlyLevel = {MEDIUM: "a quick, economical conversation", HIGH: "a deeper conversation", EXTRA_HIGH: "a very careful conversation", PRO: "the most capable available conversation"}[chat.level] ?? "a suitable conversation";
  const friendlyModel = (modelClass) => ({
    HOST_DEFAULT: "the host's normal choice", ECONOMICAL: "the economical choice", BALANCED: "a balanced choice",
    PERFORMANCE: "a performance-focused choice", FRONTIER: "the strongest choice",
  }[modelClass] ?? "the recommended choice");
  const roleLabels = {
    CAMPAIGN_ORCHESTRATOR: "overall coordinator", INDEPENDENT_AUDITOR: "independent checker", FEATURE_AGENT: "feature builder",
    PLATFORM_AGENT: "shared technical helper", AUDIT_WORKER: "focused checker", CAMPAIGN_FINALIZER: "senior repairer", RUNTIME: "release and operations helper",
  };
  const recommendedRoles = recommendedRoleModels(packet)
    .map(({role, model_class}) => `- ${roleLabels[role] ?? role}: ${friendlyModel(model_class)}`).join("\n");
  const chatAlternatives = packet.model_candidates.chat_review_levels
    .map((candidate) => `- ${candidate.level}: ${friendlyModel(candidate.model_class)} — ${candidate.guidance.reason} Cost ${candidate.guidance.economy.toLowerCase()}, speed ${candidate.guidance.speed.toLowerCase()}, fit for ${candidate.guidance.difficulty.toLowerCase().replaceAll("_", " ")} work.`)
    .join("\n");
  const roleAlternatives = MODEL_ROLES.map((role) => {
    const label = roleLabels[role] ?? role;
    const candidates = packet.model_candidates.campaign_role_candidates
      .filter((candidate) => candidate.role === role)
      .map((candidate) => `${friendlyModel(candidate.model_class)} — ${candidate.guidance.reason} Cost ${candidate.guidance.economy.toLowerCase()}, speed ${candidate.guidance.speed.toLowerCase()}, fit for ${candidate.guidance.difficulty.toLowerCase().replaceAll("_", " ")} work.`)
      .join("; ");
    return `- ${label}: ${candidates}`;
  }).join("\n");
  const list = (values) => values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- None recorded";
  return [
    "# Let's talk about the next useful step",
    "",
    "This is a private planning conversation about what you want to do next. Nothing will be changed, published, merged, deployed, or spent because of this conversation.",
    "",
    "Talk naturally, as if you were explaining the project to a thoughtful teammate. Short answers are fine, and you can use voice if that is easier.",
    "",
    "## What is true about the project right now",
    "",
    packet.current_project.summary,
    "",
    packet.current_project.north_star === null ? "The long-term direction has not been stated yet." : `The direction so far is: ${packet.current_project.north_star}`,
    "",
    `People involved: ${packet.current_project.users.join(", ")}.`,
    "",
    "Already accepted:", list(packet.current_project.accepted_capabilities), "",
    "Still uncertain or unfinished:", list([...packet.current_project.working_unaccepted, ...packet.current_project.known_flaws, ...packet.current_project.unavailable]), "",
    "## Start with one question", "",
    "What outcome would make the next step worthwhile?",
    "",
    "Answer this one first. The next short question will depend on what you say; you do not need to complete a checklist.",
    "",
    "The current suggested boundary is:", packet.candidate_campaign.owner_outcome, "",
    "The smallest complete result currently suggested is:", packet.candidate_campaign.first_useful_workflow, "",
    "## Model and time suggestion", "",
    `For this conversation, ${friendlyLevel} is suggested. The campaign model suggestions are:`, recommendedRoles, "",
    "Here are the available conversation levels so you can compare the tradeoff:", chatAlternatives, "",
    "Here are the available role choices and how they trade cost, speed, and reasoning:", roleAlternatives, "",
    `This task is currently described as ${packet.candidate_campaign.task_profile.difficulty.toLowerCase().replaceAll("_", " ")} work, with ${packet.candidate_campaign.task_profile.time_sensitivity.toLowerCase()} time sensitivity and ${packet.candidate_campaign.task_profile.cost_sensitivity.toLowerCase()} cost sensitivity.`, "",
    "These are recommendations, not commitments. Tell me if you care most about saving cost, finishing quickly, or getting the strongest reasoning, and I will reflect that preference.",
    "",
    "## How to return the conversation", "",
    "When we are finished, reply with a short note using plain-language headings such as `What I want`, `Who it helps`, `What should change`, `What should stay`, `What can wait`, `Model preference`, and `Anything unresolved`. Do not say that the project changed. AgentOS will turn the note into a bound candidate and show the owner the exact result for separate approval.",
    "",
    `Keep this conversation scoped to review ${packet.review.review_id}; project memory is helpful context, but it never outranks the current project and its boundaries.`,
    "",
  ].join("\n");
}

function markdownSection(markdown, names) {
  const wanted = new Set(names.map((name) => name.trim().toLocaleLowerCase("en-US")));
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const heading = /^#{1,3}[ \t]+(.+?)[ \t]*$/u;
  const start = lines.findIndex((line) => {
    const match = line.match(heading);
    return match !== null && wanted.has(match[1].trim().toLocaleLowerCase("en-US"));
  });
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (heading.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function markdownItems(markdown, names) {
  return markdownSection(markdown, names).split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, "").trim())
    .filter((line) => line.length > 0);
}

function markdownHasSection(markdown, names) {
  const wanted = new Set(names.map((name) => name.trim().toLocaleLowerCase("en-US")));
  const heading = /^#{1,3}[ \t]+(.+?)[ \t]*$/u;
  return markdown.replace(/\r\n?/gu, "\n").split("\n").some((line) => {
    const match = line.match(heading);
    return match !== null && wanted.has(match[1].trim().toLocaleLowerCase("en-US"));
  });
}

function normalizeOptionalItems(values) {
  if (values.length === 1 && /^(?:none|nothing|no(?:ne)? yet|n\/a|not applicable)[.!]?$/iu.test(values[0])) return [];
  return values;
}

function parseNaturalOwnerReviewReturn(markdown, packet) {
  const outcomeNames = ["What I want", "Outcome", "Desired outcome"];
  const userMomentNames = ["Who it helps", "Who this helps", "User and moment"];
  const rationaleNames = ["Why", "Why now", "Reason"];
  const changeNames = ["What should change", "What must change", "Required", "Must have"];
  const modelNames = ["Model preference", "Cost, speed, and quality"];
  const outcome = markdownSection(markdown, outcomeNames) || "Owner outcome was not supplied.";
  const userMoment = markdownSection(markdown, userMomentNames) || "The intended user and moment were not supplied.";
  const rationale = markdownSection(markdown, rationaleNames) || "The reason for the change was not supplied.";
  const required = markdownItems(markdown, ["What should change", "What must change", "Required", "Must have"]);
  const preserve = markdownItems(markdown, ["What should stay", "Preserve", "Keep"]);
  const defer = markdownItems(markdown, ["What can wait", "Defer", "Later"]);
  const nonGoals = markdownItems(markdown, ["What is out of bounds", "Non-goals", "Do not change"]);
  const unresolved = normalizeOptionalItems(markdownItems(markdown, ["Anything unresolved", "Unresolved", "Open questions"]));
  const modelText = markdownSection(markdown, modelNames);
  const missing = [];
  if (!markdownHasSection(markdown, outcomeNames)) missing.push("OWNER_REVIEW_MISSING_INTENT");
  if (!markdownHasSection(markdown, userMomentNames)) missing.push("OWNER_REVIEW_MISSING_USER_MOMENT");
  if (!markdownHasSection(markdown, rationaleNames)) missing.push("OWNER_REVIEW_MISSING_REASON");
  if (!markdownHasSection(markdown, changeNames)) missing.push("OWNER_REVIEW_MISSING_CHANGE_SET");
  if (!markdownHasSection(markdown, modelNames)) missing.push("OWNER_REVIEW_MISSING_MODEL_PREFERENCE");
  if (!markdownHasSection(markdown, ["Current understanding", "Current summary", "What is true"])) missing.push("OWNER_REVIEW_MISSING_ORIENTATION_CONFIRMATION");
  const preference = (pattern, fallback) => new RegExp(`\\b(?:${pattern})\\b`, "iu").test(modelText) ? 1 : fallback;
  const levelMatch = modelText.match(/\b(MEDIUM|HIGH|EXTRA_HIGH|PRO)\b/iu);
  const rolePreferences = [];
  for (const role of MODEL_ROLES) {
    const label = role.replaceAll("_", " ");
    const match = modelText.match(new RegExp(`${label}[^\\n]*(HOST_DEFAULT|ECONOMICAL|BALANCED|PERFORMANCE|FRONTIER)`, "iu"));
    if (match) rolePreferences.push({role, model_class: match[1].toUpperCase()});
  }
  rolePreferences.sort((left, right) => Buffer.compare(Buffer.from(left.role, "utf8"), Buffer.from(right.role, "utf8")));
  const response = {
    schema: "agentos.user_review_return.v1",
    review_id: packet.review.review_id,
    project_id: packet.review.project_id,
    source_policy_epoch: packet.source_binding.policy_epoch,
    source_policy_state_sha256: packet.source_binding.policy_state_sha256,
    source_campaign_candidate_sha256: packet.source_binding.next_campaign_candidate_sha256,
    orientation: {owner_confirmed_current_summary: !missing.includes("OWNER_REVIEW_MISSING_ORIENTATION_CONFIRMATION"), corrections: []},
    intent: {desired_outcome: outcome, user_and_moment: userMoment, rationale, north_star_change_requested: null},
    changes: {required, desired_if_economical: [], preserve, remove: [], defer, non_goals: nonGoals},
    campaign: {
      proposed_boundary: outcome,
      first_useful_workflow: userMoment,
      priorities: required.length > 0 ? required : [outcome],
      deadline: null,
      risk_posture: "Use the smallest reversible route within the stated boundaries.",
      task_profile: structuredClone(packet.candidate_campaign.task_profile),
    },
    model_preferences: {
      cost_priority: preference("cost", 0.5),
      speed_priority: preference("speed", 0.5),
      quality_priority: preference("quality|strongest|reasoning", 0.5),
      accepted_chat_level: levelMatch ? levelMatch[1].toUpperCase() : null,
      campaign_role_preferences: rolePreferences,
    },
    policy_changes: [],
    owner_soft_confirmations: {
      intent_confirmed: !missing.some((item) => ["OWNER_REVIEW_MISSING_INTENT", "OWNER_REVIEW_MISSING_USER_MOMENT", "OWNER_REVIEW_MISSING_REASON"].includes(item)),
      change_set_confirmed: !missing.includes("OWNER_REVIEW_MISSING_CHANGE_SET"),
      campaign_shape_confirmed: !missing.includes("OWNER_REVIEW_MISSING_USER_MOMENT"),
      model_plan_confirmed: !missing.includes("OWNER_REVIEW_MISSING_MODEL_PREFERENCE"),
    },
    unresolved: [...new Set([...unresolved, ...missing])].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    advisory_only: true,
  };
  response.source_markdown_sha256 = crypto.createHash("sha256").update(markdown, "utf8").digest("hex");
  response.return_sha256 = ownerReviewDigest({...response, return_sha256: null});
  validateReviewReturn(response, packet);
  return response;
}

export function parseOwnerReviewReturnMarkdown(markdown, packet) {
  validateOwnerReviewPacket(packet);
  assert(typeof markdown === "string" && markdown.trim().length > 0, "owner review return Markdown must be nonempty");
  const matches = [...markdown.matchAll(/```json\s*([\s\S]*?)```/giu)];
  if (matches.length === 0) return parseNaturalOwnerReviewReturn(markdown, packet);
  assert(matches.length === 1, "owner review return must contain exactly one JSON payload");
  const otherFences = markdown.replace(matches[0][0], "").match(/```/gu);
  assert(!otherFences, "owner review return contains another fenced payload");
  let parsed;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`owner review return JSON is invalid: ${error.message}`);
  }
  parsed.source_markdown_sha256 = crypto.createHash("sha256").update(markdown, "utf8").digest("hex");
  parsed.return_sha256 = ownerReviewDigest({...parsed, return_sha256: null});
  validateReviewReturn(parsed, packet);
  return parsed;
}

function recommendedChat(packet) {
  return packet.model_candidates.chat_review_levels.find((candidate) => candidate.recommended);
}

function recommendedRoleModels(packet) {
  return MODEL_ROLES.map((role) => packet.model_candidates.campaign_role_candidates.find((candidate) => candidate.role === role && candidate.recommended))
    .map((candidate) => ({role: candidate.role, model_class: candidate.model_class}));
}

function classifyReview(packet, response) {
  if (response.unresolved.length > 0
      || response.orientation.owner_confirmed_current_summary !== true
      || Object.values(response.owner_soft_confirmations).some((confirmed) => confirmed !== true)) return "OWNER_BOUNDARY";
  if (response.intent.north_star_change_requested !== null) return "PROJECT_COURSE_CHANGE";
  if (response.campaign.proposed_boundary !== packet.candidate_campaign.owner_outcome) return "PROJECT_COURSE_CHANGE";
  if (response.changes.required.length === 0 && response.changes.desired_if_economical.length === 0
      && response.changes.remove.length === 0 && response.changes.defer.length === 0) return "CURRENT_CAMPAIGN_COMPATIBLE";
  return "NEXT_CAMPAIGN";
}

function validateRequestedModelPreferences(packet, response) {
  const chat = response.model_preferences.accepted_chat_level;
  if (chat !== null) assert(packet.model_candidates.chat_review_levels.some((candidate) => candidate.level === chat && candidate.available && candidate.meets_floor), "requested Chat review level is unavailable or below its floor");
  for (const preference of response.model_preferences.campaign_role_preferences) {
    const candidate = packet.model_candidates.campaign_role_candidates.find((item) => item.role === preference.role && item.model_class === preference.model_class);
    assert(candidate?.available === true && candidate.meets_floor === true, `requested role model is unavailable or below its floor: ${preference.role}`);
  }
}

function candidateBody(candidate) {
  const body = structuredClone(candidate);
  body.candidate_sha256 = null;
  return body;
}

function validateProjectContextAmendment(amendment) {
  if (amendment === null) return null;
  exactKeys(amendment, ["schema", "project_id", "base_context_sha256", "changes", "reason", "authority", "amendment_sha256"], "project context amendment");
  assert(amendment.schema === "agentos.project_context_amendment.v1", "project context amendment schema mismatch");
  requireIdentifier(amendment.project_id, "project context amendment project ID");
  requireSha(amendment.base_context_sha256, "project context amendment base context");
  assert(Array.isArray(amendment.changes) && amendment.changes.length > 0, "project context amendment changes are required");
  const fields = new Set();
  for (const change of amendment.changes) {
    exactKeys(change, ["field", "new_value"], "project context amendment change");
    assert(["north_star", "first_useful_workflow"].includes(change.field) && !fields.has(change.field), "project context amendment field is invalid or duplicated");
    fields.add(change.field);
    safeText(change.new_value, `project context amendment ${change.field}`);
  }
  safeText(amendment.reason, "project context amendment reason");
  assert(amendment.authority === "OWNER_INTENT", "project context amendment authority is invalid");
  requireSha(amendment.amendment_sha256, "project context amendment digest");
  assert(amendment.amendment_sha256 === ownerReviewDigest({...amendment, amendment_sha256: null}), "project context amendment digest mismatch");
  return amendment;
}

export function compileOwnerReviewCandidate({packet, response, policyState, amendmentId = "OWNER-REVIEW-POLICY-AMENDMENT", nowUtc}) {
  validateOwnerReviewPacket(packet);
  validatePolicyState(policyState);
  validateReviewReturn(response, packet);
  assert(policyState.policy_epoch === packet.source_binding.policy_epoch && policyState.policy_state_sha256 === packet.source_binding.policy_state_sha256, "owner review was created from a stale policy state");
  validateRequestedModelPreferences(packet, response);
  requireUtc(nowUtc, "owner review candidate time");
  const classification = classifyReview(packet, response);
  const policyChanges = [...response.policy_changes];
  if (response.intent.north_star_change_requested !== null) {
    assert(!policyChanges.some((change) => change.variable_id === "PROJECT.NORTH_STAR"), "North Star must be represented by the owner intent field only");
    policyChanges.push({variable_id: "PROJECT.NORTH_STAR", new_value: response.intent.north_star_change_requested});
  }
  policyChanges.sort((left, right) => Buffer.compare(Buffer.from(left.variable_id, "utf8"), Buffer.from(right.variable_id, "utf8")));
  const policyAmendment = policyChanges.length === 0 ? null : compilePolicyAmendment({
    state: policyState,
    amendmentId,
    changes: policyChanges,
    request: {
      requested_by: "OWNER",
      authority: response.intent.north_star_change_requested !== null ? "OWNER_INTENT" : "OWNER_BOUNDARY",
      reason: response.intent.north_star_change_requested !== null
        ? "Owner-reviewed North Star change; apply only after exact admission approval."
        : "Owner-reviewed policy change; apply only after exact admission approval.",
      requested_at_utc: nowUtc,
      effective_boundary: classification === "CURRENT_CAMPAIGN_COMPATIBLE" ? "NEXT_CHECKPOINT" : "NEXT_CAMPAIGN",
      approval_state: "PENDING_EXACT_APPROVAL",
    },
    questionIdsByRoot: packet.question_ids_by_root,
  });
  if (policyAmendment) validatePolicyAmendment(policyAmendment);
  const projectContextChanges = response.intent.north_star_change_requested === null
    ? []
    : [{field: "north_star", new_value: response.intent.north_star_change_requested}];
  const projectContextAmendment = projectContextChanges.length === 0 ? null : {
    schema: "agentos.project_context_amendment.v1",
    project_id: packet.review.project_id,
    base_context_sha256: packet.source_binding.project_context_sha256,
    changes: projectContextChanges,
    reason: "Owner-reviewed project-course change; apply only after exact admission approval.",
    authority: "OWNER_INTENT",
    amendment_sha256: null,
  };
  if (projectContextAmendment !== null) {
    projectContextAmendment.amendment_sha256 = ownerReviewDigest({...projectContextAmendment, amendment_sha256: null});
    validateProjectContextAmendment(projectContextAmendment);
  }
  const selectedChat = response.model_preferences.accepted_chat_level === null
    ? recommendedChat(packet).level : response.model_preferences.accepted_chat_level;
  const selectedByRole = new Map(recommendedRoleModels(packet).map((item) => [item.role, item.model_class]));
  for (const preference of response.model_preferences.campaign_role_preferences) selectedByRole.set(preference.role, preference.model_class);
  const selectedRoles = [...selectedByRole.entries()]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
    .map(([role, model_class]) => ({role, model_class}));
  const questionRecompileRoots = response.intent.north_star_change_requested !== null || classification === "PROJECT_COURSE_CHANGE"
    ? [...ACCEPTANCE_ROOTS]
    : [...(policyAmendment?.invalidation_roots ?? [])]
      .filter((root) => ACCEPTANCE_ROOTS.includes(root))
      .sort((left, right) => ACCEPTANCE_ROOTS.indexOf(left) - ACCEPTANCE_ROOTS.indexOf(right));
  const candidate = {
    schema: "agentos.user_review_candidate.v1",
    review_id: packet.review.review_id,
    project_id: packet.review.project_id,
    source_binding: structuredClone(packet.source_binding),
    review_transport: packet.review_transport,
    transport_binding: structuredClone(packet.transport_binding),
    orientation: structuredClone(response.orientation),
    owner_soft_confirmations: structuredClone(response.owner_soft_confirmations),
    unresolved: structuredClone(response.unresolved),
    classification,
    owner_intent: {
      desired_outcome: response.intent.desired_outcome,
      user_and_moment: response.intent.user_and_moment,
      rationale: response.intent.rationale,
      north_star_change_requested: response.intent.north_star_change_requested,
    },
    change_set: structuredClone(response.changes),
    campaign_shape: {
      ...structuredClone(response.campaign),
      release_stop: packet.candidate_campaign.release_stop,
    },
    model_plan: {
      chat_review_level: selectedChat,
      campaign_role_preferences: selectedRoles,
      economics_snapshot_sha256: packet.model_candidates.economics_snapshot_sha256,
      host_catalog_sha256: packet.model_candidates.host_catalog_sha256,
    },
    policy_amendment: policyAmendment,
    policy_amendment_sha256: policyAmendment?.amendment_sha256 ?? null,
    project_context_amendment: projectContextAmendment,
    canon_delta_sha256: ownerReviewDigest({intent: response.intent, changes: response.changes, campaign: response.campaign}),
    question_recompile_roots: questionRecompileRoots,
    protected_boundaries: structuredClone(packet.review_scope.protected_boundaries),
    excluded_scope: structuredClone(packet.candidate_campaign.excluded_scope),
    candidate_status: classification === "OWNER_BOUNDARY" ? "OWNER_REVIEW_HOLD" : "CANDIDATE_ONLY",
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    requires_exact_owner_approval: true,
    created_at_utc: nowUtc,
    candidate_sha256: null,
  };
  candidate.candidate_sha256 = ownerReviewDigest(candidateBody(candidate));
  return validateOwnerReviewCandidate(candidate);
}

export function validateOwnerReviewCandidate(candidate) {
  exactKeys(candidate, [
    "schema", "review_id", "project_id", "source_binding", "review_transport", "transport_binding", "orientation", "owner_soft_confirmations", "unresolved", "classification", "owner_intent", "change_set", "campaign_shape",
    "model_plan", "policy_amendment", "policy_amendment_sha256", "project_context_amendment", "canon_delta_sha256", "question_recompile_roots", "protected_boundaries",
    "excluded_scope", "candidate_status", "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed",
    "requires_exact_owner_approval", "created_at_utc", "candidate_sha256",
  ], "owner review candidate");
  assert(candidate.schema === "agentos.user_review_candidate.v1", "owner review candidate schema mismatch");
  requireIdentifier(candidate.review_id, "owner review candidate review ID");
  requireIdentifier(candidate.project_id, "owner review candidate project ID");
  validateSourceBinding(candidate.source_binding);
  assert(REVIEW_TRANSPORTS.includes(candidate.review_transport), "owner review candidate transport is invalid");
  validateTransportBinding(candidate.transport_binding, candidate.review_transport);
  exactKeys(candidate.orientation, ["owner_confirmed_current_summary", "corrections"], "owner review candidate orientation");
  assert(typeof candidate.orientation.owner_confirmed_current_summary === "boolean", "owner review candidate orientation confirmation invalid");
  validateTextArray(candidate.orientation.corrections, "owner review candidate orientation corrections");
  exactKeys(candidate.owner_soft_confirmations, ["intent_confirmed", "change_set_confirmed", "campaign_shape_confirmed", "model_plan_confirmed"], "owner review candidate confirmations");
  for (const confirmed of Object.values(candidate.owner_soft_confirmations)) assert(typeof confirmed === "boolean", "owner review candidate confirmation is invalid");
  validateTextArray(candidate.unresolved, "owner review candidate unresolved items");
  assert(REVIEW_CLASSIFICATIONS.includes(candidate.classification), "owner review candidate classification invalid");
  exactKeys(candidate.owner_intent, ["desired_outcome", "user_and_moment", "rationale", "north_star_change_requested"], "owner review candidate intent");
  for (const field of ["desired_outcome", "user_and_moment", "rationale"]) safeText(candidate.owner_intent[field]);
  safeText(candidate.owner_intent.north_star_change_requested, "owner review candidate North Star change", {nullable: true});
  validateChanges(candidate.change_set);
  validateCampaignShape({
    owner_outcome: candidate.campaign_shape.proposed_boundary,
    first_useful_workflow: candidate.campaign_shape.first_useful_workflow,
    proposed_features: candidate.change_set.required,
    dependencies: [],
    excluded_scope: candidate.excluded_scope,
    campaign_mode: "OWNER_REVIEW_CANDIDATE",
    release_stop: candidate.campaign_shape.risk_posture,
    task_profile: candidate.campaign_shape.task_profile,
  });
  exactKeys(candidate.model_plan, ["chat_review_level", "campaign_role_preferences", "economics_snapshot_sha256", "host_catalog_sha256"], "owner review candidate model plan");
  assert(["MEDIUM", "HIGH", "EXTRA_HIGH", "PRO"].includes(candidate.model_plan.chat_review_level), "owner review candidate chat level invalid");
  const roles = candidate.model_plan.campaign_role_preferences.map((item) => item.role);
  assert(JSON.stringify(roles) === JSON.stringify([...roles].sort()), "owner review candidate roles must be sorted");
  assert(JSON.stringify(roles) === JSON.stringify([...MODEL_ROLES].sort()), "owner review candidate role plan must cover every role exactly once");
  candidate.model_plan.campaign_role_preferences.forEach((item) => {
    exactKeys(item, ["role", "model_class"], "owner review candidate role plan");
    assert(MODEL_ROLES.includes(item.role) && MODEL_CLASSES.includes(item.model_class), "owner review candidate role plan invalid");
  });
  requireSha(candidate.model_plan.economics_snapshot_sha256, "owner review candidate economics");
  requireSha(candidate.model_plan.host_catalog_sha256, "owner review candidate catalog");
  if (candidate.policy_amendment !== null) {
    validatePolicyAmendment(candidate.policy_amendment);
    assert(candidate.policy_amendment_sha256 === candidate.policy_amendment.amendment_sha256, "owner review policy amendment digest mismatch");
  } else assert(candidate.policy_amendment_sha256 === null, "owner review candidate has a missing policy amendment");
  validateProjectContextAmendment(candidate.project_context_amendment);
  if (candidate.project_context_amendment !== null) {
    assert(candidate.project_context_amendment.project_id === candidate.project_id, "project context amendment project mismatch");
    assert(candidate.project_context_amendment.base_context_sha256 === candidate.source_binding.project_context_sha256, "project context amendment base mismatch");
  }
  requireSha(candidate.canon_delta_sha256, "owner review Canon delta");
  assert(candidate.question_recompile_roots.every((root) => ACCEPTANCE_ROOTS.includes(root)), "owner review question root is invalid");
  assert(JSON.stringify(candidate.question_recompile_roots) === JSON.stringify(ACCEPTANCE_ROOTS.slice().filter((root) => candidate.question_recompile_roots.includes(root))), "owner review question roots must retain acceptance order");
  validateTextArray(candidate.protected_boundaries, "owner review candidate protected boundaries");
  validateTextArray(candidate.excluded_scope, "owner review candidate excluded scope");
  assert(["CANDIDATE_ONLY", "OWNER_REVIEW_HOLD"].includes(candidate.candidate_status), "owner review candidate status is invalid");
  if (candidate.candidate_status === "CANDIDATE_ONLY") {
    assert(candidate.unresolved.length === 0 && candidate.orientation.owner_confirmed_current_summary === true
      && Object.values(candidate.owner_soft_confirmations).every((confirmed) => confirmed === true),
    "owner review candidate was admitted before the owner completed the conversation");
  } else assert(candidate.unresolved.length > 0 || candidate.orientation.owner_confirmed_current_summary === false
    || Object.values(candidate.owner_soft_confirmations).some((confirmed) => confirmed === false),
  "owner review hold lacks an unresolved owner confirmation");
  assert(candidate.active_campaign === false && candidate.product_writes_allowed === false && candidate.product_agent_spawns_allowed === false && candidate.deployment_allowed === false && candidate.requires_exact_owner_approval === true, "owner review candidate crossed the pre-admission boundary");
  requireUtc(candidate.created_at_utc, "owner review candidate time");
  requireSha(candidate.candidate_sha256, "owner review candidate digest");
  assert(candidate.candidate_sha256 === ownerReviewDigest(candidateBody(candidate)), "owner review candidate digest mismatch");
  return candidate;
}

function approvalPacketBody(packet) {
  const body = structuredClone(packet);
  body.approval_packet_sha256 = null;
  return body;
}

export function compileOwnerApprovalPacket({candidate, packet, policyState}) {
  validateOwnerReviewPacket(packet);
  validateOwnerReviewCandidate(candidate);
  validatePolicyState(policyState);
  assert(candidate.review_id === packet.review.review_id && candidate.project_id === packet.review.project_id, "approval packet identity mismatch");
  assert(candidate.source_binding.policy_epoch === policyState.policy_epoch
    && candidate.source_binding.policy_state_sha256 === policyState.policy_state_sha256,
  "owner review approval packet policy state is stale");
  const sharedLink = packet.review_transport === "SHARED_LINK_ADVISORY";
  const configuredRoute = getPolicyValue(policyState, "REVIEW.APPROVAL_ROUTE");
  const candidateReady = candidate.candidate_status === "CANDIDATE_ONLY"
    && candidate.unresolved.length === 0
    && candidate.orientation.owner_confirmed_current_summary === true
    && Object.values(candidate.owner_soft_confirmations).every((confirmed) => confirmed === true);
  const approvalPacket = {
    schema: "agentos.owner_review_approval_packet.v1",
    review_id: candidate.review_id,
    project_id: candidate.project_id,
    source_policy_epoch: candidate.source_binding.policy_epoch,
    source_policy_state_sha256: candidate.source_binding.policy_state_sha256,
    candidate_sha256: candidate.candidate_sha256,
    policy_amendment_sha256: candidate.policy_amendment_sha256,
    exact_candidate: structuredClone(candidate),
    protected_boundaries: structuredClone(candidate.protected_boundaries),
    excluded_scope: structuredClone(candidate.excluded_scope),
    release_stop: candidate.campaign_shape.release_stop,
    approval_state: "PENDING_EXACT_APPROVAL",
    approval_allowed: !sharedLink && candidateReady,
    configured_approval_route: sharedLink || !candidateReady ? null : configuredRoute,
    allowed_approval_routes: sharedLink || !candidateReady ? [] : [configuredRoute],
    forbidden_routes: ["OWNER_CONVERSATIONAL_CONFIRMATION", "SHARED_LINK_ADVISORY"],
    activation_effect: "Admit the exact candidate to the Orchestrator; do not spawn or deploy from this packet.",
    approval_packet_sha256: null,
  };
  approvalPacket.approval_packet_sha256 = ownerReviewDigest(approvalPacketBody(approvalPacket));
  return validateOwnerApprovalPacket(approvalPacket);
}

export function validateOwnerApprovalPacket(packet) {
  exactKeys(packet, [
    "schema", "review_id", "project_id", "source_policy_epoch", "source_policy_state_sha256", "candidate_sha256", "policy_amendment_sha256",
    "exact_candidate", "protected_boundaries", "excluded_scope", "release_stop", "approval_state", "approval_allowed", "allowed_approval_routes",
    "configured_approval_route", "forbidden_routes", "activation_effect", "approval_packet_sha256",
  ], "owner review approval packet");
  assert(packet.schema === "agentos.owner_review_approval_packet.v1", "owner review approval packet schema mismatch");
  validateOwnerReviewCandidate(packet.exact_candidate);
  assert(packet.exact_candidate.candidate_sha256 === packet.candidate_sha256, "approval packet candidate mismatch");
  assert(packet.review_id === packet.exact_candidate.review_id && packet.project_id === packet.exact_candidate.project_id, "approval packet envelope does not bind to candidate");
  assert(packet.source_policy_epoch === packet.exact_candidate.source_binding.policy_epoch && packet.source_policy_state_sha256 === packet.exact_candidate.source_binding.policy_state_sha256, "approval packet policy source does not bind to candidate");
  assert(packet.policy_amendment_sha256 === packet.exact_candidate.policy_amendment_sha256, "approval packet amendment does not bind to candidate");
  requireSha(packet.source_policy_state_sha256, "approval packet policy state");
  requireSha(packet.candidate_sha256, "approval packet candidate digest");
  if (packet.policy_amendment_sha256 !== null) requireSha(packet.policy_amendment_sha256, "approval packet policy amendment");
  validateTextArray(packet.protected_boundaries, "approval packet protected boundaries");
  validateTextArray(packet.excluded_scope, "approval packet excluded scope");
  safeText(packet.release_stop, "approval packet release stop");
  assert(packet.approval_state === "PENDING_EXACT_APPROVAL", "approval packet is not pending exact approval");
  assert(typeof packet.approval_allowed === "boolean", "approval packet allowance invalid");
  sortedStrings(packet.allowed_approval_routes, "approval packet routes", {allowEmpty: true});
  assert(packet.approval_allowed === (packet.allowed_approval_routes.length > 0), "approval packet route allowance is inconsistent");
  if (packet.exact_candidate.candidate_status === "OWNER_REVIEW_HOLD") assert(packet.approval_allowed === false, "owner review hold cannot be approved");
  if (packet.approval_allowed) {
    assert(APPROVAL_ROUTES.includes(packet.configured_approval_route), "approval packet configured route is invalid");
    assert(packet.allowed_approval_routes.length === 1 && packet.allowed_approval_routes[0] === packet.configured_approval_route,
      "approval packet routes are not bound to the configured policy route");
  } else assert(packet.configured_approval_route === null, "advisory approval packet carries an approval route");
  sortedStrings(packet.forbidden_routes, "approval packet forbidden routes");
  safeText(packet.activation_effect, "approval packet activation effect");
  requireSha(packet.approval_packet_sha256, "approval packet digest");
  assert(packet.approval_packet_sha256 === ownerReviewDigest(approvalPacketBody(packet)), "approval packet digest mismatch");
  return packet;
}

function approvalBody(approval) {
  const body = structuredClone(approval);
  body.approval_sha256 = null;
  return body;
}

export function compileOwnerApproval({approvalPacket, approvalState = "OWNER_AUTHENTICATED_EXACT_APPROVAL", approvedAtUtc, actorDigestSha256, approvalRoute = "DIRECT_AGENTOS_CONFIRMATION"}) {
  validateOwnerApprovalPacket(approvalPacket);
  assert(approvalState === "OWNER_AUTHENTICATED_EXACT_APPROVAL", "owner review admission requires authenticated exact approval");
  assert(approvalPacket.approval_allowed === true && approvalPacket.allowed_approval_routes.includes(approvalRoute), "approval route is not allowed for this review transport");
  requireUtc(approvedAtUtc, "owner review approval time");
  requireSha(actorDigestSha256, "owner review actor digest");
  const approval = {
    schema: "agentos.owner_review_approval.v1",
    approval_state: approvalState,
    approval_route: approvalRoute,
    review_id: approvalPacket.review_id,
    candidate_sha256: approvalPacket.candidate_sha256,
    approval_packet_sha256: approvalPacket.approval_packet_sha256,
    approved_at_utc: approvedAtUtc,
    actor_digest_sha256: actorDigestSha256,
    approval_sha256: null,
  };
  approval.approval_sha256 = ownerReviewDigest(approvalBody(approval));
  return approval;
}

export function applyOwnerReviewApproval({candidate, approvalPacket, approval, policyState, currentBoundary = "NEXT_CAMPAIGN", policyStatePath = null, projectContextPath = null}) {
  validateOwnerReviewCandidate(candidate);
  validateOwnerApprovalPacket(approvalPacket);
  validatePolicyState(policyState);
  exactKeys(approval, [
    "schema", "approval_state", "approval_route", "review_id", "candidate_sha256", "approval_packet_sha256",
    "approved_at_utc", "actor_digest_sha256", "approval_sha256",
  ], "owner review approval");
  assert(approval.schema === "agentos.owner_review_approval.v1" && approval.approval_state === "OWNER_AUTHENTICATED_EXACT_APPROVAL", "owner review approval is not authenticated exact approval");
  assert(approval.review_id === candidate.review_id && approval.candidate_sha256 === candidate.candidate_sha256 && approval.approval_packet_sha256 === approvalPacket.approval_packet_sha256, "owner review approval targets a different candidate");
  assert(approvalPacket.exact_candidate.candidate_sha256 === candidate.candidate_sha256, "approval packet is not bound to candidate");
  assert(approvalPacket.approval_allowed === true && approvalPacket.allowed_approval_routes.includes(approval.approval_route), "owner review approval route is not allowed");
  assert(approval.approval_route === getPolicyValue(policyState, "REVIEW.APPROVAL_ROUTE"),
    "owner review approval route does not match the current global policy");
  requireUtc(approval.approved_at_utc, "owner review approval time");
  requireSha(approval.actor_digest_sha256, "owner review actor digest");
  requireSha(approval.approval_sha256, "owner review approval digest");
  assert(approval.approval_sha256 === ownerReviewDigest(approvalBody(approval)), "owner review approval digest mismatch");
  assert(candidate.source_binding.policy_state_sha256 === policyState.policy_state_sha256 && candidate.source_binding.policy_epoch === policyState.policy_epoch, "owner review candidate policy state is stale");
  let nextPolicyState = policyState;
  if (candidate.policy_amendment !== null) {
    const policyApproval = compilePolicyApproval({
      amendment: candidate.policy_amendment,
      approvedAtUtc: approval.approved_at_utc,
      actorDigestSha256: approval.actor_digest_sha256,
    });
    nextPolicyState = applyPolicyAmendment({state: policyState, amendment: candidate.policy_amendment, approval: policyApproval, currentBoundary});
  }
  let policyPersistence = null;
  if (policyStatePath !== null) {
    const persisted = writePolicyStateCompareAndSwap({
      filePath: policyStatePath,
      expectedPolicyStateSha256: policyState.policy_state_sha256,
      nextState: nextPolicyState,
    });
    nextPolicyState = persisted.state;
    policyPersistence = {
      write_receipt_sha256: persisted.write_receipt_sha256,
      policy_state_sha256: persisted.state.policy_state_sha256,
    };
  }
  let projectContextPersistence = null;
  if (projectContextPath !== null && candidate.project_context_amendment !== null) {
    projectContextPersistence = writeProjectContextCompareAndSwap({
      filePath: projectContextPath,
      expectedContextSha256: candidate.project_context_amendment.base_context_sha256,
      changes: candidate.project_context_amendment.changes,
      amendmentSha256: candidate.project_context_amendment.amendment_sha256,
    });
  }
  const admission = {
    schema: "agentos.owner_review_admission.v1",
    review_id: candidate.review_id,
    project_id: candidate.project_id,
    candidate_sha256: candidate.candidate_sha256,
    approval_packet_sha256: approvalPacket.approval_packet_sha256,
    approval_sha256: approval.approval_sha256,
    policy_state_sha256: nextPolicyState.policy_state_sha256,
    policy_epoch: nextPolicyState.policy_epoch,
    status: "ADMITTED_NEXT_CAMPAIGN",
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    next_action: "The Campaign Orchestrator may reconcile this exact candidate and create the normal admitted campaign roster.",
    owner_review_consumed: true,
    admission_sha256: null,
  };
  admission.admission_sha256 = ownerReviewDigest({...admission, admission_sha256: null});
  return {policyState: nextPolicyState, policyPersistence, projectContextPersistence, projectContextAmendment: candidate.project_context_amendment, admission};
}

export function cancelOwnerReview({packet, reason, cancelledAtUtc}) {
  validateOwnerReviewPacket(packet);
  safeText(reason, "owner review cancellation reason");
  requireUtc(cancelledAtUtc, "owner review cancellation time");
  const cancellation = {
    schema: "agentos.owner_review_cancellation.v1",
    review_id: packet.review.review_id,
    packet_sha256: packet.packet_sha256,
    status: "CANCELLED",
    current_policy_unchanged: true,
    current_campaign_unchanged: true,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    reason,
    cancelled_at_utc: cancelledAtUtc,
    cancellation_sha256: null,
  };
  cancellation.cancellation_sha256 = ownerReviewDigest({...cancellation, cancellation_sha256: null});
  return cancellation;
}
