#!/usr/bin/env node

/* Six-at-a-time collaborative audit, bulk repair, escalation, and wave closeout. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {authorizeAgentDespawn, authorizeAgentSpawn} from "./agent-lifecycle-custody.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";

export const COLLABORATIVE_AUDIT_SCHEMA = "agentos.collaborative_audit_workflow.v1";
export const AUDIT_FINDING_SCHEMA = "agentos.standard_audit_finding.v1";
export const AUDIT_GROUP_SIZE = 6;
export const MAX_BUILDER_AUDIT_ATTEMPTS = 3;
export const FINDING_STATES = Object.freeze(["OPEN", "PENDING_AUDIT_1", "PENDING_REPAIR_1", "PENDING_AUDIT_2", "PENDING_REPAIR_2", "PENDING_AUDIT_3", "ESCALATION_REQUIRED", "PENDING_ESCALATION_AUDIT", "CORRECTED"]);
export const SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const WAVE_STATES = Object.freeze(["SIX_AUDITORS_ACTIVE", "BULK_REPAIR_ACTIVE", "REAUDIT_REQUIRED", "ESCALATION_REQUIRED", "ESCALATION_REPAIR_ACTIVE", "WAVE_ACCEPTED", "RUNTIME_INTEGRATING", "WAVE_CLOSED"]);

const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const ISSUE = /^AGENTOS-(?:CVE|ISSUE)-\d{4}-\d{4,}$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function sha(value, label) { assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256`); }
function text(value, label, minimum = 8) { assert(typeof value === "string" && value.trim().length >= minimum, `${label} is incomplete`); }
function body(value, field) { return {...structuredClone(value), [field]: null}; }

export function validateStandardAuditFinding(finding) {
  assert(finding?.schema === AUDIT_FINDING_SCHEMA && finding.version === 1, "Audit finding identity is invalid");
  assert(typeof finding.issue_id === "string" && ISSUE.test(finding.issue_id), "Audit finding issue ID is invalid"); id(finding.reported_by, "finding auditor"); assert(SEVERITIES.includes(finding.severity), "Audit finding severity is invalid");
  assert(FINDING_STATES.includes(finding.state), "Audit finding state is invalid"); assert(Number.isInteger(finding.audit_attempt) && finding.audit_attempt >= 0 && Number.isInteger(finding.repair_attempt) && finding.repair_attempt >= 0, "Audit finding attempt counters are invalid");
  sha(finding.finding_sha256, "Audit finding digest"); assert(finding.finding_sha256 === canonicalDigest(body(finding, "finding_sha256")), "Audit finding digest differs"); return finding;
}

export function validateCollaborativeAuditWave(wave) {
  assert(wave?.schema === COLLABORATIVE_AUDIT_SCHEMA && wave.version === 1 && wave.workflow === "COLLABORATIVE_AUDIT", "Collaborative audit wave identity is invalid");
  assert(WAVE_STATES.includes(wave.status), "Collaborative audit wave status is invalid");
  id(wave.wave_id, "audit wave"); id(wave.builder_id, "audit builder"); validateAuditGroup(wave.auditors); assert(/^opaque:worktree:/u.test(wave.builder_worktree_ref), "Audit wave worktree reference is invalid");
  assert(Number.isInteger(wave.active_auditor_count) && wave.active_auditor_count >= 0 && wave.active_auditor_count <= 6, "Audit wave active auditor count is invalid");
  assert(Array.isArray(wave.individual_report_paths) && wave.individual_report_paths.length === 6 && new Set(wave.individual_report_paths).size === 6, "Audit wave report paths are invalid");
  assert(Array.isArray(wave.issues), "Audit wave issues are invalid"); wave.issues.forEach(validateStandardAuditFinding);
  assert(typeof wave.next_audit_group_may_start === "boolean" && typeof wave.next_builder_may_take_worktree === "boolean", "Audit wave continuation flags are invalid");
  if (wave.status === "SIX_AUDITORS_ACTIVE") assert(wave.active_auditor_count === 6, "Active audit wave must have six auditors");
  if (["BULK_REPAIR_ACTIVE", "REAUDIT_REQUIRED", "ESCALATION_REQUIRED", "ESCALATION_REPAIR_ACTIVE", "WAVE_ACCEPTED", "RUNTIME_INTEGRATING", "WAVE_CLOSED"].includes(wave.status)) assert(wave.active_auditor_count === 0, "Handed-off audit wave retained temporary auditors");
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
  const ids = new Set(), standards = new Set();
  for (const auditor of auditors) {
    assert(auditor && typeof auditor === "object", "Audit group entry is invalid"); id(auditor.auditor_id, "auditor ID"); id(auditor.standard_role_id, "auditor standard role");
    assert(auditor.read_only === true && auditor.may_repair === false, "Auditors must be read-only and cannot repair their candidate");
    assert(!ids.has(auditor.auditor_id) && !standards.has(auditor.standard_role_id), "Audit group contains duplicate identities or standards"); ids.add(auditor.auditor_id); standards.add(auditor.standard_role_id);
  }
  return auditors;
}

export function compileCollaborativeAuditWave({waveId, builderId, worktreeRef, auditors, rosterCursor, deliveryIntent} = {}) {
  id(waveId, "audit wave"); id(builderId, "audit wave builder"); validateAuditGroup(auditors);
  assert(/^opaque:worktree:/u.test(worktreeRef), "Collaborative audit builder requires an isolated worktree");
  assert(Number.isInteger(rosterCursor) && rosterCursor >= 0, "Audit roster cursor is invalid");
  assert(["REVIEW", "SAVE", "SHARE", "LIVE"].includes(deliveryIntent), "Audit wave delivery intent is invalid");
  const spawn = authorizeAgentSpawn({issuerRole: "AGENTOS.SPAWNER", requestedRole: "AGENTOS.COLLABORATIVE_BUILDER", bootstrapSpawnerStarted: true, worktreeRef, partnerAuditorIds: auditors.map((item) => item.auditor_id)});
  const wave = {schema: COLLABORATIVE_AUDIT_SCHEMA, version: 1, wave_id: waveId, workflow: "COLLABORATIVE_AUDIT", status: "SIX_AUDITORS_ACTIVE", builder_id: builderId, builder_spawn_receipt_sha256: spawn.receipt_sha256, builder_worktree_ref: worktreeRef, auditors: structuredClone(auditors), active_auditor_count: 6, roster_cursor: rosterCursor, individual_report_paths: auditors.map((_, index) => `audit-results/${waveId.toLowerCase()}/auditor-${index + 1}.md`), combined_report_path: `audit-results/${waveId.toLowerCase()}/auditresults.md`, issue_directory: `audit-results/${waveId.toLowerCase()}/issues`, issues: [], escalation: null, delivery_intent: deliveryIntent, runtime_integration: "NOT_READY", next_audit_group_may_start: false, next_builder_may_take_worktree: false, next_action: "AUDITORS_WRITE_SIX_INDEPENDENT_REPORTS", wave_sha256: null};
  wave.wave_sha256 = canonicalDigest(body(wave, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(wave));
}

export function aggregateSixAuditReports(wave, reports) {
  validateCollaborativeAuditWave(wave); assert(wave.status === "SIX_AUDITORS_ACTIVE", "Audit wave is not ready for aggregation");
  assert(Array.isArray(reports) && reports.length === 6, "Orchestrator must receive six audit reports");
  const expected = new Set(wave.auditors.map((item) => item.auditor_id)), seen = new Set(), issueIds = new Set(), issues = [];
  for (const report of reports) {
    id(report.auditor_id, "audit report author"); assert(expected.has(report.auditor_id) && !seen.has(report.auditor_id), "Audit report author is missing, duplicated, or outside the six-agent group"); seen.add(report.auditor_id);
    const auditorIndex = wave.auditors.findIndex((item) => item.auditor_id === report.auditor_id);
    assert(report.handoff_accepted === true && report.report_path === wave.individual_report_paths[auditorIndex], "Audit report handoff or path differs");
    assert(Array.isArray(report.findings), "Audit report findings are invalid");
    for (const finding of report.findings) { validateStandardAuditFinding(finding); assert(finding.reported_by === report.auditor_id, "Audit finding is not bound to its auditor"); assert(!issueIds.has(finding.issue_id), "Combined audit contains a duplicate issue ID"); issueIds.add(finding.issue_id); issues.push(structuredClone(finding)); }
    authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: report.auditor_id, roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The accepted audit report is preserved and this auditor scope is complete."});
  }
  const next = structuredClone(wave); next.status = issues.length === 0 ? "WAVE_ACCEPTED" : "BULK_REPAIR_ACTIVE"; next.active_auditor_count = 0; next.issues = issues.sort((a, b) => compareUtf8(a.issue_id, b.issue_id)); next.next_action = issues.length === 0 ? "RUNTIME_INTEGRATE_ACCEPTED_WAVE" : "BUILDER_REPAIR_COMBINED_REPORT_IN_BULK"; next.runtime_integration = issues.length === 0 ? "READY" : "NOT_READY"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function markBulkRepairComplete(wave, {issueIds, actorId} = {}) {
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
  const requested = wave.issues.find((item) => item.issue_id === issueId);
  if (requested?.state === "ESCALATION_REQUIRED") assert(actorId === wave.escalation?.agent_id, "Only the governed escalation clone may repair an escalated issue");
  const eligible = wave.issues.filter((item) => ["OPEN", "PENDING_REPAIR_1", "PENDING_REPAIR_2"].includes(item.state) || (item.state === "ESCALATION_REQUIRED" && actorId === wave.escalation?.agent_id));
  assert(eligible.length === 1 && eligible[0].issue_id === issueId, "Single-issue repair is allowed only when the combined report has exactly one eligible issue; otherwise use bulk repair");
  return markBulkRepairComplete(wave, {issueIds: [issueId], actorId});
}

export function recordAuditRound(wave, {results, auditorGroupIds} = {}) {
  validateCollaborativeAuditWave(wave); const next = structuredClone(wave);
  assert(Array.isArray(auditorGroupIds) && auditorGroupIds.length === 6 && new Set(auditorGroupIds).size === 6, "Issue re-audit requires a fresh six-auditor group"); auditorGroupIds.forEach((value) => id(value, "re-auditor"));
  const pending = next.issues.filter((item) => /^PENDING_(?:AUDIT_[123]|ESCALATION_AUDIT)$/u.test(item.state));
  assert(Array.isArray(results) && results.length === pending.length && new Set(results.map((item) => item.issue_id)).size === results.length, "Audit round must cover every pending issue exactly once");
  assert(JSON.stringify(results.map((item) => item.issue_id).sort(compareUtf8)) === JSON.stringify(pending.map((item) => item.issue_id).sort(compareUtf8)), "Audit round inventory differs from the combined report");
  for (const result of results) {
    const issue = pending.find((item) => item.issue_id === result.issue_id); assert(typeof result.passed === "boolean", "Issue audit result is required"); issue.audit_attempt += 1;
    if (result.passed) issue.state = "CORRECTED";
    else if (issue.state === "PENDING_ESCALATION_AUDIT") issue.state = "ESCALATION_REQUIRED";
    else if (issue.audit_attempt >= MAX_BUILDER_AUDIT_ATTEMPTS) issue.state = "ESCALATION_REQUIRED";
    else issue.state = `PENDING_REPAIR_${issue.audit_attempt}`;
    issue.history.push({state: issue.state, actor: "SIX_AUDITOR_CONSENSUS", outcome: result.passed ? "CORRECTED" : "FAILED_REAUDIT"}); issue.finding_sha256 = canonicalDigest(body(issue, "finding_sha256"));
  }
  for (const auditorId of auditorGroupIds) authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: auditorId, roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The re-audit result is accepted and this temporary auditor scope is complete."});
  const unresolved = next.issues.filter((item) => item.state !== "CORRECTED"); next.status = unresolved.length === 0 ? "WAVE_ACCEPTED" : unresolved.some((item) => item.state === "ESCALATION_REQUIRED") ? "ESCALATION_REQUIRED" : "BULK_REPAIR_ACTIVE"; next.runtime_integration = unresolved.length === 0 ? "READY" : "NOT_READY"; next.next_action = unresolved.length === 0 ? "RUNTIME_INTEGRATE_ACCEPTED_WAVE" : next.status === "ESCALATION_REQUIRED" ? "FINISH_NON_ESCALATED_ISSUES_THEN_REQUEST_SOL_ULTRA_CLONE" : "BUILDER_REPAIR_COMBINED_REPORT_IN_BULK"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function recordIssueAudit(wave, {issueId, passed, auditorGroupIds} = {}) {
  const pending = wave.issues.filter((item) => /^PENDING_(?:AUDIT_[123]|ESCALATION_AUDIT)$/u.test(item.state));
  assert(pending.length === 1 && pending[0].issue_id === issueId, "Single-issue audit is allowed only when exactly one combined-report issue is pending; otherwise use an audit round");
  return recordAuditRound(wave, {results: [{issue_id: issueId, passed}], auditorGroupIds});
}

export function requestEscalationClone(wave, {cloneAgentId, originalBuilderChatRef, globalGovernanceAuthorityStore, freshAuditorIds} = {}) {
  validateCollaborativeAuditWave(wave); assert(wave.status === "ESCALATION_REQUIRED", "Audit wave does not require escalation"); id(cloneAgentId, "escalation clone");
  assert(typeof originalBuilderChatRef === "string" && /^opaque:builder-chat:/u.test(originalBuilderChatRef), "Escalation requires the original builder chat reference");
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT"});
  const sol = governed.snapshot.models.find((model) => model.model_id === "gpt-5.6-sol");
  assert(sol?.host_available === true, "Current model policy must prove Sol availability before escalation spawn");
  assert(sol.supported_reasoning_efforts.includes("ultra") && sol.host_supported_reasoning_efforts.includes("ultra"), "Current model policy must prove Sol ultra availability before escalation spawn");
  assert(governed.snapshot.status === "ACCEPTED_ACTIVE" && governed.projection.snapshot_sha256 === governed.snapshot.snapshot_sha256, "Current model policy projection is not accepted and current");
  assert(Array.isArray(freshAuditorIds) && freshAuditorIds.length === 6 && new Set(freshAuditorIds).size === 6, "Escalation requires six fresh partner auditors"); freshAuditorIds.forEach((value) => id(value, "escalation partner auditor"));
  assert(wave.issues.every((item) => item.state === "CORRECTED" || item.state === "ESCALATION_REQUIRED"), "Original builder must finish all eligible issues before escalation");
  const spawn = authorizeAgentSpawn({issuerRole: "AGENTOS.SPAWNER", requestedRole: "AGENTOS.ESCALATION_BUILDER", bootstrapSpawnerStarted: true, worktreeRef: wave.builder_worktree_ref, partnerAuditorIds: freshAuditorIds});
  const next = structuredClone(wave); next.escalation = {agent_id: cloneAgentId, cloned_chat_ref: originalBuilderChatRef, model_id: "gpt-5.6-sol", reasoning_effort: "ultra", model_policy_snapshot_sha256: governed.snapshot.snapshot_sha256, model_policy_projection_sha256: governed.projection.projection_sha256, spawn_receipt_sha256: spawn.receipt_sha256, partner_auditor_ids: [...freshAuditorIds].sort(compareUtf8), combined_report_path: wave.combined_report_path, worktree_ref: wave.builder_worktree_ref}; next.status = "ESCALATION_REPAIR_ACTIVE"; next.next_action = "SOL_ULTRA_CLONE_REPAIR_ESCALATED_ISSUES"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function beginRuntimeIntegration(wave) {
  validateCollaborativeAuditWave(wave); assert(wave.status === "WAVE_ACCEPTED" && wave.issues.every((item) => item.state === "CORRECTED"), "Only a fully corrected wave may enter Runtime integration");
  const next = structuredClone(wave); next.status = "RUNTIME_INTEGRATING"; next.runtime_integration = "MERGE_OR_GOVERNED_DEPLOY_IN_PROGRESS"; next.next_audit_group_may_start = true; next.next_builder_may_take_worktree = false; next.next_action = "ORCHESTRATOR_START_NEXT_SIX_AUDITORS_WHILE_RUNTIME_INTEGRATES"; next.wave_sha256 = canonicalDigest(body(next, "wave_sha256")); return Object.freeze(validateCollaborativeAuditWave(next));
}

export function closeAcceptedWave(wave, {runtimeMerged, runtimeDeployed, deploymentRequired, builderHandoffAccepted, worktreeReferenced} = {}) {
  validateCollaborativeAuditWave(wave); assert(wave.status === "RUNTIME_INTEGRATING" && wave.issues.every((item) => item.state === "CORRECTED"), "Only a fully corrected Runtime integration may close");
  assert(runtimeMerged === true, "Runtime must merge the accepted wave before builder closeout");
  assert(deploymentRequired === (wave.delivery_intent === "LIVE"), "Runtime deployment requirement differs from owner delivery intent");
  assert(deploymentRequired ? runtimeDeployed === true : runtimeDeployed === false, "Runtime deployment result differs from the governed delivery intent");
  const despawn = authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: wave.builder_id, roleKind: "BUILDER", handoffAccepted: builderHandoffAccepted, scopeClosed: true, evidencePreserved: true, worktreeReferenced, activeCustodyRefs: [], reason: "Runtime finished the accepted wave and the next audit group may take custody."});
  const escalationDespawn = wave.escalation === null ? null : authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: wave.escalation.agent_id, roleKind: "ESCALATION_BUILDER", handoffAccepted: builderHandoffAccepted, scopeClosed: true, evidencePreserved: true, worktreeReferenced, activeCustodyRefs: [], reason: "Runtime finished the accepted escalation repair and no custody reference remains."});
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
