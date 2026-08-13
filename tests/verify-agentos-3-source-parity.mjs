import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {
  listReleaseFiles,
  verifyReleaseBinding,
  verifyReleaseSourceIdentity,
} from "../integrations/agentos-3/tools/release-source.mjs";
import {verifyMainCore} from "../integrations/agentos-3/tools/verify-main-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const integrationRoot = join(root, "integrations", "agentos-3");
function git(repository, ...args) { return execFileSync("git", ["-C", repository, ...args], {encoding: "utf8"}).trim(); }

const fixture = await mkdtemp(join(tmpdir(), "agentos-release-source-"));
try {
  await mkdir(join(fixture, "control"), {recursive: true});
  await writeFile(join(fixture, "control", "portable.mjs"), "export const portable = true;\n");
  git(fixture, "init", "-q");
  git(fixture, "config", "user.email", "release-source@example.invalid");
  git(fixture, "config", "user.name", "Release Source Test");
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "source baseline");
  const sourceCommit = git(fixture, "rev-parse", "HEAD");
  const sourceTree = git(fixture, "rev-parse", "HEAD^{tree}");
  assert.equal(verifyReleaseSourceIdentity({repositoryRoot: fixture, sourceCommit, sourceTree}).status, "EXACT_SOURCE_OR_GENERATED_DESCENDANT");

  await mkdir(join(fixture, "integrations", "agentos-3", "dist"), {recursive: true});
  await mkdir(join(fixture, "integrations", "agentos-3", "main-core", "governance"), {recursive: true});
  await mkdir(join(fixture, "integrations", "agentos-3", "main-core", "migrations"), {recursive: true});
  await writeFile(join(fixture, "integrations", "agentos-3", "dist", "artifact.json"), "{}\n");
  await writeFile(join(fixture, "integrations", "agentos-3", "main-core", "governance", "authority.json"), "{}\n");
  await writeFile(join(fixture, "integrations", "agentos-3", "main-core", "migrations", "authority.json"), "{}\n");
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "generated artifact");
  const generated = verifyReleaseSourceIdentity({repositoryRoot: fixture, sourceCommit, sourceTree});
  assert.deepEqual(generated.generated_committed_paths, [
    "integrations/agentos-3/dist/artifact.json",
    "integrations/agentos-3/main-core/governance/authority.json",
    "integrations/agentos-3/main-core/migrations/authority.json",
  ]);

  await writeFile(join(fixture, "control", "portable.mjs"), "export const portable = false;\n");
  assert.throws(() => verifyReleaseSourceIdentity({repositoryRoot: fixture, sourceCommit, sourceTree}), /RELEASE_SOURCE_DIRTY/u);
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "unauthorized source drift");
  assert.throws(() => verifyReleaseSourceIdentity({repositoryRoot: fixture, sourceCommit, sourceTree}), /RELEASE_SOURCE_DRIFT/u);
} finally {
  await rm(fixture, {recursive: true, force: true});
}

const symlinkFixture = await mkdtemp(join(tmpdir(), "agentos-release-symlink-"));
try {
  await writeFile(join(symlinkFixture, "target"), "target\n");
  await symlink("target", join(symlinkFixture, "link"));
  await assert.rejects(() => listReleaseFiles(symlinkFixture), /RELEASE_SYMLINK_FORBIDDEN/u);
} finally {
  await rm(symlinkFixture, {recursive: true, force: true});
}

const binding = await verifyReleaseBinding({integrationRoot});
assert.equal(binding.activation, "OFF");
const sourceManifest = JSON.parse(await readFile(join(integrationRoot, "main-core", "source-manifest.json"), "utf8"));
const actual = verifyReleaseSourceIdentity({repositoryRoot: root, sourceCommit: sourceManifest.source_commit, sourceTree: sourceManifest.source_tree});
const core = await verifyMainCore({sourceRoot: root, coreRoot: join(integrationRoot, "main-core")});
assert.equal(sourceManifest.schema, "agentos.integration.main-core-manifest.v3");
assert.deepEqual(sourceManifest.source_bindings, [
  {source: "control", target: "control"},
  {source: "governance/3.0/audit-repair-convergence.binding.v1.json", target: "governance/3.0/audit-repair-convergence.binding.v1.json"},
  {source: "governance/3.0/audit-repair-convergence.md", target: "governance/3.0/audit-repair-convergence.md"},
  {source: "governance/3.0/permanent-role-authority-graph.v1.json", target: "governance/3.0/permanent-role-authority-graph.v1.json"},
  {source: "governance/3.0/scheduler-runtime-custody-binding.v1.json", target: "governance/3.0/scheduler-runtime-custody-binding.v1.json"},
  {source: "governance/3.0/scheduler-runtime-custody.md", target: "governance/3.0/scheduler-runtime-custody.md"},
  {source: "migrations/audit-repair-convergence-v1.md", target: "migrations/audit-repair-convergence-v1.md"},
  {source: "migrations/permanent-role-authority.v1.json", target: "migrations/permanent-role-authority.v1.json"},
  {source: "migrations/scheduler-runtime-custody.v1.json", target: "migrations/scheduler-runtime-custody.v1.json"},
]);
assert(sourceManifest.entries.some((entry) => entry.path === "governance/3.0/permanent-role-authority-graph.v1.json"));
assert(sourceManifest.entries.some((entry) => entry.path === "governance/3.0/audit-repair-convergence.binding.v1.json"));
assert(sourceManifest.entries.some((entry) => entry.path === "governance/3.0/scheduler-runtime-custody-binding.v1.json"));
assert(sourceManifest.entries.some((entry) => entry.path === "migrations/permanent-role-authority.v1.json"));
assert(sourceManifest.entries.some((entry) => entry.path === "migrations/audit-repair-convergence-v1.md"));
assert(sourceManifest.entries.some((entry) => entry.path === "migrations/scheduler-runtime-custody.v1.json"));
assert.equal(actual.identity_sha256, core.release_source.identity_sha256);
assert.equal(core.candidate_commit, actual.source_commit);

console.log("PASS AgentOS 3 release-source parity: exact source/tree, generated-only descendants, dirty and committed source drift denial, symlink denial, bound policy, and main-core Git-object plus runtime-authority-asset parity");
