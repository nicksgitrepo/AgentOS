#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {
  activateGovernanceBinding,
  appendProjectGovernanceHistory,
  canonicalDigest,
  compileBaseGeneralLibrary,
  compileBaseRoleLibrary,
  compileGeneratedProjectRoleLibrary,
  compileLegacyGeneratedTaskRolePacket,
  compileGovernanceBinding,
  compileLegacyLayeredGovernanceContract,
  compileProjectGeneralLibrary,
  compileProjectHistoryEntry,
  GovernanceConflictError,
  GovernanceValidationError,
  prepareGovernanceUpgrade,
  rebaseProjectGeneralLibrary,
  transitionGovernanceRecord,
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateGeneratedProjectRoleLibrary,
  validateLegacyGeneratedTaskRolePacket,
  validateGovernanceBinding,
  validateLegacyLayeredGovernanceContract,
  validateGovernanceMigration,
  validateProjectGeneralLibrary,
} from "../control/four-library-governance.mjs";

const digest = (label) => canonicalDigest({fixture: label});
const sorted = (items) => [...items].sort((left, right) => Buffer.from(left).compare(Buffer.from(right, "utf8")));
const testRoot = path.dirname(fileURLToPath(import.meta.url));

for (const schemaFile of [
  "base-general-library.v1.json",
  "base-role-library.v1.json",
  "project-general-library.v1.json",
  "generated-project-role-library.v1.json",
  "governance-binding.v1.json",
  "governance-migration.v1.json",
  "governance-conflict.v1.json",
  "project-governance-history-entry.v1.json",
  "layered-governance.v1.json",
  "generated-task-role-packet.v1.json",
]) {
  const schema = JSON.parse(fs.readFileSync(path.join(testRoot, "..", "schemas", schemaFile), "utf8"));
  assert.equal(typeof schema.$id, "string", `${schemaFile} has no schema ID`);
  assert.equal(schema.type, "object", `${schemaFile} is not an object schema`);
}

function graph(graph_id, path_ref, domain, label) {
  return {
    graph_id,
    path_ref,
    graph_sha256: digest(label),
    domain,
    precedence_class: "BASE_HARD",
  };
}

function projectGraph(graph_id, path_ref, domain, label) {
  return {
    graph_id,
    path_ref,
    graph_sha256: digest(label),
    domain,
    precedence_class: "PROJECT_ADDITIVE",
  };
}

function makeBaseGeneral(releaseLabel = "release-a") {
  return compileBaseGeneralLibrary({
    release_identity: {
      version: "3.0.0-rc.1",
      source_commit: `${releaseLabel}-commit`,
      source_tree: `${releaseLabel}-tree`,
      release_digest: digest(`${releaseLabel}-release`),
    },
    source: {
      general_manifest_digest: digest(`${releaseLabel}-general-manifest`),
      question_catalog_digest: digest(`${releaseLabel}-question-catalog`),
      coverage_manifest_digest: digest(`${releaseLabel}-coverage`),
    },
    general_graph_bindings: [
      graph("GENERAL_CORE", "release/general/core.gate", "CORE", `${releaseLabel}-core`),
      graph("GENERAL_EVIDENCE", "release/general/evidence.gate", "EVIDENCE", `${releaseLabel}-evidence`),
      graph("GENERAL_SECURITY", "release/general/security.gate", "SECURITY", `${releaseLabel}-security`),
    ],
  });
}

function makeRoleInputs() {
  const role_graph_bindings = [
    {graph_id: "LANE_ALPHA", path_ref: "release/lanes/alpha.gate", graph_sha256: digest("lane-alpha"), scope_role_id: "WORKER_ALPHA", lane_id: "ALPHA"},
    {graph_id: "LANE_BETA", path_ref: "release/lanes/beta.gate", graph_sha256: digest("lane-beta"), scope_role_id: "WORKER_BETA", lane_id: "BETA"},
    {graph_id: "ROLE_AUDIT", path_ref: "release/roles/audit.gate", graph_sha256: digest("role-audit"), scope_role_id: "INDEPENDENT_AUDITOR", lane_id: null},
    {graph_id: "ROLE_ORCHESTRATION", path_ref: "release/roles/orchestration.gate", graph_sha256: digest("role-orchestration"), scope_role_id: "CAMPAIGN_ORCHESTRATOR", lane_id: null},
    {graph_id: "ROLE_REGULATOR", path_ref: "release/roles/regulator.gate", graph_sha256: digest("role-regulator"), scope_role_id: "INTENT_REGULATOR", lane_id: null},
    {graph_id: "ROLE_RUNTIME", path_ref: "release/roles/runtime.gate", graph_sha256: digest("role-runtime"), scope_role_id: "RUNTIME", lane_id: null},
  ];
  const general = ["GENERAL_CORE", "GENERAL_EVIDENCE", "GENERAL_SECURITY"];
  const prohibited = ["SCOPE_EXPANSION", "SELF_ACCEPTANCE"];
  const role = ({role_id, display_name, role_kind, lifetime, lane_id = null, role_graph_id, allowed_authority, required_evidence}) => ({
    role_id,
    display_name,
    role_kind,
    lifetime,
    lane_id,
    graph_ids: sorted([...general, role_graph_id]),
    allowed_authority: sorted(allowed_authority),
    prohibited_authority: prohibited,
    required_evidence: sorted(required_evidence),
  });
  const role_definitions = [
    role({role_id: "CAMPAIGN_ORCHESTRATOR", display_name: "Campaign Orchestrator", role_kind: "CAMPAIGN_ORCHESTRATOR", lifetime: "CAMPAIGN", role_graph_id: "ROLE_ORCHESTRATION", allowed_authority: ["CAMPAIGN_ROUTING"], required_evidence: ["CAMPAIGN_RECEIPT"]}),
    role({role_id: "INDEPENDENT_AUDITOR", display_name: "Independent Auditor", role_kind: "INDEPENDENT_AUDITOR", lifetime: "CAMPAIGN", role_graph_id: "ROLE_AUDIT", allowed_authority: ["INDEPENDENT_CHECK"], required_evidence: ["AUDIT_RECEIPT"]}),
    role({role_id: "INTENT_REGULATOR", display_name: "Intent Regulator", role_kind: "INTENT_REGULATOR", lifetime: "PERSISTENT", role_graph_id: "ROLE_REGULATOR", allowed_authority: ["PROJECT_GOVERNANCE_REVIEW"], required_evidence: ["OWNER_DECISION"]}),
    role({role_id: "RUNTIME", display_name: "Runtime", role_kind: "RUNTIME", lifetime: "PERSISTENT", role_graph_id: "ROLE_RUNTIME", allowed_authority: ["HOST_READBACK"], required_evidence: ["RUNTIME_RECEIPT"]}),
    role({role_id: "WORKER_ALPHA", display_name: "Alpha Worker", role_kind: "NAMED_LANE_WORKER", lifetime: "CAMPAIGN", lane_id: "ALPHA", role_graph_id: "LANE_ALPHA", allowed_authority: ["LANE_EXECUTION"], required_evidence: ["LANE_RECEIPT"]}),
    role({role_id: "WORKER_BETA", display_name: "Beta Worker", role_kind: "NAMED_LANE_WORKER", lifetime: "CAMPAIGN", lane_id: "BETA", role_graph_id: "LANE_BETA", allowed_authority: ["LANE_EXECUTION"], required_evidence: ["LANE_RECEIPT"]}),
  ];
  return {
    source: {
      lane_manifest_digest: digest("lane-manifest"),
      role_selection_digest: digest("role-selection"),
      role_definition_source_digest: digest("role-definition-source"),
    },
    role_graph_bindings,
    role_definitions,
  };
}

function makeBaseRole(baseGeneral, releaseLabel = "release-a", previous = null) {
  const inputs = makeRoleInputs();
  return compileBaseRoleLibrary({
    baseGeneralLibrary: baseGeneral,
    source: {
      lane_manifest_digest: digest(`${releaseLabel}-lane-manifest`),
      role_selection_digest: digest(`${releaseLabel}-role-selection`),
      role_definition_source_digest: digest(`${releaseLabel}-role-definition-source`),
    },
    role_graph_bindings: inputs.role_graph_bindings,
    role_definitions: inputs.role_definitions,
    previous,
  });
}

function makeProjectGeneral(baseGeneral, baseRole, previous = null) {
  return compileProjectGeneralLibrary({
    project_id: "PROJECT_ALPHA",
    baseGeneralLibrary: baseGeneral,
    baseRoleLibrary: baseRole,
    project_context_revision: "context-revision-001",
    project_context_digest: digest("project-context-001"),
    policy_state_digest: digest("policy-state-001"),
    source_revision: "project-source-001",
    project_graph_bindings: [
      projectGraph("PROJECT_ACCEPTANCE", "control/project/acceptance.gate", "ACCEPTANCE", "project-acceptance"),
      projectGraph("PROJECT_SECURITY", "control/project/security.gate", "SECURITY", "project-security"),
    ],
    default_graph_ids: ["PROJECT_ACCEPTANCE"],
    role_overlays: [
      {
        role_id: "ALL_ROLES",
        graph_ids: ["PROJECT_SECURITY"],
        additional_prohibited_authority: ["UNAUTHORIZED_EXTERNAL_ACTION"],
        additional_required_evidence: ["PROJECT_REVIEW"],
      },
      {
        role_id: "WORKER_ALPHA",
        graph_ids: ["PROJECT_ACCEPTANCE"],
        additional_prohibited_authority: [],
        additional_required_evidence: ["PROJECT_ACCEPTANCE"],
      },
    ],
    previous,
  });
}

function makeStack(releaseLabel = "release-a") {
  const baseGeneral = makeBaseGeneral(releaseLabel);
  const baseRole = makeBaseRole(baseGeneral, releaseLabel);
  const projectGeneral = makeProjectGeneral(baseGeneral, baseRole);
  const generatedProjectRole = compileGeneratedProjectRoleLibrary({
    baseGeneralLibrary: baseGeneral,
    baseRoleLibrary: baseRole,
    projectGeneralLibrary: projectGeneral,
  });
  const binding = compileGovernanceBinding({
    project_id: "PROJECT_ALPHA",
    policy_epoch: 1,
    baseGeneralLibrary: baseGeneral,
    baseRoleLibrary: baseRole,
    projectGeneralLibrary: projectGeneral,
    generatedProjectRoleLibrary: generatedProjectRole,
  });
  return {baseGeneral, baseRole, projectGeneral, generatedProjectRole, binding};
}

const first = makeStack();
const second = makeStack();
assert.equal(first.baseGeneral.digest, second.baseGeneral.digest, "base general compilation is not deterministic");
assert.equal(first.baseRole.digest, second.baseRole.digest, "base role compilation is not deterministic");
assert.equal(first.projectGeneral.digest, second.projectGeneral.digest, "project general compilation is not deterministic");
assert.equal(first.generatedProjectRole.digest, second.generatedProjectRole.digest, "generated project role compilation is not deterministic");
assert.equal(first.binding.digest, second.binding.digest, "governance binding compilation is not deterministic");

validateBaseGeneralLibrary(first.baseGeneral);
validateBaseRoleLibrary(first.baseRole, {baseGeneralLibrary: first.baseGeneral});
validateProjectGeneralLibrary(first.projectGeneral, {baseGeneralLibrary: first.baseGeneral, baseRoleLibrary: first.baseRole});
validateGeneratedProjectRoleLibrary(first.generatedProjectRole, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
  projectGeneralLibrary: first.projectGeneral,
});
validateGovernanceBinding(first.binding, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
  projectGeneralLibrary: first.projectGeneral,
  generatedProjectRoleLibrary: first.generatedProjectRole,
});

const taskPacket = compileLegacyGeneratedTaskRolePacket({
  generatedProjectRoleLibrary: first.generatedProjectRole,
  roleId: "WORKER_ALPHA",
  laneId: "ALPHA",
  taskIdSha256: digest("task-alpha"),
  taskKind: "AUDIT",
  applicableQuestionIds: ["TASK-START-001", "TASK-CHANGE-008", "TASK-PROOF-011"],
});
validateLegacyGeneratedTaskRolePacket(taskPacket, {generatedProjectRoleLibrary: first.generatedProjectRole});
assert.equal(taskPacket.status, "PREPARED_NOT_ACTIVATED");
assert.equal(taskPacket.role_id, "WORKER_ALPHA");
assert.deepEqual(taskPacket.applicable_question_ids, ["TASK-CHANGE-008", "TASK-PROOF-011", "TASK-START-001"]);

const layeredContract = compileLegacyLayeredGovernanceContract({
  projectContractSha256: digest("project-contract"),
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
  projectGeneralLibrary: first.projectGeneral,
  generatedProjectRoleLibrary: first.generatedProjectRole,
});
validateLegacyLayeredGovernanceContract(layeredContract, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
  projectGeneralLibrary: first.projectGeneral,
  generatedProjectRoleLibrary: first.generatedProjectRole,
});
assert.deepEqual(layeredContract.layer_order, ["SHARED_GENERAL", "BASE_ROLE", "PERSISTENT_PROJECT", "GENERATED_TASK_ROLE"]);
assert.equal(layeredContract.activation.active, false);

assert.equal(first.baseRole.role_packets.length, 6, "base role packet inventory is incomplete");
assert.equal(first.binding.status, "COMPILED", "binding compilation must not imply preparation or activation");
assert.deepEqual(first.baseRole.role_packets.filter((packet) => packet.lifetime === "PERSISTENT").map((packet) => packet.role_id), ["INTENT_REGULATOR", "RUNTIME"]);
assert.deepEqual(first.generatedProjectRole.role_packets.find((packet) => packet.role_id === "WORKER_ALPHA").project_graph_ids, ["PROJECT_ACCEPTANCE", "PROJECT_SECURITY"]);
assert(first.generatedProjectRole.role_packets.every((packet) => packet.allowed_authority.every((item) => first.baseRole.role_packets.find((base) => base.role_id === packet.role_id && base.lane_id === packet.lane_id).allowed_authority.includes(item))), "generated role expanded authority");
assert(first.generatedProjectRole.role_packets.find((packet) => packet.role_id === "WORKER_ALPHA").prohibited_authority.includes("UNAUTHORIZED_EXTERNAL_ACTION"), "project prohibition was not composed");

const forgedOwnership = structuredClone(first.baseGeneral);
forgedOwnership.ownership.owner_role = "PROJECT_OWNER";
forgedOwnership.digest = canonicalDigest({...forgedOwnership, digest: null});
assert.throws(() => validateBaseGeneralLibrary(forgedOwnership), /ownership\.owner_role/u);

const forgedLifecycle = structuredClone(first.projectGeneral);
forgedLifecycle.status = "INDEPENDENTLY_CHECKED";
forgedLifecycle.digest = canonicalDigest({...forgedLifecycle, digest: null});
assert.throws(() => validateProjectGeneralLibrary(forgedLifecycle, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
}), /independent(?: check|_check)[ _]digest/u);

const checkedProjectGeneral = transitionGovernanceRecord(first.projectGeneral, {
  nextStatus: "INDEPENDENTLY_CHECKED",
  independentCheckDigest: digest("project-independent-check"),
});
const acceptedProjectGeneral = transitionGovernanceRecord(checkedProjectGeneral, {
  nextStatus: "OWNER_ACCEPTED",
  ownerDecisionDigest: digest("project-owner-decision"),
});
assert.equal(acceptedProjectGeneral.status, "OWNER_ACCEPTED");
assert.equal(acceptedProjectGeneral.lineage.supersedes, checkedProjectGeneral.digest);
assert.throws(
  () => transitionGovernanceRecord(first.projectGeneral, {nextStatus: "ACTIVE", ownerDecisionDigest: digest("owner-only")}),
  /transition is not allowed/u,
);

const collisionBindings = [
  projectGraph("GENERAL_CORE", "control/project/collision.gate", "COLLISION", "collision"),
];
assert.throws(
  () => compileProjectGeneralLibrary({
    project_id: "PROJECT_ALPHA",
    baseGeneralLibrary: first.baseGeneral,
    baseRoleLibrary: first.baseRole,
    project_context_revision: "context-revision-002",
    project_context_digest: digest("project-context-002"),
    policy_state_digest: digest("policy-state-002"),
    source_revision: "project-source-002",
    project_graph_bindings: collisionBindings,
  }),
  (error) => error instanceof GovernanceConflictError && error.code === "PROJECT_GRAPH_ID_COLLISION",
);

const baseRolePathCollisionInputs = makeRoleInputs();
baseRolePathCollisionInputs.role_graph_bindings[0].path_ref = first.baseGeneral.general_graph_bindings[0].path_ref;
assert.throws(
  () => compileBaseRoleLibrary({
    baseGeneralLibrary: first.baseGeneral,
    source: baseRolePathCollisionInputs.source,
    role_graph_bindings: baseRolePathCollisionInputs.role_graph_bindings,
    role_definitions: baseRolePathCollisionInputs.role_definitions,
  }),
  (error) => error instanceof GovernanceConflictError && error.code === "BASE_ROLE_GRAPH_PATH_COLLISION",
);

const projectPathCollision = [
  projectGraph("PROJECT_ALIAS", first.baseGeneral.general_graph_bindings[0].path_ref, "COLLISION", "project-path-collision"),
];
assert.throws(
  () => compileProjectGeneralLibrary({
    project_id: "PROJECT_ALPHA",
    baseGeneralLibrary: first.baseGeneral,
    baseRoleLibrary: first.baseRole,
    project_context_revision: "context-revision-path-collision",
    project_context_digest: digest("project-context-path-collision"),
    policy_state_digest: digest("policy-state-path-collision"),
    source_revision: "project-source-path-collision",
    project_graph_bindings: projectPathCollision,
  }),
  (error) => error instanceof GovernanceConflictError && error.code === "PROJECT_GRAPH_PATH_COLLISION",
);

const forgedRolePathCollision = structuredClone(first.baseRole);
forgedRolePathCollision.role_graph_bindings[0].path_ref = first.baseGeneral.general_graph_bindings[0].path_ref;
forgedRolePathCollision.digest = canonicalDigest({...forgedRolePathCollision, digest: null});
assert.throws(
  () => validateBaseRoleLibrary(forgedRolePathCollision, {baseGeneralLibrary: first.baseGeneral}),
  /base role graph path collides/u,
);

const duplicateOverlayProject = makeProjectGeneral(first.baseGeneral, first.baseRole);
duplicateOverlayProject.role_overlays.push(structuredClone(duplicateOverlayProject.role_overlays[0]));
duplicateOverlayProject.role_overlays.sort((left, right) => Buffer.from(left.role_id).compare(Buffer.from(right.role_id)));
duplicateOverlayProject.digest = canonicalDigest({...duplicateOverlayProject, digest: null});
assert.throws(
  () => validateProjectGeneralLibrary(duplicateOverlayProject, {baseGeneralLibrary: first.baseGeneral, baseRoleLibrary: first.baseRole}),
  /duplicate role overlay/u,
);
assert.throws(
  () => compileProjectGeneralLibrary({
    project_id: "PROJECT_ALPHA",
    baseGeneralLibrary: first.baseGeneral,
    baseRoleLibrary: first.baseRole,
    project_context_revision: "context-revision-003",
    project_context_digest: digest("project-context-003"),
    policy_state_digest: digest("policy-state-003"),
    source_revision: "project-source-003",
    project_graph_bindings: first.projectGeneral.project_graph_bindings,
    default_graph_ids: first.projectGeneral.default_graph_ids,
    role_overlays: duplicateOverlayProject.role_overlays,
  }),
  (error) => error instanceof GovernanceConflictError && error.code === "DUPLICATE_ROLE_OVERLAY",
);

const unsafeProject = makeProjectGeneral(first.baseGeneral, first.baseRole);
unsafeProject.project_graph_bindings[0].path_ref = "/not-safe/source.gate";
unsafeProject.digest = canonicalDigest({...unsafeProject, digest: null});
assert.throws(() => validateProjectGeneralLibrary(unsafeProject, {baseGeneralLibrary: first.baseGeneral, baseRoleLibrary: first.baseRole}), /must be relative/u);

const nonCanonicalProject = makeProjectGeneral(first.baseGeneral, first.baseRole);
nonCanonicalProject.project_graph_bindings[0].path_ref = "control\\project\\source.gate";
nonCanonicalProject.digest = canonicalDigest({...nonCanonicalProject, digest: null});
assert.throws(() => validateProjectGeneralLibrary(nonCanonicalProject, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
}), /forward slashes/u);

assert.throws(
  () => compileProjectGeneralLibrary({
    project_id: "PROJECT_BETA",
    baseGeneralLibrary: first.baseGeneral,
    baseRoleLibrary: first.baseRole,
    project_context_revision: "context-revision-beta",
    project_context_digest: digest("project-context-beta"),
    policy_state_digest: digest("policy-state-beta"),
    source_revision: "project-source-beta",
    project_graph_bindings: first.projectGeneral.project_graph_bindings,
    default_graph_ids: first.projectGeneral.default_graph_ids,
    role_overlays: first.projectGeneral.role_overlays,
    previous: first.projectGeneral,
  }),
  /belongs to another project/u,
);

const tamperedGenerated = structuredClone(first.generatedProjectRole);
tamperedGenerated.base_role_library_digest = digest("wrong-parent");
tamperedGenerated.digest = canonicalDigest({...tamperedGenerated, digest: null});
assert.throws(() => validateGeneratedProjectRoleLibrary(tamperedGenerated, {
  baseGeneralLibrary: first.baseGeneral,
  baseRoleLibrary: first.baseRole,
  projectGeneralLibrary: first.projectGeneral,
}), /base-role binding differs/u);

const replacementGeneral = makeBaseGeneral("release-b");
const replacementRole = makeBaseRole(replacementGeneral, "release-b");
const replacementPathGeneral = makeBaseGeneral("release-path");
replacementPathGeneral.general_graph_bindings[0].path_ref = first.projectGeneral.project_graph_bindings[0].path_ref;
replacementPathGeneral.digest = canonicalDigest({...replacementPathGeneral, digest: null});
const replacementPathRole = makeBaseRole(replacementPathGeneral, "release-path");
assert.throws(
  () => rebaseProjectGeneralLibrary({
    projectGeneralLibrary: first.projectGeneral,
    replacementBaseGeneralLibrary: replacementPathGeneral,
    replacementBaseRoleLibrary: replacementPathRole,
  }),
  (error) => error instanceof GovernanceConflictError && error.code === "PROJECT_GRAPH_PATH_COLLISION_AFTER_UPGRADE",
);
const projectGeneralBeforeUpgrade = JSON.stringify(first.projectGeneral);
const upgrade = prepareGovernanceUpgrade({
  currentBinding: first.binding,
  currentBaseGeneralLibrary: first.baseGeneral,
  currentBaseRoleLibrary: first.baseRole,
  currentProjectGeneralLibrary: first.projectGeneral,
  currentGeneratedProjectRoleLibrary: first.generatedProjectRole,
  replacementBaseGeneralLibrary: replacementGeneral,
  replacementBaseRoleLibrary: replacementRole,
  policy_epoch: 2,
  mode: "KEEP_PROJECT_GOVERNANCE",
  projectHistoryDigest: digest("history-before-upgrade"),
});
validateGovernanceMigration(upgrade.migration);
assert.equal(upgrade.migration.status, "READY");
assert.equal(upgrade.migration.preservation.project_general_library_digest, first.projectGeneral.digest);
assert.equal(upgrade.migration.preservation.source_remains_unmodified, true);
assert.equal(upgrade.candidate.lineage.supersedes, first.binding.digest);
assert.equal(upgrade.projectGeneral.lineage.supersedes, first.projectGeneral.digest);
assert.equal(upgrade.generatedProjectRole.lineage.supersedes, first.generatedProjectRole.digest);
assert.notEqual(upgrade.projectGeneral.digest, first.projectGeneral.digest);
assert.equal(JSON.stringify(first.projectGeneral), projectGeneralBeforeUpgrade, "upgrade preparation overwrote project-owned governance");

const reset = prepareGovernanceUpgrade({
  currentBinding: first.binding,
  currentBaseGeneralLibrary: first.baseGeneral,
  currentBaseRoleLibrary: first.baseRole,
  currentProjectGeneralLibrary: first.projectGeneral,
  currentGeneratedProjectRoleLibrary: first.generatedProjectRole,
  replacementBaseGeneralLibrary: replacementGeneral,
  replacementBaseRoleLibrary: replacementRole,
  policy_epoch: 2,
  mode: "RESET_GOVERNANCE_CLEAN",
});
assert.equal(reset.candidate, null, "reset mode produced an active candidate");
assert.equal(reset.migration.preservation.project_general_library_digest, first.projectGeneral.digest);
assert.equal(reset.migration.preservation.source_remains_unmodified, true);

assert.throws(() => activateGovernanceBinding(first.binding, {
  ownerDecisionDigest: digest("owner-decision-before-check"),
  independentCheckDigest: digest("independent-check-before-check"),
}), /transition is not allowed/u);
const checkedBinding = transitionGovernanceRecord(first.binding, {
  nextStatus: "INDEPENDENTLY_CHECKED",
  independentCheckDigest: digest("binding-independent-check"),
});
const acceptedBinding = transitionGovernanceRecord(checkedBinding, {
  nextStatus: "OWNER_ACCEPTED",
  ownerDecisionDigest: digest("binding-owner-decision"),
});
const preparedBinding = transitionGovernanceRecord(acceptedBinding, {
  nextStatus: "PREPARED_NOT_ACTIVATED",
});
const activated = activateGovernanceBinding(preparedBinding, {
  ownerDecisionDigest: digest("owner-decision"),
  independentCheckDigest: digest("independent-check"),
});
assert.equal(activated.status, "ACTIVE");
assert.equal(activated.lineage.supersedes, preparedBinding.digest);
assert.equal(activated.lineage.owner_decision_digest, digest("owner-decision"));

const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-four-library-history-"));
try {
  const historyFile = path.join(historyRoot, "project-governance.jsonl");
  const historyOne = compileProjectHistoryEntry({projectGeneralLibrary: first.projectGeneral, event_type: "CREATED"});
  appendProjectGovernanceHistory({historyFile, controlRoot: historyRoot, entry: historyOne});
  const historyTwo = compileProjectHistoryEntry({projectGeneralLibrary: upgrade.projectGeneral, event_type: "REBASED", previous: historyOne});
  appendProjectGovernanceHistory({historyFile, controlRoot: historyRoot, entry: historyTwo});
  const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "project history was not append-only");
  assert.equal(JSON.parse(lines[1]).supersedes, historyOne.digest, "project history chain is not bound");
  assert.throws(() => appendProjectGovernanceHistory({historyFile, controlRoot: historyRoot, entry: historyTwo}), /supersession|revision/u);

  const malformedHistoryFile = path.join(historyRoot, "malformed.jsonl");
  fs.writeFileSync(malformedHistoryFile, "not-json\n", {encoding: "utf8", mode: 0o600});
  assert.throws(
    () => appendProjectGovernanceHistory({historyFile: malformedHistoryFile, controlRoot: historyRoot, entry: historyOne}),
    (error) => error instanceof GovernanceValidationError && /not JSON/u.test(error.message),
  );

  const brokenFirst = structuredClone(historyOne);
  brokenFirst.supersedes = digest("unexpected-history-parent");
  brokenFirst.digest = canonicalDigest({...brokenFirst, digest: null});
  const brokenHistoryFile = path.join(historyRoot, "broken.jsonl");
  fs.writeFileSync(brokenHistoryFile, `${JSON.stringify(brokenFirst)}\n${JSON.stringify(historyTwo)}\n`, {encoding: "utf8", mode: 0o600});
  assert.throws(
    () => appendProjectGovernanceHistory({historyFile: brokenHistoryFile, controlRoot: historyRoot, entry: historyTwo}),
    /history chain|supersession|revision/u,
  );
} finally {
  fs.rmSync(historyRoot, {recursive: true, force: true});
}

process.stdout.write("PASS four-library governance compiler, conflicts, binding, upgrade preservation, and append-only history\n");
