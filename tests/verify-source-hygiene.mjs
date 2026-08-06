#!/usr/bin/env node

import assert from "node:assert/strict";
import {readdir, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTENSIONS = new Set([".gate", ".json", ".mjs", ".md"]);
const slash = String.fromCharCode(47);
const backslash = String.fromCharCode(92);
const users = ["U", "s", "e", "r", "s"].join("");
const home = ["h", "o", "m", "e"].join("");
const escapeRegex = (value) => value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
const slashPattern = escapeRegex(slash);
const backslashPattern = escapeRegex(backslash);
const PRIVATE_PATH = new RegExp(`(?:${slashPattern}${users}${slashPattern}|${slashPattern}${home}${slashPattern}|[A-Za-z]:${backslashPattern}${users}${backslashPattern}|${backslashPattern}${backslashPattern}[^${backslashPattern}]+${backslashPattern})`, "u");

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

const files = await walk(ROOT);
assert(!files.some((file) => path.basename(file) === "package.json"), "npm package files are forbidden");
for (const file of files) {
  if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
  const content = await readFile(file, "utf8");
  assert(!/[^\S\r\n]+$/mu.test(content), `${path.relative(ROOT, file)} contains trailing whitespace`);
  assert(content.endsWith("\n"), `${path.relative(ROOT, file)} must end with a newline`);
  if (path.extname(file) === ".json") JSON.parse(content);
  if (path.basename(file) !== "verify-source-hygiene.mjs") assert(!PRIVATE_PATH.test(content), `${path.relative(ROOT, file)} contains a private path`);
}
console.log(JSON.stringify({status: "PASS", files: files.length}));
