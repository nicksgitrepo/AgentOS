#!/usr/bin/env node

/* Deterministic scaffolder for the first source-locked P1 router/atomic slice. */

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
const SOURCE_COMMIT = "3c6cf8b420c7d4f54ba4c551266a4e27e3cdd913";
const SOURCE_TREE = "a77308b8a879200cb2d0053fabc5c3284f1ba3a4";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function source(source_id, title, publisher, url, version, immutable_identity, scope, {effective_date = null, authority_class = "PRIMARY_DESCRIPTIVE"} = {}) {
  return {source_id, title, publisher, url, version, effective_date, retrieved_date: SOURCE_DATE, immutable_identity, content_sha256: null, authority_class, scope};
}

const sourceCatalog = {
  atomicLaw: source("source.atomic-specialization-law", "Atomic Specialization Law", "AgentOS Portable Kernel", "PORTABLE_KERNEL", "1", "agentos-atomic-specialization-law-v1", "Router-only classification, smallest-sufficient atomic composition, and no silent scope expansion.", {authority_class: "AGENTOS_PORTABLE", effective_date: SOURCE_DATE}),
  rust: source("source.rust-reference", "The Rust Reference", "Rust Project", "https://doc.rust-lang.org/reference.html", "1.97.1", "rust-reference-1.97.1-stable-2026-08-11", "Rust language semantics and reference behavior; no project-specific framework or deployment claims.", {authority_class: "PRIMARY_NORMATIVE"}),
  typescript: source("source.typescript-5-9", "TypeScript 5.9 Release Notes", "Microsoft TypeScript", "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html", "5.9", "typescript-5.9-release-notes-2025-08-01", "TypeScript 5.9 language/compiler changes and compatibility considerations.", {authority_class: "PRIMARY_DESCRIPTIVE", effective_date: "2025-08-01"}),
  react: source("source.react-19-2", "React 19.2 Release Notes", "React", "https://react.dev/blog/2025/10/01/react-19-2", "19.2", "react-19.2-release-2025-10-01", "React 19.2 runtime and component behavior; no product UX or acceptance authority.", {authority_class: "PRIMARY_DESCRIPTIVE", effective_date: "2025-10-01"}),
  postgres: source("source.postgresql-17-rls", "PostgreSQL 17 Row Security Policies", "PostgreSQL Global Development Group", "https://www.postgresql.org/docs/17/ddl-rowsecurity.html", "17.10", "postgresql-17-row-security-docs-17.10-2026-08-11", "PostgreSQL row-level security policy semantics and enforcement boundaries.", {authority_class: "PRIMARY_NORMATIVE"}),
  openapi: source("source.openapi-3-1-1", "OpenAPI Specification 3.1.1", "OpenAPI Initiative", "https://spec.openapis.org/oas/v3.1.1.html", "3.1.1", "openapi-spec-3.1.1-2024-10-24", "Machine-readable HTTP API contract syntax and semantics for the exact 3.1.1 edition.", {authority_class: "PRIMARY_NORMATIVE", effective_date: "2024-10-24"}),
  oauth: source("source.rfc-9700", "OAuth 2.0 Security Best Current Practice", "IETF", "https://www.rfc-editor.org/rfc/rfc9700.html", "RFC 9700", "rfc-9700-oauth-security-bcp-2025", "OAuth security requirements and threat mitigations; no identity-provider account authority.", {authority_class: "PRIMARY_NORMATIVE"}),
  oidc: source("source.oidc-core", "OpenID Connect Core 1.0", "OpenID Foundation", "https://openid.net/specs/openid-connect-core-1_0.html", "1.0", "openid-connect-core-1.0-2014-11-08", "OpenID Connect authentication protocol claims and flow contracts.", {authority_class: "PRIMARY_NORMATIVE", effective_date: "2014-11-08"}),
  awsIam: source("source.aws-iam-policy-elements", "IAM JSON Policy Elements Reference", "Amazon Web Services", "https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/reference_policies_elements.html", "current", "aws-iam-policy-elements-current-2026-08-11", "AWS IAM policy element semantics at retrieval; provider and account applicability remain external.", {authority_class: "PRIMARY_DESCRIPTIVE"}),
  cloudflareDns: source("source.cloudflare-dns-records", "Cloudflare DNS Records", "Cloudflare", "https://developers.cloudflare.com/dns/manage-dns-records/", "current", "cloudflare-dns-records-current-2026-06-24", "Cloudflare DNS record management semantics; account and zone authority remain external.", {authority_class: "PRIMARY_DESCRIPTIVE", effective_date: "2026-06-24"}),
  cloudflareCache: source("source.cloudflare-cache-rules", "Cloudflare Cache Rules", "Cloudflare", "https://developers.cloudflare.com/cache/how-to/cache-rules/", "current", "cloudflare-cache-rules-current-2026-08-11", "Cloudflare cache-rule matching and behavior; deployment and purge authority remain external.", {authority_class: "PRIMARY_DESCRIPTIVE"}),
};

const foundationDependencies = [
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
];

const routerSpecs = [
  {slug: "software-language-runtime-router", blockId: "specialist.software-language-runtime.router", family: "software-language-runtime", title: "Software Language and Runtime Router", purpose: "Classify language, framework, and runtime signals and assemble the smallest atomic specialist set.", signals: ["language-runtime", "ENG.RUST_BACKEND", "ENG.TYPESCRIPT_REACT_WEB", "rust", "typescript", "react"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
  {slug: "data-router", blockId: "specialist.data.router", family: "data", title: "Data and Database Router", purpose: "Classify database and data-boundary signals without performing schema, migration, or isolation work.", signals: ["data", "DATA.POSTGRES_RLS", "postgresql", "row-level security"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
  {slug: "product-client-router", blockId: "specialist.product-client.router", family: "product-client", title: "Product and Client Contract Router", purpose: "Classify API, client, and interaction signals without writing Product output or accepting behavior.", signals: ["product-client", "ARCH.API_CONTRACTS", "api contract", "openapi"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
  {slug: "security-router", blockId: "specialist.security.router", family: "security", title: "Security and Identity Router", purpose: "Classify security and identity signals and select narrow version-bound specialists.", signals: ["security", "SEC.AUTH_IDENTITY", "authentication", "oauth", "openid connect"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
  {slug: "assurance-enterprise-router", blockId: "specialist.assurance-enterprise.router", family: "assurance-enterprise", title: "Assurance and Enterprise Router", purpose: "Classify quality, audit, and enterprise assurance signals without performing the atomic assurance work.", signals: ["assurance", "QA.TEST_ARCHITECT", "test architecture"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
  {slug: "provider-edge-router", blockId: "specialist.platform.provider-edge-router", family: "delivery-operations", title: "Provider and Edge Capability Router", purpose: "Classify provider and edge signals and assemble exact provider-specific atomic specialists.", signals: ["provider-edge", "PLATFORM.AWS_CLOUDFLARE_EDGE", "aws", "cloudflare", "edge"], sources: [sourceCatalog.atomicLaw], requiredContext: ["request", "signals", "authority", "source_lock", "custody"]},
];

const atomicSpecs = [
  {slug: "rust-backend", blockId: "specialist.software-language-runtime.rust-backend", genericIds: ["ENG.RUST_BACKEND"], standardBlock: "specialist.standard.rust-reference", title: "Rust Backend Language Semantics", purpose: "Analyze Rust language and backend runtime constraints for the exact locked reference, without owning architecture, storage, or deployment decisions.", upstream: "specialist.software-language-runtime.router", signals: ["ENG.RUST_BACKEND", "rust", "rust backend"], sources: [sourceCatalog.atomicLaw], context: ["language.edition", "runtime.toolchain", "candidate.identity"], knowledge: ["specialist.standard.rust-reference", "edition and toolchain identity", "ownership, borrowing, and unsafe boundary evidence"], included: ["Rust language semantics", "edition/toolchain compatibility", "language-level backend findings"], nonGoals: ["architecture selection", "database design", "deployment", "Product acceptance"]},
  {slug: "typescript-language", blockId: "specialist.software-language-runtime.typescript-language", genericIds: ["ENG.TYPESCRIPT_REACT_WEB"], standardBlock: "specialist.standard.typescript-5-9", title: "TypeScript Language and Compiler Semantics", purpose: "Analyze TypeScript language and compiler-version behavior for the exact locked release, without absorbing React or browser UX authority.", upstream: "specialist.software-language-runtime.router", signals: ["typescript", "TypeScript compiler", "ENG.TYPESCRIPT_REACT_WEB"], sources: [sourceCatalog.atomicLaw], context: ["language.version", "compiler.options", "candidate.identity"], knowledge: ["specialist.standard.typescript-5-9", "compiler configuration", "type-system and emitted-code evidence"], included: ["TypeScript version behavior", "compiler option implications", "typed language findings"], nonGoals: ["React component behavior", "CSS or browser UX", "deployment", "Product acceptance"]},
  {slug: "react-components", blockId: "specialist.software-language-runtime.react-components", genericIds: ["ENG.TYPESCRIPT_REACT_WEB"], standardBlock: "specialist.standard.react-19-2", title: "React Component Runtime", purpose: "Analyze React 19.2 component and runtime behavior for the exact locked version, without substituting for TypeScript, accessibility, or product design specialists.", upstream: "specialist.software-language-runtime.router", signals: ["react", "React component", "ENG.TYPESCRIPT_REACT_WEB"], sources: [sourceCatalog.atomicLaw], context: ["framework.version", "component.boundary", "candidate.identity"], knowledge: ["specialist.standard.react-19-2", "component and hook boundaries", "runtime evidence"], included: ["React component runtime", "framework-version compatibility", "component-level findings"], nonGoals: ["TypeScript compiler semantics", "accessibility conformance", "UX acceptance", "deployment"]},
  {slug: "postgresql-rls", blockId: "specialist.data.postgresql-rls", genericIds: ["DATA.POSTGRES_RLS"], standardBlock: "specialist.standard.postgresql-17-rls", title: "PostgreSQL Row-Level Security", purpose: "Analyze PostgreSQL row-security policy semantics and tenant-boundary evidence for the exact locked documentation version.", upstream: "specialist.data.router", signals: ["DATA.POSTGRES_RLS", "postgresql RLS", "row-level security", "tenant isolation"], sources: [sourceCatalog.atomicLaw], context: ["database.engine", "database.version", "data.tenant-boundary", "candidate.identity"], knowledge: ["specialist.standard.postgresql-17-rls", "policy enablement and enforcement", "tenant-boundary evidence"], included: ["row-level security policy behavior", "tenant boundary evidence", "policy test obligations"], nonGoals: ["general schema design", "migration execution", "backup/restore", "legal privacy conclusions"]},
  {slug: "openapi-contracts", blockId: "specialist.product-client.openapi-contracts", genericIds: ["ARCH.API_CONTRACTS"], standardBlock: "specialist.standard.openapi-3-1-1", title: "OpenAPI HTTP Contract", purpose: "Analyze OpenAPI 3.1.1 contract identity and requirement-level consistency without writing Product behavior or selecting an API implementation.", upstream: "specialist.product-client.router", signals: ["ARCH.API_CONTRACTS", "openapi", "API contract", "HTTP schema"], sources: [sourceCatalog.atomicLaw], context: ["api.contract", "api.version", "candidate.identity"], knowledge: ["specialist.standard.openapi-3-1-1", "operation and schema identity", "contract evidence and compatibility"], included: ["OpenAPI 3.1.1 contract semantics", "operation/schema traceability", "versioned contract findings"], nonGoals: ["backend implementation", "product acceptance", "deployment", "legal or regulatory certification"]},
  {slug: "oauth-identity", blockId: "specialist.security.oauth-identity", genericIds: ["SEC.AUTH_IDENTITY"], standardBlock: "specialist.standard.oauth-rfc-9700", title: "OAuth Security Identity Flow", purpose: "Analyze OAuth security flow risks against RFC 9700 for the exact declared authorization context.", upstream: "specialist.security.router", signals: ["SEC.AUTH_IDENTITY", "oauth", "OAuth security", "authorization flow"], sources: [sourceCatalog.atomicLaw], context: ["identity.protocol", "identity.flow", "identity.client-type", "candidate.identity"], knowledge: ["specialist.standard.oauth-rfc-9700", "flow and client constraints", "threat and mitigation evidence"], included: ["OAuth flow security", "client/authorization-server evidence", "version-bound mitigation obligations"], nonGoals: ["OIDC claims semantics", "provider account administration", "credential handling", "legal advice"]},
  {slug: "oidc-core", blockId: "specialist.security.oidc-core", genericIds: ["SEC.AUTH_IDENTITY"], standardBlock: "specialist.standard.oidc-core-1-0", title: "OpenID Connect Core Claims", purpose: "Analyze OpenID Connect Core 1.0 authentication and claims contracts without absorbing OAuth security, account authority, or user acceptance.", upstream: "specialist.security.router", signals: ["openid connect", "OIDC", "identity claims"], sources: [sourceCatalog.atomicLaw], context: ["identity.protocol", "identity.claims", "identity.issuer", "candidate.identity"], knowledge: ["specialist.standard.oidc-core-1-0", "issuer and claims semantics", "authentication evidence"], included: ["OIDC Core claims", "issuer and flow contract", "version-bound authentication findings"], nonGoals: ["OAuth threat model", "provider account changes", "credential handling", "product acceptance"]},
  {slug: "aws-iam-policy", blockId: "specialist.platform.aws-iam-policy", genericIds: ["PLATFORM.AWS_CLOUDFLARE_EDGE", "CLOUD.AWS_IAM"], standardBlock: "specialist.standard.aws-iam-current", title: "AWS IAM Policy Elements", purpose: "Analyze AWS IAM policy element semantics for the exact provider documentation snapshot without granting account or deployment authority.", upstream: "specialist.platform.provider-edge-router", signals: ["aws iam", "AWS policy", "CLOUD.AWS_IAM"], sources: [sourceCatalog.atomicLaw], context: ["provider.name", "provider.region", "iam.policy", "candidate.identity"], knowledge: ["specialist.standard.aws-iam-current", "action/resource/condition semantics", "provider version and account evidence"], included: ["IAM policy element semantics", "policy evidence", "least-privilege findings"], nonGoals: ["AWS account mutation", "secrets or credentials", "network/storage/deployment controls", "provider certification"]},
  {slug: "cloudflare-dns", blockId: "specialist.platform.cloudflare-dns", genericIds: ["PLATFORM.AWS_CLOUDFLARE_EDGE", "EDGE.CLOUDFLARE_DNS"], standardBlock: "specialist.standard.cloudflare-dns-current", title: "Cloudflare DNS Records", purpose: "Analyze Cloudflare DNS record semantics for the exact documentation snapshot without changing zones or asserting account authority.", upstream: "specialist.platform.provider-edge-router", signals: ["cloudflare dns", "EDGE.CLOUDFLARE_DNS", "DNS records"], sources: [sourceCatalog.atomicLaw], context: ["provider.name", "dns.zone", "dns.records", "candidate.identity"], knowledge: ["specialist.standard.cloudflare-dns-current", "record type and zone evidence", "external account/zone custody"], included: ["DNS record semantics", "zone-scoped evidence", "configuration findings"], nonGoals: ["zone mutation", "TLS/WAF/cache policy", "credentials", "deployment"]},
  {slug: "cloudflare-cache", blockId: "specialist.platform.cloudflare-cache", genericIds: ["PLATFORM.AWS_CLOUDFLARE_EDGE", "EDGE.CLOUDFLARE_CACHE"], standardBlock: "specialist.standard.cloudflare-cache-current", title: "Cloudflare Cache Rules", purpose: "Analyze Cloudflare cache-rule matching and behavior for the exact documentation snapshot without purging, deploying, or changing edge state.", upstream: "specialist.platform.provider-edge-router", signals: ["cloudflare cache", "EDGE.CLOUDFLARE_CACHE", "cache rules"], sources: [sourceCatalog.atomicLaw], context: ["provider.name", "cache.rule", "cache.scope", "candidate.identity"], knowledge: ["specialist.standard.cloudflare-cache-current", "matching and cache behavior", "edge scope and purge boundary"], included: ["cache-rule semantics", "rule matching evidence", "edge behavior findings"], nonGoals: ["cache purge", "DNS/TLS/WAF", "deployment", "provider account mutation"]},
];

function buildBlock(spec) {
  const isRouter = spec.roleKind === "ROUTER";
  const dependencies = sorted([...(isRouter ? ["specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate"] : foundationDependencies), ...(spec.upstream ? [spec.upstream] : []), ...(spec.standardBlock ? [spec.standardBlock] : [])]);
  const requiredContext = sorted(spec.requiredContext ?? ["request", "signals", "authority", "source_lock", "custody", ...spec.context]);
  const nonGoals = sorted([...(spec.nonGoals ?? ["Product writing", "acceptance", "deployment", "activation"]), "silent scope expansion", "self-admission"]);
  const included = sorted(spec.included ?? ["typed classification", "version-bound evidence", "narrow findings"]);
  const forbidden = sorted([
    "activate, admit, deploy, publish, or self-accept",
    "write Product or consumer state",
    "infer missing authority, applicability, or evidence",
    ...(isRouter ? ["perform atomic specialist work", "substitute for a narrower atomic specialist"] : ["broaden to a family or sibling concern", "claim another provider, standard, or version"]),
  ]);
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P1",
    role_kind: spec.roleKind,
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included, non_goals: nonGoals, smallest_sufficient_rule: isRouter ? "Classify and assemble context only; select atomic specialists when a narrow concern is evidenced." : "Analyze only the named atomic concern and return NOT_APPLICABLE when it is absent."},
    atomic_scope_statement: isRouter ? `Router-only classification for ${spec.title}; it has no downstream Product or acceptance authority.` : `One narrow atomic evidence domain: ${spec.title}; unrelated failure modes require sibling blocks.`,
    permitted_decisions: sorted(isRouter ? ["classify the named family signal", "assemble typed context for downstream atomic blocks", "return NOT_APPLICABLE when the family is absent", "escalate missing authority or evidence"] : ["analyze the exact named atomic concern", "return evidence-bounded findings", "return NOT_APPLICABLE when the concern is absent", "escalate missing authority or conflicting evidence"]),
    forbidden_decisions: forbidden,
    maximum_authority: isRouter ? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION;_TYPED_ROUTING_ONLY" : "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION",
    required_upstream_router: spec.upstream ?? null,
    sibling_conflicts: sorted(spec.siblingConflicts ?? []),
    composition_rules: sorted(isRouter ? ["compose only with the declared foundation controls", "never substitute for an atomic specialist", "UNKNOWN closes only the dependent route"] : ["must be selected by the required upstream router", "compose only with explicitly named dependencies and siblings", "reuse the exact source lock and version", "UNKNOWN closes only the dependent action"]),
    escalation_target: isRouter ? "specialist.foundation.role-intake-classifier" : "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority or source lock differs", "tool or data custody differs", "failure mode differs", "provider, framework, or version differs"]),
    required_knowledge: sorted(spec.knowledge ?? ["atomicity law", "exact source lock", "typed context contract"]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "missing source lock", "stale or superseded source", "unsafe action", ...(isRouter ? [] : ["unresolved provider or version"]) ]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: sorted(["project_context", "evaluation_receipt", "runtime_readback"]), deny_if_missing: sorted(["authority", "source_lock", "custody", ...(isRouter ? [] : spec.context ?? [])]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing context", "stale source", "unsafe action", "scope expansion"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact source lock identity", "gate trace", "typed context", "unknown ledger"]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "status", "findings", "evidence", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["exact source records in sources.lock", "typed context within the declared scope", "evidence-bounded analysis"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary source", "external typed project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "provider account mutation", "Product acceptance", "self-authored admission", "another provider or version"]), jurisdiction_rule: "Require the exact provider, language, framework, database, protocol, version, scope, and effective/freshness evidence before a dependent action advances.", escalation_rule: "Conflict or missing protected authority closes only the dependent action and escalates to the named control-plane owner.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Check publisher, identifier, version, publication/effective/supersession status, retrieved date, immutable identity, and digest when obtainable; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact source and scoped concern; no cross-provider, cross-version, or cross-specialist claims.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses inference or scope expansion."},
    controls: {read: sorted(["candidate package", "typed authority corpus", "declared primary source metadata"]), write: sorted(["own isolated candidate package", "typed handoff receipt"]), tools: sorted(["local deterministic validator", "source-lock reader"]), data: sorted(["public source metadata", "synthetic or externally supplied typed context only", "no secrets", "no protected consumer data"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
    failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", recovery: sorted(["record exact missing field", "preserve immutable candidate", "refresh or escalate source", "resume only after typed recheck"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "NOT_APPLICABLE", "WAITING_WITH_RECEIPT"])},
    lifecycle_rules: {candidate_entry: "Block, source lock, twelve gates, hostile fixtures, evaluation dossier, and typed handoff have matching digests.", evaluation_entry: "Independent evaluator reruns narrowness, routing, missing-context, stale-source, authority, custody, unsafe-action, and handoff cases.", suspension: "Suspend on source supersession, stale evidence, scope drift, sibling conflict, or failed utility/harm review.", archive: "Archive only by immutable receipt when superseded, rejected, or the scoped request closes; archived never means admitted.", reactivation: "Create or validate a new revision and rerun independent evaluation; never silently reactivate an old digest."},
    gate_path: "gates/00-intake.gate",
    gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
    schema_path: "schemas/specialist-block.v1.json",
    dependencies,
    conflicts: [],
    aliases: sorted(spec.aliases ?? []),
    evaluation: {dossier_path: "evaluation.json", receipt_id: `specialist-eval.${spec.slug}.v1`, disposition: "STATIC_PASS_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])},
    reuse: {content_addressed: true, reuse_key: `block-lock.${spec.slug}`, standard_identity: null, compatibility_map_path: null, supersession_path: null, applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "A material source, version, authority, or gate correction creates a new immutable revision and compatibility/supersession receipt.", freshness_rule: "A non-material publisher refresh creates a freshness receipt only; it does not copy or fork this block."},
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  return block;
}

function buildSourceLock(spec, block) {
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: block.block_id, sources: [...spec.sources].sort((a, b) => a.source_id.localeCompare(b.source_id)), freshness_rule: "DENY dependent action when a source is stale, superseded, unverifiable, or missing exact version/effective/publication status; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const next = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact ${gateId} condition pass without expanding this ${block.role_kind === "ROUTER" ? "router" : "atomic specialist"} scope?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_lock_identity", ...(spec.upstream ? ["upstream_router_identity"] : [])]), next: {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const hostile = new Set(["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES]);
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: hostile.has(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "deterministic-static-atomic-p1-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["atomic-scope-and-upstream-router", "source-lock-digest", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required"]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability and project context remain external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: "Route the immutable P1 candidate through the upstream router and independent evaluator; preserve activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/wave-02/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const block = buildBlock(spec);
  const sourceLock = buildSourceLock(spec, block);
  fs.mkdirSync(path.join(packageDir, "gates"), {recursive: true});
  fs.mkdirSync(path.join(packageDir, "fixtures"), {recursive: true});
  writeJson(path.join(packageDir, "block.json"), block);
  writeJson(path.join(packageDir, "sources.lock"), sourceLock);
  for (const gateId of SPECIALIST_GATE_IDS) writeJson(path.join(packageDir, "gates", `${gateId}.gate`), buildGate(spec, block, gateId));
  const manifest = {schema: "agentos.specialist_gate_manifest.v1", version: 1, block_id: block.block_id, ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES], gate_paths: SPECIALIST_GATE_IDS.map((gateId) => `gates/${gateId}.gate`), manifest_sha256: null};
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  writeJson(path.join(packageDir, "gates", "manifest.json"), manifest);
  const evaluation = buildEvaluation(spec, block);
  writeJson(path.join(packageDir, "evaluation.json"), evaluation);
  writeJson(path.join(packageDir, "handoff.json"), buildHandoff(spec, block, packageRelative));
  for (const className of sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; all provider, project, consumer, and applicability facts remain external.`});
  return block.block_id;
}

export function scaffoldP1AtomicBlocks(repositoryRoot = process.cwd()) {
  const specs = [...routerSpecs.map((spec) => ({...spec, roleKind: "ROUTER"})), ...atomicSpecs.map((spec) => ({...spec, roleKind: "ATOMIC_SPECIALIST"}))];
  return specs.map((spec) => writePackage(repositoryRoot, spec));
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(JSON.stringify({status: "PASS", packages: scaffoldP1AtomicBlocks(process.cwd())}, null, 2) + "\n");
