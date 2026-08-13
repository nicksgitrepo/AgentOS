#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileGeneralGovernanceLibrary,
  sha256,
} from "../control/governance-library.mjs";
import {
  CANONICAL_ROLE_GENERATION_SOURCE,
  compileRoleGovernanceCatalog,
  compileGovernanceArchitecture,
  defaultRoleDefinitions,
  generateRoleSpecificGovernanceLibrary,
  validateGovernanceArchitecture,
  validateRoleSpecificGovernanceLibrary,
} from "../control/role-governance-library.mjs";
import {
  CANONICAL_ROLE_DEFINITION_SOURCE,
  ROLE_DEFINITION_SOURCE_SHA256,
  roleDefinitionSourceDigest,
  validateRoleDefinitionSource,
} from "../control/governance-role-definitions.mjs";
import {
  compileQuestionTree,
  sha256 as questionTreeSha256,
} from "../control/question-tree.mjs";
import {
  compileControllerArchitectureRepairGate,
  compileControllerCampaignCandidate,
  validateControllerArchitectureRepairAdmission,
  validateControllerArchitectureRepairGate,
} from "../control/agentos-controller.mjs";
import {TASK_GATE_CATALOG_SHA256, TASK_GATE_QUESTIONS} from "../control/task-gate-questions.mjs";
import {CANONICAL_PERMANENT_ROLE_IDS, PERMANENT_ROLE_AUTHORITY_SHA256} from "../control/permanent-role-authority.mjs";

const DIGEST = "b".repeat(64);
const SOURCE_COMMIT = "commit-architecture-repair";
const SOURCE_TREE = "tree-architecture-repair";
const PLAN_DIGEST = "a".repeat(64);
const AUTHORITY = {authority_id: "TEST-AUTHORITY", version: "1", sha256: DIGEST};

function clause(questionId, root, surfaces) {
  return {
    clause_id: `${questionId}:CLAUSE`,
    question_id: questionId,
    root,
    parent_question_id: null,
    source_authority: structuredClone(AUTHORITY),
    applicability: {predicate_id: `${questionId}:APPLICABLE`, question: `Does ${questionId} apply?`},
    atomic_question: `Does ${questionId} produce its exact observable result?`,
    required_evidence: [`${questionId}:RESULT`],
    repair_owner_role: "NAMED_REPAIR_ROLE",
    invalidation_conditions: [`${questionId}:CHANGE`],
    blocking_scope: `${questionId}:SCOPE`,
    exception_policy: {allowed: true, granting_authority_ids: ["OWNER"], scope: `${questionId}:SCOPE`},
    materiality: "MATERIAL_PRODUCT_ACCEPTANCE",
    applies_to_surfaces: surfaces,
  };
}

const manifestBody = {
  schema: "governance.changed_surface_manifest.v1",
  checkpoint_id: "CHECKPOINT-ARCHITECTURE-001",
  originating_owner_role_id: "INTENT_REGULATOR",
  root_id: "WORKTREE-ARCHITECTURE-001",
  branch: "campaign/main",
  commit: SOURCE_COMMIT,
  tree: SOURCE_TREE,
  changed_paths: ["control/governance-library.mjs"],
  changed_surfaces: ["BACKEND_API", "UI"],
};
const changeManifest = {...manifestBody, manifest_sha256: questionTreeSha256(manifestBody)};
const governanceTree = compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "ARCHITECTURE-REPAIR-001",
  question_tree_version: "2.1rc",
  change_manifest: changeManifest,
  clauses: [
    clause("FR-GENERAL-001", "FUNCTION_REQUIREMENTS", ["ALWAYS"]),
    clause("DB-GENERAL-001", "DESIGN_BIBLE", ["UI"]),
    clause("SEC-GENERAL-001", "SECURITY", ["BACKEND_API"]),
  ],
});

const general = compileGeneralGovernanceLibrary({sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE, bootstrapPlanSha256: PLAN_DIGEST});
const generalIds = general.clauses.map((item) => item.clause_id);

validateRoleDefinitionSource(CANONICAL_ROLE_DEFINITION_SOURCE);
assert.equal(ROLE_DEFINITION_SOURCE_SHA256, roleDefinitionSourceDigest(CANONICAL_ROLE_DEFINITION_SOURCE));
const defaultDefinitions = defaultRoleDefinitions({
  governanceTree,
  workerLanes: [
    {lane_id: "UI", question_ids: ["FR-GENERAL-001"]},
    "BUILD",
  ],
});
assert.deepEqual(defaultDefinitions.map((role) => role.role_id), [
  "AGENT_SPAWNER_COMPILER",
  "CAMPAIGN_ORCHESTRATOR",
  "CONTROLLER",
  "INDEPENDENT_AUDITOR",
  "INTENT_REGULATOR",
  "RUNTIME",
  "SCHEDULER",
  "WORKER_BUILD",
  "WORKER_UI",
]);
assert.equal(CANONICAL_ROLE_DEFINITION_SOURCE.permanent_role_authority_sha256, PERMANENT_ROLE_AUTHORITY_SHA256);
assert.deepEqual(defaultDefinitions.filter((role) => role.role_scope === "PERSISTENT").map((role) => role.role_id), CANONICAL_PERMANENT_ROLE_IDS);
assert.equal(defaultDefinitions.find((role) => role.role_id === "CAMPAIGN_ORCHESTRATOR").role_scope, "CAMPAIGN");
assert.equal(defaultDefinitions.find((role) => role.role_id === "INDEPENDENT_AUDITOR").role_scope, "CAMPAIGN");
assert.equal(defaultDefinitions.find((role) => role.role_id === "WORKER_UI").role_kind, "ONE_LANE_WORKER");
assert.equal(defaultDefinitions.some((role) => /feature\s*agent/iu.test(`${role.role_id} ${role.public_name}`)), false);

const catalog = compileRoleGovernanceCatalog({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  governanceTree,
  generalLibrary: general,
  workerLanes: [{lane_id: "UI", question_ids: ["FR-GENERAL-001"]}, "BUILD"],
});
validateRoleSpecificGovernanceLibrary(catalog, {
  generalLibrary: general,
  governanceTree,
  roleDefinitionSource: CANONICAL_ROLE_DEFINITION_SOURCE,
});
assert.equal(catalog.generation_source, CANONICAL_ROLE_GENERATION_SOURCE);
assert.equal(catalog.task_gate_catalog_sha256, TASK_GATE_CATALOG_SHA256);
assert(catalog.roles.every((role) => role.universal_task_gate_question_ids.length === TASK_GATE_QUESTIONS.length));
assert.equal(catalog.role_definition_source_sha256, ROLE_DEFINITION_SOURCE_SHA256);
assert.deepEqual(catalog.roles.map((role) => role.role_id), [
  "AGENT_SPAWNER_COMPILER",
  "CAMPAIGN_ORCHESTRATOR",
  "CONTROLLER",
  "INDEPENDENT_AUDITOR",
  "INTENT_REGULATOR",
  "RUNTIME",
  "SCHEDULER",
  "WORKER_BUILD",
  "WORKER_UI",
]);
assert.equal(catalog.roles.find((role) => role.role_id === "WORKER_UI").generated_rules.length, 1);

const roleLibrary = generateRoleSpecificGovernanceLibrary({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  governanceTree,
  generalLibrary: general,
  roles: [
    {
      role_id: "BOUNDARY_REVIEWER",
      public_name: "Boundary Reviewer",
      question_ids: ["SEC-GENERAL-001"],
      shared_clause_ids: [generalIds.find((id) => id === "GENERAL_RECOVERY_BOUNDARIES"), "GENERAL_DELIVERY_CLOSURE", "GENERAL_RESPONSE_HANDOFF_GATING"].sort(),
    },
    {
      role_id: "INTENT_REGULATOR",
      public_name: "Intent Regulator",
      question_ids: ["DB-GENERAL-001", "FR-GENERAL-001"].sort(),
      shared_clause_ids: ["GENERAL_DELIVERY_CLOSURE", "GENERAL_INTENT_SCOPE", "GENERAL_RESPONSE_HANDOFF_GATING", "GENERAL_SOURCE_BINDING"].sort(),
    },
  ],
});
validateRoleSpecificGovernanceLibrary(roleLibrary, {generalLibrary: general, governanceTree});
assert.equal(roleLibrary.library_kind, "GENERATED_ROLE_SPECIFIC_GOVERNANCE");
assert.equal(roleLibrary.generation_source, "GENERAL_LIBRARY_PLUS_COMPILED_QUESTION_TREE");
assert.equal(roleLibrary.governance_tree_sha256, sha256(governanceTree));

const architecture = compileGovernanceArchitecture({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  governanceTree,
  generalLibrary: general,
  roleSpecificLibrary: roleLibrary,
});
validateGovernanceArchitecture(architecture, {generalLibrary: general, roleSpecificLibrary: roleLibrary, governanceTree});

const bootstrappedArchitecture = compileGovernanceArchitecture({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  governanceTree,
  generalLibrary: general,
  workerLanes: ["BOOTSTRAP"],
});
assert.equal(bootstrappedArchitecture.role_definition_source_sha256, ROLE_DEFINITION_SOURCE_SHA256);
validateGovernanceArchitecture(bootstrappedArchitecture);
const bootstrappedGate = compileControllerArchitectureRepairGate({
  projectId: "PROJECT-ARCHITECTURE-001",
  campaignId: "ARCHITECTURE-REPAIR-001",
  architecture: bootstrappedArchitecture,
});
validateControllerArchitectureRepairGate(bootstrappedGate, {architecture: bootstrappedArchitecture});

const gate = compileControllerArchitectureRepairGate({projectId: "PROJECT-ARCHITECTURE-001", campaignId: "ARCHITECTURE-REPAIR-001", architecture});
validateControllerArchitectureRepairGate(gate, {architecture});
const candidate = compileControllerCampaignCandidate({
  projectId: "PROJECT-ARCHITECTURE-001",
  campaignId: "ARCHITECTURE-REPAIR-001",
  campaignVersion: "1",
  policyEpoch: 1,
  policyStateSha256: DIGEST,
  ownerIntentSha256: DIGEST,
  acceptanceContractSha256: architecture.digest,
  modelPlanSha256: DIGEST,
  scopeSha256: DIGEST,
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
});
assert.equal(validateControllerArchitectureRepairAdmission({candidate, architectureGate: gate}).status, "ARCHITECTURE_REPAIR_ADMITTED");

const missingGeneral = structuredClone(architecture);
missingGeneral.general_library_sha256 = "c".repeat(64);
missingGeneral.digest = sha256({...missingGeneral, digest: null});
assert.throws(() => validateGovernanceArchitecture(missingGeneral, {generalLibrary: general, roleSpecificLibrary: roleLibrary, governanceTree}), /architecture general library differs|digest mismatch/u);

const missingTree = structuredClone(roleLibrary);
missingTree.governance_tree_sha256 = "c".repeat(64);
missingTree.digest = sha256({...missingTree, digest: null});
assert.throws(() => validateRoleSpecificGovernanceLibrary(missingTree, {generalLibrary: general, governanceTree}), /tree digest differs|digest mismatch/u);

const missingRoleSourceBinding = structuredClone(catalog);
missingRoleSourceBinding.role_definition_source_sha256 = "c".repeat(64);
missingRoleSourceBinding.digest = sha256({...missingRoleSourceBinding, digest: null});
assert.throws(() => validateRoleSpecificGovernanceLibrary(missingRoleSourceBinding, {
  generalLibrary: general,
  governanceTree,
  roleDefinitionSource: CANONICAL_ROLE_DEFINITION_SOURCE,
}), /role-definition source binding|digest mismatch/u);

const genericWorker = structuredClone(catalog);
genericWorker.roles.push({...genericWorker.roles[genericWorker.roles.length - 1], role_id: "FEATURE_AGENT", public_name: "Feature Agent"});
genericWorker.roles.sort((left, right) => Buffer.from(left.role_id).compare(Buffer.from(right.role_id)));
genericWorker.digest = sha256({...genericWorker, digest: null});
assert.throws(() => validateRoleSpecificGovernanceLibrary(genericWorker, {generalLibrary: general, governanceTree}), /generic Feature Agent|not admitted/u);

const hostileSource = structuredClone(CANONICAL_ROLE_DEFINITION_SOURCE);
hostileSource.role_templates[0].public_name = ["/", "Users", "/private/provider credential"].join("");
assert.throws(() => validateRoleDefinitionSource(hostileSource), /private, secret, provider-bound|not an admitted/u);
assert.throws(() => compileRoleGovernanceCatalog({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  governanceTree,
  generalLibrary: general,
  workerLanes: ["Feature Agent"],
}), /not an admitted named lane|private, secret, provider-bound/u);

const wrongContract = structuredClone(candidate);
wrongContract.acceptance_contract_sha256 = DIGEST;
wrongContract.candidate_sha256 = sha256({...wrongContract, candidate_sha256: null});
assert.throws(() => validateControllerArchitectureRepairAdmission({candidate: wrongContract, architectureGate: gate}), /acceptance contract/u);

process.stdout.write("PASS role governance library and controller gate\n");
