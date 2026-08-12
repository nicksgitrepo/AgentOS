#!/usr/bin/env node

/*
 * Read-only evaluator for specialist-library candidate packages.  This is a
 * separate verification path from the controller compiler: it produces an
 * independent static receipt in memory and never admits, activates, or writes
 * a package.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {ATOMIC_EVALUATION_CLASSES, CORE_EVALUATION_CLASSES, GATE_OUTCOMES, SPECIALIST_GATE_IDS} from "./specialist-block-compiler.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GATE_SCHEMA = "agentos.specialist_gate.v1";
const BLOCK_SCHEMA = "agentos.specialist_block.v1";
const EVALUATION_SCHEMA = "agentos.specialist_evaluation.v1";
const HANDOFF_SCHEMA = "agentos.specialist_handoff.v1";

function fail(message) {
  throw new Error(`INDEPENDENT_EVALUATION_FAILED: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) fail(`${filePath} is missing`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${filePath} is invalid JSON: ${error.message}`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not a lowercase SHA-256`);
}

function assertSortedUnique(values, label) {
  if (!Array.isArray(values)) fail(`${label} is not an array`);
  const sorted = [...values].sort();
  if (JSON.stringify(values) !== JSON.stringify(sorted) || new Set(values).size !== values.length) fail(`${label} is not sorted and unique`);
}

function evaluatePackage(packageDir) {
  const block = readJson(path.join(packageDir, "block.json"));
  if (block.schema !== BLOCK_SCHEMA || block.version !== 1) fail(`${block.block_id} block schema mismatch`);
  if (block.activation !== "OFF" || block.lifecycle === "ADMITTED") fail(`${block.block_id} is active or self-admitted`);
  assertDigest(block.block_sha256, `${block.block_id}.block_sha256`);
  if (block.block_sha256 !== digest({...block, block_sha256: null})) fail(`${block.block_id} block digest mismatch`);
  if (!String(block.maximum_authority).includes("NO_PRODUCT") || !String(block.maximum_authority).includes("NO_SELF_ACCEPTANCE")) fail(`${block.block_id} authority ceiling is not closed`);
  if (block.controls?.deploy !== "DENY" || block.controls?.secrets !== "DENY") fail(`${block.block_id} grants deploy or secret capability`);
  if (block.controls?.acceptance_authority !== "INDEPENDENT_AUTHORITY_ONLY") fail(`${block.block_id} acceptance authority is not independent`);
  const sourceLock = readJson(path.join(packageDir, "sources.lock"));
  if (sourceLock.block_id !== block.block_id || !Array.isArray(sourceLock.sources) || sourceLock.sources.length === 0) fail(`${block.block_id} source lock is incomplete`);
  assertDigest(sourceLock.manifest_sha256, `${block.block_id}.manifest_sha256`);
  if (sourceLock.manifest_sha256 !== digest({...sourceLock, manifest_sha256: null})) fail(`${block.block_id} source lock digest mismatch`);
  for (const source of sourceLock.sources) {
    if (!source.source_id || !source.publisher || !source.version || !source.retrieved_date || !source.immutable_identity) fail(`${block.block_id} source lacks identity/freshness fields`);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(source.retrieved_date)) fail(`${block.block_id} source retrieved date is invalid`);
  }
  const gatesDir = path.join(packageDir, "gates");
  const gateFiles = fs.readdirSync(gatesDir).filter((name) => name.endsWith(".gate")).sort();
  if (JSON.stringify(gateFiles) !== JSON.stringify(SPECIALIST_GATE_IDS.map((id) => `${id}.gate`))) fail(`${block.block_id} does not carry exactly twelve gate files`);
  for (const gateId of SPECIALIST_GATE_IDS) {
    const gate = readJson(path.join(gatesDir, `${gateId}.gate`));
    if (gate.schema !== GATE_SCHEMA || gate.block_id !== block.block_id || gate.gate_id !== gateId || gate.answer_type !== "FOUR_VALUED") fail(`${block.block_id} ${gateId} contract mismatch`);
    if (JSON.stringify(gate.allowed_outcomes) !== JSON.stringify(GATE_OUTCOMES)) fail(`${block.block_id} ${gateId} outcomes mismatch`);
    assertDigest(gate.gate_sha256, `${block.block_id} ${gateId}.gate_sha256`);
    if (gate.gate_sha256 !== digest({...gate, gate_sha256: null})) fail(`${block.block_id} ${gateId} digest mismatch`);
  }
  const evaluation = readJson(path.join(packageDir, "evaluation.json"));
  if (evaluation.schema !== EVALUATION_SCHEMA || evaluation.block_id !== block.block_id || evaluation.candidate_digest !== block.block_sha256) fail(`${block.block_id} evaluation is not bound to the candidate`);
  const expectedClasses = [...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES].sort();
  const observedClasses = [...new Set((evaluation.cases ?? []).map((item) => item.class))].sort();
  if (JSON.stringify(observedClasses) !== JSON.stringify(expectedClasses)) fail(`${block.block_id} evaluation fixture classes are incomplete`);
  if (evaluation.independence_rule !== "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION") fail(`${block.block_id} evaluation does not require independent review`);
  const fixturesDir = path.join(packageDir, "fixtures");
  const fixtureNames = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  if (JSON.stringify(fixtureNames) !== JSON.stringify(expectedClasses)) fail(`${block.block_id} hostile fixture set is incomplete`);
  const handoff = readJson(path.join(packageDir, "handoff.json"));
  if (handoff.schema !== HANDOFF_SCHEMA || handoff.block_id !== block.block_id || handoff.candidate_digest !== block.block_sha256) fail(`${block.block_id} handoff is not bound to the candidate`);
  if (handoff.authority !== "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION") fail(`${block.block_id} handoff grants admission authority`);
  assertSortedUnique(block.dependencies, `${block.block_id}.dependencies`);
  assertSortedUnique(block.conflicts, `${block.block_id}.conflicts`);
  return {block_id: block.block_id, role_kind: block.role_kind, candidate_digest: block.block_sha256, status: "PASS", checked_gate_count: SPECIALIST_GATE_IDS.length, checked_fixture_count: expectedClasses.length, independent_utility_harm: "PENDING_EXTERNAL_AUTHORITY"};
}

function packageDirectories(libraryRoot) {
  const directories = [];
  for (const rootName of ["foundation", "wave-01", "wave-02"]) {
    const root = path.join(libraryRoot, rootName);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, {withFileTypes: true}).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const packageDir = path.join(root, entry.name);
      if (fs.existsSync(path.join(packageDir, "block.json"))) directories.push(packageDir);
    }
  }
  return directories;
}

export function independentlyEvaluateSpecialistLibrary({repositoryRoot = process.cwd()} = {}) {
  const libraryRoot = path.join(repositoryRoot, "specialist-blocks");
  const roster = readJson(path.join(libraryRoot, "registry", "roster.v1.json"));
  if (roster.status !== "COMPILED_CANDIDATE" || roster.activation !== "OFF") fail("roster is active or not a candidate");
  const packageDirs = packageDirectories(libraryRoot);
  const results = packageDirs.map(evaluatePackage).sort((left, right) => left.block_id.localeCompare(right.block_id));
  const rosterIds = new Set(roster.blocks.map((block) => block.block_id));
  for (const result of results) if (!rosterIds.has(result.block_id)) fail(`${result.block_id} is absent from the roster`);
  if (results.length !== roster.blocks.length) fail("roster/package count mismatch");
  return {
    schema: "agentos.independent_specialist_evaluation_receipt.v1",
    version: 1,
    evaluator_id: "agentos.independent-specialist-evaluator",
    evaluator_version: "1.0.0",
    candidate_roster_digest: roster.roster_sha256,
    status: "STATIC_PASS_REVIEW_REQUIRED",
    independent_reviewer_required: true,
    self_acceptance: "FORBIDDEN",
    packages_checked: results.length,
    gate_files_checked: results.reduce((total, result) => total + result.checked_gate_count, 0),
    hostile_fixtures_checked: results.reduce((total, result) => total + result.checked_fixture_count, 0),
    results,
    utility_harm: "PENDING_EXTERNAL_AUTHORITY",
    residuals: ["Independent utility/harm review has not passed.", "Admission and activation remain OFF.", "This receipt does not authorize integration, deployment, consumer adoption, or release."],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(independentlyEvaluateSpecialistLibrary({repositoryRoot: process.cwd()}), null, 2)}\n`);
}
