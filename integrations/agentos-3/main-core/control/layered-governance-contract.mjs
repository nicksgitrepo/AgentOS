#!/usr/bin/env node

/*
 * Public envelope for the four deterministic governance layers.
 *
 * The envelope binds the project contract and all four compiled libraries
 * without activating the prepared governance state. Project context remains
 * data; the kernel stores only digests and typed migration posture.
 */

import {
  GOVERNANCE_UPDATE_MODES,
  GENERATED_PROJECT_ROLE_SCHEMA,
  assert,
  assertPortable,
  canonicalDigest,
  exactKeys,
  requireDigest,
  requireIdentifier,
  requireString,
  sortedUniqueStrings,
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateProjectGeneralLibrary,
} from "./four-library-foundation.mjs";
import {
  validateGeneratedProjectRoleLibrary,
} from "./four-library-operations.mjs";

export const LEGACY_LAYERED_GOVERNANCE_SCHEMA = "agentos.layered_governance_contract.v1";
export const LEGACY_LAYERED_GOVERNANCE_VERSION = 1;
export const LEGACY_LAYERED_GOVERNANCE_STATUS = "PREPARED_NOT_ACTIVATED";
export const LEGACY_LAYER_ORDER = Object.freeze([
  "SHARED_GENERAL",
  "BASE_ROLE",
  "PERSISTENT_PROJECT",
  "GENERATED_TASK_ROLE",
]);
export const LEGACY_LAYER_PRECEDENCE_RULE = "MORE_SPECIFIC_PROJECT_AUTHORITY_MAY_ADD_RESTRICTIONS_ONLY";

function validateEnvelopeLibraries(value) {
  validateBaseGeneralLibrary(value.baseGeneralLibrary);
  validateBaseRoleLibrary(value.baseRoleLibrary, {baseGeneralLibrary: value.baseGeneralLibrary});
  validateProjectGeneralLibrary(value.projectGeneralLibrary, {
    baseGeneralLibrary: value.baseGeneralLibrary,
    baseRoleLibrary: value.baseRoleLibrary,
  });
  validateGeneratedProjectRoleLibrary(value.generatedProjectRoleLibrary, {
    baseGeneralLibrary: value.baseGeneralLibrary,
    baseRoleLibrary: value.baseRoleLibrary,
    projectGeneralLibrary: value.projectGeneralLibrary,
  });
  assert(value.projectGeneralLibrary.project_id === value.generatedProjectRoleLibrary.project_id, "layered governance project identity differs");
}

function validateLegacyLayeredGovernanceMigration(value) {
  exactKeys(value, ["controller", "modes", "source_preserved", "old_binding_remains_active_until_checked"], "layered governance migration");
  requireString(value.controller, "layered governance migration controller");
  assert(value.controller === "control/four-library-operations.mjs", "layered governance migration controller is invalid");
  sortedUniqueStrings(value.modes, "layered governance migration modes");
  assert(JSON.stringify(value.modes) === JSON.stringify([...GOVERNANCE_UPDATE_MODES].sort()), "layered governance migration modes are incomplete");
  assert(value.source_preserved === true, "layered governance migration must preserve source state");
  assert(value.old_binding_remains_active_until_checked === true, "layered governance migration must keep old binding until checked");
}

function validateLegacyLayeredGovernanceActivation(value, status) {
  exactKeys(value, ["active", "owner_decision_required", "independent_check_required"], "layered governance activation");
  assert(value.active === (status === "ACTIVE"), "layered governance activation state is inconsistent");
  assert(value.owner_decision_required === true, "layered governance activation requires owner decision");
  assert(value.independent_check_required === true, "layered governance activation requires independent check");
}

export function validateLegacyLayeredGovernanceContract(value, {
  baseGeneralLibrary = null,
  baseRoleLibrary = null,
  projectGeneralLibrary = null,
  generatedProjectRoleLibrary = null,
} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "project_id", "project_contract_sha256",
    "layer_order", "precedence_rule", "library_digests", "migration", "activation", "digest",
  ], "layered governance contract");
  assert(value.schema === LEGACY_LAYERED_GOVERNANCE_SCHEMA && value.version === LEGACY_LAYERED_GOVERNANCE_VERSION, "legacy layered governance contract identity is invalid");
  assert(["PREPARED_NOT_ACTIVATED", "ACTIVE"].includes(value.status), "layered governance contract status is invalid");
  requireIdentifier(value.project_id, "layered governance contract project_id");
  requireDigest(value.project_contract_sha256, "layered governance contract project contract digest");
  assert(JSON.stringify(value.layer_order) === JSON.stringify(LEGACY_LAYER_ORDER), "legacy layered governance layer order is invalid");
  assert(value.precedence_rule === LEGACY_LAYER_PRECEDENCE_RULE, "legacy layered governance precedence rule is invalid");
  exactKeys(value.library_digests, ["base_general", "base_role", "project_general", "generated_project_role"], "layered governance library digests");
  for (const key of Object.keys(value.library_digests)) requireDigest(value.library_digests[key], "layered governance library digest " + key);
  validateLegacyLayeredGovernanceMigration(value.migration);
  validateLegacyLayeredGovernanceActivation(value.activation, value.status);
  if (baseGeneralLibrary !== null && baseRoleLibrary !== null && projectGeneralLibrary !== null && generatedProjectRoleLibrary !== null) {
    validateEnvelopeLibraries({baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary, generatedProjectRoleLibrary});
    assert(value.project_id === projectGeneralLibrary.project_id, "layered governance project_id differs from project library");
    assert(value.library_digests.base_general === baseGeneralLibrary.digest, "layered governance base-general binding differs");
    assert(value.library_digests.base_role === baseRoleLibrary.digest, "layered governance base-role binding differs");
    assert(value.library_digests.project_general === projectGeneralLibrary.digest, "layered governance project-general binding differs");
    assert(value.library_digests.generated_project_role === generatedProjectRoleLibrary.digest, "layered governance generated-role binding differs");
  } else {
    assert(generatedProjectRoleLibrary === null || generatedProjectRoleLibrary.schema === GENERATED_PROJECT_ROLE_SCHEMA, "layered governance generated-role binding is invalid");
  }
  assertPortable(value, "layered governance contract");
  assert(typeof value.digest === "string" && value.digest === canonicalDigest({...value, digest: null}), "layered governance contract digest is invalid");
  return value;
}

export function compileLegacyLayeredGovernanceContract({
  projectContractSha256,
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  generatedProjectRoleLibrary,
} = {}) {
  requireDigest(projectContractSha256, "project contract digest");
  validateEnvelopeLibraries({baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary, generatedProjectRoleLibrary});
  const envelope = {
    schema: LEGACY_LAYERED_GOVERNANCE_SCHEMA,
    version: LEGACY_LAYERED_GOVERNANCE_VERSION,
    status: LEGACY_LAYERED_GOVERNANCE_STATUS,
    project_id: projectGeneralLibrary.project_id,
    project_contract_sha256: projectContractSha256,
    layer_order: [...LEGACY_LAYER_ORDER],
    precedence_rule: LEGACY_LAYER_PRECEDENCE_RULE,
    library_digests: {
      base_general: baseGeneralLibrary.digest,
      base_role: baseRoleLibrary.digest,
      project_general: projectGeneralLibrary.digest,
      generated_project_role: generatedProjectRoleLibrary.digest,
    },
    migration: {
      controller: "control/four-library-operations.mjs",
      modes: [...GOVERNANCE_UPDATE_MODES].sort(),
      source_preserved: true,
      old_binding_remains_active_until_checked: true,
    },
    activation: {
      active: false,
      owner_decision_required: true,
      independent_check_required: true,
    },
    digest: null,
  };
  envelope.digest = canonicalDigest({...envelope, digest: null});
  return validateLegacyLayeredGovernanceContract(envelope, {
    baseGeneralLibrary,
    baseRoleLibrary,
    projectGeneralLibrary,
    generatedProjectRoleLibrary,
  });
}

export {
  LAYERED_GOVERNANCE_SCHEMA,
  LAYERED_GOVERNANCE_VERSION,
  LAYERED_GOVERNANCE_STATUS,
  LAYERED_GOVERNANCE_LAYER_ORDER,
  LAYERED_GOVERNANCE_CHECK_SCHEMA,
  validateLayeredGovernanceContract,
  compileLayeredGovernanceContract,
  activateLayeredGovernance,
  compareLayeredGovernanceEvidence,
  validateLayeredGovernanceEvidence,
} from "./layered-governance-binding.mjs";
