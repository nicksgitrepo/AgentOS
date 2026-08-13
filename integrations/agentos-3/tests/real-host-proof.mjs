import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installBundle } from "../install.mjs";
import { rollbackTestBuild } from "../rollback.mjs";
import { snapshotProject, snapshotsEqual } from "../custody.mjs";

const INTEGRATION_ROOT = await realpath(join(fileURLToPath(new URL("..", import.meta.url))));
const BUNDLE = join(INTEGRATION_ROOT, "dist", "AGENTOS_3_TEST_BUILD.bundle.json");
const requestedHostRoot = process.env.AGENTOS_REAL_HOST_ROOT ?? tmpdir();
const hostRoot = await realpath(requestedHostRoot);

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function createRepository(root, relativeRoot, marker) {
  const repositoryRoot = join(root, relativeRoot);
  await mkdir(repositoryRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(repositoryRoot, "project.json"), `${JSON.stringify({ schema: "generic.real-host-repository.v1", marker }, null, 2)}\n`);
  git(repositoryRoot, "init", "-q");
  git(repositoryRoot, "config", "user.email", "real-host-proof@example.invalid");
  git(repositoryRoot, "config", "user.name", "AgentOS Real Host Proof");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "-qm", "real-host fixture");
  return repositoryRoot;
}

async function createProject(parent, name, { kind }) {
  const root = join(parent, name);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (kind === "MULTI_REPOSITORY_PROJECT_ROOT") {
    await createRepository(root, "services/api", "api");
    await createRepository(root, "clients/web", "web");
    await writeFile(join(root, "composition.json"), "{\"schema\":\"generic.composition.v1\"}\n");
  }
  return root;
}

function runInstalledBootstrap(companionRoot, projectRoot) {
  const compiler = join(companionRoot, "payload", "main-core", "control", "bootstrap-compiler.mjs");
  const output = execFileSync(process.execPath, [compiler, "start", projectRoot, "RECOMMENDED"], {
    encoding: "utf8",
    env: { ...process.env, AGENTOS_CONTROL_PLANE_ROOT: `${companionRoot}.control` },
  });
  const result = JSON.parse(output);
  assert.equal(result.status, "READ_ONLY_DISCOVERY_COMPLETE");
  assert.equal(result.discovery.discovery_mode, "RECOMMENDED");
  assert.equal(result.bootstrap_operating_mode, "JSA");
  assert.equal(result.question_plan.schema, "agentos.bootstrap_question_plan.v1");
  assert.ok(Array.isArray(result.question_plan.questions) && result.question_plan.questions.length > 0, "Bootstrap returned no question plan");
  return result;
}

const testRoot = await mkdtemp(join(hostRoot, ".agentos-3-real-host-proof-"));
const results = [];
try {
  for (const kind of ["EMPTY_PROJECT_ROOT", "MULTI_REPOSITORY_PROJECT_ROOT"]) {
    const projectRoot = await createProject(testRoot, kind === "EMPTY_PROJECT_ROOT" ? "new-project" : "composed-project", { kind });
    const companionRoot = join(testRoot, kind === "EMPTY_PROJECT_ROOT" ? "new-project.agentos" : "composed-project.agentos");
    const before = await snapshotProject(projectRoot);
    assert.equal(before.topology, kind);
    const installed = await installBundle(BUNDLE, { projectRoot, companionRoot });
    assert.equal(installed.activation, "OFF");
    assert.ok(snapshotsEqual(before, await snapshotProject(projectRoot)), `${kind} changed during sibling install`);
    const bootstrap = runInstalledBootstrap(companionRoot, projectRoot);
    assert.ok(snapshotsEqual(before, await snapshotProject(projectRoot)), `${kind} changed during read-only Bootstrap`);
    const rollback = await rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE });
    assert.equal(rollback.project_unchanged, true);
    assert.ok(snapshotsEqual(before, await snapshotProject(projectRoot)), `${kind} changed during rollback`);
    await assert.rejects(() => readdir(companionRoot), /ENOENT/u);
    results.push({
      kind,
      topology: before.topology,
      activation: installed.activation,
      bootstrap_mode: bootstrap.discovery.discovery_mode,
      question_count: bootstrap.question_plan.questions.length,
      project_unchanged: true,
      companion_removed: true,
    });
  }
} finally {
  await rm(testRoot, { recursive: true, force: true });
}

assert.equal(results.length, 2);
console.log(`AGENTOS_3_REAL_HOST_PROOF PASS ${results.map((result) => `${result.kind}:questions=${result.question_count}:zero-trace`).join(" ")}`);
