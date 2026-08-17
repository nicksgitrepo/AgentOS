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
  compileSupervisorObservation,
  readSupervisorRecord,
  runSupervisorIterationAsync,
  supervisorDigest,
  validateSupervisorGoal,
  validateSupervisorObservation,
  validateSupervisorTick,
  writeSupervisorRecordCompareAndSwap,
} from "./controller-supervisor.mjs";
import {canonicalDigest} from "./content-addressing.mjs";
import {compileAgentSpawnerDefectIntake, validateAgentSpawnerDefectIntake} from "./agent-spawner-defect-intake.mjs";
import {redactPersistedText} from "./persisted-record-privacy.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RUNTIME_SCHEMA = "agentos.controller_supervisor_runtime.v1";
const LEASE_SCHEMA = "agentos.controller_supervisor_lease.v1";
export const DEFAULT_SUPERVISOR_INTERVAL_MINUTES = 15;
export const DEFAULT_MAX_SAME_TURN_TRANSITIONS = 16;
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (tick.action === "WAIT_FOR_AUTHORIZED_WORK" && isExplicitAuthorizedEventWait(tick)) return "ACTIVE_EVENT_WAIT";
  return "ROUTED_OR_RECONCILED";
}

function isExplicitAuthorizedEventWait(tick) {
  const readback = tick?.route_readback;
  return tick?.route_status === "ROUTED"
    && isRecord(readback)
    && readback.status === "WAITING_FOR_AUTHORIZED_WORK"
    && typeof readback.resume_event_id === "string"
    && /^[A-Z][A-Z0-9._:-]*$/u.test(readback.resume_event_id)
    && typeof readback.resume_condition === "string"
    && readback.resume_condition.trim().length >= 8;
}

/**
 * A successful local route is not a reason to sleep until the next cadence.
 * Continue in the same turn unless the route is a true boundary, an explicit
 * event wait, a failure, or the bounded recovery already ran.  The bound is a
 * safety valve against a malformed adapter producing an endless local chain;
 * it is not a timer-based definition of progress.
 */
export function shouldContinueSupervisorSameTurn(result) {
  if (!isRecord(result) || result.reused === true || result.boundedRecovery === true) return false;
  const tick = result.tick;
  if (!isRecord(tick) || tick.route_status !== "ROUTED") return false;
  if (tick.action === "WAIT_FOR_AUTHORIZED_WORK") return false;
  if (isExplicitAuthorizedEventWait(tick)) return false;
  return true;
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

function compileNoProgressRca({runtimeId, priorGoal, priorTick, currentObservation, observedAtUtc}) {
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
    error_message_exact: "NO_SEMANTIC_PROGRESS_AFTER_ROUTED_SUCCESS",
    current_observation_sha256: currentObservation.observation_sha256,
    required_action: "Treat unchanged post-route state as a liveness defect; perform one bounded recovery and re-observe before any wait.",
    external_actions_attempted: false,
    observed_at_utc: observedAtUtc,
    rca_sha256: null,
  };
  rca.rca_sha256 = digestWithout(rca, "rca_sha256");
  return rca;
}

function compileSpawnerDefectIntake({observation, rca, defectId, defectKind = "NON_PASSING_CHECK"}) {
  const sourceBinding = {
    candidate_sha256: canonicalDigest({project_id: observation.project_id, campaign_id: observation.campaign_id, campaign_version: observation.campaign_version, source_commit: observation.source_commit, source_tree: observation.source_tree}),
    context_sha256: canonicalDigest({project_id: observation.project_id, campaign_id: observation.campaign_id, campaign_version: observation.campaign_version, parent_handoff_sha256: observation.parent_handoff_sha256}),
    roster_projection_sha256: canonicalDigest({findings: observation.findings, next_action: observation.next_action}),
    source_identity_sha256: canonicalDigest({source_commit: observation.source_commit, source_tree: observation.source_tree}),
  };
  const evidenceRefs = [
    {evidence_id: "EVIDENCE.CONTROLLER.SUPERVISOR.OBSERVATION", kind: "SUPERVISOR_OBSERVATION", reference: `opaque:supervisor-observation:${observation.observation_sha256}`, sha256: observation.observation_sha256},
    {evidence_id: "EVIDENCE.CONTROLLER.SUPERVISOR.RCA", kind: "SUPERVISOR_RCA", reference: `opaque:supervisor-rca:${rca.rca_sha256}`, sha256: rca.rca_sha256},
  ];
  return compileAgentSpawnerDefectIntake({
    defectId,
    defectKind,
    sourceBinding,
    evidenceRefs,
    observation: {
      summary: "The Controller supervisor observed a routed workflow result that did not advance semantic state.",
      expected: "A routed action changes the control-plane state or records an exact authorized resume event.",
      observed: rca.error_message_exact,
      observed_at_utc: rca.observed_at_utc,
      details_sha256: rca.rca_sha256,
    },
    classification: "REPAIRABLE_GATE_GAP",
    rootCause: {
      category: "MISSING_SEMANTIC_CONTINUATION",
      statement: "A routed Controller action returned without a durable semantic successor or exact authorized resume event.",
      evidence_class: "OBSERVED",
    },
    blockId: "BLOCK.CONTROLLER.SUPERVISOR.LIVENESS",
    gateId: "GATE.CONTROLLER.SUPERVISOR.NEXT_ACTION",
    graphId: "GRAPH.CONTROLLER.SUPERVISOR",
    question: "Did the routed Controller action produce semantic progress or an exact authorized resume event?",
    requiredEvidence: ["evidence.controller_observation", "evidence.route_readback", "evidence.semantic_successor", "evidence.independent_recheck"],
    hostileFixtureRefs: ["FIXTURE.CONTROLLER.SUPERVISOR.NO_PROGRESS", "FIXTURE.CONTROLLER.SUPERVISOR.UNBOUND_EVENT_WAIT", "FIXTURE.CONTROLLER.SUPERVISOR.STALE_ROUTE"],
    authorityScope: ["COMPILE_REUSABLE_GATE", "REFRESH_TYPED_BINDINGS", "INVALIDATE_DEPENDENT_ROSTER", "REPAIR_CONTROLLER_ROUTE"],
    stopConditions: ["INCOMPLETE_BLOCK", "MISSING_ROUTE_READBACK", "PROTECTED_BOUNDARY", "INDEPENDENT_EVALUATION_NOT_CLEARED"],
    bindingsToRefresh: ["BLOCK_DIGEST", "GATE_DIGEST", "ROSTER_PROJECTION_DIGEST", "DEPENDENT_SEED_DIGEST", "CONTROLLER_RUNTIME_DIGEST"],
    deterministicRule: "Pass only when semantic_after differs from semantic_before or the route readback contains WAITING_FOR_AUTHORIZED_WORK with a stable resume_event_id and nonempty resume_condition; otherwise route a bounded repair and re-observe.",
  });
}

function persistSpawnerDefect({runtimeRoot, intake}) {
  return writeOrVerify({
    runtimeRoot,
    recordPath: `supervisor/spawner-defects/${intake.defect_id}.json`,
    record: intake,
    digestField: "defect_sha256",
    validate: validateAgentSpawnerDefectIntake,
  });
}

function compileLivenessRecoveryObservation({observation, spawnerDefect, nowUtc}) {
  const finding = {
    finding_id: `FINDING.CONTROLLER.SUPERVISOR.NO_PROGRESS.${spawnerDefect.defect_sha256.slice(0, 16).toUpperCase()}`,
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "A bounded liveness recovery is required because the prior routed action produced no semantic successor.",
    source_sha256: spawnerDefect.defect_sha256,
  };
  return compileSupervisorObservation({
    controllerDisplayName: observation.controller_display_name,
    projectId: observation.project_id,
    campaignId: observation.campaign_id,
    campaignVersion: observation.campaign_version,
    activeCampaign: observation.active_campaign,
    ownerDecisionRequired: observation.owner_decision_required,
    boundary: structuredClone(observation.boundary),
    findings: [...observation.findings, finding].sort((left, right) => Buffer.compare(Buffer.from(left.finding_id, "utf8"), Buffer.from(right.finding_id, "utf8"))),
    nextAction: "Run one bounded liveness repair and return a semantic successor readback.",
    sourceCommit: observation.source_commit,
    sourceTree: observation.source_tree,
    parentHandoffSha256: observation.parent_handoff_sha256,
    observedAtUtc: nowUtc,
  });
}

function compileRouteFailureRecoveryObservation({observation, spawnerDefect, nowUtc}) {
  const finding = {
    finding_id: `FINDING.CONTROLLER.SUPERVISOR.ROUTE_FAILURE.${spawnerDefect.defect_sha256.slice(0, 16).toUpperCase()}`,
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "A bounded same-turn route retry is required after the prior Controller action failed.",
    source_sha256: spawnerDefect.defect_sha256,
  };
  return compileSupervisorObservation({
    controllerDisplayName: observation.controller_display_name,
    projectId: observation.project_id,
    campaignId: observation.campaign_id,
    campaignVersion: observation.campaign_version,
    activeCampaign: observation.active_campaign,
    ownerDecisionRequired: observation.owner_decision_required,
    boundary: structuredClone(observation.boundary),
    findings: [...observation.findings, finding].sort((left, right) => Buffer.compare(Buffer.from(left.finding_id, "utf8"), Buffer.from(right.finding_id, "utf8"))),
    nextAction: "Retry the failed Controller route once, then return a typed successor or retained route failure.",
    sourceCommit: observation.source_commit,
    sourceTree: observation.source_tree,
    parentHandoffSha256: observation.parent_handoff_sha256,
    observedAtUtc: nowUtc,
  });
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
  const route = typeof adapter.route === "function" ? (goal) => adapter.route(goal) : null;
  const existingTick = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/tick.json"});
  let priorSpawnerDefect = null;
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
    priorSpawnerDefect = compileSpawnerDefectIntake({
      observation,
      rca,
      defectId: `DEFECT.SUPERVISOR.ROUTE_FAILURE.${priorGoal.goal_id}.${observation.observation_sha256.slice(0, 16).toUpperCase()}`,
    });
    persistSpawnerDefect({runtimeRoot: root, intake: priorSpawnerDefect});
  }
  if (existingTick !== null && existingTick.observation_sha256 === observation.observation_sha256) {
    validateSupervisorTick(existingTick);
    const existingGoal = readSupervisorRecord({authorityRoot: root, recordPath: "supervisor/goal.json"});
    validateSupervisorGoal(existingGoal);
    if (existingTick.route_status === "STOPPED_HARD_BOUNDARY") {
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ACTIVE_PROTECTED_WAIT", observation, goal: existingGoal, tick: existingTick, nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, reused: true};
    }
    if (existingTick.route_status === "ROUTE_FAILED") {
      if (route !== null) {
        const rcaPath = `supervisor/route-failures/${existingGoal.goal_id}.json`;
        const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: rcaPath});
        const rca = compileRouteFailureRca({
          runtimeId,
          priorGoal: existingGoal,
          priorTick: existingTick,
          currentObservation: observation,
          observedAtUtc: existingRca?.observed_at_utc ?? nowUtc,
        });
        if (existingRca === null) writeSupervisorRecordCompareAndSwap({authorityRoot: root, recordPath: rcaPath, expectedDigest: null, record: rca, digestField: "rca_sha256"});
        else assert(existingRca.rca_sha256 === rca.rca_sha256, "supervisor route failure RCA differs");
        const spawnerDefect = compileSpawnerDefectIntake({
          observation,
          rca,
          defectId: `DEFECT.SUPERVISOR.ROUTE_FAILURE.${existingGoal.goal_id}`,
        });
        persistSpawnerDefect({runtimeRoot: root, intake: spawnerDefect});
        const recoveryObservation = compileRouteFailureRecoveryObservation({observation, spawnerDefect, nowUtc});
        const recoveryResult = await runSupervisorIterationAsync({observation: recoveryObservation, route});
        const recoveryGoalPath = `supervisor/goals/${recoveryObservation.observation_sha256}.json`;
        const recoveryTickPath = `supervisor/ticks/${recoveryObservation.observation_sha256}.json`;
        writeOrVerify({runtimeRoot: root, recordPath: recoveryGoalPath, record: recoveryResult.goal, digestField: "goal_sha256", validate: validateSupervisorGoal});
        writeOrVerify({runtimeRoot: root, recordPath: recoveryTickPath, record: recoveryResult.tick, digestField: "tick_sha256", validate: validateSupervisorTick});
        writeJsonAtomic(safeChild(root, "supervisor/goal.json"), recoveryResult.goal);
        writeJsonAtomic(safeChild(root, "supervisor/tick.json"), recoveryResult.tick);
        writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({
          runtimeId,
          status: runtimeStatusForTick(recoveryResult.tick),
          observation: recoveryObservation,
          goal: recoveryResult.goal,
          tick: recoveryResult.tick,
          error: recoveryResult.tick.route_error,
          nowUtc,
        }));
        return {
          ...recoveryResult,
          observation: recoveryObservation,
          reused: false,
          priorSpawnerDefect: null,
          routeFailureRca: rca,
          spawnerDefect,
          boundedRecovery: true,
          recovery_started_same_turn: true,
        };
      }
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ROUTE_FAILED_RETAINED", observation, goal: existingGoal, tick: existingTick, nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, reused: true};
    }
    if (isExplicitAuthorizedEventWait(existingTick)) {
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ACTIVE_EVENT_WAIT", observation, goal: existingGoal, tick: existingTick, nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, reused: true};
    }
    const rcaPath = `supervisor/no-progress/${existingGoal.goal_id}.json`;
    const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: rcaPath});
    const rca = compileNoProgressRca({
      runtimeId,
      priorGoal: existingGoal,
      priorTick: existingTick,
      currentObservation: observation,
      observedAtUtc: existingRca?.observed_at_utc ?? nowUtc,
    });
    if (existingRca === null) writeSupervisorRecordCompareAndSwap({authorityRoot: root, recordPath: rcaPath, expectedDigest: null, record: rca, digestField: "rca_sha256"});
    else assert(existingRca.rca_sha256 === rca.rca_sha256, "supervisor no-progress RCA differs");
    const spawnerDefect = compileSpawnerDefectIntake({
      observation,
      rca,
      defectId: `DEFECT.SUPERVISOR.NO_PROGRESS.${existingGoal.goal_id}`,
    });
    persistSpawnerDefect({runtimeRoot: root, intake: spawnerDefect});
    // Do not leave a liveness defect parked until the next cadence tick. The
    // supervisor immediately starts one bounded repair route, then records its
    // distinct goal/tick so a later turn can verify the resulting state.
    if (route !== null) {
      const recoveryObservation = compileLivenessRecoveryObservation({observation, spawnerDefect, nowUtc});
      const recoveryResult = await runSupervisorIterationAsync({observation: recoveryObservation, route});
      const recoveryGoalPath = `supervisor/goals/${recoveryObservation.observation_sha256}.json`;
      const recoveryTickPath = `supervisor/ticks/${recoveryObservation.observation_sha256}.json`;
      writeOrVerify({runtimeRoot: root, recordPath: recoveryGoalPath, record: recoveryResult.goal, digestField: "goal_sha256", validate: validateSupervisorGoal});
      writeOrVerify({runtimeRoot: root, recordPath: recoveryTickPath, record: recoveryResult.tick, digestField: "tick_sha256", validate: validateSupervisorTick});
      writeJsonAtomic(safeChild(root, "supervisor/goal.json"), recoveryResult.goal);
      writeJsonAtomic(safeChild(root, "supervisor/tick.json"), recoveryResult.tick);
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({
        runtimeId,
        status: runtimeStatusForTick(recoveryResult.tick),
        observation: recoveryObservation,
        goal: recoveryResult.goal,
        tick: recoveryResult.tick,
        error: recoveryResult.tick.route_error,
        nowUtc,
      }));
      return {
        ...recoveryResult,
        observation: recoveryObservation,
        reused: false,
        priorSpawnerDefect: null,
        noProgressRca: rca,
        spawnerDefect,
        boundedRecovery: true,
        recovery_started_same_turn: true,
      };
    }
    writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ROUTE_FAILED_RETAINED", observation, goal: existingGoal, tick: existingTick, error: "NO_SEMANTIC_PROGRESS_AFTER_ROUTED_SUCCESS", nowUtc}));
    return {observation, goal: existingGoal, tick: existingTick, reused: true, noProgressRca: rca, spawnerDefect};
  }
  const result = await runSupervisorIterationAsync({observation, route});
  const goalRecordPath = `supervisor/goals/${observation.observation_sha256}.json`;
  const tickRecordPath = `supervisor/ticks/${observation.observation_sha256}.json`;
  writeOrVerify({runtimeRoot: root, recordPath: goalRecordPath, record: result.goal, digestField: "goal_sha256", validate: validateSupervisorGoal});
  writeOrVerify({runtimeRoot: root, recordPath: tickRecordPath, record: result.tick, digestField: "tick_sha256", validate: validateSupervisorTick});
  writeJsonAtomic(safeChild(root, "supervisor/goal.json"), result.goal);
  writeJsonAtomic(safeChild(root, "supervisor/tick.json"), result.tick);
  const status = runtimeStatusForTick(result.tick);
  writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status, observation, goal: result.goal, tick: result.tick, error: result.tick.route_error, nowUtc}));
  return {...result, observation, reused: false, priorSpawnerDefect};
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

export async function runControllerSupervisor({runtimeRoot, adapter, adapterFactory = null, runtimeId = "AGENTOS-CONTROLLER-SUPERVISOR", intervalMinutes = DEFAULT_SUPERVISOR_INTERVAL_MINUTES, intervalMs = null, maxSameTurnTransitions = DEFAULT_MAX_SAME_TURN_TRANSITIONS, once = false, signal = null}) {
  assert(Number.isSafeInteger(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= MAX_SUPERVISOR_INTERVAL_MINUTES, "supervisor interval minutes must be between 1 and 1440");
  const resolvedIntervalMs = intervalMs === null ? intervalMinutes * 60_000 : intervalMs;
  assert(Number.isSafeInteger(resolvedIntervalMs) && resolvedIntervalMs >= 250 && resolvedIntervalMs <= MAX_SUPERVISOR_INTERVAL_MINUTES * 60_000, "supervisor interval is outside the safe range");
  assert(Number.isSafeInteger(maxSameTurnTransitions) && maxSameTurnTransitions >= 1 && maxSameTurnTransitions <= 256, "supervisor same-turn transition bound is invalid");
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
      let sameTurnTransitions = 0;
      do {
        const nowUtc = new Date().toISOString();
        try {
          const activeAdapter = adapterFactory === null ? adapter : await adapterFactory();
          const result = await runControllerSupervisorIteration({runtimeRoot: root, adapter: activeAdapter, runtimeId, nowUtc});
          results.push(result);
          if (!shouldContinueSupervisorSameTurn(result)) break;
          sameTurnTransitions += 1;
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
          break;
        }
      } while (!once && !stopping && signal?.aborted !== true && sameTurnTransitions < maxSameTurnTransitions);
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
