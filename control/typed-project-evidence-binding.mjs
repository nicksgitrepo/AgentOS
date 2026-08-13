#!/usr/bin/env node

/*
 * Keep content-addressed project evidence readable while excluding it from
 * portable-kernel authority scans. This controller never rewrites evidence.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TYPED_PROJECT_EVIDENCE_BINDING_SCHEMA = "agentos.typed_project_evidence_binding.v1";
const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function fileDigest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function safeRelative(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a nonempty path`);
  assert(
    !path.isAbsolute(value)
      && !value.includes("\\")
      && !value.includes("\0")
      && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    `${label} is unsafe`,
  );
}

function validateEvidenceReceipt(receipt) {
  assert(isRecord(receipt), "typed project evidence receipt is invalid");
  assert(receipt.schema === TYPED_PROJECT_EVIDENCE_BINDING_SCHEMA, "typed project evidence receipt schema is invalid");
  assert(receipt.version === 1, "typed project evidence receipt version is invalid");
  assert(receipt.status === "BOUND_EXCLUDED_FROM_PORTABLE_AUTHORITY", "typed project evidence receipt status is invalid");
  assert(Array.isArray(receipt.evidence), "typed project evidence receipt entries are invalid");
  assert(Array.isArray(receipt.excluded_paths), "typed project evidence excluded paths are invalid");
  assert(receipt.portable_kernel_input === false, "typed project evidence receipt claims portable authority");
  assert(receipt.mutation === "NONE" && receipt.activation === "OFF", "typed project evidence receipt exceeds authority");
  assert(typeof receipt.invalidation_rule === "string" && receipt.invalidation_rule.length > 0, "typed project evidence invalidation rule is missing");
  assert(SHA256.test(receipt.receipt_sha256), "typed project evidence receipt digest is invalid");
  assert(receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "typed project evidence receipt digest mismatch");
  const evidencePaths = receipt.evidence.map((entry, index) => {
    assert(isRecord(entry), `typed project evidence receipt entry ${index} is invalid`);
    assert(typeof entry.name === "string" && entry.name.length > 0, `typed project evidence receipt entry ${index} has no name`);
    safeRelative(entry.path, `typed project evidence receipt entry ${index}.path`);
    assert(SHA256.test(entry.sha256), `typed project evidence receipt entry ${index}.sha256 is invalid`);
    return entry.path;
  });
  assert(new Set(evidencePaths).size === evidencePaths.length, "typed project evidence receipt has duplicate paths");
  const excludedPaths = receipt.excluded_paths.map((entry, index) => {
    safeRelative(entry, `typed project evidence excluded_paths[${index}]`);
    return entry;
  });
  assert(new Set(excludedPaths).size === excludedPaths.length, "typed project evidence receipt has duplicate exclusions");
  assert(JSON.stringify([...evidencePaths].sort()) === JSON.stringify([...excludedPaths].sort()), "typed project evidence receipt exclusions do not match evidence");
  return receipt;
}

export function validateTypedProjectEvidenceBindings({repositoryRoot, bindings, portablePaths = []} = {}) {
  assert(typeof repositoryRoot === "string" && path.isAbsolute(repositoryRoot), "repositoryRoot must be absolute");
  assert(isRecord(bindings), "typed project evidence bindings must be an object");
  assert(Array.isArray(portablePaths), "portablePaths must be an array");
  const normalizedPortablePaths = portablePaths.map((entry, index) => {
    safeRelative(entry, `portablePaths[${index}]`);
    return entry;
  });
  const portable = new Set(normalizedPortablePaths);
  const repoRoot = path.resolve(repositoryRoot);
  const entries = [];
  const seenPaths = new Set();
  for (const name of Object.keys(bindings).sort()) {
    const entry = bindings[name];
    assert(isRecord(entry), `typed project evidence ${name} must be an object`);
    safeRelative(entry.path, `typed project evidence ${name}.path`);
    assert(SHA256.test(entry.sha256), `typed project evidence ${name}.sha256 is invalid`);
    assert(entry.classification === "TYPED_PROJECT_CONTEXT_EVIDENCE", `typed project evidence ${name} is not classified`);
    assert(entry.current_portable_kernel_input === false, `typed project evidence ${name} claims portable authority`);
    assert(!seenPaths.has(entry.path), `duplicate typed project evidence path: ${entry.path}`);
    assert(!portable.has(entry.path), `typed project evidence overlaps portable authority: ${entry.path}`);
    const absolute = path.join(repoRoot, entry.path);
    assert(absolute.startsWith(`${repoRoot}${path.sep}`), `typed project evidence ${name}.path escapes the repository`);
    assert(fs.existsSync(absolute) && fs.lstatSync(absolute).isFile(), `typed project evidence is not a regular file: ${entry.path}`);
    assert(fileDigest(absolute) === entry.sha256, `typed project evidence digest mismatch: ${entry.path}`);
    seenPaths.add(entry.path);
    entries.push({name, path: entry.path, sha256: entry.sha256});
  }
  const body = {
    schema: TYPED_PROJECT_EVIDENCE_BINDING_SCHEMA,
    version: 1,
    status: "BOUND_EXCLUDED_FROM_PORTABLE_AUTHORITY",
    evidence: entries,
    excluded_paths: entries.map((entry) => entry.path).sort(),
    portable_kernel_input: false,
    mutation: "NONE",
    activation: "OFF",
    invalidation_rule: "A path, digest, classification, or portable-authority overlap change invalidates this receipt and every dependent project manifest without changing normative kernel authority.",
    receipt_sha256: null,
  };
  body.receipt_sha256 = canonicalDigest({...body, receipt_sha256: null});
  return body;
}

export function selectPortableAuthorityPaths({allPaths, evidenceReceipt} = {}) {
  assert(Array.isArray(allPaths), "allPaths must be an array");
  validateEvidenceReceipt(evidenceReceipt);
  const normalizedPaths = allPaths.map((entry, index) => {
    safeRelative(entry, `allPaths[${index}]`);
    return entry;
  });
  assert(new Set(normalizedPaths).size === normalizedPaths.length, "allPaths contains duplicates");
  const excluded = new Set(evidenceReceipt.excluded_paths);
  return normalizedPaths.filter((entry) => !excluded.has(entry));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({schema: TYPED_PROJECT_EVIDENCE_BINDING_SCHEMA, status: "READY", mutation: "NONE", activation: "OFF"}, null, 2)}\n`);
}
