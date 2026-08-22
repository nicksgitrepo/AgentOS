#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertSpawnerPortableInputText,
  assertSpawnerPortableInputs,
  resolveConfiguredSpawnerWorkspaceRoot,
  resolveSpawnerWorkspaceCustody,
  validateSpawnerWorkspaceCustodyReceipt,
} from "../control/spawner-workspace-custody.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const root = fs.mkdtempSync(path.join(repositoryRoot, ".agentos-workspace-custody-"));
const outside = fs.mkdtempSync(path.join(path.dirname(repositoryRoot), ".agentos-workspace-escape-"));
const workspace = path.join(root, "projects");
const task = path.join(workspace, "lane");
const nested = path.join(task, "owned-worktree");
fs.mkdirSync(nested, {recursive: true});

const environmentKeys = ["AGENTOS_PROJECTS_ROOT", "AGENTOS_WORKSPACE_ROOT"];
const savedEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
function clearWorkspaceEnvironment() {
  for (const key of environmentKeys) delete process.env[key];
}
function expectCode(action, code, message) {
  assert.throws(action, (error) => error?.code === code, message);
}

try {
  clearWorkspaceEnvironment();
  process.env.AGENTOS_PROJECTS_ROOT = workspace;
  const resolved = resolveConfiguredSpawnerWorkspaceRoot();
  assert.equal(resolved.root, fs.realpathSync.native(workspace));
  assert.equal(resolved.source, "RUNTIME_ENVIRONMENT");
  const custody = resolveSpawnerWorkspaceCustody({taskRoot: nested, taskLabel: "hostile-test task worktree"});
  assert.equal(custody.taskRoot, fs.realpathSync.native(nested));
  assert.equal(custody.receipt.task_root_within_workspace, true);
  assert.doesNotThrow(() => validateSpawnerWorkspaceCustodyReceipt(custody.receipt));
  assert.equal(custody.receipt.workspace_root, fs.realpathSync.native(workspace));

  process.env.AGENTOS_PROJECTS_ROOT = path.relative(repositoryRoot, workspace);
  expectCode(() => resolveConfiguredSpawnerWorkspaceRoot(), "SPAWNER_WORKSPACE_ROOT_RELATIVE", "relative configured root was accepted");

  process.env.AGENTOS_PROJECTS_ROOT = workspace;
  expectCode(() => resolveSpawnerWorkspaceCustody({taskRoot: outside, taskLabel: "escaped task worktree"}), "SPAWNER_WORKSPACE_CONTAINMENT_REJECTED", "workspace escape was accepted");

  const workspaceAlias = path.join(root, "workspace-alias");
  fs.symlinkSync(workspace, workspaceAlias, "dir");
  process.env.AGENTOS_PROJECTS_ROOT = workspaceAlias;
  expectCode(() => resolveConfiguredSpawnerWorkspaceRoot(), "SPAWNER_WORKSPACE_SYMLINK_REJECTED", "symlinked workspace root was accepted");

  process.env.AGENTOS_PROJECTS_ROOT = workspace;
  const taskAlias = path.join(workspace, "task-alias");
  fs.symlinkSync(task, taskAlias, "dir");
  expectCode(() => resolveSpawnerWorkspaceCustody({taskRoot: taskAlias, taskLabel: "symlinked task worktree"}), "SPAWNER_WORKSPACE_SYMLINK_REJECTED", "symlinked task worktree was accepted");

  const slash = String.fromCharCode(47);
  const backslash = String.fromCharCode(92);
  const dollar = String.fromCharCode(36);
  const personalPath = [slash, ["U", "sers"].join(""), slash, "fixture", slash, "workspace"].join("");
  const homePath = [slash, "home", slash, "fixture", slash, "workspace"].join("");
  const windowsPath = ["C:", backslash, "Users", backslash, "fixture"].join("");
  const homeEnvironment = [dollar, "HOME", slash, "workspace"].join("");
  for (const value of [personalPath, homePath, windowsPath, homeEnvironment, "~/workspace"]) {
    expectCode(() => assertSpawnerPortableInputText(`declared input: ${value}`, "hostile portable input"), "SPAWNER_PERSONAL_PATH_LITERAL", "personal/home path literal was accepted");
  }
  assert.doesNotThrow(() => assertSpawnerPortableInputText("relative package input", "portable input"));
  const inventory = assertSpawnerPortableInputs({repositoryRoot});
  assert.equal(inventory.status, "PASS");
  assert.ok(inventory.tracked_input_count > 0);
  console.log(`PASS Spawner workspace custody: runtime root resolution, descendant-only task custody, relative/escape/symlink rejection, and portable package/schema input scanning (${inventory.tracked_input_count} tracked inputs)`);
} finally {
  for (const key of environmentKeys) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
  fs.rmSync(root, {recursive: true, force: true});
  fs.rmSync(outside, {recursive: true, force: true});
}
