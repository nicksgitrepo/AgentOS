#!/usr/bin/env node

/* Six-at-a-time collaborative audit, bulk repair, escalation, and wave closeout. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";
import {selectEcoModelRoute} from "./eco-model-policy.mjs";
import {assessAuditorRound} from "./auditor-round-custody.mjs";
import {authorizeAgentSpawn, authorizeAgentDespawn} from "./agent-lifecycle-custody.mjs";
import {consumeAuditorRoundReview, validateAuditorRoundReview} from "./auditor-round-review-authority.mjs";

export const COLLABORATIVE_AUDIT_SCHEMA = "agentos.collaborative_audit_workflow.v1";
export const AUDIT_FINDING_SCHEMA = "agentos.standard_audit_finding.v1";
export const AUDIT_GROUP_SIZE = 6;
export const MAX_BUILDER_AUDIT_ATTEMPTS = 3;
export const FINDING_STATES = Object.freeze(["OPEN", "PENDING_AUDIT_1", "PENDING_REPAIR_1", "PENDING_AUDIT_2", "PENDING_REPAIR_2", "PENDING_AUDIT_3", "ESCALATION_REQUIRED", "PENDING_ESCALATION_AUDIT", "CORRECTED"]);
export const SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const WAVE_STATES = Object.freeze(["SIX_AUDITORS_ACTIVE", "BULK_REPAIR_ACTIVE", "REAUDIT_REQUIRED", "ESCALATION_REQUIRED", "ESCALATION_REPAIR_ACTIVE", "WAVE_ACCEPTED", "RUNTIME_INTEGRATING", "WAVE_CLOSED"]);

const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const ISSUE = /^AGENTOS-(?:CVE|ISSUE)-\d{4}-\d{4,}$/u;
const AUDITOR_TASK = /^TASK\.AUDITOR\.[A-Z0-9._:-]{2,160}$/u;
const ROUND_REF = /^opaque:round:[A-Z0-9._:/-]{1,180}$/u;
const WORKTREE_REF = /^opaque:worktree:[A-Z0-9._:/-]{1,180}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA1 = /^[0-9a-f]{40}$/u;
function assert(condition, message, code) { if (!condition) { const error = new Error(message); if (code) error.code = code; throw error; } }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function sha(value, label) { assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256`); }
function text(value, label, minimum = 8) { assert(typeof value === "string" && value.trim().length >= minimum, `${label} is incomplete`); }
function body(value, field) { return {...structuredClone(value), [field]: null}; }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} is invalid`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`); }
function reviewReceipts(value, label) {
  assert(Array.isArray(value) && value.length === 6 && new Set(value).size === 6 && value.every((receipt) => SHA256.test(receipt)), `${label} must contain six unique sealed review receipts`, "COLLABORATIVE_AUDIT_EXTERNAL_REVIEW_REQUIRED");
  return value;
}
function validateRoundReviewBinding(independentReviewAuthority, round, receiptSha256) {
  validateAuditorRoundReview({authority: independentReviewAuthority, receiptSha256, expected: {round_sha256: round.round_sha256, candidate_commit_sha1: round.candidate.commit_sha1, candidate_tree_sha1: round.candidate.tree_sha1, rollback_commit_sha1: round.candidate.rollback_commit_sha1, rollback_tree_sha1: round.candidate.rollback_tree_sha1, package_sha256: round.candidate.package_sha256, gate_inventory_sha256: round.candidate.gate_inventory_sha256, fixture_inventory_sha256: round.candidate.fixture_inventory_sha256, context_sha256: round.candidate.context_sha256, execution_sha256: round.execution.execution_sha256}});
}
function requireGovernedTemporaryRoleLifecycle() {
  const error = new Error("Collaborative audit execution is prepared but inactive until canonical temporary-role packages, admissions, worktree custody, transition receipts, and Spawner lifecycle resolution are installed");
  error.code = "COLLABORATIVE_AUDIT_TEMPORARY_ROLE_ADMISSION_REQUIRED";
  throw error;
}

function validateWaveCandidate(candidate) {
  exact(candidate, ["candidate_ref", "commit_sha1", "tree_sha1", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "rollback_commit_sha1", "rollback_tree_sha1", "status"], "Audit wave candidate");
  assert(typeof candidate.candidate_ref === "string" && /^opaque:candidate:/u.test(candidate.candidate_ref), "Audit wave candidate reference is invalid");
  for (const key of ["commit_sha1", "tree_sha1", "rollback_commit_sha1", "rollback_tree_sha1"]) assert(GIT_SHA1.test(candidate[key]) && !/^([0-9a-f])\1{39}$/u.test(candidate[key]), `Audit wave candidate ${key} is invalid`);
  for (const key of ["package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256"]) sha(candidate[key], `Audit wave candidate ${key}`);
  assert(candidate.commit_sha1 !== candidate.rollback_commit_sha1 && candidate.tree_sha1 !== candidate.rollback_tree_sha1, "Audit wave candidate and rollback are identical");
  assert(candidate.status === "FROZEN_IMMUTABLE", "Audit wave candidate is not frozen", "COLLABORATIVE_AUDIT_CANDIDATE_NOT_FROZEN");
}

export function validateStandardAuditFinding(finding) {
  assert(finding?.schema === AUDIT_FINDING_SCHEMA && finding.version === 1, "Audit finding identity is invalid");
  assert(typeof finding.issue_id === "string" && ISSUE.test(finding.issue_id), "Audit finding issue ID is invalid"); id(finding.reported_by, "finding auditor"); assert(SEVERITIES.includes(finding.severity), "Audit finding severity is invalid");
  assert(FINDING_STATES.includes(finding.state), "Audit finding state is invalid"); assert(Number.isInteger(finding.audit_attempt) && finding.audit_attempt >= 0 && Number.isInteger(finding.repair_attempt) && finding.repair_attempt >= 0, "Audit finding attempt counters are invalid");
  sha(finding.finding_sha256, "Audit finding digest"); assert(finding.finding_sha256 === canonicalDigest(body(finding, "finding_sha256")), "Audit finding digest differs"); return finding;
}

export function validateCollaborativeAuditWave(wave) {
  assert(wave?.schema === COLLABORATIVE_AUDIT_SCHEMA && wave.version === 1 && wave.workflow === "COLLABORATIVE_AUDIT", "Collaborative audit wave identity is invalid");
  const required = ["schema", "version", "wave_id", "workflow", "status", "builder_id", "builder_spawn_receipt_sha256", "builder_worktree_ref", "candidate", "auditors", "active_auditor_count", "roster_cursor", "individual_report_paths", "combined_report_path", "issue_directory", "issues", "escalation", "accepted_review_receipts", "integration_review_receipt_sha256", "delivery_intent", "runtime_integration", "next_audit_group_may_start", "next_builder_may_take_worktree", "next_action", "builder_despawn_receipt_sha256", "escalation_despawn_receipt_sha256", "wave_sha256"];
  required.forEach((key) => assert(Object.hasOwn(wave, key), `Collaborative audit wave is missing required field: ${key}`, "COLLABORATIVE_AUDIT_SCHEMA_REQUIRED"));
  assert(SHA256.test(wave.builder_spawn_receipt_sha256) && SHA256.test(wave.wave_sha256), "Collaborative audit wave receipt or digest is invalid", "COLLABORATIVE_AUDIT_DIGEST_INVALID");
  assert(WAVE_STATES.includes(wave.status), "Collaborative audit wave status is invalid");
  id(wave.wave_id, "audit wave"); id(wave.builder_id, "audit builder"); validateWaveCandidate(wave.candidate); validateAuditGroup(wave.auditors); assert(!wave.auditors.some((auditor) => auditor.auditor_id === wave.builder_id), "Builder cannot also be an auditor", "COLLABORATIVE_AUDIT_SELF_REVIEW"); assert(/^opaque:worktree:/u.test(wave.builder_worktree_ref), "Audit wave worktree reference is invalid"); assert(wave.auditors.every((auditor) => auditor.auditor_worktree_ref !== wave.builder_worktree_ref), "Audit wave reuses the builder worktree", "COLLABORATIVE_AUDIT_SHARED_WORKTREE");
  assert(Number.isInteger(wave.active_auditor_count) && wave.active_auditor_count >= 0 && wave.active_auditor_count <= 6, "Audit wave active auditor count is invalid");
  assert(Array.isArray(wave.individual_report_paths) && wave.individual_report_paths.length === 6 && new Set(wave.individual_report_paths).size === 6, "Audit wave report paths are invalid");
  assert(Array.isArray(wave.issues), "Audit wave issues are invalid"); wave.issues.forEach(validateStandardAuditFinding); assert(Array.isArray(wave.accepted_review_receipts) && new Set(wave.accepted_review_receipts).size === wave.accepted_review_receipts.length && wave.accepted_review_receipts.every((value) => SHA256.test(value)), "Audit wave independent review receipt inventory is invalid", "COLLABORATIVE_AUDIT_EXTERNAL_REVIEW_REQUIRED");
  if (wave.integration_review_receipt_sha256 !== null) sha(wave.integration_review_receipt_sha256, "Audit wave integration review receipt");
  else assert(["RUNTIME_INTEGRATING", "WAVE_CLOSED"].includes(wave.status) === false, "Runtime wave is missing its consumed integration review", "COLLABORATIVE_AUDIT_RUNTIME_REVIEW_REQUIRED");
  if (wave.escalation !== null) {
    exact(wave.escalation, ["agent_id", "cloned_chat_ref", "model_id", "reasoning_effort", "route_sha256", "capability_floor", "selected_capability_score", "model_policy_snapshot_sha256", "model_policy_projection_sha256", "spawn_receipt_sha256", "partner_auditor_ids", "combined_report_path", "worktree_ref"], "Audit escalation");
    id(wave.escalation.agent_id, "escalation agent"); assert(/^opaque:builder-chat:/u.test(wave.escalation.cloned_chat_ref), "Escalation chat reference is invalid"); text(wave.escalation.model_id, "escalation model", 3); text(wave.escalation.reasoning_effort, "escalation reasoning", 3); sha(wave.escalation.route_sha256, "escalation route"); assert(Number.isFinite(wave.escalation.capability_floor) && Number.isFinite(wave.escalation.selected_capability_score) && wave.escalation.selected_capability_score >= wave.escalation.capability_floor, "Escalation capability floor is invalid"); sha(wave.escalation.model_policy_snapshot_sha256, "escalation model policy"); sha(wave.escalation.model_policy_projection_sha256, "escalation model projection"); sha(wave.escalation.spawn_receipt_sha256, "escalation spawn receipt"); assert(Array.isArray(wave.escalation.partner_auditor_ids) && wave.escalation.partner_auditor_ids.length === 6 && new Set(wave.escalation.partner_auditor_ids).size === 6, "Escalation partner auditors are invalid"); assert(wave.escalation.worktree_ref === wave.builder_worktree_ref && wave.escalation.combined_report_path === wave.combined_report_path, "Escalation custody differs from the audit wave");
  }
  assert(typeof wave.next_audit_group_may_start === "boolean" && typeof wave.next_builder_may_take_worktree === "boolean", "Audit wave continuation flags are invalid");
  if (wave.status === "SIX_AUDITORS_ACTIVE") assert(wave.active_auditor_count === 6, "Active audit wave must have six auditors");
  if (["BULK_REPAIR_ACTIVE", "REAUDIT_REQUIRED", "ESCALATION_REQUIRED", "ESCALATION_REPAIR_ACTIVE", "WAVE_ACCEPTED", "RUNTIME_INTEGRATING", "WAVE_CLOSED"].includes(wave.status)) assert(wave.active_auditor_count === 0, "Handed-off audit wave retained temporary auditors");
  assert(wave.builder_despawn_receipt_sha256 === null || SHA256.test(wave.builder_despawn_receipt_sha256), "Audit wave builder despawn receipt is invalid", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPT_REQUIRED"); assert(wave.escalation_despawn_receipt_sha256 === null || SHA256.test(wave.escalation_despawn_receipt_sha256), "Audit wave escalation despawn receipt is invalid", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPT_REQUIRED");
  if (wave.status === "WAVE_CLOSED") assert(SHA256.test(wave.builder_despawn_receipt_sha256) && (wave.escalation === null || SHA256.test(wave.escalation_despawn_receipt_sha256)), "Closed audit wave is missing durable despawn receipts", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPT_REQUIRED");
  sha(wave.wave_sha256, "Audit wave digest"); assert(wave.wave_sha256 === canonicalDigest(body(wave, "wave_sha256")), "Audit wave digest differs"); return wave;
}

export function compileStandardAuditFinding({issueId, title, severity, weaknessId, summary, research, evidenceRefs, affectedScope, repairAcceptance, auditorId} = {}) {
  assert(typeof issueId === "string" && ISSUE.test(issueId), "Audit issue ID must use the standard AgentOS issue form"); id(auditorId, "finding auditor");
  assert(SEVERITIES.includes(severity), "Audit finding severity is invalid"); text(title, "Audit finding title"); text(weaknessId, "Audit weakness identity", 3); text(summary, "Audit finding summary", 24); text(research, "Audit finding research", 40); text(affectedScope, "Audit affected scope", 12); text(repairAcceptance, "Audit repair acceptance", 20);
  assert(Array.isArray(evidenceRefs) && evidenceRefs.length > 0 && evidenceRefs.every((value) => typeof value === "string" && /^(?:ref:|opaque:)/u.test(value)), "Audit finding evidence is invalid");
  const finding = {schema: AUDIT_FINDING_SCHEMA, version: 1, issue_id: issueId, title, severity, weakness_id: weaknessId, summary, researched_finding: research, evidence_refs: [...evidenceRefs].sort(compareUtf8), affected_scope: affectedScope, repair_acceptance: repairAcceptance, reported_by: auditorId, state: "OPEN", audit_attempt: 0, repair_attempt: 0, history: [{state: "OPEN", actor: auditorId, outcome: "REPORTED"}], finding_sha256: null};
  finding.finding_sha256 = canonicalDigest(body(finding, "finding_sha256")); return Object.freeze(validateStandardAuditFinding(finding));
}

export function validateAuditGroup(auditors) {
  assert(Array.isArray(auditors) && auditors.length === AUDIT_GROUP_SIZE, "Collaborative audit requires exactly six auditors");
  const ids = new Set(), standards = new Set(), tasks = new Set(), rounds = new Set(), roundDigests = new Set(), worktrees = new Set();
  for (const auditor of auditors) {
    assert(auditor && typeof auditor === "object", "Audit group entry is invalid"); id(auditor.auditor_id, "auditor ID"); id(auditor.standard_role_id, "auditor standard role"); assert(typeof auditor.task_id === "string" && AUDITOR_TASK.test(auditor.task_id), "Auditor task identity is missing or invalid"); assert(typeof auditor.round_ref === "string" && ROUND_REF.test(auditor.round_ref), "Auditor round reference is missing or invalid"); assert(typeof auditor.round_sha256 === "string" && SHA256.test(auditor.round_sha256), "Auditor round digest is missing or invalid"); assert(typeof auditor.auditor_worktree_ref === "string" && WORKTREE_REF.test(auditor.auditor_worktree_ref), "Auditor worktree custody is missing or invalid");
    assert(auditor.read_only === true && auditor.may_repair === false, "Auditors must be read-only and cannot repair their candidate");
    assert(!ids.has(auditor.auditor_id) && !standards.has(auditor.standard_role_id) && !tasks.has(auditor.task_id) && !rounds.has(auditor.round_ref) && !roundDigests.has(auditor.round_sha256) && !worktrees.has(auditor.auditor_worktree_ref), "Audit group contains duplicate identities, rounds, digests, or custody");
    ids.add(auditor.auditor_id); standards.add(auditor.standard_role_id); tasks.add(auditor.task_id); rounds.add(auditor.round_ref); roundDigests.add(auditor.round_sha256); worktrees.add(auditor.auditor_worktree_ref);
  }
  return auditors;
}

export function compileCollaborativeAuditWave({waveId, builderId, worktreeRef, candidate, auditors, rosterCursor, deliveryIntent, spawnerLifecycleAuthority, builderAdmissionReceiptRef, builderTransitionReceiptRef} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  id(waveId, "audit wave"); id(builderId, "audit wave builder"); validateAuditGroup(auditors); assert(!auditors.some((auditor) => auditor.auditor_id === builderId), "Builder cannot also be an auditor", "COLLABORATIVE_AUDIT_SELF_REVIEW");
  validateWaveCandidate(candidate);
  assert(/^opaque:worktree:/u.test(worktreeRef), "Collaborative audit builder requires an isolated worktree");
  assert(Number.isInteger(rosterCursor) && rosterCursor >= 0, "Audit roster cursor is invalid");
  assert(["REVIEW", "SAVE", "SHARE", "LIVE"].includes(deliveryIntent), "Audit wave delivery intent is invalid");
  const spawn = authorizeAgentSpawn({authority: spawnerLifecycleAuthority, requestId: `SPAWN.${waveId}.BUILDER`, requestedRoleId: "AGENTOS.REPAIR", admissionReceiptRef: builderAdmissionReceiptRef, transitionReceiptRef: builderTransitionReceiptRef, agentId: builderId});
  const wave = {schema: COLLABORATIVE_AUDIT_SCHEMA, version: 1, wave_id: waveId, workflow: "COLLABORATIVE_AUDIT", status: "SIX_AUDITORS_ACTIVE", builder_id: builderId, builder_spawn_receipt_sha256: spawn.receipt_sha256, builder_worktree_ref: worktreeRef, candidate: structuredClone(candidate), auditors: structuredClone(auditors), active_auditor_count: 6, roster_cursor: rosterCursor, individual_report_paths: auditors.map((_, index) => `audit-results/${waveId.toLowerCase()}/auditor-${index + 1}.md`), combined_report_path: `audit-results/${waveId.toLowerCase()}/auditresults.md`, issue_directory: `audit-results/${waveId.toLowerCase()}/issues`, issues: [], escalation: null, accepted_review_receipts: [], integration_review_receipt_sha256: null, delivery_intent: deliveryIntent, runtime_integration: "NOT_READY", next_audit_group_may_start: false, next_builder_may_take_worktree: false, next_action: "AUDITORS_WRITE_SIX_INDEPENDENT_REPORTS", builder_despawn_receipt_sha256: null, escalation_despawn_receipt_sha256: null, wave_sha256: null};
  wave.wave_sha256 = canonicalDigest(body(wave, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(wave));
}

export function aggregateSixAuditReports(wave, reports, {spawnerLifecycleAuthority, independentReviewAuthority} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); assert(wave.status === "SIX_AUDITORS_ACTIVE", "Audit wave is not ready for aggregation");
  assert(Array.isArray(reports) && reports.length === 6, "Orchestrator must receive six audit reports");
  const expected = new Set(wave.auditors.map((item) => item.auditor_id)), seen = new Set(), issueIds = new Set(), issues = [], reviewReceipts = [], preflightSeen = new Set(), preflightIssueIds = new Set();
  assert(independentReviewAuthority, "Audit report preflight requires the sealed review authority", "COLLABORATIVE_AUDIT_EXTERNAL_REVIEW_REQUIRED");
  for (const report of reports) {
    id(report.auditor_id, "audit report author"); assert(expected.has(report.auditor_id) && !preflightSeen.has(report.auditor_id), "Audit report preflight author inventory is duplicated or outside the group", "COLLABORATIVE_AUDIT_REPORT_INVENTORY_INVALID"); preflightSeen.add(report.auditor_id); const auditor = wave.auditors.find((item) => item.auditor_id === report.auditor_id);
    assert(auditor && report.auditor_round && report.auditor_round.auditor_task_id === auditor.task_id && report.auditor_round.auditor_identity !== wave.builder_id && report.auditor_round.round_sha256 === auditor.round_sha256 && report.auditor_round.round_id === auditor.round_ref.slice("opaque:round:".length) && report.auditor_round.custody?.auditor_worktree_ref === auditor.auditor_worktree_ref && canonicalDigest(report.auditor_round.candidate) === canonicalDigest(wave.candidate), "Audit report preflight round binding is invalid", "COLLABORATIVE_AUDIT_ROUND_BINDING_REQUIRED");
    const roundResult = assessAuditorRound(report.auditor_round); assert(roundResult.disposition === "PASS" || roundResult.disposition === "NOT_APPLICABLE_WITH_EVIDENCE", "Audit report preflight round is not a typed PASS/NOT_APPLICABLE result", "COLLABORATIVE_AUDIT_ROUND_NOT_PASS");
    assert(report.handoff_accepted === true && report.report_path === wave.individual_report_paths[wave.auditors.findIndex((item) => item.auditor_id === report.auditor_id)], "Audit report preflight handoff is missing or misrouted", "COLLABORATIVE_AUDIT_HANDOFF_INVALID"); assert(Array.isArray(report.findings), "Audit report preflight findings are invalid", "COLLABORATIVE_AUDIT_FINDINGS_INVALID"); report.findings.forEach((finding) => { validateStandardAuditFinding(finding); assert(finding.reported_by === report.auditor_id && !preflightIssueIds.has(finding.issue_id), "Audit report preflight finding author or identity differs", "COLLABORATIVE_AUDIT_FINDING_BINDING_INVALID"); preflightIssueIds.add(finding.issue_id); }); assert(typeof report.despawn_transition_receipt_ref === "string" && report.despawn_transition_receipt_ref.length > 0, "Audit report preflight despawn receipt is missing", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPT_REQUIRED");
    validateAuditorRoundReview({authority: independentReviewAuthority, receiptSha256: report.independent_review_receipt_sha256, expected: {round_sha256: report.auditor_round.round_sha256, candidate_commit_sha1: report.auditor_round.candidate.commit_sha1, candidate_tree_sha1: report.auditor_round.candidate.tree_sha1, rollback_commit_sha1: report.auditor_round.candidate.rollback_commit_sha1, rollback_tree_sha1: report.auditor_round.candidate.rollback_tree_sha1, package_sha256: report.auditor_round.candidate.package_sha256, gate_inventory_sha256: report.auditor_round.candidate.gate_inventory_sha256, fixture_inventory_sha256: report.auditor_round.candidate.fixture_inventory_sha256, context_sha256: report.auditor_round.candidate.context_sha256, execution_sha256: report.auditor_round.execution.execution_sha256}});
  }
  for (const report of reports) {
    id(report.auditor_id, "audit report author"); assert(expected.has(report.auditor_id) && !seen.has(report.auditor_id), "Audit report author is missing, duplicated, or outside the six-agent group"); seen.add(report.auditor_id); const auditor = wave.auditors.find((item) => item.auditor_id === report.auditor_id); assert(report.auditor_round && report.auditor_round.auditor_task_id === auditor.task_id && report.auditor_round.auditor_identity !== wave.builder_id && report.auditor_round.round_sha256 === auditor.round_sha256 && report.auditor_round.round_id === auditor.round_ref.slice("opaque:round:".length) && report.auditor_round.custody?.auditor_worktree_ref === auditor.auditor_worktree_ref && canonicalDigest(report.auditor_round.candidate) === canonicalDigest(wave.candidate), "Audit report is missing the exact auditor round binding", "COLLABORATIVE_AUDIT_ROUND_BINDING_REQUIRED"); const roundResult = assessAuditorRound(report.auditor_round); assert(roundResult.disposition === "PASS" || roundResult.disposition === "NOT_APPLICABLE_WITH_EVIDENCE", "Audit report round is not a typed PASS/NOT_APPLICABLE result", "COLLABORATIVE_AUDIT_ROUND_NOT_PASS"); assert(independentReviewAuthority && typeof report.independent_review_receipt_sha256 === "string" && SHA256.test(report.independent_review_receipt_sha256), "Audit report lacks a sealed independent review receipt", "COLLABORATIVE_AUDIT_EXTERNAL_REVIEW_REQUIRED"); const reviewReceipt = consumeAuditorRoundReview({authority: independentReviewAuthority, receiptSha256: report.independent_review_receipt_sha256, expected: {round_sha256: report.auditor_round.round_sha256, candidate_commit_sha1: report.auditor_round.candidate.commit_sha1, candidate_tree_sha1: report.auditor_round.candidate.tree_sha1, rollback_commit_sha1: report.auditor_round.candidate.rollback_commit_sha1, rollback_tree_sha1: report.auditor_round.candidate.rollback_tree_sha1, package_sha256: report.auditor_round.candidate.package_sha256, gate_inventory_sha256: report.auditor_round.candidate.gate_inventory_sha256, fixture_inventory_sha256: report.auditor_round.candidate.fixture_inventory_sha256, context_sha256: report.auditor_round.candidate.context_sha256, execution_sha256: report.auditor_round.execution.execution_sha256}}); reviewReceipts.push(reviewReceipt.receipt_sha256);
    const auditorIndex = wave.auditors.findIndex((item) => item.auditor_id === report.auditor_id);
    assert(report.handoff_accepted === true && report.report_path === wave.individual_report_paths[auditorIndex], "Audit report handoff or path differs");
    assert(Array.isArray(report.findings), "Audit report findings are invalid");
    for (const finding of report.findings) { validateStandardAuditFinding(finding); assert(finding.reported_by === report.auditor_id, "Audit finding is not bound to its auditor"); assert(!issueIds.has(finding.issue_id), "Combined audit contains a duplicate issue ID"); issueIds.add(finding.issue_id); issues.push(structuredClone(finding)); }
    assert(typeof report.despawn_transition_receipt_ref === "string", "Audit report closeout receipt is missing", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPT_REQUIRED");
  }
  for (const report of reports) authorizeAgentDespawn({authority: spawnerLifecycleAuthority, requestId: `DESPAWN.${wave.wave_id}.${report.auditor_id}`, agentId: report.auditor_id, transitionReceiptRef: report.despawn_transition_receipt_ref});
  const next = structuredClone(wave); next.status = issues.length === 0 ? "WAVE_ACCEPTED" : "BULK_REPAIR_ACTIVE"; next.active_auditor_count = 0; next.accepted_review_receipts = reviewReceipts.sort(compareUtf8); next.issues = issues.sort((a, b) => compareUtf8(a.issue_id, b.issue_id)); next.next_action = issues.length === 0 ? "RUNTIME_INTEGRATE_ACCEPTED_WAVE" : "BUILDER_REPAIR_COMBINED_REPORT_IN_BULK"; next.runtime_integration = issues.length === 0 ? "READY" : "NOT_READY"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function markBulkRepairComplete(wave, {issueIds, actorId} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); const next = structuredClone(wave); id(actorId, "repair actor");
  assert(Array.isArray(issueIds) && issueIds.length > 0 && new Set(issueIds).size === issueIds.length, "Bulk repair issue inventory is missing or duplicated");
  const eligible = next.issues.filter((item) => ["OPEN", "PENDING_REPAIR_1", "PENDING_REPAIR_2"].includes(item.state) || (item.state === "ESCALATION_REQUIRED" && actorId === next.escalation?.agent_id));
  assert(JSON.stringify(issueIds.slice().sort(compareUtf8)) === JSON.stringify(eligible.map((item) => item.issue_id).sort(compareUtf8)), "Builder must repair the complete eligible combined-report inventory in one bulk pass");
  for (const issue of eligible) {
    if (issue.state === "ESCALATION_REQUIRED") issue.state = "PENDING_ESCALATION_AUDIT";
    else { assert(actorId === next.builder_id, "Only the governed wave builder may perform the normal bulk repair"); issue.repair_attempt += 1; assert(issue.repair_attempt <= 3, "Original builder repair limit exceeded"); issue.state = `PENDING_AUDIT_${issue.repair_attempt}`; }
    issue.history.push({state: issue.state, actor: actorId, outcome: "REPAIRED_PENDING_INDEPENDENT_AUDIT"}); issue.finding_sha256 = canonicalDigest(body(issue, "finding_sha256"));
  }
  next.status = "REAUDIT_REQUIRED"; next.next_action = "SPAWNER_CREATE_FRESH_SIX_AUDITOR_GROUP"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function markIssueRepaired(wave, issueId, actorId) {
  requireGovernedTemporaryRoleLifecycle();
  const requested = wave.issues.find((item) => item.issue_id === issueId);
  if (requested?.state === "ESCALATION_REQUIRED") assert(actorId === wave.escalation?.agent_id, "Only the governed escalation clone may repair an escalated issue");
  const eligible = wave.issues.filter((item) => ["OPEN", "PENDING_REPAIR_1", "PENDING_REPAIR_2"].includes(item.state) || (item.state === "ESCALATION_REQUIRED" && actorId === wave.escalation?.agent_id));
  assert(eligible.length === 1 && eligible[0].issue_id === issueId, "Single-issue repair is allowed only when the combined report has exactly one eligible issue; otherwise use bulk repair");
  return markBulkRepairComplete(wave, {issueIds: [issueId], actorId});
}

export function recordAuditRound(wave, {results, auditorGroupIds, freshAuditors, auditorDespawnTransitionReceiptRefs, spawnerLifecycleAuthority, independentReviewAuthority} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); const next = structuredClone(wave);
  assert(Array.isArray(freshAuditors) && freshAuditors.length === 6, "Issue re-audit requires a fresh six-auditor descriptor group", "COLLABORATIVE_AUDIT_REAUDIT_GROUP_REQUIRED"); validateAuditGroup(freshAuditors);
  assert(Array.isArray(auditorGroupIds) && auditorGroupIds.length === 6 && new Set(auditorGroupIds).size === 6, "Issue re-audit requires a fresh six-auditor group", "COLLABORATIVE_AUDIT_REAUDIT_GROUP_REQUIRED");
  assert(JSON.stringify(auditorGroupIds.slice().sort(compareUtf8)) === JSON.stringify(freshAuditors.map((auditor) => auditor.auditor_id).sort(compareUtf8)), "Re-audit IDs do not match the fresh auditor descriptors", "COLLABORATIVE_AUDIT_REAUDIT_GROUP_REQUIRED");
  assert(Array.isArray(auditorDespawnTransitionReceiptRefs) && auditorDespawnTransitionReceiptRefs.length === 6, "Issue re-audit despawn receipts are required", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPTS_REQUIRED");
  auditorDespawnTransitionReceiptRefs.forEach((value) => assert(typeof value === "string" && value.length > 0, "Issue re-audit despawn receipt is missing", "COLLABORATIVE_AUDIT_DESPAWN_RECEIPTS_REQUIRED"));
  const pending = next.issues.filter((item) => /^PENDING_(?:AUDIT_[123]|ESCALATION_AUDIT)$/u.test(item.state));
  assert(Array.isArray(results) && results.length === pending.length && new Set(results.map((item) => item.issue_id)).size === results.length, "Audit round must cover every pending issue exactly once");
  assert(JSON.stringify(results.map((item) => item.issue_id).sort(compareUtf8)) === JSON.stringify(pending.map((item) => item.issue_id).sort(compareUtf8)), "Audit round inventory differs from the combined report");
  assert(independentReviewAuthority, "Issue re-audit preflight requires the sealed review authority", "COLLABORATIVE_AUDIT_EXTERNAL_REVIEW_REQUIRED");
  for (const result of results) {
    assert(Array.isArray(result.auditor_rounds) && result.auditor_rounds.length === 6 && new Set(result.auditor_rounds.map((round) => round.auditor_task_id)).size === 6, "Issue re-audit preflight requires six distinct auditor rounds", "COLLABORATIVE_AUDIT_REAUDIT_GROUP_REQUIRED");
    const receipts = reviewReceipts(result.independent_review_receipt_sha256s, "Issue re-audit review receipts");
    result.auditor_rounds.forEach((round, index) => { const descriptor = freshAuditors.find((auditor) => auditor.task_id === round.auditor_task_id); assert(descriptor && descriptor.round_sha256 === round.round_sha256 && descriptor.round_ref === `opaque:round:${round.round_id}` && descriptor.auditor_worktree_ref === round.custody?.auditor_worktree_ref && round.auditor_identity !== wave.builder_id && canonicalDigest(round.candidate) === canonicalDigest(next.candidate), "Issue re-audit preflight round binding is invalid", "COLLABORATIVE_AUDIT_REAUDIT_BINDING_REQUIRED"); const roundResult = assessAuditorRound(round); assert(roundResult.disposition === "PASS" || roundResult.disposition === "NOT_APPLICABLE_WITH_EVIDENCE", "Issue re-audit preflight round is not a typed PASS/NOT_APPLICABLE result", "COLLABORATIVE_AUDIT_REAUDIT_NOT_PASS"); validateRoundReviewBinding(independentReviewAuthority, round, receipts[index]); });
  }
  for (const result of results) {
    const issue = pending.find((item) => item.issue_id === result.issue_id); assert(typeof result.passed === "boolean", "Issue audit result is required"); assert(Array.isArray(result.auditor_rounds) && result.auditor_rounds.length === 6 && new Set(result.auditor_rounds.map((round) => round.auditor_task_id)).size === 6, "Issue re-audit must contain six distinct auditor rounds", "COLLABORATIVE_AUDIT_REAUDIT_GROUP_REQUIRED");
    const receipts = reviewReceipts(result.independent_review_receipt_sha256s, "Issue re-audit review receipts");
    result.auditor_rounds.forEach((round, index) => { const descriptor = freshAuditors.find((auditor) => auditor.task_id === round.auditor_task_id); assert(descriptor && descriptor.round_sha256 === round.round_sha256 && descriptor.round_ref === `opaque:round:${round.round_id}` && descriptor.auditor_worktree_ref === round.custody?.auditor_worktree_ref && round.auditor_identity !== wave.builder_id && canonicalDigest(round.candidate) === canonicalDigest(next.candidate), "Issue re-audit round is not bound to the fresh six-auditor group or current candidate", "COLLABORATIVE_AUDIT_REAUDIT_BINDING_REQUIRED"); const roundResult = assessAuditorRound(round); assert(roundResult.disposition === "PASS" || roundResult.disposition === "NOT_APPLICABLE_WITH_EVIDENCE", "Issue re-audit round is not a typed PASS/NOT_APPLICABLE result", "COLLABORATIVE_AUDIT_REAUDIT_NOT_PASS"); validateRoundReviewBinding(independentReviewAuthority, round, receipts[index]); consumeAuditorRoundReview({authority: independentReviewAuthority, receiptSha256: receipts[index], expected: {round_sha256: round.round_sha256, candidate_commit_sha1: round.candidate.commit_sha1, candidate_tree_sha1: round.candidate.tree_sha1, rollback_commit_sha1: round.candidate.rollback_commit_sha1, rollback_tree_sha1: round.candidate.rollback_tree_sha1, package_sha256: round.candidate.package_sha256, gate_inventory_sha256: round.candidate.gate_inventory_sha256, fixture_inventory_sha256: round.candidate.fixture_inventory_sha256, context_sha256: round.candidate.context_sha256, execution_sha256: round.execution.execution_sha256}}); }); issue.audit_attempt += 1;
    if (result.passed) issue.state = "CORRECTED";
    else if (issue.state === "PENDING_ESCALATION_AUDIT") issue.state = "ESCALATION_REQUIRED";
    else if (issue.audit_attempt >= MAX_BUILDER_AUDIT_ATTEMPTS) issue.state = "ESCALATION_REQUIRED";
    else issue.state = `PENDING_REPAIR_${issue.audit_attempt}`;
    issue.history.push({state: issue.state, actor: "SIX_AUDITOR_CONSENSUS", outcome: result.passed ? "CORRECTED" : "FAILED_REAUDIT"}); issue.finding_sha256 = canonicalDigest(body(issue, "finding_sha256"));
  }
  for (const [index, auditorId] of auditorGroupIds.entries()) authorizeAgentDespawn({authority: spawnerLifecycleAuthority, requestId: `DESPAWN.${wave.wave_id}.${auditorId}`, agentId: auditorId, transitionReceiptRef: auditorDespawnTransitionReceiptRefs[index]});
  next.auditors = structuredClone(freshAuditors); next.active_auditor_count = 0;
  const unresolved = next.issues.filter((item) => item.state !== "CORRECTED"); next.status = unresolved.length === 0 ? "WAVE_ACCEPTED" : unresolved.some((item) => item.state === "ESCALATION_REQUIRED") ? "ESCALATION_REQUIRED" : "BULK_REPAIR_ACTIVE"; next.runtime_integration = unresolved.length === 0 ? "READY" : "NOT_READY"; next.next_action = unresolved.length === 0 ? "RUNTIME_INTEGRATE_ACCEPTED_WAVE" : next.status === "ESCALATION_REQUIRED" ? "FINISH_NON_ESCALATED_ISSUES_THEN_REQUEST_POLICY_ROUTED_ESCALATION_CLONE" : "BUILDER_REPAIR_COMBINED_REPORT_IN_BULK"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function recordIssueAudit(wave, {issueId, passed, auditorGroupIds, freshAuditors, auditorDespawnTransitionReceiptRefs, independentReviewReceiptSha256s, spawnerLifecycleAuthority, independentReviewAuthority} = {}) {
  const pending = wave.issues.filter((item) => /^PENDING_(?:AUDIT_[123]|ESCALATION_AUDIT)$/u.test(item.state));
  assert(pending.length === 1 && pending[0].issue_id === issueId, "Single-issue audit is allowed only when exactly one combined-report issue is pending; otherwise use an audit round");
  return recordAuditRound(wave, {results: [{issue_id: issueId, passed, independent_review_receipt_sha256s: independentReviewReceiptSha256s}], auditorGroupIds, freshAuditors, auditorDespawnTransitionReceiptRefs, spawnerLifecycleAuthority, independentReviewAuthority});
}

export function requestEscalationClone(wave, {cloneAgentId, originalBuilderChatRef, globalGovernanceAuthorityStore, spawnerLifecycleAuthority, freshAuditorIds, escalationAdmissionReceiptRef, escalationTransitionReceiptRef} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); assert(wave.status === "ESCALATION_REQUIRED", "Audit wave does not require escalation"); id(cloneAgentId, "escalation clone");
  assert(typeof originalBuilderChatRef === "string" && /^opaque:builder-chat:/u.test(originalBuilderChatRef), "Escalation requires the original builder chat reference");
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT"});
  assert(governed.snapshot.status === "ACCEPTED_ACTIVE" && governed.projection.snapshot_sha256 === governed.snapshot.snapshot_sha256, "Current model policy projection is not accepted and current");
  const route = selectEcoModelRoute({snapshot: governed.snapshot, taskClass: "FINAL_INTEGRATION", roleCapabilityFloor: 59, requiredContextTokens: 256000, requiredCapabilities: ["CODE", "LONG_CONTEXT", "TOOLS"], nowUtc: governed.observed_at_utc});
  assert(Array.isArray(freshAuditorIds) && freshAuditorIds.length === 6 && new Set(freshAuditorIds).size === 6, "Escalation requires six fresh partner auditors"); freshAuditorIds.forEach((value) => id(value, "escalation partner auditor"));
  assert(wave.issues.every((item) => item.state === "CORRECTED" || item.state === "ESCALATION_REQUIRED"), "Original builder must finish all eligible issues before escalation");
  const spawn = authorizeAgentSpawn({authority: spawnerLifecycleAuthority, requestId: `SPAWN.${wave.wave_id}.ESCALATION`, requestedRoleId: "AGENTOS.REPAIR", admissionReceiptRef: escalationAdmissionReceiptRef, transitionReceiptRef: escalationTransitionReceiptRef, agentId: cloneAgentId});
  const next = structuredClone(wave); next.escalation = {agent_id: cloneAgentId, cloned_chat_ref: originalBuilderChatRef, model_id: route.model_id, reasoning_effort: route.reasoning_effort, route_sha256: route.route_sha256, capability_floor: route.capability_floor, selected_capability_score: route.selected_capability_score, model_policy_snapshot_sha256: governed.snapshot.snapshot_sha256, model_policy_projection_sha256: governed.projection.projection_sha256, spawn_receipt_sha256: spawn.receipt_sha256, partner_auditor_ids: [...freshAuditorIds].sort(compareUtf8), combined_report_path: wave.combined_report_path, worktree_ref: wave.builder_worktree_ref}; next.status = "ESCALATION_REPAIR_ACTIVE"; next.next_action = "POLICY_ROUTED_ESCALATION_CLONE_REPAIR_ESCALATED_ISSUES"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function beginRuntimeIntegration(wave, {independentReviewAuthority, integrationReceiptRef} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); assert(wave.status === "WAVE_ACCEPTED" && wave.issues.every((item) => item.state === "CORRECTED"), "Only a fully corrected wave may enter Runtime integration"); assert(independentReviewAuthority && typeof integrationReceiptRef === "string" && SHA256.test(integrationReceiptRef), "Runtime integration requires a sealed independent review receipt", "COLLABORATIVE_AUDIT_RUNTIME_REVIEW_REQUIRED");
  const integrationReview = consumeAuditorRoundReview({authority: independentReviewAuthority, receiptSha256: integrationReceiptRef, expected: {candidate_commit_sha1: wave.candidate.commit_sha1, candidate_tree_sha1: wave.candidate.tree_sha1, rollback_commit_sha1: wave.candidate.rollback_commit_sha1, rollback_tree_sha1: wave.candidate.rollback_tree_sha1, package_sha256: wave.candidate.package_sha256, gate_inventory_sha256: wave.candidate.gate_inventory_sha256, fixture_inventory_sha256: wave.candidate.fixture_inventory_sha256, context_sha256: wave.candidate.context_sha256}});
  const next = structuredClone(wave); next.status = "RUNTIME_INTEGRATING"; next.integration_review_receipt_sha256 = integrationReview.receipt_sha256; next.runtime_integration = "MERGE_OR_GOVERNED_DEPLOY_IN_PROGRESS"; next.next_audit_group_may_start = true; next.next_builder_may_take_worktree = false; next.next_action = "ORCHESTRATOR_START_NEXT_SIX_AUDITORS_WHILE_RUNTIME_INTEGRATES"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function closeAcceptedWave(wave, {runtimeMerged, runtimeDeployed, deploymentRequired, builderHandoffAccepted, worktreeReferenced, builderDespawnTransitionReceiptRef, escalationDespawnTransitionReceiptRef, spawnerLifecycleAuthority} = {}) {
  requireGovernedTemporaryRoleLifecycle();
  validateCollaborativeAuditWave(wave); assert(wave.status === "RUNTIME_INTEGRATING" && wave.issues.every((item) => item.state === "CORRECTED") && typeof wave.integration_review_receipt_sha256 === "string", "Only a fully corrected Runtime integration may close");
  assert(runtimeMerged === true, "Runtime must merge the accepted wave before builder closeout");
  assert(deploymentRequired === (wave.delivery_intent === "LIVE"), "Runtime deployment requirement differs from owner delivery intent");
  assert(deploymentRequired ? runtimeDeployed === true : runtimeDeployed === false, "Runtime deployment result differs from the governed delivery intent");
  const despawn = authorizeAgentDespawn({authority: spawnerLifecycleAuthority, requestId: `DESPAWN.${wave.wave_id}.BUILDER`, agentId: wave.builder_id, transitionReceiptRef: builderDespawnTransitionReceiptRef});
  const escalationDespawn = wave.escalation === null ? null : authorizeAgentDespawn({authority: spawnerLifecycleAuthority, requestId: `DESPAWN.${wave.wave_id}.ESCALATION`, agentId: wave.escalation.agent_id, transitionReceiptRef: escalationDespawnTransitionReceiptRef});
  const next = structuredClone(wave); next.status = "WAVE_CLOSED"; next.runtime_integration = deploymentRequired ? "MERGED_AND_DEPLOYED" : "MERGED_NO_DEPLOYMENT_REQUESTED"; next.builder_despawn_receipt_sha256 = despawn.receipt_sha256; next.escalation_despawn_receipt_sha256 = escalationDespawn?.receipt_sha256 ?? null; next.roster_cursor += 6; next.next_audit_group_may_start = true; next.next_builder_may_take_worktree = true; next.next_action = "ORCHESTRATOR_CONTINUE_NEXT_SIX_AND_SPAWNER_ATTACH_NEXT_BUILDER"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function renderAuditFindingMarkdown(finding) {
  validateStandardAuditFinding(finding);
  return `# ${finding.issue_id}: ${finding.title}\n\n- Severity: ${finding.severity}\n- Weakness: ${finding.weakness_id}\n- State: ${finding.state}\n- Audit attempts: ${finding.audit_attempt}\n- Repair attempts: ${finding.repair_attempt}\n\n## Summary\n\n${finding.summary}\n\n## Researched finding\n\n${finding.researched_finding}\n\n## Affected scope\n\n${finding.affected_scope}\n\n## Repair acceptance\n\n${finding.repair_acceptance}\n`;
}

export function renderCombinedAuditResults(wave) {
  validateCollaborativeAuditWave(wave);
  return `# Audit Results\n\nWorkflow: Collaborative audit\nWave: ${wave.wave_id}\nStatus: ${wave.status}\n\n${wave.issues.map((item) => `- ${item.issue_id} — ${item.severity} — ${item.state} — ${item.title}`).join("\n")}\n`;
}
