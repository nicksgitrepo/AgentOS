#!/usr/bin/env node
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingPath = path.join(root, "schemas/bootstrap-binding.v1.json");
const loaderPath = path.join(root, "control/bootstrap-authority-loader.mjs");
const rosterPath = path.join(root, "specialist-blocks/registry/agent-roster.v1.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
const actualRosterSha = sha(fs.readFileSync(rosterPath));
assert.equal(binding.normative.reusable_agent_roster_registry.sha256, actualRosterSha, "sealed binding must address the exact roster bytes");
for (const [relative, exportName] of [
  ["control/function-scope-authority-binding.mjs", "FUNCTION_SCOPE_ROSTER_FILE_SHA256"],
  ["control/object-scope-authority-binding.mjs", "OBJECT_SCOPE_ROSTER_FILE_SHA256"],
  ["control/idempotency-authority-binding.mjs", "IDEMPOTENCY_ROSTER_FILE_SHA256"],
]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  assert(source.includes(`${exportName} = \"${actualRosterSha}\"`), `${relative} must pin the current roster bytes`);
}

const cleanEnv = {PATH: process.env.PATH ?? ""};
const current = spawnSync(process.execPath, [loaderPath, "identity"], {encoding: "utf8", env: cleanEnv});
assert.equal(current.status, 0, current.stderr || current.stdout);
const readback = JSON.parse(current.stdout);
const rosterEntry = readback.entries.find((entry) => entry.binding_id === "reusable_agent_roster_registry");
assert.equal(rosterEntry?.sha256, actualRosterSha, "loader readback must expose the exact sealed roster digest");

// Hostile proof: a roster byte change in an otherwise coherent authority copy
// must fail at the sealed loader before any package resolver can run.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ai-rag-sealed-roster-"));
try {
  const tempBinding = path.join(temp, "schemas/bootstrap-binding.v1.json");
  fs.mkdirSync(path.dirname(tempBinding), {recursive: true});
  fs.copyFileSync(bindingPath, tempBinding);
  const sections = ["normative", "compatibility_only"];
  for (const section of sections) {
    for (const record of Object.values(binding[section] ?? {})) {
      if (!record?.path) continue;
      const source = path.join(root, record.path);
      const destination = path.join(temp, record.path);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(source, destination);
    }
  }
  const hostileRoster = path.join(temp, binding.normative.reusable_agent_roster_registry.path);
  fs.appendFileSync(hostileRoster, "\n");
  const hostile = spawnSync(process.execPath, [path.join(temp, "control/bootstrap-authority-loader.mjs"), "identity"], {encoding: "utf8", env: cleanEnv});
  assert.notEqual(hostile.status, 0, "sealed loader must reject changed roster bytes");
  assert.match(`${hostile.stdout}\n${hostile.stderr}`, /BOOTSTRAP_AUTHORITY_BINDING_DRIFT|bootstrap binding drift/u);
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}

console.log("PASS sealed AI Search/RAG roster binding: current loader readback matches exact roster bytes and hostile roster mutation fails closed");
