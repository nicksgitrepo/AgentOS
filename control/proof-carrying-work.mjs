#!/usr/bin/env node

import {
  canonicalDigest,
  compareUtf8,
} from "./content-addressing.mjs";

export const PROOF_CAPSULE_SCHEMA = "governance.proof_carrying_work.v1";
export const PROOF_CONTRACT_STATUS = "PREPARED_NOT_ACTIVATED";
export const EVIDENCE_KINDS = Object.freeze([
  "DIRECT_OBSERVATION",
  "DERIVED_RESULT",
  "UNAVAILABLE_RESULT",
  "UNVERIFIED_ASSERTION",
]);
export const CLAIM_STATUSES = Object.freeze([
  "VERIFIED",
  "PARTIAL",
  "UNAVAILABLE",
  "UNVERIFIED",
  "INVALIDATED",
]);
export const CHECK_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "UNAVAILABLE",
  "UNVERIFIED",
  "NOT_RUN",
]);
export const CANDIDATE_LIFECYCLES = Object.freeze([
  "SOURCE_OPEN",
  "CANDIDATE_FROZEN",
  "PROOF_QUEUED",
  "PROOF_RUNNING",
  "PROOF_TERMINAL",
]);
export const CURRENT_DISPOSITIONS = Object.freeze([
  "WORKING_EXPECTED",
  "WAITING_WITH_RECEIPT",
  "TERMINAL_PRESERVED",
  "DORMANT_NOT_APPLICABLE",
  "BLOCKED_EXACT",
]);
export const COMPATIBILITY_STATUSES = Object.freeze([
  "NOT_APPLICABLE",
  "PENDING",
  "PASSED",
  "FAILED",
  "OUT_OF_SCOPE_PROOF_DEFERRED",
]);
export const SEAM_DISPOSITIONS = Object.freeze([
  "NO_MATERIAL_SEAM",
  "ACCEPTED_AND_IMPLEMENTED",
  "ACCEPTED_PENDING_DEPENDENCY",
  "MODIFIED_BY_AGREEMENT",
  "REJECTED_WITH_SOURCE_REASON",
  "CENTRAL_SEQUENCE_REQUIRED",
  "OWNER_DECISION_REQUIRED",
]);
export const OBSERVATION_ROLES = Object.freeze([
  "BUILDER",
  "AUDITOR",
  "INDEPENDENT_AUDITOR",
  "CAMPAIGN_ORCHESTRATOR",
]);
export const PROTECTED_ACTIONS = Object.freeze({
  acceptance: false,
  activation: false,
  deletion: false,
  deployment: false,
  external_release: false,
  external_publish: false,
  external_push: false,
  merge: false,
  product_writes: false,
  secrets: false,
  spend: false,
  authority_change: false,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PRIVATE_TEXT = /(?:\bpassword\b|\bsecret(?:s)?\b|\bcredential(?:s)?\b|\bprivate[ _-]?key\b|\btoken\b|\bsk-[A-Za-z0-9])/iu;
const PROTECTED_PUBLIC_SUMMARY = /(?:\/(?:Users|home|private|tmp|var|root|etc)\/|[A-Za-z]:[\\/](?:Users|home|private|tmp|var|root)[\\/]|(?:api|access|secret|auth|private)[ _-]?(?:key|token|credential)\s*[:=]|(?:access|refresh|bearer|session|auth)[ _-]?token\s*[:=]|(?:chat|conversation|thread)[\/:_ -])/iu;
const PRIVATE_REFERENCE_TOKEN = /(?:^|[._-])(?:private|secret|secrets|credential|credentials|token)(?:[._-]|$)/iu;
const PRIVATE_REFERENCE_SEGMENT = /^(?:\.git|\.env|tmp|var|home|root)$/iu;
const CHAT_REFERENCE_TOKEN = /(?:^|[\/._-])(?:chat|conversation|thread)(?:[\/._-]|$)/iu;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

const SOURCE_KEYS = ["commit", "tree", "working_tree_sha256", "clean", "pushed"];
const SCOPE_KEYS = ["in_paths", "out_paths", "scope_sha256", "product_writes_allowed", "external_actions_allowed"];
const ENVIRONMENT_KEYS = ["environment_id", "capability_sha256", "runtime_sha256", "source_commit", "source_tree"];
const DEPENDENCY_KEYS = ["dependency_id", "kind", "reference", "source_commit", "source_tree", "dependency_sha256", "affects_claim_ids", "recheck_ids"];
const CHECK_KEYS = ["check_id", "check_ref", "status", "source_commit", "source_tree", "result_sha256", "evidence_kind", "evidence_ids"];
const EVIDENCE_KEYS = ["evidence_id", "kind", "summary", "path", "source_commit", "source_tree", "evidence_sha256", "claim_ids"];
const CLAIM_KEYS = ["claim_id", "status", "evidence_ids", "dependency_ids", "recheck_ids"];
const ROLLBACK_KEYS = ["available", "plan_ref", "checkpoint_sha256", "owner_approval_required", "activation_allowed"];
const RISK_KEYS = ["risk_id", "severity", "summary", "route"];
const GENERATION_KEYS = ["generation_id", "repository_id", "lifecycle", "source_commit", "source_tree", "working_tree_sha256", "configuration_sha256", "toolchain_sha256", "supersedes_generation_id"];
const OBSERVATION_KEYS = ["observed_at_utc", "observed_by_role", "repository_id", "source_commit", "source_tree", "working_tree_sha256", "clean", "pushed", "observation_sha256"];
const SEAM_KEYS = ["platform_lane_ids", "shared_path_refs", "changed_contract_ids", "opposite_consumer_ids", "migration_ids", "generated_output_refs", "ordering_requirements", "atomic_seam", "primary_owner", "disposition"];
const COMPATIBILITY_KEYS = ["status", "shared_surface_ids", "check_ids", "source_commit", "source_tree", "proof_ceiling", "next_owner"];
const CURRENT_STATE_KEYS = ["candidate_generation_id", "lifecycle", "disposition", "superseded_generation_ids", "material_seams", "proof_ceiling", "next_action", "downstream_consumed"];
const INVAL_RULE_KEYS = ["rule_id", "trigger_kind", "trigger_ids", "affected_claim_ids", "required_recheck_ids"];
const INVAL_EVENT_KEYS = ["event_id", "source_changed", "environment_changed", "scope_changed", "changed_dependency_ids", "affected_claim_ids", "required_recheck_ids", "prior_claims", "previous_capsule_sha256", "cause", "observed_at_utc", "event_sha256"];
const HANDOFF_CHECK_KEYS = ["status", "auditor_id", "evidence_sha256"];
const HANDOFF_KEYS = ["phase", "result", "next_handoff", "independent_check", "evidence_ids", "summary", "candidate_generation_id", "proof_ceiling", "downstream_consumed"];
const CAPSULE_KEYS = [
  "schema", "version", "contract_status", "status", "capsule_id", "project_governance_sha256",
  "builder_id", "auditor_id", "accepted_by", "source_before", "source_after", "claimed_scope",
  "candidate_generation", "source_observation", "changed_paths", "environment", "dependencies", "checks", "evidence", "claims", "rollback",
  "seam_registration", "cross_feature_compatibility", "current_state", "downstream_consumed",
  "invalidation", "residual_risks", "handoff", "protected_actions", "capsule_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSafeSummary(value, label) {
  requireString(value, label);
  assert(!PRIVATE_TEXT.test(value) && !PROTECTED_PUBLIC_SUMMARY.test(value), `${label} contains private, credential-like, or chat-bound text`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} must be a portable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be UTC`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function sortedStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value) => requireIdentifier(value, `${label} item`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
}

export function validatePublicReference(value, label = "public reference") {
  assert(value === null || typeof value === "string", `${label} must be null or a project-relative reference`);
  if (value === null) return value;
  requireString(value, label);
  assert(!value.includes("\\"), `${label} must use project-relative paths`);
  assert(!value.startsWith("/") && !value.startsWith("~") && !/^[A-Za-z]:/u.test(value), `${label} must be project-relative`);
  assert(!SCHEME.test(value), `${label} must not be an absolute link`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} leaves the project`);
  assert(!segments.some((segment) => PRIVATE_REFERENCE_SEGMENT.test(segment) || PRIVATE_REFERENCE_TOKEN.test(segment)), `${label} contains a private path`);
  assert(!CHAT_REFERENCE_TOKEN.test(value), `${label} contains a chat link`);
  return value;
}

function sortedReferences(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value) => validatePublicReference(value, `${label} reference`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
}

function validateSeamRegistration(registration) {
  exactKeys(registration, SEAM_KEYS, "seam registration");
  sortedStrings(registration.platform_lane_ids, "seam platform lanes", {allowEmpty: true});
  sortedReferences(registration.shared_path_refs, "seam shared paths", {allowEmpty: true});
  sortedStrings(registration.changed_contract_ids, "seam changed contracts", {allowEmpty: true});
  sortedStrings(registration.opposite_consumer_ids, "seam opposite consumers", {allowEmpty: true});
  sortedStrings(registration.migration_ids, "seam migrations", {allowEmpty: true});
  sortedReferences(registration.generated_output_refs, "seam generated outputs", {allowEmpty: true});
  sortedStrings(registration.ordering_requirements, "seam ordering requirements", {allowEmpty: true});
  assert(typeof registration.atomic_seam === "boolean", "seam atomic flag is invalid");
  requireIdentifier(registration.primary_owner, "seam primary owner");
  assert(SEAM_DISPOSITIONS.includes(registration.disposition), "seam disposition is invalid");
  return registration;
}

export function compileSeamRegistration({platformLaneIds = [], sharedPathRefs = [], changedContractIds = [], oppositeConsumerIds = [], migrationIds = [], generatedOutputRefs = [], orderingRequirements = [], atomicSeam = false, primaryOwner, disposition}) {
  return validateSeamRegistration({
    platform_lane_ids: [...platformLaneIds].sort(compareUtf8),
    shared_path_refs: [...sharedPathRefs].sort(compareUtf8),
    changed_contract_ids: [...changedContractIds].sort(compareUtf8),
    opposite_consumer_ids: [...oppositeConsumerIds].sort(compareUtf8),
    migration_ids: [...migrationIds].sort(compareUtf8),
    generated_output_refs: [...generatedOutputRefs].sort(compareUtf8),
    ordering_requirements: [...orderingRequirements].sort(compareUtf8),
    atomic_seam: atomicSeam,
    primary_owner: primaryOwner,
    disposition,
  });
}

function validateCrossFeatureCompatibility(compatibility, source) {
  exactKeys(compatibility, COMPATIBILITY_KEYS, "cross-feature compatibility");
  assert(COMPATIBILITY_STATUSES.includes(compatibility.status), "cross-feature compatibility status is invalid");
  sortedStrings(compatibility.shared_surface_ids, "cross-feature shared surfaces", {allowEmpty: true});
  sortedStrings(compatibility.check_ids, "cross-feature compatibility checks", {allowEmpty: true});
  requireGitObject(compatibility.source_commit, "cross-feature compatibility commit");
  requireGitObject(compatibility.source_tree, "cross-feature compatibility tree");
  assert(compatibility.source_commit === source.commit && compatibility.source_tree === source.tree, "cross-feature compatibility source differs from candidate");
  requireSafeSummary(compatibility.proof_ceiling, "cross-feature compatibility proof ceiling");
  requireIdentifier(compatibility.next_owner, "cross-feature compatibility next owner");
  if (compatibility.status === "PASSED") assert(compatibility.check_ids.length > 0, "passed cross-feature compatibility requires a check");
  return compatibility;
}

export function compileCrossFeatureCompatibility({status, sharedSurfaceIds = [], checkIds = [], sourceCommit, sourceTree, proofCeiling, nextOwner}) {
  return validateCrossFeatureCompatibility({
    status,
    shared_surface_ids: [...sharedSurfaceIds].sort(compareUtf8),
    check_ids: [...checkIds].sort(compareUtf8),
    source_commit: sourceCommit,
    source_tree: sourceTree,
    proof_ceiling: proofCeiling,
    next_owner: nextOwner,
  }, {commit: sourceCommit, tree: sourceTree});
}

function validateCurrentState(state, generation) {
  exactKeys(state, CURRENT_STATE_KEYS, "current state");
  requireIdentifier(state.candidate_generation_id, "current state candidate generation");
  assert(state.candidate_generation_id === generation.generation_id, "current state candidate generation differs from capsule");
  assert(state.lifecycle === generation.lifecycle, "current state lifecycle differs from candidate generation");
  assert(CURRENT_DISPOSITIONS.includes(state.disposition), "current state disposition is invalid");
  sortedStrings(state.superseded_generation_ids, "current state superseded generations", {allowEmpty: true});
  sortedStrings(state.material_seams, "current state material seams", {allowEmpty: true});
  requireSafeSummary(state.proof_ceiling, "current state proof ceiling");
  requireSafeSummary(state.next_action, "current state next action");
  assert(state.downstream_consumed === false, "current state cannot claim downstream consumption");
  return state;
}

export function compileCurrentState({candidateGenerationId, lifecycle, disposition, supersededGenerationIds = [], materialSeams = [], proofCeiling, nextAction, downstreamConsumed = false}) {
  return {
    candidate_generation_id: candidateGenerationId,
    lifecycle,
    disposition,
    superseded_generation_ids: [...supersededGenerationIds].sort(compareUtf8),
    material_seams: [...materialSeams].sort(compareUtf8),
    proof_ceiling: proofCeiling,
    next_action: nextAction,
    downstream_consumed: downstreamConsumed,
  };
}

function validateSource(source, label) {
  exactKeys(source, SOURCE_KEYS, label);
  requireGitObject(source.commit, `${label} commit`);
  requireGitObject(source.tree, `${label} tree`);
  requireSha(source.working_tree_sha256, `${label} working tree`);
  assert(typeof source.clean === "boolean", `${label} clean flag is invalid`);
  assert(typeof source.pushed === "boolean", `${label} pushed flag is invalid`);
  if (source.pushed) assert(source.clean === true, `${label} pushed source must be clean`);
  return source;
}

export function compileSourceIdentity({commit, tree, workingTreeSha256, clean, pushed}) {
  const source = {commit, tree, working_tree_sha256: workingTreeSha256, clean, pushed};
  validateSource(source, "source identity");
  return source;
}

function validateCandidateGeneration(generation, source) {
  exactKeys(generation, GENERATION_KEYS, "candidate generation");
  requireIdentifier(generation.generation_id, "candidate generation ID");
  requireIdentifier(generation.repository_id, "candidate generation repository");
  assert(CANDIDATE_LIFECYCLES.includes(generation.lifecycle), "candidate generation lifecycle is invalid");
  requireGitObject(generation.source_commit, "candidate generation source commit");
  requireGitObject(generation.source_tree, "candidate generation source tree");
  assert(generation.source_commit === source.commit && generation.source_tree === source.tree, "candidate generation source differs from candidate");
  requireSha(generation.working_tree_sha256, "candidate generation working tree");
  assert(generation.working_tree_sha256 === source.working_tree_sha256, "candidate generation working tree differs from candidate");
  requireSha(generation.configuration_sha256, "candidate generation configuration");
  requireSha(generation.toolchain_sha256, "candidate generation toolchain");
  assert(generation.supersedes_generation_id === null || typeof generation.supersedes_generation_id === "string", "candidate generation predecessor is invalid");
  if (generation.supersedes_generation_id !== null) {
    requireIdentifier(generation.supersedes_generation_id, "candidate generation predecessor");
    assert(generation.supersedes_generation_id !== generation.generation_id, "candidate generation cannot supersede itself");
  }
  if (generation.lifecycle !== "SOURCE_OPEN") assert(source.clean === true, "frozen or running candidate generation requires a clean source");
  return generation;
}

export function compileCandidateGeneration({generationId, repositoryId, lifecycle, sourceCommit, sourceTree, workingTreeSha256, configurationSha256, toolchainSha256, sourceClean, supersedesGenerationId = null}) {
  return validateCandidateGeneration({
    generation_id: generationId,
    repository_id: repositoryId,
    lifecycle,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    working_tree_sha256: workingTreeSha256,
    configuration_sha256: configurationSha256,
    toolchain_sha256: toolchainSha256,
    supersedes_generation_id: supersedesGenerationId,
  }, {commit: sourceCommit, tree: sourceTree, working_tree_sha256: workingTreeSha256, clean: sourceClean, pushed: false});
}

function validateSourceObservation(observation, source, repositoryId) {
  exactKeys(observation, OBSERVATION_KEYS, "source observation");
  requireUtc(observation.observed_at_utc, "source observation time");
  assert(OBSERVATION_ROLES.includes(observation.observed_by_role), "source observation role is invalid");
  requireIdentifier(observation.repository_id, "source observation repository");
  assert(observation.repository_id === repositoryId, "source observation repository differs from candidate");
  requireGitObject(observation.source_commit, "source observation commit");
  requireGitObject(observation.source_tree, "source observation tree");
  assert(observation.source_commit === source.commit && observation.source_tree === source.tree, "source observation source differs from candidate");
  requireSha(observation.working_tree_sha256, "source observation working tree");
  assert(observation.working_tree_sha256 === source.working_tree_sha256, "source observation working tree differs from candidate");
  assert(typeof observation.clean === "boolean" && observation.clean === source.clean, "source observation clean state differs from candidate");
  assert(typeof observation.pushed === "boolean" && observation.pushed === source.pushed, "source observation pushed state differs from candidate");
  requireSha(observation.observation_sha256, "source observation digest");
  assert(observation.observation_sha256 === digestWithout(observation, "observation_sha256"), "source observation digest mismatch");
  return observation;
}

export function compileSourceObservation({observedAtUtc, observedByRole, repositoryId, sourceCommit, sourceTree, workingTreeSha256, clean, pushed}) {
  const observation = {
    observed_at_utc: observedAtUtc,
    observed_by_role: observedByRole,
    repository_id: repositoryId,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    working_tree_sha256: workingTreeSha256,
    clean,
    pushed,
    observation_sha256: null,
  };
  observation.observation_sha256 = digestWithout(observation, "observation_sha256");
  return validateSourceObservation(observation, {commit: sourceCommit, tree: sourceTree, working_tree_sha256: workingTreeSha256, clean, pushed}, repositoryId);
}

function validateScope(scope) {
  exactKeys(scope, SCOPE_KEYS, "claimed scope");
  sortedStrings(scope.in_paths, "claimed scope input paths");
  sortedStrings(scope.out_paths, "claimed scope excluded paths", {allowEmpty: true});
  for (const value of [...scope.in_paths, ...scope.out_paths]) validatePublicReference(value, "claimed scope path");
  assert(scope.in_paths.every((value) => !scope.out_paths.includes(value)), "claimed scope includes an excluded path");
  requireSha(scope.scope_sha256, "claimed scope digest");
  assert(typeof scope.product_writes_allowed === "boolean", "claimed scope product-write flag is invalid");
  assert(typeof scope.external_actions_allowed === "boolean", "claimed scope external-action flag is invalid");
  assert(scope.product_writes_allowed === false, "proof capsule cannot authorize product writes");
  assert(scope.external_actions_allowed === false, "proof capsule cannot authorize external actions");
  assert(scope.scope_sha256 === digestWithout(scope, "scope_sha256"), "claimed scope digest mismatch");
  return scope;
}

export function compileClaimedScope({inPaths, outPaths = [], productWritesAllowed = false, externalActionsAllowed = false}) {
  const scope = {
    in_paths: [...inPaths].sort(compareUtf8),
    out_paths: [...outPaths].sort(compareUtf8),
    scope_sha256: null,
    product_writes_allowed: productWritesAllowed,
    external_actions_allowed: externalActionsAllowed,
  };
  scope.scope_sha256 = digestWithout(scope, "scope_sha256");
  return validateScope(scope);
}

function validateEnvironment(environment, source) {
  exactKeys(environment, ENVIRONMENT_KEYS, "proof environment");
  requireIdentifier(environment.environment_id, "proof environment ID");
  requireSha(environment.capability_sha256, "proof environment capabilities");
  requireSha(environment.runtime_sha256, "proof environment runtime");
  requireGitObject(environment.source_commit, "proof environment source commit");
  requireGitObject(environment.source_tree, "proof environment source tree");
  assert(environment.source_commit === source.commit && environment.source_tree === source.tree, "proof environment source differs from candidate");
  return environment;
}

export function compileProofEnvironment({environmentId, capabilitySha256, runtimeSha256, sourceCommit, sourceTree}) {
  return validateEnvironment({
    environment_id: environmentId,
    capability_sha256: capabilitySha256,
    runtime_sha256: runtimeSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
  }, {commit: sourceCommit, tree: sourceTree});
}

function validateDependency(dependency, label) {
  exactKeys(dependency, DEPENDENCY_KEYS, label);
  requireIdentifier(dependency.dependency_id, `${label} ID`);
  requireIdentifier(dependency.kind, `${label} kind`);
  validatePublicReference(dependency.reference, `${label} reference`);
  requireGitObject(dependency.source_commit, `${label} source commit`);
  requireGitObject(dependency.source_tree, `${label} source tree`);
  requireSha(dependency.dependency_sha256, `${label} digest`);
  sortedStrings(dependency.affects_claim_ids, `${label} affected claims`);
  sortedStrings(dependency.recheck_ids, `${label} rechecks`);
  return dependency;
}

export function compileDependencyClaim({dependencyId, kind, reference, sourceCommit, sourceTree, dependencySha256, affectsClaimIds, recheckIds}) {
  return validateDependency({
    dependency_id: dependencyId,
    kind,
    reference,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    dependency_sha256: dependencySha256,
    affects_claim_ids: [...affectsClaimIds].sort(compareUtf8),
    recheck_ids: [...recheckIds].sort(compareUtf8),
  }, "dependency claim");
}

function validateCheck(check, source, evidenceById) {
  exactKeys(check, CHECK_KEYS, `check ${check.check_id ?? "unknown"}`);
  requireIdentifier(check.check_id, "check ID");
  validatePublicReference(check.check_ref, `check ${check.check_id} reference`);
  assert(CHECK_STATUSES.includes(check.status), `check ${check.check_id} status is invalid`);
  requireGitObject(check.source_commit, `check ${check.check_id} source commit`);
  requireGitObject(check.source_tree, `check ${check.check_id} source tree`);
  assert(check.source_commit === source.commit && check.source_tree === source.tree, `check ${check.check_id} source differs from candidate`);
  requireSha(check.result_sha256, `check ${check.check_id} result`);
  assert(EVIDENCE_KINDS.includes(check.evidence_kind), `check ${check.check_id} evidence kind is invalid`);
  sortedStrings(check.evidence_ids, `check ${check.check_id} evidence`);
  check.evidence_ids.forEach((id) => assert(evidenceById.has(id), `check ${check.check_id} references missing evidence ${id}`));
  if (check.status === "PASS") assert(["DIRECT_OBSERVATION", "DERIVED_RESULT"].includes(check.evidence_kind), `passing check ${check.check_id} lacks observed evidence`);
  if (["NOT_RUN", "UNAVAILABLE"].includes(check.status)) assert(["UNAVAILABLE_RESULT", "UNVERIFIED_ASSERTION"].includes(check.evidence_kind), `non-run check ${check.check_id} has an invalid evidence kind`);
  return check;
}

export function compileProofCheck({checkId, checkRef, status, sourceCommit, sourceTree, resultSha256, evidenceKind, evidenceIds}) {
  return {
    check_id: checkId,
    check_ref: checkRef,
    status,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    result_sha256: resultSha256,
    evidence_kind: evidenceKind,
    evidence_ids: [...evidenceIds].sort(compareUtf8),
  };
}

function validateEvidence(evidence, source) {
  exactKeys(evidence, EVIDENCE_KEYS, `evidence ${evidence.evidence_id ?? "unknown"}`);
  requireIdentifier(evidence.evidence_id, "evidence ID");
  assert(EVIDENCE_KINDS.includes(evidence.kind), `evidence ${evidence.evidence_id} kind is invalid`);
  requireSafeSummary(evidence.summary, `evidence ${evidence.evidence_id} summary`);
  validatePublicReference(evidence.path, `evidence ${evidence.evidence_id} path`);
  requireGitObject(evidence.source_commit, `evidence ${evidence.evidence_id} source commit`);
  requireGitObject(evidence.source_tree, `evidence ${evidence.evidence_id} source tree`);
  assert(evidence.source_commit === source.commit && evidence.source_tree === source.tree, `evidence ${evidence.evidence_id} source differs from candidate`);
  requireSha(evidence.evidence_sha256, `evidence ${evidence.evidence_id} digest`);
  sortedStrings(evidence.claim_ids, `evidence ${evidence.evidence_id} claims`);
  assert(evidence.evidence_sha256 === digestWithout(evidence, "evidence_sha256"), `evidence ${evidence.evidence_id} digest mismatch`);
  return evidence;
}

export function compileProofEvidence({evidenceId, kind, summary, path = null, sourceCommit, sourceTree, claimIds}) {
  const evidence = {
    evidence_id: evidenceId,
    kind,
    summary,
    path,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    evidence_sha256: null,
    claim_ids: [...claimIds].sort(compareUtf8),
  };
  evidence.evidence_sha256 = digestWithout(evidence, "evidence_sha256");
  return validateEvidence(evidence, {commit: sourceCommit, tree: sourceTree});
}

function validateClaim(claim, evidenceById, dependencyById, checkById) {
  exactKeys(claim, CLAIM_KEYS, `claim ${claim.claim_id ?? "unknown"}`);
  requireIdentifier(claim.claim_id, "claim ID");
  assert(CLAIM_STATUSES.includes(claim.status), `claim ${claim.claim_id} status is invalid`);
  sortedStrings(claim.evidence_ids, `claim ${claim.claim_id} evidence`);
  sortedStrings(claim.dependency_ids, `claim ${claim.claim_id} dependencies`, {allowEmpty: true});
  sortedStrings(claim.recheck_ids, `claim ${claim.claim_id} rechecks`);
  claim.evidence_ids.forEach((id) => assert(evidenceById.has(id), `claim ${claim.claim_id} references missing evidence ${id}`));
  claim.dependency_ids.forEach((id) => assert(dependencyById.has(id), `claim ${claim.claim_id} references missing dependency ${id}`));
  claim.recheck_ids.forEach((id) => assert(checkById.has(id), `claim ${claim.claim_id} references missing recheck ${id}`));
  const evidenceKinds = new Set(claim.evidence_ids.map((id) => evidenceById.get(id).kind));
  if (claim.status === "VERIFIED") {
    assert([...evidenceKinds].some((kind) => ["DIRECT_OBSERVATION", "DERIVED_RESULT"].includes(kind)), `verified claim ${claim.claim_id} lacks direct or derived evidence`);
    assert(!evidenceKinds.has("UNAVAILABLE_RESULT") && !evidenceKinds.has("UNVERIFIED_ASSERTION"), `verified claim ${claim.claim_id} relies on unavailable or unverified evidence`);
  }
  if (claim.status === "UNAVAILABLE") assert(evidenceKinds.has("UNAVAILABLE_RESULT"), `unavailable claim ${claim.claim_id} lacks unavailable evidence`);
  if (claim.status === "UNVERIFIED") assert(evidenceKinds.has("UNVERIFIED_ASSERTION"), `unverified claim ${claim.claim_id} lacks assertion evidence`);
  return claim;
}

export function compileProofClaim({claimId, status, evidenceIds, dependencyIds = [], recheckIds}) {
  return {
    claim_id: claimId,
    status,
    evidence_ids: [...evidenceIds].sort(compareUtf8),
    dependency_ids: [...dependencyIds].sort(compareUtf8),
    recheck_ids: [...recheckIds].sort(compareUtf8),
  };
}

function validateRollback(rollback) {
  exactKeys(rollback, ROLLBACK_KEYS, "rollback information");
  assert(typeof rollback.available === "boolean", "rollback availability is invalid");
  validatePublicReference(rollback.plan_ref, "rollback plan reference");
  requireSha(rollback.checkpoint_sha256, "rollback checkpoint");
  assert(rollback.owner_approval_required === true, "rollback requires owner approval");
  assert(rollback.activation_allowed === false, "rollback information cannot authorize activation");
  if (rollback.available) assert(rollback.plan_ref !== null, "available rollback requires a plan reference");
  return rollback;
}

export function compileRollbackInformation({available, planRef = null, checkpointSha256, ownerApprovalRequired = true, activationAllowed = false}) {
  return validateRollback({
    available,
    plan_ref: planRef,
    checkpoint_sha256: checkpointSha256,
    owner_approval_required: ownerApprovalRequired,
    activation_allowed: activationAllowed,
  });
}

function validateRisk(risk, index) {
  exactKeys(risk, RISK_KEYS, `residual risk ${index}`);
  requireIdentifier(risk.risk_id, `residual risk ${index} ID`);
  assert(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(risk.severity), `residual risk ${risk.risk_id} severity is invalid`);
  requireSafeSummary(risk.summary, `residual risk ${risk.risk_id} summary`);
  assert(["RECHECK", "OWNER", "HARD_STOP", "DEFERRED"].includes(risk.route), `residual risk ${risk.risk_id} route is invalid`);
}

function validateHandoff(handoff, auditorId, evidenceById, generation, currentState) {
  exactKeys(handoff, HANDOFF_KEYS, "typed handoff");
  requireIdentifier(handoff.phase, "typed handoff phase");
  assert(["READY_FOR_INDEPENDENT_CLEARANCE", "OPEN_REPAIR", "UNAVAILABLE", "HARD_STOP", "INVALIDATED"].includes(handoff.result), "typed handoff result is invalid");
  assert(["INDEPENDENT_AUDITOR", "CAMPAIGN_ORCHESTRATOR", "OWNER", "NONE"].includes(handoff.next_handoff), "typed handoff destination is invalid");
  requireIdentifier(handoff.candidate_generation_id, "typed handoff candidate generation");
  assert(handoff.candidate_generation_id === generation.generation_id, "typed handoff candidate generation differs from capsule");
  requireSafeSummary(handoff.proof_ceiling, "typed handoff proof ceiling");
  assert(handoff.proof_ceiling === currentState.proof_ceiling, "typed handoff proof ceiling differs from current state");
  assert(handoff.downstream_consumed === false, "typed handoff cannot claim downstream consumption");
  exactKeys(handoff.independent_check, HANDOFF_CHECK_KEYS, "typed handoff independent check");
  assert(["PENDING", "PASSED", "FAILED", "UNAVAILABLE"].includes(handoff.independent_check.status), "typed handoff independent check status is invalid");
  assert(handoff.independent_check.auditor_id === auditorId, "typed handoff Auditor differs from capsule Auditor");
  requireSha(handoff.independent_check.evidence_sha256, "typed handoff independent evidence");
  sortedStrings(handoff.evidence_ids, "typed handoff evidence");
  handoff.evidence_ids.forEach((id) => assert(evidenceById.has(id), `typed handoff references missing evidence ${id}`));
  requireSafeSummary(handoff.summary, "typed handoff summary");
  if (handoff.result === "READY_FOR_INDEPENDENT_CLEARANCE") assert(handoff.next_handoff === "INDEPENDENT_AUDITOR", "ready handoff must target independent Auditor");
  if (handoff.result === "INVALIDATED") assert(handoff.next_handoff !== "NONE", "invalidated handoff must name a recovery destination");
  return handoff;
}

export function compileTypedHandoff({phase, result, nextHandoff, auditorId, independentStatus = "PENDING", independentEvidenceSha256, evidenceIds, summary, candidateGenerationId, proofCeiling, downstreamConsumed = false}) {
  const handoff = {
    phase,
    result,
    next_handoff: nextHandoff,
    independent_check: {status: independentStatus, auditor_id: auditorId, evidence_sha256: independentEvidenceSha256},
    evidence_ids: [...evidenceIds].sort(compareUtf8),
    summary,
    candidate_generation_id: candidateGenerationId,
    proof_ceiling: proofCeiling,
    downstream_consumed: downstreamConsumed,
  };
  return handoff;
}

function buildInvalidationRules({claims, dependencies, checks}) {
  const claimIds = claims.map((claim) => claim.claim_id).sort(compareUtf8);
  const checkIds = checks.map((check) => check.check_id).sort(compareUtf8);
  const rules = [{
    rule_id: "SOURCE_CHANGE",
    trigger_kind: "SOURCE_CHANGE",
    trigger_ids: ["SOURCE"],
    affected_claim_ids: claimIds,
    required_recheck_ids: checkIds,
  }, {
    rule_id: "ENVIRONMENT_CHANGE",
    trigger_kind: "ENVIRONMENT_CHANGE",
    trigger_ids: ["ENVIRONMENT"],
    affected_claim_ids: claimIds,
    required_recheck_ids: checkIds,
  }, {
    rule_id: "SCOPE_CHANGE",
    trigger_kind: "SCOPE_CHANGE",
    trigger_ids: ["SCOPE"],
    affected_claim_ids: claimIds,
    required_recheck_ids: checkIds,
  }];
  for (const dependency of dependencies) {
    rules.push({
      rule_id: `DEPENDENCY_${dependency.dependency_id}`,
      trigger_kind: "DEPENDENCY_CHANGE",
      trigger_ids: [dependency.dependency_id],
      affected_claim_ids: [...dependency.affects_claim_ids].sort(compareUtf8),
      required_recheck_ids: [...dependency.recheck_ids].sort(compareUtf8),
    });
  }
  return rules.sort((left, right) => compareUtf8(left.rule_id, right.rule_id));
}

function validateInvalidationRule(rule, claimById, checkById) {
  exactKeys(rule, INVAL_RULE_KEYS, `invalidation rule ${rule.rule_id ?? "unknown"}`);
  requireIdentifier(rule.rule_id, "invalidation rule ID");
  assert(["SOURCE_CHANGE", "DEPENDENCY_CHANGE", "ENVIRONMENT_CHANGE", "SCOPE_CHANGE"].includes(rule.trigger_kind), `invalidation rule ${rule.rule_id} trigger is invalid`);
  sortedStrings(rule.trigger_ids, `invalidation rule ${rule.rule_id} triggers`);
  sortedStrings(rule.affected_claim_ids, `invalidation rule ${rule.rule_id} claims`);
  sortedStrings(rule.required_recheck_ids, `invalidation rule ${rule.rule_id} rechecks`);
  rule.affected_claim_ids.forEach((id) => assert(claimById.has(id), `invalidation rule ${rule.rule_id} references missing claim ${id}`));
  rule.required_recheck_ids.forEach((id) => assert(checkById.has(id), `invalidation rule ${rule.rule_id} references missing check ${id}`));
}

function validateInvalidationEvent(event, claimById, checkById) {
  exactKeys(event, INVAL_EVENT_KEYS, `invalidation event ${event.event_id ?? "unknown"}`);
  requireIdentifier(event.event_id, "invalidation event ID");
  assert(typeof event.source_changed === "boolean", "invalidation event source flag is invalid");
  assert(typeof event.environment_changed === "boolean", "invalidation event environment flag is invalid");
  assert(typeof event.scope_changed === "boolean", "invalidation event scope flag is invalid");
  sortedStrings(event.changed_dependency_ids, `invalidation event ${event.event_id} dependencies`, {allowEmpty: true});
  sortedStrings(event.affected_claim_ids, `invalidation event ${event.event_id} claims`);
  sortedStrings(event.required_recheck_ids, `invalidation event ${event.event_id} rechecks`);
  assert(Array.isArray(event.prior_claims) && event.prior_claims.length === event.affected_claim_ids.length, `invalidation event ${event.event_id} prior claims are incomplete`);
  const priorIds = event.prior_claims.map((claim) => claim.claim_id);
  sortedStrings(priorIds, `invalidation event ${event.event_id} prior claims`);
  assert(JSON.stringify(priorIds) === JSON.stringify(event.affected_claim_ids), `invalidation event ${event.event_id} prior claims differ from affected claims`);
  event.prior_claims.forEach((claim) => {
    exactKeys(claim, ["claim_id", "status"], `invalidation event ${event.event_id} prior claim`);
    assert(CLAIM_STATUSES.includes(claim.status) && claim.status !== "INVALIDATED", `invalidation event ${event.event_id} prior claim status is invalid`);
    assert(claimById.has(claim.claim_id), `invalidation event ${event.event_id} references missing prior claim`);
  });
  event.required_recheck_ids.forEach((id) => assert(checkById.has(id), `invalidation event ${event.event_id} references missing check`));
  requireSha(event.previous_capsule_sha256, `invalidation event ${event.event_id} previous capsule`);
  requireSafeSummary(event.cause, `invalidation event ${event.event_id} cause`);
  requireUtc(event.observed_at_utc, `invalidation event ${event.event_id} time`);
  requireSha(event.event_sha256, `invalidation event ${event.event_id} digest`);
  assert(event.event_sha256 === digestWithout(event, "event_sha256"), `invalidation event ${event.event_id} digest mismatch`);
}

export function deriveRequiredRechecks(capsule, {sourceChanged = false, environmentChanged = false, scopeChanged = false, changedDependencyIds = []} = {}) {
  validateProofCapsule(capsule);
  sortedStrings([...changedDependencyIds].sort(compareUtf8), "changed dependency IDs", {allowEmpty: true});
  const changed = new Set(changedDependencyIds);
  const affectedClaims = new Set();
  const rechecks = new Set();
  for (const rule of capsule.invalidation.rules) {
    const applies = (sourceChanged && rule.trigger_kind === "SOURCE_CHANGE")
      || (environmentChanged && rule.trigger_kind === "ENVIRONMENT_CHANGE")
      || (scopeChanged && rule.trigger_kind === "SCOPE_CHANGE")
      || (rule.trigger_kind === "DEPENDENCY_CHANGE" && rule.trigger_ids.some((id) => changed.has(id)));
    if (applies) {
      rule.affected_claim_ids.forEach((id) => affectedClaims.add(id));
      rule.required_recheck_ids.forEach((id) => rechecks.add(id));
    }
  }
  assert(affectedClaims.size > 0, "change does not match any invalidation rule");
  return {
    affected_claim_ids: [...affectedClaims].sort(compareUtf8),
    required_recheck_ids: [...rechecks].sort(compareUtf8),
  };
}

export function validateProofCapsule(capsule, {currentSourceCommit, currentSourceTree, currentDependencyDigests} = {}) {
  exactKeys(capsule, CAPSULE_KEYS, "proof capsule");
  assert(capsule.schema === PROOF_CAPSULE_SCHEMA, "proof capsule schema mismatch");
  assert(capsule.version === 1, "proof capsule version mismatch");
  assert(["PREPARED_NOT_ACTIVATED", "VERIFIED_NOT_ACTIVATED", "INVALIDATED"].includes(capsule.status), "proof capsule status is invalid");
  assert(capsule.contract_status === PROOF_CONTRACT_STATUS, "proof capsule is active or has an invalid contract status");
  requireIdentifier(capsule.capsule_id, "proof capsule ID");
  requireSha(capsule.project_governance_sha256, "proof capsule project governance");
  requireIdentifier(capsule.builder_id, "proof capsule builder");
  requireIdentifier(capsule.auditor_id, "proof capsule Auditor");
  assert(capsule.builder_id !== capsule.auditor_id, "proof capsule Auditor cannot be the builder");
  assert(capsule.accepted_by === null || typeof capsule.accepted_by === "string", "proof capsule acceptor must be null or a string");
  if (capsule.accepted_by !== null) {
    requireIdentifier(capsule.accepted_by, "proof capsule acceptor");
    assert(capsule.accepted_by !== capsule.builder_id && capsule.accepted_by !== capsule.auditor_id, "proof capsule acceptor must be independent");
  }
  validateSource(capsule.source_before, "proof capsule source before");
  validateSource(capsule.source_after, "proof capsule source after");
  assert(capsule.downstream_consumed === false, "proof capsule cannot claim downstream consumption");
  validateCandidateGeneration(capsule.candidate_generation, capsule.source_after);
  validateSourceObservation(capsule.source_observation, capsule.source_after, capsule.candidate_generation.repository_id);
  if (currentSourceCommit !== undefined || currentSourceTree !== undefined) {
    requireGitObject(currentSourceCommit, "current proof source commit");
    requireGitObject(currentSourceTree, "current proof source tree");
    assert(capsule.source_after.commit === currentSourceCommit && capsule.source_after.tree === currentSourceTree, "proof capsule source is stale");
  }
  validateScope(capsule.claimed_scope);
  sortedStrings(capsule.changed_paths, "proof capsule changed paths");
  capsule.changed_paths.forEach((value) => validatePublicReference(value, "proof capsule changed path"));
  assert(capsule.changed_paths.every((value) => capsule.claimed_scope.in_paths.includes(value)), "proof capsule changed path leaves claimed scope");
  validateEnvironment(capsule.environment, capsule.source_after);
  validateSeamRegistration(capsule.seam_registration);
  validateCrossFeatureCompatibility(capsule.cross_feature_compatibility, capsule.source_after);
  validateCurrentState(capsule.current_state, capsule.candidate_generation);
  assert(Array.isArray(capsule.dependencies), "proof capsule dependencies must be an array");
  const dependencyById = new Map();
  for (const [index, dependency] of capsule.dependencies.entries()) {
    validateDependency(dependency, `dependency ${index}`);
    assert(dependency.source_commit === capsule.source_after.commit && dependency.source_tree === capsule.source_after.tree, `dependency ${dependency.dependency_id} source differs from candidate`);
    assert(!dependencyById.has(dependency.dependency_id), `dependency ${dependency.dependency_id} is duplicated`);
    dependencyById.set(dependency.dependency_id, dependency);
  }
  sortedStrings(capsule.dependencies.map((dependency) => dependency.dependency_id), "proof capsule dependencies", {allowEmpty: true});
  const evidenceById = new Map();
  assert(Array.isArray(capsule.evidence) && capsule.evidence.length > 0, "proof capsule evidence is required");
  for (const [index, evidence] of capsule.evidence.entries()) {
    validateEvidence(evidence, capsule.source_after);
    assert(!evidenceById.has(evidence.evidence_id), `evidence ${evidence.evidence_id} is duplicated`);
    evidenceById.set(evidence.evidence_id, evidence);
  }
  sortedStrings(capsule.evidence.map((evidence) => evidence.evidence_id), "proof capsule evidence");
  const checkById = new Map();
  assert(Array.isArray(capsule.checks) && capsule.checks.length > 0, "proof capsule checks are required");
  for (const [index, check] of capsule.checks.entries()) {
    validateCheck(check, capsule.source_after, evidenceById);
    assert(!checkById.has(check.check_id), `check ${check.check_id} is duplicated`);
    checkById.set(check.check_id, check);
  }
  sortedStrings(capsule.checks.map((check) => check.check_id), "proof capsule checks");
  capsule.cross_feature_compatibility.check_ids.forEach((id) => assert(checkById.has(id), `cross-feature compatibility references missing check ${id}`));
  const claimById = new Map();
  assert(Array.isArray(capsule.claims) && capsule.claims.length > 0, "proof capsule claims are required");
  for (const [index, claim] of capsule.claims.entries()) {
    validateClaim(claim, evidenceById, dependencyById, checkById);
    assert(!claimById.has(claim.claim_id), `claim ${claim.claim_id} is duplicated`);
    claimById.set(claim.claim_id, claim);
  }
  sortedStrings(capsule.claims.map((claim) => claim.claim_id), "proof capsule claims");
  for (const evidence of capsule.evidence) {
    for (const claimId of evidence.claim_ids) {
      assert(claimById.has(claimId), `evidence ${evidence.evidence_id} references missing claim ${claimId}`);
      assert(claimById.get(claimId).evidence_ids.includes(evidence.evidence_id), `claim ${claimId} does not retain evidence ${evidence.evidence_id}`);
    }
  }
  for (const dependency of capsule.dependencies) {
    dependency.affects_claim_ids.forEach((claimId) => assert(claimById.has(claimId), `dependency ${dependency.dependency_id} references missing claim ${claimId}`));
    dependency.recheck_ids.forEach((checkId) => assert(checkById.has(checkId), `dependency ${dependency.dependency_id} references missing check ${checkId}`));
  }
  validateRollback(capsule.rollback);
  assert(Array.isArray(capsule.residual_risks), "proof capsule residual risks must be an array");
  const riskIds = [];
  for (const [index, risk] of capsule.residual_risks.entries()) {
    validateRisk(risk, index);
    riskIds.push(risk.risk_id);
  }
  sortedStrings(riskIds, "proof capsule residual risks", {allowEmpty: true});
  validateHandoff(capsule.handoff, capsule.auditor_id, evidenceById, capsule.candidate_generation, capsule.current_state);
  exactKeys(capsule.invalidation, ["rules", "events"], "proof capsule invalidation");
  assert(Array.isArray(capsule.invalidation.rules) && capsule.invalidation.rules.length > 0, "proof capsule invalidation rules are required");
  const ruleIds = [];
  for (const rule of capsule.invalidation.rules) {
    validateInvalidationRule(rule, claimById, checkById);
    ruleIds.push(rule.rule_id);
  }
  sortedStrings(ruleIds, "proof capsule invalidation rules");
  for (const requiredRule of ["SOURCE_CHANGE", "ENVIRONMENT_CHANGE", "SCOPE_CHANGE"]) {
    assert(ruleIds.includes(requiredRule), `proof capsule is missing ${requiredRule.toLowerCase()} invalidation`);
  }
  for (const dependency of capsule.dependencies) {
    assert(capsule.invalidation.rules.some((rule) => rule.trigger_kind === "DEPENDENCY_CHANGE" && rule.trigger_ids.includes(dependency.dependency_id)), `dependency ${dependency.dependency_id} lacks invalidation coverage`);
  }
  assert(Array.isArray(capsule.invalidation.events), "proof capsule invalidation events must be an array");
  const eventIds = [];
  for (const event of capsule.invalidation.events) {
    validateInvalidationEvent(event, claimById, checkById);
    eventIds.push(event.event_id);
  }
  sortedStrings(eventIds, "proof capsule invalidation events", {allowEmpty: true});
  exactKeys(capsule.protected_actions, Object.keys(PROTECTED_ACTIONS), "proof capsule protected actions");
  assert(JSON.stringify(capsule.protected_actions) === JSON.stringify(PROTECTED_ACTIONS), "proof capsule protected actions are not all disabled");
  if (capsule.status === "VERIFIED_NOT_ACTIVATED") {
    assert(capsule.candidate_generation.lifecycle === "PROOF_TERMINAL", "verified proof capsule is not at proof terminal");
    assert(capsule.handoff.independent_check.status === "PASSED", "verified proof capsule lacks an independent pass");
    assert(capsule.accepted_by !== null, "verified proof capsule lacks an independent acceptor");
    assert(capsule.handoff.result === "READY_FOR_INDEPENDENT_CLEARANCE", "verified proof capsule handoff result is not ready");
    assert(capsule.claims.every((claim) => claim.status === "VERIFIED"), "verified proof capsule contains an unresolved claim");
    assert(capsule.checks.every((check) => check.status === "PASS"), "verified proof capsule contains a non-passing check");
  }
  if (capsule.status === "INVALIDATED") assert(capsule.handoff.result === "INVALIDATED", "invalidated proof capsule handoff is not invalidated");
  if (currentDependencyDigests !== undefined) {
    for (const dependency of capsule.dependencies) {
      if (Object.hasOwn(currentDependencyDigests, dependency.dependency_id)) {
        assert(currentDependencyDigests[dependency.dependency_id] === dependency.dependency_sha256, `dependency ${dependency.dependency_id} is stale`);
      }
    }
  }
  requireSha(capsule.capsule_sha256, "proof capsule digest");
  assert(capsule.capsule_sha256 === digestWithout(capsule, "capsule_sha256"), "proof capsule digest mismatch");
  return capsule;
}

function defaultInvalidationRules({claims, dependencies, checks}) {
  return buildInvalidationRules({claims, dependencies, checks});
}

export function compileProofCapsule({
  capsuleId,
  repositoryId,
  projectGovernanceSha256,
  builderId,
  auditorId,
  acceptedBy = null,
  sourceBefore,
  sourceAfter,
  candidateGeneration = null,
  observedAtUtc,
  observedByRole = "BUILDER",
  sourceObservation = null,
  claimedScope,
  changedPaths,
  environment,
  dependencies = [],
  checks,
  evidence,
  claims,
  rollback,
  residualRisks = [],
  handoff,
  seamRegistration = null,
  crossFeatureCompatibility = null,
  currentState: currentStateInput = null,
  invalidationRules = null,
  status = "PREPARED_NOT_ACTIVATED",
}) {
  validateSource(sourceAfter, "proof capsule source after");
  const resolvedGeneration = candidateGeneration ?? {
    generation_id: `${capsuleId}-GEN-1`,
    repository_id: repositoryId,
    lifecycle: sourceAfter.clean ? "CANDIDATE_FROZEN" : "SOURCE_OPEN",
    source_commit: sourceAfter.commit,
    source_tree: sourceAfter.tree,
    working_tree_sha256: sourceAfter.working_tree_sha256,
    configuration_sha256: projectGovernanceSha256,
    toolchain_sha256: environment.runtime_sha256,
    supersedes_generation_id: null,
  };
  const resolvedObservation = sourceObservation ?? compileSourceObservation({
    observedAtUtc,
    observedByRole,
    repositoryId,
    sourceCommit: sourceAfter.commit,
    sourceTree: sourceAfter.tree,
    workingTreeSha256: sourceAfter.working_tree_sha256,
    clean: sourceAfter.clean,
    pushed: sourceAfter.pushed,
  });
  const resolvedSeamRegistration = seamRegistration ?? compileSeamRegistration({
    primaryOwner: "CENTRAL_INTEGRATION",
    disposition: "CENTRAL_SEQUENCE_REQUIRED",
  });
  const resolvedCompatibility = crossFeatureCompatibility ?? compileCrossFeatureCompatibility({
    status: "OUT_OF_SCOPE_PROOF_DEFERRED",
    sourceCommit: sourceAfter.commit,
    sourceTree: sourceAfter.tree,
    proofCeiling: "CUMULATIVE_PLATFORM_COMPATIBILITY_UNPROVEN",
    nextOwner: "CAMPAIGN_ORCHESTRATOR",
  });
  const resolvedCurrentState = currentStateInput ?? compileCurrentState({
    candidateGenerationId: resolvedGeneration.generation_id,
    lifecycle: resolvedGeneration.lifecycle,
    disposition: "WORKING_EXPECTED",
    materialSeams: ["CENTRAL_CUMULATIVE_COMPATIBILITY"],
    proofCeiling: "FUNCTIONAL_AND_CUMULATIVE_COMPATIBILITY_CHECKS_PENDING",
    nextAction: "RUN_FOCUSED_VERIFIERS_ON_EXACT_CANDIDATE",
  });
  const resolvedHandoff = {
    ...handoff,
    candidate_generation_id: handoff.candidate_generation_id ?? resolvedGeneration.generation_id,
    proof_ceiling: handoff.proof_ceiling ?? resolvedCurrentState.proof_ceiling,
    downstream_consumed: false,
  };
  const normalizedDependencies = [...dependencies].sort((left, right) => compareUtf8(left.dependency_id, right.dependency_id));
  const normalizedChecks = [...checks].sort((left, right) => compareUtf8(left.check_id, right.check_id));
  const normalizedEvidence = [...evidence].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  const normalizedClaims = [...claims].sort((left, right) => compareUtf8(left.claim_id, right.claim_id));
  const capsule = {
    schema: PROOF_CAPSULE_SCHEMA,
    version: 1,
    contract_status: PROOF_CONTRACT_STATUS,
    status,
    capsule_id: capsuleId,
    project_governance_sha256: projectGovernanceSha256,
    builder_id: builderId,
    auditor_id: auditorId,
    accepted_by: acceptedBy,
    source_before: sourceBefore,
    source_after: sourceAfter,
    candidate_generation: resolvedGeneration,
    source_observation: resolvedObservation,
    claimed_scope: claimedScope,
    changed_paths: [...changedPaths].sort(compareUtf8),
    environment,
    dependencies: normalizedDependencies,
    checks: normalizedChecks,
    evidence: normalizedEvidence,
    claims: normalizedClaims,
    rollback,
    seam_registration: resolvedSeamRegistration,
    cross_feature_compatibility: resolvedCompatibility,
    current_state: resolvedCurrentState,
    downstream_consumed: false,
    invalidation: {rules: invalidationRules ?? defaultInvalidationRules({claims: normalizedClaims, dependencies: normalizedDependencies, checks: normalizedChecks}), events: []},
    residual_risks: [...residualRisks].sort((left, right) => compareUtf8(left.risk_id, right.risk_id)),
    handoff: resolvedHandoff,
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    capsule_sha256: null,
  };
  capsule.capsule_sha256 = digestWithout(capsule, "capsule_sha256");
  return validateProofCapsule(capsule);
}

export function invalidateProofCapsule(capsule, {
  eventId,
  sourceChanged = false,
  environmentChanged = false,
  scopeChanged = false,
  changedDependencyIds = [],
  cause,
  observedAtUtc,
} = {}) {
  validateProofCapsule(capsule);
  requireIdentifier(eventId, "invalidation event ID");
  requireSafeSummary(cause, "invalidation cause");
  requireUtc(observedAtUtc, "invalidation time");
  const normalizedDependencies = [...changedDependencyIds].sort(compareUtf8);
  const change = deriveRequiredRechecks(capsule, {sourceChanged, environmentChanged, scopeChanged, changedDependencyIds: normalizedDependencies});
  const priorClaims = capsule.claims
    .filter((claim) => change.affected_claim_ids.includes(claim.claim_id))
    .map((claim) => ({claim_id: claim.claim_id, status: claim.status}))
    .sort((left, right) => compareUtf8(left.claim_id, right.claim_id));
  const event = {
    event_id: eventId,
    source_changed: sourceChanged,
    environment_changed: environmentChanged,
    scope_changed: scopeChanged,
    changed_dependency_ids: normalizedDependencies,
    affected_claim_ids: change.affected_claim_ids,
    required_recheck_ids: change.required_recheck_ids,
    prior_claims: priorClaims,
    previous_capsule_sha256: capsule.capsule_sha256,
    cause,
    observed_at_utc: observedAtUtc,
    event_sha256: null,
  };
  event.event_sha256 = digestWithout(event, "event_sha256");
  const next = structuredClone(capsule);
  next.status = "INVALIDATED";
  const invalidatedLifecycle = next.candidate_generation.lifecycle === "SOURCE_OPEN" ? "SOURCE_OPEN" : "PROOF_TERMINAL";
  next.candidate_generation = {...next.candidate_generation, lifecycle: invalidatedLifecycle};
  next.claims = next.claims.map((claim) => change.affected_claim_ids.includes(claim.claim_id)
    ? {...claim, status: "INVALIDATED"}
    : claim);
  next.invalidation.events = [...next.invalidation.events, event].sort((left, right) => compareUtf8(left.event_id, right.event_id));
  next.handoff = {
    ...next.handoff,
    result: "INVALIDATED",
    next_handoff: "CAMPAIGN_ORCHESTRATOR",
    independent_check: {...next.handoff.independent_check, status: "PENDING"},
    proof_ceiling: "INVALIDATED_REQUIRES_NEW_GENERATION",
    downstream_consumed: false,
    summary: "Candidate proof is invalidated; recheck the named claims before a fresh capsule can be considered.",
  };
  next.current_state = compileCurrentState({
    candidateGenerationId: next.candidate_generation.generation_id,
    lifecycle: invalidatedLifecycle,
    disposition: invalidatedLifecycle === "SOURCE_OPEN" ? "WORKING_EXPECTED" : "TERMINAL_PRESERVED",
    supersededGenerationIds: next.current_state.superseded_generation_ids,
    materialSeams: next.current_state.material_seams,
    proofCeiling: "INVALIDATED_REQUIRES_NEW_GENERATION",
    nextAction: "MINT_NEW_CANDIDATE_GENERATION",
  });
  next.downstream_consumed = false;
  next.capsule_sha256 = digestWithout(next, "capsule_sha256");
  return validateProofCapsule(next);
}
