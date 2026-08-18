#!/usr/bin/env node

/* Earliest-Bootstrap provisioning for a project-scoped lifecycle store. */

import {execFileSync} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const PROJECT_LIFECYCLE_CUSTODY_SCHEMA = "agentos.project_lifecycle_custody.v1";
const provisions = new WeakMap();
const LOADER = resolve(dirname(fileURLToPath(import.meta.url)), "installed-project-bootstrap-loader.mjs");

function fail(message, code = "PROJECT_LIFECYCLE_CUSTODY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }

function cleanEnvironment() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH"].includes(key) && !key.startsWith("NODE_") && !key.startsWith("AGENTOS_PROJECT"))); }
function loadInstalledProject() {
  assert(process.execArgv.every((arg) => !/(?:--loader|--import|--require|-r(?:$|=))/u.test(arg)) && !process.env.NODE_OPTIONS, "Project lifecycle custody cannot attach under runtime hooks", "PROJECT_LIFECYCLE_RUNTIME_HOOK");
  let readback;
  try { readback = JSON.parse(execFileSync(process.execPath, [LOADER], {cwd: dirname(LOADER), env: cleanEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]})); }
  catch (cause) { const error = new Error("Canonical installed-project Bootstrap loader is unavailable or its binding failed"); error.code = "PROJECT_LIFECYCLE_BOOTSTRAP_LOADER_UNAVAILABLE"; error.cause = cause; throw error; }
  assert(readback?.schema === "agentos.installed_project_bootstrap_readback.v1" && readback.version === 1, "Installed-project Bootstrap readback identity differs");
  assert(readback.status === "ACCEPTED_ACTIVE", "Installed-project manifest is prepared/inactive; lifecycle custody cannot attach", "PROJECT_LIFECYCLE_MANIFEST_INACTIVE");
  return Object.freeze({root: readback.project_store_root, projectIdentitySha256: readback.project_identity_sha256, bootstrapCustodySha256: readback.bootstrap_custody_sha256, bindingSha256: readback.binding_sha256, manifestSha256: readback.manifest_sha256});
}

export function prepareInstalledProjectLifecycleCustody(options = {}) {
  assert(options && typeof options === "object" && Object.keys(options).length === 0, "Project lifecycle provisioning rejects caller roots, manifests, identities, custody claims, and sealed-authority substitution", "PROJECT_LIFECYCLE_CALLER_AUTHORITY_FORBIDDEN");
  const state = loadInstalledProject(), capability = Object.freeze(Object.create(null)); provisions.set(capability, state); return capability;
}

export function reattachInstalledProjectLifecycleCustody(options = {}) {
  assert(options && typeof options === "object" && Object.keys(options).length === 0, "Project lifecycle reattachment rejects caller roots, manifests, identities, custody claims, secrets, and serialized attachments", "PROJECT_LIFECYCLE_CALLER_AUTHORITY_FORBIDDEN");
  const state = loadInstalledProject(), capability = Object.freeze(Object.create(null)); provisions.set(capability, state); return capability;
}

export function consumeInstalledProjectLifecycleCustody(capability) {
  const state = provisions.get(capability);
  assert(state, "Project lifecycle custody was forged, cloned, serialized, replayed, or never installed by Bootstrap", "PROJECT_LIFECYCLE_CUSTODY_REQUIRED");
  provisions.delete(capability);
  return state;
}
