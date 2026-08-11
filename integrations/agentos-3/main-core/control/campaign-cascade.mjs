#!/usr/bin/env node

import crypto from "node:crypto";
import {validateFinalizerRewriteAssessment} from "./cascade-economics.mjs";
import {validateAcceptanceBinding} from "./campaign-acceptance-contract.mjs";
import {verifyProductAcceptanceProof} from "./acceptance-bridge.mjs";
import {validateClosureReceipt, validateDeploymentReceipt, validateLiveAuditReceipt, validateRepositoryCheckpointProof} from "./campaign-lifecycle.mjs";
import {
  assertUniversalDevelopmentMode,
  compileUniversalTaskCloseoutReceipts,
  validateUniversalTaskCloseoutForMode,
} from "./governance-library.mjs";

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
  "pushed_checkpoint", "incomplete_work", "evidence",
];

const QUALITY_EVIDENCE_KEYS = [
  "schema", "candidate_id", "campaign_id", "campaign_version", "worktree_id",
  "commit", "tree", "remote_commit", "remote_tree", "checks", "observed_by_role",
  "observed_by_session", "observed_at_utc", "evidence_sha256",
];

const JUSTIFICATION_BASES = new Set([
  "REQUIRED_ACCEPTANCE",
  "HARD_RULE_OR_MATERIAL_RISK",
  "OBSERVED_BLOCKER",
  "OWNER_AUTHORIZATION",
]);
const JUSTIFICATION_KEYS = ["basis", "references", "summary", "owner_authorization_sha256", "changed_paths", "path_bindings"];

function validateImplementationJustification(justification, label, acceptanceContract = null, extraReferences = [], candidate = null) {
  exactKeys(justification, JUSTIFICATION_KEYS, label);
  assert(JUSTIFICATION_BASES.has(justification.basis), `${label} basis is invalid`);
  sortedUniqueStrings(justification.references, `${label} references`);
  requireString(justification.summary, `${label} summary`);
  validatePathList(justification.changed_paths, `${label} changed paths`);
  assert(Array.isArray(justification.path_bindings), `${label} path bindings are required`);
  assert(justification.path_bindings.length === justification.changed_paths.length, `${label} must bind every changed path`);
  let previousPath = null;
  for (const binding of justification.path_bindings) {
    exactKeys(binding, ["path", "references", "observation"], `${label} path binding`);
    validatePathList([binding.path], `${label} path binding path`);
    sortedUniqueStrings(binding.references, `${label} path binding references`);
    exactKeys(binding.observation, ["schema", "path", "candidate_id", "commit", "tree", "observation_kind", "summary", "observation_sha256"], `${label} path observation`);
    assert(binding.observation.schema === "governance.path_scope_observation.v1", `${label} path observation schema mismatch`);
    assert(binding.observation.path === binding.path, `${label} path observation names a different path`);
    for (const field of ["candidate_id", "commit", "tree", "observation_kind"]) requireString(binding.observation[field], `${label} path observation ${field}`);
    assert(binding.observation.observation_kind === "PATH_BOUND_SCOPE", `${label} path observation kind is invalid`);
    requireString(binding.observation.summary, `${label} path observation summary`);
    requireSha(binding.observation.observation_sha256, `${label} path observation digest`);
    assert(binding.observation.observation_sha256 === cascadeDigest({...binding.observation, observation_sha256: null}), `${label} path observation is not content-addressed`);
    if (candidate !== null) {
      assert(binding.observation.candidate_id === candidate.candidate_id
        && binding.observation.commit === candidate.commit
        && binding.observation.tree === candidate.tree,
      `${label} path observation is bound to a different candidate`);
    }
    if (previousPath !== null) assert(compareUtf8(previousPath, binding.path) < 0, `${label} path bindings must be UTF-8 sorted`);
    previousPath = binding.path;
    assert(justification.changed_paths.includes(binding.path), `${label} path binding names an unlisted path`);
  }
  assert(canonicalJson(justification.path_bindings.map((binding) => binding.path)) === canonicalJson(justification.changed_paths), `${label} path bindings do not cover changed paths exactly`);
  if (justification.owner_authorization_sha256 !== null) requireSha(justification.owner_authorization_sha256, `${label} owner authorization`);
  if (justification.basis === "OWNER_AUTHORIZATION") {
    requireSha(justification.owner_authorization_sha256, `${label} owner authorization`);
  }
  if (acceptanceContract !== null) {
    const admittedReferences = new Set([
      ...acceptanceContract.required_question_ids,
      ...acceptanceContract.hard_rules,
      ...extraReferences,
    ]);
    assert(justification.references.every((reference) => admittedReferences.has(reference)),
      `${label} references an item outside the complete acceptance contract`);
    if (justification.basis === "REQUIRED_ACCEPTANCE") {
      assert(justification.references.some((reference) => acceptanceContract.required_question_ids.includes(reference)),
        `${label} does not identify a required acceptance question`);
    }
    for (const binding of justification.path_bindings) {
      assert(binding.references.every((reference) => admittedReferences.has(reference)), `${label} path binding cites an item outside the complete acceptance contract`);
    }
  }
}

function validateQualityFloor(floor, candidate, terminal = false) {
  exactKeys(floor, QUALITY_KEYS, "first-pass quality floor");
  for (const field of QUALITY_KEYS.slice(0, 7)) assert(typeof floor[field] === "boolean", `quality floor ${field} must be boolean`);
  assert(Array.isArray(floor.incomplete_work), "quality floor incomplete_work must be an array");
  sortedUniqueStrings(floor.incomplete_work, "quality floor incomplete_work", {allowEmpty: true});
  exactKeys(floor.evidence, QUALITY_EVIDENCE_KEYS, "quality floor evidence");
  assert(floor.evidence.schema === "governance.quality_floor_observation.v1", "quality floor evidence schema mismatch");
  for (const field of ["candidate_id", "campaign_id", "campaign_version", "worktree_id", "commit", "tree", "remote_commit", "remote_tree", "observed_by_role", "observed_by_session"]) requireString(floor.evidence[field], `quality floor evidence ${field}`);
  assert(floor.evidence.candidate_id === candidate.candidate_id && floor.evidence.campaign_id === candidate.campaign_id
    && floor.evidence.campaign_version === candidate.campaign_version && floor.evidence.worktree_id === candidate.worktree_id
    && floor.evidence.commit === candidate.commit && floor.evidence.tree === candidate.tree
    && floor.evidence.remote_commit === candidate.remote_commit && floor.evidence.remote_tree === candidate.remote_tree,
  "quality floor evidence is bound to a different candidate");
  assert(floor.evidence.observed_by_role !== candidate.owner_role_id && floor.evidence.observed_by_session !== candidate.auditor_session_id,
    "quality floor evidence is self-attested by campaign custody");
  sortedUniqueStrings(floor.evidence.checks, "quality floor evidence checks");
  requireUtc(floor.evidence.observed_at_utc, "quality floor evidence observation time");
  requireSha(floor.evidence.evidence_sha256, "quality floor evidence digest");
  assert(floor.evidence.evidence_sha256 === cascadeDigest({...floor.evidence, evidence_sha256: null}), "quality floor evidence is not content-addressed");
  if (terminal) {
    for (const field of QUALITY_KEYS.slice(0, 7)) assert(floor[field] === true, `terminal first-pass quality floor is missing ${field}`);
  }
}

const CHECKPOINT_KEYS = [
  "schema", "candidate_id", "campaign_id", "campaign_version", "logical_lineage_id",
  "policy_epoch", "policy_snapshot_sha256", "acceptance_contract", "acceptance_contract_sha256", "scope_justification",
  "worktree_id", "branch", "commit", "tree", "remote_commit", "remote_tree",
  "clean", "pushed", "repository_proof", "changed_paths", "changed_surfaces", "owner_role_id", "auditor_session_id",
  "checkpoint_kind", "terminal", "quality_floor", "created_at_utc", "candidate_sha256",
];

export function validateFirstPassCandidate(candidate) {
  exactKeys(candidate, CHECKPOINT_KEYS, "first-pass candidate");
  assert(candidate.schema === "governance.first_pass_candidate.v1", "first-pass candidate schema mismatch");
  for (const field of ["candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "worktree_id", "branch", "commit", "tree", "remote_commit", "remote_tree", "owner_role_id", "auditor_session_id", "checkpoint_kind"]) {
    requireString(candidate[field], `first-pass candidate ${field}`);
  }
  assert(CASCADE_ID.test(candidate.candidate_id), "first-pass candidate ID is invalid");
  assert(Number.isSafeInteger(candidate.policy_epoch) && candidate.policy_epoch >= 1, "first-pass policy epoch is invalid");
  requireSha(candidate.policy_snapshot_sha256, "first-pass policy snapshot");
  requireSha(candidate.acceptance_contract_sha256, "first-pass acceptance contract digest");
  validateAcceptanceBinding({candidate, contract: candidate.acceptance_contract});
  validateImplementationJustification(candidate.scope_justification, "first-pass implementation scope", candidate.acceptance_contract, [], candidate);
  assert(canonicalJson(candidate.scope_justification.changed_paths) === canonicalJson(candidate.changed_paths), "first-pass changed paths differ from justification");
  assert(IDENTIFIER.test(candidate.worktree_id), "first-pass worktree ID is invalid");
  assert(["SUBSTANTIAL_CHECKPOINT", "TERMINAL_FIRST_PASS"].includes(candidate.checkpoint_kind), "first-pass checkpoint kind is invalid");
  assert(typeof candidate.terminal === "boolean", "first-pass terminal flag is invalid");
  assert(candidate.terminal === (candidate.checkpoint_kind === "TERMINAL_FIRST_PASS"), "first-pass terminal flag contradicts checkpoint kind");
  assert(typeof candidate.clean === "boolean" && typeof candidate.pushed === "boolean", "first-pass checkpoint state is invalid");
  if (candidate.pushed) {
    assert(candidate.clean === true, "pushed first-pass candidate is not clean");
    assert(candidate.commit === candidate.remote_commit && candidate.tree === candidate.remote_tree, "pushed first-pass candidate is not remote-equal");
  }
  validateRepositoryCheckpointProof(candidate.repository_proof, {worktree_id: candidate.worktree_id, commit: candidate.commit, tree: candidate.tree, remote_commit: candidate.remote_commit, remote_tree: candidate.remote_tree});
  assert(candidate.repository_proof.clean === candidate.clean && candidate.repository_proof.pushed === candidate.pushed, "first-pass repository proof disagrees with checkpoint flags");
  assert(candidate.quality_floor.clean_checkpoint === candidate.clean, "quality floor clean checkpoint disagrees with the actual checkpoint");
  assert(candidate.quality_floor.pushed_checkpoint === candidate.pushed, "quality floor pushed checkpoint disagrees with the actual checkpoint");
  if (candidate.terminal) assert(candidate.clean === true && candidate.pushed === true, "terminal first-pass candidate must be clean and pushed");
  validatePathList(candidate.changed_paths, "first-pass changed paths");
  sortedUniqueStrings(candidate.changed_surfaces, "first-pass changed surfaces");
  assert(canonicalJson(candidate.changed_surfaces) === canonicalJson(deriveChangedSurfacesFromPaths(candidate.changed_paths)),
    "first-pass changed surfaces are not mechanically derived from changed paths");
  validateQualityFloor(candidate.quality_floor, candidate, candidate.terminal);
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
  candidate.quality_floor.evidence = {
    ...candidate.quality_floor.evidence,
    candidate_id: candidate.candidate_id,
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    worktree_id: candidate.worktree_id,
    commit: candidate.commit,
    tree: candidate.tree,
    remote_commit: candidate.remote_commit,
    remote_tree: candidate.remote_tree,
    evidence_sha256: null,
  };
  candidate.quality_floor.evidence.evidence_sha256 = cascadeDigest({...candidate.quality_floor.evidence, evidence_sha256: null});
  candidate.repository_proof = {
    ...candidate.repository_proof,
    worktree_id: candidate.worktree_id,
    commit: candidate.commit,
    tree: candidate.tree,
    remote_commit: candidate.remote_commit,
    remote_tree: candidate.remote_tree,
    observation_sha256: null,
  };
  candidate.repository_proof.observation_sha256 = cascadeDigest({...candidate.repository_proof, observation_sha256: null});
  candidate.terminal = Boolean(input.terminal);
  candidate.checkpoint_kind = candidate.terminal ? "TERMINAL_FIRST_PASS" : "SUBSTANTIAL_CHECKPOINT";
  delete candidate.candidate_sha256;
  candidate.candidate_sha256 = cascadeDigest(candidate);
  validateFirstPassCandidate(candidate);
  return candidate;
}

const SURFACE_DISCIPLINES = new Map([
  ["TESTS", ["FUNCTIONALITY", "CODE_QUALITY_HYGIENE"]],
  ["UI", ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION"]],
  ["AUTHENTICATED_UI", ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY"]],
  ["BACKEND_API", ["FUNCTIONALITY"]],
  ["DATABASE_SCHEMA", ["FUNCTIONALITY"]],
  ["PROVIDER_INTEGRATION", ["FUNCTIONALITY"]],
  ["RUNTIME_CONFIG", ["FUNCTIONALITY"]],
  ["SECURITY_BOUNDARY", ["SECURITY"]],
  ["UNKNOWN", ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"]],
]);

export function deriveChangedSurfacesFromPaths(changedPaths) {
  const surfaces = new Set();
  for (const value of changedPaths) {
    if (/\.(?:md|mdx|txt|rst)$/iu.test(value) || /(?:^|\/)(?:docs?|documentation)(?:\/|$)/iu.test(value)) surfaces.add("DOCS");
    if (/(?:test|spec)(?:[./_-]|$)/iu.test(value)) surfaces.add("TESTS");
    if (/\b(?:ui|view|component|route|shell|navigation)\b/iu.test(value)) surfaces.add("UI");
    if (/\b(?:auth|permission|policy|secret|credential|session)\b/iu.test(value)) surfaces.add("AUTHENTICATED_UI");
    if (/\b(?:api|server|service|handler|controller)\b/iu.test(value)) surfaces.add("BACKEND_API");
    if (/\b(?:migration|schema|database|rls|model)\b/iu.test(value)) surfaces.add("DATABASE_SCHEMA");
    if (/\b(?:provider|integration|adapter|client)\b/iu.test(value)) surfaces.add("PROVIDER_INTEGRATION");
    if (/\b(?:runtime|deploy|config|environment)\b/iu.test(value)) surfaces.add("RUNTIME_CONFIG");
  }
  if (surfaces.size === 0 || [...surfaces].every((surface) => ["DOCS", "TESTS"].includes(surface))) {
    if (surfaces.size === 0) surfaces.add("UNKNOWN");
  }
  return [...surfaces].sort(compareUtf8);
}

export function deriveApplicableDisciplines(changedSurfaces) {
  const result = new Set();
  for (const surface of changedSurfaces) {
    for (const discipline of SURFACE_DISCIPLINES.get(surface) ?? []) result.add(discipline);
  }
  return result;
}

const NON_APPLICABILITY_EVIDENCE_KEYS = [
  "schema", "auditor_session_id", "candidate_id", "candidate_commit", "candidate_tree",
  "discipline", "changed_surfaces", "reason", "observed_at_utc", "evidence_sha256",
];
const AUDIT_PLAN_KEYS = ["schema", "campaign_id", "campaign_version", "candidate_id", "candidate_commit", "candidate_tree", "changed_surfaces", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "required_question_ids", "auditor_session_id", "terminal", "disciplines", "plan_sha256"];
const AUDIT_PLAN_DISCIPLINE_KEYS = ["discipline", "disposition", "applicability_evidence", "applicability_evidence_sha256"];

function validateNonApplicabilityEvidence(evidence, plan) {
  exactKeys(evidence, NON_APPLICABILITY_EVIDENCE_KEYS, "non-applicability evidence");
  assert(evidence.schema === "governance.audit_non_applicability_evidence.v1", "non-applicability evidence schema mismatch");
  requireString(evidence.auditor_session_id, "non-applicability evidence Auditor");
  assert(evidence.auditor_session_id === plan.auditor_session_id, "non-applicability evidence Auditor binding mismatch");
  assert(evidence.candidate_id === plan.candidate_id && evidence.candidate_commit === plan.candidate_commit && evidence.candidate_tree === plan.candidate_tree, "non-applicability evidence candidate mismatch");
  assert(evidence.discipline === plan.discipline && DISCIPLINES.has(evidence.discipline), "non-applicability evidence discipline mismatch");
  assert(canonicalJson(evidence.changed_surfaces) === canonicalJson(plan.changed_surfaces), "non-applicability evidence surfaces mismatch");
  requireString(evidence.reason, "non-applicability evidence reason");
  requireUtc(evidence.observed_at_utc, "non-applicability evidence observation time");
  requireSha(evidence.evidence_sha256, "non-applicability evidence digest");
  assert(evidence.evidence_sha256 === cascadeDigest({...evidence, evidence_sha256: null}), "non-applicability evidence is not content-addressed");
}

export function compileNonApplicabilityEvidence({candidate, discipline, auditorSessionId, reason, observedAtUtc}) {
  validateFirstPassCandidate(candidate);
  requireString(auditorSessionId, "non-applicability Auditor session");
  assert(auditorSessionId === candidate.auditor_session_id, "non-applicability Auditor differs from candidate");
  requireString(reason, "non-applicability reason");
  requireUtc(observedAtUtc, "non-applicability observation time");
  const evidence = {
    schema: "governance.audit_non_applicability_evidence.v1",
    auditor_session_id: auditorSessionId,
    candidate_id: candidate.candidate_id,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    discipline,
    changed_surfaces: [...candidate.changed_surfaces],
    reason,
    observed_at_utc: observedAtUtc,
    evidence_sha256: null,
  };
  evidence.evidence_sha256 = cascadeDigest({...evidence, evidence_sha256: null});
  validateNonApplicabilityEvidence(evidence, {
    ...evidence,
    changed_surfaces: candidate.changed_surfaces,
    auditor_session_id: auditorSessionId,
  });
  return evidence;
}

export function validateAuditPlan(plan) {
  exactKeys(plan, AUDIT_PLAN_KEYS, "cascade audit plan");
  assert(plan.schema === "governance.cascade_audit_plan.v1", "cascade audit plan schema mismatch");
  for (const field of ["campaign_id", "campaign_version", "candidate_id", "candidate_commit", "candidate_tree"]) requireString(plan[field], `audit plan ${field}`);
  sortedUniqueStrings(plan.changed_surfaces, "audit plan changed surfaces");
  assert(Number.isSafeInteger(plan.policy_epoch) && plan.policy_epoch >= 1, "audit plan policy epoch is invalid");
  requireSha(plan.policy_state_sha256, "audit plan policy state");
  requireSha(plan.acceptance_contract_sha256, "audit plan acceptance contract");
  validateQuestionIds(plan.required_question_ids, "audit plan required question IDs");
  requireString(plan.auditor_session_id, "audit plan Auditor session");
  assert(typeof plan.terminal === "boolean", "audit plan terminal flag is invalid");
  assert(Array.isArray(plan.disciplines) && plan.disciplines.length === AUDIT_DISCIPLINES.length, "audit plan must contain all four disciplines");
  const seen = new Set();
  for (const item of plan.disciplines) {
    exactKeys(item, AUDIT_PLAN_DISCIPLINE_KEYS, "audit plan discipline");
    assert(DISCIPLINES.has(item.discipline) && !seen.has(item.discipline), "audit plan discipline is duplicate or unknown");
    seen.add(item.discipline);
    assert(DISPOSITIONS.has(item.disposition), "audit plan disposition is invalid");
    if (item.disposition === "NOT_APPLICABLE_WITH_PROOF") {
      validateNonApplicabilityEvidence(item.applicability_evidence, {...plan, discipline: item.discipline});
      requireSha(item.applicability_evidence_sha256, "audit plan non-applicability evidence");
      assert(item.applicability_evidence_sha256 === item.applicability_evidence.evidence_sha256, "audit plan non-applicability evidence digest mismatch");
    } else {
      assert(item.applicability_evidence === null && item.applicability_evidence_sha256 === null, "audit plan carries unused applicability evidence");
    }
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
  assert(terminal === candidate.terminal, "audit plan terminal flag must match the candidate checkpoint");
  const applicable = deriveApplicableDisciplines(candidate.changed_surfaces);
  const disciplines = AUDIT_DISCIPLINES.map((discipline) => {
    const explicitlySet = applicability[discipline];
    if (explicitlySet !== undefined) assert(typeof explicitlySet === "boolean" || explicitlySet === "DETERMINISTIC_ONLY", `audit applicability for ${discipline} must be boolean or DETERMINISTIC_ONLY`);
    if (explicitlySet === false) assert(!applicable.has(discipline), `${discipline} is applicable from the changed surfaces and cannot be suppressed`);
    const deterministic = deterministicOnly.includes(discipline) || explicitlySet === "DETERMINISTIC_ONLY";
    const isApplicable = explicitlySet === undefined ? applicable.has(discipline) : explicitlySet === true || explicitlySet === "DETERMINISTIC_ONLY";
    assert(typeof isApplicable === "boolean", `audit applicability for ${discipline} must be boolean or DETERMINISTIC_ONLY`);
    const disposition = deterministic
      ? "DETERMINISTIC_ONLY"
      : isApplicable
        ? "REQUIRED"
        : terminal ? "NOT_APPLICABLE_WITH_PROOF" : "DEFERRED_UNTIL_TERMINAL";
    const evidence = disposition === "NOT_APPLICABLE_WITH_PROOF" ? nonApplicabilityEvidence[discipline] : null;
    if (disposition === "NOT_APPLICABLE_WITH_PROOF") validateNonApplicabilityEvidence(evidence, {
      auditor_session_id: auditorSessionId,
      candidate_id: candidate.candidate_id,
      candidate_commit: candidate.commit,
      candidate_tree: candidate.tree,
      discipline,
      changed_surfaces: candidate.changed_surfaces,
    });
    return {discipline, disposition, applicability_evidence: evidence, applicability_evidence_sha256: evidence?.evidence_sha256 ?? null};
  });
  const plan = {
    schema: "governance.cascade_audit_plan.v1",
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    candidate_id: candidate.candidate_id,
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    changed_surfaces: [...candidate.changed_surfaces],
    policy_epoch: candidate.policy_epoch,
    policy_state_sha256: candidate.policy_snapshot_sha256,
    acceptance_contract_sha256: candidate.acceptance_contract_sha256,
    required_question_ids: [...candidate.acceptance_contract.required_question_ids],
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
const COVERAGE_KEYS = ["inspected_surfaces", "excluded_paths", "unavailable_behavior", "scope_basis", "independent_of_builder_scope", "coverage_sha256"];
const RECEIPT_KEYS = ["schema", "receipt_kind", "session_id", "campaign_id", "campaign_version", "candidate_id", "discipline", "issued_by_role", "issued_at_utc", "receipt_sha256"];
const ROSTER_RECEIPT_KEYS = [...RECEIPT_KEYS, "role", "status"];
const WORKER_BINDING_KEYS = ["schema", "role", "session_id", "campaign_id", "campaign_version", "candidate_id", "candidate_commit", "candidate_tree", "discipline", "auditor_session_id", "spawn_receipt", "roster_receipt", "fresh", "pinned", "read_only", "binding_sha256"];
const AUDIT_REPORT_KEYS = ["schema", "report_id", "discipline", "candidate_id", "candidate_commit", "candidate_tree", "auditor_session_id", "worker_session_id", "worker_binding", "read_only", "reviewed_question_ids", "failed_question_ids", "findings", "coverage", "evidence_sha256", "settled", "report_sha256"];

function validateWorkerReceipt(receipt, label, plan, discipline, {roster = false} = {}) {
  exactKeys(receipt, roster ? ROSTER_RECEIPT_KEYS : RECEIPT_KEYS, label);
  assert(receipt.schema === `governance.audit_worker_${roster ? "roster" : "spawn"}_receipt.v1`, `${label} schema mismatch`);
  assert(receipt.receipt_kind === (roster ? "ROSTER" : "SPAWN"), `${label} kind mismatch`);
  for (const field of ["session_id", "campaign_id", "campaign_version", "candidate_id", "discipline", "issued_by_role", "issued_at_utc"]) requireString(receipt[field], `${label} ${field}`);
  requireUtc(receipt.issued_at_utc, `${label} time`);
  assert(receipt.session_id !== plan.auditor_session_id, `${label} reuses the Auditor session`);
  assert(receipt.campaign_id === plan.campaign_id && receipt.campaign_version === plan.campaign_version
    && receipt.candidate_id === plan.candidate_id && receipt.discipline === discipline,
  `${label} is not bound to the exact audit plan`);
  assert(receipt.issued_by_role === "CAMPAIGN_ORCHESTRATOR", `${label} issuer is not the Campaign Orchestrator`);
  if (roster) {
    assert(receipt.role === "AUDIT_WORKER" && receipt.status === "ACTIVE", `${label} roster status is invalid`);
  }
  requireSha(receipt.receipt_sha256, `${label} digest`);
  assert(receipt.receipt_sha256 === cascadeDigest({...receipt, receipt_sha256: null}), `${label} is not content-addressed`);
  return receipt;
}

function validateWorkerBinding(binding, plan, discipline) {
  exactKeys(binding, WORKER_BINDING_KEYS, "audit worker binding");
  assert(binding.schema === "governance.audit_worker_binding.v1" && binding.role === "AUDIT_WORKER", "audit worker binding identity is invalid");
  for (const field of ["session_id", "campaign_id", "campaign_version", "candidate_id", "candidate_commit", "candidate_tree", "discipline", "auditor_session_id"]) requireString(binding[field], `audit worker binding ${field}`);
  assert(binding.campaign_id === plan.campaign_id && binding.campaign_version === plan.campaign_version
    && binding.candidate_id === plan.candidate_id && binding.candidate_commit === plan.candidate_commit
    && binding.candidate_tree === plan.candidate_tree && binding.discipline === discipline
    && binding.auditor_session_id === plan.auditor_session_id, "audit worker binding candidate or campaign mismatch");
  assert(binding.session_id !== binding.auditor_session_id, "audit worker cannot be the independent Auditor session");
  validateWorkerReceipt(binding.spawn_receipt, "audit worker spawn receipt", plan, discipline);
  validateWorkerReceipt(binding.roster_receipt, "audit worker roster receipt", plan, discipline, {roster: true});
  assert(binding.spawn_receipt.session_id === binding.session_id && binding.roster_receipt.session_id === binding.session_id, "audit worker receipts name a different session");
  assert(binding.fresh === true && binding.pinned === true && binding.read_only === true, "audit worker binding is not fresh, pinned, and read-only");
  requireSha(binding.binding_sha256, "audit worker binding digest");
  assert(binding.binding_sha256 === cascadeDigest({...binding, binding_sha256: null}), "audit worker binding is not content-addressed");
  return binding;
}

export function compileAuditWorkerBinding({plan, discipline, sessionId, spawnReceipt, rosterReceipt}) {
  validateAuditPlan(plan);
  requireString(sessionId, "audit worker session");
  validateWorkerReceipt(spawnReceipt, "audit worker spawn receipt", plan, discipline);
  validateWorkerReceipt(rosterReceipt, "audit worker roster receipt", plan, discipline, {roster: true});
  const binding = {
    schema: "governance.audit_worker_binding.v1",
    role: "AUDIT_WORKER",
    session_id: sessionId,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    candidate_id: plan.candidate_id,
    candidate_commit: plan.candidate_commit,
    candidate_tree: plan.candidate_tree,
    discipline,
    auditor_session_id: plan.auditor_session_id,
    spawn_receipt: structuredClone(spawnReceipt),
    roster_receipt: structuredClone(rosterReceipt),
    fresh: true,
    pinned: true,
    read_only: true,
    binding_sha256: null,
  };
  binding.binding_sha256 = cascadeDigest({...binding, binding_sha256: null});
  return validateWorkerBinding(binding, plan, discipline);
}

function validateAuditCoverage(coverage, label = "audit coverage") {
  exactKeys(coverage, COVERAGE_KEYS, label);
  sortedUniqueStrings(coverage.inspected_surfaces, `${label} inspected surfaces`);
  validatePathList(coverage.excluded_paths, `${label} excluded paths`, {allowEmpty: true});
  requireString(coverage.unavailable_behavior, `${label} unavailable behavior`);
  assert(coverage.scope_basis === "INDEPENDENT_DOMAIN_WIDE", `${label} scope is constrained by builder interpretation`);
  assert(coverage.independent_of_builder_scope === true, `${label} is not independent of builder scope`);
  const body = structuredClone(coverage);
  delete body.coverage_sha256;
  requireSha(coverage.coverage_sha256, `${label} digest`);
  assert(coverage.coverage_sha256 === cascadeDigest(body), `${label} digest is not content-addressed`);
}

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
  assert(finding.route !== "CLOSED_NO_FINDING", "a finding cannot be routed as closed-no-finding");
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
    requireString(report.worker_session_id, "terminal required audit worker identity");
    assert(report.worker_binding !== null, "terminal required audit worker binding is missing");
    validateWorkerBinding(report.worker_binding, plan, report.discipline);
    assert(report.worker_binding.session_id === report.worker_session_id, "audit report worker session differs from its binding");
  } else if (report.worker_binding !== null) {
    validateWorkerBinding(report.worker_binding, plan, report.discipline);
    assert(report.worker_binding.session_id === report.worker_session_id, "audit report worker session differs from its binding");
  }
  if (planItem.disposition === "DETERMINISTIC_ONLY") assert(report.worker_session_id === null && report.worker_binding === null, "deterministic audit must not spawn a worker");
  assert(report.read_only === true && report.settled === true, "audit report is not read-only and settled");
  validateQuestionIds(report.reviewed_question_ids, "audit reviewed question IDs", {allowEmpty: true});
  validateQuestionIds(report.failed_question_ids, "audit failed question IDs", {allowEmpty: true});
  assert(report.reviewed_question_ids.every((id) => plan.required_question_ids.includes(id)), "audit report reviews a question outside the complete campaign contract");
  assert(report.failed_question_ids.every((id) => plan.required_question_ids.includes(id)), "audit report fails a question outside the complete campaign contract");
  if (plan.terminal && planItem.disposition === "REQUIRED") {
    assert(report.reviewed_question_ids.length > 0, "terminal required audit lacks a reviewed question slice");
  }
  assert(report.failed_question_ids.every((id) => report.reviewed_question_ids.includes(id)), "failed audit question is not reviewed");
  assert(Array.isArray(report.findings), "audit report findings are required");
  const findingIds = report.findings.map((finding) => finding.finding_id);
  sortedUniqueStrings(findingIds, "audit finding IDs", {allowEmpty: true});
  for (const finding of report.findings) {
    validateFinding(finding, report.discipline, report.candidate_commit, report.candidate_tree);
  }
  validateAuditCoverage(report.coverage);
  const body = structuredClone(report);
  delete body.report_sha256;
  assert(report.report_sha256 === cascadeDigest(body), "audit report digest is not content-addressed");
  return report;
}

export function compileAuditReport({plan, discipline, auditorSessionId, workerSessionId = undefined, workerBinding = null, reviewedQuestionIds = [], failedQuestionIds = [], findings = [], coverage = null, evidenceSha256}) {
  validateAuditPlan(plan);
  requireString(auditorSessionId, "Auditor session");
  requireSha(evidenceSha256, "audit evidence");
  assert(workerSessionId === undefined, "bare audit worker session IDs are not accepted; provide a bound workerBinding");
  const planItem = plan.disciplines.find((item) => item.discipline === discipline);
  if (plan.terminal && planItem?.disposition === "REQUIRED") assert(workerBinding !== null, "terminal required audit requires a bound worker");
  if (planItem?.disposition === "DETERMINISTIC_ONLY") assert(workerBinding === null, "deterministic audit cannot have a worker binding");
  const report = {
    schema: "governance.cascade_audit_report.v1",
    report_id: `${discipline}-REPORT`,
    discipline,
    candidate_id: plan.candidate_id,
    candidate_commit: plan.candidate_commit,
    candidate_tree: plan.candidate_tree,
    auditor_session_id: auditorSessionId,
    worker_session_id: workerBinding?.session_id ?? null,
    worker_binding: workerBinding === null ? null : structuredClone(workerBinding),
    read_only: true,
    reviewed_question_ids: validateQuestionIds(reviewedQuestionIds, "reviewed question IDs", {allowEmpty: true}),
    failed_question_ids: validateQuestionIds(failedQuestionIds, "failed question IDs", {allowEmpty: true}),
    findings: structuredClone(findings).sort((left, right) => compareUtf8(left.finding_id ?? "", right.finding_id ?? "")),
    coverage: coverage === null ? {
      inspected_surfaces: [discipline],
      excluded_paths: [],
      unavailable_behavior: reviewedQuestionIds.length > 0 ? "The mapped question slice was inspected." : "No mapped question slice was supplied; deterministic or direct discipline coverage is recorded.",
      scope_basis: "INDEPENDENT_DOMAIN_WIDE",
      independent_of_builder_scope: true,
      coverage_sha256: null,
    } : structuredClone(coverage),
    evidence_sha256: evidenceSha256,
    settled: true,
    report_sha256: "",
  };
  const coverageBody = structuredClone(report.coverage);
  delete coverageBody.coverage_sha256;
  report.coverage.coverage_sha256 = cascadeDigest(coverageBody);
  const body = structuredClone(report);
  delete body.report_sha256;
  report.report_sha256 = cascadeDigest(body);
  validateAuditReport(report, plan);
  return report;
}

const RECONCILIATION_KEYS = ["schema", "candidate_id", "candidate_commit", "candidate_tree", "terminal", "settled_disciplines", "reports", "findings", "immediate_first_pass_repairs", "finalization_queue", "owner_only_findings", "reconciliation_sha256"];
const REPORT_BINDING_KEYS = ["discipline", "report_sha256", "auditor_session_id", "worker_session_id", "worker_binding_sha256"];

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
  const findings = reports
    .flatMap((report) => report.findings.map((finding) => ({...finding, source_report_sha256: report.report_sha256})))
    .sort((left, right) => compareUtf8(left.finding_id, right.finding_id));
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
        worker_binding_sha256: report.worker_binding === null ? null : report.worker_binding.binding_sha256,
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
      requireString(binding.worker_session_id, "terminal required audit worker session");
      requireSha(binding.worker_binding_sha256, "terminal required audit worker binding");
    }
    if (planItem?.disposition === "DETERMINISTIC_ONLY") assert(binding.worker_session_id === null && binding.worker_binding_sha256 === null, "deterministic audit binding must not claim a worker");
    else {
      assert(binding.worker_session_id === null || typeof binding.worker_session_id === "string", "audit worker session is invalid");
      if (binding.worker_session_id === null) assert(binding.worker_binding_sha256 === null, "unbound audit worker digest is invalid");
      else requireSha(binding.worker_binding_sha256, "audit worker binding digest");
    }
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
  sortedUniqueStrings(reconciliation.findings.map((finding) => finding.finding_id), "reconciled finding IDs", {allowEmpty: true});
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
  "scope_finding_ids", "change_justification", "correction_batch_sha256", "model_policy_digest_sha256",
  "intent_authority", "acceptance_authority", "deployment_authority", "self_acceptance",
  "status", "final_commit", "final_tree", "final_clean", "final_pushed", "repository_proof", "changed_paths",
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
  validateImplementationJustification(finalizer.change_justification, "Campaign Finalizer change scope", candidate.acceptance_contract, finalizer.scope_finding_ids, candidate);
  if (finalizer.change_justification.basis === "OBSERVED_BLOCKER") {
    assert(finalizer.scope_finding_ids.length > 0, "Finalizer blocker justification lacks finding scope");
    assert(finalizer.scope_finding_ids.every((findingId) => finalizer.change_justification.references.includes(findingId)), "Finalizer finding scope is not justified");
  }
  validatePathList(finalizer.changed_paths, "Campaign Finalizer changed paths", {allowEmpty: true});
  assert(Number.isSafeInteger(finalizer.reframe_count) && finalizer.reframe_count >= 0 && finalizer.reframe_count <= 1, "Campaign Finalizer reframe count exceeds one");
  assert(Number.isSafeInteger(finalizer.repair_pass_count) && finalizer.repair_pass_count >= 0 && finalizer.repair_pass_count <= 1, "Campaign Finalizer repair pass count exceeds one");
  assert(["ACTIVE", "COMPLETE"].includes(finalizer.status), "Campaign Finalizer status is invalid");
  if (finalizer.status === "ACTIVE" && allowActive) {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.final_clean === null && finalizer.final_pushed === null && finalizer.repository_proof === null, "active Campaign Finalizer claims a completed candidate");
    assert(finalizer.rewrite_assessment === null, "active Campaign Finalizer carries a completion assessment");
  }
  if (finalizer.status === "COMPLETE") {
    requireString(finalizer.final_commit, "Campaign Finalizer final commit");
    requireString(finalizer.final_tree, "Campaign Finalizer final tree");
    assert(finalizer.final_clean === true && finalizer.final_pushed === true, "completed Campaign Finalizer must be clean and pushed");
    validateRepositoryCheckpointProof(finalizer.repository_proof, {worktree_id: finalizer.worktree_id, commit: finalizer.final_commit, tree: finalizer.final_tree, remote_commit: finalizer.final_commit, remote_tree: finalizer.final_tree});
    assert(finalizer.rewrite_assessment !== null, "completed Campaign Finalizer lacks a rewrite assessment");
    validateFinalizerRewriteAssessment(finalizer.rewrite_assessment);
    assert(finalizer.rewrite_assessment.classification === "TARGETED_REPAIR", "Campaign Finalizer cannot close a rebuild-required pass as a repair");
    assert(canonicalJson(finalizer.change_justification.changed_paths) === canonicalJson(finalizer.changed_paths), "completed Finalizer changed paths differ from justification");
  } else {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.final_clean === null && finalizer.final_pushed === null && finalizer.repository_proof === null, "incomplete Campaign Finalizer carries final candidate identity");
    assert(finalizer.rewrite_assessment === null, "incomplete Campaign Finalizer carries a rewrite assessment");
  }
  const body = structuredClone(finalizer);
  delete body.finalizer_sha256;
  assert(finalizer.finalizer_sha256 === cascadeDigest(body), "Campaign Finalizer digest is not content-addressed");
  return finalizer;
}

export function openCampaignFinalizer({candidate, auditPlan, reconciliation, modelPolicyDigestSha256, sessionId, worktreeId, branch, scopeFindingIds = [], changeJustification, correctionBatchSha256}) {
  validateFirstPassCandidate(candidate);
  assert(candidate.terminal === true, "Campaign Finalizer requires a terminal first-pass candidate");
  validateAuditPlan(auditPlan);
  assert(auditPlan.candidate_id === candidate.candidate_id && auditPlan.candidate_commit === candidate.commit && auditPlan.candidate_tree === candidate.tree, "Campaign Finalizer audit plan candidate mismatch");
  assert(auditPlan.policy_epoch === candidate.policy_epoch && auditPlan.policy_state_sha256 === candidate.policy_snapshot_sha256 && auditPlan.acceptance_contract_sha256 === candidate.acceptance_contract_sha256, "Campaign Finalizer audit plan policy or acceptance mismatch");
  assert(canonicalJson(auditPlan.required_question_ids) === canonicalJson(candidate.acceptance_contract.required_question_ids), "Campaign Finalizer audit plan question contract mismatch");
  validateAuditReconciliation(reconciliation, auditPlan);
  assert(reconciliation.immediate_first_pass_repairs.length === 0, "critical first-pass repairs must return to the first-pass owner before finalization");
  requireSha(modelPolicyDigestSha256, "Campaign Finalizer model policy");
  requireSha(correctionBatchSha256, "Campaign Finalizer correction batch");
  validateImplementationJustification(changeJustification, "Campaign Finalizer change scope", candidate.acceptance_contract, scopeFindingIds, candidate);
  if (changeJustification.basis === "OBSERVED_BLOCKER") {
    assert(scopeFindingIds.length > 0, "Finalizer blocker justification lacks finding scope");
    assert(scopeFindingIds.every((findingId) => changeJustification.references.includes(findingId)), "Finalizer finding scope is not justified");
  }
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
    change_justification: structuredClone(changeJustification),
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
    repository_proof: null,
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

export function completeCampaignFinalizer({finalizer, candidate, finalCommit, finalTree, repositoryProof, changedPaths, repairPassCount = 0, reframeCount = 0, rewriteAssessment}) {
  validateFinalizer(finalizer, candidate);
  requireString(finalCommit, "finalizer final commit");
  requireString(finalTree, "finalizer final tree");
  validateRepositoryCheckpointProof(repositoryProof, {worktree_id: finalizer.worktree_id, commit: finalCommit, tree: finalTree, remote_commit: finalCommit, remote_tree: finalTree});
  assert(repositoryProof.clean === true && repositoryProof.pushed === true, "Campaign Finalizer completion requires a clean pushed repository proof");
  validateFinalizerRewriteAssessment(rewriteAssessment);
  assert(rewriteAssessment.classification === "TARGETED_REPAIR", "Campaign Finalizer completion requires a targeted-repair assessment");
  const completed = {
    ...structuredClone(finalizer),
    status: "COMPLETE",
    final_commit: finalCommit,
    final_tree: finalTree,
    final_clean: true,
    final_pushed: true,
    repository_proof: structuredClone(repositoryProof),
    changed_paths: validatePathList(changedPaths, "finalizer changed paths", {allowEmpty: true}),
    repair_pass_count: repairPassCount,
    reframe_count: reframeCount,
    rewrite_assessment: structuredClone(rewriteAssessment),
    finalizer_sha256: "",
  };
  if (completed.changed_paths.length > 0) {
    assert(completed.change_justification.references.length > 0, "Finalizer changed paths lack a justification reference");
  }
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
  assert(auditPlan.policy_epoch === candidate.policy_epoch && auditPlan.policy_state_sha256 === candidate.policy_snapshot_sha256 && auditPlan.acceptance_contract_sha256 === candidate.acceptance_contract_sha256, "rolling audit plan policy or acceptance mismatch");
  assert(canonicalJson(auditPlan.required_question_ids) === canonicalJson(candidate.acceptance_contract.required_question_ids), "rolling audit plan question contract mismatch");
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

const CASCADE_TRANSITION_KEYS = ["sequence", "from_state_sha256", "from_stage", "to_stage", "event_type", "payload", "at_utc", "event_sha256"];
const CASCADE_STATE_KEYS = ["schema", "governance_version", "campaign_id", "campaign_version", "mode", "stage", "logical_lineage_id", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "first_pass", "checkpoint_ledger", "rolling_audits", "holds", "audit_plan", "audit_reconciliation", "finalizer", "delta_audit", "acceptance", "model_policy", "telemetry", "loop_control", "next_campaign_ledger", "universal_closeout_receipts", "transition_journal", "cascade_sha256"];
const LOOP_KEYS = ["max_finalization_passes", "max_delta_repair_passes", "max_supervisor_reframes", "equivalent_retry_policy"];
const TELEMETRY_KEYS = ["records", "evidence_reuse_count", "escaped_finding_count", "owner_interruptions"];
const NEXT_CAMPAIGN_ENTRY_KEYS = ["entry_id", "category", "summary", "references", "status", "created_at_utc", "entry_sha256"];

function validateNextCampaignLedger(ledger) {
  assert(Array.isArray(ledger), "next-campaign ledger is required");
  const ids = new Set();
  for (const entry of ledger) {
    exactKeys(entry, NEXT_CAMPAIGN_ENTRY_KEYS, "next-campaign ledger entry");
    requireString(entry.entry_id, "next-campaign ledger entry ID");
    assert(entry.category === "ADJACENT_IMPROVEMENT", "next-campaign ledger category is invalid");
    requireString(entry.summary, "next-campaign ledger summary");
    sortedUniqueStrings(entry.references, "next-campaign ledger references");
    assert(entry.status === "DEFERRED_NEXT_CAMPAIGN", "next-campaign ledger status is invalid");
    requireUtc(entry.created_at_utc, "next-campaign ledger time");
    requireSha(entry.entry_sha256, "next-campaign ledger digest");
    assert(!ids.has(entry.entry_id), "next-campaign ledger entry IDs duplicate");
    ids.add(entry.entry_id);
    assert(entry.entry_sha256 === cascadeDigest({...entry, entry_sha256: null}), "next-campaign ledger entry is not content-addressed");
  }
  return ledger;
}

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

function validateCascadeTransitionJournal(journal, currentStage) {
  assert(Array.isArray(journal) && journal.length > 0, "cascade transition journal is required");
  for (const [index, entry] of journal.entries()) {
    exactKeys(entry, CASCADE_TRANSITION_KEYS, "cascade transition journal entry");
    assert(Number.isSafeInteger(entry.sequence) && entry.sequence === index, "cascade transition sequence is not contiguous");
    if (entry.from_state_sha256 !== null) requireSha(entry.from_state_sha256, "cascade transition parent state");
    assert(entry.from_stage === null || STAGES.has(entry.from_stage), "cascade transition source stage is invalid");
    assert(STAGES.has(entry.to_stage), "cascade transition target stage is invalid");
    requireString(entry.event_type, "cascade transition event type");
    requireRecord(entry.payload, "cascade transition payload");
    requireUtc(entry.at_utc, "cascade transition time");
    requireSha(entry.event_sha256, "cascade transition event digest");
    if (index === 0) {
      assert(entry.from_state_sha256 === null && entry.from_stage === null && entry.event_type === "GENESIS" && entry.to_stage === "FIRST_PASS_BUILDING", "cascade transition journal has invalid genesis");
    } else {
      const previous = journal[index - 1];
      assert(entry.from_state_sha256 !== null && entry.from_stage === previous.to_stage, "cascade transition journal parent is not bound to the previous stage");
    }
    assert(entry.event_sha256 === cascadeDigest({...entry, event_sha256: null}), "cascade transition event is not content-addressed");
  }
  assert(journal.at(-1).to_stage === currentStage, "cascade transition journal does not end at the current stage");
}

function sealCascadeState(state) {
  const next = structuredClone(state);
  if (!Array.isArray(next.transition_journal) || next.transition_journal.length === 0) {
    assert(next.stage === "FIRST_PASS_BUILDING", "a new cascade state must begin at FIRST_PASS_BUILDING");
    const genesis = {
      sequence: 0,
      from_state_sha256: null,
      from_stage: null,
      to_stage: next.stage,
      event_type: "GENESIS",
      payload: {campaign_id: next.campaign_id, campaign_version: next.campaign_version, logical_lineage_id: next.logical_lineage_id},
      at_utc: "1970-01-01T00:00:00.000Z",
    };
    next.transition_journal = [{...genesis, event_sha256: cascadeDigest(genesis)}];
  }
  delete next.cascade_sha256;
  next.cascade_sha256 = cascadeDigest(next);
  return validateCascadeState(next);
}

export function createCascadeState(input) {
  requireRecord(input, "campaign cascade input");
  assert(input.stage === undefined || input.stage === "FIRST_PASS_BUILDING", "cascade creation cannot skip the FIRST_PASS_BUILDING genesis");
  return sealCascadeState({
    schema: "governance.campaign_cascade_state.v1",
    governance_version: "2.1rc",
    campaign_id: input.campaign_id,
    campaign_version: input.campaign_version,
    mode: input.mode,
    stage: input.stage ?? "FIRST_PASS_BUILDING",
    logical_lineage_id: input.logical_lineage_id,
    policy_epoch: input.policy_epoch,
    policy_state_sha256: input.policy_state_sha256,
    acceptance_contract_sha256: input.acceptance_contract_sha256,
    first_pass: structuredClone(input.first_pass),
    checkpoint_ledger: structuredClone(input.checkpoint_ledger),
    rolling_audits: structuredClone(input.rolling_audits ?? []),
    holds: structuredClone(input.holds ?? []),
    audit_plan: input.audit_plan ?? null,
    audit_reconciliation: input.audit_reconciliation ?? null,
    finalizer: input.finalizer ?? null,
    delta_audit: input.delta_audit ?? null,
    acceptance: structuredClone(input.acceptance),
    model_policy: structuredClone(input.model_policy),
    telemetry: structuredClone(input.telemetry),
    loop_control: structuredClone(input.loop_control),
    next_campaign_ledger: structuredClone(input.next_campaign_ledger ?? []),
    universal_closeout_receipts: structuredClone(input.universal_closeout_receipts ?? []),
    transition_journal: [],
    cascade_sha256: "",
  });
}

export function validateCascadeState(state, options = {}) {
  assertUniversalDevelopmentMode("CASCADE");
  exactKeys(state, CASCADE_STATE_KEYS, "campaign cascade state");
  assert(state.schema === "governance.campaign_cascade_state.v1" && state.governance_version === "2.1rc", "campaign cascade identity is invalid");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) requireString(state[field], `cascade ${field}`);
  assert(Number.isSafeInteger(state.policy_epoch) && state.policy_epoch >= 1, "cascade policy epoch is invalid");
  requireSha(state.policy_state_sha256, "cascade policy snapshot");
  requireSha(state.acceptance_contract_sha256, "cascade acceptance contract");
  assert(MODES.has(state.mode) && STAGES.has(state.stage), "campaign cascade mode or stage is invalid");
  validateCascadeTransitionJournal(state.transition_journal, state.stage);
  validateFirstPassCandidate(state.first_pass);
  assert(state.first_pass.campaign_id === state.campaign_id && state.first_pass.campaign_version === state.campaign_version && state.first_pass.logical_lineage_id === state.logical_lineage_id, "cascade first-pass lineage mismatch");
  assert(state.first_pass.policy_epoch === state.policy_epoch && state.first_pass.policy_snapshot_sha256 === state.policy_state_sha256 && state.first_pass.acceptance_contract_sha256 === state.acceptance_contract_sha256, "cascade policy or acceptance binding differs from first-pass candidate");
  validateCheckpointAuditLedger(state.checkpoint_ledger, state.first_pass);
  validateNextCampaignLedger(state.next_campaign_ledger);
  validateUniversalTaskCloseoutForMode("CASCADE", state.universal_closeout_receipts, {
    closed: state.stage === "READY_FOR_ACCEPTANCE",
    label: "campaign cascade universal closeout receipts",
  });
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
    exactKeys(hold, ["hold_id", "kind", "scope", "affected_outcome_ids", "blocked_stages", "authority_boundary", "resume_condition", "resume_condition_sha256", "safe_alternatives_evidence_sha256", "owner_role_id", "created_at_utc"], "cascade hold");
    requireString(hold.hold_id, "cascade hold ID");
    assert(HOLD_KINDS.has(hold.kind), "cascade hold kind is invalid");
    for (const field of ["scope", "authority_boundary", "resume_condition", "owner_role_id", "created_at_utc"]) requireString(hold[field], `cascade hold ${field}`);
    sortedUniqueStrings(hold.affected_outcome_ids, "cascade hold affected outcomes");
    sortedUniqueStrings(hold.blocked_stages, "cascade hold blocked stages");
    assert(hold.blocked_stages.every((stage) => STAGES.has(stage)), "cascade hold blocked stage is invalid");
    requireSha(hold.resume_condition_sha256, "cascade hold resume condition");
    assert(hold.resume_condition_sha256 === cascadeDigest({condition: hold.resume_condition}), "cascade hold resume condition digest mismatch");
    requireSha(hold.safe_alternatives_evidence_sha256, "cascade hold safe alternatives evidence");
    assert(!holdIds.has(hold.hold_id), "cascade hold IDs duplicate");
    holdIds.add(hold.hold_id);
  }
  if (state.audit_plan !== null) validateAuditPlan(state.audit_plan);
  if (state.audit_plan !== null) assert(state.audit_plan.auditor_session_id === state.first_pass.auditor_session_id, "cascade audit plan Auditor differs from the active checkpoint Auditor");
  if (state.audit_plan !== null) {
    assert(state.audit_plan.policy_epoch === state.policy_epoch && state.audit_plan.policy_state_sha256 === state.policy_state_sha256 && state.audit_plan.acceptance_contract_sha256 === state.acceptance_contract_sha256, "cascade audit plan policy or acceptance mismatch");
    assert(canonicalJson(state.audit_plan.required_question_ids) === canonicalJson(state.first_pass.acceptance_contract.required_question_ids), "cascade audit plan question contract mismatch");
  }
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
    assert(state.universal_closeout_receipts.length > 0, "ready cascade lacks universal temporary-task closeout");
    assert(options.productAcceptance !== undefined && options.productAcceptanceProof !== undefined, "ready cascade requires the executable Product acceptance proof");
    verifyProductAcceptanceProof(options.productAcceptance, options.productAcceptanceProof, state.campaign_id);
    assert(state.acceptance.product_acceptance_sha256 === cascadeDigest(options.productAcceptance), "ready cascade Product acceptance digest mismatch");
    assert(options.productAcceptance.final_candidate_commit === finalCommit && options.productAcceptance.final_candidate_tree === finalTree, "ready cascade Product acceptance candidate mismatch");
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

export function compileCascadeUniversalTaskCloseoutReceipts({receiptRefs, observedAt, label = "campaign cascade universal closeout receipts"} = {}) {
  return compileUniversalTaskCloseoutReceipts({
    mode: "CASCADE",
    receiptRefs,
    observedAt,
    label,
  });
}

export function validateAcceptedLiveCascadeBinding({cascade, acceptedLive, productAcceptance, productAcceptanceProof}) {
  validateCascadeState(cascade, {productAcceptance, productAcceptanceProof});
  exactKeys(acceptedLive, ["status", "final_candidate_commit", "final_candidate_tree", "product_acceptance_sha256", "deployed_identity", "rollback_identity", "independent_audit_identity", "deployment_receipt_sha256", "independent_audit_receipt_sha256", "closure_receipt_sha256", "deployment_receipt", "independent_audit_receipt", "closure_receipt", "cascade_state_sha256"], "accepted-live cascade binding");
  assert(acceptedLive.status === "VERIFIED", "accepted-live cascade binding requires VERIFIED status");
  requireSha(acceptedLive.product_acceptance_sha256, "accepted-live Product acceptance");
  for (const field of ["final_candidate_commit", "final_candidate_tree", "deployed_identity", "rollback_identity", "independent_audit_identity"]) requireString(acceptedLive[field], `accepted-live ${field}`);
  for (const field of ["deployment_receipt_sha256", "independent_audit_receipt_sha256", "closure_receipt_sha256", "cascade_state_sha256"]) requireSha(acceptedLive[field], `accepted-live ${field}`);
  validateDeploymentReceipt(acceptedLive.deployment_receipt);
  validateLiveAuditReceipt(acceptedLive.independent_audit_receipt);
  validateClosureReceipt(acceptedLive.closure_receipt);
  assert(acceptedLive.deployment_receipt.receipt_sha256 === acceptedLive.deployment_receipt_sha256, "accepted-live deployment receipt digest mismatch");
  assert(acceptedLive.independent_audit_receipt.audit_receipt_sha256 === acceptedLive.independent_audit_receipt_sha256, "accepted-live live audit receipt digest mismatch");
  assert(acceptedLive.closure_receipt.closure_receipt_sha256 === acceptedLive.closure_receipt_sha256, "accepted-live closure receipt digest mismatch");
  assert(acceptedLive.cascade_state_sha256 === cascade.cascade_sha256, "accepted-live closure does not bind exact cascade state");
  assert(cascade.stage === "READY_FOR_ACCEPTANCE", "accepted-live closure consumes a cascade that is not ready");
  assert(cascade.acceptance.product_acceptance_sha256 === cascadeDigest(productAcceptance), "accepted-live cascade/Product proof mismatch");
  assert(acceptedLive.product_acceptance_sha256 === cascade.acceptance.product_acceptance_sha256, "accepted-live closure does not bind Product acceptance");
  assert(cascade.acceptance.rc_ready === true && productAcceptance.rc_ready === true, "accepted-live closure lacks exact three-root acceptance");
  assert(acceptedLive.final_candidate_commit === cascade.acceptance.final_candidate_commit && acceptedLive.final_candidate_tree === cascade.acceptance.final_candidate_tree, "accepted-live closure candidate does not match Product acceptance");
  assert(acceptedLive.deployment_receipt.final_candidate_commit === acceptedLive.final_candidate_commit && acceptedLive.deployment_receipt.final_candidate_tree === acceptedLive.final_candidate_tree, "accepted-live deployment receipt candidate mismatch");
  assert(acceptedLive.independent_audit_receipt.final_candidate_commit === acceptedLive.final_candidate_commit && acceptedLive.independent_audit_receipt.final_candidate_tree === acceptedLive.final_candidate_tree, "accepted-live audit receipt candidate mismatch");
  assert(acceptedLive.deployment_receipt.deployed_identity === acceptedLive.deployed_identity && acceptedLive.deployment_receipt.rollback_identity === acceptedLive.rollback_identity, "accepted-live deployment identities are not receipt-bound");
  assert(acceptedLive.independent_audit_receipt.deployed_identity === acceptedLive.deployed_identity && acceptedLive.independent_audit_receipt.independent_audit_identity === acceptedLive.independent_audit_identity, "accepted-live audit identity is not receipt-bound");
  assert(acceptedLive.closure_receipt.deployment_receipt.receipt_sha256 === acceptedLive.deployment_receipt_sha256 && acceptedLive.closure_receipt.live_audit_receipt.audit_receipt_sha256 === acceptedLive.independent_audit_receipt_sha256, "accepted-live closure receipt is not bound to the exact receipts");
  assert(acceptedLive.closure_receipt_sha256 === cascadeDigest({...acceptedLive, closure_receipt_sha256: null}), "accepted-live closure receipt is not bound to its exact identities");
  return true;
}

export function applyCascadeTransition(previous, next, event = {}) {
  validateCascadeState(previous);
  validateCascadeState(next, event.productAcceptance === undefined ? {} : {productAcceptance: event.productAcceptance, productAcceptanceProof: event.productAcceptanceProof});
  assert(previous.campaign_id === next.campaign_id && previous.campaign_version === next.campaign_version && previous.logical_lineage_id === next.logical_lineage_id, "cascade transition changed campaign lineage");
  assert(previous.policy_epoch === next.policy_epoch && previous.policy_state_sha256 === next.policy_state_sha256 && previous.acceptance_contract_sha256 === next.acceptance_contract_sha256, "cascade transition changed policy or acceptance without a new admitted campaign");
  assert(next.next_campaign_ledger.length >= previous.next_campaign_ledger.length, "cascade transition removed next-campaign ledger entries");
  assert(canonicalJson(next.next_campaign_ledger.slice(0, previous.next_campaign_ledger.length)) === canonicalJson(previous.next_campaign_ledger), "cascade transition rewrote next-campaign ledger history");
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
  for (const hold of previous.holds) {
    assert(!hold.blocked_stages.includes(next.stage), `cascade transition enters a stage blocked by hold ${hold.hold_id}`);
    if (event.payload?.outcome_id !== undefined) assert(!hold.affected_outcome_ids.includes(event.payload.outcome_id), `cascade transition advances an outcome blocked by hold ${hold.hold_id}`);
  }
  if (previous.stage === "FIRST_PASS_REPAIR_REQUIRED" && next.stage === "FIRST_PASS_BUILDING") {
    assert(next.first_pass.candidate_id !== previous.first_pass.candidate_id, "first-pass repair rewrote the same candidate identity");
  } else if (previous.first_pass.terminal) {
    assert(next.first_pass.commit === previous.first_pass.commit && next.first_pass.tree === previous.first_pass.tree, "cascade transition rewrote terminal first-pass candidate");
  }
  if (next.finalizer !== null && next.first_pass.terminal) assert(next.finalizer.source_commit === next.first_pass.commit && next.finalizer.source_tree === next.first_pass.tree, "cascade finalizer detached from first-pass candidate");
  assert(canonicalJson(next.transition_journal) === canonicalJson(previous.transition_journal), "cascade transition must append to the current journal");
  const eventBody = {
    sequence: next.transition_journal.length,
    from_state_sha256: previous.cascade_sha256,
    from_stage: previous.stage,
    to_stage: next.stage,
    event_type: event.type ?? "CASCADE_TRANSITION",
    payload: structuredClone(event.payload ?? {}),
    at_utc: event.at_utc ?? new Date().toISOString(),
  };
  requireString(eventBody.event_type, "cascade transition event type");
  requireUtc(eventBody.at_utc, "cascade transition event time");
  next.transition_journal.push({...eventBody, event_sha256: cascadeDigest({...eventBody, event_sha256: null})});
  return sealCascadeState(next);
}

export function clearCascadeHold(state, holdId, resolution) {
  validateCascadeState(state);
  requireString(holdId, "cascade hold ID");
  exactKeys(resolution, ["condition_sha256", "affected_outcome_ids", "evidence_sha256", "resolved_at_utc"], "cascade hold resolution");
  requireSha(resolution.condition_sha256, "cascade hold resolution condition");
  sortedUniqueStrings(resolution.affected_outcome_ids, "cascade hold resolution outcomes");
  requireSha(resolution.evidence_sha256, "cascade hold resolution evidence");
  requireUtc(resolution.resolved_at_utc, "cascade hold resolution time");
  const hold = state.holds.find((item) => item.hold_id === holdId);
  assert(hold !== undefined, "cascade hold is not active");
  assert(resolution.condition_sha256 === hold.resume_condition_sha256, "cascade hold resolution does not satisfy the recorded condition");
  assert(canonicalJson(resolution.affected_outcome_ids) === canonicalJson(hold.affected_outcome_ids), "cascade hold resolution scope differs");
  assert(resolution.evidence_sha256 === cascadeDigest({...resolution, evidence_sha256: null}), "cascade hold resolution is not content-addressed");
  const next = structuredClone(state);
  next.holds = next.holds.filter((item) => item.hold_id !== holdId);
  delete next.cascade_sha256;
  next.cascade_sha256 = cascadeDigest(next);
  return applyCascadeTransition(state, next, {
    type: "HOLD_CLEARED",
    at_utc: resolution.resolved_at_utc,
    payload: {
      hold_id: holdId,
      condition_sha256: resolution.condition_sha256,
      resolution_evidence_sha256: resolution.evidence_sha256,
    },
  });
}

export function recordNextCampaignLedgerItem(state, {entryId, summary, references, createdAtUtc}) {
  validateCascadeState(state);
  requireString(entryId, "next-campaign ledger entry ID");
  requireString(summary, "next-campaign ledger summary");
  sortedUniqueStrings(references, "next-campaign ledger references");
  requireUtc(createdAtUtc, "next-campaign ledger time");
  assert(!state.next_campaign_ledger.some((entry) => entry.entry_id === entryId), "next-campaign ledger entry already exists");
  const entry = {
    entry_id: entryId,
    category: "ADJACENT_IMPROVEMENT",
    summary,
    references: [...references].sort(compareUtf8),
    status: "DEFERRED_NEXT_CAMPAIGN",
    created_at_utc: createdAtUtc,
    entry_sha256: null,
  };
  entry.entry_sha256 = cascadeDigest({...entry, entry_sha256: null});
  const next = structuredClone(state);
  next.next_campaign_ledger.push(entry);
  const body = structuredClone(next);
  delete body.cascade_sha256;
  next.cascade_sha256 = cascadeDigest(body);
  return validateCascadeState(next);
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
