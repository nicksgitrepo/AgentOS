#!/usr/bin/env node

/*
 * Materialize one deterministic, project-agnostic recipe for every retained
 * master-inventory role. Planned recipes are addressable, but cannot be
 * compiled until a role-specific block has been researched, source-locked,
 * independently evaluated, and admitted by a separate authority.
 */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compileSpecialistLibrary} from "./specialist-block-compiler.mjs";

const FOUNDATION_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evaluation-admission-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.registry-alias-deduplicator",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
]);

const BASE_LAYERS = Object.freeze([
  "owner-intent-and-authority",
  "agentos-governance",
  "task-role-authority",
  "exact-project-context",
]);

const BASE_CONTEXT = Object.freeze(["authority", "candidate", "custody", "proof", "request", "source_lock", "worktree"]);
const BASE_NON_GOALS = Object.freeze(["consumer Product writing", "activation", "deployment", "self-acceptance", "unrelated specialist scopes"]);

const P0_SOURCE_BY_RECIPE = Object.freeze({
  "recipe.agent.bootstrap": "inventory.permanent-governance-control.bootstrap-project-initializer",
  "recipe.agent.project-controller": "inventory.permanent-governance-control.global-controller-15-minute-orchestrator",
  "recipe.agent.intent-regulator": "inventory.permanent-governance-control.intent-regulator-owner-voice",
  "recipe.agent.resource-scheduler": "inventory.permanent-governance-control.scheduler-hardware-resource-governor",
  "recipe.agent.runtime-deployment": "inventory.permanent-governance-control.runtime-deployment-operator",
  "recipe.agent.independent-auditor": "inventory.permanent-governance-control.independent-auditor",
});

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function recipeIdFor(entry) {
  const stableSlug = entry.canonical_id.replace(/^inventory\./u, "").replace(/[^a-z0-9-]+/giu, "-");
  return `recipe.inventory.${stableSlug}`;
}

function genericReasons(entry) {
  return Object.fromEntries(FOUNDATION_BLOCKS.map((blockId) => [blockId, `Universal governance dependency for the planned ${entry.title} recipe.`]));
}

function finalizeRecipe(recipe) {
  const normalized = {
    ...recipe,
    aliases: sortedUnique(recipe.aliases ?? []),
    required_layers: sortedUnique(recipe.required_layers ?? BASE_LAYERS),
    required_block_ids: sortedUnique(recipe.required_block_ids ?? FOUNDATION_BLOCKS),
    required_context_fields: sortedUnique(recipe.required_context_fields ?? BASE_CONTEXT),
    non_goals: sortedUnique(recipe.non_goals ?? BASE_NON_GOALS),
    optional_block_ids: sortedUnique(recipe.optional_block_ids ?? []),
    required_atomic_blocks: sortedUnique(recipe.required_atomic_blocks ?? []),
    required_standard_blocks: sortedUnique(recipe.required_standard_blocks ?? []),
  };
  normalized.recipe_hash = null;
  normalized.recipe_hash = canonicalDigest(normalized);
  return normalized;
}

function normalizeExistingRecipe(existing, entry) {
  const lifecycle = existing.lifecycle ?? "CANDIDATE";
  return finalizeRecipe({
    schema: "agentos.specialist_recipe.v1",
    version: 1,
    recipe_id: existing.recipe_id,
    recipe_version: existing.recipe_version ?? existing.version ?? "1.0.0",
    source_inventory_id: entry.canonical_id,
    source_title: entry.title,
    source_role_kind: entry.role_kind,
    aliases: entry.aliases,
    priority: existing.priority ?? entry.priority_score,
    lane: existing.lane ?? `INVENTORY.${entry.canonical_id}`,
    family: existing.family ?? entry.family,
    purpose: existing.purpose ?? `Compile a bounded task-shaped ${entry.title} specialist.`,
    required_layers: existing.required_layers ?? BASE_LAYERS,
    required_block_ids: existing.required_block_ids ?? FOUNDATION_BLOCKS,
    required_context_fields: existing.required_context_fields ?? BASE_CONTEXT,
    non_goals: existing.non_goals ?? BASE_NON_GOALS,
    selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
    external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
    lifecycle,
    compile_allowed: lifecycle !== "PLANNED",
    materialization: {status: "COMPILED_CANDIDATE", role_specific_block_required: false, package_ids: sortedUnique(existing.required_block_ids ?? [])},
    required_atomic_blocks: existing.required_atomic_blocks ?? [],
    required_standard_blocks: existing.required_standard_blocks ?? [],
    optional_block_ids: existing.optional_block_ids ?? [],
    reasons: existing.reasons ?? genericReasons(entry),
    source_requirements: entry.source_requirements,
    freshness_policy: entry.freshness_policy,
  });
}

function plannedRecipe(entry) {
  return finalizeRecipe({
    schema: "agentos.specialist_recipe.v1",
    version: 1,
    recipe_id: recipeIdFor(entry),
    recipe_version: "1.0.0",
    source_inventory_id: entry.canonical_id,
    source_title: entry.title,
    source_role_kind: entry.role_kind,
    aliases: entry.aliases,
    priority: entry.priority_score,
    lane: `INVENTORY.${entry.canonical_id}`,
    family: entry.family,
    purpose: `Compile a task-shaped ${entry.title} specialist only after applicability, authority, source, and context evidence are complete.`,
    required_layers: BASE_LAYERS,
    required_block_ids: FOUNDATION_BLOCKS,
    required_context_fields: BASE_CONTEXT,
    non_goals: BASE_NON_GOALS,
    selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
    external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
    lifecycle: "PLANNED",
    compile_allowed: false,
    materialization: {status: "PLANNED_RECIPE_ONLY", role_specific_block_required: true, package_ids: []},
    required_atomic_blocks: [],
    required_standard_blocks: [],
    optional_block_ids: [],
    reasons: genericReasons(entry),
    source_requirements: entry.source_requirements,
    freshness_policy: entry.freshness_policy,
  });
}

export function scaffoldRecipeCatalog({repositoryRoot = process.cwd(), writeGenerated = true} = {}) {
  const libraryRoot = path.join(repositoryRoot, "specialist-blocks");
  const compiled = compileSpecialistLibrary({repositoryRoot, writeGenerated: true});
  const inventoryEntries = compiled.inventory.entries.filter((entry) => entry.canonical_id.startsWith("inventory.")).sort((left, right) => left.canonical_id.localeCompare(right.canonical_id));
  const catalogPath = path.join(libraryRoot, "registry", "recipe-catalog.v1.json");
  const existingCatalog = readJson(catalogPath, "recipe catalog");
  const existingByRecipeId = new Map((existingCatalog.recipes ?? []).map((recipe) => [recipe.recipe_id, recipe]));
  const inventoryById = new Map(inventoryEntries.map((entry) => [entry.canonical_id, entry]));
  const recipes = [];
  const covered = new Set();

  for (const [recipeId, sourceInventoryId] of Object.entries(P0_SOURCE_BY_RECIPE)) {
    const entry = inventoryById.get(sourceInventoryId);
    if (!entry) throw new Error(`${recipeId} maps to missing inventory entry ${sourceInventoryId}`);
    const existing = existingByRecipeId.get(recipeId);
    if (!existing) throw new Error(`${recipeId} is missing from the preserved P0 recipe catalog`);
    recipes.push(normalizeExistingRecipe(existing, entry));
    covered.add(sourceInventoryId);
  }
  for (const entry of inventoryEntries) {
    if (covered.has(entry.canonical_id)) continue;
    recipes.push(plannedRecipe(entry));
    covered.add(entry.canonical_id);
  }
  recipes.sort((left, right) => left.source_inventory_id.localeCompare(right.source_inventory_id));
  if (recipes.length !== inventoryEntries.length) throw new Error(`recipe coverage mismatch: ${recipes.length} recipes for ${inventoryEntries.length} inventory roles`);
  if (new Set(recipes.map((recipe) => recipe.source_inventory_id)).size !== recipes.length) throw new Error("recipe source inventory IDs are not unique");
  if (new Set(recipes.map((recipe) => recipe.recipe_id)).size !== recipes.length) throw new Error("recipe IDs are not unique");

  const rawInventory = readJson(path.join(libraryRoot, "registry", "master-inventory.v1.json"), "master inventory");
  const aliases = rawInventory.alias_mappings.map((alias) => {
    const entry = inventoryEntries.find((candidate) => candidate.title === alias.canonical_title);
    if (!entry) throw new Error(`alias target is absent from recipe coverage: ${alias.canonical_title}`);
    const recipe = recipes.find((candidate) => candidate.source_inventory_id === entry.canonical_id);
    return {alias: alias.alias, source_inventory_id: entry.canonical_id, canonical_recipe_id: recipe.recipe_id, reason: alias.reason};
  }).sort((left, right) => left.alias.localeCompare(right.alias));

  const catalog = {
    schema: "agentos.specialist_recipe_catalog.v1",
    version: 1,
    status: "COMPILED_CANDIDATE",
    activation: "OFF",
    selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
    external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
    addressability_rule: "EVERY_RETAINED_MASTER_INVENTORY_ROLE_HAS_ONE_STABLE_RECIPE;_ALIASES_RESOLVE_TO_THE_CANONICAL_RECIPE",
    planned_recipe_rule: "PLANNED_RECIPES_ARE_NOT_COMPILEABLE_UNTIL_ROLE_SPECIFIC_BLOCK_SOURCE_LOCK_EVALUATION_AND_ADMISSION_EXIST",
    foundation_block_ids: FOUNDATION_BLOCKS,
    inventory: {raw_role_mentions: 625, unique_role_titles: inventoryEntries.length, alias_mappings: aliases.length},
    recipes,
    aliases,
    recipes_sha256: null,
  };
  catalog.recipes_sha256 = canonicalDigest(catalog);
  if (writeGenerated) fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalog = scaffoldRecipeCatalog({repositoryRoot: process.cwd(), writeGenerated: true});
  process.stdout.write(`${JSON.stringify({status: "PASS", recipes: catalog.recipes.length, aliases: catalog.aliases.length, recipes_sha256: catalog.recipes_sha256}, null, 2)}\n`);
}
