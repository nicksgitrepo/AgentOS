#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalDigest,
  selectPortableAuthorityPaths,
  validateTypedProjectEvidenceBindings,
} from "../control/typed-project-evidence-binding.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-typed-evidence-"));
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
try {
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "portable.md"), "portable rule\n");
  const hostSpecificFixture = ["project-only ", "/", "Users", "/", "example evidence\n"].join("");
  fs.writeFileSync(path.join(root, "docs", "checkpoint.md"), hostSpecificFixture);
  const bindings = {
    checkpoint: {
      path: "docs/checkpoint.md",
      sha256: digest(path.join(root, "docs", "checkpoint.md")),
      classification: "TYPED_PROJECT_CONTEXT_EVIDENCE",
      current_portable_kernel_input: false,
    },
  };
  const receipt = validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings, portablePaths: ["portable.md"]});
  assert.equal(receipt.status, "BOUND_EXCLUDED_FROM_PORTABLE_AUTHORITY");
  assert.deepEqual(selectPortableAuthorityPaths({allPaths: ["docs/checkpoint.md", "portable.md"], evidenceReceipt: receipt}), ["portable.md"]);

  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: {...bindings.checkpoint, sha256: "0".repeat(64)}}}), /digest mismatch/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: {...bindings.checkpoint, classification: "PORTABLE"}}}), /not classified/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: {...bindings.checkpoint, current_portable_kernel_input: true}}}), /claims portable authority/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: {...bindings.checkpoint, path: "../escape.md"}}}), /unsafe/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: {...bindings.checkpoint, path: "./docs/checkpoint.md"}}}), /unsafe/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings: {checkpoint: bindings.checkpoint, duplicate: bindings.checkpoint}}), /duplicate/u);
  assert.throws(() => validateTypedProjectEvidenceBindings({repositoryRoot: root, bindings, portablePaths: ["docs/checkpoint.md"]}), /overlaps portable authority/u);
  assert.throws(() => selectPortableAuthorityPaths({allPaths: ["portable.md"], evidenceReceipt: {...receipt, receipt_sha256: "0".repeat(64)}}), /digest mismatch/u);
  const privilegeEscalation = {...receipt, status: "PORTABLE_AUTHORITY", receipt_sha256: null};
  privilegeEscalation.receipt_sha256 = canonicalDigest(privilegeEscalation);
  assert.throws(() => selectPortableAuthorityPaths({allPaths: ["portable.md"], evidenceReceipt: privilegeEscalation}), /status is invalid/u);
  const hiddenExclusion = {...receipt, excluded_paths: ["portable.md"], receipt_sha256: null};
  hiddenExclusion.receipt_sha256 = canonicalDigest(hiddenExclusion);
  assert.throws(() => selectPortableAuthorityPaths({allPaths: ["portable.md"], evidenceReceipt: hiddenExclusion}), /do not match evidence/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS typed project evidence binding: exact digest, classification, portable exclusion, overlap denial, path containment, privilege escalation denial, hidden exclusion denial, and hostile receipt tamper");
