#!/usr/bin/env node

import crypto from "node:crypto";

export const BOUNDARY_CONTRACT_SCHEMA = "agentos.boundary_contract.v1";
export const BOUNDARY_CLASSES = Object.freeze(["CONSTITUTIONAL", "OWNER_SOVEREIGN", "DERIVED_OPERATING", "TEMPORARY_PROBE"]);
export const BOUNDARY_CONFLICT_RULE = "THE_MORE_RESTRICTIVE_BOUNDARY_WINS; PROJECT_EXTENSIONS_MAY_ADD_RESTRICTIONS_BUT_CANNOT_WEAKEN_CONSTITUTIONAL_OR_OWNER_AUTHORITY";
export const BOUNDARY_HOLD_RULE = "A_TRUE_BOUNDARY_HOLDS_ONLY_THE_DEPENDENT_OUTCOME;_UNAFFECTED_WORK_CONTINUES";
export const BOUNDARY_EXTENSION_RULE = "PROJECT_CONTEXT_MAY_ADD_TYPED_BOUNDARIES_AND_STRICTER_LIMITS_ONLY;_IT_MAY_NOT_OVERRIDE_THE_PORTABLE_KERNEL_OR_INVENT_AUTHORITY";

const SHA256 = /^[0-9a-f]{64}$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;

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
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function stringArray(value, label, fallback = []) {
  const items = value ?? fallback;
  assert(Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim().length > 0), `${label} must be an array of nonempty strings`);
  return [...new Set(items)].sort(compareUtf8);
}

function boundary({boundary_id, className, subject, authority, automatic_allowed, forbidden, on_limit, unaffected_work, clear_condition, source_refs, immutable = false, owner_input = null}) {
  return {
    boundary_id,
    class: className,
    subject,
    authority,
    automatic_allowed,
    forbidden,
    on_limit,
    unaffected_work,
    clear_condition,
    source_refs,
    immutable,
    owner_input,
  };
}

export function constitutionalBoundaries() {
  return [
    boundary({boundary_id: "NO_SECRETS", className: "CONSTITUTIONAL", subject: "secrets_and_credentials", authority: "PORTABLE_KERNEL", automatic_allowed: ["KEEP_SECRET_VALUES_OUT_OF_SOURCE_PROMPTS_LOGS_RECEIPTS_AND_EVIDENCE"], forbidden: ["DISCOVER_COPY_PRINT_OR_PERSIST_SECRET_VALUES"], on_limit: "STOP_THE_AFFECTED_ACTION_AND_RETAIN_ONLY_SECRET_FREE_METADATA", unaffected_work: "UNRELATED_SECRET_FREE_WORK", clear_condition: "SECRET_FREE_INPUT_AND_OUTPUT_PATH_PROVEN", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_SILENT_SPENDING", className: "CONSTITUTIONAL", subject: "external_spending", authority: "OWNER_ONLY", automatic_allowed: ["CALCULATE_AND_REPORT_ESTIMATES"], forbidden: ["SPEND_OR_INCREASE_A_BILLING_BOUNDARY_WITHOUT_ADMITTED_AUTHORITY"], on_limit: "PAUSE_THE_COST_DEPENDENT_OUTCOME", unaffected_work: "NO_COST_OR_WITHIN_BOUNDARY_WORK", clear_condition: "EXACT_OWNER_BOUNDARY_AND_PROVIDER_CONTEXT_ARE_BOUND", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_IMPERSONATION", className: "CONSTITUTIONAL", subject: "human_identity_and_legal_acceptance", authority: "OWNER_ONLY", automatic_allowed: ["PREPARE_A_SECRET_FREE_DRAFT_FOR_HUMAN_REVIEW"], forbidden: ["IMPERSONATE_A_HUMAN_LOGIN_COMPLETE_MFA_VERIFY_IDENTITY_OR_ACCEPT_LEGAL_TERMS"], on_limit: "HOLD_ONLY_THE_IDENTITY_DEPENDENT_OUTCOME", unaffected_work: "NON_IDENTITY_WORK", clear_condition: "A_HUMAN_COMPLETES_THE_PROTECTED_ACTION", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_UNAUTHORIZED_DESTRUCTIVE_ACTION", className: "CONSTITUTIONAL", subject: "irreversible_or_destructive_action", authority: "OWNER_ONLY_OR_EXPLICIT_ADMITTED_AUTHORITY", automatic_allowed: ["PROPOSE_A_REVERSIBLE_ALTERNATIVE"], forbidden: ["DELETE_OVERWRITE_OR_REVOKE_WITHOUT_EXACT_AUTHORITY_AND_TARGET"], on_limit: "HOLD_THE_DESTRUCTIVE_ACTION_ONLY", unaffected_work: "REVERSIBLE_AND_READ_ONLY_WORK", clear_condition: "EXACT_TARGET_AUTHORITY_AND_ROLLBACK_OR_RECOVERY_ARE_BOUND", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_PUBLIC_PUBLICATION_BY_DEFAULT", className: "CONSTITUTIONAL", subject: "public_exposure", authority: "OWNER_ONLY", automatic_allowed: ["PREPARE_PRIVATE_OR_OWNER_ONLY_OUTPUT"], forbidden: ["PUBLISH_OR_OPEN_ACCESS_BY_DEFAULT"], on_limit: "RETAIN_PRIVATE_AND_RECORD_THE_UNRESOLVED_PUBLICATION_BOUNDARY", unaffected_work: "PRIVATE_BUILD_AND_PROOF", clear_condition: "OWNER_PUBLICATION_AND_AUDIENCE_BOUNDARY_IS_BOUND", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_SELF_ACCEPTANCE", className: "CONSTITUTIONAL", subject: "product_acceptance", authority: "INDEPENDENT_AUDITOR", automatic_allowed: ["RUN_BUILDER_SIDE_CHECKS_AND_PREPARE_EVIDENCE"], forbidden: ["BUILDER_OR_FINALIZER_MARK_ITS_OWN_CANDIDATE_ACCEPTED"], on_limit: "RETURN_THE_CANDIDATE_FOR_INDEPENDENT_AUDIT", unaffected_work: "IMPLEMENTATION_AND_READ_ONLY_PREPARATION", clear_condition: "INDEPENDENT_ACCEPTANCE_RECEIPT_BINDS_THE_EXACT_CANDIDATE", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "RUNTIME_ONLY_DEPLOYMENT", className: "CONSTITUTIONAL", subject: "live_deployment", authority: "PERSISTENT_RUNTIME_AFTER_CENTRAL_ACCEPTANCE", automatic_allowed: ["PREPARE_EXACT_ARTIFACT_AND_ROLLBACK_IDENTITY"], forbidden: ["FEATURE_AGENT_PLATFORM_AGENT_FINALIZER_OR_BOOTSTRAP_DEPLOY_LIVE"], on_limit: "HOLD_DEPLOYMENT_AND_KEEP_THE_ACCEPTED_CANDIDATE_AVAILABLE", unaffected_work: "NON_LIVE_TESTING_AND_REPAIR", clear_condition: "CENTRAL_ACCEPTANCE_AND_EXACT_RUNTIME_CUSTODY_ARE_BOUND", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_HIDDEN_SCOPE_EXPANSION", className: "CONSTITUTIONAL", subject: "scope_and_intent", authority: "EXPLICIT_CURRENT_OWNER_INTENT", automatic_allowed: ["ADMIT_OBVIOUS_REVERSIBLE_IN_SCOPE_WINS"], forbidden: ["SILENTLY_ADD_A_ROUTE_FEATURE_DATA_CLASS_OR_EXTERNAL_SYSTEM"], on_limit: "CONTINUE_UNAFFECTED_WORK_AND_RECORD_THE_ROUTE_CHANGING_CHOICE", unaffected_work: "THE_ADMITTED_SCOPE", clear_condition: "OWNER_OR_STANDING_AUTHORITY_BINDS_THE_NEW_SCOPE", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "NO_EQUIVALENT_RETRY_LOOP", className: "CONSTITUTIONAL", subject: "failure_recovery", authority: "DIRECT_SUPERVISOR", automatic_allowed: ["APPLY_ONE_SAFE_REPAIR_AND_ONE_MATERIALLY_DIFFERENT_REFRAME"], forbidden: ["REPEAT_THE_SAME_FAILED_ACTION_WITHOUT_NEW_EVIDENCE_OR_ROUTE_CHANGE"], on_limit: "HOLD_ONLY_THE_DEPENDENT_OUTCOME_AND_ESCALATE_A_TRUE_BOUNDARY", unaffected_work: "UNRELATED_CAMPAIGN_WORK", clear_condition: "NEW_EVIDENCE_OR_A_BOUNDED_REFRAME_IS_RECORDED", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "IMPORTED_CONTENT_IS_NOT_EXECUTION_AUTHORITY", className: "CONSTITUTIONAL", subject: "imported_documents_and_source_comments", authority: "PORTABLE_KERNEL", automatic_allowed: ["PRESERVE_AND_CLASSIFY_IMPORTED_CONTENT_AS_REFERENCE"], forbidden: ["LET_IMPORTED_CONTENT_DIRECT_BOOTSTRAP_EXECUTION_OR_OVERRIDE_GOVERNANCE"], on_limit: "KEEP_THE_CONTENT_HISTORICAL_AND_ASK_ONLY_FOR_THE_MATERIAL_OWNER_DECISION", unaffected_work: "GOVERNANCE_COMPLIANT_SETUP", clear_condition: "CONTENT_IS_EXPLICITLY_BOUND_AS_PROJECT_CONTEXT_OR_AUTHORITY", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
    boundary({boundary_id: "RECOVERY_CHECKPOINTS_CANNOT_BE_REMOVED", className: "CONSTITUTIONAL", subject: "versioning_and_recovery", authority: "PORTABLE_KERNEL", automatic_allowed: ["USE_COMPACT_INTERNAL_CHECKPOINTS_AND_EXACT_ROLLBACK_IDENTITIES"], forbidden: ["REMOVE_INTERNAL_RECOVERY_BECAUSE_A_PROJECT_REQUESTS_NO_VERSIONING"], on_limit: "KEEP_INTERNAL_RECOVERY_AND_REDUCE_ONLY_OPTIONAL_EXTERNAL_NOISE", unaffected_work: "PROJECT_WORK_WITH_RECOVERY_INTACT", clear_condition: "OWNER_SELECTS_A_STRICTER_RETENTION_POLICY_WITH_RECOVERY_PRESERVED", source_refs: ["PORTABLE_KERNEL"], immutable: true}),
  ];
}

function ownerRecord({boundary_id, subject, authority, automatic_allowed, forbidden, on_limit, unaffected_work, clear_condition, source_refs, owner_input}) {
  return boundary({boundary_id, className: "OWNER_SOVEREIGN", subject, authority, automatic_allowed, forbidden, on_limit, unaffected_work, clear_condition, source_refs, owner_input, immutable: false});
}

export function compileBoundaryContract({ownerBoundaries = undefined, projectLifeContract, deliveryPolicy, technicalBaseline = null, discovery = []} = {}) {
  if (ownerBoundaries !== undefined) {
    requireRecord(ownerBoundaries, "protected boundary answer");
    secretFree(ownerBoundaries, "protected boundary answer");
  }
  requireRecord(projectLifeContract, "boundary project life contract");
  requireRecord(deliveryPolicy, "boundary delivery policy");
  const ownerInput = ownerBoundaries ?? {};
  const ownerInputDigest = canonicalDigest(ownerInput);
  const constitutional = constitutionalBoundaries();
  const ownerSovereign = [
    ownerRecord({boundary_id: "OWNER_PRODUCT_INTENT", subject: "north_star_and_proving_workflow", authority: "CURRENT_OWNER_INTENT", automatic_allowed: ["IMPLEMENT_WITHIN_THE_BOUND_NORTH_STAR_AND_PROVING_WORKFLOW"], forbidden: ["REDEFINE_THE_OWNER_OUTCOME_OR_SUCCESS_CONDITION"], on_limit: "ASK_ONLY_FOR_THE_ROUTE_CHANGING_INTENT", unaffected_work: "ADMITTED_WORKFLOW_IMPLEMENTATION", clear_condition: "NORTH_STAR_AND_PROVING_WORKFLOW_ARE_EXPLICIT", source_refs: ["project.north_star", "project.first_workflow"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_AUDIENCE_AND_PUBLICATION", subject: "audience_and_publication", authority: "CURRENT_OWNER_INTENT", automatic_allowed: ["KEEP_OUTPUT_WITHIN_THE_COMPILED_PROJECT_AUDIENCE"], forbidden: ["CHANGE_PRIVATE_OWNER_ONLY_WORK_TO_PUBLIC_OR_EXPAND_AUDIENCE_SILENTLY"], on_limit: "HOLD_ONLY_PUBLICATION_OR_AUDIENCE_DEPENDENT_WORK", unaffected_work: "PRIVATE_BUILD_AND_PROOF", clear_condition: "PROJECT_LIFE_AUDIENCE_AND_PUBLICATION_DECISION_ARE_BOUND", source_refs: ["project_life_contract", "project.protected_boundaries"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_DATA_AND_PRIVACY", subject: "real_sensitive_or_durable_data", authority: "CURRENT_OWNER_INTENT_AND_SECURITY_BOUNDARY", automatic_allowed: ["USE_SYNTHETIC_OR_EXPLICITLY_ADMITTED_DATA_ONLY"], forbidden: ["INTRODUCE_SENSITIVE_DURABLE_DATA_OR_CHANGE_TENANCY_WITHOUT_AUTHORITY"], on_limit: "HOLD_ONLY_DATA_AND_AUTH_DEPENDENT_WORK", unaffected_work: "DATA_FREE_WORK", clear_condition: "DATA_POSTURE_AND_AUTHORITY_SCOPE_ARE_BOUND", source_refs: ["project_life_contract", "project.technical_baseline", "project.protected_boundaries"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_SPENDING_AND_PROVIDER_BINDING", subject: "spending_provider_and_account", authority: "CURRENT_OWNER_INTENT", automatic_allowed: ["COMPARE_COSTS_AND_PREPARE_PROVIDER_NEUTRAL_CONFIGURATION"], forbidden: ["AUTHENTICATE_SPEND_SELECT_AN_ACCOUNT_OR_EXCEED_A_COST_BOUNDARY_SILENTLY"], on_limit: "PAUSE_ONLY_THE_COST_OR_PROVIDER_DEPENDENT_ACTION", unaffected_work: "LOCAL_AND_WITHIN_BOUNDARY_WORK", clear_condition: "DELIVERY_COST_AND_PROVIDER_BINDINGS_ARE_EXPLICIT", source_refs: ["project.delivery_policy", "project.protected_boundaries"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_PRODUCTION_PROMOTION", subject: "production_promotion_and_release", authority: "CURRENT_OWNER_INTENT_AND_CENTRAL_ACCEPTANCE", automatic_allowed: ["PREPARE_A_RELEASE_AND_EXACT_ROLLBACK_PLAN"], forbidden: ["PROMOTE_OR_DEPLOY_OUTSIDE_THE_ADMITTED_RELEASE_AND_RUNTIME_CUSTODY"], on_limit: "HOLD_PROMOTION_ONLY", unaffected_work: "BUILD_REPAIR_AND_READ_ONLY_AUDIT", clear_condition: "THREE_ROOT_ACCEPTANCE_CENTRAL_RELEASE_ADMISSION_AND_RUNTIME_CUSTODY_ARE_BOUND", source_refs: ["project_life_contract", "project.delivery_policy", "project.protected_boundaries"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_SOURCE_LICENSE_AND_RETIREMENT", subject: "source_ownership_license_and_retirement", authority: "CURRENT_OWNER_INTENT", automatic_allowed: ["PRESERVE_SOURCE_AND_PREPARE_A_REVERSIBLE_RETIREMENT_PLAN"], forbidden: ["CHANGE_OWNERSHIP_LICENSE_OR_RETIREMENT_WITHOUT_AUTHORITY"], on_limit: "HOLD_ONLY_THE_OWNERSHIP_LICENSE_OR_RETIREMENT_ACTION", unaffected_work: "IMPLEMENTATION_WITH_CURRENT_SOURCE_CUSTODY", clear_condition: "SOURCE_CUSTODY_LICENSE_AND_RETIREMENT_POLICY_ARE_BOUND", source_refs: ["project.boundary", "project_life_contract", "project.protected_boundaries"], owner_input: ownerInput}),
    ownerRecord({boundary_id: "OWNER_DESTRUCTIVE_ACTIONS", subject: "destructive_cleanup_and_irreversible_actions", authority: "CURRENT_OWNER_INTENT", automatic_allowed: ["USE_TRASH_OR_RETAINED_CHECKPOINTS_WHEN_AVAILABLE"], forbidden: ["DELETE_OR_OVERWRITE_USER_WORK_OR_EXTERNAL_RESOURCES_WITHOUT_EXACT_AUTHORITY"], on_limit: "HOLD_THE_EXACT_DESTRUCTIVE_ACTION_ONLY", unaffected_work: "NON_DESTRUCTIVE_WORK", clear_condition: "TARGET_SCOPE_AUTHORITY_AND_RECOVERY_ARE_EXPLICIT", source_refs: ["project.protected_boundaries"], owner_input: ownerInput}),
  ];
  const derivedOperating = [
    boundary({boundary_id: "OPERATING_AUDIENCE", className: "DERIVED_OPERATING", subject: "compiled_audience", authority: "PROJECT_LIFE_CONTRACT", automatic_allowed: [`OPERATE_WITHIN_${projectLifeContract.audience}_AUDIENCE`], forbidden: ["EXCEED_THE_COMPILED_AUDIENCE"], on_limit: "THROTTLE_OR_HOLD_THE_AUDIENCE_DEPENDENT_OUTCOME", unaffected_work: "WITHIN_AUDIENCE_WORK", clear_condition: "PROJECT_LIFE_CONTRACT_CHANGES_WITH_OWNER_AUTHORITY", source_refs: ["project_life_contract"], immutable: false}),
    boundary({boundary_id: "OPERATING_DATA_POSTURE", className: "DERIVED_OPERATING", subject: "compiled_data_posture", authority: "PROJECT_LIFE_CONTRACT_AND_TECHNICAL_BASELINE", automatic_allowed: [`USE_${projectLifeContract.data_posture}_DATA_POSTURE`], forbidden: ["SILENTLY_ESCALATE_DATA_SENSITIVITY_DURABILITY_OR_TENANCY"], on_limit: "HOLD_THE_DATA_DEPENDENT_OUTCOME", unaffected_work: "DATA_FREE_OR_WITHIN_POSTURE_WORK", clear_condition: "OWNER_REBINDS_DATA_POSTURE_AND_SECURITY_REQUIREMENTS", source_refs: ["project_life_contract", "project.technical_baseline"], immutable: false}),
    boundary({boundary_id: "OPERATING_DELIVERY_COST", className: "DERIVED_OPERATING", subject: "runner_minutes_and_spend", authority: "DELIVERY_POLICY", automatic_allowed: ["RUN_WITHIN_THE_BOUND_RUNNER_AND_SPEND_LIMITS"], forbidden: ["EXCEED_COST_LIMITS_OR_TREAT_A_RECOMMENDATION_AS_AUTHORITY"], on_limit: deliveryPolicy.cost_boundaries.on_limit, unaffected_work: "LOCAL_OR_WITHIN_BOUNDARY_WORK", clear_condition: "OWNER_REBINDS_THE_COST_BOUNDARY", source_refs: ["project.delivery_policy"], immutable: false}),
    boundary({boundary_id: "OPERATING_DELIVERY_CUSTODY", className: "DERIVED_OPERATING", subject: "push_merge_deploy_and_rollback", authority: "DELIVERY_POLICY_AND_RUNTIME", automatic_allowed: ["PREPARE_CLEAN_CHECKPOINTS_AND_EXACT_ARTIFACT_IDENTITIES"], forbidden: ["PUSH_MERGE_DEPLOY_OR_ROLL_BACK_OUTSIDE_THE_COMPILED_CUSTODY_CHAIN"], on_limit: "HOLD_ONLY_THE_AFFECTED_DELIVERY_ACTION", unaffected_work: "SOURCE_CHECKS_AND_LOCAL_REPAIR", clear_condition: "EXACT_PROVIDER_ENVIRONMENT_RUNTIME_AND_ROLLBACK_BINDINGS_ARE_PROVEN", source_refs: ["project.delivery_policy", "project.runtime"], immutable: false}),
    boundary({boundary_id: "OPERATING_LIFETIME_AND_MAINTENANCE", className: "DERIVED_OPERATING", subject: "lifetime_maintenance_and_retirement", authority: "PROJECT_LIFE_CONTRACT", automatic_allowed: ["FOLLOW_THE_COMPILED_LIFETIME_AND_MAINTENANCE_POSTURE"], forbidden: ["CLAIM_INDEFINITE_SUPPORT_OR_SKIP_RETIREMENT_BECAUSE_WORK_CONTINUES"], on_limit: "RETAIN_THE_LAST_SAFE_CHECKPOINT_AND_ROUTE_RETIREMENT_TO_OWNER", unaffected_work: "CURRENT_CAMPAIGN_WORK_WITHIN_LIFETIME", clear_condition: "OWNER_REBINDS_LIFETIME_MAINTENANCE_OR_RETIREMENT", source_refs: ["project_life_contract"], immutable: false}),
  ];
  const temporaryProbes = [
    boundary({boundary_id: "PROBE_LOCAL_READ_ONLY", className: "TEMPORARY_PROBE", subject: "local_discovery_and_delivery_probes", authority: "BOOTSTRAP_PROBE_CONTRACT", automatic_allowed: ["READ_GIT_MARKERS_LOCAL_TOOLS_AND_SECRET_FREE_PROJECT_SHAPE"], forbidden: ["AUTHENTICATE_NETWORK_PUSH_MERGE_SPEND_WRITE_DELETE_DEPLOY_OR_ROLL_BACK"], on_limit: "MARK_UNAVAILABLE_OR_CONFLICT_AND_HOLD_ONLY_THE_DEPENDENT_OUTPUT", unaffected_work: "NO_PROBE_DEPENDENT_WORK", clear_condition: "A_NEW_BOUND_READ_ONLY_PROBE_RESULT_IS_AVAILABLE", source_refs: ["delivery.probe.results.json"], immutable: false}),
    boundary({boundary_id: "PROBE_REMOTE_AUTH_NOT_RUN", className: "TEMPORARY_PROBE", subject: "remote_authentication_and_provider_quota", authority: "OWNER_BOUNDARY", automatic_allowed: ["RECORD_NOT_RUN_OWNER_BOUNDARY"], forbidden: ["ATTEMPT_REMOTE_AUTHENTICATION_OR_PROVIDER_CONTACT_DURING_BOOTSTRAP_PROBES"], on_limit: "LEAVE_THE_EXTERNAL_BINDING_UNPROVEN", unaffected_work: "LOCAL_SETUP_AND_SECRET_FREE_PLANNING", clear_condition: "THE_OWNER_ADMITS_A_SEPARATE_EXPLICIT_EXTERNAL_ACTION", source_refs: ["delivery.probe.results.json"], immutable: false}),
    boundary({boundary_id: "PROBE_DEPLOYMENT_NOT_RUN", className: "TEMPORARY_PROBE", subject: "hosting_deployment_and_rollback", authority: "RUNTIME_AFTER_CENTRAL_ACCEPTANCE", automatic_allowed: ["RECORD_NOT_RUN_OWNER_BOUNDARY"], forbidden: ["CREATE_A_PREVIEW_DEPLOY_OR_ROLL_BACK_AS_A_BOOTSTRAP_PROBE"], on_limit: "LEAVE_DEPLOYMENT_AND_ROLLBACK_UNPROVEN", unaffected_work: "NON_LIVE_SETUP_WORK", clear_condition: "THE_ADMITTED_RUNTIME_EXECUTES_THE_BOUND_RELEASE_ACTION", source_refs: ["delivery.probe.results.json"], immutable: false}),
    boundary({boundary_id: "PROBE_LEGACY_ARCHIVE_BEFORE_REPLACEMENT", className: "TEMPORARY_PROBE", subject: "imported_authority_preservation", authority: "BOOTSTRAP_LEGACY_GATE", automatic_allowed: ["READ_SOURCE_CREATE_AND_VERIFY_THE_REQUIRED_ARCHIVE_BEFORE_REPLACEMENT_WRITES"], forbidden: ["REPLACE_AN_IMPORTED_OR_REFACTORED_CORPUS_BEFORE_LEGACY_VERIFICATION"], on_limit: "HOLD_CORPUS_REPLACEMENT_ONLY", unaffected_work: "CREATE_NEW_CORPUS_OR_UNRELATED_LOCAL_WORK", clear_condition: "LEGACY_RECEIPT_AND_READBACK_VERIFY_THE_EXACT_SOURCE", source_refs: ["legacy.zip", "legacy.receipt.json"], immutable: false}),
  ];
  const contract = {
    schema: BOUNDARY_CONTRACT_SCHEMA,
    version: 1,
    status: "COMPILED",
    owner_input_sha256: ownerInputDigest,
    constitutional,
    owner_sovereign: ownerSovereign,
    derived_operating: derivedOperating,
    temporary_probes: temporaryProbes,
    conflict_rule: BOUNDARY_CONFLICT_RULE,
    hold_rule: BOUNDARY_HOLD_RULE,
    extension_boundary: BOUNDARY_EXTENSION_RULE,
    discovery_inputs: discovery.filter((fact) => fact?.status === "OBSERVED_FACT" && typeof fact.fact_id === "string")
      .map((fact) => fact.fact_id).sort(compareUtf8),
    technical_baseline_bound: technicalBaseline !== null,
  };
  secretFree(contract, "compiled boundary contract");
  contract.boundary_contract_sha256 = canonicalDigest(contract);
  validateBoundaryContract(contract);
  return contract;
}

function validateBoundaryList(list, className, label) {
  assert(Array.isArray(list) && list.length > 0, `${label} is empty`);
  const ids = new Set();
  for (const item of list) {
    requireRecord(item, `${label} entry`);
    requireString(item.boundary_id, `${label} boundary ID`);
    assert(!ids.has(item.boundary_id), `${label} boundary IDs are not unique`);
    ids.add(item.boundary_id);
    assert(item.class === className, `${label} boundary class is invalid`);
    for (const field of ["subject", "authority", "on_limit", "unaffected_work", "clear_condition"]) requireString(item[field], `${label} ${item.boundary_id} ${field}`);
    for (const field of ["automatic_allowed", "forbidden", "source_refs"]) stringArray(item[field], `${label} ${item.boundary_id} ${field}`);
    assert(typeof item.immutable === "boolean", `${label} ${item.boundary_id} immutable flag is invalid`);
    if (className !== "CONSTITUTIONAL") assert(item.immutable === false, `${label} ${item.boundary_id} cannot claim constitutional immutability`);
    secretFree(item, `${label} ${item.boundary_id}`);
  }
  return list;
}

export function validateBoundaryContract(contract) {
  requireRecord(contract, "boundary contract");
  assert(contract.schema === BOUNDARY_CONTRACT_SCHEMA && contract.version === 1 && contract.status === "COMPILED", "boundary contract identity is invalid");
  requireSha(contract.owner_input_sha256, "boundary owner input digest");
  const expectedConstitutional = constitutionalBoundaries();
  assert(Array.isArray(contract.constitutional) && contract.constitutional.length === expectedConstitutional.length, "constitutional boundary set is incomplete");
  for (const [index, item] of contract.constitutional.entries()) {
    const expected = expectedConstitutional[index];
    assert(canonicalDigest(item) === canonicalDigest(expected), `constitutional boundary ${index} was weakened or reordered`);
  }
  validateBoundaryList(contract.constitutional, "CONSTITUTIONAL", "constitutional boundaries");
  assert(contract.constitutional.every((item) => item.immutable === true), "constitutional boundaries must be immutable");
  validateBoundaryList(contract.owner_sovereign, "OWNER_SOVEREIGN", "owner boundaries");
  validateBoundaryList(contract.derived_operating, "DERIVED_OPERATING", "derived operating boundaries");
  validateBoundaryList(contract.temporary_probes, "TEMPORARY_PROBE", "temporary probe boundaries");
  assert(contract.conflict_rule === BOUNDARY_CONFLICT_RULE, "boundary conflict rule is weakened");
  assert(contract.hold_rule === BOUNDARY_HOLD_RULE, "boundary hold rule is weakened");
  assert(contract.extension_boundary === BOUNDARY_EXTENSION_RULE, "boundary extension rule is weakened");
  assert(Array.isArray(contract.discovery_inputs) && contract.discovery_inputs.every((value) => typeof value === "string"), "boundary discovery inputs are invalid");
  assert(typeof contract.technical_baseline_bound === "boolean", "boundary technical baseline binding is invalid");
  const ownerInput = contract.owner_sovereign[0]?.owner_input;
  requireRecord(ownerInput, "boundary owner input");
  assert(contract.owner_sovereign.every((item) => canonicalDigest(item.owner_input) === contract.owner_input_sha256), "boundary owner input is not bound consistently");
  const body = structuredClone(contract);
  delete body.boundary_contract_sha256;
  requireSha(contract.boundary_contract_sha256, "boundary contract digest");
  assert(contract.boundary_contract_sha256 === canonicalDigest(body), "boundary contract is not content-addressed");
  secretFree(contract, "boundary contract");
  return contract;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("boundary contract controller loaded\n");
