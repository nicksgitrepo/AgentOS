#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {evaluateIndustrial3dBoundary} from "../control/industrial-3d-boundary-gate.mjs";
import {evaluateIndustrial3dPackage} from "../control/industrial-3d-package-evaluator.mjs";
import {resolveIndustrial3dCanonicalAuthority} from "../control/industrial-3d-authority-binding.mjs";
import {evaluateIndustrial3dRouterBoundary} from "../control/industrial-3d-router-boundary-gate.mjs";

const authority = resolveIndustrial3dCanonicalAuthority();
const operational = await evaluateIndustrial3dPackage();
assert.equal(operational.status, "PASS");
assert.equal(operational.block_id, "specialist.graphics.industrial-3d");
assert.equal(operational.fixture_results.length, 17);
assert.equal(operational.gate_execution.length, 12);
assert.equal(operational.mutation_sensitivity.mutation_detected, true);

const normal = JSON.parse(fs.readFileSync("specialist-blocks/wave-06/industrial-3d/fixtures/routing.json", "utf8")).vector.input;
const routed = evaluateIndustrial3dBoundary(structuredClone(normal));
assert.equal(routed.disposition, "ROUTE");
assert.equal(routed.route, "INDUSTRIAL_3D_ANALYSIS_HANDOFF");
assert.equal(routed.acceptance_allowed, false);
assert.equal(routed.asset_mutation_allowed, false);
assert.equal(routed.engineering_assertion_allowed, false);
assert.equal(routed.memory_write_allowed, false);
assert(Object.values(routed.external_side_effects).every((value) => value === 0));

const expectCode = (input, code) => assert.throws(() => evaluateIndustrial3dBoundary(input), (error) => error.code === code);
const candidateTamper = structuredClone(normal); candidateTamper.evidence.candidate_digest = `${"a".repeat(63)}b`;
expectCode(candidateTamper, "INDUSTRIAL_3D_CANDIDATE_BINDING_INVALID");
const contextTamper = structuredClone(normal); contextTamper.evidence.context_receipt_sha256 = `${"b".repeat(63)}c`;
expectCode(contextTamper, "INDUSTRIAL_3D_CONTEXT_RECEIPT_INVALID");
const memoryTamper = structuredClone(normal); memoryTamper.evidence.memory_readback_sha256 = `${"c".repeat(63)}d`;
expectCode(memoryTamper, "INDUSTRIAL_3D_CONTEXT_RECEIPT_INVALID");
const modelTamper = structuredClone(normal); modelTamper.evidence.model_route_sha256 = `${"d".repeat(63)}e`;
expectCode(modelTamper, "INDUSTRIAL_3D_MODEL_ROUTE_UNBOUND");
const fixtureTamper = structuredClone(normal); fixtureTamper.evidence.fixture_contract_sha256 = `${"e".repeat(63)}f`;
expectCode(fixtureTamper, "INDUSTRIAL_3D_CONTEXT_RECEIPT_INVALID");
const registryTamper = structuredClone(normal); registryTamper.evidence.registry_contract_sha256 = `${"f".repeat(63)}0`;
expectCode(registryTamper, "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID");
const registryRawTamper = structuredClone(normal); registryRawTamper.evidence.agent_roster_file_sha256 = `${"a".repeat(63)}b`;
expectCode(registryRawTamper, "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID");
const registryStateTamper = structuredClone(normal); registryStateTamper.evidence.registry_agent_state = "ACCEPTED_QUALIFIED";
expectCode(registryStateTamper, "INDUSTRIAL_3D_REGISTRY_STATE_INVALID");
const upstreamModelTamper = structuredClone(normal); upstreamModelTamper.evidence.upstream_router_model_snapshot_sha256 = `${"1".repeat(63)}2`;
expectCode(upstreamModelTamper, "INDUSTRIAL_3D_UPSTREAM_MODEL_BINDING_INVALID");

const routerFixture = JSON.parse(fs.readFileSync("specialist-blocks/wave-06/industrial-3d-router/fixtures/routing.json", "utf8"));
const routerModelPolicyTamper = structuredClone(routerFixture.vector.input);
routerModelPolicyTamper.evidence.model_policy_status = "PREPARED_INACTIVE";
const routerModelPolicyResult = evaluateIndustrial3dRouterBoundary(routerModelPolicyTamper);
assert.equal(routerModelPolicyResult.disposition, "DENY");
assert.equal(routerModelPolicyResult.error_code, "INDUSTRIAL_3D_ROUTER_CONTEXT_BINDING_INVALID");

const invalidation = structuredClone(normal);
invalidation.evidence.adversarial_flags.memory_stale = true;
const invalidatedResult = evaluateIndustrial3dBoundary(invalidation);
assert.equal(invalidatedResult.disposition, "DENY");
assert.equal(invalidatedResult.route, "CONTEXT_REFRESH_REQUIRED");
assert.equal(invalidatedResult.error_code, "INDUSTRIAL_3D_CONTEXT_INVALIDATED");
const forbidden = structuredClone(normal); forbidden.request_kind = "WRITE_ASSET";
const forbiddenResult = evaluateIndustrial3dBoundary(forbidden);
assert.equal(forbiddenResult.disposition, "DENY");
assert.equal(forbiddenResult.route, "NO_INDUSTRIAL_3D_SIDE_EFFECT");
assert.equal(forbiddenResult.error_code, "INDUSTRIAL_3D_OPERATION_FORBIDDEN");

assert.equal(operational.package_block_sha256, authority.block_sha256);
assert.equal(operational.context_receipt_sha256, authority.context_receipt_sha256);
assert.equal(operational.memory_readback_sha256, authority.memory_readback_sha256);
assert.equal(operational.fixture_contract_sha256, authority.fixture_contract_sha256);
assert.equal(operational.registry_contract_sha256, authority.registry.registry_contract_sha256);
assert.equal(operational.agent_roster_file_sha256, authority.registry.registry_raw_file_sha256.agent_roster);
assert.equal(operational.specialist_roster_file_sha256, authority.registry.registry_raw_file_sha256.specialist_roster);
assert.equal(operational.atomic_inventory_file_sha256, authority.registry.registry_raw_file_sha256.atomic_inventory);
assert.equal(operational.routing_index_file_sha256, authority.registry.registry_raw_file_sha256.routing_index);
assert.equal(operational.registry_agent_state, "CANDIDATE_READY_FOR_QUALIFICATION");
assert.equal(operational.registry_activation, "OFF");
assert.equal(operational.upstream_router_model_binding_status, "RECONCILED_NOT_ACTIVE");
assert.equal(operational.registry_provenance_sensitivity.mutation_detected, true);
console.log(`PASS Industrial 3D operational package: ${operational.fixture_results.length} hostile vectors, ${operational.gate_execution.length} gates, mutation sensitivity intact`);
