#!/usr/bin/env node

/*
 * Independent, pre-admission Controller hostile evaluator.
 *
 * This harness executes the pure Controller authorization/precondition seam
 * and the real asynchronous entrypoint against sealed evaluator context. The
 * production project store is intentionally inactive, so an otherwise valid
 * operational route records a typed ceiling rather than pretending that state
 * or adapters ran.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {
  applyAndWriteAgentOSControllerEventAsync,
  compileAgentOSControllerState,
  compileControllerRuntimeReadback,
  controllerDigest,
  CONTROLLER_EVENT_TYPES,
  validateControllerEventPreconditions,
} from "./agentos-controller.mjs";
import {compileGlobalPolicyState} from "./global-policy-state.mjs";
import {compileOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {compileControllerWorkflowMonitorTick} from "./controller-workflow-regulator.mjs";
import {materializeTestGlobalGovernanceStore} from "../tests/helpers/global-governance-fixture.mjs";

export const CONTROLLER_HOSTILE_EVALUATION_SCHEMA = "agentos.controller_hostile_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, "specialist-blocks/wave-01/project-controller");
const EVENT_FIXTURE = path.join(ROOT, "tests/fixtures/controller-events/canonical-signed-sequence.v1.json");
const PROVISIONING_CEILING = "CONTROLLER_OPERATIONAL_STORE_INACTIVE";
const CURRENT_MODEL_POLICY_TEST_TIME = new Date().toISOString();

function typedRejection(code, message) { const error = new Error(message); error.code = code; throw error; }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function withControllerEventClock(signed, operation) {
  const previousDateNow = Date.now;
  const eventAuthorityMs = Date.parse(signed.trusted_now_utc);
  const modelPolicyMs = Date.parse(CURRENT_MODEL_POLICY_TEST_TIME);
  let firstAuthorityRead = true;
  Date.now = () => {
    if (firstAuthorityRead) { firstAuthorityRead = false; return eventAuthorityMs; }
    return modelPolicyMs;
  };
  try { return await operation(); } finally { Date.now = previousDateNow; }
}
function sourceDigest(entrypoint) {
  const relative = entrypoint.split("#", 1)[0];
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(`${ROOT}${path.sep}`) || !relative.startsWith("control/")) typedRejection("CONTROLLER_ENTRYPOINT_OUTSIDE_CONTROL", `Controller implementation entrypoint is outside control/: ${entrypoint}`);
  return sha256(fs.readFileSync(file));
}
function gateIsNegative(gate) {
  const reject = (value) => typeof value === "string" && /(?:OUTCOME:(?:DENY|ESCALATE)|DENY|ESCALATE|UNKNOWN_DEPENDENT_ONLY)/u.test(value) && !/(?:CONTINUE|ACCEPT|PASS|ADMIT)/u.test(value);
  return reject(gate.next?.NO) && reject(gate.next?.UNKNOWN) && reject(gate.rules?.ambiguity) && reject(gate.rules?.missing_evidence);
}
function loadGateContracts(packageRoot) {
  const manifest = readJson(path.join(packageRoot, "gates/manifest.json"));
  const entries = manifest.ordered_gate_ids.map((gateId) => {
    const relative = manifest.gate_paths.find((candidate) => candidate.endsWith(`${gateId}.gate`));
    if (!relative) typedRejection("CONTROLLER_GATE_MANIFEST_INCOMPLETE", `Controller gate path is missing: ${gateId}`);
    return {gateId, path: relative, gate: readJson(path.join(packageRoot, relative))};
  });
  return {manifest, entries};
}
function loadFixtureInventory(fixtureManifestPath) {
  const manifest = readJson(fixtureManifestPath);
  if (manifest.schema !== "agentos.controller_hostile_fixture_manifest.v1" || manifest.version !== 1) typedRejection("CONTROLLER_FIXTURE_MANIFEST_IDENTITY_INVALID", "Controller hostile fixture manifest identity differs");
  if (manifest.manifest_sha256 !== canonicalDigest({...manifest, manifest_sha256: null})) typedRejection("CONTROLLER_FIXTURE_MANIFEST_DIGEST_INVALID", "Controller hostile fixture manifest digest differs");
  const ids = new Set(), paths = new Set(), vectors = new Set();
  for (const entry of manifest.entries) {
    if (ids.has(entry.fixture_id) || paths.has(entry.path) || vectors.has(entry.attack_vector)) typedRejection("CONTROLLER_FIXTURE_INVENTORY_ALIAS", "Controller hostile fixture inventory identifiers must be one-to-one");
    ids.add(entry.fixture_id); paths.add(entry.path); vectors.add(entry.attack_vector);
  }
  return manifest;
}
function buildContext(nowUtc, signed) {
  const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-hostile-evaluator-"));
  const global = materializeTestGlobalGovernanceStore({authorityRoot, nowUtc});
  const context = compileOperationalGlobalGovernanceContext({authorityStore: global.authorityStore, roleClass: "CONTROLLER", operationalId: "CONTEXT.CONTROLLER.HOSTILE.EVALUATOR"});
  const projectId = signed.events[0].project_id;
  const policy = compileGlobalPolicyState({projectId, nowUtc: "2026-01-01T00:00:00.000Z"});
  const runtime = compileControllerRuntimeReadback({projectId, controllerRuntimeId: "CONTROLLER-RUNTIME.HOSTILE", runtimeId: "PROJECT-RUNTIME.HOSTILE", environmentIdentity: "CONTROLLER-ENV.HOSTILE", capabilitySetSha256: "a".repeat(64), observedBySession: "CONTROLLER-SESSION.HOSTILE", observedAtUtc: "2026-01-01T00:00:00.000Z"});
  const state = compileAgentOSControllerState({projectId, logicalControllerId: signed.events[0].controller_id, currentSessionId: "CONTROLLER-SESSION.HOSTILE", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: "2026-01-01T00:00:00.000Z"});
  return {authorityRoot, authorityStore: global.authorityStore, context, state, projectId};
}
function stateAtEvent(initial, event) {
  if (event === null || event.sequence <= 1) return initial;
  const state = {...initial, event_cursor: event.sequence - 1, event_ledger_head_sha256: event.prior_controller_head_sha256, state_sha256: null};
  state.state_sha256 = controllerDigest({...state, state_sha256: null});
  return state;
}
function eventFor(fixture, signed) {
  if (fixture.vector.input.signed_controller_event === null) return null;
  const requestedType = fixture.vector.input.event_type;
  const base = signed.events.find((entry) => entry.event_type === requestedType) ?? signed.events[0];
  const event = structuredClone(base);
  if (requestedType && !CONTROLLER_EVENT_TYPES.includes(requestedType)) event.event_type = requestedType;
  switch (fixture.class) {
    case "authority_conflict": event.issuer_id = "ISSUER.CALLER.SUBSTITUTED"; break;
    case "cross_provider_version_claim": event.payload.global_model_policy_projection_sha256 = "b".repeat(64); break;
    case "data_limit": event.project_id = "different-project"; break;
    case "stale_source": event.authority_epoch = 1; break;
    default: break;
  }
  return event;
}
function semanticOutcome(error) {
  if (error === null) return "ROUTE";
  const message = String(error.message);
  return /issuer[^.]*not authorized|authority conflict|caller.?substitut/iu.test(message) ? "ESCALATE" : "DENY";
}
function runMonitorFixture(fixture) {
  const tick = compileControllerWorkflowMonitorTick(fixture.vector.input);
  const actual = tick.status === "MOVING" || tick.status === "FALSE_STALL_REJECTED" ? "ROUTE" : "DENY";
  return {actual, semantic_error: null, adapter_invocation_count: 0, state_change_count: 0, operational_ceiling: null, evidence: {status: tick.status}};
}
async function runEventFixture(fixture, signed) {
  const setup = buildContext(CURRENT_MODEL_POLICY_TEST_TIME, signed);
  const event = eventFor(fixture, signed);
  const state = stateAtEvent(setup.state, event);
  const before = controllerDigest(state);
  let semanticError = null;
  try {
    await withControllerEventClock(signed, () => validateControllerEventPreconditions({state, event, globalGovernanceContext: setup.context, globalGovernanceAuthorityStore: setup.authorityStore}));
  } catch (error) { semanticError = error; }
  const after = controllerDigest(state);
  let adapterCalls = 0;
  const adapters = new Proxy({}, {get: () => async () => { adapterCalls += 1; throw new Error("Controller hostile evaluator adapter must not run"); }});
  let operationalError = null;
  try {
    await withControllerEventClock(signed, () => applyAndWriteAgentOSControllerEventAsync({projectControlStoreCapability: Object.freeze(Object.create(null)), event, adapters, globalGovernanceContext: setup.context, globalGovernanceAuthorityStore: setup.authorityStore}));
  } catch (error) { operationalError = error; }
  fs.rmSync(setup.authorityRoot, {recursive: true, force: true});
  if (!operationalError || operationalError.code !== "CONTROLLER_PROJECT_STORE_PROVISIONING_REQUIRED") typedRejection("CONTROLLER_OPERATIONAL_CEILING_UNPROVEN", `Controller event did not stop at its typed inactive-store ceiling: ${fixture.class}`);
  return {actual: semanticOutcome(semanticError), semantic_error: semanticError === null ? null : semanticError, adapter_invocation_count: adapterCalls, state_change_count: before === after ? 0 : 1, operational_ceiling: PROVISIONING_CEILING, evidence: {semantic_precondition_rejected: semanticError !== null, async_entrypoint_ceiling: operationalError.code}};
}
function resultFor(fixture, execution) {
  const error = execution.semantic_error;
  const errorCode = error === null ? null : error.code ?? "CONTROLLER_SEMANTIC_REJECTION";
  const messageHash = error === null ? null : canonicalDigest({attack_vector: fixture.attack_vector, error_code: errorCode, message: String(error.message)});
  return {
    fixture_id: fixture.fixture_id,
    fixture_class: fixture.class,
    attack_vector: fixture.attack_vector,
    gate_id: fixture.gate_id,
    expected_outcome: fixture.expected,
    actual_outcome: execution.actual,
    implementation_entrypoint: fixture.operational_entrypoint,
    implementation_file_sha256: sourceDigest(fixture.operational_entrypoint),
    semantic_rejection: error !== null,
    operational_ceiling: execution.operational_ceiling,
    adapter_invocation_count: execution.adapter_invocation_count,
    state_change_count: execution.state_change_count,
    negative_assertion_count: fixture.required_assertions.length,
    error_code: errorCode,
    error_message_sha256: messageHash,
    result: "PENDING",
  };
}
export function auditControllerGateWeakeningAtUntrustedRoot({authorityRoot} = {}) {
  const packageRoot = path.join(authorityRoot, "specialist-blocks/wave-01/project-controller");
  const {entries} = loadGateContracts(packageRoot);
  const weakened = entries.filter(({gate}) => !gateIsNegative(gate)).map(({gateId}) => gateId).sort();
  return Object.freeze({status: weakened.length === 0 ? "INTACT" : "WEAKENED", weakened_gate_ids: weakened, gate_count: entries.length, mutation_detected: weakened.length > 0});
}
export async function evaluateCanonicalControllerHostileFixtures({fixtureManifestPath = path.join(PACKAGE_ROOT, "hostile-fixtures.manifest.json")} = {}) {
  const manifest = loadFixtureInventory(fixtureManifestPath);
  const signed = readJson(EVENT_FIXTURE);
  const results = [];
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(CURRENT_MODEL_POLICY_TEST_TIME);
  try {
   for (const entry of manifest.entries) {
    const fixturePath = path.resolve(path.dirname(fixtureManifestPath), entry.path);
    const bytes = fs.readFileSync(fixturePath);
    if (sha256(bytes) !== entry.file_sha256) typedRejection("CONTROLLER_FIXTURE_FILE_DIGEST_INVALID", `Controller fixture bytes differ: ${entry.fixture_id}`);
    const fixture = JSON.parse(bytes);
    if (fixture.fixture_id !== entry.fixture_id || fixture.class !== entry.class || fixture.attack_vector !== entry.attack_vector || fixture.expected !== entry.expected_outcome || fixture.input_class !== "HOSTILE_NEGATIVE") typedRejection("CONTROLLER_FIXTURE_BINDING_INVALID", `Controller fixture binding differs: ${entry.fixture_id}`);
    if (!Array.isArray(fixture.setup) || !fixture.setup.includes("SEALED_CANONICAL_TEST_AUTHORITY") || !fixture.setup.includes("NO_PRODUCTION_STORE_PROVISION") || fixture.canonical_input?.vector_ref !== fixture.attack_vector || !Array.isArray(fixture.required_assertions) || !fixture.required_assertions.includes("NO_ADAPTER_INVOCATION") || !fixture.required_assertions.includes("NO_CONTROLLER_STATE_CHANGE") || !Array.isArray(fixture.cleanup)) typedRejection("CONTROLLER_FIXTURE_CONTRACT_INCOMPLETE", `Controller fixture operational contract is incomplete: ${entry.fixture_id}`);
    const execution = fixture.vector.entrypoint === "compileControllerWorkflowMonitorTick" ? runMonitorFixture(fixture) : await runEventFixture(fixture, signed);
    results.push(resultFor(fixture, execution));
   }
  } finally {
   Date.now = originalDateNow;
  }
  results.sort((left, right) => Buffer.compare(Buffer.from(left.fixture_id), Buffer.from(right.fixture_id)));
  const mutation = auditControllerGateWeakeningAtUntrustedRoot({authorityRoot: ROOT});
  const implementationModules = [...new Map(results.map((entry) => [entry.implementation_entrypoint.split("#", 1)[0], {entrypoint: entry.implementation_entrypoint.split("#", 1)[0], file_sha256: entry.implementation_file_sha256}])).values()];
  const evaluation = {schema: CONTROLLER_HOSTILE_EVALUATION_SCHEMA, version: 1, candidate_package_file_sha256: sha256(fs.readFileSync(path.join(PACKAGE_ROOT, "block.json"))), fixture_manifest_sha256: manifest.manifest_sha256, implementation_modules: implementationModules, result_count: results.length, negative_assertion_count: results.reduce((sum, entry) => sum + entry.negative_assertion_count, 0), mutation_sensitivity: mutation, operational_ceiling: PROVISIONING_CEILING, results, status: "PENDING", evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateCanonicalControllerHostileFixtures())}\n`);
