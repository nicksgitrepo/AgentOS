#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  assertTaskWorkspaceCustody,
  compileTaskWorkspaceCustodyReceipt,
  resolveTaskWorkspaceRoot,
} from "../control/task-workspace-custody.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-task-custody-"));
try {
  const workspace = path.join(tempRoot, "workspace");
  const checkout = path.join(workspace, "checkout");
  const worktree = path.join(checkout, "task-worktree");
  const outside = path.join(tempRoot, "outside");
  fs.mkdirSync(worktree, {recursive: true});
  fs.mkdirSync(outside, {recursive: true});
  execFileSync("git", ["-C", checkout, "init", "-q"], {stdio: "ignore"});
  const receipt = compileTaskWorkspaceCustodyReceipt({
    projectRoot: checkout,
    workspaceRoot: workspace,
    taskCheckout: checkout,
    taskWorktree: worktree,
    observedAtUtc: new Date().toISOString(),
  });
  assert.equal(receipt.status, "MATCHED");
  assert.equal(receipt.workspace_root, fs.realpathSync.native(workspace));
  assertTaskWorkspaceCustody(receipt);
  assert.throws(
    () => compileTaskWorkspaceCustodyReceipt({projectRoot: checkout, workspaceRoot: workspace, taskCheckout: outside, taskWorktree: worktree}),
    (error) => error.code === "TASK_WORKSPACE_CUSTODY_ESCAPE",
  );
  const active = resolveTaskWorkspaceRoot({projectRoot: root, workspaceRoot: root});
  assert.equal(active.project_root, fs.realpathSync.native(root));

  const personalPath = new RegExp(`${["/", "Users", "/"].join("")}(?:[^/\\s]+/)+|${["/", "home", "/"].join("")}(?:[^/\\s]+/)`, "u");
  const scanRoots = ["control", "schemas", "docs", "prompts", "tests"];
  const scan = (directory) => {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...scan(target));
      else if (entry.isFile()) files.push(target);
    }
    return files;
  };
  for (const relative of scanRoots) for (const file of scan(path.join(root, relative))) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(personalPath.test(text), false, `personal absolute path literal found in ${path.relative(root, file)}`);
  }
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}

console.log("PASS task workspace custody: runtime-derived root, descendant-only checkout/worktree containment, and personal-path portability regression");
