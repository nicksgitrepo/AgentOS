import {assert, digestWithout} from "./canonical-json.mjs";

export const NATIVE_SESSION_SCHEMA = "agentos.native_session.v1";
export const DEFAULT_MODEL = "gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT = "max";
export const REQUIRED_HOST_ACTIONS = Object.freeze([
  "create_thread",
  "list_threads",
  "read_thread",
  "wait_threads",
  "send_message_to_thread",
  "set_thread_pinned",
  "set_thread_archived",
  "remove_from_active_roster",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ID = /^[A-Z][A-Z0-9._-]*$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function stable(value, label) {
  nonempty(value, label);
  assert(ID.test(value), `${label} is not a stable ID`);
}

function lane(value, label) {
  nonempty(value, label);
  assert(/^[a-z][a-z0-9._-]*$/u.test(value), `${label} is not a stable lane ID`);
}

function task(value, label) {
  nonempty(value, label);
  assert(/^[a-z][a-z0-9._-]*$/u.test(value), `${label} is not a stable task name`);
}

const ADMISSION_FIELDS = [
  "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256",
  "lane_id", "role_id", "role_display_name", "source_commit", "source_tree",
  "worktree_id", "governance_digest", "task_name", "prompt",
];

const THREAD_IDENTITY_FIELDS = [
  "thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id",
  "lane_id", "role_id", "source_commit", "source_tree", "worktree_id",
];

export function validateAdmission(admission) {
  exactKeys(admission, ADMISSION_FIELDS, "native admission");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id", "role_id", "worktree_id"]) stable(admission[field], `admission.${field}`);
  lane(admission.lane_id, "admission.lane_id");
  task(admission.task_name, "admission.task_name");
  nonempty(admission.role_display_name, "admission.role_display_name");
  nonempty(admission.prompt, "admission.prompt");
  assert(COMMIT.test(admission.source_commit), "admission.source_commit is invalid");
  assert(COMMIT.test(admission.source_tree), "admission.source_tree is invalid");
  assert(SHA256.test(admission.goal_sha256), "admission.goal_sha256 is invalid");
  assert(SHA256.test(admission.governance_digest), "admission.governance_digest is invalid");
  return admission;
}

export function validateHostAdapter(host) {
  assert(host && typeof host === "object", "native host adapter is required");
  for (const action of REQUIRED_HOST_ACTIONS) assert(typeof host[action] === "function", `native host action missing: ${action}`);
  return host;
}

function expectedIdentity(admission, raw, label) {
  assert(raw && typeof raw === "object" && !Array.isArray(raw), `${label} must be an object`);
  for (const field of ["thread_id", "host_id"]) stable(raw[field], `${label}.${field}`);
  assert(raw.project_id === admission.project_id, `${label}.project_id differs`);
  assert(raw.campaign_id === admission.campaign_id, `${label}.campaign_id differs`);
  assert(raw.campaign_version === admission.campaign_version, `${label}.campaign_version differs`);
  assert(raw.goal_id === admission.goal_id, `${label}.goal_id differs`);
  assert(raw.lane_id === admission.lane_id, `${label}.lane_id differs`);
  assert(raw.role_id === admission.role_id, `${label}.role_id differs`);
  assert(raw.source_commit === admission.source_commit, `${label}.source_commit differs`);
  assert(raw.source_tree === admission.source_tree, `${label}.source_tree differs`);
  assert(raw.worktree_id === admission.worktree_id, `${label}.worktree_id differs`);
  return raw;
}

function identityFrom(admission, raw) {
  return {
    thread_id: raw.thread_id,
    host_id: raw.host_id,
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    lane_id: admission.lane_id,
    role_id: admission.role_id,
    source_commit: admission.source_commit,
    source_tree: admission.source_tree,
    worktree_id: admission.worktree_id,
  };
}

function idsFor(session) {
  return {thread_id: session.thread_id, host_id: session.host_id, identity: session.identity};
}

async function removeAndVerify(host, session, reason) {
  const identity = session.identity;
  const order = [];
  const pin = await host.set_thread_pinned({thread_id: session.thread_id, pinned: false, identity, reason});
  order.push("UNPIN");
  assert(pin && pin.pinned === false, "host did not confirm unpin");
  const archive = await host.set_thread_archived({thread_id: session.thread_id, archived: true, identity, reason});
  order.push("ARCHIVE");
  assert(archive && archive.archived === true, "host did not confirm archive");
  const removed = await host.remove_from_active_roster({thread_id: session.thread_id, host_id: session.host_id, identity, reason});
  order.push("ROSTER_REMOVE");
  assert(removed && removed.active_roster_removed === true, "host did not confirm roster removal");
  const roster = await host.list_threads({identity, include_archived: true});
  assert(roster && Array.isArray(roster.threads), "host roster readback is invalid");
  assert(!roster.threads.some((thread) => thread.thread_id === session.thread_id), "closed thread remains in host roster");
  order.push("ROSTER_VERIFY");
  return {order, active_roster_removed: true};
}

async function cleanupCreated(host, admission, created, reason) {
  if (!created?.thread_id || !created?.host_id) return {attempted: false, order: [], active_roster_removed: false};
  const session = {thread_id: created.thread_id, host_id: created.host_id, identity: identityFrom(admission, created)};
  return {attempted: true, ...(await removeAndVerify(host, session, reason))};
}

export async function spawnNativeSession(host, admission) {
  validateHostAdapter(host);
  validateAdmission(admission);
  let created = null;
  try {
    const raw = await host.create_thread({
      task_name: admission.task_name,
      message: admission.prompt,
      model: DEFAULT_MODEL,
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      identity: {...admission},
    });
    if (raw && typeof raw === "object") created = {thread_id: raw.thread_id, host_id: raw.host_id};
    exactKeys(raw, THREAD_IDENTITY_FIELDS, "create_thread readback");
    expectedIdentity(admission, raw, "create_thread readback");
    const session = {
      schema: NATIVE_SESSION_SCHEMA,
      version: 1,
      status: "ACTIVE",
      ...identityFrom(admission, raw),
      model: DEFAULT_MODEL,
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      governance_digest: admission.governance_digest,
      handoff: null,
      digest: null,
    };
    session.digest = digestWithout(session, "digest");
    const pin = await host.set_thread_pinned({thread_id: raw.thread_id, pinned: true, identity: session});
    assert(pin && pin.pinned === true, "host did not confirm pin");
    return session;
  } catch (error) {
    if (created) {
      try { await cleanupCreated(host, admission, created, "SPAWN_FAILURE"); } catch (cleanupError) { error.cleanup_error = cleanupError.message; }
    }
    throw error;
  }
}

export function validateSession(session) {
  exactKeys(session, ["schema", "version", "status", ...THREAD_IDENTITY_FIELDS, "model", "reasoning_effort", "governance_digest", "handoff", "digest"], "native session");
  assert(session.schema === NATIVE_SESSION_SCHEMA && session.version === 1, "native session identity is invalid");
  assert(session.status === "ACTIVE", "native session is not active");
  for (const field of THREAD_IDENTITY_FIELDS) nonempty(session[field], `session.${field}`);
  assert(COMMIT.test(session.source_commit) && COMMIT.test(session.source_tree), "native session source identity is invalid");
  assert(session.model === DEFAULT_MODEL && session.reasoning_effort === DEFAULT_REASONING_EFFORT, "native session defaults are invalid");
  assert(SHA256.test(session.governance_digest), "native session governance digest is invalid");
  assert(session.handoff === null, "active native session already has a handoff");
  assert(SHA256.test(session.digest) && session.digest === digestWithout(session, "digest"), "native session digest does not match content");
  return session;
}

export async function readMeaningfulProgress(host, session, timeout_ms = 900_000) {
  validateSession(session);
  const waited = await host.wait_threads({targets: [{thread_id: session.thread_id, host_id: session.host_id}], timeout_ms, identity: session});
  assert(waited && Array.isArray(waited.threads) && waited.threads.length === 1, "wait_threads returned the wrong target count");
  assert(waited.threads[0].thread_id === session.thread_id && waited.threads[0].host_id === session.host_id, "wait_threads returned the wrong target");
  const raw = await host.read_thread({thread_id: session.thread_id, host_id: session.host_id, identity: session, view: "progress"});
  expectedIdentity(session, raw, "progress readback");
  exactKeys(raw, [...THREAD_IDENTITY_FIELDS, "progress"], "progress readback");
  exactKeys(raw.progress, ["result_type", "summary", "artifact_sha256", "evidence_sha256"], "progress");
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(raw.progress.result_type), "progress is not meaningful");
  nonempty(raw.progress.summary, "progress.summary");
  assert(SHA256.test(raw.progress.artifact_sha256) && SHA256.test(raw.progress.evidence_sha256), "progress evidence is invalid");
  return raw.progress;
}

export async function closeNativeSession(host, session, handoff) {
  validateSession(session);
  exactKeys(handoff, ["summary", "result_type", "artifact_sha256", "evidence_sha256"], "handoff input");
  nonempty(handoff.summary, "handoff.summary");
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(handoff.result_type), "handoff is not meaningful");
  assert(SHA256.test(handoff.artifact_sha256) && SHA256.test(handoff.evidence_sha256), "handoff evidence is invalid");
  await host.send_message_to_thread({thread_id: session.thread_id, host_id: session.host_id, identity: session, message: "Return the final typed handoff for this task."});
  const raw = await host.read_thread({thread_id: session.thread_id, host_id: session.host_id, identity: session, view: "handoff"});
  expectedIdentity(session, raw, "handoff readback");
  exactKeys(raw, [...THREAD_IDENTITY_FIELDS, "handoff"], "handoff readback");
  exactKeys(raw.handoff, ["summary", "result_type", "artifact_sha256", "evidence_sha256"], "typed handoff");
  assert(raw.handoff.summary === handoff.summary && raw.handoff.result_type === handoff.result_type, "host handoff differs from the requested handoff");
  const closure = await removeAndVerify(host, session, "NORMAL_CLOSURE");
  const closed = {...session, status: "CLOSED", handoff: raw.handoff, digest: null};
  closed.digest = digestWithout(closed, "digest");
  return {session: closed, closure};
}

export async function abortNativeSession(host, session, reason) {
  validateSession(session);
  nonempty(reason, "abort reason");
  return removeAndVerify(host, session, reason);
}
