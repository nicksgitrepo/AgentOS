#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ISSUE_REGISTRAR_ROLE_ID,
  ISSUE_REGISTRAR_FAILURE_CODE,
  ISSUE_TERMINAL_OWNER_STATUSES,
  IssueRegistrar,
  compileIssueMarkdown,
  compileIssueRegistry,
  compileIssueRegistrarRole,
  completeIssue,
  importHistoricalIssues,
  reopenIssue,
  submitIssue,
  submitRegression,
  updateIssue,
  validateIssueAuditAdmission,
  validateIssueRegistrarRole,
  validateIssueRuntimeDelivery,
  validateIssueWorkflowAdmission,
  validateIssueRecord,
  validateIssueRegistry,
  writeIssuesMarkdownAtomic,
} from "../control/issue-registrar.mjs";

const NOW = "2026-08-29T00:00:00.000Z";
const SHA = (char) => char.repeat(64);
const BASE = {
  product_prefix: "SOCIUNA",
  title: "Deterministic registrar finding",
  summary: "A complete standardized issue retained as typed evidence.",
  category: "GOVERNANCE",
  severity: "HIGH",
  reporter: {task_id: "TASK.REGISTRAR.001", thread_id: "THREAD.REGISTRAR.001", turn_id: "TURN.1", item_id: "ITEM.1"},
  evidence: [{evidence_id: "EVIDENCE.ONE", kind: "TEST_RECEIPT", reference: "ref:tests/registrar/one", sha256: SHA("1")}],
};

let registry = compileIssueRegistry();
const first = submitIssue(registry, BASE, {nowUtc: NOW});
registry = first.registry;
assert.equal(first.issue.issue_id, "SOCIUNA-ISSUE-2026-0001");
assert.equal(first.issue.status, "READY");
assert.equal(first.reserved, true);
assert.equal(first.receipt.action, "SUBMITTED");
validateIssueRegistry(registry);

// A malformed intake still reserves its number and remains visible with a typed failure.
const malformed = submitIssue(registry, {product_prefix: "SOCIUNA", reporter: {task_id: "TASK.MALFORMED"}}, {nowUtc: NOW});
registry = malformed.registry;
assert.equal(malformed.issue.issue_id, "SOCIUNA-ISSUE-2026-0002");
assert.equal(malformed.issue.status, "INTAKE_FAILED");
assert.equal(malformed.issue.lifecycle_stage, "NOT_AUTHORIZED");
assert.equal(malformed.issue.failure_code, ISSUE_REGISTRAR_FAILURE_CODE);
assert.ok(malformed.issue.missing_fields.includes("title"));
assert.ok(malformed.issue.resubmission_requirements.length > 0);
assert.equal(malformed.reserved, true);

// Completion upgrades the same immutable number rather than creating a record.
const completed = completeIssue(registry, malformed.issue.issue_id, {
  title: "Completed malformed intake",
  summary: "The previously incomplete issue now has all standardized fields.",
  category: "GOVERNANCE",
  severity: "MEDIUM",
  reporter: {task_id: "TASK.MALFORMED", thread_id: "THREAD.MALFORMED", turn_id: "TURN.2", item_id: "ITEM.2"},
  evidence: [{evidence_id: "EVIDENCE.COMPLETE", kind: "TEST_RECEIPT", reference: "ref:tests/registrar/complete", sha256: SHA("2")}],
}, {nowUtc: NOW});
registry = completed.registry;
assert.equal(completed.issue.issue_id, malformed.issue.issue_id);
assert.equal(completed.issue.status, "READY");
assert.equal(registry.issues.length, 2);

// Duplicate submissions consume no number but preserve reporter and evidence attribution.
const duplicate = submitIssue(registry, {...BASE, reporter: {task_id: "TASK.DUPLICATE", thread_id: "THREAD.DUPLICATE"}, evidence: [{evidence_id: "EVIDENCE.DUP", kind: "REPRO", reference: "ref:duplicate", sha256: SHA("3")}]}, {nowUtc: NOW});
registry = duplicate.registry;
assert.equal(duplicate.reserved, false);
assert.equal(duplicate.issue.issue_id, first.issue.issue_id);
assert.equal(duplicate.receipt.action, "DUPLICATE_LINKED");
assert.equal(duplicate.issue.duplicate_reports.at(-1).reporter.task_id, "TASK.DUPLICATE");
assert.equal(duplicate.issue.duplicate_reports.at(-1).evidence[0].sha256, SHA("3"));
assert.equal(registry.issues.length, 2);
assert.equal(registry.reservations.length, 2);

// Reporter disappearance cannot erase the captured snapshot.
const reporterInput = {...BASE, title: "Reporter snapshot", reporter: {task_id: "TASK.SNAPSHOT", thread_id: "THREAD.SNAPSHOT"}, dedupe_key: "SNAPSHOT"};
const snapshotResult = submitIssue(registry, reporterInput, {nowUtc: NOW});
reporterInput.reporter = null;
assert.equal(snapshotResult.issue.reporter.task_id, "TASK.SNAPSHOT");

// Security-sensitive evidence is redacted to an opaque reference.
const secret = submitIssue(registry, {...BASE, title: "Redacted evidence", dedupe_key: "REDACTED", evidence: [{evidence_id: "EVIDENCE.SECRET", kind: "SECRET_TOKEN", sensitive: true, payload: "do-not-persist", sha256: SHA("4")}]}, {nowUtc: NOW});
assert.equal(secret.issue.evidence[0].redacted, true);
assert.match(secret.issue.evidence[0].reference, /^opaque:issue-evidence:/u);
assert.doesNotMatch(JSON.stringify(secret.issue), /do-not-persist/u);

// Same-root reopen keeps the identifier; another root must be linked as a new issue.
const reopened = reopenIssue(registry, first.issue.issue_id, {nowUtc: NOW});
assert.equal(reopened.issue.issue_id, first.issue.issue_id);
assert.equal(reopened.issue.status, "REOPENED");
assert.throws(() => reopenIssue(registry, first.issue.issue_id, {rootIssueId: "SOCIUNA-ISSUE-2026-9999", nowUtc: NOW}), /DIFFERENT_ROOT_REQUIRES_LINK/u);
const regression = submitRegression(registry, {...BASE, title: "Regression finding", dedupe_key: "REGRESSION"}, first.issue.issue_id, {nowUtc: NOW});
assert.equal(regression.issue.status, "REGRESSION");
assert.equal(regression.issue.regression_of, first.issue.issue_id);

// Only Owner authority can set terminal decisions.
assert.ok(ISSUE_TERMINAL_OWNER_STATUSES.includes("DEFERRED"));
assert.throws(() => updateIssue(registry, first.issue.issue_id, {status: "DEFERRED"}, {nowUtc: NOW, actor: ISSUE_REGISTRAR_ROLE_ID}), /OWNER_ONLY/u);
const deferred = updateIssue(registry, first.issue.issue_id, {status: "DEFERRED", reason: "Owner accepted the residual risk."}, {nowUtc: NOW, actor: "PROJECT_OWNER"});
assert.equal(deferred.issue.status, "DEFERRED");
assert.equal(deferred.issue.owner_decision.decided_by, "PROJECT_OWNER");
assert.throws(() => updateIssue(deferred.registry, first.issue.issue_id, {status: "READY"}, {nowUtc: NOW, actor: ISSUE_REGISTRAR_ROLE_ID}), /TERMINAL_IMMUTABLE/u);

// Workflow, audit, and Runtime delivery gates fail closed on missing identity/evidence.
assert.throws(() => validateIssueWorkflowAdmission({issue: first.issue, registration: {pass: false, ready: true}}), /REPAIR_NOT_READY/u);
assert.throws(() => validateIssueWorkflowAdmission({issue: first.issue, registration: {pass: true, ready: true}, lane: "LANE.A", activeIssues: [{issue_id: "SOCIUNA-ISSUE-2026-0099", lane: "LANE.A", status: "IN_REPAIR"}]}), /ONE_LANE_ONLY/u);
assert.deepEqual(validateIssueWorkflowAdmission({issue: first.issue, registration: {pass: true, ready: true}, lane: "LANE.A"}).accepted, true);
assert.throws(() => validateIssueAuditAdmission({issue: first.issue, candidate: {commit: "a".repeat(40), tree: "b".repeat(40), scope: "", verification_contract: "contract"}}), /candidate scope/u);
const candidate = {commit: "a".repeat(40), tree: "b".repeat(40), scope: "control/issue-registrar.mjs", verification_contract: "verify-issue-registrar"};
assert.equal(validateIssueAuditAdmission({issue: first.issue, candidate}).accepted, true);
assert.throws(() => validateIssueRuntimeDelivery({issue: first.issue, candidate, independentPass: {status: "PASS", identical_bytes: false}, delivery: {status: "DELIVERED_VERIFIED"}}), /RUNTIME_PASS_REQUIRED/u);
assert.equal(validateIssueRuntimeDelivery({issue: first.issue, candidate, independentPass: {status: "PASS", identical_bytes: true}, delivery: {local_commit: candidate.commit, origin_commit: candidate.commit, github_commit: candidate.commit, local_tree: candidate.tree, origin_tree: candidate.tree, github_tree: candidate.tree}}).accepted, true);
assert.throws(() => validateIssueRuntimeDelivery({issue: first.issue, candidate, independentPass: {status: "PASS", identical_bytes: true}, delivery: {local_commit: candidate.commit, origin_commit: "c".repeat(40), github_commit: candidate.commit, local_tree: candidate.tree, origin_tree: candidate.tree, github_tree: candidate.tree}}), /IDENTITY_MISMATCH/u);

// Deterministic projection sections and sole-writer/canonical-path enforcement.
const markdown = compileIssueMarkdown(registry);
assert.match(markdown, /<a id="provisional"><\/a>/u);
assert.match(markdown, /<a id="ready"><\/a>/u);
assert.match(markdown, /<a id="regressions"><\/a>/u);
const tempRoot = path.resolve(process.cwd(), "../../../Temp/issue-registrar-verification");
fs.rmSync(tempRoot, {recursive: true, force: true});
assert.throws(() => writeIssuesMarkdownAtomic(registry, {operationsRoot: tempRoot, actor: "OTHER.ROLE", deliveryEvidence: {status: "DELIVERED_VERIFIED"}}), /SOLE_WRITER_REQUIRED/u);
assert.throws(() => writeIssuesMarkdownAtomic(registry, {operationsRoot: tempRoot, actor: ISSUE_REGISTRAR_ROLE_ID, deliveryEvidence: {status: "PENDING"}}), /DELIVERY_REQUIRED/u);
const written = writeIssuesMarkdownAtomic(registry, {operationsRoot: tempRoot, actor: ISSUE_REGISTRAR_ROLE_ID, deliveryEvidence: {status: "DELIVERED_VERIFIED"}});
assert.equal(written.path, path.join(tempRoot, "issues.md"));
assert.equal(fs.readFileSync(written.path, "utf8"), written.markdown);

// Historical import is bounded and honest: uncertain/CREATED sources stay provisional.
const historical = importHistoricalIssues([
  {source_id: "PYRAMID.FEATURE.019", source_ref: "ref:audit-pyramid/feature/019", title: "Feature historical finding", summary: "Imported from a supplied report.", category: "AUDIT_FEATURE", severity: "HIGH", source_sha256: SHA("5")},
  {source_id: "LEGACY.CREATED.001", source_ref: "ref:legacy/created/001", title: "Created template", summary: "No result is inferred.", category: "LEGACY_TEMPLATE", severity: "MEDIUM", status: "CREATED", uncertain: true, missing_evidence_reasons: ["No independent evidence supplied."]},
], {registry: compileIssueRegistry(), nowUtc: NOW});
assert.equal(historical.imported.length, 2);
const importedTemplate = historical.registry.issues.find((issue) => issue.historical_source?.source_id === "LEGACY.CREATED.001");
assert.equal(importedTemplate.status, "INTAKE_FAILED");
assert.ok(importedTemplate.historical_source.missing_evidence_reasons.length > 0);

// Role identity, invalid templates, and digest tamper are fail-closed.
const role = compileIssueRegistrarRole();
assert.equal(validateIssueRegistrarRole(role).role_id, ISSUE_REGISTRAR_ROLE_ID);
const tampered = structuredClone(first.issue);
tampered.title = "tampered";
assert.throws(() => validateIssueRecord(tampered), /DIGEST_MISMATCH/u);
const badRegistry = structuredClone(registry);
badRegistry.issues.reverse();
assert.throws(() => validateIssueRegistry(badRegistry), /NONDETERMINISTIC_ORDER/u);

// The stateful API is deterministic and preserves append-only history.
const registrar = new IssueRegistrar({registry: compileIssueRegistry(), writerIdentity: ISSUE_REGISTRAR_ROLE_ID, operationsRoot: tempRoot});
const stateful = registrar.submit({...BASE, dedupe_key: "STATEFUL"}, {nowUtc: NOW});
assert.equal(stateful.issue.number, 1);
assert.equal(registrar.registry.issues[0].history.length, 1);

fs.rmSync(tempRoot, {recursive: true, force: true});
process.stdout.write(`ISSUE_REGISTRAR_FOCUSED_PASS issues=${registry.issues.length} imported=${historical.imported.length}\n`);
