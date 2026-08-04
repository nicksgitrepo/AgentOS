#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const readme = read("README.md");
const binding = JSON.parse(read("schemas/bootstrap-binding.v1.json"));
assert.equal(binding.status, "PREPARED_NOT_ACTIVATED");
assert.equal(binding.normative.user_readme.path, "README.md");
assert.equal(sha256(readme), binding.normative.user_readme.sha256, "README binding digest mismatch");

for (const required of [
  "2.1rc — PREPARED_NOT_ACTIVATED",
  "bootstrap/start-here.md",
  "<AGENTOS_ROOT>",
  "<PROJECT_ROOT>",
  "control/bootstrap-compiler.mjs\" start \"<PROJECT_ROOT>\" RECOMMENDED",
  "schemas/bootstrap-binding.v1.json",
  "ADOPT_IN_PLACE",
  "CLEAN_COPY",
  "NORMALIZE_AND_AUDIT",
  "RECONSTRUCT_FROM_INTENT",
  "FUNCTIONALITY",
  "DESIGN_UI_SHELL_NAVIGATION",
  "SECURITY",
  "CODE_QUALITY_HYGIENE",
  "Optional continuity",
  "PREPARED_NOT_ACTIVATED",
  "setup, the ongoing project-persistent role is **AgentOS Controller**",
  "`AGENTOS_CONTROLLER`. It owns the control-plane conversation",
  "Bootstrap does not continue as that role.",
]) {
  assert(readme.includes(required), `README is missing required user-facing content: ${required}`);
}

const startPrompt = "You are Bootstrap 2.1rc. AgentOS root: <AGENTOS_ROOT>. Project root: <PROJECT_ROOT>.";
assert(readme.includes(startPrompt), "README is missing the canonical fresh-agent start instruction");

const forbidden = [
  ["Soc", "iuna"].join(""),
  ["/", "Users", "/"].join(""),
  ["nicks", "git", "repo"].join(""),
  ["chat", "gpt", "-conversation://"].join(""),
];
for (const value of forbidden) assert(!readme.includes(value), `README contains non-portable identity: ${value}`);

console.log("PASS AgentOS README: user entrypoint, fresh-agent instruction, modes, boundaries, and portability content verified");
