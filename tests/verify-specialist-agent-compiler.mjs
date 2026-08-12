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
import {canonicalDigest} from "../control/specialist-block-compiler.mjs";
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
assert.equal(recipeCatalog.inventory.raw_role_mentions, 627);
assert.equal(recipeCatalog.inventory.unique_role_titles, 621);
assert.equal(recipeCatalog.inventory.alias_mappings, 10);
assert.equal(recipeCatalog.recipes.length, 621, "recipe catalog must address every retained inventory role");
assert.equal(recipeCatalog.aliases.length, 10, "recipe catalog must preserve every explicit alias mapping");
assert.equal(recipeCatalog.recipes_sha256, canonicalDigest({...recipeCatalog, recipes_sha256: null}), "recipe catalog digest must be deterministic");
assert.equal(new Set(recipeCatalog.recipes.map((recipe) => recipe.source_inventory_id)).size, 621, "recipe source inventory IDs must be unique");
assert.equal(new Set(recipeCatalog.recipes.map((recipe) => recipe.recipe_id)).size, 621, "recipe IDs must be unique");
assert.equal(recipeCatalog.recipes.filter((recipe) => recipe.lifecycle === "CANDIDATE").length, 620, "every non-protected inventory role must compile from reusable gates and an immutable context profile");
assert.equal(recipeCatalog.recipes.filter((recipe) => recipe.lifecycle === "PLANNED").length, 0, "the on-demand roster must not advertise non-materializable roles");
assert.equal(recipeCatalog.recipes.filter((recipe) => recipe.lifecycle === "NOT_APPLICABLE").length, 1, "the protected Memory lane must remain not applicable");
assert(recipeCatalog.recipes.filter((recipe) => recipe.role_profile).every((recipe) => recipe.compile_allowed === true && recipe.materialization.status === "CONTEXT_PROFILE_CANDIDATE"), "context-profile recipes must be compileable without copying reusable authority");
assert(recipeCatalog.recipes.filter((recipe) => recipe.lifecycle === "NOT_APPLICABLE").every((recipe) => recipe.compile_allowed === false && recipe.materialization.status === "PROTECTED_EXTERNAL_LANE" && recipe.source_title === "Memory Systems (protected lane)"), "protected Memory lane must not become a portable recipe");
assert(recipeCatalog.recipes.filter((recipe) => recipe.lifecycle === "CANDIDATE").every((recipe) => recipe.compile_allowed === true), "every non-protected recipe must remain compileable");
const p4RecipeIds = ["recipe.client.product-interaction", "recipe.client.accessibility-wcag", "recipe.client.responsive-web", "recipe.client.ios-swiftui", "recipe.client.android-kotlin"];
for (const recipeId of p4RecipeIds) {
  const recipe = recipeCatalog.recipes.find((candidate) => candidate.recipe_id === recipeId);
  assert(recipe, `${recipeId} must be addressable in the durable recipe catalog`);
  assert.equal(recipe.lifecycle, "CANDIDATE");
  assert.equal(recipe.compile_allowed, true);
  assert(recipe.required_atomic_blocks.length === 1 && recipe.required_block_ids.includes(recipe.required_atomic_blocks[0]), `${recipeId} must name one narrow atom in its required closure`);
}
const p4AccessibilityRecipe = recipeCatalog.recipes.find((recipe) => recipe.recipe_id === "recipe.client.accessibility-wcag");
assert(p4AccessibilityRecipe.required_standard_blocks.includes("specialist.standard.wcag-2-2"), "P4 accessibility recipe must reuse the exact WCAG 2.2 standard block");
assert(recipeCatalog.aliases.every((alias) => recipeCatalog.recipes.some((recipe) => recipe.recipe_id === alias.canonical_recipe_id && recipe.source_inventory_id === alias.source_inventory_id)), "aliases must resolve to covered canonical recipes");
const integrationHandoff = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/integration-handoff.v1.json"), "utf8"));
assert.equal(integrationHandoff.schema, "agentos.specialist_library_integration_handoff.v1");
assert.equal(integrationHandoff.status, "WAITING_WITH_RECEIPT");
assert.equal(execFileSync("git", ["rev-parse", `${integrationHandoff.candidate.commit}^{tree}`], {cwd: root, encoding: "utf8"}).trim(), integrationHandoff.candidate.tree, "handoff candidate tree must match its commit");
assert.deepEqual(integrationHandoff.inventory.recipe_counts, {total: 621, CANDIDATE: 620, PLANNED: 0, NOT_APPLICABLE: 1, alias_mappings: 10, catalog_sha256: recipeCatalog.recipes_sha256}, "handoff recipe receipt must match the compiled catalog");
assert.deepEqual(integrationHandoff.inventory.compiled_package_counts, {total: 123, ROUTER: 19, CONTROL_PLANE: 16, ATOMIC_SPECIALIST: 65, STANDARD_BLOCK: 23}, "handoff package receipt must match the compiled roster");
assert.equal(integrationHandoff.inventory.raw_role_mentions, 627, "handoff raw role receipt must match the complete master inventory");
assert.equal(integrationHandoff.inventory.unique_role_titles, 621, "handoff inventory receipt must include discovered additions");
assert.equal(integrationHandoff.outputs.utility_harm_prescreen, "specialist-blocks/registry/utility-harm-prescreen.v1.json", "handoff must expose the deterministic utility/harm prescreen receipt");
assert(integrationHandoff.outputs.schemas.includes("schemas/specialist-utility-harm-prescreen.v1.json"), "handoff must expose the utility/harm prescreen schema");
assert.equal(integrationHandoff.receipts.find((receipt) => receipt.receipt_id === "specialist-utility-harm-prescreen-v1")?.status, "PRESCREEN_PENDING_EXTERNAL_REVIEW", "handoff must retain the external utility/harm gate");
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
  const contextualCatalogRecipe = recipeCatalog.recipes.find((recipe) => recipe.role_profile);
  assert(contextualCatalogRecipe, "recipe catalog must contain context-profile recipes");
  const contextualBlocks = loadSpecialistBlockCatalog({repositoryRoot: root});
  const contextualFields = [...new Set([...contextualCatalogRecipe.required_context_fields, ...contextualCatalogRecipe.required_block_ids.flatMap((blockId) => contextualBlocks.find((block) => block.block_id === blockId)?.required_context ?? [])])].sort();
  const contextualPackage = compile("contextual-catalog-recipe", contextualCatalogRecipe, TASKS.web, makeExternal("contextual-catalog-recipe", {contextFields: contextualFields}), contextualBlocks);
  assert.equal(contextualPackage.documents.agentPlan.recipe.role_profile.digest, contextualCatalogRecipe.role_profile.digest);
  const protectedMemoryRecipe = recipeCatalog.recipes.find((recipe) => recipe.lifecycle === "NOT_APPLICABLE");
  assert(protectedMemoryRecipe, "recipe catalog must retain the protected external lane");
  assertCode(() => compile("protected-memory-recipe", protectedMemoryRecipe, TASKS.web, makeExternal("protected-memory-recipe")), "RECIPE_NOT_COMPILEABLE");
  const rustA = compile("rust-search-a", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("rust-search"));
  const rustB = compile("rust-search-b", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("rust-search"));
  const web = compile("typescript-web", RECIPES.web, TASKS.web, makeExternal("typescript-web"));
  const data = compile("postgres-data", RECIPES.data, TASKS.data, makeExternal("postgres-data"));

  const portableCatalog = loadSpecialistBlockCatalog({repositoryRoot: root});
  const portableIds = new Set(portableCatalog.map((block) => block.block_id));
  for (const blockId of recipeCatalog.foundation_block_ids) assert(portableIds.has(blockId), `recipe catalog foundation dependency ${blockId} must be loadable`);
  let compiledRosterCount = 0;
  for (const rosterRecipe of recipeCatalog.recipes.filter((recipe) => recipe.compile_allowed)) {
    const rosterFields = [...new Set([...rosterRecipe.required_context_fields, ...rosterRecipe.required_block_ids.flatMap((blockId) => portableCatalog.find((block) => block.block_id === blockId)?.required_context ?? [])])].sort();
    let first;
    try {
      first = compileTaskShapedAgent({task: clone(TASKS.web), recipe: clone(rosterRecipe), blocks: clone(portableCatalog), external: makeExternal(`roster-${compiledRosterCount}`, {contextFields: rosterFields}), parent: clone(PARENT), library_identity: clone(LIBRARY_IDENTITY)});
    } catch (error) {
      throw new Error(`${rosterRecipe.recipe_id} failed roster materialization: ${error.message}`, {cause: error});
    }
    const second = compileTaskShapedAgent({task: clone(TASKS.web), recipe: clone(rosterRecipe), blocks: clone(portableCatalog), external: makeExternal(`roster-${compiledRosterCount}`, {contextFields: rosterFields}), parent: clone(PARENT), library_identity: clone(LIBRARY_IDENTITY)});
    assert.equal(first.packageHash, second.packageHash, `${rosterRecipe.recipe_id} must compile deterministically`);
    assert.equal(first.documents.agentPlan.recipe.source_inventory_id, rosterRecipe.source_inventory_id);
    compiledRosterCount += 1;
  }
  assert.equal(compiledRosterCount, 620, "every non-protected roster role must actually materialize through the compiler");
  const tamperedProfile = clone(contextualCatalogRecipe);
  tamperedProfile.role_profile.purpose = `${tamperedProfile.role_profile.purpose} tampered`;
  assertCode(() => compileTaskShapedAgent({task: clone(TASKS.web), recipe: tamperedProfile, blocks: clone(portableCatalog), external: makeExternal("tampered-profile"), parent: clone(PARENT), library_identity: clone(LIBRARY_IDENTITY)}), "ROLE_PROFILE_DIGEST_MISMATCH");
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
  assert.deepEqual(actualStandardLock, {block_id: actualStandard.block_id, version: actualStandard.version, hash: actualStandard.hash, role_kind: "STANDARD_BLOCK", layer: actualStandard.layer, reason: "reuse the exact source-locked ASVS edition", reuse_key: actualStandard.reuse_key, source_lock_digest: actualStandard.source_lock_digest, dependencies: actualStandard.dependencies, conflicts: actualStandard.conflicts, required_upstream_router: null, sibling_conflicts: [], applicability: "YES", source_state: "FRESH"});

  const p2Atom = portableCatalog.find((block) => block.block_id === "specialist.security.owasp-web-2025-a01-broken-access-control");
  const p2WebStandard = portableCatalog.find((block) => block.block_id === "specialist.standard.owasp-top10-2025");
  assert(p2Atom && p2WebStandard, "the P2 OWASP Web atom and reusable index standard must be loadable");
  const p2Closure = new Set([p2Atom.block_id]);
  const p2Queue = [p2Atom.block_id];
  while (p2Queue.length > 0) {
    const currentId = p2Queue.shift();
    const current = portableCatalog.find((block) => block.block_id === currentId);
    assert(current, `loaded P2 dependency ${currentId} must exist in the portable catalog`);
    for (const dependency of current.dependencies) if (!p2Closure.has(dependency)) { p2Closure.add(dependency); p2Queue.push(dependency); }
  }
  const p2ContextFields = [...new Set(["request.kind", ...[...p2Closure].flatMap((blockId) => portableCatalog.find((block) => block.block_id === blockId).required_context)])].sort();
  const p2Recipe = {
    recipe_id: "recipe.fixture.actual-owasp-web-a01",
    version: "1.0.0",
    family: "fixture-security-routing",
    purpose: "Compile a bounded task-shaped agent from one exact OWASP Web category and its reusable authorities.",
    required_block_ids: [p2Atom.block_id],
    required_atomic_blocks: [p2Atom.block_id],
    required_standard_blocks: ["specialist.standard.owasp-asvs", p2WebStandard.block_id],
    required_context_fields: p2ContextFields,
    optional_block_ids: [],
    required_layers: [],
    reasons: {[p2Atom.block_id]: "select only the evidenced OWASP Web A01 category", "specialist.standard.owasp-asvs": "reuse exact ASVS verification authority", [p2WebStandard.block_id]: "reuse exact OWASP Top 10:2025 category index"},
  };
  const p2Task = {lane: "fixture.actual-owasp-web-a01", goal: "compile one narrow category-bound security candidate", outcome: "typed-security-handoff", non_goals: ["certification", "deployment", "broad OWASP analysis"], owner_intent: {identity: "external.owner-intent.actual-owasp-web-a01", version: "1.0.0", digest: digest({owner: "actual-owasp-web-a01"})}};
  const p2Package = compile("actual-owasp-web-a01", p2Recipe, p2Task, makeExternal("actual-owasp-web-a01", {contextFields: p2ContextFields}), portableCatalog);
  assert.equal(validateTaskShapedAgentPackage(p2Package.packageDir, {repositoryRoot: root}).status, "PASS");
  const p2LockIds = new Set(p2Package.documents.blockLock.blocks.map((block) => block.block_id));
  assert(p2LockIds.has(p2Atom.block_id), "P2 package lock must include the selected atomic category");
  assert(p2LockIds.has(p2Atom.required_upstream_router), "P2 package lock must include the atomic upstream router");
  assert(p2LockIds.has("specialist.standard.owasp-asvs") && p2LockIds.has(p2WebStandard.block_id), "P2 package lock must include both reusable OWASP standards");
  assert.equal(p2Package.documents.blockLock.blocks.find((block) => block.block_id === p2WebStandard.block_id).hash, p2WebStandard.hash, "P2 package must reuse the immutable OWASP index hash");

  const p4Recipe = recipeCatalog.recipes.find((recipe) => recipe.recipe_id === "recipe.client.accessibility-wcag");
  const p4Task = {...TASKS.web, lane: "fixture.actual-p4-accessibility", goal: "compile one narrow WCAG-bound client candidate", outcome: "typed-client-handoff", non_goals: ["certification", "deployment", "legal applicability"]};
  const p4Package = compile("actual-p4-accessibility", p4Recipe, p4Task, makeExternal("actual-p4-accessibility", {contextFields: p4Recipe.required_context_fields}), portableCatalog);
  assert.equal(validateTaskShapedAgentPackage(p4Package.packageDir, {repositoryRoot: root}).status, "PASS");
  const p4LockIds = new Set(p4Package.documents.blockLock.blocks.map((block) => block.block_id));
  assert(p4LockIds.has("specialist.product-client.accessibility-wcag"), "P4 package lock must include the narrow accessibility atom");
  assert(p4LockIds.has("specialist.product-client.router"), "P4 package lock must include the product/client upstream router");
  assert(p4LockIds.has("specialist.standard.wcag-2-2"), "P4 package lock must include the reusable WCAG 2.2 standard block");
  assert.equal(p4Package.documents.blockLock.blocks.find((block) => block.block_id === "specialist.standard.wcag-2-2").hash, portableCatalog.find((block) => block.block_id === "specialist.standard.wcag-2-2").hash, "P4 package must reuse the immutable WCAG 2.2 hash");

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
  assert.equal(rustLock.blocks.length, 6, "Rust/search recipe must select the minimal dependency-complete set including its upstream router");
  assert.equal(webLock.blocks.length, 5, "web recipe must select the minimal dependency-complete set including its upstream router");
  assert.equal(dataLock.blocks.length, 5, "data recipe must select the minimal dependency-complete set including its upstream router");
  for (const lock of [rustLock, webLock, dataLock]) {
    const atomicBlocks = lock.blocks.filter((block) => block.role_kind === "ATOMIC_SPECIALIST");
    for (const block of atomicBlocks) {
      assert(block.required_upstream_router, `${block.block_id} must retain its upstream router in the block lock`);
      assert(lock.blocks.some((candidate) => candidate.block_id === block.required_upstream_router && candidate.role_kind === "ROUTER"), `${block.block_id} lock must include a ROUTER upstream`);
    }
  }
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

  const missingUpstream = clone(BLOCKS).map((block) => {
    if (block.block_id !== "specialist.fixture.search-rag") return block;
    const copy = {...block, required_upstream_router: null, dependencies: block.dependencies.filter((id) => id !== "specialist.fixture.security-router")};
    copy.hash = digest({...copy, hash: null});
    return copy;
  });
  assertCode(() => compile("missing-upstream-router", RECIPES.rustSearch, TASKS.rustSearch, makeExternal("missing-upstream-router"), missingUpstream), "INVALID_ATOMIC_COMPOSITION");

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
