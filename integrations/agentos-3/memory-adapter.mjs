import {
  AgentRoster,
  CurrentProjection,
  MemoryProject,
  MemoryService,
  RunWorkspace,
} from "./memory-m2/src/index.mjs";
import {
  assertM2ExclusiveAuthority,
  bindM2Authority,
  CANONICAL_MEMORY_TYPES,
  mapLegacyProjectMemoryType,
  mapM2RecordFamily,
  MEMORY_CATEGORY_MAP_VERSION,
  recoverMappedSource,
  requestMemoryMigration,
  verifyM2AuthorityBinding,
} from "./memory-authority.mjs";
import { MemoryContinuityController } from "./memory-continuity.mjs";

const CAPABILITY_SCHEMA = "agentos.integration.test-capability.v1";
const ADAPTER_SURFACE_SCHEMA = "agentos.integration.memory_adapter_surface.v1";
const OPAQUE = /^ref_[a-z0-9]{32}$/u;
const NONCE = /^[a-f0-9]{64}$/u;

export function createAgentOS3Runtime({
  buildId = "AGENTOS_3_TEST_BUILD",
  projectRef,
  controlPlaneRef,
  capabilityVerifier = null,
  memoryAuthorityVerifier = null,
  memoryEnabled = false,
} = {}) {
  if (memoryEnabled !== false) throw new Error("MEMORY_DEFAULT_OFF");
  if (typeof buildId !== "string" || buildId.length === 0 || !OPAQUE.test(projectRef) || !OPAQUE.test(controlPlaneRef)) {
    throw new Error("MEMORY_BINDING_INVALID");
  }
  const expected = { buildId, projectRef, controlPlaneRef };
  return Object.freeze({
    memory_enabled: false,
    async initialize() { throw new Error("MEMORY_INACTIVE"); },
    async enableForTest(capability, authorityBinding) {
      assertCapability(capability, expected);
      if (typeof capabilityVerifier !== "function") throw new Error("CAPABILITY_VERIFIER_REQUIRED");
      const verified = await capabilityVerifier(capability, {
        build_id: buildId,
        project_ref: projectRef,
        control_plane_ref: controlPlaneRef,
        scope: "memory:test",
      });
      if (verified !== true) throw new Error("CAPABILITY_NOT_VERIFIED");
      assertM2ExclusiveAuthority(authorityBinding, {
        project_ref: projectRef,
        control_plane_ref: controlPlaneRef,
      });
      if (typeof memoryAuthorityVerifier !== "function") throw new Error("MEMORY_AUTHORITY_VERIFIER_REQUIRED");
      await assertExternalAuthority(memoryAuthorityVerifier, authorityBinding, expected);
      return createAuthorizedMemoryAdapter({
        authorityBinding,
        capability,
        capabilityVerifier,
        memoryAuthorityVerifier,
        expected,
      });
    },
  });
}

function assertCapability(capability, expected) {
  if (!capability || capability.schema !== CAPABILITY_SCHEMA || capability.build_id !== expected.buildId
    || capability.project_ref !== expected.projectRef || capability.control_plane_ref !== expected.controlPlaneRef
    || capability.scope !== "memory:test" || !NONCE.test(capability.nonce) || !NONCE.test(capability.lease)
    || !Number.isFinite(Date.parse(capability.expires_at_utc)) || Date.parse(capability.expires_at_utc) <= Date.now()) {
    throw new Error("CAPABILITY_BINDING_INVALID");
  }
}

async function assertExternalAuthority(verifier, binding, expected) {
  const verified = await verifier(binding, {
    project_ref: expected.projectRef,
    control_plane_ref: expected.controlPlaneRef,
    memory_project_id: binding.memory_project_id,
    selected_authority: "MEMORY_M2",
    legacy_project_memory: "DISABLED",
    binding_digest: binding.binding_digest,
  });
  if (verified !== true) throw new Error("MEMORY_AUTHORITY_NOT_VERIFIED");
}

function adapterDescriptor(binding) {
  return Object.freeze({
    schema: ADAPTER_SURFACE_SCHEMA,
    version: 1,
    activation: "TEST_ONLY",
    project_ref: binding.project_ref,
    memory_project_id: binding.memory_project_id,
    authority_binding_digest: binding.binding_digest,
    selected_authority: binding.selected_authority,
    legacy_project_memory: binding.authorities.legacy_project_memory,
    mapping_version: MEMORY_CATEGORY_MAP_VERSION,
    canonical_types: CANONICAL_MEMORY_TYPES,
    interfaces: Object.freeze({
      records: "AVAILABLE_GUARDED",
      taxonomy: "AVAILABLE_TOTAL_FAIL_CLOSED",
      run_workspace: "AVAILABLE_GUARDED",
      current_projection: "AVAILABLE_GUARDED",
      roster: "AVAILABLE_GUARDED",
      rethread: "AVAILABLE_GUARDED",
      recovery: "AVAILABLE_GUARDED",
      continuity: "AVAILABLE_GUARDED_TEST_ONLY",
      migration: "FAIL_CLOSED_NOT_IMPLEMENTED",
      handoff_journal: "AVAILABLE_GUARDED_TEST_ONLY",
      successor_transfer: "AVAILABLE_GUARDED_TEST_ONLY",
    }),
  });
}

function taxonomySurface() {
  return Object.freeze({
    canonical_types: CANONICAL_MEMORY_TYPES,
    mapping_version: MEMORY_CATEGORY_MAP_VERSION,
    mapLegacyProjectMemoryType,
    mapM2RecordFamily,
    recoverMappedSource,
  });
}

function guarded(target, methods, guard) {
  return Object.freeze(Object.fromEntries(methods.map((method) => [method, async (...args) => {
    await guard();
    return target[method](...args);
  }])));
}

function createGuard({ project, authorityBinding, capability, capabilityVerifier, memoryAuthorityVerifier, expected }) {
  return async () => {
    assertCapability(capability, expected);
    const verified = await capabilityVerifier(capability, {
      build_id: expected.buildId,
      project_ref: expected.projectRef,
      control_plane_ref: expected.controlPlaneRef,
      scope: "memory:test",
    });
    if (verified !== true) throw new Error("CAPABILITY_NOT_VERIFIED");
    await assertExternalAuthority(memoryAuthorityVerifier, authorityBinding, expected);
    await verifyM2AuthorityBinding(project, authorityBinding);
  };
}

function exposeProject(project, guard) {
  return Object.freeze({
    project_id: project.config.project_id,
    async verify() {
      await guard();
      return project.verify();
    },
  });
}

function exposeM2Surface({ project, authorityBinding, capability, capabilityVerifier, memoryAuthorityVerifier, expected, authorityReceipt }) {
  const memory = new MemoryService(project);
  const runWorkspace = new RunWorkspace(project, memory);
  const currentProjection = new CurrentProjection(project, memory);
  const roster = new AgentRoster(project);
  const guard = createGuard({ project, authorityBinding, capability, capabilityVerifier, memoryAuthorityVerifier, expected });
  const continuity = new MemoryContinuityController(project, guard);
  return Object.freeze({
    activation: "TEST_ONLY",
    descriptor: adapterDescriptor(authorityBinding),
    taxonomy: taxonomySurface(),
    authority: authorityReceipt,
    project: exposeProject(project, guard),
    memory: guarded(memory, [
      "projectState", "propose", "transition", "placeHold", "releaseHold", "search", "contextPacket",
      "compileSeed", "descendantClosure", "invalidateClosure",
    ], guard),
    run_workspace: guarded(runWorkspace, [
      "authoritativeState", "verifiedState", "readSeed", "start", "writeScratch", "readScratch", "checkpoint", "close",
    ], guard),
    current_projection: guarded(currentProjection, ["compile", "rebuild", "verify"], guard),
    roster: guarded(roster, ["state", "register", "transition", "expireLease", "projection"], guard),
    async rethread(...args) {
      await guard();
      return roster.rethread(...args);
    },
    recovery: Object.freeze({
      async run(...args) {
        await guard();
        return runWorkspace.recoverLocal(...args);
      },
      async head() {
        await guard();
        return project.recoverHead();
      },
    }),
    continuity: guarded(continuity, [
      "state", "openTask", "appendCheckpoint", "appendFinalCheckpoint", "recoverHandoffProjection",
      "amendGoal", "recordFailure", "beginHandoff", "advanceHandoff", "checkpointFailsafe",
    ], guard),
    async migrate(...args) {
      await guard();
      return requestMemoryMigration(...args);
    },
    async handoffJournal(...args) {
      await guard();
      return continuity.appendCheckpoint(...args);
    },
    async successorTransfer(...args) {
      await guard();
      return continuity.advanceHandoff(...args);
    },
  });
}

function createAuthorizedMemoryAdapter({ authorityBinding, capability, capabilityVerifier, memoryAuthorityVerifier, expected }) {
  return Object.freeze({
    descriptor: adapterDescriptor(authorityBinding),
    taxonomy: taxonomySurface(),
    async initialize(root, projectId) {
      assertM2ExclusiveAuthority(authorityBinding, { memory_project_id: projectId });
      assertCapability(capability, expected);
      await assertExternalAuthority(memoryAuthorityVerifier, authorityBinding, expected);
      const project = await MemoryProject.init(root, projectId);
      const authorityReceipt = await bindM2Authority(project, authorityBinding);
      return exposeM2Surface({ project, authorityBinding, capability, capabilityVerifier,
        memoryAuthorityVerifier, expected, authorityReceipt });
    },
    async reopen(root) {
      assertCapability(capability, expected);
      await assertExternalAuthority(memoryAuthorityVerifier, authorityBinding, expected);
      const project = await MemoryProject.open(root, { writable: true });
      assertM2ExclusiveAuthority(authorityBinding, { memory_project_id: project.config.project_id });
      const authorityReceipt = await verifyM2AuthorityBinding(project, authorityBinding);
      return exposeM2Surface({ project, authorityBinding, capability, capabilityVerifier,
        memoryAuthorityVerifier, expected, authorityReceipt });
    },
  });
}

export const TEST_CAPABILITY_SCHEMA = CAPABILITY_SCHEMA;
export const MEMORY_ADAPTER_SURFACE_SCHEMA = ADAPTER_SURFACE_SCHEMA;
