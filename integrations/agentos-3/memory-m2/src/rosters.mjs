import { canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

export const ROSTERS = Object.freeze(["permanent", "seed", "live"]);

const TRANSITIONS = Object.freeze({
  permanent: {
    STARTING: ["READY", "STATUS_UNKNOWN"],
    READY: ["ACTIVE", "WAITING", "RETIRED", "STATUS_UNKNOWN"],
    ACTIVE: ["WAITING", "DEGRADED", "DRAINING_FOR_ROLLOVER", "STATUS_UNKNOWN"],
    WAITING: ["ACTIVE", "DEGRADED", "RETIRED", "STATUS_UNKNOWN"],
    DEGRADED: ["RECOVERING", "RETIRED", "QUARANTINED"],
    RECOVERING: ["READY", "DEGRADED", "QUARANTINED"],
    DRAINING_FOR_ROLLOVER: ["RECOVERING", "QUARANTINED"],
    STATUS_UNKNOWN: ["RECOVERY_CHECK", "QUARANTINED"],
    RECOVERY_CHECK: ["READY", "ACTIVE", "WAITING", "QUARANTINED"],
    RETIRED: [],
    QUARANTINED: []
  },
  seed: {
    BOOTSTRAPPING: ["READY_DORMANT", "CONFLICT", "STATUS_UNKNOWN"],
    READY_DORMANT: ["SYNC_PENDING", "REBUILD_REQUIRED", "RETIRED", "STATUS_UNKNOWN"],
    SYNC_PENDING: ["SYNCING", "CONFLICT", "STATUS_UNKNOWN"],
    SYNCING: ["READY_DORMANT", "CONFLICT", "STATUS_UNKNOWN"],
    CONFLICT: ["REBUILD_REQUIRED", "RETIRED", "QUARANTINED"],
    REBUILD_REQUIRED: ["REBUILDING", "RETIRED"],
    REBUILDING: ["READY_DORMANT", "CONFLICT", "STATUS_UNKNOWN"],
    STATUS_UNKNOWN: ["RECOVERY_CHECK", "QUARANTINED"],
    RECOVERY_CHECK: ["BOOTSTRAPPING", "READY_DORMANT", "SYNC_PENDING", "SYNCING", "REBUILDING", "QUARANTINED"],
    RETIRED: [],
    QUARANTINED: []
  },
  live: {
    PROVISIONING: ["READY", "QUARANTINED", "STATUS_UNKNOWN"],
    READY: ["ACTIVE", "DRAINING", "QUARANTINED", "STATUS_UNKNOWN"],
    ACTIVE: ["BLOCKED", "WAITING_FOR_ORCHESTRATOR", "CHECKPOINTING", "MODEL_HANDOFF", "DRAINING", "STATUS_UNKNOWN"],
    BLOCKED: ["ACTIVE", "WAITING_FOR_ORCHESTRATOR", "DRAINING", "STATUS_UNKNOWN"],
    WAITING_FOR_ORCHESTRATOR: ["ACTIVE", "BLOCKED", "DRAINING", "STATUS_UNKNOWN"],
    CHECKPOINTING: ["ACTIVE", "DRAINING", "STATUS_UNKNOWN"],
    MODEL_HANDOFF: ["ACTIVE", "DRAINING", "QUARANTINED", "STATUS_UNKNOWN"],
    DRAINING: ["DESPAWN_REVIEW", "QUARANTINED", "STATUS_UNKNOWN"],
    DESPAWN_REVIEW: ["ACTIVE", "TRANSFER_PENDING", "QUARANTINED", "ARCHIVED"],
    TRANSFER_PENDING: ["ARCHIVED", "QUARANTINED"],
    STATUS_UNKNOWN: ["RECOVERY_CHECK", "QUARANTINED"],
    RECOVERY_CHECK: ["PROVISIONING", "READY", "ACTIVE", "BLOCKED", "WAITING_FOR_ORCHESTRATOR", "CHECKPOINTING", "MODEL_HANDOFF", "DRAINING", "ARCHIVED", "QUARANTINED"],
    ARCHIVED: [],
    QUARANTINED: []
  }
});

const INITIAL = Object.freeze({ permanent: "STARTING", seed: "BOOTSTRAPPING", live: "PROVISIONING" });
const TERMINAL = new Set(["ARCHIVED", "RETIRED", "QUARANTINED"]);
const LEASED = new Set(["ACTIVE", "WAITING", "READY_DORMANT", "SYNCING", "BLOCKED", "WAITING_FOR_ORCHESTRATOR", "CHECKPOINTING", "MODEL_HANDOFF", "DRAINING"]);
const LOGICAL_REF = /^(session|worktree|tmp|checkpoint|capsule|campaign|goal|governance):\/\/[a-z0-9][a-z0-9._/-]{0,180}$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;

function actorRole(actor) {
  invariant(typeof actor === "string" && actor.length > 0, "INVALID_ACTOR", "actor is required");
  return actor.includes(":") ? actor.slice(0, actor.indexOf(":")) : actor.includes(".") ? actor.slice(0, actor.indexOf(".")) : actor;
}

function logicalRef(value, field, { nullable = true, schemes = null } = {}) {
  if (value === null && nullable) return;
  invariant(typeof value === "string" && LOGICAL_REF.test(value), "INVALID_LOGICAL_REF", `${field} must be a portable logical reference`);
  if (schemes) invariant(schemes.some((scheme) => value.startsWith(`${scheme}://`)), "INVALID_LOGICAL_REF", `${field} has a disallowed reference scheme`);
}

function parseTimestamp(value, field) {
  invariant(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), "INVALID_TIMESTAMP", `${field} must be UTC with milliseconds`);
  const parsed = Date.parse(value);
  invariant(Number.isFinite(parsed), "INVALID_TIMESTAMP", `${field} is not a valid timestamp`);
  return parsed;
}

function authorizeRegister(roster, actor) {
  const role = actorRole(actor);
  const allowed = roster === "live" ? ["owner", "controller", "runtime"] : ["owner", "controller"];
  invariant(allowed.includes(role), "UNAUTHORIZED", `${actor} may not register a ${roster} agent`);
}

function authorizeTransition(entry, actor, target) {
  const role = actorRole(actor);
  if (["owner", "controller"].includes(role)) return;
  if (role === "runtime" && ["READY", "READY_DORMANT", "STATUS_UNKNOWN", "RECOVERY_CHECK", "RECOVERING"].includes(target)) return;
  if (role === "maintainer" && TERMINAL.has(target)) return;
  const agentId = entry.registration?.agent_id ?? entry.agent_id;
  if (actor === `agent:${agentId}@${entry.session_epoch}` && ["ACTIVE", "BLOCKED", "WAITING", "WAITING_FOR_ORCHESTRATOR", "CHECKPOINTING", "MODEL_HANDOFF", "DRAINING"].includes(target)) return;
  invariant(false, "UNAUTHORIZED", `${actor} may not transition ${agentId} to ${target}`);
}

function authorizeRethread(actor) {
  invariant(["owner", "controller", "runtime"].includes(actorRole(actor)), "UNAUTHORIZED", `${actor} may not rethread an agent`);
}

async function verifyRethreadCheckpoint(project, checkpointRef, current) {
  invariant(typeof checkpointRef === "string" && OBJECT_REF.test(checkpointRef), "INVALID_CHECKPOINT_REF", "checkpoint_ref must be a project object reference");
  const checkpoint = await project.getJson(checkpointRef);
  invariant(checkpoint.schema === "agentos.memory.run_checkpoint.v1" && checkpoint.project_id === project.config.project_id,
    "INVALID_CHECKPOINT", "checkpoint has unsupported schema or project identity");
  invariant(checkpoint.agent_id === current.registration.agent_id && checkpoint.session_ref === current.session_ref && checkpoint.session_epoch === current.session_epoch,
    "CHECKPOINT_SESSION_MISMATCH", "checkpoint is not bound to the current agent session");
  invariant(typeof checkpoint.run_id === "string" && /^run:[a-zA-Z0-9._:-]+$/.test(checkpoint.run_id), "INVALID_CHECKPOINT", "checkpoint run_id is invalid");
  invariant(typeof checkpoint.scratch_object_ref === "string" && OBJECT_REF.test(checkpoint.scratch_object_ref), "INVALID_CHECKPOINT", "checkpoint scratch object reference is invalid");
  invariant(Number.isSafeInteger(checkpoint.byte_count) && checkpoint.byte_count >= 0, "INVALID_CHECKPOINT", "checkpoint byte_count is invalid");
  const bytes = await project.getBytes(checkpoint.scratch_object_ref);
  invariant(bytes.length === checkpoint.byte_count && sha256Ref("agentos.memory.scratch.v1", bytes) === checkpoint.scratch_digest,
    "CHECKPOINT_CONTENT_MISMATCH", "checkpoint scratch content does not match its manifest");
  const expected = {
    schema: "agentos.memory.run_checkpoint.v1",
    project_id: project.config.project_id,
    run_id: checkpoint.run_id,
    agent_id: checkpoint.agent_id,
    session_ref: checkpoint.session_ref,
    session_epoch: checkpoint.session_epoch,
    scratch_object_ref: checkpoint.scratch_object_ref,
    byte_count: checkpoint.byte_count,
    scratch_digest: checkpoint.scratch_digest,
    note: checkpoint.note ?? null
  };
  invariant(canonicalJson(checkpoint) === canonicalJson(expected), "INVALID_CHECKPOINT", "checkpoint contains unsupported fields");
  return checkpoint;
}

function validateRegistration(input, projectId) {
  invariant(input && typeof input === "object" && !Array.isArray(input), "INVALID_AGENT", "agent registration must be an object");
  invariant(ROSTERS.includes(input.roster), "INVALID_ROSTER", `roster must be one of ${ROSTERS.join(", ")}`);
  invariant(typeof input.agent_id === "string" && /^[a-z][a-z0-9._-]{2,127}$/.test(input.agent_id), "INVALID_AGENT_ID", "agent_id is invalid");
  invariant(typeof input.role_id === "string" && /^[a-z][a-z0-9._-]{1,127}$/.test(input.role_id), "INVALID_ROLE_ID", "role_id is invalid");
  const laneId = input.lane_id ?? null;
  invariant(laneId === null || /^[a-z][a-z0-9._-]{1,127}$/.test(laneId), "INVALID_LANE_ID", "lane_id is invalid");
  logicalRef(input.session_ref, "session_ref", { nullable: false, schemes: ["session"] });
  logicalRef(input.worktree_ref ?? null, "worktree_ref", { schemes: ["worktree"] });
  logicalRef(input.tmp_ref ?? null, "tmp_ref", { schemes: ["tmp"] });
  logicalRef(input.governance_ref, "governance_ref", { nullable: false, schemes: ["governance"] });
  invariant(Number.isSafeInteger(input.session_epoch ?? 1) && (input.session_epoch ?? 1) >= 1, "INVALID_SESSION_EPOCH", "session_epoch must be a positive integer");
  const parentAgentId = input.parent_agent_id ?? null;
  invariant(parentAgentId === null || /^[a-z][a-z0-9._-]{2,127}$/.test(parentAgentId), "INVALID_PARENT_AGENT", "parent_agent_id is invalid");
  invariant(input.roster !== "live" || parentAgentId !== null, "PARENT_REQUIRED", "live agents require a registered parent agent");
  return {
    schema: "agentos.memory.agent_registration.v1",
    project_id: projectId,
    agent_id: input.agent_id,
    roster: input.roster,
    role_id: input.role_id,
    lane_id: laneId,
    session_ref: input.session_ref,
    session_epoch: input.session_epoch ?? 1,
    governance_ref: input.governance_ref,
    worktree_ref: input.worktree_ref ?? null,
    tmp_ref: input.tmp_ref ?? null,
    parent_agent_id: parentAgentId,
    initial_state: INITIAL[input.roster]
  };
}

export class AgentRoster {
  constructor(project) {
    this.project = project;
  }

  async state() {
    const { events } = await this.project.verifyEvents();
    const agents = new Map();
    for (const event of events) {
      const { action, subject_ref: agentId, object_ref: objectRef, actor, sequence, metadata } = event.body;
      if (action === "AGENT_REGISTERED") {
        invariant(!agents.has(agentId), "AGENT_EXISTS", `${agentId} was registered twice`);
        const registration = await this.project.getJson(objectRef);
        const validated = validateRegistration(registration, this.project.config.project_id);
        invariant(canonicalJson(validated) === canonicalJson(registration), "INVALID_AGENT_REGISTRATION", "agent registration object is not canonical for its schema");
        invariant(registration.agent_id === agentId && registration.project_id === this.project.config.project_id, "AGENT_SUBJECT_MISMATCH", "agent registration subject mismatch");
        invariant(metadata.roster === registration.roster, "AGENT_REGISTRATION_MISMATCH", "agent registration roster does not match its event");
        authorizeRegister(registration.roster, actor);
        invariant(![...agents.values()].some((entry) => entry.session_ref === registration.session_ref && !TERMINAL.has(entry.state)),
          "SESSION_IN_USE", `${registration.session_ref} is assigned more than once in replay`);
        if (registration.parent_agent_id !== null) {
          const parent = agents.get(registration.parent_agent_id);
          invariant(parent, "UNKNOWN_PARENT_AGENT", "parent agent is not registered");
          invariant(["permanent", "live"].includes(parent.registration.roster) && !TERMINAL.has(parent.state),
            "INVALID_PARENT_AGENT", "parent agent must be an active permanent or live roster entry");
        }
        agents.set(agentId, {
          registration,
          session_ref: registration.session_ref,
          session_epoch: registration.session_epoch,
          tmp_ref: registration.tmp_ref,
          state: registration.initial_state,
          sequence,
          lease_epoch: 0,
          lease_expires_at_utc: null,
          suspended_from_status: null,
          history: [{ sequence, action, state: registration.initial_state }]
        });
      } else if (action === "AGENT_TRANSITIONED") {
        const current = agents.get(agentId);
        invariant(current, "UNKNOWN_AGENT", `${agentId} transitioned before registration`);
        const transition = await this.project.getJson(objectRef);
        invariant(transition.schema === "agentos.memory.agent_transition.v1" && transition.agent_id === agentId && transition.project_id === this.project.config.project_id,
          "AGENT_TRANSITION_MISMATCH", "agent transition object identity mismatch");
        for (const field of ["from_state", "to_state", "reason", "lease_epoch", "lease_expires_at_utc", "suspended_from_status"]) {
          invariant(transition[field] === metadata[field], "AGENT_TRANSITION_MISMATCH", `agent transition ${field} does not match its event`);
        }
        invariant(canonicalJson(transition) === canonicalJson({
          schema: "agentos.memory.agent_transition.v1",
          project_id: this.project.config.project_id,
          agent_id: agentId,
          ...metadata
        }), "AGENT_TRANSITION_MISMATCH", "agent transition object contains unsupported fields");
        invariant(metadata.from_state === current.state, "ROSTER_SOURCE_MISMATCH", `${agentId} transition source does not match replay state`);
        invariant(TRANSITIONS[current.registration.roster][current.state]?.includes(metadata.to_state), "INVALID_ROSTER_TRANSITION", `${current.state} cannot transition to ${metadata.to_state}`);
        authorizeTransition(current, actor, metadata.to_state);
        if (TERMINAL.has(metadata.to_state)) {
          invariant(![...agents.values()].some((entry) => entry.registration.parent_agent_id === agentId && !TERMINAL.has(entry.state)),
            "ACTIVE_CHILD_AGENTS", `${agentId} cannot enter a terminal state while it has active child agents`);
        }
        const expectedSuspended = metadata.to_state === "STATUS_UNKNOWN"
          ? current.state
          : current.state === "RECOVERY_CHECK" && !TERMINAL.has(metadata.to_state)
            ? null
            : current.suspended_from_status;
        invariant(metadata.suspended_from_status === expectedSuspended, "INVALID_RECOVERY_STATE",
          "transition suspended_from_status does not match replay state");
        if (LEASED.has(metadata.to_state)) {
          invariant(Number.isSafeInteger(metadata.lease_epoch) && metadata.lease_epoch === current.lease_epoch + 1,
            "INVALID_LEASE_EPOCH", "lease epoch must increase by exactly one");
          invariant(parseTimestamp(metadata.lease_expires_at_utc, "lease_expires_at_utc") > parseTimestamp(event.body.recorded_at_utc, "recorded_at_utc"),
            "EXPIRED_LEASE", "lease must expire after the transition event");
        } else {
          invariant(metadata.lease_epoch === current.lease_epoch, "INVALID_LEASE_EPOCH",
            "unleased transitions must preserve the current lease epoch");
          invariant(metadata.lease_expires_at_utc === null, "UNEXPECTED_LEASE", "unleased state must not carry a lease expiry");
        }
        if (metadata.to_state === "STATUS_UNKNOWN") current.suspended_from_status = metadata.suspended_from_status;
        if (metadata.to_state === "RECOVERY_CHECK") invariant(current.suspended_from_status !== null, "MISSING_RECOVERY_STATE", "recovery requires suspended_from_status");
        if (current.state === "RECOVERY_CHECK" && !TERMINAL.has(metadata.to_state)) {
          invariant(metadata.to_state === current.suspended_from_status, "INVALID_RECOVERY_TARGET", "recovery must restore the suspended state or enter a terminal state");
          current.suspended_from_status = null;
        }
        current.state = metadata.to_state;
        current.sequence = sequence;
        current.lease_epoch = metadata.lease_epoch;
        current.lease_expires_at_utc = metadata.lease_expires_at_utc;
        current.history.push({ sequence, action, state: current.state, reason: metadata.reason });
      } else if (action === "AGENT_RETHREADED") {
        const current = agents.get(agentId);
        invariant(current, "UNKNOWN_AGENT", `${agentId} rethreaded before registration`);
        authorizeRethread(actor);
        const rethread = await this.project.getJson(objectRef);
        const expected = {
          schema: "agentos.memory.agent_rethread.v1",
          project_id: this.project.config.project_id,
          agent_id: agentId,
          ...metadata
        };
        invariant(canonicalJson(rethread) === canonicalJson(expected), "AGENT_RETHREAD_MISMATCH", "agent rethread object does not match its event");
        invariant(!TERMINAL.has(current.state), "TERMINAL_AGENT", "terminal agents cannot be rethreaded");
        const allowedStates = { permanent: ["DRAINING_FOR_ROLLOVER"], seed: ["READY_DORMANT", "SYNC_PENDING"], live: ["MODEL_HANDOFF"] };
        invariant(allowedStates[current.registration.roster].includes(current.state), "INVALID_RETHREAD_STATE", `${current.state} does not admit rethreading`);
        invariant(metadata.previous_session_ref === current.session_ref && metadata.previous_session_epoch === current.session_epoch,
          "STALE_SESSION", "rethread predecessor does not match current session");
        logicalRef(metadata.new_session_ref, "new_session_ref", { nullable: false, schemes: ["session"] });
        await verifyRethreadCheckpoint(this.project, metadata.checkpoint_ref, current);
        logicalRef(metadata.tmp_ref, "tmp_ref", { schemes: ["tmp"] });
        invariant(metadata.new_session_ref !== current.session_ref, "SESSION_UNCHANGED", "rethread requires a new session reference");
        invariant(metadata.new_session_epoch === current.session_epoch + 1, "INVALID_SESSION_EPOCH", "rethread epoch must increase by exactly one");
        invariant(![...agents.values()].some((entry) => entry !== current && entry.session_ref === metadata.new_session_ref && !TERMINAL.has(entry.state)),
          "SESSION_IN_USE", `${metadata.new_session_ref} is already assigned to an active roster entry`);
        invariant(Number.isSafeInteger(metadata.lease_epoch) && metadata.lease_epoch === current.lease_epoch + 1,
          "INVALID_LEASE_EPOCH", "rethread must fence the prior session with the next lease epoch");
        if (LEASED.has(current.state)) {
          invariant(parseTimestamp(metadata.lease_expires_at_utc, "lease_expires_at_utc") > parseTimestamp(event.body.recorded_at_utc, "recorded_at_utc"),
            "EXPIRED_LEASE", "replacement-session lease must expire after its event");
        } else invariant(metadata.lease_expires_at_utc === null, "UNEXPECTED_LEASE", "unleased rethread state must not carry a lease expiry");
        current.session_ref = metadata.new_session_ref;
        current.session_epoch = metadata.new_session_epoch;
        current.tmp_ref = metadata.tmp_ref;
        current.lease_epoch = metadata.lease_epoch;
        current.lease_expires_at_utc = metadata.lease_expires_at_utc;
        current.sequence = sequence;
        current.history.push({ sequence, action, state: current.state, reason: metadata.reason, session_epoch: current.session_epoch });
      }
    }
    return { agents, head_sequence: events.length };
  }

  async register(input, { actor = "controller" } = {}) {
    const registration = validateRegistration(input, this.project.config.project_id);
    authorizeRegister(registration.roster, actor);
    const state = await this.state();
    invariant(!state.agents.has(registration.agent_id), "AGENT_EXISTS", `${registration.agent_id} already exists`);
    invariant(![...state.agents.values()].some((entry) => entry.session_ref === registration.session_ref && !TERMINAL.has(entry.state)),
      "SESSION_IN_USE", `${registration.session_ref} is already assigned to an active roster entry`);
    if (registration.parent_agent_id !== null) {
      const parent = state.agents.get(registration.parent_agent_id);
      invariant(parent, "UNKNOWN_PARENT_AGENT", "parent agent is not registered");
      invariant(["permanent", "live"].includes(parent.registration.roster) && !TERMINAL.has(parent.state), "INVALID_PARENT_AGENT", "parent agent must be an active permanent or live roster entry");
    }
    const objectRef = await this.project.putJson(registration);
    const event = await this.project.commit({ actor, action: "AGENT_REGISTERED", subjectRef: registration.agent_id, objectRef, metadata: { roster: registration.roster } });
    return { registration, object_ref: objectRef, event };
  }

  async transition(agentId, toState, { actor = "controller", reason, lease_expires_at_utc = null, expected_state = null, suspended_from_status = null } = {}) {
    invariant(typeof reason === "string" && reason.length > 0, "INVALID_REASON", "transition reason is required");
    const state = await this.state();
    const current = state.agents.get(agentId);
    invariant(current, "UNKNOWN_AGENT", `${agentId} is not registered`);
    if (expected_state !== null) invariant(current.state === expected_state, "ROSTER_SOURCE_MISMATCH", `expected ${expected_state}, found ${current.state}`);
    invariant(TRANSITIONS[current.registration.roster][current.state]?.includes(toState), "INVALID_ROSTER_TRANSITION", `${current.state} cannot transition to ${toState}`);
    authorizeTransition(current, actor, toState);
    if (TERMINAL.has(toState)) {
      invariant(![...state.agents.values()].some((entry) => entry.registration.parent_agent_id === agentId && !TERMINAL.has(entry.state)),
        "ACTIVE_CHILD_AGENTS", `${agentId} cannot enter a terminal state while it has active child agents`);
    }
    if (current.state === "RECOVERY_CHECK" && !TERMINAL.has(toState)) {
      invariant(toState === current.suspended_from_status, "INVALID_RECOVERY_TARGET", "recovery must restore the suspended state or enter a terminal state");
    }
    let leaseEpoch = current.lease_epoch;
    let leaseExpiry = null;
    if (LEASED.has(toState)) {
      parseTimestamp(lease_expires_at_utc, "lease_expires_at_utc");
      invariant(Date.parse(lease_expires_at_utc) > Date.now(), "EXPIRED_LEASE", "new lease must expire in the future");
      leaseEpoch += 1;
      leaseExpiry = lease_expires_at_utc;
    }
    const suspended = toState === "STATUS_UNKNOWN"
      ? (suspended_from_status ?? current.state)
      : current.state === "RECOVERY_CHECK" && !TERMINAL.has(toState) ? null : current.suspended_from_status;
    const metadata = {
      from_state: current.state,
      to_state: toState,
      reason,
      lease_epoch: leaseEpoch,
      lease_expires_at_utc: leaseExpiry,
      suspended_from_status: suspended
    };
    const objectRef = await this.project.putJson({ schema: "agentos.memory.agent_transition.v1", project_id: this.project.config.project_id, agent_id: agentId, ...metadata });
    return this.project.commit({ actor, action: "AGENT_TRANSITIONED", subjectRef: agentId, objectRef, metadata });
  }

  async rethread(agentId, newSessionRef, {
    actor = "controller",
    reason,
    checkpoint_ref,
    expected_session_epoch,
    tmp_ref = null,
    lease_expires_at_utc = null
  } = {}) {
    invariant(typeof reason === "string" && reason.length > 0, "INVALID_REASON", "rethread reason is required");
    logicalRef(newSessionRef, "new_session_ref", { nullable: false, schemes: ["session"] });
    logicalRef(tmp_ref, "tmp_ref", { schemes: ["tmp"] });
    invariant(Number.isSafeInteger(expected_session_epoch) && expected_session_epoch >= 1, "INVALID_SESSION_EPOCH", "expected_session_epoch is required");
    authorizeRethread(actor);
    const state = await this.state();
    const current = state.agents.get(agentId);
    invariant(current, "UNKNOWN_AGENT", `${agentId} is not registered`);
    invariant(!TERMINAL.has(current.state), "TERMINAL_AGENT", "terminal agents cannot be rethreaded");
    const allowedStates = { permanent: ["DRAINING_FOR_ROLLOVER"], seed: ["READY_DORMANT", "SYNC_PENDING"], live: ["MODEL_HANDOFF"] };
    invariant(allowedStates[current.registration.roster].includes(current.state), "INVALID_RETHREAD_STATE", `${current.state} does not admit rethreading`);
    invariant(current.session_epoch === expected_session_epoch, "STALE_SESSION", `expected session epoch ${expected_session_epoch}, found ${current.session_epoch}`);
    await verifyRethreadCheckpoint(this.project, checkpoint_ref, current);
    invariant(newSessionRef !== current.session_ref, "SESSION_UNCHANGED", "rethread requires a new session reference");
    invariant(![...state.agents.values()].some((entry) => entry !== current && entry.session_ref === newSessionRef && !TERMINAL.has(entry.state)),
      "SESSION_IN_USE", `${newSessionRef} is already assigned to an active roster entry`);
    let leaseExpiry = null;
    if (LEASED.has(current.state)) {
      invariant(parseTimestamp(lease_expires_at_utc, "lease_expires_at_utc") > Date.now(), "EXPIRED_LEASE", "replacement-session lease must expire in the future");
      leaseExpiry = lease_expires_at_utc;
    } else invariant(lease_expires_at_utc === null, "UNEXPECTED_LEASE", "unleased rethread state must not carry a lease expiry");
    const metadata = {
      previous_session_ref: current.session_ref,
      previous_session_epoch: current.session_epoch,
      new_session_ref: newSessionRef,
      new_session_epoch: current.session_epoch + 1,
      checkpoint_ref,
      tmp_ref,
      reason,
      lease_epoch: current.lease_epoch + 1,
      lease_expires_at_utc: leaseExpiry
    };
    const objectRef = await this.project.putJson({ schema: "agentos.memory.agent_rethread.v1", project_id: this.project.config.project_id, agent_id: agentId, ...metadata });
    return this.project.commit({ actor, action: "AGENT_RETHREADED", subjectRef: agentId, objectRef, metadata });
  }

  async expireLease(agentId, observedAtUtc, { actor = "runtime" } = {}) {
    const observed = parseTimestamp(observedAtUtc, "observed_at_utc");
    const state = await this.state();
    const current = state.agents.get(agentId);
    invariant(current, "UNKNOWN_AGENT", `${agentId} is not registered`);
    invariant(current.lease_expires_at_utc !== null, "NO_ACTIVE_LEASE", `${agentId} has no active lease`);
    invariant(observed >= Date.parse(current.lease_expires_at_utc), "LEASE_NOT_EXPIRED", `${agentId} lease has not expired`);
    return this.transition(agentId, "STATUS_UNKNOWN", { actor, reason: `lease expired as observed at ${observedAtUtc}`, expected_state: current.state, suspended_from_status: current.state });
  }

  async projection() {
    const state = await this.state();
    return {
      schema: "agentos.memory.roster_projection.v1",
      project_id: this.project.config.project_id,
      source_head_sequence: state.head_sequence,
      agents: [...state.agents.values()].map((current) => ({
        agent_id: current.registration.agent_id,
        roster: current.registration.roster,
        role_id: current.registration.role_id,
        lane_id: current.registration.lane_id,
        state: current.state,
        session_ref: current.session_ref,
        session_epoch: current.session_epoch,
        tmp_ref: current.tmp_ref,
        lease_epoch: current.lease_epoch,
        lease_expires_at_utc: current.lease_expires_at_utc,
        suspended_from_status: current.suspended_from_status,
        last_sequence: current.sequence
      })).sort((a, b) => a.agent_id.localeCompare(b.agent_id, "en"))
    };
  }
}

export const rosterInternals = { TRANSITIONS, INITIAL, LEASED, LOGICAL_REF, validateRegistration };
