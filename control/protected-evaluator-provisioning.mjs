#!/usr/bin/env node

/* Bootstrap-only attachment of externally provisioned evaluator material. */

import {lstatSync, realpathSync} from "node:fs";
import {isAbsolute} from "node:path";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";

const provisions = new WeakMap();
function fail(message, code = "PROTECTED_EVALUATOR_PROVISIONING_INVALID") { const error = new Error(message); error.code = code; throw error; }
function realDirectory(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) fail(`${label} must be an absolute bootstrap-resolved path`);
  const real = realpathSync.native(value), stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real non-symlink directory`);
  return real;
}

/* Called only by the earliest trusted Bootstrap process, never by request handling. */
export function prepareProtectedEvaluatorProvisioning({sealedAuthority, clearanceStoreRoot, candidateRepositoryRoot} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  const capability = Object.freeze(Object.create(null));
  provisions.set(capability, Object.freeze({clearanceStoreRoot: realDirectory(clearanceStoreRoot, "clearance store root"), candidateRepositoryRoot: realDirectory(candidateRepositoryRoot, "candidate repository root")}));
  return capability;
}

export function consumeProtectedEvaluatorProvisioning(capability) {
  const provision = provisions.get(capability);
  if (!provision) fail("evaluator provisioning was forged, serialized, or reconstructed", "PROTECTED_EVALUATOR_PROVISIONING_REQUIRED");
  provisions.delete(capability);
  return provision;
}
