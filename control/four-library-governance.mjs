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
  validateGovernanceBinding,
  compileGovernanceBinding,
  transitionGovernanceRecord,
  activateGovernanceBinding,
  rebaseProjectGeneralLibrary,
  validateGovernanceMigration,
  prepareGovernanceUpgrade,
} from "./four-library-operations.mjs";

export {
  compileProjectHistoryEntry,
  validateProjectHistoryEntry,
  appendProjectGovernanceHistory,
} from "./four-library-history.mjs";

export {
  GENERATED_TASK_ROLE_PACKET_SCHEMA,
  GENERATED_TASK_ROLE_PACKET_VERSION,
  TASK_PACKET_STATUS,
  TASK_PACKET_AUTHORITY_EXPANSION,
  compileGeneratedTaskRolePacket,
  validateGeneratedTaskRolePacket,
} from "./task-role-packet.mjs";

export {canonicalDigest} from "./four-library-foundation.mjs";
