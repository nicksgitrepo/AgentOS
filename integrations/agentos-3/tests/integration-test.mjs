import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { combinedBootstrap, assertInactive } from "../bootstrap.mjs";
import { createAgentOS3Runtime, TEST_CAPABILITY_SCHEMA } from "../memory-adapter.mjs";
import { compileGovernanceCandidate, validateCandidateFixtures } from "../agent-builder-adapter.mjs";
import { installBundle } from "../install.mjs";
import { rollbackTestBuild } from "../rollback.mjs";
import { snapshotProject, snapshotsEqual } from "../custody.mjs";
import { verifyMainCore } from "../tools/verify-main-core.mjs";
import { createCombinedMainCoreEntrypoint } from "../main-core/entrypoint.mjs";
import { createAgentOS3TestBuild } from "../entrypoint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = dirname(HERE);
const BUNDLE = join(INTEGRATION_ROOT, "dist", "AGENTOS_3_TEST_BUILD.bundle.json");
const MAIN_SOURCE = process.env.AGENTOS_MAIN_SOURCE_ROOT;
assert.ok(MAIN_SOURCE, "AGENTOS_MAIN_SOURCE_ROOT is required for exact core rebind proof");

function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }

async function createGitProject(parent, name, imported = false) {
  const root = join(parent, name);
  await (await import("node:fs/promises")).mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "project.json"), JSON.stringify({ schema: "generic.project.fixture.v1", imported }, null, 2) + "\n");
  if (imported) await writeFile(join(root, "imported-record.json"), "{\"kind\":\"generic-import\"}\n");
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "AgentOS Test");
  git(root, "add", ".");
  git(root, "commit", "-qm", "generic fixture");
  return root;
}

const bootstrap = await combinedBootstrap();
assertInactive(bootstrap);
assert.equal(bootstrap.activation, "OFF");
assert.equal(bootstrap.specialist_library.admitted_for_test_build, true);
assert.equal(bootstrap.specialist_library.activation, "OFF");
assert.equal(createAgentOS3Runtime({ projectRef: "ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", controlPlaneRef: "ref_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }).memory_enabled, false);
assert.throws(() => createAgentOS3Runtime({ memoryEnabled: true, projectRef: "ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", controlPlaneRef: "ref_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }), /MEMORY_DEFAULT_OFF/);

const builder = validateCandidateFixtures();
assert.match(builder.task_ir, /RESULT PASS/);
assert.match(builder.context_blocks, /RESULT PASS/);
const validRequest = {
  role_id: "role.generic-test",
  role_name: "Generic Test Role",
  purpose: "compile a bounded candidate",
  scope: { include: ["generic-input"], exclude: ["side-effects"] },
  source_refs: ["source:typed-input"],
  budget: { max_tokens: 400, projected_tokens: 120 },
  version: "1.0.0",
  unknown_fields: [],
  contradictions: [],
  omissions: [],
  stale_source: false
};
const candidate = compileGovernanceCandidate(validRequest);
assert.equal(candidate.admission, "NOT_ADMITTED");
assert.deepEqual(candidate.authority_effect_grants, []);
assert.equal(candidate.activation_package.capability_lease, "EXTERNAL_TYPED_LEASE_REQUIRED");
assert.equal(candidate.context_projection.security.secrets_allowed, false);
for (const [field, error] of [["unknown_fields", "UNKNOWN_FIELD"], ["contradictions", "CONTRADICTION"], ["omissions", "OMISSION"], ["stale_source", "STALE_SOURCE"]]) {
  const invalid = structuredClone(validRequest);
  invalid[field] = field === "stale_source" ? true : ["one"];
  assert.throws(() => compileGovernanceCandidate(invalid), new RegExp(error));
}

const root = await mkdtemp(join(await realpath(tmpdir()), "agentos-3-integration-"));
const projectRoot = await createGitProject(root, "project", true);
const companionRoot = join(root, "project.agentos-3");
const before = await snapshotProject(projectRoot);
const projectRef = `ref_${randomBytes(16).toString("hex")}`;
const controlPlaneRef = `ref_${randomBytes(16).toString("hex")}`;
const lease = randomBytes(32).toString("hex");
const capability = { schema: TEST_CAPABILITY_SCHEMA, build_id: "AGENTOS_3_TEST_BUILD", project_ref: projectRef, control_plane_ref: controlPlaneRef, scope: "memory:test", expires_at_utc: new Date(Date.now() + 60_000).toISOString(), nonce: randomBytes(32).toString("hex"), lease };
const runtime = createAgentOS3Runtime({ projectRef, controlPlaneRef, capabilityVerifier: async (value, expected) => value.lease === lease && value.build_id === expected.build_id && value.project_ref === expected.project_ref && value.control_plane_ref === expected.control_plane_ref });
const wrongCapability = { ...capability, lease: randomBytes(32).toString("hex") };
await assert.rejects(() => runtime.enableForTest(wrongCapability), /CAPABILITY_NOT_VERIFIED/);
const memory = await runtime.enableForTest(capability);
const memoryRoot = join(root, "memory");
const first = await memory.initialize(memoryRoot, "test-build");
await first.memory.propose({ record_id: "memory:test-record", family: "fact", statement: "A staged test fact", role: "test", lane: "local" });
await first.memory.transition("memory:test-record", "RECORD_VERIFIED", { actor: "reviewer" });
await first.memory.transition("memory:test-record", "RECORD_ACCEPTED", { actor: "controller" });
assert.equal((await first.memory.projectState()).records.get("memory:test-record").effective_state, "ACCEPTED");
await first.project.verify();
const reopened = await memory.reopen(memoryRoot);
assert.equal((await reopened.memory.projectState()).records.get("memory:test-record").effective_state, "ACCEPTED");

const core = await verifyMainCore({ sourceRoot: MAIN_SOURCE, coreRoot: join(INTEGRATION_ROOT, "main-core") });
assert.equal(core.candidate_commit, core.release_source.source_commit);
assert.equal(core.candidate_tree, core.release_source.source_tree);
const mainEntrypoint = createCombinedMainCoreEntrypoint();
assert.equal(mainEntrypoint.activation, "OFF");
assert.ok(mainEntrypoint.exports_available.includes("bootstrapAndStartAgentOS"));
assert.ok(mainEntrypoint.exports_available.includes("compileControllerCampaignCandidate"));
assert.equal(mainEntrypoint.controller_probe.status, "MAIN_CORE_CONTROLLER_COMPILE_PASS");
assert.equal(mainEntrypoint.controller_probe.activation, "OFF");
const combined = await createAgentOS3TestBuild({ projectRef, controlPlaneRef, capabilityVerifier: async () => false });
assert.equal(combined.activation, "OFF");
assert.equal(combined.bootstrap.memory.enabled, false);
assert.equal(combined.agent_builder.activation, "NOT_ACTIVATED");
assert.equal(combined.specialist_library.activation, "OFF");
assert.equal(combined.specialist_library.roster_sha256, "9309836799934070627329157e9f024b1c38d32bb5d1ae59ed879890228aab08");
assert.equal(combined.main_core.identity.candidate_commit, core.candidate_commit);

const installed = await installBundle(BUNDLE, { projectRoot, companionRoot });
assert.equal(installed.activation, "OFF");
assert(snapshotsEqual(before, await snapshotProject(projectRoot)), "project changed during install");
assert.deepEqual((await readdir(projectRoot)).sort(), [".git", "imported-record.json", "project.json"].sort());
await assert.rejects(() => installBundle(BUNDLE, { projectRoot, companionRoot: join(projectRoot, ".sidecar") }), /PROJECT_COMPANION_OVERLAP/);
await assert.rejects(() => installBundle(BUNDLE, { projectRoot, companionRoot: join(root, "sidecar"), mode: "PROJECT_SIDE_CAR" }), /PROJECT_SIDE_CAR_FORBIDDEN/);
await assert.rejects(() => installBundle(BUNDLE, { projectRoot, companionRoot: join(root, "in-project"), mode: "IN_PROJECT_OPT_IN" }), /IN_PROJECT_OPT_IN_FORBIDDEN/);

const foreignPath = join(companionRoot, "foreign.txt");
await writeFile(foreignPath, "foreign\n", { flag: "wx" });
await assert.rejects(() => rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE }), /ROLLBACK_FOREIGN_OR_MISSING_FILE/);
await rm(foreignPath);
const receiptPath = join(companionRoot, "install-receipt.json");
const receiptBytes = await readFile(receiptPath);
await rm(receiptPath);
await assert.rejects(() => rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE }), /INSTALL_RECEIPT_MISSING/);
await writeFile(receiptPath, receiptBytes, { flag: "wx" });
const ownedPath = join(companionRoot, "payload", "CURRENT_STATE.md");
const ownedBytes = await readFile(ownedPath);
await writeFile(ownedPath, Buffer.from("changed\n"));
await assert.rejects(() => rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE }), /ROLLBACK_CHANGED_FILE/);
await writeFile(ownedPath, ownedBytes);
await writeFile(join(projectRoot, "untracked.txt"), "changed project\n");
await assert.rejects(() => rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE }), /PROJECT_CHANGED_BEFORE_ROLLBACK/);
await rm(join(projectRoot, "untracked.txt"));
const rolledBack = await rollbackTestBuild({ projectRoot, companionRoot, bundlePath: BUNDLE });
assert.equal(rolledBack.project_unchanged, true);
assert(snapshotsEqual(before, await snapshotProject(projectRoot)), "project changed during rollback");
assert.deepEqual((await readdir(projectRoot)).sort(), [".git", "imported-record.json", "project.json"].sort());

const maliciousRoot = await mkdtemp(join(tmpdir(), "agentos-3-malicious-"));
const maliciousBundle = join(maliciousRoot, "bad.bundle.json");
const maliciousManifest = join(maliciousRoot, "bad.manifest.json");
const originalBundle = JSON.parse(await readFile(BUNDLE, "utf8"));
originalBundle.entries[0].bytes_base64 = Buffer.from("tampered\n").toString("base64");
await writeFile(maliciousBundle, JSON.stringify(originalBundle, null, 2) + "\n");
const originalManifest = JSON.parse(await readFile(BUNDLE.replace(/\.bundle\.json$/u, ".manifest.json"), "utf8"));
await writeFile(maliciousManifest, JSON.stringify(originalManifest, null, 2) + "\n");
const failedCompanion = join(root, "failed.agentos-3");
await assert.rejects(() => installBundle(maliciousBundle, { projectRoot, companionRoot: failedCompanion }), /BUNDLE_DIGEST_MISMATCH/);
await assert.rejects(() => readdir(failedCompanion), /ENOENT/);
assert.equal((await readdir(root)).filter((name) => name.startsWith("failed.agentos-3.stage-")).length, 0);
await assert.rejects(() => rollbackTestBuild({ projectRoot, companionRoot: root, bundlePath: BUNDLE }), /PROJECT_COMPANION_OVERLAP/);
assert.equal((await readFile(join(projectRoot, "project.json"), "utf8")).includes("generic"), true);
await rm(maliciousRoot, { recursive: true, force: true });
await rm(root, { recursive: true, force: true });

const bundleText = await readFile(BUNDLE, "utf8");
const forbiddenMarkers = ["Job" + "Sight", "Well" + "Sight", "Soci" + "una", String.fromCharCode(47) + "Users" + String.fromCharCode(47)];
assert(forbiddenMarkers.every((marker) => !bundleText.includes(marker)), "non-portable context in bundle");
console.log(`AGENTOS_3_TEST_PROOF PASS core=${core.entry_count} default-off capability-bound builder-compile hostile-install rollback-project-unchanged restart-replay purity`);
