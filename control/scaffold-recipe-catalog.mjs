#!/usr/bin/env node

/*
 * Materialize one deterministic, project-agnostic recipe address for every
 * retained master-inventory role. A role profile is context, not authority
 * and never makes an otherwise unbuilt role spawnable. Only recipes whose
 * complete role-specific block closure exists may become compileable. This
 * preserves stable routing for the backlog without pretending a family router
 * and universal governance are a finished specialist.
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
  "external-project-governance",
  "task-role-authority",
  "exact-project-context",
]);

const BASE_CONTEXT = Object.freeze(["authority", "candidate", "custody", "proof", "request", "source_lock", "worktree"]);
const BASE_NON_GOALS = Object.freeze(["consumer Product writing", "activation", "deployment", "self-acceptance", "unrelated specialist scopes"]);

const FAMILY_ROUTER = Object.freeze({
  "ai-search-intelligent-systems": "specialist.ai.search-router",
  "data-database-analytics-migration": "specialist.data.router",
  "delivery-operations": "specialist.assurance-enterprise.router",
  "finance-accounting-commercial-controls": "specialist.finance.accounting-router",
  fmcsatransport: "specialist.regulatory.applicability-router",
  "law-regulation-standards-privacy-compliance": "specialist.regulatory.applicability-router",
  "product-client-experience": "specialist.product-client.router",
  security: "specialist.security.router",
  "software-language-runtime": "specialist.software-language-runtime.router",
  "three-dimensional-graphics-visual-assets": "specialist.graphics.industrial-3d-router",
});

const P0_SOURCE_BY_RECIPE = Object.freeze({
  "recipe.agent.bootstrap": "inventory.permanent-governance-control.bootstrap-project-initializer",
  "recipe.agent.project-controller": "inventory.permanent-governance-control.global-controller-15-minute-orchestrator",
  "recipe.agent.intent-regulator": "inventory.permanent-governance-control.intent-regulator-owner-voice",
  "recipe.agent.resource-scheduler": "inventory.permanent-governance-control.scheduler-hardware-resource-governor",
  "recipe.agent.runtime-deployment": "inventory.permanent-governance-control.runtime-deployment-operator",
  "recipe.agent.independent-auditor": "inventory.permanent-governance-control.independent-auditor",
});

const P4_RECIPE_OVERRIDES = Object.freeze({
  "inventory.product-client-experience.interaction-designer": {
    recipe_id: "recipe.client.product-interaction",
    required_block_ids: ["specialist.product-client.router", "specialist.product-client.product-interaction"],
    required_atomic_blocks: ["specialist.product-client.product-interaction"],
    required_standard_blocks: [],
    context_fields: ["interaction.scope", "interaction.states", "candidate.identity"],
    reason: "Select the named product-interaction atom under the product/client router.",
  },
  "inventory.product-client-experience.accessibility-wcag": {
    recipe_id: "recipe.client.accessibility-wcag",
    required_block_ids: ["specialist.product-client.router", "specialist.product-client.accessibility-wcag", "specialist.standard.wcag-2-2"],
    required_atomic_blocks: ["specialist.product-client.accessibility-wcag"],
    required_standard_blocks: ["specialist.standard.wcag-2-2"],
    context_fields: ["accessibility.scope", "accessibility.criteria", "standard.edition", "candidate.identity", "jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "content_scope"],
    reason: "Select the version-bound WCAG atom and reuse the immutable WCAG 2.2 standard block.",
  },
  "inventory.product-client-experience.responsive-web": {
    recipe_id: "recipe.client.responsive-web",
    required_block_ids: ["specialist.product-client.router", "specialist.product-client.responsive-web"],
    required_atomic_blocks: ["specialist.product-client.responsive-web"],
    required_standard_blocks: [],
    context_fields: ["web.scope", "web.viewports", "web.layout", "candidate.identity"],
    reason: "Select the named responsive-web atom under the product/client router.",
  },
  "inventory.software-language-runtime.swift-swiftui": {
    recipe_id: "recipe.client.ios-swiftui",
    required_block_ids: ["specialist.product-client.router", "specialist.product-client.ios-swiftui"],
    required_atomic_blocks: ["specialist.product-client.ios-swiftui"],
    required_standard_blocks: [],
    context_fields: ["client.platform", "client.swiftui", "client.lifecycle", "candidate.identity"],
    reason: "Select the named SwiftUI client atom under the product/client router.",
  },
  "inventory.software-language-runtime.kotlin": {
    recipe_id: "recipe.client.android-kotlin",
    required_block_ids: ["specialist.product-client.router", "specialist.product-client.android-kotlin"],
    required_atomic_blocks: ["specialist.product-client.android-kotlin"],
    required_standard_blocks: [],
    context_fields: ["client.platform", "client.kotlin", "client.compose", "candidate.identity"],
    reason: "Select the named Android/Kotlin client atom under the product/client router.",
  },
});

const P5_RECIPE_OVERRIDES = Object.freeze({
  "inventory.domain-workflows.field-job-workflow": {
    recipe_id: "recipe.domain.field-job-workflow",
    priority: "P5",
    required_block_ids: ["specialist.domain.workflow-router", "specialist.domain.field-job-workflow"],
    required_atomic_blocks: ["specialist.domain.field-job-workflow"],
    required_standard_blocks: [],
    context_fields: ["workflow.domain", "workflow.phase", "workflow.task", "workflow.dependencies", "candidate.identity"],
    reason: "Select the narrow field-job workflow atom under the domain workflow router; operational authority remains external.",
  },
  "inventory.domain-workflows.well-workflow": {
    recipe_id: "recipe.domain.well-workflow",
    priority: "P5",
    required_block_ids: ["specialist.domain.workflow-router", "specialist.domain.well-workflow"],
    required_atomic_blocks: ["specialist.domain.well-workflow"],
    required_standard_blocks: [],
    context_fields: ["workflow.domain", "workflow.phase", "workflow.task", "workflow.operation_scope", "candidate.identity"],
    reason: "Select the narrow well-workflow atom under the domain workflow router; engineering and safety authority remain external.",
  },
  "inventory.three-dimensional-graphics-visual-assets.industrial-equipment-modeler": {
    recipe_id: "recipe.graphics.industrial-3d",
    priority: "P5",
    required_block_ids: ["specialist.graphics.industrial-3d-router", "specialist.graphics.industrial-3d", "specialist.standard.gltf-2-0-1"],
    required_atomic_blocks: ["specialist.graphics.industrial-3d"],
    required_standard_blocks: ["specialist.standard.gltf-2-0-1"],
    context_fields: ["asset.domain", "asset.stage", "asset.identity", "asset.format", "asset.evidence", "candidate.identity", "standard.edition", "standard_version", "effective_date", "applicability_decision"],
    reason: "Select the industrial 3D atom and reuse the immutable glTF 2.0.1 standard block; engineering truth remains external.",
  },
  "inventory.ai-search-intelligent-systems.rag": {
    recipe_id: "recipe.ai.search-rag",
    priority: "P5",
    required_block_ids: ["specialist.ai.search-router", "specialist.ai.search-rag", "specialist.standard.nist-ai-rmf-1-0", "specialist.standard.nist-genai-profile-1-0"],
    required_atomic_blocks: ["specialist.ai.search-rag"],
    required_standard_blocks: ["specialist.standard.nist-ai-rmf-1-0", "specialist.standard.nist-genai-profile-1-0"],
    context_fields: ["ai.system_scope", "corpus.scope", "corpus.authority", "retrieval.task", "retrieval.evaluation", "candidate.identity", "standard.edition", "standard_version", "effective_date", "applicability_decision"],
    reason: "Select the smallest search/RAG evidence atom and reuse the exact NIST AI RMF and GenAI profile blocks; corpus/provider authority remains external.",
  },
  "inventory.fmcsatransport.fmcsa-applicability": {
    recipe_id: "recipe.regulatory.fmcsa-applicability",
    priority: "P5",
    required_block_ids: ["specialist.regulatory.applicability-router", "specialist.regulatory.fmcsa-applicability", "specialist.standard.fmcsa-part-390-2025"],
    required_atomic_blocks: ["specialist.regulatory.fmcsa-applicability"],
    required_standard_blocks: ["specialist.standard.fmcsa-part-390-2025"],
    context_fields: ["regulation.jurisdiction", "regulation.entity", "regulation.activity", "regulation.commerce", "regulation.vehicle", "regulation.exception", "regulation.version", "candidate.identity", "standard_version", "effective_date", "applicability_decision"],
    reason: "Select the version-bound FMCSA applicability atom and reuse the exact 2025 49 CFR Part 390 standard block; no legal conclusion is produced.",
  },
  "inventory.finance-accounting-commercial-controls.job-costing": {
    recipe_id: "recipe.finance.job-cost-accounting",
    priority: "P5",
    required_block_ids: ["specialist.finance.accounting-router", "specialist.finance.job-cost-accounting", "specialist.standard.gao-green-book-2025"],
    required_atomic_blocks: ["specialist.finance.job-cost-accounting"],
    required_standard_blocks: ["specialist.standard.gao-green-book-2025"],
    context_fields: ["accounting.entity", "accounting.objective", "accounting.period", "accounting.cost_object", "accounting.policy", "accounting.evidence", "candidate.identity", "standard.edition", "standard_version", "effective_date", "applicability_decision"],
    reason: "Select the narrow job-cost control atom and reuse the exact GAO Green Book 2025 standard block; professional accounting authority remains external.",
  },
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

function isProtectedMemoryLane(entry) {
  return entry.title === "Memory Systems (protected lane)";
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

function roleProfile(entry) {
  const profile = {
    schema: "agentos.specialist_role_profile.v1",
    version: 1,
    canonical_id: entry.canonical_id,
    title: entry.title,
    family: entry.family,
    subfamily: entry.subfamily,
    purpose: entry.purpose,
    triggers: sortedUnique(entry.triggers ?? []),
    exclusions: sortedUnique(entry.exclusions ?? []),
    source_requirements: sortedUnique(entry.source_requirements ?? []),
    freshness_policy: entry.freshness_policy,
    authority: "CONTEXT_ONLY;_NEVER_OVERRIDES_SELECTED_GATES_OR_EXTERNAL_PROJECT_AUTHORITY",
  };
  return {...profile, digest: canonicalDigest(profile)};
}

function contextualRecipe(entry) {
  if (isProtectedMemoryLane(entry)) {
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
      purpose: "Preserve a protected external lane identity without encoding portable Memory implementation or internal direction.",
      required_layers: ["agentos-governance", "exact-project-context"],
      required_block_ids: ["specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate"],
      required_context_fields: ["authority", "custody", "request"],
      non_goals: [...BASE_NON_GOALS, "Memory internals", "Memory implementation", "directing or modifying a protected Memory lane"],
      selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
      external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
      lifecycle: "NOT_APPLICABLE",
      compile_allowed: false,
      materialization: {status: "PROTECTED_EXTERNAL_LANE", role_specific_block_required: false, package_ids: []},
      required_atomic_blocks: [],
      required_standard_blocks: [],
      optional_block_ids: [],
      reasons: Object.fromEntries(["specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate"].map((blockId) => [blockId, "Preserve the protected external boundary without implementing or directing Memory internals."])),
      source_requirements: entry.source_requirements,
      freshness_policy: entry.freshness_policy,
    });
  }
  const familyRouter = FAMILY_ROUTER[entry.family] ?? null;
  const requiredBlockIds = sortedUnique([...FOUNDATION_BLOCKS, ...(familyRouter ? [familyRouter] : [])]);
  const profile = roleProfile(entry);
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
    required_block_ids: requiredBlockIds,
    required_context_fields: [...BASE_CONTEXT, "role_profile", "signals"],
    non_goals: BASE_NON_GOALS,
    selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
    external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
    lifecycle: "PLANNED",
    compile_allowed: false,
    materialization: {status: "PLANNED_RECIPE_ONLY", role_specific_block_required: true, package_ids: requiredBlockIds},
    required_atomic_blocks: [],
    required_standard_blocks: [],
    optional_block_ids: [],
    reasons: {...genericReasons(entry), ...(familyRouter ? {[familyRouter]: `Route ${entry.title} through the narrowest reusable ${entry.family} family gate; the immutable role profile supplies context but no authority.`} : {})},
    role_profile: profile,
    source_requirements: entry.source_requirements,
    freshness_policy: entry.freshness_policy,
  });
}

function compiledRecipe(entry, override) {
  const requiredBlockIds = sortedUnique([
    ...FOUNDATION_BLOCKS,
    ...override.required_block_ids,
    ...override.required_atomic_blocks,
    ...override.required_standard_blocks,
  ]);
  const reasons = {
    ...genericReasons(entry),
    ...Object.fromEntries(override.required_block_ids.map((blockId) => [blockId, override.reason])),
    ...Object.fromEntries(override.required_standard_blocks.map((blockId) => [blockId, "Reuse the exact content-addressed standard block; applicability remains an external overlay."])),
  };
  return finalizeRecipe({
    schema: "agentos.specialist_recipe.v1",
    version: 1,
    recipe_id: override.recipe_id,
    recipe_version: "1.0.0",
    source_inventory_id: entry.canonical_id,
    source_title: entry.title,
    source_role_kind: entry.role_kind,
    aliases: entry.aliases,
    priority: override.priority ?? "P4",
    lane: `${override.priority ?? "P4"}.${override.recipe_id}`,
    family: entry.family,
    purpose: `Compile a bounded ${entry.title} task-shaped agent from the smallest dependency-complete ${override.priority ?? "P4"} block set.`,
    required_layers: BASE_LAYERS,
    required_block_ids: requiredBlockIds,
    required_context_fields: [...BASE_CONTEXT, "signals", ...override.context_fields],
    non_goals: [...BASE_NON_GOALS, "product acceptance", "platform or standard scope expansion"],
    selection_rule: "SELECT_SMALLEST_DEPENDENCY_COMPLETE_SET;_ATOMIC_SPECIALISTS_BEAT_ROUTERS",
    external_overlay_rule: "PROJECT_GOVERNANCE_CONTEXT_CANDIDATE_WORKTREE_CUSTODY_TOOLS_RESOURCES_AND_PROOF_REMAIN_EXTERNAL",
    lifecycle: "CANDIDATE",
    compile_allowed: true,
    materialization: {status: "COMPILED_CANDIDATE", role_specific_block_required: false, package_ids: requiredBlockIds},
    required_atomic_blocks: override.required_atomic_blocks,
    required_standard_blocks: override.required_standard_blocks,
    optional_block_ids: [],
    reasons,
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
    const override = P5_RECIPE_OVERRIDES[entry.canonical_id] ?? P4_RECIPE_OVERRIDES[entry.canonical_id];
    recipes.push(override ? compiledRecipe(entry, override) : contextualRecipe(entry));
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
    planned_recipe_rule: "UNBUILT_ROLES_REMAIN_ADDRESSABLE_BUT_NON_COMPILEABLE_UNTIL_THE_COMPLETE_ROLE_SPECIFIC_AND_STANDARD_BLOCK_CLOSURE_IS_SOURCE_LOCKED_QA_EVALUATED_AND_ACCEPTED;_CONTEXT_NEVER_BECOMES_AUTHORITY",
    foundation_block_ids: FOUNDATION_BLOCKS,
    inventory: {raw_role_mentions: 627, unique_role_titles: inventoryEntries.length, alias_mappings: aliases.length},
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
