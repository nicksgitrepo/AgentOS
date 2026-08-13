#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectProjectSource,
  preserveProjectSource,
  verifySourcePreservation,
} from "../control/project-import.mjs";
import {compileConservativePreservationPolicy} from "../control/conservative-preservation-policy.mjs";
import {
  compileProjectPreservationOverlay,
  decideConservativePreservation,
  invalidateDependentPreservationManifest,
  validateConservativePreservationPolicy,
} from "../control/conservative-preservation-policy.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-conservative-preservation-"));
const source = path.join(root, "source");
const destination = path.join(root, "preservation");
fs.mkdirSync(path.join(source, "build"), {recursive: true});
fs.mkdirSync(path.join(source, "node_modules", "fixture"), {recursive: true});
fs.mkdirSync(path.join(source, "evidence"), {recursive: true});
fs.writeFileSync(path.join(source, ".gitignore"), "node_modules/\nevidence/\n");
fs.writeFileSync(path.join(source, "tracked.txt"), "tracked\n");
fs.writeFileSync(path.join(source, "build", "kept.txt"), "tracked build output\n");
fs.writeFileSync(path.join(source, ".env"), "TOKEN=raw-secret-for-preservation\n");
fs.writeFileSync(path.join(source, "settings.json"), "{\"password\":\"raw-secret\"}\n");
fs.writeFileSync(path.join(source, "node_modules", "fixture", "generated.js"), "reproducible dependency\n");
fs.writeFileSync(path.join(source, "evidence", "ambiguous.json"), "user-owned ignored evidence\n");
fs.symlinkSync("tracked.txt", path.join(source, "linked.txt"));
execFileSync("git", ["init", "-q"], {cwd: source});
execFileSync("git", ["config", "user.email", "agentos-test@example.invalid"], {cwd: source});
execFileSync("git", ["config", "user.name", "AgentOS Test"], {cwd: source});
execFileSync("git", ["add", ".gitignore", "tracked.txt", "build/kept.txt", ".env", "settings.json"], {cwd: source});
execFileSync("git", ["commit", "-qm", "fixture"], {cwd: source});
fs.mkdirSync(destination, {recursive: true});
const policy = compileConservativePreservationPolicy();
validateConservativePreservationPolicy(policy);
assert.equal(decideConservativePreservation({entryName: ".git", entryKind: "directory", tracked: false, ignored: false, policy}).decision, "EXCLUDE_GIT_ADMINISTRATIVE_INTERNAL");
assert.equal(decideConservativePreservation({entryName: "node_modules", entryKind: "directory", tracked: false, ignored: true, hasTrackedDescendant: false, policy}).decision, "EXCLUDE_IGNORED_REPRODUCIBLE_OUTPUT");
assert.equal(decideConservativePreservation({entryName: "node_modules", entryKind: "directory", tracked: false, ignored: true, hasTrackedDescendant: true, policy}).decision, "PRESERVE_USER_CONTENT");
assert.equal(decideConservativePreservation({entryName: "evidence.json", entryKind: "file", tracked: false, ignored: true, policy}).decision, "PRESERVE_USER_CONTENT");
assert.throws(() => validateConservativePreservationPolicy({...policy, ambiguous_ignored_content: "DROP"}), /weakens preservation/u);
const overlay = compileProjectPreservationOverlay({projectContextDigest: "a".repeat(64), reproducibleIgnoredDirectoryNames: ["generated-cache"]});
const overlaidPolicy = compileConservativePreservationPolicy({projectOverlay: overlay});
assert.equal(overlaidPolicy.source_overlay_digest, overlay.overlay_sha256);
assert.equal(invalidateDependentPreservationManifest({manifestPolicySha256: policy.policy_sha256, currentPolicySha256: overlaidPolicy.policy_sha256}).status, "INVALIDATED");

try {
  const before = inspectProjectSource(source, {conservative: true, policy});
  const preserved = preserveProjectSource(source, destination, "2026-08-13T01:05:00.000Z", {conservative: true, policy});
  assert.equal(preserved.verification.status, "VERIFIED_EXACT");
  assert.equal(verifySourcePreservation(destination).status, "VERIFIED_EXACT");
  assert.deepEqual(inspectProjectSource(source, {conservative: true, policy}), before);
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, "source-preservation.manifest.json"), "utf8"));
  const included = new Set(manifest.included_files.map((entry) => entry.path));
  assert(included.has(".env"), "conservative mode must preserve sensitive user-owned files");
  assert(included.has("settings.json"), "conservative mode must preserve sensitive content");
  assert(included.has("build/kept.txt"), "conservative mode must preserve tracked generated-looking content");
  assert(included.has("evidence/ambiguous.json"), "conservative mode must preserve ambiguous ignored content");
  assert(!included.has("node_modules/fixture/generated.js"), "conservative mode must exclude ignored reproducible dependencies");
  assert(manifest.excluded_paths.some((entry) => entry.path === "node_modules"));
  assert.deepEqual(manifest.symlink_files, [{path: "linked.txt", target: "tracked.txt", target_sha256: "19033232c7f966831bfb0468dac9c2ca87b30cc955dec1752b3287f367cf5643"}], "symlink metadata must be preserved");
  assert(manifest.preservation_policy.startsWith("PRESERVE_TRACKED_AND_USER_OWNED_UNTRACKED"));
  console.log("PASS conservative source preservation: sensitive and ambiguous user content retained; only ignored reproducible dependency output excluded");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
