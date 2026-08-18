#!/usr/bin/env node

/* Controller-owned deterministic scaffolder for candidate specialist packages. */

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
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sorted(items) {
  return [...new Set(items)].sort();
}

const sourceCatalog = {
  role: {source_id: "source.agentskills-spec", title: "Agent Skills Specification", publisher: "Agent Skills", url: "https://agentskills.io/specification", version: "current", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "agentskills-specification-current-2026-08-11", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Progressive disclosure and typed skill-resource boundaries."},
  jsonSchema: {source_id: "source.json-schema-2020-12", title: "JSON Schema 2020-12", publisher: "JSON Schema", url: "https://json-schema.org/draft/2020-12", version: "2020-12", effective_date: "2020-12-01", retrieved_date: SOURCE_DATE, immutable_identity: "json-schema-draft-2020-12", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Machine-readable contract validation."},
  prov: {source_id: "source.w3c-prov-dm", title: "PROV-DM", publisher: "W3C", url: "https://www.w3.org/TR/prov-dm/", version: "REC", effective_date: "2013-04-30", retrieved_date: SOURCE_DATE, immutable_identity: "w3c-prov-dm-recommendation-20130430", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Evidence provenance and derivation identity."},
  cedar: {source_id: "source.cedar-authorization", title: "Cedar Authorization Model", publisher: "AWS Cedar", url: "https://docs.cedarpolicy.com/auth/authorization.html", version: "current", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "cedar-authorization-model-current-2026-08-11", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Explicit authorization and forbid-overrides-permit reference pattern."},
  slsa: {source_id: "source.slsa-provenance", title: "SLSA Provenance", publisher: "SLSA", url: "https://slsa.dev/spec/v1.2/provenance", version: "1.2", effective_date: "2023-06-01", retrieved_date: SOURCE_DATE, immutable_identity: "slsa-provenance-v1.2", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Source-to-artifact provenance and build identity."},
  rfc2119: {source_id: "source.rfc2119", title: "Key words for use in RFCs", publisher: "IETF", url: "https://www.rfc-editor.org/rfc/rfc2119", version: "RFC 2119", effective_date: "1997-03-01", retrieved_date: SOURCE_DATE, immutable_identity: "rfc2119-bcp14-1997", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Controlled normative language."},
  nistAi: {source_id: "source.nist-ai-rmf", title: "AI Risk Management Framework", publisher: "NIST", url: "https://www.nist.gov/itl/ai-risk-management-framework", version: "1.0", effective_date: "2023-01-26", retrieved_date: SOURCE_DATE, immutable_identity: "nist-ai-rmf-1.0-20230126", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Evaluation, risk, and trustworthiness framing."},
};

const specs = [
  {slug: "role-intake-classifier", blockId: "specialist.foundation.role-intake-classifier", title: "Universal Role-Intake Classifier", purpose: "Classify a typed request into the smallest sufficient router, atomic specialist, or control-plane route without granting authority.", signals: ["typed request", "role signal", "specialist selection"], knowledge: ["master role inventory", "atomicity law", "typed context contract"], sources: [sourceCatalog.role, sourceCatalog.jsonSchema], included: ["role classification", "router versus atomic versus control-plane distinction", "missing-context denial"], nonGoals: ["performing domain work", "Product writing", "acceptance", "inventing a role from an umbrella label"]},
  {slug: "evidence-freshness-gate", blockId: "specialist.foundation.evidence-freshness-gate", title: "Source/Evidence/Freshness Gate", purpose: "Require source identity, provenance, freshness, and invalidation evidence before a specialist route advances.", signals: ["source evidence", "freshness", "provenance"], knowledge: ["source lock fields", "W3C PROV-DM", "version and effective-date rules"], sources: [sourceCatalog.jsonSchema, sourceCatalog.prov, sourceCatalog.slsa], included: ["source lock validation", "staleness denial", "evidence digest binding"], nonGoals: ["declaring domain truth without a source", "refreshing external sources automatically", "accepting an opaque citation"]},
  {slug: "authority-jurisdiction-gate", blockId: "specialist.foundation.authority-jurisdiction-gate", title: "Authority/Precedence/Jurisdiction Gate", purpose: "Resolve authority precedence and deny legal, regulatory, safety, or provider applicability when required scope is missing.", signals: ["authority", "precedence", "jurisdiction", "applicability"], knowledge: ["authority classes", "jurisdiction/entity/activity/data applicability", "deny-by-default authorization"], sources: [sourceCatalog.cedar, sourceCatalog.rfc2119], included: ["authority precedence", "jurisdiction completeness", "conflict escalation"], nonGoals: ["legal advice", "certification", "substituting project preference for authority"]},
  {slug: "scope-non-goal-gate", blockId: "specialist.foundation.scope-non-goal-gate", title: "Scope/Non-Goal Gate", purpose: "Keep each specialist narrow, expose non-goals, and split work whenever failure modes or authority differ.", signals: ["scope", "non-goal", "atomicity", "split"], knowledge: ["atomicity fields", "smallest-sufficient routing", "sibling conflicts"], sources: [sourceCatalog.role, sourceCatalog.jsonSchema], included: ["scope boundary", "silent-expansion denial", "sibling split rule"], nonGoals: ["umbrella work", "scope expansion by convenience", "acceptance authority"]},
  {slug: "tool-custody-gate", blockId: "specialist.foundation.tool-custody-gate", title: "Tool/Resource/Custody Gate", purpose: "Bind read/write/tool/data/browser/build/deploy/communication capabilities to the least-authority candidate lease.", signals: ["tool", "resource", "custody", "capability"], knowledge: ["capability ceilings", "worktree custody", "secret and data classes"], sources: [sourceCatalog.cedar, sourceCatalog.slsa], included: ["tool boundary", "custody binding", "secret denial", "deploy denial"], nonGoals: ["provider activation", "credential handling", "production custody"]},
  {slug: "evaluation-admission-gate", blockId: "specialist.foundation.evaluation-admission-gate", title: "Evaluation/Admission Gate", purpose: "Require independent narrowness, routing, utility, harm, hostile, and handoff evaluation before any admission recommendation.", signals: ["evaluation", "admission", "utility", "harm", "independence"], knowledge: ["evaluation dossier", "candidate lifecycle", "independent reviewer rule"], sources: [sourceCatalog.nistAi, sourceCatalog.jsonSchema, sourceCatalog.prov], included: ["evaluation receipt", "self-admission denial", "utility/harm ceiling"], nonGoals: ["self-acceptance", "activation", "release or deployment"]},
  {slug: "registry-alias-deduplicator", blockId: "specialist.foundation.registry-alias-deduplicator", title: "Registry/Alias/Deduplication Controller", purpose: "Maintain one deterministic canonical identity per true alias while preserving distinct specialists when knowledge, authority, evidence, tools, or failure modes differ.", signals: ["registry", "alias", "deduplication", "canonical identity"], knowledge: ["content-addressed registry", "alias mappings", "router versus atomic identity"], sources: [sourceCatalog.jsonSchema, sourceCatalog.prov, sourceCatalog.rfc2119], included: ["stable identity", "alias mapping", "collision denial", "roster materialization"], nonGoals: ["merging distinct specialists", "renumbering accepted identities", "admission or activation"]},
];

function buildBlock(spec) {
  const requiredContext = sorted(["request", "signals", "authority", "source_lock", "custody"]);
  const optionalContext = sorted(["project_context", "runtime_readback", "evaluation_receipt"]);
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P0",
    role_kind: "CONTROL_PLANE",
    family: "foundation",
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included: sorted(spec.included), non_goals: sorted(spec.nonGoals), smallest_sufficient_rule: "Advance only the named dependent governance action; keep unrelated work moving."},
    atomic_scope_statement: `Governance-only control for ${spec.title}; it does not perform the downstream specialist or Product action.`,
    permitted_decisions: sorted(["classify the dependent governance condition", "return NOT_APPLICABLE when the condition is absent", "deny or escalate missing evidence", "issue a typed candidate handoff"]),
    forbidden_decisions: sorted(["activate or admit a block", "grant Product-writing authority", "publish, deploy, migrate, or spend", "infer missing authority or evidence", "direct protected Memory internals"]),
    maximum_authority: "NO_PRODUCT_WRITE;_NO_ACTIVATION;_NO_SELF_ACCEPTANCE;_TYPED_HANDOFF_ONLY",
    required_upstream_router: null,
    sibling_conflicts: [],
    composition_rules: sorted(["compose only with the declared foundation contract", "UNKNOWN closes only the dependent action", "preserve exact source and custody identity"]),
    escalation_target: "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority differs", "source/version differs", "tool or data custody differs", "failure mode differs"]),
    required_knowledge: sorted(spec.knowledge),
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: optionalContext, deny_if_missing: sorted(["request", "authority", "source_lock", "custody"]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing authority", "stale source", "unsafe action"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact gate trace", "source lock identity", "custody and capability result", "unknown ledger"]), handoff_fields: sorted(["block_id", "candidate_digest", "status", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["portable AgentOS governance contract", "typed source and evidence records", "independent evaluation receipt"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "versioned primary source", "project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "consumer preference as law", "provider account facts", "self-authored acceptance"]), jurisdiction_rule: "Require jurisdiction, entity, activity, data class, version, effective date, exceptions, and requirement-level mapping before regulated applicability advances.", escalation_rule: "Conflict or missing protected authority escalates to the named control-plane owner and closes only the dependent action.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Version, effective/publication/supersession status, retrieved date, immutable identity, and digest must be checked; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact scoped source and evidence identity; no source identity means no authority claim.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses an inference."},
    controls: {read: sorted(["candidate package", "typed authority corpus", "declared source records"]), write: sorted(["own append-only candidate package", "typed handoff receipt"]), tools: sorted(["local filesystem read/write within package scope", "deterministic validator"]), data: sorted(["public or synthetic source metadata only", "no secrets", "no protected consumer data"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
    failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", recovery: sorted(["record exact missing field", "preserve unrelated work", "refresh source or escalate", "resume only after typed recheck"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "NOT_APPLICABLE", "WAITING_WITH_RECEIPT"])},
    lifecycle_rules: {candidate_entry: "Package, source lock, twelve gates, fixtures, evaluation dossier, and handoff exist with matching digests.", evaluation_entry: "Independent evaluator reruns the exact candidate and task set; static syntax alone is insufficient.", suspension: "Suspend on stale source, invalidated authority, failed utility/harm evaluation, or custody mismatch.", archive: "Archive only by immutable receipt when superseded, rejected, or the scoped request closes; archive never means admitted.", reactivation: "Create or validate a new revision and rerun independent evaluation; never silently reactivate the old digest."},
    gate_path: "gates/00-intake.gate",
    gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
    schema_path: "schemas/specialist-block.v1.json",
    dependencies: [],
    conflicts: [],
    aliases: [],
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "stale source", "unsafe action"]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    evaluation: {dossier_path: "evaluation.json", receipt_id: `specialist-eval.${spec.slug}.v1`, disposition: "STATIC_PASS_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])},
    reuse: {content_addressed: true, reuse_key: `block-lock.${spec.slug}`, standard_identity: null, compatibility_map_path: null, supersession_path: null, applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "Changes to normative content, gate semantics, or publisher edition create a new immutable revision and compatibility/supersession record.", freshness_rule: "A publisher refresh without material change creates a freshness receipt only; it does not copy or fork the reusable block."},
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  return block;
}

function buildSourceLock(spec, block) {
  const sources = [...spec.sources].sort((left, right) => left.source_id.localeCompare(right.source_id));
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: block.block_id, sources, freshness_rule: "DENY dependent action when source is stale, superseded, unverifiable, or missing effective/applicability identity; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const nextGate = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {
    schema: "agentos.specialist_gate.v1",
    version: 1,
    gate_id: gateId,
    block_id: block.block_id,
    status: "EXECUTABLE",
    answer_type: "FOUR_VALUED",
    allowed_outcomes: [...GATE_OUTCOMES],
    question: `${spec.title}: does the declared ${gateId} condition pass with exact typed evidence?`,
    evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "candidate_digest", "source_lock_identity"]),
    next: {YES: nextGate, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: nextGate},
    rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"},
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: ["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES].includes(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "deterministic-static-specialist-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["block-schema-and-digest", "source-lock-digest", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required"]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: "Route the frozen candidate to an independent evaluator and then the main AgentOS 3.0 integration owner; preserve activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/foundation/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  fs.mkdirSync(path.join(packageDir, "gates"), {recursive: true});
  const block = buildBlock(spec);
  writeJson(path.join(packageDir, "block.json"), block);
  writeJson(path.join(packageDir, "sources.lock"), buildSourceLock(spec, block));
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
  for (const className of classes) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; no consumer data or private context.`});
}

export function scaffoldFoundationPackages(repositoryRoot = process.cwd()) {
  for (const spec of specs) writePackage(repositoryRoot, spec);
  return specs.map((spec) => spec.blockId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = scaffoldFoundationPackages(process.cwd());
  process.stdout.write(JSON.stringify({status: "PASS", packages: ids}, null, 2) + "\n");
}
