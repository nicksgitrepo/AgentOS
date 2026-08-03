#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOOTSTRAP_QUESTIONS,
  compileBootstrapPlan,
  compileModelEconomics,
  normalizeModelProfile,
  planBootstrapInterview,
  recommendModels,
} from "../control/bootstrap-interview.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {
  compileLegacyPreservationPlan,
  preserveLegacyCorpus,
  verifyLegacyPreservation,
} from "../control/legacy-preservation.mjs";

const failures = [];
let hostiles = 0;

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectRejected(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostiles += 1;
  }
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

const discovery = [
  {
    fact_id: "environment.project_root",
    value: "/synthetic/project",
    confidence: "HIGH",
    source_kind: "FILESYSTEM",
    source_locator: "root",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  },
  {
    fact_id: "repositories.topology.detected",
    value: "SINGLE_REPOSITORY",
    confidence: "HIGH",
    source_kind: "GIT",
    source_locator: "root",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  },
  {
    fact_id: "stack.framework.detected",
    value: "synthetic-framework",
    confidence: "HIGH",
    source_kind: "SOURCE",
    source_locator: "manifest",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  },
  {
    fact_id: "ui.routes.detected",
    value: ["/synthetic-route"],
    confidence: "HIGH",
    source_kind: "SOURCE",
    source_locator: "route-index",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  },
  {
    fact_id: "authority-corpus.source.detected",
    value: "external-readable-source",
    confidence: "HIGH",
    source_kind: "FILESYSTEM",
    source_locator: "authority-root",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  },
];

const initial = planBootstrapInterview({discovery});
expect(initial.next === "bootstrap.discovery.mode", "discovery permission is not the first question");
expect(initial.questions[0].class === "OWNER_BOUNDARY", "first question is not an owner boundary");
expect(initial.questions.every((question) => question.discovered_facts), "question plan lost discovery context");
expect(BOOTSTRAP_QUESTIONS.some((question) => question.id === "project.north_star"),
  "north-star question is missing");
expect(BOOTSTRAP_QUESTIONS.some((question) => question.id === "project.model_economics"),
  "model economics question is missing");

const discoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-discovery-alignment-"));
try {
  fs.writeFileSync(path.join(discoveryRoot, "package.json"), "{}\n");
  const observed = discoverProject(discoveryRoot, "RECOMMENDED");
  expect(observed.schema === "agentos.bootstrap_discovery_result.v1"
    && observed.operations.read_only === true
    && observed.operations.authentication_attempted === false
    && observed.operations.secrets_requested === false,
  "canonical Bootstrap Discovery is not read-only");
  expect(observed.facts.every((fact) => fact.secret_free === true),
    "canonical Bootstrap Discovery emitted a non-secret-free fact");
  expect(observed.facts.some((fact) => fact.fact_id === "project.marker.package.json"),
    "canonical Bootstrap Discovery missed a safe project marker");
  const observedPlan = planBootstrapInterview({discovery: observed.facts});
  expect(observedPlan.schema === "agentos.bootstrap_interview_plan.v1"
    && observedPlan.discovery_digest_sha256.length === 64,
  "Bootstrap Interview rejected canonical Discovery facts");
  expectRejected("canonical discovery invalid mode", () => discoverProject(discoveryRoot, "AUTHENTICATED"));
  expectRejected("manual mode runs discovery", () => discoverProject(discoveryRoot, "MANUAL"));
} finally {
  fs.rmSync(discoveryRoot, {recursive: true, force: true});
}

expect(normalizeModelProfile("ECO") === "ECO_CONTINUOUS", "ECO alias was not normalized");
expect(normalizeModelProfile("ECONOMICAL") === "ECO_CONTINUOUS",
  "ECONOMICAL alias was not normalized");
const economics = compileModelEconomics({profile: "ECO", completion_floor: 0.8});
expect(economics.profile === "ECO_CONTINUOUS" && economics.profile_alias === "ECO",
  "model profile compatibility record is incomplete");
const recommendation = recommendModels({
  economics: {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  candidates: [
    {
      model: "too-weak",
      reasoning: "medium",
      spawnable: true,
      estimated_success_probability: 0.6,
      estimated_attempts: 1,
      relative_unit_cost: 1,
    },
    {
      model: "reliable-efficient",
      reasoning: "high",
      spawnable: true,
      estimated_success_probability: 0.9,
      estimated_attempts: 1.1,
      relative_unit_cost: 2,
    },
    {
      model: "reliable-expensive",
      reasoning: "highest",
      spawnable: true,
      estimated_success_probability: 0.98,
      estimated_attempts: 1,
      relative_unit_cost: 8,
    },
  ],
});
expect(recommendation.recommended.model === "reliable-efficient",
  "eco recommendation did not minimize expected completion cost");
expect(recommendation.excluded.some((entry) => entry.reason === "BELOW_COMPLETION_FLOOR"),
  "below-floor model was not excluded");
const roleRecommendation = recommendModels({
  role: "CAMPAIGN_FINALIZER",
  economics: {
    profile: "ECO_CONTINUOUS",
    completion_floor: 0.8,
    max_expected_cost: 10,
  },
  requirements: {
    required_context_window: 100,
    required_tools: ["shell", "git"],
    minimum_reasoning: "HIGH",
  },
  candidates: [
    {
      model: "too-small",
      reasoning: "HIGH",
      spawnable: true,
      context_window: 32,
      tools: ["shell", "git"],
      estimated_success_probability: 0.99,
      estimated_attempts: 1,
      relative_unit_cost: 1,
    },
    {
      model: "finalizer-feasible",
      reasoning: "HIGH",
      spawnable: true,
      context_window: 128,
      tools: ["shell", "git"],
      estimated_success_probability: 0.9,
      estimated_attempts: 1.1,
      relative_unit_cost: 4,
      supervisor_cost: 0.5,
      repair_cost: 0.5,
      integration_cost: 0.5,
      estimated_wall_hours: 4,
    },
  ],
});
expect(roleRecommendation.role === "CAMPAIGN_FINALIZER"
  && roleRecommendation.recommended.model === "finalizer-feasible"
  && roleRecommendation.recommended.expected_completion_cost_range.expected === 5.9
  && roleRecommendation.pareto_frontier.includes("finalizer-feasible"),
"role-specific model policy did not bind capability floors and accepted-cost economics");
expectRejected("no eligible model after capability gates", () => recommendModels({
  role: "CAMPAIGN_FINALIZER",
  economics: {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  requirements: {required_context_window: 999},
  candidates: [{
    model: "ineligible",
    reasoning: "HIGH",
    spawnable: true,
    context_window: 128,
    estimated_success_probability: 0.99,
    estimated_attempts: 1,
    relative_unit_cost: 1,
  }],
}));
expectRejected("unknown model recommendation role", () => recommendModels({
  role: "UNREGISTERED_ROLE",
  economics: {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  candidates: [{
    model: "eligible-but-unbound",
    reasoning: "HIGH",
    spawnable: true,
    estimated_success_probability: 0.99,
    estimated_attempts: 1,
    relative_unit_cost: 1,
  }],
}));

const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.boundary": {repositories: "discovered", external_systems: []},
  "project.north_star": {user: "operator", recurring_moment: "complete work", better: "less friction"},
  "project.first_workflow": {workflow: "complete work", done_when: "verified result"},
  "project.delivery_boundary": "DEVELOPMENT_READY",
  "project.protected_boundaries": {owner_only: ["irreversible production action"]},
  "authority-corpus.source": {operation: "CREATE_NEW", source: null},
  "project.design_posture": {surfaces: "discovered", posture: "clear and accessible"},
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  "bootstrap.confirmation": "PROCEED",
};
const compiled = compileBootstrapPlan({discovery, answers});
expect(compiled.plan_sha256 === compiled.plan_sha256 && compiled.legacy_preservation_required === false,
  "compiled Bootstrap plan is not canonical for a new corpus");

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-alignment-"));
const source = path.join(parent, "imported-authority");
const destination = path.join(parent, "new-authority");
const secondDestination = path.join(parent, "new-authority-repeat");
fs.mkdirSync(path.join(source, ".git"), {recursive: true});
fs.mkdirSync(path.join(source, "nested"), {recursive: true});
fs.mkdirSync(path.join(source, ".cache"), {recursive: true});
fs.writeFileSync(path.join(source, "README.md"), "legacy truth\n");
fs.writeFileSync(path.join(source, ".hidden.md"), "hidden but relevant\n");
fs.writeFileSync(path.join(source, "nested", "context.md"), "context\n");
fs.writeFileSync(path.join(source, ".git", "objects"), "excluded\n");
fs.writeFileSync(path.join(source, ".cache", "item"), "excluded\n");
fs.writeFileSync(path.join(source, ".DS_Store"), "metadata\n");
fs.mkdirSync(destination);
fs.mkdirSync(secondDestination);
const firstPlan = compileLegacyPreservationPlan(source, destination);
const secondPlan = compileLegacyPreservationPlan(source, secondDestination);
expect(firstPlan.archive_sha256 === secondPlan.archive_sha256
  && firstPlan.manifest_sha256 === secondPlan.manifest_sha256
  && firstPlan.index_sha256 === secondPlan.index_sha256,
"legacy preservation plan is not deterministic");
expect(!fs.existsSync(path.join(destination, "legacy.zip")),
  "legacy planning wrote before preservation was applied");
const preserved = preserveLegacyCorpus(source, destination, "2026-01-01T00:00:00.000Z");
expect(preserved.verification.status === "VERIFIED_EXACT", "legacy archive did not verify");
expect(preserved.verification.included_files === 3 && preserved.verification.excluded_paths === 3,
  "legacy include/exclude inventory is incorrect");
expect(verifyLegacyPreservation(destination).archive_sha256 === firstPlan.archive_sha256,
  "legacy archive readback changed its planned identity");

expectRejected("legacy destination inside source", () => {
  const nestedDestination = path.join(source, "new-authority");
  fs.mkdirSync(nestedDestination);
  compileLegacyPreservationPlan(source, nestedDestination);
});
expectRejected("legacy source symlink", () => {
  const symlinkSource = path.join(parent, "symlink-source");
  const symlinkDestination = path.join(parent, "symlink-destination");
  fs.mkdirSync(symlinkSource);
  fs.mkdirSync(symlinkDestination);
  fs.writeFileSync(path.join(symlinkSource, "real.md"), "real\n");
  fs.symlinkSync(path.join(symlinkSource, "real.md"), path.join(symlinkSource, "alias.md"));
  compileLegacyPreservationPlan(symlinkSource, symlinkDestination);
});
expectRejected("legacy root symlink", () => {
  const realSource = path.join(parent, "real-source");
  const linkedSource = path.join(parent, "linked-source");
  const linkedDestination = path.join(parent, "linked-destination");
  fs.mkdirSync(realSource);
  fs.mkdirSync(linkedDestination);
  fs.writeFileSync(path.join(realSource, "README.md"), "real\n");
  fs.symlinkSync(realSource, linkedSource, "dir");
  compileLegacyPreservationPlan(linkedSource, linkedDestination);
});
expectRejected("secret-bearing discovery", () => planBootstrapInterview({
  discovery: [{...discovery[0], value: "api_key: hidden"}],
}));
expectRejected("custom model without conditions", () => compileModelEconomics({profile: "CUSTOM"}));

fs.rmSync(parent, {recursive: true, force: true});
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS AgentOS Bootstrap alignment: discovery-first interview, model-floor economics, deterministic legacy preservation, and ${hostiles} hostile cases passed`);
}
