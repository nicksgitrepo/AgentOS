#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isRetainedFailedAttempt} from "../control/retained-failed-worktree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const formatOnly = process.argv.includes("--format-only");
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".mjs", ".md", ".toml", ".txt", ".yaml", ".yml"]);

function walk(directory, result = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    if ([".git", "node_modules", "tmp"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isRetainedFailedAttempt(absolute, root)) walk(absolute, result);
    } else if (entry.isFile()) {
      result.push(absolute);
    }
  }
  return result;
}

function isTextFile(file) {
  const extension = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return true;
  const bytes = fs.readFileSync(file);
  return !bytes.includes(0);
}

const files = walk(root);
const textFiles = files.filter(isTextFile);
const trailingWhitespace = [];
for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/u, "");
    if (/[ \t]+$/u.test(line)) trailingWhitespace.push(`${path.relative(root, file)}:${index + 1}`);
  }
  assert(text.length === 0 || text.endsWith("\n"), `text file has no final newline: ${path.relative(root, file)}`);
}
assert.deepEqual(trailingWhitespace, [], `trailing whitespace remains: ${trailingWhitespace.join(", ")}`);

if (!formatOnly) {
  for (const file of textFiles.filter((candidate) => candidate.endsWith(".json"))) {
    JSON.parse(fs.readFileSync(file, "utf8"));
  }
  for (const file of textFiles.filter((candidate) => candidate.endsWith(".mjs"))) {
    const result = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
    assert.equal(result.status, 0, `JavaScript syntax failed: ${path.relative(root, file)}\n${result.stderr}`);
  }
}

console.log(`PASS source hygiene: ${textFiles.length} text files have no trailing whitespace${formatOnly ? "" : "; JSON and JavaScript syntax checked"}`);
