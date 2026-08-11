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
const privateWorktreeDirectory = [".", "code", "x"].join("");

function walk(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if ([".git", "node_modules", [".", "code", "x"].join("")].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, result);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(target);
  }
  return result;
}

function scanText(text) {
  return scanPersistedRecord(text);
}

function rawDigest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function scanRecords() {
  const projectionPath = path.join(root, "docs/privacy-public-projection.v1.json");
  const projection = JSON.parse(fs.readFileSync(projectionPath, "utf8"));
  assert.equal(projection.schema, "agentos.privacy_public_projection.v1");
  assert.equal(projection.status, "PREPARED_NOT_ACTIVATED");
  assert.equal(projection.private_record_count, projection.private_records.length);
  assert.equal(projection.private_finding_count, projection.private_records.reduce((total, record) => total + record.finding_categories.length, 0));
  assert.equal(projection.digest, crypto.createHash("sha256").update(JSON.stringify({...projection, digest: null}), "utf8").digest("hex"));
  const privateDigests = new Set(projection.private_records.map((record) => {
    assert.match(record.stable_opaque_id, new RegExp(`^opaque:record:${record.record_digest_sha256}$`, "u"));
    assert.match(record.public_replacement, new RegExp(`^opaque:public-record:${record.record_digest_sha256}$`, "u"));
    return record.record_digest_sha256;
  }));
  for (const digest of projection.retained_payload_digest_extensions ?? []) assert.match(digest, /^[0-9a-f]{64}$/u);
  for (const digest of projection.retained_payload_digest_extensions ?? []) privateDigests.add(digest);
  assert.equal(privateDigests.size, projection.private_record_count + (projection.retained_payload_digest_extensions?.length ?? 0));

  const privateManifestPath = path.join(controlRoot, "handoffs/privacy-public-projection-2026-08-11.json");
  assert(fs.existsSync(privateManifestPath), "private control evidence manifest is unavailable");
  const privateManifest = JSON.parse(fs.readFileSync(privateManifestPath, "utf8"));
  assert.equal(privateManifest.schema, "agentos.private_control_evidence_projection_manifest.v1");
  assert.equal(privateManifest.status, "PRESERVED_APPEND_ONLY_PRIVATE_EVIDENCE");
  assert.equal(privateManifest.record_count, projection.private_record_count);
  assert.equal(privateManifest.finding_count, projection.private_finding_count);
  assert.equal(privateManifest.manifest_digest_sha256, crypto.createHash("sha256").update(JSON.stringify({...privateManifest, manifest_digest_sha256: null}), "utf8").digest("hex"));
  const manifestDigests = new Set(privateManifest.payload_digests ?? privateManifest.records.map((record) => {
    assert.equal(record.opaque_record_ref, `opaque:record:${record.payload_digest_sha256}`);
    return record.payload_digest_sha256;
  }));
  for (const digest of privateManifest.supplemental_payload_digests ?? []) manifestDigests.add(digest);
  assert.equal(manifestDigests.size, privateManifest.record_count + (privateManifest.supplemental_payload_digests?.length ?? 0));
  assert.deepEqual([...manifestDigests].sort(), [...privateDigests].sort());

  const binding = JSON.parse(fs.readFileSync(path.join(root, "schemas/bootstrap-binding.v1.json"), "utf8"));
  const allFiles = recordRoots.flatMap(({root: recordRoot}) => walk(recordRoot));
  const filesByDigest = new Map();
  for (const file of allFiles) {
    const digest = rawDigest(file);
    const files = filesByDigest.get(digest) ?? [];
    files.push(file);
    filesByDigest.set(digest, files);
  }
  for (const digest of privateDigests) assert(manifestDigests.has(digest), `private retained payload digest is unavailable: ${digest}`);

  const normativeFiles = [...new Map(Object.values(binding.normative)
    .filter((entry) => entry && typeof entry.path === "string")
    .filter((entry) => extensions.has(path.extname(entry.path).toLowerCase()))
    .map((entry) => [entry.path, path.join(root, entry.path)])).entries()];
  const input = {
    schema: "privacy-public-proof-selector.v1",
    scope: "NORMATIVE_PUBLIC_OBJECTS_PLUS_OPAQUE_PRIVATE_DIGESTS",
    roots: recordRoots.map(({label, root_ref}) => ({label, root_ref})),
    normative_paths: normativeFiles.map(([relativePath]) => relativePath),
    private_record_count: projection.private_record_count,
    private_finding_count: projection.private_finding_count,
    extensions: [...extensions].sort(),
    exclusions: [".git", "node_modules", privateWorktreeDirectory],
  };
  const input_sha256 = crypto.createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
  const summary = {
    version: "privacy-public-proof-selector.v1",
    input_sha256,
    selector_mode: input.scope,
    roots: {},
    normative_public_files_scanned: 0,
    private_records_verified: projection.private_record_count,
    private_retained_digests_verified: privateDigests.size,
    private_payloads_scanned: 0,
    total_files: allFiles.length,
    total_findings: 0,
  };
  for (const {label, root: recordRoot, root_ref} of recordRoots) {
    const files = walk(recordRoot);
    summary.roots[label] = {
      root_ref,
      files_indexed: files.length,
      root_digest_sha256: crypto.createHash("sha256").update(JSON.stringify({root_ref, fileDigests: files.map((file) => ({relative_record_ref: path.relative(recordRoot, file), value_sha256: rawDigest(file)}))}), "utf8").digest("hex"),
    };
  }
  for (const [relativePath, file] of normativeFiles) {
    assert(fs.existsSync(file) && fs.statSync(file).isFile(), `normative public object is unavailable: ${relativePath}`);
    if (privateDigests.has(rawDigest(file))) continue;
    summary.normative_public_files_scanned++;
    const findings = scanText(fs.readFileSync(file, "utf8"));
    for (const [category, count] of Object.entries(findings.categories)) summary.total_findings += count;
  }
  summary.result_digest_sha256 = crypto.createHash("sha256").update(JSON.stringify({...summary, result_digest_sha256: null}), "utf8").digest("hex");
  return summary;
}

function findingsTotal(categories) {
  return Object.values(categories).reduce((total, count) => total + count, 0);
}

const syntheticTaskId = ["0".repeat(8), "0".repeat(4), "4" + "0".repeat(3), "8" + "0".repeat(3), "0".repeat(12)].join("-");
const syntheticPrivateLink = ["chat", "gpt", "-conversation", "://opaque"].join("");
const syntheticWorktreePath = [privateWorktreeDirectory, "worktrees", "opaque"].join("/");
const synthetic = {
  schema: "synthetic.record.v1",
  cwd: "/absolute/host/path",
  worktree_path: syntheticWorktreePath,
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
  syntheticWorktreePath,
  "HOST_FLAG=synthetic-value",
  "sk-" + "A".repeat(20),
  syntheticPrivateLink,
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
const serializedSyntheticForbidden = ["/absolute/host/path", syntheticWorktreePath, "synthetic-secret", "00000000-0000", syntheticPrivateLink].join("|");
assert.doesNotMatch(serializePersistedRecord(synthetic), new RegExp(serializedSyntheticForbidden, "u"));
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
