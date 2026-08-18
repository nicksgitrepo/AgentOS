#!/usr/bin/env node

/* User-facing Bootstrap -> Intent Regulator -> campaign transition. */

import fs from "node:fs";
import path from "node:path";
import {compileVisibleTaskParityReadback, compileVisibleTaskRegistryFromHost} from "./canonical-feature-inventory.mjs";
import {canonicalDigest} from "./content-addressing.mjs";
import {createIntentRegulatorRuntime} from "./intent-regulator-runtime.mjs";
import {validateProjectImportPlan} from "./project-import.mjs";
import {validateAuditDrivenMigrationRecord, validateRapidPrototypeWorkflow, validateRapidPrototypeWorkflowInventoryBinding} from "./rapid-prototype-workflow.mjs";
import {assertUniversalDevelopmentMode} from "./governance-library.mjs";
import {initializeBootstrapProjectMemory} from "./project-memory-runtime.mjs";
import {compileAllOperationalGlobalGovernanceContexts} from "./global-governance-operational-context.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireQuestionId(value) {
  requireString(value, "Bootstrap Runtime question ID");
  assert(/^[A-Z][A-Z0-9._:-]*$/u.test(value), "Bootstrap Runtime question ID is not portable");
}

function safeExternalPath(root, relativePath) {
  requireString(root, "Bootstrap Runtime authority root");
  requireString(relativePath, "Bootstrap Runtime state path");
  assert(path.isAbsolute(root) && !path.isAbsolute(relativePath) && !relativePath.includes("\\"), "Bootstrap Runtime state path must be relative to an absolute authority root");
  const canonicalRoot = fs.realpathSync.native(path.resolve(root));
  const target = path.resolve(canonicalRoot, relativePath);
  assert(target.startsWith(`${canonicalRoot}${path.sep}`), "Bootstrap Runtime state path escapes the authority root");
  for (let cursor = target; cursor !== canonicalRoot; cursor = path.dirname(cursor)) if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "Bootstrap Runtime state path contains a symlink");
  return target;
}

function writeDurableAtomic(target, contents, mode = 0o600) {
  const staged = `${target}.${process.pid}.${Date.now()}.stage`;
  try {
    const handle = fs.openSync(staged, "wx", mode);
    try {
      fs.writeFileSync(handle, contents, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(staged, target);
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
}

function createBoundExternalStatePersistence({authorityRoot, repositoryRoot = process.cwd(), relativePath, stateField, expectedField, digestField, label} = {}) {
  const canonicalRepository = fs.realpathSync.native(path.resolve(repositoryRoot));
  const canonicalAuthority = fs.realpathSync.native(path.resolve(authorityRoot));
  assert(canonicalAuthority !== canonicalRepository && !canonicalAuthority.startsWith(`${canonicalRepository}${path.sep}`), "Bootstrap Runtime authority must remain outside the Product repository");
  const target = safeExternalPath(authorityRoot, relativePath);
  const persist = (payload = {}) => {
    const expectedDigest = payload[expectedField] ?? null;
    const state = payload[stateField];
    assert(state !== null && typeof state === "object" && !Array.isArray(state), `${label} must be an object`);
    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    if (fs.existsSync(target)) {
      assert(!fs.lstatSync(target).isSymbolicLink(), `${label} may not be a symlink`);
      const current = JSON.parse(fs.readFileSync(target, "utf8"));
      if (expectedDigest !== null) assert(current[digestField] === expectedDigest, `${label} compare-and-swap parent is stale`);
    } else assert(expectedDigest === null, `${label} parent is missing`);
    writeDurableAtomic(target, `${JSON.stringify(state)}\n`);
    const readback = JSON.parse(fs.readFileSync(target, "utf8"));
    assert(readback[digestField] === state[digestField], `${label} readback differs`);
    return readback;
  };
  return Object.freeze({
    repository_root: repositoryRoot,
    authority_root: authorityRoot,
    state_path: target,
    persist,
  });
}

export function createCampaignStatePersistence({authorityRoot, repositoryRoot = process.cwd(), relativePath = "campaigns/current/state.json"} = {}) {
  const persistence = createBoundExternalStatePersistence({
    authorityRoot,
    repositoryRoot,
    relativePath,
    stateField: "state",
    expectedField: "expected_state_sha256",
    digestField: "state_sha256",
    label: "campaign state",
  });
  return Object.freeze({...persistence, persistCampaignState: persistence.persist});
}

export function createWorkflowStatePersistence({authorityRoot, repositoryRoot = process.cwd(), relativePath = "workflows/current/state.json"} = {}) {
  const persistence = createBoundExternalStatePersistence({
    authorityRoot,
    repositoryRoot,
    relativePath,
    stateField: "workflow",
    expectedField: "expected_workflow_sha256",
    digestField: "workflow_sha256",
    label: "rapid-prototype workflow state",
  });
  return Object.freeze({...persistence, persistWorkflowState: persistence.persist});
}

export function createQuestionQueuePersistence({authorityRoot, repositoryRoot = process.cwd(), relativePath = "questions.txt"} = {}) {
  const canonicalRepository = fs.realpathSync.native(path.resolve(repositoryRoot));
  const canonicalAuthority = fs.realpathSync.native(path.resolve(authorityRoot));
  assert(canonicalAuthority !== canonicalRepository && !canonicalAuthority.startsWith(`${canonicalRepository}${path.sep}`), "Bootstrap Runtime question queue must remain outside the Product repository");
  const target = safeExternalPath(authorityRoot, relativePath);
  const appendQuestion = ({question_id: questionId} = {}) => {
    requireQuestionId(questionId);
    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    let current = "";
    if (fs.existsSync(target)) {
      assert(!fs.lstatSync(target).isSymbolicLink(), "Bootstrap Runtime question queue may not be a symlink");
      current = fs.readFileSync(target, "utf8");
    }
    const line = `${questionId}\tOPEN\n`;
    if (!current.split("\n").some((entry) => entry.startsWith(`${questionId}\t`))) {
      writeDurableAtomic(target, current.endsWith("\n") || current.length === 0 ? `${current}${line}` : `${current}\n${line}`);
    }
    return target;
  };
  return Object.freeze({repository_root: repositoryRoot, authority_root: authorityRoot, question_path: target, appendQuestion});
}

export async function bootstrapAndStartAgentOS({
  configuration,
  runtimeOptions = {},
  bootstrapPlan,
  admission,
  laneWork,
  authorityRoot,
  repositoryRoot = process.cwd(),
  projectBinding = null,
  projectContract = null,
  projectMemory = null,
  persistCampaignState = null,
  statePath = "campaigns/current/state.json",
  rapidPrototypeWorkflow = null,
  rapidPrototypeMigration = null,
  rapidPrototypeInventory = null,
  visibleTaskRegistry = null,
  // Retained for compatibility with older callers; rapid workflows always
  // replace it with a fresh receipt obtained from the bound host below.
  visibleTaskReadback = null,
  rapidPrototypePhase = null,
  projectSetupReceipt = null,
  persistWorkflowState = null,
  workflowStatePath = "workflows/current/state.json",
  questionQueuePath = "questions.txt",
  onWorkflowQuestion = null,
  platformMergeReceipt = null,
  preserveHandoff = null,
  integrateWorktree = null,
  archiveTask = null,
  monitorObservation = null,
  monitorOnIteration = null,
  monitorResolveIteration = null,
  monitorOnSameTurnBoundExhausted = null,
  monitorOptions = {},
  startMonitor = monitorObservation !== null,
  globalGovernanceBootstrap,
  globalGovernanceEvents,
  globalGovernanceReadback,
  globalGovernanceObservedAtUtc,
  globalGovernanceAuthorityStore,
} = {}) {
  assertUniversalDevelopmentMode("BOOTSTRAP");
  assert(globalGovernanceBootstrap === undefined && globalGovernanceEvents === undefined && globalGovernanceReadback === undefined && globalGovernanceObservedAtUtc === undefined, "Bootstrap Runtime rejects caller-supplied global-governance objects; provide only canonical store references");
  const operationalGlobalGovernanceContexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: globalGovernanceAuthorityStore});
  const persistence = persistCampaignState === null
    ? createCampaignStatePersistence({authorityRoot, repositoryRoot, relativePath: statePath})
    : {persistCampaignState};
  let boundVisibleTaskReadback = visibleTaskReadback;
  let boundVisibleTaskRegistry = visibleTaskRegistry;
  if (rapidPrototypeWorkflow !== null) {
    const visibleTaskHost = runtimeOptions?.host;
    assert(visibleTaskHost !== null && typeof visibleTaskHost === "object" && typeof visibleTaskHost.list_threads === "function",
      "Bootstrap Runtime requires the bound host list_threads capability for visible-task parity", "VISIBLE_TASK_READBACK_REQUIRED");
    let listThreadsReceipt;
    try {
      const requestedTaskIds = Array.isArray(boundVisibleTaskRegistry)
        ? boundVisibleTaskRegistry.map((record) => record.runtime_task_id)
        : [
          ...(rapidPrototypeInventory?.features ?? []),
          ...(rapidPrototypeInventory?.governance_lanes ?? []),
        ].map((entry) => entry.auditor_task_id);
      listThreadsReceipt = await visibleTaskHost.list_threads({
        projectId: rapidPrototypeWorkflow.project_id,
        campaignId: rapidPrototypeWorkflow.campaign_id,
        runtime_task_ids: requestedTaskIds,
      });
    } catch (error) {
      const unavailable = new Error(`Bootstrap Runtime could not obtain visible-task host readback; error_ref:opaque:error:${canonicalDigest(error?.message ?? String(error))}`);
      unavailable.code = "VISIBLE_TASK_READBACK_UNAVAILABLE";
      throw unavailable;
    }
    if (!Array.isArray(boundVisibleTaskRegistry)) {
      boundVisibleTaskRegistry = compileVisibleTaskRegistryFromHost({
        inventory: rapidPrototypeInventory,
        listThreadsReceipt,
        projectId: rapidPrototypeWorkflow.project_id,
        campaignId: rapidPrototypeWorkflow.campaign_id,
      });
    }
    boundVisibleTaskReadback = compileVisibleTaskParityReadback({
      inventory: rapidPrototypeInventory,
      visibleTaskRegistry: boundVisibleTaskRegistry,
      listThreadsReceipt,
      projectId: rapidPrototypeWorkflow.project_id,
      campaignId: rapidPrototypeWorkflow.campaign_id,
    });
    validateRapidPrototypeWorkflowInventoryBinding(rapidPrototypeWorkflow, {
      inventory: rapidPrototypeInventory,
      visibleTaskRegistry: boundVisibleTaskRegistry,
      visibleTaskReadback: boundVisibleTaskReadback,
    });
    const migrationRequired = rapidPrototypeWorkflow.project_mode === "IMPORTED_PROJECT"
      || rapidPrototypeWorkflow.migrated_worktrees.length > 0;
    if (migrationRequired) {
      assert(rapidPrototypeMigration !== null, "Bootstrap Runtime requires the preserved rapid-prototype migration record before campaign admission");
      validateAuditDrivenMigrationRecord(rapidPrototypeMigration, {inventory: rapidPrototypeInventory});
      const migratedTargets = rapidPrototypeMigration.feature_adoptions.map((entry) => entry.worktree_id).sort();
      const workflowTargets = rapidPrototypeWorkflow.migrated_worktrees.map((entry) => entry.worktree_id).sort();
      assert(JSON.stringify(migratedTargets) === JSON.stringify(workflowTargets), "Bootstrap Runtime migration record and workflow worktree intake differ");
    }
  }
  assert(rapidPrototypeWorkflow === null || rapidPrototypePhase === null || ["PROJECT_INITIALIZATION", "PLATFORM_FOUNDATION", "PLATFORM_INTEGRATION", "FEATURE_AUDIT_REPAIR", "CENTRAL_INTEGRATION", "FEATURE_DEVELOPMENT"].includes(rapidPrototypePhase), "Bootstrap Runtime rapid-prototype phase is invalid");
  assert(onWorkflowQuestion === null || typeof onWorkflowQuestion === "function", "Bootstrap Runtime workflow question callback must be callable");
  assert(preserveHandoff === null || typeof preserveHandoff === "function", "Bootstrap Runtime handoff preservation adapter must be callable");
  assert(integrateWorktree === null || typeof integrateWorktree === "function", "Bootstrap Runtime worktree integration adapter must be callable");
  assert(archiveTask === null || typeof archiveTask === "function", "Bootstrap Runtime task archive adapter must be callable");
  const workflowPersistence = rapidPrototypeWorkflow === null
    ? null
    : persistWorkflowState === null
      ? createWorkflowStatePersistence({authorityRoot, repositoryRoot, relativePath: workflowStatePath})
      : {persistWorkflowState, state_path: null};
  const questionPersistence = rapidPrototypeWorkflow === null
    ? null
    : createQuestionQueuePersistence({authorityRoot, repositoryRoot, relativePath: questionQueuePath});
  const onQuestion = rapidPrototypeWorkflow === null || (questionPersistence === null && onWorkflowQuestion === null)
    ? null
    : async (payload) => {
      questionPersistence?.appendQuestion(payload);
      if (onWorkflowQuestion !== null) await onWorkflowQuestion(payload);
    };
  if (rapidPrototypeWorkflow !== null && workflowPersistence?.state_path !== null && workflowPersistence?.state_path !== undefined && !fs.existsSync(workflowPersistence.state_path)) {
    await workflowPersistence.persistWorkflowState({expected_workflow_sha256: null, workflow: rapidPrototypeWorkflow});
  }
  const regulator = createIntentRegulatorRuntime({
    ...runtimeOptions,
    operationalGlobalGovernanceContexts,
    globalGovernanceAuthorityStore,
    configuration,
    authorityRoot,
    repositoryRoot,
    projectBinding,
  });
  let memoryRuntime = null;
  let memoryState = null;
  if (projectMemory !== null) {
    assert(projectMemory !== null && typeof projectMemory === "object" && !Array.isArray(projectMemory), "Bootstrap Runtime project-memory options must be an object");
    assert(projectContract !== null, "Bootstrap Runtime project-memory integration requires the compiled project contract");
    const initializedMemory = initializeBootstrapProjectMemory({
      projectContract,
      observedAtUtc: projectMemory.observedAtUtc,
      authorityRoot: projectMemory.authorityRoot ?? authorityRoot,
      repositoryRoot,
      binding: projectMemory.binding,
      ledgerPath: projectMemory.ledgerPath,
      snapshotPath: projectMemory.snapshotPath,
      laneRef: projectMemory.laneRef,
      allowedScopeRefs: projectMemory.allowedScopeRefs,
      prohibitedScopeRefs: projectMemory.prohibitedScopeRefs,
    });
    memoryRuntime = initializedMemory.runtime;
    memoryState = initializedMemory.state;
  }
  assert(monitorObservation === null || typeof monitorObservation === "function", "Bootstrap Runtime monitor observation must be callable");
  assert(monitorOnIteration === null || typeof monitorOnIteration === "function", "Bootstrap Runtime monitor callback must be callable");
  assert(monitorResolveIteration === null || typeof monitorResolveIteration === "function", "Bootstrap Runtime monitor resolver must be callable");
  assert(monitorOnSameTurnBoundExhausted === null || typeof monitorOnSameTurnBoundExhausted === "function", "Bootstrap Runtime monitor bound callback must be callable");
  assert(monitorOptions !== null && typeof monitorOptions === "object" && !Array.isArray(monitorOptions), "Bootstrap Runtime monitor options must be an object");
  let monitor = null;
  if (startMonitor) {
    assert(typeof monitorObservation === "function", "Bootstrap Runtime cannot start the monitor without an observation callback");
    const {
      signal = null,
      once = false,
      intervalMinutes = configuration.review_interval_minutes,
      intervalMs = null,
    } = monitorOptions;
    monitor = regulator.monitor({
      observe: monitorObservation,
      onIteration: monitorOnIteration,
      resolveIteration: monitorResolveIteration,
      onSameTurnBoundExhausted: monitorOnSameTurnBoundExhausted,
      signal,
      once,
      intervalMinutes,
      intervalMs,
    }).catch((error) => ({
      status: "BLOCKED",
      code: error?.code ?? "INTENT_REGULATOR_MONITOR_FAILURE",
    }));
  }
  let campaign = null;
  let workflow = rapidPrototypeWorkflow === null ? null : structuredClone(rapidPrototypeWorkflow);
  let nextAction = null;
  const advanceWorkflow = rapidPrototypeWorkflow === null
    ? null
    : async ({event, payload = null} = {}) => {
      const nextWorkflow = await regulator.advanceRapidPrototype({
        workflow,
        event,
        payload,
        persistWorkflowState: workflowPersistence.persistWorkflowState,
        onQuestion,
        inventory: rapidPrototypeInventory,
        visibleTaskRegistry: boundVisibleTaskRegistry,
        visibleTaskReadback: boundVisibleTaskReadback,
      });
      workflow = nextWorkflow;
      nextAction = nextWorkflow.stage;
      return Object.freeze({workflow: structuredClone(workflow), next_action: nextAction});
    };
  const startPhase = rapidPrototypeWorkflow === null
    ? null
    : async ({phase, phaseLaneWork = laneWork, phasePlatformMergeReceipt = platformMergeReceipt} = {}) => {
      assert(["PROJECT_INITIALIZATION", "PLATFORM_FOUNDATION", "PLATFORM_INTEGRATION", "FEATURE_AUDIT_REPAIR", "CENTRAL_INTEGRATION", "FEATURE_DEVELOPMENT"].includes(phase), "Bootstrap Runtime rapid-prototype phase is invalid");
      if (phase === "PROJECT_INITIALIZATION") {
        assert(projectSetupReceipt !== null, "Bootstrap Runtime project initialization requires a source-bound setup receipt");
        const initialized = await regulator.initializeRapidPrototypeProject({
          workflow,
          setupReceipt: projectSetupReceipt,
          persistWorkflowState: workflowPersistence.persistWorkflowState,
          onQuestion,
          inventory: rapidPrototypeInventory,
          visibleTaskRegistry: boundVisibleTaskRegistry,
          visibleTaskReadback: boundVisibleTaskReadback,
        });
        workflow = initialized.workflow;
        nextAction = initialized.next_action;
        return Object.freeze({campaign: null, workflow: structuredClone(workflow), next_action: nextAction});
      }
      const phaseResult = await regulator.startRapidPrototypePhase({
        workflow,
        phase,
        bootstrapPlan,
        admission,
        laneWork: phaseLaneWork,
        persistCampaignState: persistence.persistCampaignState,
        persistWorkflowState: workflowPersistence.persistWorkflowState,
        onQuestion,
        platformMergeReceipt: phasePlatformMergeReceipt,
        inventory: rapidPrototypeInventory,
        visibleTaskRegistry: boundVisibleTaskRegistry,
        visibleTaskReadback: boundVisibleTaskReadback,
      });
      campaign = phaseResult.campaign;
      workflow = phaseResult.workflow;
      nextAction = phaseResult.next_action;
      return Object.freeze({campaign, workflow: structuredClone(workflow), next_action: nextAction});
    };
  if (rapidPrototypeWorkflow !== null && rapidPrototypeWorkflow.stage === "IMPORT_APPROVAL_REQUIRED") {
    nextAction = "OWNER_APPROVAL_REQUIRED";
  } else if (rapidPrototypeWorkflow !== null && rapidPrototypeWorkflow.stage === "PROJECT_INITIALIZATION") {
    nextAction = "PROJECT_INITIALIZATION";
  } else if (rapidPrototypeWorkflow !== null) {
    assert(rapidPrototypePhase !== null, "Bootstrap Runtime rapid-prototype start requires an explicit phase");
    await startPhase({phase: rapidPrototypePhase});
  } else {
    campaign = await regulator.startCampaign({
      bootstrapPlan,
      admission,
      laneWork,
      persistCampaignState: persistence.persistCampaignState,
    });
    nextAction = campaign.status;
  }
  return Object.freeze({
    runtime: regulator.inspect(),
    campaign,
    workflow,
    next_action: nextAction,
    state_path: persistence.state_path ?? null,
    workflow_state_path: workflowPersistence?.state_path ?? null,
    questions_path: questionPersistence?.question_path ?? null,
    memory: memoryState,
    global_governance: Object.freeze({bootstrap_sha256: operationalGlobalGovernanceContexts.SPAWNER.bootstrap_sha256, contexts: operationalGlobalGovernanceContexts}),
    refresh_memory: memoryRuntime === null ? null : ({observedAtUtc = new Date().toISOString()} = {}) => {
      memoryState = memoryRuntime.loadCurrent({observedAtUtc});
      return memoryState;
    },
    advance_workflow: advanceWorkflow,
    initialize_project: rapidPrototypeWorkflow === null ? null : async ({setupReceipt = projectSetupReceipt} = {}) => {
      const initialized = await regulator.initializeRapidPrototypeProject({
        workflow,
        setupReceipt,
        persistWorkflowState: workflowPersistence?.persistWorkflowState ?? null,
        onQuestion,
        inventory: rapidPrototypeInventory,
        visibleTaskRegistry: boundVisibleTaskRegistry,
        visibleTaskReadback: boundVisibleTaskReadback,
      });
      workflow = initialized.workflow;
      nextAction = initialized.next_action;
      return Object.freeze({workflow: structuredClone(workflow), next_action: nextAction});
    },
    start_phase: startPhase,
    close_task: rapidPrototypeWorkflow === null ? null : async ({agentId, handoffSha256, worktreeId = null} = {}) => {
      const nextWorkflow = await regulator.closeRapidPrototypeTask({
        workflow,
        agentId,
        handoffSha256,
        worktreeId,
        persistWorkflowState: workflowPersistence?.persistWorkflowState ?? null,
        onQuestion,
        inventory: rapidPrototypeInventory,
        visibleTaskRegistry: boundVisibleTaskRegistry,
        visibleTaskReadback: boundVisibleTaskReadback,
        preserveHandoff,
        integrateWorktree,
        archiveTask,
      });
      workflow = nextWorkflow;
      nextAction = nextWorkflow.stage;
      return Object.freeze({workflow: structuredClone(workflow), next_action: nextAction});
    },
    monitor,
  });
}
