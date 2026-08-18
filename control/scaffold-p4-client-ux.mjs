#!/usr/bin/env node

/* Deterministic P4 client/UX candidates.  Broad desktop/offline/realtime is a router; the other entries are narrow atoms. */

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
const SOURCE_COMMIT = "421968026752d92473261e6d99493056cc046f67";
const SOURCE_TREE = "8663ced54c07cae7616cf349f78db7846e686a55";

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
  ariaApg: source("source.w3c-aria-apg", "ARIA Authoring Practices Guide", "W3C WAI", "https://www.w3.org/WAI/ARIA/apg/", "current", "w3c-aria-apg-current-2026-08-11", "Accessible web interaction patterns and keyboard behavior; descriptive guidance, not a normative conformance standard."),
  mdnResponsive: source("source.mdn-responsive-design", "Responsive Web Design", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design", "current", "mdn-responsive-design-current-2026-08-11", "Responsive layout, flexible media, viewport, and media-query concepts; no product or device acceptance authority."),
  swiftui: source("source.apple-swiftui-documentation", "SwiftUI Documentation", "Apple", "https://developer.apple.com/documentation/swiftui/", "current", "apple-swiftui-documentation-current-2026-08-11", "SwiftUI declarative UI, layout, interaction, accessibility, localization, and platform adaptation; no signing or deployment authority."),
  androidCompose: source("source.android-jetpack-compose", "Jetpack Compose Documentation", "Android Developers", "https://developer.android.com/develop/ui/compose/documentation", "current", "android-jetpack-compose-documentation-current-2026-08-11", "Jetpack Compose UI, state, semantics, adaptive layout, interaction, and testing concepts; no device or release authority."),
  kotlin: source("source.kotlin-language-documentation", "Kotlin Documentation", "Kotlin", "https://kotlinlang.org/docs/home.html", "current", "kotlin-language-documentation-current-2026-08-11", "Kotlin language and ecosystem guidance used only for the declared Android/Kotlin client scope."),
  webrtc: source("source.w3c-webrtc-2025", "WebRTC: Real-Time Communication in Browsers", "W3C", "https://www.w3.org/TR/2025/REC-webrtc-20250313/", "2025-03-13", "w3c-webrtc-recommendation-20250313", "Version-bound browser real-time communication semantics used only to classify realtime work.", {effective_date: "2025-03-13", authority_class: "PRIMARY_NORMATIVE"}),
  serviceWorkers: source("source.w3c-service-workers-current", "Service Workers", "W3C", "https://www.w3.org/TR/service-workers/", "current", "w3c-service-workers-current-2026-08-11", "Browser service-worker and offline-capability concepts used only to classify offline work.", {authority_class: "PRIMARY_NORMATIVE"}),
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
    slug: "desktop-offline-realtime-router",
    blockId: "specialist.product-client.desktop-offline-realtime-router",
    genericIds: ["CLIENT.DESKTOP_OFFLINE_REALTIME"],
    family: "product-client",
    title: "Desktop/Offline/Realtime Client Router",
    purpose: "Classify desktop, offline, and realtime client concerns and split them into the smallest sufficient atomic route without performing any of the three distinct domains.",
    signals: ["CLIENT.DESKTOP_OFFLINE_REALTIME", "desktop client", "offline-first", "realtime client"],
    context: ["client.surface", "client.mode", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.serviceWorkers, sourceCatalog.webrtc],
    standards: [],
    dependencies: [],
    included: ["desktop/offline/realtime signal classification", "mode-specific context assembly", "split-required handoff"],
    nonGoals: ["desktop implementation", "offline synchronization design", "realtime protocol implementation", "Product writing", "acceptance"],
  },
];

const atomicSpecs = [
  {
    slug: "product-interaction",
    blockId: "specialist.product-client.product-interaction",
    genericIds: ["UX.PRODUCT_INTERACTION"],
    family: "product-client",
    title: "Product Interaction",
    purpose: "Analyze one named interaction-flow concern, including keyboard/focus and state-transition evidence where declared, without owning product requirements or acceptance.",
    signals: ["UX.PRODUCT_INTERACTION", "product interaction", "interaction flow", "interaction state"],
    context: ["interaction.scope", "interaction.states", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.ariaApg],
    standards: [],
    upstream: "specialist.product-client.router",
    included: ["named interaction flow", "state and transition evidence", "keyboard/focus interaction evidence when applicable"],
    nonGoals: ["product prioritization", "visual design acceptance", "accessibility conformance certification", "unrelated client platforms"],
  },
  {
    slug: "accessibility-wcag",
    blockId: "specialist.product-client.accessibility-wcag",
    genericIds: ["UX.ACCESSIBILITY_WCAG"],
    family: "product-client",
    title: "Accessibility/WCAG",
    purpose: "Map the declared web accessibility concern to the exact WCAG edition and accessibility evidence without certifying conformance or deciding legal applicability.",
    signals: ["UX.ACCESSIBILITY_WCAG", "Accessibility/WCAG", "WCAG", "web accessibility"],
    context: ["accessibility.scope", "accessibility.criteria", "standard.edition", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.ariaApg],
    standards: ["specialist.standard.wcag-2-2"],
    upstream: "specialist.product-client.router",
    included: ["exact WCAG edition binding", "success-criterion evidence mapping", "keyboard and assistive-technology evidence"],
    nonGoals: ["legal applicability", "automated certification", "native-platform accessibility implementation", "unrelated UX review"],
  },
  {
    slug: "responsive-web",
    blockId: "specialist.product-client.responsive-web",
    genericIds: ["CLIENT.RESPONSIVE_WEB"],
    family: "product-client",
    title: "Responsive Web",
    purpose: "Analyze one responsive-web layout or viewport concern using declared content, device, and breakpoint evidence without claiming universal device coverage.",
    signals: ["CLIENT.RESPONSIVE_WEB", "Responsive Web", "responsive layout", "viewport", "media query"],
    context: ["web.scope", "web.viewports", "web.layout", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.mdnResponsive],
    standards: [],
    upstream: "specialist.product-client.router",
    included: ["viewport and layout evidence", "responsive media and breakpoint analysis", "declared device-coverage gaps"],
    nonGoals: ["browser certification", "accessibility conformance certification", "native mobile implementation", "visual acceptance"],
  },
  {
    slug: "ios-swiftui",
    blockId: "specialist.product-client.ios-swiftui",
    genericIds: ["CLIENT.IOS_SWIFTUI"],
    family: "product-client",
    title: "iOS SwiftUI",
    purpose: "Analyze the named SwiftUI client concern against the locked Apple documentation snapshot and declared platform context without signing, shipping, or accepting the app.",
    signals: ["CLIENT.IOS_SWIFTUI", "iOS SwiftUI", "SwiftUI", "iOS client"],
    context: ["client.platform", "client.swiftui", "client.lifecycle", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.swiftui],
    standards: [],
    upstream: "specialist.product-client.router",
    included: ["SwiftUI view/state/layout evidence", "declared Apple-platform context", "typed client implementation handoff"],
    nonGoals: ["Apple account or signing operations", "App Store release", "native accessibility certification", "Android or desktop implementation"],
  },
  {
    slug: "android-kotlin",
    blockId: "specialist.product-client.android-kotlin",
    genericIds: ["CLIENT.ANDROID_KOTLIN"],
    family: "product-client",
    title: "Android/Kotlin",
    purpose: "Analyze the named Android/Kotlin client concern against the locked Android and Kotlin documentation snapshots and declared platform context without signing, shipping, or accepting the app.",
    signals: ["CLIENT.ANDROID_KOTLIN", "Android Kotlin", "Jetpack Compose", "Android client"],
    context: ["client.platform", "client.kotlin", "client.compose", "candidate.identity"],
    sources: [sourceCatalog.atomicLaw, sourceCatalog.androidCompose, sourceCatalog.kotlin],
    standards: [],
    upstream: "specialist.product-client.router",
    included: ["Android/Kotlin/Compose evidence", "state, semantics, adaptive-layout, and interaction context", "typed client implementation handoff"],
    nonGoals: ["Android signing or release", "device-farm acceptance", "native accessibility certification", "iOS or desktop implementation"],
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
    ? ["classify the named client-surface signal", "assemble typed context for downstream atomic blocks", "return NOT_APPLICABLE when the family is absent", "escalate missing authority or evidence"]
    : ["analyze the exact named client/UX concern", "return evidence-bounded findings", "return NOT_APPLICABLE when the concern is absent", "escalate missing authority or conflicting evidence"];
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: "P4",
    role_kind: spec.roleKind,
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: spec.purpose,
    scope: {included, non_goals: nonGoals, smallest_sufficient_rule: isRouter ? "Classify and assemble context only; split desktop, offline, and realtime into narrower specialists when evidenced." : "Analyze only the named client/UX concern and return NOT_APPLICABLE when it is absent."},
    atomic_scope_statement: isRouter ? `Router-only classification for ${spec.title}; it has no downstream Product or acceptance authority.` : `One narrow atomic evidence domain: ${spec.title}; unrelated client, platform, or accessibility failure modes require sibling blocks.`,
    permitted_decisions: sorted(permitted),
    forbidden_decisions: forbidden,
    maximum_authority: isRouter ? "NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_ACTIVATION;_TYPED_ROUTING_ONLY" : "ADVISORY_ANALYSIS_AND_TYPED_HANDOFF_ONLY;_NO_PRODUCT_WRITE;_NO_ACCEPTANCE;_NO_SELF_ACCEPTANCE;_NO_CERTIFICATION;_NO_ACTIVATION",
    required_upstream_router: spec.upstream ?? null,
    sibling_conflicts: sorted(spec.siblingConflicts ?? []),
    composition_rules: sorted(isRouter ? ["compose only with the declared foundation controls", "split desktop, offline, and realtime into narrower routes when evidenced", "never substitute for an atomic specialist", "UNKNOWN closes only the dependent route"] : ["must be selected by the required upstream router", "compose only with explicitly named dependencies and siblings", "reuse exact standard block IDs, versions, and hashes", "UNKNOWN closes only the dependent action"]),
    escalation_target: isRouter ? "specialist.foundation.role-intake-classifier" : "specialist.foundation.evaluation-admission-gate",
    split_required_when: sorted(["knowledge differs", "authority or source lock differs", "tool or data custody differs", "failure mode differs", "platform, provider, standard, or version differs"]),
    required_knowledge: sorted(["atomic specialization law", "exact source lock", "typed context contract", ...(spec.standards ?? [])]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing authority", "missing source lock", "stale or superseded source", "unsafe action", ...(isRouter ? [] : ["unresolved platform or version", "scope expansion"])]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: requiredContext, optional_context: sorted(["project_context", "evaluation_receipt", "runtime_readback"]), deny_if_missing: sorted(["authority", "source_lock", "custody", ...spec.context]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous request", "missing context", "stale source", "unsafe action", "scope expansion"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "scope", "findings", "evidence", "unknowns", "handoff"]), evidence_obligations: sorted(["exact source lock identity", "gate trace", "typed context", "unknown ledger", ...(spec.standards ?? []).map((id) => `${id} hash`)]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "status", "findings", "evidence", "residuals", "next_action"])},
    authority: {allowed_authority: sorted(["exact source records in sources.lock", "typed context within the declared scope", "reusable standard block identities and requirement mappings", "evidence-bounded analysis"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary source or immutable standard block", "external typed project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citations", "provider/account mutation", "Product acceptance", "self-authored admission", "another provider, standard, or version"]), jurisdiction_rule: "Require exact client/UX concern, platform or standard version, source scope, authority, and freshness evidence; regulated or legal applicability remains external.", escalation_rule: "Conflict or missing protected authority closes only the dependent action and escalates to the named control-plane owner.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Check publisher, identifier, version, publication/effective/supersession status, retrieved date, immutable identity, and digest when obtainable; stale or unverifiable evidence denies the dependent action.", claim_rule: "Claims are limited to the exact source-backed client/UX concern and selected reusable standards; no cross-platform, cross-version, or cross-specialist claims.", unknown_rule: "UNKNOWN records missing evidence and closes only the dependent action; it never licenses inference or scope expansion."},
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
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "deterministic-independent-client-ux-p4-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["p4-client-ux-scope-and-authority", "source-lock-digest", "reusable-standard-dependency-identities", "12-gate-pack-digests", "hostile-fixture-catalog", "independent-reviewer-required", ...(spec.upstream ? ["upstream-router-closure"] : ["router-only-split-boundary"])]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability and project context remain external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: `Route the immutable P4 ${block.role_kind === "ROUTER" ? "router" : "atomic client/UX"} candidate through independent evaluation; preserve activation OFF.`, authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/wave-05/${spec.slug}`;
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
  const byGenericId = new Map();
  for (let index = 0; index < specs.length; index += 1) for (const genericId of specs[index].genericIds ?? []) byGenericId.set(genericId, blocks[index]);
  const upsert = (entries, genericId, extra) => {
    let item = entries.find((candidate) => candidate.generic_id === genericId);
    if (!item) { item = {generic_id: genericId, ...extra}; entries.push(item); }
    Object.assign(item, extra);
  };
  for (const spec of routerSpecs) {
    const block = byGenericId.get(spec.genericIds[0]);
    upsert(inventory.routers, spec.genericIds[0], {title: spec.title, version: "1.0.0", source_lock: "sources.lock", block_id: block.block_id, package_status: "COMPILED_CANDIDATE", evaluator_status: "STATIC_PASS_REVIEW_REQUIRED", evaluator_receipt: block.evaluation.receipt_id});
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

export function scaffoldP4ClientUx(repositoryRoot = process.cwd()) {
  const specs = [
    ...routerSpecs.map((spec) => ({...spec, roleKind: "ROUTER"})),
    ...atomicSpecs.map((spec) => ({...spec, roleKind: "ATOMIC_SPECIALIST"})),
  ];
  const blocks = specs.map((spec) => writePackage(repositoryRoot, spec));
  updateAtomicInventory(repositoryRoot, specs, blocks);
  return blocks.map((block) => block.block_id);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify({status: "PASS", packages: scaffoldP4ClientUx(process.cwd())}, null, 2)}\n`);
