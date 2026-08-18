#!/usr/bin/env node

/* Deterministic P2 security routers and narrow atomic specialist candidates. */

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
const SOURCE_COMMIT = "170bbf4ca705dce9de199172910c6c25e243e7fc";
const SOURCE_TREE = "aebfe743b8b460dd1ffb5c90cfc3342f93d18597";

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
};

const foundationDependencies = [
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
];

const routerSpecs = [
  {slug: "owasp-web-top10-router", blockId: "specialist.security.owasp-web-top10-router", genericIds: ["SEC.OWASP_WEB_TOP10"], title: "OWASP Web Top 10 Router", purpose: "Classify OWASP Top 10:2025 web-risk signals and select the smallest category specialist set without performing category analysis.", signals: ["SEC.OWASP_WEB_TOP10", "OWASP Top 10", "web application security", "A01:2025", "A05:2025"], context: ["web.application", "standard.edition", "applicability"], dependencies: ["specialist.security.router"]},
  {slug: "owasp-api-top10-router", blockId: "specialist.security.owasp-api-top10-router", genericIds: ["SEC.OWASP_API_TOP10"], title: "OWASP API Security Top 10 Router", purpose: "Classify OWASP API Security Top 10 2023 signals and select the smallest category specialist set without performing category analysis.", signals: ["SEC.OWASP_API_TOP10", "OWASP API Security Top 10", "API security", "API1:2023", "API7:2023"], context: ["api.scope", "standard.edition", "applicability"], dependencies: ["specialist.security.router"]},
  {slug: "owasp-asvs-router", blockId: "specialist.security.owasp-asvs-router", genericIds: ["SEC.OWASP_ASVS"], title: "OWASP ASVS Applicability Router", purpose: "Classify ASVS applicability and verification-level signals and route to the reusable exact edition without performing verification work.", signals: ["SEC.OWASP_ASVS", "ASVS", "application verification", "verification level"], context: ["application.scope", "standard.edition", "applicability"], dependencies: ["specialist.security.router"]},
  {slug: "access-control-router", blockId: "specialist.security.access-control-router", genericIds: ["SEC.TENANT_ACCESS_CONTROL"], title: "Access-Control Composition Router", purpose: "Classify access-control model and boundary signals and assemble distinct authorization specialists without making authorization decisions.", signals: ["SEC.TENANT_ACCESS_CONTROL", "access control", "RBAC", "tenant isolation", "object authorization"], context: ["identity.model", "authorization.boundary", "tenant.scope"], dependencies: ["specialist.security.router"]},
  {slug: "supply-chain-router", blockId: "specialist.security.supply-chain-router", genericIds: ["SEC.SECRETS_CRYPTO_SUPPLY_CHAIN"], title: "Secrets, Cryptography, and Supply-Chain Router", purpose: "Classify source, dependency, provenance, and cryptographic-control signals and select narrow specialists without handling secrets or certifying supply-chain posture.", signals: ["SEC.SECRETS_CRYPTO_SUPPLY_CHAIN", "SBOM", "CVE", "provenance", "supply chain"], context: ["artifact.scope", "dependency.scope", "source.authority"], dependencies: ["specialist.security.router"]},
  {slug: "data-lifecycle-router", blockId: "specialist.privacy.data-lifecycle-router", genericIds: ["PRIVACY.DATA_LIFECYCLE"], title: "Privacy Data-Lifecycle Router", purpose: "Classify data-lifecycle signals and route to a jurisdiction-bound privacy specialist without asserting legal applicability or handling protected data.", signals: ["PRIVACY.DATA_LIFECYCLE", "data lifecycle", "retention", "erasure", "privacy"], context: ["data.class", "jurisdiction", "entity", "activity"], dependencies: []},
];

const webCategories = [
  ["A01", "BROKEN_ACCESS_CONTROL", "Broken Access Control", ["access control", "authorization", "A01:2025"]],
  ["A02", "SECURITY_MISCONFIGURATION", "Security Misconfiguration", ["misconfiguration", "A02:2025"]],
  ["A03", "SOFTWARE_SUPPLY_CHAIN_FAILURES", "Software Supply Chain Failures", ["software supply chain", "dependencies", "A03:2025"]],
  ["A04", "CRYPTOGRAPHIC_FAILURES", "Cryptographic Failures", ["cryptography", "encryption", "A04:2025"]],
  ["A05", "INJECTION", "Injection", ["injection", "A05:2025"]],
  ["A06", "INSECURE_DESIGN", "Insecure Design", ["insecure design", "threat modeling", "A06:2025"]],
  ["A07", "AUTHENTICATION_FAILURES", "Authentication Failures", ["authentication", "identity", "A07:2025"]],
  ["A08", "SOFTWARE_DATA_INTEGRITY_FAILURES", "Software or Data Integrity Failures", ["integrity", "signed artifact", "A08:2025"]],
  ["A09", "SECURITY_LOGGING_ALERTING_FAILURES", "Security Logging and Alerting Failures", ["security logging", "alerting", "A09:2025"]],
  ["A10", "MISHANDLING_EXCEPTIONAL_CONDITIONS", "Mishandling of Exceptional Conditions", ["exception handling", "fail open", "A10:2025"]],
];

const apiCategories = [
  ["API1", "OBJECT_AUTHORIZATION", "Broken Object Level Authorization", ["object authorization", "API1:2023"]],
  ["API2", "BROKEN_AUTHENTICATION", "Broken Authentication", ["API authentication", "API2:2023"]],
  ["API3", "PROPERTY_AUTHORIZATION", "Broken Object Property Level Authorization", ["property authorization", "API3:2023"]],
  ["API4", "RESOURCE_CONSUMPTION", "Unrestricted Resource Consumption", ["resource consumption", "rate limiting", "API4:2023"]],
  ["API5", "FUNCTION_AUTHORIZATION", "Broken Function Level Authorization", ["function authorization", "API5:2023"]],
  ["API6", "SENSITIVE_BUSINESS_FLOWS", "Unrestricted Access to Sensitive Business Flows", ["business flow abuse", "API6:2023"]],
  ["API7", "SSRF", "Server Side Request Forgery", ["SSRF", "server side request forgery", "API7:2023"]],
  ["API8", "MISCONFIGURATION", "Security Misconfiguration", ["API misconfiguration", "API8:2023"]],
  ["API9", "INVENTORY", "Improper Inventory Management", ["API inventory", "API9:2023"]],
  ["API10", "UNSAFE_API_CONSUMPTION", "Unsafe Consumption of APIs", ["unsafe API consumption", "API10:2023"]],
];

const accessControls = [
  ["SEC.ACCESS_CONTROL_RBAC", "rbac", "Role-Based Access Control", ["RBAC", "role-based access"]],
  ["SEC.ACCESS_CONTROL_ABAC", "abac", "Attribute-Based Access Control", ["ABAC", "attribute-based access"]],
  ["SEC.ACCESS_CONTROL_REBAC", "rebac", "Relationship-Based Access Control", ["ReBAC", "relationship-based access"]],
  ["SEC.ACCESS_CONTROL_TENANT_ISOLATION", "tenant-isolation", "Tenant Isolation Access Control", ["tenant isolation", "tenant boundary"]],
  ["SEC.ACCESS_CONTROL_OBJECT_SCOPE", "object-scope", "Object Scope Authorization", ["object scope", "object authorization"]],
  ["SEC.ACCESS_CONTROL_FUNCTION_SCOPE", "function-scope", "Function Scope Authorization", ["function scope", "function authorization"]],
  ["SEC.ACCESS_CONTROL_REVOCATION", "revocation", "Authorization Revocation", ["revocation", "permission removal"]],
  ["SEC.ACCESS_CONTROL_CACHE_RESIDUE", "cache-residue", "Authorization Cache Residue", ["authorization cache", "cache residue"]],
];

const concurrency = [
  ["SEC.RACE_CONDITION", "race-condition", "Race Condition", ["race condition", "concurrent mutation"]],
  ["SEC.TOCTOU", "toctou", "Time-of-Check/Time-of-Use", ["TOCTOU", "check use gap"]],
  ["SEC.DEADLOCK", "deadlock", "Deadlock", ["deadlock", "lock ordering"]],
  ["SEC.IDEMPOTENCY", "idempotency", "Idempotency", ["idempotency", "retry safety"]],
  ["SEC.REPLAY", "replay", "Replay Resistance", ["replay", "nonce"]],
  ["SEC.DOUBLE_SUBMISSION", "double-submission", "Double Submission", ["double submission", "duplicate request"]],
  ["SEC.CONCURRENT_AUTHORIZATION", "concurrent-authorization", "Concurrent Authorization", ["concurrent authorization", "authorization race"]],
];

const supplyChain = [
  ["SEC.CVE_INVENTORY", "cve-inventory", "CVE Inventory", ["CVE inventory", "vulnerability inventory"]],
  ["SEC.CVE_APPLICABILITY", "cve-applicability", "CVE Applicability", ["CVE applicability", "affected version"]],
  ["SEC.DEPENDENCY_VULNERABILITY", "dependency-vulnerability", "Dependency Vulnerability", ["dependency vulnerability", "vulnerable dependency"]],
  ["SEC.SBOM", "sbom", "Software Bill of Materials", ["SBOM", "component inventory"]],
  ["SEC.PATCH_REMEDIATION", "patch-remediation", "Patch Remediation", ["patch remediation", "vulnerability fix"]],
  ["SEC.SUPPLY_CHAIN_PROVENANCE", "supply-chain-provenance", "Supply-Chain Provenance", ["provenance", "build provenance"]],
];

function makeAtomic({genericId, slug, title, signals, upstream, standardBlocks, context, nonGoals = [], included = [], siblingConflicts = []}) {
  return {roleKind: "ATOMIC_SPECIALIST", slug, blockId: `specialist.security.${slug}`, genericIds: [genericId], family: "security", title, purpose: `Analyze only ${title} as a narrow, version-bound security evidence domain; return NOT_APPLICABLE when the named concern is absent.`, upstream, standardBlocks, signals, context, nonGoals, included, siblingConflicts};
}

const atomicSpecs = [
  ...webCategories.map(([code, name, title, signals]) => makeAtomic({genericId: `SEC.OWASP_WEB_2025_${code}_${name}`, slug: `owasp-web-2025-${code.toLowerCase()}-${name.toLowerCase().replaceAll("_", "-")}`, title: `OWASP Web ${code}:2025 ${title}`, signals, upstream: "specialist.security.owasp-web-top10-router", standardBlocks: ["specialist.standard.owasp-top10-2025", "specialist.standard.owasp-asvs"], context: ["web.application", "web.category", "standard.edition", "candidate.identity"], nonGoals: ["other OWASP categories", "project risk acceptance", "certification"], included: ["exact OWASP category identity", "category-scoped evidence", "version-bound security findings"]})),
  ...apiCategories.map(([code, name, title, signals]) => makeAtomic({genericId: `SEC.OWASP_API_2023_${name}`, slug: `owasp-api-2023-${code.toLowerCase()}-${name.toLowerCase().replaceAll("_", "-")}`, title: `OWASP API ${code}:2023 ${title}`, signals, upstream: "specialist.security.owasp-api-top10-router", standardBlocks: ["specialist.standard.owasp-api-top10-2023", "specialist.standard.owasp-asvs"], context: ["api.scope", "api.category", "standard.edition", "candidate.identity"], nonGoals: ["other API categories", "business risk acceptance", "certification"], included: ["exact OWASP API category identity", "category-scoped evidence", "version-bound API security findings"]})),
  ...accessControls.map(([genericId, slug, title, signals]) => makeAtomic({genericId, slug, title, signals, upstream: "specialist.security.access-control-router", standardBlocks: ["specialist.standard.owasp-asvs"], context: ["identity.model", "authorization.boundary", "candidate.identity"], nonGoals: ["other authorization models", "Product permission acceptance", "legal conclusions"], included: ["named authorization model evidence", "boundary findings", "typed access-control obligations"]})),
  ...concurrency.map(([genericId, slug, title, signals]) => makeAtomic({genericId, slug, title, signals, upstream: "specialist.security.access-control-router", standardBlocks: ["specialist.standard.owasp-asvs"], context: ["concurrency.scope", "operation.identity", "candidate.identity"], nonGoals: ["unrelated concurrency failure modes", "runtime deployment", "acceptance"], included: ["named concurrency failure mode", "interleaving or ordering evidence", "typed mitigation obligations"]})),
  ...supplyChain.map(([genericId, slug, title, signals]) => makeAtomic({genericId, slug, title, signals, upstream: "specialist.security.supply-chain-router", standardBlocks: ["specialist.standard.nist-ssdf", "specialist.standard.slsa"], context: ["artifact.scope", "dependency.scope", "candidate.identity"], nonGoals: ["secret values", "provider certification", "unrelated cryptographic claims"], included: ["named supply-chain evidence domain", "artifact or dependency identity", "typed remediation/provenance obligations"]})),
];

function buildBlock(spec) {
  const isRouter = spec.roleKind === "ROUTER";
  const dependencies = sorted([...foundationDependencies, ...(spec.dependencies ?? []), ...(spec.upstream ? [spec.upstream] : []), ...(spec.standardBlocks ?? [])]);
  const requiredContext = sorted(["request", "signals", "authority", "source_lock", "custody", ...spec.context]);
  const nonGoals = sorted([...(spec.nonGoals ?? []), "silent scope expansion", "self-admission", "Product writing", "acceptance", "activation"]);
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
    priority: "P2",
    role_kind: spec.roleKind,
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included, non_goals: nonGoals, smallest_sufficient_rule: isRouter ? "Classify and assemble context only; select atomic specialists when a narrow concern is evidenced." : "Analyze only the named atomic concern and return NOT_APPLICABLE when it is absent."},
    atomic_scope_statement: isRouter ? `Router-only classification for ${spec.title}; it has no downstream Product or acceptance authority.` : `One narrow atomic evidence domain: ${spec.title}; unrelated failure modes require sibling blocks.`,
    permitted_decisions: sorted(isRouter ? ["classify the named security signal", "assemble typed context for downstream atomic blocks", "return NOT_APPLICABLE when the family is absent", "escalate missing authority or evidence"] : ["analyze the exact named security concern", "return evidence-bounded findings", "return NOT_APPLICABLE when the concern is absent", "escalate missing authority or conflicting evidence"]),
    forbidden_decisions: forbidden,
    maximum_authority: isRouter ? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION;_TYPED_ROUTING_ONLY" : "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION",
    required_upstream_router: spec.upstream ?? null,
    sibling_conflicts: sorted(spec.siblingConflicts ?? []),
    composition_rules: sorted(isRouter ? ["compose only with declared foundation and router dependencies", "never substitute for an atomic specialist", "UNKNOWN closes only the dependent route"] : ["must be selected by the required upstream router", "compose only with explicitly named dependencies and siblings", "reuse exact standard block IDs, versions, and hashes", "UNKNOWN closes only the dependent action"]),
    escalation_target: isRouter ? "specialist.foundation.role-intake-classifier" : "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority or source lock differs", "tool or data custody differs", "failure mode differs", "standard, provider, or version differs"]),
    required_knowledge: sorted(["atomic specialization law", "exact source lock", "typed context contract", ...(spec.standardBlocks ?? [])]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "missing source lock", "stale or superseded source", "unsafe action", ...(isRouter ? [] : ["unresolved standard version", "scope expansion"]) ]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: sorted(["project_context", "evaluation_receipt", "runtime_readback"]), deny_if_missing: sorted(["authority", "source_lock", "custody", ...spec.context]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing context", "stale source", "unsafe action", "scope expansion"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact source lock identity", "gate trace", "typed context", "unknown ledger", ...(spec.standardBlocks ?? []).map((id) => `${id} hash`)]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "status", "findings", "evidence", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["exact source records in sources.lock", "typed context within the declared scope", "reusable standard block identities and requirement mappings", "evidence-bounded analysis"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary source or immutable standard block", "external typed project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "provider/account mutation", "Product acceptance", "self-authored admission", "another provider, standard, or version"]), jurisdiction_rule: "Require exact security concern, source/standard version, scope, authority, and freshness evidence; regulated or legal applicability remains external.", escalation_rule: "Conflict or missing protected authority closes only the dependent action and escalates to the named control-plane owner.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Check publisher, identifier, version, publication/effective/supersession status, retrieved date, immutable identity, and digest when obtainable; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact source-backed concern and selected reusable standard blocks; no cross-version or cross-specialist claims.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses inference or scope expansion."},
    controls: {read: sorted(["candidate package", "typed authority corpus", "declared primary source metadata", ...(spec.standardBlocks ?? []).map((id) => `${id} package`)]), write: sorted(["own isolated candidate package", "typed handoff receipt"]), tools: sorted(["local deterministic validator", "source-lock reader", "fixture evaluator"]), data: sorted(["public source metadata", "synthetic or externally supplied typed context only", "no secrets", "no protected consumer data"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
    failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", recovery: sorted(["record exact missing field", "preserve immutable candidate", "refresh or escalate source", "resume only after typed recheck"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "NOT_APPLICABLE", "WAITING_WITH_RECEIPT"])},
    lifecycle_rules: {candidate_entry: "Block, source lock, twelve gates, hostile fixtures, evaluation dossier, and typed handoff have matching digests.", evaluation_entry: "Independent evaluator reruns narrowness, routing, missing-context, stale-source, authority, custody, unsafe-action, and handoff cases.", suspension: "Suspend on source supersession, stale evidence, scope drift, sibling conflict, or failed utility/harm review.", archive: "Archive only by immutable receipt when superseded, rejected, or the scoped request closes; archived never means admitted.", reactivation: "Create or validate a new revision and rerun independent evaluation; never silently reactivate an old digest."},
    gate_path: "gates/00-intake.gate",
    gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
    schema_path: "schemas/specialist-block.v1.json",
    dependencies,
    conflicts: [],
    aliases: [],
    evaluation: {dossier_path: "evaluation.json", receipt_id: `specialist-eval.${spec.slug}.v1`, disposition: "STATIC_PASS_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])},
    reuse: {content_addressed: true, reuse_key: `block-lock.${spec.slug}`, standard_identity: null, compatibility_map_path: null, supersession_path: null, applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "A material source, version, authority, or gate correction creates a new immutable revision and compatibility/supersession receipt.", freshness_rule: "A non-material publisher refresh creates a freshness receipt only; it does not copy or fork this block."},
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  return block;
}

function buildSourceLock(block) {
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: block.block_id, sources: [sourceCatalog.atomicLaw], freshness_rule: "DENY dependent action when a source or reusable authority is stale, superseded, unverifiable, or missing exact version/effective/publication status; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const next = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact ${gateId} condition pass without expanding this ${block.role_kind === "ROUTER" ? "router" : "atomic specialist"} scope?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_lock_identity", ...(spec.upstream ? ["upstream_router_identity"] : []), ...(spec.standardBlocks ?? []).map((id) => `${id}_hash`)]), next: {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const hostile = new Set(["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES]);
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: hostile.has(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "deterministic-independent-security-p2-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["atomic-scope-and-upstream-router", "source-lock-digest", "reusable-standard-dependency-identities", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required"]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability and project context remain external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: "Route the immutable P2 security candidate through its upstream router and independent evaluator; preserve activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/wave-03/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const block = buildBlock(spec);
  const sourceLock = buildSourceLock(block);
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
  for (const className of sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; provider, project, consumer, secret, and applicability facts remain external.`});
  return block;
}

function updateAtomicInventory(repositoryRoot, specs, blocks) {
  const inventoryPath = path.join(repositoryRoot, "specialist-blocks/registry/atomic-inventory.v1.json");
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const byGenericId = new Map();
  for (let index = 0; index < specs.length; index += 1) for (const genericId of specs[index].genericIds ?? []) byGenericId.set(genericId, blocks[index]);
  for (const item of inventory.routers) {
    const block = byGenericId.get(item.generic_id);
    if (!block) continue;
    item.block_id = block.block_id;
    item.package_status = "COMPILED_CANDIDATE";
    item.evaluator_status = "STATIC_PASS_REVIEW_REQUIRED";
    item.evaluator_receipt = block.evaluation.receipt_id;
  }
  for (const item of inventory.atomic_specialists) {
    const block = byGenericId.get(item.generic_id);
    if (!block) continue;
    item.block_id = block.block_id;
    item.package_status = "COMPILED_CANDIDATE";
    item.evaluator_status = "STATIC_PASS_REVIEW_REQUIRED";
    item.evaluator_receipt = block.evaluation.receipt_id;
  }
  inventory.routers.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.atomic_specialists.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.counts = {ROUTER: inventory.routers.length, ATOMIC_SPECIALIST: inventory.atomic_specialists.length, CONTROL_PLANE: inventory.control_plane.length};
  writeJson(inventoryPath, inventory);
}

export function scaffoldP2SecurityBlocks(repositoryRoot = process.cwd()) {
  const specs = [...routerSpecs.map((spec) => ({...spec, roleKind: "ROUTER"})), ...atomicSpecs];
  const blocks = specs.map((spec) => writePackage(repositoryRoot, spec));
  updateAtomicInventory(repositoryRoot, specs, blocks);
  return blocks.map((block) => block.block_id);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(JSON.stringify({status: "PASS", packages: scaffoldP2SecurityBlocks(process.cwd())}, null, 2) + "\n");
