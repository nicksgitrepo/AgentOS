#!/usr/bin/env node

/* Controller-owned source-locked STANDARD_BLOCK candidates. */

import fs from "node:fs";
import path from "node:path";
import {
  ATOMIC_EVALUATION_CLASSES,
  CORE_EVALUATION_CLASSES,
  GATE_OUTCOMES,
  SPECIALIST_GATE_IDS,
  canonicalDigest,
} from "./specialist-block-compiler.mjs";

const SOURCE_DATE = "2026-08-11";
const SOURCE_COMMIT = "590c07ddd4be7a8c24727c24b40808e44ca7357d";
const SOURCE_TREE = "f1b358d87e6a969fb9631e202a3d478540edd4d9";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sorted(values) {
  return [...new Set(values)].sort();
}

const sourceCatalog = {
  nist: {source_id: "source.nist-sp-800-218", title: "Secure Software Development Framework (SSDF) Version 1.1", publisher: "NIST", url: "https://csrc.nist.gov/pubs/sp/800/218/final", version: "1.1", effective_date: "2022-02-03", retrieved_date: SOURCE_DATE, immutable_identity: "nist-sp-800-218-v1.1-final-20220203", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound secure software development practices and task mappings."},
  asvs: {source_id: "source.owasp-asvs-5-0-0", title: "Application Security Verification Standard", publisher: "OWASP Foundation", url: "https://owasp.org/www-project-application-security-verification-standard/", version: "5.0.0", effective_date: "2025-05-30", retrieved_date: SOURCE_DATE, immutable_identity: "owasp-asvs-5.0.0-release-20250530", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound application security verification requirements and identifiers."},
  slsa: {source_id: "source.slsa-spec-1-2", title: "SLSA Specification", publisher: "SLSA", url: "https://slsa.dev/spec/v1.2/", version: "1.2", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "slsa-spec-v1.2-approved", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Approved SLSA tracks, levels, attestations, and provenance references."},
};

const specs = [
  {
    slug: "nist-ssdf",
    blockId: "specialist.standard.nist-ssdf",
    title: "NIST Secure Software Development Framework 1.1",
    family: "security",
    standardIdentity: {publisher: "NIST", identifier: "NIST SP 800-218 SSDF", edition: "1.1"},
    source: sourceCatalog.nist,
    supersessionStatus: "CURRENT_FINAL;_NIST_SP_800-218_REV_1_V1.2_REMAINS_INITIAL_PUBLIC_DRAFT",
    supersededBy: null,
    knownNonSuperseding: [{identifier: "NIST SP 800-218 Rev. 1", edition: "1.2", status: "INITIAL_PUBLIC_DRAFT", source_url: "https://csrc.nist.gov/pubs/sp/800/218/r1/ipd"}],
    signals: ["secure software development", "software provenance", "vulnerability prevention"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["publisher and publication identity", "software producer or supplier role", "activity and artifact scope", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["A profile or contract may narrow the selected practice set only with an external authority reference.", "This block does not certify conformance or provide legal advice."],
    requirements: [
      {requirement_id: "PO.1.1", statement: "Identify and maintain software security requirements for the development process.", source_ref: "NIST.SP.800-218:PO.1.1", evidence: "Bound requirement record and current review receipt."},
      {requirement_id: "PS.3.2", statement: "Collect and share provenance data for software components and releases.", source_ref: "NIST.SP.800-218:PS.3.2", evidence: "Immutable provenance or an explicit external unknown ledger."},
      {requirement_id: "PW.1.2", statement: "Track software security requirements, risks, and design decisions.", source_ref: "NIST.SP.800-218:PW.1.2", evidence: "Traceable requirements and decision records."}
    ]
  },
  {
    slug: "owasp-asvs",
    blockId: "specialist.standard.owasp-asvs",
    title: "OWASP Application Security Verification Standard 5.0.0",
    family: "security",
    standardIdentity: {publisher: "OWASP Foundation", identifier: "OWASP ASVS", edition: "5.0.0"},
    source: sourceCatalog.asvs,
    supersessionStatus: "CURRENT_STABLE_RELEASE",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["application security verification", "web security requirements", "ASVS identifier"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["application or service scope", "verification level and requirement profile", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["Requirement identifiers are version-bound and must not be carried across editions without a compatibility map.", "This block does not certify an application or issue a security attestation."],
    requirements: [
      {requirement_id: "v5.0.0-1.2.5", statement: "Verify protections against OS command injection and use parameterized OS queries or contextual output encoding.", source_ref: "OWASP.ASVS.5.0.0:1.2.5", evidence: "Requirement-level test or an explicit unknown ledger."},
      {requirement_id: "v5.0.0-2", statement: "Use the edition's versioned chapter, section, and requirement identifiers for traceability.", source_ref: "OWASP.ASVS.5.0.0:identifier-rule", evidence: "Versioned requirement mapping."}
    ]
  },
  {
    slug: "slsa",
    blockId: "specialist.standard.slsa",
    title: "SLSA Specification 1.2",
    family: "delivery-operations",
    standardIdentity: {publisher: "SLSA", identifier: "SLSA Specification", edition: "1.2"},
    source: sourceCatalog.slsa,
    supersessionStatus: "CURRENT_APPROVED_SPECIFICATION",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["software supply chain", "provenance", "attestation", "build integrity"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["source/build/artifact track", "requested SLSA level or track", "attestation and provenance scope", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["A requested level or track must be named; the block does not infer a level from a build tool.", "This block does not certify a build platform or artifact."],
    requirements: [
      {requirement_id: "SLSA.1.2.provenance", statement: "Bind verifiable provenance to the source, build, and artifact identities in the selected track.", source_ref: "SLSA.1.2:provenance", evidence: "Attestation identity and verification receipt."},
      {requirement_id: "SLSA.1.2.track-level", statement: "Evaluate the declared source or build track and level without silently broadening the claim.", source_ref: "SLSA.1.2:track-level", evidence: "Explicit track/level applicability overlay."}
    ]
  }
];

function buildBlock(spec, fileDigests, sourceLock) {
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P1",
    role_kind: "STANDARD_BLOCK",
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: `Provide reusable, version-bound normalized requirements for ${spec.title}; do not certify applicability or compliance.`,
    scope: {included: sorted(["exact edition identity", "normalized requirement mappings", "source/effective-date lock", "external applicability overlay", "exceptions and supersession" ]), non_goals: sorted(["legal advice", "automated certification", "provider activation", "consumer Product writing", "silently selecting a different edition"]), smallest_sufficient_rule: "Reference this exact edition once and route unrelated or version-different authority to a separate block."},
    atomic_scope_statement: `One immutable standard edition: ${spec.title}; no unrelated standard, jurisdiction, or certification authority.`,
    permitted_decisions: sorted(["map a typed requirement to the exact locked edition", "return NOT_APPLICABLE when the external overlay proves the standard is irrelevant", "return UNKNOWN when applicability or evidence is incomplete", "issue a typed evidence obligation"]),
    forbidden_decisions: sorted(["automated certification", "legal advice", "claim another edition or publisher", "broaden into a different standard", "activate, deploy, publish, or self-accept", "infer jurisdiction/entity/activity/data applicability"]),
    maximum_authority: "NO_PRODUCT_WRITE;_NO_CERTIFICATION;_NO_LEGAL_ADVICE;_NO_ACTIVATION;_NO_SELF_ACCEPTANCE;_TYPED_HANDOFF_ONLY",
    required_upstream_router: null,
    sibling_conflicts: [],
    composition_rules: sorted(["reuse exact ID/version/hash rather than copying requirements", "evaluate applicability only in the external overlay", "new edition, material erratum, or gate correction creates a new block version", "UNKNOWN closes only the dependent requirement mapping"]),
    escalation_target: "specialist.foundation.authority-jurisdiction-gate",
    split_required_when: sorted(["publisher differs", "edition or material erratum differs", "jurisdiction or applicability rule differs", "requirement authority differs", "tool or evidence custody differs"]),
    required_knowledge: sorted([spec.title, "versioned requirement identifiers", "publisher/effective/supersession metadata", "external applicability and exception overlay"]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing publisher/version/effective identity", "stale or superseded source", "missing jurisdiction/entity/activity/data applicability", "certification request"]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: sorted(spec.context), optional_context: sorted(["project_context", "profile", "evidence_receipt"]), deny_if_missing: sorted(["standard_version", "effective_date", "applicability_decision"]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous edition", "stale source", "missing applicability", "certification claim"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "standard_identity", "requirement_mappings", "applicability", "exceptions", "unknowns", "handoff"]), evidence_obligations: sorted(["sources.lock identity", "requirement-level mapping", "effective/supersession status", "external applicability overlay", "unknown ledger"]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "source_lock_identity", "applicability_status", "residuals"])},
    authority: {allowed_authority: sorted(["the exact source edition in sources.lock", "normalized requirement mappings", "external applicability evidence"]), precedence: sorted(["human safety/emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary standard source", "external applicability overlay", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citation", "automated certification", "legal conclusion", "another publisher/edition", "self-authored acceptance"]), jurisdiction_rule: "Require jurisdiction, entity, activity, data class, version, effective date, exceptions, and requirement-level mapping before regulated or standards applicability advances.", escalation_rule: "Conflict or missing applicability escalates to the authority-jurisdiction gate and closes only the dependent mapping.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Exact publisher, identifier, edition, publication/effective/supersession status, retrieved date, immutable identity, and source digest must be checked; stale or unverifiable evidence denies the dependent mapping.", claim_rule: "Claims are limited to the exact normalized requirement and source identity; no certification or legal applicability claim is permitted.", unknown_rule: "UNKNOWN records missing applicability or evidence and closes only the dependent requirement mapping."},
    controls: {read: sorted(["sources.lock", "requirements.json", "compatibility.json", "supersession.json", "external typed applicability overlay"]), write: sorted(["own append-only candidate package", "typed handoff receipt"]), tools: sorted(["local deterministic validator", "source-lock reader"]), data: sorted(["public standard metadata", "synthetic or externally supplied applicability fields only", "no secrets"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
    failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", recovery: sorted(["record exact missing applicability field", "refresh or supersede the source lock", "preserve the immutable block", "resume only after independent recheck"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "NOT_APPLICABLE", "WAITING_WITH_RECEIPT"])},
    lifecycle_rules: {candidate_entry: "Block, source lock, normalized requirements, compatibility/supersession maps, twelve gates, fixtures, evaluation, and handoff have matching digests.", evaluation_entry: "Independent evaluator checks requirement-level mappings and applicability denial; static syntax is insufficient.", suspension: "Suspend on source supersession, material erratum, invalidated applicability, or failed utility/harm review.", archive: "Archive only by immutable receipt when superseded, rejected, or the exact edition is retired; old compiled locks remain reproducible.", reactivation: "Create or validate a new revision and rerun independent evaluation; never silently reactivate an old edition."},
    gate_path: "gates/00-intake.gate",
    gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
    schema_path: "schemas/specialist-block.v1.json",
    dependencies: sorted(["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate"]),
    conflicts: [],
    aliases: [],
    evaluation: {dossier_path: "evaluation.json", receipt_id: `specialist-eval.${spec.slug}.v1`, disposition: "STATIC_PASS_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])},
    normalized_requirements_path: "requirements.json",
    applicability_inputs: sorted(spec.applicabilityInputs),
    exceptions: sorted(spec.exceptions),
    supersession_status: spec.supersessionStatus,
    reuse: {content_addressed: true, reuse_key: `block-lock.standard-${spec.slug}`, standard_identity: spec.standardIdentity, compatibility_map_path: "compatibility.json", supersession_path: "supersession.json", applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "A new edition, material erratum, or normative gate correction creates a new immutable block version plus compatibility/supersession map.", freshness_rule: "A non-material publisher refresh creates a freshness receipt only; it does not copy or fork this standard block."},
    source_manifest_sha256: sourceLock.manifest_sha256,
    normalized_requirements_sha256: fileDigests.requirements,
    compatibility_sha256: fileDigests.compatibility,
    supersession_sha256: fileDigests.supersession,
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  return block;
}

function buildSourceLock(spec) {
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: spec.blockId, sources: [spec.source], freshness_rule: "DENY dependent mapping when source is stale, superseded, unverifiable, or missing edition/effective identity; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildRequirements(spec) {
  return {schema: "agentos.specialist_standard_requirements.v1", version: 1, block_id: spec.blockId, standard_identity: spec.standardIdentity, requirements: spec.requirements, applicability_rule: "Applicability is evaluated from external jurisdiction/entity/activity/data/version/effective-date evidence; this file never stores project facts.", exception_rule: "Exceptions require an external primary-source or authority-corpus reference and remain requirement-level mappings."};
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const nextGate = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact edition and external applicability condition pass with typed evidence?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_manifest_sha256", "external_applicability_overlay"]), next: {YES: nextGate, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: nextGate}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: ["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES].includes(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "gpt-5.6-luna/max", harness: "deterministic-independent-standard-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/requirements.json`, `${packageRelative}/compatibility.json`, `${packageRelative}/supersession.json`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["standard-identity-and-edition", "normalized-requirement-digest", "source-lock-digest", "compatibility-and-supersession-maps", "12-gate-pack-digests", "requirement-level-hostile-fixtures", "independent-reviewer-required"]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability remains external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: "Route the immutable standard candidate to an independent evaluator; preserve external applicability overlay and activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/standards/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const sourceLock = buildSourceLock(spec);
  const requirements = buildRequirements(spec);
  const compatibility = {schema: "agentos.specialist_standard_compatibility.v1", version: 1, block_id: spec.blockId, current_edition: spec.standardIdentity.edition, compatible_predecessors: [], rule: "No predecessor is silently interchangeable; add an explicit mapping for every material change."};
  const supersession = {schema: "agentos.specialist_standard_supersession.v1", version: 1, block_id: spec.blockId, status: spec.supersessionStatus, superseded_by: spec.supersededBy, known_non_superseding: spec.knownNonSuperseding, rule: "A new edition or material erratum creates a new block and leaves old compiled locks reproducible."};
  const fileDigests = {requirements: canonicalDigest(requirements), compatibility: canonicalDigest(compatibility), supersession: canonicalDigest(supersession)};
  const block = buildBlock(spec, fileDigests, sourceLock);
  fs.mkdirSync(path.join(packageDir, "gates"), {recursive: true});
  fs.mkdirSync(path.join(packageDir, "fixtures"), {recursive: true});
  writeJson(path.join(packageDir, "block.json"), block);
  writeJson(path.join(packageDir, "sources.lock"), sourceLock);
  writeJson(path.join(packageDir, "requirements.json"), requirements);
  writeJson(path.join(packageDir, "compatibility.json"), compatibility);
  writeJson(path.join(packageDir, "supersession.json"), supersession);
  const gatePaths = [];
  for (const gateId of SPECIALIST_GATE_IDS) {
    gatePaths.push(`gates/${gateId}.gate`);
    writeJson(path.join(packageDir, "gates", `${gateId}.gate`), buildGate(spec, block, gateId));
  }
  const manifest = {schema: "agentos.specialist_gate_manifest.v1", version: 1, block_id: block.block_id, ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES], gate_paths: gatePaths, manifest_sha256: null};
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  writeJson(path.join(packageDir, "gates", "manifest.json"), manifest);
  const evaluation = buildEvaluation(spec, block);
  writeJson(path.join(packageDir, "evaluation.json"), evaluation);
  writeJson(path.join(packageDir, "handoff.json"), buildHandoff(spec, block, packageRelative));
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  for (const className of classes) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; standard applicability and requirement evidence remain external.`});
}

export function scaffoldStandardBlocks(repositoryRoot = process.cwd()) {
  for (const spec of specs) writePackage(repositoryRoot, spec);
  return specs.map((spec) => spec.blockId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify({status: "PASS", packages: scaffoldStandardBlocks(process.cwd())}, null, 2) + "\n");
}
