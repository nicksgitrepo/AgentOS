import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function combinedBootstrap() {
  const contract = JSON.parse(await readFile(join(ROOT, "contracts", "agentos-3-integration.v1.json"), "utf8"));
  const specialist = contract.components.find((component) => component.id === "specialist-block-library");
  return Object.freeze({
    schema: "agentos.integration.bootstrap.v1",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    memory: { enabled: false, custody: "private_local_only", migration: "forbidden" },
    agent_builder: { lifecycle: "candidate", admitted: false, activated: false, test_build_input: "INDEPENDENTLY_CLEARED", authority_effect_grants: [] },
    specialist_library: { admitted_for_test_build: specialist.admission === "ACCEPTED_FOR_INACTIVE_TEST_BUILD_ONLY", activation: specialist.activation, roster_sha256: specialist.roster_sha256, authority_effect_grants: [] },
    main_candidate: contract.components.find((component) => component.id === "main-agentos").candidate_commit
  });
}

export function assertInactive(state) {
  if (state.activation !== "OFF" || state.memory.enabled || state.agent_builder.admitted || state.agent_builder.activated || state.specialist_library.activation !== "OFF" || state.specialist_library.authority_effect_grants.length !== 0) {
    throw new Error("BOOTSTRAP_NOT_INACTIVE");
  }
  return true;
}
