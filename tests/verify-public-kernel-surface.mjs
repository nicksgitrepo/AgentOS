#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicKernel = await import(pathToFileURL(path.join(root, "control", "agentos.mjs")).href);

for (const name of [
  "compileControllerWorkflowRegulatorContract",
  "compileRapidPrototypeWorkflow",
  "compileRapidPrototypeWorkflowFromInventory",
  "compileGeneratedProjectRoleLibrary",
  "compileReleasePromotionGate",
  "compileAutonomousLaneHandoff",
  "validateAutonomousLaneHandoff",
  "compileControllerNextLifecycleHandoff",
  "validateControllerNextLifecycleHandoff",
]) {
  assert.equal(typeof publicKernel[name], "function", `public kernel export is unavailable: ${name}`);
}
for (const forbidden of ["bootstrapAndStartAgentOS", "createIntentRegulatorRuntime", "agentLifecycleCustody", "bootstrapRuntime", "projectOwnerBootstrap", "controller", "controllerSupervisor", "continuousLoop", "openPersistentIntentRuntime", "runContinuousOperatingLoop", "createProjectMemoryRuntime", "projectMemoryStore", "projectMemoryArtifacts", "projectMemoryRuntime"]) {
  assert.equal(Object.hasOwn(publicKernel, forbidden), false, `unsafe legacy authority remains public: ${forbidden}`);
}
assert.equal(typeof publicKernel.productOwnerOperational?.runProductOwnerOperationalRequest, "function", "governed Product Owner operational surface is unavailable");
assert.equal(Object.hasOwn(publicKernel, "projectOwnerConversation"), false, "structural Product Owner conversation compiler must not bypass governed operational context");

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

console.log("PASS public kernel surface: safe facade exports resolve, unsafe legacy lifecycle/campaign authority is absent, and every reusable control module imports without CLI side effects");
