#!/usr/bin/env node

/* Focused JSON Schema parity checks for the lane-owned Runtime records. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest, scanPersistedRecord} from "../control/content-addressing.mjs";
import {
  ACTIVATION_STATUS,
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION,
  REGULATOR_DECISIONS,
  compilePersistentIntentRuntimeContract,
  compileIntentRegulatorDecision,
  createOpaqueRuntimeReference,
  openPersistentIntentRuntime,
  validatePersistentIntentRuntimeContract,
} from "../control/persistent-intent-runtime.mjs";

const repositoryRoot = fs.realpathSync(process.cwd());
const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "schemas/persistent-intent-runtime.v1.json"), "utf8"));
const PROJECT = "PROJECT-001";
const ENVIRONMENT = "ENVIRONMENT-001";
const CAMPAIGN = "CAMPAIGN-001";
const GOAL_ID = "GOAL-001";
const GOAL_SHA256 = "a".repeat(64);
const SOURCE_COMMIT = "b".repeat(40);
const SOURCE_TREE = "c".repeat(40);
const T0 = "2026-01-01T00:00:00.000Z";

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function typeMatches(value, type) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  throw new Error(`unsupported schema type: ${type}`);
}

function resolveRef(ref) {
  assert(ref.startsWith("#/$defs/"), `unexpected external schema reference: ${ref}`);
  const definition = schema.$defs[ref.slice("#/$defs/".length)];
  assert(definition, `missing schema definition: ${ref}`);
  return definition;
}

function validateSchemaInstance(definition, value, location = "$", stack = new Set()) {
  if (definition.$ref) {
    const marker = `${definition.$ref}|${location}`;
    if (!stack.has(marker)) {
      const next = new Set(stack);
      next.add(marker);
      validateSchemaInstance(resolveRef(definition.$ref), value, location, next);
    }
  }
  if (definition.const !== undefined) assert(same(value, definition.const), `${location} differs from schema const`);
  if (definition.enum) assert(definition.enum.some((candidate) => same(candidate, value)), `${location} differs from schema enum`);
  if (definition.type) assert(typeMatches(value, definition.type), `${location} has an invalid type`);
  if (definition.minLength !== undefined) assert(value.length >= definition.minLength, `${location} is too short`);
  if (definition.minimum !== undefined) assert(value >= definition.minimum, `${location} is below minimum`);
  if (definition.maximum !== undefined) assert(value <= definition.maximum, `${location} is above maximum`);
  if (definition.pattern) assert(new RegExp(definition.pattern, "u").test(value), `${location} fails pattern`);
  if (definition.required) for (const key of definition.required) assert(Object.hasOwn(value, key), `${location}.${key} is required`);
  if (definition.properties) {
    for (const [key, child] of Object.entries(definition.properties)) {
      if (Object.hasOwn(value, key)) validateSchemaInstance(child, value[key], `${location}.${key}`, stack);
    }
  }
  if (definition.additionalProperties === false && definition.type === "object") {
    const known = new Set(Object.keys(definition.properties ?? {}));
    for (const key of Object.keys(value)) assert(known.has(key), `${location}.${key} is not allowed`);
  }
  if (definition.items) for (const [index, item] of value.entries()) validateSchemaInstance(definition.items, item, `${location}[${index}]`, stack);
  if (definition.minItems !== undefined) assert(value.length >= definition.minItems, `${location} has too few items`);
  if (definition.maxItems !== undefined) assert(value.length <= definition.maxItems, `${location} has too many items`);
  if (definition.uniqueItems) assert(new Set(value.map((item) => JSON.stringify(item))).size === value.length, `${location} has duplicate items`);
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    if (!definition[keyword]) continue;
    const matches = definition[keyword].filter((candidate) => {
      try {
        validateSchemaInstance(candidate, value, location, stack);
        return true;
      } catch {
        return false;
      }
    }).length;
    if (keyword === "allOf") assert.equal(matches, definition[keyword].length, `${location} failed allOf`);
    if (keyword === "anyOf") assert(matches > 0, `${location} failed anyOf`);
    if (keyword === "oneOf") assert.equal(matches, 1, `${location} failed oneOf`);
  }
}

function snapshot() {
  return {
    schema: "agentos.campaign_snapshot.v1",
    version: 1,
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: "V1",
    goal_id: GOAL_ID,
    goal_sha256: GOAL_SHA256,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
    progress_status: "PROGRESS_RECORDED",
    scope_changed: false,
    intent_changed: false,
    conditions_changed: false,
    hard_boundary_detected: false,
    soft_boundary_detected: false,
    evidence_identity_ok: true,
    roster_exact: true,
    acceptance_status: "NONE",
  };
}

function checkpoint() {
  const value = {
    schema: "agentos.intent_regulator_checkpoint.v1",
    version: 1,
    activation_status: ACTIVATION_STATUS,
    checkpoint_id: "CHECKPOINT-001",
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: "V1",
    goal_id: GOAL_ID,
    goal_sha256: GOAL_SHA256,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
    phase_index: 0,
    lane_index: 0,
    step: "STEP-001",
    next_action: "CAMPAIGN_ORCHESTRATOR",
    progress_status: "PROGRESS_RECORDED",
    meaningful_progress: {
      result_type: "VERIFIED_BEHAVIOR",
      artifact_sha256: "d".repeat(64),
      evidence_sha256: "e".repeat(64),
      handoff_sha256: "f".repeat(64),
      summary_sha256: "1".repeat(64),
    },
    last_meaningful_progress_at_utc: T0,
    evidence_identity_ok: true,
    created_at_utc: T0,
    checkpoint_sha256: null,
  };
  value.checkpoint_sha256 = canonicalDigest(value);
  return value;
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runtime-schema-parity-"));
}

const root = freshRoot();
let runtime;
try {
  runtime = openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot,
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", "schema-parity"),
    snapshot: snapshot(),
    environmentId: ENVIRONMENT,
    nowUtc: T0,
    faultInjector: (stage) => {
      if (stage === "TRANSACTION_PREPARED") throw Object.assign(new Error("prepared fixture"), {code: "TEST_PREPARED_FIXTURE"});
    },
  });
  assert.throws(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "PARITY-001", observedAtUtc: T0}), /prepared fixture/u);

  const inspected = JSON.parse(JSON.stringify((await import("../control/persistent-intent-runtime.mjs")).inspectPersistentIntentRuntime({authorityRoot: root, repositoryRoot})));
  const transactionName = fs.readdirSync(path.join(root, "transactions"))[0];
  const transaction = JSON.parse(fs.readFileSync(path.join(root, "transactions", transactionName), "utf8"));
  const decision = transaction.event.payload;
  const records = {
    snapshot: snapshot(),
    decision,
    state: inspected.state,
    persistentRole: inspected.roles[0],
    lease: inspected.lease,
    checkpoint: checkpoint(),
    event: transaction.event,
    transaction,
    meaningfulProgress: checkpoint().meaningful_progress,
  };

  for (const [definitionName, value] of Object.entries(records)) {
    validateSchemaInstance(schema.$defs[definitionName], value, `$defs.${definitionName}`);
    assert.deepEqual([...schema.$defs[definitionName].required].sort(), Object.keys(value).sort(), `${definitionName} required keys drifted from runtime output`);
    assert.equal(scanPersistedRecord(value).safe, true, `${definitionName} record failed privacy scan`);
  }

  const contract = compilePersistentIntentRuntimeContract({
    records: {
      state: transaction.next_state,
      persistent_roles: inspected.roles,
      lease: inspected.lease,
      event: transaction.event,
      checkpoint: checkpoint(),
      transaction,
      decision,
    },
  });
  validatePersistentIntentRuntimeContract(contract);
  validateSchemaInstance(schema, contract, "$contract");
  assert.equal(contract.schema, PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA);
  assert.equal(contract.version, PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION);

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "agentos.persistent_intent_runtime_contract.v1");
  assert.equal(schema.properties.status.const, ACTIVATION_STATUS);
  assert.deepEqual(schema.properties.decisions.items.enum, [...REGULATOR_DECISIONS]);
  assert.equal(schema.properties.authority.properties.sole_state_writer.const, "RUNTIME");
  assert.equal(schema.properties.authority.properties.regulator_mode.const, "GUIDE_ONLY");
  assert.equal(schema.properties.storage.properties.transaction_recovery.const, "PREPARED_TRANSACTION_REPLAY_OR_FAIL_CLOSED");
  assert.equal(schema.properties.activation.properties.protected_actions_enabled.const, false);
  assert.equal(schema.$defs.state.properties.event_cursor.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.$defs.lease.properties.fencing_epoch.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.$defs.event.properties.sequence.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.$defs.event.properties.fencing_epoch.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(decision.interval_minutes, DEFAULT_REVIEW_INTERVAL_MINUTES);

  assert.throws(() => validateSchemaInstance(schema.$defs.state, {...records.state, unexpected: true}), /not allowed/u);
  assert.throws(() => validateSchemaInstance(schema.$defs.event, {...records.event, sequence: Number.MAX_SAFE_INTEGER + 1}), /above maximum/u);
  assert.throws(() => validateSchemaInstance(schema.$defs.lease, {...records.lease, fencing_epoch: Number.MAX_SAFE_INTEGER + 1}), /above maximum/u);
} finally {
  try { runtime?.close({nowUtc: "2026-01-01T00:00:03.000Z"}); } catch { /* prepared fixture cleanup */ }
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS persistent Runtime schema parity: runtime records, contract metadata, privacy, exact keys, and safe-integer bounds verified");
