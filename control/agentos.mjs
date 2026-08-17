#!/usr/bin/env node

/* Stable public kernel surface for the complete AgentOS runtime. */

export * from "./intent-regulator-runtime.mjs";
export * from "./native-self-development-adapter.mjs";
export {createCampaignStatePersistence, createWorkflowStatePersistence, createQuestionQueuePersistence, bootstrapAndStartAgentOS} from "./bootstrap-runtime.mjs";
export {compileRapidPrototypeWorkflow, compileRapidPrototypeWorkflowFromInventory} from "./rapid-prototype-workflow.mjs";
export {compileFeatureLaneGoal, validateFeatureLaneGoal, assertFeatureLaneGoalBinding} from "./feature-lane-goal.mjs";
export {compileVisibleTaskParityReadback, compileVisibleTaskRegistryFromHost, validateVisibleTaskParity} from "./canonical-feature-inventory.mjs";
export {runCanonicalCampaign, inspectCanonicalCampaignRuntime} from "./canonical-campaign-orchestration-adapter.mjs";
export {compileGeneratedProjectRoleLibrary, compileGeneratedTaskRolePacket, compileGovernanceBinding, prepareGovernanceUpgrade} from "./four-library-governance.mjs";
export {compileLayeredGovernanceContract, validateLayeredGovernanceContract, activateLayeredGovernance, compareLayeredGovernanceEvidence, validateLayeredGovernanceEvidence} from "./layered-governance-contract.mjs";
export {compileProjectContract, compileProjectContractWithReceipt, reassessProjectContract} from "./bootstrap-project-contract.mjs";
export {compileControllerImportPlanningContext, validateControllerImportPlanningContext, compileControllerImportCampaignPlan, validateControllerImportCampaignPlan, compileControllerImportRosterProjection, validateControllerImportRosterProjection, compileControllerImportRunState, validateControllerImportRunState, advanceControllerImportRunState} from "./controller-import-planner.mjs";
export {compileControllerImportRoutineCloseout, validateControllerImportRoutineCloseout} from "./controller-import-closeout.mjs";
export {compilePyramidImportOutput, validatePyramidImportOutput, compileGitRepointPlan, validateGitRepointPlan} from "./project-import.mjs";
export {compileControllerEscalation, validateControllerEscalation} from "./controller-escalation-continuation.mjs";
export {compileControllerOwnerEventWake, validateControllerOwnerEventWake, resumeControllerFromOwnerEvent, runControllerOwnerEventContinuation} from "./controller-owner-event-wake.mjs";
export {evaluateStopWorkflowGate, validateStopWorkflowDecision, compileStopWorkflowNoStopAnswers, compileRoutineDevelopmentStopDecision, STOP_WORKFLOW_QUESTIONS, STOP_WORKFLOW_OUTCOMES, STOP_WORKFLOW_NEXT_ACTIONS} from "./stop-workflow-gate.mjs";
export {compileCandidateScopeGate, validateCandidateScopeGate, CANDIDATE_SCOPE_MODES, CANDIDATE_SCOPE_GATE_HOSTILE_FIXTURES} from "./candidate-scope-gate.mjs";
export {compileAgentSpawnerLifecycle, validateAgentSpawnerLifecycle, advanceAgentSpawnerLifecycle, runAgentSpawnerCompilerTick, validateAgentSpawnerCompilerContinuation, admitAgentSpawnerIsolatedLocalCustody, AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256} from "./agent-spawner-lifecycle.mjs";
export {compileControllerStartupSuccessor, validateControllerStartupSuccessor, CONTROLLER_STARTUP_STAGES, CONTROLLER_STARTUP_SEQUENCE_SCHEMA, CONTROLLER_STARTUP_SEQUENCE_VERSION} from "./controller-startup-sequence.mjs";
export {compileControllerStartupCursor, compileControllerStartupRunReadback, validateControllerStartupRunReadback, runControllerStartupCycle, CONTROLLER_STARTUP_RUNNER_SCHEMA, CONTROLLER_STARTUP_RUNNER_VERSION} from "./controller-startup-runner.mjs";
export {compileAgentSpawnerDefectIntake, validateAgentSpawnerDefectIntake, acceptAgentSpawnerDefectRepair} from "./agent-spawner-defect-intake.mjs";
export {compileAgentSpawnerControllerBridge, validateAgentSpawnerControllerBridge, SPAWNER_ROUTE_TO_CONTROLLER_ACTION, AGENT_SPAWNER_CONTROLLER_BRIDGE_SCHEMA, AGENT_SPAWNER_CONTROLLER_BRIDGE_VERSION} from "./agent-spawner-controller-bridge.mjs";
export {compileAgentSpawnerDefectQueue, validateAgentSpawnerDefectQueue, readAgentSpawnerDefectQueue, writeAgentSpawnerDefectQueueCompareAndSwap, appendAgentSpawnerDefectQueueRecord, acceptAgentSpawnerDefectQueueRecord} from "./agent-spawner-defect-queue.mjs";
export {compileIndependentClearanceApplicability, validateIndependentClearanceApplicability} from "./independent-clearance-applicability.mjs";
export {compileImportOrchestrator, validateImportOrchestrator, advanceImportOrchestrator, readImportOrchestratorRecord, writeImportOrchestratorRecordCompareAndSwap, advanceImportOrchestratorRecord} from "./import-orchestrator.mjs";
export {dispatchOrchestratorSuccessor, validateOrchestratorSuccessorDispatchReadback, ORCHESTRATOR_SUCCESSOR_DISPATCH_SCHEMA, ORCHESTRATOR_SUCCESSOR_DISPATCH_VERSION, ORCHESTRATOR_LOCAL_RUNTIME_SUCCESSOR_ACTIONS, ORCHESTRATOR_PROTECTED_RUNTIME_SUCCESSOR_ACTIONS, ORCHESTRATOR_SAFE_TRANSITION_CAP, ORCHESTRATOR_DISPATCHABLE_ACTIONS} from "./orchestrator-successor-dispatch.mjs";
export {compileOrchestratorSuccessorBundle, validateOrchestratorSuccessorBundle, ORCHESTRATOR_SUCCESSOR_BUNDLE_SCHEMA, ORCHESTRATOR_SUCCESSOR_BUNDLE_VERSION} from "./orchestrator-successor-bundle-gate.mjs";
export {compileLocalProofEvidenceGate, validateLocalProofEvidenceGate, LOCAL_PROOF_EVIDENCE_GATE_SCHEMA, LOCAL_PROOF_EVIDENCE_GATE_VERSION, LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS, LOCAL_PROOF_EVIDENCE_REPAIR_ACTION, LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER} from "./local-proof-evidence-gate.mjs";
export {compileLivenessDigestGate, validateLivenessDigestGate, evaluateLivenessBindingFreshness, LIVENESS_DIGEST_GATE_SCHEMA, LIVENESS_DIGEST_GATE_VERSION, LIVENESS_ROSTER_INVALIDATION_RULE, LIVENESS_ROSTER_REFRESH_TRIGGERS} from "./liveness-digest-gate.mjs";
export {compileAutonomousDispatchLivenessGate, validateAutonomousDispatchLivenessGate, evaluateAutonomousDispatchLiveness, AUTONOMOUS_DISPATCH_LIVENESS_GATE_SCHEMA, AUTONOMOUS_DISPATCH_LIVENESS_GATE_VERSION, AUTONOMOUS_DISPATCH_RETRY_ACTION, AUTONOMOUS_DISPATCH_RETRY_HANDLER, AUTONOMOUS_DISPATCH_RETRY_ROUTE} from "./autonomous-dispatch-liveness-gate.mjs";
export {compileHarnessCollisionGate, validateHarnessCollisionGate, inspectHarnessSource, HARNESS_COLLISION_GATE_SCHEMA, HARNESS_COLLISION_GATE_VERSION, HARNESS_COLLISION_REPAIR_ACTION, HARNESS_COLLISION_REPAIR_HANDLER, HARNESS_COLLISION_DIRECT_CONSUMER, HARNESS_COLLISION_DEFECT_CODE, HARNESS_COLLISION_HOSTILE_FIXTURE_REFS} from "./harness-collision-gate.mjs";
export {compileAutonomousLaneHandoff, validateAutonomousLaneHandoff, AUTONOMOUS_LANE_HANDOFF_SCHEMA, AUTONOMOUS_LANE_HANDOFF_VERSION, AUTONOMOUS_LANE_EXECUTION_OWNER, AUTONOMOUS_LANE_CONTROLLER_ROLE, AUTONOMOUS_LANE_NEXT_ACTION, AUTONOMOUS_LANE_NEXT_HANDLER} from "./autonomous-lane-handoff.mjs";
export {discoverDynamicLanes, compileDynamicDependencyGraph, compileDynamicLaneManifest, selectDynamicLaneRolePackets} from "./dynamic-project-lanes.mjs";
export {
  compileTaskProfile,
  compileTaskModelPolicy,
  compileHostCapabilityCatalog,
  compileHostCapabilityAttestation,
  compileRoutingUnavailable,
  selectExecutionRoute,
  selectFallbackRoute,
} from "./task-model-routing.mjs";
export {compileTaskContextPolicy, compileTaskContextItem, selectTaskContext} from "./task-context-firewall.mjs";
export {admitExecutionRoute, runAdmittedTask} from "./task-routing-admission.mjs";
export {compileTaskRoutingEvaluation, replayTaskRouting} from "./task-routing-evaluation.mjs";
export {openPersistentIntentRuntime, inspectPersistentIntentRuntime} from "./persistent-intent-runtime.mjs";
export {compilePersistentRuntimeObservation, compilePersistentRuntimeRoute} from "./persistent-intent-runtime-integration.mjs";
export {compileContinuousOperatingLoop, runContinuousOperatingLoop, runContinuousOperatingLoopIteration} from "./continuous-operating-loop.mjs";
export {readProjectMemoryLedger, reconstructProjectMemory, appendProjectMemoryEvent, readProjectMemorySnapshot, writeProjectMemorySnapshotCompareAndSwap, recoverProjectMemoryLock} from "./project-memory-store.mjs";
export {compileProjectMemoryArtifact, validateProjectMemoryArtifact, writeProjectMemoryArtifact, readProjectMemoryArtifact} from "./project-memory-artifacts.mjs";
export {compileBootstrapProjectMemoryBinding, createProjectMemoryRuntime, assertProjectMemoryRuntimeReady, initializeBootstrapProjectMemory, compileProjectMemoryTaskContext, importProjectMemoryCapsuleAuthoritatively} from "./project-memory-runtime.mjs";
export {compileOfflinePolicy, authorizeOfflineAction, transitionOfflinePolicy} from "./private-offline-mode.mjs";
export {compileProviderNeutralDiscovery, findOfflineUsableAdapters} from "./private-provider-discovery.mjs";
export {allocateTestBuild, formatTestBuildTag, parseTestBuildTag, buildReleaseArtifactManifest} from "./release-lifecycle.mjs";
export {compileReleasePromotionGate, compileBlockedDevelopmentPromotionGate} from "./release-promotion-gate.mjs";
export {advanceDeliveryState, assertCampaignCompletionEligible} from "./delivery-closure-transitions.mjs";
export {
  compileDeliveryOperationGovernance,
  validateDeliveryOperationGovernance,
  compileRuntimeOperationCostProjection,
  validateRuntimeOperationCostProjection,
  compileRuntimeOperationAuthorization,
  validateRuntimeOperationAuthorization,
  approveRuntimeOperationAuthorization,
  rejectRuntimeOperationAuthorization,
  createRuntimeOperationDecisionPacket,
} from "./delivery-operation-governance.mjs";
export {startLocalSelfDevelopment} from "./start-local-self-development.mjs";
export * as apprenticeship from "./apprenticeship-contracts.mjs";

/*
 * Namespaced authorities keep the public kernel complete without flattening
 * unrelated compiler vocabularies into one collision-prone export list.
 * Each namespace is still the same portable code used by the active paths;
 * these are not alternate implementations or compatibility shims.
 */
export * as bootstrap from "./bootstrap-compiler.mjs";
export * as bootstrapConversation from "./bootstrap-conversation.mjs";
export * as bootstrapRuntime from "./bootstrap-runtime.mjs";
export * as projectContract from "./bootstrap-project-contract.mjs";
export * as decisionTree from "./governance-decision-tree.mjs";
export * as gateCatalog from "./gate-catalog-compiler.mjs";
export * as universalResponseGating from "./universal-response-gating.mjs";
export * as generalGovernance from "./governance-library.mjs";
export * as roleGovernance from "./role-governance-library.mjs";
export * as fourLibraries from "./four-library-governance.mjs";
export * as layeredGovernance from "./layered-governance-contract.mjs";
export * as hostAttachment from "./native-host-attachment.mjs";
export * as hostContract from "./native-host-contract.mjs";
export * as nativeSessions from "./native-session-team.mjs";
export * as nativeRunner from "./native-session-runner.mjs";
export * as controller from "./agentos-controller.mjs";
export * as controllerImportPlanner from "./controller-import-planner.mjs";
export * as controllerImportCloseout from "./controller-import-closeout.mjs";
export * as controllerEscalation from "./controller-escalation-continuation.mjs";
export * as controllerOwnerEventWake from "./controller-owner-event-wake.mjs";
export * as agentSpawnerLifecycle from "./agent-spawner-lifecycle.mjs";
export * as controllerStartup from "./controller-startup-sequence.mjs";
export * as controllerStartupRunner from "./controller-startup-runner.mjs";
export * as agentSpawnerDefectIntake from "./agent-spawner-defect-intake.mjs";
export * as agentSpawnerControllerBridge from "./agent-spawner-controller-bridge.mjs";
export * as agentSpawnerDefectQueue from "./agent-spawner-defect-queue.mjs";
export * as independentClearanceApplicability from "./independent-clearance-applicability.mjs";
export * as importOrchestrator from "./import-orchestrator.mjs";
export * as orchestratorSuccessorDispatch from "./orchestrator-successor-dispatch.mjs";
export * as localProofEvidenceGate from "./local-proof-evidence-gate.mjs";
export * as autonomousDispatchLivenessGate from "./autonomous-dispatch-liveness-gate.mjs";
export * as harnessCollisionGate from "./harness-collision-gate.mjs";
export * as projectImport from "./project-import.mjs";
export * as controllerSupervisor from "./controller-supervisor-runtime.mjs";
export * as stopWorkflowGate from "./stop-workflow-gate.mjs";
export * as candidateScopeGate from "./candidate-scope-gate.mjs";
export * as dynamicLanes from "./dynamic-project-lanes.mjs";
export * as featureInventory from "./canonical-feature-inventory.mjs";
export * as projectMemory from "./project-memory.mjs";
export * as projectMemoryStore from "./project-memory-store.mjs";
export * as projectMemoryArtifacts from "./project-memory-artifacts.mjs";
export * as projectMemoryRuntime from "./project-memory-runtime.mjs";
export * as projectMap from "./project-map.mjs";
export * as projectContext from "./project-context-store.mjs";
export * as privateControlBundle from "./private-control-bundle.mjs";
export * as privateControlStorage from "./private-control-storage.mjs";
export * as privateReleaseUpdate from "./private-release-update.mjs";
export * as releaseLifecycle from "./release-lifecycle.mjs";
export * as releasePromotion from "./release-promotion-gate.mjs";
export * as modelRouting from "./task-model-routing.mjs";
export * as taskContext from "./task-context-firewall.mjs";
export * as taskRoutingAdmission from "./task-routing-admission.mjs";
export * as taskRoutingEvaluation from "./task-routing-evaluation.mjs";
export * as offlinePolicy from "./private-offline-mode.mjs";
export * as providerDiscovery from "./private-provider-discovery.mjs";
export * as rapidPrototype from "./rapid-prototype/index.mjs";
export * as rapidPrototypeWorkflow from "./rapid-prototype-workflow.mjs";
export * as platformFoundationMerge from "./platform-foundation-merge.mjs";
export * as deliveryClosure from "./delivery-closure-foundation.mjs";
export * as deliveryOperationGovernance from "./delivery-operation-governance.mjs";
export * as repairRecovery from "./repair-recovery.mjs";
export * as continuousLoop from "./continuous-operating-loop.mjs";
export * as apprenticeshipRunner from "./apprenticeship-native-runner.mjs";
