#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  aggregateSixAuditReports,
  closeAcceptedWave,
  compileCollaborativeAuditWave,
  compileStandardAuditFinding,
  recordAuditRound,
  renderAuditFindingMarkdown,
  requestEscalationClone,
} from "../control/collaborative-audit-workflow.mjs";

const auditors = Array.from({length: 6}, (_, index) => ({
  auditor_id: `AUDITOR.${index + 1}`,
  standard_role_id: `STANDARD.${index + 1}`,
  read_only: true,
  may_repair: false,
}));
const blocked = (operation) => assert.throws(operation, (error) =>
  error?.code === "COLLABORATIVE_AUDIT_TEMPORARY_ROLE_ADMISSION_REQUIRED");

const finding = compileStandardAuditFinding({
  issueId: "AGENTOS-ISSUE-2026-0001",
  title: "Unsafe lifecycle handoff",
  severity: "HIGH",
  weaknessId: "CWE-664",
  summary: "A temporary checker can remain active after its accepted report is preserved.",
  research: "Lifecycle research shows that retained temporary authority increases stale-custody and confused-deputy risk after a handoff.",
  evidenceRefs: ["ref:test:lifecycle"],
  affectedScope: "Temporary audit worker lifecycle",
  repairAcceptance: "Spawner closes the checker only after governed handoff and zero live references.",
  auditorId: "AUDITOR.1",
});
assert.match(renderAuditFindingMarkdown(finding), /Researched finding/u);

const request = {waveId: "WAVE.1", builderId: "BUILDER.1", worktreeRef: "opaque:worktree:wave-1", auditors, rosterCursor: 0, deliveryIntent: "REVIEW", spawnerLifecycleAuthority: Object.freeze(Object.create(null))};
blocked(() => compileCollaborativeAuditWave(request));
blocked(() => aggregateSixAuditReports({}, [], {spawnerLifecycleAuthority: request.spawnerLifecycleAuthority}));
blocked(() => recordAuditRound({}, {results: [], auditorGroupIds: [], spawnerLifecycleAuthority: request.spawnerLifecycleAuthority}));
blocked(() => requestEscalationClone({}, {spawnerLifecycleAuthority: request.spawnerLifecycleAuthority}));
blocked(() => closeAcceptedWave({}, {spawnerLifecycleAuthority: request.spawnerLifecycleAuthority}));
blocked(() => compileCollaborativeAuditWave({...request, authorityRoot: "/tmp/alternate"}));

console.log("PASS collaborative audit blueprint remains fail-closed until governed temporary-role admission, custody, and lifecycle receipts exist");
