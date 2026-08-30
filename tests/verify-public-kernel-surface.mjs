#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicKernel = await import(pathToFileURL(path.join(root, "control", "agentos.mjs")).href);
const permanentRoleRoster = await import(pathToFileURL(path.join(root, "control", "permanent-role-roster.mjs")).href);

for (const name of [
  "bootstrapAndStartAgentOS",
  "compileRapidPrototypeWorkflow",
  "compileRapidPrototypeWorkflowFromInventory",
  "createProjectMemoryRuntime",
  "compileGeneratedProjectRoleLibrary",
  "compileReleasePromotionGate",
  "compileAutonomousLaneHandoff",
  "validateAutonomousLaneHandoff",
  "compileControllerNextLifecycleHandoff",
  "validateControllerNextLifecycleHandoff",
  "compilePermanentRoleCandidate",
  "validatePermanentRoleCandidate",
  "compilePermanentRoleRoster",
  "validatePermanentRoleRoster",
  "admitNextPermanentRole",
  "createIssueRegistrar",
  "submitIssue",
  "compileIssueRegistry",
  "writeIssuesMarkdownAtomic",
  "validateIssueRuntimeDelivery",
]) {
  assert.equal(typeof publicKernel[name], "function", `public kernel export is unavailable: ${name}`);
}

const issueRegistrar = await import(pathToFileURL(path.join(root, "control", "issue-registrar.mjs")).href);
for (const name of ["createIssueRegistrar", "submitIssue", "submitSeamFinding", "compileIssueRegistry", "writeIssuesMarkdownAtomic", "compileClearedIssuesMarkdown", "reconcileIssueProjections", "validateIssueSeamClosure", "validateIssueRuntimeDelivery", "ISSUE_REGISTRAR_ROLE_ID", "ISSUE_REGISTRAR_CLEARED_CANONICAL_FILENAME"]) {
  assert.equal(publicKernel[name], issueRegistrar[name], `public kernel issue registrar export drifted: ${name}`);
  assert.equal(publicKernel.issueRegistrar[name], issueRegistrar[name], `public kernel issue registrar namespace drifted: ${name}`);
}

for (const name of [
  "compilePermanentRoleCandidate",
  "validatePermanentRoleCandidate",
  "compilePermanentRoleRoster",
  "validatePermanentRoleRoster",
  "admitNextPermanentRole",
  "PERMANENT_ROLE_ROSTER_SCHEMA",
  "PERMANENT_ROLE_CANDIDATE_SCHEMA",
  "PERMANENT_ROLE_ROSTER_VERSION",
  "PERMANENT_ROLE_IDS",
  "PERMANENT_ROLE_KINDS",
  "PERMANENT_ROLE_ROSTER_NEXT_ACTIONS",
]) {
  assert.equal(publicKernel[name], permanentRoleRoster[name], `public kernel roster export drifted from direct module: ${name}`);
  assert.equal(publicKernel.permanentRoleRoster[name], permanentRoleRoster[name], `public kernel roster namespace drifted from direct module: ${name}`);
}

function modules(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...modules(absolute));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) result.push(absolute);
  }
  return result.sort();
}

const cliOnly = new Set([path.join(root, "control", "local-agent-worker.mjs")]);
for (const modulePath of modules(path.join(root, "control"))) {
  if (cliOnly.has(modulePath)) continue;
  await import(pathToFileURL(modulePath).href);
}

console.log("PASS public kernel surface: stable facade exports resolve and every reusable control module imports without CLI side effects");
