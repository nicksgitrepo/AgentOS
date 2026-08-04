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

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RUNTIME_SCHEMA = "agentos.controller_supervisor_runtime.v1";
const LEASE_SCHEMA = "agentos.controller_supervisor_lease.v1";

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

function canonicalRoot(root) {
  requireString(root, "supervisor runtime root");
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "supervisor runtime root must be a real directory");
  return resolved;
}

function safeChild(root, relativePath) {
  const resolvedRoot = canonicalRoot(root);
  requireString(relativePath, "supervisor runtime relative path");
  assert(!path.isAbsolute(relativePath), "supervisor runtime path must be relative");
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), "supervisor runtime path escapes the runtime root");
  return target;
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `supervisor runtime record is not a regular file: ${target}`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
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
    error,
    observed_at_utc: nowUtc,
    runtime_sha256: null,
  };
  state.runtime_sha256 = digestWithout(state, "runtime_sha256");
  return state;
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
  if (existingTick !== null && existingTick.observation_sha256 === observation.observation_sha256) {
    validateSupervisorTick(existingTick);
    const existingGoal = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/goal.json"});
    validateSupervisorGoal(existingGoal);
    writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "IDLE_SAME_OBSERVATION", observation, goal: existingGoal, tick: existingTick, nowUtc}));
    return {observation, goal: existingGoal, tick: existingTick, reused: true};
  }
  const route = typeof adapter.route === "function" ? (goal) => adapter.route(goal) : null;
  const result = await runSupervisorIterationAsync({observation, route});
  writeOrVerify({runtimeRoot: root, recordPath: "supervisor/goal.json", record: result.goal, digestField: "goal_sha256", validate: validateSupervisorGoal});
  writeOrVerify({runtimeRoot: root, recordPath: "supervisor/tick.json", record: result.tick, digestField: "tick_sha256", validate: validateSupervisorTick});
  const status = result.tick.route_status === "STOPPED_HARD_BOUNDARY"
    ? "HARD_BOUNDARY_STOPPED"
    : result.tick.route_status === "ROUTE_FAILED" ? "ROUTE_FAILED_RETAINED" : "ROUTED_OR_RECONCILED";
  writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status, observation, goal: result.goal, tick: result.tick, error: result.tick.route_error, nowUtc}));
  return {...result, observation, reused: false};
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runControllerSupervisor({runtimeRoot, adapter, runtimeId = "AGENTOS-CONTROLLER-SUPERVISOR", intervalMs = 30_000, once = false, signal = null}) {
  assert(Number.isInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 60_000, "supervisor interval must be between 250ms and 60s");
  const root = canonicalRoot(runtimeRoot);
  const leaseState = acquireLease({runtimeRoot: root, runtimeId});
  let stopping = false;
  const stop = () => { stopping = true; };
  if (signal) signal.addEventListener("abort", stop, {once: true});
  const results = [];
  try {
    do {
      const nowUtc = new Date().toISOString();
      try {
        results.push(await runControllerSupervisorIteration({runtimeRoot: root, adapter, runtimeId, nowUtc}));
      } catch (error) {
        const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", error: error?.message ?? String(error), nowUtc});
        writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
        if (once) throw error;
      }
      if (once || stopping) break;
      await sleep(intervalMs);
    } while (!stopping);
  } finally {
    releaseLease(leaseState);
    if (signal) signal.removeEventListener("abort", stop);
  }
  return results;
}

function parseArgs(argv) {
  const result = {once: false, intervalMs: 30_000};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--once") result.once = true;
    else if (value === "--watch") result.once = false;
    else if (value === "--runtime-root") result.runtimeRoot = argv[++index];
    else if (value === "--repo-root") result.repoRoot = argv[++index];
    else if (value === "--adapter") result.adapterPath = argv[++index];
    else if (value === "--runtime-id") result.runtimeId = argv[++index];
    else if (value === "--interval-ms") result.intervalMs = Number(argv[++index]);
    else throw new Error(`unknown supervisor runtime argument: ${value}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireString(args.runtimeRoot, "--runtime-root");
  requireString(args.adapterPath, "--adapter");
  const adapterModule = await import(pathToFileURL(path.resolve(args.adapterPath)).href);
  const adapter = typeof adapterModule.createControllerSupervisorAdapter === "function"
    ? await adapterModule.createControllerSupervisorAdapter({runtimeRoot: args.runtimeRoot, repoRoot: args.repoRoot ?? args.runtimeRoot})
    : adapterModule.default;
  assert(adapter && typeof adapter.observe === "function", "supervisor adapter module does not export an adapter");
  const results = await runControllerSupervisor({runtimeRoot: args.runtimeRoot, adapter, runtimeId: args.runtimeId, intervalMs: args.intervalMs, once: args.once});
  if (args.once) process.stdout.write(`${JSON.stringify(results.at(-1) ?? null)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

export {acquireLease, compileLease, compileRuntimeState, releaseLease};
