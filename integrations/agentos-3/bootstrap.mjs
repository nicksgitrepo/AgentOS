import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function combinedBootstrap() {
  const contract = JSON.parse(await readFile(join(ROOT, "contracts", "agentos-3-integration.v1.json"), "utf8"));
  return Object.freeze({
    schema: "agentos.integration.bootstrap.v1",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    memory: { enabled: false, custody: "private_local_only", migration: "forbidden" },
    agent_builder: { lifecycle: "candidate", admitted: false, activated: false, authority_effect_grants: [] },
    main_candidate: contract.components.find((component) => component.id === "main-agentos").candidate_commit
  });
}

export function assertInactive(state) {
  if (state.activation !== "OFF" || state.memory.enabled || state.agent_builder.admitted || state.agent_builder.activated) {
    throw new Error("BOOTSTRAP_NOT_INACTIVE");
  }
  return true;
}
