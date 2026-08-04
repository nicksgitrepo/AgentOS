#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  applyPolicyAmendment,
  policyDigest,
  validatePolicyState,
} from "./global-policy-state.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256`);
}

function assertNoSymlink(filePath, label) {
  try {
    assert(!fs.lstatSync(filePath).isSymbolicLink(), `${label} may not be a symbolic link`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertSafeTarget(filePath) {
  assert(typeof filePath === "string" && path.isAbsolute(filePath), "policy state path must be absolute");
  assert(!filePath.includes("\0"), "policy state path contains a NUL byte");
  assertNoSymlink(filePath, "policy state file");
  assertNoSymlink(path.dirname(filePath), "policy state directory");
}

function readBytes(filePath) {
  assertSafeTarget(filePath);
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile(), "policy state target is not a regular file");
  return fs.readFileSync(filePath, "utf8");
}

export function readPolicyState(filePath) {
  let bytes;
  try {
    bytes = readBytes(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let state;
  try {
    state = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`policy state JSON is invalid: ${error.message}`);
  }
  validatePolicyState(state);
  return state;
}

function withPolicyLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  assertSafeTarget(filePath);
  assertNoSymlink(lockPath, "policy state lock");
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("policy state compare-and-swap is already in progress");
    throw error;
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

export function writePolicyStateCompareAndSwap({filePath, expectedPolicyStateSha256 = null, nextState}) {
  requireRecord(nextState, "next policy state");
  validatePolicyState(nextState);
  requireSha(expectedPolicyStateSha256, "expected policy state", {nullable: true});
  return withPolicyLock(filePath, () => {
    const current = readPolicyState(filePath);
    if (expectedPolicyStateSha256 === null) assert(current === null, "policy state already exists");
    else assert(current !== null && current.policy_state_sha256 === expectedPolicyStateSha256, "policy state compare-and-swap parent is stale");
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, {recursive: true});
    const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.stage`);
    assertNoSymlink(temporary, "policy state staging file");
    // Preserve the controller's declared array/object order while the policy digest
    // remains independent of presentation order.
    const bytes = `${JSON.stringify(nextState)}\n`;
    fs.writeFileSync(temporary, bytes, {flag: "wx", mode: 0o600});
    try {
      fs.renameSync(temporary, filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    const readback = readPolicyState(filePath);
    assert(readback?.policy_state_sha256 === nextState.policy_state_sha256, "policy state readback digest differs from the written state");
    return {
      state: readback,
      write_receipt_sha256: policyDigest({
        file_path: path.basename(filePath),
        expected_policy_state_sha256: expectedPolicyStateSha256,
        written_policy_state_sha256: nextState.policy_state_sha256,
      }),
    };
  });
}

export function applyAndPersistPolicyAmendment({filePath, state, amendment, approval, currentBoundary = amendment.effective_boundary}) {
  requireRecord(state, "current policy state");
  validatePolicyState(state);
  const nextState = applyPolicyAmendment({state, amendment, approval, currentBoundary});
  const persisted = writePolicyStateCompareAndSwap({
    filePath,
    expectedPolicyStateSha256: state.policy_state_sha256,
    nextState,
  });
  return {
    ...persisted,
    amendment_sha256: amendment.amendment_sha256,
    approval_sha256: approval.approval_sha256,
  };
}
