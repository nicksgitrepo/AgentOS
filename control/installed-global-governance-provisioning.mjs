#!/usr/bin/env node

/* One-use Bootstrap provisioning capability for the installed global store. */

import {lstatSync, realpathSync} from "node:fs";
import {isAbsolute} from "node:path";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";

const states = new WeakMap();
const SHA = /^[0-9a-f]{64}$/u;
function fail(message, code = "GLOBAL_GOVERNANCE_PROVISIONING_INVALID") { const error = new Error(message); error.code = code; throw error; }

/* Earliest trusted Bootstrap boundary; request/role code never calls this. */
export function prepareInstalledGlobalGovernanceProvisioning({sealedAuthority, installedStoreRoot, bootstrapSha256} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  if (typeof installedStoreRoot !== "string" || !isAbsolute(installedStoreRoot)) fail("installed global-governance root must be absolute");
  if (typeof bootstrapSha256 !== "string" || !SHA.test(bootstrapSha256)) fail("installed global-governance bootstrap digest is invalid");
  const realRoot = realpathSync.native(installedStoreRoot), stat = lstatSync(installedStoreRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("installed global-governance root must be a real non-symlink directory");
  const capability = Object.freeze(Object.create(null));
  states.set(capability, Object.freeze({realRoot, bootstrapSha256}));
  return capability;
}

export function consumeInstalledGlobalGovernanceProvisioning(capability) {
  const state = states.get(capability);
  if (!state) fail("global-governance provisioning was forged, replayed, serialized, or reconstructed", "GLOBAL_GOVERNANCE_PROVISIONING_REQUIRED");
  states.delete(capability);
  return state;
}
