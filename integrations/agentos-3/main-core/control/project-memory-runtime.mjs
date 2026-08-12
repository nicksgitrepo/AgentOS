#!/usr/bin/env node

/* Operational Bootstrap/runtime bridge for the prepared project-memory contract. */

import {
  canonicalDigest,
  compareUtf8,
} from "./content-addressing.mjs";
import {validateProjectContract} from "./bootstrap-project-contract.mjs";
import {
  GENESIS_EVENT_SHA256,
  compileDecisionRecord,
  compileGoalRecord,
  compileMemoryEvent,
  compileMemorySnapshot,
  compilePolicyReference,
  compileProjectContextRecord,
  compileRoleContextCapsule,
  validateBinding,
} from "./project-memory.mjs";
import {
  appendProjectMemoryEvent,
  readProjectMemoryLedger,
  readProjectMemorySnapshot,
  reconstructProjectMemory,
  writeProjectMemorySnapshotCompareAndSwap,
} from "./project-memory-store.mjs";
import {
  prepareProjectMemoryCapsuleImport,
  validateProjectMemoryCapsule,
} from "./project-memory-capsule.mjs";
import {
  compileProjectMemoryArtifact,
  readProjectMemoryArtifact,
  writeProjectMemoryArtifact,
} from "./project-memory-artifacts.mjs";
import {requireIdentifier, requireSha} from "./map-memory-common.mjs";
import {compileTaskContextItem} from "./task-context-firewall.mjs";

export const PROJECT_MEMORY_RUNTIME_SCHEMA = "agentos.project_memory_runtime.v1";

const DEFAULT_ALLOWED_SCOPES = Object.freeze([
  "PROJECT_CONTEXT",
  "PROJECT_DECISION",
  "PROJECT_GOAL",
  "PROJECT_GOVERNANCE",
].sort(compareUtf8));
const DEFAULT_PROHIBITED_SCOPES = Object.freeze([
  "HOST_SESSION_IDENTITY",
  "PRIVATE_CREDENTIALS",
  "RAW_CONVERSATION",
].sort(compareUtf8));
const BINDING_FIELDS = Object.freeze([
  "project_ref", "campaign_ref", "goal_ref", "role_ref", "source_commit",
  "source_tree", "source_snapshot_sha256", "policy_sha256", "handoff_sha256",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function semanticPayloads(projectContract) {
  const context = {
    schema: "agentos.project_context_payload.v1",
    project_ref: projectContract.project_ref,
    project_profile: projectContract.project_profile,
    workflows: projectContract.workflows,
    terminology: projectContract.terminology,
    providers: projectContract.providers,
    retention: projectContract.retention,
    delivery_intent: projectContract.delivery_intent,
    unknowns: projectContract.unknowns,
    source_binding: projectContract.source_binding,
    discovery_binding: projectContract.discovery_binding,
  };
  const intent = {schema: "agentos.project_intent_payload.v1", intent: projectContract.intent};
  const plan = {
    schema: "agentos.project_plan_payload.v1",
    goals: projectContract.goals,
    phase_plan: projectContract.phase_plan,
    acceptance_conditions: projectContract.acceptance_conditions,
    open_questions: projectContract.open_questions,
  };
  const governance = {
    schema: "agentos.project_governance_payload.v1",
    governance_inputs: projectContract.governance_inputs,
    reassessment: projectContract.reassessment,
  };
  const boundaries = {
    schema: "agentos.project_boundaries_payload.v1",
    scope: projectContract.scope,
    boundaries: projectContract.boundaries,
    privacy: projectContract.privacy,
  };
  return {context, intent, plan, governance, boundaries};
}

function makeArtifact({binding, artifactKind, scopeRef, payload}) {
  return compileProjectMemoryArtifact({
    artifactKind,
    scopeRef,
    projectRef: binding.project_ref,
    payload,
  });
}

function semanticDigestFields(record) {
  const fields = {
    PROJECT_CONTEXT: ["context_input_sha256", "intent_sha256", "plan_sha256", "governance_sha256", "boundary_sha256"],
    GOAL: ["goal_sha256", "scope_sha256", "acceptance_sha256"],
    DECISION: ["decision_sha256", "rationale_sha256"],
    HANDOFF: ["result_sha256", "uncertainty_sha256"],
    POLICY_REF: ["policy_sha256"],
  }[record.record_type] ?? [];
  return [...new Set(fields.map((field) => record.body[field]).filter((value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)))].sort(compareUtf8);
}

function hasExactBinding(candidate, binding) {
  return candidate !== null && BINDING_FIELDS.every((field) => candidate[field] === binding[field]);
}

function appendRecord({authorityRoot, repositoryRoot, relativePath, binding, compile}) {
  const replay = reconstructProjectMemory({authorityRoot, repositoryRoot, relativePath, binding});
  const provisional = compile({recordVersion: 1, supersedesRecordSha256: null});
  const current = replay.current_records.find((record) => record.record_type === provisional.record_type && record.record_id === provisional.record_id) ?? null;
  const candidate = current === null
    ? provisional
    : compile({recordVersion: current.record_version, supersedesRecordSha256: current.supersedes_record_sha256});
  if (current !== null && candidate.record_sha256 === current.record_sha256) return {status: "UNCHANGED", record: current};
  const record = current === null
    ? provisional
    : compile({recordVersion: current.record_version + 1, supersedesRecordSha256: current.record_sha256});
  const event = compileMemoryEvent({
    eventId: `MEMORY_EVENT_${record.record_sha256}`,
    idempotencyKey: `MEMORY_APPEND_${record.record_sha256}`,
    sequence: replay.event_count,
    eventType: current === null ? "RECORD_APPENDED" : "RECORD_SUPERSEDED",
    record,
    priorEventSha256: replay.head_sha256,
  });
  const result = appendProjectMemoryEvent({
    authorityRoot,
    repositoryRoot,
    relativePath,
    expectedHeadSha256: replay.head_sha256,
    event,
  });
  return {status: result.status, record};
}

export function compileBootstrapProjectMemoryBinding({
  projectContract,
  campaignRef,
  goalRef,
  roleRef,
  sourceCommit,
  sourceTree,
  handoffSha256 = null,
}) {
  validateProjectContract(projectContract);
  requireIdentifier(campaignRef, "project-memory campaign");
  requireIdentifier(goalRef, "project-memory goal");
  requireIdentifier(roleRef, "project-memory role");
  assert(typeof sourceCommit === "string" && /^[0-9a-f]{40}$/u.test(sourceCommit), "project-memory source commit is invalid");
  assert(typeof sourceTree === "string" && /^[0-9a-f]{40}$/u.test(sourceTree), "project-memory source tree is invalid");
  const payloads = semanticPayloads(projectContract);
  const binding = {
    project_ref: projectContract.project_ref,
    campaign_ref: campaignRef,
    goal_ref: goalRef,
    role_ref: roleRef,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    source_snapshot_sha256: projectContract.contract_sha256,
    policy_sha256: canonicalDigest(payloads.governance),
    handoff_sha256: handoffSha256 ?? canonicalDigest({kind: "BOOTSTRAP_TO_RUNTIME", project_contract_sha256: projectContract.contract_sha256}),
  };
  return validateBinding(binding, "Bootstrap project-memory binding");
}

export function createProjectMemoryRuntime({
  authorityRoot,
  repositoryRoot = process.cwd(),
  binding,
  ledgerPath = "ledgers/project-memory-events.jsonl",
  snapshotPath = "snapshots/current.json",
  laneRef = "PROJECT_RUNTIME",
  allowedScopeRefs = DEFAULT_ALLOWED_SCOPES,
  prohibitedScopeRefs = DEFAULT_PROHIBITED_SCOPES,
} = {}) {
  validateBinding(binding, "project-memory runtime binding");
  requireIdentifier(laneRef, "project-memory runtime lane");
  const allowed = [...allowedScopeRefs].sort(compareUtf8);
  const prohibited = [...prohibitedScopeRefs].sort(compareUtf8);
  assert(new Set(allowed).size === allowed.length && new Set(prohibited).size === prohibited.length, "project-memory runtime scopes contain duplicates");
  allowed.forEach((scope) => requireIdentifier(scope, "project-memory allowed scope"));
  prohibited.forEach((scope) => requireIdentifier(scope, "project-memory prohibited scope"));
  assert(!allowed.some((scope) => prohibited.includes(scope)), "project-memory allowed and prohibited scopes overlap");

  const writeArtifact = (artifact) => writeProjectMemoryArtifact({authorityRoot, repositoryRoot, artifact});

  const captureBootstrapContract = ({projectContract}) => {
    validateProjectContract(projectContract);
    assert(["READY", "REASSESSMENT_REQUIRED"].includes(projectContract.status), "project-memory capture requires a ready or reassessment contract");
    assert(projectContract.project_ref === binding.project_ref, "project-memory contract belongs to another project");
    assert(projectContract.contract_sha256 === binding.source_snapshot_sha256, "project-memory contract differs from the bound source snapshot");
    const payloads = semanticPayloads(projectContract);
    const artifacts = {
      context: makeArtifact({binding, artifactKind: "BOOTSTRAP_CONTEXT", scopeRef: "PROJECT_CONTEXT", payload: payloads.context}),
      intent: makeArtifact({binding, artifactKind: "BOOTSTRAP_INTENT", scopeRef: "PROJECT_CONTEXT", payload: payloads.intent}),
      plan: makeArtifact({binding, artifactKind: "BOOTSTRAP_PLAN", scopeRef: "PROJECT_CONTEXT", payload: payloads.plan}),
      governance: makeArtifact({binding, artifactKind: "BOOTSTRAP_GOVERNANCE", scopeRef: "PROJECT_GOVERNANCE", payload: payloads.governance}),
      boundaries: makeArtifact({binding, artifactKind: "BOOTSTRAP_BOUNDARIES", scopeRef: "PROJECT_CONTEXT", payload: payloads.boundaries}),
    };
    assert(artifacts.governance.payload_sha256 === binding.policy_sha256, "project-memory governance payload differs from the bound policy");
    const writtenArtifacts = Object.values(artifacts).map(writeArtifact);
    const records = [];
    records.push(appendRecord({
      authorityRoot, repositoryRoot, relativePath: ledgerPath, binding,
      compile: ({recordVersion, supersedesRecordSha256}) => compileProjectContextRecord({
        recordId: "BOOTSTRAP_CONTEXT",
        recordVersion,
        supersedesRecordSha256,
        binding,
        contextInputSha256: artifacts.context.payload_sha256,
        intentSha256: artifacts.intent.payload_sha256,
        planSha256: artifacts.plan.payload_sha256,
        governanceSha256: artifacts.governance.payload_sha256,
        boundarySha256: artifacts.boundaries.payload_sha256,
      }),
    }));
    projectContract.goals.forEach((goal, index) => {
      const goalArtifact = makeArtifact({binding, artifactKind: "BOOTSTRAP_GOAL", scopeRef: "PROJECT_GOAL", payload: {schema: "agentos.project_goal_payload.v1", goal}});
      const scopeArtifact = makeArtifact({binding, artifactKind: "BOOTSTRAP_GOAL_SCOPE", scopeRef: "PROJECT_GOAL", payload: {schema: "agentos.project_goal_scope_payload.v1", scope: projectContract.scope, boundaries: projectContract.boundaries}});
      const acceptanceArtifact = makeArtifact({binding, artifactKind: "BOOTSTRAP_ACCEPTANCE", scopeRef: "PROJECT_GOAL", payload: {schema: "agentos.project_acceptance_payload.v1", acceptance_conditions: projectContract.acceptance_conditions}});
      writtenArtifacts.push(writeArtifact(goalArtifact), writeArtifact(scopeArtifact), writeArtifact(acceptanceArtifact));
      records.push(appendRecord({
        authorityRoot, repositoryRoot, relativePath: ledgerPath, binding,
        compile: ({recordVersion, supersedesRecordSha256}) => compileGoalRecord({
          recordId: `BOOTSTRAP_GOAL_${String(index + 1).padStart(3, "0")}`,
          recordVersion,
          supersedesRecordSha256,
          binding,
          goalSha256: goalArtifact.payload_sha256,
          goalKind: goal.goal_kind ?? "PROJECT_OUTCOME",
          scopeSha256: scopeArtifact.payload_sha256,
          acceptanceSha256: acceptanceArtifact.payload_sha256,
        }),
      }));
    });
    projectContract.decisions.forEach((decision, index) => {
      const decisionArtifact = makeArtifact({binding, artifactKind: "BOOTSTRAP_DECISION", scopeRef: "PROJECT_DECISION", payload: {schema: "agentos.project_decision_payload.v1", decision}});
      const rationaleArtifact = makeArtifact({binding, artifactKind: "BOOTSTRAP_DECISION_RATIONALE", scopeRef: "PROJECT_DECISION", payload: {schema: "agentos.project_decision_rationale_payload.v1", rationale: {certainty: decision.certainty, provenance: decision.provenance, revision_trigger: decision.revision_trigger}}});
      writtenArtifacts.push(writeArtifact(decisionArtifact), writeArtifact(rationaleArtifact));
      records.push(appendRecord({
        authorityRoot, repositoryRoot, relativePath: ledgerPath, binding,
        compile: ({recordVersion, supersedesRecordSha256}) => compileDecisionRecord({
          recordId: `BOOTSTRAP_DECISION_${String(index + 1).padStart(3, "0")}`,
          recordVersion,
          supersedesRecordSha256,
          binding,
          decisionSha256: decisionArtifact.payload_sha256,
          decisionKind: "BOOTSTRAP_DECISION",
          selectionRef: decision.question_id,
          effectScope: ["PROJECT_CONTRACT"],
          rationaleSha256: rationaleArtifact.payload_sha256,
        }),
      }));
    });
    records.push(appendRecord({
      authorityRoot, repositoryRoot, relativePath: ledgerPath, binding,
      compile: ({recordVersion, supersedesRecordSha256}) => compilePolicyReference({
        recordId: "BOOTSTRAP_POLICY",
        recordVersion,
        supersedesRecordSha256,
        binding,
        policyEpoch: 1,
        policyKind: "BOOTSTRAP_PROJECT_CONTRACT",
      }),
    }));
    return {status: "CAPTURED", artifacts: writtenArtifacts, records};
  };

  const loadCurrent = ({observedAtUtc = new Date().toISOString()} = {}) => {
    const replay = reconstructProjectMemory({authorityRoot, repositoryRoot, relativePath: ledgerPath, binding});
    let snapshot = readProjectMemorySnapshot({authorityRoot, repositoryRoot, relativePath: snapshotPath});
    let snapshotDisposition = "CURRENT";
    if (!hasExactBinding(snapshot, binding) || snapshot.event_cursor !== replay.event_count || snapshot.event_ledger_head_sha256 !== replay.head_sha256) {
      const expectedSnapshotSha256 = snapshot?.snapshot_sha256 ?? null;
      snapshot = compileMemorySnapshot({binding, replay, observedAtUtc});
      writeProjectMemorySnapshotCompareAndSwap({
        authorityRoot,
        repositoryRoot,
        relativePath: snapshotPath,
        expectedSnapshotSha256,
        snapshot,
      });
      snapshotDisposition = "REBUILT_FROM_LEDGER";
    }
    const selectedRecords = [...replay.current_records].sort((left, right) => compareUtf8(left.record_sha256, right.record_sha256));
    const hydrated = [];
    const uncertainties = [];
    for (const record of selectedRecords) {
      for (const payloadSha256 of semanticDigestFields(record)) {
        const artifact = readProjectMemoryArtifact({authorityRoot, repositoryRoot, payloadSha256, projectRef: binding.project_ref});
        if (artifact === null) {
          uncertainties.push({code: "SEMANTIC_ARTIFACT_UNAVAILABLE", subject_ref: payloadSha256, detail: "A selected canonical memory record references an unavailable semantic artifact."});
          continue;
        }
        if (prohibited.includes(artifact.scope_ref) || !allowed.includes(artifact.scope_ref)) continue;
        hydrated.push({record_sha256: record.record_sha256, artifact});
      }
    }
    const uniqueHydrated = [...new Map(hydrated.map((entry) => [entry.artifact.payload_sha256, entry])).values()]
      .sort((left, right) => compareUtf8(left.artifact.payload_sha256, right.artifact.payload_sha256));
    const uniqueUncertainties = [...new Map(uncertainties.map((notice) => [`${notice.code}\u0000${notice.subject_ref ?? ""}\u0000${notice.detail}`, notice])).values()]
      .sort((left, right) => compareUtf8(`${left.code}\u0000${left.subject_ref ?? ""}\u0000${left.detail}`, `${right.code}\u0000${right.subject_ref ?? ""}\u0000${right.detail}`));
    const capsule = compileRoleContextCapsule({
      snapshot,
      roleRef: binding.role_ref,
      laneRef,
      selectedRecordSha256s: selectedRecords.map((record) => record.record_sha256).sort(compareUtf8),
      allowedScopeRefs: allowed,
      prohibitedScopeRefs: prohibited,
      uncertainties: uniqueUncertainties,
    });
    return {
      schema: PROJECT_MEMORY_RUNTIME_SCHEMA,
      status: capsule.status,
      snapshot_disposition: snapshotDisposition,
      ledger_head_sha256: replay.head_sha256,
      event_count: replay.event_count,
      replay,
      snapshot,
      capsule,
      semantic_context: uniqueHydrated,
    };
  };

  const inspect = () => {
    const replay = reconstructProjectMemory({authorityRoot, repositoryRoot, relativePath: ledgerPath, binding});
    return Object.freeze({
      schema: PROJECT_MEMORY_RUNTIME_SCHEMA,
      status: replay.status,
      project_ref: binding.project_ref,
      event_count: replay.event_count,
      ledger_head_sha256: replay.head_sha256,
      semantic_hydration_enabled: true,
      contract_status: "PREPARED_NOT_ACTIVATED",
    });
  };

  return Object.freeze({
    binding: structuredClone(binding),
    captureBootstrapContract,
    loadCurrent,
    inspect,
  });
}

export function assertProjectMemoryRuntimeReady(runtimeState) {
  assert(runtimeState?.schema === PROJECT_MEMORY_RUNTIME_SCHEMA, "project-memory runtime state is invalid");
  assert(runtimeState.status === "READY", `project-memory runtime is not ready: ${runtimeState.status}`);
  requireSha(runtimeState.ledger_head_sha256, "project-memory runtime ledger head");
  assert(runtimeState.semantic_context.length > 0, "project-memory runtime has no hydrated semantic context");
  return runtimeState;
}

export function initializeBootstrapProjectMemory({projectContract, observedAtUtc, ...runtimeOptions} = {}) {
  const runtime = createProjectMemoryRuntime(runtimeOptions);
  const capture = runtime.captureBootstrapContract({projectContract});
  const state = runtime.loadCurrent({observedAtUtc});
  return Object.freeze({runtime, capture, state});
}

export function compileProjectMemoryTaskContext({
  memoryState,
  taskRefSha256,
  goalRefSha256,
  capturedAtUtc,
  expiresAtUtc = null,
} = {}) {
  assertProjectMemoryRuntimeReady(memoryState);
  requireSha(taskRefSha256, "project-memory task context task reference");
  requireSha(goalRefSha256, "project-memory task context goal reference");
  const sourceBindingSha256 = canonicalDigest(memoryState.capsule.project_ref === undefined
    ? memoryState.replay.binding
    : {
      project_ref: memoryState.capsule.project_ref,
      campaign_ref: memoryState.capsule.campaign_ref,
      goal_ref: memoryState.capsule.goal_ref,
      role_ref: memoryState.capsule.role_ref,
      source_commit: memoryState.capsule.source_commit,
      source_tree: memoryState.capsule.source_tree,
      source_snapshot_sha256: memoryState.capsule.source_snapshot_sha256,
      policy_sha256: memoryState.capsule.policy_sha256,
      handoff_sha256: memoryState.capsule.handoff_sha256,
    });
  const projectContextSha256 = memoryState.capsule.context_record_sha256 ?? memoryState.capsule.snapshot_sha256;
  const items = memoryState.semantic_context.map((entry, index) => compileTaskContextItem({
    itemRefSha256: entry.artifact.payload_sha256,
    sourceBindingSha256,
    projectContextSha256,
    taskRefSha256,
    goalRefSha256,
    authority: "MEMORY_AUTHORITY",
    contentClass: "MEMORY_RECORD",
    capturedAtUtc,
    expiresAtUtc,
    tokenCount: Math.max(1, Math.ceil(JSON.stringify(entry.artifact.payload).length / 4)),
    relation: "PROJECT_RELEVANT",
    memoryAuthorized: true,
    safeLabel: `MEMORY_${String(index + 1).padStart(3, "0")}_${entry.artifact.artifact_kind}`,
    content: entry.artifact.payload,
  }));
  return Object.freeze({
    schema: "agentos.project_memory_task_context.v1",
    status: "READY",
    source_binding_sha256: sourceBindingSha256,
    project_context_sha256: projectContextSha256,
    items,
    transient_payloads: memoryState.semantic_context.map((entry) => ({
      item_ref_sha256: entry.artifact.payload_sha256,
      payload: structuredClone(entry.artifact.payload),
    })),
  });
}

export function importProjectMemoryCapsuleAuthoritatively({
  capsule,
  authorityRoot,
  repositoryRoot = process.cwd(),
  destinationBinding = null,
  ownerDecisionDigest = null,
  ledgerPath = "ledgers/project-memory-events.jsonl",
} = {}) {
  validateProjectMemoryCapsule(capsule);
  const prepared = prepareProjectMemoryCapsuleImport(capsule, {destinationBinding, ownerDecisionDigest});
  assert(prepared.status === "READY_TO_REPLAY", "project-memory capsule requires binding reconciliation before authoritative import");
  const binding = prepared.destination_binding;
  const destination = readProjectMemoryLedger({authorityRoot, repositoryRoot, relativePath: ledgerPath, binding});
  const sharedLength = Math.min(destination.events.length, capsule.events.length);
  for (let index = 0; index < sharedLength; index += 1) {
    assert(destination.events[index].event_sha256 === capsule.events[index].event_sha256, `project-memory capsule diverges from destination at event ${index}`);
  }
  assert(destination.events.length <= capsule.events.length, "project-memory destination has unrepresented later events");
  let headSha256 = destination.head_sha256;
  let appended = 0;
  for (const event of capsule.events.slice(destination.events.length)) {
    const result = appendProjectMemoryEvent({
      authorityRoot,
      repositoryRoot,
      relativePath: ledgerPath,
      expectedHeadSha256: headSha256,
      event,
    });
    headSha256 = result.head_sha256;
    appended += result.status === "APPENDED" ? 1 : 0;
  }
  const readback = readProjectMemoryLedger({authorityRoot, repositoryRoot, relativePath: ledgerPath, binding});
  assert(readback.event_count === capsule.events.length && readback.head_sha256 === (capsule.events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256), "project-memory capsule authoritative import readback mismatch");
  const receipt = {
    schema: "agentos.project_memory_capsule_import_receipt.v1",
    status: appended === 0 ? "IDEMPOTENT_REPLAY" : "IMPORTED",
    capsule_id: capsule.capsule_id,
    capsule_sha256: capsule.capsule_sha256,
    appended_event_count: appended,
    destination_event_count: readback.event_count,
    destination_head_sha256: readback.head_sha256,
    project_tree_touched: false,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null});
  return receipt;
}

export const PROJECT_MEMORY_RUNTIME_API = Object.freeze({
  compileBootstrapProjectMemoryBinding,
  createProjectMemoryRuntime,
  assertProjectMemoryRuntimeReady,
  initializeBootstrapProjectMemory,
  compileProjectMemoryTaskContext,
  importProjectMemoryCapsuleAuthoritatively,
});
