import { loadCandidateContract } from "./agent-builder-adapter.mjs";
import { combinedBootstrap } from "./bootstrap.mjs";
import { createAgentOS3Runtime } from "./memory-adapter.mjs";
import { createCombinedMainCoreEntrypoint } from "./main-core/entrypoint.mjs";

export async function createAgentOS3TestBuild(options = {}) {
  const [bootstrap, builder] = await Promise.all([combinedBootstrap(), loadCandidateContract()]);
  return Object.freeze({
    schema: "agentos.integration.combined-entrypoint.v1",
    build_id: "AGENTOS_3_TEST_BUILD",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    bootstrap,
    main_core: createCombinedMainCoreEntrypoint(),
    memory: createAgentOS3Runtime(options),
    agent_builder: builder,
    specialist_library: bootstrap.specialist_library
  });
}
