import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentOS3Runtime, TEST_CAPABILITY_SCHEMA } from "../memory-adapter.mjs";
import { compileMemoryAuthorityBinding } from "../memory-authority.mjs";
import {
  compileImmutableGoal,
  compileProposedLeaseTransfer,
  compileSuccessorAck,
  compileSuccessorChecksum,
  continuityWorktreeDigest,
  MemoryContinuityController,
} from "../memory-continuity.mjs";
import { canonicalJson, sha256Ref } from "../memory-m2/src/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = dirname(HERE);
const REPOSITORY_ROOT = join(INTEGRATION_ROOT, "..", "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const contract = await readJson(join(INTEGRATION_ROOT, "contracts", "memory-continuity.v1.json"));
const contentBinding = await readJson(join(INTEGRATION_ROOT, "contracts", "memory-continuity-binding.v1.json"));
assert.equal(contract.status, "CANDIDATE_INACTIVE");
assert.equal(contract.activation, "TEST_ONLY");
assert.equal(contract.task_custody.worktree_owner, "TASK");
assert.equal(contract.task_custody.agent_archive_effect, "RELEASE_AGENT_LEASE_ONLY_RETAIN_WORKTREE");
assert.deepEqual(contentBinding.inputs.map(({ path }) => path), [...contentBinding.inputs.map(({ path }) => path)].sort());
for (const input of contentBinding.inputs) {
  assert.equal(createHash("sha256").update(await readFile(join(REPOSITORY_ROOT, input.path))).digest("hex"), input.sha256,
    `memory continuity content binding mismatch: ${input.path}`);
}
const bindingBody = structuredClone(contentBinding);
delete bindingBody.binding_sha256;
assert.equal(createHash("sha256").update(canonicalJson(bindingBody)).digest("hex"), contentBinding.binding_sha256);
for (const [path, id] of [
  ["memory-continuity-task.v1.json", "agentos.memory.continuity_task.v1"],
  ["memory-continuity-checkpoint.v1.json", "agentos.memory.continuity_checkpoint.v1"],
  ["memory-goal-amendment.v1.json", "agentos.memory.goal_amendment.v1"],
  ["memory-failure-signature.v1.json", "agentos.memory.failure_signature.v1"],
  ["memory-handoff-transition.v1.json", "agentos.memory.handoff_transition.v1"],
]) assert.equal((await readJson(join(REPOSITORY_ROOT, "schemas", path))).$id, id);

const ref = (character) => `ref_${character.repeat(32)}`;
const content = (label) => sha256Ref("agentos.memory.continuity-test.v1", Buffer.from(label));
const worktree = ({ id = "worktree-a", path = "/portable-fixture/project-control/worktrees/task-a",
  branch = "codex/task-a", head = "1".repeat(40), tree = "2".repeat(40), patch = "0".repeat(64) } = {}) => ({
  worktree_id: id,
  path,
  branch,
  head,
  tree,
  dirty_patch_digest: patch,
});
const entry = (statement, overrides = {}) => ({
  class: "OBSERVATION",
  epistemic_status: "FACT",
  statement,
  evidence_refs: [content(`evidence:${statement}`)],
  provenance_refs: [],
  attempt_disposition: "SUCCEEDED",
  ...overrides,
});
const route = (label) => ({
  seed_digest: content(`${label}:seed`),
  role_manifest_digest: content(`${label}:role`),
  model: "test-model",
  duty: `test-duty-${label}`,
  strategy_digest: content(`${label}:strategy`),
});

assert.throws(() => new MemoryContinuityController({ verifyEvents() {}, commit() {} }),
  (error) => error.code === "CONTINUITY_AUTHORITY_GUARD_REQUIRED");

const projectRef = ref("a");
const controlPlaneRef = ref("b");
const authorityBinding = compileMemoryAuthorityBinding({
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  memory_project_id: "continuity-test",
  selected_authority: "MEMORY_M2",
});
const lease = randomBytes(32).toString("hex");
const capability = {
  schema: TEST_CAPABILITY_SCHEMA,
  build_id: "AGENTOS_3_TEST_BUILD",
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  scope: "memory:test",
  expires_at_utc: new Date(Date.now() + 600_000).toISOString(),
  nonce: randomBytes(32).toString("hex"),
  lease,
};
let authorityActive = true;
const capabilityVerifier = async (value) => value.lease === lease;
const memoryAuthorityVerifier = async (value, expected) => authorityActive
  && value.binding_digest === expected.binding_digest
  && value.selected_authority === "MEMORY_M2"
  && value.authorities.legacy_project_memory === "DISABLED";

const root = await mkdtemp(join(tmpdir(), "agentos-memory-continuity-"));
try {
  const runtime = createAgentOS3Runtime({ projectRef, controlPlaneRef, capabilityVerifier, memoryAuthorityVerifier });
  const adapter = await runtime.enableForTest(capability, authorityBinding);
  const opened = await adapter.initialize(join(root, "m2"), "continuity-test");
  assert.equal(opened.descriptor.interfaces.continuity, "AVAILABLE_GUARDED_TEST_ONLY");
  assert.equal(opened.descriptor.interfaces.handoff_journal, "AVAILABLE_GUARDED_TEST_ONLY");
  assert.equal(opened.descriptor.interfaces.successor_transfer, "AVAILABLE_GUARDED_TEST_ONLY");

  const goal = compileImmutableGoal({
    objective: "Deliver the bounded portable continuity fixture.",
    success_criteria: ["Signed checkpoint chain exists.", "Handoff fails closed."],
  });
  await opened.continuity.openTask({
    task_id: "task-a",
    original_goal: goal,
    worktree: worktree(),
    agent_id: "agent-a",
    generation: 1,
    recorded_at_utc: "2026-01-01T00:00:00.000Z",
  });
  await assert.rejects(() => opened.continuity.openTask({
    task_id: "duplicate-worktree-task", original_goal: goal, worktree: worktree(),
    agent_id: "duplicate-agent", generation: 1,
  }), (error) => error.code === "WORKTREE_ALREADY_TASK_OWNED");
  // A process disappearing after an external test but before checkpoint cannot create fictional memory.
  // The signed state remains at the last known boundary and the timer only reports the bounded exposure.
  assert.equal((await opened.continuity.state("task-a")).checkpoints.length, 0);
  assert.equal((await opened.continuity.checkpointFailsafe("task-a", {
    now_utc: "2026-01-01T00:15:00.001Z",
  })).disposition, "CHECKPOINT_REQUIRED");
  const first = await opened.continuity.appendCheckpoint({
    task_id: "task-a",
    agent_id: "agent-a",
    generation: 1,
    worktree: worktree(),
    status: "ACTIVE",
    recorded_at_utc: "2026-01-01T00:01:00.000Z",
    entries: [entry("Initial state is externalized."), entry("A rejected approach remains known.", {
      class: "DISCOVERY",
      attempt_disposition: "DISPROVEN",
    })],
  });
  assert.equal(first.checkpoint_number, 1);
  const projection = await opened.continuity.recoverHandoffProjection("task-a");
  const projectionBytes = await readFile(projection.path);
  assert.match(projectionBytes.toString("utf8"), /OBSERVATION \| FACT \| SUCCEEDED/u);
  assert.match(projectionBytes.toString("utf8"), /DISCOVERY \| FACT \| DISPROVEN/u);

  // A partial projection write is recovered only by appending the missing signed suffix.
  await truncate(projection.path, projectionBytes.length - 11);
  const repaired = await opened.continuity.recoverHandoffProjection("task-a");
  assert.equal(repaired.repaired_bytes, 11);
  assert.deepEqual(await readFile(projection.path), projectionBytes);

  const beforeGoal = await opened.continuity.state("task-a");
  const amended = await opened.continuity.amendGoal({
    task_id: "task-a",
    authority_ref: ref("c"),
    reason: "An accepted authority added a recovery criterion.",
    success_criteria: [...goal.success_criteria, "Crash recovery is proven."],
    evidence_refs: [content("goal-amendment-evidence")],
    recorded_at_utc: "2026-01-01T00:02:00.000Z",
  });
  assert.deepEqual(amended.task.original_goal, goal);
  assert.notEqual(amended.active_goal_digest, beforeGoal.active_goal_digest);
  assert.equal(amended.amendments.length, 1);

  const due = await opened.continuity.checkpointFailsafe("task-a", { now_utc: "2026-01-01T00:17:00.001Z" });
  assert.equal(due.lifecycle_authority, "STATE_MACHINE");
  assert.equal(due.timer_authority, "FAILSAFE_ONLY");
  assert.equal(due.disposition, "CHECKPOINT_REQUIRED");

  const routeA = route("same-failure-route");
  for (let index = 0; index < 2; index += 1) {
    const failure = await opened.continuity.recordFailure({
      task_id: "task-a",
      agent_id: "agent-a",
      generation: 1,
      failure_class: "REPEATED_TOOL_FAILURE",
      normalized_scope: "portable continuity fixture",
      normalized_cause: "deterministic unavailable dependency",
      affected_gate: "CONTINUITY_FIXTURE",
      evidence_refs: [content(`failure-${index}`)],
      route: routeA,
      recorded_at_utc: `2026-01-01T00:0${3 + index}:00.000Z`,
    });
    assert.equal(failure.streak.count, index + 1);
  }

  const routeB = route("generation-two");
  let state = await opened.continuity.beginHandoff({
    task_id: "task-a",
    transaction_id: "handoff-one",
    actor_id: "controller",
    successor_agent_id: "agent-b",
    successor_generation: 2,
    successor_route: routeB,
    recorded_at_utc: "2026-01-01T00:05:00.000Z",
  });
  assert.equal(state.active_handoff.stage, "PREPARE_HANDOFF");

  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "FREEZE_PREDECESSOR_WRITES",
    actor_id: "controller", payload: {}, recorded_at_utc: "2026-01-01T00:06:00.000Z",
  });
  assert.equal(state.writes_frozen, true);
  await assert.rejects(() => opened.continuity.appendCheckpoint({
    task_id: "task-a", agent_id: "agent-a", generation: 1, worktree: worktree(), entries: [entry("late write")],
  }), (error) => error.code === "PREDECESSOR_WRITES_FROZEN");

  const finalCheckpoint = await opened.continuity.appendFinalCheckpoint({
    task_id: "task-a",
    agent_id: "agent-a",
    generation: 1,
    worktree: worktree({ head: "3".repeat(40), tree: "4".repeat(40), patch: "5".repeat(64) }),
    recorded_at_utc: "2026-01-01T00:07:00.000Z",
    entries: [entry("Predecessor final state is externalized.", { class: "CODE_CHANGE" })],
  });
  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "FINAL_CHECKPOINT",
    actor_id: "controller", payload: { checkpoint_digest: finalCheckpoint.checkpoint_digest },
    recorded_at_utc: "2026-01-01T00:08:00.000Z",
  });
  const worktreeManifestDigest = continuityWorktreeDigest(finalCheckpoint.worktree);
  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE",
    actor_id: "spawner", payload: {
      checkpoint_digest: finalCheckpoint.checkpoint_digest,
      evidence_manifest_digest: content("evidence-manifest"),
      worktree_manifest_digest: worktreeManifestDigest,
    }, recorded_at_utc: "2026-01-01T00:09:00.000Z",
  });
  const successorContextDigest = content("successor-context");
  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "CONSOLIDATE_SUCCESSOR_CONTEXT",
    actor_id: "spawner", payload: {
      successor_context_digest: successorContextDigest,
      source_checkpoint_digest: finalCheckpoint.checkpoint_digest,
      source_goal_digest: state.active_goal_digest,
    }, recorded_at_utc: "2026-01-01T00:10:00.000Z",
  });
  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "SPAWN_SUCCESSOR",
    actor_id: "spawner", payload: {
      successor_agent_id: "agent-b",
      successor_generation: 2,
      spawn_receipt_ref: ref("d"),
      role_context_manifest_digest: routeB.role_manifest_digest,
    }, recorded_at_utc: "2026-01-01T00:11:00.000Z",
  });
  const checksumInput = {
    successor_context_digest: successorContextDigest,
    checkpoint_digest: finalCheckpoint.checkpoint_digest,
    goal_digest: state.active_goal_digest,
    worktree_manifest_digest: worktreeManifestDigest,
    role_context_manifest_digest: routeB.role_manifest_digest,
  };
  const checksumDigest = compileSuccessorChecksum(checksumInput);
  await assert.rejects(() => opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "SUCCESSOR_VERIFY_CHECKSUM",
    actor_id: "agent-b", payload: { ...checksumInput, checksum_digest: content("wrong-checksum") },
  }), (error) => error.code === "SUCCESSOR_CHECKSUM_DIVERGENCE");
  state = await opened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "SUCCESSOR_VERIFY_CHECKSUM",
    actor_id: "agent-b", payload: { ...checksumInput, checksum_digest: checksumDigest },
    recorded_at_utc: "2026-01-01T00:12:00.000Z",
  });

  // Crash before ACK: reopening reconstructs checksum state and retains predecessor lease.
  let reopened = await adapter.reopen(join(root, "m2"));
  state = await reopened.continuity.state("task-a");
  assert.equal(state.active_handoff.stage, "SUCCESSOR_VERIFY_CHECKSUM");
  assert.deepEqual(state.lease_holder, { agent_id: "agent-a", generation: 1 });
  await assert.rejects(() => reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "TRANSFER_TASK_WORKTREE_LEASE",
    actor_id: "controller", payload: {},
  }), (error) => error.code === "INVALID_HANDOFF_ORDER");

  const ackDigest = compileSuccessorAck({ transaction_id: "handoff-one", successor_agent_id: "agent-b",
    successor_generation: 2, checksum_digest: checksumDigest });
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "SUCCESSOR_ACK",
    actor_id: "agent-b", payload: { checksum_digest: checksumDigest, successor_ack_digest: ackDigest },
    recorded_at_utc: "2026-01-01T00:13:00.000Z",
  });
  assert.deepEqual(state.lease_holder, { agent_id: "agent-a", generation: 1 });

  const transferDigest = compileProposedLeaseTransfer({ transaction_id: "handoff-one",
    from_agent_id: "agent-a", to_agent_id: "agent-b", worktree_id: "worktree-a" });
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "TRANSFER_TASK_WORKTREE_LEASE",
    actor_id: "controller", payload: {
      from_agent_id: "agent-a", to_agent_id: "agent-b", worktree_id: "worktree-a",
      proposed_transfer_digest: transferDigest,
    }, recorded_at_utc: "2026-01-01T00:14:00.000Z",
  });

  // Crash during transfer: proposed transfer is not ownership; predecessor remains recoverable.
  reopened = await adapter.reopen(join(root, "m2"));
  state = await reopened.continuity.state("task-a");
  assert.equal(state.active_handoff.stage, "TRANSFER_TASK_WORKTREE_LEASE");
  assert.deepEqual(state.lease_holder, { agent_id: "agent-a", generation: 1 });
  await assert.rejects(() => reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST",
    actor_id: "controller", payload: {
      worktree: worktree(), worktree_manifest_digest: continuityWorktreeDigest(worktree()),
      proposed_transfer_digest: transferDigest,
    },
  }), (error) => error.code === "TRANSFER_STATE_DIVERGENCE");

  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST",
    actor_id: "controller", payload: {
      worktree: finalCheckpoint.worktree,
      worktree_manifest_digest: worktreeManifestDigest,
      proposed_transfer_digest: transferDigest,
    }, recorded_at_utc: "2026-01-01T00:15:00.000Z",
  });
  const verificationTransitionDigest = state.active_handoff.last_transition_digest;
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "HANDOFF_COMMITTED",
    actor_id: "controller", payload: {
      proposed_transfer_digest: transferDigest,
      verification_transition_digest: verificationTransitionDigest,
    }, recorded_at_utc: "2026-01-01T00:16:00.000Z",
  });
  assert.deepEqual(state.lease_holder, { agent_id: "agent-b", generation: 2 });
  assert.equal(state.archived_agents.length, 0);
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-one", action: "ARCHIVE_PREDECESSOR",
    actor_id: "controller", payload: {
      predecessor_agent_id: "agent-a",
      archive_receipt_ref: ref("e"),
      worktree_disposition: "RETAINED_TASK_CUSTODY",
    }, recorded_at_utc: "2026-01-01T00:17:00.000Z",
  });
  assert.equal(state.archived_agents.length, 1);
  assert.equal(state.active_handoff.stage, "ARCHIVE_PREDECESSOR");
  assert.equal(state.task.worktree.worktree_id, "worktree-a");

  await reopened.continuity.appendCheckpoint({
    task_id: "task-a", agent_id: "agent-b", generation: 2, worktree: finalCheckpoint.worktree,
    status: "RECOVERY", recorded_at_utc: "2026-01-01T00:18:00.000Z",
    entries: [entry("Successor resumed the same task-owned worktree.", { class: "DISCOVERY" })],
  });
  const third = await reopened.continuity.recordFailure({
    task_id: "task-a", agent_id: "agent-b", generation: 2,
    failure_class: "REPEATED_TOOL_FAILURE", normalized_scope: "portable continuity fixture",
    normalized_cause: "deterministic unavailable dependency", affected_gate: "CONTINUITY_FIXTURE",
    evidence_refs: [content("failure-generation-two")], route: routeA,
    recorded_at_utc: "2026-01-01T00:19:00.000Z",
  });
  assert.deepEqual(third.streak, {
    signature_digest: third.failure.signature_digest,
    route_digest: third.failure.route_digest,
    count: 3,
    disposition: "ROUTE_CHANGE_REQUIRED",
  });
  await assert.rejects(() => reopened.continuity.beginHandoff({
    task_id: "task-a", transaction_id: "handoff-two", actor_id: "controller",
    successor_agent_id: "agent-c", successor_generation: 3, successor_route: routeA,
  }), (error) => error.code === "REPEATED_FAILURE_ROUTE_CHANGE_REQUIRED");
  const routeC = route("changed-recovery-route");
  state = await reopened.continuity.beginHandoff({
    task_id: "task-a", transaction_id: "handoff-two", actor_id: "controller",
    successor_agent_id: "agent-c", successor_generation: 3, successor_route: routeC,
    recorded_at_utc: "2026-01-01T00:20:00.000Z",
  });
  assert.equal(state.active_handoff.transaction_id, "handoff-two");

  // A goal amendment cannot race a live handoff.
  await assert.rejects(() => reopened.continuity.amendGoal({
    task_id: "task-a", authority_ref: ref("f"), reason: "unsafe race",
    success_criteria: ["should not write"], evidence_refs: [content("unsafe-amendment")],
  }), (error) => error.code === "GOAL_AMENDMENT_DURING_HANDOFF");

  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "FREEZE_PREDECESSOR_WRITES",
    actor_id: "controller", payload: {}, recorded_at_utc: "2026-01-01T00:21:00.000Z",
  });
  const divergenceFinal = await reopened.continuity.appendFinalCheckpoint({
    task_id: "task-a", agent_id: "agent-b", generation: 2, worktree: finalCheckpoint.worktree,
    recorded_at_utc: "2026-01-01T00:22:00.000Z",
    entries: [entry("State before the divergent successor is externalized.", { class: "DISCOVERY" })],
  });
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "FINAL_CHECKPOINT",
    actor_id: "controller", payload: { checkpoint_digest: divergenceFinal.checkpoint_digest },
    recorded_at_utc: "2026-01-01T00:23:00.000Z",
  });
  const divergenceWorktreeDigest = continuityWorktreeDigest(divergenceFinal.worktree);
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE",
    actor_id: "spawner", payload: {
      checkpoint_digest: divergenceFinal.checkpoint_digest,
      evidence_manifest_digest: content("divergence-evidence-manifest"),
      worktree_manifest_digest: divergenceWorktreeDigest,
    }, recorded_at_utc: "2026-01-01T00:24:00.000Z",
  });
  const divergenceContextDigest = content("divergence-successor-context");
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "CONSOLIDATE_SUCCESSOR_CONTEXT",
    actor_id: "spawner", payload: {
      successor_context_digest: divergenceContextDigest,
      source_checkpoint_digest: divergenceFinal.checkpoint_digest,
      source_goal_digest: state.active_goal_digest,
    }, recorded_at_utc: "2026-01-01T00:25:00.000Z",
  });
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "SPAWN_SUCCESSOR",
    actor_id: "spawner", payload: {
      successor_agent_id: "agent-c", successor_generation: 3,
      spawn_receipt_ref: ref("g"), role_context_manifest_digest: routeC.role_manifest_digest,
    }, recorded_at_utc: "2026-01-01T00:26:00.000Z",
  });
  const divergenceChecksumInput = {
    successor_context_digest: divergenceContextDigest,
    checkpoint_digest: divergenceFinal.checkpoint_digest,
    goal_digest: state.active_goal_digest,
    worktree_manifest_digest: divergenceWorktreeDigest,
    role_context_manifest_digest: routeC.role_manifest_digest,
  };
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "SUCCESSOR_VERIFY_CHECKSUM",
    actor_id: "agent-c", payload: {
      ...divergenceChecksumInput,
      checksum_digest: compileSuccessorChecksum(divergenceChecksumInput),
    }, recorded_at_utc: "2026-01-01T00:27:00.000Z",
  });
  state = await reopened.continuity.advanceHandoff({
    task_id: "task-a", transaction_id: "handoff-two", action: "DIVERGENCE",
    actor_id: "agent-c", payload: {
      reason: "Successor independently reported a state mismatch outside the bound checksum fields.",
      evidence_refs: [content("successor-divergence")],
    }, recorded_at_utc: "2026-01-01T00:28:00.000Z",
  });
  assert.equal(state.active_handoff.stage, "DIVERGENCE");
  assert.deepEqual(state.lease_holder, { agent_id: "agent-b", generation: 2 });
  assert.equal(state.archived_agents.length, 1);

  // Raw or contradictory projection bytes never become signed continuity truth.
  await appendFile(projection.path, "UNSIGNED TAIL\n");
  await assert.rejects(() => reopened.continuity.recoverHandoffProjection("task-a"),
    (error) => error.code === "HANDOFF_PROJECTION_DIVERGENCE");

  // Authority revocation blocks continuity before it reaches writable custody.
  const beforeRevocation = (await reopened.project.verify()).event_count;
  authorityActive = false;
  await assert.rejects(() => reopened.continuity.state("task-a"), /MEMORY_AUTHORITY_NOT_VERIFIED/u);
  authorityActive = true;
  assert.equal((await reopened.project.verify()).event_count, beforeRevocation);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("PASS AgentOS 3 memory continuity: immutable goal amendments, append-first typed checkpoints, negative knowledge, three-repeat route change, transactional ACK/lease/archive, crash recovery, and authority denial");
