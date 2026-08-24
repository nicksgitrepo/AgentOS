#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const libraryRoot = path.join(root, "specialist-blocks");
const catalog = JSON.parse(fs.readFileSync(path.join(libraryRoot, "registry/recipe-catalog.v1.json"), "utf8"));
const readme = fs.readFileSync(path.join(libraryRoot, "README.md"), "utf8");
const roster = fs.readFileSync(path.join(libraryRoot, "registry/ROSTER.md"), "utf8");
const currentState = fs.readFileSync(path.join(libraryRoot, "CURRENT_STATE.md"), "utf8");

assert.equal(catalog.schema, "agentos.specialist_recipe_catalog.v1");
assert.equal(catalog.recipes.length, 621);
const candidateCount = catalog.recipes.filter((recipe) => recipe.lifecycle === "CANDIDATE").length;
const plannedCount = catalog.recipes.filter((recipe) => recipe.lifecycle === "PLANNED").length;
const protectedCount = catalog.recipes.filter((recipe) => recipe.lifecycle === "NOT_APPLICABLE").length;
assert.equal(candidateCount, 620);
assert.equal(plannedCount, 0);
assert.equal(protectedCount, 1);

const currentReadmeSection = readme.split("registry/recipe-catalog.v1.json", 2)[1]?.split("The read-only independent evaluator", 1)[0] ?? "";
assert.match(currentReadmeSection, /`621` recipes total, with `620` compileable candidates and zero\s+planned rows/u);
assert.doesNotMatch(currentReadmeSection, /`17` recipes|`603` explicit\s+planned/u);

const currentRosterSection = roster.split("The on-demand recipe catalog now covers", 2)[1]?.split("## Source-locked standard candidates", 1)[0] ?? "";
assert.match(currentRosterSection, /`620` recipes are `CANDIDATE` and compileable, with zero `PLANNED` rows/u);
assert.doesNotMatch(currentRosterSection, /`17` recipes|`603` recipes/u);

const currentStateSection = currentState.split("The on-demand recipe catalog is now complete", 2)[1]?.split("## Wave law", 1)[0] ?? "";
assert.match(currentStateSection, /^ for the retained backlog:/u);
assert.match(currentStateSection, /All `620` non-protected recipes are compileable/u);
assert.match(currentStateSection, /`17` are\s+package-backed `COMPILED_CANDIDATE` lanes/u);
assert.match(currentStateSection, /`603` are `CONTEXT_PROFILE_CANDIDATE` recipes/u);
assert.match(currentStateSection, /None are `PLANNED` or non-compileable/u);
assert.doesNotMatch(currentStateSection, /`603` are `PLANNED`|`603`.*non-compileable/u);

console.log(`specialist documentation parity verified: ${catalog.recipes.length} recipes, ${candidateCount} compileable, ${plannedCount} planned, ${protectedCount} protected`);
