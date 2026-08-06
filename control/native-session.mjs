import {assert, digestWithout} from "./canonical-json.mjs";
import {validateGateResponse} from "./gate-response.mjs";
import {validateHostWorkerBoundaryForAdmission} from "./host-worker-boundary.mjs";
import {validateWorkspaceBoundary} from "./workspace-boundary.mjs";
import {validateCampaignVersion} from "./campaign-names.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {assertOpaqueReference, bindRuntimeIdentity, getRuntimeIdentity, isOpaqueReference, opaqueReference, sessionReference} from "./opaque-reference.mjs";

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
  assertOpaqueReference(value, "task", label);
}

function normalizeAdmission(admission) {
  assert(admission && typeof admission === "object" && !Array.isArray(admission), "native admission is required");
  if (isOpaqueReference(admission.task_name, "task")) return admission;
  return {
    ...admission,
    task_name: opaqueReference("task", admission.task_name, `${admission.project_id}:${admission.campaign_id}:${admission.goal_id}:${admission.lane_id}`),
  };
}

const ADMISSION_FIELDS = [
  "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256",
  "lane_id", "role_id", "role_display_name", "source_commit", "source_tree",
  "worktree_id", "environment_id", "workspace_boundary", "governance_digest", "task_name", "prompt",
];

const THREAD_IDENTITY_FIELDS = [
  "thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id",
  "lane_id", "role_id", "source_commit", "source_tree", "worktree_id",
];

export function validateAdmission(admission) {
  exactKeys(admission, ADMISSION_FIELDS, "native admission");
  for (const field of ["project_id", "campaign_id", "goal_id", "role_id", "worktree_id", "environment_id"]) stable(admission[field], `admission.${field}`);
  validateCampaignVersion(admission.campaign_version, "admission.campaign_version");
  lane(admission.lane_id, "admission.lane_id");
  task(admission.task_name, "admission.task_name");
  nonempty(admission.role_display_name, "admission.role_display_name");
  nonempty(admission.prompt, "admission.prompt");
  assert(COMMIT.test(admission.source_commit), "admission.source_commit is invalid");
  assert(COMMIT.test(admission.source_tree), "admission.source_tree is invalid");
  assert(SHA256.test(admission.goal_sha256), "admission.goal_sha256 is invalid");
  assert(SHA256.test(admission.governance_digest), "admission.governance_digest is invalid");
  validateWorkspaceBoundary(admission.workspace_boundary);
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
  const bindingIdentity = {
    source_commit: admission.source?.source_commit ?? admission.source_commit,
    source_tree: admission.source?.source_tree ?? admission.source_tree,
    worktree_id: admission.source?.worktree_id ?? admission.worktree_id,
    goal_id: admission.goal_id,
    environment_id: admission.source?.environment_id ?? admission.environment_id,
  };
  const binding = `${admission.project_id}:${admission.campaign_id}:${admission.goal_id}:${admission.governance_digest}`;
  return {
    thread_id: opaqueReference("thread", raw.thread_id, binding),
    host_id: sessionReference(raw.host_id, bindingIdentity),
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    lane_id: admission.lane_id,
    role_id: admission.role_id,
    source_commit: admission.source_commit,
    source_tree: admission.source_tree,
    worktree_id: admission.worktree_id,
    workspace_boundary: admission.workspace_boundary,
  };
}

function expectedSessionIds(session, raw, label) {
  const runtime = getRuntimeIdentity(session);
  assert(raw.thread_id === runtime.thread_id, `${label}.thread_id differs from active session`);
  assert(raw.host_id === runtime.host_id, `${label}.host_id differs from active session`);
}

async function removeAndVerify(host, session, reason) {
  const runtime = getRuntimeIdentity(session);
  const identity = session;
  const order = [];
  const pin = await host.set_thread_pinned({thread_id: runtime.thread_id, host_id: runtime.host_id, pinned: false, identity, reason});
  order.push("UNPIN");
  assert(pin && pin.pinned === false, "host did not confirm unpin");
  const archive = await host.set_thread_archived({thread_id: runtime.thread_id, host_id: runtime.host_id, archived: true, identity, reason});
  order.push("ARCHIVE");
  assert(archive && archive.archived === true, "host did not confirm archive");
  const roster = await host.list_threads({identity, include_archived: false});
  assert(roster && Array.isArray(roster.threads), "host roster readback is invalid");
  assert(!roster.threads.some((thread) => thread.thread_id === runtime.thread_id || thread.host_id === runtime.host_id), "closed thread remains in host roster");
  order.push("ROSTER_REMOVE");
  order.push("ROSTER_VERIFY");
  return {order, active_roster_removed: true};
}

async function cleanupCreated(host, admission, created, reason) {
  assert(created && typeof created === "object", "native create returned no cleanup identity");
  assert(created.thread_id || created.host_id, "native create returned no thread or host identity for cleanup");
  let resolved = created;
  if (!created.thread_id || !created.host_id) {
    const roster = await host.list_threads({identity: {...admission}, include_archived: true});
    assert(roster && Array.isArray(roster.threads), "cleanup roster readback is invalid");
    const candidates = roster.threads.filter((thread) => (created.thread_id && thread.thread_id === created.thread_id) || (created.host_id && thread.host_id === created.host_id));
    assert(candidates.length === 1, "cleanup could not resolve the partially identified native thread");
    expectedIdentity(admission, candidates[0], "cleanup roster readback");
    resolved = {thread_id: candidates[0].thread_id, host_id: candidates[0].host_id};
  }
  const session = bindRuntimeIdentity(identityFrom(admission, resolved), {thread_id: resolved.thread_id, host_id: resolved.host_id});
  return {attempted: true, ...(await removeAndVerify(host, session, reason))};
}

export async function spawnNativeSession(host, admission, {host_worker_boundary = null} = {}) {
  validateHostAdapter(host);
  const boundAdmission = normalizeAdmission(admission);
  validateAdmission(boundAdmission);
  if (host_worker_boundary !== null) validateHostWorkerBoundaryForAdmission(host_worker_boundary, boundAdmission);
  let created = null;
  try {
    const createInput = {
      task_name: boundAdmission.task_name,
      message: boundAdmission.prompt,
      model: DEFAULT_MODEL,
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      identity: {...boundAdmission},
    };
    if (host_worker_boundary !== null) createInput.host_worker_boundary = {...host_worker_boundary};
    const raw = await host.create_thread(createInput);
    if (raw && typeof raw === "object") created = {thread_id: raw.thread_id ?? null, host_id: raw.host_id ?? null};
    exactKeys(raw, THREAD_IDENTITY_FIELDS, "create_thread readback");
    expectedIdentity(boundAdmission, raw, "create_thread readback");
    const session = bindRuntimeIdentity({
      schema: NATIVE_SESSION_SCHEMA,
      version: 1,
      status: "ACTIVE",
      ...identityFrom(boundAdmission, raw),
      model: DEFAULT_MODEL,
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      governance_digest: boundAdmission.governance_digest,
      handoff: null,
      digest: null,
    }, {thread_id: raw.thread_id, host_id: raw.host_id});
    session.digest = digestWithout(session, "digest");
    assertPortableRecord(session, "native session");
    const pin = await host.set_thread_pinned({thread_id: raw.thread_id, host_id: raw.host_id, pinned: true, identity: session});
    assert(pin && pin.pinned === true, "host did not confirm pin");
    return session;
  } catch (error) {
    if (created) {
      try { await cleanupCreated(host, boundAdmission, created, "SPAWN_FAILURE"); } catch (cleanupError) { error.cleanup_error = cleanupError.message; }
    }
    throw error;
  }
}

export async function spawnVisibleWorker(host, admission, host_worker_boundary) {
  validateHostWorkerBoundaryForAdmission(host_worker_boundary, admission);
  assert(host_worker_boundary.workspace_mode === "HOST_MANAGED_VISIBLE", "visible worker spawn requires a host-managed visible boundary");
  return spawnNativeSession(host, admission, {host_worker_boundary});
}

export function validateSession(session) {
  exactKeys(session, ["schema", "version", "status", ...THREAD_IDENTITY_FIELDS, "workspace_boundary", "model", "reasoning_effort", "governance_digest", "handoff", "digest"], "native session");
  assert(session.schema === NATIVE_SESSION_SCHEMA && session.version === 1, "native session identity is invalid");
  assert(session.status === "ACTIVE", "native session is not active");
  assertOpaqueReference(session.thread_id, "thread", "session.thread_id");
  assertOpaqueReference(session.host_id, "session", "session.host_id");
  for (const field of THREAD_IDENTITY_FIELDS.slice(2)) nonempty(session[field], `session.${field}`);
  validateWorkspaceBoundary(session.workspace_boundary);
  assert(COMMIT.test(session.source_commit) && COMMIT.test(session.source_tree), "native session source identity is invalid");
  assert(session.model === DEFAULT_MODEL && session.reasoning_effort === DEFAULT_REASONING_EFFORT, "native session defaults are invalid");
  assert(SHA256.test(session.governance_digest), "native session governance digest is invalid");
  assert(session.handoff === null, "active native session already has a handoff");
  assert(SHA256.test(session.digest) && session.digest === digestWithout(session, "digest"), "native session digest does not match content");
  return session;
}

export async function readMeaningfulProgress(host, session, timeout_ms = 900_000, {secretValues = []} = {}) {
  validateSession(session);
  const runtime = getRuntimeIdentity(session);
  const waited = await host.wait_threads({targets: [{thread_id: runtime.thread_id, host_id: runtime.host_id}], timeout_ms, identity: session});
  assert(waited && Array.isArray(waited.threads) && waited.threads.length === 1, "wait_threads returned the wrong target count");
  assert(waited.threads[0].thread_id === runtime.thread_id && waited.threads[0].host_id === runtime.host_id, "wait_threads returned the wrong target");
  const raw = await host.read_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, view: "progress"});
  expectedIdentity(session, raw, "progress readback");
  expectedSessionIds(session, raw, "progress readback");
  exactKeys(raw, [...THREAD_IDENTITY_FIELDS, "progress"], "progress readback");
  exactKeys(raw.progress, ["result_type", "summary", "artifact_sha256", "evidence_sha256"], "progress");
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(raw.progress.result_type), "progress is not meaningful");
  nonempty(raw.progress.summary, "progress.summary");
  assert(SHA256.test(raw.progress.artifact_sha256) && SHA256.test(raw.progress.evidence_sha256), "progress evidence is invalid");
  assertPortableRecord(raw.progress, "native progress", {secretValues});
  return raw.progress;
}

export async function readGatePacket(host, session, {renderedForGate = null} = {}) {
  validateSession(session);
  const runtime = getRuntimeIdentity(session);
  const raw = await host.read_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, view: "gate_packet"});
  expectedIdentity(session, raw, "gate packet readback");
  expectedSessionIds(session, raw, "gate packet readback");
  exactKeys(raw, [...THREAD_IDENTITY_FIELDS, "gate_packet"], "gate packet readback");
  assert(Array.isArray(raw.gate_packet) && raw.gate_packet.length > 0, "gate packet is empty");
  for (const [index, item] of raw.gate_packet.entries()) {
    if (renderedForGate) {
      exactKeys(item, ["gate_id", "gate_name", "context", "question", "answer", "evidence", "response"], `gate packet ${index}`);
      const rendered = renderedForGate(item.gate_id);
      assert(rendered && typeof rendered === "object", `gate packet ${index} has no rendered gate`);
      assert(item.gate_name === rendered.gate_name && item.context === rendered.context && item.question === rendered.question, `gate packet ${index} display differs from the governed question`);
      validateGateResponse(item.response, rendered, {evidence: item.evidence});
    } else exactKeys(item, ["gate_id", "answer", "evidence"], `gate packet ${index}`);
    nonempty(item.gate_id, `gate packet ${index}.gate_id`);
    assert(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"].includes(item.answer), `gate packet ${index}.answer is invalid`);
    assert(item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence), `gate packet ${index}.evidence is invalid`);
  }
  return raw.gate_packet;
}

export async function closeNativeSession(host, session, handoff, {secretValues = []} = {}) {
  validateSession(session);
  const runtime = getRuntimeIdentity(session);
  exactKeys(handoff, ["summary", "result_type", "artifact_sha256", "evidence_sha256"], "handoff input");
  nonempty(handoff.summary, "handoff.summary");
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(handoff.result_type), "handoff is not meaningful");
  assert(SHA256.test(handoff.artifact_sha256) && SHA256.test(handoff.evidence_sha256), "handoff evidence is invalid");
  assertPortableRecord(handoff, "native handoff input", {secretValues});
  await host.send_message_to_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, message: "Return the final typed handoff for this task."});
  const raw = await host.read_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, view: "handoff"});
  expectedIdentity(session, raw, "handoff readback");
  expectedSessionIds(session, raw, "handoff readback");
  exactKeys(raw, [...THREAD_IDENTITY_FIELDS, "handoff"], "handoff readback");
  exactKeys(raw.handoff, ["summary", "result_type", "artifact_sha256", "evidence_sha256"], "typed handoff");
  assert(raw.handoff.summary === handoff.summary && raw.handoff.result_type === handoff.result_type && raw.handoff.artifact_sha256 === handoff.artifact_sha256 && raw.handoff.evidence_sha256 === handoff.evidence_sha256, "host handoff differs from the requested handoff");
  assertPortableRecord(raw.handoff, "native typed handoff", {secretValues});
  const closure = await removeAndVerify(host, session, "NORMAL_CLOSURE");
  const closed = {...session, status: "CLOSED", handoff: raw.handoff, digest: null};
  closed.digest = digestWithout(closed, "digest");
  assertPortableRecord(closed, "closed native session", {secretValues});
  return {session: closed, closure};
}

export async function abortNativeSession(host, session, reason) {
  validateSession(session);
  nonempty(reason, "abort reason");
  return removeAndVerify(host, session, reason);
}
