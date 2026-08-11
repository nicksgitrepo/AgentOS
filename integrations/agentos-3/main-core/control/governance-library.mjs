#!/usr/bin/env node
import crypto from "node:crypto";
import {TASK_GATE_QUESTIONS, TASK_GATE_CATALOG_SHA256} from "./task-gate-questions.mjs";
import {findPrivateContextLeaks} from "./private-context-detector.mjs";
import * as universalGovernance from "./governance-universal.mjs";
export * from "./governance-universal.mjs";
export {
  assertFeatureLaneGoalBinding,
  compileFeatureLaneGoal,
  FEATURE_LANE_GOAL_OBJECTIVE,
  FEATURE_LANE_GOAL_SCHEMA,
  FEATURE_LANE_GOAL_STATES,
  validateFeatureLaneGoal,
} from "./feature-lane-goal.mjs";
export const GENERAL_GOVERNANCE_SCHEMA = "agentos.general_governance_library.v1";
export const GENERAL_LIBRARY_KIND = "SHARED_GENERAL_GOVERNANCE";
export const GENERAL_GOVERNANCE_DOMAINS = Object.freeze([
  "INTENT_SCOPE",
  "SOURCE_BINDING",
  "CONVERSATION",
  "ROLE_ROUTING",
  "PROGRESS_HEALTH",
  "FUNCTIONAL_ACCEPTANCE",
  "EVIDENCE_IDENTITY",
  "RESPONSE_HANDOFF_GATING",
  "SECURITY_PRIVACY",
  "RECOVERY_BOUNDARIES",
  "DELIVERY_CLOSURE",
]);
const {
  GOVERNANCE_ARCHITECTURE_PLAN_SCHEMA, GOVERNANCE_ARCHITECTURE_PLAN_KIND, GOVERNANCE_TREE_ROOTS, ARCHITECTURE_ACCEPTANCE_REQUIREMENTS,
  UNIVERSAL_TASK_CLOSEOUT_SEQUENCE, UNIVERSAL_TASK_CLOSEOUT_EVIDENCE, UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA,
  UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES, UNIVERSAL_TASK_CLOSEOUT_MODES, UNIVERSAL_DEVELOPMENT_MODES,
  UNIVERSAL_RESPONSE_GATING_POLICY, UNIVERSAL_TASK_CLOSEOUT_APPLICABILITY,
  universalTaskCloseoutPolicy, validateUniversalTaskCloseoutReceipts, compileUniversalTaskCloseoutReceipts,
  assertUniversalTaskCloseoutMode, assertUniversalResponseGatingMode, assertUniversalDevelopmentMode,
  validateUniversalTaskCloseoutForMode,
} = universalGovernance;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const TASK_GATE_IDS = new Set(TASK_GATE_QUESTIONS.map((question) => question.question_id));
const DEFAULT_CLAUSES = Object.freeze([
  {
    clause_id: "GENERAL_INTENT_SCOPE",
    domain: "INTENT_SCOPE",
    rule: "Bind every action to explicit intent and declared scope.",
    required_evidence: ["INTENT_RECORD", "SCOPE_RECORD"],
    gate_question_ids: ["TASK-CHANGE-008", "TASK-CHANGE-009", "TASK-START-001", "TASK-START-007"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"],
    hard_stop: "CHANGED_INTENT_OR_SCOPE",
  },
  {
    clause_id: "GENERAL_SOURCE_BINDING",
    domain: "SOURCE_BINDING",
    rule: "Read back the exact source before mutation and reject a changed source.",
    required_evidence: ["SOURCE_COMMIT", "SOURCE_READBACK", "SOURCE_TREE"],
    gate_question_ids: ["TASK-PROOF-012", "TASK-START-003", "TASK-START-004"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE"],
    hard_stop: "MISSING_OR_MISMATCHED_SOURCE",
  },
  {
    clause_id: "GENERAL_CONVERSATION",
    domain: "CONVERSATION",
    rule: "Use plain language and ask at most one material owner question when discovery cannot decide safely.",
    required_evidence: ["CONVERSATION_BOUNDARY", "OWNER_QUESTION_OR_DEFAULT"],
    gate_question_ids: ["TASK-START-001", "TASK-START-002"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"],
    hard_stop: "UNRESOLVED_OWNER_INTENT_CONTRADICTION",
  },
  {
    clause_id: "GENERAL_ROLE_ROUTING",
    domain: "ROLE_ROUTING",
    rule: "Route work only to named, admitted, independently checkable roles.",
    required_evidence: ["ROLE_ADMISSION", "ROLE_IDENTITY_READBACK"],
    gate_question_ids: ["TASK-ACCEPTANCE-014", "TASK-START-002"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE"],
    hard_stop: "UNVERIFIED_OR_UNADMITTED_ROLE",
  },
  {
    clause_id: "GENERAL_PROGRESS_HEALTH",
    domain: "PROGRESS_HEALTH",
    rule: "Separate meaningful progress from liveness and bound waits without claiming success.",
    required_evidence: ["BOUNDED_CHECK_RESULT", "PROGRESS_RECEIPT"],
    gate_question_ids: ["TASK-PROGRESS-013"],
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"],
    hard_stop: "FALSE_SUCCESS_OR_UNBOUNDED_WAIT",
  },
  {
    clause_id: "GENERAL_FUNCTIONAL_ACCEPTANCE",
    domain: "FUNCTIONAL_ACCEPTANCE",
    rule: "Accept only a real behavior with focused checks and an independent result.",
    required_evidence: ["BEHAVIOR_RESULT", "FOCUSED_CHECK", "INDEPENDENT_CHECK"],
    gate_question_ids: ["TASK-PROOF-010", "TASK-PROOF-011", "TASK-START-005", "TASK-START-006"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"],
    hard_stop: "DOCUMENTATION_ONLY_OR_SELF_ACCEPTANCE",
  },
  {
    clause_id: "GENERAL_EVIDENCE_IDENTITY",
    domain: "EVIDENCE_IDENTITY",
    rule: "Bind each result and handoff to its source, role, scope, check, and digest.",
    required_evidence: ["DIGEST", "HANDOFF_RECEIPT", "ROLE_RECEIPT", "SOURCE_RECEIPT"],
    gate_question_ids: ["TASK-PROOF-012", "TASK-START-004"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE"],
    hard_stop: "MISSING_OR_FALSE_EVIDENCE_IDENTITY",
  },
  {
    clause_id: "GENERAL_SECURITY_PRIVACY",
    domain: "SECURITY_PRIVACY",
    rule: "Keep portable public payloads secret-free and provider-neutral.",
    required_evidence: ["PORTABILITY_SCAN", "SECRET_SCAN"],
    gate_question_ids: ["TASK-CHANGE-009", "TASK-START-003"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE"],
    hard_stop: "SECRET_OR_PRIVATE_CONTEXT_LEAK",
  },
  {
    clause_id: "GENERAL_RESPONSE_HANDOFF_GATING",
    domain: "RESPONSE_HANDOFF_GATING",
    rule: "Evaluate every progress statement, document, response, typed handoff, and closure claim through the applicable named catalog graph before disclosure or continuation.",
    required_evidence: ["NAMED_GATE_GRAPH", "RESPONSE_ENVELOPE", "INDEPENDENT_CHECK", "PUBLIC_SAFE_TEXT"].sort(),
    gate_question_ids: ["TASK-ACCEPTANCE-014", "TASK-CLOSURE-015", "TASK-PROOF-010", "TASK-PROOF-011", "TASK-PROOF-012"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"].sort(),
    hard_stop: "UNPROVEN_RESPONSE_OR_HANDOFF",
  },
  {
    clause_id: "GENERAL_RECOVERY_BOUNDARIES",
    domain: "RECOVERY_BOUNDARIES",
    rule: "Classify puzzles, soft reviews, and hard stops, and mint a fresh source-bound goal after changed conditions.",
    required_evidence: ["DECISION_CLASS", "RECOVERY_OR_SUCCESSOR_RECORD"],
    gate_question_ids: ["TASK-CHANGE-008", "TASK-CHANGE-009", "TASK-START-006", "TASK-START-007"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE", "SOFT_REVIEW"],
    hard_stop: "CHANGED_CONDITION_OR_UNSAFE_RECOVERY",
  },
  {
    clause_id: "GENERAL_DELIVERY_CLOSURE",
    domain: "DELIVERY_CLOSURE",
    rule: "Every development mode must use the universal closeout sequence PRESERVE_HANDOFF -> PERSIST_HANDOFF -> AUDIT_CANDIDATE -> INTEGRATE_ACCEPTED_WORK -> UNPIN_SESSION -> CLOSE_STALE_WORKTREE -> REMOVE_ACTIVE_TASK_SCOPE -> MARK_CHAT_OUT_OF_SCOPE -> ARCHIVE_VISIBLE_TASK before the Controller continues, and every visible lane must carry a persistent controller-owned goal with a terminal state readback at closeout.",
    required_evidence: [...UNIVERSAL_TASK_CLOSEOUT_EVIDENCE, "GOAL_STATE_READBACK", "PERSISTENT_LANE_GOAL"].sort(),
    gate_question_ids: ["TASK-ACCEPTANCE-014", "TASK-CLOSURE-015"].sort(),
    decision_classes: ["HARD_STOP", "PUZZLE"],
    hard_stop: "UNABLE_TO_CLOSE_TEMPORARY_WORK",
  },
]);
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}
function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}
function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort((a, b) => Buffer.from(a).compare(Buffer.from(b))).map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}
function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return sha256(body);
}
function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const expected = [...keys].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}
function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  const sorted = [...value].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  assert(new Set(sorted).size === sorted.length && JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return value;
}
function assertPortable(value, label) {
  const text = JSON.stringify(value);
  assert(findPrivateContextLeaks(text).length === 0, `${label} contains private or provider-bound content`);
}
function validateClause(clause, index) {
  exactKeys(clause, ["clause_id", "domain", "rule", "required_evidence", "gate_question_ids", "decision_classes", "hard_stop"], `general clause ${index}`);
  requireIdentifier(clause.clause_id, `general clause ${index} ID`);
  assert(GENERAL_GOVERNANCE_DOMAINS.includes(clause.domain), `general clause ${clause.clause_id} domain is invalid`);
  requireString(clause.rule, `general clause ${clause.clause_id} rule`);
  sortedUniqueStrings(clause.required_evidence, `general clause ${clause.clause_id} evidence`);
  sortedUniqueStrings(clause.gate_question_ids, `general clause ${clause.clause_id} gate questions`);
  clause.gate_question_ids.forEach((questionId) => assert(TASK_GATE_IDS.has(questionId), `general clause ${clause.clause_id} selects an unknown task gate question: ${questionId}`));
  sortedUniqueStrings(clause.decision_classes, `general clause ${clause.clause_id} decisions`);
  requireIdentifier(clause.hard_stop, `general clause ${clause.clause_id} hard stop`);
}
export function validateGeneralGovernanceLibrary(library) {
  exactKeys(library, ["schema", "version", "library_kind", "source_commit", "source_tree", "bootstrap_plan_sha256", "task_gate_catalog_sha256", "required_domains", "universal_closeout", "response_handoff_gating", "clauses", "digest"]);
  assert(library.schema === GENERAL_GOVERNANCE_SCHEMA && library.version === 1, "general governance library identity is invalid");
  assert(library.library_kind === GENERAL_LIBRARY_KIND, "general governance library kind is invalid");
  requireString(library.source_commit, "general governance source commit");
  requireString(library.source_tree, "general governance source tree");
  requireSha(library.bootstrap_plan_sha256, "general governance Bootstrap plan digest");
  requireSha(library.task_gate_catalog_sha256, "general governance task-gate catalog digest");
  assert(library.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "general governance task-gate catalog binding differs");
  assert(JSON.stringify(library.required_domains) === JSON.stringify(GENERAL_GOVERNANCE_DOMAINS), "general governance domains are incomplete or reordered");
  const universalCloseout = library.universal_closeout;
  exactKeys(universalCloseout, ["mode", "applies_to", "receipt_schema", "receipt_compiler", "receipt_authorities", "sequence", "required_evidence", "controller_must_wait_for_integration", "archive_is_dynamic", "archive_requires_chat_out_of_scope", "archive_requires_active_scope_removal", "archive_requires_stale_worktree_closed", "archive_preconditions"], "general governance universal closeout");
  assert(universalCloseout.mode === "ALL_DEVELOPMENT_MODES", "general governance universal closeout must apply to every development mode");
  assert(JSON.stringify(universalCloseout.applies_to) === JSON.stringify(UNIVERSAL_TASK_CLOSEOUT_APPLICABILITY), "general governance universal closeout mode coverage is incomplete or reordered");
  assert(universalCloseout.receipt_schema === UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA, "general governance universal closeout receipt schema is invalid");
  assert(universalCloseout.receipt_compiler === "compileUniversalTaskCloseoutReceipts", "general governance universal closeout compiler is invalid");
  assert(JSON.stringify(universalCloseout.receipt_authorities) === JSON.stringify(UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES), "general governance universal closeout authorities are incomplete or reordered");
  assert(JSON.stringify(universalCloseout.sequence) === JSON.stringify(UNIVERSAL_TASK_CLOSEOUT_SEQUENCE), "general governance universal closeout sequence is incomplete or reordered");
  assert(JSON.stringify(universalCloseout.required_evidence) === JSON.stringify(UNIVERSAL_TASK_CLOSEOUT_EVIDENCE), "general governance universal closeout evidence is incomplete or reordered");
  assert(universalCloseout.controller_must_wait_for_integration === true, "Controller must wait for audited worktree integration before archive");
  assert(universalCloseout.archive_is_dynamic === true, "general governance archive must be dynamic");
  assert(universalCloseout.archive_requires_chat_out_of_scope === true, "general governance archive lacks the chat-out-of-scope precondition");
  assert(universalCloseout.archive_requires_active_scope_removal === true, "general governance archive lacks active-scope removal precondition");
  assert(universalCloseout.archive_requires_stale_worktree_closed === true, "general governance archive lacks stale-worktree closure precondition");
  assert(JSON.stringify(universalCloseout.archive_preconditions) === JSON.stringify([
    "HANDOFF_PRESERVED",
    "HANDOFF_PERSISTED",
    "CANDIDATE_INDEPENDENTLY_AUDITED",
    "WORKTREE_INTEGRATED",
    "STALE_WORKTREE_CLOSED",
    "ACTIVE_TASK_SCOPE_REMOVED",
    "CHAT_OUT_OF_SCOPE",
  ]), "general governance archive preconditions are incomplete or reordered");
  const responseGating = library.response_handoff_gating;
  exactKeys(responseGating, ["controller", "contract", "catalog_source", "catalog_compiler", "applies_to_modes", "applies_to", "complete_requires", "unknown_behavior", "not_applicable_behavior", "public_payload"], "general governance response handoff gating");
  assert(responseGating.controller === UNIVERSAL_RESPONSE_GATING_POLICY.controller && responseGating.contract === UNIVERSAL_RESPONSE_GATING_POLICY.contract, "general governance response boundary is not bound to the canonical controller and contract");
  assert(responseGating.catalog_source === UNIVERSAL_RESPONSE_GATING_POLICY.catalog_source && responseGating.catalog_compiler === UNIVERSAL_RESPONSE_GATING_POLICY.catalog_compiler, "general governance response catalog binding is incomplete");
  assert(JSON.stringify(responseGating.applies_to_modes) === JSON.stringify(UNIVERSAL_RESPONSE_GATING_POLICY.applies_to_modes), "general governance response mode coverage is incomplete or reordered");
  assert(JSON.stringify(responseGating.applies_to_modes.slice(0, -1)) === JSON.stringify(UNIVERSAL_DEVELOPMENT_MODES), "general governance response mode coverage is not derived from the universal development modes");
  assert(JSON.stringify(responseGating.applies_to) === JSON.stringify(UNIVERSAL_RESPONSE_GATING_POLICY.applies_to), "general governance response context coverage is incomplete or reordered");
  assert(JSON.stringify(responseGating.complete_requires) === JSON.stringify(UNIVERSAL_RESPONSE_GATING_POLICY.complete_requires), "general governance response completion requirements are incomplete or reordered");
  assert(responseGating.unknown_behavior === "NEVER_PASSES" && responseGating.not_applicable_behavior === "REQUIRES_APPLICABILITY_JUSTIFICATION", "general governance response answer safety is weakened");
  assert(responseGating.public_payload === "SECRET_FREE_PROJECT_AGNOSTIC", "general governance response payload boundary is invalid");
  assert(Array.isArray(library.clauses) && library.clauses.length === GENERAL_GOVERNANCE_DOMAINS.length, "general governance clauses are incomplete");
  const ids = new Set();
  const domains = new Set();
  library.clauses.forEach((clause, index) => {
    validateClause(clause, index);
    assert(!ids.has(clause.clause_id), `duplicate general clause ${clause.clause_id}`);
    ids.add(clause.clause_id);
    domains.add(clause.domain);
  });
  assert(JSON.stringify(library.clauses.map((clause) => clause.clause_id)) === JSON.stringify([...ids].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))), "general clauses must be sorted by ID");
  assert(GENERAL_GOVERNANCE_DOMAINS.every((domain) => domains.has(domain)), "general governance domain is missing");
  const closeoutClause = library.clauses.find((clause) => clause.clause_id === "GENERAL_DELIVERY_CLOSURE");
  assert(closeoutClause !== undefined, "general governance universal closeout clause is missing");
  for (const step of UNIVERSAL_TASK_CLOSEOUT_SEQUENCE) assert(closeoutClause.rule.includes(step), `general governance closeout sequence is missing ${step}`);
  for (const evidence of UNIVERSAL_TASK_CLOSEOUT_EVIDENCE) assert(closeoutClause.required_evidence.includes(evidence), `general governance closeout evidence is missing ${evidence}`);
  assert(closeoutClause.required_evidence.includes("PERSISTENT_LANE_GOAL") && closeoutClause.required_evidence.includes("GOAL_STATE_READBACK"), "general governance closeout goal evidence is incomplete");
  requireSha(library.digest, "general governance library digest");
  assert(library.digest === digestWithout(library, "digest"), "general governance library digest mismatch");
  assertPortable(library, "general governance library");
  return library;
}
export function compileGeneralGovernanceLibrary({sourceCommit, sourceTree, bootstrapPlanSha256, clauses = DEFAULT_CLAUSES} = {}) {
  requireString(sourceCommit, "general governance source commit");
  requireString(sourceTree, "general governance source tree");
  requireSha(bootstrapPlanSha256, "general governance Bootstrap plan digest");
  assert(Array.isArray(clauses), "general governance clauses must be an array");
  const sortedClauses = structuredClone(clauses).sort((a, b) => Buffer.from(a.clause_id ?? "").compare(Buffer.from(b.clause_id ?? "")));
  const library = {
    schema: GENERAL_GOVERNANCE_SCHEMA,
    version: 1,
    library_kind: GENERAL_LIBRARY_KIND,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    bootstrap_plan_sha256: bootstrapPlanSha256,
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    required_domains: [...GENERAL_GOVERNANCE_DOMAINS],
    universal_closeout: universalTaskCloseoutPolicy(),
    response_handoff_gating: structuredClone(UNIVERSAL_RESPONSE_GATING_POLICY),
    clauses: sortedClauses,
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateGeneralGovernanceLibrary(library);
}
export function compileGovernanceArchitecturePlan({questionRoots = GOVERNANCE_TREE_ROOTS, acceptanceRequirements = ARCHITECTURE_ACCEPTANCE_REQUIREMENTS} = {}) {
  assert(JSON.stringify(questionRoots) === JSON.stringify(GOVERNANCE_TREE_ROOTS), "governance architecture roots must use the canonical question tree roots");
  assert(JSON.stringify(acceptanceRequirements) === JSON.stringify(ARCHITECTURE_ACCEPTANCE_REQUIREMENTS), "governance architecture acceptance requirements are incomplete or reordered");
  const plan = {
    schema: GOVERNANCE_ARCHITECTURE_PLAN_SCHEMA,
    version: 1,
    repair_kind: GOVERNANCE_ARCHITECTURE_PLAN_KIND,
    shared_general_library_required: true,
    generated_role_specific_library_required: true,
    generation_source: "GENERAL_LIBRARY_PLUS_ROLE_DEFINITION_SOURCE_PLUS_COMPILED_QUESTION_TREE",
    role_definition_source: "control/governance-role-definitions.mjs",
    role_catalog_rule: "COMPILE_FROM_GENERAL_LIBRARY_ROLE_DEFINITION_SOURCE_AND_COMPILED_QUESTION_TREE",
    question_tree_roots: [...GOVERNANCE_TREE_ROOTS],
    controller_gate: "REPAIR_CAMPAIGN_ARCHITECTURE_ADMISSION",
    acceptance_requirements: [...ARCHITECTURE_ACCEPTANCE_REQUIREMENTS],
    excluded_admission_roles: ["FEATURE_AGENT", "GENERIC_FEATURE_AGENT", "RECURSIVE_CHILD", "SHELL_STAND_IN"],
    digest: null,
  };
  plan.digest = digestWithout(plan, "digest");
  return validateGovernanceArchitecturePlan(plan);
}
export function validateGovernanceArchitecturePlan(plan) {
  exactKeys(plan, ["schema", "version", "repair_kind", "shared_general_library_required", "generated_role_specific_library_required", "generation_source", "role_definition_source", "role_catalog_rule", "question_tree_roots", "controller_gate", "acceptance_requirements", "excluded_admission_roles", "digest"]);
  assert(plan.schema === GOVERNANCE_ARCHITECTURE_PLAN_SCHEMA && plan.version === 1, "governance architecture plan identity is invalid");
  assert(plan.repair_kind === GOVERNANCE_ARCHITECTURE_PLAN_KIND, "governance architecture repair kind is invalid");
  assert(plan.shared_general_library_required === true && plan.generated_role_specific_library_required === true, "governance architecture requires both libraries");
  assert(plan.generation_source === "GENERAL_LIBRARY_PLUS_ROLE_DEFINITION_SOURCE_PLUS_COMPILED_QUESTION_TREE", "governance architecture generation source is invalid");
  assert(plan.role_definition_source === "control/governance-role-definitions.mjs", "governance architecture role-definition source is invalid");
  assert(plan.role_catalog_rule === "COMPILE_FROM_GENERAL_LIBRARY_ROLE_DEFINITION_SOURCE_AND_COMPILED_QUESTION_TREE", "governance architecture role-catalog rule is invalid");
  assert(JSON.stringify(plan.question_tree_roots) === JSON.stringify(GOVERNANCE_TREE_ROOTS), "governance architecture question roots are invalid");
  assert(plan.controller_gate === "REPAIR_CAMPAIGN_ARCHITECTURE_ADMISSION", "governance architecture controller gate is invalid");
  assert(JSON.stringify(plan.acceptance_requirements) === JSON.stringify(ARCHITECTURE_ACCEPTANCE_REQUIREMENTS), "governance architecture acceptance requirements are invalid");
  sortedUniqueStrings(plan.excluded_admission_roles, "governance architecture excluded roles");
  requireSha(plan.digest, "governance architecture plan digest");
  assert(plan.digest === digestWithout(plan, "digest"), "governance architecture plan digest mismatch");
  assertPortable(plan, "governance architecture plan");
  return plan;
}
export function defaultGeneralGovernanceClauses() {
  return structuredClone(DEFAULT_CLAUSES);
}
