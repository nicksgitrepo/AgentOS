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

function hasTypedSemanticProgress(result) {
  const readback = result?.tick?.route_readback;
  if (!isRecord(readback)) return false;
  if (readback.semantic_progress === true) return true;
  return typeof readback.semantic_before_sha256 === "string"
    && SHA256.test(readback.semantic_before_sha256)
    && typeof readback.semantic_after_sha256 === "string"
    && SHA256.test(readback.semantic_after_sha256)
    && readback.semantic_before_sha256 !== readback.semantic_after_sha256;
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

function compileMissingRouteAdapterRca({runtimeId, goal, observation, observedAtUtc}) {
  const rca = {
    schema: "agentos.controller_supervisor_route_failure_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    controller_role: "AGENTOS_CONTROLLER",
    runtime_id: runtimeId,
    prior_goal_id: goal.goal_id,
    prior_goal_sha256: goal.goal_sha256,
    prior_observation_sha256: observation.observation_sha256,
    failed_route_status: "ROUTE_FAILED",
    error_message_exact: "CONTROLLER_ROUTE_ADAPTER_MISSING",
    current_observation_sha256: observation.observation_sha256,
    required_action: "Bind or repair the project-agnostic local route adapter, reload it, and re-observe in the same turn; cadence is not a recovery mechanism.",
    external_actions_attempted: false,
    observed_at_utc: observedAtUtc,
    rca_sha256: null,
  };
  rca.rca_sha256 = digestWithout(rca, "rca_sha256");
  return rca;
}

function ensureMissingRouteAdapterRca({runtimeId, goal, observation, observedAtUtc, authorityRoot, recordPath, existingRca}) {
  if (existingRca?.error_message_exact === "CONTROLLER_ROUTE_ADAPTER_MISSING") return existingRca;
  const rca = compileMissingRouteAdapterRca({runtimeId, goal, observation, observedAtUtc});
  const expectedDigest = existingRca === null ? null : existingRca?.rca_sha256;
  if (existingRca !== null) requireSha(expectedDigest, "existing supervisor route failure RCA digest");
  writeSupervisorRecordCompareAndSwap({authorityRoot, recordPath, expectedDigest, record: rca, digestField: "rca_sha256"});
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

// An observation/factory failure happens before a valid Controller
// observation exists, but it is still a failed check that the Agent Spawner
// must learn from.  Keep this intake deliberately opaque and project
// agnostic: it binds only the runtime identity, safe error fingerprint, and
// the fact that no observation or route result was produced.  It must never
// invent project facts or make the failure spawnable.
function compileIterationFailureSpawnerDefect({runtimeId, errorCode, errorMessage, errorFingerprint, observedAtUtc}) {
  const sourceBinding = {
    candidate_sha256: canonicalDigest({runtime_id: runtimeId, evidence: "ITERATION_FAILURE"}),
    context_sha256: canonicalDigest({runtime_id: runtimeId, error_code: errorCode, error_fingerprint: errorFingerprint}),
    roster_projection_sha256: canonicalDigest({runtime_id: runtimeId, roster: "UNAVAILABLE_BEFORE_OBSERVATION"}),
    source_identity_sha256: canonicalDigest({runtime_id: runtimeId, source: "SUPERVISOR_RUNTIME"}),
  };
  const evidenceRefs = [
    {
      evidence_id: "EVIDENCE.CONTROLLER.SUPERVISOR.ITERATION_ERROR",
      kind: "SUPERVISOR_ITERATION_ERROR",
      reference: `opaque:supervisor-iteration-error:${errorFingerprint}`,
      sha256: errorFingerprint,
    },
    {
      evidence_id: "EVIDENCE.CONTROLLER.SUPERVISOR.RUNTIME_IDENTITY",
      kind: "SUPERVISOR_RUNTIME_IDENTITY",
      reference: `opaque:supervisor-runtime:${canonicalDigest({runtime_id: runtimeId})}`,
      sha256: canonicalDigest({runtime_id: runtimeId}),
    },
  ];
  return compileAgentSpawnerDefectIntake({
    defectId: `DEFECT.SUPERVISOR.ITERATION_FAILURE.${errorFingerprint.slice(0, 16).toUpperCase()}`,
    defectKind: "NON_PASSING_CHECK",
    sourceBinding,
    evidenceRefs,
    observation: {
      summary: "The Controller supervisor failed before producing a valid observation or route result.",
      expected: "The supervisor produces a valid observation or a typed route result in the same turn.",
      observed: `${errorCode}:${errorMessage}`,
      observed_at_utc: observedAtUtc,
      details_sha256: errorFingerprint,
    },
    classification: "REPAIRABLE_GATE_GAP",
    rootCause: {
      category: "SUPERVISOR_ITERATION_FAILURE",
      statement: "The supervisor failed before producing a valid observation or route result; repair the runtime or adapter and re-observe immediately.",
      evidence_class: "OBSERVED",
    },
    blockId: "BLOCK.CONTROLLER.SUPERVISOR.ITERATION_FAILURE",
    gateId: "GATE.CONTROLLER.SUPERVISOR.ITERATION_RESULT",
    graphId: "GRAPH.CONTROLLER.SUPERVISOR",
    question: "Did the Controller supervisor produce a valid observation or typed route result in this turn?",
    requiredEvidence: ["evidence.supervisor_runtime_identity", "evidence.iteration_error", "evidence.repair_attempt", "evidence.independent_recheck"],
    hostileFixtureRefs: ["FIXTURE.CONTROLLER.SUPERVISOR.ITERATION_FAILURE", "FIXTURE.CONTROLLER.SUPERVISOR.MISSING_OBSERVATION", "FIXTURE.CONTROLLER.SUPERVISOR.REPAIR_REQUIRED"],
    authorityScope: ["COMPILE_REUSABLE_GATE", "REFRESH_TYPED_BINDINGS", "REPAIR_CONTROLLER_RUNTIME", "INVALIDATE_DEPENDENT_ROSTER"],
    stopConditions: ["INCOMPLETE_BLOCK", "MISSING_ITERATION_RESULT", "PROTECTED_BOUNDARY", "INDEPENDENT_EVALUATION_NOT_CLEARED"],
    bindingsToRefresh: ["BLOCK_DIGEST", "GATE_DIGEST", "ROSTER_PROJECTION_DIGEST", "DEPENDENT_SEED_DIGEST", "CONTROLLER_RUNTIME_DIGEST"],
    deterministicRule: "Pass only when the supervisor emits a valid observation or typed route result after the repair attempt; an exception, missing result, or unverified repair remains a reusable failure gate.",
    detailsSha256: errorFingerprint,
    observedAtUtc,
  });
}

function persistIterationFailureSpawnerDefect({runtimeRoot, runtimeId, errorCode, errorMessage, errorFingerprint, observedAtUtc}) {
  const defectId = `DEFECT.SUPERVISOR.ITERATION_FAILURE.${errorFingerprint.slice(0, 16).toUpperCase()}`;
  const recordPath = `supervisor/spawner-defects/${defectId}.json`;
  const existing = readSupervisorRecord({authorityRoot: runtimeRoot, recordPath});
  if (existing !== null) {
    validateAgentSpawnerDefectIntake(existing);
    return existing;
  }
  const intake = compileIterationFailureSpawnerDefect({runtimeId, errorCode, errorMessage, errorFingerprint, observedAtUtc});
  const persisted = persistSpawnerDefect({runtimeRoot, intake});
  return persisted.record;
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
  // `reconcile` is an explicit project-agnostic recovery surface.  It is
  // accepted as a route only when the adapter has not yet exposed its normal
  // route, so a startup/configuration defect can repair itself without a
  // timer-shaped wait.
  const route = typeof adapter.route === "function"
    ? (goal) => adapter.route(goal)
    : typeof adapter.reconcile === "function"
      ? (goal) => adapter.reconcile(goal)
      : null;
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
        // Preserve a previously recorded missing-adapter RCA when the route
        // has just become available. Recompiling it as a generic route error
        // would change its evidence digest and falsely strand the recovery.
        const rca = existingRca?.error_message_exact === "CONTROLLER_ROUTE_ADAPTER_MISSING"
          ? existingRca
          : compileRouteFailureRca({
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
      const existingRcaPath = `supervisor/route-failures/${existingGoal.goal_id}.json`;
      const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: existingRcaPath});
      const missingRouteRca = ensureMissingRouteAdapterRca({runtimeId, goal: existingGoal, observation, observedAtUtc: nowUtc, authorityRoot: root, recordPath: existingRcaPath, existingRca});
      const missingRouteDefect = compileSpawnerDefectIntake({
        observation,
        rca: missingRouteRca,
        defectId: `DEFECT.SUPERVISOR.ROUTE_ADAPTER_MISSING.${existingGoal.goal_id}`,
      });
      persistSpawnerDefect({runtimeRoot: root, intake: missingRouteDefect});
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ROUTE_FAILED_RETAINED", observation, goal: existingGoal, tick: existingTick, error: "CONTROLLER_ROUTE_ADAPTER_MISSING", nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, routeFailureRca: missingRouteRca, spawnerDefect: missingRouteDefect, routeAdapterMissing: true, reused: true};
    }
    if (isExplicitAuthorizedEventWait(existingTick)) {
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ACTIVE_EVENT_WAIT", observation, goal: existingGoal, tick: existingTick, nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, reused: true};
    }
    if (route === null) {
      // A previously routed lane whose adapter disappeared is a route
      // configuration defect, not an ordinary no-progress observation. Keep
      // the exact missing-adapter RCA and make the caller reload/repair in
      // the same turn instead of sleeping until cadence.
      const rcaPath = `supervisor/route-failures/${existingGoal.goal_id}.json`;
      const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: rcaPath});
      const missingRouteRca = ensureMissingRouteAdapterRca({runtimeId, goal: existingGoal, observation, observedAtUtc: nowUtc, authorityRoot: root, recordPath: rcaPath, existingRca});
      const missingRouteDefect = compileSpawnerDefectIntake({
        observation,
        rca: missingRouteRca,
        defectId: `DEFECT.SUPERVISOR.ROUTE_ADAPTER_MISSING.${existingGoal.goal_id}`,
      });
      persistSpawnerDefect({runtimeRoot: root, intake: missingRouteDefect});
      writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), compileRuntimeState({runtimeId, status: "ROUTE_FAILED_RETAINED", observation, goal: existingGoal, tick: existingTick, error: "CONTROLLER_ROUTE_ADAPTER_MISSING", nowUtc}));
      return {observation, goal: existingGoal, tick: existingTick, priorSpawnerDefect, routeFailureRca: missingRouteRca, spawnerDefect: missingRouteDefect, routeAdapterMissing: true, reused: true};
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
  if (result.routeAdapterMissing === true) {
    const rcaPath = `supervisor/route-failures/${result.goal.goal_id}.json`;
    const existingRca = readSupervisorRecord({authorityRoot: root, recordPath: rcaPath});
    const rca = ensureMissingRouteAdapterRca({runtimeId, goal: result.goal, observation, observedAtUtc: nowUtc, authorityRoot: root, recordPath: rcaPath, existingRca});
    const spawnerDefect = compileSpawnerDefectIntake({
      observation,
      rca,
      defectId: `DEFECT.SUPERVISOR.ROUTE_ADAPTER_MISSING.${result.goal.goal_id}`,
    });
    persistSpawnerDefect({runtimeRoot: root, intake: spawnerDefect});
    result.routeFailureRca = rca;
    result.spawnerDefect = spawnerDefect;
  }
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
  let routeAdapterMissingAttempts = 0;
  let boundedRecoveryFingerprint = null;
  let boundedRecoveryCount = 0;
  let iterationFailureFingerprint = null;
  let iterationFailureCount = 0;
  try {
    do {
      if (signal?.aborted === true || stopping) break;
      let sameTurnTransitions = 0;
      let immediateTurnRequested = false;
      do {
        const nowUtc = new Date().toISOString();
        let activeAdapter = adapter;
        try {
          activeAdapter = adapterFactory === null ? adapter : await adapterFactory();
          const result = await runControllerSupervisorIteration({runtimeRoot: root, adapter: activeAdapter, runtimeId, nowUtc});
          results.push(result);
          iterationFailureFingerprint = null;
          iterationFailureCount = 0;
          if (result.routeAdapterMissing === true) {
            routeAdapterMissingAttempts += 1;
            // An adapter may repair/reload its own route surface.  Give that
            // explicit local hook a same-turn opportunity before reloading
            // through adapterFactory; no cadence timer is involved.
            if (typeof activeAdapter.repair === "function") {
              await activeAdapter.repair({goal: result.goal, observation: result.observation, defect: result.spawnerDefect, attempt: routeAdapterMissingAttempts});
            }
            if (routeAdapterMissingAttempts < 3) continue;
            const exhausted = new Error("CONTROLLER_ROUTE_ADAPTER_MISSING_AFTER_BOUNDED_RECOVERY");
            exhausted.code = "AGENTOS_SUPERVISOR_ROUTE_ADAPTER_MISSING";
            const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", observation: result.observation, goal: result.goal, tick: result.tick, error: exhausted.message, nowUtc});
            writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
            stopping = true;
            break;
          }
          routeAdapterMissingAttempts = 0;
          if (result.boundedRecovery === true) {
            const fingerprint = result.noProgressRca?.rca_sha256
              ?? result.routeFailureRca?.rca_sha256
              ?? result.spawnerDefect?.defect_sha256
              ?? "UNKNOWN_BOUNDED_RECOVERY";
            boundedRecoveryCount = fingerprint === boundedRecoveryFingerprint ? boundedRecoveryCount + 1 : 1;
            boundedRecoveryFingerprint = fingerprint;
            if (boundedRecoveryCount >= 3) {
              const exhausted = new Error("BLOCKED_EXACT_AFTER_THREE_IDENTICAL_BOUNDED_RECOVERIES");
              exhausted.code = "AGENTOS_SUPERVISOR_BLOCKED_EXACT";
              const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", observation: result.observation, goal: result.goal, tick: result.tick, error: exhausted.message, nowUtc});
              writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
              if (typeof activeAdapter.onBlockedExact === "function") {
                await activeAdapter.onBlockedExact({runtimeId, result, error: exhausted.message, recovery_count: boundedRecoveryCount});
              }
              stopping = true;
              break;
            }
            // The recovery itself is not a reason to wait for cadence. Start
            // the next observation immediately; only an explicit typed
            // semantic-progress readback clears the repeated-recovery ceiling.
            immediateTurnRequested = true;
            break;
          }
          if (hasTypedSemanticProgress(result)) {
            boundedRecoveryFingerprint = null;
            boundedRecoveryCount = 0;
          }
          if (!shouldContinueSupervisorSameTurn(result)) break;
          sameTurnTransitions += 1;
        } catch (error) {
          if (error?.code === "AGENTOS_SUPERVISOR_RESTART_REQUIRED") {
            stopping = true;
            break;
          }
          const errorMessage = safeSupervisorText(error?.message ?? String(error), "supervisor iteration failed");
          const errorCode = typeof error?.code === "string" && error.code.length > 0 ? error.code : "UNCLASSIFIED";
          const fingerprint = canonicalDigest({error_code: errorCode, error_message: errorMessage});
          iterationFailureCount = fingerprint === iterationFailureFingerprint ? iterationFailureCount + 1 : 1;
          iterationFailureFingerprint = fingerprint;
          // Capture every failed iteration before attempting repair or
          // deciding whether the bounded retry budget is exhausted.  The
          // Spawner receives an opaque, reusable gate candidate even when the
          // failure happened before a project observation was available.
          let iterationFailureDefect = null;
          try {
            iterationFailureDefect = persistIterationFailureSpawnerDefect({
              runtimeRoot: root,
              runtimeId,
              errorCode,
              errorMessage,
              errorFingerprint: fingerprint,
              observedAtUtc: nowUtc,
            });
          } catch (intakeError) {
            const intakeMessage = safeSupervisorText(intakeError?.message ?? String(intakeError), "spawner defect intake failed");
            const failure = compileRuntimeState({
              runtimeId,
              status: "ITERATION_FAILED_RETAINED",
              error: `SPAWNER_DEFECT_INTAKE_FAILED:${intakeMessage}`,
              nowUtc,
            });
            writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
            stopping = true;
            break;
          }
          if (once) {
            const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", error: errorMessage, nowUtc});
            writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
            const safeError = new Error(errorMessage);
            safeError.code = error?.code;
            throw safeError;
          }
          if (typeof activeAdapter?.repair === "function") {
            try {
              await activeAdapter.repair({
                runtimeId,
                error: errorMessage,
                error_code: errorCode,
                error_fingerprint: fingerprint,
                defect: iterationFailureDefect,
                attempt: iterationFailureCount,
              });
            } catch (repairError) {
              // A repair hook is advisory and cannot turn an immediate retry
              // into a cadence wait. The original failure remains the bound
              // liveness signal; the next turn re-observes the repaired route.
              void repairError;
            }
          }
          if (iterationFailureCount >= 3) {
            const exhausted = new Error("BLOCKED_EXACT_AFTER_THREE_IDENTICAL_ITERATION_FAILURES");
            exhausted.code = "AGENTOS_SUPERVISOR_ITERATION_BLOCKED_EXACT";
            const failure = compileRuntimeState({runtimeId, status: "ITERATION_FAILED_RETAINED", error: exhausted.message, nowUtc});
            writeJsonAtomic(safeChild(root, "supervisor/runtime.json"), failure);
            if (typeof activeAdapter?.onBlockedExact === "function") {
              await activeAdapter.onBlockedExact({runtimeId, result: null, defect: iterationFailureDefect, error: exhausted.message, original_error: errorMessage, error_code: errorCode, error_fingerprint: fingerprint, recovery_count: iterationFailureCount});
            }
            stopping = true;
            break;
          }
          // Observation, module-load, and adapter failures are local liveness
          // defects. Re-enter the supervisor immediately; cadence is only a
          // backstop after a valid nonterminal route, never the first repair.
          immediateTurnRequested = true;
          break;
        }
      } while (!once && !stopping && signal?.aborted !== true && sameTurnTransitions < maxSameTurnTransitions);
      if (once || stopping) break;
      if (immediateTurnRequested) continue;
      // Exhausting the same-turn safety bound is not a reason to sleep until
      // the cadence. Re-observe immediately so the Controller can prove a
      // semantic successor, trigger its bounded no-progress recovery, or
      // reach an explicit protected event. The cadence is only a backstop
      // after a route has already yielded a legitimate nonterminal result.
      if (sameTurnTransitions >= maxSameTurnTransitions) continue;
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
