#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compileTaskShapedAgent,
  freezeTaskShapedAgentPackage,
  loadSpecialistBlockCatalog,
  validateTaskShapedAgentPackage,
} from "../control/specialist-agent-compiler.mjs";
import {
  BLOCKS,
  LIBRARY_IDENTITY,
  PARENT,
  RECIPES,
  TASKS,
  clone,
  digest,
  makeExternal,
} from "./fixtures/specialist-composition-fixtures.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const statusBefore = execFileSync("git", ["status", "--short"], {cwd: root, encoding: "utf8"});
const companion = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-specialist-companion-"));
const recipeCatalog = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/recipe-catalog.v1.json"), "utf8"));
assert.equal(recipeCatalog.schema, "agentos.specialist_recipe_catalog.v1");
assert.equal(recipeCatalog.recipes.length, 6, "recipe catalog must retain all six P0 recipes");
assert(recipeCatalog.recipes.every((recipe) => recipe.priority === "P0" && recipe.lifecycle === "CANDIDATE"), "recipe catalog P0 entries must remain inactive candidates");
const integrationHandoff = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/integration-handoff.v1.json"), "utf8"));
assert.equal(integrationHandoff.schema, "agentos.specialist_library_integration_handoff.v1");
assert.equal(integrationHandoff.status, "WAITING_WITH_RECEIPT");
assert.equal(execFileSync("git", ["rev-parse", `${integrationHandoff.candidate.commit}^{tree}`], {cwd: root, encoding: "utf8"}).trim(), integrationHandoff.candidate.tree, "handoff candidate tree must match its commit");
assert.deepEqual(integrationHandoff.lanes.entries.map((entry) => entry.generic_id), ["AGENT.BOOTSTRAP", "AGENT.PROJECT_CONTROLLER", "AGENT.INTENT_REGULATOR", "AGENT.RESOURCE_SCHEDULER", "AGENT.RUNTIME_DEPLOYMENT", "AGENT.INDEPENDENT_AUDITOR"]);

function compile(name, recipe, task, external = makeExternal(name), blocks = BLOCKS) {
  return compileTaskShapedAgent({
    task: clone(task),
    recipe: clone(recipe),
    blocks: clone(blocks),
    external: clone(external),
    parent: clone(PARENT),
    library_identity: clone(LIBRARY_IDENTITY),
    outputDir: path.join(companion, name),
    repositoryRoot: root,
  });
}

function assertCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

function packageBytes(packageDir) {
  return ["agent-plan.json", "block-lock.json", "authority-graph.json", "context-manifest.json", "decision-tree.gate", "proof-matrix.json", "handoff.schema.json", "evaluation-receipt.json", "bootstrap.md"].map((name) => fs.readFileSync(path.join(packageDir, name)));
}

function customRecipe(id, required, atomic = [], standards = []) {
  const sortedRequired = [...required].sort();
  return {
    recipe_id: id,
    version: "1.0.0",
    family: "fixture-negative",
    purpose: "Exercise a bounded compiler denial path.",
    required_block_ids: sortedRequired,
    required_atomic_blocks: [...atomic].sort(),
    required_standard_blocks: [...standards].sort(),
    required_context_fields: ["request.kind"],
    optional_block_ids: [],
    required_layers: [],
    reasons: Object.fromEntries(sortedRequired.map((blockId) => [blockId, `fixture requirement for ${blockId}`])),
  };
}

try {
  const rustA = compile("rust-search-a", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("rust-search"));
  const rustB = compile("rust-search-b", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("rust-search"));
  const web = compile("typescript-web", RECIPES.web, TASKS.web, makeExternal("typescript-web"));
  const data = compile("postgres-data", RECIPES.data, TASKS.data, makeExternal("postgres-data"));

  const portableCatalog = loadSpecialistBlockCatalog({repositoryRoot: root});
  const actualStandard = portableCatalog.find((block) => block.block_id === "specialist.standard.owasp-asvs");
  assert(actualStandard, "the source-locked OWASP ASVS standard must be loadable by the task-shaped compiler");
  const actualClosure = new Set([actualStandard.block_id]);
  const closureQueue = [actualStandard.block_id];
  while (closureQueue.length > 0) {
    const currentId = closureQueue.shift();
    const current = portableCatalog.find((block) => block.block_id === currentId);
    assert(current, `loaded standard dependency ${currentId} must exist in the portable catalog`);
    for (const dependency of current.dependencies) if (!actualClosure.has(dependency)) { actualClosure.add(dependency); closureQueue.push(dependency); }
  }
  const actualContextFields = [...new Set(["request.kind", ...[...actualClosure].flatMap((blockId) => portableCatalog.find((block) => block.block_id === blockId).required_context)])].sort();
  const actualRecipe = {
    recipe_id: "recipe.fixture.actual-standard-loader",
    version: "1.0.0",
    family: "fixture-standard-loader",
    purpose: "Compile a bounded task-shaped agent from a real reusable standard package.",
    required_block_ids: [actualStandard.block_id],
    required_atomic_blocks: [],
    required_standard_blocks: [actualStandard.block_id],
    required_context_fields: actualContextFields,
    optional_block_ids: [],
    required_layers: [],
    reasons: {[actualStandard.block_id]: "reuse the exact source-locked ASVS edition"},
  };
  const actualTask = {lane: "fixture.actual-standard-loader", goal: "compile a bounded standard-mapped candidate", outcome: "typed-candidate-handoff", non_goals: ["certification", "deployment"], owner_intent: {identity: "external.owner-intent.actual-standard-loader", version: "1.0.0", digest: digest({owner: "actual-standard-loader"})}};
  const actualStandardPackage = compile("actual-standard-loader", actualRecipe, actualTask, makeExternal("actual-standard-loader", {contextFields: actualContextFields}), portableCatalog);
  assert.equal(validateTaskShapedAgentPackage(actualStandardPackage.packageDir, {repositoryRoot: root}).status, "PASS");
  const actualStandardLock = actualStandardPackage.documents.blockLock.blocks.find((block) => block.block_id === actualStandard.block_id);
  assert.deepEqual(actualStandardLock, {block_id: actualStandard.block_id, version: actualStandard.version, hash: actualStandard.hash, role_kind: "STANDARD_BLOCK", layer: actualStandard.layer, reason: "reuse the exact source-locked ASVS edition", reuse_key: actualStandard.reuse_key, source_lock_digest: actualStandard.source_lock_digest, dependencies: actualStandard.dependencies, conflicts: actualStandard.conflicts, applicability: "YES", source_state: "FRESH"});

  assert.equal(validateTaskShapedAgentPackage(rustA.packageDir, {repositoryRoot: root}).status, "PASS");
  assert.equal(validateTaskShapedAgentPackage(web.packageDir, {repositoryRoot: root}).status, "PASS");
  assert.equal(validateTaskShapedAgentPackage(data.packageDir, {repositoryRoot: root}).status, "PASS");
  assert.equal(rustA.packageHash, rustB.packageHash, "identical inputs must yield one package hash");
  assert.deepEqual(packageBytes(rustA.packageDir), packageBytes(rustB.packageDir), "identical inputs must yield byte-identical packages");
  assert.notEqual(rustA.packageHash, web.packageHash, "different lane/context overlays must change package identity");
  assert.notEqual(web.packageHash, data.packageHash, "different lane/context overlays must change package identity");

  const rustLock = rustA.documents.blockLock;
  const webLock = web.documents.blockLock;
  const dataLock = data.documents.blockLock;
  const sharedStandardIds = ["specialist.fixture.standard.nist-ssdf"];
  for (const standardId of sharedStandardIds) {
    const hashes = [rustLock, webLock, dataLock].map((lock) => lock.blocks.find((block) => block.block_id === standardId)?.hash);
    assert(hashes.every(Boolean), `${standardId} must be selected in all three recipes`);
    assert.equal(new Set(hashes).size, 1, `${standardId} must be reused by hash`);
  }
  const rustIds = new Set(rustLock.blocks.map((block) => block.block_id));
  for (const block of rustLock.blocks) for (const dependency of block.dependencies) assert(rustIds.has(dependency), `${block.block_id} dependency ${dependency} missing from lock`);
  assert.equal(rustLock.blocks.length, 5, "Rust/search recipe must select the minimal dependency-complete set");
  assert.equal(webLock.blocks.length, 4, "web recipe must select the minimal dependency-complete set");
  assert.equal(dataLock.blocks.length, 4, "data recipe must select the minimal dependency-complete set");
  for (const packageResult of [rustA, web, data]) {
    for (const block of packageResult.documents.blockLock.blocks) assert(packageResult.bootstrap.includes(`${block.block_id}@${block.version}#${block.hash}`), "bootstrap.md must reflect each machine lock");
    assert(packageResult.bootstrap.includes(`Package hash: ${packageResult.packageHash}`), "bootstrap.md must reflect package hash");
  }
  assert.equal(freezeTaskShapedAgentPackage(rustA.packageDir).status, "FROZEN_ARCHIVED");

  const stale = makeExternal("stale", {freshnessStatus: "UNKNOWN"});
  assertCode(() => compile("stale", RECIPES.rustSearch, TASKS.rustSearch, stale), "STALE_EXTERNAL_EVIDENCE");
  const incomplete = makeExternal("incomplete", {contextFields: ["request.kind"]});
  assertCode(() => compile("incomplete", RECIPES.rustSearch, TASKS.rustSearch, incomplete), "INCOMPLETE_CONTEXT");
  const missingGovernance = makeExternal("missing-governance", {governanceStatus: "UNKNOWN"});
  assertCode(() => compile("missing-governance", RECIPES.rustSearch, TASKS.rustSearch, missingGovernance), "MISSING_PROJECT_GOVERNANCE");
  const missingCorpus = makeExternal("missing-corpus", {corpusStatus: "UNKNOWN"});
  assertCode(() => compile("missing-corpus", RECIPES.rustSearch, TASKS.rustSearch, missingCorpus), "MISSING_CORPUS_AUTHORITY");

  const noAsvs = BLOCKS.filter((block) => block.block_id !== "specialist.fixture.standard.owasp-asvs");
  assertCode(() => compile("missing-asvs", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("missing-asvs"), noAsvs), "MISSING_BLOCK");
  const noNist = BLOCKS.filter((block) => block.block_id !== "specialist.fixture.standard.nist-ssdf");
  assertCode(() => compile("missing-nist", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("missing-nist"), noNist), "MISSING_BLOCK");
  const noSlsa = BLOCKS.filter((block) => block.block_id !== "specialist.fixture.standard.slsa");
  assertCode(() => compile("missing-slsa", RECIPES.data, TASKS.data, makeExternal("missing-slsa"), noSlsa), "MISSING_BLOCK");

  const irrelevantAsvs = clone(BLOCKS);
  const irrelevant = irrelevantAsvs.find((block) => block.block_id === "specialist.fixture.standard.owasp-asvs");
  irrelevant.applicability = {outcome: "NOT_APPLICABLE", source_state: "FRESH"};
  irrelevantAsvs[irrelevantAsvs.indexOf(irrelevant)] = irrelevant;
  assertCode(() => compile("irrelevant-asvs", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("irrelevant-asvs"), irrelevantAsvs), "BLOCK_NOT_APPLICABLE");

  const oldAsvs = clone(BLOCKS).find((block) => block.block_id === "specialist.fixture.standard.owasp-asvs");
  oldAsvs.block_id = "specialist.fixture.standard.owasp-asvs-old";
  oldAsvs.version = "4.0.0";
  oldAsvs.reuse.reuse_key = "block-lock.fixture-standard-owasp-asvs-old";
  oldAsvs.reuse.standard_identity.edition = "4.0.0";
  oldAsvs.source_lock_digest = digest({source: "fixture-asvs-old"});
  oldAsvs.hash = digest({...oldAsvs, hash: null});
  const conflictRecipe = customRecipe("recipe.fixture.conflicting-editions", ["specialist.fixture.general-governance", "specialist.fixture.standard.nist-ssdf", "specialist.fixture.standard.owasp-asvs", oldAsvs.block_id, "specialist.fixture.typescript-web"], ["specialist.fixture.typescript-web"], ["specialist.fixture.standard.nist-ssdf", "specialist.fixture.standard.owasp-asvs", oldAsvs.block_id]);
  assertCode(() => compile("conflicting-editions", conflictRecipe, TASKS.web, makeExternal("conflicting-editions"), [...BLOCKS, oldAsvs]), "CONFLICTING_STANDARD_EDITIONS");

  const router = BLOCKS.find((block) => block.role_kind === "ROUTER");
  const broadRecipe = customRecipe("recipe.fixture.broad-router", ["specialist.fixture.general-governance", router.block_id], ["specialist.fixture.search-rag"]);
  const broadTask = {...TASKS.rustSearch, goal: "route a security family request"};
  assertCode(() => compile("broad-router", broadRecipe, broadTask, makeExternal("broad-router")), "ATOMIC_SPECIALIST_REQUIRED");

  const unsafe = BLOCKS.find((block) => block.block_id === "specialist.fixture.unsafe-rust-authority");
  const unsafeRecipe = customRecipe("recipe.fixture.unsafe-authority", ["specialist.fixture.general-governance", unsafe.block_id], [unsafe.block_id]);
  const unsafeTask = {...TASKS.rustSearch, goal: "perform unsafe authority escalation"};
  assertCode(() => compile("unsafe-authority", unsafeRecipe, unsafeTask, makeExternal("unsafe-authority")), "UNSAFE_AUTHORITY_ESCALATION");

  const productOutput = path.join(root, ".specialist-fixture-product-residue");
  assertCode(() => compileTaskShapedAgent({task: clone(TASKS.web), recipe: clone(RECIPES.web), blocks: clone(BLOCKS), external: makeExternal("product-residue"), parent: clone(PARENT), library_identity: clone(LIBRARY_IDENTITY), outputDir: productOutput, repositoryRoot: root}), "PRODUCT_REPOSITORY_RESIDUE_FORBIDDEN");
  assert.equal(fs.existsSync(productOutput), false, "forbidden product output must not be created");

  const lockPath = path.join(rustA.packageDir, "block-lock.json");
  const tampered = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  tampered.blocks[0].hash = "0".repeat(64);
  fs.writeFileSync(lockPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assertCode(() => validateTaskShapedAgentPackage(rustA.packageDir, {repositoryRoot: root}), "PACKAGE_HASH_MISMATCH");

  fs.rmSync(companion, {recursive: true, force: true});
  const statusAfter = execFileSync("git", ["status", "--short"], {cwd: root, encoding: "utf8"});
  assert.equal(statusAfter, statusBefore, "removing external generated instances must leave AgentOS Git status unchanged");
  console.log("PASS specialist task-shaped compiler: three deterministic external packages, shared standard reuse, minimal dependency closure, four-valued gates, negative denials, bootstrap reflection, and zero repository residue");
} finally {
  if (fs.existsSync(companion)) fs.rmSync(companion, {recursive: true, force: true});
}
