import {assert, digestWithout, sha256} from "./canonical-json.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

export const GOAL_SCHEMA = "agentos.goal.v1";
export const WINDOW_SCHEMA = "agentos.progress_window.v1";
export const GOAL_STATUSES = Object.freeze(["ACTIVE", "SUCCEEDED_BY_REASSESSMENT", "COMPLETE", "BLOCKED"]);
export const WINDOW_STATUSES = Object.freeze(["OPEN", "PROGRESS_RECORDED", "STALLED", "CLOSED"]);
export const RESULT_TYPES = Object.freeze(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF", "FAILURE_LIST"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function timestamp(value, label) {
  assert(typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} is invalid`);
  return value;
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function id(value, label) {
  assert(typeof value === "string" && ID.test(value), `${label} is invalid`);
}

function fingerprints({objective, scope, intent, boundaries}) {
  return {
    objective_sha256: sha256(objective),
    scope_sha256: sha256(scope),
    intent_sha256: sha256(intent),
    boundaries_sha256: sha256(boundaries),
    conditions_sha256: sha256({scope, intent, boundaries}),
  };
}

export function createGoal({goal_id, objective, scope, intent, boundaries, created_at_utc}) {
  id(goal_id, "goal_id");
  nonempty(objective, "objective");
  timestamp(created_at_utc, "created_at_utc");
  const goal = {
    schema: GOAL_SCHEMA,
    version: 1,
    status: "ACTIVE",
    goal_id,
    objective,
    scope,
    intent,
    boundaries,
    fingerprints: fingerprints({objective, scope, intent, boundaries}),
    created_at_utc,
    closed_at_utc: null,
    close_reason: null,
    replacement_goal_id: null,
    digest: null,
  };
  return {...goal, digest: digestWithout(goal, "digest")};
}

export function validateGoal(goal) {
  assertPortableRecord(goal, "goal");
  exactKeys(goal, ["schema", "version", "status", "goal_id", "objective", "scope", "intent", "boundaries", "fingerprints", "created_at_utc", "closed_at_utc", "close_reason", "replacement_goal_id", "digest"], "goal");
  assert(goal.schema === GOAL_SCHEMA && goal.version === 1, "goal identity is invalid");
  assert(GOAL_STATUSES.includes(goal.status), "goal status is invalid");
  id(goal.goal_id, "goal_id");
  nonempty(goal.objective, "objective");
  timestamp(goal.created_at_utc, "created_at_utc");
  exactKeys(goal.fingerprints, ["objective_sha256", "scope_sha256", "intent_sha256", "boundaries_sha256", "conditions_sha256"], "goal fingerprints");
  for (const value of Object.values(goal.fingerprints)) assert(DIGEST.test(value), "goal fingerprint is invalid");
  if (goal.closed_at_utc !== null) timestamp(goal.closed_at_utc, "closed_at_utc");
  if (goal.close_reason !== null) nonempty(goal.close_reason, "close_reason");
  if (goal.replacement_goal_id !== null) id(goal.replacement_goal_id, "replacement_goal_id");
  assert(DIGEST.test(goal.digest) && goal.digest === digestWithout(goal, "digest"), "goal digest does not match content");
  assert(JSON.stringify(goal.fingerprints) === JSON.stringify(fingerprints(goal)), "goal fingerprints do not match content");
  if (goal.status === "ACTIVE") assert(goal.closed_at_utc === null && goal.close_reason === null && goal.replacement_goal_id === null, "active goal has closure fields");
  if (goal.status === "SUCCEEDED_BY_REASSESSMENT") assert(goal.closed_at_utc !== null && goal.close_reason === "CONDITIONS_CHANGED" && goal.replacement_goal_id !== null, "reassessed goal closure is incomplete");
  return goal;
}

export function reassessGoal(goal, observation) {
  validateGoal(goal);
  exactKeys(observation, ["objective", "scope", "intent", "boundaries", "observed_at_utc", "reason", "replacement_goal_id"], "goal reassessment");
  nonempty(observation.objective, "reassessment objective");
  timestamp(observation.observed_at_utc, "reassessment observed_at_utc");
  nonempty(observation.reason, "reassessment reason");
  const nextFingerprints = fingerprints(observation);
  const unchanged = JSON.stringify(nextFingerprints) === JSON.stringify(goal.fingerprints);
  if (unchanged) return {status: "UNCHANGED", goal, observation_digest: sha256(observation), replacement_goal: null};
  id(observation.replacement_goal_id, "replacement_goal_id");
  const closed = {
    ...goal,
    status: "SUCCEEDED_BY_REASSESSMENT",
    closed_at_utc: observation.observed_at_utc,
    close_reason: "CONDITIONS_CHANGED",
    replacement_goal_id: observation.replacement_goal_id,
    digest: null,
  };
  closed.digest = digestWithout(closed, "digest");
  const replacement = createGoal({
    goal_id: observation.replacement_goal_id,
    objective: observation.objective,
    scope: observation.scope,
    intent: observation.intent,
    boundaries: observation.boundaries,
    created_at_utc: observation.observed_at_utc,
  });
  validateGoal(closed);
  return {status: "REPLACEMENT_REQUIRED", goal: closed, observation_digest: sha256(observation), replacement_goal: replacement};
}

export function createProgressWindow({window_id, worker_id, goal_id, started_at_utc, window_minutes = 15}) {
  id(window_id, "window_id");
  id(worker_id, "worker_id");
  id(goal_id, "goal_id");
  timestamp(started_at_utc, "started_at_utc");
  assert(Number.isInteger(window_minutes) && window_minutes > 0 && window_minutes <= 240, "window_minutes must be between 1 and 240");
  const deadline = new Date(Date.parse(started_at_utc) + window_minutes * 60_000).toISOString();
  const window = {
    schema: WINDOW_SCHEMA,
    version: 1,
    status: "OPEN",
    window_id,
    worker_id,
    goal_id,
    window_minutes,
    started_at_utc,
    deadline_at_utc: deadline,
    last_result: null,
    stall_reason: null,
    digest: null,
  };
  return {...window, digest: digestWithout(window, "digest")};
}

export function validateProgressWindow(window) {
  assertPortableRecord(window, "progress window");
  exactKeys(window, ["schema", "version", "status", "window_id", "worker_id", "goal_id", "window_minutes", "started_at_utc", "deadline_at_utc", "last_result", "stall_reason", "digest"], "progress window");
  assert(window.schema === WINDOW_SCHEMA && window.version === 1, "progress window identity is invalid");
  assert(WINDOW_STATUSES.includes(window.status), "progress window status is invalid");
  id(window.window_id, "window_id"); id(window.worker_id, "worker_id"); id(window.goal_id, "goal_id");
  assert(Number.isInteger(window.window_minutes) && window.window_minutes > 0 && window.window_minutes <= 240, "window_minutes is invalid");
  timestamp(window.started_at_utc, "started_at_utc");
  timestamp(window.deadline_at_utc, "deadline_at_utc");
  assert(Date.parse(window.deadline_at_utc) === Date.parse(window.started_at_utc) + window.window_minutes * 60_000, "deadline does not match window");
  if (window.last_result !== null) {
    exactKeys(window.last_result, ["result_type", "summary", "artifact_sha256", "evidence_sha256", "observed_at_utc", "digest"], "worker result");
    assert(RESULT_TYPES.includes(window.last_result.result_type), "worker result type is invalid");
    nonempty(window.last_result.summary, "worker result summary");
    assert(DIGEST.test(window.last_result.artifact_sha256) && DIGEST.test(window.last_result.evidence_sha256), "worker result digest is invalid");
    timestamp(window.last_result.observed_at_utc, "worker result observed_at_utc");
    assert(DIGEST.test(window.last_result.digest) && window.last_result.digest === digestWithout(window.last_result, "digest"), "worker result digest does not match content");
  }
  if (window.stall_reason !== null) nonempty(window.stall_reason, "stall_reason");
  assert(DIGEST.test(window.digest) && window.digest === digestWithout(window, "digest"), "progress window digest does not match content");
  if (window.status === "OPEN") assert(window.last_result === null && window.stall_reason === null, "open window has a result or stall reason");
  if (window.status === "PROGRESS_RECORDED") assert(window.last_result !== null && window.last_result.result_type !== "FAILURE_LIST" && window.stall_reason === null, "progress window result is not meaningful");
  if (window.status === "STALLED") assert(window.stall_reason !== null, "stalled window lacks a reason");
  return window;
}

export function recordWorkerResult(window, result) {
  validateProgressWindow(window);
  exactKeys(result, ["result_type", "summary", "artifact_sha256", "evidence_sha256", "observed_at_utc"], "worker result input");
  assert(RESULT_TYPES.includes(result.result_type), "worker result type is invalid");
  nonempty(result.summary, "worker result summary");
  assert(DIGEST.test(result.artifact_sha256) && DIGEST.test(result.evidence_sha256), "worker result digests are invalid");
  timestamp(result.observed_at_utc, "worker result observed_at_utc");
  assert(window.status === "OPEN", "worker window is no longer open");
  const record = {...result, digest: null};
  record.digest = digestWithout(record, "digest");
  const afterDeadline = Date.parse(result.observed_at_utc) >= Date.parse(window.deadline_at_utc);
  const stalled = result.result_type === "FAILURE_LIST" || afterDeadline;
  const next = {
    ...window,
    status: stalled ? "STALLED" : "PROGRESS_RECORDED",
    last_result: record,
    stall_reason: result.result_type === "FAILURE_LIST" ? "FAILURE_LIST_ONLY" : afterDeadline ? "WINDOW_EXPIRED" : null,
    digest: null,
  };
  next.digest = digestWithout(next, "digest");
  return validateProgressWindow(next);
}

export function evaluateProgressWindow(window, observed_at_utc) {
  validateProgressWindow(window);
  timestamp(observed_at_utc, "observed_at_utc");
  if (window.status !== "OPEN") return {status: window.status, window};
  if (Date.parse(observed_at_utc) < Date.parse(window.deadline_at_utc)) return {status: "OPEN", window};
  const stalled = {...window, status: "STALLED", stall_reason: "WINDOW_EXPIRED", digest: null};
  stalled.digest = digestWithout(stalled, "digest");
  return {status: "STALLED", window: validateProgressWindow(stalled)};
}
