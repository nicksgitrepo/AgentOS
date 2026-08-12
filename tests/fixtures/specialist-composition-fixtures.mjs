import {canonicalDigest, GATE_OUTCOMES, SPECIALIST_GATE_IDS} from "../../control/specialist-block-compiler.mjs";

const ZERO = "0000000000000000000000000000000000000000";

function digest(value) {
  return canonicalDigest(value);
}

function makeBlock({block_id, version = "1.0.0", role_kind, layer, dependencies = [], required_context = [], standard_identity = null, forbidden_decisions = []}) {
  const block = {
    block_id,
    version,
    role_kind,
    layer,
    dependencies: [...dependencies].sort(),
    conflicts: [],
    required_context: [...required_context].sort(),
    permitted_decisions: ["return typed scoped analysis"],
    forbidden_decisions: [...new Set(["write Product", "self-accept", "silently broaden scope", ...forbidden_decisions])].sort(),
    maximum_authority: "NO_PRODUCT_WRITE;_NO_ACTIVATION;_NO_SELF_ACCEPTANCE;_TYPED_HANDOFF_ONLY",
    applicability: {outcome: "YES", source_state: "FRESH"},
    source_state: "FRESH",
    reuse: {
      content_addressed: true,
      reuse_key: `block-lock.${block_id.replace(/^specialist\./u, "").replace(/[^a-z0-9-]+/giu, "-")}`,
      standard_identity,
      applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY",
    },
    source_lock_digest: digest({block_id, version, source: "fixture-primary-source"}),
    gate_ids: [...SPECIALIST_GATE_IDS],
  };
  block.hash = digest({...block, hash: null});
  return block;
}

const sharedGovernance = makeBlock({
  block_id: "specialist.fixture.general-governance",
  role_kind: "CONTROL_PLANE",
  layer: "agentos-governance",
  required_context: ["request.kind"],
});

const sharedNist = makeBlock({
  block_id: "specialist.fixture.standard.nist-ssdf",
  version: "1.1.0",
  role_kind: "STANDARD_BLOCK",
  layer: "change-release-supply-chain",
  standard_identity: {publisher: "NIST", identifier: "NIST SSDF", edition: "1.1"},
  required_context: ["standard.applicability"],
});

const sharedAsvs = makeBlock({
  block_id: "specialist.fixture.standard.owasp-asvs",
  version: "5.0.0",
  role_kind: "STANDARD_BLOCK",
  layer: "security-privacy-safety",
  standard_identity: {publisher: "OWASP", identifier: "ASVS", edition: "5.0.0"},
  required_context: ["standard.applicability"],
});

const sharedSlsa = makeBlock({
  block_id: "specialist.fixture.standard.slsa",
  version: "1.2.0",
  role_kind: "STANDARD_BLOCK",
  layer: "change-release-supply-chain",
  standard_identity: {publisher: "SLSA", identifier: "SLSA", edition: "1.2"},
  required_context: ["artifact.provenance"],
});

const rust = makeBlock({
  block_id: "specialist.fixture.rust-backend",
  role_kind: "KNOWLEDGE_BLOCK",
  layer: "language-runtime-framework",
  dependencies: [sharedGovernance.block_id, sharedNist.block_id, sharedAsvs.block_id],
  required_context: ["language.edition", "api.contract"],
});

const search = makeBlock({
  block_id: "specialist.fixture.search-rag",
  role_kind: "ATOMIC_SPECIALIST",
  layer: "domain-capability",
  dependencies: [sharedGovernance.block_id, sharedNist.block_id, sharedAsvs.block_id],
  required_context: ["corpus.authority", "retrieval.freshness"],
});

const web = makeBlock({
  block_id: "specialist.fixture.typescript-web",
  role_kind: "ATOMIC_SPECIALIST",
  layer: "language-runtime-framework",
  dependencies: [sharedGovernance.block_id, sharedNist.block_id, sharedAsvs.block_id],
  required_context: ["web.route", "browser.target"],
});

const data = makeBlock({
  block_id: "specialist.fixture.postgres-data",
  role_kind: "ATOMIC_SPECIALIST",
  layer: "architecture-platform",
  dependencies: [sharedGovernance.block_id, sharedNist.block_id, sharedSlsa.block_id],
  required_context: ["data.schema", "data.tenant-boundary"],
});

const broadSecurityRouter = makeBlock({
  block_id: "specialist.fixture.security-router",
  role_kind: "ROUTER",
  layer: "task-role-authority",
  dependencies: [sharedGovernance.block_id],
  required_context: ["security.signal"],
});

const unsafeRust = makeBlock({
  block_id: "specialist.fixture.unsafe-rust-authority",
  role_kind: "ATOMIC_SPECIALIST",
  layer: "language-runtime-framework",
  dependencies: [sharedGovernance.block_id],
  required_context: ["language.edition"],
  forbidden_decisions: ["grant unsafe authority"],
});

export const BLOCKS = Object.freeze([
  sharedGovernance,
  sharedNist,
  sharedAsvs,
  sharedSlsa,
  rust,
  search,
  web,
  data,
  broadSecurityRouter,
  unsafeRust,
]);

const ALL_CONTEXT_FIELDS = Object.freeze([
  "api.contract",
  "artifact.provenance",
  "browser.target",
  "candidate.identity",
  "corpus.authority",
  "data.schema",
  "data.tenant-boundary",
  "language.edition",
  "request.kind",
  "retrieval.freshness",
  "security.signal",
  "standard.applicability",
  "web.route",
]);

function ref(identity, version, status, authority) {
  return {identity, version, digest: digest({identity, version}), authority, status};
}

export function makeExternal(label = "alpha", {contextFields = ALL_CONTEXT_FIELDS, governanceStatus = "COMPLETE", freshnessStatus = "FRESH", corpusStatus = "COMPLETE"} = {}) {
  return {
    project_governance: ref(`external.project-governance.${label}`, "1.0.0", governanceStatus, "EXTERNAL_TYPED_PROJECT_GOVERNANCE"),
    context: {
      identity: `external.current-context.${label}`,
      version: "1.0.0",
      digest: digest({context: label, fields: [...contextFields].sort()}),
      field_ids: [...contextFields].sort(),
      completeness: contextFields.length > 0 ? "COMPLETE" : "UNKNOWN",
      corpus_authority: ref(`external.corpus-authority.${label}`, "1.0.0", corpusStatus, "EXTERNAL_AUTHORITY_CORPUS"),
    },
    candidate: ref(`external.candidate.${label}`, "1.0.0", "BOUND", "EXTERNAL_CANDIDATE"),
    worktree: {identity: `external.worktree.${label}`, base_commit: ZERO, base_tree: ZERO, custody: "isolated-governed-worktree"},
    custody: ref(`external.custody.${label}`, "1.0.0", "BOUND", "EXTERNAL_CUSTODY_RECEIPT"),
    freshness: ref(`external.freshness.${label}`, "1.0.0", freshnessStatus, "EXTERNAL_SOURCE_OVERLAY"),
    capabilities: {
      read: ["bound candidate", "typed context"],
      write: ["bound candidate/worktree"],
      tools: ["deterministic compiler", "local validator"],
      data: ["synthetic or externally bound typed data"],
      secrets: "DENY",
      browser: "READ_ONLY_PRIMARY_SOURCES",
      build: "LOCAL_ISOLATED_CANDIDATE",
      deploy: "DENY",
      communication: "TYPED_HANDOFF_ONLY",
      resources: ["bounded local worker lease"],
    },
  };
}

function recipe(recipe_id, required_block_ids, required_atomic_blocks, required_standard_blocks, required_context_fields, reasons) {
  return {
    recipe_id,
    version: "1.0.0",
    family: "fixture-task-shaped-agent",
    purpose: `Compile the smallest dependency-complete ${recipe_id} task-shaped agent.`,
    required_block_ids: [...required_block_ids].sort(),
    required_atomic_blocks: [...required_atomic_blocks].sort(),
    required_standard_blocks: [...required_standard_blocks].sort(),
    required_context_fields: [...required_context_fields].sort(),
    optional_block_ids: [],
    required_layers: [],
    reasons,
  };
}

export const RECIPES = Object.freeze({
  rustSearch: recipe("recipe.fixture.rust-search", [sharedGovernance.block_id, sharedNist.block_id, sharedAsvs.block_id, rust.block_id, search.block_id], [search.block_id], [sharedAsvs.block_id, sharedNist.block_id], ["request.kind", "language.edition", "api.contract", "corpus.authority", "retrieval.freshness", "standard.applicability", "candidate.identity"], {
    [sharedGovernance.block_id]: "general AgentOS governance is mandatory",
    [sharedNist.block_id]: "reuse the exact NIST SSDF edition once",
    [sharedAsvs.block_id]: "reuse the exact ASVS edition for the security overlay",
    [rust.block_id]: "bind Rust runtime and backend failure modes",
    [search.block_id]: "bind retrieval, freshness, corpus authority, and abstention scope",
  }),
  web: recipe("recipe.fixture.typescript-web", [sharedGovernance.block_id, sharedNist.block_id, sharedAsvs.block_id, web.block_id], [web.block_id], [sharedAsvs.block_id, sharedNist.block_id], ["request.kind", "web.route", "browser.target", "standard.applicability", "candidate.identity"], {
    [sharedGovernance.block_id]: "general AgentOS governance is mandatory",
    [sharedNist.block_id]: "reuse the exact NIST SSDF edition once",
    [sharedAsvs.block_id]: "reuse the exact ASVS edition for web security",
    [web.block_id]: "bind TypeScript web route and browser target scope",
  }),
  data: recipe("recipe.fixture.postgres-data", [sharedGovernance.block_id, sharedNist.block_id, sharedSlsa.block_id, data.block_id], [data.block_id], [sharedNist.block_id, sharedSlsa.block_id], ["request.kind", "data.schema", "data.tenant-boundary", "artifact.provenance", "standard.applicability", "candidate.identity"], {
    [sharedGovernance.block_id]: "general AgentOS governance is mandatory",
    [sharedNist.block_id]: "reuse the exact NIST SSDF edition once",
    [sharedSlsa.block_id]: "reuse the exact SLSA edition for provenance",
    [data.block_id]: "bind PostgreSQL schema and tenant-boundary scope",
  }),
});

export const TASKS = Object.freeze({
  rustSearch: {lane: "fixture.rust-search", goal: "compile a bounded Rust backend AI search builder", outcome: "typed-candidate-handoff", non_goals: ["deployment", "legal certification"], owner_intent: {identity: "external.owner-intent.rust-search", version: "1.0.0", digest: digest({owner: "rust-search"})}},
  web: {lane: "fixture.typescript-web", goal: "compile a bounded TypeScript web builder", outcome: "typed-candidate-handoff", non_goals: ["deployment", "product acceptance"], owner_intent: {identity: "external.owner-intent.typescript-web", version: "1.0.0", digest: digest({owner: "typescript-web"})}},
  data: {lane: "fixture.postgres-data", goal: "compile a bounded PostgreSQL data builder", outcome: "typed-candidate-handoff", non_goals: ["deployment", "data certification"], owner_intent: {identity: "external.owner-intent.postgres-data", version: "1.0.0", digest: digest({owner: "postgres-data"})}},
});

export const PARENT = {identity: "external.parent-controller.fixture", version: "1.0.0", digest: digest({parent: "fixture-controller"})};

export const LIBRARY_IDENTITY = {id: "agentos.specialist-block-library.fixture", version: "2.1rc", digest: digest({library: "fixture-library", version: "2.1rc"})};

export function clone(value) {
  return structuredClone(value);
}

export {digest};
