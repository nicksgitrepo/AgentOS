#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roles = new Map([
  ["AGENTOS_CONTROLLER", "project-controller"],
  ["AGENTOS.PRODUCT_OWNER", "product-owner"],
  ["AGENTOS.MEMORY", "memory"],
  ["AGENTOS.RUNTIME", "runtime-deployment-operator"],
  ["AGENTOS.SCHEDULER", "resource-scheduler"],
  ["AGENTOS.ORCHESTRATOR", "orchestrator"],
]);
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const providerThreadScheme = ["co", "dex", "://"].join("");
const personalHomePrefix = ["/", "Use", "rs", "/"].join("");
const forbiddenPortable = new RegExp(`${providerThreadScheme}|01[a-z0-9]{6}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}|${personalHomePrefix}|adversarial auditor endpoint|prototype`, "iu");

for (const [roleId, dir] of roles) {
  const packagePath = `specialist-blocks/wave-01/${dir}`;
  const bootstrap = JSON.parse(fs.readFileSync(path.join(ROOT, packagePath, "bootstrap.json"), "utf8"));
  const block = JSON.parse(fs.readFileSync(path.join(ROOT, packagePath, "block.json"), "utf8"));
  assert.equal(bootstrap.schema, "agentos.permanent_role_chat_bootstrap.v1");
  assert.equal(bootstrap.status, "PREPARED_NOT_ACTIVATED");
  assert.equal(bootstrap.role_id, roleId);
  assert.equal(bootstrap.role_package_path, packagePath);
  assert.equal(bootstrap.role_block_sha256, block.block_sha256);
  assert.deepEqual(bootstrap.model_route, {model: "gpt-5.6-sol", reasoning_effort: "medium", authority: "PROJECT_OWNER_EXPLICIT_ROUTE", runtime_readback_required: true});
  assert.deepEqual(bootstrap.delegation_policy, {default: "NO_SUBAGENTS", explicit_owner_approval_required: true, approval_scope: "EACH_USE", hidden_or_recursive_delegation_forbidden: true});
  assert.equal(bootstrap.lifecycle.kind, "LONG_RUNNING_NAMED_AGENT");
  assert.equal(bootstrap.lifecycle.activation, "OFF_UNTIL_SPAWNER_ADMISSION");
  assert.equal(bootstrap.archive_gate.process_state, "INACTIVE");
  assert.equal(bootstrap.archive_gate.worktree_state, "STALE_AND_NO_LONGER_USED");
  assert.equal(bootstrap.archive_gate.live_reference_count, 0);
  assert.equal(bootstrap.archive_gate.host_close_capability, "SUPPORTED");
  assert.equal(bootstrap.archive_gate.result, "CLOSED");
  assert.equal(bootstrap.prompt_sha256, sha256(bootstrap.prompt));
  assert.doesNotMatch(JSON.stringify(bootstrap), forbiddenPortable);
  assert.match(bootstrap.prompt, /gpt-5\.6-sol with reasoning_effort=medium/);
  assert.match(bootstrap.prompt, /explicitly approves that individual use/);
  assert.match(bootstrap.prompt, /AGENTOS\.SPAWNER is only the host-facing lifecycle executor/);
  assert.match(bootstrap.prompt, /process_state=INACTIVE/);
  assert.match(bootstrap.prompt, /worktree_state=STALE_AND_NO_LONGER_USED/);
}

console.log("PASS six production permanent-role bootstraps: exact role blocks, Sol-medium owner route, long-running lifecycle, per-use delegation denial, lifecycle-only Spawner, portable source binding, and strict archive gate");
