#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateMemoryPackage} from "../control/memory-package-evaluator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "specialist-blocks/wave-01/memory");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "hostile-fixtures.manifest.json"), "utf8"));
assert.equal(manifest.schema, "agentos.memory_hostile_fixture_manifest.v1");
assert.equal(manifest.manifest_sha256, canonicalDigest({...manifest, manifest_sha256: null}));
assert.equal(manifest.entries.length, 17);
for (const entry of manifest.entries) assert.equal(entry.file_sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(packageRoot, entry.path))).digest("hex"));

const evaluation = await evaluateMemoryPackage();
assert.equal(evaluation.schema, "agentos.specialist_memory_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, "specialist.control.memory");
assert.equal(evaluation.lifecycle, "CANDIDATE");
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 17);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert(evaluation.fixture_results.every((entry) => Object.values(entry.external_side_effects).every((value) => value === 0)));
assert(evaluation.focused_suites.every((suite) => suite.status === "PASS"));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Memory package evaluator: all 17 real hostile vectors, eight focused memory suites, isolated stores, privacy mutation sensitivity, and zero external side effects");
