#!/usr/bin/env node

/* QA and admit permanent AgentOS control-plane roles one at a time. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateTypedSpawnerAdmission} from "./typed-spawner-admission.mjs";

export const PERMANENT_ROLE_ROSTER_SCHEMA = "agentos.permanent_role_roster.v1";
export const PERMANENT_ROLE_CANDIDATE_SCHEMA = "agentos.permanent_role_candidate.v1";
export const PERMANENT_ROLE_ROSTER_VERSION = 1;
export const PERMANENT_ROLE_IDS = Object.freeze([
  "AGENTOS.INTENT_REGULATOR",
  "AGENTOS.MEMORY",
  "AGENTOS.RUNTIME",
  "AGENTOS.SCHEDULER",
]);
export const PERMANENT_ROLE_KINDS = Object.freeze({
  "AGENTOS.INTENT_REGULATOR": "INTENT_REGULATOR",
  "AGENTOS.MEMORY": "MEMORY",
  "AGENTOS.RUNTIME": "RUNTIME",
  "AGENTOS.SCHEDULER": "SCHEDULER",
});
export const PERMANENT_ROLE_ROSTER_NEXT_ACTIONS = Object.freeze([
  "ADMIT_NEXT_PERMANENT_ROLE",
  "INJECT_ORCHESTRATOR_GOVERNANCE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Z][A-Z0-9._:-]*$/u;
const PLACEHOLDER = /(?:^|[^A-Z])(TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)(?:$|[^A-Z])/iu;
const CANDIDATE_KEYS = Object.freeze([
  "schema", "version", "role_id", "role_kind", "block_set_sha256", "independent_evaluation_sha256", "hostile_fixture_ids",
  "authority", "stop_conditions", "qa_status", "admission_state", "activation_state", "worker_spawned", "candidate_sha256",
]);
const ROSTER_KEYS = Object.freeze([
  "schema", "version", "spawner_admission_sha256", "controller_role_alias", "duplicate_controller_forbidden", "permanent_role_ids",
  "candidates", "admitted_role_ids", "next_role_id", "status", "activation_state", "worker_spawned_count", "next_action", "roster_sha256",
]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireToken(value, label) { assert(typeof value === "string" && TOKEN.test(value) && !PLACEHOLDER.test(value), `${label} is invalid`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && TOKEN.test(value) && !PLACEHOLDER.test(value)), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}
function nonPlaceholder(value, label, minimumLength = 24) { assert(typeof value === "string" && value.trim().length >= minimumLength && !/^(?:TBD|TODO|FIXME|PLACEHOLDER|LATER)$/iu.test(value.trim()), `${label} is incomplete or a placeholder`); }
function digestWithout(value, field) { return canonicalDigest({...structuredClone(value), [field]: null}); }

export function validatePermanentRoleCandidate(candidate) {
  exactKeys(candidate, CANDIDATE_KEYS, "Permanent role candidate");
  assert(candidate.schema === PERMANENT_ROLE_CANDIDATE_SCHEMA && candidate.version === PERMANENT_ROLE_ROSTER_VERSION, "Permanent role candidate identity is invalid");
  requireToken(candidate.role_id, "Permanent role candidate role");
  assert(PERMANENT_ROLE_IDS.includes(candidate.role_id), "Permanent role candidate role is not canonical");
  assert(candidate.role_kind === PERMANENT_ROLE_KINDS[candidate.role_id], "Permanent role candidate kind differs");
  requireSha(candidate.block_set_sha256, "Permanent role candidate block set");
  requireSha(candidate.independent_evaluation_sha256, "Permanent role candidate evaluation");
  sortedUnique(candidate.hostile_fixture_ids, "Permanent role candidate hostile fixtures");
  assert(candidate.authority === "INDEPENDENT_ADMISSION_AUTHORITY", "Permanent role candidate authority is invalid");
  nonPlaceholder(candidate.stop_conditions, "Permanent role candidate stop conditions");
  assert(candidate.qa_status === "QA_PASS_INDEPENDENT_EVALUATION", "Permanent role candidate QA is incomplete");
  assert(["QA_READY_NOT_ADMITTED", "ADMITTED_CONTROL_PLANE_ONLY"].includes(candidate.admission_state), "Permanent role candidate admission state is invalid");
  assert(candidate.activation_state === "OFF", "Permanent role candidate activation must remain off");
  assert(candidate.worker_spawned === false, "Permanent role candidate cannot spawn a worker");
  requireSha(candidate.candidate_sha256, "Permanent role candidate digest");
  assert(candidate.candidate_sha256 === digestWithout(candidate, "candidate_sha256"), "Permanent role candidate digest mismatch");
  return candidate;
}

export function compilePermanentRoleCandidate({roleId, blockSetSha256, independentEvaluationSha256, hostileFixtureIds, stopConditions} = {}) {
  requireToken(roleId, "Permanent role candidate role");
  requireSha(blockSetSha256, "Permanent role candidate block set");
  requireSha(independentEvaluationSha256, "Permanent role candidate evaluation");
  assert(Array.isArray(hostileFixtureIds), "Permanent role candidate hostile fixture ids input is required");
  const candidate = {
    schema: PERMANENT_ROLE_CANDIDATE_SCHEMA,
    version: PERMANENT_ROLE_ROSTER_VERSION,
    role_id: roleId,
    role_kind: PERMANENT_ROLE_KINDS[roleId],
    block_set_sha256: blockSetSha256,
    independent_evaluation_sha256: independentEvaluationSha256,
    hostile_fixture_ids: [...hostileFixtureIds].sort(compareUtf8),
    authority: "INDEPENDENT_ADMISSION_AUTHORITY",
    stop_conditions: stopConditions,
    qa_status: "QA_PASS_INDEPENDENT_EVALUATION",
    admission_state: "QA_READY_NOT_ADMITTED",
    activation_state: "OFF",
    worker_spawned: false,
    candidate_sha256: null,
  };
  candidate.candidate_sha256 = digestWithout(candidate, "candidate_sha256");
  return validatePermanentRoleCandidate(candidate);
}

function validateRolePrefix(admittedRoleIds) {
  assert(Array.isArray(admittedRoleIds), "Permanent roster admitted roles are required");
  assert(admittedRoleIds.length <= PERMANENT_ROLE_IDS.length, "Permanent roster admitted role count exceeds canonical set");
  assert(JSON.stringify(admittedRoleIds) === JSON.stringify(PERMANENT_ROLE_IDS.slice(0, admittedRoleIds.length)), "Permanent roles must be admitted one at a time in canonical order");
}

export function validatePermanentRoleRoster(roster, {spawnerAdmission = null} = {}) {
  exactKeys(roster, ROSTER_KEYS, "Permanent role roster");
  assert(roster.schema === PERMANENT_ROLE_ROSTER_SCHEMA && roster.version === PERMANENT_ROLE_ROSTER_VERSION, "Permanent role roster identity is invalid");
  requireSha(roster.spawner_admission_sha256, "Permanent roster Spawner admission");
  assert(roster.controller_role_alias === "AGENTOS.INTENT_REGULATOR", "Controller role alias is invalid");
  assert(roster.duplicate_controller_forbidden === true, "Permanent roster must forbid duplicate Controllers");
  assert(JSON.stringify(roster.permanent_role_ids) === JSON.stringify(PERMANENT_ROLE_IDS), "Permanent roster role set is incomplete or reordered");
  assert(Array.isArray(roster.candidates) && roster.candidates.length === PERMANENT_ROLE_IDS.length, "Permanent roster candidates are incomplete");
  const candidateIds = roster.candidates.map((candidate) => candidate.role_id);
  assert(JSON.stringify(candidateIds) === JSON.stringify(PERMANENT_ROLE_IDS), "Permanent roster candidates must be canonical and ordered");
  for (const candidate of roster.candidates) validatePermanentRoleCandidate(candidate);
  validateRolePrefix(roster.admitted_role_ids);
  const admittedSet = new Set(roster.admitted_role_ids);
  for (const candidate of roster.candidates) {
    const expected = admittedSet.has(candidate.role_id) ? "ADMITTED_CONTROL_PLANE_ONLY" : "QA_READY_NOT_ADMITTED";
    assert(candidate.admission_state === expected, `Permanent role ${candidate.role_id} admission state is inconsistent`);
  }
  const expectedNextRole = roster.admitted_role_ids.length < PERMANENT_ROLE_IDS.length ? PERMANENT_ROLE_IDS[roster.admitted_role_ids.length] : null;
  assert(roster.next_role_id === expectedNextRole, "Permanent roster next role is inconsistent");
  const complete = expectedNextRole === null;
  assert(roster.status === (complete ? "PERMANENT_ROSTER_READY" : "READY_FOR_NEXT_ROLE"), "Permanent roster status is inconsistent");
  assert(roster.activation_state === "OFF", "Permanent roster activation must remain off");
  assert(roster.worker_spawned_count === 0, "Permanent roster cannot spawn workers");
  assert(roster.next_action === (complete ? "INJECT_ORCHESTRATOR_GOVERNANCE" : "ADMIT_NEXT_PERMANENT_ROLE"), "Permanent roster next action is inconsistent");
  requireSha(roster.roster_sha256, "Permanent roster digest");
  assert(roster.roster_sha256 === digestWithout(roster, "roster_sha256"), "Permanent roster digest mismatch");
  if (spawnerAdmission !== null) {
    validateTypedSpawnerAdmission(spawnerAdmission);
    assert(roster.spawner_admission_sha256 === spawnerAdmission.admission_sha256, "Permanent roster Spawner admission is stale");
  }
  return roster;
}

export function compilePermanentRoleRoster({spawnerAdmissionSha256, candidates, admittedRoleIds = []} = {}) {
  requireSha(spawnerAdmissionSha256, "Permanent roster Spawner admission");
  assert(Array.isArray(candidates), "Permanent roster candidate list is required");
  assert(Array.isArray(admittedRoleIds), "Permanent roster admitted roles are required");
  for (const candidate of candidates) validatePermanentRoleCandidate(candidate);
  const roster = {
    schema: PERMANENT_ROLE_ROSTER_SCHEMA,
    version: PERMANENT_ROLE_ROSTER_VERSION,
    spawner_admission_sha256: spawnerAdmissionSha256,
    controller_role_alias: "AGENTOS.INTENT_REGULATOR",
    duplicate_controller_forbidden: true,
    permanent_role_ids: [...PERMANENT_ROLE_IDS],
    candidates: [...candidates].sort((left, right) => compareUtf8(left.role_id, right.role_id)),
    admitted_role_ids: [...admittedRoleIds],
    next_role_id: null,
    status: "READY_FOR_NEXT_ROLE",
    activation_state: "OFF",
    worker_spawned_count: 0,
    next_action: "ADMIT_NEXT_PERMANENT_ROLE",
    roster_sha256: null,
  };
  roster.next_role_id = roster.admitted_role_ids.length < PERMANENT_ROLE_IDS.length ? PERMANENT_ROLE_IDS[roster.admitted_role_ids.length] : null;
  if (roster.next_role_id === null) {
    roster.status = "PERMANENT_ROSTER_READY";
    roster.next_action = "INJECT_ORCHESTRATOR_GOVERNANCE";
  }
  roster.roster_sha256 = digestWithout(roster, "roster_sha256");
  return validatePermanentRoleRoster(roster);
}

export function admitNextPermanentRole(roster, roleId) {
  validatePermanentRoleRoster(roster);
  requireToken(roleId, "Permanent roster requested role");
  assert(roster.next_role_id === roleId, "Permanent role admission must follow the typed next role");
  const next = structuredClone(roster);
  const candidate = next.candidates.find((item) => item.role_id === roleId);
  assert(candidate !== undefined && candidate.admission_state === "QA_READY_NOT_ADMITTED", "Permanent role candidate is not independently ready");
  candidate.admission_state = "ADMITTED_CONTROL_PLANE_ONLY";
  candidate.candidate_sha256 = digestWithout(candidate, "candidate_sha256");
  next.admitted_role_ids = [...next.admitted_role_ids, roleId];
  next.next_role_id = next.admitted_role_ids.length < PERMANENT_ROLE_IDS.length ? PERMANENT_ROLE_IDS[next.admitted_role_ids.length] : null;
  next.status = next.next_role_id === null ? "PERMANENT_ROSTER_READY" : "READY_FOR_NEXT_ROLE";
  next.next_action = next.next_role_id === null ? "INJECT_ORCHESTRATOR_GOVERNANCE" : "ADMIT_NEXT_PERMANENT_ROLE";
  next.roster_sha256 = digestWithout(next, "roster_sha256");
  return validatePermanentRoleRoster(next);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Permanent role roster contract loaded\n");
