#!/usr/bin/env node

import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendLivingCampaignEvent,
  applyCampaignTransition,
  campaignDigest,
  classifyRequiredSeamReviews,
  compileChangeManifest,
  compileCompactEvent,
  compileDependencyOrder,
  compileLivingCampaignEvent,
  compileLivingCampaignView,
  decideHeartbeatAction,
  validateCampaignState,
  validateCompactEvent,
  validateLivingCampaignLedger,
  readLivingCampaignLedger,
  validateSeamReviewBatch,
  writeStateCompareAndSwap,
} from "../control/campaign-controller.mjs";
import {compileProductAcceptanceProof} from "../control/acceptance-bridge.mjs";
import {
  compileQuestionTree,
  sha256 as questionTreeSha256,
} from "../control/question-tree.mjs";
import {
  AUDIT_DISCIPLINES,
  cascadeDigest,
  compileAuditPlan,
  compileAuditReport,
  compileDeltaAudit,
  compileFirstPassCandidate,
  compileModelPolicy,
  completeCampaignFinalizer,
  openCampaignFinalizer,
  reconcileAuditFindings,
} from "../control/campaign-cascade.mjs";

const sha = "a".repeat(64);
const validState = {
  schema: "governance.portable_campaign_state.v1",
  campaign_id: "campaign-001",
  campaign_version: "001",
  governance_version: "2.1rc",
  status: "OPEN",
  snapshot_sequence: 7,
  snapshot_at: "2026-01-01T00:14:00.000Z",
  configuration_snapshot_sha256: "b".repeat(64),
  progress_interval_minutes: 15,
  gpt_assist_mode: "GPT_ASSIST",
  authority_writer_role: "GLOBAL_ORCHESTRATOR",
  standard_authority: {
    release_identity: "release-previous",
    meaning: "LAST_ACCEPTED_LIVE_RELEASE",
  },
  active_campaign_article: "campaigns/campaign-001/current.md",
  living_record: {
    events_root: "campaigns/campaign-001/events",
    current_view_path: "campaigns/campaign-001/current.md",
    event_count: 1,
    ledger_sha256: "c".repeat(64),
    writer_heads: {"session-orchestrator": "d".repeat(64)},
    current_view_sha256: "e".repeat(64),
  },
  topology: "SINGLE_CUMULATIVE_ROOT",
  dependency_nodes: [
    {node_id: "x", owner_role_id: "feature-x", depends_on: []},
    {node_id: "z", owner_role_id: "feature-z", depends_on: ["x"]},
    {node_id: "y", owner_role_id: "feature-y", depends_on: ["z"]},
  ],
  dependency_order: ["x", "z", "y"],
  root: {
    root_id: "root-001",
    branch: "campaign/campaign-001",
    commit: "commit-001",
    tree: "tree-001",
    remote_commit: "commit-001",
    remote_tree: "tree-001",
    clean: false,
    pushed: false,
  },
  active_goal: {
    goal_id: "goal-x-build",
    goal_system_id: "host-goal-001",
    stage: "BUILD",
    owner_role_id: "feature-x",
    dependency_node_id: "x",
    status: "ACTIVE",
    instruction_sha256: sha,
    done_when_sha256: sha,
    started_at: "2026-01-01T00:00:00.000Z",
    completion_receipt_sha256: null,
  },
  lease: {
    lease_id: "lease-001",
    holder_role_id: "feature-x",
    root_id: "root-001",
    status: "ACTIVE",
  },
  checkpoint_handoff: null,
  agents: [
    {
      role_id: "orchestrator",
      kind: "GLOBAL_ORCHESTRATOR",
      session_id: "session-orchestrator",
      predecessor_session_id: null,
      campaign_id: "campaign-001",
      campaign_version: "001",
      governance_version: "2.1rc",
      display_name: "orchestrator 001 2.1rc",
      pinned: true,
      state: "CAMPAIGN_ACTIVE",
      spawn_reason: "FRESH_CAMPAIGN",
      material_seam: null,
    },
    {
      role_id: "runtime",
      kind: "GLOBAL_RUNTIME",
      session_id: "session-runtime",
      predecessor_session_id: null,
      campaign_id: "campaign-001",
      campaign_version: "PERSISTENT",
      governance_version: "2.1rc",
      display_name: "Runtime Persistent 2.1rc",
      pinned: true,
      state: "PERSISTENT_ACTIVE",
      spawn_reason: "PERSISTENT",
      material_seam: null,
    },
    {
      role_id: "auditor",
      kind: "INDEPENDENT_AUDITOR",
      session_id: "session-auditor-new",
      predecessor_session_id: "session-auditor-old",
      campaign_id: "campaign-001",
      campaign_version: "001",
      governance_version: "2.1rc",
      display_name: "auditor 001 2.1rc",
      pinned: true,
      state: "CAMPAIGN_ACTIVE",
      spawn_reason: "FRESH_CAMPAIGN",
      material_seam: null,
    },
    ...["x", "z", "y"].map((id) => ({
      role_id: `feature-${id}`,
      kind: "FEATURE_AGENT",
      session_id: `session-feature-${id}-new`,
      predecessor_session_id: `session-feature-${id}-old`,
      campaign_id: "campaign-001",
      campaign_version: "001",
      governance_version: "2.1rc",
      display_name: `feature-${id} 001 2.1rc`,
      pinned: true,
      state: "CAMPAIGN_ACTIVE",
      spawn_reason: "FRESH_CAMPAIGN",
      material_seam: null,
    })),
    {
      role_id: "database-x",
      kind: "PLATFORM_AGENT",
      session_id: "session-database-x",
      predecessor_session_id: null,
      campaign_id: "campaign-001",
      campaign_version: "001",
      governance_version: "2.1rc",
      display_name: "database-x 001 2.1rc",
      pinned: true,
      state: "CAMPAIGN_ACTIVE",
      spawn_reason: "ON_DEMAND_BY_FEATURE_X",
      material_seam: "database-rls",
    },
  ],
  auditor: {
    session_id: "session-auditor-new",
    pinned: true,
    findings_state: "OPEN",
    intent_questions_state: "OPEN",
    audit_state_identity: "audit-state-001",
    next_campaign_candidate: "DRAFT",
  },
  runtime: {
    session_id: "session-runtime",
    state_identity: "runtime-state-001",
    deployed_identity: "release-previous",
    rollback_identity: "rollback-previous",
  },
  accepted_live: {
    status: "PENDING",
    deployed_identity: null,
    rollback_identity: null,
    independent_audit_identity: null,
    closure_receipt_sha256: null,
  },
  product_acceptance: {
    question_tree_sha256: "3".repeat(64),
    change_manifest_sha256: "5".repeat(64),
    observations_sha256: "4".repeat(64),
    evidence_cache_sha256: "6".repeat(64),
    acceptance_receipt_sha256: "7".repeat(64),
    open_question_ids: ["FR-ENTRY-001"],
    authorized_exception_ids: [],
    roots: {
      FUNCTION_REQUIREMENTS: "OPEN_REPAIR",
      DESIGN_BIBLE: "OPEN_REPAIR",
      SECURITY: "PENDING_ADMISSION",
    },
    rc_ready: false,
    auditor_session_id: "session-auditor-new",
    evaluated_at_utc: "2026-01-01T00:09:00.000Z",
    critical_freezes: [],
  },
  last_progress: {
    at: "2026-01-01T00:10:00.000Z",
    kind: "SUBSTANTIAL_BATCH",
    identity: "batch-001",
  },
  open_owner_questions: [],
  blocker: null,
  next_action: "feature-x continues build",
  standard_promotion: {
    status: "NOT_APPLIED",
    source_campaign_id: "campaign-001",
  },
  successor_wave: {
    status: "PENDING",
    disposition_identity: null,
    candidate_digest_sha256: null,
    gpt_assist_handoff_sha256: null,
    successor_campaign_id: null,
    successor_campaign_version: null,
    successor_orchestrator_binding: null,
    successor_auditor_binding: null,
    successor_feature_agent_bindings: [],
    product_writer_lease_status: "NOT_CREATED",
  },
};

const fixtureEvidenceSha = "f".repeat(64);
const fixtureManifestBody = {
  schema: "governance.changed_surface_manifest.v1",
  checkpoint_id: "checkpoint-acceptance-fixture",
  originating_owner_role_id: "feature-x",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  commit: "commit-001",
  tree: "tree-001",
  changed_paths: ["src/fixture.ts"],
  changed_surfaces: ["UI"],
};
const fixtureManifest = {
  ...fixtureManifestBody,
  manifest_sha256: questionTreeSha256(fixtureManifestBody),
};
const fixtureClause = (questionId, root) => ({
  clause_id: `${questionId}:CLAUSE`,
  question_id: questionId,
  root,
  parent_question_id: null,
  source_authority: {
    authority_id: `${root}-FIXTURE-AUTHORITY`,
    version: "fixture-1",
    sha256: fixtureEvidenceSha,
  },
  applicability: {
    predicate_id: `${questionId}:APPLICABLE`,
    question: `Does ${questionId} apply to this fixture?`,
  },
  atomic_question: `Does ${questionId} produce its exact fixture result?`,
  required_evidence: [`${root}:FIXTURE_PROOF`],
  repair_owner_role: root === "SECURITY" ? "SECURITY" : "FEATURE",
  invalidation_conditions: [`${questionId}:changed`],
  blocking_scope: `${questionId}:scope`,
  exception_policy: {
    allowed: false,
    granting_authority_ids: [],
    scope: null,
  },
  materiality: "MATERIAL_PRODUCT_ACCEPTANCE",
  applies_to_surfaces: ["ALWAYS"],
});
const fixtureTree = compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "campaign-001",
  question_tree_version: "2.1rc",
  change_manifest: fixtureManifest,
  clauses: [
    fixtureClause("FR-FIXTURE-001", "FUNCTION_REQUIREMENTS"),
    fixtureClause("DB-FIXTURE-001", "DESIGN_BIBLE"),
    fixtureClause("SEC-FIXTURE-001", "SECURITY"),
  ],
});
const fixtureEvidence = (kind) => ({
  evidence_id: `E-${kind}`,
  kind,
  sha256: fixtureEvidenceSha,
  commit_sha: "commit-001",
  worktree_id: "root-001",
  build_identity: "build-001",
  environment_id: "fixture-001",
  observed_at_utc: "2026-01-01T00:09:00.000Z",
  question_tree_version: "2.1rc",
});
const fixtureObservation = (question, disposition) => ({
  question_id: question.question_id,
  applicable: true,
  applicability_evidence: [fixtureEvidence("APPLICABILITY")],
  disposition,
  evidence: [fixtureEvidence(question.required_evidence[0])],
  evaluated_at_utc: "2026-01-01T00:09:00.000Z",
  evaluation_binding: {
    commit_sha: "commit-001",
    worktree_id: "root-001",
    relevant_hashes: [fixtureEvidenceSha],
    build_identity: "build-001",
    environment_id: "fixture-001",
    question_tree_version: "2.1rc",
  },
});
const fixtureObservationsOpen = fixtureTree.questions.map((question) =>
  fixtureObservation(question, question.root === "FUNCTION_REQUIREMENTS" ? "NO" : "YES_WITH_EVIDENCE"));
const fixtureObservationsAccepted = fixtureTree.questions.map((question) =>
  fixtureObservation(question, "YES_WITH_EVIDENCE"));
const fixtureEvidenceCache = {
  schema: "governance.fixture_evidence_cache.v1",
  entries: fixtureTree.questions.map((question) => ({
    question_id: question.question_id,
    result_sha256: fixtureEvidenceSha,
    question_tree_version: "2.1rc",
  })),
};
const openAcceptanceProof = compileProductAcceptanceProof({
  tree: fixtureTree,
  observations: fixtureObservationsOpen,
  evidence_cache: fixtureEvidenceCache,
  auditor_session_id: "session-auditor-new",
  evaluated_at_utc: "2026-01-01T00:09:00.000Z",
  critical_freezes: [],
});
const acceptedAcceptanceProof = compileProductAcceptanceProof({
  tree: fixtureTree,
  observations: fixtureObservationsAccepted,
  evidence_cache: fixtureEvidenceCache,
  auditor_session_id: "session-auditor-new",
  evaluated_at_utc: "2026-01-01T00:09:00.000Z",
  critical_freezes: [],
});

function resealAcceptance(state) {
  const receiptBody = structuredClone(state.product_acceptance);
  delete receiptBody.acceptance_receipt_sha256;
  state.product_acceptance.acceptance_receipt_sha256 = campaignDigest(receiptBody);
}

Object.assign(validState.product_acceptance, openAcceptanceProof.product_acceptance);

resealAcceptance(validState);
const cascadeRolePolicies = [
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
].map((role) => ({
  role,
  selection_mode: "EXTERNAL_SNAPSHOT_ROLE_MATCH",
  minimum_capability_floor: "COMPLETION_FLOOR_AND_REQUIRED_TOOLS",
  budget_behavior: "EXPECTED_ACCEPTED_COST_WITH_REWORK",
  fallback_behavior: "FAIL_CLOSED_NO_ELIGIBLE_MODEL",
}));
const fixtureCascadeModelPolicy = compileModelPolicy({
  profile: "ECO_CONTINUOUS",
  completionFloor: 0.75,
  marketSnapshotSha256: sha,
  rolePolicies: cascadeRolePolicies,
});
const fixtureCascadeFirstPass = compileFirstPassCandidate({
  candidate_id: "CANDIDATE-001",
  campaign_id: "campaign-001",
  campaign_version: "001",
  logical_lineage_id: "lineage-001",
  worktree_id: "root-001",
  branch: "campaign/campaign-001",
  commit: "commit-001",
  tree: "tree-001",
  remote_commit: "commit-001",
  remote_tree: "tree-001",
  clean: false,
  pushed: false,
  changed_paths: ["src/fixture.ts"],
  changed_surfaces: ["UI"],
  owner_role_id: "feature-x",
  terminal: false,
  created_at_utc: "2026-01-01T00:00:00.000Z",
  quality_floor: {
    intended_path_present: true,
    affected_checks_pass: true,
    interfaces_coherent: true,
    critical_defect_disclosed: true,
    safe_operations: true,
    clean_checkpoint: false,
    pushed_checkpoint: false,
    incomplete_work: ["fixture campaign remains active"],
    evidence_sha256: sha,
  },
});
const fixtureCascade = {
  schema: "governance.campaign_cascade_state.v1",
  governance_version: "2.1rc",
  campaign_id: "campaign-001",
  campaign_version: "001",
  mode: "STANDARD_SUBSTANTIAL",
  stage: "FIRST_PASS_BUILDING",
  logical_lineage_id: "lineage-001",
  first_pass: fixtureCascadeFirstPass,
  audit_plan: null,
  audit_reconciliation: null,
  finalizer: null,
  delta_audit: null,
  acceptance: {
    product_acceptance_sha256: cascadeDigest(validState.product_acceptance),
    question_tree_sha256: validState.product_acceptance.question_tree_sha256,
    final_candidate_commit: "commit-001",
    final_candidate_tree: "tree-001",
    roots: structuredClone(validState.product_acceptance.roots),
    rc_ready: false,
    auditor_session_id: "session-auditor-new",
  },
  model_policy: fixtureCascadeModelPolicy,
  telemetry: {
    records: [],
    evidence_reuse_count: 0,
    escaped_finding_count: 0,
    owner_interruptions: 0,
  },
  loop_control: {
    max_finalization_passes: 1,
    max_delta_repair_passes: 1,
    max_supervisor_reframes: 1,
    equivalent_retry_policy: "STOP_AND_CLASSIFY_AFTER_ONE_REFRAME",
  },
  cascade_sha256: "",
};
delete fixtureCascade.cascade_sha256;
fixtureCascade.cascade_sha256 = cascadeDigest(fixtureCascade);
validState.cascade = fixtureCascade;
const clone = () => structuredClone(validState);

function compileTerminalCascade(productAcceptance) {
  const terminalCandidate = compileFirstPassCandidate({
    candidate_id: "CANDIDATE-001",
    campaign_id: "campaign-001",
    campaign_version: "001",
    logical_lineage_id: "lineage-001",
    worktree_id: "root-001",
    branch: "campaign/campaign-001",
    commit: "commit-draft",
    tree: "tree-draft",
    remote_commit: "commit-draft",
    remote_tree: "tree-draft",
    clean: true,
    pushed: true,
    changed_paths: ["src/fixture.ts"],
    changed_surfaces: ["UI"],
    owner_role_id: "feature-y",
    terminal: true,
    created_at_utc: "2026-01-01T00:14:00.000Z",
    quality_floor: {
      intended_path_present: true,
      affected_checks_pass: true,
      interfaces_coherent: true,
      critical_defect_disclosed: true,
      safe_operations: true,
      clean_checkpoint: true,
      pushed_checkpoint: true,
      incomplete_work: [],
      evidence_sha256: sha,
    },
  });
  const plan = compileAuditPlan({candidate: terminalCandidate, terminal: true});
  const reports = AUDIT_DISCIPLINES.map((discipline) => compileAuditReport({
    plan,
    discipline,
    auditorSessionId: "session-auditor-new",
    workerSessionId: `worker-${discipline}`,
    reviewedQuestionIds: [`${discipline === "FUNCTIONALITY" ? "FR" : discipline === "DESIGN_UI_SHELL_NAVIGATION" ? "DB" : "SEC"}-TERMINAL-001`],
    failedQuestionIds: [],
    findings: [],
    evidenceSha256: sha,
  }));
  const reconciliation = reconcileAuditFindings({plan, reports, terminal: true});
  const finalizer = openCampaignFinalizer({
    candidate: terminalCandidate,
    auditPlan: plan,
    reconciliation,
    modelPolicyDigestSha256: fixtureCascadeModelPolicy.policy_sha256,
    sessionId: "session-finalizer",
    worktreeId: "finalizer-worktree",
    branch: "campaign/campaign-001-finalizer",
    scopeFindingIds: [],
    correctionBatchSha256: sha,
  });
  const completedFinalizer = completeCampaignFinalizer({
    finalizer,
    candidate: terminalCandidate,
    finalCommit: "commit-001",
    finalTree: "tree-001",
    changedPaths: ["src/fixture.ts"],
  });
  const delta = compileDeltaAudit({
    baselineCommit: terminalCandidate.commit,
    baselineTree: terminalCandidate.tree,
    candidateCommit: completedFinalizer.final_commit,
    candidateTree: completedFinalizer.final_tree,
    allQuestionIds: ["FR-TERMINAL-001", "DB-TERMINAL-001", "SEC-TERMINAL-001", "SEC-TERMINAL-002"],
    previouslyFailedQuestionIds: ["FR-TERMINAL-001"],
    directlyTouchedQuestionIds: ["DB-TERMINAL-001"],
    dependentQuestionIds: [],
    smokeQuestionIds: ["SEC-TERMINAL-001"],
    causalRootIds: ["CAUSE-TERMINAL"],
    evidenceReuseSha256: sha,
  });
  const cascade = {
    schema: "governance.campaign_cascade_state.v1",
    governance_version: "2.1rc",
    campaign_id: "campaign-001",
    campaign_version: "001",
    mode: "STANDARD_SUBSTANTIAL",
    stage: "READY_FOR_ACCEPTANCE",
    logical_lineage_id: "lineage-001",
    first_pass: terminalCandidate,
    audit_plan: plan,
    audit_reconciliation: reconciliation,
    finalizer: completedFinalizer,
    delta_audit: delta,
    acceptance: {
      product_acceptance_sha256: cascadeDigest(productAcceptance),
      question_tree_sha256: productAcceptance.question_tree_sha256,
      final_candidate_commit: completedFinalizer.final_commit,
      final_candidate_tree: completedFinalizer.final_tree,
      roots: structuredClone(productAcceptance.roots),
      rc_ready: productAcceptance.rc_ready,
      auditor_session_id: "session-auditor-new",
    },
    model_policy: fixtureCascadeModelPolicy,
    telemetry: {
      records: [],
      evidence_reuse_count: 1,
      escaped_finding_count: 0,
      owner_interruptions: 0,
    },
    loop_control: {
      max_finalization_passes: 1,
      max_delta_repair_passes: 1,
      max_supervisor_reframes: 1,
      equivalent_retry_policy: "STOP_AND_CLASSIFY_AFTER_ONE_REFRAME",
    },
    cascade_sha256: "",
  };
  delete cascade.cascade_sha256;
  cascade.cascade_sha256 = cascadeDigest(cascade);
  return cascade;
}
let hostileRejected = 0;
const failures = [];
const rejectState = (label, mutate) => {
  const draft = clone();
  mutate(draft);
  try {
    validateCampaignState(draft);
    failures.push(`hostile state accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
};

validateCampaignState(validState);
const livingState = structuredClone(validState);
livingState.agents = livingState.agents.filter((agent) =>
  agent.session_id !== "session-database-x");
validateCampaignState(livingState);

const livingOpen = compileLivingCampaignEvent({
  campaign_id: "campaign-001",
  campaign_version: "001",
  recorded_at: "2026-01-01T00:00:01.000Z",
  writer_session_id: "session-orchestrator",
  writer_role_id: "orchestrator",
  writer_kind: "GLOBAL_ORCHESTRATOR",
  event_type: "CAMPAIGN_OPENED",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  goal_id: "goal-x-build",
  dependency_node_id: "x",
  summary: "Campaign root and initial roster are bound.",
  next: "Feature X begins the active goal.",
  related_agent: null,
  checkpoint_sha256: null,
}, livingState, []).event;
const livingProgress = compileLivingCampaignEvent({
  campaign_id: "campaign-001",
  campaign_version: "001",
  recorded_at: "2026-01-01T00:01:00.000Z",
  writer_session_id: "session-feature-x-new",
  writer_role_id: "feature-x",
  writer_kind: "FEATURE_AGENT",
  event_type: "PROGRESS",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  goal_id: "goal-x-build",
  dependency_node_id: "x",
  summary: "The bounded implementation batch is active.",
  next: "Complete the affected contract and checks.",
  related_agent: null,
  checkpoint_sha256: null,
}, livingState, [livingOpen]).event;
const parallelAudit = compileLivingCampaignEvent({
  campaign_id: "campaign-001",
  campaign_version: "001",
  recorded_at: "2026-01-01T00:01:30.000Z",
  writer_session_id: "session-auditor-new",
  writer_role_id: "auditor",
  writer_kind: "INDEPENDENT_AUDITOR",
  event_type: "AUDIT_FINDING",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  goal_id: "goal-x-build",
  dependency_node_id: "x",
  summary: "The parallel audit has one bounded finding.",
  next: "Queue it for the originating Feature Agent at handoff.",
  related_agent: null,
  checkpoint_sha256: null,
  evidence_pointer_sha256: "1".repeat(64),
}, livingState, [livingOpen, livingProgress]).event;
const spawnedPlatform = structuredClone(
  validState.agents.find((agent) => agent.session_id === "session-database-x"),
);
const livingSpawn = compileLivingCampaignEvent({
  campaign_id: "campaign-001",
  campaign_version: "001",
  recorded_at: "2026-01-01T00:02:00.000Z",
  writer_session_id: "session-feature-x-new",
  writer_role_id: "feature-x",
  writer_kind: "FEATURE_AGENT",
  event_type: "PLATFORM_AGENT_SPAWNED",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  goal_id: "goal-x-build",
  dependency_node_id: "x",
  summary: "A database and row-security seam needs bounded work.",
  next: "The on-demand Platform Agent returns its scoped result.",
  related_agent: spawnedPlatform,
  checkpoint_sha256: null,
}, livingState, [livingOpen, livingProgress]).event;
const livingReturn = compileLivingCampaignEvent({
  campaign_id: "campaign-001",
  campaign_version: "001",
  recorded_at: "2026-01-01T00:03:00.000Z",
  writer_session_id: "session-database-x",
  writer_role_id: "database-x",
  writer_kind: "PLATFORM_AGENT",
  event_type: "PLATFORM_AGENT_RETURNED",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  goal_id: "goal-x-build",
  dependency_node_id: "x",
  summary: "The database seam result is ready for Feature X.",
  next: "Feature X integrates the scoped result.",
  related_agent: null,
  checkpoint_sha256: null,
  material_seam: "database-rls",
  spawn_event_sha256: livingSpawn.event_id,
  evidence_pointer_sha256: "2".repeat(64),
}, livingState, [livingOpen, livingProgress, livingSpawn]).event;
const livingEvents = [
  livingOpen, livingProgress, parallelAudit, livingSpawn, livingReturn,
];
function bindLivingRecord(state, events, productAcceptanceProof = null) {
  if (state.checkpoint_handoff !== null) {
    state.checkpoint_handoff.living_record = structuredClone(state.living_record);
  }
  const view = compileLivingCampaignView(state, events, {
    product_acceptance_proof: productAcceptanceProof,
  });
  state.living_record = {
    events_root: `campaigns/${state.campaign_id}/events`,
    current_view_path: state.active_campaign_article,
    event_count: view.event_count,
    ledger_sha256: view.ledger_sha256,
    writer_heads: view.writer_heads,
    current_view_sha256: view.markdown_sha256,
  };
  if (state.checkpoint_handoff !== null) {
    state.checkpoint_handoff.living_record = structuredClone(state.living_record);
  }
  return view;
}
const livingView = bindLivingRecord(livingState, livingEvents);
const livingLedger = validateLivingCampaignLedger(livingState, livingEvents);
validateCampaignState(livingState);
const reorderedLivingView = compileLivingCampaignView(
  livingState,
  [livingReturn, livingSpawn, livingOpen, parallelAudit, livingProgress],
);
if (livingLedger.event_count !== 5
    || livingLedger.writer_heads["session-feature-x-new"] !== livingSpawn.event_id
    || livingLedger.writer_heads["session-auditor-new"] !== parallelAudit.event_id
    || livingLedger.writer_heads["session-database-x"] !== livingReturn.event_id
    || !livingView.markdown.includes("session-feature-x-new")
    || !livingView.markdown.includes("session-database-x")
    || livingView.markdown_sha256 !== reorderedLivingView.markdown_sha256
    || livingView.ledger_sha256 !== reorderedLivingView.ledger_sha256) {
  failures.push("living campaign record does not bind sessions and append-only progress");
}
const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "living-campaign-"));
const casPath = path.join(ledgerRoot, "authority-state.json");
fs.writeFileSync(casPath, "version-one\n", {mode: 0o600});
writeStateCompareAndSwap(casPath, "version-one\n", {version: 2});
assert.equal(fs.readFileSync(casPath, "utf8"), '{\n  "version": 2\n}\n');
assert.throws(
  () => writeStateCompareAndSwap(casPath, "version-one\n", {version: 3}),
  /changed since transition validation/,
);
hostileRejected += 1;
for (const event of livingEvents) {
  const writerPath = crypto.createHash("sha256")
    .update(event.writer_session_id, "utf8").digest("hex");
  appendLivingCampaignEvent(
    ledgerRoot,
    `campaigns/campaign-001/events/${writerPath}/${
      String(event.writer_sequence).padStart(6, "0")
    }-${event.event_id}.json`,
    event,
  );
}
fs.mkdirSync(path.join(ledgerRoot, "campaigns/campaign-001"), {recursive: true});
fs.writeFileSync(
  path.join(ledgerRoot, "campaigns/campaign-001/current.md"),
  livingView.markdown,
);
const readbackLedger = readLivingCampaignLedger(ledgerRoot, livingState);
if (readbackLedger.ledger_sha256 !== livingLedger.ledger_sha256) {
  failures.push("living campaign filesystem readback differs from authority binding");
}
const currentViewPath = path.join(ledgerRoot, "campaigns/campaign-001/current.md");
fs.writeFileSync(currentViewPath, `${livingView.markdown}\nrewritten\n`);
try {
  readLivingCampaignLedger(ledgerRoot, livingState);
  failures.push("rewritten living campaign current view was accepted");
} catch {
  hostileRejected += 1;
}
fs.writeFileSync(currentViewPath, livingView.markdown);
const externalCurrentView = path.join(os.tmpdir(), "living-campaign-external-current.md");
fs.writeFileSync(externalCurrentView, livingView.markdown);
fs.unlinkSync(currentViewPath);
fs.symlinkSync(externalCurrentView, currentViewPath, "file");
try {
  readLivingCampaignLedger(ledgerRoot, livingState);
  failures.push("living campaign filesystem followed a symlinked current view");
} catch {
  hostileRejected += 1;
}
fs.unlinkSync(currentViewPath);
fs.writeFileSync(currentViewPath, livingView.markdown);
fs.rmSync(externalCurrentView, {force: true});
const terminalEvent = livingEvents.at(-1);
const terminalWriterPath = crypto.createHash("sha256")
  .update(terminalEvent.writer_session_id, "utf8").digest("hex");
const terminalEventPath = path.join(
  ledgerRoot, "campaigns/campaign-001/events", terminalWriterPath,
  `${String(terminalEvent.writer_sequence).padStart(6, "0")}-${terminalEvent.event_id}.json`,
);
fs.renameSync(terminalEventPath, `${terminalEventPath}.renamed`);
try {
  readLivingCampaignLedger(ledgerRoot, livingState);
  failures.push("living campaign filesystem rename/omission was accepted");
} catch {
  hostileRejected += 1;
}
fs.renameSync(`${terminalEventPath}.renamed`, terminalEventPath);
const rewritten = JSON.parse(fs.readFileSync(terminalEventPath, "utf8"));
rewritten.summary = "rewritten terminal evidence";
fs.chmodSync(terminalEventPath, 0o600);
fs.writeFileSync(terminalEventPath, `${JSON.stringify(rewritten)}\n`);
try {
  readLivingCampaignLedger(ledgerRoot, livingState);
  failures.push("living campaign filesystem rewrite was accepted");
} catch {
  hostileRejected += 1;
}
fs.writeFileSync(terminalEventPath, `${JSON.stringify(terminalEvent)}\n`);
fs.chmodSync(terminalEventPath, 0o400);
try {
  appendLivingCampaignEvent(
    ledgerRoot,
    `campaigns/campaign-001/events/${terminalWriterPath}/${
      String(terminalEvent.writer_sequence).padStart(6, "0")
    }-${terminalEvent.event_id}.json`,
    terminalEvent,
  );
  failures.push("living campaign event path was overwritten");
} catch {
  hostileRejected += 1;
}
const secretQuery = ["token", "secret"].join("=");
const secretFragment = `#${["secret"].join("")}`;
const credentialedProviderUrl = `https://${["user", "secret"].join(":")}@provider.example/login`;
for (const [label, mutate] of [
  ["living ledger event rewrite", (events) => { events[1].summary = "rewritten"; }],
  ["living ledger event deletion", (events) => { events.splice(1, 1); }],
  ["living ledger terminal event deletion", (events) => { events.pop(); }],
  ["living ledger wrong writer session", (events) => {
    events[1].writer_session_id = "session-feature-y-new";
  }],
  ["living ledger platform event by Feature Agent", (events) => {
    events[4].writer_session_id = "session-feature-x-new";
    events[4].writer_role_id = "feature-x";
    events[4].writer_kind = "FEATURE_AGENT";
  }],
]) {
  const hostile = structuredClone(livingEvents);
  mutate(hostile);
  try {
    validateLivingCampaignLedger(livingState, hostile);
    failures.push(`hostile living campaign ledger accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}
try {
  const staleHead = structuredClone(next);
  staleHead.living_record.writer_heads["session-feature-x-new"] = "f".repeat(64);
  applyCampaignTransition(completed, staleHead, {
    role: "GLOBAL_ORCHESTRATOR",
    session_id: "session-orchestrator",
  }, {
    ...transitionProof,
    next_view_sha256: staleHead.living_record.current_view_sha256,
  });
  failures.push("checkpoint handoff accepted a stale living-record writer head");
} catch {
  hostileRejected += 1;
}
try {
  const forged = structuredClone(livingProgress);
  forged.writer_session_id = "session-feature-y-new";
  forged.writer_role_id = "feature-y";
  forged.goal_id = "goal-y-build";
  forged.dependency_node_id = "y";
  forged.writer_sequence = 1;
  forged.previous_writer_event_sha256 = "0".repeat(64);
  const body = structuredClone(forged);
  delete body.event_id;
  forged.event_id = crypto.createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(
      Object.keys(body).sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map((key) => [key, body[key]]),
    ))).digest("hex");
  validateLivingCampaignLedger(livingState, [...livingEvents, forged]);
  failures.push("raw inactive Feature Agent event was accepted");
} catch {
  hostileRejected += 1;
}
try {
  const duplicateSpawn = compileLivingCampaignEvent({
    campaign_id: "campaign-001",
    campaign_version: "001",
    recorded_at: "2026-01-01T00:04:00.000Z",
    writer_session_id: "session-feature-x-new",
    writer_role_id: "feature-x",
    writer_kind: "FEATURE_AGENT",
    event_type: "PLATFORM_AGENT_SPAWNED",
    root_id: "root-001",
    branch: "campaign/campaign-001",
    goal_id: "goal-x-build",
    dependency_node_id: "x",
    summary: "The same Platform session is recorded a second time.",
    next: "Reject the duplicate spawn.",
    related_agent: spawnedPlatform,
    checkpoint_sha256: null,
  }, livingState, livingEvents).event;
  validateLivingCampaignLedger(livingState, [...livingEvents, duplicateSpawn]);
  failures.push("duplicate Platform Agent spawn record was accepted");
} catch {
  hostileRejected += 1;
}
try {
  compileLivingCampaignEvent({
    campaign_id: "campaign-001",
    campaign_version: "001",
    recorded_at: "2026-01-01T00:04:00.000Z",
    writer_session_id: "session-feature-y-new",
    writer_role_id: "feature-y",
    writer_kind: "FEATURE_AGENT",
    event_type: "PROGRESS",
    root_id: "root-001",
    branch: "campaign/campaign-001",
    goal_id: "goal-y-build",
    dependency_node_id: "y",
    summary: "A future owner attempts to write early.",
    next: "Wait for the accepted handoff.",
    related_agent: null,
    checkpoint_sha256: null,
  }, livingState, livingEvents);
  failures.push("inactive Feature Agent appended to the living campaign");
} catch {
  hostileRejected += 1;
}
if (compileDependencyOrder(validState.dependency_nodes).join(",") !== "x,z,y") {
  failures.push("dependency order is not deterministic");
}

const observation = {
  root_id: "root-001",
  root_branch: "campaign/campaign-001",
  root_commit: "commit-001",
  root_tree: "tree-001",
  remote_commit: "commit-001",
  remote_tree: "tree-001",
  root_clean: false,
  root_pushed: false,
  active_session_id: "session-feature-x-new",
  active_goal_id: "goal-x-build",
  active_dependency_node_id: "x",
  lease_id: "lease-001",
  lease_holder_role_id: "feature-x",
  checkpoint_id: null,
  runtime_session_id: "session-runtime",
  runtime_state_identity: "runtime-state-001",
  deployed_identity: "release-previous",
  rollback_identity: "rollback-previous",
  auditor_session_id: "session-auditor-new",
  auditor_state_identity: "audit-state-001",
  material_progress: false,
  progress_kind: null,
  progress_identity: null,
  true_blocker: null,
};
const healthy = decideHeartbeatAction(validState, observation, "2026-01-01T00:14:59.000Z");
if (healthy.action !== "NO_SEMANTIC_CHANGE_NO_AUTHORITY_COMMIT" || healthy.authority_write) {
  failures.push("healthy heartbeat creates authority noise");
}
const stalled = decideHeartbeatAction(validState, observation, "2026-01-01T00:25:00.000Z");
if (stalled.action !== "REPAIR_BROKEN_CHAIN_THEN_WRITE_CAMPAIGN_SNAPSHOT") {
  failures.push("stalled campaign does not trigger recovery");
}

const providerBlocker = {
  class: "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE",
  reason: "provider session expired",
  authority_boundary_id: "AUTH-PROVIDER-SESSION",
  blocker_evidence_sha256: sha,
  exact_owner_question: "Authenticate the admitted provider account in the configured browser.",
  smallest_owner_action: "Complete the provider sign-in.",
  attempted_safe_alternatives: ["existing authorized session", "read-only provider identity"],
  unaffected_work: "All non-provider work continues.",
  blocked_scope: "provider deployment only",
  resumption_condition: "Runtime read-only identity succeeds.",
  provider: "provider.example",
  environment: "development",
  official_authorization_url: "https://provider.example/login",
  selected_browser_required: true,
  sensitive_link: false,
  resume_check: "Runtime read-only identity succeeds",
  resume_goal_id: "goal-x-build",
};
const suspend = decideHeartbeatAction(
  validState,
  {...observation, true_blocker: providerBlocker},
  "2026-01-01T00:15:00.000Z",
);
if (suspend.action !== "SUSPEND_SAME_GOAL_STOP_PROGRESS_TIMER_AND_ASK_OWNER") {
  failures.push("provider blocker did not suspend the same goal and timer");
}
const suspendedState = clone();
suspendedState.status = "TRUE_BLOCKER_SUSPENDED";
suspendedState.active_goal.status = "SUSPENDED_TRUE_BLOCKER";
suspendedState.blocker = providerBlocker;
validateCampaignState(suspendedState);
const waiting = decideHeartbeatAction(
  suspendedState,
  {...observation, true_blocker: providerBlocker},
  "2026-01-01T12:00:00.000Z",
);
if (waiting.action !== "WAIT_FOR_BLOCKER_RESOLUTION_NO_PROGRESS_TIMER") {
  failures.push("suspended provider blocker still runs the progress timer");
}
const resume = decideHeartbeatAction(
  suspendedState,
  observation,
  "2026-01-01T12:00:00.000Z",
);
if (resume.action !== "RESUME_SAME_GOAL_AND_RESTART_PROGRESS_TIMER") {
  failures.push("resolved provider blocker did not resume the same goal");
}

const expectedUiReviews = [
  "ACCESSIBILITY", "SECURITY", "SHELL_NAVIGATION", "UI_UX",
];
if (classifyRequiredSeamReviews(["UI"]).join(",") !== expectedUiReviews.join(",")) {
  failures.push("UI seam review classification is incomplete");
}
const materialReviewBatch = {
  checkpoint_id: "checkpoint-ui-001",
  originating_owner_role_id: "feature-x",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  commit: "commit-001",
  tree: "tree-001",
  changed_paths: ["src/pages/dashboard.tsx"],
  changed_surfaces: ["UI"],
  change_manifest_sha256: compileChangeManifest(
    validState.root,
    "checkpoint-ui-001",
    "feature-x",
    ["src/pages/dashboard.tsx"],
  ).manifest_sha256,
  required_review_roles: expectedUiReviews,
  reviews: expectedUiReviews.map((role) => ({
    reviewer_role_id: role,
    session_id: `session-${role}`,
    pinned: true,
    read_only: true,
    severity: role === "UI_UX" ? "MATERIAL" : "PASS",
    reviewed_question_ids: role === "SECURITY" ? ["SEC-ACCESS-001"] : ["DB-SHELL-001"],
    failed_question_ids: role === "UI_UX" ? ["DB-SHELL-001"] : [],
    question_observations_sha256: validState.product_acceptance.observations_sha256,
    correction_owner_role_id: role === "UI_UX" ? "feature-x" : null,
    report_sha256: sha,
  })),
  handoff_state: "QUEUED_RETURN_TO_ORIGINATING_OWNER_AT_STABLE_HANDOFF",
};
const seamReviewState = clone();
for (const role of expectedUiReviews) {
  seamReviewState.agents.push({
    role_id: role,
    kind: "AUDIT_WORKER",
    session_id: `session-${role}`,
    predecessor_session_id: null,
    campaign_id: "campaign-001",
    campaign_version: "001",
    governance_version: "2.1rc",
    display_name: `${role} 001 2.1rc`,
    pinned: true,
    state: "CAMPAIGN_ACTIVE",
    spawn_reason: "ON_DEMAND_CHECKPOINT_REVIEW",
    material_seam: role,
  });
}
validateSeamReviewBatch(materialReviewBatch, seamReviewState);
const withArchivedPredecessor = clone();
withArchivedPredecessor.agents.splice(3, 0, {
  role_id: "feature-x",
  kind: "FEATURE_AGENT",
  session_id: "session-feature-x-archived",
  predecessor_session_id: "session-feature-x-older",
  campaign_id: "campaign-001",
  campaign_version: "001",
  governance_version: "2.1rc",
  display_name: "feature-x 001 2.1rc",
  pinned: false,
  state: "ARCHIVED_UNPINNED",
  spawn_reason: "FRESH_CAMPAIGN",
  material_seam: null,
});
const predecessorSafe = decideHeartbeatAction(
  withArchivedPredecessor,
  observation,
  "2026-01-01T00:14:59.000Z",
);
if (predecessorSafe.action !== "NO_SEMANTIC_CHANGE_NO_AUTHORITY_COMMIT") {
  failures.push("heartbeat bound an archived predecessor instead of the active Feature Agent");
}
const predecessorReported = decideHeartbeatAction(
  withArchivedPredecessor,
  {
    ...observation,
    active_session_id: "session-feature-x-archived",
    progress_kind: null,
    progress_identity: null,
  },
  "2026-01-01T00:14:59.000Z",
);
if (predecessorReported.action !== "RECONCILE_AND_WRITE_CAMPAIGN_SNAPSHOT") {
  failures.push("heartbeat accepted an archived predecessor as the active Feature Agent");
}
for (const field of [
  "active_session_id", "root_tree", "remote_commit", "active_dependency_node_id",
  "lease_id", "runtime_session_id", "runtime_state_identity", "deployed_identity",
  "rollback_identity", "auditor_session_id", "auditor_state_identity",
]) {
  const changed = {...observation, [field]: `changed-${field}`,
    progress_kind: null, progress_identity: null};
  const result = decideHeartbeatAction(validState, changed, "2026-01-01T00:12:00.000Z");
  if (result.action !== "RECONCILE_AND_WRITE_CAMPAIGN_SNAPSHOT") {
    failures.push(`heartbeat ignores material reality: ${field}`);
  }
}

const completed = clone();
completed.snapshot_sequence = 8;
completed.snapshot_at = "2026-01-01T00:14:30.000Z";
completed.root.clean = true;
completed.root.pushed = true;
completed.active_goal.status = "COMPLETE";
completed.active_goal.completion_receipt_sha256 = sha;
completed.lease.status = "RELEASED";
completed.checkpoint_handoff = {
  kind: "FEATURE_TO_FEATURE",
  checkpoint_id: "checkpoint-x",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  commit: "commit-001",
  tree: "tree-001",
  remote_commit: "commit-001",
  remote_tree: "tree-001",
  lease_id: "lease-001",
  from_owner_role_id: "feature-x",
  from_goal_id: "goal-x-build",
  to_owner_role_id: "feature-z",
  to_goal_id: "goal-z-blueprint",
  status: "ACCEPTED",
  living_record: structuredClone(livingState.living_record),
  product_acceptance_sha256: campaignDigest(completed.product_acceptance),
};
bindLivingRecord(completed, livingEvents);
validateCampaignState(completed);
try {
  compileLivingCampaignEvent({
    campaign_id: "campaign-001",
    campaign_version: "001",
    recorded_at: "2026-01-01T00:14:45.000Z",
    writer_session_id: "session-feature-x-new",
    writer_role_id: "feature-x",
    writer_kind: "FEATURE_AGENT",
    event_type: "PROGRESS",
    root_id: "root-001",
    branch: "campaign/campaign-001",
    goal_id: "goal-x-build",
    dependency_node_id: "x",
    summary: "Feature work attempts to continue after checkpoint closure.",
    next: "Reject the post-closure Product event.",
    related_agent: null,
    checkpoint_sha256: null,
  }, completed, livingEvents);
  failures.push("Feature Agent appended after goal and lease closure");
} catch {
  hostileRejected += 1;
}

const next = structuredClone(completed);
next.snapshot_sequence += 1;
next.snapshot_at = "2026-01-01T00:15:00.000Z";
next.active_goal = {
  goal_id: "goal-z-blueprint",
  goal_system_id: "host-goal-002",
  stage: "BLUEPRINT",
  owner_role_id: "feature-z",
  dependency_node_id: "z",
  status: "ACTIVE",
  instruction_sha256: sha,
  done_when_sha256: sha,
  started_at: "2026-01-01T00:15:00.000Z",
  completion_receipt_sha256: null,
};
next.lease = {
  lease_id: "lease-002",
  holder_role_id: "feature-z",
  root_id: "root-001",
  status: "ACTIVE",
};
next.checkpoint_handoff = null;
bindLivingRecord(next, livingEvents);
const transitionProof = {
  previous_events: livingEvents,
  next_events: livingEvents,
  previous_view_sha256: completed.living_record.current_view_sha256,
  next_view_sha256: next.living_record.current_view_sha256,
  consumed_gpt_assist_handoff_sha256: null,
  previous_product_acceptance_proof: null,
  next_product_acceptance_proof: null,
};
applyCampaignTransition(completed, next, {
  role: "GLOBAL_ORCHESTRATOR",
  session_id: "session-orchestrator",
}, transitionProof);
try {
  const futureEvent = compileLivingCampaignEvent({
    campaign_id: "campaign-001",
    campaign_version: "001",
    recorded_at: "2026-01-01T00:16:00.000Z",
    writer_session_id: "session-orchestrator",
    writer_role_id: "orchestrator",
    writer_kind: "GLOBAL_ORCHESTRATOR",
    event_type: "HANDOFF_ACCEPTED",
    root_id: "root-001",
    branch: "campaign/campaign-001",
    goal_id: "goal-x-build",
    dependency_node_id: "x",
    summary: "A future-dated handoff event is attempted.",
    next: "Reject chronology beyond the next snapshot.",
    related_agent: null,
    checkpoint_sha256: null,
  }, completed, livingEvents).event;
  const futureNext = structuredClone(next);
  bindLivingRecord(futureNext, [...livingEvents, futureEvent]);
  applyCampaignTransition(completed, futureNext, {
    role: "GLOBAL_ORCHESTRATOR",
    session_id: "session-orchestrator",
  }, {
    previous_events: livingEvents,
    next_events: [...livingEvents, futureEvent],
    previous_view_sha256: completed.living_record.current_view_sha256,
    next_view_sha256: futureNext.living_record.current_view_sha256,
    consumed_gpt_assist_handoff_sha256: null,
    previous_product_acceptance_proof: null,
    next_product_acceptance_proof: null,
  });
  failures.push("future-dated living campaign event was accepted");
} catch {
  hostileRejected += 1;
}
try {
  applyCampaignTransition(completed, next, {
    role: "INDEPENDENT_AUDITOR",
    session_id: "session-auditor-new",
  }, transitionProof);
  failures.push("non-Orchestrator applied an authority transition");
} catch {
  hostileRejected += 1;
}
for (const [label, mutate] of [
  ["wrong transition recipient", (d) => { d.active_goal.owner_role_id = "feature-y"; d.lease.holder_role_id = "feature-y"; }],
  ["wrong transition goal", (d) => { d.active_goal.goal_id = "goal-other"; }],
  ["skipped transition node", (d) => { d.active_goal.dependency_node_id = "y"; d.active_goal.owner_role_id = "feature-y"; d.lease.holder_role_id = "feature-y"; }],
  ["transition root switch", (d) => { d.root.root_id = "root-other"; d.lease.root_id = "root-other"; }],
  ["transition remote identity switch", (d) => {
    d.root.remote_commit = "remote-other";
    d.root.remote_tree = "remote-tree-other";
  }],
  ["transition starts dirty", (d) => { d.root.clean = false; }],
  ["transition starts unpushed", (d) => { d.root.pushed = false; }],
  ["transition rewrites dependency graph", (d) => {
    d.dependency_nodes[2].depends_on = ["x"];
    d.dependency_order = ["x", "y", "z"];
  }],
  ["transition switches campaign article", (d) => {
    d.active_campaign_article = "campaigns/other/current.md";
  }],
  ["transition replaces feature session", (d) => {
    d.agents.find((agent) => agent.role_id === "feature-y").session_id = "replacement-session";
  }],
]) {
  const hostileNext = structuredClone(next);
  mutate(hostileNext);
  try {
    applyCampaignTransition(completed, hostileNext, {
      role: "GLOBAL_ORCHESTRATOR",
      session_id: "session-orchestrator",
    }, transitionProof);
    failures.push(`hostile transition accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}
try {
  const ignoredHandoff = structuredClone(completed);
  ignoredHandoff.snapshot_sequence += 1;
  ignoredHandoff.snapshot_at = "2026-01-01T00:15:00.000Z";
  applyCampaignTransition(completed, ignoredHandoff, {
    role: "GLOBAL_ORCHESTRATOR",
    session_id: "session-orchestrator",
  }, transitionProof);
  failures.push("accepted handoff did not constrain the next snapshot");
} catch {
  hostileRejected += 1;
}

const terminalClosed = clone();
terminalClosed.snapshot_sequence = 9;
terminalClosed.snapshot_at = "2026-01-01T00:15:30.000Z";
terminalClosed.status = "ACCEPTED_LIVE_CLOSED";
terminalClosed.root.clean = true;
terminalClosed.root.pushed = true;
terminalClosed.active_goal = {
  goal_id: "goal-y-build",
  goal_system_id: "host-goal-terminal",
  stage: "BUILD",
  owner_role_id: "feature-y",
  dependency_node_id: "y",
  status: "COMPLETE",
  instruction_sha256: sha,
  done_when_sha256: sha,
  started_at: "2026-01-01T00:00:00.000Z",
  completion_receipt_sha256: sha,
};
terminalClosed.lease = {
  lease_id: "lease-y",
  holder_role_id: "feature-y",
  root_id: "root-001",
  status: "RELEASED",
};
terminalClosed.product_acceptance = {
  ...terminalClosed.product_acceptance,
  ...acceptedAcceptanceProof.product_acceptance,
};
resealAcceptance(terminalClosed);
terminalClosed.cascade = compileTerminalCascade(terminalClosed.product_acceptance);
for (const report of terminalClosed.cascade.audit_reconciliation.reports) {
  terminalClosed.agents.push({
    role_id: report.discipline,
    kind: "AUDIT_WORKER",
    session_id: report.worker_session_id,
    predecessor_session_id: null,
    campaign_id: "campaign-001",
    campaign_version: "001",
    governance_version: "2.1rc",
    display_name: `${report.discipline} 001 2.1rc`,
    pinned: false,
    state: "ARCHIVED_UNPINNED",
    spawn_reason: "ON_DEMAND_TERMINAL_AUDIT",
    material_seam: report.discipline,
  });
}
terminalClosed.agents.push({
  role_id: "campaign-finalizer",
  kind: "CAMPAIGN_FINALIZER",
  session_id: "session-finalizer",
  predecessor_session_id: null,
  campaign_id: "campaign-001",
  campaign_version: "001",
  governance_version: "2.1rc",
  display_name: "campaign-finalizer 001 2.1rc",
  pinned: true,
  state: "CAMPAIGN_ACTIVE",
  spawn_reason: "ON_DEMAND_FINALIZATION",
  material_seam: null,
});
terminalClosed.checkpoint_handoff = {
  kind: "TERMINAL_TO_RUNTIME",
  checkpoint_id: "checkpoint-y",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  commit: "commit-001",
  tree: "tree-001",
  remote_commit: "commit-001",
  remote_tree: "tree-001",
  lease_id: "lease-y",
  from_owner_role_id: "feature-y",
  from_goal_id: "goal-y-build",
  to_owner_role_id: "GLOBAL_RUNTIME",
  to_goal_id: "RUNTIME_INTEGRATION_AND_DEPLOYMENT",
  status: "ACCEPTED",
  living_record: structuredClone(livingState.living_record),
  product_acceptance_sha256: campaignDigest(terminalClosed.product_acceptance),
};
terminalClosed.accepted_live = {
  status: "VERIFIED",
  deployed_identity: "release-previous",
  rollback_identity: "rollback-previous",
  independent_audit_identity: "audit-state-001",
  closure_receipt_sha256: sha,
  cascade_state_sha256: terminalClosed.cascade.cascade_sha256,
};
terminalClosed.auditor.next_campaign_candidate = "RECORDED_FOR_ORCHESTRATOR";
terminalClosed.standard_promotion.status = "APPLIED";
terminalClosed.successor_wave = {
  status: "RECORDED",
  disposition_identity: "NO_NEXT_CAMPAIGN_REQUIRED",
  candidate_digest_sha256: sha,
  gpt_assist_handoff_sha256: null,
  successor_campaign_id: null,
  successor_campaign_version: null,
  successor_orchestrator_binding: null,
  successor_auditor_binding: null,
  successor_feature_agent_bindings: [],
  product_writer_lease_status: "NOT_APPLICABLE",
};
bindLivingRecord(terminalClosed, livingEvents, acceptedAcceptanceProof.proof);
validateCampaignState(terminalClosed, {
  product_acceptance_proof: acceptedAcceptanceProof.proof,
});
try {
  const missingCascadeWorker = structuredClone(terminalClosed);
  missingCascadeWorker.agents = missingCascadeWorker.agents.filter((agent) => agent.kind !== "AUDIT_WORKER");
  validateCampaignState(missingCascadeWorker, {
    product_acceptance_proof: acceptedAcceptanceProof.proof,
  });
  failures.push("cascade accepted without its real audit-worker roster");
} catch {
  hostileRejected += 1;
}

const terminalOriented = structuredClone(terminalClosed);
terminalOriented.status = "MERGED_NOT_ACCEPTED_LIVE";
terminalOriented.accepted_live = {
  status: "PENDING",
  deployed_identity: null,
  rollback_identity: null,
  independent_audit_identity: null,
  closure_receipt_sha256: null,
};
terminalOriented.auditor.next_campaign_candidate = "RECORDED_FOR_ORCHESTRATOR";
terminalOriented.standard_promotion.status = "NOT_APPLIED";
terminalOriented.successor_wave = {
  status: "ORIENTED_HELD",
  disposition_identity: "NEXT_CAMPAIGN_ADMITTED",
  candidate_digest_sha256: sha,
  gpt_assist_handoff_sha256: "9".repeat(64),
  successor_campaign_id: "campaign-002",
  successor_campaign_version: "002",
  successor_orchestrator_binding: {
    role_id: "orchestrator",
    kind: "GLOBAL_ORCHESTRATOR",
    session_id: "session-orchestrator-002",
    campaign_id: "campaign-002",
    campaign_version: "002",
    governance_version: "2.1rc",
    display_name: "orchestrator 002 2.1rc",
    pinned: true,
    spawn_reason: "FRESH_CAMPAIGN",
  },
  successor_auditor_binding: {
    role_id: "auditor",
    kind: "INDEPENDENT_AUDITOR",
    session_id: "session-auditor-002",
    campaign_id: "campaign-002",
    campaign_version: "002",
    governance_version: "2.1rc",
    display_name: "auditor 002 2.1rc",
    pinned: true,
    spawn_reason: "FRESH_CAMPAIGN",
  },
  successor_feature_agent_bindings: [{
    role_id: "feature-x",
    kind: "FEATURE_AGENT",
    session_id: "session-feature-x-002",
    campaign_id: "campaign-002",
    campaign_version: "002",
    governance_version: "2.1rc",
    display_name: "feature-x 002 2.1rc",
    pinned: true,
    spawn_reason: "FRESH_CAMPAIGN",
  }, {
    role_id: "feature-z",
    kind: "FEATURE_AGENT",
    session_id: "session-feature-z-002",
    campaign_id: "campaign-002",
    campaign_version: "002",
    governance_version: "2.1rc",
    display_name: "feature-z 002 2.1rc",
    pinned: true,
    spawn_reason: "FRESH_CAMPAIGN",
  }, {
    role_id: "feature-y",
    kind: "FEATURE_AGENT",
    session_id: "session-feature-y-002",
    campaign_id: "campaign-002",
    campaign_version: "002",
    governance_version: "2.1rc",
    display_name: "feature-y 002 2.1rc",
    pinned: true,
    spawn_reason: "FRESH_CAMPAIGN",
  }],
  product_writer_lease_status: "HELD_PENDING_ACCEPTED_LIVE",
};
bindLivingRecord(terminalOriented, livingEvents, acceptedAcceptanceProof.proof);
validateCampaignState(terminalOriented, {
  product_acceptance_proof: acceptedAcceptanceProof.proof,
});
const candidateOnly = structuredClone(terminalOriented);
candidateOnly.successor_wave = {
  status: "CANDIDATE_RECORDED",
  disposition_identity: "NEXT_CAMPAIGN_CANDIDATE",
  candidate_digest_sha256: sha,
  gpt_assist_handoff_sha256: "9".repeat(64),
  successor_campaign_id: null,
  successor_campaign_version: null,
  successor_orchestrator_binding: null,
  successor_auditor_binding: null,
  successor_feature_agent_bindings: [],
  product_writer_lease_status: "NOT_CREATED",
};
bindLivingRecord(candidateOnly, livingEvents, acceptedAcceptanceProof.proof);
validateCampaignState(candidateOnly, {
  product_acceptance_proof: acceptedAcceptanceProof.proof,
});
const directOnly = structuredClone(terminalOriented);
directOnly.gpt_assist_mode = "DIRECT_ONLY";
directOnly.successor_wave.gpt_assist_handoff_sha256 = null;
bindLivingRecord(directOnly, livingEvents, acceptedAcceptanceProof.proof);
validateCampaignState(directOnly, {
  product_acceptance_proof: acceptedAcceptanceProof.proof,
});
try {
  const forgedAcceptance = structuredClone(terminalClosed);
  forgedAcceptance.product_acceptance.roots.SECURITY = "OPEN_REPAIR";
  forgedAcceptance.product_acceptance.rc_ready = false;
  resealAcceptance(forgedAcceptance);
  validateCampaignState(forgedAcceptance, {
    product_acceptance_proof: acceptedAcceptanceProof.proof,
  });
  failures.push("Product acceptance roots escaped compiler binding");
} catch {
  hostileRejected += 1;
}
try {
  const forgedProof = structuredClone(acceptedAcceptanceProof.proof);
  forgedProof.observations[0].disposition = "NO";
  validateCampaignState(terminalClosed, {product_acceptance_proof: forgedProof});
  failures.push("forged question-tree observations were admitted");
} catch {
  hostileRejected += 1;
}
const nextRuntimeSnapshot = structuredClone(terminalOriented);
nextRuntimeSnapshot.snapshot_sequence += 1;
nextRuntimeSnapshot.snapshot_at = "2026-01-01T00:16:00.000Z";
bindLivingRecord(nextRuntimeSnapshot, livingEvents, acceptedAcceptanceProof.proof);
const terminalTransitionProof = {
  previous_events: livingEvents,
  next_events: livingEvents,
  previous_view_sha256: terminalOriented.living_record.current_view_sha256,
  next_view_sha256: nextRuntimeSnapshot.living_record.current_view_sha256,
  consumed_gpt_assist_handoff_sha256:
    terminalOriented.successor_wave.gpt_assist_handoff_sha256,
  previous_product_acceptance_proof: acceptedAcceptanceProof.proof,
  next_product_acceptance_proof: acceptedAcceptanceProof.proof,
};
applyCampaignTransition(terminalOriented, nextRuntimeSnapshot, {
  role: "GLOBAL_ORCHESTRATOR",
  session_id: "session-orchestrator",
}, terminalTransitionProof);
try {
  applyCampaignTransition(terminalOriented, nextRuntimeSnapshot, {
    role: "GLOBAL_ORCHESTRATOR",
    session_id: "session-orchestrator",
  }, {
    ...terminalTransitionProof,
    consumed_gpt_assist_handoff_sha256: "8".repeat(64),
  });
  failures.push("next campaign transition accepted the wrong GPT_ASSIST handoff");
} catch {
  hostileRejected += 1;
}
for (const [label, mutate] of [
  ["successor Product lease opens before accepted live", (d) => {
    d.successor_wave.product_writer_lease_status = "RELEASED_AFTER_ACCEPTED_LIVE";
  }],
  ["successor Orchestrator is missing", (d) => {
    d.successor_wave.successor_orchestrator_binding = null;
  }],
  ["successor Orchestrator is not fresh", (d) => {
    d.successor_wave.successor_orchestrator_binding.spawn_reason = "REUSED";
  }],
  ["successor Orchestrator and Auditor share a session", (d) => {
    d.successor_wave.successor_auditor_binding.session_id =
      d.successor_wave.successor_orchestrator_binding.session_id;
  }],
  ["DIRECT_ONLY successor claims GPT_ASSIST", (d) => {
    d.gpt_assist_mode = "DIRECT_ONLY";
  }],
  ["successor roster omits a dependency owner", (d) => {
    d.successor_wave.successor_feature_agent_bindings =
      d.successor_wave.successor_feature_agent_bindings.slice(0, 2);
  }],
]) {
  const draft = structuredClone(terminalOriented);
  mutate(draft);
  try {
    validateCampaignState(draft);
    failures.push(`hostile successor orientation accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}
for (const [label, mutate] of [
  ["candidate packet invents a successor campaign", (d) => {
    d.successor_wave.successor_campaign_id = "campaign-002";
  }],
  ["candidate packet opens a Product writer lease", (d) => {
    d.successor_wave.product_writer_lease_status = "HELD_PENDING_ACCEPTED_LIVE";
  }],
  ["candidate packet omits the GPT_ASSIST handoff", (d) => {
    d.successor_wave.gpt_assist_handoff_sha256 = null;
  }],
]) {
  const draft = structuredClone(candidateOnly);
  mutate(draft);
  try {
    validateCampaignState(draft);
    failures.push(`hostile candidate-only successor accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

for (const [label, mutate] of [
  ["non-orchestrator authority writer", (d) => { d.authority_writer_role = "INDEPENDENT_AUDITOR"; }],
  ["invalid progress interval", (d) => { d.progress_interval_minutes = 0; }],
  ["missing configuration snapshot", (d) => { d.configuration_snapshot_sha256 = "missing"; }],
  ["standard means work in progress", (d) => { d.standard_authority.meaning = "CURRENT_BRANCH"; }],
  ["dependency order drift", (d) => { d.dependency_order = ["z", "x", "y"]; }],
  ["dependency cycle", (d) => { d.dependency_nodes[0].depends_on = ["y"]; }],
  ["lease/root mismatch", (d) => { d.lease.root_id = "other"; }],
  ["active dependency owner mismatch", (d) => { d.active_goal.dependency_node_id = "z"; }],
  ["goal closes without handoff", (d) => {
    d.root.clean = true; d.root.pushed = true; d.lease.status = "RELEASED";
    d.active_goal.status = "COMPLETE";
  }],
  ["handoff wrong recipient", (d) => {
    Object.assign(d, structuredClone(completed));
    d.checkpoint_handoff.to_owner_role_id = "feature-y";
  }],
  ["handoff remote mismatch", (d) => {
    Object.assign(d, structuredClone(completed));
    d.checkpoint_handoff.remote_tree = "other-tree";
  }],
  ["missing dependency Feature Agent", (d) => {
    d.agents = d.agents.filter((a) => a.role_id !== "feature-z");
  }],
  ["stale Feature Agent", (d) => {
    d.agents.find((a) => a.role_id === "feature-x").spawn_reason = "REUSED";
  }],
  ["persistent campaign Orchestrator", (d) => {
    d.agents.find((a) => a.kind === "GLOBAL_ORCHESTRATOR").spawn_reason = "PERSISTENT";
  }],
  ["campaign agent missing versioned display name", (d) => {
    d.agents.find((a) => a.kind === "INDEPENDENT_AUDITOR").display_name = "auditor";
  }],
  ["Runtime not named persistent", (d) => {
    d.agents.find((a) => a.kind === "GLOBAL_RUNTIME").display_name = "runtime 001 2.1rc";
  }],
  ["duplicate pinned Feature Agent for active owner", (d) => {
    d.agents.push({
      role_id: "feature-x",
      kind: "FEATURE_AGENT",
      session_id: "session-feature-x-second",
      predecessor_session_id: "session-feature-x-other",
      campaign_id: "campaign-001",
      campaign_version: "001",
      governance_version: "2.1rc",
      display_name: "feature-x 001 2.1rc",
      pinned: true,
      state: "CAMPAIGN_ACTIVE",
      spawn_reason: "FRESH_CAMPAIGN",
      material_seam: null,
    });
  }],
  ["duplicate pinned campaign Orchestrator", (d) => {
    const duplicate = structuredClone(
      d.agents.find((agent) => agent.kind === "GLOBAL_ORCHESTRATOR"),
    );
    duplicate.session_id = "session-orchestrator-second";
    d.agents.push(duplicate);
  }],
  ["duplicate pinned campaign Auditor", (d) => {
    const duplicate = structuredClone(
      d.agents.find((agent) => agent.kind === "INDEPENDENT_AUDITOR"),
    );
    duplicate.session_id = "session-auditor-second";
    d.agents.push(duplicate);
  }],
  ["duplicate pinned persistent Runtime", (d) => {
    const duplicate = structuredClone(
      d.agents.find((agent) => agent.kind === "GLOBAL_RUNTIME"),
    );
    duplicate.session_id = "session-runtime-second";
    d.agents.push(duplicate);
  }],
  ["stale Auditor", (d) => { d.agents[2].spawn_reason = "REUSED"; }],
  ["Auditor state binds Feature Agent session", (d) => {
    d.auditor.session_id = "session-feature-x-new";
  }],
  ["Runtime state binds Feature Agent session", (d) => {
    d.runtime.session_id = "session-feature-y-new";
  }],
  ["platform agent pre-spawned", (d) => { d.agents.at(-1).spawn_reason = "CAMPAIGN_START"; }],
  ["duplicate session", (d) => { d.agents[3].session_id = "session-runtime"; }],
  ["suspended campaign without blocker", (d) => {
    d.status = "TRUE_BLOCKER_SUSPENDED";
    d.active_goal.status = "SUSPENDED_TRUE_BLOCKER";
  }],
  ["blocker while OPEN", (d) => {
    d.blocker = {
      class: "OWNER_PRODUCT_OR_POLICY_DECISION",
      reason: "owner choice",
      safe_alternatives_exhausted: true,
      exact_owner_question: "choose A or B?",
    };
  }],
  ["goal suspended without campaign suspension", (d) => {
    d.active_goal.status = "SUSPENDED_TRUE_BLOCKER";
  }],
  ["ordinary puzzle pauses campaign", (d) => {
    d.status = "TRUE_BLOCKER_SUSPENDED";
    d.active_goal.status = "SUSPENDED_TRUE_BLOCKER";
    d.blocker = {
      class: "FAILING_TEST",
      reason: "test failed",
      safe_alternatives_exhausted: true,
      exact_owner_question: "fix it?",
    };
  }],
  ["missing Product-acceptance state", (d) => { delete d.product_acceptance; }],
  ["RC_READY with an open root", (d) => { d.product_acceptance.rc_ready = true; }],
  ["Product acceptance bound to wrong Auditor", (d) => {
    d.product_acceptance.auditor_session_id = "session-feature-x-new";
  }],
  ["Product acceptance postdates snapshot", (d) => {
    d.product_acceptance.evaluated_at_utc = "2026-01-01T00:15:00.000Z";
  }],
  ["active critical freeze marked RC_READY", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.product_acceptance.critical_freezes = [{
      finding_sha256: sha,
      scope: "api/auth",
      global: false,
      status: "ACTIVE",
      clear_evidence_sha256: null,
    }];
  }],
  ["terminal handoff lacks three-root PASS", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.product_acceptance.roots.SECURITY = "OPEN_REPAIR";
    d.product_acceptance.rc_ready = false;
    d.checkpoint_handoff.product_acceptance_sha256 = campaignDigest(d.product_acceptance);
  }],
  ["handoff binds a different Product-acceptance state", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.checkpoint_handoff.product_acceptance_sha256 = "9".repeat(64);
  }],
  ["promotion before accepted live", (d) => { d.standard_promotion.status = "APPLIED"; }],
  ["closure without accepted-live identities", (d) => {
    d.status = "ACCEPTED_LIVE_CLOSED";
    d.standard_promotion.status = "APPLIED";
  }],
  ["closure with self-asserted successor booleans replaced by no identity", (d) => {
    d.status = "ACCEPTED_LIVE_CLOSED";
    d.standard_promotion.status = "APPLIED";
    d.accepted_live = {
      status: "VERIFIED",
      deployed_identity: "release-previous",
      rollback_identity: "rollback-previous",
      independent_audit_identity: "audit-live",
      closure_receipt_sha256: sha,
    };
    d.auditor.next_campaign_candidate = "RECORDED_FOR_ORCHESTRATOR";
    d.successor_wave.status = "RECORDED";
  }],
  ["closure while feature goal remains active", (d) => {
    d.status = "ACCEPTED_LIVE_CLOSED";
    d.standard_authority.release_identity = "release-previous";
    d.standard_promotion.status = "APPLIED";
    d.accepted_live = {
      status: "VERIFIED",
      deployed_identity: "release-previous",
      rollback_identity: "rollback-previous",
      independent_audit_identity: "audit-state-001",
      closure_receipt_sha256: sha,
    };
    d.auditor.next_campaign_candidate = "RECORDED_FOR_ORCHESTRATOR";
    d.successor_wave = {
      status: "RECORDED",
      disposition_identity: "NO_NEXT_CAMPAIGN_REQUIRED",
      candidate_digest_sha256: sha,
      gpt_assist_handoff_sha256: null,
      successor_campaign_id: null,
      successor_campaign_version: null,
      successor_orchestrator_binding: null,
      successor_auditor_binding: null,
      successor_feature_agent_bindings: [],
      product_writer_lease_status: "NOT_APPLICABLE",
    };
  }],
  ["closure with dirty terminal root", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.root.clean = false;
  }],
  ["closure with active lease", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.lease.status = "ACTIVE";
  }],
  ["closure with wrong standard release", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.standard_authority.release_identity = "other-release";
  }],
  ["successor reuses current sessions", (d) => {
    Object.assign(d, structuredClone(terminalClosed));
    d.successor_wave = {
      status: "RECORDED",
      disposition_identity: "NEXT_CAMPAIGN_ADMITTED",
      candidate_digest_sha256: sha,
      gpt_assist_handoff_sha256: sha,
      successor_campaign_id: "campaign-002",
      successor_campaign_version: "002",
      successor_orchestrator_binding: {
        role_id: "orchestrator",
        kind: "GLOBAL_ORCHESTRATOR",
        session_id: "session-orchestrator",
        campaign_id: "campaign-002",
        campaign_version: "002",
        governance_version: "2.1rc",
        display_name: "orchestrator 002 2.1rc",
        pinned: true,
        spawn_reason: "FRESH_CAMPAIGN",
      },
      successor_auditor_binding: {
        role_id: "auditor",
        kind: "INDEPENDENT_AUDITOR",
        session_id: "session-auditor-new",
        campaign_id: "campaign-002",
        campaign_version: "002",
        governance_version: "2.1rc",
        display_name: "auditor 002 2.1rc",
        pinned: true,
        spawn_reason: "FRESH_CAMPAIGN",
      },
      successor_feature_agent_bindings: [{
        role_id: "feature-x",
        kind: "FEATURE_AGENT",
        session_id: "session-feature-x-new",
        campaign_id: "campaign-002",
        campaign_version: "002",
        governance_version: "2.1rc",
        display_name: "feature-x 002 2.1rc",
        pinned: true,
        spawn_reason: "FRESH_CAMPAIGN",
      }],
      product_writer_lease_status: "RELEASED_AFTER_ACCEPTED_LIVE",
    };
  }],
]) rejectState(label, mutate);

for (const [label, mutate] of [
  ["missing mandatory Security review", (d) => {
    d.required_review_roles = d.required_review_roles.filter((role) => role !== "SECURITY");
    d.reviews = d.reviews.filter((review) => review.reviewer_role_id !== "SECURITY");
  }],
  ["material review routed to another owner", (d) => {
    d.reviews.find((review) => review.severity === "MATERIAL").correction_owner_role_id = "feature-z";
  }],
  ["material review silently continues", (d) => { d.handoff_state = "CONTINUE"; }],
  ["reviewer takes Product custody", (d) => {
    d.reviews[0].read_only = false;
  }],
  ["unknown reviewer session", (d) => {
    d.reviews[0].session_id = "session-not-in-roster";
  }],
  ["duplicate reviewer session", (d) => {
    d.reviews[1].session_id = d.reviews[0].session_id;
  }],
  ["self-declared surface differs from paths", (d) => {
    d.changed_surfaces = ["BACKEND_API"];
  }],
  ["change manifest replayed onto another commit", (d) => {
    d.commit = "other-commit";
  }],
  ["change path changed without manifest rebind", (d) => {
    d.changed_paths = ["src/server/api.rs"];
  }],
  ["review report digest missing", (d) => {
    d.reviews[0].report_sha256 = "";
  }],
  ["free-form review gate", (d) => {
    d.reviews[0].failed_question_ids = ["DESIGN_BIBLE"];
  }],
  ["review binds another observation ledger", (d) => {
    d.reviews[0].question_observations_sha256 = "b".repeat(64);
  }],
]) {
  const draft = structuredClone(materialReviewBatch);
  mutate(draft);
  try {
    validateSeamReviewBatch(draft, seamReviewState);
    failures.push(`hostile seam review accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

for (const [label, mutate] of [
  ["wrong reviewer kind", (d) => {
    d.agents.find((agent) => agent.role_id === "SECURITY").kind = "FEATURE_AGENT";
  }],
  ["stale reviewer", (d) => {
    d.agents.find((agent) => agent.role_id === "SECURITY").state = "REPLACED_UNPINNED";
    d.agents.find((agent) => agent.role_id === "SECURITY").pinned = false;
  }],
  ["wrong reviewer seam", (d) => {
    d.agents.find((agent) => agent.role_id === "SECURITY").material_seam = "UI_UX";
  }],
]) {
  const rosterDraft = structuredClone(seamReviewState);
  mutate(rosterDraft);
  try {
    validateSeamReviewBatch(materialReviewBatch, rosterDraft);
    failures.push(`hostile seam reviewer roster accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

for (const [label, mutate] of [
  ["sensitive provider link retained", (d) => { d.sensitive_link = true; }],
  ["provider query secret retained", (d) => {
    d.official_authorization_url = `https://provider.example/login?${secretQuery}`;
  }],
  ["provider fragment secret retained", (d) => {
    d.official_authorization_url = `https://provider.example/login${secretFragment}`;
  }],
  ["provider URL credentials retained", (d) => {
    d.official_authorization_url = credentialedProviderUrl;
  }],
]) {
  const blockerDraft = structuredClone(providerBlocker);
  mutate(blockerDraft);
  try {
    decideHeartbeatAction(
      validState,
      {...observation, true_blocker: blockerDraft},
      "2026-01-01T00:15:00.000Z",
    );
    failures.push(`hostile provider blocker accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

const compactEvent = compileCompactEvent({
  campaign_id: "campaign-001",
  snapshot_sequence: 8,
  recorded_at: "2026-01-01T00:15:00.000Z",
  session_id: "session-feature-x-new",
  root_id: "root-001",
  branch: "campaign/campaign-001",
  event: "CHECKPOINT",
  role: "feature-x",
  goal: "goal-x-build",
  result: "substantial batch complete",
  commit: "commit-001",
  tree: "tree-001",
  changed_surfaces: ["UI"],
  checks: ["focused", "build"],
  blocker: null,
  next: "handoff to feature-z",
  previous_event_sha256: sha,
  evidence_pointer_sha256: sha,
});
validateCompactEvent(compactEvent);
for (const [label, mutate] of [
  ["extra event field", (event) => { event.receipt_ids = ["noise"]; }],
  ["chatty event", (event) => { event.result = "step-by-step narration"; }],
  ["event content changed without rebind", (event) => { event.commit = "other"; }],
  ["event chain missing", (event) => { event.previous_event_sha256 = ""; }],
]) {
  const event = structuredClone(compactEvent);
  mutate(event);
  try {
    validateCompactEvent(event);
    failures.push(`hostile event accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

try {
  decideHeartbeatAction(validState, {
    ...observation,
    true_blocker: {
      class: "FAILING_TEST",
      reason: "test failed",
      safe_alternatives_exhausted: true,
      exact_owner_question: "fix it?",
    },
  }, "2026-01-01T00:12:00.000Z");
  failures.push("ordinary puzzle accepted as heartbeat blocker");
} catch {
  hostileRejected += 1;
}

try {
  validateCampaignState({...structuredClone(validState), topology: "ADMITTED_MULTI_LANE"});
  failures.push("unimplemented multi-lane topology accepted for 2.1rc activation");
} catch {
  hostileRejected += 1;
}

try {
  decideHeartbeatAction(validState, {
    ...observation,
    material_progress: true,
    progress_kind: "PRODUCT_COMMIT",
    progress_identity: "self-attested-noncommit",
  }, "2026-01-01T00:12:00.000Z");
  failures.push("self-attested material progress accepted");
} catch {
  hostileRejected += 1;
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
fs.rmSync(ledgerRoot, {recursive: true, force: true});
console.log(
  `PASS Governance 2.1rc portable campaign controller: identity-bound checkpoint/handoff; `
  + `configuration-bound full-reality recovery; trusted sole authority writer; fresh on-demand agents; `
  + `accepted-live and successor continuity; ${hostileRejected} hostile cases rejected`,
);
