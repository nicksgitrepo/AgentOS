#!/usr/bin/env node

/* Typed compatibility and migration evidence for a release candidate. */

import {
  assert,
  assertPortableRecord,
  canonicalDigest,
  compareUtf8,
  digestWithout,
  exactKeys,
  privacySummary,
  requireBoolean,
  requireIdentifier,
  requireSha,
  requireUtc,
  sortedUnique,
} from "./release-common.mjs";

export const MIGRATION_PLAN_SCHEMA = "agentos.release_migration_plan.v1";
export const COMPATIBILITY_EVIDENCE_SCHEMA = "agentos.release_compatibility_evidence.v1";
export const MIGRATION_PHASES = Object.freeze(["BACKFILL", "CUTOVER", "RECONCILIATION", "ROLLBACK"]);
export const BACKFILL_STRATEGIES = Object.freeze(["NONE", "ONLINE", "OFFLINE", "BATCHED"]);
export const CUTOVER_STRATEGIES = Object.freeze(["ATOMIC", "PAUSED", "DUAL_READ", "DUAL_WRITE"]);
export const RECONCILIATION_STRATEGIES = Object.freeze(["REPLAY_AND_COMPARE", "CHECKSUM_AND_REPAIR", "OWNER_REVIEW"]);
export const ROLLBACK_STRATEGIES = Object.freeze(["RESTORE_CHECKPOINT", "FORWARD_FIX", "OWNER_HOLD"]);
export const IRREVERSIBLE_POINTS = Object.freeze(["NONE", "AFTER_BACKFILL", "AT_CUTOVER", "AFTER_RECONCILIATION"]);
export const COMPATIBILITY_SCENARIOS = Object.freeze([
  "OLD_STATE",
  "NEW_STATE",
  "MIXED_VERSION",
  "FAILED_MIGRATION",
  "INTERRUPTED_CUTOVER",
  "RECONCILIATION",
  "ROLLBACK",
]);
export const COMPATIBILITY_RESULTS = Object.freeze(["PASS", "FAIL", "PENDING"]);
export const MIGRATION_JOURNAL_STATUSES = Object.freeze(["JOURNALED", "INTENTIONALLY_JOURNALLESS", "MISSING_OR_UNPROVEN"]);
export const LOAD_BEARING_OBJECT_KINDS = Object.freeze([
  "FUNCTION_BODY",
  "FUNCTION_SIGNATURE",
  "GRANT",
  "INDEX",
  "POLICY",
  "REVOKE",
  "RLS_POSTURE",
  "SCHEMA_OBJECT",
  "TRIGGER",
]);

const PLAN_FIELDS = [
  "schema", "version", "status", "migration_id", "source_schema_version", "target_schema_version",
  "backfill_strategy", "cutover_strategy", "reconciliation_strategy", "irreversible_point",
  "rollback_strategy", "migration_journal_status", "migration_source_sha256", "journal_entry_key",
  "journal_entry_checksum_sha256", "journal_entry_sha256",
  "load_bearing_fingerprints", "steps", "plan_sha256",
];
const STEP_FIELDS = ["step_id", "phase", "order", "reversible", "required", "evidence_sha256"];
const FINGERPRINT_FIELDS = ["object_kind", "object_id", "fingerprint_sha256"];
const COMPATIBILITY_FIELDS = [
  "schema", "version", "status", "subject_candidate_sha256", "release_version", "migration_plan_sha256",
  "migration_journal_status", "migration_source_sha256", "load_bearing_fingerprints_sha256",
  "required_scenarios", "cases", "independent_checker_sha256", "checked_at_utc", "privacy", "compatibility_sha256",
];
const CASE_FIELDS = [
  "case_id", "scenario", "source_state_sha256", "target_state_sha256", "observed_state_sha256",
  "rollback_state_sha256", "result", "evidence_sha256",
];

function sortedSteps(steps) {
  return [...steps].sort((left, right) => left.order - right.order || compareUtf8(left.step_id, right.step_id));
}

function sortedCases(cases) {
  const order = new Map(COMPATIBILITY_SCENARIOS.map((scenario, index) => [scenario, index]));
  return [...cases].sort((left, right) => order.get(left.scenario) - order.get(right.scenario) || compareUtf8(left.case_id, right.case_id));
}

function sortedFingerprints(fingerprints) {
  return [...fingerprints].sort((left, right) => compareUtf8(left.object_kind, right.object_kind) || compareUtf8(left.object_id, right.object_id));
}

function validateMigrationStep(step, index) {
  exactKeys(step, STEP_FIELDS, `migration step ${index}`);
  requireIdentifier(step.step_id, `migration step ${index} ID`);
  assert(MIGRATION_PHASES.includes(step.phase), `migration step ${index} phase is invalid`);
  assert(Number.isSafeInteger(step.order) && step.order >= 1, `migration step ${index} order is invalid`);
  requireBoolean(step.reversible, `migration step ${index} reversible`);
  requireBoolean(step.required, `migration step ${index} required`);
  requireSha(step.evidence_sha256, `migration step ${index} evidence`);
  return step;
}

function validateLoadBearingFingerprint(value, index) {
  exactKeys(value, FINGERPRINT_FIELDS, `migration fingerprint ${index}`);
  assert(LOAD_BEARING_OBJECT_KINDS.includes(value.object_kind), `migration fingerprint ${index} object kind is invalid`);
  requireIdentifier(value.object_id, `migration fingerprint ${index} object ID`);
  requireSha(value.fingerprint_sha256, `migration fingerprint ${index} digest`);
  return value;
}

export function validateMigrationPlan(plan) {
  exactKeys(plan, PLAN_FIELDS, "migration plan");
  assert(plan.schema === MIGRATION_PLAN_SCHEMA && plan.version === 1, "migration plan identity is invalid");
  assert(plan.status === "PREPARED", "migration plan status is invalid");
  requireIdentifier(plan.migration_id, "migration ID");
  requireIdentifier(plan.source_schema_version, "migration source schema version");
  requireIdentifier(plan.target_schema_version, "migration target schema version");
  assert(plan.source_schema_version !== plan.target_schema_version, "migration schema versions must differ");
  assert(BACKFILL_STRATEGIES.includes(plan.backfill_strategy), "migration backfill strategy is invalid");
  assert(CUTOVER_STRATEGIES.includes(plan.cutover_strategy), "migration cutover strategy is invalid");
  assert(RECONCILIATION_STRATEGIES.includes(plan.reconciliation_strategy), "migration reconciliation strategy is invalid");
  assert(IRREVERSIBLE_POINTS.includes(plan.irreversible_point), "migration irreversible point is invalid");
  assert(ROLLBACK_STRATEGIES.includes(plan.rollback_strategy), "migration rollback strategy is invalid");
  assert(MIGRATION_JOURNAL_STATUSES.includes(plan.migration_journal_status), "migration journal status is invalid");
  requireSha(plan.migration_source_sha256, "migration source digest");
  assert(plan.journal_entry_key === null || typeof plan.journal_entry_key === "string", "migration journal entry key is invalid");
  if (plan.journal_entry_key !== null) requireIdentifier(plan.journal_entry_key, "migration journal entry key");
  requireSha(plan.journal_entry_checksum_sha256, "migration journal entry checksum", {nullable: true});
  requireSha(plan.journal_entry_sha256, "migration journal entry digest", {nullable: true});
  assert(Array.isArray(plan.load_bearing_fingerprints), "migration load-bearing fingerprints are required");
  const fingerprints = sortedFingerprints(plan.load_bearing_fingerprints);
  assert(JSON.stringify(plan.load_bearing_fingerprints) === JSON.stringify(fingerprints), "migration fingerprints must be ordered");
  const fingerprintIds = new Set();
  fingerprints.forEach((fingerprint, index) => {
    validateLoadBearingFingerprint(fingerprint, index);
    const key = `${fingerprint.object_kind}:${fingerprint.object_id}`;
    assert(!fingerprintIds.has(key), "migration fingerprints must be unique");
    fingerprintIds.add(key);
  });
  if (plan.migration_journal_status === "JOURNALED") {
    requireIdentifier(plan.journal_entry_key, "journaled migration entry key");
    requireSha(plan.journal_entry_checksum_sha256, "journaled migration entry checksum");
    requireSha(plan.journal_entry_sha256, "journaled migration entry digest");
  } else {
    assert(plan.journal_entry_key === null && plan.journal_entry_checksum_sha256 === null && plan.journal_entry_sha256 === null, "non-journaled migration cannot carry journal evidence");
  }
  if (plan.migration_journal_status === "INTENTIONALLY_JOURNALLESS") {
    assert(fingerprints.length > 0, "intentionally journal-less migration requires load-bearing fingerprints");
  }
  assert(Array.isArray(plan.steps) && plan.steps.length > 0, "migration plan steps are required");
  const steps = sortedSteps(plan.steps);
  assert(JSON.stringify(plan.steps) === JSON.stringify(steps), "migration plan steps must be ordered");
  const ids = new Set();
  const phases = new Set();
  steps.forEach((step, index) => {
    validateMigrationStep(step, index);
    assert(step.order === index + 1, "migration plan step order must be contiguous");
    assert(!ids.has(step.step_id), "migration plan step IDs must be unique");
    ids.add(step.step_id);
    if (step.required) phases.add(step.phase);
  });
  for (const phase of MIGRATION_PHASES) assert(phases.has(phase), `migration plan lacks required ${phase} evidence`);
  if (plan.irreversible_point !== "NONE") assert(steps.some((step) => step.reversible === false), "irreversible migration point lacks an irreversible step");
  requireSha(plan.plan_sha256, "migration plan digest");
  assert(plan.plan_sha256 === digestWithout(plan, "plan_sha256"), "migration plan digest does not match content");
  assertPortableRecord(plan, "migration plan");
  return plan;
}

export function requireMigrationPlanAdmission(plan) {
  validateMigrationPlan(plan);
  assert(plan.migration_journal_status !== "MISSING_OR_UNPROVEN", "migration provenance is missing or unproven");
  return plan;
}

export function compileMigrationPlan({
  migrationId,
  sourceSchemaVersion,
  targetSchemaVersion,
  backfillStrategy = "NONE",
  cutoverStrategy = "ATOMIC",
  reconciliationStrategy = "REPLAY_AND_COMPARE",
  irreversiblePoint = "NONE",
  rollbackStrategy = "RESTORE_CHECKPOINT",
  migrationJournalStatus,
  migrationSourceSha256,
  journalEntryKey = null,
  journalEntryChecksumSha256 = null,
  journalEntrySha256 = null,
  loadBearingFingerprints = [],
  steps,
} = {}) {
  requireIdentifier(migrationId, "migration ID");
  requireIdentifier(sourceSchemaVersion, "migration source schema version");
  requireIdentifier(targetSchemaVersion, "migration target schema version");
  assert(Array.isArray(steps), "migration steps are required");
  const ordered = sortedSteps(steps.map((step) => ({...step})));
  const plan = {
    schema: MIGRATION_PLAN_SCHEMA,
    version: 1,
    status: "PREPARED",
    migration_id: migrationId,
    source_schema_version: sourceSchemaVersion,
    target_schema_version: targetSchemaVersion,
    backfill_strategy: backfillStrategy,
    cutover_strategy: cutoverStrategy,
    reconciliation_strategy: reconciliationStrategy,
    irreversible_point: irreversiblePoint,
    rollback_strategy: rollbackStrategy,
    migration_journal_status: migrationJournalStatus,
    migration_source_sha256: migrationSourceSha256,
    journal_entry_key: journalEntryKey,
    journal_entry_checksum_sha256: journalEntryChecksumSha256,
    journal_entry_sha256: journalEntrySha256,
    load_bearing_fingerprints: sortedFingerprints(loadBearingFingerprints.map((fingerprint) => ({...fingerprint}))),
    steps: ordered,
    plan_sha256: null,
  };
  plan.plan_sha256 = digestWithout(plan, "plan_sha256");
  return validateMigrationPlan(plan);
}

function requiredStateFieldsFor(scenario) {
  if (scenario === "OLD_STATE") return ["source_state_sha256"];
  if (scenario === "NEW_STATE") return ["target_state_sha256"];
  if (scenario === "MIXED_VERSION") return ["source_state_sha256", "target_state_sha256"];
  if (scenario === "FAILED_MIGRATION" || scenario === "INTERRUPTED_CUTOVER" || scenario === "RECONCILIATION") return ["observed_state_sha256"];
  return ["rollback_state_sha256"];
}

export function validateCompatibilityCase(value, index = 0) {
  exactKeys(value, CASE_FIELDS, `compatibility case ${index}`);
  requireIdentifier(value.case_id, `compatibility case ${index} ID`);
  assert(COMPATIBILITY_SCENARIOS.includes(value.scenario), `compatibility case ${index} scenario is invalid`);
  for (const field of ["source_state_sha256", "target_state_sha256", "observed_state_sha256", "rollback_state_sha256"]) requireSha(value[field], `compatibility case ${index} ${field}`, {nullable: true});
  for (const field of requiredStateFieldsFor(value.scenario)) requireSha(value[field], `compatibility case ${index} ${field}`);
  if (value.scenario === "FAILED_MIGRATION" || value.scenario === "INTERRUPTED_CUTOVER") requireSha(value.rollback_state_sha256, `compatibility case ${index} rollback state`);
  assert(COMPATIBILITY_RESULTS.includes(value.result), `compatibility case ${index} result is invalid`);
  requireSha(value.evidence_sha256, `compatibility case ${index} evidence`);
  return value;
}

export function validateCompatibilityEvidence(value, {migrationPlan = null} = {}) {
  exactKeys(value, COMPATIBILITY_FIELDS, "compatibility evidence");
  assert(value.schema === COMPATIBILITY_EVIDENCE_SCHEMA && value.version === 1, "compatibility evidence identity is invalid");
  assert(["PASS", "BLOCKED"].includes(value.status), "compatibility evidence status is invalid");
  requireSha(value.subject_candidate_sha256, "compatibility subject candidate");
  requireIdentifier(value.release_version, "compatibility release version");
  requireSha(value.migration_plan_sha256, "compatibility migration plan");
  assert(MIGRATION_JOURNAL_STATUSES.includes(value.migration_journal_status), "compatibility migration journal status is invalid");
  requireSha(value.migration_source_sha256, "compatibility migration source digest");
  requireSha(value.load_bearing_fingerprints_sha256, "compatibility migration fingerprint digest");
  if (migrationPlan !== null) {
    validateMigrationPlan(migrationPlan);
    assert(value.migration_plan_sha256 === migrationPlan.plan_sha256, "compatibility migration plan is stale");
    assert(value.migration_journal_status === migrationPlan.migration_journal_status, "compatibility migration journal status differs");
    assert(value.migration_source_sha256 === migrationPlan.migration_source_sha256, "compatibility migration source differs");
    assert(value.load_bearing_fingerprints_sha256 === canonicalDigest(migrationPlan.load_bearing_fingerprints), "compatibility migration fingerprints differ");
  }
  assert(JSON.stringify(value.required_scenarios) === JSON.stringify(COMPATIBILITY_SCENARIOS), "compatibility required scenarios are incomplete or reordered");
  assert(Array.isArray(value.cases) && value.cases.length === COMPATIBILITY_SCENARIOS.length, "compatibility cases must cover every required scenario");
  const ordered = sortedCases(value.cases);
  assert(JSON.stringify(value.cases) === JSON.stringify(ordered), "compatibility cases must be ordered");
  const scenarios = new Set();
  const caseIds = new Set();
  value.cases.forEach((item, index) => {
    validateCompatibilityCase(item, index);
    assert(!scenarios.has(item.scenario), "compatibility scenarios must be unique");
    assert(!caseIds.has(item.case_id), "compatibility case IDs must be unique");
    scenarios.add(item.scenario);
    caseIds.add(item.case_id);
  });
  assert(scenarios.size === COMPATIBILITY_SCENARIOS.length, "compatibility evidence omitted a required scenario");
  requireSha(value.independent_checker_sha256, "compatibility independent checker");
  requireUtc(value.checked_at_utc, "compatibility check time");
  exactKeys(value.privacy, ["safe", "categories"], "compatibility privacy");
  assert(value.privacy.safe === true, "compatibility privacy check failed");
  for (const category of Object.keys(value.privacy.categories)) assert(value.privacy.categories[category] === 0, `compatibility privacy category is nonzero: ${category}`);
  const expectedStatus = value.migration_journal_status !== "MISSING_OR_UNPROVEN" && value.cases.every((item) => item.result === "PASS") ? "PASS" : "BLOCKED";
  assert(value.status === expectedStatus, "compatibility evidence status does not match cases");
  requireSha(value.compatibility_sha256, "compatibility evidence digest");
  assert(value.compatibility_sha256 === digestWithout(value, "compatibility_sha256"), "compatibility evidence digest does not match content");
  assertPortableRecord(value, "compatibility evidence");
  return value;
}

export function compileCompatibilityEvidence({subjectCandidateSha256, releaseVersion, migrationPlan, cases, independentCheckerSha256, checkedAtUtc} = {}) {
  validateMigrationPlan(migrationPlan);
  requireSha(subjectCandidateSha256, "compatibility subject candidate");
  requireIdentifier(releaseVersion, "compatibility release version");
  requireSha(independentCheckerSha256, "compatibility independent checker");
  requireUtc(checkedAtUtc, "compatibility check time");
  assert(Array.isArray(cases), "compatibility cases are required");
  const ordered = sortedCases(cases.map((item) => ({...item})));
  const evidence = {
    schema: COMPATIBILITY_EVIDENCE_SCHEMA,
    version: 1,
    status: migrationPlan.migration_journal_status !== "MISSING_OR_UNPROVEN" && ordered.length === COMPATIBILITY_SCENARIOS.length && ordered.every((item) => item.result === "PASS") ? "PASS" : "BLOCKED",
    subject_candidate_sha256: subjectCandidateSha256,
    release_version: releaseVersion,
    migration_plan_sha256: migrationPlan.plan_sha256,
    migration_journal_status: migrationPlan.migration_journal_status,
    migration_source_sha256: migrationPlan.migration_source_sha256,
    load_bearing_fingerprints_sha256: canonicalDigest(migrationPlan.load_bearing_fingerprints),
    required_scenarios: [...COMPATIBILITY_SCENARIOS],
    cases: ordered,
    independent_checker_sha256: independentCheckerSha256,
    checked_at_utc: checkedAtUtc,
    privacy: privacySummary({
      schema: COMPATIBILITY_EVIDENCE_SCHEMA,
      version: 1,
      subject_candidate_sha256: subjectCandidateSha256,
      release_version: releaseVersion,
      migration_plan_sha256: migrationPlan.plan_sha256,
      migration_journal_status: migrationPlan.migration_journal_status,
      migration_source_sha256: migrationPlan.migration_source_sha256,
      load_bearing_fingerprints_sha256: canonicalDigest(migrationPlan.load_bearing_fingerprints),
      required_scenarios: COMPATIBILITY_SCENARIOS,
      cases: ordered,
      independent_checker_sha256: independentCheckerSha256,
      checked_at_utc: checkedAtUtc,
    }),
    compatibility_sha256: null,
  };
  evidence.compatibility_sha256 = digestWithout(evidence, "compatibility_sha256");
  return validateCompatibilityEvidence(evidence, {migrationPlan});
}

export function requireCompatibilityPass(value, {migrationPlan = null} = {}) {
  if (migrationPlan !== null) requireMigrationPlanAdmission(migrationPlan);
  validateCompatibilityEvidence(value, {migrationPlan});
  assert(value.status === "PASS", "compatibility evidence is not passing");
  return value;
}
