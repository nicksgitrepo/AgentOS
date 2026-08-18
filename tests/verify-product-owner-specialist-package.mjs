#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {validateGatePack, validateSourceLock, validateSpecialistBlock} from "../control/specialist-block-compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "specialist-blocks", "wave-01", "product-owner");
const read = (name) => JSON.parse(fs.readFileSync(path.join(packageDir, name), "utf8"));
const operationalSource = fs.readFileSync(path.join(root, "control", "product-owner-operational.mjs"), "utf8");
const boundarySource = fs.readFileSync(path.join(root, "control", "product-owner-boundary-gate.mjs"), "utf8");

const block = validateSpecialistBlock(read("block.json"));
validateSourceLock(read("sources.lock"), block.block_id);
validateGatePack(packageDir, block);

assert.equal(block.block_id, "specialist.control.product-owner");
assert.equal(block.lifecycle, "CANDIDATE");
assert.equal(block.activation, "OFF");
assert.equal(block.prepared_status, "PREPARED_INACTIVE");
assert.match(block.atomic_scope_statement, /AGENTOS\.PRODUCT_OWNER/u);
assert.match(block.purpose, /fifteen minutes/u);
assert(block.scope.included.some((value) => /simple language/u.test(value)));
assert(block.controls.write.every((value) => !/memory/iu.test(value)));
for (const denied of ["spawn", "despawn", "workflow", "deploy", "memory"]) {
  assert(block.forbidden_decisions.some((value) => value.toLowerCase().includes(denied)), `${denied} authority must be denied`);
}

const evaluation = read("evaluation.json");
assert.equal(evaluation.candidate_digest, block.block_sha256);
assert.equal(evaluation.disposition, "UTILITY_HARM_PENDING");
assert.deepEqual(evaluation.results, {passed: 0, failed: 0, pending: 17});
assert.equal(evaluation.model_requirement, "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE");

const fixtureNames = fs.readdirSync(path.join(packageDir, "fixtures")).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureNames.length, 17);
assert.equal(new Set(fixtureNames).size, 17);
for (const fixtureName of fixtureNames) {
  const fixture = read(path.join("fixtures", fixtureName));
  assert.equal(fixture.block_id, block.block_id);
  assert.equal(fixture.hostile, true);
  assert.equal(fixture.vector.entrypoint, "evaluateProductOwnerBoundary");
  assert.match(operationalSource, /export function runProductOwnerOperationalRequest/u);
  assert.match(operationalSource, /evaluateProductOwnerBoundary/u);
  assert.match(boundarySource, /export function evaluateProductOwnerBoundary/u);
  assert(Object.keys(fixture.vector.input).length > 0, `${fixtureName} lacks hostile input`);
  assert.equal(fixture.vector.input.schema, "agentos.product_owner_boundary_input.v1");
  assert.equal(fixture.vector.expected_readback.all_side_effect_counts, 0);
  assert(evaluation.cases.some((item) => item.class === fixture.class && item.expected === fixture.expected && item.observed === "PENDING"));
}

const routingFixture = read("fixtures/routing.json");
assert.equal(routingFixture.vector.input.request_kind, "SIMPLE_EXPLANATION");
assert.equal(routingFixture.vector.expected_readback.disposition, "ALLOW_CONVERSATION");

const selfAcceptance = read("fixtures/router_self_accept.json");
assert.equal(selfAcceptance.expected, "DENY");
assert.equal(selfAcceptance.vector.input.request_kind, "SELF_REVIEW");
assert.equal(selfAcceptance.vector.expected_readback.route, "INDEPENDENT_EVALUATOR");

console.log("PASS Product Owner specialist package: prepared inactive, intent-only, simple human conversation, model-policy-bound, independent-review-required, and operational-hostile-vector-ready");
