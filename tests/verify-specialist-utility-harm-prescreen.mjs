#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {prescreenSpecialistUtilityHarm} from "../control/specialist-utility-harm-prescreen.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const receiptPath = path.join(root, "specialist-blocks/registry/utility-harm-prescreen.v1.json");
const schemaPath = path.join(root, "schemas/specialist-utility-harm-prescreen.v1.json");
const actual = prescreenSpecialistUtilityHarm({repositoryRoot: root});
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

assert.equal(schema.$id, "https://agentos.dev/schemas/specialist-utility-harm-prescreen.v1.json");
assert.equal(schema.properties.schema.const, actual.schema);
assert.equal(schema.properties.model_requirement.const, "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE");
assert.deepEqual(actual, receipt, "checked prescreen output must equal the committed receipt");
assert.equal(actual.status, "PRESCREEN_PENDING_EXTERNAL_REVIEW");
assert.equal(actual.packages_checked, 123);
assert.equal(actual.cases_checked, 2091);
assert.equal(actual.route_cases + actual.deny_cases + actual.escalate_cases, actual.cases_checked);
assert.equal(actual.passed_cases + actual.pending_cases, actual.cases_checked);
assert.equal(actual.failed_cases, 0);
assert.equal(actual.candidate.commit, "edd6cb5012b052445d623923d304ff7e1906ca51");
assert.equal(actual.candidate.tree, "44de1627c475f7c0d64becc5b82f63693dc7a9fb");
assert.equal(actual.utility_harm, "PENDING_EXTERNAL_AUTHORITY");
assert.equal(actual.independent_reviewer_required, true);
assert.equal(actual.self_acceptance, "FORBIDDEN");
assert.equal(actual.policy.flexible_classes.includes("duplicate_sibling_authority"), true);

console.log(`specialist utility/harm prescreen verified: ${actual.packages_checked} packages, ${actual.cases_checked} cases, ${actual.pending_cases} pending`);
