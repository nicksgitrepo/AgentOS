#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertPersistedRecordSafe,
  redactPersistedRecord,
  redactPersistedText,
  resolveHostLocalRuntimeConfig,
  scanPersistedRecord,
  serializePersistedRecord,
  writePersistedRecordAtomic,
} from "../control/persisted-record-privacy.mjs";
import {
  serializePersistedRecord as sharedSerializePersistedRecord,
  writePersistedRecordAtomic as sharedWritePersistedRecordAtomic,
} from "../control/content-addressing.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const controlRoot = path.resolve(root, "../../AgentOS-control");
const recordRoots = [
  {label: "CONTROL_SPACE", root: controlRoot, root_ref: "opaque:root:control-space"},
  {label: "PUBLIC_PROJECT_RECORDS", root: path.join(root, "docs"), root_ref: "opaque:root:public-project-records"},
];
const extensions = new Set([".json", ".md", ".yaml", ".yml", ".toml", ".txt"]);

function walk(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if ([".git", "node_modules", ".codex"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, result);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(target);
  }
  return result;
}

function scanText(text) {
  return scanPersistedRecord(text);
}

function scanRecords() {
  const input = {
    schema: "privacy-record-scan.v1",
    scope: "KNOWN_AGENTOS_PROJECT_AND_CONTROL_ROOTS",
    roots: recordRoots.map(({label, root_ref}) => ({label, root_ref})),
    extensions: [...extensions].sort(),
    exclusions: [".git", "node_modules", ".codex"],
  };
  const input_sha256 = crypto.createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
  const summary = {version: "privacy-record-scan.v1", input_sha256, roots: {}, total_files: 0, total_findings: 0};
  for (const {label, root: recordRoot, root_ref} of recordRoots) {
    const files = walk(recordRoot);
    const rootSummary = {files_scanned: files.length, files_with_findings: 0, categories: {}};
    const fileDigests = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const findings = scanText(text);
      fileDigests.push({relative_record_ref: path.relative(recordRoot, file), value_sha256: findings.value_sha256});
      const present = Object.entries(findings.categories).filter(([, count]) => count > 0).map(([category]) => category);
      if (present.length > 0) rootSummary.files_with_findings++;
      for (const category of present) rootSummary.categories[category] = (rootSummary.categories[category] ?? 0) + 1;
    }
    rootSummary.root_ref = root_ref;
    rootSummary.root_digest_sha256 = crypto.createHash("sha256").update(JSON.stringify({root_ref, fileDigests}), "utf8").digest("hex");
    summary.roots[label] = rootSummary;
    summary.total_files += files.length;
    summary.total_findings += findingsTotal(rootSummary.categories);
  }
  summary.result_digest_sha256 = crypto.createHash("sha256").update(JSON.stringify({...summary, result_digest_sha256: null}), "utf8").digest("hex");
  return summary;
}

function findingsTotal(categories) {
  return Object.values(categories).reduce((total, count) => total + count, 0);
}

const syntheticTaskId = ["0".repeat(8), "0".repeat(4), "4" + "0".repeat(3), "8" + "0".repeat(3), "0".repeat(12)].join("-");
const syntheticPrivateLink = ["chatgpt", "-conversation", "://opaque"].join("");
const synthetic = {
  schema: "synthetic.record.v1",
  cwd: "/absolute/host/path",
  worktree_path: ".codex/worktrees/opaque",
  task_id: syntheticTaskId,
  environment: {API_KEY: "sk" + "-" + "synthetic-secret"},
  private_link: syntheticPrivateLink,
  source_commit: "a".repeat(40),
};
const redacted = redactPersistedRecord(synthetic);
assert.deepEqual(Object.keys(redacted.redaction_counts).sort(), [
  "ABSOLUTE_PATH",
  "ENVIRONMENT_VALUE",
  "SECRET_LIKE_VALUE",
  "SESSION_OR_TASK_IDENTITY",
  "UNSAFE_PRIVATE_LINK",
  "WORKTREE_PATH",
].sort());
assert(redacted.redaction_counts.ABSOLUTE_PATH > 0);
assert(redacted.redaction_counts.WORKTREE_PATH > 0);
assert(redacted.redaction_counts.ENVIRONMENT_VALUE > 0);
assert(redacted.redaction_counts.SESSION_OR_TASK_IDENTITY > 0);
assert(redacted.redaction_counts.UNSAFE_PRIVATE_LINK > 0);
assert.equal(scanPersistedRecord(redacted.record).safe, true);
const textRedaction = redactPersistedText([
  "safe-context",
  "/absolute/host/path",
  ".codex/worktrees/opaque",
  "HOST_FLAG=synthetic-value",
  "sk-" + "A".repeat(20),
  "chatgpt-conversation://opaque",
  syntheticTaskId,
].join(" | "));
assert.equal(scanPersistedRecord(textRedaction.text).safe, true);
assert(textRedaction.redaction_counts.ABSOLUTE_PATH > 0);
assert(textRedaction.redaction_counts.WORKTREE_PATH > 0);
assert(textRedaction.redaction_counts.ENVIRONMENT_VALUE > 0);
assert(textRedaction.redaction_counts.SECRET_LIKE_VALUE > 0);
assert(textRedaction.redaction_counts.UNSAFE_PRIVATE_LINK > 0);
assert(textRedaction.redaction_counts.SESSION_OR_TASK_IDENTITY > 0);
assert.match(textRedaction.text, /safe-context/u);
assert.doesNotMatch(serializePersistedRecord(synthetic), /\/absolute\/host\/path|\.codex\/worktrees\/opaque|synthetic-secret|00000000-0000|chatgpt-conversation/u);
assert.throws(() => assertPersistedRecordSafe(synthetic), /forbidden categories/u);
assert.equal(sharedSerializePersistedRecord(synthetic), serializePersistedRecord(synthetic));
assert.equal(sharedWritePersistedRecordAtomic, writePersistedRecordAtomic);
assert.equal(scanPersistedRecord("task-" + "A".repeat(20)).safe, true);
assert.equal(scanPersistedRecord("sk-" + "A".repeat(20)).safe, false);

const outside = fs.mkdtempSync(path.join(fs.realpathSync.native("/tmp"), "agentos-host-config-"));
const config = path.join(outside, "runtime.json");
fs.writeFileSync(config, "{}\n", {mode: 0o600});
try {
  const hostRef = resolveHostLocalRuntimeConfig({configPath: config, repositoryRoot: root});
  assert.equal(hostRef.location, "HOST_LOCAL_CONFIGURATION_OUTSIDE_REPOSITORY");
  assert.equal(hostRef.config_ref_sha256.length, 64);
  assert.throws(() => resolveHostLocalRuntimeConfig({configPath: path.join(root, "control", "content-addressing.mjs"), repositoryRoot: root}), /outside the Git repository/u);
  const persistedTarget = path.join(outside, "redacted-record.json");
  const written = writePersistedRecordAtomic({filePath: persistedTarget, value: synthetic, repositoryRoot: root, runtimeConfigPath: config});
  assert.equal(written.status, "REDACTED");
  assert.equal(written.protected_actions.activation, false);
  assert.equal(scanPersistedRecord(JSON.parse(fs.readFileSync(persistedTarget, "utf8"))).safe, true);
  assert.throws(() => writePersistedRecordAtomic({filePath: path.join(root, "redacted-record.json"), value: synthetic, repositoryRoot: root, runtimeConfigPath: config}), /outside the Git repository/u);
} finally {
  fs.rmSync(outside, {recursive: true, force: true});
}

const boundedScanRequested = process.env.AGENTOS_PRIVACY_BOUNDED_SCAN !== "SKIP";
const summary = boundedScanRequested
  ? scanRecords()
  : {version: "privacy-record-scan.v1", status: "SKIPPED_AFTER_EXPLICIT_BOUNDED_SCAN"};
if (boundedScanRequested) assert.equal(summary.total_findings, 0, `persisted privacy findings remain: ${JSON.stringify(summary)}`);
const summaryDigest = boundedScanRequested
  ? summary.result_digest_sha256
  : crypto.createHash("sha256").update(JSON.stringify(summary), "utf8").digest("hex");
console.log(JSON.stringify({...summary, status: "PASS", bounded_scan: boundedScanRequested ? "PASS" : "SKIPPED_AFTER_EXPLICIT_BOUNDED_SCAN", summary_digest: summaryDigest}));
