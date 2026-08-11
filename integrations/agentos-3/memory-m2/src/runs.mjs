import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { acquireWriterLock, atomicWrite, ensurePrivateDir, exists, readJson } from "./io.mjs";
import { uuidv7 } from "./uuidv7.mjs";
import { AgentRoster } from "./rosters.mjs";

export class RunWorkspace {
  constructor(project, memory) {
    this.project = project;
    this.memory = memory;
    this.roster = new AgentRoster(project);
  }

  path(runId, name) {
    invariant(/^run:[a-zA-Z0-9._:-]+$/.test(runId), "INVALID_RUN_ID", "invalid run id");
    const base = resolve(this.project.root, "tmp", "runs");
    const target = resolve(base, runId.slice(4), name);
    invariant(target.startsWith(`${base}${sep}`), "RUN_PATH_ESCAPE", "run path must remain inside project temporary custody");
    return target;
  }

  async assertRunCustody(runId) {
    const base = resolve(this.project.root, "tmp", "runs");
    const directory = this.path(runId, "");
    for (const [path, label] of [[base, "run custody root"], [directory, "run directory"]]) {
      const info = await lstat(path);
      invariant(info.isDirectory() && !info.isSymbolicLink(), "RUN_CUSTODY_INVALID", `${label} must be a real directory`);
      invariant((info.mode & 0o077) === 0, "RUN_CUSTODY_PERMISSIONS", `${label} must not be accessible by group or other users`);
    }
  }

  async assertRunFile(runId, name) {
    const info = await lstat(this.path(runId, name));
    invariant(info.isFile() && !info.isSymbolicLink(), "RUN_FILE_INVALID", `${name} must be a real regular file`);
    invariant((info.mode & 0o077) === 0, "RUN_FILE_PERMISSIONS", `${name} must not be accessible by group or other users`);
  }

  async bindingIsCurrent(state) {
    if (state.agent_id === null) return true;
    const agent = (await this.roster.state()).agents.get(state.agent_id);
    return Boolean(agent && agent.session_epoch === state.session_epoch && agent.session_ref === state.session_ref);
  }

  async authoritativeState(runId) {
    let state = null;
    const { events } = await this.project.verifyEvents();
    for (const event of events) {
      if (event.body.subject_ref !== runId) continue;
      const { action, object_ref: objectRef, metadata, sequence, recorded_at_utc: recordedAt } = event.body;
      if (action === "RUN_STARTED") {
        invariant(state === null && objectRef !== null, "INVALID_RUN_HISTORY", "run must have exactly one manifest-backed start event");
        const manifest = await this.project.getJson(objectRef);
        const expected = {
          schema: "agentos.memory.run_manifest.v1",
          project_id: this.project.config.project_id,
          run_id: runId,
          role: manifest.role,
          lane: manifest.lane,
          assignment: manifest.assignment,
          agent_id: manifest.agent_id,
          session_ref: manifest.session_ref,
          session_epoch: manifest.session_epoch,
          seed_capsule_ref: manifest.seed_capsule_ref,
          seed_capsule_digest: manifest.seed_capsule_digest,
          query: manifest.query,
          budget_bytes: manifest.budget_bytes
        };
        invariant(canonicalJson(manifest) === canonicalJson(expected), "INVALID_RUN_MANIFEST", "run manifest is invalid or contains unsupported fields");
        invariant(canonicalJson(metadata) === canonicalJson({
          role: manifest.role,
          lane: manifest.lane,
          seed_capsule_ref: manifest.seed_capsule_ref,
          seed_capsule_digest: manifest.seed_capsule_digest,
          agent_id: manifest.agent_id,
          session_ref: manifest.session_ref,
          session_epoch: manifest.session_epoch
        }), "RUN_EVENT_MISMATCH", "run start metadata does not match its manifest");
        state = {
          schema: "agentos.memory.run_state.v1",
          run_id: runId,
          project_id: this.project.config.project_id,
          role: manifest.role,
          lane: manifest.lane,
          assignment: manifest.assignment,
          agent_id: manifest.agent_id,
          session_ref: manifest.session_ref,
          session_epoch: manifest.session_epoch,
          status: "ACTIVE",
          seed_capsule_ref: manifest.seed_capsule_ref,
          seed_capsule_digest: manifest.seed_capsule_digest,
          started_at_utc: recordedAt,
          last_checkpoint_ref: null
        };
      } else if (action === "RUN_CHECKPOINTED") {
        invariant(state?.status === "ACTIVE" && objectRef !== null, "INVALID_RUN_HISTORY", "checkpoint requires an active run");
        const checkpoint = await this.project.getJson(objectRef);
        invariant(checkpoint.schema === "agentos.memory.run_checkpoint.v1" && checkpoint.project_id === this.project.config.project_id && checkpoint.run_id === runId,
          "INVALID_RUN_HISTORY", "checkpoint does not belong to this run");
        invariant(canonicalJson(metadata) === canonicalJson({ note: checkpoint.note, byte_count: checkpoint.byte_count, agent_id: checkpoint.agent_id, session_epoch: checkpoint.session_epoch }),
          "RUN_EVENT_MISMATCH", "checkpoint metadata does not match its manifest");
        state = { ...state, last_checkpoint_ref: objectRef, last_checkpoint_sequence: sequence };
      } else if (action === "RUN_CLOSED") {
        invariant(state?.status === "ACTIVE", "INVALID_RUN_HISTORY", "close requires an active run");
        invariant(["ARCHIVED", "QUARANTINED"].includes(metadata.disposition), "INVALID_RUN_HISTORY", "run close disposition is invalid");
        invariant(metadata.bound_session_epoch === state.session_epoch && typeof metadata.stale_session === "boolean", "RUN_EVENT_MISMATCH", "run close metadata is invalid");
        invariant(objectRef === state.last_checkpoint_ref, "RUN_EVENT_MISMATCH", "run close must retain the last verified checkpoint");
        state = { ...state, status: metadata.disposition, closed_at_utc: recordedAt, stale_session_at_close: metadata.stale_session };
      }
    }
    invariant(state !== null, "UNKNOWN_RUN", `${runId} has no signed run history`);
    return state;
  }

  async verifiedState(runId) {
    await this.assertRunCustody(runId);
    await this.assertRunFile(runId, "runstate.json");
    const stored = await readJson(this.path(runId, "runstate.json"));
    const authoritative = await this.authoritativeState(runId);
    invariant(canonicalJson(stored) === canonicalJson(authoritative), "RUN_STATE_MISMATCH", "stored run state does not match signed replay");
    await this.verifySeedFile(runId, stored);
    return stored;
  }

  async verifySeedFile(runId, state) {
    const path = this.path(runId, "seed.json");
    await this.assertRunFile(runId, "seed.json");
    const raw = await readFile(path);
    const seed = await readJson(path);
    invariant(raw.equals(Buffer.from(`${canonicalJson(seed)}\n`)), "NON_CANONICAL_SEED", "stored seed capsule is not canonical");
    const authoritativeSeed = await this.project.getJson(state.seed_capsule_ref);
    invariant(canonicalJson(seed) === canonicalJson(authoritativeSeed), "SEED_OBJECT_MISMATCH",
      "stored seed capsule does not match its signed object binding");
    const { capsule_digest: capsuleDigest, ...body } = seed;
    invariant(seed.schema === "agentos.memory.seed_capsule.v1" && seed.project_id === this.project.config.project_id,
      "INVALID_SEED_CAPSULE", "stored seed capsule has unsupported schema or project identity");
    invariant(seed.role === state.role && seed.lane === state.lane, "SEED_SCOPE_MISMATCH", "stored seed scope does not match run scope");
    invariant(capsuleDigest === state.seed_capsule_digest && capsuleDigest === sha256Ref("agentos.memory.seed-capsule.v1", canonicalBytes(body)),
      "SEED_DIGEST_MISMATCH", "stored seed capsule does not match its signed run manifest");
    const expected = {
      schema: "agentos.memory.seed_capsule.v1",
      project_id: this.project.config.project_id,
      role: seed.role,
      lane: seed.lane,
      source_head_sequence: seed.source_head_sequence,
      context_packet_digest: seed.context_packet_digest,
      records: seed.records,
      omissions: seed.omissions,
      capsule_digest: capsuleDigest
    };
    invariant(canonicalJson(seed) === canonicalJson(expected), "INVALID_SEED_CAPSULE", "stored seed capsule contains unsupported fields");
    return seed;
  }

  async readSeed(runId) {
    const state = await this.verifiedState(runId);
    return this.verifySeedFile(runId, state);
  }

  async recoverLocal(runId, { actor = "system.run-recovery", timeout_ms = 15_000 } = {}) {
    const release = await acquireWriterLock(this.project.root, actor, timeout_ms);
    try { return await this.recoverLocalLocked(runId); } finally { await release(); }
  }

  async recoverLocalLocked(runId) {
    const state = await this.authoritativeState(runId);
    const base = resolve(this.project.root, "tmp", "runs");
    await ensurePrivateDir(base);
    await ensurePrivateDir(this.path(runId, ""));
    await this.assertRunCustody(runId);
    const seed = await this.project.getJson(state.seed_capsule_ref);
    const { capsule_digest: capsuleDigest, ...seedBody } = seed;
    invariant(capsuleDigest === state.seed_capsule_digest
      && capsuleDigest === sha256Ref("agentos.memory.seed-capsule.v1", canonicalBytes(seedBody)),
    "SEED_DIGEST_MISMATCH", "immutable seed object does not match signed run state");

    let scratch = Buffer.from("", "utf8");
    if (state.last_checkpoint_ref !== null) {
      const checkpoint = await this.project.getJson(state.last_checkpoint_ref);
      scratch = await this.project.getBytes(checkpoint.scratch_object_ref);
      invariant(checkpoint.byte_count === scratch.length
        && checkpoint.scratch_digest === sha256Ref("agentos.memory.scratch.v1", scratch),
      "CHECKPOINT_DIGEST_MISMATCH", "checkpoint scratch object is invalid");
    }
    const restored = [];
    const preserved = [];
    const restore = async (name, bytes) => {
      const path = this.path(runId, name);
      try {
        await this.assertRunFile(runId, name);
        invariant((await readFile(path)).equals(bytes), "LOCAL_RECOVERY_CONFLICT", `${name} conflicts with signed recovery state`);
        preserved.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await atomicWrite(path, bytes);
        restored.push(name);
      }
    };
    await restore("seed.json", Buffer.from(`${canonicalJson(seed)}\n`));
    await restore("runstate.json", Buffer.from(`${canonicalJson(state)}\n`));
    await restore("tmpcontext.md", scratch);
    return { ...(await this.verifiedState(runId)), recovery: { restored, preserved } };
  }

  async start({ role, lane, assignment, actor = "controller", query = "", budget_bytes = 24_576, agent_id = null, session_epoch = null }) {
    invariant(typeof assignment === "string" && assignment.length > 0, "INVALID_ASSIGNMENT", "assignment is required");
    let sessionRef = null;
    if (agent_id !== null || session_epoch !== null) {
      invariant(typeof agent_id === "string" && agent_id.length > 0, "INVALID_AGENT_ID", "bound runs require agent_id");
      invariant(Number.isSafeInteger(session_epoch) && session_epoch >= 1, "INVALID_SESSION_EPOCH", "bound runs require a positive session_epoch");
      const agent = (await this.roster.state()).agents.get(agent_id);
      invariant(agent && agent.session_epoch === session_epoch, "STALE_SESSION", "run binding must match the current registered agent session");
      invariant(["permanent", "live"].includes(agent.registration.roster) && !["ARCHIVED", "RETIRED", "QUARANTINED"].includes(agent.state),
        "AGENT_CANNOT_RUN", "bound runs require an active permanent or live roster entry");
      invariant(agent.registration.role_id === role, "RUN_SCOPE_MISMATCH", "run role must match the registered agent role");
      invariant(agent.registration.lane_id === lane, "RUN_SCOPE_MISMATCH", "run lane must match the registered agent lane");
      sessionRef = agent.session_ref;
    }
    const runId = `run:${uuidv7()}`;
    const directory = this.path(runId, "");
    await ensurePrivateDir(resolve(this.project.root, "tmp", "runs"));
    await ensurePrivateDir(directory);
    await this.assertRunCustody(runId);
    const seed = await this.memory.compileSeed({ role, lane, query, budget_bytes });
    const seedCapsuleRef = await this.project.putJson(seed);
    const manifest = {
      schema: "agentos.memory.run_manifest.v1",
      run_id: runId,
      project_id: this.project.config.project_id,
      role,
      lane,
      assignment,
      agent_id,
      session_ref: sessionRef,
      session_epoch,
      seed_capsule_ref: seedCapsuleRef,
      seed_capsule_digest: seed.capsule_digest,
      query,
      budget_bytes
    };
    const manifestRef = await this.project.putJson(manifest);
    const event = await this.project.commit({
      actor,
      action: "RUN_STARTED",
      subjectRef: runId,
      objectRef: manifestRef,
      metadata: { role, lane, seed_capsule_ref: seedCapsuleRef, seed_capsule_digest: seed.capsule_digest, agent_id, session_ref: sessionRef, session_epoch }
    });
    const state = {
      schema: "agentos.memory.run_state.v1",
      run_id: runId,
      project_id: this.project.config.project_id,
      role,
      lane,
      assignment,
      agent_id,
      session_ref: sessionRef,
      session_epoch,
      status: "ACTIVE",
      seed_capsule_ref: seedCapsuleRef,
      seed_capsule_digest: seed.capsule_digest,
      started_at_utc: event.body.recorded_at_utc,
      last_checkpoint_ref: null
    };
    await atomicWrite(this.path(runId, "seed.json"), Buffer.from(`${canonicalJson(seed)}\n`));
    await atomicWrite(this.path(runId, "runstate.json"), Buffer.from(`${canonicalJson(state)}\n`));
    await atomicWrite(this.path(runId, "tmpcontext.md"), Buffer.from("", "utf8"));
    return state;
  }

  async writeScratch(runId, text) {
    invariant(typeof text === "string" && text.normalize("NFC") === text, "INVALID_SCRATCH", "scratch text must be NFC");
    const state = await this.verifiedState(runId);
    invariant(state.status === "ACTIVE", "RUN_NOT_ACTIVE", `${runId} is not active`);
    invariant(await this.bindingIsCurrent(state), "STALE_SESSION", "only the currently bound session may write this run");
    await atomicWrite(this.path(runId, "tmpcontext.md"), Buffer.from(text, "utf8"));
  }

  async readScratch(runId) {
    await this.verifiedState(runId);
    await this.assertRunFile(runId, "tmpcontext.md");
    return readFile(this.path(runId, "tmpcontext.md"), "utf8");
  }

  async checkpoint(runId, { actor = "runner", note = null } = {}) {
    const state = await this.verifiedState(runId);
    invariant(state.status === "ACTIVE", "RUN_NOT_ACTIVE", `${runId} is not active`);
    invariant(await this.bindingIsCurrent(state), "STALE_SESSION", "only the currently bound session may checkpoint this run");
    await this.assertRunFile(runId, "tmpcontext.md");
    const bytes = await readFile(this.path(runId, "tmpcontext.md"));
    const scratchObjectRef = await this.project.putBytes(bytes);
    const digest = sha256Ref("agentos.memory.scratch.v1", bytes);
    const checkpoint = {
      schema: "agentos.memory.run_checkpoint.v1",
      project_id: this.project.config.project_id,
      run_id: runId,
      agent_id: state.agent_id,
      session_ref: state.session_ref,
      session_epoch: state.session_epoch,
      scratch_object_ref: scratchObjectRef,
      byte_count: bytes.length,
      scratch_digest: digest,
      note
    };
    const checkpointRef = await this.project.putJson(checkpoint);
    const event = await this.project.commit({ actor, action: "RUN_CHECKPOINTED", subjectRef: runId, objectRef: checkpointRef, metadata: { note, byte_count: bytes.length, agent_id: state.agent_id, session_epoch: state.session_epoch } });
    const next = { ...state, last_checkpoint_ref: checkpointRef, last_checkpoint_sequence: event.body.sequence };
    await atomicWrite(this.path(runId, "runstate.json"), Buffer.from(`${canonicalJson(next)}\n`));
    return { ...checkpoint, checkpoint_ref: checkpointRef };
  }

  async close(runId, { actor = "controller", disposition = "ARCHIVED" } = {}) {
    invariant(["ARCHIVED", "QUARANTINED"].includes(disposition), "INVALID_DISPOSITION", "run disposition must be ARCHIVED or QUARANTINED");
    let state = await this.verifiedState(runId);
    invariant(state.status === "ACTIVE", "RUN_NOT_ACTIVE", `${runId} is not active`);
    const staleSession = !(await this.bindingIsCurrent(state));
    invariant(!staleSession || disposition === "QUARANTINED", "STALE_RUN_REQUIRES_QUARANTINE", "a stale-session run may only be quarantined");
    let checkpoint = null;
    if (!staleSession && await exists(this.path(runId, "tmpcontext.md"))) {
      checkpoint = await this.checkpoint(runId, { actor: "runner:close", note: "automatic close checkpoint" });
      state = await this.verifiedState(runId);
    }
    const retainedCheckpointRef = checkpoint?.checkpoint_ref ?? state.last_checkpoint_ref;
    const event = await this.project.commit({
      actor,
      action: "RUN_CLOSED",
      subjectRef: runId,
      objectRef: retainedCheckpointRef,
      metadata: { disposition, stale_session: staleSession, bound_session_epoch: state.session_epoch }
    });
    const next = { ...state, status: disposition, closed_at_utc: event.body.recorded_at_utc, last_checkpoint_ref: retainedCheckpointRef, stale_session_at_close: staleSession };
    await atomicWrite(this.path(runId, "runstate.json"), Buffer.from(`${canonicalJson(next)}\n`));
    return next;
  }
}
