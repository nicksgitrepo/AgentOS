#!/usr/bin/env node

import assert from "node:assert/strict";
import {readdir, stat} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".agentos" || entry.name === "tmp") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files.sort();
}

function run(label, args) {
  const result = spawnSync(process.execPath, args, {cwd: ROOT, encoding: "utf8"});
  if (result.status !== 0) {
    process.stderr.write(`${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    process.exit(result.status ?? 1);
  }
}

const controlFiles = (await walk(path.join(ROOT, "control"))).filter((file) => file.endsWith(".mjs"));
const testFiles = (await walk(path.join(ROOT, "tests"))).filter((file) => file.endsWith(".mjs"));
for (const file of [...controlFiles, ...testFiles]) run(`syntax ${path.relative(ROOT, file)}`, ["--check", file]);
const verifiers = testFiles.filter((file) => path.basename(file).startsWith("verify-") && path.basename(file) !== "verify-all.mjs");
assert(verifiers.length >= 13, "canonical verifier discovered too few verifier scripts");
for (const file of verifiers) run(`test ${path.relative(ROOT, file)}`, [file]);
console.log(JSON.stringify({status: "PASS", syntax_files: controlFiles.length + testFiles.length, verifier_files: verifiers.length}));
