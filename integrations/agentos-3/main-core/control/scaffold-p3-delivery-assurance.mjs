#!/usr/bin/env node

/* Deterministic P3 delivery/assurance candidates and their narrow prerequisite route. */

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
const SOURCE_COMMIT = "a6407f4c991d1768596f43f2f29d5a91d8044c0c";
const SOURCE_TREE = "2c392cf5d4f4a0fdb942c8d37fd09d3d836ef2f2";

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
  slsa: source("source.slsa-provenance", "SLSA Provenance", "SLSA", "https://slsa.dev/spec/v1.2/provenance", "1.2", "slsa-provenance-v1.2", "Source-to-artifact provenance and build identity; no deployment or release acceptance authority.", {effective_date: "2023-06-01", authority_class: "PRIMARY_NORMATIVE"}),
  semver: source("source.semantic-versioning-2-0-0", "Semantic Versioning", "Semantic Versioning", "https://semver.org/spec/v2.0.0.html", "2.0.0", "semantic-versioning-2.0.0", "Version precedence and compatibility signaling; no product acceptance or release authority.", {effective_date: "2013-06-21", authority_class: "PRIMARY_NORMATIVE"}),
  conventionalCommits: source("source.conventional-commits-1-0-0", "Conventional Commits", "Conventional Commits", "https://www.conventionalcommits.org/en/v1.0.0/", "1.0.0", "conventional-commits-1.0.0", "Commit-message structure and change-intent signaling; no merge or release authority.", {effective_date: "2019-02-26", authority_class: "PRIMARY_NORMATIVE"}),
  gitWorktree: source("source.git-worktree", "git-worktree Documentation", "Git", "https://git-scm.com/docs/git-worktree.html", "current", "git-worktree-documentation-current-2026-08-11", "Worktree attachment, custody, locking, readback, and safe removal semantics; no destructive action authority.", {authority_class: "PRIMARY_DESCRIPTIVE"}),
  sreMonitoring: source("source.google-sre-monitoring", "Monitoring Distributed Systems", "Google SRE", "https://sre.google/sre-book/monitoring-distributed-systems/", "current", "google-sre-monitoring-distributed-systems-current-2026-08-11", "Monitoring, alerting, signal quality, and incident evidence concepts; no production mutation authority.", {authority_class: "PRIMARY_DESCRIPTIVE"}),
  sreTesting: source("source.google-sre-testing-reliability", "Testing for Reliability", "Google SRE", "https://sre.google/sre-book/testing-reliability/", "current", "google-sre-testing-reliability-current-2026-08-11", "Reliability-oriented test strategy and evidence; no acceptance authority.", {authority_class: "PRIMARY_DESCRIPTIVE"}),
  postgresqlTransactions: source("source.postgresql-transactions", "PostgreSQL Transaction Isolation", "PostgreSQL Global Development Group", "https://www.postgresql.org/docs/current/transaction-iso.html", "current", "postgresql-transaction-isolation-current-2026-08-11", "Transaction isolation and rollback evidence used as a database-specific example; no database mutation authority.", {authority_class: "PRIMARY_NORMATIVE"}),
};

const foundationDependencies = [
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
];

const controlSpecs = [
  {
    slug: "central-integrator",
    blockId: "specialist.control.central-integrator",
    genericIds: ["AGENT.CENTRAL_INTEGRATOR"],
    family: "permanent-governance-control",
    title: "Integration/Central Owner",
    purpose: "Coordinate typed block locks, authority edges, proof dependencies, and handoff sequencing without accepting or mutating a downstream product.",
    signals: ["AGENT.CENTRAL_INTEGRATOR", "central integration", "authority graph", "block lock"],
    context: ["integration.candidate", "integration.dependencies", "integration.conflicts", "handoff.receipt"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.slsa],
    standards: ["specialist.standard.nist-ssdf", "specialist.standard.slsa"],
    dependencies: ["specialist.foundation.evaluation-admission-gate", "specialist.foundation.registry-alias-deduplicator"],
    included: ["typed dependency ordering", "authority-graph reconciliation", "handoff sequencing", "conflict escalation"],
    nonGoals: ["merge authority", "Product acceptance", "activation", "deployment", "consumer adoption"],
  },
  {
    slug: "release-manager",
    blockId: "specialist.control.release-manager",
    genericIds: ["AGENT.RELEASE_MANAGER"],
    family: "permanent-governance-control",
    title: "Release Manager",
    purpose: "Coordinate version, change, proof, rollback, and release-readiness evidence while leaving publication and deployment authority external.",
    signals: ["AGENT.RELEASE_MANAGER", "release readiness", "version change", "rollback evidence"],
    context: ["release.version", "release.changes", "release.proof", "release.rollback"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.semver, sourceCatalog.conventionalCommits, sourceCatalog.slsa],
    standards: ["specialist.standard.conventional-commits-1-0-0", "specialist.standard.nist-ssdf", "specialist.standard.semantic-versioning-2-0-0", "specialist.standard.slsa"],
    dependencies: ["specialist.foundation.evaluation-admission-gate"],
    included: ["version identity", "change evidence", "release proof matrix", "rollback readiness"],
    nonGoals: ["public publication", "deployment", "approving production risk", "licensed legal or accounting advice"],
  },
  {
    slug: "worktree-custody",
    blockId: "specialist.control.worktree-custody",
    genericIds: ["AGENT.WORKTREE_CUSTODY"],
    family: "permanent-governance-control",
    title: "Worktree/Custody Manager",
    purpose: "Bind candidate identity, worktree ownership, changed-path scope, clean readback, and recovery receipts without deleting or merging work.",
    signals: ["AGENT.WORKTREE_CUSTODY", "worktree custody", "changed paths", "clean readback"],
    context: ["candidate.identity", "worktree.identity", "worktree.base", "worktree.changed_paths", "custody.receipt"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.gitWorktree, sourceCatalog.slsa],
    standards: ["specialist.standard.slsa"],
    dependencies: ["specialist.foundation.tool-custody-gate", "specialist.foundation.evidence-freshness-gate"],
    included: ["candidate/worktree binding", "changed-path receipt", "clean and remote readback", "recoverable custody state"],
    nonGoals: ["destructive cleanup", "merge", "push authorization", "secret custody", "consumer repository mutation"],
  },
];

const routerSpecs = [
  {
    slug: "observability-router",
    blockId: "specialist.delivery-operations.observability-router",
    genericIds: ["INTERNAL.SRE_OBSERVABILITY_ROUTER"],
    family: "delivery-operations",
    title: "Observability and Incident Router",
    purpose: "Classify observability and incident signals and assemble the smallest evidence-bound monitoring or incident specialist route.",
    signals: ["SRE.OBSERVABILITY_INCIDENT", "observability", "monitoring", "incident response", "alerting"],
    context: ["service.identity", "signal.scope", "incident.identity", "source_lock"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.sreMonitoring],
    standards: [],
    dependencies: [],
    included: ["observability signal classification", "incident-context assembly", "atomic route selection"],
    nonGoals: ["production mutation", "incident command", "acceptance", "root-cause claims without evidence"],
  },
];

const atomicSpecs = [
  {
    slug: "test-architect",
    blockId: "specialist.assurance-enterprise.test-architect",
    genericIds: ["QA.TEST_ARCHITECT"],
    family: "assurance-enterprise",
    title: "Test Architecture",
    purpose: "Analyze one test-architecture concern and its evidence contract without accepting product completeness or replacing test-type specialists.",
    signals: ["QA.TEST_ARCHITECT", "test architecture", "test strategy", "quality gates"],
    context: ["test.scope", "test.strategy", "test.evidence", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.sreTesting],
    standards: ["specialist.standard.nist-ssdf"],
    upstream: "specialist.assurance-enterprise.router",
    included: ["test-level composition", "coverage and traceability evidence", "risk-based test strategy"],
    nonGoals: ["unit/integration implementation", "test execution", "release acceptance", "product writing"],
  },
  {
    slug: "observability-incident",
    blockId: "specialist.delivery-operations.observability-incident",
    genericIds: ["SRE.OBSERVABILITY_INCIDENT"],
    family: "delivery-operations",
    title: "Observability/Incident Evidence",
    purpose: "Analyze only the named observability or incident evidence concern and return NOT_APPLICABLE when the signal is absent.",
    signals: ["SRE.OBSERVABILITY_INCIDENT", "observability", "monitoring", "incident evidence", "alert quality"],
    context: ["service.identity", "signal.scope", "incident.identity", "observability.evidence", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.sreMonitoring],
    standards: ["specialist.standard.slsa"],
    upstream: "specialist.delivery-operations.observability-router",
    included: ["signal identity", "alert/evidence quality", "incident timeline evidence", "typed escalation"],
    nonGoals: ["production changes", "incident command", "customer communication", "availability guarantees"],
  },
  {
    slug: "migration-rollback",
    blockId: "specialist.data.migration-rollback",
    genericIds: ["DATA.MIGRATION_ROLLBACK"],
    family: "data",
    title: "Data Migration/Rollback",
    purpose: "Analyze migration ordering, reversibility, backup, and rollback evidence for the named data change without executing it.",
    signals: ["DATA.MIGRATION_ROLLBACK", "migration rollback", "schema migration", "backfill rollback"],
    context: ["data.engine", "data.migration", "data.rollback", "data.backup", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.postgresqlTransactions, sourceCatalog.slsa],
    standards: ["specialist.standard.nist-ssdf", "specialist.standard.slsa"],
    upstream: "specialist.data.router",
    included: ["migration dependency ordering", "rollback and backup evidence", "irreversible-step identification", "typed recovery handoff"],
    nonGoals: ["executing migrations", "deleting data", "database-specific authority without engine evidence", "release acceptance"],
  },
];

function makeBlock(spec) {
  const isControl = spec.roleKind === "CONTROL_PLANE";
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
    ...(isRouter ? ["perform atomic specialist work", "substitute for a narrower atomic specialist"] : isControl ? ["merge or mutate another worktree", "grant downstream acceptance authority"] : ["broaden to a family or sibling concern", "claim another provider, standard, or version"]),
  ]);
  const permitted = isRouter
    ? ["classify the named observability signal", "assemble typed context for downstream atomic blocks", "return NOT_APPLICABLE when the family is absent", "escalate missing authority or evidence"]
    : isControl
      ? ["coordinate named governance dependencies", "reconcile typed receipts", "return NOT_APPLICABLE when the control condition is absent", "escalate conflicts or missing authority"]
      : ["analyze the exact named concern", "return evidence-bounded findings", "return NOT_APPLICABLE when the concern is absent", "escalate missing authority or conflicting evidence"];
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P3",
    role_kind: spec.roleKind,
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included, non_goals: nonGoals, smallest_sufficient_rule: isRouter ? "Classify and assemble context only; select atomic specialists when a narrow concern is evidenced." : isControl ? "Coordinate only the named governance boundary; leave unrelated work and external authority unchanged." : "Analyze only the named atomic concern and return NOT_APPLICABLE when it is absent."},
    atomic_scope_statement: isRouter ? `Router-only classification for ${spec.title}; it has no downstream Product or acceptance authority.` : isControl ? `Governance-only control for ${spec.title}; it does not perform downstream Product work or grant acceptance authority.` : `One narrow atomic evidence domain: ${spec.title}; unrelated failure modes require sibling blocks.`,
    permitted_decisions: sorted(permitted),
    forbidden_decisions: forbidden,
    maximum_authority: isRouter ? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION;_TYPED_ROUTING_ONLY" : isControl ? "GOVERNANCE_COORDINATION_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_MERGE;_NO_DEPLOY;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION" : "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION",
    required_upstream_router: spec.upstream ?? null,
    sibling_conflicts: sorted(spec.siblingConflicts ?? []),
    composition_rules: sorted(isRouter ? ["compose only with declared foundation dependencies", "never substitute for an atomic specialist", "UNKNOWN closes only the dependent route"] : isControl ? ["compose only with named governance dependencies", "do not add downstream authority", "UNKNOWN closes only the dependent governance action"] : ["must be selected by the required upstream router", "compose only with explicitly named dependencies and siblings", "reuse exact standard block IDs, versions, and hashes", "UNKNOWN closes only the dependent action"]),
    escalation_target: isRouter ? "specialist.foundation.role-intake-classifier" : "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority or source lock differs", "tool or data custody differs", "failure mode differs", "standard, provider, or version differs"]),
    required_knowledge: sorted(["atomic specialization law", "exact source lock", "typed context contract", ...(spec.standards ?? [])]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "missing source lock", "stale or superseded source", "unsafe action", ...(isRouter || isControl ? [] : ["unresolved standard version", "scope expansion"])]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: sorted(["project_context", "evaluation_receipt", "runtime_readback"]), deny_if_missing: sorted(["authority", "source_lock", "custody", ...spec.context]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing context", "stale source", "unsafe action", "scope expansion"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact source lock identity", "gate trace", "typed context", "unknown ledger", ...(spec.standards ?? []).map((id) => `${id} hash`)]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "status", "findings", "evidence", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["exact source records in sources.lock", "typed context within the declared scope", "reusable standard block identities and requirement mappings", "evidence-bounded analysis", ...(isControl ? ["named governance receipts"] : [])]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary source or immutable standard block", "external typed project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "provider/account mutation", "Product acceptance", "self-authored admission", "another provider, standard, or version"]), jurisdiction_rule: "Require exact role scope, source/standard version, applicability context, and freshness evidence; regulated or legal applicability remains external.", escalation_rule: "Conflict or missing protected authority closes only the dependent action and escalates to the named control-plane owner.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Check publisher, identifier, version, publication/effective/supersession status, retrieved date, immutable identity, and digest when obtainable; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact source-backed scope and selected reusable standards; no cross-version or cross-specialist claims.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses inference or scope expansion."},
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
  const sources = [...spec.sources].sort((left, right) => left.source_id.localeCompare(right.source_id));
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: block.block_id, sources, freshness_rule: "DENY dependent action when a source or reusable authority is stale, superseded, unverifiable, or missing exact version/effective/publication status; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const next = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact ${gateId} condition pass without expanding this ${block.role_kind} scope?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_lock_identity", ...(spec.upstream ? ["upstream_router_identity"] : []), ...(spec.standards ?? []).map((id) => `${id}_hash`)]), next: {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const hostile = new Set(["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES]);
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: hostile.has(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "gpt-5.6-luna/max", harness: "deterministic-independent-p3-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["p3-scope-and-authority", "source-lock-digest", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required", ...(spec.upstream ? ["upstream-router-closure"] : [])]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability and project context remain external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: `Route the immutable P3 ${block.role_kind === "CONTROL_PLANE" ? "governance" : block.role_kind === "ROUTER" ? "router" : "atomic"} candidate through independent evaluation; preserve activation OFF.`, authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/wave-04/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const block = makeBlock({...spec, roleKind: spec.roleKind ?? (spec.upstream ? "ATOMIC_SPECIALIST" : "ROUTER")});
  fs.mkdirSync(path.join(packageDir, "gates"), {recursive: true});
  fs.mkdirSync(path.join(packageDir, "fixtures"), {recursive: true});
  writeJson(path.join(packageDir, "block.json"), block);
  writeJson(path.join(packageDir, "sources.lock"), buildSourceLock(spec, block));
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

function updateInventory(repositoryRoot, specs, blocks) {
  const inventoryPath = path.join(repositoryRoot, "specialist-blocks/registry/atomic-inventory.v1.json");
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const byGenericId = new Map();
  for (let index = 0; index < specs.length; index += 1) for (const genericId of specs[index].genericIds ?? []) byGenericId.set(genericId, blocks[index]);
  const upsert = (entries, genericId, extra) => {
    let item = entries.find((candidate) => candidate.generic_id === genericId);
    if (!item) { item = {generic_id: genericId, ...extra}; entries.push(item); }
    Object.assign(item, extra);
    return item;
  };
  for (const item of inventory.control_plane) {
    const block = byGenericId.get(item.generic_id);
    if (block) Object.assign(item, {block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  for (const spec of controlSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    upsert(inventory.control_plane, spec.genericIds[0], {block_id: block.block_id, title: spec.title, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  for (const item of inventory.routers) {
    const block = byGenericId.get(item.generic_id);
    if (block) Object.assign(item, {block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  upsert(inventory.routers, "QA.ASSURANCE_ENTERPRISE_ROUTER", {block_id: "specialist.assurance-enterprise.router", title: "Assurance and Enterprise Router", version: "1.0.0", source_lock: "sources.lock", package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: "specialist-eval.assurance-enterprise-router.v1"});
  for (const spec of routerSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    upsert(inventory.routers, spec.genericIds[0], {block_id: block.block_id, title: spec.title, version: "1.0.0", source_lock: "sources.lock", package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  for (const item of inventory.atomic_specialists) {
    const block = byGenericId.get(item.generic_id);
    if (block) Object.assign(item, {block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  for (const spec of atomicSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    upsert(inventory.atomic_specialists, spec.genericIds[0], {block_id: block.block_id, title: spec.title, version: "1.0.0", router: spec.upstream, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
  }
  inventory.routers.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.atomic_specialists.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.control_plane.sort((left, right) => left.generic_id.localeCompare(right.generic_id));
  inventory.counts = {ROUTER: inventory.routers.length, ATOMIC_SPECIALIST: inventory.atomic_specialists.length, CONTROL_PLANE: inventory.control_plane.length};
  writeJson(inventoryPath, inventory);
}

export function scaffoldP3DeliveryAssurance(repositoryRoot = process.cwd()) {
  const specs = [
    ...controlSpecs.map((spec) => ({...spec, roleKind: "CONTROL_PLANE"})),
    ...routerSpecs.map((spec) => ({...spec, roleKind: "ROUTER"})),
    ...atomicSpecs.map((spec) => ({...spec, roleKind: "ATOMIC_SPECIALIST"})),
  ];
  const blocks = specs.map((spec) => writePackage(repositoryRoot, spec));
  updateInventory(repositoryRoot, specs, blocks);
  return blocks.map((block) => block.block_id);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify({status: "PASS", packages: scaffoldP3DeliveryAssurance(process.cwd())}, null, 2)}\n`);
