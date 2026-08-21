#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {lstatSync, realpathSync} from "node:fs";
import path from "node:path";
import {assertSealedCanonicalAuthority, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

const states = new WeakMap();
function fail(message, code = "PROTECTED_SPAWNER_REVIEW_PROVISIONING_INVALID") { const error = new Error(message); error.code = code; throw error; }

export function prepareProtectedSpawnerReviewProvisioning(options = {}) {
  if (!options || typeof options !== "object" || JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(["sealedAuthority"])) fail("Caller-selected external review roots are forbidden", "PROTECTED_SPAWNER_REVIEW_CALLER_ROOT_FORBIDDEN");
  const {sealedAuthority} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  let gitCommon, commit;
  try { gitCommon = realpathSync.native(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repositoryRoot, encoding: "utf8"}).trim()); commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim(); } catch { fail("canonical external review Git identity is unavailable", "PROTECTED_SPAWNER_REVIEW_PROVISIONING_REQUIRED"); }
  const reviewStoreRoot = path.join(gitCommon, "agentos-independent-evaluator", commit, "review");
  let realRoot;
  try { realRoot = realpathSync.native(reviewStoreRoot); } catch { fail("canonical external review store is not provisioned", "PROTECTED_SPAWNER_REVIEW_PROVISIONING_REQUIRED"); }
  const stat = lstatSync(reviewStoreRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("external review store root must be a real non-symlink directory");
  const capability = Object.freeze(Object.create(null)); states.set(capability, Object.freeze({realRoot})); return capability;
}

export function consumeProtectedSpawnerReviewProvisioning(capability) {
  const state = states.get(capability);
  if (!state) fail("external review provisioning was forged, serialized, reconstructed, or replayed", "PROTECTED_SPAWNER_REVIEW_PROVISIONING_REQUIRED");
  states.delete(capability); return state;
}
