#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileReusableAgentRoster} from "../control/reusable-agent-roster-compiler.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const packageRelative = "specialist-blocks/control-plane/agent-spawner";
const manifestRelative = `${packageRelative}/gates/manifest.json`;

const current = compileReusableAgentRoster({repositoryRoot: root, writeGenerated: false});
const currentSpawner = current.entries.find((entry) => entry.stable_agent_id === "AGENTOS.SPAWNER");
assert(currentSpawner, "canonical Spawner roster entry is missing");
assert.equal(currentSpawner.deterministic_gates.status, "BOUND");
assert.equal(currentSpawner.deterministic_gates.gates.length, 9);
assert.deepEqual(currentSpawner.deterministic_gates.gates.map((gate) => gate.gate_id), [
  "SPAWNER.OWNERSHIP_CLASSIFICATION",
  "SPAWNER.AUTHORITY_SEPARATION",
  "SPAWNER.EXACT_BLOCK_QA",
  "SPAWNER.SEED_INERTNESS",
  "SPAWNER.ECO_MODEL_POLICY",
  "SPAWNER.GLOBAL_MEMORY",
  "SPAWNER.TURN_CONTINUATION",
  "SPAWNER.GIT_INTEGRATION",
  "SPAWNER.FEATURE_IMPLEMENTATION_LOOP",
]);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-roster-gate-regression-"));
try {
  fs.cpSync(path.join(root, packageRelative), path.join(temporaryRoot, packageRelative), {recursive: true});
  fs.mkdirSync(path.join(temporaryRoot, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temporaryRoot, "fixtures/model-policy-snapshot.initial.v1.json"));

  const manifestPath = path.join(temporaryRoot, manifestRelative);
  const partial = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  partial.entries.pop();
  partial.manifest_sha256 = canonicalDigest({...partial, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(partial)}\n`);
  const partialRoster = compileReusableAgentRoster({repositoryRoot: temporaryRoot, writeGenerated: false});
  const partialSpawner = partialRoster.entries.find((entry) => entry.stable_agent_id === "AGENTOS.SPAWNER");
  assert.equal(partialSpawner.deterministic_gates.status, "INCOMPLETE");

  const escaped = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const canonical = JSON.parse(fs.readFileSync(path.join(root, manifestRelative), "utf8"));
  escaped.entries = canonical.entries.map((entry) => ({...entry}));
  escaped.entries[0].path = "../outside.gate";
  escaped.manifest_sha256 = canonicalDigest({...escaped, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(escaped)}\n`);
  const escapedRoster = compileReusableAgentRoster({repositoryRoot: temporaryRoot, writeGenerated: false});
  const escapedSpawner = escapedRoster.entries.find((entry) => entry.stable_agent_id === "AGENTOS.SPAWNER");
  assert.equal(escapedSpawner.deterministic_gates.status, "INCOMPLETE");
  assert(escapedSpawner.deterministic_gates.gates.every((gate) => !gate.path.includes("..")));
} finally {
  fs.rmSync(temporaryRoot, {recursive: true, force: true});
}

console.log("PASS reusable roster gate regression: canonical Spawner entries bind, partial manifests stay incomplete, and path escapes stay unbound");
