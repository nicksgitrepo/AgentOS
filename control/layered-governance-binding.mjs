#!/usr/bin/env node

/*
 * Public four-layer governance binding. The record is project-agnostic: the
 * project contract supplies opaque context digests, while the portable
 * kernel supplies the shared and role authorities. A generated task packet
 * is a disposable projection and never becomes an authority source.
 */

import {
  canonicalDigest,
  assert,
  assertPortable,
  compareUtf8,
  digestWithout,
  exactKeys,
  requireDigest,
  requireIdentifier,
  sortedUniqueStrings,
} from "./four-library-foundation.mjs";
import {
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateProjectGeneralLibrary,
} from "./four-library-foundation.mjs";
import {
  validateGovernanceMigration,
  validateGeneratedProjectRoleLibrary,
} from "./four-library-operations.mjs";
import {
  validateGeneratedTaskRolePacket,
} from "./task-role-packet.mjs";
import {
  validateBootstrapConversation,
} from "./bootstrap-conversation.mjs";
import {
  validateProjectContract,
} from "./bootstrap-project-contract.mjs";

export const LAYERED_GOVERNANCE_SCHEMA = "agentos.layered_governance.v1";
export const LAYERED_GOVERNANCE_VERSION = 1;
export const LAYERED_GOVERNANCE_STATUS = Object.freeze([
  "PREPARED_NOT_ACTIVATED",
  "ACTIVE",
  "SUPERSEDED",
  "BLOCKED",
]);
export const LAYERED_GOVERNANCE_LAYER_ORDER = Object.freeze([
  "GENERAL_GOVERNANCE",
  "BASE_ROLE_GOVERNANCE",
  "PERSISTENT_PROJECT_GOVERNANCE",
  "GENERATED_TASK_ROLE_GOVERNANCE",
]);
export const LAYERED_GOVERNANCE_CHECK_SCHEMA = "agentos.layered_governance_check.v1";

const SAFE_PROJECT_REF = /^[a-z][a-z0-9._-]{0,63}$/u;
const DIGEST_FIELDS = Object.freeze([
  "general_governance",
  "base_general",
  "base_role",
  "project_general",
  "generated_project_role",
  "project_contract",
  "task_packet",
]);

function layerRecord(layerId, precedence, sourceDigests, authorityMode) {
  return {
    layer_id: layerId,
    precedence,
    source_digests: [...sourceDigests].sort(compareUtf8),
    authority_mode: authorityMode,
  };
}

function validateLayerRecord(layer, index) {
  exactKeys(layer, ["layer_id", "precedence", "source_digests", "authority_mode"], "layered governance layer " + index);
  assert(layer.layer_id === LAYERED_GOVERNANCE_LAYER_ORDER[index], "layered governance layer order is invalid");
  assert(layer.precedence === index + 1, "layered governance layer precedence is invalid");
  sortedUniqueStrings(layer.source_digests, "layered governance layer " + index + " source digests");
  layer.source_digests.forEach((digest) => requireDigest(digest, "layered governance layer " + index + " source digest"));
  assert(typeof layer.authority_mode === "string" && layer.authority_mode.length > 0, "layered governance authority mode is invalid");
}

function validateDigestBindings(bindings) {
  exactKeys(bindings, DIGEST_FIELDS, "layered governance digest bindings");
  DIGEST_FIELDS.forEach((field) => requireDigest(bindings[field], "layered governance digest binding " + field));
}

function upgradeRecord(upgradeResult, projectId = null) {
  if (upgradeResult === null) return null;
  if (upgradeResult.migration !== undefined) {
    validateGovernanceMigration(upgradeResult.migration);
    if (projectId !== null) assert(upgradeResult.migration.project_id === projectId, "layered governance upgrade belongs to another project");
    return upgradeResult.migration;
  }
  if (upgradeResult.schema === "agentos.governance_migration.v1") {
    validateGovernanceMigration(upgradeResult);
    if (projectId !== null) assert(upgradeResult.project_id === projectId, "layered governance upgrade belongs to another project");
    return upgradeResult;
  }
  throw new Error("layered governance upgrade result must contain a migration record");
}

export function validateLayeredGovernanceContract(value, {
  projectContract = null,
  baseGeneralLibrary = null,
  baseRoleLibrary = null,
  projectGeneralLibrary = null,
  generatedProjectRoleLibrary = null,
  taskPacket = null,
} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "project_ref", "project_id",
    "layer_order", "layers", "precedence", "bindings", "migration",
    "activation", "acceptance", "digest",
  ], "layered governance contract");
  assert(value.schema === LAYERED_GOVERNANCE_SCHEMA && value.version === LAYERED_GOVERNANCE_VERSION, "layered governance identity is invalid");
  assert(LAYERED_GOVERNANCE_STATUS.includes(value.status), "layered governance status is invalid");
  assert(typeof value.project_ref === "string" && SAFE_PROJECT_REF.test(value.project_ref), "layered governance project reference is invalid");
  requireIdentifier(value.project_id, "layered governance project ID");
  assert(JSON.stringify(value.layer_order) === JSON.stringify(LAYERED_GOVERNANCE_LAYER_ORDER), "layered governance layer order differs from the canonical order");
  assert(Array.isArray(value.layers) && value.layers.length === LAYERED_GOVERNANCE_LAYER_ORDER.length, "layered governance layer inventory is incomplete");
  value.layers.forEach(validateLayerRecord);
  exactKeys(value.precedence, ["override_policy", "conflict_policy", "task_projection_policy"], "layered governance precedence");
  assert(value.precedence.override_policy === "LATER_LAYERS_MAY_ADD_BUT_NOT_REMOVE_OR_EXPAND", "layered governance override policy is invalid");
  assert(value.precedence.conflict_policy === "REJECT_AND_REQUIRE_OWNER_REVIEW", "layered governance conflict policy is invalid");
  assert(value.precedence.task_projection_policy === "DISPOSABLE_PROJECTION_NO_AUTHORITY", "layered governance task projection policy is invalid");
  validateDigestBindings(value.bindings);
  const expectedLayerSources = [
    [value.bindings.general_governance, value.bindings.base_general],
    [value.bindings.base_role],
    [value.bindings.project_general],
    [value.bindings.task_packet],
  ].map((digests) => [...digests].sort(compareUtf8));
  value.layers.forEach((layer, index) => assert(
    JSON.stringify(layer.source_digests) === JSON.stringify(expectedLayerSources[index]),
    "layered governance layer source binding is not exact",
  ));
  exactKeys(value.migration, ["status", "migration_sha256", "reversible", "source_remains_unmodified"], "layered governance migration");
  assert(["NOT_PRESENT", "READY", "BLOCKED"].includes(value.migration.status), "layered governance migration status is invalid");
  assert(value.migration.migration_sha256 === null || /^[0-9a-f]{64}$/u.test(value.migration.migration_sha256), "layered governance migration digest is invalid");
  if (value.migration.status === "NOT_PRESENT") assert(value.migration.migration_sha256 === null, "layered governance absent migration cannot carry a digest");
  if (["READY", "BLOCKED"].includes(value.migration.status)) assert(value.migration.migration_sha256 !== null, "layered governance migration status requires a digest");
  assert(value.migration.reversible === true && value.migration.source_remains_unmodified === true, "layered governance migration safety is invalid");
  exactKeys(value.activation, ["state", "owner_decision_sha256", "independent_check_sha256"], "layered governance activation");
  assert(value.activation.state === value.status, "layered governance activation state differs from status");
  assert(value.activation.owner_decision_sha256 === null || /^[0-9a-f]{64}$/u.test(value.activation.owner_decision_sha256), "layered governance owner decision digest is invalid");
  assert(value.activation.independent_check_sha256 === null || /^[0-9a-f]{64}$/u.test(value.activation.independent_check_sha256), "layered governance independent check digest is invalid");
  if (value.status === "PREPARED_NOT_ACTIVATED") {
    assert(value.activation.owner_decision_sha256 === null && value.activation.independent_check_sha256 === null, "prepared layered governance cannot carry activation approvals");
  }
  if (value.status === "ACTIVE") {
    assert(value.activation.owner_decision_sha256 !== null && value.activation.independent_check_sha256 !== null, "active layered governance requires both activation approvals");
  }
  exactKeys(value.acceptance, ["independent_checker_required", "upgrade_evidence_required", "activation_requires_owner_and_checker"], "layered governance acceptance");
  assert(value.acceptance.independent_checker_required === true && value.acceptance.upgrade_evidence_required === true && value.acceptance.activation_requires_owner_and_checker === true, "layered governance acceptance requirements are incomplete");
  if (projectContract !== null) {
    validateProjectContract(projectContract);
    assert(value.project_ref === projectContract.project_ref, "layered governance project reference differs from project contract");
    assert(value.bindings.project_contract === projectContract.contract_sha256, "layered governance project contract binding differs");
  }
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.bindings.base_general === baseGeneralLibrary.digest, "layered governance base-general binding differs");
  }
  if (baseRoleLibrary !== null) {
    validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
    assert(value.bindings.base_role === baseRoleLibrary.digest, "layered governance base-role binding differs");
  }
  if (projectGeneralLibrary !== null) {
    validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
    assert(value.project_id === projectGeneralLibrary.project_id, "layered governance project ID differs");
    assert(value.bindings.project_general === projectGeneralLibrary.digest, "layered governance project-general binding differs");
  }
  if (generatedProjectRoleLibrary !== null) {
    validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
    assert(value.bindings.generated_project_role === generatedProjectRoleLibrary.digest, "layered governance generated-role binding differs");
  }
  if (taskPacket !== null) {
    validateGeneratedTaskRolePacket(taskPacket, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary, generatedProjectRoleLibrary});
    assert(value.bindings.task_packet === taskPacket.digest, "layered governance task packet binding differs");
    assert(taskPacket.project_contract_sha256 === value.bindings.project_contract, "layered governance task packet uses another project contract");
  }
  assert(value.layers[0].source_digests.includes(value.bindings.general_governance), "layered governance general source is not bound");
  assert(value.layers[0].source_digests.includes(value.bindings.base_general), "layered governance base-general source is not bound");
  assert(value.layers[1].source_digests.includes(value.bindings.base_role), "layered governance base-role source is not bound");
  assert(value.layers[2].source_digests.includes(value.bindings.project_general), "layered governance project source is not bound");
  assert(value.layers[3].source_digests.includes(value.bindings.task_packet), "layered governance task source is not bound");
  assertPortable(value, "layered governance contract");
  requireDigest(value.digest, "layered governance digest");
  assert(value.digest === canonicalDigest({...value, digest: null}), "layered governance contract is not content-addressed");
  return value;
}

export function compileLayeredGovernanceContract({
  projectContract,
  project_id,
  generalGovernanceDigest,
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  generatedProjectRoleLibrary,
  taskPacket,
  migration = null,
} = {}) {
  validateProjectContract(projectContract);
  assert(projectContract.status === "READY", "layered governance requires a ready project contract");
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
  validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
  validateGeneratedTaskRolePacket(taskPacket, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary, generatedProjectRoleLibrary});
  requireIdentifier(project_id, "layered governance project ID");
  requireDigest(generalGovernanceDigest, "layered governance general governance digest");
  assert(project_id === projectGeneralLibrary.project_id && project_id === generatedProjectRoleLibrary.project_id && taskPacket.project_id === project_id, "layered governance project IDs differ");
  assert(taskPacket.project_contract_sha256 === projectContract.contract_sha256, "layered governance task packet is not bound to the project contract");
  const migrationRecord = migration === null
    ? {status: "NOT_PRESENT", migration_sha256: null, reversible: true, source_remains_unmodified: true}
    : (() => {
      validateGovernanceMigration(migration);
      assert(migration.project_id === project_id, "layered governance migration belongs to another project");
      return {
        status: migration.status,
        migration_sha256: migration.digest,
        reversible: true,
        source_remains_unmodified: migration.preservation.source_remains_unmodified,
      };
    })();
  const bindings = {
    general_governance: generalGovernanceDigest,
    base_general: baseGeneralLibrary.digest,
    base_role: baseRoleLibrary.digest,
    project_general: projectGeneralLibrary.digest,
    generated_project_role: generatedProjectRoleLibrary.digest,
    project_contract: projectContract.contract_sha256,
    task_packet: taskPacket.digest,
  };
  const contract = {
    schema: LAYERED_GOVERNANCE_SCHEMA,
    version: LAYERED_GOVERNANCE_VERSION,
    status: "PREPARED_NOT_ACTIVATED",
    project_ref: projectContract.project_ref,
    project_id,
    layer_order: [...LAYERED_GOVERNANCE_LAYER_ORDER],
    layers: [
      layerRecord("GENERAL_GOVERNANCE", 1, [generalGovernanceDigest, baseGeneralLibrary.digest], "SHARED_GENERAL"),
      layerRecord("BASE_ROLE_GOVERNANCE", 2, [baseRoleLibrary.digest], "BASE_ROLE_ADDITIVE"),
      layerRecord("PERSISTENT_PROJECT_GOVERNANCE", 3, [projectGeneralLibrary.digest], "PROJECT_OWNER_ADDITIVE"),
      layerRecord("GENERATED_TASK_ROLE_GOVERNANCE", 4, [taskPacket.digest], "DISPOSABLE_TASK_PROJECTION"),
    ],
    precedence: {
      override_policy: "LATER_LAYERS_MAY_ADD_BUT_NOT_REMOVE_OR_EXPAND",
      conflict_policy: "REJECT_AND_REQUIRE_OWNER_REVIEW",
      task_projection_policy: "DISPOSABLE_PROJECTION_NO_AUTHORITY",
    },
    bindings,
    migration: migrationRecord,
    activation: {
      state: "PREPARED_NOT_ACTIVATED",
      owner_decision_sha256: null,
      independent_check_sha256: null,
    },
    acceptance: {
      independent_checker_required: true,
      upgrade_evidence_required: true,
      activation_requires_owner_and_checker: true,
    },
    digest: null,
  };
  contract.digest = digestWithout(contract, "digest");
  return validateLayeredGovernanceContract(contract, {
    projectContract,
    baseGeneralLibrary,
    baseRoleLibrary,
    projectGeneralLibrary,
    generatedProjectRoleLibrary,
    taskPacket,
  });
}

export function activateLayeredGovernance(contract, {
  ownerDecisionSha256,
  independentCheck = null,
  independentCheckSha256 = null,
} = {}) {
  validateLayeredGovernanceContract(contract);
  assert(contract.status === "PREPARED_NOT_ACTIVATED", "layered governance is not awaiting activation");
  requireDigest(ownerDecisionSha256, "layered governance owner decision digest");
  assert(independentCheck !== null, "layered governance activation requires the independent check record");
  validateLayeredGovernanceEvidence(independentCheck);
  assert(independentCheck.status === "PASS", "layered governance activation requires a passing independent check");
  assert(independentCheck.layered_governance_sha256 === contract.digest, "layered governance independent check covers another contract");
  assert(independentCheck.project_contract_sha256 === contract.bindings.project_contract, "layered governance independent check covers another project contract");
  assert(independentCheck.task_packet_sha256 === contract.bindings.task_packet, "layered governance independent check covers another task packet");
  assert(independentCheck.upgrade_result_sha256 === contract.migration.migration_sha256, "layered governance independent check covers another upgrade result");
  if (independentCheckSha256 !== null) assert(independentCheckSha256 === independentCheck.digest, "layered governance independent check digest differs from its record");
  const checkDigest = independentCheck.digest;
  const active = structuredClone(contract);
  active.status = "ACTIVE";
  active.activation = {
    state: "ACTIVE",
    owner_decision_sha256: ownerDecisionSha256,
    independent_check_sha256: checkDigest,
  };
  active.digest = digestWithout(active, "digest");
  return validateLayeredGovernanceContract(active);
}

function checkDigest(value, label) {
  requireDigest(value, label);
  return value;
}

export function compareLayeredGovernanceEvidence({
  conversation,
  projectContract,
  taskPacket,
  layeredGovernance = null,
  upgradeResult = null,
} = {}) {
  validateBootstrapConversation(conversation);
  validateProjectContract(projectContract);
  validateGeneratedTaskRolePacket(taskPacket);
  assert(layeredGovernance !== null, "layered governance evidence comparison requires the layered contract");
  validateLayeredGovernanceContract(layeredGovernance, {projectContract, taskPacket});
  const upgrade = upgradeRecord(upgradeResult, layeredGovernance.project_id);
  if (upgrade !== null) assert(upgrade.preservation.project_general_library_digest === layeredGovernance.bindings.project_general, "layered governance upgrade preserves another project library");
  if (upgrade === null) assert(layeredGovernance.migration.status === "NOT_PRESENT", "layered governance upgrade evidence is missing for a bound migration");
  if (upgrade !== null) assert(layeredGovernance.migration.migration_sha256 === upgrade.digest, "layered governance upgrade result is not bound to the layered contract");
  const upgradeSha256 = upgrade?.digest ?? null;
  const matches = {
    conversation_to_contract: projectContract.source_binding.conversation_sha256 === conversation.session_sha256
      && projectContract.source_binding.question_map_sha256 === conversation.question_map.map_sha256,
    contract_to_task_packet: taskPacket.project_contract_sha256 === projectContract.contract_sha256,
    task_to_layers: layeredGovernance.bindings.task_packet === taskPacket.digest,
    upgrade_bound: upgrade?.status === "READY",
    raw_owner_text_excluded: projectContract.source_binding.raw_owner_text_persisted === false
      && projectContract.privacy.raw_conversation_persisted === false,
  };
  const status = Object.values(matches).every(Boolean)
    ? "PASS"
    : upgrade === null && Object.entries(matches).filter(([key]) => key !== "upgrade_bound").every(([, value]) => value)
      ? "PENDING_UPGRADE_EVIDENCE"
      : "BLOCKED";
  const check = {
    schema: LAYERED_GOVERNANCE_CHECK_SCHEMA,
    version: 1,
    status,
    conversation_sha256: checkDigest(conversation.session_sha256, "layered governance check conversation digest"),
    project_contract_sha256: checkDigest(projectContract.contract_sha256, "layered governance check project contract digest"),
    task_packet_sha256: checkDigest(taskPacket.digest, "layered governance check task packet digest"),
    layered_governance_sha256: layeredGovernance.digest,
    upgrade_result_sha256: upgradeSha256,
    matches,
    digest: null,
  };
  check.digest = digestWithout(check, "digest");
  return validateLayeredGovernanceEvidence(check);
}

export function validateLayeredGovernanceEvidence(value) {
  exactKeys(value, [
    "schema", "version", "status", "conversation_sha256", "project_contract_sha256",
    "task_packet_sha256", "layered_governance_sha256", "upgrade_result_sha256",
    "matches", "digest",
  ], "layered governance evidence check");
  assert(value.schema === LAYERED_GOVERNANCE_CHECK_SCHEMA && value.version === 1, "layered governance evidence check identity is invalid");
  assert(["PASS", "PENDING_UPGRADE_EVIDENCE", "BLOCKED"].includes(value.status), "layered governance evidence check status is invalid");
  requireDigest(value.conversation_sha256, "layered governance evidence conversation digest");
  requireDigest(value.project_contract_sha256, "layered governance evidence contract digest");
  requireDigest(value.task_packet_sha256, "layered governance evidence task packet digest");
  requireDigest(value.layered_governance_sha256, "layered governance evidence layered contract digest");
  assert(value.upgrade_result_sha256 === null || /^[0-9a-f]{64}$/u.test(value.upgrade_result_sha256), "layered governance evidence upgrade digest is invalid");
  exactKeys(value.matches, ["conversation_to_contract", "contract_to_task_packet", "task_to_layers", "upgrade_bound", "raw_owner_text_excluded"], "layered governance evidence matches");
  Object.values(value.matches).forEach((match) => assert(typeof match === "boolean", "layered governance evidence match must be boolean"));
  const coreMatches = Object.entries(value.matches).filter(([key]) => key !== "upgrade_bound").every(([, match]) => match);
  const expectedStatus = coreMatches && value.matches.upgrade_bound
    ? "PASS"
    : coreMatches && value.upgrade_result_sha256 === null
      ? "PENDING_UPGRADE_EVIDENCE"
      : "BLOCKED";
  assert(value.status === expectedStatus, "layered governance evidence status does not match its matches");
  if (value.status === "PASS") assert(value.upgrade_result_sha256 !== null, "passing layered governance evidence requires upgrade evidence");
  if (value.status === "PENDING_UPGRADE_EVIDENCE") assert(value.upgrade_result_sha256 === null, "pending layered governance evidence cannot carry an upgrade digest");
  assert(value.digest === canonicalDigest({...value, digest: null}), "layered governance evidence is not content-addressed");
  assertPortable(value, "layered governance evidence");
  return value;
}


