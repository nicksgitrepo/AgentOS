#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {compileBootstrapCoverage} from "../control/bootstrap-coverage.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {planBootstrapQuestions} from "../control/bootstrap-compiler.mjs";

function fact(discovery, id) {
  return discovery.facts.find((entry) => entry.fact_id === id);
}

function importRow(discovery) {
  return compileBootstrapCoverage({
    discovery: discovery.facts,
    answers: {"bootstrap.discovery.mode": "RECOMMENDED"},
  }).outputs.find((entry) => entry.output_id === "PROJECT_IMPORT");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-multirepo-"));
try {
  const api = path.join(root, "services", "api");
  const web = path.join(root, "apps", "web");
  fs.mkdirSync(path.join(api, ".git"), {recursive: true});
  fs.mkdirSync(web, {recursive: true});
  fs.writeFileSync(path.join(web, ".git"), "gitdir: ../.git/worktrees/web\n");

  const multi = discoverProject(root, "RECOMMENDED");
  assert.equal(fact(multi, "repositories.topology")?.value, "MULTI_REPOSITORY_PROJECT_ROOT");
  assert.equal(fact(multi, "repositories.topology")?.status, "OBSERVED_FACT");
  assert.equal(fact(multi, "repositories.nested.count")?.value, 2);
  assert.equal(multi.facts.filter((entry) => entry.fact_id.startsWith("repositories.nested.")
    && entry.fact_id !== "repositories.nested.count" && entry.status === "OBSERVED_FACT").length, 2);
  assert.equal(importRow(multi)?.status, "OWNER_REQUIRED");
  assert(importRow(multi)?.discovery_inputs.some((id) => id.startsWith("repositories.nested.")));
  assert.equal(planBootstrapQuestions({
    discovery: multi.facts,
    answers: {"bootstrap.discovery.mode": "RECOMMENDED"},
  }).next, "project.north_star", "multi-repository discovery must not reorder the first intent question");

  const gitParent = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-git-parent-"));
  try {
    const initialized = spawnSync("git", ["init", "--quiet", gitParent], {encoding: "utf8"});
    assert.equal(initialized.status, 0, initialized.stderr);
    fs.mkdirSync(path.join(gitParent, "packages", "worker", ".git"), {recursive: true});
    const discovery = discoverProject(gitParent, "RECOMMENDED");
    assert.equal(fact(discovery, "repositories.topology")?.value, "MULTI_REPOSITORY_PROJECT_ROOT");
    assert.equal(fact(discovery, "repositories.topology")?.status, "OBSERVED_FACT");
  } finally {
    fs.rmSync(gitParent, {recursive: true, force: true});
  }

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-empty-"));
  try {
    const discovery = discoverProject(empty, "RECOMMENDED");
    assert.equal(fact(discovery, "repositories.topology")?.status, "UNKNOWN");
    assert.equal(fact(discovery, "repositories.topology")?.reason, "NOT_A_GIT_REPOSITORY");
    assert.equal(importRow(discovery)?.status, "NOT_APPLICABLE_WITH_PROOF");
  } finally {
    fs.rmSync(empty, {recursive: true, force: true});
  }

  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-symlink-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-symlink-target-"));
  try {
    fs.mkdirSync(path.join(target, "repo", ".git"), {recursive: true});
    fs.symlinkSync(target, path.join(symlinkRoot, "linked-repository"), "dir");
    fs.symlinkSync(target, path.join(symlinkRoot, "node_modules"), "dir");
    const discovery = discoverProject(symlinkRoot, "RECOMMENDED");
    assert.equal(discovery.facts.some((entry) => entry.fact_id.startsWith("repositories.nested.")
      && entry.status === "OBSERVED_FACT"), false, "discovery must not follow a repository symlink");
    assert(discovery.facts.some((entry) => entry.fact_id.startsWith("repositories.nested.issue.")
      && entry.reason === "SYMLINK_NOT_FOLLOWED"));
    assert.equal(discovery.facts.some((entry) => entry.source_locator === "node_modules"), false,
      "dependency symlink trees must not create topology conflicts");
    assert.equal(fact(discovery, "repositories.topology")?.status, "CONFLICT");
    assert.equal(importRow(discovery)?.status, "OWNER_REQUIRED");
  } finally {
    fs.rmSync(symlinkRoot, {recursive: true, force: true});
    fs.rmSync(target, {recursive: true, force: true});
  }

  console.log("PASS AgentOS Bootstrap multi-repository discovery: nested identities, import gating, first-question ordering, empty-root proof, and symlink hostile case");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
