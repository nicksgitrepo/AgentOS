#!/usr/bin/env node

/*
 * Operational proof for one builder/auditor round.
 *
 * This is deliberately a validator, not an admission authority.  A builder
 * cannot turn a string such as "PASS" into permission to merge: the round
 * must bind two different tasks, one frozen candidate, read-only auditor
 * custody, real fixture/gate executions, and zero side effects.  Spawner and
 * the separately governed evaluator remain the only authorities that can
 * admit or consume the resulting receipt.
 */

import {canonicalDigest} from "./content-addressing.mjs";

export const AUDITOR_ROUND_SCHEMA = "agentos.auditor_round_custody.v1";
export const AUDITOR_ROUND_RESULT_SCHEMA = "agentos.auditor_round_result.v1";
export const AUDITOR_ROUND_VERSION = 1;

const ID = /^[A-Z][A-Z0-9._:-]{2,191}$/u;
const TASK = /^TASK\.(?:BUILDER|AUDITOR)\.[A-Z0-9._:-]{2,160}$/u;
const REF = /^opaque:(?:task|worktree|candidate|round|receipt):[A-Z0-9._:/-]{1,180}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA1 = /^[0-9a-f]{40}$/u;
const VERDICTS = new Set(["PASS", "NOT_APPLICABLE_WITH_EVIDENCE", "FAIL", "UNKNOWN", "BLOCKED_EXACT"]);
const OBSERVED = new Set(["PASS", "ROUTE", "DENY", "FAIL", "NOT_APPLICABLE", "BLOCKED", "UNKNOWN"]);
const SIDE_EFFECT_KEYS = ["candidate_writes", "builder_writes", "memory_writes", "project_writes", "credential_accesses", "merge_calls", "deploy_calls", "state_changes"];

function fail(message, code = "AUDITOR_ROUND_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) { if (!value) fail(message, code); }

function exact(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AUDITOR_ROUND_SHAPE_INVALID");
  const expected = [...keys].sort().join("\0");
  const actual = Object.keys(value).sort().join("\0");
  assert(actual === expected, `${label} fields differ`, "AUDITOR_ROUND_UNKNOWN_FIELD");
}

function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is not canonical`, "AUDITOR_ROUND_ID_INVALID"); }
function task(value, label) { assert(typeof value === "string" && TASK.test(value), `${label} is not a task identity`, "AUDITOR_ROUND_TASK_INVALID"); }
function ref(value, label) { assert(typeof value === "string" && REF.test(value), `${label} is not an opaque reference`, "AUDITOR_ROUND_REF_INVALID"); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a content digest`, "AUDITOR_ROUND_DIGEST_INVALID"); }
function gitSha(value, label) { assert(typeof value === "string" && GIT_SHA1.test(value) && !/^([0-9a-f])\1{39}$/u.test(value), `${label} is not a Git identity`, "AUDITOR_ROUND_GIT_ID_INVALID"); }
function bounded(value, label, limit = 180) { assert(typeof value === "string" && value.length > 0 && value.length <= limit, `${label} is not bounded`, "AUDITOR_ROUND_FIELD_INVALID"); }
function utc(value, label) { bounded(value, label, 40); const time = Date.parse(value); assert(Number.isFinite(time) && value === new Date(time).toISOString(), `${label} is not canonical UTC`, "AUDITOR_ROUND_TIME_INVALID"); return time; }
function bool(value, label) { assert(typeof value === "boolean", `${label} must be boolean`, "AUDITOR_ROUND_BOOLEAN_INVALID"); }
function list(value, label, min = 1, max = 4096) { assert(Array.isArray(value) && value.length >= min && value.length <= max, `${label} inventory is invalid`, "AUDITOR_ROUND_INVENTORY_INVALID"); }
function unique(values, label) { assert(new Set(values).size === values.length, `${label} contains duplicates or aliases`, "AUDITOR_ROUND_DUPLICATE_INVENTORY"); }
function zeroSideEffects(value, label) {
  exact(value, SIDE_EFFECT_KEYS, label);
  for (const key of SIDE_EFFECT_KEYS) assert(value[key] === 0, `${label}.${key} is non-zero`, "AUDITOR_ROUND_SIDE_EFFECT_DETECTED");
}
function digestWithout(value, field) { return canonicalDigest({...value, [field]: null}); }

function validateCandidate(candidate) {
  exact(candidate, ["candidate_ref", "commit_sha1", "tree_sha1", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "rollback_commit_sha1", "rollback_tree_sha1", "status"], "round.candidate");
  ref(candidate.candidate_ref, "candidate_ref");
  gitSha(candidate.commit_sha1, "candidate.commit_sha1"); gitSha(candidate.tree_sha1, "candidate.tree_sha1");
  sha(candidate.package_sha256, "candidate.package_sha256"); sha(candidate.gate_inventory_sha256, "candidate.gate_inventory_sha256"); sha(candidate.fixture_inventory_sha256, "candidate.fixture_inventory_sha256"); sha(candidate.context_sha256, "candidate.context_sha256");
  gitSha(candidate.rollback_commit_sha1, "candidate.rollback_commit_sha1"); gitSha(candidate.rollback_tree_sha1, "candidate.rollback_tree_sha1");
  assert(candidate.status === "FROZEN_IMMUTABLE", "candidate is not frozen", "AUDITOR_ROUND_CANDIDATE_NOT_FROZEN");
}

function validateModel(model) {
  exact(model, ["snapshot_sha256", "projection_sha256", "model_id", "reasoning_effort", "availability", "status"], "round.model_policy");
  sha(model.snapshot_sha256, "model_policy.snapshot_sha256"); sha(model.projection_sha256, "model_policy.projection_sha256"); bounded(model.model_id, "model_policy.model_id", 120); bounded(model.reasoning_effort, "model_policy.reasoning_effort", 40);
  assert(model.availability === "CURRENT_HOST_AVAILABLE" && model.status === "CURRENT_BOUND", "model policy is unavailable or stale", "AUDITOR_ROUND_MODEL_POLICY_INVALID");
}

function validateCustody(custody, builderTask, auditorTask) {
  exact(custody, ["builder_worktree_ref", "auditor_worktree_ref", "builder_custody_receipt_sha256", "auditor_spawn_receipt_sha256", "auditor_task_readback_ref", "candidate_snapshot_sha256", "read_only", "candidate_mutation_allowed", "merge_allowed", "deploy_allowed"], "round.custody");
  ref(custody.builder_worktree_ref, "custody.builder_worktree_ref"); ref(custody.auditor_worktree_ref, "custody.auditor_worktree_ref"); ref(custody.auditor_task_readback_ref, "custody.auditor_task_readback_ref");
  assert(custody.builder_worktree_ref !== custody.auditor_worktree_ref, "builder and auditor share a worktree", "AUDITOR_ROUND_SHARED_WORKTREE");
  sha(custody.builder_custody_receipt_sha256, "custody.builder_custody_receipt_sha256"); sha(custody.auditor_spawn_receipt_sha256, "custody.auditor_spawn_receipt_sha256"); sha(custody.candidate_snapshot_sha256, "custody.candidate_snapshot_sha256");
  bool(custody.read_only, "custody.read_only"); bool(custody.candidate_mutation_allowed, "custody.candidate_mutation_allowed"); bool(custody.merge_allowed, "custody.merge_allowed"); bool(custody.deploy_allowed, "custody.deploy_allowed");
  assert(custody.read_only === true && custody.candidate_mutation_allowed === false && custody.merge_allowed === false && custody.deploy_allowed === false, "auditor custody grants a forbidden action", "AUDITOR_ROUND_CUSTODY_WEAKENED");
  assert(custody.auditor_task_readback_ref !== `opaque:task:${builderTask}`, "task readback points at the builder", "AUDITOR_ROUND_TASK_READBACK_INVALID");
}

function validateFixture(fixture, index) {
  exact(fixture, ["fixture_id", "fixture_sha256", "input_sha256", "entrypoint", "invoked", "expected_disposition", "observed_disposition", "expected_error_code", "observed_error_code", "negative_assertions", "side_effects", "result_sha256"], `round.execution.fixtures[${index}]`);
  id(fixture.fixture_id, `fixture[${index}].fixture_id`); sha(fixture.fixture_sha256, `fixture[${index}].fixture_sha256`); sha(fixture.input_sha256, `fixture[${index}].input_sha256`); bounded(fixture.entrypoint, `fixture[${index}].entrypoint`, 240);
  bool(fixture.invoked, `fixture[${index}].invoked`); assert(fixture.invoked === true, `fixture[${index}] was not invoked`, "AUDITOR_ROUND_FIXTURE_NOT_EXECUTED");
  assert(OBSERVED.has(fixture.expected_disposition) && OBSERVED.has(fixture.observed_disposition), `fixture[${index}] disposition invalid`, "AUDITOR_ROUND_FIXTURE_RESULT_INVALID"); bounded(fixture.expected_error_code, `fixture[${index}].expected_error_code`, 160); bounded(fixture.observed_error_code, `fixture[${index}].observed_error_code`, 160);
  list(fixture.negative_assertions, `fixture[${index}].negative_assertions`, 1, 32); fixture.negative_assertions.forEach((item) => bounded(item, `fixture[${index}].negative_assertions[]`, 160));
  zeroSideEffects(fixture.side_effects, `fixture[${index}].side_effects`); sha(fixture.result_sha256, `fixture[${index}].result_sha256`); assert(fixture.result_sha256 === digestWithout(fixture, "result_sha256"), `fixture[${index}] result digest differs`, "AUDITOR_ROUND_FIXTURE_DIGEST_MISMATCH");
}

function validateGate(gate, index, fixtureIds) {
  exact(gate, ["gate_id", "gate_sha256", "fixture_ids", "entrypoint", "executed", "observed_status", "negative_assertions", "execution_receipt_sha256", "result_sha256"], `round.execution.gates[${index}]`);
  id(gate.gate_id, `gate[${index}].gate_id`); sha(gate.gate_sha256, `gate[${index}].gate_sha256`); list(gate.fixture_ids, `gate[${index}].fixture_ids`); unique(gate.fixture_ids, `gate[${index}].fixture_ids`); gate.fixture_ids.forEach((fixtureId) => assert(fixtureIds.has(fixtureId), `gate[${index}] references an unexecuted fixture`, "AUDITOR_ROUND_GATE_FIXTURE_UNBOUND")); bounded(gate.entrypoint, `gate[${index}].entrypoint`, 240);
  bool(gate.executed, `gate[${index}].executed`); assert(gate.executed === true, `gate[${index}] was not executed`, "AUDITOR_ROUND_GATE_NOT_EXECUTED"); assert(OBSERVED.has(gate.observed_status), `gate[${index}] status invalid`, "AUDITOR_ROUND_GATE_RESULT_INVALID"); list(gate.negative_assertions, `gate[${index}].negative_assertions`); sha(gate.execution_receipt_sha256, `gate[${index}].execution_receipt_sha256`); sha(gate.result_sha256, `gate[${index}].result_sha256`); assert(gate.result_sha256 === digestWithout(gate, "result_sha256"), `gate[${index}] result digest differs`, "AUDITOR_ROUND_GATE_DIGEST_MISMATCH");
}

function validateExecution(execution, custody, candidate) {
  exact(execution, ["status", "entrypoints_real", "metadata_only", "timeout_or_silence", "fixture_inventory_complete", "gate_inventory_complete", "fixtures", "gates", "side_effects", "auditor_cwd_ref", "candidate_custody_readback_sha256", "write_attempts", "target_write_attempts", "command_receipts", "execution_sha256"], "round.execution");
  assert(execution.status === "COMPLETE", "audit execution is not complete", "AUDITOR_ROUND_EXECUTION_INCOMPLETE"); bool(execution.entrypoints_real, "execution.entrypoints_real"); bool(execution.metadata_only, "execution.metadata_only"); bool(execution.timeout_or_silence, "execution.timeout_or_silence"); bool(execution.fixture_inventory_complete, "execution.fixture_inventory_complete"); bool(execution.gate_inventory_complete, "execution.gate_inventory_complete");
  assert(execution.entrypoints_real === true && execution.metadata_only === false && execution.timeout_or_silence === false && execution.fixture_inventory_complete === true && execution.gate_inventory_complete === true, "audit execution is metadata-only, stale, or incomplete", "AUDITOR_ROUND_EXECUTION_UNTRUSTED");
  ref(execution.auditor_cwd_ref, "execution.auditor_cwd_ref"); assert(execution.auditor_cwd_ref === custody.auditor_worktree_ref, "auditor command did not run in its isolated worktree", "AUDITOR_ROUND_CWD_CUSTODY_MISMATCH"); sha(execution.candidate_custody_readback_sha256, "execution.candidate_custody_readback_sha256"); assert(Number.isInteger(execution.write_attempts) && execution.write_attempts >= 0 && Number.isInteger(execution.target_write_attempts) && execution.target_write_attempts === 0, "auditor write-attempt readback is unsafe", "AUDITOR_ROUND_TARGET_WRITE_DETECTED"); list(execution.command_receipts, "execution.command_receipts"); unique(execution.command_receipts.map((receipt) => receipt.command_sha256), "execution.command_receipts"); execution.command_receipts.forEach((receipt, index) => { exact(receipt, ["command_sha256", "cwd_ref", "entrypoint", "status", "target_write_attempts", "candidate_tree_before_sha1", "candidate_tree_after_sha1", "readback_sha256"], `execution.command_receipts[${index}]`); sha(receipt.command_sha256, `command[${index}].command_sha256`); ref(receipt.cwd_ref, `command[${index}].cwd_ref`); assert(receipt.cwd_ref === custody.auditor_worktree_ref && receipt.status === "COMPLETE" && receipt.target_write_attempts === 0, `command[${index}] escaped auditor custody`, "AUDITOR_ROUND_COMMAND_CUSTODY_INVALID"); gitSha(receipt.candidate_tree_before_sha1, `command[${index}].candidate_tree_before_sha1`); gitSha(receipt.candidate_tree_after_sha1, `command[${index}].candidate_tree_after_sha1`); assert(receipt.candidate_tree_before_sha1 === receipt.candidate_tree_after_sha1 && receipt.candidate_tree_after_sha1 === candidate.tree_sha1, `command[${index}] changed or did not read back the candidate tree`, "AUDITOR_ROUND_CANDIDATE_READBACK_INVALID"); sha(receipt.readback_sha256, `command[${index}].readback_sha256`); assert(receipt.readback_sha256 === digestWithout(receipt, "readback_sha256"), `command[${index}] readback digest differs`, "AUDITOR_ROUND_COMMAND_DIGEST_MISMATCH"); });
  list(execution.fixtures, "execution.fixtures"); const fixtureList = execution.fixtures.map((fixture) => fixture.fixture_id); unique(fixtureList, "execution.fixtures"); const fixtureIds = new Set(fixtureList); execution.fixtures.forEach(validateFixture);
  list(execution.gates, "execution.gates"); const gateIds = execution.gates.map((gate) => gate.gate_id); unique(gateIds, "execution.gates"); execution.gates.forEach((gate, index) => validateGate(gate, index, fixtureIds)); const covered = new Set(execution.gates.flatMap((gate) => gate.fixture_ids)); assert([...fixtureIds].every((fixtureId) => covered.has(fixtureId)), "gate inventory does not cover every executed fixture", "AUDITOR_ROUND_GATE_COVERAGE_INCOMPLETE"); zeroSideEffects(execution.side_effects, "execution.side_effects"); sha(execution.execution_sha256, "execution.execution_sha256"); assert(execution.execution_sha256 === digestWithout(execution, "execution_sha256"), "execution digest differs", "AUDITOR_ROUND_EXECUTION_DIGEST_MISMATCH");
}

export function validateAuditorRound(round) {
  exact(round, ["schema", "version", "round_id", "round_kind", "builder_task_id", "auditor_task_id", "builder_identity", "auditor_identity", "candidate", "model_policy", "custody", "execution", "verdict", "issued_at_utc", "expires_at_utc", "round_sha256"], "auditor round");
  assert(round.schema === AUDITOR_ROUND_SCHEMA && round.version === AUDITOR_ROUND_VERSION && round.round_kind === "ADVERSARIAL_AUDIT", "auditor round identity is invalid", "AUDITOR_ROUND_SCHEMA_MISMATCH"); id(round.round_id, "round_id"); task(round.builder_task_id, "builder_task_id"); task(round.auditor_task_id, "auditor_task_id"); assert(round.builder_task_id !== round.auditor_task_id, "builder and auditor use the same task", "AUDITOR_ROUND_SELF_REVIEW"); id(round.builder_identity, "builder_identity"); id(round.auditor_identity, "auditor_identity"); assert(round.builder_identity !== round.auditor_identity, "builder and auditor use the same identity", "AUDITOR_ROUND_SELF_REVIEW");
  validateCandidate(round.candidate); validateModel(round.model_policy); validateCustody(round.custody, round.builder_task_id, round.auditor_task_id); assert(round.custody.candidate_snapshot_sha256 === canonicalDigest(round.candidate), "custody is bound to a different candidate snapshot", "AUDITOR_ROUND_CANDIDATE_BINDING_MISMATCH"); validateExecution(round.execution, round.custody, round.candidate);
  assert(VERDICTS.has(round.verdict), "auditor round verdict is invalid", "AUDITOR_ROUND_VERDICT_INVALID");
  const issued = utc(round.issued_at_utc, "issued_at_utc"); const expires = utc(round.expires_at_utc, "expires_at_utc"); const now = Date.now(); assert(issued <= now && now <= expires, "auditor round is future-dated or expired", "AUDITOR_ROUND_STALE"); assert(expires - issued <= 24 * 60 * 60 * 1000, "auditor round validity window is too long", "AUDITOR_ROUND_FRESHNESS_INVALID");
  assert(round.round_sha256 === digestWithout(round, "round_sha256"), "auditor round digest differs", "AUDITOR_ROUND_DIGEST_MISMATCH");
  if (round.verdict === "PASS" || round.verdict === "NOT_APPLICABLE_WITH_EVIDENCE") {
    assert(round.execution.fixtures.every((fixture) => fixture.expected_disposition === fixture.observed_disposition && fixture.expected_error_code === fixture.observed_error_code), "auditor PASS contains a mismatched fixture result", "AUDITOR_ROUND_PASS_UNPROVEN");
  }
  return round;
}

export function assessAuditorRound(round) {
  try {
    validateAuditorRound(round);
    const descriptivePass = ["PASS", "NOT_APPLICABLE_WITH_EVIDENCE"].includes(round.verdict);
    const result = {schema: AUDITOR_ROUND_RESULT_SCHEMA, version: 1, disposition: round.verdict, integration_allowed: false, independent_clearance: false, ready_for_spawner_review: false, error_code: descriptivePass ? "AUDITOR_ROUND_EXTERNAL_REVIEW_REQUIRED" : "AUDITOR_ROUND_TYPED_FINDING_OR_BLOCKER", round_sha256: round.round_sha256};
    return Object.freeze({...result, result_sha256: canonicalDigest(result)});
  } catch (error) {
    return Object.freeze({schema: AUDITOR_ROUND_RESULT_SCHEMA, version: 1, disposition: "BLOCKED_EXACT", integration_allowed: false, independent_clearance: false, ready_for_spawner_review: false, error_code: error.code || "AUDITOR_ROUND_INVALID", result_sha256: canonicalDigest({schema: AUDITOR_ROUND_RESULT_SCHEMA, version: 1, disposition: "BLOCKED_EXACT", integration_allowed: false, independent_clearance: false, ready_for_spawner_review: false, error_code: error.code || "AUDITOR_ROUND_INVALID"})});
  }
}
