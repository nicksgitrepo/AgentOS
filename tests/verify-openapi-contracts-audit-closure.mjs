#!/usr/bin/env node

/* Read-only closure readback for the exact candidate custody and authority loader. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {validateOpenApiContractsCandidateBinding} from "../control/openapi-contracts-candidate-freeze.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingIndex = process.argv.indexOf("--candidate-binding");
assert(bindingIndex >= 0 && process.argv[bindingIndex + 1], "--candidate-binding is required");
const bindingPath = path.resolve(root, process.argv[bindingIndex + 1]);
const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
validateOpenApiContractsCandidateBinding(binding, {repositoryRoot: root});

const statusBefore = execFileSync("git", ["status", "--porcelain=v1", "--branch"], {cwd: root, encoding: "utf8"}).trim();
assert.equal(statusBefore, `## ${binding.custody.builder_branch}`);
const identity = JSON.parse(execFileSync(process.execPath, ["control/bootstrap-authority-loader.mjs", "identity"], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024}));
assert.equal(identity.root, root);
assert.equal(identity.binding_sha256, "efb15125644f96c04b6c0029a7374da4f713fa92ef55acadb7df8bbd4e6f9bed");
assert.equal(identity.entries.length, 1191);
const roster = identity.entries.find((entry) => entry.binding_id === "specialist_roster_registry");
assert.deepEqual(roster, {
  binding_id: "specialist_roster_registry",
  path: "specialist-blocks/registry/roster.v1.json",
  sha256: "67bf31be4ec809ea9eac66ee0306471da2cea71efcf184f0e1596f71154d68f6",
});
const rosterSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, roster.path))).digest("hex");
assert.equal(rosterSha, roster.sha256);
const statusAfter = execFileSync("git", ["status", "--porcelain=v1", "--branch"], {cwd: root, encoding: "utf8"}).trim();
assert.equal(statusAfter, statusBefore);
console.log(JSON.stringify({schema: "agentos.openapi_contracts_audit_closure_readback.v1", status: "PASS", candidate_commit: binding.candidate_commit, candidate_tree: binding.candidate_tree, binding_sha256: binding.binding_sha256, loader_binding_sha256: identity.binding_sha256, roster_path: roster.path, roster_sha256: roster.sha256, clean_status: statusAfter}));
