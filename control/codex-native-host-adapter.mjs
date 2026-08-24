#!/usr/bin/env node

/*
 * In-process Codex host bridge.
 *
 * AgentOS never imports the desktop application or stores its private runtime
 * objects. The parent Codex task supplies these callbacks while the bridge
 * translates them into the portable native-host contract. Host-local paths,
 * environment values, and provider objects stay inside this closure.
 */

import {
  bindNativeHost,
  compileNativeHostAttachment,
  validateNativeHostAdapter,
} from "./native-host-attachment.mjs";
import {DEFAULT_AGENT_MODEL, DEFAULT_AGENT_REASONING_EFFORT, NATIVE_SESSION_TOOLS} from "./native-host-contract.mjs";
import {canonicalDigest} from "./content-addressing.mjs";

export const CODEX_TASK_LIST_READBACK_MODE = "CODEX_APP_LISTED_TASKS";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireFunction(value, label) {
  assert(typeof value === "function", `${label} callback is required`);
}

function decodeHostReadback(value, label) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} was not structured data; error_ref:opaque:${canonicalDigest(value)}`);
  }
}

function taskRosterFrom(value) {
  if (!isRecord(value)) return [];
  const candidates = [value.threads, value.pinnedThreads, value.active_roster, value.activeRoster, value.active_sessions];
  const list = candidates.find(Array.isArray);
  if (list !== undefined) return list;
  if (isRecord(value.thread)) return [value.thread];
  if (isRecord(value.task)) return [value.task];
  if (typeof (value.runtime_task_id ?? value.runtimeTaskId ?? value.task_id ?? value.taskId ?? value.thread_id ?? value.threadId ?? value.id) === "string") return [value];
  return [];
}

function taskIdFrom(task, index) {
  const id = task.runtime_task_id ?? task.runtimeTaskId ?? task.task_id ?? task.taskId ?? task.thread_id ?? task.threadId ?? task.id;
  assert(typeof id === "string" && id.trim().length > 0, `Codex task ${index} has no task identity`);
  return id;
}

function statusFrom(task) {
  if (typeof task.status === "string") return task.status;
  if (isRecord(task.status) && typeof task.status.type === "string") return task.status.type;
  return null;
}

function opaqueWorktreeReference(cwd, hostId) {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  const worktreeMatch = cwd.match(/(?:^|\/)worktrees\/([A-Za-z0-9._-]+)(?:\/|$)/u);
  if (worktreeMatch !== null) return "HOST_WORKTREE_" + worktreeMatch[1].toUpperCase();
  return "HOST_WORKTREE_" + canonicalDigest({host_id: hostId, cwd}).slice(0, 32).toUpperCase();
}

function normalizeCodexTaskList(raw, payload = {}) {
  raw = decodeHostReadback(raw, "Codex list_threads readback");
  requireRecord(raw, "Codex list_threads readback");
  const pinned = Array.isArray(raw.pinnedThreads) ? raw.pinnedThreads : [];
  const pinnedTaskIds = pinned.filter(isRecord).map(taskIdFrom);
  assert(new Set(pinnedTaskIds).size === pinnedTaskIds.length, "Codex pinnedThreads contains duplicate task identities");
  const listed = Array.isArray(raw.threads) ? raw.threads : taskRosterFrom(raw);
  const combined = [...pinned, ...listed];
  const hostId = raw.host_id
    ?? raw.hostId
    ?? payload.identity?.host_id
    ?? payload.host_id
    ?? combined.find((task) => isRecord(task) && typeof (task.host_id ?? task.hostId) === "string")?.host_id
    ?? combined.find((task) => isRecord(task) && typeof (task.host_id ?? task.hostId) === "string")?.hostId
    ?? null;
  const projectId = raw.project_id ?? raw.projectId ?? payload.project_id ?? payload.projectId ?? payload.identity?.project_id ?? null;
  const campaignId = raw.campaign_id ?? raw.campaignId ?? payload.campaign_id ?? payload.campaignId ?? null;
  assert(typeof hostId === "string" && hostId.trim().length > 0, "Codex list_threads readback has no bound host identity");
  assert(typeof projectId === "string" && projectId.trim().length > 0, "Codex list_threads readback has no bound project identity");
  assert(typeof campaignId === "string" && campaignId.trim().length > 0, "Codex list_threads readback has no bound campaign identity");

  const expectedTaskIds = Array.isArray(payload.runtime_task_ids)
    ? new Set(payload.runtime_task_ids.filter((value) => typeof value === "string" && value.length > 0 && !/^AUDITOR_TASK_REF_|^TASK_REF_|^VISIBLE_PLATFORM_TASK_REF_|^WORKTREE_REF_/u.test(value)))
    : null;
  const seen = new Set();
  const threads = [];
  for (const [index, task] of combined.entries()) {
    if (!isRecord(task) || task.kind === "chatgpt") continue;
    const runtimeTaskId = taskIdFrom(task, index);
    if (expectedTaskIds !== null && expectedTaskIds.size > 0 && !expectedTaskIds.has(runtimeTaskId)) continue;
    if (seen.has(runtimeTaskId)) continue;
    const taskProjectId = task.project_id ?? task.projectId;
    const taskCampaignId = task.campaign_id ?? task.campaignId;
    if (taskProjectId !== undefined && taskProjectId !== null && taskProjectId !== projectId) {
      if (expectedTaskIds !== null && expectedTaskIds.has(runtimeTaskId)) {
        throw new Error(`Codex task ${runtimeTaskId} belongs to another project`);
      }
      continue;
    }
    if ((taskProjectId === undefined || taskProjectId === null)
      && (typeof task.cwd !== "string" || !task.cwd.includes("/.codex/worktrees/"))) continue;
    assert(taskCampaignId === undefined || taskCampaignId === null || taskCampaignId === campaignId,
      `Codex task ${runtimeTaskId} belongs to another campaign`);
    const worktreeIdentity = task.runtime_worktree_id
      ?? task.runtimeWorktreeId
      ?? task.worktree_id
      ?? task.worktreeId
      ?? opaqueWorktreeReference(task.cwd, hostId);
    assert(typeof worktreeIdentity === "string" && worktreeIdentity.length > 0,
      `Codex task ${runtimeTaskId} has no worktree readback`);
    const entryHostId = task.host_id ?? task.hostId ?? hostId;
    assert(entryHostId === hostId, `Codex task ${runtimeTaskId} belongs to another host`);
    const status = statusFrom(task);
    threads.push({
      runtime_task_id: runtimeTaskId,
      runtime_worktree_id: worktreeIdentity,
      host_id: entryHostId,
      project_id: projectId,
      campaign_id: campaignId,
      visible: typeof task.visible === "boolean" ? task.visible : true,
      active: typeof task.active === "boolean" ? task.active : status === "active",
      archived: typeof task.archived === "boolean" ? task.archived : false,
      pinned: pinnedTaskIds.includes(runtimeTaskId),
    });
    seen.add(runtimeTaskId);
  }
  assert(threads.length > 0 || requestedRuntimeTaskIds(payload).length > 0,
    "Codex list_threads readback has no eligible visible tasks");
  return {
    schema: "agentos.codex_app_task_list_readback.v1",
    version: 1,
    readback_mode: CODEX_TASK_LIST_READBACK_MODE,
    host_id: hostId,
    project_id: projectId,
    campaign_id: campaignId,
    pinned_task_ids: [...pinnedTaskIds].sort((left, right) => left.localeCompare(right)),
    threads,
  };
}

function callbackSet(options) {
  const callbacks = {
    create_thread: options.createThread ?? options.create_thread,
    list_threads: options.listThreads ?? options.list_threads,
    read_thread: options.readThread ?? options.read_thread,
    send_message_to_thread: options.sendMessageToThread ?? options.send_message_to_thread,
    set_thread_archived: options.setThreadArchived ?? options.set_thread_archived,
    set_thread_pinned: options.setThreadPinned ?? options.set_thread_pinned,
    wait_threads: options.waitThreads ?? options.wait_threads,
  };
  for (const action of NATIVE_SESSION_TOOLS) requireFunction(callbacks[action], `Codex host ${action}`);
  return callbacks;
}

async function enrichCreateReadback(raw, payload, readEnvironment) {
  raw = decodeHostReadback(raw, "Codex create_thread readback");
  requireRecord(raw, "Codex create_thread readback");
  if (typeof readEnvironment !== "function") return raw;
  const context = await readEnvironment({operation: "create_thread", payload: structuredClone(payload), readback: structuredClone(raw)});
  requireRecord(context, "Codex host environment readback");
  // Only authoritative host fields are copied. No path or environment value
  // is persisted by this bridge; the native session boundary converts the
  // worktree path to an opaque reference before it becomes a record.
  return {...raw, ...context};
}

function freezeAdapter(callbacks, readEnvironment) {
  const adapter = {
    create_thread: async (payload = {}) => enrichCreateReadback(await callbacks.create_thread(payload), payload, readEnvironment),
    list_threads: async (payload = {}) => reconcileCodexTaskList({
      raw: await callbacks.list_threads(payload),
      payload,
      readThread: callbacks.read_thread,
    }),
    read_thread: async (payload = {}) => decodeHostReadback(await callbacks.read_thread(payload), "Codex read_thread readback"),
    send_message_to_thread: async (payload = {}) => decodeHostReadback(await callbacks.send_message_to_thread(payload), "Codex send_message_to_thread readback"),
    set_thread_archived: async (payload = {}) => decodeHostReadback(await callbacks.set_thread_archived(payload), "Codex set_thread_archived readback"),
    set_thread_pinned: async (payload = {}) => decodeHostReadback(await callbacks.set_thread_pinned(payload), "Codex set_thread_pinned readback"),
    wait_threads: async (payload = {}) => decodeHostReadback(await callbacks.wait_threads(payload), "Codex wait_threads readback"),
  };
  return Object.freeze(validateNativeHostAdapter(adapter));
}

export function createCodexNativeHostAdapter(options = {}) {
  requireRecord(options, "Codex native host options");
  return freezeAdapter(callbackSet(options), options.readEnvironment ?? options.read_environment);
}

export function attachCodexNativeHost({
  adapter,
  hostId,
  attachmentId,
  projectId,
  environmentId,
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
  attachedAtUtc = new Date().toISOString(),
} = {}) {
  validateNativeHostAdapter(adapter);
  const attachment = compileNativeHostAttachment({
    attachmentId,
    hostId,
    projectId,
    environmentId,
    model,
    reasoningEffort,
    attachedAtUtc,
  });
  return Object.freeze({adapter: bindNativeHost(adapter, attachment), attachment});
}

export function createAttachedCodexNativeHost(options = {}) {
  const {adapterOptions, ...attachmentOptions} = options;
  const adapter = createCodexNativeHostAdapter(adapterOptions ?? options);
  return attachCodexNativeHost({...attachmentOptions, adapter});
}
function requestedRuntimeTaskIds(payload = {}) {
  return Array.isArray(payload.runtime_task_ids)
    ? payload.runtime_task_ids.filter((value) => typeof value === "string" && value.length > 0 && !/^AUDITOR_TASK_REF_|^TASK_REF_|^VISIBLE_PLATFORM_TASK_REF_|^WORKTREE_REF_/u.test(value))
    : [];
}

async function reconcileCodexTaskList({raw, payload, readThread}) {
  const normalized = normalizeCodexTaskList(raw, payload);
  const expectedTaskIds = requestedRuntimeTaskIds(payload);
  const observedTaskIds = new Set(normalized.threads.map((entry) => entry.runtime_task_id));
  const missingTaskIds = expectedTaskIds.filter((taskId) => !observedTaskIds.has(taskId));
  if (missingTaskIds.length === 0) return normalized;
  assert(typeof readThread === "function", "Codex task list is incomplete and read_thread is unavailable");
  const additions = await Promise.all(missingTaskIds.map(async (runtimeTaskId) => {
    const readback = await readThread({
      ...payload,
      host_id: normalized.host_id,
      project_id: normalized.project_id,
      campaign_id: normalized.campaign_id,
      runtime_task_id: runtimeTaskId,
      thread_id: runtimeTaskId,
    });
    const single = normalizeCodexTaskList(readback, {
      ...payload,
      host_id: normalized.host_id,
      project_id: normalized.project_id,
      campaign_id: normalized.campaign_id,
      runtime_task_ids: [runtimeTaskId],
    });
    assert(single.threads.length === 1 && single.threads[0].runtime_task_id === runtimeTaskId, `Codex read_thread returned the wrong task for ${runtimeTaskId}`);
    return single.threads[0];
  }));
  const threads = [...normalized.threads, ...additions].sort((left, right) => left.runtime_task_id.localeCompare(right.runtime_task_id));
  assert(new Set(threads.map((entry) => entry.runtime_task_id)).size === expectedTaskIds.length, "Codex task readback does not cover the requested task registry");
  return {...normalized, threads};
}
