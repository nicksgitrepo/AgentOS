#!/usr/bin/env node

/* Fresh-process, binding-pinned loader for installed project-control custody. */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const SELF = fileURLToPath(import.meta.url);
const CONTROL = dirname(SELF);
const BOOTSTRAP_LOADER = resolve(CONTROL, "bootstrap-authority-loader.mjs");
const EXPECTED_MANIFEST_PATH = "schemas/installed-project-manifest.prepared.v1.json";
const EXACT_FIELDS = ["schema", "version", "status", "project_identity_sha256", "bootstrap_custody_sha256", "store_relative_path", "activation_rule", "consumer_data_present", "manifest_sha256"];
const SHA = /^[0-9a-f]{64}$/u;

function fail(message, code = "INSTALLED_PROJECT_BOOTSTRAP_LOADER_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function digest(value) { return sha(Buffer.from(JSON.stringify(canonical(value)))); }
function cleanEnvironment() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH"].includes(key) && !key.startsWith("NODE_") && !key.startsWith("AGENTOS_PROJECT"))); }
function bootstrap(args) {
  const raw = execFileSync(process.execPath, [BOOTSTRAP_LOADER, ...args], {cwd: CONTROL, env: cleanEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  return JSON.parse(raw);
}
function artifact(id) { const readback = bootstrap(["read", id]), bytes = Buffer.from(readback.bytes_base64, "base64"); assert(sha(bytes) === readback.sha256, `Installed-project binding changed while loading: ${id}`); return {...readback, bytes}; }

assert(process.execArgv.every((arg) => !/(?:--loader|--import|--require|-r(?:$|=))/u.test(arg)) && !process.env.NODE_OPTIONS, "Installed-project authority cannot load under runtime hooks", "INSTALLED_PROJECT_RUNTIME_HOOK");
const identity = bootstrap(["identity"]);
const own = artifact("installed_project_bootstrap_loader"), manifestArtifact = artifact("installed_project_manifest"), custodyController = artifact("project_lifecycle_custody_controller");
assert(own.path === "control/installed-project-bootstrap-loader.mjs" && realpathSync.native(SELF) === SELF && sha(own.bytes) === sha(readFileSync(SELF)), "Installed-project loader bytes/path are not pinned");
assert(manifestArtifact.path === EXPECTED_MANIFEST_PATH && custodyController.path === "control/project-lifecycle-custody.mjs", "Installed-project binding paths differ from canonical authority");
const manifest = JSON.parse(manifestArtifact.bytes.toString("utf8"));
assert(manifest && typeof manifest === "object" && !Array.isArray(manifest) && JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify(EXACT_FIELDS.slice().sort()), "Installed-project manifest fields differ");
assert(manifest.schema === "agentos.installed_project_manifest.v1" && manifest.version === 1 && ["PREPARED_INACTIVE", "ACCEPTED_ACTIVE"].includes(manifest.status), "Installed-project manifest identity/status differs");
assert([manifest.project_identity_sha256, manifest.bootstrap_custody_sha256, manifest.manifest_sha256].every((value) => SHA.test(value)) && manifest.manifest_sha256 === digest({...manifest, manifest_sha256: null}), "Installed-project manifest digest differs");
assert(manifest.consumer_data_present === false && manifest.activation_rule === "REQUIRES_SEPARATE_PROJECT_INSTALL_ACCEPTANCE_AND_PINNED_BOOTSTRAP_BINDING", "Installed-project manifest contains consumer data or bypasses activation");
assert(typeof manifest.store_relative_path === "string" && manifest.store_relative_path.startsWith(".agentos/") && !manifest.store_relative_path.split(/[\\/]/u).some((part) => part === "" || part === ".."), "Installed-project store path is not the reserved repository-relative project-state path");

let output;
if (manifest.status === "PREPARED_INACTIVE") {
  output = {schema: "agentos.installed_project_bootstrap_readback.v1", version: 1, status: "PREPARED_INACTIVE", binding_sha256: identity.binding_sha256, authority_sha256: identity.authority_sha256, loader_sha256: own.sha256, manifest_sha256: manifest.manifest_sha256, custody_controller_sha256: custodyController.sha256, project_store_root: null, project_identity_sha256: manifest.project_identity_sha256, bootstrap_custody_sha256: manifest.bootstrap_custody_sha256};
} else {
  const root = realpathSync.native(identity.root), selected = resolve(root, manifest.store_relative_path);
  assert(selected.startsWith(`${root}${sep}`), "Installed-project store escaped the installed authority root");
  const stat = lstatSync(selected); assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync.native(selected) === selected, "Installed-project store is absent, aliased, or symlinked");
  output = {schema: "agentos.installed_project_bootstrap_readback.v1", version: 1, status: "ACCEPTED_ACTIVE", binding_sha256: identity.binding_sha256, authority_sha256: identity.authority_sha256, loader_sha256: own.sha256, manifest_sha256: manifest.manifest_sha256, custody_controller_sha256: custodyController.sha256, project_store_root: selected, project_identity_sha256: manifest.project_identity_sha256, bootstrap_custody_sha256: manifest.bootstrap_custody_sha256};
}
process.stdout.write(`${JSON.stringify(output)}\n`);
