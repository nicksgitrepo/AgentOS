#!/usr/bin/env node
import {
  classifyIntentChange,
  compileIntentEnvelope,
} from "./intent-scope.mjs";
import {
  compileBootstrapContext,
} from "./bootstrap-context.mjs";
import {buildConversationTurn} from "./user-conversation.mjs";
import {assertUniversalDevelopmentMode} from "../governance-library.mjs";
import {admitRole} from "./role-routing.mjs";
import {recordProgress} from "./progress-health.mjs";
import {
  evaluateThinWorkflow,
  THIN_WORKFLOW_OUTCOMES,
} from "./functionality.mjs";
import {renderOwnerSurface} from "./ui-ux.mjs";
import {
  CODE_HYGIENE_ALLOWED_PATHS,
  compileHygieneResult,
  EXACT_LANE_PATHS,
} from "./code-hygiene.mjs";
import {scanPublicPayload} from "./security-privacy.mjs";
import {
  compileEvidenceReceipt,
  verifyHostAuthority,
  verifyEvidenceReceipt,
} from "./evidence-identity.mjs";
import {routeBoundary} from "./recovery-boundaries.mjs";
import {validateSchedulerAdmissionReceipt} from "../scheduler-admission.mjs";
import {
  completeTemporaryWorker,
  DELIVERY_CLOSURE_LIFECYCLE,
} from "./delivery-closure.mjs";
import {normalizeSchedulerTerminalReceipt} from "./verification-handoff.mjs";
export {
  compileVerificationHandoff,
  normalizeSchedulerTerminalReceipt,
  runBoundedVerification,
  validateVerificationHandoff,
  VERIFICATION_CHECKS,
  VERIFICATION_HANDOFF_SCHEMA,
  VERIFICATION_HANDOFF_STATUSES,
} from "./verification-handoff.mjs";
export const RAPID_PROTOTYPE_SCHEMA = "agentos.rapid_prototype_slice.v1";
export const RAPID_PROTOTYPE_ROLE = "RAPID_SLICE_BUILDER";
export const RAPID_PROTOTYPE_CHANGED_PATHS = Object.freeze([
  "control/rapid-prototype/index.mjs",
  "tests/verify-rapid-prototype.mjs",
]);
export const RAPID_PROTOTYPE_PLAN_DIGESTS = Object.freeze({
  public_plan: "b2b22548811348bc68a0a2cd59bd71dba297020e33eb8606a2b572e725aceb4f",
  rapid_machine_contract: "f7b4eb910a20ef0fa738ecc78362d9ac068ec4f60f1242d043a9fa6fa542a9f2",
  bootstrap_contract: "69e77910d36624bbb02d02706a6de3dc5a27d70ebdcc7f3ad44600af9b243737",
  workflow_registry: "e87401cd30edc55695660aa37216aae907453554759163c571d597e24af38325",
  native_session_controller: "6d410e6bfbb85f6a3a1e92ffdb30385dec4a77a328efae56fc976648a8a98370",
});
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const DEFAULT_SOURCE_BINDING = Object.freeze({
  project_id: "synthetic-project",
  cwd: "synthetic-project-root",
  git_top_level: "synthetic-project-root",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
});
const DEFAULT_ROLE_IDENTITY = Object.freeze({
  sessionId: "rapid-slice-builder-synthetic",
  projectId: "synthetic-project",
  cwd: "synthetic-project-root",
  verified: true,
});
const DEFAULT_TIMES = Object.freeze({
  startedAt: "2026-08-04T12:00:00.000Z",
  observedAt: "2026-08-04T12:05:00.000Z",
  deadline: "2026-08-04T13:00:00.000Z",
});
const DEFAULT_INTENT = Object.freeze({
  goal: "Complete one bounded local governance workflow",
  workflow: [
    "bind the source",
    "run the focused check",
    "preserve the typed handoff",
  ],
  inScope: [
    "deterministic local evaluation",
    "plain owner-facing status",
    "review-ready evidence",
  ],
  outOfScope: [
    "external actions",
    "publication",
    "deployment",
  ],
  acceptance: [
    "the first useful workflow is checkable",
    "the independent check remains requested",
  ],
  protectedBoundaries: [
    "no secrets",
    "no external effects",
    "source mismatch fails closed",
  ],
  assumptions: [
    "the source readback is current",
    "the host supplies the admitted local input",
  ],
});
const FUNCTIONALITY_ROLE = "IMPLEMENTATION_FUNCTIONALITY";
const FUNCTIONALITY_TOPOLOGY = "INDEPENDENT_SIBLING_SESSION";
const LANE_HYGIENE_PATHS = Object.freeze([...EXACT_LANE_PATHS]);
const DECISION_CASES = Object.freeze([
  {id: "READY", decision: {status: "READY", check: {status: "PASS"}}},
  {id: "QUESTION", decision: {status: "QUESTION"}},
  {id: "PUZZLE", decision: {status: "PUZZLE"}},
  {id: "SOFT_REVIEW", decision: {status: "SOFT_REVIEW"}},
  {id: "UNAVAILABLE", decision: {status: "UNAVAILABLE"}},
  {id: "HARD_STOP", decision: {status: "HARD_STOP"}},
]);
const BOUNDARY_CASES = Object.freeze([
  {id: "PUZZLE_CLARIFICATION", condition: "PUZZLE"},
  {id: "PUZZLE_SAFE_DEFAULT", condition: "PUZZLE_SAFE_DEFAULT"},
  {id: "SOFT_REVIEW", condition: "SOFT_REVIEW"},
  {id: "HARD_STOP", condition: "HARD_STOP"},
  {id: "UNAVAILABLE", condition: "UNAVAILABLE"},
]);
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
function firstDefined(record, names, fallback = undefined) {
  if (!isRecord(record)) return fallback;
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  return fallback;
}
function sourceValue(source, names, fallback = undefined) {
  return firstDefined(source, names, fallback);
}
function publicDigest(value) {
  return typeof value === "string" && SHA256.test(value) ? value : null;
}
function safeDigestSet(input) {
  const supplied = isRecord(input) ? input : {};
  const aliases = {
    public_plan: ["public_plan", "publicPlan", "plan_digest", "planDigest"],
    rapid_machine_contract: ["rapid_machine_contract", "rapidMachineContract", "contract_digest", "contractDigest"],
    bootstrap_contract: ["bootstrap_contract", "bootstrapContract"],
    workflow_registry: ["workflow_registry", "workflowRegistry"],
    native_session_controller: ["native_session_controller", "nativeSessionController", "controller_digest", "controllerDigest"],
  };
  const result = {...RAPID_PROTOTYPE_PLAN_DIGESTS};
  const mismatches = [];
  for (const [key, names] of Object.entries(aliases)) {
    const candidate = firstDefined(supplied, names);
    if (candidate === undefined) continue;
    if (!publicDigest(candidate)) {
      mismatches.push(key);
      continue;
    }
    if (candidate !== RAPID_PROTOTYPE_PLAN_DIGESTS[key]) mismatches.push(key);
    else result[key] = candidate;
  }
  return {result, mismatches};
}
function sourceBindings(input) {
  const direct = input.source_binding ?? input.sourceBinding ?? input.source ?? {};
  const expected = firstDefined(direct, [
    "expected",
    "expected_source_binding",
    "expectedSourceBinding",
  ], input.expected_source_binding ?? input.expectedSourceBinding);
  const observed = firstDefined(direct, [
    "observed",
    "observed_source_binding",
    "observedSourceBinding",
  ], input.observed_source_binding ?? input.observedSourceBinding);
  if (expected !== undefined || observed !== undefined) {
    return {
      expected: expected ?? {},
      observed: observed ?? {},
    };
  }
  if (isRecord(direct) && Object.keys(direct).length > 0) {
    return {expected: direct, observed: clone(direct)};
  }
  return {
    expected: clone(DEFAULT_SOURCE_BINDING),
    observed: clone(DEFAULT_SOURCE_BINDING),
  };
}
function intentFields(value) {
  if (!isRecord(value)) return {};
  const fields = {};
  const aliases = [
    ["goal", ["goal"]],
    ["workflow", ["workflow"]],
    ["inScope", ["inScope", "in_scope"]],
    ["outOfScope", ["outOfScope", "out_of_scope"]],
    ["acceptance", ["acceptance"]],
    ["protectedBoundaries", ["protectedBoundaries", "protected_boundaries"]],
    ["assumptions", ["assumptions"]],
  ];
  for (const [field, names] of aliases) {
    const valueForField = firstDefined(value, names);
    if (valueForField !== undefined) fields[field] = clone(valueForField);
  }
  return fields;
}
function compileIntent(value) {
  return compileIntentEnvelope({
    ...DEFAULT_INTENT,
    ...intentFields(value),
  });
}
function compileCandidateIntent(value, baseline) {
  if (value === undefined || value === null) return baseline;
  const candidate = compileIntentEnvelope({
    ...intentFields(baseline),
    ...intentFields(value),
  });
  for (const field of [
    "puzzle",
    "repair",
    "reversible_problem",
    "soft_review",
    "softReview",
    "policy",
    "condition",
    "conditions",
    "source_condition",
    "operating_condition",
    "scope_changed",
    "intent_changed",
    "policy_changed",
    "condition_changed",
    "source_changed",
    "boundary_crossed",
    "conflict",
    "owner_decision_required",
    "unavailable",
    "classification",
    "change_classification",
    "change_type",
    "change_kind",
    "kind",
    "type",
    "event_type",
  ]) {
    if (Object.hasOwn(value, field)) candidate[field] = clone(value[field]);
  }
  for (const field of ["intent_envelope_sha256", "intentEnvelopeSha256"]) {
    if (Object.hasOwn(value, field)) candidate.intent_envelope_sha256 = value[field];
  }
  return candidate;
}
function roleOptions(input, source) {
  const supplied = input.role_admission ?? input.roleAdmission ?? {};
  const expectedProject = firstDefined(supplied, ["expectedProject", "expected_project"], sourceValue(source.expected, ["project_id", "projectId", "project"], DEFAULT_SOURCE_BINDING.project_id));
  const expectedCwd = firstDefined(supplied, ["expectedCwd", "expected_cwd"], sourceValue(source.expected, ["cwd", "working_directory", "workingDirectory"], DEFAULT_SOURCE_BINDING.cwd));
  const sessionIdentity = firstDefined(supplied, ["sessionIdentity", "session_identity"], {
    ...DEFAULT_ROLE_IDENTITY,
    projectId: expectedProject,
    cwd: expectedCwd,
  });
  return {
    role: supplied.role ?? RAPID_PROTOTYPE_ROLE,
    admittedRoles: supplied.admittedRoles ?? supplied.admitted_roles ?? [RAPID_PROTOTYPE_ROLE],
    sessionIdentity,
    expectedProject,
    expectedCwd,
    topology: supplied.topology ?? "INDEPENDENT_SIBLING_SESSION",
  };
}
function summarizeRoleAdmission(admission) {
  if (!admission) return {status: "NOT_ADMITTED", admitted: false, role: null, topology: null};
  return {
    status: admission.status,
    admitted: admission.admitted,
    role: admission.role,
    topology: admission.topology,
  };
}
function progressOptions(input) {
  const supplied = input.progress_options ?? input.progressOptions ?? input.progress ?? {};
  const times = input.times ?? {};
  return {
    workerIdentity: supplied.workerIdentity ?? supplied.worker_identity ?? "rapid-slice-builder-worker",
    phase: supplied.phase ?? "BUILD_THIN_WORKING_SLICE",
    meaningfulProgress: supplied.meaningfulProgress ?? supplied.meaningful_progress ?? false,
    heartbeat: supplied.heartbeat ?? true,
    startedAt: supplied.startedAt ?? supplied.started_at ?? times.startedAt ?? DEFAULT_TIMES.startedAt,
    observedAt: supplied.observedAt ?? supplied.observed_at ?? times.observedAt ?? DEFAULT_TIMES.observedAt,
    deadline: supplied.deadline ?? times.deadline ?? DEFAULT_TIMES.deadline,
    result: supplied.result ?? null,
    error: supplied.error ?? null,
    taskId: supplied.taskId ?? supplied.task_id ?? null,
    scope: supplied.scope ?? null,
    sourceCommit: supplied.sourceCommit ?? supplied.source_commit ?? null,
    sourceTree: supplied.sourceTree ?? supplied.source_tree ?? null,
    progressEvidence: supplied.progressEvidence ?? supplied.progress_evidence ?? supplied.evidence ?? null,
  };
}
function summarizeProgress(progress) {
  if (!progress) return {status: "UNAVAILABLE", progress: "NO_PROGRESS", meaningful_progress: false, liveness: "UNKNOWN", completed: false, task_id: null, scope: null, source_commit: null, source_tree: null, last_concrete_progress_identity: null, progress_evidence_digest: null};
  return {
    status: progress.status,
    progress: progress.progress,
    meaningful_progress: progress.meaningful_progress,
    liveness: progress.liveness,
    health: progress.health,
    completed: progress.completed,
    timed_out: progress.timed_out,
    task_id: progress.task_id,
    scope: clone(progress.scope),
    source_commit: progress.source_commit,
    source_tree: progress.source_tree,
    last_concrete_progress_identity: progress.progress_evidence?.identity ?? null,
    progress_evidence_digest: progress.progress_evidence_digest,
  };
}
function workflowIntent(intent, classification) {
  return {
    goal: intent.goal,
    scope: {
      in: intent.in_scope,
      out: intent.out_of_scope,
    },
    scope_changed: classification === "HARD_STOP",
    required_capabilities: ["local_check"],
  };
}
function sourceRecord(binding, verified) {
  if (!isRecord(binding)) return {verified};
  const record = {...clone(binding), verified};
  if (record.project_root === undefined && record.projectRoot === undefined) {
    record.project_root = record.cwd ?? record.working_directory ?? record.workingDirectory;
  }
  if (record.git_common_directory === undefined && record.gitCommonDirectory === undefined) {
    record.git_common_directory = record.git_top_level ?? record.gitTopLevel;
  }
  return record;
}
function functionalityContext(source, bootstrap, capabilities) {
  return {
    source_readback: sourceRecord(source.observed, bootstrap.source_binding.status === "MATCH"),
    expected_source: sourceRecord(source.expected, true),
    required_capabilities: ["local_check"],
    capabilities,
  };
}
function laneRoleAdmission(role) {
  const admission = admitRole({
    role: FUNCTIONALITY_ROLE,
    admittedRoles: [FUNCTIONALITY_ROLE],
    sessionIdentity: {
      sessionId: "functionality-lane-synthetic",
      projectId: role.expectedProject,
      cwd: role.expectedCwd,
      verified: true,
    },
    expectedProject: role.expectedProject,
    expectedCwd: role.expectedCwd,
    topology: FUNCTIONALITY_TOPOLOGY,
  });
  return {
    ...admission,
    session_id: "functionality-lane-synthetic",
    identity_verified: true,
  };
}
function decisionFor(classification, input) {
  const supplied = input.workflow_decision ?? input.workflowDecision ?? input.decision;
  if (supplied !== undefined) return isRecord(supplied) ? clone(supplied) : {status: supplied};
  if (classification === "PUZZLE") return {status: "PUZZLE"};
  if (classification === "SOFT_REVIEW") return {status: "SOFT_REVIEW"};
  if (classification === "HARD_STOP") return {status: "HARD_STOP"};
  return {status: "HARD_STOP", code: "WORKFLOW_DECISION_REQUIRED", check: {status: "UNPROVEN"}, independent_check: {status: "REQUIRED"}};
}
function outcomeStatus(outcome) {
  return {
    [THIN_WORKFLOW_OUTCOMES.READY]: "ready",
    [THIN_WORKFLOW_OUTCOMES.QUESTION]: "one-question",
    [THIN_WORKFLOW_OUTCOMES.PUZZLE]: "puzzle",
    [THIN_WORKFLOW_OUTCOMES.SOFT_REVIEW]: "soft-review",
    [THIN_WORKFLOW_OUTCOMES.UNAVAILABLE]: "unavailable",
    [THIN_WORKFLOW_OUTCOMES.HARD_STOP]: "hard-stop",
  }[outcome] ?? "hard-stop";
}
function conversationFor(outcome, input = {}) {
  const status = outcomeStatus(outcome);
  const openQuestions = input.open_questions ?? input.openQuestions ?? (
    status === "one-question" ? ["Which safe local option should continue?"] : []
  );
  const safeDefault = input.safe_default ?? input.safeDefault ?? (
    status === "ready" ? "Review the local result."
      : status === "puzzle" ? "Keep the current repair scope."
        : status === "soft-review" ? "Keep the current local arrangement."
          : null
  );
  const decision = status === "one-question" ? "SOFT_REVIEW" : status.toUpperCase().replaceAll("-", "_");
  return buildConversationTurn({
    message: input.message ?? "The bounded local check produced a typed result.",
    openQuestions,
    safeDefault,
    unavailable: status === "unavailable" ? true : null,
    decision,
  });
}
function publicSurfaceFor(outcome, conversation) {
  const status = conversation.status === "HARD_STOP"
    ? "hard-stop"
    : conversation.status === "UNAVAILABLE"
      ? "unavailable"
      : outcomeStatus(outcome);
  return renderOwnerSurface({
    status,
    message: conversation.message,
    question: conversation.question,
    options: conversation.question === null ? [] : ["Keep the current scope", "Pause for review"],
    nextStep: status === "ready" ? "Review the local result." : undefined,
  });
}
function summarizeConversation(conversation) {
  return {
    status: conversation.status,
    question: conversation.question,
    has_safe_default: conversation.safeDefault !== null,
    unavailable: conversation.unavailable,
  };
}
function summarizeSurface(surface) {
  return {
    schema: surface.schema,
    version: surface.version,
    status: surface.status,
    label: surface.label,
    message: surface.message,
    question: surface.question,
    options: [...surface.options],
    nextStep: surface.nextStep,
    text: surface.text,
  };
}
function matrixConversation(caseId, functionality) {
  const outcome = functionality.outcome;
  const conversation = conversationFor(outcome, {
    message: `The ${caseId.toLowerCase()} path has a bounded public result.`,
  });
  const surface = publicSurfaceFor(outcome, conversation);
  return {
    id: caseId,
    outcome: functionality.outcome,
    outcome_code: functionality.outcome_code,
    reason_code: functionality.reason_code,
    success: functionality.success,
    surface: summarizeSurface(surface),
  };
}
function decisionMatrix({intent, context, roleAdmission, progress}) {
  return DECISION_CASES.map(({id, decision}) => {
    const functionality = evaluateThinWorkflow({
      intent,
      context,
      roleAdmission,
      progress,
      decision,
    });
    return matrixConversation(id, functionality);
  });
}
function boundarySummary(boundary) {
  return boundary === null ? null : {
    status: boundary.status,
    route: boundary.route,
    action: boundary.action,
    next: boundary.next,
    continuation: boundary.continuation,
    requiresFreshGoal: boundary.requiresFreshGoal,
    acceptance: boundary.acceptance,
  };
}
function boundaryExamples() {
  const base = {
    scopeChanged: false,
    intentChanged: false,
    policyChanged: false,
    capabilityAvailable: true,
    identityMatch: true,
  };
  return BOUNDARY_CASES.map(({id, condition}) => ({
    id,
    ...boundarySummary(routeBoundary({...base, condition})),
  }));
}
function selectedBoundary(classification, sourceStatus, capabilityAvailable) {
  if (sourceStatus !== "MATCH") {
    return routeBoundary({
      condition: "HARD_STOP",
      scopeChanged: false,
      intentChanged: false,
      policyChanged: false,
      capabilityAvailable: capabilityAvailable === true,
      identityMatch: false,
    });
  }
  if (classification === "UNCHANGED") return null;
  const condition = classification === "PUZZLE" ? "PUZZLE"
    : classification === "SOFT_REVIEW" ? "SOFT_REVIEW"
      : "HARD_STOP";
  return routeBoundary({
    condition,
    scopeChanged: classification === "HARD_STOP",
    intentChanged: false,
    policyChanged: false,
    capabilityAvailable,
    identityMatch: true,
  });
}
function publicPayloadCandidate({surface, functionality, changedPaths, handoffStatus}) {
  void functionality;
  void handoffStatus;
  return [surface.text, ...changedPaths].join("\n");
}
function hostileSecuritySummary() {
  const hostile = scanPublicPayload("authorization: Bearer synthetic-secret-value");
  return {
    safe: hostile.safe,
    status: hostile.status,
    violations: [...hostile.violations],
    payload_sha256: hostile.payload_sha256,
  };
}
function evidenceInputs(input, source, sourceStatus, digests, behaviorStatus, sourceCommit, sourceTree, authority) {
const suppliedSource = authority?.sourceReadback ?? input.evidence_source_readback ?? input.evidenceSourceReadback;
assert(suppliedSource !== null && typeof suppliedSource === "object" && !Array.isArray(suppliedSource), "authoritative source readback is required", "EVIDENCE_UNAVAILABLE");
const evidenceSource = suppliedSource;
const schedulerReceipt = authority?.schedulerTerminalReceipt ?? input.scheduler_terminal_receipt ?? input.schedulerTerminalReceipt ?? null;
const schedulerAdmission = authority?.schedulerAdmissionReceipt ?? input.scheduler_admission_receipt ?? input.schedulerAdmissionReceipt ?? null;
let schedulerEvidenceVerified = false;
try {
  normalizeSchedulerTerminalReceipt(schedulerReceipt, {sourceCommit, sourceTree, requestId: schedulerAdmission?.request_id ?? null});
  validateSchedulerAdmissionReceipt(schedulerAdmission, {candidateCommit: sourceCommit, candidateTree: sourceTree});
  schedulerEvidenceVerified = true;
} catch {
  schedulerEvidenceVerified = false;
}
const schedulerEvidenceReady = schedulerReceipt !== null
  && typeof schedulerReceipt === "object"
  && schedulerReceipt.status === "PASS"
  && schedulerReceipt.source_commit === sourceCommit
  && schedulerReceipt.source_tree === sourceTree
  && schedulerAdmission !== null
  && typeof schedulerAdmission === "object"
  && schedulerAdmission.status === "READY"
  && schedulerAdmission.candidate_commit === sourceCommit
  && schedulerAdmission.candidate_tree === sourceTree;
  const suppliedProject = authority?.projectIdentity ?? input.evidence_project_identity ?? input.evidenceProjectIdentity;
  const evidenceProject = suppliedProject ?? {
    projectId: "source-bound-project",
    projectRoot: evidenceSource.pwd ?? evidenceSource.cwd,
    gitTopLevel: evidenceSource.gitTopLevel ?? evidenceSource.git_top_level,
    environment: "LOCAL_PROJECT",
  };
  return {
    sourceReadback: evidenceSource,
    projectIdentity: evidenceProject,
    task: {
      taskId: "TASK-RAPID-SLICE-BUILDER",
      role: RAPID_PROTOTYPE_ROLE,
      allowedChangedPaths: RAPID_PROTOTYPE_CHANGED_PATHS,
    },
    goal: {
      goalId: "GOAL-RAPID-SLICE-BUILDER",
      summary: "Assemble one bounded local governance workflow.",
    },
    changedPaths: RAPID_PROTOTYPE_CHANGED_PATHS,
    behaviorResult: {
      status: behaviorStatus,
      summary: behaviorStatus === "PASS"
        ? "The first useful local workflow is ready for independent review."
        : "The local workflow remains blocked at a typed boundary.",
    },
focusedCheck: {
  test: "node tests/verify-rapid-prototype.mjs",
      status: schedulerEvidenceVerified ? "PASS" : "UNPROVEN",
      sourceCommit,
      sourceTree,
      summary: "The end-to-end focused check passed its ready, boundary, privacy, evidence, and closure cases.",
    },
    hostileCoverage: [
      {id: "H-01", disposition: "source mismatch fails closed"},
      {id: "H-02", disposition: "hard boundary does not continue"},
      {id: "H-03", disposition: "public leakage is rejected"},
      {id: "H-04", disposition: "altered evidence is not verified"},
      {id: "H-05", disposition: "closure order and zero-active state are checked"},
    ],
    handoff: {
      status: behaviorStatus === "PASS" ? "READY_FOR_INDEPENDENT_CLEARANCE" : "BLOCKED",
      independentCheck: "REQUESTED",
      nextHandoff: "INDEPENDENT_AUDITOR",
    },
    relevantDigests: digests,
    source,
  };
}
function makeTypedHandoff({source, progress, functionality, evidenceDigest}) {
  return {
    schema: "DELIVERY_AND_CLOSURE_HANDOFF_V1",
    status: functionality.success ? "READY_FOR_INDEPENDENT_CLEARANCE" : "BLOCKED",
    public_lane: "Delivery and closure",
    task_scope: {
      in_scope: ["local governance evaluation", "review-ready evidence"],
      out_of_scope: ["external actions", "publication", "deployment"],
      changed_paths: [...RAPID_PROTOTYPE_CHANGED_PATHS],
    },
    source_binding: {
      commit: sourceValue(source.observed, ["source_commit", "sourceCommit", "head", "commit"]),
      tree: sourceValue(source.observed, ["source_tree", "sourceTree", "tree"]),
      result: "MATCH",
    },
    progress: {
      state: progress.meaningful_progress ? "MEANINGFUL" : "IN_PROGRESS",
      summary: progress.meaningful_progress
        ? "The assembled path made meaningful local progress."
        : "The assembled path has not shown meaningful progress.",
    },
    result: {
      local_review: functionality.success ? "READY" : "NOT_READY",
      external_effects: "NONE",
    },
    independent_check: {
      status: "REQUESTED",
      evidence_digest: evidenceDigest,
    },
    closure: {
      handoff_preserved: false,
      temporary_work: "PENDING",
      active_temporary_count: 1,
      receipt_digest: null,
    },
    iteration: {items: []},
    open_risks: ["Independent check remains outstanding."],
    next_handoff: "INDEPENDENT_AUDITOR",
    clearance: "NOT_CLAIMED",
  };
}
function closureSummary(result) {
  if (!result) return {status: "NOT_RUN", code: "CLOSURE_NOT_REQUESTED", handoff_preserved: false, active_workers_for_worker: null, lifecycle: [], universal_closeout_receipts: null};
  return {
    status: result.status,
    code: result.code ?? null,
    phase: result.phase ?? null,
    handoff_preserved: result.preserved_handoff === true || result.receipt?.handoff_preserved === true,
    receipt_status: result.receipt?.status ?? null,
    active_workers_for_worker: result.receipt?.active_workers_for_worker ?? result.closure?.active_workers_for_worker ?? null,
    lifecycle: result.lifecycle ? [...result.lifecycle] : result.receipt?.lifecycle ? [...result.receipt.lifecycle] : [],
    universal_closeout_receipts: result.universal_closeout_receipts ? structuredClone(result.universal_closeout_receipts) : null,
  };
}
function failureResult(code, digests = RAPID_PROTOTYPE_PLAN_DIGESTS) {
  return {
    schema: RAPID_PROTOTYPE_SCHEMA,
    version: 1,
    status: "HARD_STOP",
    code,
    accepted: false,
    role: RAPID_PROTOTYPE_ROLE,
    changed_paths: [...RAPID_PROTOTYPE_CHANGED_PATHS],
    digests: clone(digests),
    handoff: null,
    closure: closureSummary(null),
    independent_check: "REQUESTED",
  };
}
async function runRapidPrototypeInternal(input) {
  assertUniversalDevelopmentMode("RAPID_PROTOTYPE");
  const {result: digests, mismatches} = safeDigestSet(input.digests ?? input.planDigests ?? {});
  if (mismatches.length > 0) return failureResult("CONTRACT_DIGEST_MISMATCH", digests);
  const source = sourceBindings(input);
  const intent = compileIntent(input.intent);
  const candidate = compileCandidateIntent(input.candidate_intent ?? input.candidateIntent ?? input.intent_candidate ?? input.intentCandidate, intent);
  const classification = classifyIntentChange({baseline: intent, candidate});
  const sourceExpectedProject = sourceValue(source.expected, ["project_id", "projectId", "project"]);
  const sourceExpectedCwd = sourceValue(source.expected, ["cwd", "working_directory", "workingDirectory"]);
  const sourceStatusProbe = sourceValue(source.observed, ["project_id", "projectId", "project"]) !== undefined
    && sourceValue(source.observed, ["cwd", "working_directory", "workingDirectory"]) !== undefined;
  const bootstrap = compileBootstrapContext({
    expected: source.expected,
    observed: source.observed,
    planDigest: digests.public_plan,
    contractDigest: digests.rapid_machine_contract,
    nativeSessionControllerDigest: digests.native_session_controller,
    boundedChecks: [
      {
        name: "source-binding-readback",
        status: sourceStatusProbe ? "PASS" : "UNAVAILABLE",
        evidence_digest: digests.bootstrap_contract,
      },
      {
        name: "rapid-contract-readback",
        status: "PASS",
        evidence_digest: digests.rapid_machine_contract,
      },
      {
        name: "workflow-registry-readback",
        status: "PASS",
        evidence_digest: digests.workflow_registry,
      },
    ],
  });
  const sourceMatch = bootstrap.source_binding.status === "MATCH";
  const suppliedRole = roleOptions(input, source);
  const roleBindingMatches = sourceExpectedProject === undefined || sourceExpectedCwd === undefined
    ? true
    : suppliedRole.expectedProject === sourceExpectedProject && suppliedRole.expectedCwd === sourceExpectedCwd;
  const authority = verifyHostAuthority({input, source, suppliedRole});
  let roleAdmission = null;
  if (sourceMatch && roleBindingMatches) roleAdmission = admitRole(suppliedRole);
  const roleSummary = summarizeRoleAdmission(roleAdmission);
  const progress = recordProgress(progressOptions(input));
  const capabilities = input.capabilities ?? input.availableCapabilities ?? ["local_check"];
  const workflow = workflowIntent(intent, classification);
  const laneAdmission = sourceMatch && roleBindingMatches ? laneRoleAdmission(suppliedRole) : null;
  const functionalityInput = {
    intent: workflow,
    context: functionalityContext(source, bootstrap, capabilities),
    roleAdmission: laneAdmission,
    progress,
    decision: decisionFor(classification, input),
  };
  const functionality = evaluateThinWorkflow(functionalityInput);
  const conversation = conversationFor(functionality.outcome, input);
  const candidateSurface = publicSurfaceFor(functionality.outcome, conversation);
  const publicCandidate = publicPayloadCandidate({
    surface: candidateSurface,
    functionality,
    changedPaths: RAPID_PROTOTYPE_CHANGED_PATHS,
    handoffStatus: functionality.success ? "READY_FOR_INDEPENDENT_CLEARANCE" : "BLOCKED",
  });
  const publicScan = scanPublicPayload(publicCandidate, [], true);
  const surface = publicScan.safe && authority.verified
    ? candidateSurface
    : renderOwnerSurface({status: publicScan.safe ? "unavailable" : "hard-stop"});
  const hygieneInput = input.hygiene_changed_paths ?? input.hygieneChangedPaths ?? LANE_HYGIENE_PATHS;
  const hygiene = compileHygieneResult({
    changedPaths: hygieneInput,
    allowedPaths: CODE_HYGIENE_ALLOWED_PATHS,
  });
  const selected = selectedBoundary(classification, bootstrap.source_binding.status, Array.isArray(capabilities) && capabilities.includes("local_check"));
  const recovery = {
    selected: boundarySummary(selected),
    examples: boundaryExamples(),
  };
  const sourceCommit = sourceValue(source.observed, ["source_commit", "sourceCommit", "head", "commit"]);
  const sourceTree = sourceValue(source.observed, ["source_tree", "sourceTree", "tree"]);
const schedulerTerminalReceipt = authority?.schedulerTerminalReceipt ?? input.scheduler_terminal_receipt ?? input.schedulerTerminalReceipt ?? null;
const schedulerAdmissionReceipt = authority?.schedulerAdmissionReceipt ?? input.scheduler_admission_receipt ?? input.schedulerAdmissionReceipt ?? null;
let normalizedSchedulerTerminalReceipt = null;
try {
  normalizedSchedulerTerminalReceipt = normalizeSchedulerTerminalReceipt(schedulerTerminalReceipt, {sourceCommit, sourceTree, requestId: schedulerAdmissionReceipt?.request_id ?? null});
} catch {
  normalizedSchedulerTerminalReceipt = null;
}
const schedulerReady = normalizedSchedulerTerminalReceipt !== null;
let schedulerAdmissionReady = false;
try {
  validateSchedulerAdmissionReceipt(schedulerAdmissionReceipt, {candidateCommit: sourceCommit, candidateTree: sourceTree});
  schedulerAdmissionReady = true;
} catch {
  schedulerAdmissionReady = false;
}
const coreReady = bootstrap.status === "READY"
    && sourceMatch
    && roleAdmission?.admitted === true
    && progress.completed === true
    && progress.meaningful_progress === true
    && functionality.success === true
    && hygiene.status === "CLEAN"
    && publicScan.safe === true
  && authority.verified === true
  && schedulerReady
  && schedulerAdmissionReady;
  let evidence = {
    status: "NOT_COMPILED",
    verified: false,
    receipt_sha256: null,
    relevant_digests: digests,
  };
  let evidenceReceipt = null;
  if (coreReady && GIT_OBJECT.test(sourceCommit ?? "") && GIT_OBJECT.test(sourceTree ?? "")) {
    try {
      const inputs = evidenceInputs(input, source, bootstrap.source_binding.status, digests, "PASS", sourceCommit, sourceTree, authority);
      evidenceReceipt = compileEvidenceReceipt(inputs);
      evidenceReceipt = verifyEvidenceReceipt(evidenceReceipt);
      evidence = {
        status: "VERIFIED",
        verified: true,
        authority_status: authority.status,
        receipt_sha256: evidenceReceipt.receipt_sha256,
        relevant_digests: digests,
      };
    } catch {
      evidence = {
        status: "HARD_STOP",
        verified: false,
        authority_status: authority.status,
        receipt_sha256: null,
        relevant_digests: digests,
      };
    }
  }
  let handoff = null;
  let closureResult = null;
  if (coreReady && evidence.verified) {
    handoff = makeTypedHandoff({source, progress: summarizeProgress(progress), functionality, evidenceDigest: evidence.receipt_sha256});
    const closureInput = input.closure ?? {};
    const host = closureInput.host ?? input.host;
    const activeRoster = closureInput.activeRoster ?? closureInput.active_roster ?? input.activeRoster ?? input.active_roster;
    const threadId = closureInput.threadId ?? closureInput.thread_id ?? input.threadId ?? input.thread_id;
    const hostId = closureInput.hostId ?? closureInput.host_id ?? input.hostId ?? input.host_id;
    if (host !== undefined && activeRoster !== undefined && threadId !== undefined && hostId !== undefined) {
      closureResult = await completeTemporaryWorker({
        threadId,
        hostId,
        handoff,
        activeRoster,
        host,
        universalCloseoutEvidence: closureInput.universalCloseoutEvidence
          ?? closureInput.universal_closeout_evidence
          ?? input.universalCloseoutEvidence
          ?? input.universal_closeout_evidence
          ?? null,
      });
    }
  }
  const closure = closureSummary(closureResult);
  const ready = coreReady && evidence.verified && closure.status === "CLOSED";
  const status = ready
    ? "READY_FOR_INDEPENDENT_CLEARANCE"
    : bootstrap.source_binding.status !== "MATCH" || functionality.outcome_code === "HARD_STOP" || !publicScan.safe || hygiene.status === "HARD_STOP"
      ? "BLOCKED"
      : "UNAVAILABLE";
  return {
    schema: RAPID_PROTOTYPE_SCHEMA,
    version: 1,
    status,
    accepted: false,
    role: RAPID_PROTOTYPE_ROLE,
    changed_paths: [...RAPID_PROTOTYPE_CHANGED_PATHS],
    intent: {
      classification,
      envelope_sha256: intent.intent_envelope_sha256,
      candidate_envelope_sha256: candidate.intent_envelope_sha256,
    },
    bootstrap,
    role_admission: roleSummary,
    progress: summarizeProgress(progress),
    functionality: {
      outcome: functionality.outcome,
      outcome_code: functionality.outcome_code,
      success: functionality.success,
      reason_code: functionality.reason_code,
      acceptance: functionality.acceptance,
      evidence: functionality.evidence,
    },
    conversation: summarizeConversation(conversation),
    surface: summarizeSurface(surface),
    decision_matrix: decisionMatrix(functionalityInput),
    hygiene,
    security: {
      public_scan: publicScan,
      hostile: hostileSecuritySummary(),
    },
    recovery,
    evidence,
    evidence_authority: {
      status: authority.status,
      verified: authority.verified,
    },
    handoff,
    closure,
    lifecycle: [...DELIVERY_CLOSURE_LIFECYCLE],
    independent_check: "REQUESTED",
    digests,
  };
}
export async function runRapidPrototype(input = {}) {
  try {
    return await runRapidPrototypeInternal(isRecord(input) ? input : {});
  } catch {
    return failureResult("RAPID_PROTOTYPE_INPUT_INVALID");
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write("rapid prototype slice assembler loaded\n");
}
