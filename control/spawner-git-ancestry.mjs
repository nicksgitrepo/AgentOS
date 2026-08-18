#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {realpathSync, lstatSync} from "node:fs";
import {isAbsolute} from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const SPAWNER_GIT_ANCESTRY_SCHEMA = "agentos.spawner_git_ancestry.v1";
const GIT = /^[0-9a-f]{40}$/u;
function fail(message, code = "SPAWNER_GIT_ANCESTRY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function run(root, args) { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); }
function gitObject(value, label) { if (typeof value !== "string" || !GIT.test(value)) fail(`${label} must be an exact Git object`); }
function body(value) { return {...structuredClone(value), ancestry_sha256: null}; }

export function resolveSpawnerGitAncestry({repositoryRoot, candidateCommit, authorizedPredecessor} = {}) {
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) fail("repository root must be absolute");
  const root = realpathSync.native(repositoryRoot);
  if (!lstatSync(root).isDirectory()) fail("repository root must be a real directory");
  gitObject(candidateCommit, "candidate commit"); gitObject(authorizedPredecessor, "authorized predecessor");
  const resolvedCandidate = run(root, ["rev-parse", `${candidateCommit}^{commit}`]);
  const resolvedPredecessor = run(root, ["rev-parse", `${authorizedPredecessor}^{commit}`]);
  if (resolvedCandidate !== candidateCommit || resolvedPredecessor !== authorizedPredecessor) fail("abbreviated or substituted Git identity is forbidden");
  const tree = run(root, ["rev-parse", `${candidateCommit}^{tree}`]);
  const parentLine = run(root, ["rev-list", "--parents", "-n", "1", candidateCommit]).split(/\s+/u);
  const parents = parentLine.slice(1);
  if (run(root, ["merge-base", candidateCommit, authorizedPredecessor]) !== authorizedPredecessor) fail("authorized predecessor is not an ancestor", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  const ancestryPath = run(root, ["rev-list", "--reverse", "--ancestry-path", `${authorizedPredecessor}..${candidateCommit}`]).split("\n").filter(Boolean);
  if (ancestryPath.at(-1) !== candidateCommit) fail("candidate ancestry path is incomplete", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  const receipt = {schema: SPAWNER_GIT_ANCESTRY_SCHEMA, version: 1, candidate_commit: candidateCommit, candidate_tree: tree, direct_parent_commits: [...parents].sort(compareUtf8), authorized_predecessor_commit: authorizedPredecessor, merge_base_commit: authorizedPredecessor, ancestry_path: ancestryPath, interposed_commits: ancestryPath.slice(0, -1), ancestry_sha256: null};
  receipt.ancestry_sha256 = canonicalDigest(body(receipt));
  return Object.freeze(receipt);
}

export function validateSpawnerGitAncestry(receipt, {repositoryRoot} = {}) {
  const current = resolveSpawnerGitAncestry({repositoryRoot, candidateCommit: receipt?.candidate_commit, authorizedPredecessor: receipt?.authorized_predecessor_commit});
  if (canonicalDigest(receipt) !== canonicalDigest(current)) fail("reported ancestry omits or substitutes actual Git history", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  return receipt;
}
