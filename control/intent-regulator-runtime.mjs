#!/usr/bin/env node

/*
 * The executable AgentOS application seam.
 *
 * Bootstrap supplies the project contract and admission. This facade mounts
 * the four governance libraries, starts the canonical parallel campaign, and
 * keeps the persistent Intent Regulator/Runtime review loop attached to the
 * same host. It does not decide worker results itself; it observes typed
 * readbacks and routes the workflow to the existing Controller, Orchestrator,
 * Auditor, or owner boundary.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {assertUniversalDevelopmentMode} from "./governance-library.mjs";
import {
  compileGeneratedProjectRoleLibrary,
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateGeneratedProjectRoleLibrary,
  validateProjectGeneralLibrary,
} from "./four-library-governance.mjs";
import {runCanonicalCampaign, validateCanonicalCampaignAdmission} from "./canonical-campaign-orchestration-adapter.mjs";
import {runContinuousOperatingLoop} from "./continuous-operating-loop.mjs";
import {createOpaqueRuntimeReference} from "./persistent-intent-runtime.mjs";
import {createHybridScheduler} from "./hybrid-scheduler.mjs";
import {assertOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {
  createRapidPrototypeWorkflowController,
  RAPID_PROTOTYPE_PHASES,
  validatePlatformMergeGate,
  validateRapidPrototypeWorkflowInventoryBinding,
} from "./rapid-prototype-workflow.mjs";

export const INTENT_REGULATOR_RUNTIME_SCHEMA = "agentos.intent_regulator_runtime.v1";
export const DEFAULT_INTENT_REVIEW_INTERVAL_MINUTES = 15;

function assert(condition, message, code = null) {
  if (!condition) {
    const error = new Error(message);
    if (code !== null) error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${label} must be an exact Git object identity`);
}

function requireDigest(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256 digest`);
}

function requireInterval(value) {
  assert(Number.isSafeInteger(value) && value >= 1 && value <= 24 * 60, "Intent Regulator review interval must be between one minute and one day");
}

export function compileIntentRegulatorRuntimeConfiguration({
  projectId,
  projectContractDigest,
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  previousGeneratedProjectRoleLibrary = null,
  modelPolicyDigest,
  releasePolicyDigest,
  offlinePolicyDigest,
  reviewIntervalMinutes = DEFAULT_INTENT_REVIEW_INTERVAL_MINUTES,
  sourceCommit,
  sourceTree,
  generatedAtUtc = new Date().toISOString(),
} = {}) {
  requireString(projectId, "Intent Regulator project ID");
  requireDigest(projectContractDigest, "Intent Regulator project contract");
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
  if (previousGeneratedProjectRoleLibrary !== null) validateGeneratedProjectRoleLibrary(previousGeneratedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
  for (const [value, label] of [[modelPolicyDigest, "model policy"], [releasePolicyDigest, "release policy"], [offlinePolicyDigest, "offline policy"]]) requireString(value, `Intent Regulator ${label}`);
  requireGitObject(sourceCommit, "Intent Regulator source commit");
  requireGitObject(sourceTree, "Intent Regulator source tree");
  requireInterval(reviewIntervalMinutes);
  const generatedProjectRoleLibrary = compileGeneratedProjectRoleLibrary({
    baseGeneralLibrary,
    baseRoleLibrary,
    projectGeneralLibrary,
    previous: previousGeneratedProjectRoleLibrary,
  });
  const configuration = {
    schema: INTENT_REGULATOR_RUNTIME_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id: projectId,
    project_contract_sha256: projectContractDigest,
    governance: {
      base_general_sha256: baseGeneralLibrary.digest,
      base_role_sha256: baseRoleLibrary.digest,
      project_general_sha256: projectGeneralLibrary.digest,
      generated_project_role_sha256: generatedProjectRoleLibrary.digest,
    },
    model_policy_sha256: modelPolicyDigest,
    release_policy_sha256: releasePolicyDigest,
    offline_policy_sha256: offlinePolicyDigest,
    review_interval_minutes: reviewIntervalMinutes,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    generated_at_utc: generatedAtUtc,
    configuration_sha256: null,
  };
  configuration.configuration_sha256 = canonicalDigest({...configuration, configuration_sha256: null});
  return Object.freeze({configuration, generatedProjectRoleLibrary});
}

function validateHostBinding(host, hostAttachment) {
  requireRecord(host, "Intent Regulator native host");
  requireRecord(hostAttachment, "Intent Regulator host attachment");
}

function requireCampaignHandoffBatch(campaign, roster, label) {
  requireRecord(campaign, `${label} campaign result`);
  assert(campaign.status === "CLOSED", `${label} campaign did not close with a handoff`, "CAMPAIGN_CLOSURE_REQUIRED");
  assert(campaign.acceptance?.status === "ACCEPTED", `${label} campaign lacks independent acceptance`, "CAMPAIGN_ACCEPTANCE_REQUIRED");
  assert(campaign.closure?.exact_worker_closure === true, `${label} campaign lacks exact worker closure`, "CAMPAIGN_CLOSURE_REQUIRED");
  assert(campaign.closure?.active_native_session_count === 0, `${label} campaign retains active native sessions`, "NATIVE_SESSION_ROSTER_LEAK");
  assert(Array.isArray(campaign.workers) && campaign.workers.length === roster.length, `${label} campaign does not cover the exact admitted roster`, "CAMPAIGN_ROSTER_MISMATCH");
  const handoffs = roster.map((agent) => {
    const worker = campaign.workers.find((candidate) => candidate.lane_id === agent.target_id
      || candidate.target_id === agent.target_id
      || candidate.scope_id === agent.target_id);
    assert(worker !== undefined, `${label} campaign lacks a handoff for ${agent.agent_id}`, "CAMPAIGN_ROSTER_MISMATCH");
    requireDigest(worker.handoff_sha256, `${label} ${agent.agent_id} handoff`);
    return {
      agent_id: agent.agent_id,
      handoff_sha256: worker.handoff_sha256,
      worktree_id: agent.worktree_id,
      target_id: agent.target_id,
      target_kind: agent.target_kind,
      auditor_task_id: agent.auditor_task_id,
      goal_id: agent.goal_id,
      goal_sha256: agent.goal_sha256,
      goal_state: agent.goal_state,
      project_id: campaign.project_id ?? null,
      source_bound: true,
      production_candidate_pending_tests: true,
      applicable_platforms: worker.applicable_platforms ?? null,
    };
  });
  return {
    all_required_handoffs: true,
    production_candidate_pending_tests: true,
    handoffs,
  };
}

export function createIntentRegulatorRuntime({
  configuration,
  authorityRoot,
  repositoryRoot = process.cwd(),
  environmentId,
  host,
  hostAttachment,
  generatedProjectRoleLibrary = null,
  baseGeneralLibrary = null,
  baseRoleLibrary = null,
  projectGeneralLibrary = null,
  projectBinding = null,
  runtimeRef = null,
  schedulerRoot = null,
  schedulerPolicy = null,
  clock = () => new Date().toISOString(),
  leaseDurationSeconds = 60,
  operationalGlobalGovernanceContexts,
  globalGovernanceAuthorityRoot,
  globalGovernanceBootstrapSha256,
} = {}) {
  requireRecord(configuration, "Intent Regulator configuration");
  requireRecord(operationalGlobalGovernanceContexts, "Intent Regulator global-governance contexts");
  assertOperationalGlobalGovernanceContext(operationalGlobalGovernanceContexts.RUNTIME, {authorityRoot: globalGovernanceAuthorityRoot, expectedRoleClass: "RUNTIME", bootstrapSha256: globalGovernanceBootstrapSha256});
  assertOperationalGlobalGovernanceContext(operationalGlobalGovernanceContexts.SCHEDULER, {authorityRoot: globalGovernanceAuthorityRoot, expectedRoleClass: "SCHEDULER", bootstrapSha256: globalGovernanceBootstrapSha256});
  assertOperationalGlobalGovernanceContext(operationalGlobalGovernanceContexts.ORCHESTRATOR, {authorityRoot: globalGovernanceAuthorityRoot, expectedRoleClass: "ORCHESTRATOR", bootstrapSha256: globalGovernanceBootstrapSha256});
  assert(configuration.schema === INTENT_REGULATOR_RUNTIME_SCHEMA && configuration.version === 1, "Intent Regulator configuration identity is invalid");
  requireDigest(configuration.configuration_sha256, "Intent Regulator configuration digest");
  assert(configuration.configuration_sha256 === canonicalDigest({...configuration, configuration_sha256: null}), "Intent Regulator configuration digest mismatch");
  validateHostBinding(host, hostAttachment);
  assert(hostAttachment.project_id === configuration.project_id, "Intent Regulator host attachment belongs to another project", "PROJECT_BINDING_REQUIRED");
  requireString(environmentId, "Intent Regulator environment ID");
  if (projectBinding !== null) {
    requireRecord(projectBinding, "Intent Regulator project binding");
    assert(projectBinding.project_id === configuration.project_id, "Intent Regulator project binding belongs to another project", "PROJECT_BINDING_REQUIRED");
  }
  if (generatedProjectRoleLibrary !== null) {
    if (baseGeneralLibrary !== null && baseRoleLibrary !== null && projectGeneralLibrary !== null) {
      validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
    } else {
      requireDigest(generatedProjectRoleLibrary.digest, "Intent Regulator generated project role library");
      assert(generatedProjectRoleLibrary.digest === configuration.governance.generated_project_role_sha256, "Intent Regulator generated role library differs from configuration");
    }
  }
  const boundRuntimeRef = runtimeRef ?? createOpaqueRuntimeReference("RUNTIME_REF", configuration.configuration_sha256);
  const schedulerAuthorityRoot = schedulerRoot ?? authorityRoot;
  const scheduler = createHybridScheduler({
    authorityRoot: schedulerAuthorityRoot,
    policy: schedulerPolicy ?? undefined,
    clock,
    globalGovernanceContext: operationalGlobalGovernanceContexts.SCHEDULER,
    globalGovernanceAuthorityRoot,
    globalGovernanceBootstrapSha256,
  });
  let status = "PREPARED_NOT_ACTIVATED";
  let lastCampaign = null;
  let lastMonitor = null;
  let lastRapidPrototypeWorkflow = null;

  const startCampaign = async ({bootstrapPlan, admission, laneWork, persistCampaignState, runtimeAuthorityRoot = authorityRoot, repositoryRootOverride = repositoryRoot, schedulerRootOverride = null} = {}) => {
    assertUniversalDevelopmentMode("CAMPAIGN");
    assert(projectBinding !== null, "Intent Regulator campaign requires an explicit project binding", "PROJECT_BINDING_REQUIRED");
    validateCanonicalCampaignAdmission(admission, {bootstrapPlan});
    status = "ACTIVE";
    try {
      lastCampaign = await runCanonicalCampaign({
        bootstrapPlan,
        admission,
        host,
        hostAttachment,
        authorityRoot: runtimeAuthorityRoot,
        repositoryRoot: repositoryRootOverride,
        runtimeRef: boundRuntimeRef,
        laneWork,
        persistCampaignState,
        projectBinding,
        clock,
        leaseDurationSeconds,
        schedulerRoot: schedulerRootOverride ?? schedulerAuthorityRoot ?? runtimeAuthorityRoot,
        schedulerPolicy: scheduler.policy(),
        globalGovernanceContext: operationalGlobalGovernanceContexts.SCHEDULER,
        globalGovernanceAuthorityRoot,
        globalGovernanceBootstrapSha256,
      });
      status = lastCampaign.status === "CLOSED" ? "CLOSED" : lastCampaign.status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
      return lastCampaign;
    } catch (error) {
      status = "BLOCKED";
      throw error;
    }
  };

  const monitor = async ({observe, onIteration = null, resolveIteration = null, onSameTurnBoundExhausted = null, signal = null, once = false, intervalMinutes = configuration.review_interval_minutes, intervalMs = null} = {}) => {
    assert(typeof observe === "function", "Intent Regulator monitor requires a typed observation callback");
    requireInterval(intervalMinutes);
    lastMonitor = await runContinuousOperatingLoop({
      observe,
      onIteration,
      resolveIteration,
      onSameTurnBoundExhausted,
      signal,
      once,
      intervalMinutes,
      intervalMs,
    });
    return lastMonitor;
  };

  const advanceRapidPrototype = async ({workflow, event, payload = null, persistWorkflowState = null, onQuestion = null, inventory = null, visibleTaskRegistry = null, visibleTaskReadback = null} = {}) => {
    const controller = createRapidPrototypeWorkflowController({workflow, inventory, visibleTaskRegistry, visibleTaskReadback, persist: persistWorkflowState, onQuestion});
    lastRapidPrototypeWorkflow = await controller.advance({event, payload});
    return structuredClone(lastRapidPrototypeWorkflow);
  };

  const initializeRapidPrototypeProject = async ({workflow, setupReceipt, persistWorkflowState = null, onQuestion = null, inventory = null, visibleTaskRegistry = null, visibleTaskReadback = null} = {}) => {
  validateRapidPrototypeWorkflowInventoryBinding(workflow, {inventory, visibleTaskRegistry, visibleTaskReadback});
    assert(workflow.stage === "PROJECT_INITIALIZATION", "rapid-prototype project initialization is not due", "RAPID_PROTOTYPE_GATE_REQUIRED");
    requireRecord(setupReceipt, "rapid-prototype project setup receipt");
    const nextWorkflow = await advanceRapidPrototype({
      workflow,
      event: "PROJECT_INITIALIZED",
      payload: setupReceipt,
      persistWorkflowState,
      onQuestion,
      inventory,
      visibleTaskRegistry,
      visibleTaskReadback,
    });
    return Object.freeze({workflow: nextWorkflow, next_action: nextWorkflow.stage});
  };

  const closeRapidPrototypeTask = async ({workflow, agentId, handoffSha256, worktreeId = null, persistWorkflowState = null, onQuestion = null, preserveHandoff = null, integrateWorktree = null, archiveTask = null, inventory = null, visibleTaskRegistry = null, visibleTaskReadback = null} = {}) => {
    const controller = createRapidPrototypeWorkflowController({
      workflow,
      inventory,
      visibleTaskRegistry,
      visibleTaskReadback,
      persist: persistWorkflowState,
      onQuestion,
      preserveHandoff,
      integrateWorktree,
      archiveTask,
    });
    lastRapidPrototypeWorkflow = await controller.closeTask({agentId, handoffSha256, worktreeId});
    return structuredClone(lastRapidPrototypeWorkflow);
  };

  const startRapidPrototypePhase = async ({
    workflow,
    phase,
    bootstrapPlan,
    admission,
    laneWork,
    persistCampaignState,
    persistWorkflowState,
    onQuestion = null,
    platformMergeReceipt = null,
    inventory = null,
    visibleTaskRegistry = null,
    visibleTaskReadback = null,
    runtimeAuthorityRoot = authorityRoot,
    repositoryRootOverride = repositoryRoot,
  } = {}) => {
    validateRapidPrototypeWorkflowInventoryBinding(workflow, {inventory, visibleTaskRegistry, visibleTaskReadback});
    const phaseAliases = {FEATURE_DEVELOPMENT: "FEATURE_AUDIT_REPAIR"};
    const activePhase = phaseAliases[phase] ?? phase;
    assert(RAPID_PROTOTYPE_PHASES.includes(activePhase), `rapid-prototype phase is invalid: ${phase}`, "RAPID_PROTOTYPE_PHASE_MISMATCH");
    assert(workflow.phase === "PROJECT_INITIALIZATION" || workflow.phase === activePhase,
    `rapid-prototype workflow is in ${workflow.phase}, not ${activePhase}`, "RAPID_PROTOTYPE_PHASE_MISMATCH");
    assert(workflow.stage !== "IMPORT_APPROVAL_REQUIRED", "imported rapid development requires explicit owner approval", "OWNER_APPROVAL_REQUIRED");
    if (workflow.stage === "PROJECT_INITIALIZATION") {
      throw Object.assign(new Error("PROJECT_INITIALIZATION_REQUIRED: the Controller must create or bind the project skeleton before feature work"), {code: "PROJECT_INITIALIZATION_REQUIRED"});
    }
    if (activePhase === "PLATFORM_INTEGRATION") {
      assert(workflow.stage === "PLATFORM_INTEGRATION", "platform integration is not ready for Controller merge", "RAPID_PROTOTYPE_GATE_REQUIRED");
      validatePlatformMergeGate(platformMergeReceipt, {projectId: workflow.project_id, sourceBinding: admission?.source ?? null, inventorySha256: workflow.inventory_sha256});
      const nextWorkflow = await advanceRapidPrototype({
        workflow,
        event: "PLATFORM_MERGE_COMPLETE",
        payload: {platform_merge_gate: platformMergeReceipt},
        persistWorkflowState,
        onQuestion,
        inventory,
        visibleTaskRegistry,
        visibleTaskReadback,
      });
      return Object.freeze({campaign: null, workflow: nextWorkflow, next_action: nextWorkflow.stage});
    }
    if (activePhase === "CENTRAL_INTEGRATION") {
      assert(workflow.stage === "CENTRAL_INTEGRATION", "central integration is not ready", "RAPID_PROTOTYPE_GATE_REQUIRED");
      return Object.freeze({campaign: null, workflow: structuredClone(workflow), next_action: "CENTRAL_CANDIDATE_UPDATED"});
    }
    const phaseRoster = activePhase === "FEATURE_AUDIT_REPAIR"
      ? [...workflow.feature_roster, ...workflow.governance_roster]
      : workflow.platform_roster;
    const startEvent = activePhase === "FEATURE_AUDIT_REPAIR" ? "FEATURE_WAVE_STARTED" : "PLATFORM_WAVE_STARTED";
    const expectedStage = activePhase === "FEATURE_AUDIT_REPAIR" ? "FEATURE_WAVE" : "PLATFORM_WAVE";
    assert(workflow.phase === activePhase && workflow.stage === expectedStage, "rapid-prototype phase cannot start before its preceding convergence gate", "RAPID_PROTOTYPE_GATE_REQUIRED");
    workflow = await advanceRapidPrototype({workflow, event: startEvent, persistWorkflowState, onQuestion, inventory, visibleTaskRegistry, visibleTaskReadback});
    const campaign = await startCampaign({
      bootstrapPlan,
      admission,
      laneWork,
      persistCampaignState,
      runtimeAuthorityRoot,
      repositoryRootOverride,
    });
    const handoffBatch = requireCampaignHandoffBatch(campaign, phaseRoster, activePhase === "FEATURE_AUDIT_REPAIR" ? "feature" : "platform");
    let nextWorkflow = workflow;
    for (const handoff of handoffBatch.handoffs) {
      nextWorkflow = await advanceRapidPrototype({
        workflow: nextWorkflow,
        event: activePhase === "FEATURE_AUDIT_REPAIR"
          ? (handoff.target_kind === "GOVERNANCE_LANE" ? "GOVERNANCE_CANDIDATE_READY" : "FEATURE_CANDIDATE_READY")
          : "PLATFORM_DOMAIN_CANDIDATE_READY",
        payload: handoff,
        persistWorkflowState,
        onQuestion,
        inventory,
        visibleTaskRegistry,
        visibleTaskReadback,
      });
    }
    if (activePhase === "FEATURE_AUDIT_REPAIR" || activePhase === "PLATFORM_FOUNDATION") {
      nextWorkflow = await advanceRapidPrototype({
        workflow: nextWorkflow,
        event: activePhase === "FEATURE_AUDIT_REPAIR" ? "FEATURE_BATCH_CLOSED" : "PLATFORM_BATCH_CLOSED",
        payload: {all_required_handoffs: true, production_candidate_pending_tests: true, handoffs: handoffBatch.handoffs},
        persistWorkflowState,
        onQuestion,
        inventory,
        visibleTaskRegistry,
        visibleTaskReadback,
      });
    }
    return Object.freeze({campaign, workflow: nextWorkflow, next_action: nextWorkflow.stage});
  };

  const inspect = () => Object.freeze({
    schema: INTENT_REGULATOR_RUNTIME_SCHEMA,
    version: 1,
    status,
    configuration_sha256: configuration.configuration_sha256,
    runtime_ref: boundRuntimeRef,
    scheduler: scheduler.inspect(),
    global_governance_context_sha256: operationalGlobalGovernanceContexts.RUNTIME.context_sha256,
    last_campaign_status: lastCampaign?.status ?? null,
    last_monitor_iterations: Array.isArray(lastMonitor) ? lastMonitor.length : 0,
  });

  return Object.freeze({
    configuration: structuredClone(configuration),
    generatedProjectRoleLibrary: generatedProjectRoleLibrary === null ? null : structuredClone(generatedProjectRoleLibrary),
    runtimeRef: boundRuntimeRef,
    inspectScheduler: () => structuredClone(scheduler.inspect()),
    startCampaign,
    advanceRapidPrototype,
    initializeRapidPrototypeProject,
    closeRapidPrototypeTask,
    startRapidPrototypePhase,
    monitor,
    inspect,
  });
}
