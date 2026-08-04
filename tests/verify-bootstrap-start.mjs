#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/bootstrap-compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = path.join(root, "control/bootstrap-compiler.mjs");
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-start-"));

try {
  const result = spawnSync(process.execPath, [controller, "start", projectRoot, "RECOMMENDED"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema, "agentos.bootstrap_start_result.v1");
  assert.equal(output.governance_version, "2.1rc");
  assert.equal(output.status, "READ_ONLY_DISCOVERY_COMPLETE");
  assert.equal(output.canonical_controller, "control/bootstrap-compiler.mjs");
  assert.equal(output.agentos_root, root);
  assert.equal(output.project_root, fs.realpathSync.native(projectRoot));
  assert.equal(output.control_plane.mode, "EXTERNAL_DEFAULT");
  assert.equal(output.control_plane_root, output.control_plane.control_plane_root);
  assert.notEqual(output.control_plane_root, output.project_root);
  assert.equal(output.initial_answers["bootstrap.discovery.mode"], "RECOMMENDED");
  assert.equal(output.discovery.operations.read_only, true);
  assert.equal(output.discovery.operations.authentication_attempted, false);
  assert.equal(output.discovery.operations.spending_attempted, false);
  assert.equal(output.discovery.operations.publication_attempted, false);
  assert.equal(output.discovery.operations.deployment_attempted, false);
  assert.equal(output.discovery.operations.deletion_attempted, false);
  assert.equal(output.question_plan.schema, "agentos.bootstrap_question_plan.v1");
  assert.notEqual(output.question_plan.next, "bootstrap.discovery.mode", "the explicit start mode must not be asked again");
  assert.equal(output.question_plan.discovery_digest_sha256, canonicalDigest(output.discovery.facts), "the start result must expose the discovery binding");
  const startBody = structuredClone(output);
  delete startBody.start_sha256;
  const canonicalize = (value) => Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))).map((key) => [key, canonicalize(value[key])]))
      : value;
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonicalize(startBody)), "utf8").digest("hex");
  assert.equal(output.start_sha256, digest);

  const missingPath = spawnSync(process.execPath, [controller, "start"], {cwd: root, encoding: "utf8"});
  assert.notEqual(missingPath.status, 0, "start without a project root must fail closed");
  const relativePath = spawnSync(process.execPath, [controller, "start", path.relative(root, projectRoot), "RECOMMENDED"], {cwd: root, encoding: "utf8"});
  assert.notEqual(relativePath.status, 0, "start with a relative project root must fail closed");
  const importedFromStdin = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: root,
    input: "import './control/bootstrap-compiler.mjs'; console.log('IMPORTED');\n",
    encoding: "utf8",
  });
  assert.equal(importedFromStdin.status, 0, `${importedFromStdin.stdout}\n${importedFromStdin.stderr}`);
  assert(importedFromStdin.stdout.includes("IMPORTED"), "controller import from stdin did not complete");
  const spacedProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos bootstrap start - "));
  try {
    const spaced = spawnSync(process.execPath, [controller, "start", spacedProjectRoot, "RECOMMENDED"], {cwd: root, encoding: "utf8"});
    assert.equal(spaced.status, 0, `${spaced.stdout}\n${spaced.stderr}`);
    assert.equal(JSON.parse(spaced.stdout).project_root, fs.realpathSync.native(spacedProjectRoot));
  } finally {
    fs.rmSync(spacedProjectRoot, {recursive: true, force: true});
  }
  const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-start-target-"));
  const symlinkRoot = path.join(projectRoot, "symlink-project");
  fs.symlinkSync(symlinkTarget, symlinkRoot, "dir");
  try {
    const unsafe = spawnSync(process.execPath, [controller, "start", symlinkRoot, "RECOMMENDED"], {cwd: root, encoding: "utf8"});
    assert.notEqual(unsafe.status, 0, "start through a symlink must fail closed");
  } finally {
    fs.rmSync(symlinkTarget, {recursive: true, force: true});
  }
  console.log("PASS AgentOS Bootstrap start contract: exact two-root read-only invocation, result binding, missing-path, and symlink hostile cases passed");
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
}
