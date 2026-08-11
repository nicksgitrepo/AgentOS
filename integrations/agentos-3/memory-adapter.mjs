import { MemoryProject, MemoryService } from "./memory-m2/src/index.mjs";

const CAPABILITY_SCHEMA = "agentos.integration.test-capability.v1";
const OPAQUE = /^ref_[a-z0-9]{32}$/u;
const NONCE = /^[a-f0-9]{64}$/u;

export function createAgentOS3Runtime({ buildId = "AGENTOS_3_TEST_BUILD", projectRef, controlPlaneRef, capabilityVerifier = null, memoryEnabled = false } = {}) {
  if (memoryEnabled !== false) throw new Error("MEMORY_DEFAULT_OFF");
  if (typeof buildId !== "string" || buildId.length === 0 || !OPAQUE.test(projectRef) || !OPAQUE.test(controlPlaneRef)) throw new Error("MEMORY_BINDING_INVALID");
  return Object.freeze({
    memory_enabled: false,
    async initialize() { throw new Error("MEMORY_INACTIVE"); },
    async enableForTest(capability) {
      assertCapability(capability, { buildId, projectRef, controlPlaneRef });
      if (typeof capabilityVerifier !== "function") throw new Error("CAPABILITY_VERIFIER_REQUIRED");
      const verified = await capabilityVerifier(capability, { build_id: buildId, project_ref: projectRef, control_plane_ref: controlPlaneRef, scope: "memory:test" });
      if (verified !== true) throw new Error("CAPABILITY_NOT_VERIFIED");
      return createAuthorizedMemoryAdapter();
    }
  });
}

function assertCapability(capability, expected) {
  if (!capability || capability.schema !== CAPABILITY_SCHEMA || capability.build_id !== expected.buildId || capability.project_ref !== expected.projectRef || capability.control_plane_ref !== expected.controlPlaneRef || capability.scope !== "memory:test" || !NONCE.test(capability.nonce) || !NONCE.test(capability.lease) || !Number.isFinite(Date.parse(capability.expires_at_utc)) || Date.parse(capability.expires_at_utc) <= Date.now()) throw new Error("CAPABILITY_BINDING_INVALID");
}

function createAuthorizedMemoryAdapter() {
  return Object.freeze({
    async initialize(root, projectId) {
      const project = await MemoryProject.init(root, projectId);
      return { project, memory: new MemoryService(project), activation: "TEST_ONLY" };
    },
    async reopen(root) {
      const project = await MemoryProject.open(root, { writable: true });
      return { project, memory: new MemoryService(project), activation: "TEST_ONLY" };
    }
  });
}

export const TEST_CAPABILITY_SCHEMA = CAPABILITY_SCHEMA;
