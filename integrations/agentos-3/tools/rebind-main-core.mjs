#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const INTEGRATION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = resolve(INTEGRATION_ROOT, "../..");
const CORE_ROOT = join(INTEGRATION_ROOT, "main-core");
const SOURCE = join(REPOSITORY_ROOT, "control");
const TARGET = join(CORE_ROOT, "control");
const STAGE = join(CORE_ROOT, ".control-rebind-stage");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(root, current = root) {
  const output = [];
  for (const name of (await readdir(current)).sort()) {
    const absolute = join(current, name);
    const info = await stat(absolute);
    if (info.isDirectory()) output.push(...await files(root, absolute));
    else if (info.isFile()) output.push(absolute);
  }
  return output;
}

function git(...args) {
  const result = spawnSync("git", ["-C", REPOSITORY_ROOT, ...args], {encoding: "utf8"});
  if (result.status !== 0) throw new Error(`GIT_IDENTITY_FAILED:${result.stderr}`);
  return result.stdout.trim();
}

const status = git("status", "--porcelain");
if (status.length > 0) throw new Error("SOURCE_WORKTREE_NOT_CLEAN");
const commit = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
await rm(STAGE, {recursive: true, force: true});
await mkdir(STAGE, {recursive: true, mode: 0o700});
await cp(SOURCE, STAGE, {recursive: true, preserveTimestamps: false});
const entries = [];
for (const absolute of await files(STAGE)) {
  const bytes = await readFile(absolute);
  entries.push({path: `control/${relative(STAGE, absolute).split("\\").join("/")}`, size: bytes.length, sha256: sha256(bytes)});
}
await rm(TARGET, {recursive: true, force: true});
await rename(STAGE, TARGET);
await writeFile(join(CORE_ROOT, "source-manifest.json"), `${JSON.stringify({schema: "agentos.integration.main-core-manifest.v2", source_commit: commit, source_tree: tree, candidate_commit: commit, candidate_tree: tree, entries}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({status: "PASS", commit, tree, entries: entries.length})}\n`);
