#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-field-job-workflow-rebind-"));
const files = [
  "control/content-addressing.mjs",
  "control/persisted-record-privacy.mjs",
  "control/field-job-workflow-rebind.mjs",
  "specialist-blocks/wave-06/field-job-workflow/block.json",
  "specialist-blocks/wave-06/field-job-workflow/evaluation.json",
  "specialist-blocks/wave-06/field-job-workflow/registry-entry.json",
  "specialist-blocks/registry/field-job-workflow-operational-readback.v1.json",
];
const copy = (relative) => {
  const target = path.join(temporary, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(root, relative), target);
  return target;
};
try {
  for (const relative of files) copy(relative);
  const controller = await import(`${pathToFileURL(path.join(temporary, "control/field-job-workflow-rebind.mjs")).href}?test=${Date.now()}`);
  const rebound = controller.rebindFieldJobWorkflowOperationalReadback();
  assert.equal(rebound.status, "PASS");
  assert.equal(rebound.candidate_lifecycle, "CANDIDATE");
  assert.equal(rebound.activation, "OFF");
  assert.equal(rebound.external_admission, "BLOCKED_EXACT:SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");

  const registryPath = path.join(temporary, "specialist-blocks/wave-06/field-job-workflow/registry-entry.json");
  const registryBeforeHostile = fs.readFileSync(registryPath);
  const readbackPath = path.join(temporary, "specialist-blocks/registry/field-job-workflow-operational-readback.v1.json");
  const hostile = JSON.parse(fs.readFileSync(readbackPath, "utf8"));
  hostile.candidate_digest = "0".repeat(64);
  hostile.readback_sha256 = canonicalDigest({...hostile, readback_sha256: null});
  fs.writeFileSync(readbackPath, `${JSON.stringify(hostile, null, 2)}\n`);
  assert.throws(
    () => controller.rebindFieldJobWorkflowOperationalReadback(),
    (error) => error.code === "FIELD_JOB_WORKFLOW_REBIND_READBACK_STALE",
  );
  assert.deepEqual(fs.readFileSync(registryPath), registryBeforeHostile);
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}

console.log("PASS Field Job Workflow rebind: current readback pins rebind only to the inactive candidate, external admission remains blocked, and wrong-candidate hostile receipt is rejected without registry mutation");
