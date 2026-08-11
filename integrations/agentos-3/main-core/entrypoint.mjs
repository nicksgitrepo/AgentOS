import { mainCoreIdentity } from "./identity.mjs";
import * as BootstrapRuntime from "./control/bootstrap-runtime.mjs";
import * as Controller from "./control/agentos-controller.mjs";

export function runInactiveControllerProbe() {
  const candidate = Controller.compileControllerCampaignCandidate({
    projectId: "BOUND_SCOPE",
    campaignId: "LOCAL_TEST_CAMPAIGN",
    campaignVersion: "1.0.0",
    policyEpoch: 1,
    policyStateSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerIntentSha256: "1111111111111111111111111111111111111111111111111111111111111111",
    acceptanceContractSha256: "2222222222222222222222222222222222222222222222222222222222222222",
    modelPlanSha256: "3333333333333333333333333333333333333333333333333333333333333333",
    scopeSha256: "4444444444444444444444444444444444444444444444444444444444444444",
    sourceCommit: "SOURCE_COMMIT_BOUND",
    sourceTree: "SOURCE_TREE_BOUND",
  });
  return Object.freeze({
    status: "MAIN_CORE_CONTROLLER_COMPILE_PASS",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    candidate_sha256: candidate.candidate_sha256,
  });
}

export function createCombinedMainCoreEntrypoint() {
  return Object.freeze({
    schema: "agentos.integration.main-core-entrypoint.v1",
    lifecycle: "CANDIDATE_INACTIVE",
    activation: "OFF",
    identity: mainCoreIdentity(),
    exports_available: Object.freeze([...new Set([...Object.keys(BootstrapRuntime), ...Object.keys(Controller)])].sort()),
    controller_probe: runInactiveControllerProbe(),
    routing: "bootstrap-runtime-plus-controller"
  });
}

export const AgentOS = Object.freeze({ BootstrapRuntime, Controller });
