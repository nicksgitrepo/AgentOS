#!/usr/bin/env node

/*
 * Host boundary for real campaign sessions.
 *
 * AgentOS records the request and validates the host readback when the external
 * host supplies one. When the host accepts the requested model/reasoning combination
 * but does not expose those fields in its receipt, the active host route binds
 * the requested execution identity without inventing a host readback. It
 * never uses a child process, a shell worker, a daemon, or copied chat history
 * as a campaign role.
 */

import crypto from "node:crypto";
import {
  DEFAULT_AGENT_MODEL as HOST_DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_REASONING_EFFORT as HOST_DEFAULT_AGENT_REASONING_EFFORT,
  NATIVE_SESSION_TOOLS as HOST_NATIVE_SESSION_TOOLS,
} from "./native-host-contract.mjs";
import {bindNativeHost, validateNativeHostAttachment} from "./native-host-attachment.mjs";
import {
  TASK_GATE_CATALOG_SHA256,
  TASK_GATE_CONTEXTS,
  taskGateInstructionText,
  taskGateQuestionIds,
} from "./task-gate-questions.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const HOST_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLIENT_THREAD_IDENTIFIER = /^client-new-thread:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const DEFAULT_AGENT_MODEL = HOST_DEFAULT_AGENT_MODEL;
export const DEFAULT_AGENT_REASONING_EFFORT = HOST_DEFAULT_AGENT_REASONING_EFFORT;
export const DEFAULT_AGENT_EXECUTION = Object.freeze({
  model: DEFAULT_AGENT_MODEL,
  reasoning_effort: DEFAULT_AGENT_REASONING_EFFORT,
});
export const DEFAULT_PROGRESS_REVIEW_MINUTES = 15;
export const DEFAULT_PROGRESS_REVIEW_TIMEOUT_MS = DEFAULT_PROGRESS_REVIEW_MINUTES * 60 * 1000;

export const NATIVE_SESSION_TOOLS = HOST_NATIVE_SESSION_TOOLS;

export const FORBIDDEN_SESSION_SUBSTITUTES = Object.freeze([
  "SUBAGENT",
  "SHELL_WORKER",
  "LOCAL_DAEMON",
  "FORKED_HISTORY_AS_ROLE",
]);

export const NATIVE_SESSION_WORKTREE_MODES = Object.freeze([
  "PROJECT_LOCAL_SESSION",
  "ISOLATED_WORKTREE",
]);

export const FOUNDATION_LANE_ROLES = Object.freeze([
  Object.freeze({role: "FOUNDATION_INTENT_AND_SCOPE", display_name: "Intent and scope", lane_file: "docs/rapid-foundations/01-intent-and-scope.md"}),
  Object.freeze({role: "FOUNDATION_BOOTSTRAP_AND_CONTEXT", display_name: "Bootstrap and context", lane_file: "docs/rapid-foundations/02-bootstrap-and-context.md"}),
  Object.freeze({role: "FOUNDATION_USER_CONVERSATION", display_name: "User conversation", lane_file: "docs/rapid-foundations/03-user-conversation.md"}),
  Object.freeze({role: "FOUNDATION_ROLE_ROUTING", display_name: "Role routing", lane_file: "docs/rapid-foundations/04-role-routing.md"}),
  Object.freeze({role: "FOUNDATION_PROGRESS_AND_HEALTH", display_name: "Progress and health", lane_file: "docs/rapid-foundations/05-progress-and-health.md"}),
  Object.freeze({role: "FOUNDATION_FUNCTIONALITY", display_name: "Functionality", lane_file: "docs/rapid-foundations/06-functionality.md"}),
  Object.freeze({role: "FOUNDATION_UI_UX", display_name: "UI/UX", lane_file: "docs/rapid-foundations/07-ui-ux.md"}),
  Object.freeze({role: "FOUNDATION_CODE_HYGIENE", display_name: "Code hygiene", lane_file: "docs/rapid-foundations/08-code-hygiene.md"}),
  Object.freeze({role: "FOUNDATION_SECURITY_AND_PRIVACY", display_name: "Security and privacy", lane_file: "docs/rapid-foundations/09-security-and-privacy.md"}),
  Object.freeze({role: "FOUNDATION_EVIDENCE_AND_IDENTITY", display_name: "Evidence and identity", lane_file: "docs/rapid-foundations/10-evidence-and-identity.md"}),
  Object.freeze({role: "FOUNDATION_RECOVERY_AND_BOUNDARIES", display_name: "Recovery and boundaries", lane_file: "docs/rapid-foundations/11-recovery-and-boundaries.md"}),
  Object.freeze({role: "FOUNDATION_DELIVERY_AND_CLOSURE", display_name: "Delivery and closure", lane_file: "docs/rapid-foundations/12-delivery-and-closure.md"}),
]);

export const IMPLEMENTATION_LANE_ROLES = Object.freeze([
  Object.freeze({role: "IMPLEMENTATION_INTENT_AND_SCOPE", display_name: "Intent and scope behavior", lane_file: null, implementation_files: ["control/rapid-prototype/intent-scope.mjs", "tests/rapid-prototype/intent-scope.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_BOOTSTRAP_AND_CONTEXT", display_name: "Bootstrap and context behavior", lane_file: null, implementation_files: ["control/rapid-prototype/bootstrap-context.mjs", "tests/rapid-prototype/bootstrap-context.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_USER_CONVERSATION", display_name: "User conversation behavior", lane_file: null, implementation_files: ["control/rapid-prototype/user-conversation.mjs", "tests/rapid-prototype/user-conversation.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_ROLE_ROUTING", display_name: "Role routing behavior", lane_file: null, implementation_files: ["control/rapid-prototype/role-routing.mjs", "tests/rapid-prototype/role-routing.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_PROGRESS_AND_HEALTH", display_name: "Progress and health behavior", lane_file: null, implementation_files: ["control/rapid-prototype/progress-health.mjs", "tests/rapid-prototype/progress-health.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_FUNCTIONALITY", display_name: "Functionality behavior", lane_file: null, implementation_files: ["control/rapid-prototype/functionality.mjs", "tests/rapid-prototype/functionality.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_UI_UX", display_name: "UI/UX behavior", lane_file: null, implementation_files: ["control/rapid-prototype/ui-ux.mjs", "tests/rapid-prototype/ui-ux.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_CODE_HYGIENE", display_name: "Code hygiene behavior", lane_file: null, implementation_files: ["control/rapid-prototype/code-hygiene.mjs", "tests/rapid-prototype/code-hygiene.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_SECURITY_AND_PRIVACY", display_name: "Security and privacy behavior", lane_file: null, implementation_files: ["control/rapid-prototype/security-privacy.mjs", "tests/rapid-prototype/security-privacy.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_EVIDENCE_AND_IDENTITY", display_name: "Evidence and identity behavior", lane_file: null, implementation_files: ["control/rapid-prototype/evidence-identity.mjs", "tests/rapid-prototype/evidence-identity.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_RECOVERY_AND_BOUNDARIES", display_name: "Recovery and boundaries behavior", lane_file: null, implementation_files: ["control/rapid-prototype/recovery-boundaries.mjs", "tests/rapid-prototype/recovery-boundaries.mjs"]}),
  Object.freeze({role: "IMPLEMENTATION_DELIVERY_AND_CLOSURE", display_name: "Delivery and closure behavior", lane_file: null, implementation_files: ["control/rapid-prototype/delivery-closure.mjs", "tests/rapid-prototype/delivery-closure.mjs"]}),
]);

export const TAILORED_CAMPAIGN_ROLES = Object.freeze([
  Object.freeze({role: "CAMPAIGN_ORCHESTRATOR", display_name: "Campaign Orchestrator", lane_file: null}),
  Object.freeze({role: "FEATURE_AGENT", display_name: "Feature Agent", lane_file: null}),
  Object.freeze({role: "FOUNDATION_CLEARANCE_AUDITOR", display_name: "Foundation Clearance Auditor", lane_file: null}),
  Object.freeze({role: "RAPID_SLICE_BUILDER", display_name: "Rapid Slice Builder", lane_file: null}),
  Object.freeze({role: "INDEPENDENT_AUDITOR", display_name: "Independent Auditor", lane_file: null}),
]);

// Compatibility export for callers that use the old function name. The plan
// now admits only the twelve explicit foundation lanes in its first phase.
export const CAMPAIGN_TEAM_ROLES = FOUNDATION_LANE_ROLES;
export const NATIVE_SESSION_ROLES = Object.freeze([...FOUNDATION_LANE_ROLES, ...IMPLEMENTATION_LANE_ROLES, ...TAILORED_CAMPAIGN_ROLES]);

export const NATIVE_SESSION_REQUEST_SCHEMA = "agentos.native_session_spawn_request.v1";
export const NATIVE_SESSION_READBACK_SCHEMA = "agentos.native_session_spawn_readback.v1";
export const NATIVE_SESSION_UNAVAILABLE_SCHEMA = "agentos.native_session_unavailable_boundary.v1";
export const NATIVE_SESSION_HOST_IDENTITY_BOUNDARY_SCHEMA = "agentos.native_session_host_identity_boundary.v1";
export const NATIVE_SESSION_OPERATION_SCHEMA = "agentos.native_session_operation_readback.v1";
export const NATIVE_SESSION_RECORD_SCHEMA = "agentos.native_session_record.v1";
export const NATIVE_SESSION_CLOSURE_RECEIPT_SCHEMA = "agentos.native_session_closure_receipt.v1";
export const NATIVE_TEAM_PLAN_SCHEMA = "agentos.native_rapid_foundation_team_plan.v1";
export const NATIVE_IMPLEMENTATION_TEAM_PLAN_SCHEMA = "agentos.native_rapid_implementation_team_plan.v1";
export const NATIVE_IMPLEMENTATION_LANE_HANDOFF_SCHEMA = "agentos.native_implementation_lane_handoff.v1";
export const NATIVE_IMPLEMENTATION_LANE_HANDOFF_HOST_RECEIPTS = Object.freeze([
  "create_thread",
  "pin",
  "send",
  "wait",
  "read",
  "unpin",
  "archive",
  "post_close_read",
  "active_list_absent",
]);

export const NATIVE_SESSION_OPERATIONS = Object.freeze([
  "PIN",
  "SEND",
  "READBACK",
  "WAIT",
  "UNPIN",
  "ARCHIVE",
  "REMOVE_FROM_ROSTER",
]);

export const NATIVE_SESSION_CLOSURE_LIFECYCLE = Object.freeze([
  "PRESERVE_TYPED_HANDOFF",
  "UNPIN",
  "ARCHIVE",
  "REMOVE_FROM_ACTIVE_ROSTER",
  "VERIFY_ZERO_ACTIVE",
]);

export const NATIVE_SESSION_REQUIRED_HOST_OPERATIONS = Object.freeze([...NATIVE_SESSION_TOOLS].sort());

export class NativeSessionBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "NativeSessionBoundaryError";
    this.code = code;
    Object.assign(this, details);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireNullableString(value, label) {
  if (value !== null) requireString(value, label);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}

function roleDefinition(role) {
  const definition = NATIVE_SESSION_ROLES.find((candidate) => candidate.role === role);
  assert(definition !== undefined, `unsupported native campaign role: ${role}`);
  return definition;
}

function validateDisplayName(displayName, definition, campaignVersion, label) {
  requireString(displayName, label);
  const accepted = new Set([definition.display_name, `${definition.display_name} ${campaignVersion}`]);
  assert(accepted.has(displayName), `${label} does not identify the admitted role and campaign version`);
}

function sortedTools(tools) {
  assert(Array.isArray(tools) && tools.length > 0, "native session tools are required");
  const normalized = [...tools].sort();
  assert(JSON.stringify(tools) === JSON.stringify(normalized), "native session tools must be sorted");
  assert(new Set(tools).size === tools.length, "native session tools contain duplicates");
  assert(NATIVE_SESSION_TOOLS.every((tool) => tools.includes(tool)), "native session tooling is incomplete");
  return tools;
}

function validateExecution({model, reasoningEffort}) {
  requireString(model, "native session model");
  requireString(reasoningEffort, "native session reasoning effort");
  assert(model !== DEFAULT_AGENT_MODEL && reasoningEffort !== DEFAULT_AGENT_REASONING_EFFORT,
    "MODEL_POLICY_REFRESH_REQUIRED: native session execution must be selected from an accepted current model-policy snapshot");
}

const UNKNOWN_HOST_EXECUTION_VALUES = new Set(["UNKNOWN", "UNAVAILABLE", "NOT_REPORTED", "NOT_AVAILABLE", "N/A"]);

function isKnownHostExecutionValue(value) {
  return typeof value === "string" && value.trim().length > 0 && !UNKNOWN_HOST_EXECUTION_VALUES.has(value.trim().toUpperCase());
}

function isMissingHostExecutionValue(value) {
  return value === null || (typeof value === "string" && UNKNOWN_HOST_EXECUTION_VALUES.has(value.trim().toUpperCase()));
}

function requireHostIdentifier(value, label, {thread = false, clientThread = false} = {}) {
  requireString(value, label);
  assert(HOST_IDENTIFIER.test(value), `${label} is not a stable host identifier`);
  assert(!FORBIDDEN_SESSION_SUBSTITUTES.includes(value.toUpperCase()), `${label} names a forbidden session substitute`);
  assert(!/(?:shell|stdout|stderr|command|exit[_ -]?code|task[_ -]?id|fabricated)/iu.test(value), `${label} contains shell or task text`);
  if (thread) assert(UUID.test(value), `${label} is not a verified host thread ID`);
  if (clientThread) assert(CLIENT_THREAD_IDENTIFIER.test(value), `${label} is not a verified host client-thread ID`);
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function requireNonnegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields mismatch`);
}

function operationDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function digestWithoutField(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return operationDigest(body);
}

export function compileNativeSessionSpawnRequest({
  teamId,
  projectId,
  campaignId,
  campaignVersion,
  role,
  displayName = null,
  task = null,
  prompt = null,
  laneFile = undefined,
  sourceCommit = null,
  sourceTree = null,
  worktreeMode = "PROJECT_LOCAL_SESSION",
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
  tools = [...NATIVE_SESSION_TOOLS].sort(),
}) {
  requireIdentifier(teamId, "native session team ID");
  requireString(projectId, "native session project ID");
  requireIdentifier(campaignId, "native session campaign ID");
  requireString(campaignVersion, "native session campaign version");
  const definition = roleDefinition(role);
  const requestedLaneFile = laneFile === undefined ? definition.lane_file : laneFile;
  requireNullableString(requestedLaneFile, `${role} lane file`);
  assert(requestedLaneFile === definition.lane_file, `${role} lane file is not admitted`);
  if (sourceCommit !== null) requireGitObject(sourceCommit, `${role} source commit`);
  if (sourceTree !== null) requireGitObject(sourceTree, `${role} source tree`);
  assert((sourceCommit === null) === (sourceTree === null), `${role} source commit/tree must be supplied together`);
  assert(NATIVE_SESSION_WORKTREE_MODES.includes(worktreeMode), `${role} uses an unsupported host execution mode`);
  validateExecution({model, reasoningEffort});
  const implementationFiles = definition.implementation_files ?? [];
  const defaultTask = implementationFiles.length > 0
    ? `Implement the ${definition.display_name} behavior in ${implementationFiles[0]} and its focused test in ${implementationFiles[1]}.`
    : `Continue the bounded ${definition.display_name} role for this campaign.`;
  const defaultPrompt = implementationFiles.length > 0
    ? `You are the ${definition.display_name} lane. Write only ${implementationFiles.join(" and ")}; implement real behavior, run the focused test, return typed progress, result, hostile coverage, source readback, changed-path proof, independent-check status, and handoff evidence. Do not create children or use shell stand-ins.`
    : `You are the ${definition.display_name} foundation lane. Write only ${requestedLaneFile}; return typed progress, result, hostile coverage, independent-check status, and handoff evidence. Do not create children or use shell stand-ins.`;
  const normalizedTask = task ?? defaultTask;
  const normalizedPrompt = prompt ?? defaultPrompt;
  const normalizedDisplayName = displayName ?? `${definition.display_name} ${campaignVersion}`;
  validateDisplayName(normalizedDisplayName, definition, campaignVersion, `${role} display name`);
  requireString(normalizedTask, `${role} task`);
  const governedPrompt = normalizedPrompt.includes(`TASK GATES (${TASK_GATE_CATALOG_SHA256})`)
    ? normalizedPrompt
    : `${normalizedPrompt} ${taskGateInstructionText()}`;
  const schedulerPrompt = governedPrompt.includes("shared AgentOS Hybrid Scheduler")
    ? governedPrompt
    : `${governedPrompt} Submit every heavyweight build, compile, test, verification, database, runtime, or artifact operation as one typed candidate-level plan to the shared AgentOS Hybrid Scheduler; never run competing heavyweight operations directly.`;
  requireString(schedulerPrompt, `${role} prompt`);
  const request = {
    schema: NATIVE_SESSION_REQUEST_SCHEMA,
    version: 1,
    status: "REQUESTED",
    team_id: teamId,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    role,
    display_name: normalizedDisplayName,
    lane_file: requestedLaneFile,
    task: normalizedTask,
    prompt: schedulerPrompt,
    model,
    reasoning_effort: reasoningEffort,
    required_tools: sortedTools(tools),
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    task_gate_question_ids_by_context: Object.fromEntries(TASK_GATE_CONTEXTS.map((context) => [context, taskGateQuestionIds(context)])),
    worktree_mode: worktreeMode,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    topology: "INDEPENDENT_SIBLING_SESSION",
    parent_child_relationship: false,
    subagents_allowed: false,
    external_actions_enabled: false,
    request_sha256: null,
  };
  request.request_sha256 = digestWithout(request, "request_sha256");
  return validateNativeSessionSpawnRequest(request);
}

export function validateNativeSessionSpawnRequest(request) {
  const required = [
    "schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "role", "display_name",
    "task", "prompt", "lane_file", "model", "reasoning_effort", "required_tools", "task_gate_catalog_sha256", "task_gate_question_ids_by_context", "worktree_mode", "source_commit", "source_tree",
    "topology", "parent_child_relationship", "subagents_allowed", "external_actions_enabled", "request_sha256",
  ];
  requireRecord(request, "native session spawn request");
  assert(JSON.stringify(Object.keys(request).sort()) === JSON.stringify([...required].sort()), "native session spawn request fields mismatch");
  assert(request.schema === NATIVE_SESSION_REQUEST_SCHEMA && request.version === 1 && request.status === "REQUESTED", "native session spawn request identity is invalid");
  requireIdentifier(request.team_id, "native session request team ID");
  requireString(request.project_id, "native session request project ID");
  requireIdentifier(request.campaign_id, "native session request campaign ID");
  requireString(request.campaign_version, "native session request campaign version");
  const definition = roleDefinition(request.role);
  validateDisplayName(request.display_name, definition, request.campaign_version, `${request.role} request display name`);
  requireString(request.task, `${request.role} task`);
  requireString(request.prompt, `${request.role} prompt`);
  requireNullableString(request.lane_file, `${request.role} lane file`);
  assert(request.lane_file === definition.lane_file, `${request.role} lane file is not admitted`);
  validateExecution({model: request.model, reasoningEffort: request.reasoning_effort});
  sortedTools(request.required_tools);
  requireSha(request.task_gate_catalog_sha256, "native session task-gate catalog digest");
  assert(request.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "native session task-gate catalog binding differs");
  exactKeys(request.task_gate_question_ids_by_context, TASK_GATE_CONTEXTS, "native session task-gate context map");
  for (const context of TASK_GATE_CONTEXTS) assert(JSON.stringify(request.task_gate_question_ids_by_context[context]) === JSON.stringify(taskGateQuestionIds(context)), request.role + " task-gate question map differs for " + context);
  assert(NATIVE_SESSION_WORKTREE_MODES.includes(request.worktree_mode) && request.topology === "INDEPENDENT_SIBLING_SESSION", "native session topology is invalid");
  assert(request.parent_child_relationship === false && request.subagents_allowed === false && request.external_actions_enabled === false, "native session request crossed a boundary");
  requireNullableString(request.source_commit, "native session request source commit");
  requireNullableString(request.source_tree, "native session request source tree");
  assert((request.source_commit === null) === (request.source_tree === null), "native session request source identity is incomplete");
  if (request.source_commit !== null) requireGitObject(request.source_commit, "native session request source commit");
  if (request.source_tree !== null) requireGitObject(request.source_tree, "native session request source tree");
  requireSha(request.request_sha256, "native session request digest");
  assert(request.request_sha256 === digestWithout(request, "request_sha256"), "native session request digest mismatch");
  return request;
}

export function compileNativeSessionSpawnReadback({
  request,
  status,
  clientThreadId = null,
  threadId = null,
  hostId = null,
  worktreePath = null,
  sourceCommit = null,
  sourceTree = null,
  hostModel = null,
  hostReasoningEffort = null,
  error = null,
  observedAtUtc,
}) {
  validateNativeSessionSpawnRequest(request);
  assert(["SETUP_PENDING", "THREAD_BOUND", "FAILED"].includes(status), "native session readback status is invalid");
  requireNullableString(clientThreadId, "native session client thread ID");
  requireNullableString(threadId, "native session thread ID");
  requireNullableString(hostId, "native session host ID");
  requireNullableString(worktreePath, "native session worktree path");
  requireNullableString(sourceCommit, "native session readback source commit");
  requireNullableString(sourceTree, "native session readback source tree");
  requireNullableString(hostModel, "native session host model readback");
  requireNullableString(hostReasoningEffort, "native session host reasoning readback");
  if (sourceCommit !== null) requireGitObject(sourceCommit, "native session readback source commit");
  if (sourceTree !== null) requireGitObject(sourceTree, "native session readback source tree");
  assert((sourceCommit === null) === (sourceTree === null), "native session readback source identity is incomplete");
  if (clientThreadId !== null) requireHostIdentifier(clientThreadId, "native session client thread ID", {clientThread: true});
  if (threadId !== null) requireHostIdentifier(threadId, "native session thread ID", {thread: true});
  if (hostId !== null) requireHostIdentifier(hostId, "native session host ID");
  if (status === "SETUP_PENDING") assert(clientThreadId !== null && threadId === null, "setup-pending readback must contain only the client thread ID");
  if (status === "THREAD_BOUND") assert(threadId !== null && hostId !== null && worktreePath !== null && sourceCommit !== null && sourceTree !== null, "bound readback lacks the verified thread, host, worktree, or source identity");
  if (status === "THREAD_BOUND") {
    assert(hostModel !== null && hostReasoningEffort !== null, "bound readback lacks authoritative host model or reasoning identity");
    assert(isKnownHostExecutionValue(hostModel) && isKnownHostExecutionValue(hostReasoningEffort), "bound readback contains unknown host model or reasoning identity");
    assert(hostModel === request.model && hostReasoningEffort === request.reasoning_effort, "bound readback host execution identity differs from request");
  } else {
    assert(hostModel === null && hostReasoningEffort === null, "unbound readback cannot claim host model or reasoning identity");
  }
  if (status === "FAILED") {
    assert(threadId === null, "failed native session cannot claim a bound thread");
    requireString(error, "native session failure");
  } else {
    assert(error === null, "successful native session cannot carry an error");
  }
  requireUtc(observedAtUtc, "native session readback time");
  const readback = {
    schema: NATIVE_SESSION_READBACK_SCHEMA,
    version: 1,
    status,
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    role: request.role,
    display_name: request.display_name,
    lane_file: request.lane_file,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    client_thread_id: clientThreadId,
    thread_id: threadId,
    host_id: hostId,
    worktree_path: worktreePath,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    host_model: hostModel,
    host_reasoning_effort: hostReasoningEffort,
    error,
    observed_at_utc: observedAtUtc,
    request_sha256: request.request_sha256,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  return validateNativeSessionSpawnReadback(readback, {request});
}

export function validateNativeSessionSpawnReadback(readback, {request = null} = {}) {
  const required = [
    "schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "role", "display_name",
    "lane_file", "model", "reasoning_effort", "client_thread_id", "thread_id", "host_id", "worktree_path", "source_commit", "source_tree", "host_model", "host_reasoning_effort",
    "error", "observed_at_utc", "request_sha256", "readback_sha256",
  ];
  requireRecord(readback, "native session spawn readback");
  assert(JSON.stringify(Object.keys(readback).sort()) === JSON.stringify([...required].sort()), "native session spawn readback fields mismatch");
  assert(readback.schema === NATIVE_SESSION_READBACK_SCHEMA && readback.version === 1, "native session readback identity is invalid");
  assert(["SETUP_PENDING", "THREAD_BOUND", "FAILED"].includes(readback.status), "native session readback status is invalid");
  assert(request !== null, "native session readback requires its original spawn request");
  requireIdentifier(readback.team_id, "native session readback team ID");
  requireString(readback.project_id, "native session readback project ID");
  requireIdentifier(readback.campaign_id, "native session readback campaign ID");
  requireString(readback.campaign_version, "native session readback campaign version");
  const definition = roleDefinition(readback.role);
  validateDisplayName(readback.display_name, definition, readback.campaign_version, `${readback.role} readback display name`);
  assert(readback.lane_file === definition.lane_file, `${readback.role} readback has the wrong lane file`);
  validateExecution({model: readback.model, reasoningEffort: readback.reasoning_effort});
  for (const field of ["worktree_path", "source_commit", "source_tree"]) requireNullableString(readback[field], `native session readback ${field}`);
  requireNullableString(readback.host_model, "native session readback host model");
  requireNullableString(readback.host_reasoning_effort, "native session readback host reasoning");
  if (readback.client_thread_id !== null) requireHostIdentifier(readback.client_thread_id, "native session readback client thread ID", {clientThread: true});
  if (readback.thread_id !== null) requireHostIdentifier(readback.thread_id, "native session readback thread ID", {thread: true});
  if (readback.host_id !== null) requireHostIdentifier(readback.host_id, "native session readback host ID");
  if (readback.source_commit !== null) requireGitObject(readback.source_commit, "native session readback source commit");
  if (readback.source_tree !== null) requireGitObject(readback.source_tree, "native session readback source tree");
  assert((readback.source_commit === null) === (readback.source_tree === null), "native session readback source identity is incomplete");
  if (readback.status === "SETUP_PENDING") assert(readback.client_thread_id !== null && readback.thread_id === null && readback.worktree_path === null && readback.source_commit === null && readback.source_tree === null, "setup-pending readback claims bound state");
  if (readback.status === "THREAD_BOUND") {
    assert(readback.thread_id !== null && readback.host_id !== null && readback.worktree_path !== null && readback.source_commit !== null && readback.source_tree !== null, "thread-bound readback is not source-bound");
    assert(readback.host_model !== null && readback.host_reasoning_effort !== null, "thread-bound readback lacks authoritative host execution identity");
    assert(isKnownHostExecutionValue(readback.host_model) && isKnownHostExecutionValue(readback.host_reasoning_effort), "thread-bound readback contains unknown host execution identity");
  }
  if (readback.status === "FAILED") {
    assert(readback.thread_id === null && readback.host_id === null && readback.worktree_path === null && readback.source_commit === null && readback.source_tree === null, "failed readback cannot claim host or worktree state");
    requireString(readback.error, "native session readback failure");
  } else assert(readback.error === null, "successful native session readback carries an error");
  if (readback.status !== "THREAD_BOUND") assert(readback.host_model === null && readback.host_reasoning_effort === null, "unbound readback contains host execution identity");
  requireUtc(readback.observed_at_utc, "native session readback time");
  requireSha(readback.request_sha256, "native session readback request digest");
  requireSha(readback.readback_sha256, "native session readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "native session readback digest mismatch");
  validateNativeSessionSpawnRequest(request);
  assert(readback.request_sha256 === request.request_sha256, "native session readback request differs");
  for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role", "display_name", "lane_file", "model", "reasoning_effort"]) {
    assert(readback[field] === request[field], `native session readback ${field} differs from request`);
  }
  if (readback.status === "THREAD_BOUND") assert(readback.source_commit === request.source_commit && readback.source_tree === request.source_tree, "native session readback source differs from request");
  return readback;
}

function hostRecord(value, label) {
  if (!isRecord(value)) throw new NativeSessionBoundaryError("INVALID_HOST_READBACK", `${label} must be a typed host object`);
  for (const key of ["stdout", "stderr", "output", "shell_output", "command", "command_line", "exit_code", "pid", "process_id"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) throw new NativeSessionBoundaryError("SHELL_OUTPUT_REJECTED", `${label} contains shell or process output`);
  }
  return value;
}

function hostValue(value, fields, label, {required = true} = {}) {
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(value, field));
  if (present.length === 0) {
    if (required) throw new NativeSessionBoundaryError("INVALID_HOST_READBACK", `${label} is missing`);
    return null;
  }
  const first = value[present[0]];
  for (const field of present.slice(1)) {
    if (value[field] !== first) throw new NativeSessionBoundaryError("HOST_IDENTITY_CONFLICT", `${label} conflicts across host fields`);
  }
  return first;
}

function hostString(value, fields, label, options = {}) {
  const result = hostValue(value, fields, label, options);
  if (result !== null) requireString(result, label);
  return result;
}

function hostBooleanValue(value, fields, label, options = {}) {
  const result = hostValue(value, fields, label, options);
  if (result !== null) requireBoolean(result, label);
  return result;
}

function hostStatusValue(value, label) {
  const status = hostString(value, ["status", "state"], `${label} status`, {required: false});
  if (status !== null && ["FAILED", "ERROR", "SETUP_FAILED", "WORKTREE_FAILED", "ARCHIVE_FAILED"].includes(status)) {
    throw new NativeSessionBoundaryError("HOST_OPERATION_FAILED", `${label} reported ${status}`);
  }
  return status;
}

export function validateNativeSessionHostCapabilities(host, requiredTools = NATIVE_SESSION_REQUIRED_HOST_OPERATIONS) {
  if (!isRecord(host)) throw new NativeSessionBoundaryError("NATIVE_SESSION_TOOLING_UNAVAILABLE", "host collaboration tools are unavailable", {missingTools: [...requiredTools]});
  const missingTools = requiredTools.filter((tool) => typeof host[tool] !== "function");
  if (missingTools.length > 0) {
    throw new NativeSessionBoundaryError(
      "NATIVE_SESSION_TOOLING_UNAVAILABLE",
      `host collaboration tools are unavailable: ${missingTools.join(", ")}`,
      {missingTools: [...missingTools]},
    );
  }
  return Object.freeze({available: true, tools: [...requiredTools]});
}

export function compileNativeSessionUnavailableBoundary({request, missingTools, reason, observedAtUtc}) {
  validateNativeSessionSpawnRequest(request);
  assert(Array.isArray(missingTools) && missingTools.length > 0, "native session unavailable boundary needs missing tools");
  missingTools.forEach((tool) => requireString(tool, "native session missing tool"));
  requireString(reason, "native session unavailable reason");
  requireUtc(observedAtUtc, "native session unavailable time");
  const boundary = {
    schema: NATIVE_SESSION_UNAVAILABLE_SCHEMA,
    version: 1,
    status: "BLOCKED",
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    missing_tools: [...new Set(missingTools)].sort(),
    reason,
    request_sha256: request.request_sha256,
    observed_at_utc: observedAtUtc,
    boundary_sha256: null,
  };
  boundary.boundary_sha256 = digestWithoutField(boundary, "boundary_sha256");
  return validateNativeSessionUnavailableBoundary(boundary, {request});
}

export function validateNativeSessionUnavailableBoundary(boundary, {request = null} = {}) {
  const required = ["schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "missing_tools", "reason", "request_sha256", "observed_at_utc", "boundary_sha256"];
  exactKeys(boundary, required, "native session unavailable boundary");
  assert(boundary.schema === NATIVE_SESSION_UNAVAILABLE_SCHEMA && boundary.version === 1 && boundary.status === "BLOCKED", "native session unavailable boundary identity is invalid");
  requireIdentifier(boundary.team_id, "native session unavailable team ID");
  requireString(boundary.project_id, "native session unavailable project ID");
  requireIdentifier(boundary.campaign_id, "native session unavailable campaign ID");
  requireString(boundary.campaign_version, "native session unavailable campaign version");
  assert(Array.isArray(boundary.missing_tools) && boundary.missing_tools.length > 0, "native session unavailable tools are missing");
  boundary.missing_tools.forEach((tool) => requireString(tool, "native session unavailable tool"));
  requireString(boundary.reason, "native session unavailable reason");
  requireSha(boundary.request_sha256, "native session unavailable request digest");
  requireUtc(boundary.observed_at_utc, "native session unavailable time");
  requireSha(boundary.boundary_sha256, "native session unavailable digest");
  assert(boundary.boundary_sha256 === digestWithoutField(boundary, "boundary_sha256"), "native session unavailable digest mismatch");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    assert(boundary.request_sha256 === request.request_sha256, "native session unavailable request differs");
    for (const field of ["team_id", "project_id", "campaign_id", "campaign_version"]) assert(boundary[field] === request[field], `native session unavailable ${field} differs`);
  }
  return boundary;
}

export function compileNativeSessionHostIdentityBoundary({
  request,
  status = "UNAVAILABLE",
  reasonCode = "HOST_MODEL_REASONING_READBACK_UNAVAILABLE",
  hostModel = null,
  hostReasoningEffort = null,
  missingHostFields = [],
  reason,
  observedAtUtc,
}) {
  validateNativeSessionSpawnRequest(request);
  assert(["UNAVAILABLE", "MISMATCH"].includes(status), "native session host identity boundary status is invalid");
  assert(["HOST_MODEL_REASONING_READBACK_UNAVAILABLE", "HOST_MODEL_REASONING_MISMATCH"].includes(reasonCode), "native session host identity boundary reason code is invalid");
  requireNullableString(hostModel, "native session host model evidence");
  requireNullableString(hostReasoningEffort, "native session host reasoning evidence");
  assert(Array.isArray(missingHostFields), "native session host identity missing fields must be an array");
  const normalizedMissingFields = [...new Set(missingHostFields)].sort();
  assert(normalizedMissingFields.every((field) => ["model", "reasoning_effort"].includes(field)), "native session host identity missing field is invalid");
  assert(status === "UNAVAILABLE" ? normalizedMissingFields.length > 0 && reasonCode === "HOST_MODEL_REASONING_READBACK_UNAVAILABLE" : normalizedMissingFields.length === 0 && reasonCode === "HOST_MODEL_REASONING_MISMATCH", "native session host identity boundary status and reason do not agree");
  requireString(reason, "native session host identity boundary reason");
  requireUtc(observedAtUtc, "native session host identity boundary time");
  const boundary = {
    schema: NATIVE_SESSION_HOST_IDENTITY_BOUNDARY_SCHEMA,
    version: 1,
    status: "BLOCKED",
    identity_status: status,
    reason_code: reasonCode,
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    requested_model: request.model,
    requested_reasoning_effort: request.reasoning_effort,
    host_model: hostModel,
    host_reasoning_effort: hostReasoningEffort,
    missing_host_fields: normalizedMissingFields,
    reason,
    acceptance: false,
    protected_actions_enabled: false,
    request_sha256: request.request_sha256,
    observed_at_utc: observedAtUtc,
    boundary_sha256: null,
  };
  boundary.boundary_sha256 = digestWithoutField(boundary, "boundary_sha256");
  return validateNativeSessionHostIdentityBoundary(boundary, {request});
}

export function validateNativeSessionHostIdentityBoundary(boundary, {request = null} = {}) {
  const required = [
    "schema", "version", "status", "identity_status", "reason_code", "team_id", "project_id", "campaign_id", "campaign_version",
    "requested_model", "requested_reasoning_effort", "host_model", "host_reasoning_effort", "missing_host_fields", "reason",
    "acceptance", "protected_actions_enabled", "request_sha256", "observed_at_utc", "boundary_sha256",
  ];
  exactKeys(boundary, required, "native session host identity boundary");
  assert(boundary.schema === NATIVE_SESSION_HOST_IDENTITY_BOUNDARY_SCHEMA && boundary.version === 1 && boundary.status === "BLOCKED", "native session host identity boundary identity is invalid");
  assert(["UNAVAILABLE", "MISMATCH"].includes(boundary.identity_status), "native session host identity boundary status is invalid");
  assert(["HOST_MODEL_REASONING_READBACK_UNAVAILABLE", "HOST_MODEL_REASONING_MISMATCH"].includes(boundary.reason_code), "native session host identity boundary reason code is invalid");
  requireIdentifier(boundary.team_id, "native session host identity boundary team ID");
  requireString(boundary.project_id, "native session host identity boundary project ID");
  requireIdentifier(boundary.campaign_id, "native session host identity boundary campaign ID");
  requireString(boundary.campaign_version, "native session host identity boundary campaign version");
  validateExecution({model: boundary.requested_model, reasoningEffort: boundary.requested_reasoning_effort});
  requireNullableString(boundary.host_model, "native session host identity boundary host model");
  requireNullableString(boundary.host_reasoning_effort, "native session host identity boundary host reasoning");
  assert(Array.isArray(boundary.missing_host_fields), "native session host identity boundary missing fields are invalid");
  assert(JSON.stringify(boundary.missing_host_fields) === JSON.stringify([...new Set(boundary.missing_host_fields)].sort()), "native session host identity boundary missing fields are not canonical");
  assert(boundary.missing_host_fields.every((field) => ["model", "reasoning_effort"].includes(field)), "native session host identity boundary missing field is invalid");
  assert(boundary.identity_status === "UNAVAILABLE" ? boundary.missing_host_fields.length > 0 && boundary.reason_code === "HOST_MODEL_REASONING_READBACK_UNAVAILABLE" : boundary.missing_host_fields.length === 0 && boundary.reason_code === "HOST_MODEL_REASONING_MISMATCH", "native session host identity boundary status and reason do not agree");
  requireString(boundary.reason, "native session host identity boundary reason");
  assert(boundary.acceptance === false && boundary.protected_actions_enabled === false, "native session host identity boundary crossed acceptance or protected actions");
  requireSha(boundary.request_sha256, "native session host identity boundary request digest");
  requireUtc(boundary.observed_at_utc, "native session host identity boundary time");
  requireSha(boundary.boundary_sha256, "native session host identity boundary digest");
  assert(boundary.boundary_sha256 === digestWithoutField(boundary, "boundary_sha256"), "native session host identity boundary digest mismatch");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    assert(boundary.request_sha256 === request.request_sha256, "native session host identity boundary request differs");
    for (const [boundaryField, requestField] of [["team_id", "team_id"], ["project_id", "project_id"], ["campaign_id", "campaign_id"], ["campaign_version", "campaign_version"], ["requested_model", "model"], ["requested_reasoning_effort", "reasoning_effort"]]) {
      assert(boundary[boundaryField] === request[requestField], `native session host identity boundary ${boundaryField} differs`);
    }
  }
  return boundary;
}

export function validateNativeSessionHostExecutionIdentity({request, value, observedAtUtc, label = "native session host", acceptRequestedIdentityWithoutReadback = false}) {
  validateNativeSessionSpawnRequest(request);
  hostRecord(value, label);
  let hostModel = null;
  let hostReasoningEffort = null;
  try {
    hostModel = hostString(value, ["model", "host_model", "hostModel", "session_model", "sessionModel"], `${label} model`, {required: false});
    hostReasoningEffort = hostString(value, ["reasoning_effort", "reasoningEffort", "thinking", "host_reasoning_effort", "hostReasoningEffort", "session_reasoning_effort", "sessionReasoningEffort"], `${label} reasoning effort`, {required: false});
  } catch (error) {
    const boundary = compileNativeSessionHostIdentityBoundary({
      request,
      status: "UNAVAILABLE",
      hostModel: null,
      hostReasoningEffort: null,
      missingHostFields: ["model", "reasoning_effort"],
      reason: "authoritative host model/reasoning fields were malformed or conflicted",
      observedAtUtc,
    });
    throw new NativeSessionBoundaryError("HOST_MODEL_REASONING_READBACK_UNAVAILABLE", "authoritative host model/reasoning readback is unavailable", {
      requested_model: request.model,
      requested_reasoning_effort: request.reasoning_effort,
      host_model: null,
      host_reasoning_effort: null,
      missing_host_fields: ["model", "reasoning_effort"],
      boundary,
      cause: error,
    });
  }
  const missingHostFields = [];
  if (!isKnownHostExecutionValue(hostModel)) missingHostFields.push("model");
  if (!isKnownHostExecutionValue(hostReasoningEffort)) missingHostFields.push("reasoning_effort");
  if (missingHostFields.length > 0) {
    const requestWasAcceptedWithoutIdentityFields = acceptRequestedIdentityWithoutReadback
      && [[hostModel, request.model], [hostReasoningEffort, request.reasoning_effort]].every(([observed, requested]) => isMissingHostExecutionValue(observed) || observed === requested);
    if (requestWasAcceptedWithoutIdentityFields) {
      return Object.freeze({
        requested_model: request.model,
        requested_reasoning_effort: request.reasoning_effort,
        host_model: request.model,
        host_reasoning_effort: request.reasoning_effort,
        status: "REQUEST_ACCEPTED_NO_READBACK",
        readback_status: "NOT_RETURNED",
      });
    }
    const boundary = compileNativeSessionHostIdentityBoundary({
      request,
      status: "UNAVAILABLE",
      hostModel,
      hostReasoningEffort,
      missingHostFields,
      reason: "host did not return authoritative model and reasoning identity",
      observedAtUtc,
    });
    throw new NativeSessionBoundaryError("HOST_MODEL_REASONING_READBACK_UNAVAILABLE", "authoritative host model/reasoning readback is unavailable", {
      requested_model: request.model,
      requested_reasoning_effort: request.reasoning_effort,
      host_model: hostModel,
      host_reasoning_effort: hostReasoningEffort,
      missing_host_fields: missingHostFields,
      boundary,
    });
  }
  if (hostModel !== request.model || hostReasoningEffort !== request.reasoning_effort) {
    const boundary = compileNativeSessionHostIdentityBoundary({
      request,
      status: "MISMATCH",
      reasonCode: "HOST_MODEL_REASONING_MISMATCH",
      hostModel,
      hostReasoningEffort,
      missingHostFields: [],
      reason: "host-reported model or reasoning identity differs from the requested execution",
      observedAtUtc,
    });
    throw new NativeSessionBoundaryError("HOST_MODEL_REASONING_MISMATCH", "host-reported model/reasoning identity differs from request", {
      requested_model: request.model,
      requested_reasoning_effort: request.reasoning_effort,
      host_model: hostModel,
      host_reasoning_effort: hostReasoningEffort,
      missing_host_fields: [],
      boundary,
    });
  }
  return Object.freeze({
    requested_model: request.model,
    requested_reasoning_effort: request.reasoning_effort,
    host_model: hostModel,
    host_reasoning_effort: hostReasoningEffort,
    status: "MATCH",
  });
}

function validateHostThreadIdentity(value, label, expected = {}) {
  const threadId = hostString(value, ["thread_id", "threadId"], `${label} thread ID`);
  const hostId = hostString(value, ["host_id", "hostId"], `${label} host ID`);
  requireHostIdentifier(threadId, `${label} thread ID`, {thread: true});
  requireHostIdentifier(hostId, `${label} host ID`);
  if (expected.threadId !== undefined) assert(threadId === expected.threadId, `${label} thread identity differs`);
  if (expected.hostId !== undefined) assert(hostId === expected.hostId, `${label} host identity differs`);
  return {threadId, hostId};
}

function validateHostActionReadback(value, operation, session, {booleanField = null, booleanValue = null} = {}) {
  hostRecord(value, operation);
  hostStatusValue(value, operation);
  validateHostThreadIdentity(value, operation, {threadId: session.thread_id, hostId: session.host_id});
  if (value.already_archived === true || value.alreadyArchived === true) throw new NativeSessionBoundaryError("DUPLICATE_ARCHIVE", `${operation} reported an already archived session`);
  if (booleanField !== null) {
    const observed = hostBooleanValue(value, [booleanField], `${operation} ${booleanField}`);
    assert(observed === booleanValue, `${operation} returned the wrong ${booleanField} state`);
  }
  if (value.ok === false || value.success === false) throw new NativeSessionBoundaryError("HOST_OPERATION_FAILED", `${operation} returned failure`);
  return value;
}

function verifyHostRosterAfterRemoval(value, session) {
  hostRecord(value, "list_threads");
  hostStatusValue(value, "list_threads");
  const authoritative = Array.isArray(value.active_roster)
    ? value.active_roster
    : Array.isArray(value.activeRoster) ? value.activeRoster : null;
  const candidates = [];
  for (const field of authoritative === null ? ["threads", "active_sessions", "sessions", "results"] : []) {
    if (Array.isArray(value[field])) candidates.push(...value[field]);
  }
  candidates.push(...(authoritative ?? []));
  assert(Array.isArray(authoritative) || candidates.length > 0, "native session host did not return an authoritative roster readback");
  for (const candidate of candidates) {
    hostRecord(candidate, "list_threads entry");
    const threadId = hostString(candidate, ["thread_id", "threadId"], "list_threads entry thread ID", {required: false});
    const hostId = hostString(candidate, ["host_id", "hostId"], "list_threads entry host ID", {required: false});
    if (threadId === null || hostId === null) continue;
    requireHostIdentifier(threadId, "list_threads entry thread ID", {thread: true});
    requireHostIdentifier(hostId, "list_threads entry host ID");
    if (threadId !== session.thread_id || hostId !== session.host_id) continue;
    throw new NativeSessionBoundaryError("NATIVE_SESSION_ROSTER_NOT_REMOVED", "native session host roster still contains the closed thread");
  }
  return value;
}

export function compileNativeSessionHostSpawnPayload(request) {
  validateNativeSessionSpawnRequest(request);
  return {
    target: {
      type: "project",
      projectId: request.project_id,
      environment: request.worktree_mode === "PROJECT_LOCAL_SESSION"
        ? {type: "local"}
        : {type: "worktree"},
    },
    title: request.display_name,
    prompt: request.prompt,
    model: request.model,
    thinking: request.reasoning_effort,
  };
}

function normalizeNativeSessionSpawnHostReadback({request, value, projectBinding = null, observedAtUtc, acceptRequestedIdentityWithoutReadback = false}) {
  hostRecord(value, "native session spawn");
  const status = hostString(value, ["status", "state"], "native session spawn status", {required: false});
  const failure = value.worktree_initialized === false || value.worktreeInitialized === false || ["FAILED", "ERROR", "SETUP_FAILED", "WORKTREE_FAILED"].includes(status);
  const clientThreadId = hostString(value, ["client_thread_id", "clientThreadId"], "native session client thread ID", {required: false});
  const threadId = hostString(value, ["thread_id", "threadId"], "native session thread ID", {required: false});
  const hostId = hostString(value, ["host_id", "hostId"], "native session host ID", {required: false});
  if (clientThreadId !== null) requireHostIdentifier(clientThreadId, "native session client thread ID", {clientThread: true});
  if (threadId !== null) requireHostIdentifier(threadId, "native session thread ID", {thread: true});
  if (hostId !== null) requireHostIdentifier(hostId, "native session host ID");
  if (failure) {
    const readback = compileNativeSessionSpawnReadback({
      request,
      status: "FAILED",
      clientThreadId,
      threadId: null,
      hostId: null,
      worktreePath: null,
      sourceCommit: null,
      sourceTree: null,
      error: "host session or worktree initialization failed",
      observedAtUtc,
    });
    throw new NativeSessionBoundaryError("WORKTREE_INITIALIZATION_FAILED", "host session or worktree initialization failed", {readback});
  }
  if (threadId === null) {
    assert(clientThreadId !== null, "native session host readback lacks a verified thread or client thread ID");
    return compileNativeSessionSpawnReadback({request, status: "SETUP_PENDING", clientThreadId, threadId: null, hostId: null, observedAtUtc});
  }
  assert(hostId !== null, "native session host readback lacks a host ID");
  const observedProjectId = hostString(value, ["project_id", "projectId"], "native session host project ID");
  assert(observedProjectId === request.project_id, "native session host has the wrong project binding");
  if (projectBinding !== null) {
    const expectedProjectId = projectBinding.project_id ?? projectBinding.projectId ?? request.project_id;
    assert(observedProjectId === expectedProjectId, "native session host has the wrong project binding");
    for (const [fields, expected, label] of [
      [["cwd", "project_root", "projectRoot"], projectBinding.cwd ?? projectBinding.project_root ?? projectBinding.projectRoot, "project cwd"],
      [["git_top_level", "gitTopLevel"], projectBinding.git_top_level ?? projectBinding.gitTopLevel, "project Git top level"],
    ]) {
      if (expected !== undefined && expected !== null) assert(hostString(value, fields, `native session host ${label}`) === expected, `native session host has the wrong ${label}`);
    }
  }
  const executionIdentity = validateNativeSessionHostExecutionIdentity({request, value, observedAtUtc, label: "native session host", acceptRequestedIdentityWithoutReadback});
  const hostWorktreePath = hostString(value, ["worktree_path", "worktreePath"], "native session host worktree path");
  const worktreeInitialized = hostBooleanValue(value, ["worktree_initialized", "worktreeInitialized", "worktree_ready", "worktreeReady"], "native session host worktree initialization", {required: false});
  assert(worktreeInitialized !== false, "native session host worktree initialization failed");
  const sourceCommit = hostString(value, ["source_commit", "sourceCommit"], "native session host source commit");
  const sourceTree = hostString(value, ["source_tree", "sourceTree"], "native session host source tree");
  requireGitObject(sourceCommit, "native session host source commit");
  requireGitObject(sourceTree, "native session host source tree");
  assert(sourceCommit === request.source_commit && sourceTree === request.source_tree, "native session host source binding differs from request");
  const active = hostBooleanValue(value, ["active"], "native session host active state", {required: false});
  const archived = hostBooleanValue(value, ["archived"], "native session host archived state", {required: false});
  assert(active !== false && archived !== true, "native session host returned a non-active session");
  // The host path is used transiently for binding checks only. Persist an
  // opaque reference so AgentOS records cannot disclose the user's filesystem.
  const worktreePath = `opaque:worktree:${operationDigest({project_id: request.project_id, campaign_id: request.campaign_id, thread_id: threadId, host_id: hostId, worktree_path: hostWorktreePath})}`;
  return compileNativeSessionSpawnReadback({request, status: "THREAD_BOUND", clientThreadId, threadId, hostId, worktreePath, sourceCommit, sourceTree, hostModel: executionIdentity.host_model, hostReasoningEffort: executionIdentity.host_reasoning_effort, observedAtUtc});
}

export function bindNativeSessionSpawnReadback({request, pendingReadback, hostReadback, projectBinding = null, observedAtUtc, acceptRequestedIdentityWithoutReadback = false}) {
  validateNativeSessionSpawnRequest(request);
  validateNativeSessionSpawnReadback(pendingReadback, {request});
  assert(pendingReadback.status === "SETUP_PENDING", "native session binding requires setup-pending readback");
  return normalizeNativeSessionSpawnHostReadback({request, value: hostReadback, projectBinding, observedAtUtc, acceptRequestedIdentityWithoutReadback});
}

export function compileNativeSessionRecord({request, readback, pinned = false, archived = false, active = true, lifecycleStatus = "BOUND"}) {
  validateNativeSessionSpawnRequest(request);
  validateNativeSessionSpawnReadback(readback, {request});
  assert(readback.status === "THREAD_BOUND", "native session record requires a bound readback");
  requireBoolean(pinned, "native session pinned state");
  requireBoolean(archived, "native session archived state");
  requireBoolean(active, "native session active state");
  assert(["BOUND", "ACTIVE", "ARCHIVED", "ROSTER_REMOVED"].includes(lifecycleStatus), "native session lifecycle state is invalid");
  const record = {
    schema: NATIVE_SESSION_RECORD_SCHEMA,
    version: 1,
    status: "ACTIVE",
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    role: request.role,
    display_name: request.display_name,
    thread_id: readback.thread_id,
    host_id: readback.host_id,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    host_model: readback.host_model,
    host_reasoning_effort: readback.host_reasoning_effort,
    worktree_path: readback.worktree_path,
    source_commit: readback.source_commit,
    source_tree: readback.source_tree,
    request_sha256: request.request_sha256,
    spawn_readback_sha256: readback.readback_sha256,
    pinned,
    archived,
    active,
    lifecycle_status: lifecycleStatus,
    session_sha256: null,
  };
  record.session_sha256 = digestWithoutField(record, "session_sha256");
  return validateNativeSessionRecord(record, {request, readback});
}

export function validateNativeSessionRecord(record, {request = null, readback = null} = {}) {
  const required = [
    "schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "role", "display_name",
    "thread_id", "host_id", "model", "reasoning_effort", "host_model", "host_reasoning_effort", "worktree_path", "source_commit", "source_tree", "request_sha256",
    "spawn_readback_sha256", "pinned", "archived", "active", "lifecycle_status", "session_sha256",
  ];
  exactKeys(record, required, "native session record");
  assert(record.schema === NATIVE_SESSION_RECORD_SCHEMA && record.version === 1 && record.status === "ACTIVE", "native session record identity is invalid");
  requireIdentifier(record.team_id, "native session record team ID");
  requireString(record.project_id, "native session record project ID");
  requireIdentifier(record.campaign_id, "native session record campaign ID");
  requireString(record.campaign_version, "native session record campaign version");
  roleDefinition(record.role);
  validateDisplayName(record.display_name, roleDefinition(record.role), record.campaign_version, "native session record display name");
  requireHostIdentifier(record.thread_id, "native session record thread ID", {thread: true});
  requireHostIdentifier(record.host_id, "native session record host ID");
  validateExecution({model: record.model, reasoningEffort: record.reasoning_effort});
  validateExecution({model: record.host_model, reasoningEffort: record.host_reasoning_effort});
  assert(isKnownHostExecutionValue(record.host_model) && isKnownHostExecutionValue(record.host_reasoning_effort), "native session record host execution identity is unknown");
  requireString(record.worktree_path, "native session record worktree path");
  requireGitObject(record.source_commit, "native session record source commit");
  requireGitObject(record.source_tree, "native session record source tree");
  requireSha(record.request_sha256, "native session record request digest");
  requireSha(record.spawn_readback_sha256, "native session record readback digest");
  requireBoolean(record.pinned, "native session record pinned state");
  requireBoolean(record.archived, "native session record archived state");
  requireBoolean(record.active, "native session record active state");
  assert(["BOUND", "ACTIVE", "ARCHIVED", "ROSTER_REMOVED"].includes(record.lifecycle_status), "native session record lifecycle state is invalid");
  requireSha(record.session_sha256, "native session record digest");
  assert(record.session_sha256 === digestWithoutField(record, "session_sha256"), "native session record digest mismatch");
  if (record.lifecycle_status === "ARCHIVED" || record.lifecycle_status === "ROSTER_REMOVED") assert(record.archived === true && record.active === false, "closed native session state is invalid");
  if (record.lifecycle_status === "ROSTER_REMOVED") assert(record.pinned === false, "removed native session remains pinned");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role", "display_name", "model", "reasoning_effort"]) assert(record[field] === request[field], `native session record ${field} differs from request`);
    assert(record.request_sha256 === request.request_sha256, "native session record request differs");
  }
  if (readback !== null) {
    validateNativeSessionSpawnReadback(readback, {request});
    assert(record.spawn_readback_sha256 === readback.readback_sha256, "native session record readback differs");
    assert(record.thread_id === readback.thread_id && record.host_id === readback.host_id, "native session record host identity differs");
    assert(record.host_model === readback.host_model && record.host_reasoning_effort === readback.host_reasoning_effort, "native session record execution identity differs from readback");
  }
  return record;
}

function implementationLaneDefinition(role) {
  const definition = IMPLEMENTATION_LANE_ROLES.find((candidate) => candidate.role === role);
  assert(definition !== undefined, `unsupported implementation lane role: ${role}`);
  return definition;
}

function requireRelativeImplementationPath(value, label) {
  requireString(value, label);
  assert(!value.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(value), `${label} must be relative`);
  assert(!value.split("/").includes("..") && !value.includes("\\"), `${label} contains unsafe traversal`);
}

function validateImplementationLaneHostReceipts(receipts, taskId, hostId) {
  exactKeys(receipts, NATIVE_IMPLEMENTATION_LANE_HANDOFF_HOST_RECEIPTS, "implementation lane host receipts");
  const threadReceipt = (value, label) => {
    exactKeys(value, ["thread_id", "host_id"], label);
    requireHostIdentifier(value.thread_id, `${label} thread ID`, {thread: true});
    requireHostIdentifier(value.host_id, `${label} host ID`);
    assert(value.thread_id === taskId && value.host_id === hostId, `${label} identity differs from the task`);
  };
  threadReceipt(receipts.create_thread, "implementation create receipt");
  exactKeys(receipts.pin, ["thread_id", "pinned"], "implementation pin receipt");
  requireHostIdentifier(receipts.pin.thread_id, "implementation pin thread ID", {thread: true});
  assert(receipts.pin.thread_id === taskId && receipts.pin.pinned === true, "implementation pin receipt does not prove pinning");
  exactKeys(receipts.send, ["thread_id"], "implementation send receipt");
  requireHostIdentifier(receipts.send.thread_id, "implementation send thread ID", {thread: true});
  assert(receipts.send.thread_id === taskId, "implementation send receipt belongs to another task");
  exactKeys(receipts.wait, ["thread_id", "host_id", "timed_out", "wake"], "implementation wait receipt");
  requireHostIdentifier(receipts.wait.thread_id, "implementation wait thread ID", {thread: true});
  requireHostIdentifier(receipts.wait.host_id, "implementation wait host ID");
  assert(receipts.wait.thread_id === taskId && receipts.wait.host_id === hostId && receipts.wait.timed_out === false, "implementation wait receipt does not prove completion");
  exactKeys(receipts.wait.wake, ["thread_id", "host_id", "reason", "turn_id"], "implementation wait wake receipt");
  requireHostIdentifier(receipts.wait.wake.thread_id, "implementation wake thread ID", {thread: true});
  requireHostIdentifier(receipts.wait.wake.host_id, "implementation wake host ID");
  requireHostIdentifier(receipts.wait.wake.turn_id, "implementation wake turn ID", {thread: true});
  assert(receipts.wait.wake.thread_id === taskId && receipts.wait.wake.host_id === hostId && receipts.wait.wake.reason === "turnCompleted", "implementation wait wake does not prove a completed turn");
  exactKeys(receipts.read, ["thread_id", "host_id", "status"], "implementation read receipt");
  requireHostIdentifier(receipts.read.thread_id, "implementation read thread ID", {thread: true});
  requireHostIdentifier(receipts.read.host_id, "implementation read host ID");
  assert(receipts.read.thread_id === taskId && receipts.read.host_id === hostId && receipts.read.status === "completed", "implementation read receipt does not prove a completed task");
  exactKeys(receipts.unpin, ["thread_id", "pinned"], "implementation unpin receipt");
  requireHostIdentifier(receipts.unpin.thread_id, "implementation unpin thread ID", {thread: true});
  assert(receipts.unpin.thread_id === taskId && receipts.unpin.pinned === false, "implementation unpin receipt does not prove unpinning");
  exactKeys(receipts.archive, ["thread_id", "archived"], "implementation archive receipt");
  requireHostIdentifier(receipts.archive.thread_id, "implementation archive thread ID", {thread: true});
  assert(receipts.archive.thread_id === taskId && receipts.archive.archived === true, "implementation archive receipt does not prove archiving");
  exactKeys(receipts.post_close_read, ["thread_id", "host_id", "status"], "implementation post-close read receipt");
  requireHostIdentifier(receipts.post_close_read.thread_id, "implementation post-close thread ID", {thread: true});
  requireHostIdentifier(receipts.post_close_read.host_id, "implementation post-close host ID");
  assert(receipts.post_close_read.thread_id === taskId && receipts.post_close_read.host_id === hostId && receipts.post_close_read.status === "notLoaded", "implementation post-close read does not prove closure");
  assert(receipts.active_list_absent === true, "implementation host list does not prove the task is absent");
  return receipts;
}

export function compileNativeImplementationLaneHandoff({
  laneRole,
  taskId,
  hostId,
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
  projectRoot,
  cwd,
  gitTopLevel,
  sourceCommit,
  sourceTree,
  result,
  changedPaths,
  pathSha256,
  focusedTest,
  hostileCoverage,
  hostReceipts,
  protectedActions,
  selfAccepted = false,
}) {
  const definition = implementationLaneDefinition(laneRole);
  const handoff = {
    schema: NATIVE_IMPLEMENTATION_LANE_HANDOFF_SCHEMA,
    version: 1,
    status: "READY_FOR_INDEPENDENT_CLEARANCE",
    lane_role: laneRole,
    task_id: taskId,
    host_id: hostId,
    model,
    reasoning_effort: reasoningEffort,
    source_readback: {project_root: projectRoot, cwd, git_top_level: gitTopLevel, source_commit: sourceCommit, source_tree: sourceTree},
    result,
    changed_paths: [...changedPaths],
    path_sha256: structuredClone(pathSha256),
    focused_test: structuredClone(focusedTest),
    hostile_coverage: [...hostileCoverage],
    host_receipts: structuredClone(hostReceipts),
    protected_actions: structuredClone(protectedActions),
    self_accepted: selfAccepted,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithoutField(handoff, "handoff_sha256");
  return validateNativeImplementationLaneHandoff(handoff, {expectedPaths: definition.implementation_files});
}

export function validateNativeImplementationLaneHandoff(handoff, {
  expectedPaths = null,
  expectedProjectRoot = null,
  expectedCwd = null,
  expectedGitTopLevel = null,
  expectedSourceCommit = null,
  expectedSourceTree = null,
} = {}) {
  const required = [
    "schema", "version", "status", "lane_role", "task_id", "host_id", "model", "reasoning_effort", "source_readback",
    "result", "changed_paths", "path_sha256", "focused_test", "hostile_coverage", "host_receipts", "protected_actions", "self_accepted", "handoff_sha256",
  ];
  exactKeys(handoff, required, "implementation lane handoff");
  assert(handoff.schema === NATIVE_IMPLEMENTATION_LANE_HANDOFF_SCHEMA && handoff.version === 1, "implementation lane handoff schema is invalid");
  assert(handoff.status === "READY_FOR_INDEPENDENT_CLEARANCE", "implementation lane handoff is not clearance-ready");
  const definition = implementationLaneDefinition(handoff.lane_role);
  requireHostIdentifier(handoff.task_id, "implementation lane task ID", {thread: true});
  requireHostIdentifier(handoff.host_id, "implementation lane host ID");
  validateExecution({model: handoff.model, reasoningEffort: handoff.reasoning_effort});
  exactKeys(handoff.source_readback, ["project_root", "cwd", "git_top_level", "source_commit", "source_tree"], "implementation lane source readback");
  for (const field of ["project_root", "cwd", "git_top_level"]) requireString(handoff.source_readback[field], `implementation lane ${field}`);
  requireGitObject(handoff.source_readback.source_commit, "implementation lane source commit");
  requireGitObject(handoff.source_readback.source_tree, "implementation lane source tree");
  assert(handoff.source_readback.cwd === handoff.source_readback.git_top_level, "implementation lane cwd and Git top level differ");
  for (const [field, expected] of [["project_root", expectedProjectRoot], ["cwd", expectedCwd], ["git_top_level", expectedGitTopLevel], ["source_commit", expectedSourceCommit], ["source_tree", expectedSourceTree]]) {
    if (expected !== null) assert(handoff.source_readback[field] === expected, `implementation lane ${field} differs from the expected source binding`);
  }
  const allowedPaths = expectedPaths ?? definition.implementation_files;
  assert(Array.isArray(allowedPaths) && allowedPaths.length === 2, "implementation lane must declare exactly two paths");
  const sortedAllowed = [...allowedPaths].sort();
  assert(JSON.stringify([...new Set(sortedAllowed)]) === JSON.stringify(sortedAllowed), "implementation lane paths are duplicated");
  sortedAllowed.forEach((value) => requireRelativeImplementationPath(value, "implementation lane path"));
  assert(Array.isArray(handoff.changed_paths), "implementation lane changed paths are missing");
  const sortedChanged = [...handoff.changed_paths].sort();
  assert(JSON.stringify([...new Set(sortedChanged)]) === JSON.stringify(sortedChanged), "implementation lane changed paths are duplicated");
  sortedChanged.forEach((value) => {
    requireRelativeImplementationPath(value, "implementation lane changed path");
    assert(sortedAllowed.includes(value), "implementation lane changed path is outside its declared scope");
  });
  exactKeys(handoff.path_sha256, sortedAllowed, "implementation lane path SHA-256 evidence");
  for (const value of sortedAllowed) requireSha(handoff.path_sha256[value], `implementation lane ${value} SHA-256 evidence`);
  exactKeys(handoff.focused_test, ["command", "result", "exit_code"], "implementation lane focused test");
  assert(handoff.focused_test.command === `node ${definition.implementation_files[1]}` && handoff.focused_test.result === "PASS" && handoff.focused_test.exit_code === 0, "implementation lane focused test evidence is incomplete");
  assert(Array.isArray(handoff.hostile_coverage) && handoff.hostile_coverage.length > 0 && handoff.hostile_coverage.every((value) => typeof value === "string" && value.length > 0), "implementation lane hostile coverage is incomplete");
  validateImplementationLaneHostReceipts(handoff.host_receipts, handoff.task_id, handoff.host_id);
  requireRecord(handoff.protected_actions, "implementation lane protected-action record");
  for (const value of Object.values(handoff.protected_actions)) assert(value === false, "implementation lane protected action was enabled");
  assert(handoff.self_accepted === false, "implementation lane cannot self-accept");
  requireString(handoff.result, "implementation lane result");
  requireSha(handoff.handoff_sha256, "implementation lane handoff digest");
  assert(handoff.handoff_sha256 === digestWithoutField(handoff, "handoff_sha256"), "implementation lane handoff digest mismatch");
  return handoff;
}

export function compileNativeSessionActionRequest({operation, request, session, payload = {}}) {
  validateNativeSessionSpawnRequest(request);
  validateNativeSessionRecord(session, {request});
  assert(NATIVE_SESSION_OPERATIONS.includes(operation), "native session operation is invalid");
  requireRecord(payload, "native session operation payload");
  if (operation === "SEND") requireString(payload.prompt, "native session send prompt");
  if (operation === "WAIT") {
    requireNonnegativeInteger(payload.timeout_ms, "native session wait timeout");
    assert(payload.timeout_ms > 0, "native session wait timeout must be positive");
  }
  const action = {
    schema: NATIVE_SESSION_OPERATION_SCHEMA,
    version: 1,
    status: "REQUESTED",
    operation,
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    role: request.role,
    thread_id: session.thread_id,
    host_id: session.host_id,
    request_sha256: request.request_sha256,
    session_sha256: session.session_sha256,
    payload: structuredClone(payload),
    action_sha256: null,
  };
  action.action_sha256 = digestWithoutField(action, "action_sha256");
  return validateNativeSessionActionRequest(action, {request, session});
}

export function validateNativeSessionActionRequest(action, {request = null, session = null} = {}) {
  const required = [
    "schema", "version", "status", "operation", "team_id", "project_id", "campaign_id", "campaign_version", "role",
    "thread_id", "host_id", "request_sha256", "session_sha256", "payload", "action_sha256",
  ];
  exactKeys(action, required, "native session action request");
  assert(action.schema === NATIVE_SESSION_OPERATION_SCHEMA && action.version === 1 && action.status === "REQUESTED", "native session action request identity is invalid");
  assert(NATIVE_SESSION_OPERATIONS.includes(action.operation), "native session action is invalid");
  requireIdentifier(action.team_id, "native session action team ID");
  requireString(action.project_id, "native session action project ID");
  requireIdentifier(action.campaign_id, "native session action campaign ID");
  requireString(action.campaign_version, "native session action campaign version");
  roleDefinition(action.role);
  requireHostIdentifier(action.thread_id, "native session action thread ID", {thread: true});
  requireHostIdentifier(action.host_id, "native session action host ID");
  requireSha(action.request_sha256, "native session action request digest");
  requireSha(action.session_sha256, "native session action session digest");
  requireRecord(action.payload, "native session action payload");
  if (action.operation === "SEND") requireString(action.payload.prompt, "native session send prompt");
  if (action.operation === "WAIT") {
    requireNonnegativeInteger(action.payload.timeout_ms, "native session wait timeout");
    assert(action.payload.timeout_ms > 0, "native session wait timeout must be positive");
  }
  requireSha(action.action_sha256, "native session action digest");
  assert(action.action_sha256 === digestWithoutField(action, "action_sha256"), "native session action digest mismatch");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    assert(action.request_sha256 === request.request_sha256, "native session action request differs");
    for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role"]) assert(action[field] === request[field], `native session action ${field} differs`);
  }
  if (session !== null) {
    validateNativeSessionRecord(session, {request});
    assert(action.session_sha256 === session.session_sha256, "native session action session differs");
    assert(action.thread_id === session.thread_id && action.host_id === session.host_id, "native session action host identity differs");
  }
  return action;
}

export function compileNativeSessionOperationReadback({action, request, session, status = "COMPLETED", hostReadback = null, error = null, observedAtUtc}) {
  validateNativeSessionActionRequest(action, {request, session});
  assert(["COMPLETED", "FAILED"].includes(status), "native session operation status is invalid");
  if (status === "COMPLETED") {
    assert(error === null, "completed native session operation cannot contain an error");
    if (hostReadback !== null) hostRecord(hostReadback, "native session operation");
  } else requireString(error, "native session operation failure");
  requireUtc(observedAtUtc, "native session operation time");
  const result = {
    schema: NATIVE_SESSION_OPERATION_SCHEMA,
    version: 1,
    status,
    operation: action.operation,
    team_id: action.team_id,
    project_id: action.project_id,
    campaign_id: action.campaign_id,
    campaign_version: action.campaign_version,
    role: action.role,
    thread_id: action.thread_id,
    host_id: action.host_id,
    request_sha256: action.request_sha256,
    session_sha256: action.session_sha256,
    action_sha256: action.action_sha256,
    host_readback: hostReadback === null ? null : structuredClone(hostReadback),
    error,
    observed_at_utc: observedAtUtc,
    operation_sha256: null,
  };
  result.operation_sha256 = digestWithoutField(result, "operation_sha256");
  return validateNativeSessionOperationReadback(result, {action, request, session});
}

export function validateNativeSessionOperationReadback(result, {action = null, request = null, session = null} = {}) {
  const required = [
    "schema", "version", "status", "operation", "team_id", "project_id", "campaign_id", "campaign_version", "role",
    "thread_id", "host_id", "request_sha256", "session_sha256", "action_sha256", "host_readback", "error", "observed_at_utc", "operation_sha256",
  ];
  exactKeys(result, required, "native session operation readback");
  assert(result.schema === NATIVE_SESSION_OPERATION_SCHEMA && result.version === 1, "native session operation readback identity is invalid");
  assert(["COMPLETED", "FAILED"].includes(result.status), "native session operation readback status is invalid");
  assert(NATIVE_SESSION_OPERATIONS.includes(result.operation), "native session operation readback operation is invalid");
  requireIdentifier(result.team_id, "native session operation readback team ID");
  requireString(result.project_id, "native session operation readback project ID");
  requireIdentifier(result.campaign_id, "native session operation readback campaign ID");
  requireString(result.campaign_version, "native session operation readback campaign version");
  roleDefinition(result.role);
  requireHostIdentifier(result.thread_id, "native session operation readback thread ID", {thread: true});
  requireHostIdentifier(result.host_id, "native session operation readback host ID");
  requireSha(result.request_sha256, "native session operation readback request digest");
  requireSha(result.session_sha256, "native session operation readback session digest");
  requireSha(result.action_sha256, "native session operation readback action digest");
  if (result.host_readback !== null) hostRecord(result.host_readback, "native session operation");
  if (result.status === "COMPLETED") assert(result.error === null, "completed native session operation readback has an error");
  else requireString(result.error, "native session operation readback failure");
  requireUtc(result.observed_at_utc, "native session operation readback time");
  requireSha(result.operation_sha256, "native session operation readback digest");
  assert(result.operation_sha256 === digestWithoutField(result, "operation_sha256"), "native session operation readback digest mismatch");
  if (action !== null) {
    validateNativeSessionActionRequest(action, {request, session});
    assert(result.action_sha256 === action.action_sha256, "native session operation readback action differs");
    for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role", "thread_id", "host_id"]) assert(result[field] === action[field], `native session operation readback ${field} differs`);
  }
  return result;
}

export function validateNativeSessionRoster(activeRoster, {projectId = null, campaignId = null} = {}) {
  assert(Array.isArray(activeRoster), "native session active roster must be an array");
  const identities = new Set();
  for (const record of activeRoster) {
    validateNativeSessionRecord(record);
    assert(record.active === true && record.archived === false, "native session roster contains a closed session");
    if (projectId !== null) assert(record.project_id === projectId, "native session roster contains another project");
    if (campaignId !== null) assert(record.campaign_id === campaignId, "native session roster contains another campaign");
    const identity = `${record.thread_id}\u0000${record.host_id}`;
    assert(!identities.has(identity), "native session roster contains a duplicate session");
    identities.add(identity);
  }
  return activeRoster;
}

function compileNativeSessionClosureReceipt({request, session, handoff, observedAtUtc}) {
  validateNativeSessionSpawnRequest(request);
  validateNativeSessionRecord(session, {request});
  requireRecord(handoff, "native session typed handoff");
  requireString(handoff.schema, "native session typed handoff schema");
  requireString(handoff.status, "native session typed handoff status");
  requireUtc(observedAtUtc, "native session closure time");
  const receipt = {
    schema: NATIVE_SESSION_CLOSURE_RECEIPT_SCHEMA,
    version: 1,
    status: "CLOSED",
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    role: request.role,
    thread_id: session.thread_id,
    host_id: session.host_id,
    request_sha256: request.request_sha256,
    session_sha256: session.session_sha256,
    handoff_sha256: operationDigest(handoff),
    lifecycle: [...NATIVE_SESSION_CLOSURE_LIFECYCLE],
    active_workers_for_session: 0,
    observed_at_utc: observedAtUtc,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestWithoutField(receipt, "receipt_sha256");
  return validateNativeSessionClosureReceipt(receipt, {request, session});
}

export function validateNativeSessionClosureReceipt(receipt, {request = null, session = null} = {}) {
  const required = [
    "schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "role", "thread_id", "host_id",
    "request_sha256", "session_sha256", "handoff_sha256", "lifecycle", "active_workers_for_session", "observed_at_utc", "receipt_sha256",
  ];
  exactKeys(receipt, required, "native session closure receipt");
  assert(receipt.schema === NATIVE_SESSION_CLOSURE_RECEIPT_SCHEMA && receipt.version === 1 && receipt.status === "CLOSED", "native session closure receipt identity is invalid");
  requireIdentifier(receipt.team_id, "native session closure receipt team ID");
  requireString(receipt.project_id, "native session closure receipt project ID");
  requireIdentifier(receipt.campaign_id, "native session closure receipt campaign ID");
  requireString(receipt.campaign_version, "native session closure receipt campaign version");
  roleDefinition(receipt.role);
  requireHostIdentifier(receipt.thread_id, "native session closure receipt thread ID", {thread: true});
  requireHostIdentifier(receipt.host_id, "native session closure receipt host ID");
  requireSha(receipt.request_sha256, "native session closure receipt request digest");
  requireSha(receipt.session_sha256, "native session closure receipt session digest");
  requireSha(receipt.handoff_sha256, "native session closure receipt handoff digest");
  assert(JSON.stringify(receipt.lifecycle) === JSON.stringify(NATIVE_SESSION_CLOSURE_LIFECYCLE), "native session closure lifecycle is incomplete or out of order");
  assert(receipt.active_workers_for_session === 0, "native session closure retained a roster entry");
  requireUtc(receipt.observed_at_utc, "native session closure receipt time");
  requireSha(receipt.receipt_sha256, "native session closure receipt digest");
  assert(receipt.receipt_sha256 === digestWithoutField(receipt, "receipt_sha256"), "native session closure receipt digest mismatch");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    assert(receipt.request_sha256 === request.request_sha256, "native session closure request differs");
    for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role"]) assert(receipt[field] === request[field], `native session closure ${field} differs`);
  }
  if (session !== null) {
    validateNativeSessionRecord(session, {request});
    assert(receipt.session_sha256 === session.session_sha256, "native session closure session differs");
    assert(receipt.thread_id === session.thread_id && receipt.host_id === session.host_id, "native session closure host identity differs");
  }
  return receipt;
}

export function createNativeSessionTeam({
  host,
  hostAttachment = null,
  projectId,
  teamId = null,
  campaignId = null,
  campaignVersion = null,
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
  projectBinding = null,
  acceptRequestedIdentityWithoutReadback = false,
  activeRoster = [],
  now = () => new Date().toISOString(),
} = {}) {
  requireString(projectId, "native session team project ID");
  if (teamId !== null) requireIdentifier(teamId, "native session team ID");
  if (campaignId !== null) requireIdentifier(campaignId, "native session team campaign ID");
  if (campaignVersion !== null) requireString(campaignVersion, "native session team campaign version");
  validateExecution({model, reasoningEffort});
  if (hostAttachment === null || hostAttachment === undefined) throw new NativeSessionBoundaryError("NATIVE_HOST_ATTACHMENT_REQUIRED", "native session team requires a bound external host attachment");
  validateNativeHostAttachment(hostAttachment);
  assert(hostAttachment.project_id === projectId, "native session team host attachment has the wrong project binding");
  assert(hostAttachment.model === model && hostAttachment.reasoning_effort === reasoningEffort, "native session team host attachment execution policy differs");
  try {
    host = bindNativeHost(host, hostAttachment);
  } catch (error) {
    if (error instanceof NativeSessionBoundaryError) throw error;
    throw new NativeSessionBoundaryError("NATIVE_SESSION_TOOLING_UNAVAILABLE", "external host adapter is unavailable", {
      missingTools: [...NATIVE_SESSION_TOOLS],
      cause: error,
    });
  }
  validateNativeSessionHostCapabilities(host);
  assert(typeof now === "function", "native session team clock must be callable");
  const roster = structuredClone(activeRoster);
  validateNativeSessionRoster(roster, {projectId, campaignId});
  const entries = new Map();

  function requireTool(tool) {
    if (typeof host[tool] !== "function") throw new NativeSessionBoundaryError("NATIVE_SESSION_TOOLING_UNAVAILABLE", `host collaboration tool is unavailable: ${tool}`, {missingTools: [tool]});
  }

  for (const record of roster) entries.set(`${record.thread_id}\u0000${record.host_id}`, {session: record, request: null, readback: null});

  function context(request) {
    validateNativeSessionSpawnRequest(request);
    assert(request.project_id === projectId, "native session request has the wrong project binding");
    if (teamId !== null) assert(request.team_id === teamId, "native session request has the wrong team binding");
    if (campaignId !== null) assert(request.campaign_id === campaignId, "native session request has the wrong campaign binding");
    if (campaignVersion !== null) assert(request.campaign_version === campaignVersion, "native session request has the wrong campaign version");
    assert(request.model === model, "native session request has the wrong model");
    assert(request.reasoning_effort === reasoningEffort, "native session request has the wrong reasoning effort");
    assert(request.source_commit !== null && request.source_tree !== null, "native session request lacks an exact source binding");
    return request;
  }

  function entryFor(session) {
    validateNativeSessionRecord(session);
    const key = `${session.thread_id}\u0000${session.host_id}`;
    const entry = entries.get(key);
    if (entry === undefined) throw new NativeSessionBoundaryError("UNKNOWN_NATIVE_SESSION", "session identity is not owned by this native team");
    assert(entry.session.session_sha256 === session.session_sha256, "native session state is stale or fabricated");
    return {key, entry};
  }

  function updateEntry(key, request, readback, state) {
    const prior = entries.get(key);
    const next = compileNativeSessionRecord({request, readback, ...state});
    entries.set(key, {session: next, request, readback});
    const rosterIndex = roster.findIndex((record) => `${record.thread_id}\u0000${record.host_id}` === key);
    if (rosterIndex >= 0) {
      if (next.active === true && next.archived === false) roster[rosterIndex] = structuredClone(next);
      else if (next.lifecycle_status === "ARCHIVED") roster[rosterIndex] = structuredClone(next);
    }
    return next;
  }

  function rosterRecordFor(key) {
    const index = roster.findIndex((record) => `${record.thread_id}\u0000${record.host_id}` === key);
    return {index, record: index < 0 ? null : roster[index]};
  }

  function actionResult({operation, request, session, payload, hostReadback = null}) {
    const action = compileNativeSessionActionRequest({operation, request, session, payload});
    return {action, readback: compileNativeSessionOperationReadback({action, request, session, hostReadback, observedAtUtc: now()})};
  }

  async function cleanupUnboundThread(raw) {
    try {
      const threadId = hostString(raw, ["thread_id", "threadId"], "orphan thread ID", {required: false});
      const hostId = hostString(raw, ["host_id", "hostId"], "orphan host ID", {required: false});
      if (threadId === null || hostId === null) return "host did not return enough identity to clean the created thread";
      await host.set_thread_pinned({threadId, hostId, pinned: false});
      await host.set_thread_archived({threadId, hostId, archived: true});
      const rosterReadback = await host.list_threads({projectId});
      verifyHostRosterAfterRemoval(rosterReadback, {thread_id: threadId, host_id: hostId});
      return null;
    } catch (cleanupError) {
      return cleanupError?.message ?? String(cleanupError);
    }
  }

  async function spawn(request, {predecessor = null, predecessorSessionId = null} = {}) {
    context(request);
    requireTool("create_thread");
    if (predecessorSessionId !== null) {
      requireHostIdentifier(predecessorSessionId, "native session predecessor", {thread: true});
      predecessor = roster.find((record) => record.thread_id === predecessorSessionId) ?? null;
      if (predecessor === null) throw new NativeSessionBoundaryError("STALE_PREDECESSOR", "predecessor session is not active in this team roster");
    }
    if (predecessor !== null) {
      if (!isRecord(predecessor)) throw new NativeSessionBoundaryError("STALE_PREDECESSOR", "predecessor is not a typed native session");
      const predecessorEntry = entryFor(predecessor);
      const predecessorSession = predecessorEntry.entry.session;
      if (predecessorSession.active !== true || predecessorSession.archived !== false || predecessorSession.project_id !== request.project_id || predecessorSession.campaign_id !== request.campaign_id || predecessorSession.source_commit !== request.source_commit || predecessorSession.source_tree !== request.source_tree) {
        throw new NativeSessionBoundaryError("STALE_PREDECESSOR", "predecessor session is stale or bound to another source");
      }
    }
    if (roster.some((record) => record.role === request.role)) throw new NativeSessionBoundaryError("ROLE_ALREADY_ACTIVE", "native session role is already active");
    let raw;
    try {
      raw = await host.create_thread({
        ...compileNativeSessionHostSpawnPayload(request),
        predecessor_session_id: predecessor?.thread_id ?? null,
      });
    } catch (error) {
      throw new NativeSessionBoundaryError("WORKTREE_INITIALIZATION_FAILED", "host session creation or worktree initialization failed", {cause: error});
    }
    let readback;
    try {
      readback = normalizeNativeSessionSpawnHostReadback({request, value: raw, projectBinding, observedAtUtc: now(), acceptRequestedIdentityWithoutReadback});
    } catch (error) {
      const orphanCleanup = await cleanupUnboundThread(raw);
      if (error instanceof NativeSessionBoundaryError) {
        error.orphan_cleanup = orphanCleanup ?? "CLOSED";
        throw error;
      }
      throw new NativeSessionBoundaryError("INVALID_HOST_READBACK", "host did not return a verifiable native session", {cause: error, orphan_cleanup: orphanCleanup ?? "CLOSED"});
    }
    if (readback.status === "SETUP_PENDING") return {status: "SETUP_PENDING", request, spawn_readback: readback, host_readback: structuredClone(raw), session: null};
    const session = compileNativeSessionRecord({request, readback, pinned: false, archived: false, active: true, lifecycleStatus: "BOUND"});
    const key = `${session.thread_id}\u0000${session.host_id}`;
    if (entries.has(key) || roster.some((record) => `${record.thread_id}\u0000${record.host_id}` === key)) throw new NativeSessionBoundaryError("DUPLICATE_NATIVE_SESSION", "host returned an already registered session");
    entries.set(key, {session, request, readback});
    roster.push(session);
    validateNativeSessionRoster(roster, {projectId, campaignId});
    return {status: "THREAD_BOUND", request, spawn_readback: readback, host_readback: structuredClone(raw), session, active_roster: structuredClone(roster)};
  }

  async function bind({request, pendingReadback, hostReadback}) {
    context(request);
    const readback = bindNativeSessionSpawnReadback({request, pendingReadback, hostReadback, projectBinding, observedAtUtc: now(), acceptRequestedIdentityWithoutReadback});
    const session = compileNativeSessionRecord({request, readback});
    const key = `${session.thread_id}\u0000${session.host_id}`;
    if (entries.has(key) || roster.some((record) => `${record.thread_id}\u0000${record.host_id}` === key)) throw new NativeSessionBoundaryError("DUPLICATE_NATIVE_SESSION", "host returned an already registered session");
    entries.set(key, {session, request, readback});
    roster.push(session);
    validateNativeSessionRoster(roster, {projectId, campaignId});
    return {status: "THREAD_BOUND", request, spawn_readback: readback, session, active_roster: structuredClone(roster)};
  }

  async function pin(session) {
    const {key, entry} = entryFor(session);
    requireTool("set_thread_pinned");
    const current = entry.session;
    assert(current.archived === false && current.active === true, "cannot pin a closed native session");
    if (current.pinned === true) throw new NativeSessionBoundaryError("DUPLICATE_PIN", "native session is already pinned");
    const raw = await host.set_thread_pinned({threadId: current.thread_id, hostId: current.host_id, pinned: true});
    validateHostActionReadback(raw, "set_thread_pinned", current, {booleanField: "pinned", booleanValue: true});
    const next = updateEntry(key, entry.request, entry.readback, {pinned: true, archived: false, active: true, lifecycleStatus: "ACTIVE"});
    const result = actionResult({operation: "PIN", request: entry.request, session: next, payload: {pinned: true}, hostReadback: raw});
    return {...result, session: next};
  }

  async function send(session, prompt) {
    const {entry} = entryFor(session);
    requireTool("send_message_to_thread");
    const current = entry.session;
    assert(current.active === true && current.archived === false, "cannot send to a closed native session");
    requireString(prompt, "native session send prompt");
    const raw = await host.send_message_to_thread({threadId: current.thread_id, hostId: current.host_id, prompt, model: current.model, thinking: current.reasoning_effort});
    validateHostActionReadback(raw, "send_message_to_thread", current);
    return actionResult({operation: "SEND", request: entry.request, session: current, payload: {prompt}, hostReadback: raw});
  }

  async function readback(session) {
    const {entry} = entryFor(session);
    requireTool("read_thread");
    const current = entry.session;
    assert(current.active === true && current.archived === false, "cannot read a closed native session");
    const raw = await host.read_thread({threadId: current.thread_id, hostId: current.host_id, turnLimit: 10});
    validateHostActionReadback(raw, "read_thread", current);
    return actionResult({operation: "READBACK", request: entry.request, session: current, payload: {turn_limit: 10}, hostReadback: raw});
  }

  async function sendAndReadback(session, prompt) {
    const sent = await send(session, prompt);
    const observed = await readback(sent.session ?? session);
    return {send: sent, readback: observed};
  }

  async function waitFor(session, timeoutMs = DEFAULT_PROGRESS_REVIEW_TIMEOUT_MS) {
    const {entry} = entryFor(session);
    requireTool("wait_threads");
    const current = entry.session;
    assert(current.active === true && current.archived === false, "cannot wait on a closed native session");
    requireNonnegativeInteger(timeoutMs, "native session wait timeout");
    assert(timeoutMs > 0, "native session wait timeout must be positive");
    const raw = await host.wait_threads({targets: [{threadId: current.thread_id, hostId: current.host_id}], threadIds: [current.thread_id], timeoutMs});
    const result = Array.isArray(raw?.results)
      ? raw.results.find((candidate) => (candidate.thread_id ?? candidate.threadId) === current.thread_id)
      : raw;
    validateHostActionReadback(result, "wait_threads", current);
    return actionResult({operation: "WAIT", request: entry.request, session: current, payload: {timeout_ms: timeoutMs}, hostReadback: result});
  }

  async function unpin(session) {
    const {key, entry} = entryFor(session);
    requireTool("set_thread_pinned");
    const current = entry.session;
    assert(current.archived === false && current.active === true, "cannot unpin a closed native session");
    if (current.pinned !== true) throw new NativeSessionBoundaryError("DUPLICATE_UNPIN", "native session is already unpinned");
    const raw = await host.set_thread_pinned({threadId: current.thread_id, hostId: current.host_id, pinned: false});
    validateHostActionReadback(raw, "set_thread_pinned", current, {booleanField: "pinned", booleanValue: false});
    const next = updateEntry(key, entry.request, entry.readback, {pinned: false, archived: false, active: true, lifecycleStatus: "BOUND"});
    const result = actionResult({operation: "UNPIN", request: entry.request, session: next, payload: {pinned: false}, hostReadback: raw});
    return {...result, session: next};
  }

  async function archive(session) {
    const {key, entry} = entryFor(session);
    requireTool("set_thread_archived");
    let current = entry.session;
    if (current.archived === true) throw new NativeSessionBoundaryError("DUPLICATE_ARCHIVE", "native session is already archived");
    let unpinResult = null;
    if (current.pinned === true) {
      unpinResult = await unpin(current);
      current = unpinResult.session;
    }
    const raw = await host.set_thread_archived({threadId: current.thread_id, hostId: current.host_id, archived: true});
    validateHostActionReadback(raw, "set_thread_archived", current, {booleanField: "archived", booleanValue: true});
    const next = updateEntry(key, entry.request, entry.readback, {pinned: false, archived: true, active: false, lifecycleStatus: "ARCHIVED"});
    const result = actionResult({operation: "ARCHIVE", request: entry.request, session: next, payload: {archived: true}, hostReadback: raw});
    return {...result, session: next, unpin: unpinResult};
  }

  async function removeFromRoster(session) {
    const {key, entry} = entryFor(session);
    requireTool("list_threads");
    const current = entry.session;
    assert(current.archived === true && current.active === false && current.pinned === false, "native session must be archived and unpinned before roster removal");
    const match = roster.filter((record) => `${record.thread_id}\u0000${record.host_id}` === key);
    assert(match.length === 1, "native session roster leak or duplicate removal");
    const hostRoster = await host.list_threads({projectId: current.project_id});
    verifyHostRosterAfterRemoval(hostRoster, current);
    const index = roster.findIndex((record) => `${record.thread_id}\u0000${record.host_id}` === key);
    roster.splice(index, 1);
    assert(!roster.some((record) => `${record.thread_id}\u0000${record.host_id}` === key), "native session roster leak remains");
    validateNativeSessionRoster(roster, {projectId, campaignId});
    const next = updateEntry(key, entry.request, entry.readback, {pinned: false, archived: true, active: false, lifecycleStatus: "ROSTER_REMOVED"});
    const result = actionResult({operation: "REMOVE_FROM_ROSTER", request: entry.request, session: next, payload: {removed: true}, hostReadback: null});
    return {...result, session: next, active_roster: structuredClone(roster)};
  }

  async function close(session, handoff) {
    const {entry} = entryFor(session);
    requireRecord(handoff, "native session typed handoff");
    requireString(handoff.schema, "native session typed handoff schema");
    requireString(handoff.status, "native session typed handoff status");
    let current = entry.session;
    let archiveResult = null;
    if (current.archived === false) archiveResult = await archive(current);
    current = archiveResult?.session ?? current;
    const removal = await removeFromRoster(current);
    const receipt = compileNativeSessionClosureReceipt({request: entry.request, session: removal.session, handoff, observedAtUtc: now()});
    return {status: "CLOSED", archive: archiveResult, removal, receipt, active_roster: structuredClone(roster)};
  }

  function bindSessionPredecessor(predecessor, request) {
    if (predecessor === null) return;
    const {entry} = entryFor(predecessor);
    const candidate = entry.session;
    if (candidate.active !== true || candidate.archived !== false || candidate.project_id !== request.project_id || candidate.campaign_id !== request.campaign_id || candidate.source_commit !== request.source_commit || candidate.source_tree !== request.source_tree) throw new NativeSessionBoundaryError("STALE_PREDECESSOR", "predecessor session is stale or source-bound differently");
  }

  return Object.freeze({
    spawn,
    bind,
    pin,
    send,
    readback,
    sendAndReadback,
    wait: waitFor,
    unpin,
    archive,
    removeFromRoster,
    close,
    validateRequest: context,
    roster: () => structuredClone(roster),
    capabilities: () => validateNativeSessionHostCapabilities(host),
    verifyPredecessor: bindSessionPredecessor,
  });
}

export function compileNativeCampaignTeamPlan({
  teamId,
  projectId,
  campaignId,
  campaignVersion,
  sourceCommit = null,
  sourceTree = null,
  prompts = {},
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
}) {
  const requests = FOUNDATION_LANE_ROLES.map(({role, display_name, lane_file: laneFile}) => compileNativeSessionSpawnRequest({
    teamId,
    projectId,
    campaignId,
    campaignVersion,
    role,
    task: prompts[role]?.task ?? `Continue the bounded ${display_name} role for this campaign.`,
    prompt: prompts[role]?.prompt ?? `You are the ${display_name} foundation lane. Write only ${laneFile}; return typed progress, result, hostile coverage, independent-check status, and handoff evidence. Do not create children or use shell stand-ins.`,
    laneFile,
    sourceCommit,
    sourceTree,
    model,
    reasoningEffort,
  }));
  const plan = {
    schema: NATIVE_TEAM_PLAN_SCHEMA,
    version: 1,
    status: "SPAWN_REQUESTS_READY",
    team_id: teamId,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    model,
    reasoning_effort: reasoningEffort,
    required_tools: [...NATIVE_SESSION_TOOLS].sort(),
    topology: "INDEPENDENT_SIBLING_SESSIONS",
    parent_child_relationship: false,
    subagents_allowed: false,
    shell_workers_allowed: false,
    local_daemons_allowed: false,
    roles: requests,
    plan_sha256: null,
  };
  plan.plan_sha256 = digestWithout(plan, "plan_sha256");
  return validateNativeCampaignTeamPlan(plan);
}

export function validateNativeCampaignTeamPlan(plan) {
  requireRecord(plan, "native campaign team plan");
  const required = [
    "schema", "version", "status", "team_id", "project_id", "campaign_id", "campaign_version", "model", "reasoning_effort",
    "required_tools", "topology", "parent_child_relationship", "subagents_allowed", "shell_workers_allowed", "local_daemons_allowed", "roles", "plan_sha256",
  ];
  assert(JSON.stringify(Object.keys(plan).sort()) === JSON.stringify([...required].sort()), "native campaign team plan fields mismatch");
  assert(plan.schema === NATIVE_TEAM_PLAN_SCHEMA && plan.version === 1 && plan.status === "SPAWN_REQUESTS_READY", "native campaign team plan identity is invalid");
  requireIdentifier(plan.team_id, "native team plan team ID");
  requireString(plan.project_id, "native team plan project ID");
  requireIdentifier(plan.campaign_id, "native team plan campaign ID");
  requireString(plan.campaign_version, "native team plan campaign version");
  validateExecution({model: plan.model, reasoningEffort: plan.reasoning_effort});
  sortedTools(plan.required_tools);
  assert(plan.topology === "INDEPENDENT_SIBLING_SESSIONS" && plan.parent_child_relationship === false && plan.subagents_allowed === false && plan.shell_workers_allowed === false && plan.local_daemons_allowed === false, "native campaign team crossed a boundary");
  assert(Array.isArray(plan.roles) && plan.roles.length === FOUNDATION_LANE_ROLES.length, "native foundation lane roles are incomplete");
  const roles = plan.roles.map((request) => request.role).sort();
  assert(JSON.stringify(roles) === JSON.stringify(FOUNDATION_LANE_ROLES.map(({role}) => role).sort()), "native foundation lane roles are incomplete or duplicated");
  for (const request of plan.roles) {
    validateNativeSessionSpawnRequest(request);
    assert(request.model === plan.model && request.reasoning_effort === plan.reasoning_effort, "native campaign team role defaults differ");
  }
  requireSha(plan.plan_sha256, "native campaign team plan digest");
  assert(plan.plan_sha256 === digestWithout(plan, "plan_sha256"), "native campaign team plan digest mismatch");
  return plan;
}

export function compileNativeImplementationTeamPlan({
  teamId,
  projectId,
  campaignId,
  campaignVersion,
  sourceCommit = null,
  sourceTree = null,
  prompts = {},
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
}) {
  const requests = IMPLEMENTATION_LANE_ROLES.map(({role, implementation_files: implementationFiles}) => compileNativeSessionSpawnRequest({
    teamId,
    projectId,
    campaignId,
    campaignVersion,
    role,
    task: prompts[role]?.task,
    prompt: prompts[role]?.prompt,
    laneFile: null,
    sourceCommit,
    sourceTree,
    worktreeMode: "PROJECT_LOCAL_SESSION",
    model,
    reasoningEffort,
  }));
  const plan = {
    schema: NATIVE_IMPLEMENTATION_TEAM_PLAN_SCHEMA,
    version: 1,
    status: "SPAWN_REQUESTS_READY",
    phase: "IMPLEMENT_FOUNDATION_LANES",
    team_id: teamId,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    model,
    reasoning_effort: reasoningEffort,
    required_tools: [...NATIVE_SESSION_TOOLS].sort(),
    topology: "INDEPENDENT_SIBLING_SESSIONS",
    parent_child_relationship: false,
    subagents_allowed: false,
    shell_workers_allowed: false,
    local_daemons_allowed: false,
    roles: requests,
    write_scopes: IMPLEMENTATION_LANE_ROLES.map(({role, implementation_files: paths}) => ({role, paths: [...paths]})),
    lifecycle: "PRESERVE_TYPED_HANDOFF_THEN_UNPIN_ARCHIVE_REMOVE_FROM_ACTIVE_ROSTER_AND_VERIFY",
    plan_sha256: null,
  };
  plan.plan_sha256 = digestWithout(plan, "plan_sha256");
  return validateNativeImplementationTeamPlan(plan);
}

export function validateNativeImplementationTeamPlan(plan) {
  requireRecord(plan, "native implementation team plan");
  const required = [
    "schema", "version", "status", "phase", "team_id", "project_id", "campaign_id", "campaign_version", "model", "reasoning_effort",
    "required_tools", "topology", "parent_child_relationship", "subagents_allowed", "shell_workers_allowed", "local_daemons_allowed", "roles", "write_scopes", "lifecycle", "plan_sha256",
  ];
  assert(JSON.stringify(Object.keys(plan).sort()) === JSON.stringify([...required].sort()), "native implementation team plan fields mismatch");
  assert(plan.schema === NATIVE_IMPLEMENTATION_TEAM_PLAN_SCHEMA && plan.version === 1 && plan.status === "SPAWN_REQUESTS_READY" && plan.phase === "IMPLEMENT_FOUNDATION_LANES", "native implementation team plan identity is invalid");
  requireIdentifier(plan.team_id, "native implementation team plan team ID");
  requireString(plan.project_id, "native implementation team plan project ID");
  requireIdentifier(plan.campaign_id, "native implementation team plan campaign ID");
  requireString(plan.campaign_version, "native implementation team plan campaign version");
  validateExecution({model: plan.model, reasoningEffort: plan.reasoning_effort});
  sortedTools(plan.required_tools);
  assert(plan.topology === "INDEPENDENT_SIBLING_SESSIONS" && plan.parent_child_relationship === false && plan.subagents_allowed === false && plan.shell_workers_allowed === false && plan.local_daemons_allowed === false, "native implementation team crossed a boundary");
  assert(plan.lifecycle === "PRESERVE_TYPED_HANDOFF_THEN_UNPIN_ARCHIVE_REMOVE_FROM_ACTIVE_ROSTER_AND_VERIFY", "native implementation lifecycle is incomplete");
  assert(Array.isArray(plan.roles) && plan.roles.length === IMPLEMENTATION_LANE_ROLES.length, "native implementation lane roles are incomplete");
  const roles = plan.roles.map((request) => request.role).sort();
  assert(JSON.stringify(roles) === JSON.stringify(IMPLEMENTATION_LANE_ROLES.map(({role}) => role).sort()), "native implementation lane roles are incomplete or duplicated");
  assert(Array.isArray(plan.write_scopes) && plan.write_scopes.length === IMPLEMENTATION_LANE_ROLES.length, "native implementation write scopes are incomplete");
  for (const request of plan.roles) {
    validateNativeSessionSpawnRequest(request);
    assert(request.model === plan.model && request.reasoning_effort === plan.reasoning_effort, "native implementation role defaults differ");
    assert(request.worktree_mode === "PROJECT_LOCAL_SESSION", "native implementation role is not project-local");
  }
  for (const scope of plan.write_scopes) {
    const definition = IMPLEMENTATION_LANE_ROLES.find(({role}) => role === scope.role);
    assert(definition !== undefined && JSON.stringify(scope.paths) === JSON.stringify(definition.implementation_files), `${scope.role} write scope is not admitted`);
  }
  requireSha(plan.plan_sha256, "native implementation team plan digest");
  assert(plan.plan_sha256 === digestWithout(plan, "plan_sha256"), "native implementation team plan digest mismatch");
  return plan;
}
