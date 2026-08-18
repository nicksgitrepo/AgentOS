#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertCurrentRoleIdentity, compileLegacyRoleIdentityMigration, RETIRED_ROLE_IDS} from "../control/legacy-role-identity.mjs";
import {compileSpecialistLibrary} from "../control/specialist-block-compiler.mjs";
import {assertNoRetiredRecipeAuthority, scaffoldRecipeCatalog} from "../control/scaffold-recipe-catalog.mjs";

for (const legacyRoleId of RETIRED_ROLE_IDS) {
  const migration = compileLegacyRoleIdentityMigration({legacyRoleId});
  assert.equal(migration.live_authority, false);
  assert.equal(migration.automatic_mapping_forbidden, true);
  assert.deepEqual(migration.required_separation, ["AGENTOS_CONTROLLER", "AGENTOS.PRODUCT_OWNER"]);
  assert.throws(() => assertCurrentRoleIdentity(legacyRoleId), /Retired role identity/u);
}
assert.equal(assertCurrentRoleIdentity("AGENTOS_CONTROLLER"), "AGENTOS_CONTROLLER");
assert.equal(assertCurrentRoleIdentity("AGENTOS.PRODUCT_OWNER"), "AGENTOS.PRODUCT_OWNER");
assert.throws(() => compileLegacyRoleIdentityMigration({legacyRoleId: "AGENTOS_CONTROLLER"}), /not a recognized retired identity/u);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = compileSpecialistLibrary({repositoryRoot: root, writeGenerated: false});
assert.equal(library.records.some(({block}) => block.block_id === "specialist.control.intent-regulator"), false, "archived Intent Regulator package entered the current specialist roster");
assert.equal(library.roster.blocks.some((block) => block.block_id === "specialist.control.intent-regulator"), false, "archived Intent Regulator package entered the current roster output");
assert.equal(library.routing.routes.some((route) => route.select.includes("specialist.control.intent-regulator")), false, "archived Intent Regulator package entered current routing");
const catalog = scaffoldRecipeCatalog({repositoryRoot: root, writeGenerated: false});
assert.equal(assertNoRetiredRecipeAuthority(catalog), true);
assert.equal(catalog.recipes.some((recipe) => recipe.recipe_id === "recipe.agent.product-owner"), true, "Product Owner recipe is absent from current catalog");

for (const relativePath of [
  "specialist-blocks/registry/atomic-inventory.v1.json",
  "specialist-blocks/registry/integration-handoff.v1.json",
  "specialist-blocks/registry/master-inventory.materialized.v1.json",
  "specialist-blocks/registry/master-inventory.v1.json",
  "specialist-blocks/registry/priority-roster.v1.json",
  "specialist-blocks/registry/recipe-catalog.v1.json",
]) {
  const currentAuthority = JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  const serialized = JSON.stringify(currentAuthority);
  assert.equal(serialized.includes("AGENT.INTENT_REGULATOR"), false, `${relativePath} advertises the retired lane`);
  assert.equal(serialized.includes("recipe.agent.intent-regulator"), false, `${relativePath} exposes the retired recipe`);
  assert.equal(serialized.includes("inventory.permanent-governance-control.intent-regulator-owner-voice"), false, `${relativePath} exposes the retired inventory identity`);
  assert.equal(serialized.includes("specialist.control.intent-regulator"), false, `${relativePath} materializes the retired package`);
}

console.log("PASS legacy role identity: old conflated names are read-only migration inputs and cannot grant live Controller or Product Owner authority");
