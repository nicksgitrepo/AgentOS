#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./bootstrap-compiler.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSha(value, label) {
  assert(value === null || (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)), `${label} must be a lowercase SHA-256 or null`);
}

function assertSafePath(filePath) {
  assert(typeof filePath === "string" && path.isAbsolute(filePath) && !filePath.includes("\0"), "project context path must be absolute");
  try {
    assert(!fs.lstatSync(filePath).isSymbolicLink(), "project context file may not be a symbolic link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    assert(!fs.lstatSync(path.dirname(filePath)).isSymbolicLink(), "project context directory may not be a symbolic link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function readContextBytes(filePath) {
  assertSafePath(filePath);
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile(), "project context target is not a regular file");
  return fs.readFileSync(filePath, "utf8");
}

function validateContext(context) {
  assert(context !== null && typeof context === "object" && !Array.isArray(context), "project context must be an object");
  assert(context.schema === "agentos.project_context_binding.v1", "project context schema is invalid");
  requireSha(context.exact_context_digest, "project context digest");
  const body = structuredClone(context);
  delete body.exact_context_digest;
  assert(context.exact_context_digest === canonicalDigest(body), "project context digest is invalid");
  return context;
}

export function readProjectContext(filePath) {
  let bytes;
  try {
    bytes = readContextBytes(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let context;
  try {
    context = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`project context JSON is invalid: ${error.message}`);
  }
  return validateContext(context);
}

function withLock(filePath, operation) {
  assertSafePath(filePath);
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const lockPath = `${filePath}.lock`;
  try {
    assert(!fs.lstatSync(lockPath).isSymbolicLink(), "project context lock may not be a symbolic link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("project context compare-and-swap is already in progress");
    throw error;
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

export function writeProjectContextCompareAndSwap({filePath, expectedContextSha256, changes, amendmentSha256 = null}) {
  assert(Array.isArray(changes) && changes.length > 0, "project context changes are required");
  requireSha(expectedContextSha256, "expected project context digest");
  requireSha(amendmentSha256, "project context amendment digest");
  return withLock(filePath, () => {
    const current = readProjectContext(filePath);
    assert(current !== null && current.exact_context_digest === expectedContextSha256, "project context compare-and-swap parent is stale");
    const next = structuredClone(current);
    const seen = new Set();
    for (const change of changes) {
      assert(change && typeof change.field === "string" && !seen.has(change.field), "project context amendment field is duplicate or invalid");
      seen.add(change.field);
      assert(["north_star", "first_useful_workflow"].includes(change.field), `project context amendment field is not owner-reviewable: ${change.field}`);
      assert(typeof change.new_value === "string" && change.new_value.trim().length > 0, `project context ${change.field} must be nonempty`);
      next[change.field] = change.new_value;
    }
    if (amendmentSha256 !== null) next.last_context_amendment_sha256 = amendmentSha256;
    delete next.exact_context_digest;
    next.exact_context_digest = canonicalDigest(next);
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.stage`);
    assertSafePath(temporary);
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, {flag: "wx", mode: 0o600});
    try {
      fs.renameSync(temporary, filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    const readback = readProjectContext(filePath);
    assert(readback.exact_context_digest === next.exact_context_digest, "project context readback digest differs from the written context");
    return {
      context: readback,
      previous_context_sha256: expectedContextSha256,
      context_sha256: readback.exact_context_digest,
      write_receipt_sha256: canonicalDigest({previous_context_sha256: expectedContextSha256, context_sha256: readback.exact_context_digest, amendment_sha256: amendmentSha256}),
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("project context store loaded\n");
