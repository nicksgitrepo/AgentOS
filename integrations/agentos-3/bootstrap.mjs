import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSpecialistLibraryIntakeState } from "./specialist-library-intake.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

export function assertSpecialistLibraryExternalContract(contract) {
  const matches = Array.isArray(contract?.components)
    ? contract.components.filter((component) => component?.id === "specialist-block-library")
    : [];
  const specialist = matches[0];
  if (matches.length !== 1 || specialist.custody !== "EXTERNAL_TYPED_INTAKE_ONLY"
    || specialist.state !== "EXTERNAL_CANDIDATE_NOT_RECEIVED" || specialist.admission !== "NOT_ADMITTED"
    || specialist.activation !== "OFF" || specialist.accepted_candidate !== null || specialist.roster_truth !== null
    || !Array.isArray(specialist.authority_effect_grants) || specialist.authority_effect_grants.length !== 0
    || specialist.intake_contract !== "contracts/specialist-library-intake.v1.json"
    || specialist.intake_controller !== "specialist-library-intake.mjs"
    || specialist.intake_binding !== "contracts/specialist-library-intake-binding.v1.json") {
    throw new Error("SPECIALIST_LIBRARY_CONTRACT_NOT_EXTERNAL_AND_INACTIVE");
  }
  return specialist;
}

export async function combinedBootstrap() {
  const [contract, mainCore] = await Promise.all([
    readFile(join(ROOT, "contracts", "agentos-3-integration.v1.json"), "utf8").then((bytes) => JSON.parse(bytes)),
    readFile(join(ROOT, "main-core", "source-manifest.json"), "utf8").then((bytes) => JSON.parse(bytes)),
  ]);
  assertSpecialistLibraryExternalContract(contract);
  return Object.freeze({
    schema: "agentos.integration.bootstrap.v1",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    memory: {
      enabled: false,
      custody: "private_local_only",
      authority: "UNBOUND_EXCLUSIVE_SELECTION_REQUIRED",
      taxonomy: ["EPISODIC", "SEMANTIC", "PROCEDURAL", "GOVERNANCE", "WORKING_TASK"],
      mapping_version: "agentos.memory.category-map.v1",
      migration: "PLAN_ONLY_FAIL_CLOSED",
    },
    agent_builder: { lifecycle: "candidate", admitted: false, activated: false, test_build_input: "INDEPENDENTLY_CLEARED", authority_effect_grants: [] },
    specialist_library: compileSpecialistLibraryIntakeState(),
    main_candidate: {commit: mainCore.candidate_commit, tree: mainCore.candidate_tree},
  });
}

export function assertInactive(state) {
  if (state.activation !== "OFF" || state.memory.enabled || state.agent_builder.admitted || state.agent_builder.activated
    || state.specialist_library.activation !== "OFF" || state.specialist_library.admitted
    || state.specialist_library.intake_status !== "NOT_RECEIVED" || state.specialist_library.authority_effect_grants.length !== 0) {
    throw new Error("BOOTSTRAP_NOT_INACTIVE");
  }
  return true;
}
