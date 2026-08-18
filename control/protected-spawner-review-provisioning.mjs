#!/usr/bin/env node

import {lstatSync, realpathSync} from "node:fs";
import {isAbsolute} from "node:path";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";

const states = new WeakMap();
function fail(message, code = "PROTECTED_SPAWNER_REVIEW_PROVISIONING_INVALID") { const error = new Error(message); error.code = code; throw error; }

export function prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  if (typeof reviewStoreRoot !== "string" || !isAbsolute(reviewStoreRoot)) fail("external review store root must be absolute");
  const realRoot = realpathSync.native(reviewStoreRoot), stat = lstatSync(reviewStoreRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("external review store root must be a real non-symlink directory");
  const capability = Object.freeze(Object.create(null)); states.set(capability, Object.freeze({realRoot})); return capability;
}

export function consumeProtectedSpawnerReviewProvisioning(capability) {
  const state = states.get(capability);
  if (!state) fail("external review provisioning was forged, serialized, reconstructed, or replayed", "PROTECTED_SPAWNER_REVIEW_PROVISIONING_REQUIRED");
  states.delete(capability); return state;
}
