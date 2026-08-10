#!/usr/bin/env node

/*
 * Public entrypoint for the lane-owned four-library governance compiler.
 * Focused implementation modules keep composition, upgrades, and history
 * independently reviewable without changing the public import surface.
 */

export {
  BASE_GENERAL_SCHEMA,
  BASE_ROLE_SCHEMA,
  PROJECT_GENERAL_SCHEMA,
  GENERATED_PROJECT_ROLE_SCHEMA,
  GOVERNANCE_BINDING_SCHEMA,
  GOVERNANCE_MIGRATION_SCHEMA,
  GOVERNANCE_CONFLICT_SCHEMA,
  PROJECT_HISTORY_SCHEMA,
  FOUR_LIBRARY_VERSION,
  GOVERNANCE_VERSION,
  BASE_GENERAL_KIND,
  BASE_ROLE_KIND,
  PROJECT_GENERAL_KIND,
  GENERATED_PROJECT_ROLE_KIND,
  LIBRARY_STATUSES,
  GOVERNANCE_UPDATE_MODES,
  FIXED_ROLE_IDS,
  FIXED_ROLE_KINDS,
  GovernanceValidationError,
  GovernanceConflictError,
  makeGovernanceConflict,
  validateConflictRecord,
  validateBaseGeneralLibrary,
  compileBaseGeneralLibrary,
  validateBaseRoleLibrary,
  compileBaseRoleLibrary,
  validateProjectGeneralLibrary,
  compileProjectGeneralLibrary,
} from "./four-library-foundation.mjs";

export {
  validateGeneratedProjectRoleLibrary,
  compileGeneratedProjectRoleLibrary,
  GENERATED_TASK_ROLE_PACKET_SCHEMA as LEGACY_GENERATED_TASK_ROLE_PACKET_SCHEMA,
  validateGeneratedTaskRolePacket as validateLegacyGeneratedTaskRolePacket,
  compileGeneratedTaskRolePacket as compileLegacyGeneratedTaskRolePacket,
  validateGovernanceBinding,
  compileGovernanceBinding,
  transitionGovernanceRecord,
  activateGovernanceBinding,
  rebaseProjectGeneralLibrary,
  validateGovernanceMigration,
  prepareGovernanceUpgrade,
} from "./four-library-operations.mjs";

export {
  GENERATED_TASK_ROLE_PACKET_SCHEMA,
  GENERATED_TASK_ROLE_PACKET_VERSION,
  TASK_PACKET_STATUS,
  TASK_PACKET_AUTHORITY_EXPANSION,
  validateGeneratedTaskRolePacket,
  compileGeneratedTaskRolePacket,
} from "./task-role-packet.mjs";

export {
  compileProjectHistoryEntry,
  validateProjectHistoryEntry,
  appendProjectGovernanceHistory,
} from "./four-library-history.mjs";

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
} from "./layered-governance-contract.mjs";

export {
  LEGACY_LAYERED_GOVERNANCE_SCHEMA,
  LEGACY_LAYERED_GOVERNANCE_VERSION,
  LEGACY_LAYERED_GOVERNANCE_STATUS,
  LEGACY_LAYER_ORDER,
  LEGACY_LAYER_PRECEDENCE_RULE,
  validateLegacyLayeredGovernanceContract,
  compileLegacyLayeredGovernanceContract,
} from "./layered-governance-contract.mjs";

export {canonicalDigest} from "./four-library-foundation.mjs";
