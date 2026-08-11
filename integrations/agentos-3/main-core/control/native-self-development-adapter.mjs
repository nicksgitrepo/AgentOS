#!/usr/bin/env node

/*
 * Native Controller adapter for AgentOS's own development campaign.
 *
 * This is the replacement for the local child-process adapter. It creates
 * real native sessions through the external host bridge, keeps the session
 * records in memory until they are durably handed off, and performs the
 * complete preserve -> unpin -> archive -> roster-removal lifecycle.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import path from "node:path";
import {compileControllerAdapterReadback} from "./agentos-controller.mjs";
import {
  compileNativeSessionSpawnRequest,
  createNativeSessionTeam,
} from "./native-session-team.mjs";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";

const NATIVE_WORKER_READBACK_SCHEMA = "agentos.native_controller_worker_readback.v1";
const DEFAULT_PROGRESS_WINDOW_MINUTES = 15;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function versionedDisplayName(base, campaignVersion) {
  return `${base} ${campaignVersion}`;
}

function workerReadback({request, session, observedAtUtc, progressWindowMinutes, status = "ACTIVE"}) {
  const readback = {
    schema: NATIVE_WORKER_READBACK_SCHEMA,
    version: 1,
    status,
    role: request.role,
    display_name: request.display_name,
    session_id: session.thread_id,
    host_id: session.host_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    source_commit: request.source_commit,
    source_tree: request.source_tree,
    worktree_ref: session.worktree_path,
    progress_window_minutes: progressWindowMinutes,
    meaningful_progress: false,
    progress_sha256: null,
    handoff_sha256: null,
    pinned: session.pinned,
    archived: session.archived,
    active: session.active,
    protected_actions: {
      published: false,
      pushed: false,
      merged: false,
      deployed: false,
      revealed_secrets: false,
      product_writes: false,
    },
    observed_at_utc: observedAtUtc,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  return readback;
}

function sessionIdFromPayload(payload, label) {
  requireRecord(payload, `${label} payload`);
  const sessionId = payload.session_id ?? payload.thread_id;
  requireString(sessionId, `${label} session ID`);
  return sessionId;
}

function summarizeHostRoster(readback) {
  requireRecord(readback, "native host roster readback");
  const authoritative = Array.isArray(readback.active_roster)
    ? readback.active_roster
    : Array.isArray(readback.activeRoster)
      ? readback.activeRoster
      : Array.isArray(readback.threads)
        ? readback.threads
        : Array.isArray(readback.active_sessions)
          ? readback.active_sessions
          : null;
  assert(authoritative !== null, "native host roster readback is not authoritative");
  return authoritative.map((entry, index) => {
    requireRecord(entry, `native host roster entry ${index}`);
    const threadId = entry.thread_id ?? entry.threadId;
    const hostId = entry.host_id ?? entry.hostId;
    requireString(threadId, `native host roster entry ${index} thread ID`);
    requireString(hostId, `native host roster entry ${index} host ID`);
    return {
      thread_id: threadId,
      host_id: hostId,
      project_id: entry.project_id ?? entry.projectId ?? null,
      campaign_id: entry.campaign_id ?? entry.campaignId ?? null,
      campaign_version: entry.campaign_version ?? entry.campaignVersion ?? null,
      role: entry.role ?? null,
      lane_id: entry.lane_id ?? entry.laneId ?? entry.role ?? null,
      active: entry.active ?? null,
      pinned: entry.pinned ?? null,
      archived: entry.archived ?? null,
    };
  }).sort((left, right) => compareUtf8(`${left.thread_id}\u0000${left.host_id}`, `${right.thread_id}\u0000${right.host_id}`));
}

function nativeWorkerPrompt({role, campaignVersion, task, scope, predecessor = null}) {
  const predecessorText = predecessor === null ? "" : ` Your predecessor session is ${predecessor}; inspect its retained handoff before acting.`;
  return [
    `You are the ${role} for ${campaignVersion}.`,
    "Work as a real project worker in the AgentOS work repository, not as a documentation-only simulator.",
    "Follow the supplied task gates line by line. Ask YES, NO, UNKNOWN, or NOT_APPLICABLE for every applicable gate and retain evidence for every answer.",
    `Your bounded scope is: ${scope}.`,
    `Task: ${task}.`,
    "Do not create child agents, do not use a shell substitute, do not publish, push, merge, deploy, reveal secrets, or write outside the admitted scope.",
    "Submit every heavyweight build, compile, test, verification, database, runtime, or artifact operation as one typed candidate-level plan to the shared AgentOS Hybrid Scheduler; never run competing heavyweight operations directly.",
    "Return meaningful progress within 15 minutes, then a typed handoff with changed paths, source identity, evidence, unresolved findings, and the exact next action.",
    predecessorText,
  ].join(" ");
}

export function createNativeSelfDevelopmentAdapters({
  host,
  hostAttachment,
  authorization,
  admission,
  candidate,
  identityBinding,
  projectBinding = null,
  now = () => new Date().toISOString(),
  progressWindowMinutes = DEFAULT_PROGRESS_WINDOW_MINUTES,
  featureLanes = null,
  schedulerRoot = null,
  schedulerPolicy = null,
} = {}) {
  requireRecord(authorization, "native self-development authorization");
  requireRecord(admission, "native self-development admission");
  requireRecord(candidate, "native self-development candidate");
  requireRecord(identityBinding, "native self-development identity binding");
  requireString(candidate.project_id, "native self-development project");
  requireString(candidate.campaign_id, "native self-development campaign");
  requireString(candidate.campaign_version, "native self-development campaign version");
  assert(Number.isSafeInteger(progressWindowMinutes) && progressWindowMinutes >= 1, "native progress window is invalid");
  const teamId = `TEAM-${candidate.campaign_id}`;
  const team = createNativeSessionTeam({
    host,
    hostAttachment,
    projectId: candidate.project_id,
    teamId,
    campaignId: candidate.campaign_id,
    campaignVersion: candidate.campaign_version,
    model: hostAttachment.model,
    reasoningEffort: hostAttachment.reasoning_effort,
    projectBinding,
    acceptRequestedIdentityWithoutReadback: true,
    now,
  });
  assert(typeof schedulerRoot === "string" && schedulerRoot.length > 0, "native self-development requires an explicit file-backed scheduler authority root");
  assert(path.isAbsolute(schedulerRoot), "native self-development scheduler authority root must be absolute");
  const buildScheduler = createHybridScheduler({
    authorityRoot: schedulerRoot,
    policy: schedulerPolicy ?? undefined,
    clock: now,
  });
  const sessions = new Map();

  const nativeReadback = ({context, details, externalIdentity, observedAtUtc = now(), status = "SUCCESS"}) => compileControllerAdapterReadback({
    operation: context.operation,
    actionId: context.action_id,
    eventId: context.event.event_id,
    controllerId: context.controller_state.logical_controller_id,
    projectId: context.controller_state.project_id,
    policyEpoch: context.controller_state.policy_epoch,
    policyStateSha256: context.controller_state.policy_state_sha256,
    campaignId: candidate.campaign_id,
    externalIdentity,
    status,
    observedAtUtc,
    details,
  });

  const spawn = async (context, {role, baseDisplayName, task, scope, predecessor = null}) => {
    const request = compileNativeSessionSpawnRequest({
      teamId,
      projectId: candidate.project_id,
      campaignId: candidate.campaign_id,
      campaignVersion: candidate.campaign_version,
      role,
      displayName: versionedDisplayName(baseDisplayName, candidate.campaign_version),
      task,
      prompt: nativeWorkerPrompt({role: baseDisplayName, campaignVersion: candidate.campaign_version, task, scope, predecessor}),
      sourceCommit: candidate.source_commit,
      sourceTree: candidate.source_tree,
      worktreeMode: "ISOLATED_WORKTREE",
      model: hostAttachment.model,
      reasoningEffort: hostAttachment.reasoning_effort,
    });
    const schedulerRequest = compileHybridSchedulerRequest({
      requestId: `NATIVE-${canonicalDigest({campaign: candidate.campaign_id, role, task, predecessor, started_at_utc: now()}).slice(0, 32).toUpperCase()}`,
      requesterId: `ROLE-${canonicalDigest(role).slice(0, 24).toUpperCase()}`,
      lane: `ROLE_${role}`,
      repositoryId: "AGENTOS_PROJECT",
      worktreeId: `WORKTREE-${candidate.candidate_sha256.slice(0, 24).toUpperCase()}`,
      candidateCommit: candidate.source_commit,
      candidateTreeOrDigest: candidate.source_tree,
      cleanState: true,
      resourceClass: "AGENT_BUILD",
      workingDirectoryRef: opaqueSchedulerWorktreeRef(candidate.candidate_sha256),
      commandArgv: ["AGENTOS_NATIVE_SESSION_PLAN", role],
      toolchainProfile: "NATIVE_SESSION_HOST",
      proofClass: "AGENT_SESSION",
      whyNeeded: "SPAWN_ADMITTED_NATIVE_SESSION",
      expectedProof: "NATIVE_TYPED_HANDOFF",
      coverage: [`CAMPAIGN_${candidate.campaign_id}`, `ROLE_${role}`].sort(),
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
      resolveCandidate: () => ({commit: candidate.source_commit, tree: candidate.source_tree}),
      execute: async () => {
        let session = null;
        try {
          const created = await team.spawn(request, {predecessor: predecessor === null ? null : sessions.get(predecessor)?.session ?? null});
          assert(created.status === "THREAD_BOUND" && created.session !== null, `${role} native session did not bind immediately`);
          session = created.session;
          const pinned = await team.pin(session);
          session = pinned.session;
          await team.send(session, request.prompt);
          const readback = workerReadback({request, session, observedAtUtc: now(), progressWindowMinutes});
          sessions.set(session.thread_id, {request, session, readback, task, scope});
          return nativeReadback({
            context,
            externalIdentity: `NATIVE_THREAD:${session.thread_id}`,
            observedAtUtc: readback.observed_at_utc,
            details: {
              session_id: session.thread_id,
              worker_readback: readback,
              native_session: session,
            },
          });
        } catch (error) {
          if (session !== null) {
            try {
              await team.close(session, {
                schema: "agentos.native_campaign_worker_handoff.v1",
                status: "FAILED",
                result: "native scheduler admission failed",
                session_id: session.thread_id,
              });
            } catch {
              // Preserve the primary failure; the Controller's recovery path retains the session identity.
            }
          }
          throw error;
        }
      },
    });
    return scheduled.output;
  };

  const admitLocalSelfDevelopment = async (context) => {
    assert(context.payload.authorization.authorization_sha256 === authorization.authorization_sha256, "native admission authorization differs");
    assert(context.payload.admission.admission_sha256 === admission.admission_sha256, "native admission record differs");
    assert(context.payload.candidate.candidate_sha256 === candidate.candidate_sha256, "native admission candidate differs");
    assert(context.payload.identity_binding.binding_sha256 === identityBinding.binding_sha256, "native admission identity differs");
    return nativeReadback({
      context,
      externalIdentity: `NATIVE_ADMISSION:${admission.admission_sha256.slice(0, 16)}`,
      details: {
        status: "CAMPAIGN_ADMITTED",
        admission_sha256: admission.admission_sha256,
        authorization_sha256: authorization.authorization_sha256,
        candidate_sha256: candidate.candidate_sha256,
        identity_binding_sha256: identityBinding.binding_sha256,
      },
    });
  };

  const spawnCampaignOrchestrator = (context) => spawn(context, {
    role: "CAMPAIGN_ORCHESTRATOR",
    baseDisplayName: "Campaign Orchestrator",
    task: "Own the campaign workflow. Route admitted lane work, request real progress, preserve handoffs, and never claim a worker result as your own.",
    scope: "campaign routing, dependency order, timers, handoffs, and recovery",
  });

  const lanes = Array.isArray(featureLanes) && featureLanes.length > 0
    ? featureLanes
    : [{role: "FEATURE_AGENT", displayName: "Feature Agent", task: "Build the next admitted AgentOS feature slice with real code and source-bound evidence.", scope: "the current admitted AgentOS feature slice"}];
  // The legacy self-development Controller state has one FEATURE_AGENT role.
  // Parallel lane campaigns use runCanonicalCampaign and its dynamic admission
  // manifest; silently stuffing several sessions into this older state would
  // make the durable roster lie about custody.
  assert(lanes.length === 1, "native self-development Controller adapter accepts one feature role; use the dynamic campaign admission for parallel lanes");

  const spawnFeatureAgents = async (context) => {
    const results = [];
    for (const lane of lanes) {
      const result = await spawn(context, {
        role: lane.role ?? "FEATURE_AGENT",
        baseDisplayName: lane.displayName ?? "Feature Agent",
        task: lane.task ?? "Build the next admitted AgentOS feature slice with real code and source-bound evidence.",
        scope: lane.scope ?? "the current admitted AgentOS feature slice",
      });
      results.push(result.details);
    }
    const workerReadbacks = results.map((details) => details.worker_readback);
    return nativeReadback({
      context,
      externalIdentity: `NATIVE_FEATURE_ROSTER:${canonicalDigest(workerReadbacks).slice(0, 16)}`,
      details: {
        session_id: workerReadbacks[0].session_id,
        worker_readback: workerReadbacks[0],
        feature_agent_session_ids: workerReadbacks.map((value) => value.session_id).sort(compareUtf8),
        worker_readbacks: workerReadbacks.sort((left, right) => compareUtf8(left.session_id, right.session_id)),
      },
    });
  };

  const spawnIndependentAuditor = (context) => {
    const featureSession = [...sessions.values()].find((entry) => entry.request.role === "FEATURE_AGENT");
    return spawn(context, {
      role: "INDEPENDENT_AUDITOR",
      baseDisplayName: "Independent Auditor",
      task: "Audit the live Feature Agent work, its changed tree, gate answers, source identity, privacy, and handoff. Return a finding, not a generic status.",
      scope: featureSession === undefined ? "the admitted campaign source" : `the Feature Agent session ${featureSession.session.thread_id} and its bounded changed tree`,
      predecessor: featureSession?.session.thread_id ?? null,
    });
  };

  const archiveCampaignAgents = async (context) => {
    const requested = Array.isArray(context.payload.spawned_session_ids) ? context.payload.spawned_session_ids : [...sessions.keys()];
    const archived = [];
    for (const sessionId of [...new Set(requested)].sort(compareUtf8)) {
      const entry = sessions.get(sessionId);
      if (entry === undefined) continue;
      const handoff = {
        schema: "agentos.native_campaign_worker_handoff.v1",
        status: "FAILED",
        result: "campaign spawn rollback",
        session_id: sessionId,
      };
      await team.close(entry.session, handoff);
      archived.push(sessionId);
      sessions.delete(sessionId);
    }
    return nativeReadback({
      context,
      externalIdentity: `NATIVE_CLEANUP:${canonicalDigest(archived).slice(0, 16)}`,
      details: {archived_session_ids: archived, active_roster: team.roster().map((value) => value.thread_id).sort(compareUtf8)},
    });
  };

  const reconcileLiveness = async (context) => {
    const rawRoster = await host.list_threads({
      projectId: candidate.project_id,
      campaignId: candidate.campaign_id,
      campaignVersion: candidate.campaign_version,
      teamId,
      rosterScope: "ACTIVE_CAMPAIGN",
    });
    const roster = summarizeHostRoster(rawRoster);
    const localRoster = team.roster();
    for (const [index, entry] of roster.entries()) {
      assert(entry.project_id === candidate.project_id, `native host roster entry ${index} is bound to another project`);
      assert(entry.campaign_id === candidate.campaign_id, `native host roster entry ${index} is bound to another campaign`);
      assert(entry.campaign_version === candidate.campaign_version, `native host roster entry ${index} is bound to another campaign version`);
      requireString(entry.role, `native host roster entry ${index} role`);
      requireString(entry.lane_id, `native host roster entry ${index} lane ID`);
      assert(entry.active !== false && entry.archived !== true, `native host roster entry ${index} is not active`);
    }
    const localKeys = localRoster.map((entry) => `${entry.thread_id}\u0000${entry.host_id}\u0000${entry.role}`).sort(compareUtf8);
    const hostKeys = roster.map((entry) => `${entry.thread_id}\u0000${entry.host_id}\u0000${entry.role}`).sort(compareUtf8);
    const localUnique = new Set(localKeys).size === localKeys.length;
    const hostUnique = new Set(hostKeys).size === hostKeys.length;
    const exact = localUnique
      && hostUnique
      && localKeys.length === hostKeys.length
      && JSON.stringify(localKeys) === JSON.stringify(hostKeys)
      && localRoster.length === sessions.size;
    assert(exact, "native host roster does not exactly match the bound campaign roster");
    return nativeReadback({
      context,
      externalIdentity: `NATIVE_ROSTER:${canonicalDigest(roster).slice(0, 16)}`,
      details: {active_session_ids: [...sessions.keys()].sort(compareUtf8), host_roster: roster, exact, roster_sha256: canonicalDigest(roster)},
    });
  };

  const readWorker = async (sessionId, timeoutMs = progressWindowMinutes * 60 * 1000) => {
    const entry = sessions.get(sessionId);
    assert(entry !== undefined, `unknown native worker session ${sessionId}`);
    await team.wait(entry.session, timeoutMs);
    const observed = await team.readback(entry.session);
    return {entry: structuredClone(entry), observed};
  };

  const closeWorker = async (sessionId, handoff) => {
    const entry = sessions.get(sessionId);
    assert(entry !== undefined, `unknown native worker session ${sessionId}`);
    const receipt = await team.close(entry.session, handoff);
    sessions.delete(sessionId);
    return receipt;
  };

  return Object.freeze({
    admitLocalSelfDevelopment,
    spawnCampaignOrchestrator,
    spawnFeatureAgents,
    spawnIndependentAuditor,
    archiveCampaignAgents,
    reconcileLiveness,
    readWorker,
    closeWorker,
    team,
    sessions,
  });
}

export {NATIVE_WORKER_READBACK_SCHEMA};
