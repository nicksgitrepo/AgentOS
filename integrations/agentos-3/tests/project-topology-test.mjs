import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotProject, snapshotsEqual } from "../custody.mjs";

const INTEGRATION_ROOT = fileURLToPath(new URL("..", import.meta.url));

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function createRepository(root, marker) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "marker.txt"), `${marker}\n`);
  git(root, "init", "-q");
  git(root, "config", "user.email", "topology-test@example.invalid");
  git(root, "config", "user.name", "AgentOS Topology Test");
  git(root, "add", ".");
  git(root, "commit", "-qm", "generic topology fixture");
}

const schema = JSON.parse(await readFile(join(INTEGRATION_ROOT, "contracts", "project-snapshot.v2.json"), "utf8"));
assert.equal(schema.properties.schema.const, "agentos.integration.project_snapshot.v2");

const root = await mkdtemp(join(tmpdir(), "agentos-project-topology-"));
try {
  const empty = join(root, "empty");
  await mkdir(empty);
  const emptySnapshot = await snapshotProject(empty);
  assert.equal(emptySnapshot.topology, "EMPTY_PROJECT_ROOT");
  assert.deepEqual(emptySnapshot.entries, []);
  assert.deepEqual(emptySnapshot.repositories, []);

  const nonGit = join(root, "non-git");
  await mkdir(join(nonGit, "empty-directory"), { recursive: true });
  await writeFile(join(nonGit, "project.txt"), "generic non-Git project\n");
  const nonGitSnapshot = await snapshotProject(nonGit);
  assert.equal(nonGitSnapshot.topology, "NON_GIT_PROJECT_ROOT");
  assert(nonGitSnapshot.entries.some((entry) => entry.path === "empty-directory" && entry.type === "DIRECTORY"));
  await mkdir(join(nonGit, "new-empty-directory"));
  assert.equal(snapshotsEqual(nonGitSnapshot, await snapshotProject(nonGit)), false, "empty directory mutation was not detected");

  const composition = join(root, "composition");
  await createRepository(join(composition, "services", "api"), "api");
  await createRepository(join(composition, "clients", "web"), "web");
  await writeFile(join(composition, "services", "api", "untracked.txt"), "untracked user state\n");
  const compositionSnapshot = await snapshotProject(composition);
  assert.equal(compositionSnapshot.topology, "MULTI_REPOSITORY_PROJECT_ROOT");
  assert.deepEqual(compositionSnapshot.repositories.map((entry) => entry.relative_root), ["clients/web", "services/api"]);
  assert(compositionSnapshot.repositories.every((entry) => entry.state === "HEAD_BOUND"));
  assert(compositionSnapshot.repositories.find((entry) => entry.relative_root === "services/api").status_base64.length > 0);
  assert(compositionSnapshot.entries.every((entry) => !entry.path.split("/").includes(".git")), "Git administration entered the project snapshot");

  const rootAndNested = join(root, "root-and-nested");
  await createRepository(rootAndNested, "root");
  await createRepository(join(rootAndNested, "packages", "worker"), "worker");
  const rootAndNestedSnapshot = await snapshotProject(rootAndNested);
  assert.equal(rootAndNestedSnapshot.topology, "MULTI_REPOSITORY_PROJECT_ROOT");
  assert.deepEqual(rootAndNestedSnapshot.repositories.map((entry) => entry.relative_root), [".", "packages/worker"]);

  const symlinkRoot = join(root, "symlink-hostile");
  const external = join(root, "external");
  await mkdir(symlinkRoot);
  await mkdir(external);
  await symlink(external, join(symlinkRoot, "linked"), "dir");
  await assert.rejects(() => snapshotProject(symlinkRoot), /PROJECT_TOPOLOGY_DISCOVERY_INCOMPLETE|PROJECT_SYMLINK/u);

  console.log("AGENTOS_3_PROJECT_TOPOLOGY PASS empty non-git root-and-nested composition exact-git-identities empty-directory zero-trace hostile-symlink");
} finally {
  await rm(root, { recursive: true, force: true });
}
