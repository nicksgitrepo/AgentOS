#!/usr/bin/env node

/* Read-only migration notice for retired, formerly conflated role identities. */

import {canonicalDigest} from "./content-addressing.mjs";

export const LEGACY_ROLE_IDENTITY_SCHEMA = "agentos.legacy_role_identity_migration.v1";
export const RETIRED_ROLE_IDS = Object.freeze(["AGENTOS.INTENT_REGULATOR", "AGENTOS.PROJECT_OWNER"]);

function assert(condition, message, code = "LEGACY_ROLE_IDENTITY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}

export function compileLegacyRoleIdentityMigration({legacyRoleId} = {}) {
  assert(RETIRED_ROLE_IDS.includes(legacyRoleId), "Role identity is not a recognized retired identity");
  const record = {
    schema: LEGACY_ROLE_IDENTITY_SCHEMA,
    version: 1,
    legacy_role_id: legacyRoleId,
    status: "READ_ONLY_MIGRATION_REQUIRED",
    live_authority: false,
    automatic_mapping_forbidden: true,
    required_separation: ["AGENTOS_CONTROLLER", "AGENTOS.PRODUCT_OWNER"],
    explanation: "Historical records may be read, but they cannot create a current agent or grant authority. Migration must explicitly separate workflow regulation from user-intent ownership.",
    migration_sha256: null,
  };
  record.migration_sha256 = canonicalDigest({...record, migration_sha256: null});
  return Object.freeze(record);
}

export function assertCurrentRoleIdentity(roleId) {
  assert(!RETIRED_ROLE_IDS.includes(roleId), "Retired role identity cannot be used as current authority", "RETIRED_ROLE_AUTHORITY_FORBIDDEN");
  return roleId;
}
