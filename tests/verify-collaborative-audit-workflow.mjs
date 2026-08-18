#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {aggregateSixAuditReports, beginRuntimeIntegration, closeAcceptedWave, compileCollaborativeAuditWave, compileStandardAuditFinding, markBulkRepairComplete, markIssueRepaired, recordAuditRound, recordIssueAudit, renderAuditFindingMarkdown, renderCombinedAuditResults, requestEscalationClone} from "../control/collaborative-audit-workflow.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const auditors = Array.from({length: 6}, (_, index) => ({auditor_id: `AUDITOR.${index + 1}`, standard_role_id: `STANDARD.${index + 1}`, read_only: true, may_repair: false}));
const wave = compileCollaborativeAuditWave({waveId: "WAVE.1", builderId: "BUILDER.1", worktreeRef: "opaque:worktree:wave-1", auditors, rosterCursor: 0, deliveryIntent: "REVIEW"});
assert.equal(wave.active_auditor_count, 6); assert.equal(wave.individual_report_paths.length, 6);
assert.throws(() => compileCollaborativeAuditWave({waveId: "WAVE.BAD", builderId: "BUILDER.1", worktreeRef: "opaque:worktree:x", auditors: auditors.slice(0, 5), rosterCursor: 0, deliveryIntent: "REVIEW"}), /exactly six/iu);

const finding = compileStandardAuditFinding({issueId: "AGENTOS-ISSUE-2026-0001", title: "Unsafe lifecycle handoff", severity: "HIGH", weaknessId: "CWE-664", summary: "A temporary checker can remain active after its accepted report is preserved.", research: "Lifecycle research shows that retained temporary authority increases stale-custody and confused-deputy risk after a handoff.", evidenceRefs: ["ref:test:lifecycle"], affectedScope: "Temporary audit worker lifecycle", repairAcceptance: "The Spawner closes the checker only after accepted handoff and zero remaining references.", auditorId: "AUDITOR.1"});
const reports = auditors.map((auditor, index) => ({auditor_id: auditor.auditor_id, report_path: wave.individual_report_paths[index], handoff_accepted: true, findings: index === 0 ? [finding] : []}));
let state = aggregateSixAuditReports(wave, reports); assert.equal(state.status, "BULK_REPAIR_ACTIVE"); assert.equal(state.active_auditor_count, 0); assert.equal(state.issues.length, 1);
assert.equal(aggregateSixAuditReports(wave, [...reports].reverse()).issues.length, 1);
assert.match(renderAuditFindingMarkdown(state.issues[0]), /Researched finding/u); assert.match(renderCombinedAuditResults(state), /AGENTOS-ISSUE-2026-0001/u);
assert.throws(() => aggregateSixAuditReports(wave, [...reports.slice(0, 5), reports[0]]), /duplicated|path differs/iu);

const secondFinding = compileStandardAuditFinding({issueId: "AGENTOS-ISSUE-2026-0003", title: "Second bulk repair item", severity: "LOW", weaknessId: "CWE-710", summary: "A second issue proves that the builder receives and repairs the complete list together.", research: "Bulk repair governance prevents a builder from presenting only a convenient subset to the six-agent audit round.", evidenceRefs: ["ref:test:bulk-second"], affectedScope: "Combined collaborative audit list", repairAcceptance: "Both pending items enter one complete six-agent audit round.", auditorId: "AUDITOR.2"});
const multiReports = reports.map((report) => report.auditor_id === "AUDITOR.2" ? {...report, findings: [secondFinding]} : report);
let multi = aggregateSixAuditReports(wave, multiReports);
assert.throws(() => markIssueRepaired(multi, "AGENTOS-ISSUE-2026-0001", "BUILDER.1"), /bulk repair/iu);
multi = markBulkRepairComplete(multi, {issueIds: ["AGENTOS-ISSUE-2026-0001", "AGENTOS-ISSUE-2026-0003"], actorId: "BUILDER.1"});
assert.throws(() => recordIssueAudit(multi, {issueId: "AGENTOS-ISSUE-2026-0001", passed: true, auditorGroupIds: Array.from({length: 6}, (_, index) => `BULK.AUDITOR.${index + 1}`)}), /audit round/iu);
multi = recordAuditRound(multi, {results: [{issue_id: "AGENTOS-ISSUE-2026-0001", passed: true}, {issue_id: "AGENTOS-ISSUE-2026-0003", passed: true}], auditorGroupIds: Array.from({length: 6}, (_, index) => `BULK.AUDITOR.${index + 1}`)});
assert.equal(multi.status, "WAVE_ACCEPTED");

for (let attempt = 1; attempt <= 3; attempt += 1) {
  state = markIssueRepaired(state, "AGENTOS-ISSUE-2026-0001", "BUILDER.1");
  assert.equal(state.issues[0].state, `PENDING_AUDIT_${attempt}`);
  const reauditors = Array.from({length: 6}, (_, index) => `REAUDITOR.${attempt}.${index + 1}`);
  state = recordIssueAudit(state, {issueId: "AGENTOS-ISSUE-2026-0001", passed: false, auditorGroupIds: reauditors});
}
assert.equal(state.status, "ESCALATION_REQUIRED"); assert.equal(state.issues[0].state, "ESCALATION_REQUIRED");
assert.throws(() => markIssueRepaired(state, "AGENTOS-ISSUE-2026-0001", "BUILDER.1"), /governed escalation clone/iu);
const fresh = Array.from({length: 6}, (_, index) => `ESCALATION.AUDITOR.${index + 1}`);
assert.throws(() => requestEscalationClone(state, {cloneAgentId: "BUILDER.SOL.1", originalBuilderChatRef: "opaque:builder-chat:one", freshAuditorIds: fresh}), /sealed global-governance authority/iu);
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-collaborative-governance-"));
const governance = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});
state = requestEscalationClone(state, {cloneAgentId: "BUILDER.ESCALATION.1", originalBuilderChatRef: "opaque:builder-chat:one", globalGovernanceAuthorityStore: governance.authorityStore, freshAuditorIds: fresh});
assert.equal(state.status, "ESCALATION_REPAIR_ACTIVE");
assert.equal(state.escalation.model_id, governance.snapshot.task_classes.find((entry) => entry.task_class === "FINAL_INTEGRATION").preferred_models[0]);
assert.equal(state.escalation.reasoning_effort, governance.snapshot.task_classes.find((entry) => entry.task_class === "FINAL_INTEGRATION").preferred_reasoning_effort);
assert.equal(typeof state.escalation.route_sha256, "string");

const normalWave = compileCollaborativeAuditWave({waveId: "WAVE.2", builderId: "BUILDER.2", worktreeRef: "opaque:worktree:wave-2", auditors, rosterCursor: 0, deliveryIntent: "REVIEW"});
const normalFinding = compileStandardAuditFinding({issueId: "AGENTOS-ISSUE-2026-0002", title: "Repairable lifecycle gap", severity: "MEDIUM", weaknessId: "CWE-664", summary: "A normal repair needs one independent audit before Runtime may integrate it.", research: "The governed workflow preserves separation between the repairing builder and the six independent auditors who verify the result.", evidenceRefs: ["ref:test:normal-cycle"], affectedScope: "Collaborative audit repair cycle", repairAcceptance: "Six fresh auditors accept the repair before Runtime begins integration.", auditorId: "AUDITOR.1"});
const normalReports = auditors.map((auditor, index) => ({auditor_id: auditor.auditor_id, report_path: normalWave.individual_report_paths[index], handoff_accepted: true, findings: index === 0 ? [normalFinding] : []}));
state = aggregateSixAuditReports(normalWave, normalReports);
state = markIssueRepaired(state, "AGENTOS-ISSUE-2026-0002", "BUILDER.2");
state = recordIssueAudit(state, {issueId: "AGENTOS-ISSUE-2026-0002", passed: true, auditorGroupIds: Array.from({length: 6}, (_, index) => `FINAL.AUDITOR.${index + 1}`)});
assert.equal(state.status, "WAVE_ACCEPTED"); assert.equal(state.issues[0].state, "CORRECTED");
state = beginRuntimeIntegration(state); assert.equal(state.status, "RUNTIME_INTEGRATING"); assert.equal(state.next_audit_group_may_start, true); assert.equal(state.next_builder_may_take_worktree, false);
assert.throws(() => closeAcceptedWave(state, {runtimeMerged: true, runtimeDeployed: false, deploymentRequired: false, builderHandoffAccepted: true, worktreeReferenced: true}), /still referenced/iu);
state = closeAcceptedWave(state, {runtimeMerged: true, runtimeDeployed: false, deploymentRequired: false, builderHandoffAccepted: true, worktreeReferenced: false});
assert.equal(state.status, "WAVE_CLOSED"); assert.equal(state.next_action, "ORCHESTRATOR_CONTINUE_NEXT_SIX_AND_SPAWNER_ATTACH_NEXT_BUILDER"); assert.equal(state.roster_cursor, 6); assert.equal(state.next_builder_may_take_worktree, true);
fs.rmSync(governanceRoot, {recursive: true, force: true});
console.log("PASS collaborative audit workflow: six independent reports, standard issues, bulk repair, three-attempt ceiling, fail-closed capability-first economic escalation, re-audit, Runtime integration, safe despawn, and next-six continuation");
