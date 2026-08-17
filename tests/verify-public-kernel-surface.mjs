#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicKernel = await import(pathToFileURL(path.join(root, "control", "agentos.mjs")).href);

for (const name of [
  "bootstrapAndStartAgentOS",
  "compileRapidPrototypeWorkflow",
  "compileRapidPrototypeWorkflowFromInventory",
  "createProjectMemoryRuntime",
  "compileGeneratedProjectRoleLibrary",
  "compileReleasePromotionGate",
  "compileAutonomousLaneHandoff",
  "validateAutonomousLaneHandoff",
]) {
  assert.equal(typeof publicKernel[name], "function", `public kernel export is unavailable: ${name}`);
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
