#!/usr/bin/env node

/*
 * One explicit local start transition for the AgentOS self-development campaign.
 * It is intentionally not a generic delivery path: local development and local
 * worker processes are allowed here, while every external side effect remains
 * disabled and every worker must return a real readback.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
  applyAndWriteAgentOSControllerEvent,
  compileAgentOSControllerState,
  compileControllerEvent,
  compileControllerRuntimeReadback,
  compileControllerCampaignCandidate,
  controllerDigest,
  writeAgentOSControllerStateCompareAndSwap,
} from "./agentos-controller.mjs";
import {compileGlobalPolicyState} from "./global-policy-state.mjs";
import {
  compileGovernanceDecisionTree,
  validateGovernanceDecisionTree,
} from "./governance-decision-tree.mjs";
import {
  compileLocalCampaignActivation,
  compileLocalCampaignAdmission,
  compileLocalCampaignIdentityBinding,
  compileLocalDevelopmentAuthorization,
  validateLocalCampaignActivation,
  validateLocalCampaignAdmission,
  validateLocalCampaignIdentityBinding,
  validateLocalDevelopmentAuthorization,
  validateLocalStartTransition,
  writeLocalCampaignRecord,
} from "./local-campaign-admission.mjs";
import {createLocalSelfDevelopmentAdapters, validateLocalWorkerReadback} from "./local-agent-runtime.mjs";

const REPO_ROOT = path.resolve(process.argv[2] ?? process.cwd());
const PARENT_PACKET_PATH = path.join(REPO_ROOT, "tmp/agentos-audit-97f755fbd96e/audit-packet.json");
const PARENT_ADDENDUM_PATH = path.join(REPO_ROOT, "tmp/agentos-audit-97f755fbd96e/audit-handoff-addendum.json");
const STALE_APPROVAL_PATH = path.join(REPO_ROOT, "tmp/agentos-first-campaign-bd26c163e067/approval-packet.json");
const STALE_STATUS_PATH = path.join(REPO_ROOT, "tmp/agentos-first-campaign-bd26c163e067/campaign-status.json");
const CAMPAIGN_ID = "CAMPAIGN-AGENTOS-SELF-DEVELOPMENT-1";
const CAMPAIGN_VERSION = "v1";
const PROJECT_ID = "agentos-self-development";
const CONTROLLER_ID = "AGENTOS-CONTROLLER-SELF-DEVELOPMENT-1";
const RUNTIME_ID = "AGENTOS-LOCAL-SELF-DEVELOPMENT-RUNTIME-1";
const CONTROLLER_RUNTIME_ID = "AGENTOS-LOCAL-SELF-DEVELOPMENT-CONTROLLER-RUNTIME-1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalRoot(root) {
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local start repository root must be a real directory");
  return resolved;
}

function readJson(filePath) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `local start record is not a regular file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function contentAddressed(record, field) {
  const result = structuredClone(record);
  result[field] = null;
  result[field] = controllerDigest(result);
  return result;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw new Error(`failed command: git -C ${root} ${args.join(" ")}; error: ${stderr || error.message}`);
  }
}

function writeRecord(root, fileName, record, validate = (value) => value) {
  return writeLocalCampaignRecord({root, fileName, record, validate});
}

function validateParentEvidence(parentPacket, parentAddendum) {
  assert(parentPacket.packet_sha256 === digestWithout(parentPacket, "packet_sha256"), "retained parent audit packet digest is invalid");
  assert(parentAddendum.addendum_sha256 === digestWithout(parentAddendum, "addendum_sha256"), "retained parent audit addendum digest is invalid");
  assert(parentPacket.status.current_commit === parentAddendum.source_checkpoint.commit, "retained audit packet/addendum commit differs");
  assert(parentPacket.status.current_tree === parentAddendum.source_checkpoint.tree, "retained audit packet/addendum tree differs");
}

function compileStaleCandidateRejection({staleApproval, staleStatus, sourceCommit, sourceTree, nowUtc, parentPacketSha256, parentAddendumSha256}) {
  const rejected = {
    schema: "agentos.anti_drift_candidate_rejection.v1",
    version: 1,
    status: "REJECTED_STALE_NOT_ADMITTED",
    controller_role: "AGENTOS_CONTROLLER",
    observed_at_utc: nowUtc,
    observed_source_commit: sourceCommit,
    observed_source_tree: sourceTree,
    stale_packet: {
      approval_packet_sha256: staleApproval.approval_packet_sha256,
      candidate_sha256: staleApproval.candidate_sha256,
      project_id: staleApproval.project_id,
      campaign_id: staleApproval.exact_candidate?.source_binding?.current_campaign_id ?? "CAMPAIGN-OWNER-REVIEW-1",
      owner_intent: staleApproval.exact_candidate?.owner_intent?.desired_outcome ?? null,
      candidate_status: staleApproval.exact_candidate?.candidate_status ?? null,
      approval_state: staleApproval.approval_state,
      active_campaign: staleApproval.exact_candidate?.active_campaign ?? staleStatus.active_campaign,
      product_writes_allowed: staleApproval.exact_candidate?.product_writes_allowed ?? false,
      product_agent_spawns_allowed: staleApproval.exact_candidate?.product_agent_spawns_allowed ?? false,
      release_stop: staleApproval.release_stop,
    },
    rejection_reasons: [
      "The candidate is bound to synthetic-project instead of AgentOS self-development.",
      "The candidate carries the old generic owner intent instead of the current local self-development authorization.",
      "The candidate is CANDIDATE_ONLY with PENDING_EXACT_APPROVAL and cannot be promoted by the local start event.",
      "The candidate keeps local worker spawning and Product writes disabled and stops before admission/publication/deployment.",
      "Source rebinding alone cannot rebind changed owner intent, project identity, or local-development permissions.",
    ].sort(),
    stale_status_readback: structuredClone(staleStatus),
    linked_findings: [
      "F-REAL-WORKER-EXECUTION",
      "F-CONTROLLER-ADMISSION",
      "F-CONTROLLER-ENFORCEMENT",
      "F-ANTI-DRIFT-CANDIDATE",
    ].sort(),
    parent_audit_packet_sha256: parentPacketSha256,
    parent_audit_addendum_sha256: parentAddendumSha256,
    admission_allowed: false,
    spawn_allowed: false,
    rca: {
      classification: "REPAIRABLE_ENGINEERING_PUZZLE",
      route: "COMPILE_FRESH_CURRENT_SOURCE_CANDIDATE_AND_BOUNDARY",
      required_recheck: "Fresh AgentOS self-development candidate, authorization, identity binding, admission, and real worker readbacks must validate together.",
    },
    rejection_sha256: null,
  };
  rejected.rejection_sha256 = digestWithout(rejected, "rejection_sha256");
  return rejected;
}

function compileStallRca({sourceCommit, sourceTree, parentAuditPacketSha256, parentAuditAddendumSha256, nowUtc}) {
  return contentAddressed({
    schema: "agentos.anti_drift_stall_rca.v1",
    version: 1,
    status: "RETAINED_BEFORE_START",
    controller_role: "AGENTOS_CONTROLLER",
    observed_at_utc: nowUtc,
    observed_source_commit: sourceCommit,
    observed_source_tree: sourceTree,
    symptom: "Valid local self-development consent existed, but no campaign activation, spawn record, or worker readback had been produced.",
    observed_state: {
      active_campaign: false,
      controller_status: "PREPARED_NOT_ACTIVATED",
      approval_state: "PENDING_EXACT_APPROVAL",
      local_start_event: "MISSING",
      orchestrator_spawn_record: "MISSING",
      auditor_spawn_record: "MISSING",
      feature_agent_spawn_record: "MISSING",
      worker_readbacks: "MISSING",
    },
    required_immediate_action: [
      "Run only focused syntax and hostile checks for the minimum local bridge.",
      "Bind the current source to the already-recorded local owner authorization.",
      "Invoke the local campaign start event and require three real process readbacks.",
      "Hand the bounded code repair to the Feature Agent after verified spawn.",
      "Stop and retain the exact command and error if a worker or adapter is unavailable.",
    ],
    linked_findings: ["F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"],
    parent_audit_packet_sha256: parentAuditPacketSha256,
    parent_audit_addendum_sha256: parentAuditAddendumSha256,
    rca_sha256: null,
  }, "rca_sha256");
}

function localFailureRca({campaignRoot, error, phase, sourceCommit = null, sourceTree = null, nowUtc, attemptedCommand = null}) {
  const spawnFailures = [];
  const recordsRoot = path.join(campaignRoot, "spawn-records");
  if (fs.existsSync(recordsRoot)) {
    for (const name of fs.readdirSync(recordsRoot).sort()) {
      const filePath = path.join(recordsRoot, name);
      try {
        const record = readJson(filePath);
        if (record.status === "FAILED") spawnFailures.push(record);
      } catch (readError) {
        spawnFailures.push({file: name, readback_error: readError.message});
      }
    }
  }
  return contentAddressed({
    schema: "agentos.local_campaign_start_failure_rca.v1",
    version: 1,
    status: "HARD_UNAVAILABLE_BLOCKER",
    controller_role: "AGENTOS_CONTROLLER",
    phase,
    observed_at_utc: nowUtc,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    failed_command: attemptedCommand,
    error_message_exact: error?.message ?? String(error),
    error_stack: error?.stack ?? null,
    spawn_failures: spawnFailures,
    required_response: "Stop the start sequence, repair or provide the missing local adapter, then rerun from a fresh exact current-source binding.",
    external_actions_attempted: false,
    rca_sha256: null,
  }, "rca_sha256");
}

function main() {
  const repoRoot = canonicalRoot(REPO_ROOT);
  assert(repoRoot === canonicalRoot(process.cwd()), "local start must run from the writable development copy");
  assert(fs.existsSync(path.join(repoRoot, ".git")), "local start repository is not a Git development copy");
  const nowUtc = new Date().toISOString();
  const campaignRoot = path.join(repoRoot, "tmp/agentos-local-self-development-1");
  fs.mkdirSync(campaignRoot, {recursive: true});
  let phase = "INITIALIZE";
  let attemptedCommand = null;
  let sourceCommit = null;
  let sourceTree = null;

  try {
    phase = "READ_RETAINED_AUDIT";
    const parentPacket = readJson(PARENT_PACKET_PATH);
    const parentAddendum = readJson(PARENT_ADDENDUM_PATH);
    validateParentEvidence(parentPacket, parentAddendum);
    const parentAuditPacketSha256 = parentPacket.packet_sha256;
    const parentAuditAddendumSha256 = parentAddendum.addendum_sha256;
    sourceCommit = git(repoRoot, ["rev-parse", "HEAD"]);
    sourceTree = git(repoRoot, ["rev-parse", "HEAD^{tree}"]);
    assert(sourceCommit !== parentPacket.status.current_commit || sourceTree !== parentPacket.status.current_tree, "fresh local campaign source did not advance from the frozen audit checkpoint");
    assert(git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]) === "", "local start requires a clean committed bridge checkpoint");

    phase = "RETAIN_ANTI_DRIFT_EVIDENCE";
    const staleApproval = readJson(STALE_APPROVAL_PATH);
    const staleStatus = readJson(STALE_STATUS_PATH);
    const staleRejection = compileStaleCandidateRejection({staleApproval, staleStatus, sourceCommit, sourceTree, nowUtc, parentPacketSha256: parentAuditPacketSha256, parentAddendumSha256: parentAuditAddendumSha256});
    const stallRca = compileStallRca({sourceCommit, sourceTree, parentAuditPacketSha256, parentAuditAddendumSha256, nowUtc});
    writeRecord(campaignRoot, "anti-drift-register.json", contentAddressed({
      schema: "agentos.controller_anti_drift_register.v1",
      version: 1,
      controller_role: "AGENTOS_CONTROLLER",
      source_commit: sourceCommit,
      source_tree: sourceTree,
      retained_records: [staleRejection, stallRca],
      open_findings: ["F-ANTI-DRIFT-CANDIDATE", "F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"].sort(),
      status: "OPEN_UNTIL_REAL_START_AND_SUPERVISION_EVIDENCE",
      register_sha256: null,
    }, "register_sha256"));
    writeRecord(campaignRoot, "stale-candidate-rejection.json", staleRejection);
    writeRecord(campaignRoot, "stall-rca.json", stallRca);

    phase = "COMPILE_CURRENT_OWNER_INTENT_AND_BOUNDARY";
    const ownerIntent = contentAddressed({
      schema: "agentos.agentos_self_development_owner_intent.v1",
      version: 1,
      source: "OWNER_EXISTING_CONSENT",
      project_id: PROJECT_ID,
      owner_decision: "START_LOCAL_AGENTOS_SELF_DEVELOPMENT",
      goal: "Run AgentOS as an all-in-one system that turns complicated development into casual conversations and lets agents build from those conversations.",
      current_run: "Build and audit AgentOS itself in the writable development copy through a local governed campaign.",
      controller_role: "AgentOS Controller",
      role_custody: {
        controller: "Supervise, compare intent with actual events and evidence, classify drift, and enforce re-checks.",
        orchestrator: "Coordinate the bounded campaign and traverse the executable four-root governance tree.",
        auditor: "Independently inspect the Feature-Agent changed tree and evidence.",
        feature_agent: "Own the actual bounded code repair in an isolated worktree.",
      },
      decision_tree_requirement: "FUNCTIONALITY, DESIGN_UI_SHELL_NAVIGATION, CODE_QUALITY_HYGIENE, then SECURITY; YES requires evidence and sub-gates; NO requires classification, repair path, and exact re-check.",
      parent_audit_packet_sha256: parentAuditPacketSha256,
      parent_audit_addendum_sha256: parentAuditAddendumSha256,
      protected_external_actions: ["deployment", "release", "publication", "push", "merge", "secrets", "destructive_work"].sort(),
      deferred_candidates: ["direct Feature-Agent targeting", "optional parallel development schemes"].sort(),
      owner_intent_sha256: null,
    }, "owner_intent_sha256");
    const scope = contentAddressed({
      schema: "agentos.local_self_development_scope.v1",
      version: 1,
      project_id: PROJECT_ID,
      allowed_root_kind: "WRITABLE_DEVELOPMENT_COPY",
      allowed_work: ["AgentOS control-plane code", "schemas", "tests", "documentation", "isolated local worker worktrees"].sort(),
      changed_paths: [
        "control/agentos-controller.mjs",
        "control/governance-decision-tree.mjs",
        "control/local-agent-runtime.mjs",
        "control/local-agent-worker.mjs",
        "control/local-campaign-admission.mjs",
        "control/start-local-self-development.mjs",
        "schemas/agentos-controller.v1.json",
        "tests/verify-governance-decision-tree.mjs",
        "tests/verify-local-campaign-admission.mjs",
        "tests/verify-local-agent-runtime.mjs",
      ].sort(),
      excluded_work: ["Product code", "Product agents", "external deployment", "release", "publication", "push", "merge", "sterile-copy changes", "secrets", "destructive work"].sort(),
      local_worker_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"].sort(),
      scope_sha256: null,
    }, "scope_sha256");
    const decisionTree = compileGovernanceDecisionTree({
      sourceCommit,
      sourceTree,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      scopeSha256: scope.scope_sha256,
      featureFiles: scope.changed_paths,
    });
    validateGovernanceDecisionTree(decisionTree);
    const decisionTreeRequirement = contentAddressed({
      schema: "agentos.executable_decision_tree_requirement.v1",
      version: 1,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      scope_sha256: scope.scope_sha256,
      decision_tree_sha256: decisionTree.tree_sha256,
      ordered_roots: decisionTree.ordered_roots,
      yes_rule: decisionTree.yes_rule,
      no_rule: decisionTree.no_rule,
      ambiguity_rule: decisionTree.ambiguity_rule,
      linked_findings: ["F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"].sort(),
      decision_tree_requirement_sha256: null,
    }, "decision_tree_requirement_sha256");
    const policy = compileGlobalPolicyState({
      projectId: PROJECT_ID,
      values: {
        "CAMPAIGN.MODE": "STANDARD_SUBSTANTIAL",
        "PROJECT.NORTH_STAR": "AgentOS turns complicated development into casual conversations and lets agents build from those conversations.",
        "PROJECT.FIRST_USEFUL_WORKFLOW": "The Controller starts one local AgentOS campaign, the Feature Agent makes a bounded code repair, and the Auditor verifies it.",
        "PROJECT.ASSURANCE_CLASS": "LIMITED_PRODUCT",
        "REVIEW.USER_REVIEW_MODE": "RECOMMENDED",
        "REVIEW.APPROVAL_ROUTE": "DIRECT_AGENTOS_CONFIRMATION",
      },
      nowUtc,
      timeBasis: "OBSERVED_UTC",
    });
    const modelPlan = contentAddressed({
      schema: "agentos.local_self_development_model_plan.v1",
      version: 1,
      project_id: PROJECT_ID,
      worker_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"].sort(),
      execution_adapter: "LOCAL_NODE_PROCESS_AND_GIT_WORKTREE",
      real_spawn_requirements: ["PID", "session", "isolated worktree", "source commit/tree", "handshake", "artifact", "readback"].sort(),
      feature_agent_completion_requirements: ["actual code change", "focused checks", "changed commit/tree", "Auditor verification"].sort(),
      model_plan_sha256: null,
    }, "model_plan_sha256");
    const acceptance = contentAddressed({
      schema: "agentos.local_self_development_acceptance.v1",
      version: 1,
      project_id: PROJECT_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      policy_epoch: policy.policy_epoch,
      policy_state_sha256: policy.policy_state_sha256,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      decision_tree_requirement_sha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      scope_sha256: scope.scope_sha256,
      required_evidence: ["fresh current-source candidate", "identity binding", "admission", "three real worker readbacks", "Feature-Agent changed checkpoint", "Auditor verification", "atomic JSON readback"].sort(),
      non_goals: ["external side effects", "Product work", "release readiness"].sort(),
      stop_conditions: ["Any identity, scope, intent, evidence, source, or boundary mismatch.", "Any unavailable or fake local adapter.", "Any missing or metadata-only worker build."].sort(),
      acceptance_sha256: null,
    }, "acceptance_sha256");
    writeRecord(campaignRoot, "owner-intent.json", ownerIntent);
    writeRecord(campaignRoot, "scope.json", scope);
    writeRecord(campaignRoot, "decision-tree.json", decisionTree, validateGovernanceDecisionTree);
    writeRecord(campaignRoot, "decision-tree-requirement.json", decisionTreeRequirement);
    writeRecord(campaignRoot, "policy-state.json", policy);
    writeRecord(campaignRoot, "model-plan.json", modelPlan);
    writeRecord(campaignRoot, "acceptance-contract.json", acceptance);

    phase = "COMPILE_CURRENT_CANDIDATE_AUTHORIZATION_AND_ADMISSION";
    const authorization = compileLocalDevelopmentAuthorization({
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      sourceCommit,
      sourceTree,
      parentAuditPacketSha256,
      parentAuditAddendumSha256,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      decisionTreeRequirementSha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      acceptanceContractSha256: acceptance.acceptance_sha256,
      modelPlanSha256: modelPlan.model_plan_sha256,
      scopeSha256: scope.scope_sha256,
      recordedFrom: "NICK_CURRENT_LOCAL_SELF_DEVELOPMENT_AUTHORIZATION",
    });
    const candidate = compileControllerCampaignCandidate({
      projectId: PROJECT_ID,
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      acceptanceContractSha256: acceptance.acceptance_sha256,
      modelPlanSha256: modelPlan.model_plan_sha256,
      scopeSha256: scope.scope_sha256,
      sourceCommit,
      sourceTree,
    });
    const auditCandidate = {
      candidate_id: parentPacket.candidate.candidate_id,
      candidate_sha256: parentPacket.candidate.candidate_sha256,
      commit: parentPacket.candidate.commit,
      tree: parentPacket.candidate.tree,
    };
    const identityBinding = compileLocalCampaignIdentityBinding({
      authorization,
      candidate,
      auditCandidate,
      auditCampaignVersion: parentPacket.campaign_version,
      auditPlanSha256: parentPacket.audit_plan.plan_sha256,
      auditReconciliationSha256: parentPacket.reconciliation.reconciliation_sha256,
      parentAuditPacketSha256,
      parentAuditAddendumSha256,
    });
    const admission = compileLocalCampaignAdmission({authorization, candidate, identityBinding, nowUtc});
    validateLocalStartTransition({authorization, admission});
    writeRecord(campaignRoot, "authorization.json", authorization, validateLocalDevelopmentAuthorization);
    writeRecord(campaignRoot, "candidate.json", candidate);
    writeRecord(campaignRoot, "identity-binding.json", identityBinding, validateLocalCampaignIdentityBinding);
    writeRecord(campaignRoot, "admission.json", admission, validateLocalCampaignAdmission);

    phase = "INITIALIZE_CONTROLLER_STATE";
    const controllerSessionId = `AGENTOS-CONTROLLER-SESSION-${sourceCommit.slice(0, 12)}`;
    const capabilitySetSha256 = controllerDigest({adapter: "LOCAL_NODE_PROCESS_AND_GIT_WORKTREE", roles: authorization.worker_roles, root_kind: "WRITABLE_DEVELOPMENT_COPY"});
    const runtimeReadback = compileControllerRuntimeReadback({
      projectId: PROJECT_ID,
      controllerRuntimeId: CONTROLLER_RUNTIME_ID,
      runtimeId: RUNTIME_ID,
      environmentIdentity: "LOCAL_DEVELOPMENT_COPY",
      capabilitySetSha256,
      observedBySession: controllerSessionId,
      observedAtUtc: nowUtc,
    });
    const initialState = compileAgentOSControllerState({
      projectId: PROJECT_ID,
      logicalControllerId: CONTROLLER_ID,
      currentSessionId: controllerSessionId,
      policyState: policy,
      controllerRuntimeReadback: runtimeReadback,
      nowUtc,
    });
    writeRecord(campaignRoot, "runtime-readback.json", runtimeReadback);
    writeRecord(campaignRoot, "controller-state-before-start.json", initialState);
    const controllerStatePath = "controller-state.json";
    writeAgentOSControllerStateCompareAndSwap({authorityRoot: campaignRoot, statePath: controllerStatePath, expectedStateSha256: null, state: initialState});

    phase = "START_LOCAL_CAMPAIGN_WITH_REAL_WORKERS";
    attemptedCommand = `node control/start-local-self-development.mjs ${repoRoot}`;
    const decisionTreePath = path.join(campaignRoot, "decision-tree.json");
    const adapters = createLocalSelfDevelopmentAdapters({repoRoot, runtimeRoot: campaignRoot, authorization, admission, candidate, identityBinding, decisionTreePath});
    const event = compileControllerEvent({
      eventId: `LOCAL-SELF-DEVELOPMENT-AUTHORIZED-${sourceCommit.slice(0, 12)}`,
      eventType: "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
      sourceRole: "AGENTOS_CONTROLLER",
      controllerId: CONTROLLER_ID,
      projectId: PROJECT_ID,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      campaignId: CAMPAIGN_ID,
      sequence: 1,
      priorControllerHeadSha256: null,
      payload: {authorization, admission, candidate, identity_binding: identityBinding},
      occurredAtUtc: nowUtc,
    });
    const result = applyAndWriteAgentOSControllerEvent({authorityRoot: campaignRoot, statePath: controllerStatePath, expectedStateSha256: initialState.state_sha256, event, adapters, nowUtc});
    const finalState = result.state;
    writeRecord(campaignRoot, "start-event.json", event);
    writeRecord(campaignRoot, "controller-state.json", finalState);
    const receiptsByOperation = Object.fromEntries(finalState.action_receipts.filter((receipt) => receipt.event_id === event.event_id).map((receipt) => [receipt.operation, receipt]));
    const spawnReadbacks = ["spawnCampaignOrchestrator", "spawnIndependentAuditor", "spawnFeatureAgents"].map((operation) => {
      const receipt = receiptsByOperation[operation];
      assert(receipt?.details?.worker_readback, `${operation} did not return a worker readback`);
      validateLocalWorkerReadback(receipt.details.worker_readback);
      return receipt.details.worker_readback;
    });
    assert(spawnReadbacks.every((readback) => /^\d+$/u.test(readback.pid)), "real worker PID readback is missing");
    assert(spawnReadbacks.every((readback) => fs.existsSync(readback.worktree_path)), "real worker worktree readback is missing");
    assert(spawnReadbacks.every((readback) => readback.source_commit === sourceCommit && readback.source_tree === sourceTree), "real worker source identity differs");
    const activation = compileLocalCampaignActivation({
      admission,
      authorization,
      identityBinding,
      candidate,
      spawnReadbacks,
      controllerStateSha256: finalState.state_sha256,
      startedAtUtc: nowUtc,
    });
    validateLocalCampaignActivation(activation);
    writeRecord(campaignRoot, "activation.json", activation, validateLocalCampaignActivation);
    const handoff = contentAddressed({
      schema: "agentos.local_campaign_start_handoff.v1",
      version: 1,
      status: "CAMPAIGN_ACTIVE_BUILDING_AND_AUDITING",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "AgentOS Controller",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      project_id: PROJECT_ID,
      source_checkpoint: {commit: sourceCommit, tree: sourceTree, clean: true, pushed: false},
      parent_audit_packet_sha256: parentAuditPacketSha256,
      parent_audit_addendum_sha256: parentAuditAddendumSha256,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      decision_tree_requirement_sha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      policy_state_sha256: policy.policy_state_sha256,
      acceptance_sha256: acceptance.acceptance_sha256,
      candidate_sha256: candidate.candidate_sha256,
      authorization_sha256: authorization.authorization_sha256,
      identity_binding_sha256: identityBinding.binding_sha256,
      admission_sha256: admission.admission_sha256,
      activation_sha256: activation.activation_sha256,
      controller_state_sha256: finalState.state_sha256,
      event_sha256: event.event_sha256,
      spawn_readbacks: structuredClone(spawnReadbacks),
      custody: {
        controller: "AgentOS Controller supervises and enforces; it does not claim Feature-Agent repair completion.",
        orchestrator: receiptsByOperation.spawnCampaignOrchestrator.details.worker_readback.session_id,
        auditor: receiptsByOperation.spawnIndependentAuditor.details.worker_readback.session_id,
        feature_agent: receiptsByOperation.spawnFeatureAgents.details.worker_readback.session_id,
        feature_agent_build_commit: receiptsByOperation.spawnFeatureAgents.details.worker_readback.build_commit,
        feature_agent_build_tree: receiptsByOperation.spawnFeatureAgents.details.worker_readback.build_tree,
        auditor_verified_commit: receiptsByOperation.spawnIndependentAuditor.details.worker_readback.build_commit,
        auditor_verified_tree: receiptsByOperation.spawnIndependentAuditor.details.worker_readback.build_tree,
      },
      permissions: structuredClone(authorization.permissions),
      next_action: "Keep the local campaign open for Controller supervision, four-root audit reconciliation, and exact repair re-check; external actions remain disabled.",
      stop_conditions: authorization.stop_conditions,
      undo: ["Retain the immutable parent audit packet and addendum.", "Remove only this local campaign runtime and its isolated worktrees if the owner later directs undo.", "Do not alter the sterile release copy."],
      handoff_sha256: null,
    }, "handoff_sha256");
    writeRecord(campaignRoot, "campaign-start-handoff.json", handoff);
    process.stdout.write(`${JSON.stringify({status: handoff.status, campaign_id: CAMPAIGN_ID, campaign_root: path.relative(repoRoot, campaignRoot), candidate_sha256: candidate.candidate_sha256, activation_sha256: activation.activation_sha256, controller_state_sha256: finalState.state_sha256, worker_roles: spawnReadbacks.map((readback) => ({role: readback.role, pid: readback.pid, session_id: readback.session_id, worktree_path: readback.worktree_path, source_commit: readback.source_commit, source_tree: readback.source_tree, build_status: readback.build_status, build_commit: readback.build_commit, build_tree: readback.build_tree}))}, null, 2)}\n`);
    return handoff;
  } catch (error) {
    const rca = localFailureRca({campaignRoot, error, phase, sourceCommit, sourceTree, nowUtc, attemptedCommand});
    try {
      writeRecord(campaignRoot, "start-failure-rca.json", rca);
    } catch (writeError) {
      process.stderr.write(`Failed to retain local start RCA: ${writeError.message}\n`);
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export {compileStaleCandidateRejection, compileStallRca, localFailureRca, main};
