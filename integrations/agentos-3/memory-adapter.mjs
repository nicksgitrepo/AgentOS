import { MemoryProject, MemoryService } from "./memory-m2/src/index.mjs";

const TEST_AUTHORITY = "AGENTOS_3_LOCAL_TEST_AUTHORITY";

export function createAgentOS3Runtime({ memoryEnabled = false } = {}) {
  if (memoryEnabled !== false) throw new Error("MEMORY_DEFAULT_OFF");
  return Object.freeze({
    memory_enabled: false,
    async initialize() { throw new Error("MEMORY_INACTIVE"); },
    async enableForTest(authority) {
      if (authority !== TEST_AUTHORITY) throw new Error("UNAUTHORIZED_MEMORY_ACTIVATION");
      return createAuthorizedMemoryAdapter();
    }
  });
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

export const AGENTOS_3_TEST_AUTHORITY = TEST_AUTHORITY;
