#!/usr/bin/env node

/* Sealed, project-agnostic identity root for permanent control-plane roles. */

import {getSealedCanonicalAuthority, readSealedAuthorityBinding} from "./sealed-canonical-authority.mjs";
import {compareUtf8} from "./content-addressing.mjs";

export const PERMANENT_ROLE_REGISTRY_SCHEMA = "agentos.permanent_role_registry.v1";
export const PERMANENT_ROLE_REGISTRY_BINDING_ID = "permanent_role_registry";
const ROLE_ID = /^(?:AGENTOS_CONTROLLER|AGENTOS\.[A-Z][A-Z0-9_]*)$/u;

function assert(condition, message, code = "PERMANENT_ROLE_REGISTRY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}

export function loadCanonicalPermanentRoleRegistry() {
  const artifact = readSealedAuthorityBinding(getSealedCanonicalAuthority(), PERMANENT_ROLE_REGISTRY_BINDING_ID);
  const registry = artifact.value;
  assert(registry.schema === PERMANENT_ROLE_REGISTRY_SCHEMA && registry.version === 1 && registry.status === "PREPARED_NOT_ACTIVATED", "Permanent role registry identity differs");
  assert(registry.bootstrap_predecessor === "AGENTOS.SPAWNER" && registry.activation === "OFF", "Permanent role registry lifecycle differs");
  assert(Array.isArray(registry.canonical_order) && registry.canonical_order.length === 6 && new Set(registry.canonical_order).size === 6, "Permanent role registry order is incomplete");
  assert(Array.isArray(registry.roles) && registry.roles.length === registry.canonical_order.length, "Permanent role registry definitions are incomplete");
  assert(JSON.stringify(registry.roles.map((role) => role.role_id)) === JSON.stringify(registry.canonical_order), "Permanent role registry definitions are reordered");
  for (const role of registry.roles) {
    assert(ROLE_ID.test(role.role_id) && typeof role.role_class === "string" && typeof role.public_name === "string", "Permanent role identity is invalid");
    assert(typeof role.responsibility === "string" && typeof role.human_facing === "boolean", "Permanent role responsibility is incomplete");
    assert(role.monitor_minutes === null || role.monitor_minutes === 15, "Permanent role monitor interval is invalid");
    assert(typeof role.package_path === "string" && role.package_path.startsWith("specialist-blocks/wave-01/") && !role.package_path.split("/").some((part) => part === ".." || part === ""), "Permanent role package path is unsafe");
  }
  const owner = registry.roles.filter((role) => role.human_facing);
  assert(owner.length === 1 && owner[0].role_id === "AGENTOS.PRODUCT_OWNER", "Product Owner must be the sole normal human-facing permanent role");
  assert(registry.roles.find((role) => role.role_id === "AGENTOS_CONTROLLER")?.responsibility === "WORKFLOW_REGULATION_ONLY", "Controller responsibility is widened");
  assert(registry.retired_current_role_ids.includes("AGENTOS.INTENT_REGULATOR"), "Retired Intent Regulator identity is not denied");
  assert(registry.retired_current_role_ids.includes("AGENTOS.PROJECT_OWNER"), "Retired Project Owner alias is not denied");
  return Object.freeze(structuredClone(registry));
}

export function resolveCanonicalPermanentRole(roleId) {
  assert(typeof roleId === "string" && ROLE_ID.test(roleId), "Permanent role request identity is invalid");
  const registry = loadCanonicalPermanentRoleRegistry();
  const role = registry.roles.find((entry) => entry.role_id === roleId);
  assert(role, `Permanent role is not canonical: ${roleId}`, "PERMANENT_ROLE_UNKNOWN");
  return Object.freeze(structuredClone(role));
}

export function canonicalPermanentRoleIds() {
  return Object.freeze([...loadCanonicalPermanentRoleRegistry().canonical_order]);
}

export function validateCanonicalPermanentRoleSet(roleIds) {
  assert(Array.isArray(roleIds), "Permanent role set is required");
  const canonical = canonicalPermanentRoleIds();
  assert(JSON.stringify(roleIds) === JSON.stringify(canonical), "Permanent roles must match the sealed canonical order");
  assert(new Set(roleIds).size === roleIds.length && [...roleIds].sort(compareUtf8).length === roleIds.length, "Permanent role set contains duplicates");
  return roleIds;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Permanent role registry loaded\n");
