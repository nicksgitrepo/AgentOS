#!/usr/bin/env node

import crypto from "node:crypto";

export const AUDIT_FIRST_IMPORT_PROCEDURE_SCHEMA = "agentos.audit_first_import_procedure.v1";
export const APPLICABILITY_OUTCOMES = Object.freeze([
  "PENDING_APPLICABILITY",
  "APPLICABLE",
  "NOT_APPLICABLE_WITH_EVIDENCE",
  "UNKNOWN_BLOCKED",
  "SUPERSEDED",
]);
export const REQUIREMENT_STATUSES = Object.freeze([
  "OPEN",
  "REPAIRED_PENDING_AUDIT",
  "ACCEPTED",
  "BLOCKED_EXACT",
  "NOT_APPLICABLE_WITH_EVIDENCE",
]);
export const AUDIT_FIRST_IMPORT_PHASES = Object.freeze([
  "PRESERVE_LEGACY_SOURCE",
  "SELECT_CLEAN_CONTENT_ADDRESSED_BASELINES",
  "VERIFY_THREE_ROOT_ZERO_TRACE_LAYOUT",
  "COMPILE_COMPLETE_STANDARDS_INVENTORY",
  "RUN_SOURCE_FRESHNESS_AND_APPLICABILITY_GATES",
  "BUILD_CLAUSE_REQUIREMENTS_TRACEABILITY",
  "RUN_ATOMIC_READ_ONLY_SPECIALIST_AUDITS",
  "CONSOLIDATE_FINDINGS_WITHOUT_HIDING_SEAMS",
  "REPAIR_IN_ISOLATED_WORKTREES_UNDER_SCHEDULER_CUSTODY",
  "PLATFORM_INTEGRATION",
  "CENTRAL_INTEGRATION",
  "REPEAT_INDEPENDENT_AUDIT_REPAIR_TO_CONVERGENCE",
  "RUN_DETERMINISTIC_LOCAL_PROOF",
  "RUN_REQUIRED_DEPLOYED_REAL_USE_PROOF",
  "BUILD_CONTENT_ADDRESSED_COMPLIANCE_EVIDENCE_PACK",
  "ISSUE_RELEASE_RECOMMENDATION_OR_EXACT_BLOCKER",
]);
export const AUDIT_FIRST_CHECKPOINT_CONTRACT = Object.freeze({
  immediate_handoff_after_bounded_action: true,
  required_handoff_fields: Object.freeze(["ASSIGNED_SCOPE", "OBSERVED_IDENTITIES", "REQUIRED_FIELD_COMPLETENESS", "SIDE_EFFECTS", "MUTATION_AND_SPAWN_PROOF", "VIOLATIONS_AND_EVIDENCE_GAPS", "NEXT_REQUIRED_DECISION"]),
  missing_field_rule: "MISSING_REQUESTED_EVIDENCE_IS_A_FAILED_INCOMPLETE_HANDOFF_NOT_A_SUCCESSFUL_DISCOVERY",
  latency_rule: "WHEN_THE_BOUNDED_ACTION_COMPLETES_EMIT_THE_HANDOFF_AND_END_THE_TURN;_DO_NOT_WAIT_FOR_UNRELATED_WORK",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function normalizeIds(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = [...new Set(values)];
  assert(result.every((value) => typeof value === "string" && SAFE_ID.test(value)), `${label} contains an invalid identifier`);
  result.sort(compareUtf8);
  return result;
}

function inventoryEntries(ids, origin) {
  return ids.map((standardId) => ({
    standard_id: standardId,
    inventory_origin: origin,
    applicability_outcome: "PENDING_APPLICABILITY",
    applicability_evidence_sha256: null,
    source_freshness: "REQUIRES_INDEPENDENT_CURRENT_SOURCE_CHECK",
    atomic_auditor_identity: `STANDARD_VERSION_SPECIALIST_REQUIRED:${standardId}`,
  }));
}

export function compileAuditFirstImportProcedure({
  standardsRegistrySha256,
  specialistRosterSha256,
  registryStandardIds = [],
  discoveredStandardIds = [],
  ownerDeclaredStandardIds = [],
  maximumConcurrentRepairClones = 6,
} = {}) {
  requireSha(standardsRegistrySha256, "audit-first standards registry binding");
  requireSha(specialistRosterSha256, "audit-first specialist roster binding");
  assert(Number.isSafeInteger(maximumConcurrentRepairClones)
    && maximumConcurrentRepairClones >= 1
    && maximumConcurrentRepairClones <= 6,
  "audit-first repair concurrency must be an integer from one through six");

  const registry = normalizeIds(registryStandardIds, "registry standards");
  const discovered = normalizeIds(discoveredStandardIds, "discovered standards").filter((id) => !registry.includes(id));
  const owner = normalizeIds(ownerDeclaredStandardIds, "owner-declared standards").filter((id) => !registry.includes(id) && !discovered.includes(id));
  const standardsInventory = [
    ...inventoryEntries(registry, "AGENTOS_STANDARDS_REGISTRY"),
    ...inventoryEntries(discovered, "TYPED_PROJECT_DISCOVERY"),
    ...inventoryEntries(owner, "OWNER_DECLARED"),
  ].sort((left, right) => compareUtf8(left.standard_id, right.standard_id));

  const body = {
    schema: AUDIT_FIRST_IMPORT_PROCEDURE_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    purpose: "IMPORT_AND_REFACTOR_TO_EVIDENCE_BACKED_COMPLIANCE_FOR_THE_EXACT_DECLARED_SCOPE",
    standards_registry_sha256: standardsRegistrySha256,
    specialist_roster_sha256: specialistRosterSha256,
    phases: [...AUDIT_FIRST_IMPORT_PHASES],
    standards_inventory: standardsInventory,
    standards_inventory_complete_when: [
      "EVERY_AGENTOS_REGISTRY_STANDARD_HAS_ONE_ENTRY",
      "EVERY_DISCOVERED_TECHNOLOGY_JURISDICTION_DATA_CLASS_PROVIDER_AND_DELIVERY_STANDARD_HAS_ONE_ENTRY",
      "EVERY_OWNER_DECLARED_STANDARD_HAS_ONE_ENTRY",
      "ALIASES_ARE_DEDUPLICATED_WITHOUT_DROPPING_SOURCE_OR_VERSION_IDENTITY",
    ],
    applicability: {
      outcomes: [...APPLICABILITY_OUTCOMES],
      independent_identity_required: true,
      source_lock_fields: ["ISSUER", "TITLE", "VERSION", "PUBLICATION_OR_EFFECTIVE_DATE", "SOURCE_IDENTITY", "SOURCE_DIGEST_WHEN_AVAILABLE"],
      rule: "EVERY_INVENTORY_ENTRY_RECEIVES_SOURCE_FRESHNESS_AND_APPLICABILITY_REVIEW;_ONLY_APPLICABLE_ENTRIES_CREATE_CLAUSE_LEVEL_AUDIT_AND_REPAIR_WORK",
      unknown_rule: "UNKNOWN_BLOCKED_CLOSES_DEPENDENT_RELEASE_AND_COMPLIANCE_CLAIMS",
      legal_rule: "NO_AGENT_CERTIFIES_LEGAL_OR_REGULATORY_COMPLIANCE_OR_INFERS_UNDECLARED_JURISDICTION",
    },
    seed_composition: {
      formula: "GENERAL_GOVERNANCE + PROJECT_GOVERNANCE + EXACT_ROLE + EXACT_STANDARD_OR_TECHNICAL_SCOPE + SOURCE_VERSION_LOCKS + PROJECT_CONTEXT_SLICE + AUTHORITY_AND_TOOL_LIMITS + TYPED_HANDOFF_AND_PROOF_CONTRACT",
      permanent_roles: ["CONTROLLER", "INTENT_REGULATOR", "AGENT_SPAWNER_GOVERNANCE_COMPILER", "SCHEDULER", "RUNTIME", "MEMORY", "WORKTREE_CUSTODY", "PLATFORM_INTEGRATOR", "CENTRAL_INTEGRATOR", "RELEASE_EVIDENCE_ROLLBACK_CUSTODY"],
      dynamic_roles: ["APPLICABILITY_SPECIALIST", "SOURCE_FRESHNESS_SPECIALIST", "REQUIREMENTS_TRACEABILITY_SPECIALIST", "ATOMIC_READ_ONLY_AUDITOR", "ISOLATED_REPAIR_SPECIALIST", "INDEPENDENT_ACCEPTANCE_SPECIALIST"],
      separation_rules: ["SEEDS_NEVER_WORK", "FRESH_CLONES_PERFORM_WORK", "NO_SUBAGENTS", "APPLICABILITY_AUDIT_REPAIR_AND_ACCEPTANCE_IDENTITIES_ARE_DISTINCT", "NO_SELF_ACCEPTANCE", "ONE_STANDARD_VERSION_OR_ONE_NARROW_FAILURE_MODE_PER_ATOMIC_SPECIALIST"],
    },
    traceability: {
      schema: "agentos.audit_first_requirement_trace.v1",
      required_fields: ["requirement_id", "standard_id", "standard_version", "source_sha256", "clause_id", "applicability_outcome", "applicability_basis", "product_surface_ref", "implementation_commit", "implementation_tree", "proof_identity", "proof_result", "finding_id", "severity", "repair_candidate_id", "repair_commit", "repair_tree", "independent_auditor_id", "independent_disposition", "evidence_ceiling", "deferred_real_host_status", "rollback_identity", "residual_risk_or_owner_decision", "status"],
      allowed_statuses: [...REQUIREMENT_STATUSES],
      rule: "EVERY_APPLICABLE_MANDATORY_CLAUSE_HAS_IMPLEMENTATION_CURRENT_EVIDENCE_PROOF_REPAIR_WHEN_NEEDED_AND_INDEPENDENT_DISPOSITION",
    },
    custody: {
      maximum_concurrent_repair_clones: maximumConcurrentRepairClones,
      repair_workspace: "ONE_UNIQUE_ISOLATED_WORKTREE_AND_REQUESTER_PER_CLONE",
      scheduler_rule: "EVERY_WRITER_BUILD_TEST_RENDER_AND_DEPLOY_ACTION_REQUIRES_REGISTERED_SCHEDULER_CUSTODY",
      integration_route: ["PLATFORM_INTEGRATION", "CENTRAL_INTEGRATION"],
      auditor_rule: "AUDITORS_ARE_READ_ONLY_AND_CANNOT_ACCEPT_A_CANDIDATE_THEY_MODIFIED",
      release_rule: "RUNTIME_DEPLOYMENT_AND_PRODUCTION_PROMOTION_RETAIN_SEPARATE_AUTHORITY",
    },
    checkpoint_contract: structuredClone(AUDIT_FIRST_CHECKPOINT_CONTRACT),
    evidence_pack: ["REQUIREMENTS_TRACEABILITY_MATRIX", "SOURCE_AND_APPLICABILITY_RECEIPTS", "INDEPENDENT_AUDIT_DISPOSITIONS", "LOCAL_AND_REAL_HOST_PROOF", "SPDX_OR_CYCLONEDX_SBOM_AS_APPLICABLE", "SLSA_OR_EQUIVALENT_PROVENANCE_AS_APPLICABLE", "ROLLBACK_IDENTITY", "RESIDUAL_RISK_REGISTER", "RELEASE_RECOMMENDATION"],
    completion: {
      definition: "FOR_THE_EXACT_DECLARED_SCOPE_JURISDICTIONS_DATA_CLASSES_DEPLOYMENT_TARGETS_TECHNOLOGIES_AND_STANDARD_VERSIONS_EVERY_APPLICABLE_MANDATORY_REQUIREMENT_IS_TRACED_TO_IMPLEMENTATION_AND_CURRENT_EVIDENCE_WITH_REQUIRED_PROOF_AND_INDEPENDENT_ACCEPTANCE",
      blockers: ["UNKNOWN_BLOCKED", "FAILED_MANDATORY_REQUIREMENT", "UNTESTED_REQUIRED_REAL_HOST_PROOF", "DIRTY_ACCEPTED_CANDIDATE", "UNREVIEWED_AUTHORITY_CONFLICT", "MISSING_ROLLBACK_IDENTITY"],
      prohibited_claims: ["LEGAL_CERTIFICATION", "REGULATORY_APPROVAL", "SECURITY_PERFECTION", "UNIVERSAL_COMPLIANCE", "COMPLIANCE_WITH_INAPPLICABLE_UNLICENSED_UNKNOWN_OR_SUPERSEDED_REQUIREMENTS"],
    },
  };
  const procedure = {...body, procedure_sha256: canonicalDigest(body)};
  validateAuditFirstImportProcedure(procedure);
  return procedure;
}

export function validateAuditFirstImportProcedure(procedure) {
  assert(isRecord(procedure), "audit-first import procedure must be an object");
  assert(procedure.schema === AUDIT_FIRST_IMPORT_PROCEDURE_SCHEMA && procedure.version === 1, "audit-first import procedure identity is invalid");
  assert(procedure.governance_version === "2.1rc" && procedure.status === "PREPARED_NOT_ACTIVATED", "audit-first import procedure lifecycle is invalid");
  requireSha(procedure.standards_registry_sha256, "audit-first standards registry binding");
  requireSha(procedure.specialist_roster_sha256, "audit-first specialist roster binding");
  assert(JSON.stringify(procedure.phases) === JSON.stringify(AUDIT_FIRST_IMPORT_PHASES), "audit-first phase sequence is incomplete or reordered");
  assert(Array.isArray(procedure.standards_inventory), "audit-first standards inventory is missing");
  const ids = procedure.standards_inventory.map((entry) => entry.standard_id);
  assert(JSON.stringify(ids) === JSON.stringify([...new Set(ids)].sort(compareUtf8)), "audit-first standards inventory is duplicated or unsorted");
  for (const entry of procedure.standards_inventory) {
    assert(SAFE_ID.test(entry.standard_id), "audit-first standard ID is invalid");
    assert(APPLICABILITY_OUTCOMES.includes(entry.applicability_outcome), "audit-first applicability outcome is invalid");
    assert(entry.applicability_outcome === "PENDING_APPLICABILITY" && entry.applicability_evidence_sha256 === null, "compiled import procedure must not pre-judge applicability");
  }
  assert(procedure.applicability.independent_identity_required === true, "audit-first applicability may self-accept");
  assert(procedure.seed_composition.separation_rules.includes("SEEDS_NEVER_WORK")
    && procedure.seed_composition.separation_rules.includes("NO_SUBAGENTS")
    && procedure.seed_composition.separation_rules.includes("NO_SELF_ACCEPTANCE"), "audit-first seed separation is weakened");
  assert(procedure.traceability.allowed_statuses.every((status) => REQUIREMENT_STATUSES.includes(status)), "audit-first traceability status is invalid");
  assert(procedure.custody.maximum_concurrent_repair_clones >= 1 && procedure.custody.maximum_concurrent_repair_clones <= 6, "audit-first repair concurrency exceeds custody limit");
  assert(procedure.checkpoint_contract.immediate_handoff_after_bounded_action === true
    && procedure.checkpoint_contract.missing_field_rule.includes("FAILED_INCOMPLETE_HANDOFF"), "audit-first checkpoint failure semantics are weakened");
  assert(procedure.completion.blockers.includes("UNKNOWN_BLOCKED")
    && procedure.completion.blockers.includes("UNTESTED_REQUIRED_REAL_HOST_PROOF")
    && procedure.completion.prohibited_claims.includes("LEGAL_CERTIFICATION"), "audit-first completion claim is unsafe");
  const body = structuredClone(procedure);
  delete body.procedure_sha256;
  requireSha(procedure.procedure_sha256, "audit-first import procedure digest");
  assert(procedure.procedure_sha256 === canonicalDigest(body), "audit-first import procedure is not content-addressed");
  return procedure;
}
