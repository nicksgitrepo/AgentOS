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
  if (block.role_kind === "STANDARD_BLOCK") {
    if (block.normalized_requirements_path !== "requirements.json") fail(`${block.block_id} normalized requirements path is missing`);
    for (const field of ["source_manifest_sha256", "normalized_requirements_sha256", "compatibility_sha256", "supersession_sha256"]) assertDigest(block[field], `${block.block_id}.${field}`);
    if (block.source_manifest_sha256 !== sourceLock.manifest_sha256) fail(`${block.block_id} source manifest is not bound to block`);
    const lockedSource = sourceLock.sources.find((source) => source.version === block.reuse.standard_identity.edition);
    if (!lockedSource || lockedSource.publisher !== block.reuse.standard_identity.publisher) fail(`${block.block_id} source publisher/edition does not match the standard identity`);
    if (!("effective_date" in lockedSource)) fail(`${block.block_id} source lock omits effective-date status`);
    const requirements = readJson(path.join(packageDir, "requirements.json"));
    if (requirements.schema !== "agentos.specialist_standard_requirements.v1" || requirements.version !== 1 || requirements.block_id !== block.block_id) fail(`${block.block_id} normalized requirements contract is invalid`);
    if (block.normalized_requirements_sha256 !== digest(requirements)) fail(`${block.block_id} normalized requirements digest mismatch`);
    if (!Array.isArray(requirements.requirements) || requirements.requirements.length === 0) fail(`${block.block_id} normalized requirements are empty`);
    const requirementIds = requirements.requirements.map((item) => item.requirement_id);
    if (requirementIds.some((item) => typeof item !== "string" || item.length === 0) || new Set(requirementIds).size !== requirementIds.length) fail(`${block.block_id} normalized requirement IDs are invalid`);
    if (JSON.stringify(requirements.standard_identity) !== JSON.stringify(block.reuse.standard_identity)) fail(`${block.block_id} normalized standard identity mismatch`);
    const compatibility = readJson(path.join(packageDir, block.reuse.compatibility_map_path));
    if (compatibility.schema !== "agentos.specialist_standard_compatibility.v1" || compatibility.version !== 1 || compatibility.block_id !== block.block_id) fail(`${block.block_id} compatibility map contract is invalid`);
    if (block.compatibility_sha256 !== digest(compatibility)) fail(`${block.block_id} compatibility digest mismatch`);
    const supersession = readJson(path.join(packageDir, block.reuse.supersession_path));
    if (supersession.schema !== "agentos.specialist_standard_supersession.v1" || supersession.version !== 1 || supersession.block_id !== block.block_id) fail(`${block.block_id} supersession map contract is invalid`);
    if (block.supersession_sha256 !== digest(supersession)) fail(`${block.block_id} supersession digest mismatch`);
    if (supersession.status !== block.supersession_status || !Array.isArray(supersession.known_non_superseding)) fail(`${block.block_id} supersession status is not bound to the block`);
    if (block.reuse.applicability_overlay !== "EXTERNAL_TYPED_COMPANION_ONLY") fail(`${block.block_id} stores applicability in the reusable block`);
    if (block.forbidden_decisions.some((decision) => /certif|legal/iu.test(decision)) === false) fail(`${block.block_id} standard authority ceiling lacks certification/legal denial`);
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
  if (!Array.isArray(block.dependencies) || [...block.dependencies].sort().join("\u0000") !== block.dependencies.join("\u0000")) fail(`${block.block_id} dependencies are not sorted`);
  if (!Array.isArray(block.sibling_conflicts) || [...block.sibling_conflicts].sort().join("\u0000") !== block.sibling_conflicts.join("\u0000")) fail(`${block.block_id} sibling conflicts are not sorted`);
  if (block.role_kind === "ROUTER" && block.permitted_decisions.some((decision) => /(?:write|accept|admit|deploy|publish)/iu.test(decision))) fail(`${block.block_id} router has Product or acceptance authority`);
  if (block.role_kind === "ATOMIC_SPECIALIST") {
    if (typeof block.required_upstream_router !== "string" || block.required_upstream_router.length === 0) fail(`${block.block_id} atomic specialist lacks upstream router`);
    if (!block.forbidden_decisions.some((decision) => /(?:broaden|sibling|family|provider|version)/iu.test(decision))) fail(`${block.block_id} atomic specialist lacks anti-broadening denial`);
  }
  return {block_id: block.block_id, role_kind: block.role_kind, candidate_digest: block.block_sha256, dependencies: block.dependencies, required_upstream_router: block.required_upstream_router, sibling_conflicts: block.sibling_conflicts, candidate_standard_dependencies: block.dependencies.filter((dependency) => dependency.startsWith("specialist.standard.")), status: "PASS", checked_gate_count: SPECIALIST_GATE_IDS.length, checked_fixture_count: expectedClasses.length, independent_utility_harm: "PENDING_EXTERNAL_AUTHORITY"};
}

function packageDirectories(libraryRoot) {
  const directories = [];
  for (const rootName of ["foundation", "standards", "wave-01", "wave-02", "wave-03", "wave-04", "wave-05", "wave-06"]) {
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
  const byId = new Map(results.map((result) => [result.block_id, result]));
  for (const result of results) {
    for (const dependency of result.dependencies) {
      if (!byId.has(dependency)) fail(`${result.block_id} depends on missing package ${dependency}`);
    }
    if (result.role_kind === "ATOMIC_SPECIALIST") {
      const upstream = byId.get(result.required_upstream_router);
      if (!upstream || upstream.role_kind !== "ROUTER") fail(`${result.block_id} upstream router closure is invalid`);
      if (!result.dependencies.includes(result.required_upstream_router)) fail(`${result.block_id} does not declare its upstream router as a dependency`);
      if (result.sibling_conflicts.some((conflict) => byId.has(conflict))) fail(`${result.block_id} has an admitted sibling conflict in the candidate closure`);
    }
    for (const dependency of result.candidate_standard_dependencies) {
      if (byId.get(dependency)?.role_kind !== "STANDARD_BLOCK") fail(`${result.block_id} standard dependency ${dependency} is not a reusable STANDARD_BLOCK`);
    }
  }
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
