#!/usr/bin/env node

/*
 * Runtime for the project-persistent Controller supervisor.
 *
 * A project supplies the adapter that observes its control-plane records and
 * performs already-authorized local routing.  The runtime owns the lease,
 * cadence, heartbeat, idempotent goal/tick records, and fail-closed behavior.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, spawn} from "node:child_process";
import {pathToFileURL} from "node:url";
import {
  canonicalSupervisorJson,
  readSupervisorRecord,
  runSupervisorIterationAsync,
  supervisorDigest,
  validateSupervisorGoal,
  validateSupervisorObservation,
  validateSupervisorTick,
  writeSupervisorRecordCompareAndSwap,
} from "./controller-supervisor.mjs";
import {redactPersistedText} from "./persisted-record-privacy.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RUNTIME_SCHEMA = "agentos.controller_supervisor_runtime.v1";
const LEASE_SCHEMA = "agentos.controller_supervisor_lease.v1";
export const DEFAULT_SUPERVISOR_INTERVAL_MINUTES = 15;
const MAX_SUPERVISOR_INTERVAL_MINUTES = 24 * 60;
export const CONTROLLER_RUNTIME_STATUSES = Object.freeze([
  "ACTIVE_EVENT_WAIT",
  "ACTIVE_PROTECTED_WAIT",
  "ROUTED_OR_RECONCILED",
  "ROUTE_FAILED_RETAINED",
  "ITERATION_FAILED_RETAINED",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireRuntimeStatus(value) {
  requireString(value, "supervisor runtime status");
  assert(CONTROLLER_RUNTIME_STATUSES.includes(value), "supervisor runtime status is invalid");
}

function safeSupervisorText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  try {
    return redactPersistedText(String(value)).text.replace(/\s+/gu, " ").trim().slice(0, 2000);
  } catch {
    return `opaque:error:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
  }
}

function canonicalRoot(root) {
  requireString(root, "supervisor runtime root");
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "supervisor runtime root must be a real directory");
  return resolved;
}

function assertNoSymlinkAncestors(root, target, label) {
  let current = target;
  while (true) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `${label} contains a symbolic-link component`);
    if (current === root) return;
    const parent = path.dirname(current);
    assert(parent !== current && (parent === root || parent.startsWith(`${root}${path.sep}`)), `${label} escapes the bound root`);
    current = parent;
  }
}

function safeChild(root, relativePath) {
  const resolvedRoot = canonicalRoot(root);
  requireString(relativePath, "supervisor runtime relative path");
  assert(!path.isAbsolute(relativePath), "supervisor runtime path must be relative");
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), "supervisor runtime path escapes the runtime root");
  assertNoSymlinkAncestors(resolvedRoot, target, "supervisor runtime path");
  return target;
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `supervisor runtime record is not a regular file: ${target}`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function adapterSourceIdentity({adapterPath, repoRoot}) {
  let repositoryHead = "NO_REPOSITORY";
  if (repoRoot) {
    try {
      repositoryHead = execFileSync("git", ["-C", path.resolve(repoRoot), "rev-parse", "HEAD"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    } catch {
      repositoryHead = "UNAVAILABLE_REPOSITORY";
    }
  }
  const sourceRoot = path.dirname(adapterPath);
  const sourceFiles = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(target);
      else if (entry.isFile() && target.endsWith(".mjs")) sourceFiles.push(target);
    }
  };
  collect(sourceRoot);
  const content = sourceFiles.sort().map((target) => `${path.relative(sourceRoot, target)}\u0000${fs.readFileSync(target)}`).join("\u0001");
  const sourceDigest = crypto.createHash("sha256").update(content).digest("hex");
  return `${repositoryHead}:${sourceDigest}`;
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assert(!fs.lstatSync(path.dirname(target)).isSymbolicLink(), "supervisor runtime record parent may not be a symlink");
  assert(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink(), `supervisor runtime target is a symlink: ${target}`);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${canonicalSupervisorJson(value)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return supervisorDigest(body);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function compileLease({runtimeId, ownerPid, acquiredAtUtc}) {
  const lease = {
    schema: LEASE_SCHEMA,
    version: 1,
    runtime_id: runtimeId,
    owner_pid: ownerPid,
    acquired_at_utc: acquiredAtUtc,
    lease_sha256: null,
  };
  lease.lease_sha256 = digestWithout(lease, "lease_sha256");
  return lease;
}

function acquireLease({runtimeRoot, runtimeId = "AGENTOS-CONTROLLER-SUPERVISOR", nowUtc = new Date().toISOString()}) {
  requireIdentifier(runtimeId, "supervisor runtime ID");
  requireUtc(nowUtc, "supervisor lease time");
  const target = safeChild(runtimeRoot, "supervisor/lease.json");
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assert(!fs.lstatSync(path.dirname(target)).isSymbolicLink(), "supervisor lease parent may not be a symlink");
  const existing = readJson(target);
  if (existing !== null && pidAlive(existing.owner_pid)) throw new Error(`controller supervisor lease is held by PID ${existing.owner_pid}`);
  if (existing !== null) {
    assert(existing.schema === LEASE_SCHEMA && SHA256.test(existing.lease_sha256), "stale supervisor lease is malformed");
    fs.unlinkSync(target);
  }
  const lease = compileLease({runtimeId, ownerPid: process.pid, acquiredAtUtc: nowUtc});
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${canonicalSupervisorJson(lease)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  const readback = readJson(target);
  assert(readback?.lease_sha256 === lease.lease_sha256 && readback.owner_pid === process.pid, "supervisor lease readback differs");
  return {target, lease};
}

function releaseLease({target, lease}) {
  const current = readJson(target);
  if (current?.lease_sha256 !== lease.lease_sha256 || current?.owner_pid !== process.pid) return;
  fs.unlinkSync(target);
}

function compileRuntimeState({runtimeId, status, observation = null, goal = null, tick = null, error = null, nowUtc}) {
  requireRuntimeStatus(status);
  const state = {
    schema: RUNTIME_SCHEMA,
    version: 1,
    runtime_id: runtimeId,
    supervisor_pid: process.pid,
    status,
    observation_sha256: observation?.observation_sha256 ?? null,
    goal_id: goal?.goal_id ?? null,
    goal_sha256: goal?.goal_sha256 ?? null,
    tick_sha256: tick?.tick_sha256 ?? null,
    error: safeSupervisorText(error),
    observed_at_utc: nowUtc,
    runtime_sha256: null,
  };
  state.runtime_sha256 = digestWithout(state, "runtime_sha256");
  return state;
}

function runtimeStatusForTick(tick) {
  if (tick.route_status === "STOPPED_HARD_BOUNDARY") return "ACTIVE_PROTECTED_WAIT";
  if (tick.route_status === "ROUTE_FAILED") return "ROUTE_FAILED_RETAINED";
  if (tick.action === "WAIT_FOR_AUTHORIZED_WORK") return "ACTIVE_EVENT_WAIT";
  return "ROUTED_OR_RECONCILED";
}

function compileRouteFailureRca({runtimeId, priorGoal, priorTick, currentObservation, observedAtUtc}) {
  const rca = {
    schema: "agentos.controller_supervisor_route_failure_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    controller_role: "AGENTOS_CONTROLLER",
    runtime_id: runtimeId,
    prior_goal_id: priorGoal.goal_id,
    prior_goal_sha256: priorGoal.goal_sha256,
    prior_observation_sha256: priorTick.observation_sha256,
    failed_route_status: priorTick.route_status,
    error_message_exact: safeSupervisorText(priorTick.route_error, "UNAVAILABLE"),
    current_observation_sha256: currentObservation.observation_sha256,
    required_action: "Retain the exact failed route, change the source-bound route or repair the stale boundary rule, then re-observe before retrying.",
    external_actions_attempted: false,
    observed_at_utc: observedAtUtc,
    rca_sha256: null,
  };
  rca.rca_sha256 = digestWithout(rca, "rca_sha256");
  return rca;
}

function writeOrVerify({runtimeRoot, recordPath, record, digestField, validate}) {
  const existing = readSupervisorRecord({authorityRoot: runtimeRoot, recordPath});
  if (existing !== null) {
    validate(existing);
    assert(existing[digestField] === record[digestField], `supervisor record differs for ${recordPath}`);
    return {record: existing, reused: true};
  }
  const written = writeSupervisorRecordCompareAndSwap({authorityRoot: runtimeRoot, recordPath, expectedDigest: null, record, digestField});
  validate(written);
  return {record: written, reused: false};
}

export async function runControllerSupervisorIteration({runtimeRoot, adapter, runtimeId = "AGENTOS-CONTROLLER-SUPERVISOR", nowUtc = new Date().toISOString()}) {
  requireString(runtimeRoot, "supervisor runtime root");
  assert(adapter && typeof adapter.observe === "function", "supervisor adapter must provide observe()");
  const root = canonicalRoot(runtimeRoot);
  const observation = await adapter.observe();
  validateSupervisorObservation(observation);
  const existingTick = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/tick.json"});
  if (existingTick !== null && existingTick.route_status === "ROUTE_FAILED" && existingTick.observation_sha256 !== observation.observation_sha256) {
    const priorGoal = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/goal.json"});
    validateSupervisorTick(existingTick);
    validateSupervisorGoal(priorGoal);
    const baseRcaPath = `supervisor/route-failures/${priorGoal.goal_id}.json`;
    const existingBaseRca = readSupervisorRecord({authorityRoot: root, recordPath: baseRcaPath});
    const rcaPath = existingBaseRca === null || existingBaseRca.current_observation_sha256 === observation.observation_sha256
      ? baseRcaPath
      : `supervisor/route-failures/${priorGoal.goal_id}-${observation.observation_sha256}.json`;
    const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: rcaPath});
    const rca = compileRouteFailureRca({
      runtimeId,
      priorGoal,
      priorTick: existingTick,
      currentObservation: observation,
      observedAtUtc: existingRca?.observed_at_utc ?? nowUtc,
    });
    if (existingRca === null) writeSupervisorRecordCompareAndSwap({authorityRoot: root, recordPath: rcaPath, expectedDigest: null, record: rca, digestField: "rca_sha256"});
    else assert(existingRca.rca_sha256 === rca.rca_sha256, "supervisor route failure RCA differs");
  }
  if (existingTick !== null && existingTick.observation_sha256 === observation.observation_sha256) {
    validateSupervisorTick(existingTick);
    const existingGoal = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/goal.json"});
    validateSupervisorGoal(existingGoal);
    const status = existingTick.route_status === "STOPPED_HARD_BOUNDARY"
      ? "ACTIVE_PROTECTED_WAIT"
      : existingTick.route_status === "ROUTE_FAILED" ? "ROUTE_FAILED_RETAINED" : "ACTIVE_EVENT_WAIT";
    writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status, observation, goal: existingGoal, tick: existingTick, nowUtc}));
    return {observation, goal: existingGoal, tick: existingTick, reused: true};
  }
  const route = typeof adapter.route === "function" ? (goal) => adapter.route(goal) : null;
  const result = await runSupervisorIterationAsync({observation, route});
  const goalRecordPath = `supervisor/goals/${observation.observation_sha256}.json`;
  const tickRecordPath = `supervisor/ticks/${observation.observation_sha256}.json`;
  writeOrVerify({runtimeRoot: root, recordPath: goalRecordPath, record: result.goal, digestField: "goal_sha256", validate: validateSupervisorGoal});
  writeOrVerify({runtimeRoot: root, recordPath: tickRecordPath, record: result.tick, digestField: "tick_sha256", validate: validateSupervisorTick});
  writeJsonAtomic(safeChild(root, "supervisor/goal.json"), result.goal);
  writeJsonAtomic(safeChild(root, "supervisor/tick.json"), result.tick);
  const status = runtimeStatusForTick(result.tick);
  writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status, observation, goal: result.goal, tick: result.tick, error: result.tick.route_error, nowUtc}));
  return {...result, observation, reused: false};
}

function sleep(milliseconds, signal = null) {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    if (signal) signal.addEventListener("abort", finish, {once: true});
  });
}

export async function runControllerSupervisor({runtimeRoot, adapter, adapterFactory = null, runtimeId = "AGENTOS-CONTROLLER-SUPERVISOR", intervalMinutes = DEFAULT_SUPERVISOR_INTERVAL_MINUTES, intervalMs = null, once = false, signal = null}) {
  assert(Number.isSafeInteger(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= MAX_SUPERVISOR_INTERVAL_MINUTES, "supervisor interval minutes must be between 1 and 1440");
  const resolvedIntervalMs = intervalMs === null ? intervalMinutes * 60_000 : intervalMs;
  assert(Number.isSafeInteger(resolvedIntervalMs) && resolvedIntervalMs >= 250 && resolvedIntervalMs <= MAX_SUPERVISOR_INTERVAL_MINUTES * 60_000, "supervisor interval is outside the safe range");
  assert(adapter && typeof adapter.observe === "function", "supervisor adapter must provide observe()");
  assert(adapterFactory === null || typeof adapterFactory === "function", "supervisor adapter factory must be callable");
  const root = canonicalRoot(runtimeRoot);
  const leaseState = acquireLease({runtimeRoot: root, runtimeId});
  let stopping = false;
  const stop = () => { stopping = true; };
  if (signal) signal.addEventListener("abort", stop, {once: true});
  const results = [];
  try {
    do {
      if (signal?.aborted === true || stopping) break;
      const nowUtc = new Date().toISOString();
      try {
        const activeAdapter = adapterFactory === null ? adapter : await adapterFactory();
        results.push(await runControllerSupervisorIteration({runtimeRoot: root, adapter: activeAdapter, runtimeId, nowUtc}));
      } catch (error) {
        if (error?.code === "AGENTOS_SUPERVISOR_RESTART_REQUIRED") {
          stopping = true;
          break;
        }
        const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", error: error?.message ?? String(error), nowUtc});
        writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
        if (once) {
          const safeError = new Error(safeSupervisorText(error?.message ?? String(error), "supervisor iteration failed"));
          safeError.code = error?.code;
          throw safeError;
        }
      }
      if (once || stopping) break;
      await sleep(resolvedIntervalMs, signal);
    } while (!stopping);
  } finally {
    releaseLease(leaseState);
    if (signal) signal.removeEventListener("abort", stop);
  }
  return results;
}

function parseArgs(argv) {
  const result = {once: false, intervalMinutes: DEFAULT_SUPERVISOR_INTERVAL_MINUTES, intervalMs: null};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--once") result.once = true;
    else if (value === "--watch") result.once = false;
    else if (value === "--runtime-root") result.runtimeRoot = argv[++index];
    else if (value === "--repo-root") result.repoRoot = argv[++index];
    else if (value === "--adapter") result.adapterPath = argv[++index];
    else if (value === "--runtime-id") result.runtimeId = argv[++index];
    else if (value === "--interval-minutes") result.intervalMinutes = Number(argv[++index]);
    else if (value === "--interval-ms") result.intervalMs = Number(argv[++index]);
    else throw new Error(`unknown supervisor runtime argument: ${value}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireString(args.runtimeRoot, "--runtime-root");
  requireString(args.adapterPath, "--adapter");
  const adapterPath = path.resolve(args.adapterPath);
  const repoRoot = args.repoRoot ?? args.runtimeRoot;
  let loadedAdapter = null;
  let loadedIdentity = null;
  let restartRequested = false;
  const loadAdapter = async () => {
    const identity = adapterSourceIdentity({adapterPath, repoRoot});
    if (loadedAdapter !== null && loadedIdentity === identity) return loadedAdapter;
    if (loadedAdapter !== null && loadedIdentity !== identity) {
      restartRequested = true;
      const error = new Error("AgentOS source changed; restarting the Controller so every loaded control-plane module refreshes together.");
      error.code = "AGENTOS_SUPERVISOR_RESTART_REQUIRED";
      throw error;
    }
    const adapterUrl = pathToFileURL(adapterPath);
    adapterUrl.searchParams.set("source", identity);
    const adapterModule = await import(adapterUrl.href);
    loadedAdapter = typeof adapterModule.createControllerSupervisorAdapter === "function"
      ? await adapterModule.createControllerSupervisorAdapter({runtimeRoot: args.runtimeRoot, repoRoot})
      : adapterModule.default;
    assert(loadedAdapter && typeof loadedAdapter.observe === "function", "supervisor adapter module does not export an adapter");
    loadedIdentity = identity;
    return loadedAdapter;
  };
  const adapter = await loadAdapter();
  const results = await runControllerSupervisor({runtimeRoot: args.runtimeRoot, adapter, adapterFactory: loadAdapter, runtimeId: args.runtimeId, intervalMinutes: args.intervalMinutes, intervalMs: args.intervalMs, once: args.once});
  if (restartRequested && !args.once) {
    const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {detached: true, stdio: "ignore"});
    child.unref();
  }
  if (args.once) process.stdout.write(`${JSON.stringify(results.at(-1) ?? null)}\n`);
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

export {acquireLease, compileLease, compileRuntimeState, releaseLease};
