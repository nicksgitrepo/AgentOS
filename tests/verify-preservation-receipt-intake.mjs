#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileConservativePreservationPolicy} from "../control/conservative-preservation-policy.mjs";
import {preserveProjectSource} from "../control/project-import.mjs";
import {
  intakePreservedSources,
  validatePreservationReceiptIntake,
} from "../control/preservation-receipt-intake.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-receipt-intake-"));
const policy = compileConservativePreservationPolicy();
const sources = [];
try {
  for (const [repositoryId, name] of [["COMPONENT_A", "a"], ["COMPONENT_B", "b"], ["COMPONENT_C", "c"]]) {
    const sourceRoot = path.join(root, `${name}-source`);
    const artifactRoot = path.join(root, `${name}-artifacts`);
    fs.mkdirSync(sourceRoot, {recursive: true});
    fs.mkdirSync(artifactRoot, {recursive: true});
    fs.writeFileSync(path.join(sourceRoot, "source.txt"), `${repositoryId}\n`);
    fs.writeFileSync(path.join(sourceRoot, ".gitignore"), "dist/\n");
    const {execFileSync} = await import("node:child_process");
    execFileSync("git", ["init", "-q"], {cwd: sourceRoot});
    execFileSync("git", ["config", "user.email", "agentos-test@example.invalid"], {cwd: sourceRoot});
    execFileSync("git", ["config", "user.name", "AgentOS Test"], {cwd: sourceRoot});
    execFileSync("git", ["add", "."], {cwd: sourceRoot});
    execFileSync("git", ["commit", "-qm", "fixture"], {cwd: sourceRoot});
    const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sourceRoot, encoding: "utf8"}).trim();
    const expectedTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {cwd: sourceRoot, encoding: "utf8"}).trim();
    preserveProjectSource(sourceRoot, artifactRoot, "2026-08-13T01:30:00.000Z", {conservative: true, policy});
    sources.push({repositoryId, sourceRoot, artifactRoot, expectedCommit, expectedTree});
  }
  const destinationRoot = path.join(root, "destination");
  const custodyRoot = path.join(root, "custody");
  fs.mkdirSync(destinationRoot);
  fs.mkdirSync(custodyRoot);
  const record = intakePreservedSources({sources, destinationRoot, externalCustodyRoot: custodyRoot, policy});
  assert.equal(record.status, "PRESERVATION_RECEIPTS_ACCEPTED_ZERO_TRACE");
  assert.equal(record.sources.length, 3);
  assert.equal(record.zero_trace.destination_entry_count, 0);
  assert.equal(validatePreservationReceiptIntake(record).intake_sha256, record.intake_sha256);
  const tampered = structuredClone(record);
  tampered.zero_trace.destination_entry_count = 1;
  delete tampered.intake_sha256;
  tampered.intake_sha256 = "0".repeat(64);
  assert.throws(() => validatePreservationReceiptIntake(tampered), /zero-trace proof failed/u);
  const duplicate = structuredClone(record);
  duplicate.sources[1].repository_id = duplicate.sources[0].repository_id;
  delete duplicate.intake_sha256;
  duplicate.intake_sha256 = "0".repeat(64);
  assert.throws(() => validatePreservationReceiptIntake(duplicate), /duplicated/u);
  const dirtyDestination = path.join(root, "dirty-destination");
  fs.mkdirSync(dirtyDestination);
  fs.writeFileSync(path.join(dirtyDestination, "trace.txt"), "must reject\n");
  assert.throws(() => intakePreservedSources({sources, destinationRoot: dirtyDestination, externalCustodyRoot: custodyRoot, policy}), /destination is not empty/u);
  console.log("PASS preservation receipt intake: exact source binding, independent artifact readback, zero-trace destination proof, and hostile tamper rejection");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
