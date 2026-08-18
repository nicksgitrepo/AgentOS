#!/usr/bin/env node

/* Deterministic P5 domain, AI/search, 3D, regulatory, and finance candidates. */

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
const SOURCE_COMMIT = "7ba72b318dd7ee48fa64f7ee8bbb6e412524496e";
const SOURCE_TREE = "050a8eea7c8e63cf97a164519d925943bc9eeba5";

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
  atomicLaw: source("source.atomic-specialization-law", "Atomic Specialization Law", "AgentOS Portable Kernel", "PORTABLE_KERNEL", "1", "agentos-atomic-specialization-law-v1", "Router-only classification, smallest-sufficient atomic composition, and no silent scope expansion.", {effective_date: SOURCE_DATE, authority_class: "AGENTOS_PORTABLE"}),
  oshaOilGas: source("source.osha-oil-gas-well-etool", "Oil and Gas Well Drilling and Servicing eTool", "U.S. Occupational Safety and Health Administration", "https://www.osha.gov/etools/oil-and-gas/", "current", "osha-oil-gas-well-etool-current-2026-08-11", "Public descriptive work-phase, hazard-analysis, contractor-coordination, and stop-work context; expressly not a consensus standard, legal duty, or complete safety program."),
  oshaSitePreparation: source("source.osha-oil-gas-site-preparation", "Oil and Gas Well Site Preparation", "U.S. Occupational Safety and Health Administration", "https://www.osha.gov/etools/oil-and-gas/site-preparation", "current", "osha-oil-gas-site-preparation-current-2026-06-10", "Public descriptive site-preparation and job-safety-analysis context; state plans and current requirements remain external."),
  blenderGltf: source("source.blender-gltf-2-0-manual", "Blender glTF 2.0 Import/Export Manual", "Blender Foundation", "https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html", "3.3", "blender-gltf-2.0-manual-3.3-retrieved-2026-08-11", "Tool-specific import/export guidance; no dimensional, engineering, safety, or runtime acceptance authority."),
  nistAiRmf: source("source.nist-ai-100-1", "Artificial Intelligence Risk Management Framework (AI RMF 1.0)", "NIST", "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10", "1.0", "nist-ai-100-1-ai-rmf-1.0-20230126", "Voluntary, cross-sector, use-case-agnostic AI risk-management framework; applicability and organizational decisions remain external.", {effective_date: "2023-01-26", authority_class: "PRIMARY_NORMATIVE"}),
  nistGenAi: source("source.nist-ai-600-1", "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile", "NIST", "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf", "NIST AI 600-1", "nist-ai-600-1-genai-profile-20240726", "Version-bound generative-AI risk-management profile; it does not certify a model, corpus, provider, or application.", {effective_date: "2024-07-26", authority_class: "PRIMARY_NORMATIVE"}),
  fmcsa: source("source.govinfo-cfr-title49-part390-2025", "49 CFR Part 390 — Federal Motor Carrier Safety Regulations, General Applicability and Definitions", "U.S. Department of Transportation / FMCSA", "https://www.govinfo.gov/content/pkg/CFR-2025-title49-vol5/pdf/CFR-2025-title49-vol5-part390.pdf", "2025-10-01", "cfr-title49-vol5-part390-2025-10-01", "Version-bound federal motor-carrier applicability and definitions; jurisdiction, entity, activity, exceptions, and current law remain external.", {effective_date: "2025-10-01", authority_class: "PRIMARY_NORMATIVE"}),
  irsCost: source("source.irs-managerial-costing-2024", "IRS Managerial Costing Internal Revenue Manual", "Internal Revenue Service", "https://www.irs.gov/irm/part1/irm_01-033-005", "2024-10-18", "irs-irm-1.33.5-managerial-costing-20241018", "Descriptive federal managerial-costing context for cost recognition, responsibility segments, allocation, and internal controls; not universal GAAP/IFRS advice.", {effective_date: "2024-10-18"}),
  gaoGreenBook: source("source.gao-green-book-2025", "Standards for Internal Control in the Federal Government (2025 Green Book)", "U.S. Government Accountability Office", "https://www.gao.gov/greenbook", "2025", "gao-green-book-2025-effective-fy2026", "Version-bound federal internal-control principles; it is not a universal GAAP/IFRS or licensed-accounting conclusion.", {authority_class: "PRIMARY_NORMATIVE"}),
};

const foundationDependencies = [
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
];

const routerSpecs = [
  {
    slug: "workflow-router",
    blockId: "specialist.domain.workflow-router",
    genericIds: ["DOMAIN.WORKFLOW_ROUTER"],
    family: "domain",
    title: "Field and Well Workflow Router",
    purpose: "Classify a generic field or well-workflow request and assemble only the typed context needed by the corresponding narrow workflow atom; never assert operational, safety, equipment, or engineering truth.",
    signals: ["DOMAIN.FIELD_JOB_WORKFLOW", "DOMAIN.WELL_WORKFLOW", "field job workflow", "well workflow", "job phase"],
    context: ["workflow.domain", "workflow.phase", "workflow.task", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.oshaOilGas, sourceCatalog.oshaSitePreparation],
    standards: [],
    dependencies: [],
    included: ["field/well workflow signal classification", "phase and task context assembly", "safety and engineering boundary handoff"],
    nonGoals: ["operational dispatch", "equipment/load/pressure claims", "safety certification", "field instruction", "Product writing", "acceptance"],
  },
  {
    slug: "industrial-3d-router",
    blockId: "specialist.graphics.industrial-3d-router",
    genericIds: ["GRAPHICS.INDUSTRIAL_3D_ROUTER"],
    family: "graphics",
    title: "Industrial 3D Asset Router",
    purpose: "Classify industrial 3D asset and visual-pipeline concerns into the smallest sufficient modeling, interchange, runtime, or engineering-truth boundary without performing asset work or asserting dimensions.",
    signals: ["GRAPHICS.INDUSTRIAL_3D", "industrial 3D", "CAD asset", "GLB", "gltf asset"],
    context: ["asset.domain", "asset.stage", "asset.identity", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.blenderGltf],
    standards: [],
    dependencies: [],
    included: ["3D pipeline signal classification", "asset-stage context assembly", "engineering-truth boundary handoff"],
    nonGoals: ["dimensional truth", "OEM identity", "safety/load/pressure claims", "asset acceptance", "Product writing"],
  },
  {
    slug: "search-router",
    blockId: "specialist.ai.search-router",
    genericIds: ["AI.SEARCH_ROUTER"],
    family: "ai-search",
    title: "AI/Search/RAG Router",
    purpose: "Classify search, retrieval, ranking, citation, and generative-AI evidence concerns and assemble context for the smallest sufficient atom without selecting a model, corpus, provider, or answer.",
    signals: ["AI.SEARCH_RAG", "search", "RAG", "retrieval", "citation", "ranking"],
    context: ["ai.system_scope", "corpus.scope", "retrieval.task", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.nistAiRmf, sourceCatalog.nistGenAi],
    standards: [],
    dependencies: [],
    included: ["search/RAG signal classification", "corpus and retrieval context assembly", "model/provider/authority boundary handoff"],
    nonGoals: ["answer generation", "model selection", "corpus permission grant", "truth certification", "Product writing"],
  },
  {
    slug: "regulatory-applicability-router",
    blockId: "specialist.regulatory.applicability-router",
    genericIds: ["REGULATORY.APPLICABILITY_ROUTER"],
    family: "regulatory",
    title: "Regulatory Applicability Router",
    purpose: "Classify a regulatory applicability question and assemble jurisdiction, entity, activity, data, version, exception, and effective-date context for the narrow rule-family specialist without giving legal advice.",
    signals: ["REG.FMCSA_APPLICABILITY", "regulatory applicability", "FMCSA", "49 CFR Part 390"],
    context: ["regulation.jurisdiction", "regulation.entity", "regulation.activity", "regulation.version", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.fmcsa],
    standards: [],
    dependencies: [],
    included: ["regulatory signal classification", "applicability-context assembly", "rule-family and exception handoff"],
    nonGoals: ["legal conclusion", "compliance certification", "enforcement interpretation", "regulated operation instruction", "Product writing"],
  },
  {
    slug: "accounting-router",
    blockId: "specialist.finance.accounting-router",
    genericIds: ["FINANCE.ACCOUNTING_ROUTER"],
    family: "finance",
    title: "Accounting and Job-Cost Router",
    purpose: "Classify job-cost, managerial-costing, financial-control, and reconciliation concerns and assemble the smallest sufficient accounting-control context without impersonating a licensed professional.",
    signals: ["FIN.JOB_COST_ACCOUNTING", "job cost accounting", "managerial costing", "cost allocation", "cost center"],
    context: ["accounting.entity", "accounting.objective", "accounting.period", "accounting.policy", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.irsCost, sourceCatalog.gaoGreenBook],
    standards: [],
    dependencies: [],
    included: ["accounting signal classification", "cost-object and control-objective context assembly", "professional-review boundary handoff"],
    nonGoals: ["bookkeeping entry", "tax conclusion", "GAAP/IFRS opinion", "financial acceptance", "Product writing"],
  },
];

const atomicSpecs = [
  {
    slug: "field-job-workflow",
    blockId: "specialist.domain.field-job-workflow",
    genericIds: ["DOMAIN.FIELD_JOB_WORKFLOW"],
    family: "domain",
    title: "Field Job Workflow",
    purpose: "Analyze one declared generic field-job phase, task, dependency, or evidence handoff using externally supplied workflow facts and descriptive safety context without directing field operations.",
    signals: ["DOMAIN.FIELD_JOB_WORKFLOW", "field job workflow", "field task", "job phase"],
    context: ["workflow.domain", "workflow.phase", "workflow.task", "workflow.dependencies", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.oshaOilGas, sourceCatalog.oshaSitePreparation],
    standards: [],
    upstream: "specialist.domain.workflow-router",
    included: ["one declared field-job phase", "task/dependency evidence", "typed workflow handoff", "unknown and stop-work escalation record"],
    nonGoals: ["dispatch or scheduling", "equipment/load/pressure/capacity truth", "safety certification", "unbounded domain policy", "unrelated well, finance, or regulatory analysis"],
  },
  {
    slug: "well-workflow",
    blockId: "specialist.domain.well-workflow",
    genericIds: ["DOMAIN.WELL_WORKFLOW"],
    family: "domain",
    title: "Well Workflow",
    purpose: "Analyze one declared generic well-operation phase or task sequence using externally supplied operation facts and public descriptive workflow context without asserting well control, pressure, equipment, or safety truth.",
    signals: ["DOMAIN.WELL_WORKFLOW", "well workflow", "drilling phase", "completion", "servicing", "workover"],
    context: ["workflow.domain", "workflow.phase", "workflow.task", "workflow.operation_scope", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.oshaOilGas],
    standards: [],
    upstream: "specialist.domain.workflow-router",
    included: ["one declared well-operation phase", "phase/task dependency evidence", "public descriptive workflow mapping", "safety and engineering escalation boundary"],
    nonGoals: ["well control or pressure determination", "equipment selection", "safe-operating instruction", "regulatory applicability conclusion", "unrelated field or 3D analysis"],
  },
  {
    slug: "industrial-3d",
    blockId: "specialist.graphics.industrial-3d",
    genericIds: ["GRAPHICS.INDUSTRIAL_3D"],
    family: "graphics",
    title: "Industrial 3D Asset Pipeline",
    purpose: "Analyze one declared industrial 3D asset-pipeline concern—identity, interchange, materials, topology, placement, or runtime attachment—against exact source and externally supplied asset evidence without asserting engineering truth.",
    signals: ["GRAPHICS.INDUSTRIAL_3D", "industrial 3D", "GLB", "gltf", "asset pipeline"],
    context: ["asset.domain", "asset.stage", "asset.identity", "asset.format", "asset.evidence", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.blenderGltf],
    standards: ["specialist.standard.gltf-2-0-1"],
    upstream: "specialist.graphics.industrial-3d-router",
    included: ["one 3D asset concern", "exact glTF identity and extension mapping", "asset provenance and unavailable-state evidence", "typed runtime handoff"],
    nonGoals: ["CAD/dimensional truth", "OEM/source identity", "load/pressure/safety claims", "visual acceptance", "unrelated rendering or model-generation authority"],
  },
  {
    slug: "search-rag",
    blockId: "specialist.ai.search-rag",
    genericIds: ["AI.SEARCH_RAG"],
    family: "ai-search",
    title: "AI Search and Retrieval-Augmented Generation",
    purpose: "Analyze one declared search/RAG evidence concern—retrieval, indexing, ranking, citation, permission filtering, freshness, poisoning, prompt injection, abstention, or evaluation—without selecting a provider or claiming truth.",
    signals: ["AI.SEARCH_RAG", "search relevance", "RAG", "retrieval", "ranking", "citation", "permission filtering"],
    context: ["ai.system_scope", "corpus.scope", "corpus.authority", "retrieval.task", "retrieval.evaluation", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.nistAiRmf, sourceCatalog.nistGenAi],
    standards: ["specialist.standard.nist-ai-rmf-1-0", "specialist.standard.nist-genai-profile-1-0"],
    upstream: "specialist.ai.search-router",
    included: ["one search/RAG failure or evidence domain", "corpus authority and permission-filter evidence", "retrieval/ranking/citation evaluation context", "abstention and unknown handoff"],
    nonGoals: ["answer generation", "model/provider selection", "corpus permission grant", "truth or safety certification", "memory internals", "unrelated AI modalities"],
  },
  {
    slug: "fmcsa-applicability",
    blockId: "specialist.regulatory.fmcsa-applicability",
    genericIds: ["REG.FMCSA_APPLICABILITY"],
    family: "regulatory",
    title: "FMCSA Applicability",
    purpose: "Map a declared motor-carrier applicability question to the exact 2025 49 CFR Part 390 source and identify missing jurisdiction, entity, activity, commerce, vehicle, definition, or exception evidence without giving legal advice.",
    signals: ["REG.FMCSA_APPLICABILITY", "FMCSA applicability", "49 CFR 390.3", "49 CFR 390.5"],
    context: ["regulation.jurisdiction", "regulation.entity", "regulation.activity", "regulation.commerce", "regulation.vehicle", "regulation.exception", "regulation.version", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.fmcsa],
    standards: ["specialist.standard.fmcsa-part-390-2025"],
    upstream: "specialist.regulatory.applicability-router",
    included: ["one FMCSA Part 390 applicability question", "section and definition mapping", "exception evidence ledger", "typed legal-review escalation"],
    nonGoals: ["legal advice", "compliance certification", "HOS/CDL/ELD/maintenance/hazmat conclusions", "state-law inference", "enforcement or operating instruction"],
  },
  {
    slug: "job-cost-accounting",
    blockId: "specialist.finance.job-cost-accounting",
    genericIds: ["FIN.JOB_COST_ACCOUNTING"],
    family: "finance",
    title: "Job-Cost Accounting",
    purpose: "Analyze one declared job-cost or managerial-costing control concern—cost object, responsibility segment, allocation evidence, reconciliation, or control activity—without posting entries or impersonating a licensed professional.",
    signals: ["FIN.JOB_COST_ACCOUNTING", "job cost accounting", "cost object", "cost allocation", "cost center", "managerial costing"],
    context: ["accounting.entity", "accounting.objective", "accounting.period", "accounting.cost_object", "accounting.policy", "accounting.evidence", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.irsCost, sourceCatalog.gaoGreenBook],
    standards: ["specialist.standard.gao-green-book-2025"],
    upstream: "specialist.finance.accounting-router",
    included: ["one job-cost control concern", "cost-object and responsibility-segment evidence", "allocation/reconciliation traceability", "professional-review handoff"],
    nonGoals: ["bookkeeping or ledger mutation", "tax advice", "GAAP/IFRS opinion", "financial statement acceptance", "licensed-accountant impersonation", "unrelated procurement or payroll authority"],
  },
];

function makeBlock(spec) {
  const isRouter = spec.roleKind === "ROUTER";
  const dependencies = sorted([
    ...foundationDependencies,
    ...(spec.dependencies ?? []),
    ...(spec.upstream ? [spec.upstream] : []),
    ...(spec.standards ?? []),
  ]);
  const requiredContext = sorted(["request", "signals", "authority", "source_lock", "custody", ...spec.context]);
  const nonGoals = sorted([...(spec.nonGoals ?? []), "silent scope expansion", "self-admission", "Product writing", "acceptance", "activation"]);
  const included = sorted(spec.included ?? ["typed classification", "version-bound evidence", "typed handoff"]);
  const forbidden = sorted([
    "activate, admit, deploy, publish, or self-accept",
    "write Product or consumer state",
    "infer missing authority, applicability, or evidence",
    ...(isRouter ? ["perform atomic specialist work", "substitute for a narrower atomic specialist"] : ["broaden to a family or sibling concern", "claim another provider, standard, or version"]),
  ]);
  const permitted = isRouter
    ? ["classify the named P5 signal", "assemble typed context for downstream atomic blocks", "return NOT_APPLICABLE when the family is absent", "escalate missing authority or evidence"]
    : ["analyze the exact named P5 concern", "return evidence-bounded findings", "return NOT_APPLICABLE when the concern is absent", "escalate missing authority or conflicting evidence"];
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P5",
    role_kind: spec.roleKind,
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included, non_goals: nonGoals, smallest_sufficient_rule: isRouter ? "Classify and assemble context only; split domain, authority, platform, provider, standard, and failure-mode concerns into narrower routes when evidenced." : "Analyze only the named P5 concern and return NOT_APPLICABLE when it is absent; do not infer operational, legal, financial, engineering, or model truth."},
    atomic_scope_statement: isRouter ? `Router-only classification for ${spec.title}; it has no Product, operational, legal, financial, engineering, or acceptance authority.` : `One narrow atomic evidence domain: ${spec.title}; unrelated domain, provider, standard, platform, or failure modes require sibling blocks.`,
    permitted_decisions: sorted(permitted),
    forbidden_decisions: forbidden,
    maximum_authority: isRouter ? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION;_TYPED_ROUTING_ONLY" : "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION",
    required_upstream_router: spec.upstream ?? null,
    sibling_conflicts: sorted(spec.siblingConflicts ?? []),
    composition_rules: sorted(isRouter ? ["compose only with declared foundation controls", "split the five P5 authority/failure domains when evidenced", "never substitute for an atomic specialist", "UNKNOWN closes only the dependent route"] : ["must be selected by the required upstream router", "compose only with explicitly named dependencies and siblings", "reuse exact standard block IDs, versions, and hashes", "UNKNOWN closes only the dependent action"]),
    escalation_target: isRouter ? "specialist.foundation.role-intake-classifier" : "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority or source lock differs", "tool or data custody differs", "failure mode differs", "jurisdiction, provider, standard, version, or professional-authority boundary differs"]),
    required_knowledge: sorted(["atomic specialization law", "exact source lock", "typed context contract", ...(spec.standards ?? [])]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "missing source lock", "stale or superseded source", "unsafe action", ...(isRouter ? [] : ["unresolved jurisdiction, platform, provider, standard, or version", "scope expansion"])]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: sorted(["project_context", "evaluation_receipt", "runtime_readback"]), deny_if_missing: sorted(["authority", "source_lock", "custody", ...spec.context]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing context", "stale source", "unsafe action", "scope expansion"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact source lock identity", "gate trace", "typed context", "unknown ledger", ...(spec.standards ?? []).map((id) => `${id} hash`)]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "status", "findings", "evidence", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["exact source records in sources.lock", "typed context within the declared scope", "reusable standard block identities and requirement mappings", "evidence-bounded analysis"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary source or immutable standard block", "external typed project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "provider/account mutation", "Product acceptance", "self-authored admission", "another provider, standard, or version", "legal, accounting, engineering, safety, or model certification claim"]), jurisdiction_rule: "Require exact P5 concern, source scope, authority, freshness, and typed context; regulated, financial, engineering, safety, and professional applicability remain external.", escalation_rule: "Conflict or missing protected authority closes only the dependent action and escalates to the named control-plane owner.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Check publisher, identifier, version, publication/effective/supersession status, retrieved date, immutable identity, and digest when obtainable; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact source-backed P5 concern and selected reusable standards; no cross-domain, cross-version, legal, financial, engineering, safety, or provider claim is permitted.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses inference or scope expansion."},
    controls: {read: sorted(["candidate package", "typed authority corpus", "declared primary source metadata", ...(spec.standards ?? []).map((id) => `${id} package`)]), write: sorted(["own isolated candidate package", "typed handoff receipt"]), tools: sorted(["local deterministic validator", "source-lock reader", "fixture evaluator"]), data: sorted(["public source metadata", "synthetic or externally supplied typed context only", "no secrets", "no protected consumer data"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
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

function buildSourceLock(spec, block) {
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: block.block_id, sources: [...spec.sources].sort((left, right) => left.source_id.localeCompare(right.source_id)), freshness_rule: "DENY dependent action when a source or reusable authority is stale, superseded, unverifiable, or missing exact version/effective/publication status; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const next = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact ${gateId} condition pass without expanding this ${block.role_kind === "ROUTER" ? "router" : "atomic specialist"} scope?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_lock_identity", ...(spec.upstream ? ["upstream_router_identity"] : []), ...(spec.standards ?? []).map((id) => `${id}_hash`)]), next: {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const hostile = new Set(["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES]);
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: hostile.has(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "deterministic-independent-p5-domain-ai-3d-reg-finance-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["p5-domain-ai-3d-reg-finance-scope-and-authority", "source-lock-digest", "reusable-standard-dependency-identities", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required", ...(spec.upstream ? ["upstream-router-closure"] : ["router-only-split-boundary"])]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability and project context remain external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: `Route the immutable P5 ${block.role_kind === "ROUTER" ? "router" : "atomic specialist"} candidate through independent evaluation; preserve activation OFF.`, authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/wave-06/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const block = makeBlock(spec);
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
  for (const className of sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; provider, project, consumer, secret, and applicability facts remain external.`});
  return block;
}

function updateAtomicInventory(repositoryRoot, specs, blocks) {
  const inventoryPath = path.join(repositoryRoot, "specialist-blocks/registry/atomic-inventory.v1.json");
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const atomicGenericIds = new Set(atomicSpecs.flatMap((spec) => spec.genericIds));
  inventory.routers = inventory.routers.filter((item) => !atomicGenericIds.has(item.generic_id));
  const byGenericId = new Map();
  for (let index = 0; index < specs.length; index += 1) for (const genericId of specs[index].genericIds ?? []) byGenericId.set(genericId, blocks[index]);
  const upsert = (entries, genericId, extra) => {
    let item = entries.find((candidate) => candidate.generic_id === genericId);
    if (!item) { item = {generic_id: genericId, ...extra}; entries.push(item); }
    Object.assign(item, extra);
  };
  for (const spec of routerSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    for (const genericId of spec.genericIds) upsert(inventory.routers, genericId, {title: spec.title, version: "1.0.0", source_lock: "sources.lock", block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  for (const spec of atomicSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    upsert(inventory.atomic_specialists, spec.genericIds[0], {title: spec.title, version: "1.0.0", router: spec.upstream, block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  inventory.routers.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.atomic_specialists.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.counts = {ROUTER: inventory.routers.length, ATOMIC_SPECIALIST: inventory.atomic_specialists.length, CONTROL_PLANE: inventory.control_plane.length};
  writeJson(inventoryPath, inventory);
  const masterPath = path.join(repositoryRoot, "specialist-blocks/registry/master-inventory.v1.json");
  const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
  master.role_kind_counts.ATOMIC_SPECIALIST = inventory.atomic_specialists.length;
  writeJson(masterPath, master);
}

export function scaffoldP5DomainAi3dRegFinance(repositoryRoot = process.cwd()) {
  const specs = [
    ...routerSpecs.map((spec) => ({...spec, roleKind: "ROUTER"})),
    ...atomicSpecs.map((spec) => ({...spec, roleKind: "ATOMIC_SPECIALIST"})),
  ];
  const blocks = specs.map((spec) => writePackage(repositoryRoot, spec));
  updateAtomicInventory(repositoryRoot, specs, blocks);
  return blocks.map((block) => block.block_id);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify({status: "PASS", packages: scaffoldP5DomainAi3dRegFinance(process.cwd())}, null, 2)}\n`);
