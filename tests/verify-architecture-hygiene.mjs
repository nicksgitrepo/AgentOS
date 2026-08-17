#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const controlRoot = path.join(root, "control");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineCount(relativePath) {
  return read(relativePath).split(/\r?\n/u).length - 1;
}

function controlModules(directory = controlRoot, result = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) controlModules(absolute, result);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) result.push(absolute);
  }
  return result.sort();
}

function importsFrom(file) {
  const source = fs.readFileSync(file, "utf8");
  const imports = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:import\b|export\b).*?\bfrom\s+["'](\.\.?\/[^"']+\.mjs)["']/u)
      ?? line.match(/^\s*\}\s*from\s+["'](\.\.?\/[^"']+\.mjs)["']/u);
    if (match) imports.push(path.normalize(path.join(path.dirname(file), match[1])));
  }
  return imports;
}

const modules = controlModules();
const graph = new Map(modules.map((file) => [file, importsFrom(file)]));
for (const [source, dependencies] of graph) {
  for (const dependency of dependencies) assert(fs.existsSync(dependency), `missing local dependency: ${path.relative(root, source)} -> ${path.relative(root, dependency)}`);
}

const cycles = [];
const active = new Set();
const complete = new Set();
const stack = [];
function visit(file) {
  if (active.has(file)) {
    cycles.push([...stack.slice(stack.indexOf(file)), file].map((item) => path.relative(root, item)));
    return;
  }
  if (complete.has(file)) return;
  active.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  active.delete(file);
  complete.add(file);
}
for (const file of modules) visit(file);
assert.deepEqual(cycles, [], `control import cycle(s) remain: ${JSON.stringify(cycles)}`);

const general = read("control/governance-library.mjs");
const role = read("control/role-governance-library.mjs");
const generalImports = new Set(graph.get(path.join(controlRoot, "governance-library.mjs")) ?? []);
const roleImports = new Set(graph.get(path.join(controlRoot, "role-governance-library.mjs")) ?? []);
assert(![...generalImports].some((dependency) => dependency.endsWith("role-governance-library.mjs") || dependency.endsWith("governance-role-definitions.mjs")), "general governance must not depend on role-specific generation");
assert([...roleImports].some((dependency) => dependency.endsWith("governance-library.mjs"))
  && [...roleImports].some((dependency) => dependency.endsWith("governance-role-definitions.mjs"))
  && [...roleImports].some((dependency) => dependency.endsWith("question-tree.mjs")), "role-specific governance is not generated from all three admitted sources");
assert(read("control/project-context-store.mjs").includes("./content-addressing.mjs"), "project context store must use the shared digest primitive");
assert(!read("control/project-context-store.mjs").includes("./bootstrap-compiler.mjs"), "project context store must not depend on the Bootstrap entrypoint");
assert(read("control/bootstrap-coverage.mjs").includes("./bootstrap-output-definitions.mjs"), "Bootstrap coverage must consume the extracted output-definition catalog");
assert(read("control/campaign-lifecycle.mjs").includes("./content-addressing.mjs"), "campaign lifecycle must use the shared digest primitive");
assert(!/function\s+canonicalize\s*\(/u.test(read("control/campaign-lifecycle.mjs")), "campaign lifecycle must not carry a private canonicalizer");
assert(read("control/owner-review.mjs").includes("./content-addressing.mjs"), "owner review must use the shared digest primitive");
assert(!/function\s+canonicalize\s*\(/u.test(read("control/owner-review.mjs")), "owner review must not carry a private canonicalizer");
assert(general.includes("UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA") && general.includes("validateUniversalTaskCloseoutReceipts"), "general governance must own the universal closeout receipt contract");
assert(read("control/audit-driven-integration-pyramid.mjs").includes("preserveHandoff")
  && read("control/audit-driven-integration-pyramid.mjs").includes("archiveTask"),
"audit-driven rapid-prototype closeout must preserve and archive only after downstream consumption");
assert(read("control/rapid-prototype/delivery-closure.mjs").includes("compileUniversalTaskCloseoutReceipts")
  && read("control/rapid-prototype/delivery-closure.mjs").includes('mode: "RAPID_PROTOTYPE"'),
"direct rapid-prototype delivery closure must consume the general closeout receipt contract");
assert(read("control/apprenticeship-drill.mjs").includes("validateUniversalTaskCloseoutReceipts"), "apprenticeship closeout must consume the general closeout receipt contract");

const developmentModeBindings = new Map([
  ["BOOTSTRAP", ["control/bootstrap-runtime.mjs"]],
  ["IMPORT", ["control/project-import.mjs"]],
  ["RAPID_PROTOTYPE", ["control/audit-driven-integration-pyramid.mjs"]],
  ["RAPID_PROTOTYPING", ["control/development-plan.mjs"]],
  ["ITERATION", ["control/development-plan.mjs"]],
  ["CAMPAIGN", ["control/campaign-lifecycle.mjs"]],
  ["CASCADE", ["control/campaign-cascade.mjs"]],
  ["APPRENTICESHIP", ["control/apprenticeship-drill.mjs"]],
]);
for (const [mode, [relativePath]] of developmentModeBindings) {
  const source = read(relativePath);
  assert(source.includes("assertUniversalDevelopmentMode") && source.includes(`\"${mode}\"`), `${relativePath} is not bound to the universal ${mode} development policy`);
}

const universalModeAdapters = new Map([
  ["CAMPAIGN", ["control/intent-regulator-runtime.mjs", "control/canonical-campaign-orchestration-adapter.mjs", "control/canonical-campaign-orchestration-support.mjs"]],
  ["BOOTSTRAP", ["control/platform-foundation-merge.mjs"]],
  ["RAPID_PROTOTYPE", ["control/rapid-prototype/index.mjs", "control/rapid-prototype/delivery-closure.mjs"]],
]);
for (const [mode, relativePaths] of universalModeAdapters) {
  for (const relativePath of relativePaths) {
    const source = read(relativePath);
    assert(source.includes("assertUniversalDevelopmentMode") && source.includes(`\"${mode}\"`), `${relativePath} is not bound to the universal ${mode} development policy`);
  }
}

for (const [mode, [relativePath]] of developmentModeBindings) {
  const source = read(relativePath);
  assert(source.includes("assertUniversalDevelopmentMode"), `${relativePath} is not bound to the general universal development policy`);
}

const laneNames = [
  "intent-scope", "bootstrap-context", "user-conversation", "role-routing",
  "progress-health", "functionality", "ui-ux", "code-hygiene",
  "security-privacy", "evidence-identity", "recovery-boundaries", "delivery-closure",
];
const rapidIndex = read("control/rapid-prototype/index.mjs");
for (const lane of laneNames) {
  const relativePath = `control/rapid-prototype/${lane}.mjs`;
  assert(fs.existsSync(path.join(root, relativePath)), `rapid prototype lane is missing: ${relativePath}`);
  assert(rapidIndex.includes(`./${lane}.mjs`), `rapid prototype index does not wire lane: ${lane}`);
  assert(lineCount(relativePath) <= 600, `rapid prototype lane is too large to remain a focused module: ${relativePath}`);
}

const focusedBudgets = new Map([
  ["control/content-addressing.mjs", 120],
  ["control/bootstrap-output-definitions.mjs", 350],
  ["control/governance-library.mjs", 350],
  ["control/governance-role-definitions.mjs", 300],
  ["control/role-governance-library.mjs", 600],
  ["control/development-plan.mjs", 350],
  ["control/native-session-runner.mjs", 400],
  ["control/rapid-prototype/index.mjs", 900],
]);
for (const [relativePath, budget] of focusedBudgets) assert(lineCount(relativePath) <= budget, `${relativePath} exceeds its focused-module budget of ${budget} lines`);

const explicitlyRetainedLargeBoundaries = new Set([
  "control/agentos-controller.mjs",
  "control/audit-driven-integration-pyramid.mjs",
  "control/bootstrap-compiler.mjs",
  "control/campaign-cascade.mjs",
  "control/campaign-lifecycle.mjs",
  "control/continuous-operating-loop.mjs",
  "control/hybrid-scheduler.mjs",
  "control/local-agent-runtime.mjs",
  "control/local-agent-worker.mjs",
  "control/local-self-development-supervisor-adapter.mjs",
  "control/native-session-team.mjs",
  "control/owner-review.mjs",
  "control/proof-carrying-work.mjs",
  "control/project-import.mjs",
  "control/release-lifecycle.mjs",
  "control/task-model-routing.mjs",
]);
const largeModules = modules
  .map((file) => path.relative(root, file))
  .filter((relativePath) => lineCount(relativePath) > 900);
assert(largeModules.every((relativePath) => explicitlyRetainedLargeBoundaries.has(relativePath)), `unclassified large control module(s): ${largeModules.join(", ")}`);
assert.equal(read("control/rapid-prototype/index.mjs").includes("RAPID_PROTOTYPE_CHANGED_PATHS"), true);

console.log(`PASS architecture hygiene: ${modules.length} control modules are acyclic; general and role-specific libraries are separated; ${laneNames.length} rapid lanes are wired and budgeted; ${largeModules.length} legacy/transaction boundaries are explicit`);
