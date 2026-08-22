#!/usr/bin/env node

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const bindingPath = path.join(root, "schemas/bootstrap-binding.v1.json");
const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
const rosterBindings = [
  ["reusable_agent_roster_registry", "specialist-blocks/registry/agent-roster.v1.json"],
  ["specialist_roster_registry", "specialist-blocks/registry/roster.v1.json"],
];

for (const [bindingId, relativePath] of rosterBindings) {
  const record = binding.normative[bindingId];
  assert.equal(record?.path, relativePath, `${bindingId} path is not canonical`);
  assert.equal(record.sha256, shaFile(path.join(root, relativePath)), `${bindingId} is stale after rebind`);
}

const loader = path.join(root, "control/bootstrap-authority-loader.mjs");
const cleanEnv = {...process.env};
delete cleanEnv.NODE_OPTIONS;
delete cleanEnv.NODE_PATH;
const identity = JSON.parse(execFileSync(process.execPath, [loader, "identity"], {cwd: root, env: cleanEnv, encoding: "utf8"}));
for (const [bindingId, relativePath] of rosterBindings) {
  const entry = identity.entries.find((candidate) => candidate.binding_id === bindingId);
  assert.equal(entry?.path, relativePath, `${bindingId} is absent from loader readback`);
  assert.equal(entry.sha256, shaFile(path.join(root, relativePath)), `${bindingId} loader readback is stale`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cloudflare-cache-binding-rebind-"));
try {
  fs.mkdirSync(path.join(tempRoot, "schemas"), {recursive: true});
  fs.copyFileSync(bindingPath, path.join(tempRoot, "schemas/bootstrap-binding.v1.json"));
  for (const section of ["normative", "compatibility_only"]) {
    for (const record of Object.values(binding[section] ?? {})) {
      if (!record?.path) continue;
      const source = path.join(root, record.path);
      const target = path.join(tempRoot, record.path);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(source, target);
    }
  }
  const mutatedRoster = path.join(tempRoot, "specialist-blocks/registry/agent-roster.v1.json");
  fs.appendFileSync(mutatedRoster, "\n");
  const hostile = spawnSync(process.execPath, [path.join(tempRoot, "control/bootstrap-authority-loader.mjs"), "identity"], {cwd: tempRoot, env: cleanEnv, encoding: "utf8"});
  assert.notEqual(hostile.status, 0, "mutated roster unexpectedly passed bootstrap authority loading");
  assert.match(hostile.stderr, /bootstrap binding drift: reusable_agent_roster_registry/u, "mutated roster did not return the typed drift");
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}

console.log("PASS Cloudflare Cache authority rebind: exact roster bindings read back current and hostile roster mutation fails closed");
