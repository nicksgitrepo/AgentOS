#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const INTEGRATION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = resolve(INTEGRATION_ROOT, "../..");
const CORE_ROOT = join(INTEGRATION_ROOT, "main-core");
const STAGE = join(CORE_ROOT, ".source-rebind-stage");
const SOURCE_BINDINGS = Object.freeze([
  Object.freeze({source: "control", target: "control"}),
  Object.freeze({source: "governance/3.0/audit-repair-convergence.binding.v1.json", target: "governance/3.0/audit-repair-convergence.binding.v1.json"}),
  Object.freeze({source: "governance/3.0/audit-repair-convergence.md", target: "governance/3.0/audit-repair-convergence.md"}),
  Object.freeze({source: "governance/3.0/permanent-role-authority-graph.v1.json", target: "governance/3.0/permanent-role-authority-graph.v1.json"}),
  Object.freeze({source: "governance/3.0/scheduler-runtime-custody-binding.v1.json", target: "governance/3.0/scheduler-runtime-custody-binding.v1.json"}),
  Object.freeze({source: "governance/3.0/scheduler-runtime-custody.md", target: "governance/3.0/scheduler-runtime-custody.md"}),
  Object.freeze({source: "migrations/audit-repair-convergence-v1.md", target: "migrations/audit-repair-convergence-v1.md"}),
  Object.freeze({source: "migrations/permanent-role-authority.v1.json", target: "migrations/permanent-role-authority.v1.json"}),
  Object.freeze({source: "migrations/scheduler-runtime-custody.v1.json", target: "migrations/scheduler-runtime-custody.v1.json"}),
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(root, current = root) {
  const output = [];
  for (const name of (await readdir(current)).sort()) {
    const absolute = join(current, name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`MAIN_CORE_SOURCE_SYMLINK_FORBIDDEN:${relative(root, absolute)}`);
    if (info.isDirectory()) output.push(...await files(root, absolute));
    else if (info.isFile()) output.push(absolute);
    else throw new Error(`MAIN_CORE_SOURCE_SPECIAL_FILE_FORBIDDEN:${relative(root, absolute)}`);
  }
  return output.sort();
}

function git(...args) {
  const result = spawnSync("git", ["-C", REPOSITORY_ROOT, ...args], {encoding: "utf8"});
  if (result.status !== 0) throw new Error(`GIT_IDENTITY_FAILED:${result.stderr}`);
  return result.stdout.trim();
}

const status = git("status", "--porcelain", "--untracked-files=all");
if (status.length > 0) throw new Error("SOURCE_WORKTREE_NOT_CLEAN");
const commit = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
await rm(STAGE, {recursive: true, force: true});
await mkdir(STAGE, {recursive: true, mode: 0o700});
for (const binding of SOURCE_BINDINGS) {
  const stagedTarget = join(STAGE, binding.target);
  await mkdir(dirname(stagedTarget), {recursive: true, mode: 0o700});
  await cp(join(REPOSITORY_ROOT, binding.source), stagedTarget, {recursive: true, preserveTimestamps: false});
}
const entries = [];
for (const absolute of await files(STAGE)) {
  const bytes = await readFile(absolute);
  entries.push({path: relative(STAGE, absolute).split("\\").join("/"), size: bytes.length, sha256: sha256(bytes)});
}
for (const topLevel of ["control", "governance", "migrations"]) await rm(join(CORE_ROOT, topLevel), {recursive: true, force: true});
for (const topLevel of ["control", "governance", "migrations"]) await rename(join(STAGE, topLevel), join(CORE_ROOT, topLevel));
await rm(STAGE, {recursive: true, force: true});
await writeFile(join(CORE_ROOT, "source-manifest.json"), `${JSON.stringify({
  schema: "agentos.integration.main-core-manifest.v3",
  source_commit: commit,
  source_tree: tree,
  candidate_commit: commit,
  candidate_tree: tree,
  source_bindings: SOURCE_BINDINGS,
  entries,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({status: "PASS", commit, tree, entries: entries.length})}\n`);
