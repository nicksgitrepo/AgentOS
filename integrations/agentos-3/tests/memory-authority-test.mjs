import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentOS3Runtime, MEMORY_ADAPTER_SURFACE_SCHEMA, TEST_CAPABILITY_SCHEMA } from "../memory-adapter.mjs";
import {
  assertMemoryAuthorityBinding,
  CANONICAL_MEMORY_TYPES,
  compileMemoryAuthorityBinding,
  mapLegacyProjectMemoryType,
  mapM2RecordFamily,
  MEMORY_CATEGORY_MAP_VERSION,
  MEMORY_MAPPING_COVERAGE,
  recoverMappedSource,
  verifyM2AuthorityBinding,
} from "../memory-authority.mjs";
import { canonicalJson, MemoryProject } from "../memory-m2/src/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = dirname(HERE);
const REPOSITORY_ROOT = join(INTEGRATION_ROOT, "..", "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const contract = await readJson(join(INTEGRATION_ROOT, "contracts", "memory-authority.v1.json"));
const contentBinding = await readJson(join(INTEGRATION_ROOT, "contracts", "memory-authority-binding.v1.json"));
const bindingSchema = await readJson(join(REPOSITORY_ROOT, "schemas", "memory-authority-binding.v1.json"));
const mappingSchema = await readJson(join(REPOSITORY_ROOT, "schemas", "memory-category-mapping.v1.json"));
const surfaceSchema = await readJson(join(REPOSITORY_ROOT, "schemas", "agentos-3-memory-adapter-surface.v1.json"));

assert.deepEqual(CANONICAL_MEMORY_TYPES, ["EPISODIC", "SEMANTIC", "PROCEDURAL", "GOVERNANCE", "WORKING_TASK"]);
assert.deepEqual(contract.canonical_taxonomy, CANONICAL_MEMORY_TYPES);
assert.equal(contract.mapping_version, MEMORY_CATEGORY_MAP_VERSION);
assert.equal(bindingSchema.$id, "agentos.memory.authority_binding.v1");
assert.equal(mappingSchema.$id, "agentos.memory.category_mapping.v1");
assert.equal(mappingSchema.oneOf.length, 14);
assert.equal(surfaceSchema.$id, MEMORY_ADAPTER_SURFACE_SCHEMA);
assert.deepEqual(contentBinding.inputs.map(({ path }) => path), [...contentBinding.inputs.map(({ path }) => path)].sort());
for (const input of contentBinding.inputs) {
  assert.equal(createHash("sha256").update(await readFile(join(REPOSITORY_ROOT, input.path))).digest("hex"), input.sha256,
    `memory authority content binding mismatch: ${input.path}`);
}
const contentBindingBody = structuredClone(contentBinding);
delete contentBindingBody.binding_sha256;
assert.equal(createHash("sha256").update(canonicalJson(contentBindingBody)).digest("hex"), contentBinding.binding_sha256);

for (const sourceCategory of MEMORY_MAPPING_COVERAGE.legacy_project_memory) {
  const mapping = mapLegacyProjectMemoryType(sourceCategory);
  assert.equal(mapping.canonical_type, contract.source_mappings.LEGACY_PROJECT_MEMORY[sourceCategory]);
  assert.deepEqual(recoverMappedSource(mapping), { source_system: "LEGACY_PROJECT_MEMORY", source_category: sourceCategory });
}
for (const sourceCategory of MEMORY_MAPPING_COVERAGE.memory_m2) {
  const mapping = mapM2RecordFamily(sourceCategory);
  assert.equal(mapping.canonical_type, contract.source_mappings.MEMORY_M2[sourceCategory]);
  assert.deepEqual(recoverMappedSource(mapping), { source_system: "MEMORY_M2", source_category: sourceCategory });
}
assert.throws(() => mapLegacyProjectMemoryType("UNKNOWN"), (error) => error.code === "UNMAPPED_MEMORY_CATEGORY");
assert.throws(() => mapM2RecordFamily("task"), (error) => error.code === "UNMAPPED_MEMORY_CATEGORY");
const validMapping = mapM2RecordFamily("fact");
assert.throws(() => recoverMappedSource({ ...validMapping, canonical_type: "EPISODIC" }),
  (error) => error.code === "INVALID_CATEGORY_MAPPING");

const projectRef = "ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const controlPlaneRef = "ref_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const binding = compileMemoryAuthorityBinding({
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  memory_project_id: "authority-test",
  selected_authority: "MEMORY_M2",
});
assert.equal(assertMemoryAuthorityBinding(binding), binding);
const legacyBinding = compileMemoryAuthorityBinding({
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  memory_project_id: "authority-test",
  selected_authority: "LEGACY_PROJECT_MEMORY",
});
assert.equal(legacyBinding.authorities.memory_m2, "DISABLED");
assert.throws(() => assertMemoryAuthorityBinding({
  ...binding,
  authorities: { legacy_project_memory: "AUTHORITATIVE", memory_m2: "AUTHORITATIVE" },
}), (error) => error.code === "MEMORY_COAUTHORITY_FORBIDDEN");
assert.throws(() => assertMemoryAuthorityBinding({
  ...binding,
  migration: { ...binding.migration, mode: "LEGACY_TO_M2" },
}), (error) => error.code === "MEMORY_COAUTHORITY_FORBIDDEN");

assert.equal(createAgentOS3Runtime({ projectRef, controlPlaneRef }).memory_enabled, false);
assert.throws(() => createAgentOS3Runtime({ projectRef, controlPlaneRef, memoryEnabled: true }), /MEMORY_DEFAULT_OFF/u);

const lease = randomBytes(32).toString("hex");
const capability = {
  schema: TEST_CAPABILITY_SCHEMA,
  build_id: "AGENTOS_3_TEST_BUILD",
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  scope: "memory:test",
  expires_at_utc: new Date(Date.now() + 600_000).toISOString(),
  nonce: randomBytes(32).toString("hex"),
  lease,
};
let authorityActive = true;
const capabilityVerifier = async (value, expected) => value.lease === lease
  && value.build_id === expected.build_id
  && value.project_ref === expected.project_ref
  && value.control_plane_ref === expected.control_plane_ref;
const memoryAuthorityVerifier = async (value, expected) => authorityActive
  && value.binding_digest === expected.binding_digest
  && value.project_ref === expected.project_ref
  && value.control_plane_ref === expected.control_plane_ref
  && value.memory_project_id === expected.memory_project_id
  && value.selected_authority === "MEMORY_M2"
  && value.authorities.legacy_project_memory === "DISABLED";

const noAuthorityVerifier = createAgentOS3Runtime({ projectRef, controlPlaneRef, capabilityVerifier });
await assert.rejects(() => noAuthorityVerifier.enableForTest(capability, binding), /MEMORY_AUTHORITY_VERIFIER_REQUIRED/u);
const denyingRuntime = createAgentOS3Runtime({ projectRef, controlPlaneRef, capabilityVerifier,
  memoryAuthorityVerifier: async () => false });
await assert.rejects(() => denyingRuntime.enableForTest(capability, binding), /MEMORY_AUTHORITY_NOT_VERIFIED/u);

const runtime = createAgentOS3Runtime({ projectRef, controlPlaneRef, capabilityVerifier, memoryAuthorityVerifier });
await assert.rejects(() => runtime.enableForTest({ ...capability, lease: randomBytes(32).toString("hex") }, binding),
  /CAPABILITY_NOT_VERIFIED/u);
await assert.rejects(() => runtime.enableForTest(capability, legacyBinding),
  (error) => error.code === "MEMORY_M2_NOT_EXCLUSIVE");
const adapter = await runtime.enableForTest(capability, binding);
assert.equal(adapter.descriptor.schema, MEMORY_ADAPTER_SURFACE_SCHEMA);

const root = await mkdtemp(join(tmpdir(), "agentos-memory-authority-"));
try {
  const memoryRoot = join(root, "m2");
  await assert.rejects(() => adapter.initialize(memoryRoot, "different-project"),
    (error) => error.code === "MEMORY_AUTHORITY_BINDING_MISMATCH");
  const opened = await adapter.initialize(memoryRoot, "authority-test");
  assert.equal(opened.descriptor.selected_authority, "MEMORY_M2");
  assert.equal(opened.descriptor.legacy_project_memory, "DISABLED");
  assert.deepEqual(opened.descriptor.canonical_types, CANONICAL_MEMORY_TYPES);
  assert.equal(opened.descriptor.interfaces.taxonomy, "AVAILABLE_TOTAL_FAIL_CLOSED");
  assert.deepEqual(contract.adapter.available, ["taxonomy", "records", "run_workspace", "current_projection", "roster", "rethread", "recovery", "continuity"]);
  assert.equal(opened.taxonomy.mapM2RecordFamily("procedure").canonical_type, "PROCEDURAL");
  assert.throws(() => opened.taxonomy.mapM2RecordFamily("working"),
    (error) => error.code === "UNMAPPED_MEMORY_CATEGORY");
  assert.equal(opened.authority.event_sequence, 2);

  await opened.memory.propose({
    record_id: "memory:authority-fact",
    family: "fact",
    statement: "A portable authority fact",
    role: "controller",
    lane: "core",
  });
  await opened.memory.transition("memory:authority-fact", "RECORD_VERIFIED", { actor: "reviewer" });
  await opened.memory.transition("memory:authority-fact", "RECORD_ACCEPTED", { actor: "controller" });
  assert.equal((await opened.memory.projectState()).records.get("memory:authority-fact").effective_state, "ACCEPTED");

  const projection = await opened.current_projection.rebuild();
  assert.equal(projection.records[0].record_id, "memory:authority-fact");
  assert.equal((await opened.current_projection.verify()).ok, true);

  await opened.roster.register({
    roster: "permanent",
    agent_id: "controller.agent",
    role_id: "controller",
    lane_id: "core",
    session_ref: "session://controller-v1",
    governance_ref: "governance://memory-authority-v1",
  });
  await opened.roster.transition("controller.agent", "READY", { reason: "startup complete" });
  await opened.roster.transition("controller.agent", "ACTIVE", {
    reason: "bounded test run",
    lease_expires_at_utc: "2999-01-01T00:00:00.000Z",
  });
  const run = await opened.run_workspace.start({
    role: "controller",
    lane: "core",
    assignment: "exercise guarded run workspace",
    agent_id: "controller.agent",
    session_epoch: 1,
  });
  await opened.run_workspace.writeScratch(run.run_id, "checkpointed context");
  const checkpoint = await opened.run_workspace.checkpoint(run.run_id, { note: "before rethread" });
  await opened.roster.transition("controller.agent", "DRAINING_FOR_ROLLOVER", { reason: "prepare rethread" });
  const rethread = await opened.rethread("controller.agent", "session://controller-v2", {
    reason: "replace bounded session",
    checkpoint_ref: checkpoint.checkpoint_ref,
    expected_session_epoch: 1,
    tmp_ref: "tmp://controller-v2",
  });
  assert.equal(rethread.body.action, "AGENT_RETHREADED");
  const rosterProjection = await opened.roster.projection();
  assert.equal(rosterProjection.agents[0].session_epoch, 2);
  assert.equal(rosterProjection.agents[0].session_ref, "session://controller-v2");

  for (const name of ["seed.json", "runstate.json", "tmpcontext.md"]) {
    await rm(join(memoryRoot, "tmp", "runs", run.run_id.slice(4), name));
  }
  const recoveredRun = await opened.recovery.run(run.run_id);
  assert.deepEqual(recoveredRun.recovery.restored, ["seed.json", "runstate.json", "tmpcontext.md"]);
  assert.equal(await opened.run_workspace.readScratch(run.run_id), "checkpointed context");

  await rm(join(memoryRoot, "state", "head.json"));
  const recoveredHead = await opened.recovery.head();
  assert.equal(recoveredHead.sequence, (await opened.memory.projectState()).head_sequence);
  assert.equal((await opened.project.verify()).ok, true);

  const beforeDeferred = (await opened.memory.projectState()).head_sequence;
  await assert.rejects(() => opened.migrate(), (error) => error.code === "MEMORY_MIGRATION_NOT_IMPLEMENTED");
  assert.equal(opened.descriptor.interfaces.continuity, "AVAILABLE_GUARDED_TEST_ONLY");
  assert.equal(opened.descriptor.interfaces.handoff_journal, "AVAILABLE_GUARDED_TEST_ONLY");
  assert.equal(opened.descriptor.interfaces.successor_transfer, "AVAILABLE_GUARDED_TEST_ONLY");
  assert.equal((await opened.memory.projectState()).head_sequence, beforeDeferred);

  const reopened = await adapter.reopen(memoryRoot);
  assert.equal((await reopened.project.verify()).ok, true);
  assert.equal(reopened.authority.binding.binding_digest, binding.binding_digest);

  const beforeRevocation = (await reopened.memory.projectState()).head_sequence;
  authorityActive = false;
  await assert.rejects(() => reopened.memory.propose({ family: "fact", statement: "must not write" }),
    /MEMORY_AUTHORITY_NOT_VERIFIED/u);
  authorityActive = true;
  assert.equal((await reopened.memory.projectState()).head_sequence, beforeRevocation);

  const raw = await MemoryProject.open(memoryRoot, { writable: true });
  const competingRef = await raw.putJson(legacyBinding);
  await raw.commit({
    actor: "controller",
    action: "MEMORY_AUTHORITY_BOUND",
    subjectRef: "memory-authority:authority-test",
    objectRef: competingRef,
    metadata: {
      authority_binding_digest: legacyBinding.binding_digest,
      selected_authority: legacyBinding.selected_authority,
      legacy_project_memory: legacyBinding.authorities.legacy_project_memory,
      memory_m2: legacyBinding.authorities.memory_m2,
      authority_epoch: legacyBinding.authority_epoch,
    },
  });
  await assert.rejects(() => verifyM2AuthorityBinding(raw, binding),
    (error) => error.code === "MEMORY_AUTHORITY_CONFLICT");
  await assert.rejects(() => adapter.reopen(memoryRoot),
    (error) => error.code === "MEMORY_AUTHORITY_CONFLICT");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("PASS AgentOS 3 memory authority: five-type taxonomy, total lossless mappings, exclusive signed authority, guarded M2 surfaces, recovery, and hostile denials");
