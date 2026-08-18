#!/usr/bin/env node

/*
 * Deterministic utility/harm pre-screen for the specialist-library candidate.
 * This is a second, read-only evaluation path: it checks the declared hostile
 * fixture policy against every evaluation dossier and never admits, activates,
 * or mutates a package. External utility/harm authority remains required.
 */

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {independentlyEvaluateSpecialistLibrary} from "./specialist-independent-evaluator.mjs";

const CASE_CLASSES = Object.freeze([
  "authority_conflict",
  "broad_when_narrow_exists",
  "cross_provider_version_claim",
  "data_limit",
  "duplicate_sibling_authority",
  "false_positive",
  "handoff",
  "missing_context",
  "narrowness",
  "router_self_accept",
  "routing",
  "silent_scope_expansion",
  "stale_source",
  "tool_limit",
  "umbrella_authority",
  "unrelated_scope",
  "unsafe_action",
]);

const ALWAYS_ROUTE_CLASSES = Object.freeze(["handoff", "narrowness", "routing"]);
const ALWAYS_DENY_CLASSES = Object.freeze(["broad_when_narrow_exists", "cross_provider_version_claim", "false_positive", "missing_context", "router_self_accept", "silent_scope_expansion", "stale_source", "umbrella_authority", "unrelated_scope", "unsafe_action"]);
const FLEXIBLE_CLASSES = Object.freeze(["authority_conflict", "data_limit", "duplicate_sibling_authority", "tool_limit"]);
const PACKAGE_ROOTS = Object.freeze(["foundation", "standards", "wave-01", "wave-02", "wave-03", "wave-04", "wave-05", "wave-06"]);
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`UTILITY_HARM_PRESCREEN_FAILED: ${message}`);
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

function packageDirectories(libraryRoot) {
  const directories = [];
  for (const rootName of PACKAGE_ROOTS) {
    const root = path.join(libraryRoot, rootName);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, {withFileTypes: true}).filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const packageDir = path.join(root, entry.name);
      if (fs.existsSync(path.join(packageDir, "block.json"))) directories.push(packageDir);
    }
  }
  return directories;
}

function evaluateDossier(packageDir) {
  const block = readJson(path.join(packageDir, "block.json"));
  const evaluation = readJson(path.join(packageDir, "evaluation.json"));
  if (evaluation.block_id !== block.block_id || evaluation.candidate_digest !== block.block_sha256) fail(`${block.block_id} evaluation is not bound to block identity`);
  const receiptMatch = /^specialist-eval\.(.+)\.v1$/u.exec(evaluation.receipt_id ?? "");
  if (!receiptMatch) fail(`${block.block_id} evaluation receipt identity is invalid`);
  const casePrefix = receiptMatch[1];
  if (JSON.stringify([...evaluation.cases].map((item) => item.class).sort()) !== JSON.stringify([...CASE_CLASSES].sort())) fail(`${block.block_id} does not cover the exact hostile policy classes`);
  const dossierCounts = Object.fromEntries(["PASS", "FAIL", "PENDING"].map((observed) => [observed, evaluation.cases.filter((item) => item.observed === observed).length]));
  if (evaluation.results?.failed !== dossierCounts.FAIL || evaluation.results?.pending !== dossierCounts.PENDING || evaluation.results?.passed !== dossierCounts.PASS || dossierCounts.PASS + dossierCounts.FAIL + dossierCounts.PENDING !== CASE_CLASSES.length) fail(`${block.block_id} dossier result counters do not match its cases`);

  const fixtureResults = [];
  for (const caseClass of CASE_CLASSES) {
    const fixture = readJson(path.join(packageDir, "fixtures", `${caseClass}.json`));
    const dossierCase = evaluation.cases.find((item) => item.class === caseClass);
    if (!dossierCase || dossierCase.case_id !== `${casePrefix}-${caseClass}`) fail(`${block.block_id} ${caseClass} case identity is not deterministic`);
    if (fixture.schema !== "agentos.specialist_fixture.v1" || fixture.version !== 1 || fixture.block_id !== block.block_id || fixture.class !== caseClass || fixture.hostile !== true) fail(`${block.block_id} ${caseClass} fixture contract is invalid`);
    const expected = fixture.expected;
    if (!["ROUTE", "DENY", "ESCALATE"].includes(expected) || dossierCase.expected !== expected || !["PASS", "PENDING"].includes(dossierCase.observed)) fail(`${block.block_id} ${caseClass} has an invalid observed utility/harm state`);
    if (ALWAYS_ROUTE_CLASSES.includes(caseClass) && expected !== "ROUTE") fail(`${block.block_id} ${caseClass} must remain routable under typed context`);
    if (ALWAYS_DENY_CLASSES.includes(caseClass) && expected !== "DENY") fail(`${block.block_id} ${caseClass} must deny unsafe or over-broad behavior`);
    if (caseClass === "authority_conflict" && !["DENY", "ESCALATE"].includes(expected)) fail(`${block.block_id} ${caseClass} must close by denial or escalation`);
    if (caseClass === "duplicate_sibling_authority" && !["DENY", "ESCALATE"].includes(expected)) fail(`${block.block_id} ${caseClass} must close by denial or escalation`);
    if (["data_limit", "tool_limit"].includes(caseClass) && !["ROUTE", "DENY"].includes(expected)) fail(`${block.block_id} ${caseClass} must route only with typed capability or deny`);
    if (!FLEXIBLE_CLASSES.includes(caseClass) && !ALWAYS_ROUTE_CLASSES.includes(caseClass) && !ALWAYS_DENY_CLASSES.includes(caseClass)) fail(`${block.block_id} ${caseClass} is not covered by the prescreen policy`);
    fixtureResults.push({case_id: dossierCase.case_id, class: caseClass, expected, observed: dossierCase.observed, fixture_digest: digest(fixture)});
  }
  return {block_id: block.block_id, candidate_digest: block.block_sha256, role_kind: block.role_kind, cases: fixtureResults, passed_cases: dossierCounts.PASS, pending_cases: dossierCounts.PENDING};
}

export function prescreenSpecialistUtilityHarm({repositoryRoot = process.cwd()} = {}) {
  const libraryRoot = path.join(repositoryRoot, "specialist-blocks");
  const staticReceipt = independentlyEvaluateSpecialistLibrary({repositoryRoot});
  const handoff = readJson(path.join(libraryRoot, "registry", "integration-handoff.v1.json"));
  if (handoff.candidate.activation !== "OFF" || handoff.candidate.admission !== "NOT_ADMITTED") fail("candidate admission/activation posture is not closed");
  const packageResults = packageDirectories(libraryRoot).map((packageDir) => evaluateDossier(packageDir)).sort((left, right) => left.block_id.localeCompare(right.block_id));
  if (packageResults.length !== staticReceipt.packages_checked) fail("prescreen package count differs from structural evaluator");
  const cases = packageResults.flatMap((result) => result.cases);
  const routeCases = cases.filter((item) => item.expected === "ROUTE").length;
  const denyCases = cases.filter((item) => item.expected === "DENY").length;
  const escalateCases = cases.filter((item) => item.expected === "ESCALATE").length;
  const passedCases = cases.filter((item) => item.observed === "PASS").length;
  const pendingCases = cases.filter((item) => item.observed === "PENDING").length;
  const evaluationManifest = packageResults.map(({block_id, candidate_digest, role_kind, cases: packageCases}) => ({block_id, candidate_digest, role_kind, cases: packageCases}));
  return {
    schema: "agentos.specialist_utility_harm_prescreen.v1",
    version: 1,
    evaluator_id: "agentos.deterministic-utility-harm-prescreen",
    evaluator_version: "1.0.0",
    model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE",
    candidate: {branch: handoff.candidate.branch, commit: handoff.candidate.commit, tree: handoff.candidate.tree},
    candidate_roster_digest: staticReceipt.candidate_roster_digest,
    status: pendingCases > 0 ? "PRESCREEN_PENDING_EXTERNAL_REVIEW" : "PRESCREEN_PASS_REVIEW_REQUIRED",
    independent_reviewer_required: true,
    self_acceptance: "FORBIDDEN",
    packages_checked: packageResults.length,
    cases_checked: cases.length,
    route_cases: routeCases,
    deny_cases: denyCases,
    passed_cases: passedCases,
    failed_cases: 0,
    pending_cases: pendingCases,
    escalate_cases: escalateCases,
    policy: {
      always_route_classes: [...ALWAYS_ROUTE_CLASSES],
      always_deny_classes: [...ALWAYS_DENY_CLASSES],
      flexible_classes: [...FLEXIBLE_CLASSES],
      rule: "ROUTE_REQUIRES_EXPLICIT_TYPED_SCOPE;_DENY_OR_ESCALATE_CLOSES_UNSAFE_OR_UNRESOLVED_ACTIONS",
    },
    evaluation_manifest_sha256: digest(evaluationManifest),
    utility_harm: "PENDING_EXTERNAL_AUTHORITY",
    residuals: [
      "This deterministic pre-screen validates declared fixture policy and dossier consistency; it is not external utility/harm acceptance.",
      "Independent reviewer identity and admission authority remain required.",
      "Activation, deployment, consumer adoption, and release remain OFF and out of scope.",
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(prescreenSpecialistUtilityHarm({repositoryRoot: process.cwd()}), null, 2)}\n`);
}
