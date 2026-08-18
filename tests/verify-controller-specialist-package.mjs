#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {validateGatePack, validateSourceLock, validateSpecialistBlock} from "../control/specialist-block-compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "specialist-blocks", "wave-01", "project-controller");
const read = (name) => JSON.parse(fs.readFileSync(path.join(packageDir, name), "utf8"));

const block = validateSpecialistBlock(read("block.json"));
validateSourceLock(read("sources.lock"), block.block_id);
validateGatePack(packageDir, block);

assert.equal(block.atomic_scope_statement.includes("AGENTOS_CONTROLLER"), true);
assert.equal(block.atomic_scope_statement.includes("AGENTOS.PRODUCT_OWNER owns intent"), true);
assert.equal(block.prepared_status, "PREPARED_INACTIVE");
assert.equal(block.lifecycle, "CANDIDATE");
assert.equal(block.activation, "OFF");
assert.match(block.purpose, /fifteen minutes/u);
assert.match(block.maximum_authority, /SIGNED_ONE_SPAWNER_OPERATIONS_ONLY/u);
for (const denied of ["campaign", "phase", "task", "despawn", "deploy", "memory", "human-facing"]) {
  assert(block.forbidden_decisions.some((value) => value.toLowerCase().includes(denied)), `${denied} authority must be denied`);
}

const evaluation = read("evaluation.json");
assert.equal(evaluation.receipt_id, "specialist-eval.project-controller.v2");
assert.equal(evaluation.candidate_digest, block.block_sha256);
assert.equal(evaluation.disposition, "UTILITY_HARM_PENDING");
assert.deepEqual(evaluation.results, {passed: 0, failed: 0, pending: 17});
assert.equal(evaluation.model_requirement, "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE");

const fixtureManifest = read("hostile-fixtures.manifest.json");
assert.equal(fixtureManifest.schema, "agentos.controller_hostile_fixture_manifest.v1");
assert.equal(fixtureManifest.entries.length, 17);
assert.equal(fixtureManifest.manifest_sha256, (await import("../control/content-addressing.mjs")).canonicalDigest({...fixtureManifest, manifest_sha256: null}));

const publicEntrypoints = new Map([
  ["applyAndWriteAgentOSControllerEventAsync", {file: "control/agentos-controller.mjs", declaration: /export async function applyAndWriteAgentOSControllerEventAsync/u}],
  ["compileControllerWorkflowMonitorTick", {file: "control/controller-workflow-regulator.mjs", declaration: /export function compileControllerWorkflowMonitorTick/u}],
]);
const fixtureNames = fs.readdirSync(path.join(packageDir, "fixtures")).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureNames.length, 17);
assert.equal(new Set(fixtureNames).size, 17);
for (const fixtureName of fixtureNames) {
  const fixture = read(path.join("fixtures", fixtureName));
  assert.equal(fixture.block_id, block.block_id);
  assert.equal(fixture.hostile, true);
  const entrypoint = publicEntrypoints.get(fixture.vector.entrypoint);
  assert(entrypoint, `${fixtureName} does not name an allowed operational entrypoint`);
  assert.match(fs.readFileSync(path.join(root, entrypoint.file), "utf8"), entrypoint.declaration, `${fixtureName} entrypoint is not public in production code`);
  assert(Object.keys(fixture.vector.input).length > 0, `${fixtureName} lacks hostile input`);
  assert(fixture.vector.assertions.length >= 3, `${fixtureName} lacks side-effect assertions`);
  assert(fixture.vector.assertions.some((value) => /zero|remains zero|no adapter/iu.test(value)), `${fixtureName} lacks a zero-adapter assertion`);
  assert(evaluation.cases.some((item) => item.class === fixture.class && item.expected === fixture.expected && item.observed === "PENDING"));
  const manifestEntry = fixtureManifest.entries.find((entry) => entry.fixture_id === fixture.fixture_id);
  assert(manifestEntry, `${fixtureName} is absent from the hostile fixture manifest`);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(packageDir, "fixtures", fixtureName))).digest("hex"), manifestEntry.file_sha256);
  assert.equal(fixture.operational_entrypoint, fixture.vector.entrypoint === "compileControllerWorkflowMonitorTick" ? "control/controller-workflow-regulator.mjs#compileControllerWorkflowMonitorTick" : "control/agentos-controller.mjs#validateControllerEventPreconditions");
  assert(fixture.setup.includes("SEALED_CANONICAL_TEST_AUTHORITY") && fixture.setup.includes("NO_PRODUCTION_STORE_PROVISION"));
  assert(fixture.required_assertions.includes("NO_ADAPTER_INVOCATION") && fixture.required_assertions.includes("NO_CONTROLLER_STATE_CHANGE"));
}

console.log("PASS Controller specialist package: prepared inactive, workflow-only, Product Owner separated, 15-minute progress-bound, signed-one-Spawner-only, and operational-hostile-review pending");
