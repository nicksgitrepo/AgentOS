#!/usr/bin/env node

/*
 * Canonical Bootstrap-to-closure orchestration entrypoint.
 *
 * The adapter owns execution sequencing only. Typed contracts and deterministic
 * projections live in the focused support module; Bootstrap, Runtime, lifecycle,
 * native sessions, and delivery policy remain their existing authorities.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {assertUniversalDevelopmentMode} from "./governance-library.mjs";
import {
  createOpaqueRuntimeReference,
  openPersistentIntentRuntime,
  inspectPersistentIntentRuntime,
} from "./persistent-intent-runtime.mjs";
import {
  createParallelCampaignLifecycle,
  opaqueSessionRef,
} from "./parallel-campaign-lifecycle.mjs";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";
import {
  compileNativeSessionSpawnRequest,
  createNativeSessionTeam,
  validateNativeSessionHostCapabilities,
} from "./native-session-team.mjs";
import {
  CANONICAL_CAMPAIGN_CLOSURE_SCHEMA,
  CANONICAL_SUPPORTED_OWNER_DELIVERY,
  assert,
  validateCanonicalCampaignAdmission,
  requireUtc,
  expectedParallelPlan,
  compileSnapshot,
  meaningfulProgressFromHandoff,
  compileCheckpoint,
  lookupLaneWork,
  validateNativeProgress,
  validateNativeAudit,
  hostReadbackFromOperation,
  workerEvidenceRecord,
  compileResult,
  finalAcceptanceDigest,
  buildClosedClosure,
  compileCanonicalCampaignUniversalCloseoutReceipts,
  blockedDelivery,
  runtimeResult,
  runtimeOperationKey,
  stableKey,
  makeNativeWorkerPrompt,
  makeNativeAuditorPrompt,
  serialExecutor,
  closeIfLive,
} from "./canonical-campaign-orchestration-support.mjs";

export {
  CANONICAL_CAMPAIGN_ADMISSION_SCHEMA,
  CANONICAL_CAMPAIGN_CLOSURE_SCHEMA,
  CANONICAL_CAMPAIGN_ORCHESTRATION_SCHEMA,
  CANONICAL_CAMPAIGN_VERSION,
  DEFAULT_PROGRESS_REVIEW_MINUTES,
  CANONICAL_AUDITOR_ROLE,
  CANONICAL_SUPPORTED_OWNER_DELIVERY,
  validateCanonicalCampaignAdmission,
  compileCanonicalCampaignAdmission,
  validateCanonicalCampaignClosure,
  validateCanonicalCampaignOrchestration,
} from "./canonical-campaign-orchestration-support.mjs";

export async function runCanonicalCampaign({
  bootstrapPlan,
  admission,
  host,
  hostAttachment,
  authorityRoot,
  repositoryRoot = process.cwd(),
  runtimeRef = null,
  laneWork,
  persistCampaignState,
  projectBinding = null,
  clock = () => new Date().toISOString(),
  leaseDurationSeconds = 60,
  schedulerRoot = null,
  schedulerPolicy = null,
} = {}) {
  assertUniversalDevelopmentMode("CAMPAIGN");
  assert(typeof clock === "function", "canonical campaign clock must be callable");
  assert(typeof persistCampaignState === "function", "canonical campaign requires durable campaign-state persistence", "CAMPAIGN_PERSISTENCE_REQUIRED");
  assert(bootstrapPlan !== null && bootstrapPlan !== undefined, "canonical campaign requires the validated Bootstrap plan", "BOOTSTRAP_ADMISSION_REQUIRED");
  assert(admission !== null, "canonical campaign requires a typed Bootstrap admission");
  validateCanonicalCampaignAdmission(admission, {bootstrapPlan});
  assert(admission.delivery.owner_choice === CANONICAL_SUPPORTED_OWNER_DELIVERY, `owner delivery choice ${admission.delivery.owner_choice} requires its exact external delivery adapter`, "DELIVERY_ADAPTER_REQUIRED");
  assert(authorityRoot !== undefined && authorityRoot !== null, "canonical campaign requires an external Runtime authority root", "RUNTIME_AUTHORITY_REQUIRED");
  assert(projectBinding !== null && projectBinding !== undefined, "canonical campaign requires an explicit source-bound project binding", "PROJECT_BINDING_REQUIRED");
  const parallelPlan = expectedParallelPlan(admission);
  const boundRuntimeRef = runtimeRef ?? createOpaqueRuntimeReference("RUNTIME_REF", canonicalDigest({admission_sha256: admission.admission_sha256}));
  validateNativeSessionHostCapabilities(host);
  const team = createNativeSessionTeam({
    host,
    hostAttachment,
    projectId: admission.project_id,
    teamId: admission.team_id,
    campaignId: admission.campaign_id,
    campaignVersion: admission.campaign_version,
    projectBinding,
    acceptRequestedIdentityWithoutReadback: true,
    now: clock,
  });
  const buildScheduler = createHybridScheduler({
    authorityRoot: schedulerRoot ?? authorityRoot,
    policy: schedulerPolicy ?? undefined,
    clock,
  });
  const initialTime = clock();
  requireUtc(initialTime, "canonical campaign start time");
  const initialSnapshot = compileSnapshot(admission, {progressStatus: "OPEN", acceptanceStatus: "NONE"});
  const runtime = openPersistentIntentRuntime({
    authorityRoot,
    repositoryRoot,
    runtimeRef: boundRuntimeRef,
    snapshot: initialSnapshot,
    environmentId: admission.environment_id,
    reviewIntervalMinutes: admission.review_interval_minutes,
    nowUtc: initialTime,
    leaseDurationSeconds,
  });
  const runRuntimeOperation = serialExecutor();
  const liveSessions = new Map();
  const closedNativeEvidence = new Map();
  const auditorEvidence = new Map();
  const runAuditor = serialExecutor();
  let lifecycle = null;
  let campaignState = null;

  const persist = ({expected_state_sha256, state}) => persistCampaignState({expected_state_sha256, state});
  const recordRuntimeCheckpoint = (checkpoint) => runRuntimeOperation(() => runtime.recordCheckpoint(checkpoint, {
    idempotencyKey: runtimeOperationKey("CHECKPOINT", checkpoint.checkpoint_id),
    nowUtc: checkpoint.created_at_utc,
  }));
  const tickRuntime = (snapshot, key, observedAtUtc) => runRuntimeOperation(() => runtime.runIntentRegulatorTick(snapshot, {
    idempotencyKey: runtimeOperationKey("TICK", key),
    observedAtUtc,
  }));

  const cleanupNativeSessions = async () => {
    const errors = [];
    for (const [sessionRef, evidence] of [...liveSessions.entries()]) {
      try {
        const receipt = await closeIfLive(team, evidence.session, {schema: CANONICAL_CAMPAIGN_CLOSURE_SCHEMA, status: "FAILED"});
        if (receipt !== null) closedNativeEvidence.set(sessionRef, {...evidence, closure: structuredClone(receipt), closure_sha256: receipt.receipt_sha256});
        liveSessions.delete(sessionRef);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };

  const hardStopRuntime = async (reason) => {
    const observedAtUtc = clock();
    const rosterExact = team.roster().length === 0;
    try {
      await tickRuntime(compileSnapshot(admission, {
        progressStatus: "STALLED",
        acceptanceStatus: "NONE",
        evidenceIdentityOk: rosterExact,
        rosterExact,
        hardBoundaryDetected: true,
      }), {reason, rosterExact}, observedAtUtc);
    } catch {
      // The original failure remains authoritative. A missing stop event is
      // intentionally not converted into a successful result.
    }
  };

  try {
    const continued = await tickRuntime(initialSnapshot, {admission: admission.admission_sha256}, initialTime);
    assert(continued.state.dependent_work_allowed === true && continued.state.status === "ACTIVE", "Intent Regulator did not admit dependent campaign work", "REGULATOR_ADMISSION_REQUIRED");
    const admissionCheckpoint = compileCheckpoint(admission, {
      checkpointId: stableKey("CHECKPOINT_ADMISSION", admission.admission_sha256),
      laneIndex: 0,
      step: "BOOTSTRAP_ADMITTED",
      nextAction: "CAMPAIGN_ORCHESTRATOR",
      progressStatus: "OPEN",
      meaningfulProgress: null,
      lastMeaningfulProgressAtUtc: null,
      evidenceIdentityOk: true,
      createdAtUtc: initialTime,
    });
    await recordRuntimeCheckpoint(admissionCheckpoint);

    const initialState = createParallelCampaignLifecycle({
      plan: parallelPlan,
      persist,
      clock,
    });
    lifecycle = initialState;
    campaignState = lifecycle.snapshot();
    const initialPersisted = persist({expected_state_sha256: null, state: campaignState});
    assert(initialPersisted !== false, "initial campaign state persistence was rejected", "CAMPAIGN_PERSISTENCE_REJECTED");

    const nativeWorker = async ({assignment}) => {
      const work = lookupLaneWork(laneWork, assignment);
      const request = compileNativeSessionSpawnRequest({
        teamId: admission.team_id,
        projectId: admission.project_id,
        campaignId: admission.campaign_id,
        campaignVersion: admission.campaign_version,
        role: admission.lanes.find((lane) => lane.lane_id === assignment.lane_id).native_role,
        task: work.task,
        prompt: makeNativeWorkerPrompt(assignment, work),
        sourceCommit: admission.source.commit,
        sourceTree: admission.source.tree,
        worktreeMode: admission.lanes.find((lane) => lane.lane_id === assignment.lane_id).worktree_mode,
      });
      const schedulerRequest = compileHybridSchedulerRequest({
        requestId: `SCHEDULER-${canonicalDigest({campaign: admission.campaign_id, lane: assignment.lane_id, task: request.request_sha256, started_at_utc: initialTime}).slice(0, 32).toUpperCase()}`,
        requesterId: `LANE-${canonicalDigest(assignment.lane_id).slice(0, 24).toUpperCase()}`,
        lane: `LANE_${assignment.lane_id}`,
        repositoryId: "AGENTOS_PROJECT",
        worktreeId: admission.source.worktree_id,
        candidateCommit: admission.source.commit,
        candidateTreeOrDigest: admission.source.tree,
        cleanState: true,
        resourceClass: "AGENT_BUILD",
        workingDirectoryRef: opaqueSchedulerWorktreeRef(admission.source.worktree_id),
        commandArgv: ["AGENTOS_NATIVE_SESSION_PLAN", assignment.lane_id],
        toolchainProfile: "NATIVE_SESSION_HOST",
        proofClass: "AGENT_SESSION",
        whyNeeded: "EXECUTE_ADMITTED_LANE",
        expectedProof: "MEANINGFUL_TYPED_HANDOFF",
        coverage: [`LANE_${assignment.lane_id}`],
        timeoutClass: "PROGRESS_WINDOW",
        cachePolicy: "NONE",
        secretPolicy: "REDACTED",
      });
      const scheduled = await buildScheduler.run({
        request: schedulerRequest,
        admission: {
          effectiveArgv: schedulerRequest.command_argv,
          workingDirectoryRef: schedulerRequest.working_directory_ref,
          allowedScope: ["NATIVE_SESSION"],
          dependencyPreflight: () => ({status: "READY", identity: `DEPENDENCY_${schedulerRequest.request_sha256.slice(0, 24).toUpperCase()}`}),
          runtimePreflight: () => ({status: "READY", identity: `RUNTIME_${schedulerRequest.request_sha256.slice(0, 24).toUpperCase()}`}),
        },
        resolveCandidate: () => ({commit: admission.source.commit, tree: admission.source.tree}),
        execute: async () => {
          let session = null;
          try {
            const spawned = await team.spawn(request);
            assert(spawned.status === "THREAD_BOUND" && spawned.session !== null, "native worker did not return a bound session", "NATIVE_SESSION_BINDING_REQUIRED");
            session = spawned.session;
            const pinned = await team.pin(session);
            session = pinned.session;
            await team.send(session, makeNativeWorkerPrompt(assignment, work));
            await team.wait(session, admission.progress_window_minutes * 60 * 1000);
            const observed = await team.readback(session);
            const progress = validateNativeProgress(hostReadbackFromOperation(observed).progress, {session, request, admission});
            const sessionRef = opaqueSessionRef({kind: "worker", request_sha256: request.request_sha256, session_sha256: session.session_sha256});
            liveSessions.set(sessionRef, {request, session, native_role: request.role});
            return {
              session_ref: sessionRef,
              progress: {
                result_type: progress.result_type,
                summary: progress.summary,
                artifact_sha256: progress.artifact_sha256,
                evidence_sha256: progress.evidence_sha256,
              },
            };
          } catch (error) {
            if (session !== null) {
              try { await closeIfLive(team, session, {schema: CANONICAL_CAMPAIGN_CLOSURE_SCHEMA, status: "FAILED"}); } catch { /* preserve the native failure */ }
            }
            throw error;
          }
        },
      });
      return scheduled.output;
    };

    const auditHandoff = async ({worker, handoff}) => runAuditor(async () => {
      const candidateSnapshot = compileSnapshot(admission, {progressStatus: "PROGRESS_RECORDED", acceptanceStatus: "CANDIDATE"});
      await tickRuntime(candidateSnapshot, {candidate: worker.worker_ref, handoff: handoff.handoff_sha256}, clock());
      const candidateCheckpoint = compileCheckpoint(admission, {
        checkpointId: stableKey("CHECKPOINT_CANDIDATE", handoff.handoff_sha256),
        laneIndex: parallelPlan.lanes.findIndex((lane) => lane.lane_id === worker.lane_id),
        step: `LANE_${worker.lane_id}_HANDOFF`,
        nextAction: "INDEPENDENT_AUDITOR",
        progressStatus: "PROGRESS_RECORDED",
        meaningfulProgress: meaningfulProgressFromHandoff(handoff),
        lastMeaningfulProgressAtUtc: handoff.observed_at_utc,
        evidenceIdentityOk: true,
        createdAtUtc: clock(),
      });
      await recordRuntimeCheckpoint(candidateCheckpoint);

      const request = compileNativeSessionSpawnRequest({
        teamId: admission.team_id,
        projectId: admission.project_id,
        campaignId: admission.campaign_id,
        campaignVersion: admission.campaign_version,
        role: admission.auditor_role,
        task: `Independently audit handoff ${handoff.handoff_sha256}.`,
        prompt: makeNativeAuditorPrompt(worker, handoff),
        sourceCommit: admission.source.commit,
        sourceTree: admission.source.tree,
        worktreeMode: "PROJECT_LOCAL_SESSION",
      });
      const auditorSchedulerRequest = compileHybridSchedulerRequest({
        requestId: `AUDITOR-${canonicalDigest({campaign: admission.campaign_id, lane: worker.lane_id, handoff: handoff.handoff_sha256, started_at_utc: clock()}).slice(0, 32).toUpperCase()}`,
        requesterId: `AUDITOR-${canonicalDigest(worker.lane_id).slice(0, 24).toUpperCase()}`,
        lane: `AUDITOR_${worker.lane_id}`,
        repositoryId: "AGENTOS_PROJECT",
        worktreeId: admission.source.worktree_id,
        candidateCommit: admission.source.commit,
        candidateTreeOrDigest: admission.source.tree,
        cleanState: true,
        resourceClass: "AGENT_BUILD",
        workingDirectoryRef: opaqueSchedulerWorktreeRef(admission.source.worktree_id),
        commandArgv: ["AGENTOS_NATIVE_AUDIT", worker.lane_id],
        toolchainProfile: "NATIVE_SESSION_HOST",
        proofClass: "AGENT_SESSION",
        whyNeeded: "AUDIT_ADMITTED_NATIVE_HANDOFF",
        expectedProof: "NATIVE_TYPED_AUDIT",
        coverage: [`CAMPAIGN_${admission.campaign_id}`, `LANE_${worker.lane_id}`].sort(),
        timeoutClass: "PROGRESS_WINDOW",
        cachePolicy: "NONE",
        secretPolicy: "REDACTED",
      });
      const scheduledAudit = await buildScheduler.run({
        request: auditorSchedulerRequest,
        admission: {
          effectiveArgv: auditorSchedulerRequest.command_argv,
          workingDirectoryRef: auditorSchedulerRequest.working_directory_ref,
          allowedScope: ["NATIVE_SESSION"],
          dependencyPreflight: () => ({status: "READY", identity: `DEPENDENCY_${auditorSchedulerRequest.request_sha256.slice(0, 24).toUpperCase()}`}),
          runtimePreflight: () => ({status: "READY", identity: `RUNTIME_${auditorSchedulerRequest.request_sha256.slice(0, 24).toUpperCase()}`}),
        },
        resolveCandidate: () => ({commit: admission.source.commit, tree: admission.source.tree}),
        execute: async () => {
          let session = null;
          let sessionRef = null;
          try {
            const spawned = await team.spawn(request);
            assert(spawned.status === "THREAD_BOUND" && spawned.session !== null, "native Auditor did not return a bound session", "NATIVE_SESSION_BINDING_REQUIRED");
            session = spawned.session;
            const pinned = await team.pin(session);
            session = pinned.session;
            await team.send(session, makeNativeAuditorPrompt(worker, handoff));
            await team.wait(session, admission.progress_window_minutes * 60 * 1000);
            const observed = await team.readback(session);
            const audit = validateNativeAudit(hostReadbackFromOperation(observed).audit, {session, request, handoff, admission});
            sessionRef = opaqueSessionRef({kind: "auditor", request_sha256: request.request_sha256, session_sha256: session.session_sha256});
            const auditorRef = `opaque:auditor:${canonicalDigest({audit_sha256: audit.audit_sha256, session_ref: sessionRef})}`;
            const receipt = await closeIfLive(team, session, {schema: handoff.schema, status: "AUDIT_HANDOFF_CLOSED"});
            assert(receipt !== null, "native Auditor did not produce a closure receipt", "NATIVE_SESSION_CLOSURE_REQUIRED");
            auditorEvidence.set(sessionRef, {request_sha256: request.request_sha256, session_sha256: session.session_sha256, closure: structuredClone(receipt), closure_sha256: receipt.receipt_sha256});
            const acceptedSnapshot = compileSnapshot(admission, {progressStatus: "PROGRESS_RECORDED", acceptanceStatus: audit.accepted ? "ACCEPTED" : "CANDIDATE", evidenceIdentityOk: audit.accepted, rosterExact: team.roster().length === 1});
            await tickRuntime(acceptedSnapshot, {accepted: worker.worker_ref, audit: audit.audit_sha256}, clock());
            const acceptedCheckpoint = compileCheckpoint(admission, {
              checkpointId: stableKey(audit.accepted ? "CHECKPOINT_ACCEPTED" : "CHECKPOINT_REJECTED", audit.audit_sha256),
              laneIndex: parallelPlan.lanes.findIndex((lane) => lane.lane_id === worker.lane_id),
              step: `LANE_${worker.lane_id}_${audit.accepted ? "ACCEPTED" : "REJECTED"}`,
              nextAction: audit.accepted ? "CAMPAIGN_ORCHESTRATOR" : "OWNER_REVIEW",
              progressStatus: "PROGRESS_RECORDED",
              meaningfulProgress: meaningfulProgressFromHandoff(handoff),
              lastMeaningfulProgressAtUtc: handoff.observed_at_utc,
              evidenceIdentityOk: audit.accepted,
              createdAtUtc: clock(),
            });
            if (audit.accepted) await recordRuntimeCheckpoint(acceptedCheckpoint);
            else await hardStopRuntime({worker: worker.worker_ref, audit: audit.audit_sha256});

            const workerEvidence = liveSessions.get(worker.session_ref);
            assert(workerEvidence !== undefined, "worker native session is not retained for typed closure", "NATIVE_SESSION_CLOSURE_REQUIRED");
            const workerReceipt = await closeIfLive(team, workerEvidence.session, {schema: handoff.schema, status: "WORKER_HANDOFF_CLOSED"});
            assert(workerReceipt !== null, "native worker did not produce a closure receipt", "NATIVE_SESSION_CLOSURE_REQUIRED");
            closedNativeEvidence.set(worker.session_ref, {...workerEvidence, closure: structuredClone(workerReceipt), closure_sha256: workerReceipt.receipt_sha256});
            liveSessions.delete(worker.session_ref);
            return {
              auditor_ref: auditorRef,
              auditor_session_ref: sessionRef,
              accepted: audit.accepted,
              evidence_sha256: audit.evidence_sha256,
            };
          } catch (error) {
            if (session !== null) {
              try { await closeIfLive(team, session, {schema: CANONICAL_CAMPAIGN_CLOSURE_SCHEMA, status: "FAILED"}); } catch { /* preserve the native failure */ }
            }
            throw error;
          }
        },
      });
      return scheduledAudit.output;
    });

    campaignState = await lifecycle.run({executeWorker: nativeWorker, auditHandoff});
    await runAuditor(() => Promise.resolve());
    if (campaignState.status === "BLOCKED") {
      const cleanupErrors = await cleanupNativeSessions();
      await hardStopRuntime({campaign: campaignState.state_sha256, cleanup_errors: cleanupErrors.length});
      campaignState = lifecycle.snapshot();
      const blocked = compileResult({
        status: "BLOCKED",
        admission,
        runtimeResult: runtimeResult(runtime, boundRuntimeRef),
        workers: campaignState.workers.map((worker) => workerEvidenceRecord(worker, closedNativeEvidence, auditorEvidence)),
        acceptance: {status: "NOT_REACHED", accepted_worker_count: campaignState.workers.filter((worker) => worker.audit?.accepted === true).length, final_evidence_sha256: null},
        delivery: blockedDelivery(admission),
        closure: null,
      });
      return blocked;
    }
    assert(campaignState.status === "CLOSED", "parallel campaign did not reach exact closure", "CAMPAIGN_CLOSURE_REQUIRED");
    assert(team.roster().length === 0 && liveSessions.size === 0, "native session roster is not empty at campaign closure", "NATIVE_SESSION_ROSTER_LEAK");
    const lastWorker = campaignState.workers.at(-1);
    const finalCheckpoint = compileCheckpoint(admission, {
      checkpointId: stableKey("CHECKPOINT_CLOSED", campaignState.state_sha256),
      laneIndex: campaignState.workers.length,
      step: "CAMPAIGN_CLOSED",
      nextAction: "COMPLETE",
      progressStatus: "CLOSED",
      meaningfulProgress: meaningfulProgressFromHandoff(lastWorker?.handoff ?? null),
      lastMeaningfulProgressAtUtc: lastWorker?.handoff?.observed_at_utc ?? campaignState.closed_at_utc,
      evidenceIdentityOk: true,
      createdAtUtc: campaignState.closed_at_utc,
    });
    const finalRuntime = await recordRuntimeCheckpoint(finalCheckpoint);
    const finalRuntimeState = finalRuntime.state;
    assert(finalRuntimeState.status === "CLOSED", "persistent Runtime did not reach exact closure", "RUNTIME_CLOSURE_REQUIRED");
    const acceptanceDigest = finalAcceptanceDigest(campaignState);
    const delivery = {
      status: "COMPLETE",
      owner_choice: admission.delivery.owner_choice,
      policy_sha256: admission.delivery.policy_sha256,
      result: "REVIEW_READY",
      result_sha256: canonicalDigest({status: "COMPLETE", owner_choice: admission.delivery.owner_choice, policy_sha256: admission.delivery.policy_sha256, result: "REVIEW_READY", campaign_state_sha256: campaignState.state_sha256, final_acceptance_sha256: acceptanceDigest}),
    };
    const universalCloseoutReceipts = compileCanonicalCampaignUniversalCloseoutReceipts({
      admission,
      campaignState,
      closedNativeEvidence,
      auditorEvidence,
      acceptanceDigest,
      closedAtUtc: campaignState.closed_at_utc,
    });
    const closure = buildClosedClosure({
      admission,
      campaignState,
      runtimeState: finalRuntimeState,
      runtimeCheckpoint: finalRuntime.checkpoint,
      acceptanceDigest,
      delivery,
      closedAtUtc: campaignState.closed_at_utc,
      universalCloseoutReceipts,
    });
    return compileResult({
      status: "CLOSED",
      admission,
      runtimeResult: {
        runtime_ref: boundRuntimeRef,
        status: finalRuntimeState.status,
        state_sha256: finalRuntimeState.state_sha256,
        checkpoint_sha256: finalRuntimeState.checkpoint_sha256,
        event_cursor: finalRuntimeState.event_cursor,
        roles_sha256: finalRuntimeState.persistent_roles_sha256,
      },
      workers: campaignState.workers.map((worker) => workerEvidenceRecord(worker, closedNativeEvidence, auditorEvidence)),
      acceptance: {status: "ACCEPTED", accepted_worker_count: campaignState.workers.length, final_evidence_sha256: acceptanceDigest},
      delivery,
      closure,
    });
  } catch (error) {
    const cleanupErrors = await cleanupNativeSessions();
    if (runtime.readState().status !== "CLOSED") await hardStopRuntime({error_code: error?.code ?? "CANONICAL_CAMPAIGN_FAILURE", cleanup_errors: cleanupErrors.length});
    campaignState = lifecycle?.snapshot?.() ?? campaignState;
    if (campaignState?.status === "BLOCKED") {
      return compileResult({
        status: "BLOCKED",
        admission,
        runtimeResult: runtimeResult(runtime, boundRuntimeRef),
        workers: campaignState.workers.map((worker) => workerEvidenceRecord(worker, closedNativeEvidence, auditorEvidence)),
        acceptance: {status: "NOT_REACHED", accepted_worker_count: campaignState.workers.filter((worker) => worker.audit?.accepted === true).length, final_evidence_sha256: null},
        delivery: blockedDelivery(admission),
        closure: null,
      });
    }
    throw error;
  } finally {
    runtime.close({nowUtc: clock()});
  }
}

export function inspectCanonicalCampaignRuntime({authorityRoot, repositoryRoot = process.cwd()} = {}) {
  return inspectPersistentIntentRuntime({authorityRoot, repositoryRoot});
}
