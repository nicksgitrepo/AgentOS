#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isRetainedFailedAttempt} from "../control/retained-failed-worktree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const formatOnly = process.argv.includes("--format-only");
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".mjs", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const HISTORICAL_COMPATIBILITY_RECORDS = new Map([
  ["docs/feature-audits/APPRENTICESHIP_WORKFLOW_LEARNING/auditreport.md", "0f0e4c2b6d0d63892dd85671ba7e6bf8dddcb6117e39e5e7459ce3392ce1c603"],
  ["docs/feature-audits/BOOTSTRAP_PROJECT_CONTRACT/auditreport.md", "4b50ff6ec680e58156d4ced90d648b5e89caf760fc0048fd5cba48d76731097d"],
  ["docs/feature-audits/EVIDENCE_IDENTITY_HANDOFFS/auditreport.md", "3fae445beba5e3a1a241b325bef8870df55336c1039d5f61b6e8f71c85e80908"],
  ["docs/feature-audits/OFFLINE_LOCAL_MODE/auditreport.md", "d16814a4c4b0def344f818f4ba18f00ffa0420eb87ca4b840d47253bad7f38fe"],
  ["docs/feature-audits/PERSISTENT_INTENT_RUNTIME/auditreport.md", "b95a540b8c2dc337a3c0f7286e14acd2f120014dd668ed5f591c49bb0b5a48f8"],
  ["docs/feature-audits/PERSISTENT_INTENT_RUNTIME/central-intake-preservation-manifest-2026-08-09.md", "e114b7c50b37095b8577e292c49971dc33c35608748b1251c2277806f8bd4d2b"],
  ["docs/feature-audits/PROJECT_GOVERNANCE_PERSISTENCE/auditreport.md", "d5eb017ec39e1a31a03972d359f03b604c0ae8841e9f484d69bdb8bfc46ae27c"],
  ["docs/feature-audits/ROADMAP_02_LAYERED_GOVERNANCE/auditreport.md", "7be5e2e12fafbe8a2bfdaaa89395cdd63a6d06083b5dad70858a663b974bac21"],
  ["docs/feature-audits/ROADMAP_06_CAMPAIGN_LIFECYCLE/auditreport.md", "7ca49f990609a458c3080c3339cf4bc677f6d37909f367d6908ec478b631ee44"],
  ["docs/feature-audits/ROADMAP_07_PROOF_ACCEPTANCE/auditreport.md", "cc6fd0b7a81bd8bd12e5fe3eb201d896593796764c963879be0f27261b5a3bde"],
]);

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
  const relativePath = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const historicalDigest = HISTORICAL_COMPATIBILITY_RECORDS.get(relativePath);
  if (historicalDigest !== undefined) {
    const observedDigest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(observedDigest, historicalDigest, `historical compatibility record changed: ${relativePath}`);
    assert(text.length === 0 || text.endsWith("\n"), `historical compatibility record has no final newline: ${relativePath}`);
    continue;
  }
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

console.log(`PASS source hygiene: ${textFiles.length} text files have no trailing whitespace; ${HISTORICAL_COMPATIBILITY_RECORDS.size} append-only historical records preserved by exact digest${formatOnly ? "" : "; JSON and JavaScript syntax checked"}`);
