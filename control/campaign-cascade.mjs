#!/usr/bin/env node

import crypto from "node:crypto";
import {validateFinalizerRewriteAssessment} from "./cascade-economics.mjs";

export const CASCADE_STAGES = Object.freeze([
  "FIRST_PASS_BUILDING",
  "TERMINAL_PROPOSED",
  "FIRST_PASS_REPAIR_REQUIRED",
  "TERMINAL_SETTLED",
  "FINALIZER_PENDING",
  "FINALIZING",
  "DELTA_REPAIR",
  "READY_FOR_ACCEPTANCE",
]);
export const CASCADE_MODES = Object.freeze([
  "SMALL_DETERMINISTIC",
  "STANDARD_SUBSTANTIAL",
  "FOUNDATIONAL_HIGH_CONSEQUENCE",
]);
export const AUDIT_DISCIPLINES = Object.freeze([
  "FUNCTIONALITY",
  "DESIGN_UI_SHELL_NAVIGATION",
  "SECURITY",
  "CODE_QUALITY_HYGIENE",
]);
export const AUDIT_DISPOSITIONS = Object.freeze([
  "REQUIRED",
  "DEFERRED_UNTIL_TERMINAL",
  "NOT_APPLICABLE_WITH_PROOF",
  "DETERMINISTIC_ONLY",
]);
export const FINDING_SEVERITIES = Object.freeze([
  "NONCRITICAL",
  "MATERIAL",
  "CATASTROPHIC",
  "OWNER_ONLY",
]);
export const FINDING_ROUTES = Object.freeze([
  "CLOSED_NO_FINDING",
  "FINALIZATION_QUEUE",
  "IMMEDIATE_FIRST_PASS_REPAIR",
  "OWNER_ONLY",
]);
export const MODEL_POLICY_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const QUESTION_ID = /^(?:FR|DB|SEC)-[A-Z0-9._:-]+$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CASCADE_ID = /^[A-Z][A-Z0-9._:-]*$/u;
const STAGES = new Set(CASCADE_STAGES);
const MODES = new Set(CASCADE_MODES);
const DISCIPLINES = new Set(AUDIT_DISCIPLINES);
const DISPOSITIONS = new Set(AUDIT_DISPOSITIONS);
const SEVERITIES = new Set(FINDING_SEVERITIES);
const ROUTES = new Set(FINDING_ROUTES);
const MODEL_ROLES = new Set(MODEL_POLICY_ROLES);
const HOLD_KINDS = new Set(["CONTEXT", "AUTHORITY_BOUNDARY", "EXTERNAL_DEPENDENCY", "CREDENTIAL_ACCESS", "OWNER_DECISION", "PROTECTED_RESOURCE"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function cascadeDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sortedUniqueStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must be nonempty`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid string`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length && canonicalJson(values) === canonicalJson(sorted), `${label} must be unique and sorted`);
  return sorted;
}

function validatePathList(paths, label, {allowEmpty = false} = {}) {
  const sorted = sortedUniqueStrings(paths, label, {allowEmpty});
  for (const value of sorted) {
    assert(!value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..") && !value.includes("\0"), `${label} contains an unsafe path`);
  }
  return sorted;
}

function validateQuestionIds(ids, label, {allowEmpty = false} = {}) {
  const sorted = sortedUniqueStrings(ids, label, {allowEmpty});
  assert(sorted.every((id) => QUESTION_ID.test(id)), `${label} contains an invalid question ID`);
  return sorted;
}

const QUALITY_KEYS = [
  "intended_path_present", "affected_checks_pass", "interfaces_coherent",
  "critical_defect_disclosed", "safe_operations", "clean_checkpoint",
  "pushed_checkpoint", "incomplete_work", "evidence_sha256",
];

function validateQualityFloor(floor, terminal = false) {
  exactKeys(floor, QUALITY_KEYS, "first-pass quality floor");
  for (const field of QUALITY_KEYS.slice(0, 7)) assert(typeof floor[field] === "boolean", `quality floor ${field} must be boolean`);
  assert(Array.isArray(floor.incomplete_work), "quality floor incomplete_work must be an array");
  sortedUniqueStrings(floor.incomplete_work, "quality floor incomplete_work", {allowEmpty: true});
  requireSha(floor.evidence_sha256, "quality floor evidence");
  if (terminal) {
    for (const field of QUALITY_KEYS.slice(0, 7)) assert(floor[field] === true, `terminal first-pass quality floor is missing ${field}`);
  }
}

const CHECKPOINT_KEYS = [
  "schema", "candidate_id", "campaign_id", "campaign_version", "logical_lineage_id",
  "worktree_id", "branch", "commit", "tree", "remote_commit", "remote_tree",
  "clean", "pushed", "changed_paths", "changed_surfaces", "owner_role_id", "auditor_session_id",
  "checkpoint_kind", "terminal", "quality_floor", "created_at_utc", "candidate_sha256",
];

export function validateFirstPassCandidate(candidate) {
  exactKeys(candidate, CHECKPOINT_KEYS, "first-pass candidate");
  assert(candidate.schema === "governance.first_pass_candidate.v1", "first-pass candidate schema mismatch");
  for (const field of ["candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "worktree_id", "branch", "commit", "tree", "remote_commit", "remote_tree", "owner_role_id", "auditor_session_id", "checkpoint_kind"]) {
    requireString(candidate[field], `first-pass candidate ${field}`);
  }
  assert(CASCADE_ID.test(candidate.candidate_id), "first-pass candidate ID is invalid");
  assert(IDENTIFIER.test(candidate.worktree_id), "first-pass worktree ID is invalid");
  assert(["SUBSTANTIAL_CHECKPOINT", "TERMINAL_FIRST_PASS"].includes(candidate.checkpoint_kind), "first-pass checkpoint kind is invalid");
  assert(typeof candidate.terminal === "boolean", "first-pass terminal flag is invalid");
  assert(candidate.terminal === (candidate.checkpoint_kind === "TERMINAL_FIRST_PASS"), "first-pass terminal flag contradicts checkpoint kind");
  assert(typeof candidate.clean === "boolean" && typeof candidate.pushed === "boolean", "first-pass checkpoint state is invalid");
  if (candidate.pushed) {
    assert(candidate.clean === true, "pushed first-pass candidate is not clean");
    assert(candidate.commit === candidate.remote_commit && candidate.tree === candidate.remote_tree, "pushed first-pass candidate is not remote-equal");
  }
  validatePathList(candidate.changed_paths, "first-pass changed paths");
  sortedUniqueStrings(candidate.changed_surfaces, "first-pass changed surfaces");
  validateQualityFloor(candidate.quality_floor, candidate.terminal);
  requireUtc(candidate.created_at_utc, "first-pass creation time");
  const body = structuredClone(candidate);
  delete body.candidate_sha256;
  assert(candidate.candidate_sha256 === cascadeDigest(body), "first-pass candidate digest is not content-addressed");
  return candidate;
}

export function compileFirstPassCandidate(input) {
  requireRecord(input, "first-pass candidate input");
  const candidate = {
    schema: "governance.first_pass_candidate.v1",
    candidate_sha256: "",
    ...structuredClone(input),
  };
  candidate.changed_paths = [...candidate.changed_paths].sort(compareUtf8);
  candidate.changed_surfaces = [...candidate.changed_surfaces].sort(compareUtf8);
  candidate.quality_floor = {
    ...candidate.quality_floor,
    incomplete_work: [...candidate.quality_floor.incomplete_work].sort(compareUtf8),
  };
  candidate.terminal = Boolean(input.terminal);
  candidate.checkpoint_kind = candidate.terminal ? "TERMINAL_FIRST_PASS" : "SUBSTANTIAL_CHECKPOINT";
  delete candidate.candidate_sha256;
  candidate.candidate_sha256 = cascadeDigest(candidate);
  validateFirstPassCandidate(candidate);
  return candidate;
}

const SURFACE_DISCIPLINES = new Map([
  ["UI", ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION"]],
  ["AUTHENTICATED_UI", ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY"]],
  ["BACKEND_API", ["FUNCTIONALITY"]],
  ["DATABASE_SCHEMA", ["FUNCTIONALITY"]],
  ["PROVIDER_INTEGRATION", ["FUNCTIONALITY"]],
  ["RUNTIME_CONFIG", ["FUNCTIONALITY"]],
  ["SECURITY_BOUNDARY", ["SECURITY"]],
]);

export function deriveApplicableDisciplines(changedSurfaces) {
  const result = new Set();
  for (const surface of changedSurfaces) {
    for (const discipline of SURFACE_DISCIPLINES.get(surface) ?? []) result.add(discipline);
  }
  return result;
}

const AUDIT_PLAN_KEYS = ["schema", "candidate_id", "candidate_commit", "candidate_tree", "auditor_session_id", "terminal", "disciplines", "plan_sha256"];
const AUDIT_PLAN_DISCIPLINE_KEYS = ["discipline", "disposition", "applicability_evidence_sha256"];

export function validateAuditPlan(plan) {
  exactKeys(plan, AUDIT_PLAN_KEYS, "cascade audit plan");
  assert(plan.schema === "governance.cascade_audit_plan.v1", "cascade audit plan schema mismatch");
  for (const field of ["candidate_id", "candidate_commit", "candidate_tree"]) requireString(plan[field], `audit plan ${field}`);
  requireString(plan.auditor_session_id, "audit plan Auditor session");
  assert(typeof plan.terminal === "boolean", "audit plan terminal flag is invalid");
  assert(Array.isArray(plan.disciplines) && plan.disciplines.length === AUDIT_DISCIPLINES.length, "audit plan must contain all four disciplines");
  const seen = new Set();
  for (const item of plan.disciplines) {
    exactKeys(item, AUDIT_PLAN_DISCIPLINE_KEYS, "audit plan discipline");
    assert(DISCIPLINES.has(item.discipline) && !seen.has(item.discipline), "audit plan discipline is duplicate or unknown");
    seen.add(item.discipline);
    assert(DISPOSITIONS.has(item.disposition), "audit plan disposition is invalid");
    if (item.disposition === "NOT_APPLICABLE_WITH_PROOF") requireSha(item.applicability_evidence_sha256, "audit plan non-applicability evidence");
    else assert(item.applicability_evidence_sha256 === null, "audit plan carries unused applicability evidence");
  }
  assert([...seen].sort(compareUtf8).join("\0") === [...AUDIT_DISCIPLINES].sort(compareUtf8).join("\0"), "audit plan does not cover all four disciplines");
  const body = structuredClone(plan);
  delete body.plan_sha256;
  assert(plan.plan_sha256 === cascadeDigest(body), "audit plan digest is not content-addressed");
  return plan;
}

export function compileAuditPlan({candidate, auditorSessionId, terminal = false, applicability = {}, deterministicOnly = [], nonApplicabilityEvidence = {}}) {
  validateFirstPassCandidate(candidate);
  requireString(auditorSessionId, "audit plan Auditor session");
  assert(auditorSessionId === candidate.auditor_session_id, "audit plan Auditor differs from the checkpoint Auditor");
  const applicable = deriveApplicableDisciplines(candidate.changed_surfaces);
  const disciplines = AUDIT_DISCIPLINES.map((discipline) => {
    const explicitlySet = applicability[discipline];
    if (explicitlySet !== undefined) assert(typeof explicitlySet === "boolean" || explicitlySet === "DETERMINISTIC_ONLY", `audit applicability for ${discipline} must be boolean or DETERMINISTIC_ONLY`);
    const deterministic = deterministicOnly.includes(discipline) || explicitlySet === "DETERMINISTIC_ONLY";
    const isApplicable = explicitlySet === undefined ? applicable.has(discipline) : explicitlySet === true || explicitlySet === "DETERMINISTIC_ONLY";
    assert(typeof isApplicable === "boolean", `audit applicability for ${discipline} must be boolean or DETERMINISTIC_ONLY`);
    const disposition = deterministic
      ? "DETERMINISTIC_ONLY"
      : isApplicable
        ? "REQUIRED"
        : terminal ? "NOT_APPLICABLE_WITH_PROOF" : "DEFERRED_UNTIL_TERMINAL";
    const proof = disposition === "NOT_APPLICABLE_WITH_PROOF"
      ? nonApplicabilityEvidence[discipline]
        ?? cascadeDigest({candidate_id: candidate.candidate_id, candidate_commit: candidate.commit, candidate_tree: candidate.tree, discipline, changed_surfaces: candidate.changed_surfaces, rule: "NO_APPLICABLE_SURFACE"})
      : null;
    if (disposition === "NOT_APPLICABLE_WITH_PROOF") requireSha(proof, `${discipline} non-applicability evidence`);
    return {discipline, disposition, applicability_evidence_sha256: proof};
  });
  const plan = {
    schema: "governance.cascade_audit_plan.v1",
    candidate_id: candidate.candidate_id,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    auditor_session_id: auditorSessionId,
    terminal,
    disciplines,
    plan_sha256: "",
  };
  delete plan.plan_sha256;
  plan.plan_sha256 = cascadeDigest(plan);
  validateAuditPlan(plan);
  return plan;
}

const FINDING_KEYS = ["finding_id", "discipline", "severity", "causal_root_id", "route", "question_ids", "evidence_sha256", "summary"];
const AUDIT_REPORT_KEYS = ["schema", "report_id", "discipline", "candidate_id", "candidate_commit", "candidate_tree", "auditor_session_id", "worker_session_id", "read_only", "reviewed_question_ids", "failed_question_ids", "findings", "evidence_sha256", "settled", "report_sha256"];

function validateFinding(finding, expectedDiscipline, candidateCommit, candidateTree) {
  exactKeys(finding, FINDING_KEYS, "cascade finding");
  for (const field of ["finding_id", "causal_root_id", "summary"]) requireString(finding[field], `finding ${field}`);
  assert(DISCIPLINES.has(finding.discipline) && finding.discipline === expectedDiscipline, "finding discipline is not bound to its report");
  assert(SEVERITIES.has(finding.severity) && ROUTES.has(finding.route), "finding severity or route is invalid");
  validateQuestionIds(finding.question_ids, "finding question IDs", {allowEmpty: true});
  requireSha(finding.evidence_sha256, "finding evidence");
  if (["MATERIAL", "CATASTROPHIC"].includes(finding.severity)) {
    assert(finding.question_ids.length > 0, "material findings must map to a Function, Design Bible, or Security question");
  }
  if (finding.discipline === "CODE_QUALITY_HYGIENE" && finding.severity !== "NONCRITICAL") {
    assert(finding.question_ids.length > 0, "Code Quality findings must map to a Product root or remain NONCRITICAL hygiene");
  }
  if (finding.severity === "CATASTROPHIC") assert(["IMMEDIATE_FIRST_PASS_REPAIR", "OWNER_ONLY"].includes(finding.route), "catastrophic finding cannot wait for finalization");
  if (finding.severity === "OWNER_ONLY") assert(finding.route === "OWNER_ONLY", "owner-only finding must route to owner");
  if (finding.route === "FINALIZATION_QUEUE") assert(["NONCRITICAL", "MATERIAL"].includes(finding.severity), "only ordinary findings may enter finalization queue");
  assert(typeof candidateCommit === "string" && typeof candidateTree === "string", "finding candidate identity is unavailable");
}

export function validateAuditReport(report, plan) {
  exactKeys(report, AUDIT_REPORT_KEYS, "cascade audit report");
  assert(report.schema === "governance.cascade_audit_report.v1", "cascade audit report schema mismatch");
  assert(DISCIPLINES.has(report.discipline), "audit report discipline is invalid");
  const planItem = plan.disciplines.find((item) => item.discipline === report.discipline);
  assert(planItem?.disposition === "REQUIRED" || planItem?.disposition === "DETERMINISTIC_ONLY", "audit report is not planned");
  assert(report.report_id === `${report.discipline}-REPORT`, "audit report ID is not canonically bound to its discipline");
  for (const field of ["report_id", "candidate_id", "candidate_commit", "candidate_tree", "auditor_session_id", "evidence_sha256"]) requireString(report[field], `audit report ${field}`);
  assert(report.candidate_id === plan.candidate_id && report.candidate_commit === plan.candidate_commit && report.candidate_tree === plan.candidate_tree, "audit report candidate identity mismatch");
  assert(report.auditor_session_id === plan.auditor_session_id, "audit report is bound to a different campaign Auditor");
  assert(report.worker_session_id === null || typeof report.worker_session_id === "string", "audit worker identity is invalid");
  if (plan.terminal && planItem.disposition === "REQUIRED") {
    assert(report.worker_session_id === null || typeof report.worker_session_id === "string", "terminal audit worker identity is invalid");
  }
  if (planItem.disposition === "DETERMINISTIC_ONLY") assert(report.worker_session_id === null, "deterministic audit must not spawn a worker");
  assert(report.read_only === true && report.settled === true, "audit report is not read-only and settled");
  validateQuestionIds(report.reviewed_question_ids, "audit reviewed question IDs", {allowEmpty: true});
  validateQuestionIds(report.failed_question_ids, "audit failed question IDs", {allowEmpty: true});
  assert(report.failed_question_ids.every((id) => report.reviewed_question_ids.includes(id)), "failed audit question is not reviewed");
  assert(Array.isArray(report.findings), "audit report findings are required");
  const findingIds = new Set();
  for (const finding of report.findings) {
    validateFinding(finding, report.discipline, report.candidate_commit, report.candidate_tree);
    assert(!findingIds.has(finding.finding_id), "audit finding IDs duplicate");
    findingIds.add(finding.finding_id);
  }
  const body = structuredClone(report);
  delete body.report_sha256;
  assert(report.report_sha256 === cascadeDigest(body), "audit report digest is not content-addressed");
  return report;
}

export function compileAuditReport({plan, discipline, auditorSessionId, workerSessionId = null, reviewedQuestionIds = [], failedQuestionIds = [], findings = [], evidenceSha256}) {
  validateAuditPlan(plan);
  requireString(auditorSessionId, "Auditor session");
  requireSha(evidenceSha256, "audit evidence");
  const report = {
    schema: "governance.cascade_audit_report.v1",
    report_id: `${discipline}-REPORT`,
    discipline,
    candidate_id: plan.candidate_id,
    candidate_commit: plan.candidate_commit,
    candidate_tree: plan.candidate_tree,
    auditor_session_id: auditorSessionId,
    worker_session_id: workerSessionId,
    read_only: true,
    reviewed_question_ids: validateQuestionIds(reviewedQuestionIds, "reviewed question IDs", {allowEmpty: true}),
    failed_question_ids: validateQuestionIds(failedQuestionIds, "failed question IDs", {allowEmpty: true}),
    findings: structuredClone(findings),
    evidence_sha256: evidenceSha256,
    settled: true,
    report_sha256: "",
  };
  const body = structuredClone(report);
  delete body.report_sha256;
  report.report_sha256 = cascadeDigest(body);
  validateAuditReport(report, plan);
  return report;
}

const RECONCILIATION_KEYS = ["schema", "candidate_id", "candidate_commit", "candidate_tree", "terminal", "settled_disciplines", "reports", "findings", "immediate_first_pass_repairs", "finalization_queue", "owner_only_findings", "reconciliation_sha256"];
const REPORT_BINDING_KEYS = ["discipline", "report_sha256", "auditor_session_id", "worker_session_id"];

export function reconcileAuditFindings({plan, reports, terminal = plan.terminal}) {
  validateAuditPlan(plan);
  assert(Array.isArray(reports), "audit reports are required");
  assert(terminal === plan.terminal, "audit reconciliation terminal flag must match its plan");
  const required = plan.disciplines.filter((item) => ["REQUIRED", "DETERMINISTIC_ONLY"].includes(item.disposition)).map((item) => item.discipline);
  const byDiscipline = new Map();
  for (const report of reports) {
    validateAuditReport(report, plan);
    assert(!byDiscipline.has(report.discipline), "duplicate audit discipline report");
    byDiscipline.set(report.discipline, report);
  }
  for (const discipline of required) assert(byDiscipline.has(discipline), `missing settled audit discipline ${discipline}`);
  if (terminal) {
    assert(plan.terminal === true, "terminal reconciliation requires a terminal audit plan");
    assert(plan.disciplines.every((item) => ["REQUIRED", "DETERMINISTIC_ONLY", "NOT_APPLICABLE_WITH_PROOF"].includes(item.disposition)), "terminal audit plan contains deferred discipline");
  }
  const findings = reports.flatMap((report) => report.findings.map((finding) => ({...finding, source_report_sha256: report.report_sha256})));
  const findingIds = new Set();
  for (const finding of findings) {
    assert(!findingIds.has(finding.finding_id), "duplicate reconciled finding ID");
    findingIds.add(finding.finding_id);
  }
  const immediate = findings.filter((finding) => finding.route === "IMMEDIATE_FIRST_PASS_REPAIR").map((finding) => finding.finding_id).sort(compareUtf8);
  const finalization = findings.filter((finding) => finding.route === "FINALIZATION_QUEUE").map((finding) => finding.finding_id).sort(compareUtf8);
  const ownerOnly = findings.filter((finding) => finding.route === "OWNER_ONLY").map((finding) => finding.finding_id).sort(compareUtf8);
  const settledDisciplines = terminal
    ? plan.disciplines
      .filter((item) => item.disposition !== "DEFERRED_UNTIL_TERMINAL")
      .map((item) => item.discipline)
      .sort(compareUtf8)
    : [...byDiscipline.keys()].sort(compareUtf8);
  const reconciliation = {
    schema: "governance.cascade_audit_reconciliation.v1",
    candidate_id: plan.candidate_id,
    candidate_commit: plan.candidate_commit,
    candidate_tree: plan.candidate_tree,
    terminal,
    settled_disciplines: settledDisciplines,
    reports: reports
      .map((report) => ({
        discipline: report.discipline,
        report_sha256: report.report_sha256,
        auditor_session_id: report.auditor_session_id,
        worker_session_id: report.worker_session_id,
      }))
      .sort((left, right) => compareUtf8(left.discipline, right.discipline)),
    findings,
    immediate_first_pass_repairs: immediate,
    finalization_queue: finalization,
    owner_only_findings: ownerOnly,
    reconciliation_sha256: "",
  };
  const body = structuredClone(reconciliation);
  delete body.reconciliation_sha256;
  reconciliation.reconciliation_sha256 = cascadeDigest(body);
  validateAuditReconciliation(reconciliation, plan);
  return reconciliation;
}

export function validateAuditReconciliation(reconciliation, plan) {
  exactKeys(reconciliation, RECONCILIATION_KEYS, "cascade audit reconciliation");
  assert(reconciliation.schema === "governance.cascade_audit_reconciliation.v1", "cascade reconciliation schema mismatch");
  assert(reconciliation.candidate_id === plan.candidate_id && reconciliation.candidate_commit === plan.candidate_commit && reconciliation.candidate_tree === plan.candidate_tree, "cascade reconciliation candidate mismatch");
  assert(typeof reconciliation.terminal === "boolean", "cascade reconciliation terminal flag invalid");
  assert(reconciliation.terminal === plan.terminal, "cascade reconciliation terminal flag contradicts its plan");
  sortedUniqueStrings(reconciliation.settled_disciplines, "settled audit disciplines");
  assert(reconciliation.settled_disciplines.every((discipline) => DISCIPLINES.has(discipline)), "settled audit discipline invalid");
  assert(Array.isArray(reconciliation.reports), "audit report bindings are required");
  for (const binding of reconciliation.reports) assert(binding.auditor_session_id === plan.auditor_session_id, "audit report binding is bound to a different campaign Auditor");
  const reportDisciplines = [];
  const reportDigests = [];
  for (const binding of reconciliation.reports) {
    exactKeys(binding, REPORT_BINDING_KEYS, "audit report binding");
    assert(DISCIPLINES.has(binding.discipline), "audit report binding discipline is invalid");
    requireSha(binding.report_sha256, "audit report digest");
    requireString(binding.auditor_session_id, "audit report Auditor session");
    const planItem = plan.disciplines.find((item) => item.discipline === binding.discipline);
    if (plan.terminal && planItem?.disposition === "REQUIRED") {
      assert(binding.worker_session_id === null || typeof binding.worker_session_id === "string", "terminal audit worker session is invalid");
    }
    if (planItem?.disposition === "DETERMINISTIC_ONLY") assert(binding.worker_session_id === null, "deterministic audit binding must not claim a worker");
    else assert(binding.worker_session_id === null || typeof binding.worker_session_id === "string", "audit worker session is invalid");
    reportDisciplines.push(binding.discipline);
    reportDigests.push(binding.report_sha256);
  }
  sortedUniqueStrings(reportDisciplines, "audit report binding disciplines", {allowEmpty: true});
  sortedUniqueStrings([...reportDigests].sort(compareUtf8), "audit report digests", {allowEmpty: true});
  if (plan.terminal) {
    const workerSessions = reconciliation.reports.map((binding) => binding.worker_session_id).filter((session) => session !== null);
    assert(new Set(workerSessions).size === workerSessions.length, "terminal audit disciplines must use distinct worker sessions");
  }
  const expectedSettled = plan.disciplines
    .filter((item) => item.disposition !== "DEFERRED_UNTIL_TERMINAL")
    .map((item) => item.discipline)
    .sort(compareUtf8);
  const expectedReports = plan.disciplines
    .filter((item) => ["REQUIRED", "DETERMINISTIC_ONLY"].includes(item.disposition))
    .map((item) => item.discipline)
    .sort(compareUtf8);
  assert(canonicalJson(reconciliation.settled_disciplines) === canonicalJson(expectedSettled), "reconciliation does not settle the plan's exact discipline set");
  assert(canonicalJson(reportDisciplines) === canonicalJson(expectedReports), "reconciliation does not bind one report for every required discipline");
  assert(Array.isArray(reconciliation.findings), "reconciled findings are required");
  const findingIds = new Set();
  for (const finding of reconciliation.findings) {
    exactKeys(finding, [...FINDING_KEYS, "source_report_sha256"], "reconciled finding");
    requireSha(finding.source_report_sha256, "reconciled finding report");
    assert(reportDigests.includes(finding.source_report_sha256), "reconciled finding is not bound to a listed audit report");
    assert(!findingIds.has(finding.finding_id), "reconciled finding IDs duplicate");
    findingIds.add(finding.finding_id);
    const sourceFinding = structuredClone(finding);
    delete sourceFinding.source_report_sha256;
    validateFinding(sourceFinding, finding.discipline, reconciliation.candidate_commit, reconciliation.candidate_tree);
  }
  const routeInventories = {
    immediate_first_pass_repairs: "IMMEDIATE_FIRST_PASS_REPAIR",
    finalization_queue: "FINALIZATION_QUEUE",
    owner_only_findings: "OWNER_ONLY",
  };
  for (const [field, route] of Object.entries(routeInventories)) {
    sortedUniqueStrings(reconciliation[field], field, {allowEmpty: true});
    const expected = reconciliation.findings
      .filter((finding) => finding.route === route)
      .map((finding) => finding.finding_id)
      .sort(compareUtf8);
    assert(canonicalJson(reconciliation[field]) === canonicalJson(expected), `${field} inventory is not derived`);
  }
  assert(reconciliation.immediate_first_pass_repairs.every((id) => reconciliation.findings.some((finding) => finding.finding_id === id && finding.route === "IMMEDIATE_FIRST_PASS_REPAIR")), "immediate repair inventory is not derived");
  assert(reconciliation.finalization_queue.every((id) => reconciliation.findings.some((finding) => finding.finding_id === id && finding.route === "FINALIZATION_QUEUE")), "finalization queue is not derived");
  assert(reconciliation.owner_only_findings.every((id) => reconciliation.findings.some((finding) => finding.finding_id === id && finding.route === "OWNER_ONLY")), "owner-only inventory is not derived");
  const body = structuredClone(reconciliation);
  delete body.reconciliation_sha256;
  assert(reconciliation.reconciliation_sha256 === cascadeDigest(body), "cascade reconciliation digest is not content-addressed");
  return reconciliation;
}

const FINALIZER_KEYS = [
  "schema", "role", "session_id", "campaign_id", "campaign_version", "logical_lineage_id",
  "source_candidate_id", "source_commit", "source_tree", "source_worktree_id", "source_branch",
  "worktree_id", "branch", "base_commit", "base_tree", "fresh_worktree", "exclusive_writer",
  "scope_finding_ids", "correction_batch_sha256", "model_policy_digest_sha256",
  "intent_authority", "acceptance_authority", "deployment_authority", "self_acceptance",
  "status", "final_commit", "final_tree", "final_clean", "final_pushed", "changed_paths",
  "reframe_count", "repair_pass_count", "rewrite_assessment", "finalizer_sha256",
];

export function validateFinalizer(finalizer, candidate, {allowActive = true} = {}) {
  exactKeys(finalizer, FINALIZER_KEYS, "Campaign Finalizer");
  assert(finalizer.schema === "governance.campaign_finalizer.v1" && finalizer.role === "CAMPAIGN_FINALIZER", "Campaign Finalizer identity is invalid");
  for (const field of ["session_id", "campaign_id", "campaign_version", "logical_lineage_id", "source_candidate_id", "source_commit", "source_tree", "source_worktree_id", "source_branch", "worktree_id", "branch", "base_commit", "base_tree", "correction_batch_sha256", "model_policy_digest_sha256"]) requireString(finalizer[field], `Campaign Finalizer ${field}`);
  assert(finalizer.campaign_id === candidate.campaign_id && finalizer.campaign_version === candidate.campaign_version && finalizer.logical_lineage_id === candidate.logical_lineage_id, "Campaign Finalizer campaign binding mismatch");
  assert(finalizer.source_candidate_id === candidate.candidate_id && finalizer.source_commit === candidate.commit && finalizer.source_tree === candidate.tree && finalizer.source_worktree_id === candidate.worktree_id && finalizer.source_branch === candidate.branch, "Campaign Finalizer source candidate mismatch");
  assert(finalizer.worktree_id !== candidate.worktree_id && finalizer.fresh_worktree === true && finalizer.exclusive_writer === true, "Campaign Finalizer must have a fresh exclusive worktree");
  for (const field of ["intent_authority", "acceptance_authority", "deployment_authority", "self_acceptance"]) assert(finalizer[field] === false, `Campaign Finalizer cannot own ${field}`);
  sortedUniqueStrings(finalizer.scope_finding_ids, "Campaign Finalizer finding scope", {allowEmpty: true});
  validatePathList(finalizer.changed_paths, "Campaign Finalizer changed paths", {allowEmpty: true});
  assert(Number.isSafeInteger(finalizer.reframe_count) && finalizer.reframe_count >= 0 && finalizer.reframe_count <= 1, "Campaign Finalizer reframe count exceeds one");
  assert(Number.isSafeInteger(finalizer.repair_pass_count) && finalizer.repair_pass_count >= 0 && finalizer.repair_pass_count <= 1, "Campaign Finalizer repair pass count exceeds one");
  assert(["ACTIVE", "COMPLETE"].includes(finalizer.status), "Campaign Finalizer status is invalid");
  if (finalizer.status === "ACTIVE" && allowActive) {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.final_clean === null && finalizer.final_pushed === null, "active Campaign Finalizer claims a completed candidate");
    assert(finalizer.rewrite_assessment === null, "active Campaign Finalizer carries a completion assessment");
  }
  if (finalizer.status === "COMPLETE") {
    requireString(finalizer.final_commit, "Campaign Finalizer final commit");
    requireString(finalizer.final_tree, "Campaign Finalizer final tree");
    assert(finalizer.final_clean === true && finalizer.final_pushed === true, "completed Campaign Finalizer must be clean and pushed");
    assert(finalizer.rewrite_assessment !== null, "completed Campaign Finalizer lacks a rewrite assessment");
    validateFinalizerRewriteAssessment(finalizer.rewrite_assessment);
    assert(finalizer.rewrite_assessment.classification === "TARGETED_REPAIR", "Campaign Finalizer cannot close a rebuild-required pass as a repair");
  } else {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.final_clean === null && finalizer.final_pushed === null, "incomplete Campaign Finalizer carries final candidate identity");
    assert(finalizer.rewrite_assessment === null, "incomplete Campaign Finalizer carries a rewrite assessment");
  }
  const body = structuredClone(finalizer);
  delete body.finalizer_sha256;
  assert(finalizer.finalizer_sha256 === cascadeDigest(body), "Campaign Finalizer digest is not content-addressed");
  return finalizer;
}

export function openCampaignFinalizer({candidate, auditPlan, reconciliation, modelPolicyDigestSha256, sessionId, worktreeId, branch, scopeFindingIds = [], correctionBatchSha256}) {
  validateFirstPassCandidate(candidate);
  assert(candidate.terminal === true, "Campaign Finalizer requires a terminal first-pass candidate");
  validateAuditPlan(auditPlan);
  assert(auditPlan.candidate_id === candidate.candidate_id && auditPlan.candidate_commit === candidate.commit && auditPlan.candidate_tree === candidate.tree, "Campaign Finalizer audit plan candidate mismatch");
  validateAuditReconciliation(reconciliation, auditPlan);
  assert(reconciliation.immediate_first_pass_repairs.length === 0, "critical first-pass repairs must return to the first-pass owner before finalization");
  requireSha(modelPolicyDigestSha256, "Campaign Finalizer model policy");
  requireSha(correctionBatchSha256, "Campaign Finalizer correction batch");
  const finalizer = {
    schema: "governance.campaign_finalizer.v1",
    role: "CAMPAIGN_FINALIZER",
    session_id: sessionId,
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    logical_lineage_id: candidate.logical_lineage_id,
    source_candidate_id: candidate.candidate_id,
    source_commit: candidate.commit,
    source_tree: candidate.tree,
    source_worktree_id: candidate.worktree_id,
    source_branch: candidate.branch,
    worktree_id: worktreeId,
    branch,
    base_commit: candidate.commit,
    base_tree: candidate.tree,
    fresh_worktree: true,
    exclusive_writer: true,
    scope_finding_ids: sortedUniqueStrings(scopeFindingIds, "Campaign Finalizer finding scope", {allowEmpty: true}),
    correction_batch_sha256: correctionBatchSha256,
    model_policy_digest_sha256: modelPolicyDigestSha256,
    intent_authority: false,
    acceptance_authority: false,
    deployment_authority: false,
    self_acceptance: false,
    status: "ACTIVE",
    final_commit: null,
    final_tree: null,
    final_clean: null,
    final_pushed: null,
    changed_paths: [],
    reframe_count: 0,
    repair_pass_count: 0,
    rewrite_assessment: null,
    finalizer_sha256: "",
  };
  const body = structuredClone(finalizer);
  delete body.finalizer_sha256;
  finalizer.finalizer_sha256 = cascadeDigest(body);
  validateFinalizer(finalizer, candidate);
  return finalizer;
}

export function completeCampaignFinalizer({finalizer, candidate, finalCommit, finalTree, changedPaths, repairPassCount = 0, reframeCount = 0, rewriteAssessment}) {
  validateFinalizer(finalizer, candidate);
  requireString(finalCommit, "finalizer final commit");
  requireString(finalTree, "finalizer final tree");
  validateFinalizerRewriteAssessment(rewriteAssessment);
  assert(rewriteAssessment.classification === "TARGETED_REPAIR", "Campaign Finalizer completion requires a targeted-repair assessment");
  const completed = {
    ...structuredClone(finalizer),
    status: "COMPLETE",
    final_commit: finalCommit,
    final_tree: finalTree,
    final_clean: true,
    final_pushed: true,
    changed_paths: validatePathList(changedPaths, "finalizer changed paths", {allowEmpty: true}),
    repair_pass_count: repairPassCount,
    reframe_count: reframeCount,
    rewrite_assessment: structuredClone(rewriteAssessment),
    finalizer_sha256: "",
  };
  const body = structuredClone(completed);
  delete body.finalizer_sha256;
  completed.finalizer_sha256 = cascadeDigest(body);
  validateFinalizer(completed, candidate);
  return completed;
}

const DELTA_KEYS = ["schema", "baseline_commit", "baseline_tree", "candidate_commit", "candidate_tree", "invalidated_question_ids", "directly_touched_question_ids", "dependent_question_ids", "smoke_question_ids", "rerun_question_ids", "reused_question_ids", "all_question_ids", "causal_root_ids", "audit_pass_number", "status", "evidence_reuse_sha256", "delta_sha256"];

export function validateDeltaAudit(delta) {
  exactKeys(delta, DELTA_KEYS, "delta audit");
  assert(delta.schema === "governance.delta_audit.v1", "delta audit schema mismatch");
  for (const field of ["baseline_commit", "baseline_tree", "candidate_commit", "candidate_tree"]) requireString(delta[field], `delta audit ${field}`);
  for (const field of ["invalidated_question_ids", "directly_touched_question_ids", "dependent_question_ids", "smoke_question_ids", "rerun_question_ids", "reused_question_ids", "all_question_ids"]) validateQuestionIds(delta[field], `delta audit ${field}`, {allowEmpty: ["directly_touched_question_ids", "dependent_question_ids", "reused_question_ids"].includes(field)});
  sortedUniqueStrings(delta.causal_root_ids, "delta causal roots", {allowEmpty: true});
  assert(Number.isSafeInteger(delta.audit_pass_number) && delta.audit_pass_number >= 1 && delta.audit_pass_number <= 2, "delta audit pass number is invalid");
  assert(["PENDING", "SETTLED"].includes(delta.status), "delta audit status is invalid");
  requireSha(delta.evidence_reuse_sha256, "delta evidence reuse");
  const eligible = new Set([...delta.invalidated_question_ids, ...delta.directly_touched_question_ids, ...delta.dependent_question_ids, ...delta.smoke_question_ids]);
  assert(delta.rerun_question_ids.every((id) => eligible.has(id)), "delta audit reruns a question outside its invalidation graph");
  const unaffected = delta.all_question_ids.filter((id) => !eligible.has(id));
  assert(delta.reused_question_ids.every((id) => unaffected.includes(id)), "delta audit reuses affected evidence");
  if (unaffected.length > 0) assert(delta.rerun_question_ids.length < delta.all_question_ids.length, "delta audit restarted the complete question corpus");
  if (delta.status === "SETTLED") assert(delta.rerun_question_ids.length > 0, "settled delta audit has no targeted proof");
  const body = structuredClone(delta);
  delete body.delta_sha256;
  assert(delta.delta_sha256 === cascadeDigest(body), "delta audit digest is not content-addressed");
  return delta;
}

export function compileDeltaAudit({baselineCommit, baselineTree, candidateCommit, candidateTree, allQuestionIds, previouslyFailedQuestionIds = [], directlyTouchedQuestionIds = [], dependentQuestionIds = [], smokeQuestionIds, causalRootIds = [], auditPassNumber = 1, status = "SETTLED", evidenceReuseSha256}) {
  requireString(baselineCommit, "delta baseline commit");
  requireString(baselineTree, "delta baseline tree");
  requireString(candidateCommit, "delta candidate commit");
  requireString(candidateTree, "delta candidate tree");
  assert(baselineCommit !== candidateCommit || baselineTree !== candidateTree, "delta audit candidate did not change");
  const all = validateQuestionIds([...allQuestionIds].sort(compareUtf8), "delta all question IDs");
  const invalidated = validateQuestionIds([...previouslyFailedQuestionIds].sort(compareUtf8), "previously failed question IDs", {allowEmpty: true});
  const touched = validateQuestionIds([...directlyTouchedQuestionIds].sort(compareUtf8), "directly touched question IDs", {allowEmpty: true});
  const dependent = validateQuestionIds([...dependentQuestionIds].sort(compareUtf8), "dependent question IDs", {allowEmpty: true});
  const smoke = validateQuestionIds([...smokeQuestionIds].sort(compareUtf8), "smoke question IDs");
  const rerun = [...new Set([...invalidated, ...touched, ...dependent, ...smoke])].sort(compareUtf8);
  const affected = new Set(rerun);
  const reused = all.filter((id) => !affected.has(id));
  const delta = {
    schema: "governance.delta_audit.v1",
    baseline_commit: baselineCommit,
    baseline_tree: baselineTree,
    candidate_commit: candidateCommit,
    candidate_tree: candidateTree,
    invalidated_question_ids: invalidated,
    directly_touched_question_ids: touched,
    dependent_question_ids: dependent,
    smoke_question_ids: smoke,
    rerun_question_ids: rerun,
    reused_question_ids: reused,
    all_question_ids: all,
    causal_root_ids: sortedUniqueStrings(causalRootIds, "delta causal roots", {allowEmpty: true}),
    audit_pass_number: auditPassNumber,
    status,
    evidence_reuse_sha256: evidenceReuseSha256,
    delta_sha256: "",
  };
  const body = structuredClone(delta);
  delete body.delta_sha256;
  delta.delta_sha256 = cascadeDigest(body);
  validateDeltaAudit(delta);
  return delta;
}

const MODEL_POLICY_KEYS = ["schema", "profile", "completion_floor", "market_snapshot_sha256", "role_policies", "no_eligible_action", "calibration", "policy_sha256"];
const ROLE_POLICY_KEYS = ["role", "selection_mode", "minimum_capability_floor", "budget_behavior", "fallback_behavior"];
const ECONOMICS_POLICY_KEYS = ["minimum_savings_target_ratio", "minimum_observations_before_default", "comparison_basis", "unproven_action", "default_rule", "required_metrics"];
const DEFAULT_ECONOMICS_POLICY = Object.freeze({
  minimum_savings_target_ratio: 0.75,
  minimum_observations_before_default: 3,
  comparison_basis: "EQUIVALENT_ACCEPTED_RESULT_COST",
  unproven_action: "DO_NOT_CLAIM_SAVINGS",
  default_rule: "KEEP_CASCADE_DEFAULT_ONLY_AFTER_THREE_ACCEPTED_OBSERVATIONS_AT_OR_BELOW_TARGET_WITHOUT_REBUILD_REQUIRED_FINALIZATION",
  required_metrics: ["accepted_result_cost", "audit_cost", "escaped_findings", "finalizer_rewrite_rate", "first_pass_survival", "repair_rounds"],
});

export function validateModelPolicy(policy) {
  exactKeys(policy, [...MODEL_POLICY_KEYS, "economics_policy"], "cascade model policy");
  assert(policy.schema === "governance.cascade_model_policy.v1", "cascade model policy schema mismatch");
  requireString(policy.profile, "model policy profile");
  assert(typeof policy.completion_floor === "number" && policy.completion_floor > 0 && policy.completion_floor <= 1, "model policy completion floor is invalid");
  if (policy.market_snapshot_sha256 !== null) requireSha(policy.market_snapshot_sha256, "model market snapshot");
  assert(Array.isArray(policy.role_policies) && policy.role_policies.length === MODEL_POLICY_ROLES.length, "model policy must cover every role");
  const roles = new Set();
  for (const rolePolicy of policy.role_policies) {
    exactKeys(rolePolicy, ROLE_POLICY_KEYS, "role model policy");
    assert(MODEL_ROLES.has(rolePolicy.role) && !roles.has(rolePolicy.role), "role model policy is duplicate or unknown");
    roles.add(rolePolicy.role);
    for (const field of ["selection_mode", "minimum_capability_floor", "budget_behavior", "fallback_behavior"]) requireString(rolePolicy[field], `role model policy ${field}`);
  }
  assert([...roles].sort(compareUtf8).join("\0") === [...MODEL_POLICY_ROLES].sort(compareUtf8).join("\0"), "model policy role inventory is incomplete");
  assert(policy.no_eligible_action === "FAIL_CLOSED_NO_FEASIBLE_MODEL", "model policy does not fail closed");
  requireRecord(policy.calibration, "model policy calibration");
  assert(Number.isSafeInteger(policy.calibration.minimum_campaigns_before_recalibration) && policy.calibration.minimum_campaigns_before_recalibration >= 3, "model calibration floor is invalid");
  assert(Array.isArray(policy.calibration.observations), "model calibration observations are required");
  exactKeys(policy.economics_policy, ECONOMICS_POLICY_KEYS, "cascade economics policy");
  assert(policy.economics_policy.minimum_savings_target_ratio === 0.75, "cascade economics savings target was weakened");
  assert(Number.isSafeInteger(policy.economics_policy.minimum_observations_before_default) && policy.economics_policy.minimum_observations_before_default >= 3, "cascade economics observation floor is invalid");
  assert(policy.economics_policy.comparison_basis === "EQUIVALENT_ACCEPTED_RESULT_COST", "cascade economics comparison basis is invalid");
  assert(policy.economics_policy.unproven_action === "DO_NOT_CLAIM_SAVINGS", "cascade economics unproven action is invalid");
  requireString(policy.economics_policy.default_rule, "cascade economics default rule");
  assert(canonicalJson(policy.economics_policy.required_metrics) === canonicalJson(DEFAULT_ECONOMICS_POLICY.required_metrics), "cascade economics metric inventory is incomplete or reordered");
  const body = structuredClone(policy);
  delete body.policy_sha256;
  assert(policy.policy_sha256 === cascadeDigest(body), "model policy digest is not content-addressed");
  return policy;
}

export function compileModelPolicy({profile, completionFloor, marketSnapshotSha256 = null, rolePolicies, observations = [], economicsPolicy = DEFAULT_ECONOMICS_POLICY}) {
  const policy = {
    schema: "governance.cascade_model_policy.v1",
    profile,
    completion_floor: completionFloor,
    market_snapshot_sha256: marketSnapshotSha256,
    role_policies: structuredClone(rolePolicies),
    no_eligible_action: "FAIL_CLOSED_NO_FEASIBLE_MODEL",
    calibration: {
      minimum_campaigns_before_recalibration: 3,
      observations: structuredClone(observations),
    },
    economics_policy: structuredClone(economicsPolicy),
    policy_sha256: "",
  };
  const body = structuredClone(policy);
  delete body.policy_sha256;
  policy.policy_sha256 = cascadeDigest(body);
  validateModelPolicy(policy);
  return policy;
}

const CHECKPOINT_LEDGER_ENTRY_KEYS = [
  "candidate_id", "candidate_commit", "candidate_tree", "terminal", "audit_plan_sha256",
  "audit_reconciliation_sha256", "finding_status", "status",
];

export function validateCheckpointAuditLedger(ledger, activeCandidate = null) {
  exactKeys(ledger, ["schema", "entries", "active_candidate_id", "ledger_sha256"], "first-pass checkpoint ledger");
  assert(ledger.schema === "governance.first_pass_checkpoint_ledger.v1", "checkpoint ledger schema mismatch");
  assert(Array.isArray(ledger.entries) && ledger.entries.length > 0, "checkpoint ledger entries are required");
  requireString(ledger.active_candidate_id, "active checkpoint candidate");
  const ids = new Set();
  for (const entry of ledger.entries) {
    exactKeys(entry, CHECKPOINT_LEDGER_ENTRY_KEYS, "checkpoint ledger entry");
    for (const field of ["candidate_id", "candidate_commit", "candidate_tree", "finding_status", "status"]) requireString(entry[field], `checkpoint ledger ${field}`);
    assert(typeof entry.terminal === "boolean", "checkpoint ledger terminal flag is invalid");
    assert(!ids.has(entry.candidate_id), "checkpoint ledger candidate IDs duplicate");
    ids.add(entry.candidate_id);
    for (const field of ["audit_plan_sha256", "audit_reconciliation_sha256"]) {
      if (entry[field] !== null) requireSha(entry[field], `checkpoint ledger ${field}`);
    }
    assert(["BUILDING", "AUDITING", "TERMINAL_PROPOSED", "REPAIR_REQUIRED", "SETTLED", "SUPERSEDED"].includes(entry.status), "checkpoint ledger status is invalid");
    if (entry.status === "SETTLED") assert(entry.audit_reconciliation_sha256 !== null, "settled checkpoint lacks reconciliation");
  }
  assert(ids.has(ledger.active_candidate_id), "checkpoint ledger active candidate is missing");
  if (activeCandidate !== null) {
    validateFirstPassCandidate(activeCandidate);
    const current = ledger.entries.find((entry) => entry.candidate_id === ledger.active_candidate_id);
    assert(current.candidate_commit === activeCandidate.commit && current.candidate_tree === activeCandidate.tree, "checkpoint ledger active identity does not match first-pass state");
  }
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  assert(ledger.ledger_sha256 === cascadeDigest(body), "checkpoint ledger digest is not content-addressed");
  return ledger;
}

export function compileCheckpointAuditLedger({entries, activeCandidateId}) {
  assert(Array.isArray(entries) && entries.length > 0, "checkpoint ledger entries are required");
  const ledger = {
    schema: "governance.first_pass_checkpoint_ledger.v1",
    entries: structuredClone(entries),
    active_candidate_id: activeCandidateId,
    ledger_sha256: "",
  };
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  ledger.ledger_sha256 = cascadeDigest(body);
  validateCheckpointAuditLedger(ledger);
  return ledger;
}

const ROLLING_AUDIT_KEYS = ["candidate_id", "candidate_commit", "candidate_tree", "audit_plan", "audit_reconciliation", "rolling_audit_sha256"];

export function compileRollingAudit({candidate, auditPlan, auditReconciliation = null}) {
  validateFirstPassCandidate(candidate);
  assert(candidate.terminal === false, "rolling audit must target a nonterminal checkpoint");
  validateAuditPlan(auditPlan);
  assert(auditPlan.terminal === false && auditPlan.candidate_id === candidate.candidate_id
    && auditPlan.candidate_commit === candidate.commit && auditPlan.candidate_tree === candidate.tree,
  "rolling audit plan is not bound to its checkpoint");
  assert(auditPlan.auditor_session_id === candidate.auditor_session_id, "rolling audit plan Auditor differs from its checkpoint Auditor");
  if (auditReconciliation !== null) {
    validateAuditReconciliation(auditReconciliation, auditPlan);
    assert(auditReconciliation.terminal === false, "rolling audit reconciliation cannot be terminal");
  }
  const entry = {
    candidate_id: candidate.candidate_id,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    audit_plan: structuredClone(auditPlan),
    audit_reconciliation: structuredClone(auditReconciliation),
    rolling_audit_sha256: "",
  };
  const body = structuredClone(entry);
  delete body.rolling_audit_sha256;
  entry.rolling_audit_sha256 = cascadeDigest(body);
  validateRollingAudit(entry);
  return entry;
}

export function validateRollingAudit(entry) {
  exactKeys(entry, ROLLING_AUDIT_KEYS, "rolling audit entry");
  requireString(entry.candidate_id, "rolling audit candidate");
  requireString(entry.candidate_commit, "rolling audit commit");
  requireString(entry.candidate_tree, "rolling audit tree");
  validateAuditPlan(entry.audit_plan);
  assert(entry.audit_plan.terminal === false && entry.audit_plan.candidate_id === entry.candidate_id
    && entry.audit_plan.candidate_commit === entry.candidate_commit && entry.audit_plan.candidate_tree === entry.candidate_tree,
  "rolling audit plan identity mismatch");
  if (entry.audit_reconciliation !== null) {
    validateAuditReconciliation(entry.audit_reconciliation, entry.audit_plan);
    assert(entry.audit_reconciliation.terminal === false, "rolling audit reconciliation is terminal");
  }
  requireSha(entry.rolling_audit_sha256, "rolling audit digest");
  const body = structuredClone(entry);
  delete body.rolling_audit_sha256;
  assert(entry.rolling_audit_sha256 === cascadeDigest(body), "rolling audit is not content-addressed");
  return entry;
}

export function attachRollingAudit(state, entry) {
  validateCascadeState(state);
  validateRollingAudit(entry);
  assert(state.checkpoint_ledger.entries.some((candidate) => candidate.candidate_id === entry.candidate_id
    && candidate.candidate_commit === entry.candidate_commit && candidate.candidate_tree === entry.candidate_tree),
  "rolling audit checkpoint is not in the campaign ledger");
  assert(entry.candidate_id !== state.first_pass.candidate_id, "rolling audit must target an earlier checkpoint while the builder advances");
  assert(!state.rolling_audits.some((item) => item.candidate_id === entry.candidate_id), "rolling audit already exists for this checkpoint");
  const next = structuredClone(state);
  next.rolling_audits.push(structuredClone(entry));
  next.rolling_audits.sort((left, right) => compareUtf8(left.candidate_id, right.candidate_id));
  const body = structuredClone(next);
  delete body.cascade_sha256;
  next.cascade_sha256 = cascadeDigest(body);
  validateCascadeState(next);
  return next;
}

const ACCEPTANCE_KEYS = ["product_acceptance_sha256", "question_tree_sha256", "final_candidate_commit", "final_candidate_tree", "roots", "rc_ready", "auditor_session_id"];
const ROOTS = ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"];

function validateCascadeAcceptance(acceptance) {
  exactKeys(acceptance, ACCEPTANCE_KEYS, "cascade acceptance binding");
  for (const field of ["product_acceptance_sha256", "question_tree_sha256"]) requireSha(acceptance[field], `cascade acceptance ${field}`);
  requireString(acceptance.final_candidate_commit, "cascade acceptance final commit");
  requireString(acceptance.final_candidate_tree, "cascade acceptance final tree");
  requireString(acceptance.auditor_session_id, "cascade acceptance Auditor");
  exactKeys(acceptance.roots, ROOTS, "cascade acceptance roots");
  for (const root of ROOTS) assert(["PASS", "OPEN_REPAIR", "UNKNOWN", "NOT_APPLICABLE"].includes(acceptance.roots[root]), `cascade acceptance root ${root} is invalid`);
  assert(typeof acceptance.rc_ready === "boolean" && acceptance.rc_ready === ROOTS.every((root) => acceptance.roots[root] === "PASS"), "cascade acceptance RC_READY is not the exact three-root conjunction");
  if (acceptance.rc_ready) assert(acceptance.product_acceptance_sha256 !== "0".repeat(64), "cascade acceptance cannot use an empty Product proof digest");
}

const CASCADE_STATE_KEYS = ["schema", "governance_version", "campaign_id", "campaign_version", "mode", "stage", "logical_lineage_id", "first_pass", "checkpoint_ledger", "rolling_audits", "holds", "audit_plan", "audit_reconciliation", "finalizer", "delta_audit", "acceptance", "model_policy", "telemetry", "loop_control", "cascade_sha256"];
const LOOP_KEYS = ["max_finalization_passes", "max_delta_repair_passes", "max_supervisor_reframes", "equivalent_retry_policy"];
const TELEMETRY_KEYS = ["records", "evidence_reuse_count", "escaped_finding_count", "owner_interruptions"];

function validateTelemetry(telemetry) {
  exactKeys(telemetry, TELEMETRY_KEYS, "cascade telemetry");
  assert(Array.isArray(telemetry.records), "cascade telemetry records are required");
  for (const field of ["evidence_reuse_count", "escaped_finding_count", "owner_interruptions"]) assert(Number.isSafeInteger(telemetry[field]) && telemetry[field] >= 0, `cascade telemetry ${field} is invalid`);
  for (const record of telemetry.records) {
    requireRecord(record, "cascade telemetry record");
    requireSha(record.record_sha256, "cascade telemetry record digest");
  }
}

function validateLoopControl(control) {
  exactKeys(control, LOOP_KEYS, "cascade loop control");
  assert(control.max_finalization_passes === 1 && control.max_delta_repair_passes === 1 && control.max_supervisor_reframes === 1, "cascade loop limits were weakened");
  assert(control.equivalent_retry_policy === "STOP_AND_CLASSIFY_AFTER_ONE_REFRAME", "cascade equivalent retry policy is invalid");
}

export function validateCascadeState(state, options = {}) {
  exactKeys(state, CASCADE_STATE_KEYS, "campaign cascade state");
  assert(state.schema === "governance.campaign_cascade_state.v1" && state.governance_version === "2.1rc", "campaign cascade identity is invalid");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) requireString(state[field], `cascade ${field}`);
  assert(MODES.has(state.mode) && STAGES.has(state.stage), "campaign cascade mode or stage is invalid");
  validateFirstPassCandidate(state.first_pass);
  assert(state.first_pass.campaign_id === state.campaign_id && state.first_pass.campaign_version === state.campaign_version && state.first_pass.logical_lineage_id === state.logical_lineage_id, "cascade first-pass lineage mismatch");
  validateCheckpointAuditLedger(state.checkpoint_ledger, state.first_pass);
  assert(Array.isArray(state.rolling_audits), "rolling audits are required");
  let previousRollingCandidate = null;
  for (const entry of state.rolling_audits) {
    validateRollingAudit(entry);
    assert(previousRollingCandidate === null || compareUtf8(previousRollingCandidate, entry.candidate_id) < 0, "rolling audits must be UTF-8 sorted");
    previousRollingCandidate = entry.candidate_id;
    assert(entry.candidate_id !== state.first_pass.candidate_id, "rolling audit cannot target the active builder checkpoint");
  }
  assert(Array.isArray(state.holds), "cascade holds are required");
  const holdIds = new Set();
  for (const hold of state.holds) {
    exactKeys(hold, ["hold_id", "kind", "scope", "authority_boundary", "resume_condition", "owner_role_id", "created_at_utc"], "cascade hold");
    requireString(hold.hold_id, "cascade hold ID");
    assert(HOLD_KINDS.has(hold.kind), "cascade hold kind is invalid");
    for (const field of ["scope", "authority_boundary", "resume_condition", "owner_role_id", "created_at_utc"]) requireString(hold[field], `cascade hold ${field}`);
    assert(!holdIds.has(hold.hold_id), "cascade hold IDs duplicate");
    holdIds.add(hold.hold_id);
  }
  if (state.audit_plan !== null) validateAuditPlan(state.audit_plan);
  if (state.audit_plan !== null) assert(state.audit_plan.auditor_session_id === state.first_pass.auditor_session_id, "cascade audit plan Auditor differs from the active checkpoint Auditor");
  if (state.audit_reconciliation !== null) {
    assert(state.audit_plan !== null, "cascade reconciliation lacks an audit plan");
    validateAuditReconciliation(state.audit_reconciliation, state.audit_plan);
  }
  if (state.finalizer !== null) validateFinalizer(state.finalizer, state.first_pass);
  if (state.delta_audit !== null) validateDeltaAudit(state.delta_audit);
  validateCascadeAcceptance(state.acceptance);
  validateModelPolicy(state.model_policy);
  validateTelemetry(state.telemetry);
  validateLoopControl(state.loop_control);
  if (state.stage === "FIRST_PASS_BUILDING") {
    assert(state.first_pass.terminal === false && state.audit_plan === null && state.audit_reconciliation === null && state.finalizer === null && state.delta_audit === null && state.acceptance.rc_ready === false, "building cascade carries later-stage authority");
  }
  if (state.stage === "TERMINAL_PROPOSED") {
    assert(state.first_pass.terminal === true, "terminal proposal lacks a terminal checkpoint");
    if (state.audit_plan !== null) assert(state.audit_plan.candidate_id === state.first_pass.candidate_id, "rolling audit plan is bound to the wrong checkpoint");
  }
  if (["FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED", "FINALIZER_PENDING", "FINALIZING", "DELTA_REPAIR", "READY_FOR_ACCEPTANCE"].includes(state.stage)) {
    assert(state.first_pass.terminal === true && state.audit_plan !== null && state.audit_reconciliation !== null, "terminal cascade is missing settled audit state");
    assert(state.audit_plan.terminal === true, "terminal cascade uses a nonterminal audit plan");
    assert(state.audit_reconciliation.terminal === true, "terminal cascade uses a nonterminal reconciliation");
    assert(state.audit_reconciliation.settled_disciplines.length === AUDIT_DISCIPLINES.length, "terminal cascade does not settle all four audit disciplines");
  }
  if (["FINALIZER_PENDING", "FINALIZING", "DELTA_REPAIR", "READY_FOR_ACCEPTANCE"].includes(state.stage)) {
    if (state.mode !== "SMALL_DETERMINISTIC" || state.audit_reconciliation.finalization_queue.length > 0) assert(state.finalizer !== null, "cascade finalizer is required");
  }
  if (state.stage === "FINALIZING") assert(state.finalizer?.status === "ACTIVE", "finalizing cascade does not have active finalizer custody");
  if (state.stage === "DELTA_REPAIR") assert(state.finalizer?.status === "COMPLETE" && state.delta_audit !== null, "delta repair lacks finalizer completion or delta proof");
  if (state.stage === "READY_FOR_ACCEPTANCE") {
    assert(state.finalizer === null || state.finalizer.status === "COMPLETE", "ready cascade has incomplete finalizer");
    assert(state.delta_audit?.status === "SETTLED", "ready cascade lacks settled delta audit");
    assert(state.acceptance.rc_ready === true, "ready cascade lacks exact three-root acceptance");
    const finalCommit = state.finalizer?.final_commit ?? state.first_pass.commit;
    const finalTree = state.finalizer?.final_tree ?? state.first_pass.tree;
    assert(state.acceptance.final_candidate_commit === finalCommit && state.acceptance.final_candidate_tree === finalTree, "cascade acceptance does not bind final candidate");
  }
  if (options.productAcceptance) {
    const product = options.productAcceptance;
    requireSha(product.acceptance_receipt_sha256, "product acceptance receipt");
    assert(state.acceptance.product_acceptance_sha256 === cascadeDigest(product), "cascade acceptance does not bind exact Product acceptance");
    assert(state.acceptance.question_tree_sha256 === product.question_tree_sha256, "cascade acceptance question tree mismatch");
    assert(state.acceptance.rc_ready === product.rc_ready, "cascade acceptance RC_READY mismatch");
    for (const root of ROOTS) assert(state.acceptance.roots[root] === product.roots[root], `cascade acceptance ${root} mismatch`);
  }
  const body = structuredClone(state);
  delete body.cascade_sha256;
  assert(state.cascade_sha256 === cascadeDigest(body), "campaign cascade digest is not content-addressed");
  return state;
}

export function validateAcceptedLiveCascadeBinding({cascade, acceptedLive, productAcceptance}) {
  validateCascadeState(cascade, {productAcceptance});
  exactKeys(acceptedLive, ["status", "deployed_identity", "rollback_identity", "independent_audit_identity", "closure_receipt_sha256", "cascade_state_sha256"], "accepted-live cascade binding");
  assert(acceptedLive.status === "VERIFIED", "accepted-live cascade binding requires VERIFIED status");
  for (const field of ["deployed_identity", "rollback_identity", "independent_audit_identity"]) requireString(acceptedLive[field], `accepted-live ${field}`);
  for (const field of ["closure_receipt_sha256", "cascade_state_sha256"]) requireSha(acceptedLive[field], `accepted-live ${field}`);
  assert(acceptedLive.cascade_state_sha256 === cascade.cascade_sha256, "accepted-live closure does not bind exact cascade state");
  assert(cascade.stage === "READY_FOR_ACCEPTANCE", "accepted-live closure consumes a cascade that is not ready");
  assert(cascade.acceptance.product_acceptance_sha256 === cascadeDigest(productAcceptance), "accepted-live cascade/Product proof mismatch");
  assert(cascade.acceptance.rc_ready === true && productAcceptance.rc_ready === true, "accepted-live closure lacks exact three-root acceptance");
  return true;
}

export function applyCascadeTransition(previous, next) {
  validateCascadeState(previous);
  validateCascadeState(next);
  assert(previous.campaign_id === next.campaign_id && previous.campaign_version === next.campaign_version && previous.logical_lineage_id === next.logical_lineage_id, "cascade transition changed campaign lineage");
  assert(next.cascade_sha256 !== previous.cascade_sha256, "cascade transition did not change state");
  const allowed = new Map([
    ["FIRST_PASS_BUILDING", new Set(["FIRST_PASS_BUILDING", "TERMINAL_PROPOSED"])],
    ["TERMINAL_PROPOSED", new Set(["TERMINAL_PROPOSED", "FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED"])],
    ["FIRST_PASS_REPAIR_REQUIRED", new Set(["FIRST_PASS_REPAIR_REQUIRED", "FIRST_PASS_BUILDING"])],
    ["TERMINAL_SETTLED", new Set(["TERMINAL_SETTLED", "FINALIZER_PENDING", "READY_FOR_ACCEPTANCE"])],
    ["FINALIZER_PENDING", new Set(["FINALIZER_PENDING", "FINALIZING"])],
    ["FINALIZING", new Set(["FINALIZING", "DELTA_REPAIR"])],
    ["DELTA_REPAIR", new Set(["DELTA_REPAIR", "FINALIZING", "READY_FOR_ACCEPTANCE"])],
    ["READY_FOR_ACCEPTANCE", new Set(["READY_FOR_ACCEPTANCE"])]
  ]);
  assert(allowed.get(previous.stage)?.has(next.stage), `cascade transition ${previous.stage} -> ${next.stage} is not allowed`);
  if (previous.stage === "FIRST_PASS_REPAIR_REQUIRED" && next.stage === "FIRST_PASS_BUILDING") {
    assert(next.first_pass.candidate_id !== previous.first_pass.candidate_id, "first-pass repair rewrote the same candidate identity");
  } else if (previous.first_pass.terminal) {
    assert(next.first_pass.commit === previous.first_pass.commit && next.first_pass.tree === previous.first_pass.tree, "cascade transition rewrote terminal first-pass candidate");
  }
  if (next.finalizer !== null && next.first_pass.terminal) assert(next.finalizer.source_commit === next.first_pass.commit && next.finalizer.source_tree === next.first_pass.tree, "cascade finalizer detached from first-pass candidate");
  return next;
}

export function recordCascadeTelemetry(telemetry, record) {
  validateTelemetry(telemetry);
  requireRecord(record, "cascade telemetry input");
  requireString(record.metric, "cascade telemetry metric");
  requireString(record.value, "cascade telemetry value");
  const body = structuredClone(record);
  body.record_sha256 = "";
  body.record_sha256 = cascadeDigest(body);
  const next = structuredClone(telemetry);
  next.records.push(body);
  next.records.sort((left, right) => compareUtf8(left.record_sha256, right.record_sha256));
  validateTelemetry(next);
  return next;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write("campaign-cascade controller loaded\n");
}
