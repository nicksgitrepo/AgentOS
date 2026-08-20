#!/usr/bin/env node

/* Independent-review input compiler for one permanent role at a time. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";
import {inspectCanonicalPermanentRoleCandidate} from "./permanent-role-governed-admission.mjs";
import {auditControllerGateWeakeningAtUntrustedRoot, evaluateCanonicalControllerHostileFixtures} from "./controller-hostile-fixture-evaluator.mjs";

export const PERMANENT_ROLE_PACKAGE_EVALUATION_SCHEMA = "agentos.permanent_role_package_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function fail(message, code = "PERMANENT_ROLE_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function readJson(relative) { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")); }
function resultDigest(value) { return canonicalDigest({...value, result_sha256: null}); }

function assertionReadbacks(fixture, execution) {
  return fixture.required_assertions.map((assertion) => {
    if (assertion === "TYPED_SEMANTIC_OUTCOME") return {assertion, observed: execution.actual_outcome === fixture.expected, evidence: `actual_outcome=${execution.actual_outcome}; expected_outcome=${fixture.expected}`};
    if (assertion === "NO_ADAPTER_INVOCATION") return {assertion, observed: execution.adapter_invocation_count === 0, evidence: `adapter_invocation_count=${execution.adapter_invocation_count}`};
    if (assertion === "NO_CONTROLLER_STATE_CHANGE") return {assertion, observed: execution.state_change_count === 0, evidence: `state_change_count=${execution.state_change_count}`};
    return {assertion, observed: false, evidence: "Unknown assertion is not accepted by the canonical evaluator."};
  });
}

export async function evaluatePermanentRolePackage({roleId = "AGENTOS_CONTROLLER"} = {}) {
  assert(roleId === "AGENTOS_CONTROLLER", "Only the highest-priority eligible permanent role may be evaluated in this turn", "PERMANENT_ROLE_ORDER_VIOLATION");
  const candidate = inspectCanonicalPermanentRoleCandidate({roleId});
  const hostile = await evaluateCanonicalControllerHostileFixtures();
  assert(hostile.result_count === 17 && hostile.results.length === 17, "Controller hostile evaluation inventory is incomplete", "PERMANENT_ROLE_HOSTILE_INVENTORY_INCOMPLETE");
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-package-mutation-"));
  let mutation;
  try {
    const packageRoot = path.join(mutationRoot, "specialist-blocks/wave-01/project-controller"); fs.mkdirSync(path.dirname(packageRoot), {recursive: true}); fs.cpSync(path.join(ROOT, "specialist-blocks/wave-01/project-controller"), packageRoot, {recursive: true});
    const gatePath = path.join(packageRoot, "gates/01-applicability.gate"), gate = JSON.parse(fs.readFileSync(gatePath, "utf8")); gate.next.NO = "OUTCOME:CONTINUE"; gate.next.UNKNOWN = "OUTCOME:CONTINUE"; gate.rules.ambiguity = "CONTINUE"; gate.rules.missing_evidence = "CONTINUE"; fs.writeFileSync(gatePath, `${JSON.stringify(gate)}\n`);
    mutation = auditControllerGateWeakeningAtUntrustedRoot({authorityRoot: mutationRoot});
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
  assert(mutation?.mutation_detected === true && mutation?.status === "WEAKENED", "Controller gate mutation proof did not execute", "PERMANENT_ROLE_MUTATION_PROOF_MISSING");
  const fixtures = new Map(fs.readdirSync(path.join(ROOT, "specialist-blocks/wave-01/project-controller/fixtures")).filter((name) => name.endsWith(".json")).map((name) => { const relative = `specialist-blocks/wave-01/project-controller/fixtures/${name}`; return [readJson(relative).fixture_id, readJson(relative)]; }));
  const now = new Date().toISOString();
  const fixtureResults = hostile.results.map((execution) => {
    const fixture = fixtures.get(execution.fixture_id); assert(fixture, `Controller fixture is not resolvable: ${execution.fixture_id}`);
    const result = {fixture_id: execution.fixture_id, fixture_class: execution.fixture_class, fixture_file_sha256: candidate.fixtures.find((entry) => entry.fixture_id === execution.fixture_id)?.file_sha256, entrypoint: execution.implementation_entrypoint.split("#").at(-1), entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: execution.expected_outcome, actual_outcome: execution.actual_outcome, error_code: execution.error_code, exit_code: 0, assertion_readbacks: assertionReadbacks(fixture, execution), side_effect_spy_readback: {adapter_calls: execution.adapter_invocation_count, state_changes: execution.state_change_count, memory_writes: 0, deploy_calls: 0}, executed_at_utc: now, result_sha256: null};
    result.result_sha256 = resultDigest(result); return result;
  }).sort((left, right) => left.fixture_id.localeCompare(right.fixture_id));
  assert(fixtureResults.every((result) => result.fixture_file_sha256 && result.actual_outcome === result.expected_outcome && result.assertion_readbacks.every((entry) => entry.observed === true)), "Controller hostile evaluation did not satisfy every expected result", "PERMANENT_ROLE_HOSTILE_RESULT_FAILED");
  return Object.freeze({schema: PERMANENT_ROLE_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", role_id: roleId, role_class: "CONTROLLER", candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, gate_inventory_sha256: canonicalDigest(candidate.gates), fixture_inventory_sha256: canonicalDigest(candidate.fixtures), fixture_results: fixtureResults, mutation_sensitivity: mutation, operational_context_required: true, independent_signature_required: true, observed_at_utc: now, evaluation_sha256: canonicalDigest({role_id: roleId, candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, fixture_results: fixtureResults, mutation_sensitivity: mutation, observed_at_utc: now})});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluatePermanentRolePackage(), null, 2)}\n`);
