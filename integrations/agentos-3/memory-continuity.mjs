import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalBytes, canonicalJson, MemoryError, sha256Ref } from "./memory-m2/src/index.mjs";
import { fsyncDir } from "./memory-m2/src/io.mjs";

export const CONTINUITY_VERSION = 1;
export const CONTINUITY_TASK_SCHEMA = "agentos.memory.continuity_task.v1";
export const CONTINUITY_CHECKPOINT_SCHEMA = "agentos.memory.continuity_checkpoint.v1";
export const GOAL_AMENDMENT_SCHEMA = "agentos.memory.goal_amendment.v1";
export const FAILURE_SIGNATURE_SCHEMA = "agentos.memory.failure_signature.v1";
export const HANDOFF_TRANSITION_SCHEMA = "agentos.memory.handoff_transition.v1";

export const CHECKPOINT_EVENT_CLASSES = Object.freeze([
  "OBSERVATION", "DECISION", "CODE_CHANGE", "TEST_RESULT", "BLOCKER", "ASSUMPTION",
  "DISCOVERY", "GATE_CANDIDATE", "MEMORY_CANDIDATE",
]);
export const EPISTEMIC_CLASSES = Object.freeze(["FACT", "CLAIM", "RECOMMENDATION"]);
export const ATTEMPT_DISPOSITIONS = Object.freeze([
  "NOT_APPLICABLE", "SUCCEEDED", "DISPROVEN", "REJECTED", "BLOCKED",
]);
export const CHECKPOINT_STATUSES = Object.freeze([
  "ACTIVE", "BLOCKED", "PHASE_COMPLETE", "FINAL", "RECOVERY",
]);

export const HANDOFF_ACTIONS = Object.freeze([
  "PREPARE_HANDOFF",
  "FREEZE_PREDECESSOR_WRITES",
  "FINAL_CHECKPOINT",
  "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE",
  "CONSOLIDATE_SUCCESSOR_CONTEXT",
  "SPAWN_SUCCESSOR",
  "SUCCESSOR_VERIFY_CHECKSUM",
  "SUCCESSOR_ACK",
  "DIVERGENCE",
  "TRANSFER_TASK_WORKTREE_LEASE",
  "VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST",
  "HANDOFF_COMMITTED",
  "ARCHIVE_PREDECESSOR",
]);

export const CONTINUITY_INVALIDATION_RULES = Object.freeze({
  original_goal: "IMMUTABLE;_CHANGE_REQUIRES_TYPED_GOAL_AMENDMENT",
  goal_amendment: "INVALIDATE_SUCCESSOR_CONTEXT_AND_ANY_UNCOMMITTED_HANDOFF",
  checkpoint_change: "APPEND_ONLY;_MUTATION_INVALIDATES_CHAIN_AND_FAILS_CLOSED",
  worktree_state_change: "REQUIRE_NEW_CHECKPOINT_AND_REVERIFY_BEFORE_HANDOFF_COMMIT",
  memory_authority_change: "STOP_ALL_CONTINUITY_WRITES_UNTIL_EXCLUSIVE_AUTHORITY_IS_REBOUND",
  role_or_seed_change: "INVALIDATE_SUCCESSOR_CONTEXT_AND_ROLE_CONTEXT_MANIFEST",
  failure_signature_third_repeat: "DENY_IDENTICAL_SUCCESSOR_ROUTE_AND_REQUIRE_MATERIAL_ROUTE_CHANGE",
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const GIT_ID = /^[0-9a-f]{40}$/u;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[a-z2-7]{52}$/u;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/u;
const PORTABLE_REF = /^(?:sha256:[a-z2-7]{52}|obj_[a-z2-7]{52}|ref_[a-z0-9]{32})$/u;
const HANDOFF_SUBJECT = "continuity-task:";
const EVENT_ACTIONS = Object.freeze({
  task: "CONTINUITY_TASK_OPENED",
  checkpoint: "CONTINUITY_CHECKPOINT_APPENDED",
  amendment: "CONTINUITY_GOAL_AMENDED",
  failure: "CONTINUITY_FAILURE_RECORDED",
  handoff: "CONTINUITY_HANDOFF_TRANSITIONED",
});

function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new MemoryError(code, message, details);
}

function record(value, code, label) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object`);
  return value;
}

function exactKeys(value, keys, code, label) {
  record(value, code, label);
  invariant(canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()), code,
    `${label} has missing or unsupported fields`);
}

function text(value, code, label) {
  invariant(typeof value === "string" && value.length > 0 && value === value.normalize("NFC")
    && !/[\u0000-\u001f\u007f]/u.test(value), code, `${label} must be nonempty canonical text`);
  return value;
}

function identifier(value, code, label) {
  invariant(typeof value === "string" && IDENTIFIER.test(value), code, `${label} is not a portable identifier`);
  return value;
}

function utc(value, code, label) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value, code, `${label} must be canonical UTC`);
  return value;
}

function digest(value, code, label) {
  invariant(typeof value === "string" && DIGEST.test(value), code, `${label} must be a canonical digest`);
  return value;
}

function refs(value, code, label, { min = 0 } = {}) {
  invariant(Array.isArray(value) && value.length >= min && value.every((item) => PORTABLE_REF.test(item)), code,
    `${label} must contain portable content or opaque references`);
  const sorted = [...new Set(value)].sort();
  invariant(sorted.length === value.length && canonicalJson(sorted) === canonicalJson(value), code,
    `${label} must be unique and sorted`);
  return value;
}

function contentDigest(domain, value, omittedField) {
  const body = { ...value };
  if (omittedField !== undefined) delete body[omittedField];
  return sha256Ref(domain, canonicalBytes(body));
}

function assertWorktree(worktree, code = "INVALID_WORKTREE_SNAPSHOT") {
  exactKeys(worktree, ["worktree_id", "path", "branch", "head", "tree", "dirty_patch_digest"], code,
    "worktree snapshot");
  identifier(worktree.worktree_id, code, "worktree ID");
  text(worktree.path, code, "worktree path");
  text(worktree.branch, code, "worktree branch");
  invariant(GIT_ID.test(worktree.head) && GIT_ID.test(worktree.tree), code, "worktree Git identities are invalid");
  invariant(HEX_SHA256.test(worktree.dirty_patch_digest), code, "worktree dirty patch digest is invalid");
  return worktree;
}

function worktreeDigest(worktree) {
  assertWorktree(worktree);
  return sha256Ref("agentos.memory.worktree-snapshot.v1", canonicalBytes(worktree));
}

function assertGoal(goal) {
  exactKeys(goal, ["objective", "success_criteria", "goal_digest"], "INVALID_CONTINUITY_GOAL", "goal");
  text(goal.objective, "INVALID_CONTINUITY_GOAL", "goal objective");
  invariant(Array.isArray(goal.success_criteria) && goal.success_criteria.length > 0,
    "INVALID_CONTINUITY_GOAL", "goal success criteria are required");
  goal.success_criteria.forEach((item, index) => text(item, "INVALID_CONTINUITY_GOAL", `goal criterion ${index}`));
  invariant(new Set(goal.success_criteria).size === goal.success_criteria.length,
    "INVALID_CONTINUITY_GOAL", "goal criteria contain duplicates");
  digest(goal.goal_digest, "INVALID_CONTINUITY_GOAL", "goal digest");
  invariant(goal.goal_digest === contentDigest("agentos.memory.immutable-goal.v1", goal, "goal_digest"),
    "INVALID_CONTINUITY_GOAL", "goal digest mismatch");
  return goal;
}

export function compileImmutableGoal({ objective, success_criteria: successCriteria } = {}) {
  text(objective, "INVALID_CONTINUITY_GOAL", "goal objective");
  invariant(Array.isArray(successCriteria) && successCriteria.length > 0,
    "INVALID_CONTINUITY_GOAL", "goal success criteria are required");
  const goal = { objective, success_criteria: [...successCriteria], goal_digest: null };
  goal.goal_digest = contentDigest("agentos.memory.immutable-goal.v1", goal, "goal_digest");
  return Object.freeze(assertGoal(goal));
}

function activeGoalDigest(originalGoal, amendments) {
  return sha256Ref("agentos.memory.active-goal.v1", canonicalBytes({
    original_goal_digest: originalGoal.goal_digest,
    amendment_digests: amendments.map((item) => item.amendment_digest),
  }));
}

function assertEntry(entry, index = 0) {
  exactKeys(entry, ["class", "epistemic_status", "statement", "evidence_refs", "provenance_refs",
    "attempt_disposition"], "INVALID_CHECKPOINT_ENTRY", `checkpoint entry ${index}`);
  invariant(CHECKPOINT_EVENT_CLASSES.includes(entry.class), "INVALID_CHECKPOINT_ENTRY",
    `checkpoint entry ${index} class is invalid`);
  invariant(EPISTEMIC_CLASSES.includes(entry.epistemic_status), "INVALID_CHECKPOINT_ENTRY",
    `checkpoint entry ${index} epistemic status is invalid`);
  text(entry.statement, "INVALID_CHECKPOINT_ENTRY", `checkpoint entry ${index} statement`);
  refs(entry.evidence_refs, "INVALID_CHECKPOINT_ENTRY", `checkpoint entry ${index} evidence refs`,
    { min: entry.epistemic_status === "FACT" ? 1 : 0 });
  refs(entry.provenance_refs, "INVALID_CHECKPOINT_ENTRY", `checkpoint entry ${index} provenance refs`);
  invariant(entry.evidence_refs.length + entry.provenance_refs.length > 0,
    "INVALID_CHECKPOINT_ENTRY", `checkpoint entry ${index} needs evidence or provenance`);
  invariant(ATTEMPT_DISPOSITIONS.includes(entry.attempt_disposition), "INVALID_CHECKPOINT_ENTRY",
    `checkpoint entry ${index} attempt disposition is invalid`);
  return entry;
}

function assertTaskManifest(task, projectId) {
  exactKeys(task, ["schema", "version", "project_id", "task_id", "original_goal", "worktree",
    "opened_by", "checkpoint_max_interval_minutes", "created_at_utc", "task_digest"],
  "INVALID_CONTINUITY_TASK", "continuity task");
  invariant(task.schema === CONTINUITY_TASK_SCHEMA && task.version === CONTINUITY_VERSION
    && task.project_id === projectId, "INVALID_CONTINUITY_TASK", "continuity task identity is invalid");
  identifier(task.task_id, "INVALID_CONTINUITY_TASK", "task ID");
  assertGoal(task.original_goal);
  assertWorktree(task.worktree, "INVALID_CONTINUITY_TASK");
  exactKeys(task.opened_by, ["agent_id", "generation"], "INVALID_CONTINUITY_TASK", "task opener");
  identifier(task.opened_by.agent_id, "INVALID_CONTINUITY_TASK", "opener agent ID");
  invariant(Number.isSafeInteger(task.opened_by.generation) && task.opened_by.generation >= 1,
    "INVALID_CONTINUITY_TASK", "opener generation must be positive");
  invariant(Number.isSafeInteger(task.checkpoint_max_interval_minutes)
    && task.checkpoint_max_interval_minutes >= 1 && task.checkpoint_max_interval_minutes <= 1440,
  "INVALID_CONTINUITY_TASK", "checkpoint interval must be between 1 and 1440 minutes");
  utc(task.created_at_utc, "INVALID_CONTINUITY_TASK", "task creation time");
  digest(task.task_digest, "INVALID_CONTINUITY_TASK", "task digest");
  invariant(task.task_digest === contentDigest("agentos.memory.continuity-task.v1", task, "task_digest"),
    "INVALID_CONTINUITY_TASK", "continuity task digest mismatch");
  return task;
}

function assertCheckpoint(checkpoint, projectId) {
  exactKeys(checkpoint, ["schema", "version", "project_id", "task_id", "checkpoint_number", "status",
    "recorded_at_utc", "agent_id", "generation", "worktree", "active_goal_digest",
    "predecessor_checkpoint_digest", "entries", "checkpoint_digest"],
  "INVALID_CONTINUITY_CHECKPOINT", "continuity checkpoint");
  invariant(checkpoint.schema === CONTINUITY_CHECKPOINT_SCHEMA && checkpoint.version === CONTINUITY_VERSION
    && checkpoint.project_id === projectId, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint identity is invalid");
  identifier(checkpoint.task_id, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint task ID");
  invariant(Number.isSafeInteger(checkpoint.checkpoint_number) && checkpoint.checkpoint_number >= 1,
    "INVALID_CONTINUITY_CHECKPOINT", "checkpoint number must be positive");
  invariant(CHECKPOINT_STATUSES.includes(checkpoint.status), "INVALID_CONTINUITY_CHECKPOINT",
    "checkpoint status is invalid");
  utc(checkpoint.recorded_at_utc, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint time");
  identifier(checkpoint.agent_id, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint agent ID");
  invariant(Number.isSafeInteger(checkpoint.generation) && checkpoint.generation >= 1,
    "INVALID_CONTINUITY_CHECKPOINT", "checkpoint generation must be positive");
  assertWorktree(checkpoint.worktree, "INVALID_CONTINUITY_CHECKPOINT");
  digest(checkpoint.active_goal_digest, "INVALID_CONTINUITY_CHECKPOINT", "active goal digest");
  invariant(checkpoint.predecessor_checkpoint_digest === null || DIGEST.test(checkpoint.predecessor_checkpoint_digest),
    "INVALID_CONTINUITY_CHECKPOINT", "predecessor checkpoint digest is invalid");
  invariant(Array.isArray(checkpoint.entries) && checkpoint.entries.length > 0,
    "INVALID_CONTINUITY_CHECKPOINT", "checkpoint entries are required");
  checkpoint.entries.forEach(assertEntry);
  digest(checkpoint.checkpoint_digest, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint digest");
  invariant(checkpoint.checkpoint_digest === contentDigest("agentos.memory.continuity-checkpoint.v1", checkpoint,
    "checkpoint_digest"), "INVALID_CONTINUITY_CHECKPOINT", "checkpoint digest mismatch");
  return checkpoint;
}

function assertAmendment(amendment, projectId) {
  exactKeys(amendment, ["schema", "version", "project_id", "task_id", "amendment_number", "authority_ref",
    "reason", "success_criteria", "evidence_refs", "recorded_at_utc", "predecessor_amendment_digest",
    "amendment_digest"], "INVALID_GOAL_AMENDMENT", "goal amendment");
  invariant(amendment.schema === GOAL_AMENDMENT_SCHEMA && amendment.version === CONTINUITY_VERSION
    && amendment.project_id === projectId, "INVALID_GOAL_AMENDMENT", "goal amendment identity is invalid");
  identifier(amendment.task_id, "INVALID_GOAL_AMENDMENT", "goal amendment task ID");
  invariant(Number.isSafeInteger(amendment.amendment_number) && amendment.amendment_number >= 1,
    "INVALID_GOAL_AMENDMENT", "goal amendment number is invalid");
  invariant(PORTABLE_REF.test(amendment.authority_ref), "INVALID_GOAL_AMENDMENT", "goal amendment authority is invalid");
  text(amendment.reason, "INVALID_GOAL_AMENDMENT", "goal amendment reason");
  invariant(Array.isArray(amendment.success_criteria) && amendment.success_criteria.length > 0,
    "INVALID_GOAL_AMENDMENT", "amended success criteria are required");
  amendment.success_criteria.forEach((item, index) => text(item, "INVALID_GOAL_AMENDMENT",
    `amended success criterion ${index}`));
  invariant(new Set(amendment.success_criteria).size === amendment.success_criteria.length,
    "INVALID_GOAL_AMENDMENT", "amended success criteria contain duplicates");
  refs(amendment.evidence_refs, "INVALID_GOAL_AMENDMENT", "goal amendment evidence", { min: 1 });
  utc(amendment.recorded_at_utc, "INVALID_GOAL_AMENDMENT", "goal amendment time");
  invariant(amendment.predecessor_amendment_digest === null || DIGEST.test(amendment.predecessor_amendment_digest),
    "INVALID_GOAL_AMENDMENT", "predecessor goal amendment digest is invalid");
  digest(amendment.amendment_digest, "INVALID_GOAL_AMENDMENT", "goal amendment digest");
  invariant(amendment.amendment_digest === contentDigest("agentos.memory.goal-amendment.v1", amendment,
    "amendment_digest"), "INVALID_GOAL_AMENDMENT", "goal amendment digest mismatch");
  return amendment;
}

function assertFailure(failure, projectId) {
  exactKeys(failure, ["schema", "version", "project_id", "task_id", "agent_id", "generation", "failure_class",
    "normalized_scope", "normalized_cause", "affected_gate", "evidence_refs", "route", "signature_digest",
    "route_digest", "recorded_at_utc", "failure_digest"], "INVALID_FAILURE_SIGNATURE", "failure signature");
  invariant(failure.schema === FAILURE_SIGNATURE_SCHEMA && failure.version === CONTINUITY_VERSION
    && failure.project_id === projectId, "INVALID_FAILURE_SIGNATURE", "failure signature identity is invalid");
  for (const [field, label] of [["task_id", "task ID"], ["agent_id", "agent ID"],
    ["failure_class", "failure class"], ["affected_gate", "affected gate"]]) {
    identifier(failure[field], "INVALID_FAILURE_SIGNATURE", label);
  }
  invariant(Number.isSafeInteger(failure.generation) && failure.generation >= 1,
    "INVALID_FAILURE_SIGNATURE", "failure generation is invalid");
  text(failure.normalized_scope, "INVALID_FAILURE_SIGNATURE", "normalized failure scope");
  text(failure.normalized_cause, "INVALID_FAILURE_SIGNATURE", "normalized failure cause");
  refs(failure.evidence_refs, "INVALID_FAILURE_SIGNATURE", "failure evidence", { min: 1 });
  assertRoute(failure.route, "INVALID_FAILURE_SIGNATURE");
  digest(failure.signature_digest, "INVALID_FAILURE_SIGNATURE", "failure signature digest");
  digest(failure.route_digest, "INVALID_FAILURE_SIGNATURE", "failure route digest");
  const signatureBody = { failure_class: failure.failure_class, normalized_scope: failure.normalized_scope,
    normalized_cause: failure.normalized_cause, affected_gate: failure.affected_gate };
  invariant(failure.signature_digest === sha256Ref("agentos.memory.failure-signature.v1", canonicalBytes(signatureBody)),
    "INVALID_FAILURE_SIGNATURE", "material failure signature digest mismatch");
  invariant(failure.route_digest === routeDigest(failure.route), "INVALID_FAILURE_SIGNATURE", "route digest mismatch");
  utc(failure.recorded_at_utc, "INVALID_FAILURE_SIGNATURE", "failure time");
  digest(failure.failure_digest, "INVALID_FAILURE_SIGNATURE", "failure record digest");
  invariant(failure.failure_digest === contentDigest("agentos.memory.failure-record.v1", failure, "failure_digest"),
    "INVALID_FAILURE_SIGNATURE", "failure record digest mismatch");
  return failure;
}

function assertRoute(route, code = "INVALID_SUCCESSOR_ROUTE") {
  exactKeys(route, ["seed_digest", "role_manifest_digest", "model", "duty", "strategy_digest"], code,
    "successor route");
  digest(route.seed_digest, code, "route seed digest");
  digest(route.role_manifest_digest, code, "route role manifest digest");
  text(route.model, code, "route model");
  text(route.duty, code, "route duty");
  digest(route.strategy_digest, code, "route strategy digest");
  return route;
}

function routeDigest(route) {
  assertRoute(route);
  return sha256Ref("agentos.memory.successor-route.v1", canonicalBytes(route));
}

function emptyState() {
  return {
    task: null,
    amendments: [],
    checkpoints: [],
    failures: [],
    failure_streak: null,
    lease_holder: null,
    active_handoff: null,
    handoff_history: [],
    archived_agents: [],
  };
}

function eventMetadata(kind, object) {
  if (kind === "task") return { task_digest: object.task_digest };
  if (kind === "checkpoint") return { checkpoint_number: object.checkpoint_number,
    checkpoint_digest: object.checkpoint_digest };
  if (kind === "amendment") return { amendment_number: object.amendment_number,
    amendment_digest: object.amendment_digest };
  if (kind === "failure") return { signature_digest: object.signature_digest, route_digest: object.route_digest };
  return { transaction_id: object.transaction_id, action: object.action, transition_digest: object.transition_digest };
}

function assertEvent(event, object, kind, taskId) {
  invariant(event.body.subject_ref === `${HANDOFF_SUBJECT}${taskId}` && event.body.object_ref !== null,
    "CONTINUITY_EVENT_MISMATCH", "continuity event subject or object is invalid");
  invariant(canonicalJson(event.body.metadata) === canonicalJson(eventMetadata(kind, object)),
    "CONTINUITY_EVENT_MISMATCH", "continuity event metadata differs from its object");
}

function assertCheckpointChain(state, checkpoint) {
  invariant(checkpoint.task_id === state.task.task_id, "CHECKPOINT_CHAIN_MISMATCH", "checkpoint task differs");
  invariant(checkpoint.checkpoint_number === state.checkpoints.length + 1, "CHECKPOINT_CHAIN_MISMATCH",
    "checkpoint number is not contiguous");
  const previous = state.checkpoints.at(-1)?.checkpoint_digest ?? null;
  invariant(checkpoint.predecessor_checkpoint_digest === previous, "CHECKPOINT_CHAIN_MISMATCH",
    "checkpoint predecessor digest differs");
  invariant(checkpoint.active_goal_digest === activeGoalDigest(state.task.original_goal, state.amendments),
    "CHECKPOINT_GOAL_MISMATCH", "checkpoint is not bound to the active goal");
}

function failureStreak(failures) {
  if (failures.length === 0) return null;
  const latest = failures.at(-1);
  let count = 0;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].signature_digest !== latest.signature_digest) break;
    count += 1;
  }
  return Object.freeze({ signature_digest: latest.signature_digest, route_digest: latest.route_digest, count,
    disposition: count >= 3 ? "ROUTE_CHANGE_REQUIRED" : "RETRY_PERMITTED" });
}

function assertHandoffTransition(transition, projectId) {
  exactKeys(transition, ["schema", "version", "project_id", "task_id", "transaction_id", "action", "actor_id",
    "recorded_at_utc", "predecessor_transition_digest", "payload", "transition_digest"],
  "INVALID_HANDOFF_TRANSITION", "handoff transition");
  invariant(transition.schema === HANDOFF_TRANSITION_SCHEMA && transition.version === CONTINUITY_VERSION
    && transition.project_id === projectId, "INVALID_HANDOFF_TRANSITION", "handoff transition identity is invalid");
  identifier(transition.task_id, "INVALID_HANDOFF_TRANSITION", "handoff task ID");
  identifier(transition.transaction_id, "INVALID_HANDOFF_TRANSITION", "handoff transaction ID");
  invariant(HANDOFF_ACTIONS.includes(transition.action), "INVALID_HANDOFF_TRANSITION", "handoff action is invalid");
  identifier(transition.actor_id, "INVALID_HANDOFF_TRANSITION", "handoff actor ID");
  utc(transition.recorded_at_utc, "INVALID_HANDOFF_TRANSITION", "handoff transition time");
  invariant(transition.predecessor_transition_digest === null || DIGEST.test(transition.predecessor_transition_digest),
    "INVALID_HANDOFF_TRANSITION", "handoff predecessor transition digest is invalid");
  record(transition.payload, "INVALID_HANDOFF_TRANSITION", "handoff transition payload");
  digest(transition.transition_digest, "INVALID_HANDOFF_TRANSITION", "handoff transition digest");
  invariant(transition.transition_digest === contentDigest("agentos.memory.handoff-transition.v1", transition,
    "transition_digest"), "INVALID_HANDOFF_TRANSITION", "handoff transition digest mismatch");
  return transition;
}

const NEXT_ACTION = Object.freeze({
  PREPARE_HANDOFF: "FREEZE_PREDECESSOR_WRITES",
  FREEZE_PREDECESSOR_WRITES: "FINAL_CHECKPOINT",
  FINAL_CHECKPOINT: "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE",
  SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE: "CONSOLIDATE_SUCCESSOR_CONTEXT",
  CONSOLIDATE_SUCCESSOR_CONTEXT: "SPAWN_SUCCESSOR",
  SPAWN_SUCCESSOR: "SUCCESSOR_VERIFY_CHECKSUM",
  SUCCESSOR_VERIFY_CHECKSUM: ["SUCCESSOR_ACK", "DIVERGENCE"],
  SUCCESSOR_ACK: "TRANSFER_TASK_WORKTREE_LEASE",
  TRANSFER_TASK_WORKTREE_LEASE: "VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST",
  VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST: "HANDOFF_COMMITTED",
  HANDOFF_COMMITTED: "ARCHIVE_PREDECESSOR",
});

function requirePayload(payload, keys, code, label) {
  exactKeys(payload, keys, code, label);
  return payload;
}

function applyHandoffTransition(state, transition, { replay = false } = {}) {
  const prior = state.active_handoff;
  const action = transition.action;
  if (action === "PREPARE_HANDOFF") {
    invariant(prior === null || ["DIVERGENCE", "ARCHIVE_PREDECESSOR"].includes(prior.stage),
      "HANDOFF_ALREADY_ACTIVE", "a nonterminal handoff is already active");
    requirePayload(transition.payload, ["predecessor_agent_id", "predecessor_generation", "successor_agent_id",
      "successor_generation", "successor_route", "successor_route_digest", "expected_worktree_digest"],
    "INVALID_HANDOFF_PAYLOAD", "prepare handoff payload");
    const payload = transition.payload;
    identifier(payload.predecessor_agent_id, "INVALID_HANDOFF_PAYLOAD", "predecessor agent ID");
    identifier(payload.successor_agent_id, "INVALID_HANDOFF_PAYLOAD", "successor agent ID");
    invariant(payload.predecessor_generation === state.lease_holder.generation
      && payload.predecessor_agent_id === state.lease_holder.agent_id,
    "HANDOFF_PREDECESSOR_MISMATCH", "handoff predecessor does not own the task lease");
    invariant(payload.successor_generation === payload.predecessor_generation + 1,
      "INVALID_SUCCESSOR_GENERATION", "successor must be the next generation");
    assertRoute(payload.successor_route);
    invariant(payload.successor_route_digest === routeDigest(payload.successor_route),
      "INVALID_SUCCESSOR_ROUTE", "successor route digest mismatch");
    const latestWorktree = state.checkpoints.at(-1)?.worktree ?? state.task.worktree;
    invariant(payload.expected_worktree_digest === worktreeDigest(latestWorktree),
      "WORKTREE_STATE_MISMATCH", "handoff expected worktree differs from task state");
    if (state.failure_streak?.count >= 3) {
      invariant(payload.successor_route_digest !== state.failure_streak.route_digest,
        "REPEATED_FAILURE_ROUTE_CHANGE_REQUIRED",
        "three materially identical failures prohibit an identical successor route");
    }
    state.active_handoff = {
      transaction_id: transition.transaction_id,
      stage: action,
      predecessor_agent_id: payload.predecessor_agent_id,
      predecessor_generation: payload.predecessor_generation,
      successor_agent_id: payload.successor_agent_id,
      successor_generation: payload.successor_generation,
      successor_route: payload.successor_route,
      successor_route_digest: payload.successor_route_digest,
      expected_worktree_digest: payload.expected_worktree_digest,
      last_transition_digest: transition.transition_digest,
      transitions: [transition],
      pending_lease_transfer: null,
    };
    return;
  }
  invariant(prior !== null && prior.transaction_id === transition.transaction_id,
    "HANDOFF_TRANSACTION_MISMATCH", "handoff transition does not belong to the active transaction");
  const allowed = NEXT_ACTION[prior.stage];
  invariant(Array.isArray(allowed) ? allowed.includes(action) : allowed === action,
    "INVALID_HANDOFF_ORDER", `${action} cannot follow ${prior.stage}`);
  invariant(transition.predecessor_transition_digest === prior.last_transition_digest,
    "HANDOFF_TRANSITION_CHAIN_MISMATCH", "handoff transition predecessor digest differs");
  const latestCheckpoint = state.checkpoints.at(-1);
  if (action === "FREEZE_PREDECESSOR_WRITES") {
    requirePayload(transition.payload, [], "INVALID_HANDOFF_PAYLOAD", "freeze payload");
  } else if (action === "FINAL_CHECKPOINT") {
    requirePayload(transition.payload, ["checkpoint_digest"], "INVALID_HANDOFF_PAYLOAD", "final checkpoint payload");
    invariant(latestCheckpoint?.status === "FINAL"
      && latestCheckpoint.checkpoint_digest === transition.payload.checkpoint_digest
      && latestCheckpoint.agent_id === prior.predecessor_agent_id,
    "FINAL_CHECKPOINT_MISMATCH", "handoff final checkpoint is missing or mismatched");
  } else if (action === "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE") {
    requirePayload(transition.payload, ["checkpoint_digest", "evidence_manifest_digest", "worktree_manifest_digest"],
      "INVALID_HANDOFF_PAYLOAD", "spawner verification payload");
    invariant(transition.payload.checkpoint_digest === latestCheckpoint?.checkpoint_digest,
      "HANDOFF_VERIFICATION_MISMATCH", "spawner verification uses a stale checkpoint");
    for (const field of ["evidence_manifest_digest", "worktree_manifest_digest"]) {
      digest(transition.payload[field], "INVALID_HANDOFF_PAYLOAD", field);
    }
    invariant(transition.payload.worktree_manifest_digest === worktreeDigest(latestCheckpoint.worktree),
      "HANDOFF_VERIFICATION_MISMATCH", "spawner worktree verification differs from final checkpoint");
  } else if (action === "CONSOLIDATE_SUCCESSOR_CONTEXT") {
    requirePayload(transition.payload, ["successor_context_digest", "source_checkpoint_digest", "source_goal_digest"],
      "INVALID_HANDOFF_PAYLOAD", "successor context payload");
    digest(transition.payload.successor_context_digest, "INVALID_HANDOFF_PAYLOAD", "successor context digest");
    invariant(transition.payload.source_checkpoint_digest === latestCheckpoint?.checkpoint_digest
      && transition.payload.source_goal_digest === activeGoalDigest(state.task.original_goal, state.amendments),
    "SUCCESSOR_CONTEXT_SOURCE_MISMATCH", "successor context is not bound to current task state");
  } else if (action === "SPAWN_SUCCESSOR") {
    requirePayload(transition.payload, ["successor_agent_id", "successor_generation", "spawn_receipt_ref",
      "role_context_manifest_digest"], "INVALID_HANDOFF_PAYLOAD", "spawn receipt payload");
    invariant(transition.payload.successor_agent_id === prior.successor_agent_id
      && transition.payload.successor_generation === prior.successor_generation,
    "SUCCESSOR_IDENTITY_MISMATCH", "spawn receipt names a different successor");
    invariant(PORTABLE_REF.test(transition.payload.spawn_receipt_ref), "INVALID_HANDOFF_PAYLOAD",
      "spawn receipt must be a portable reference");
    digest(transition.payload.role_context_manifest_digest, "INVALID_HANDOFF_PAYLOAD", "role context manifest digest");
    invariant(transition.payload.role_context_manifest_digest === prior.successor_route.role_manifest_digest,
      "SUCCESSOR_ROLE_MANIFEST_MISMATCH", "spawned successor role manifest differs from the approved route");
  } else if (action === "SUCCESSOR_VERIFY_CHECKSUM") {
    requirePayload(transition.payload, ["successor_context_digest", "checkpoint_digest", "goal_digest",
      "worktree_manifest_digest", "role_context_manifest_digest", "checksum_digest"],
    "INVALID_HANDOFF_PAYLOAD", "successor checksum payload");
    const consolidate = prior.transitions.find((item) => item.action === "CONSOLIDATE_SUCCESSOR_CONTEXT").payload;
    const verify = prior.transitions.find((item) => item.action === "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE").payload;
    const spawn = prior.transitions.find((item) => item.action === "SPAWN_SUCCESSOR").payload;
    invariant(transition.payload.successor_context_digest === consolidate.successor_context_digest
      && transition.payload.checkpoint_digest === latestCheckpoint.checkpoint_digest
      && transition.payload.goal_digest === activeGoalDigest(state.task.original_goal, state.amendments)
      && transition.payload.worktree_manifest_digest === verify.worktree_manifest_digest
      && transition.payload.role_context_manifest_digest === spawn.role_context_manifest_digest,
    "SUCCESSOR_CHECKSUM_DIVERGENCE", "successor checksum inputs differ from predecessor state");
    const checksumBody = { ...transition.payload };
    delete checksumBody.checksum_digest;
    invariant(transition.payload.checksum_digest === sha256Ref("agentos.memory.successor-checksum.v1",
      canonicalBytes(checksumBody)), "SUCCESSOR_CHECKSUM_DIVERGENCE", "successor checksum digest mismatch");
  } else if (action === "SUCCESSOR_ACK") {
    requirePayload(transition.payload, ["checksum_digest", "successor_ack_digest"],
      "INVALID_HANDOFF_PAYLOAD", "successor acknowledgement payload");
    const checksum = prior.transitions.find((item) => item.action === "SUCCESSOR_VERIFY_CHECKSUM").payload.checksum_digest;
    invariant(transition.payload.checksum_digest === checksum, "SUCCESSOR_ACK_MISMATCH",
      "successor acknowledgement does not bind the verified checksum");
    const expectedAck = sha256Ref("agentos.memory.successor-ack.v1", canonicalBytes({
      transaction_id: transition.transaction_id,
      successor_agent_id: prior.successor_agent_id,
      successor_generation: prior.successor_generation,
      checksum_digest: checksum,
    }));
    invariant(transition.payload.successor_ack_digest === expectedAck, "SUCCESSOR_ACK_MISMATCH",
      "successor acknowledgement digest mismatch");
  } else if (action === "DIVERGENCE") {
    requirePayload(transition.payload, ["reason", "evidence_refs"], "INVALID_HANDOFF_PAYLOAD", "divergence payload");
    text(transition.payload.reason, "INVALID_HANDOFF_PAYLOAD", "divergence reason");
    refs(transition.payload.evidence_refs, "INVALID_HANDOFF_PAYLOAD", "divergence evidence", { min: 1 });
  } else if (action === "TRANSFER_TASK_WORKTREE_LEASE") {
    requirePayload(transition.payload, ["from_agent_id", "to_agent_id", "worktree_id", "proposed_transfer_digest"],
      "INVALID_HANDOFF_PAYLOAD", "lease transfer payload");
    invariant(transition.payload.from_agent_id === prior.predecessor_agent_id
      && transition.payload.to_agent_id === prior.successor_agent_id
      && transition.payload.worktree_id === (latestCheckpoint?.worktree ?? state.task.worktree).worktree_id,
    "LEASE_TRANSFER_MISMATCH", "lease transfer identity differs from the handoff");
    const transferBody = { from_agent_id: transition.payload.from_agent_id,
      to_agent_id: transition.payload.to_agent_id, worktree_id: transition.payload.worktree_id,
      transaction_id: transition.transaction_id };
    invariant(transition.payload.proposed_transfer_digest === sha256Ref("agentos.memory.proposed-lease-transfer.v1",
      canonicalBytes(transferBody)), "LEASE_TRANSFER_MISMATCH", "proposed lease transfer digest mismatch");
    prior.pending_lease_transfer = transition.payload;
  } else if (action === "VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST") {
    requirePayload(transition.payload, ["worktree", "worktree_manifest_digest", "proposed_transfer_digest"],
      "INVALID_HANDOFF_PAYLOAD", "transfer verification payload");
    assertWorktree(transition.payload.worktree, "INVALID_HANDOFF_PAYLOAD");
    invariant(canonicalJson(transition.payload.worktree) === canonicalJson(latestCheckpoint.worktree)
      && transition.payload.worktree_manifest_digest === worktreeDigest(transition.payload.worktree)
      && transition.payload.proposed_transfer_digest === prior.pending_lease_transfer?.proposed_transfer_digest,
    "TRANSFER_STATE_DIVERGENCE", "lease transfer verification differs from the final checkpoint");
  } else if (action === "HANDOFF_COMMITTED") {
    requirePayload(transition.payload, ["proposed_transfer_digest", "verification_transition_digest"],
      "INVALID_HANDOFF_PAYLOAD", "handoff commit payload");
    invariant(transition.payload.proposed_transfer_digest === prior.pending_lease_transfer?.proposed_transfer_digest
      && transition.payload.verification_transition_digest === prior.last_transition_digest,
    "HANDOFF_COMMIT_MISMATCH", "handoff commit is not bound to the verified lease transfer");
    state.lease_holder = { agent_id: prior.successor_agent_id, generation: prior.successor_generation };
  } else if (action === "ARCHIVE_PREDECESSOR") {
    requirePayload(transition.payload, ["predecessor_agent_id", "archive_receipt_ref", "worktree_disposition"],
      "INVALID_HANDOFF_PAYLOAD", "predecessor archive payload");
    invariant(transition.payload.predecessor_agent_id === prior.predecessor_agent_id
      && PORTABLE_REF.test(transition.payload.archive_receipt_ref)
      && transition.payload.worktree_disposition === "RETAINED_TASK_CUSTODY",
    "PREDECESSOR_ARCHIVE_MISMATCH", "archive must release only the predecessor agent and retain the worktree");
    state.archived_agents.push({ agent_id: prior.predecessor_agent_id,
      generation: prior.predecessor_generation, archive_receipt_ref: transition.payload.archive_receipt_ref });
  }
  prior.stage = action;
  prior.last_transition_digest = transition.transition_digest;
  prior.transitions.push(transition);
  if (action === "DIVERGENCE" || action === "ARCHIVE_PREDECESSOR") state.handoff_history.push(structuredClone(prior));
  if (!replay && action === "DIVERGENCE") {
    invariant(state.lease_holder.agent_id === prior.predecessor_agent_id,
      "DIVERGENCE_CUSTODY_CHANGED", "divergence must leave predecessor custody unchanged");
  }
}

function transitionObject({ projectId, taskId, transactionId, action, actorId, recordedAtUtc,
  predecessorTransitionDigest, payload }) {
  const transition = {
    schema: HANDOFF_TRANSITION_SCHEMA,
    version: CONTINUITY_VERSION,
    project_id: projectId,
    task_id: taskId,
    transaction_id: transactionId,
    action,
    actor_id: actorId,
    recorded_at_utc: recordedAtUtc,
    predecessor_transition_digest: predecessorTransitionDigest,
    payload,
    transition_digest: null,
  };
  transition.transition_digest = contentDigest("agentos.memory.handoff-transition.v1", transition,
    "transition_digest");
  return assertHandoffTransition(transition, projectId);
}

function checkpointHeader(checkpoint) {
  return {
    task_id: checkpoint.task_id,
    agent_id: checkpoint.agent_id,
    generation: checkpoint.generation,
    worktree_id: checkpoint.worktree.worktree_id,
    worktree_path: checkpoint.worktree.path,
    branch: checkpoint.worktree.branch,
    head: checkpoint.worktree.head,
    tree: checkpoint.worktree.tree,
    dirty_patch_digest: checkpoint.worktree.dirty_patch_digest,
    checkpoint_number: checkpoint.checkpoint_number,
    status: checkpoint.status,
    timestamp: checkpoint.recorded_at_utc,
    active_goal_digest: checkpoint.active_goal_digest,
    predecessor_checkpoint_digest: checkpoint.predecessor_checkpoint_digest,
    checkpoint_digest: checkpoint.checkpoint_digest,
  };
}

function renderCheckpoint(checkpoint) {
  const lines = [
    `## Checkpoint ${checkpoint.checkpoint_number} — ${checkpoint.status}`,
    "",
    "```json",
    canonicalJson(checkpointHeader(checkpoint)),
    "```",
    "",
  ];
  for (const entry of checkpoint.entries) {
    lines.push(`- ${entry.class} | ${entry.epistemic_status} | ${entry.attempt_disposition}: ${JSON.stringify(entry.statement)}`,
      `  - evidence: ${entry.evidence_refs.length > 0 ? entry.evidence_refs.join(", ") : "none"}`,
      `  - provenance: ${entry.provenance_refs.length > 0 ? entry.provenance_refs.join(", ") : "none"}`);
  }
  return `${lines.join("\n")}\n\n`;
}

async function assertPrivateDirectory(path, label) {
  const info = await lstat(path);
  invariant(info.isDirectory() && !info.isSymbolicLink(), "INVALID_HANDOFF_CUSTODY", `${label} must be a real directory`);
  invariant((info.mode & 0o077) === 0, "INSECURE_HANDOFF_CUSTODY", `${label} must be private`);
}

async function ensurePrivateDirectory(path, label) {
  try {
    await assertPrivateDirectory(path, label);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
    await assertPrivateDirectory(path, label);
  }
}

async function handoffPath(project, taskId) {
  const projections = join(project.root, "projections");
  await assertPrivateDirectory(projections, "projection root");
  const continuity = join(projections, "continuity");
  await ensurePrivateDirectory(continuity, "continuity projection root");
  const taskRoot = join(continuity, taskId);
  await ensurePrivateDirectory(taskRoot, "task continuity projection");
  return join(taskRoot, "handoff.md");
}

async function appendProjectionSuffix(path, expected) {
  let current = Buffer.alloc(0);
  try {
    const info = await lstat(path);
    invariant(info.isFile() && !info.isSymbolicLink(), "INVALID_HANDOFF_FILE", "handoff.md must be a real file");
    invariant((info.mode & 0o077) === 0, "INSECURE_HANDOFF_FILE", "handoff.md must be private");
    current = await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const target = Buffer.from(expected, "utf8");
  invariant(current.length <= target.length && target.subarray(0, current.length).equals(current),
    "HANDOFF_PROJECTION_DIVERGENCE", "handoff.md contains bytes not present in the signed checkpoint chain");
  if (current.length === target.length) return { repaired_bytes: 0, byte_count: target.length };
  const handle = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600);
  try {
    await handle.writeFile(target.subarray(current.length));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
  await fsyncDir(dirname(path));
  return { repaired_bytes: target.length - current.length, byte_count: target.length };
}

export class MemoryContinuityController {
  #authorityGuard;

  constructor(project, authorityGuard) {
    invariant(project && typeof project.verifyEvents === "function" && typeof project.commit === "function",
      "INVALID_MEMORY_PROJECT", "continuity requires writable Memory M2 custody");
    invariant(typeof authorityGuard === "function", "CONTINUITY_AUTHORITY_GUARD_REQUIRED",
      "continuity requires the exclusive Memory M2 authority guard");
    this.project = project;
    this.#authorityGuard = authorityGuard;
  }

  async state(taskId) {
    await this.#authorityGuard();
    identifier(taskId, "INVALID_TASK_ID", "task ID");
    const state = emptyState();
    const { events } = await this.project.verifyEvents();
    for (const event of events) {
      if (event.body.subject_ref !== `${HANDOFF_SUBJECT}${taskId}`) continue;
      const object = await this.project.getJson(event.body.object_ref);
      if (event.body.action === EVENT_ACTIONS.task) {
        invariant(state.task === null, "DUPLICATE_CONTINUITY_TASK", "task was opened more than once");
        assertTaskManifest(object, this.project.config.project_id);
        invariant(object.task_id === taskId, "CONTINUITY_EVENT_MISMATCH", "task ID differs from event subject");
        assertEvent(event, object, "task", taskId);
        state.task = object;
        state.lease_holder = structuredClone(object.opened_by);
      } else {
        invariant(state.task !== null, "CONTINUITY_TASK_MISSING", "continuity event precedes task creation");
        if (event.body.action === EVENT_ACTIONS.checkpoint) {
          assertCheckpoint(object, this.project.config.project_id);
          assertEvent(event, object, "checkpoint", taskId);
          assertCheckpointChain(state, object);
          const frozen = state.active_handoff && !["DIVERGENCE", "ARCHIVE_PREDECESSOR"].includes(state.active_handoff.stage)
            && HANDOFF_ACTIONS.indexOf(state.active_handoff.stage) >= HANDOFF_ACTIONS.indexOf("FREEZE_PREDECESSOR_WRITES");
          invariant(!frozen || (object.status === "FINAL" && state.active_handoff.stage === "FREEZE_PREDECESSOR_WRITES"),
            "PREDECESSOR_WRITES_FROZEN", "only the final checkpoint may append after predecessor freeze");
          invariant(object.agent_id === state.lease_holder.agent_id && object.generation === state.lease_holder.generation,
            "CHECKPOINT_LEASE_MISMATCH", "checkpoint author does not own the task worktree lease");
          state.checkpoints.push(object);
        } else if (event.body.action === EVENT_ACTIONS.amendment) {
          assertAmendment(object, this.project.config.project_id);
          assertEvent(event, object, "amendment", taskId);
          invariant(object.amendment_number === state.amendments.length + 1
            && object.predecessor_amendment_digest === (state.amendments.at(-1)?.amendment_digest ?? null),
          "GOAL_AMENDMENT_CHAIN_MISMATCH", "goal amendment chain is not contiguous");
          invariant(state.active_handoff === null || ["DIVERGENCE", "ARCHIVE_PREDECESSOR"].includes(state.active_handoff.stage),
            "GOAL_AMENDMENT_DURING_HANDOFF", "goal cannot change during an uncommitted handoff");
          state.amendments.push(object);
        } else if (event.body.action === EVENT_ACTIONS.failure) {
          assertFailure(object, this.project.config.project_id);
          assertEvent(event, object, "failure", taskId);
          invariant(object.agent_id === state.lease_holder.agent_id && object.generation === state.lease_holder.generation,
            "FAILURE_LEASE_MISMATCH", "failure reporter does not own the task lease");
          state.failures.push(object);
          state.failure_streak = failureStreak(state.failures);
        } else if (event.body.action === EVENT_ACTIONS.handoff) {
          assertHandoffTransition(object, this.project.config.project_id);
          assertEvent(event, object, "handoff", taskId);
          applyHandoffTransition(state, object, { replay: true });
        } else {
          throw new MemoryError("UNKNOWN_CONTINUITY_EVENT", `unsupported continuity event ${event.body.action}`);
        }
      }
    }
    invariant(state.task !== null, "CONTINUITY_TASK_NOT_FOUND", `continuity task ${taskId} does not exist`);
    return Object.freeze({ ...state,
      active_goal_digest: activeGoalDigest(state.task.original_goal, state.amendments),
      writes_frozen: Boolean(state.active_handoff
        && !["DIVERGENCE", "ARCHIVE_PREDECESSOR"].includes(state.active_handoff.stage)
        && HANDOFF_ACTIONS.indexOf(state.active_handoff.stage) >= HANDOFF_ACTIONS.indexOf("FREEZE_PREDECESSOR_WRITES")),
    });
  }

  async openTask({ task_id: taskId, original_goal: originalGoal, worktree, agent_id: agentId, generation = 1,
    checkpoint_max_interval_minutes: checkpointMaxIntervalMinutes = 15,
    recorded_at_utc: recordedAtUtc = new Date().toISOString(), actor = "controller" } = {}) {
    await this.#authorityGuard();
    identifier(taskId, "INVALID_CONTINUITY_TASK", "task ID");
    assertGoal(originalGoal);
    assertWorktree(worktree, "INVALID_CONTINUITY_TASK");
    identifier(agentId, "INVALID_CONTINUITY_TASK", "agent ID");
    utc(recordedAtUtc, "INVALID_CONTINUITY_TASK", "task creation time");
    const { events } = await this.project.verifyEvents();
    invariant(!events.some((event) => event.body.subject_ref === `${HANDOFF_SUBJECT}${taskId}`),
      "DUPLICATE_CONTINUITY_TASK", "continuity task already exists");
    for (const event of events.filter((item) => item.body.action === EVENT_ACTIONS.task)) {
      const existing = await this.project.getJson(event.body.object_ref);
      assertTaskManifest(existing, this.project.config.project_id);
      invariant(existing.worktree.worktree_id !== worktree.worktree_id && existing.worktree.path !== worktree.path,
        "WORKTREE_ALREADY_TASK_OWNED", "worktree identity is already owned by another continuity task");
    }
    const task = {
      schema: CONTINUITY_TASK_SCHEMA,
      version: CONTINUITY_VERSION,
      project_id: this.project.config.project_id,
      task_id: taskId,
      original_goal: originalGoal,
      worktree,
      opened_by: { agent_id: agentId, generation },
      checkpoint_max_interval_minutes: checkpointMaxIntervalMinutes,
      created_at_utc: recordedAtUtc,
      task_digest: null,
    };
    task.task_digest = contentDigest("agentos.memory.continuity-task.v1", task, "task_digest");
    assertTaskManifest(task, this.project.config.project_id);
    const objectRef = await this.project.putJson(task);
    await this.project.commit({ actor, action: EVENT_ACTIONS.task, subjectRef: `${HANDOFF_SUBJECT}${taskId}`,
      objectRef, metadata: eventMetadata("task", task) });
    return this.state(taskId);
  }

  async appendCheckpoint({ task_id: taskId, agent_id: agentId, generation, worktree, status = "ACTIVE", entries,
    recorded_at_utc: recordedAtUtc = new Date().toISOString(), actor = "controller", allow_frozen_final: allowFrozenFinal = false,
  } = {}) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    invariant(agentId === state.lease_holder.agent_id && generation === state.lease_holder.generation,
      "CHECKPOINT_LEASE_MISMATCH", "checkpoint author does not own the task lease");
    invariant(!state.writes_frozen || (allowFrozenFinal === true && status === "FINAL"
      && state.active_handoff.stage === "FREEZE_PREDECESSOR_WRITES"),
    "PREDECESSOR_WRITES_FROZEN", "predecessor writes are frozen");
    assertWorktree(worktree, "INVALID_CONTINUITY_CHECKPOINT");
    invariant(CHECKPOINT_STATUSES.includes(status), "INVALID_CONTINUITY_CHECKPOINT", "checkpoint status is invalid");
    invariant(Array.isArray(entries) && entries.length > 0, "INVALID_CONTINUITY_CHECKPOINT", "entries are required");
    entries.forEach(assertEntry);
    utc(recordedAtUtc, "INVALID_CONTINUITY_CHECKPOINT", "checkpoint time");
    const checkpoint = {
      schema: CONTINUITY_CHECKPOINT_SCHEMA,
      version: CONTINUITY_VERSION,
      project_id: this.project.config.project_id,
      task_id: taskId,
      checkpoint_number: state.checkpoints.length + 1,
      status,
      recorded_at_utc: recordedAtUtc,
      agent_id: agentId,
      generation,
      worktree,
      active_goal_digest: state.active_goal_digest,
      predecessor_checkpoint_digest: state.checkpoints.at(-1)?.checkpoint_digest ?? null,
      entries,
      checkpoint_digest: null,
    };
    checkpoint.checkpoint_digest = contentDigest("agentos.memory.continuity-checkpoint.v1", checkpoint,
      "checkpoint_digest");
    assertCheckpoint(checkpoint, this.project.config.project_id);
    const objectRef = await this.project.putJson(checkpoint);
    await this.project.commit({ actor, action: EVENT_ACTIONS.checkpoint, subjectRef: `${HANDOFF_SUBJECT}${taskId}`,
      objectRef, metadata: eventMetadata("checkpoint", checkpoint) });
    await this.recoverHandoffProjection(taskId);
    return checkpoint;
  }

  async appendFinalCheckpoint(input = {}) {
    return this.appendCheckpoint({ ...input, status: "FINAL", allow_frozen_final: true });
  }

  async recoverHandoffProjection(taskId) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    const expected = state.checkpoints.map(renderCheckpoint).join("");
    const path = await handoffPath(this.project, taskId);
    const receipt = await appendProjectionSuffix(path, expected);
    return Object.freeze({ task_id: taskId, path, checkpoint_count: state.checkpoints.length,
      projection_digest: sha256Ref("agentos.memory.handoff-projection.v1", Buffer.from(expected, "utf8")), ...receipt });
  }

  async amendGoal({ task_id: taskId, authority_ref: authorityRef, reason, success_criteria: successCriteria,
    evidence_refs: evidenceRefs, recorded_at_utc: recordedAtUtc = new Date().toISOString(), actor = "owner" } = {}) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    invariant(state.active_handoff === null || ["DIVERGENCE", "ARCHIVE_PREDECESSOR"].includes(state.active_handoff.stage),
      "GOAL_AMENDMENT_DURING_HANDOFF", "goal cannot change during an uncommitted handoff");
    const amendment = {
      schema: GOAL_AMENDMENT_SCHEMA,
      version: CONTINUITY_VERSION,
      project_id: this.project.config.project_id,
      task_id: taskId,
      amendment_number: state.amendments.length + 1,
      authority_ref: authorityRef,
      reason,
      success_criteria: successCriteria,
      evidence_refs: evidenceRefs,
      recorded_at_utc: recordedAtUtc,
      predecessor_amendment_digest: state.amendments.at(-1)?.amendment_digest ?? null,
      amendment_digest: null,
    };
    amendment.amendment_digest = contentDigest("agentos.memory.goal-amendment.v1", amendment, "amendment_digest");
    assertAmendment(amendment, this.project.config.project_id);
    const objectRef = await this.project.putJson(amendment);
    await this.project.commit({ actor, action: EVENT_ACTIONS.amendment, subjectRef: `${HANDOFF_SUBJECT}${taskId}`,
      objectRef, metadata: eventMetadata("amendment", amendment) });
    return this.state(taskId);
  }

  async recordFailure({ task_id: taskId, agent_id: agentId, generation, failure_class: failureClass,
    normalized_scope: normalizedScope, normalized_cause: normalizedCause, affected_gate: affectedGate,
    evidence_refs: evidenceRefs, route, recorded_at_utc: recordedAtUtc = new Date().toISOString(),
    actor = "controller" } = {}) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    invariant(agentId === state.lease_holder.agent_id && generation === state.lease_holder.generation,
      "FAILURE_LEASE_MISMATCH", "failure reporter does not own the task lease");
    const signatureBody = { failure_class: failureClass, normalized_scope: normalizedScope,
      normalized_cause: normalizedCause, affected_gate: affectedGate };
    const failure = {
      schema: FAILURE_SIGNATURE_SCHEMA,
      version: CONTINUITY_VERSION,
      project_id: this.project.config.project_id,
      task_id: taskId,
      agent_id: agentId,
      generation,
      ...signatureBody,
      evidence_refs: evidenceRefs,
      route,
      signature_digest: sha256Ref("agentos.memory.failure-signature.v1", canonicalBytes(signatureBody)),
      route_digest: routeDigest(route),
      recorded_at_utc: recordedAtUtc,
      failure_digest: null,
    };
    failure.failure_digest = contentDigest("agentos.memory.failure-record.v1", failure, "failure_digest");
    assertFailure(failure, this.project.config.project_id);
    const objectRef = await this.project.putJson(failure);
    await this.project.commit({ actor, action: EVENT_ACTIONS.failure, subjectRef: `${HANDOFF_SUBJECT}${taskId}`,
      objectRef, metadata: eventMetadata("failure", failure) });
    const next = await this.state(taskId);
    return Object.freeze({ failure, streak: next.failure_streak });
  }

  async beginHandoff({ task_id: taskId, transaction_id: transactionId, actor_id: actorId,
    successor_agent_id: successorAgentId, successor_generation: successorGeneration, successor_route: successorRoute,
    recorded_at_utc: recordedAtUtc = new Date().toISOString(), actor = "controller" } = {}) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    const latestWorktree = state.checkpoints.at(-1)?.worktree ?? state.task.worktree;
    const payload = {
      predecessor_agent_id: state.lease_holder.agent_id,
      predecessor_generation: state.lease_holder.generation,
      successor_agent_id: successorAgentId,
      successor_generation: successorGeneration,
      successor_route: successorRoute,
      successor_route_digest: routeDigest(successorRoute),
      expected_worktree_digest: worktreeDigest(latestWorktree),
    };
    const transition = transitionObject({ projectId: this.project.config.project_id, taskId, transactionId,
      action: "PREPARE_HANDOFF", actorId, recordedAtUtc, predecessorTransitionDigest: null, payload });
    const preview = structuredClone(state);
    applyHandoffTransition(preview, transition);
    await this.#commitTransition(taskId, transition, actor);
    return this.state(taskId);
  }

  async advanceHandoff({ task_id: taskId, transaction_id: transactionId, action, actor_id: actorId, payload,
    recorded_at_utc: recordedAtUtc = new Date().toISOString(), actor = "controller" } = {}) {
    await this.#authorityGuard();
    invariant(action !== "PREPARE_HANDOFF", "INVALID_HANDOFF_ORDER", "use beginHandoff for PREPARE_HANDOFF");
    const state = await this.state(taskId);
    invariant(state.active_handoff !== null, "HANDOFF_NOT_ACTIVE", "no handoff transaction is active");
    const transition = transitionObject({ projectId: this.project.config.project_id, taskId, transactionId,
      action, actorId, recordedAtUtc, predecessorTransitionDigest: state.active_handoff.last_transition_digest,
      payload });
    const preview = structuredClone(state);
    applyHandoffTransition(preview, transition);
    await this.#commitTransition(taskId, transition, actor);
    return this.state(taskId);
  }

  async #commitTransition(taskId, transition, actor) {
    const objectRef = await this.project.putJson(transition);
    await this.project.commit({ actor, action: EVENT_ACTIONS.handoff, subjectRef: `${HANDOFF_SUBJECT}${taskId}`,
      objectRef, metadata: eventMetadata("handoff", transition) });
  }

  async checkpointFailsafe(taskId, { now_utc: nowUtc = new Date().toISOString() } = {}) {
    await this.#authorityGuard();
    const state = await this.state(taskId);
    utc(nowUtc, "INVALID_FAILSAFE_TIME", "failsafe time");
    const last = state.checkpoints.at(-1)?.recorded_at_utc ?? state.task.created_at_utc;
    const elapsed = Math.max(0, Date.parse(nowUtc) - Date.parse(last));
    const threshold = state.task.checkpoint_max_interval_minutes * 60_000;
    return Object.freeze({
      task_id: taskId,
      lifecycle_authority: "STATE_MACHINE",
      timer_authority: "FAILSAFE_ONLY",
      last_checkpoint_at_utc: last,
      now_utc: nowUtc,
      max_interval_minutes: state.task.checkpoint_max_interval_minutes,
      overdue: elapsed > threshold,
      disposition: elapsed > threshold ? "CHECKPOINT_REQUIRED" : "NO_TIMER_ACTION",
    });
  }
}

export function compileSuccessorChecksum(payload) {
  requirePayload(payload, ["successor_context_digest", "checkpoint_digest", "goal_digest",
    "worktree_manifest_digest", "role_context_manifest_digest"], "INVALID_HANDOFF_PAYLOAD",
  "successor checksum input");
  for (const value of Object.values(payload)) digest(value, "INVALID_HANDOFF_PAYLOAD", "successor checksum input");
  return sha256Ref("agentos.memory.successor-checksum.v1", canonicalBytes(payload));
}

export function compileSuccessorAck({ transaction_id: transactionId, successor_agent_id: successorAgentId,
  successor_generation: successorGeneration, checksum_digest: checksumDigest } = {}) {
  identifier(transactionId, "INVALID_HANDOFF_PAYLOAD", "handoff transaction ID");
  identifier(successorAgentId, "INVALID_HANDOFF_PAYLOAD", "successor agent ID");
  invariant(Number.isSafeInteger(successorGeneration) && successorGeneration >= 2,
    "INVALID_HANDOFF_PAYLOAD", "successor generation is invalid");
  digest(checksumDigest, "INVALID_HANDOFF_PAYLOAD", "successor checksum digest");
  return sha256Ref("agentos.memory.successor-ack.v1", canonicalBytes({
    transaction_id: transactionId,
    successor_agent_id: successorAgentId,
    successor_generation: successorGeneration,
    checksum_digest: checksumDigest,
  }));
}

export function compileProposedLeaseTransfer({ transaction_id: transactionId, from_agent_id: fromAgentId,
  to_agent_id: toAgentId, worktree_id: worktreeId } = {}) {
  for (const [value, label] of [[transactionId, "transaction ID"], [fromAgentId, "from agent ID"],
    [toAgentId, "to agent ID"], [worktreeId, "worktree ID"]]) identifier(value, "INVALID_HANDOFF_PAYLOAD", label);
  return sha256Ref("agentos.memory.proposed-lease-transfer.v1", canonicalBytes({
    from_agent_id: fromAgentId, to_agent_id: toAgentId, worktree_id: worktreeId, transaction_id: transactionId,
  }));
}

export function continuityWorktreeDigest(worktree) {
  return worktreeDigest(worktree);
}

export const CONTINUITY_EVENT_ACTIONS = EVENT_ACTIONS;
