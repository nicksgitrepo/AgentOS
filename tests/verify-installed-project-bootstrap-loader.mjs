#!/usr/bin/env node

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, canonicalJson} from "../control/content-addressing.mjs";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relative) => path.join(repository, relative);
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(execFileSync("git", ["ls-files", ".agentos"], {cwd: repository, encoding: "utf8"}).trim(), "", "reserved installed project-state path overlaps tracked authority files");

function materialize(status) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-installed-project-loader-"));
  for (const directory of ["control", "schemas", ".agentos/project-control"]) fs.mkdirSync(path.join(root, directory), {recursive: true, mode: 0o700});
  for (const relative of ["control/bootstrap-authority-loader.mjs", "control/installed-project-bootstrap-loader.mjs", "control/project-lifecycle-custody.mjs"]) fs.copyFileSync(source(relative), path.join(root, relative));
  const manifest = JSON.parse(fs.readFileSync(source("schemas/installed-project-manifest.prepared.v1.json"), "utf8"));
  manifest.status = status; manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(path.join(root, "schemas/installed-project-manifest.prepared.v1.json"), `${canonicalJson(manifest)}\n`);
  const binding = {schema: "agentos.governance_2_1rc_bootstrap_binding.v2", version: 2, normative: {
    bootstrap_authority_loader_controller: {path: "control/bootstrap-authority-loader.mjs", sha256: shaFile(path.join(root, "control/bootstrap-authority-loader.mjs"))},
    installed_project_bootstrap_loader: {path: "control/installed-project-bootstrap-loader.mjs", sha256: shaFile(path.join(root, "control/installed-project-bootstrap-loader.mjs"))},
    installed_project_manifest: {path: "schemas/installed-project-manifest.prepared.v1.json", sha256: shaFile(path.join(root, "schemas/installed-project-manifest.prepared.v1.json"))},
    project_lifecycle_custody_controller: {path: "control/project-lifecycle-custody.mjs", sha256: shaFile(path.join(root, "control/project-lifecycle-custody.mjs"))},
  }, compatibility_only: {}};
  fs.writeFileSync(path.join(root, "schemas/bootstrap-binding.v1.json"), `${canonicalJson(binding)}\n`);
  return {root, loader: path.join(root, "control/installed-project-bootstrap-loader.mjs"), manifest};
}
function run(fixture, {cwd = os.tmpdir(), env = {}} = {}) {
  return JSON.parse(execFileSync(process.execPath, [fixture.loader, "/attacker/chosen-root"], {cwd, env: {...process.env, AGENTOS_PROJECT_ROOT: "/attacker", AGENTOS_PROJECT_ID: "attacker", ...env}, encoding: "utf8"}));
}

const active = materialize("ACCEPTED_ACTIVE"), inactive = materialize("PREPARED_INACTIVE");
try {
  assert.equal(active.manifest.project_identity_sha256, canonicalDigest({schema: "agentos.prepared_project_slot.v1", slot: "DEFAULT"}));
  assert.equal(active.manifest.bootstrap_custody_sha256, canonicalDigest({schema: "agentos.prepared_project_custody.v1", authority: "BOOTSTRAP"}));
  assert.equal(shaFile(active.loader), shaFile(source("control/installed-project-bootstrap-loader.mjs")), "test loader bytes differ from production candidate");
  const first = run(active), alternate = run(active, {cwd: "/", env: {AGENTOS_PROJECT_ROOT: "/different", PWD: "/different"}});
  assert.equal(first.status, "ACCEPTED_ACTIVE");
  assert.equal(first.project_store_root, fs.realpathSync.native(path.join(active.root, ".agentos/project-control")));
  assert.equal(alternate.project_store_root, first.project_store_root, "cwd/env changed installed project selection");
  assert.equal(first.project_identity_sha256, active.manifest.project_identity_sha256);
  assert.equal(run(inactive).status, "PREPARED_INACTIVE");
  assert.equal(run(inactive).project_store_root, null, "inactive manifest selected a live store");

  const manifestPath = path.join(active.root, "schemas/installed-project-manifest.prepared.v1.json"), original = fs.readFileSync(manifestPath);
  fs.writeFileSync(manifestPath, `${original.toString("utf8").replace("ACCEPTED_ACTIVE", "PREPARED_INACTIVE")}`);
  const substituted = spawnSync(process.execPath, [active.loader], {cwd: active.root, encoding: "utf8"});
  assert.notEqual(substituted.status, 0); assert.match(substituted.stderr, /binding drift/u);
  fs.writeFileSync(manifestPath, original);

  const selected = path.join(active.root, ".agentos/project-control"), outside = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-store-outside-"));
  fs.rmSync(selected, {recursive: true}); fs.symlinkSync(outside, selected, "dir");
  const symlinked = spawnSync(process.execPath, [active.loader], {cwd: active.root, encoding: "utf8"});
  assert.notEqual(symlinked.status, 0); assert.match(symlinked.stderr, /symlink|aliased/u); fs.rmSync(outside, {recursive: true});
} finally {
  fs.rmSync(active.root, {recursive: true, force: true}); fs.rmSync(inactive.root, {recursive: true, force: true});
}

const production = spawnSync(process.execPath, [source("control/installed-project-bootstrap-loader.mjs")], {cwd: "/", env: {...process.env, AGENTOS_PROJECT_ROOT: "/attacker"}, encoding: "utf8"});
assert.equal(production.status, 0, production.stderr);
const productionReadback = JSON.parse(production.stdout);
assert.equal(productionReadback.status, "PREPARED_INACTIVE");
assert.equal(productionReadback.project_store_root, null);
assert.equal(Object.hasOwn(productionReadback, "caller_project_root"), false);

console.log("PASS installed-project Bootstrap loader candidate: exact bytes and pinned manifest select only the repository-relative real store; inactive, cwd/env/root, manifest substitution, and symlink cases fail closed");
