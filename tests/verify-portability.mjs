#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  applyCorpusPlan,
  canonicalCompactJson,
  compileCorpusPlan,
  validateCorpusInputs,
} from "../control/authority-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      fail(`symbolic link exists in candidate: ${path.relative(root, absolute)}`);
    } else if (stat.isDirectory()) {
      result.push(...listFiles(absolute));
    } else if (stat.isFile()) {
      result.push(absolute);
    } else {
      fail(`unsupported candidate filesystem entry: ${path.relative(root, absolute)}`);
    }
  }
  return result;
}

function collectBoundPaths(value, output = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && (key === "path" || key.endsWith("_path"))) {
      output.push(child);
    }
    collectBoundPaths(child, output);
  }
  return output;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const files = listFiles(root);
for (const absolute of files.filter((entry) => entry.endsWith(".json"))) {
  try {
    JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${path.relative(root, absolute)} (${error.message})`);
  }
}
for (const absolute of files.filter((entry) => entry.endsWith(".mjs"))) {
  const checked = spawnSync(process.execPath, ["--check", absolute], {
    cwd: root,
    encoding: "utf8",
  });
  if (checked.status !== 0) {
    fail(`invalid JavaScript: ${path.relative(root, absolute)}: ${checked.stderr.trim()}`);
  }
}

const forbiddenProductIdentity = ["Soc", "iuna"].join("");
const forbiddenAbsolutePath = ["/", "Users", "/"].join("");
const forbiddenRepositoryOwner = ["nicks", "git", "repo"].join("");
const forbiddenStrings = [
  forbiddenProductIdentity,
  forbiddenAbsolutePath,
  forbiddenRepositoryOwner,
];
const credentialUrl = /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu;
const accessKey = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u;
const tokenValue = /\b(?:ghp|github_pat|sk|rk)[_-][A-Za-z0-9_-]{20,}\b/u;
const taskUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
for (const absolute of files) {
  const text = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(root, absolute);
  for (const token of forbiddenStrings) {
    if (text.includes(token)) fail(`forbidden product identity in ${relative}`);
  }
  if (credentialUrl.test(text)) fail(`credential-bearing URL in ${relative}`);
  if (accessKey.test(text)) fail(`cloud access key shape in ${relative}`);
  if (tokenValue.test(text)) fail(`API token shape in ${relative}`);
  if (taskUuid.test(text)) fail(`task/session UUID in ${relative}`);
}

const binding = readJson("schemas/bootstrap-binding.v1.json");
const boundPaths = collectBoundPaths(binding);
for (const relative of boundPaths) {
  if (path.isAbsolute(relative)
      || relative.includes("\\")
      || relative.split("/").some((segment) => segment === ".." || segment === "")) {
    fail(`unsafe bound path: ${relative}`);
    continue;
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    fail(`bound path is not a regular file: ${relative}`);
  }
}

const context = readJson("examples/project-context-fixture.v1.json");
const workflow = readJson("schemas/capability-and-worktree-registry.v1.json");
if (context.kernel?.override_allowed !== false) {
  fail("project context does not explicitly forbid governance override");
}
const preparedPlan = compileCorpusPlan(context, workflow);
const repeatedPlan = compileCorpusPlan(structuredClone(context), structuredClone(workflow));
if (canonicalCompactJson(preparedPlan) !== canonicalCompactJson(repeatedPlan)
    || preparedPlan.plan_sha256 !== repeatedPlan.plan_sha256) {
  fail("repeated compilation is not deterministic");
}

const importedContext = structuredClone(context);
importedContext.portable_template_instance.authority.project_context_articles.push(
  "external-source/context.md",
);
const importedPlan = compileCorpusPlan(importedContext, workflow);
if (canonicalCompactJson(preparedPlan.pages) !== canonicalCompactJson(importedPlan.pages)
    || preparedPlan.context_identity.exact_context_digest
      === importedPlan.context_identity.exact_context_digest) {
  fail("imported project context is not separate from the governed tree plan");
}

const overrideAttempt = structuredClone(context);
overrideAttempt.kernel.override_allowed = true;
try {
  validateCorpusInputs(overrideAttempt, workflow);
  fail("project-specific context extension overrode portable governance");
} catch {
  // Expected hostile state.
}

const emptyProject = structuredClone(context);
emptyProject.project_name = "Synthetic Empty Project";
emptyProject.authority_corpus_activation = "ACTIVATED";
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-empty-project-"));
try {
  const applied = applyCorpusPlan(emptyRoot, emptyProject, workflow);
  const repeatedAppliedPlan = compileCorpusPlan(emptyProject, workflow);
  if (applied.plan.plan_sha256 !== repeatedAppliedPlan.plan_sha256
      || !fs.existsSync(path.join(emptyRoot, emptyProject.authority_corpus_roots.authority_index_path))) {
    fail("empty synthetic project did not receive a deterministic authority corpus");
  }
  for (const page of applied.plan.pages) {
    if (!fs.existsSync(path.join(emptyRoot, page.relative_path))) {
      fail(`empty synthetic project missing page: ${page.relative_path}`);
    }
  }
} finally {
  fs.rmSync(emptyRoot, {recursive: true, force: true});
}

const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-symlink-root-"));
const symlinkExternal = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-symlink-external-"));
try {
  fs.mkdirSync(path.join(symlinkRoot, "authority"), {recursive: true});
  fs.symlinkSync(symlinkExternal, path.join(symlinkRoot, "authority/features"), "dir");
  const activated = structuredClone(emptyProject);
  activated.authority_corpus_entities.feature_ids = ["feature"];
  let rejected = false;
  try {
    applyCorpusPlan(symlinkRoot, activated, workflow);
  } catch {
    rejected = true;
  }
  if (!rejected) fail("symlinked authority path was accepted");
  if (fs.readdirSync(symlinkExternal).length !== 0) {
    fail("symlinked authority path received writes outside the admitted root");
  }
} finally {
  fs.rmSync(symlinkRoot, {recursive: true, force: true});
  fs.rmSync(symlinkExternal, {recursive: true, force: true});
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS AgentOS 2.1rc portability: ${files.length} files scanned; ${boundPaths.length} bound paths; JSON and script syntax verified; deterministic empty-project, context-separation, extension-boundary, containment, and symlink cases passed`);
}
