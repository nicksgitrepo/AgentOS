#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import {compileGeneralGovernanceLibrary} from "../control/governance-library.mjs";
import {
  CANONICAL_ROLE_DEFINITION_SOURCE,
  RETIRED_CURRENT_ROLE_IDS,
  validateRoleDefinitionSource,
} from "../control/governance-role-definitions.mjs";
import {
  compileRoleGovernanceCatalog,
  generateRoleSpecificGovernanceLibrary,
} from "../control/role-governance-library.mjs";
import {compileQuestionTree, sha256} from "../control/question-tree.mjs";

const permanentRegistry = JSON.parse(fs.readFileSync("specialist-blocks/registry/permanent-role-registry.v1.json", "utf8"));
const persistentRoleIds = [...permanentRegistry.canonical_order].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));

validateRoleDefinitionSource(CANONICAL_ROLE_DEFINITION_SOURCE);
assert.deepEqual(
  CANONICAL_ROLE_DEFINITION_SOURCE.role_templates.filter((role) => role.role_scope === "PERSISTENT").map((role) => role.role_id),
  persistentRoleIds,
);
assert.equal(CANONICAL_ROLE_DEFINITION_SOURCE.role_templates.some((role) => RETIRED_CURRENT_ROLE_IDS.includes(role.role_id)), false);

const manifestBody = {
  schema: "governance.changed_surface_manifest.v1",
  checkpoint_id: "ROLE-IDENTITY-SPLIT",
  originating_owner_role_id: "AGENTOS.PRODUCT_OWNER",
  root_id: "PORTABLE-ROLE-LIBRARY",
  branch: "candidate",
  commit: "role-identity-source",
  tree: "role-identity-tree",
  changed_paths: ["control/governance-role-definitions.mjs"],
  changed_surfaces: ["BACKEND_API"],
};
const authority = {authority_id: "PORTABLE-AUTHORITY", version: "1", sha256: "a".repeat(64)};
const questionId = "FR-ROLE-IDENTITY-001";
const governanceTree = compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "ROLE-IDENTITY-SPLIT",
  question_tree_version: "2.1rc",
  change_manifest: {...manifestBody, manifest_sha256: sha256(manifestBody)},
  clauses: [{
    clause_id: `${questionId}:CLAUSE`,
    question_id: questionId,
    root: "FUNCTION_REQUIREMENTS",
    parent_question_id: null,
    source_authority: authority,
    applicability: {predicate_id: `${questionId}:APPLICABLE`, question: "Does the role identity split apply?"},
    atomic_question: "Does current governance use distinct Controller and Product Owner identities?",
    required_evidence: [`${questionId}:RESULT`],
    repair_owner_role: "AGENTOS.SPAWNER",
    invalidation_conditions: [`${questionId}:CHANGE`],
    blocking_scope: `${questionId}:SCOPE`,
    exception_policy: {allowed: true, granting_authority_ids: ["AGENTOS.PRODUCT_OWNER"], scope: `${questionId}:SCOPE`},
    materiality: "MATERIAL_PRODUCT_ACCEPTANCE",
    applies_to_surfaces: ["ALWAYS"],
  }],
});
const generalLibrary = compileGeneralGovernanceLibrary({
  sourceCommit: "role-identity-source",
  sourceTree: "role-identity-tree",
  bootstrapPlanSha256: "b".repeat(64),
});
const catalog = compileRoleGovernanceCatalog({
  sourceCommit: "role-identity-source",
  sourceTree: "role-identity-tree",
  bootstrapPlanSha256: "b".repeat(64),
  governanceTree,
  generalLibrary,
  workerLanes: ["TEST"],
});
assert.deepEqual(catalog.roles.filter((role) => role.role_scope === "PERSISTENT").map((role) => role.role_id), persistentRoleIds);
assert.equal(catalog.roles.some((role) => RETIRED_CURRENT_ROLE_IDS.includes(role.role_id)), false);

assert.throws(() => generateRoleSpecificGovernanceLibrary({
  sourceCommit: "role-identity-source",
  sourceTree: "role-identity-tree",
  bootstrapPlanSha256: "b".repeat(64),
  governanceTree,
  generalLibrary,
  roles: [{
    role_id: "INTENT_REGULATOR",
    public_name: "Retired Intent Role",
    role_scope: "PERSISTENT",
    role_kind: "NAMED_ROLE",
    lane_id: null,
    question_ids: [questionId],
    shared_clause_ids: ["GENERAL_DELIVERY_CLOSURE", "GENERAL_RESPONSE_HANDOFF_GATING"],
  }],
}), /retired role INTENT_REGULATOR/u);

for (const schemaPath of ["schemas/governance-binding.v1.json", "schemas/project-general-library.v1.json"]) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$defs.ownership.properties.owner_role.const, "AGENTOS.PRODUCT_OWNER");
  assert.equal(schema.$defs.ownership.properties.authoring_role.const, "AGENTOS.SPAWNER");
}

process.stdout.write("PASS governance role identity split\n");
