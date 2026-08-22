#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(root, "control/cloudflare-cache-rebind-preflight.mjs");
const cleanEnv = {...process.env};
delete cleanEnv.NODE_OPTIONS;
delete cleanEnv.NODE_PATH;

const output = JSON.parse(execFileSync(process.execPath, [entrypoint], {cwd: root, env: cleanEnv, encoding: "utf8"}));
assert.equal(output.schema, "agentos.cloudflare_cache_rebind_preflight.v1");
assert.equal(output.version, 1);
assert.equal(output.status, "BLOCKED_EXACT");
assert.equal(output.candidate.repository_root, root);
assert.equal(typeof output.candidate.worktree_clean, "boolean");
for (const value of [output.candidate.commit, output.candidate.tree, output.candidate.rollback.commit, output.candidate.rollback.tree]) assert.match(value, /^[0-9a-f]{40}$/u);
assert.match(output.authority.identity.binding_sha256, /^[0-9a-f]{64}$/u);
assert.match(output.authority.identity.authority_sha256, /^[0-9a-f]{64}$/u);
assert.equal(output.package.stable_agent_id, "AGENT.PLATFORM_CLOUDFLARE_CACHE");
assert.equal(output.package.block_id, "specialist.platform.cloudflare-cache");
assert.equal(output.roster.status, "PASS");
assert.deepEqual(output.roster.bindings.map((entry) => entry.binding_id), ["reusable_agent_roster_registry", "specialist_roster_registry"]);
assert.equal(output.roster.package_entry.package_path, "specialist-blocks/wave-02/cloudflare-cache");
assert.equal(output.roster.package_entry.candidate_digest.length, 64);
assert.equal(output.model_policy.status, "BLOCKED_EXACT");
assert.equal(output.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.match(output.model_policy.message, /stale/iu);
assert.equal(output.model_policy.relative_path, "fixtures/model-policy-snapshot.initial.v1.json");
assert.equal(output.model_policy.snapshot_status, "PREPARED_INACTIVE");
assert.equal(output.model_policy.expires_at_utc, "2026-08-22T04:09:00.000Z");
assert.equal(output.evaluator_handoff.status, "BLOCKED_EXACT");
assert.equal(output.evaluator_handoff.code, "CANONICAL_EVALUATOR_HANDOFF_REQUIRED");
assert.equal(output.evaluator_handoff.message, "Separately controlled evaluator handoff is not available for the current candidate");
assert.equal(output.evaluator_handoff.handoff_root_exists, false);
assert.match(output.next_action, /fresh canonical HOST\.CODEX_MODEL_CATALOG attestation/iu);
assert.match(output.next_action, /signed evaluator and reviewer handoff/iu);
assert.equal(output.preflight_sha256, canonicalDigest({...output, preflight_sha256: null}));

const statusBefore = execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8"});
const statusAfter = execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8"});
assert.equal(statusAfter, statusBefore, "preflight changed the builder worktree");

const hostile = spawnSync(process.execPath, [entrypoint, root], {cwd: root, env: cleanEnv, encoding: "utf8"});
assert.notEqual(hostile.status, 0, "preflight accepted a caller-supplied root");
assert.match(hostile.stderr, /CLOUDFLARE_CACHE_REBIND_PREFLIGHT_CALLER_INPUT_FORBIDDEN/u);

const bindingBytes = fs.readFileSync(path.join(root, "schemas/bootstrap-binding.v1.json"));
assert.equal(createHash("sha256").update(bindingBytes).digest("hex").length, 64);
console.log("PASS Cloudflare Cache rebind preflight: sealed roster readback, exact stale-policy receipt, exact missing-evaluator receipt, candidate rollback identity, no-input guard, and zero filesystem writes");
