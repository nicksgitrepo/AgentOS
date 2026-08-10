#!/usr/bin/env node

/*
 * Persistent goal contract for one canonical feature or governance lane.
 *
 * The inventory owns scope. This module gives every visible auditor/build
 * task one durable, content-addressed goal that survives handoff, repair,
 * re-audit, and closure without copying project-specific implementation
 * details into the AgentOS kernel.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const FEATURE_LANE_GOAL_SCHEMA = "agentos.feature_lane_goal.v1";
export const FEATURE_LANE_GOAL_VERSION = 1;
export const FEATURE_LANE_GOAL_OBJECTIVE = "AUDIT_REPAIR_REAUDIT_UNTIL_PRODUCTION_CANDIDATE_OR_EXTERNAL_BLOCKER";
export const FEATURE_LANE_GOAL_STATES = Object.freeze(["ACTIVE", "FINISHED", "CONTEXT_NEEDED", "BLOCKED"]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const REPORT_PATH = /(?:^|\/)[A-Za-z0-9._-]*auditreport\.md$/u;
const GOAL_KEYS = [
  "schema", "version", "goal_id", "target_id", "target_name", "target_kind",
  "auditor_task_id", "worktree_id", "report_path", "source_refs", "objective",
  "persistence", "state", "goal_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a portable identifier`);
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(RELATIVE_PATH.test(value), `${label} must be a safe relative path`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function normalizeSourceRefs(sourceRefs) {
  assert(Array.isArray(sourceRefs) && sourceRefs.length > 0, "feature lane goal source_refs are required");
  const refs = sourceRefs.map((source, index) => {
    requireRelativePath(source, `feature lane goal source ${index}`);
    return source;
  });
  assert(new Set(refs).size === refs.length, "feature lane goal source_refs contain duplicates");
  return [...refs].sort(compareUtf8);
}

export function validateFeatureLaneGoal(goal, {label = "feature lane goal"} = {}) {
  exactKeys(goal, GOAL_KEYS, label);
  assert(goal.schema === FEATURE_LANE_GOAL_SCHEMA, `${label} schema is invalid`);
  assert(goal.version === FEATURE_LANE_GOAL_VERSION, `${label} version is invalid`);
  requireIdentifier(goal.goal_id, `${label} ID`);
  requireIdentifier(goal.target_id, `${label} target ID`);
  requireString(goal.target_name, `${label} target name`);
  requireIdentifier(goal.target_kind, `${label} target kind`);
  requireIdentifier(goal.auditor_task_id, `${label} auditor task`);
  requireIdentifier(goal.worktree_id, `${label} worktree`);
  requireRelativePath(goal.report_path, `${label} report path`);
  assert(REPORT_PATH.test(goal.report_path), `${label} report path must end in auditreport.md`);
  const sortedSourceRefs = normalizeSourceRefs(goal.source_refs);
  assert(JSON.stringify(goal.source_refs) === JSON.stringify(sortedSourceRefs), `${label} source_refs must be UTF-8 sorted`);
  assert(goal.objective === FEATURE_LANE_GOAL_OBJECTIVE, `${label} objective is invalid`);
  assert(goal.persistence === "CONTROLLER_CONTROL_PLANE", `${label} persistence authority is invalid`);
  assert(FEATURE_LANE_GOAL_STATES.includes(goal.state), `${label} state is invalid`);
  assert(typeof goal.goal_sha256 === "string" && /^[0-9a-f]{64}$/u.test(goal.goal_sha256), `${label} digest is invalid`);
  assert(goal.goal_sha256 === digestWithout(goal, "goal_sha256"), `${label} digest mismatch`);
  return goal;
}

export function compileFeatureLaneGoal({
  targetId,
  targetName,
  targetKind,
  auditorTaskId,
  worktreeId,
  reportPath,
  sourceRefs,
  state = "ACTIVE",
} = {}) {
  requireIdentifier(targetId, "feature lane goal target ID");
  requireString(targetName, "feature lane goal target name");
  requireIdentifier(targetKind, "feature lane goal target kind");
  requireIdentifier(auditorTaskId, "feature lane goal auditor task");
  requireIdentifier(worktreeId, "feature lane goal worktree");
  requireRelativePath(reportPath, "feature lane goal report path");
  assert(REPORT_PATH.test(reportPath), "feature lane goal report path must end in auditreport.md");
  assert(FEATURE_LANE_GOAL_STATES.includes(state), "feature lane goal state is invalid");
  const goal = {
    schema: FEATURE_LANE_GOAL_SCHEMA,
    version: FEATURE_LANE_GOAL_VERSION,
    goal_id: `GOAL_${auditorTaskId}`,
    target_id: targetId,
    target_name: targetName,
    target_kind: targetKind,
    auditor_task_id: auditorTaskId,
    worktree_id: worktreeId,
    report_path: reportPath,
    source_refs: normalizeSourceRefs(sourceRefs),
    objective: FEATURE_LANE_GOAL_OBJECTIVE,
    persistence: "CONTROLLER_CONTROL_PLANE",
    state,
    goal_sha256: null,
  };
  goal.goal_sha256 = digestWithout(goal, "goal_sha256");
  return validateFeatureLaneGoal(goal);
}

export function assertFeatureLaneGoalBinding(goal, binding, {label = "feature lane goal binding"} = {}) {
  validateFeatureLaneGoal(goal, {label});
  assert(isRecord(binding), `${label} binding must be an object`);
  for (const field of ["target_id", "auditor_task_id", "worktree_id", "goal_id", "goal_sha256"]) {
    assert(binding[field] === goal[field], `${label} ${field} differs from the persisted goal`);
  }
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("feature lane goal loaded\n");
