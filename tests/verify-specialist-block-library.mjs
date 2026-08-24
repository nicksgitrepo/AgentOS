#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ATOMIC_EVALUATION_CLASSES,
  CORE_EVALUATION_CLASSES,
  GATE_OUTCOMES,
  SPECIALIST_GATE_IDS,
  canonicalDigest,
  compileSpecialistLibrary,
  evaluateGateAnswer,
} from "../control/specialist-block-compiler.mjs";
import {
  loadSpecialistLibrary,
  routeSpecialists,
  validateAtomicSelection,
} from "../control/specialist-block-loader.mjs";
import {loadSpecialistBlockCatalog} from "../control/specialist-agent-compiler.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const first = compileSpecialistLibrary({repositoryRoot: root, writeGenerated: false});
const second = compileSpecialistLibrary({repositoryRoot: root, writeGenerated: false});
assert.deepEqual(first.roster, second.roster, "specialist roster compilation is not deterministic");
assert.deepEqual(first.routing, second.routing, "specialist routing compilation is not deterministic");
assert.deepEqual(first.inventory, second.inventory, "specialist inventory materialization is not deterministic");
assert.equal(first.records.length, 123, "foundation, reusable standard, P0, P1, P2, P3, P4, and P5 package count is wrong");

const library = loadSpecialistLibrary({repositoryRoot: root, compileIfMissing: false});
const taskCompilerCatalog = loadSpecialistBlockCatalog({repositoryRoot: root});
const materialized = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(library.roster, materialized(first.roster), "checked-in specialist roster is stale or detached from compiler output");
assert.deepEqual(library.routing, materialized(first.routing), "checked-in specialist routing index is stale or detached from compiler output");
assert.deepEqual(library.inventory, materialized(first.inventory), "checked-in specialist inventory is stale or detached from compiler output");
const expectedRouteIds = first.records.map(({block}) => `route.${block.block_id.slice("specialist.".length)}`).sort();
const actualRouteIds = library.routing.routes.map((route) => route.route_id).sort();
assert.equal(new Set(actualRouteIds).size, actualRouteIds.length, "checked-in specialist routing index contains duplicate route identities");
assert.deepEqual(actualRouteIds, expectedRouteIds, "checked-in specialist routing index does not cover the exact roster identities");
for (const route of library.routing.routes) {
  assert.equal(route.select.length, 1, `${route.route_id} must select exactly its canonical roster block`);
  assert.equal(route.route_id, `route.${route.select[0].slice("specialist.".length)}`, `${route.route_id} is not bound to its selected canonical block`);
}
assert.equal(taskCompilerCatalog.length, 123, "task-shaped compiler catalog must load every compiled candidate package");
assert.equal(taskCompilerCatalog.filter((block) => block.role_kind === "STANDARD_BLOCK").length, 23);
assert.deepEqual(taskCompilerCatalog.filter((block) => block.role_kind === "STANDARD_BLOCK").map((block) => block.block_id), ["specialist.standard.aws-iam-current", "specialist.standard.cloudflare-cache-current", "specialist.standard.cloudflare-dns-current", "specialist.standard.conventional-commits-1-0-0", "specialist.standard.fmcsa-part-390-2025", "specialist.standard.gao-green-book-2025", "specialist.standard.gltf-2-0-1", "specialist.standard.nist-ai-rmf-1-0", "specialist.standard.nist-genai-profile-1-0", "specialist.standard.nist-ssdf", "specialist.standard.oauth-rfc-9700", "specialist.standard.oidc-core-1-0", "specialist.standard.openapi-3-1-1", "specialist.standard.owasp-api-top10-2023", "specialist.standard.owasp-asvs", "specialist.standard.owasp-top10-2025", "specialist.standard.postgresql-17-rls", "specialist.standard.react-19-2", "specialist.standard.rust-reference", "specialist.standard.semantic-versioning-2-0-0", "specialist.standard.slsa", "specialist.standard.typescript-5-9", "specialist.standard.wcag-2-2"]);
assert(taskCompilerCatalog.filter((block) => block.role_kind === "STANDARD_BLOCK").every((block) => block.standard_identity && /^[0-9a-f]{64}$/u.test(block.source_lock_digest)), "loaded standard blocks must retain exact reuse and source-lock identities");
assert.equal(library.roster.activation, "OFF");
assert.equal(library.roster.lifecycle ?? "NOT_ADMITTED", "NOT_ADMITTED");
assert.equal(library.roster.blocks.every((block) => block.lifecycle === "NOT_ADMITTED" && block.activation === "OFF"), true);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "CONTROL_PLANE").length, 16);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "STANDARD_BLOCK").length, 23);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "ROUTER").length, 19);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "ATOMIC_SPECIALIST").length, 65);
assert.deepEqual(library.inventory.counts, {ROUTER: 640, CONTROL_PLANE: 16, KNOWLEDGE_BLOCK: 0, GOVERNANCE_BLOCK: 0, STANDARD_BLOCK: 0, CONTEXT_BLOCK: 0, ATOMIC_SPECIALIST: 92, COMPILED_AGENT_PACKAGE: 0});
assert.equal(library.inventory.entries.length, 621);
assert.equal(library.inventory.typed_overlay_entries.length, 127, "typed router/atomic/control overlay must be inspectable alongside the expanded backlog");
assert.deepEqual(library.inventory.typed_overlay_counts, {ROUTER: 19, CONTROL_PLANE: 16, KNOWLEDGE_BLOCK: 0, GOVERNANCE_BLOCK: 0, STANDARD_BLOCK: 0, CONTEXT_BLOCK: 0, ATOMIC_SPECIALIST: 92, COMPILED_AGENT_PACKAGE: 0});

for (const record of first.records) {
  const packageDir = record.packageDir;
  assert.equal(record.block.gate_pack.ordered_gate_ids.length, 12);
  assert.deepEqual(record.block.gate_pack.outcomes, GATE_OUTCOMES);
  assert.equal(fs.readdirSync(path.join(packageDir, "gates")).filter((name) => name.endsWith(".gate")).length, 12);
  const expectedFixtureClasses = new Set([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const evaluationByClass = new Map(record.evaluation.cases.map((item) => [item.class, item]));
  const fixtureFiles = fs.readdirSync(path.join(packageDir, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert.equal(fixtureFiles.length, expectedFixtureClasses.size);
  assert.equal(new Set(fixtureFiles).size, fixtureFiles.length);
  for (const fixtureFile of fixtureFiles) {
    const fixture = JSON.parse(fs.readFileSync(path.join(packageDir, "fixtures", fixtureFile), "utf8"));
    assert.equal(fixture.schema, "agentos.specialist_fixture.v1");
    assert.equal(fixture.version, 1);
    assert.equal(fixture.block_id, record.block.block_id);
    assert.equal(fixtureFile, `${fixture.class}.json`);
    assert(expectedFixtureClasses.has(fixture.class), `${record.block.block_id} fixture class is not governed: ${fixture.class}`);
    assert.equal(fixture.hostile, true, `${record.block.block_id} fixture is not hostile: ${fixture.class}`);
    assert.equal(fixture.expected, evaluationByClass.get(fixture.class)?.expected, `${record.block.block_id} fixture/evaluation expected outcome mismatch: ${fixture.class}`);
    assert(typeof fixture.note === "string" && fixture.note.length > 0, `${record.block.block_id} fixture note is missing: ${fixture.class}`);
  }
  assert.deepEqual(new Set(record.evaluation.cases.map((item) => item.class)), expectedFixtureClasses);
  if (record.block.role_kind === "STANDARD_BLOCK") {
    assert.equal(record.standard.requirements.block_id, record.block.block_id);
    assert.equal(record.block.source_manifest_sha256, record.sources.manifest_sha256);
    assert.equal(record.block.normalized_requirements_sha256, canonicalDigest(record.standard.requirements));
  }
}

const contextForRoute = (route) => {
  const context = {};
  for (const key of route.required_context) {
    const parts = key.split(".");
    let cursor = context;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== "object") cursor[parts[index]] = {};
      cursor = cursor[parts[index]];
    }
    cursor[parts.at(-1)] = "declared";
  }
  return context;
};
const routableRoutes = first.routing.routes.filter((route) => route.role_kind !== "STANDARD_BLOCK");
assert.equal(routableRoutes.length, 100, "all non-standard roster routes must remain runtime-routable");
for (const route of routableRoutes) {
  const result = routeSpecialists({library, signals: route.signals, context: contextForRoute(route)});
  assert.equal(result.status, "ROUTE", `${route.route_id} does not produce a deterministic route with complete context`);
  assert(result.selected.length > 0, `${route.route_id} selected no candidate block`);
}

const removeContextPath = (context, dottedPath) => {
  const copy = structuredClone(context);
  const parts = dottedPath.split(".");
  let cursor = copy;
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object") return copy;
    cursor = cursor[part];
  }
  if (cursor && typeof cursor === "object") delete cursor[parts.at(-1)];
  return copy;
};

const controlIds = first.records.filter((record) => record.block.role_kind === "CONTROL_PLANE").map((record) => record.block.block_id).sort();
assert.equal(controlIds.length, 16, "the complete control-plane roster must remain covered");
for (const blockId of controlIds) {
  const block = first.records.find((record) => record.block.block_id === blockId)?.block;
  assert(block, `${blockId} is missing from the compiled candidate library`);
  assert.equal(block.role_kind, "CONTROL_PLANE");
  assert.equal(block.activation, "OFF");
  assert.equal(block.lifecycle, "CANDIDATE");
  assert(String(block.maximum_authority).includes("NO_PRODUCT_WRITE"), `${blockId} lacks the Product-write ceiling`);
  assert(String(block.maximum_authority).includes("NO_ACTIVATION"), `${blockId} lacks the activation ceiling`);
  assert(String(block.maximum_authority).includes("NO_SELF_ACCEPTANCE"), `${blockId} lacks the self-acceptance ceiling`);
  assert.equal(block.controls?.deploy, "DENY", `${blockId} grants deploy capability`);
  assert.equal(block.controls?.secrets, "DENY", `${blockId} grants secret capability`);
  assert.equal(block.controls?.acceptance_authority, "INDEPENDENT_AUTHORITY_ONLY", `${blockId} has non-independent acceptance authority`);
  assert(block.forbidden_decisions.some((decision) => /self[- ]accept|accept or admit|activate or admit/iu.test(decision)), `${blockId} lacks explicit self-admission denial`);
  assert(block.permitted_decisions.every((decision) => !/\b(?:deploy|publish|execute)\b|write Product|accept or admit|activate or admit/iu.test(decision)), `${blockId} permits an external side effect`);
}

const controlRoutes = first.routing.routes.filter((route) => route.role_kind === "CONTROL_PLANE");
const allControlIds = first.records.filter((record) => record.block.role_kind === "CONTROL_PLANE").map((record) => record.block.block_id).sort();
assert.equal(controlRoutes.length, allControlIds.length, "every control-plane candidate must have one governed route");
for (const route of controlRoutes) {
  const completeContext = contextForRoute(route);
  const complete = routeSpecialists({library, signals: [], requestedBlockIds: route.select, context: completeContext});
  assert.equal(complete.status, "ROUTE", `${route.route_id} cannot route with its complete typed context`);
  assert(route.select.every((blockId) => complete.selected.includes(blockId)), `${route.route_id} dropped its declared control-plane candidate`);
  for (const requiredKey of route.required_context) {
    const missing = routeSpecialists({library, signals: [], requestedBlockIds: route.select, context: removeContextPath(completeContext, requiredKey)});
    assert.equal(missing.selected.length, 0, `${route.route_id} routed despite missing ${requiredKey}`);
    assert(missing.status === "UNKNOWN" || missing.status === "NO_MATCH", `${route.route_id} did not close missing ${requiredKey}`);
  }
}

const gate = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/foundation/role-intake-classifier/gates/00-intake.gate"), "utf8"));
const evidence = Object.fromEntries(gate.evidence.map((key) => [key, {present: true}]));
assert.deepEqual(evaluateGateAnswer(gate, "YES", evidence), {outcome: "YES", dependent_action: "ADVANCES", unrelated_work: "CONTINUES"});
assert.deepEqual(evaluateGateAnswer(gate, "NO", {}), {outcome: "NO", dependent_action: "DENIED", unrelated_work: "CONTINUES"});
assert.deepEqual(evaluateGateAnswer(gate, "NOT_APPLICABLE", {}), {outcome: "NOT_APPLICABLE", dependent_action: "SKIPPED", unrelated_work: "CONTINUES"});
const unknown = evaluateGateAnswer(gate, "UNKNOWN", {});
assert.equal(unknown.outcome, "UNKNOWN");
assert.equal(unknown.dependent_action, "CLOSED");
assert.equal(unknown.unrelated_work, "CONTINUES");
assert.throws(() => evaluateGateAnswer(gate, "MAYBE", {}), /one of YES, NO, UNKNOWN, NOT_APPLICABLE/u);

const routerId = "specialist.security.owasp-web-top10-router";
const atomicId = "specialist.security.owasp-web-2025-a01-broken-access-control";
const syntheticRouter = {block_id: routerId, role_kind: "ROUTER", required_upstream_router: null, maximum_authority: "NO_PRODUCT_WRITE;NO_ACCEPTANCE"};
const syntheticAtomic = {block_id: atomicId, role_kind: "ATOMIC_SPECIALIST", required_upstream_router: routerId, sibling_conflicts: [], maximum_authority: "NO_PRODUCT_WRITE;NO_ACCEPTANCE"};
const synthetic = {
  byId: new Map([[routerId, syntheticRouter], [atomicId, syntheticAtomic]]),
  routing: {routes: [
    {route_id: "route.security.owasp-web-top10-router", role_kind: "ROUTER", signals: ["security"], required_context: ["request.kind"], select: [routerId], deny_if: [], priority: 1},
    {route_id: "route.security.owasp-web-a01", role_kind: "ATOMIC_SPECIALIST", signals: ["access-control"], required_context: ["request.kind", "access_control.object_scope"], select: [atomicId], deny_if: [], priority: 1},
  ]},
};
const narrow = routeSpecialists({library: synthetic, signals: ["security", "access-control"], context: {request: {kind: "web"}, access_control: {object_scope: "declared"}}});
assert.equal(narrow.status, "ROUTE");
assert.deepEqual(narrow.selected, [atomicId, routerId]);
assert.equal(narrow.smallest_sufficient, true);
assert.deepEqual(validateAtomicSelection({library: synthetic, selected: narrow.selected}).status, "PASS");
assert.throws(() => validateAtomicSelection({library: synthetic, selected: [atomicId]}), /requires upstream router/u);
const missingUpstreamLibrary = {byId: new Map([[atomicId, syntheticAtomic]]), routing: synthetic.routing};
const missingUpstreamRoute = routeSpecialists({library: missingUpstreamLibrary, signals: ["access-control"], context: {request: {kind: "web"}, access_control: {object_scope: "declared"}}});
assert.equal(missingUpstreamRoute.status, "UNKNOWN");
assert.equal(missingUpstreamRoute.selected.length, 0);
const missing = routeSpecialists({library: synthetic, signals: ["access-control"], context: {request: {kind: "web"}}});
assert.equal(missing.status, "UNKNOWN");
assert.equal(missing.denials[0].outcome, "UNKNOWN");

const rustRoute = routeSpecialists({library, signals: ["ENG.RUST_BACKEND"], context: {request: "typed", signals: "ENG.RUST_BACKEND", authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, language: {edition: "2021"}, runtime: {toolchain: "1.97.1"}}});
assert.equal(rustRoute.status, "ROUTE");
assert.deepEqual(rustRoute.selected, ["specialist.software-language-runtime.router", "specialist.software-language-runtime.rust-backend"]);
assert.deepEqual(validateAtomicSelection({library, selected: rustRoute.selected}).status, "PASS");
const webA01Route = routeSpecialists({library, signals: ["A01:2025"], context: {request: {kind: "web"}, signals: ["A01:2025"], authority: "bound", source_lock: "fresh", custody: "bound", web: {application: "declared", category: "A01"}, standard: {edition: "2025"}, candidate: {identity: "candidate"}}});
assert.equal(webA01Route.status, "ROUTE");
assert.deepEqual(webA01Route.selected, ["specialist.security.owasp-web-2025-a01-broken-access-control", "specialist.security.owasp-web-top10-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: webA01Route.selected}).status, "PASS");
const api7Route = routeSpecialists({library, signals: ["API7:2023"], context: {request: {kind: "api"}, signals: ["API7:2023"], authority: "bound", source_lock: "fresh", custody: "bound", api: {scope: "declared", category: "API7"}, standard: {edition: "2023"}, candidate: {identity: "candidate"}}});
assert.equal(api7Route.status, "ROUTE");
assert.deepEqual(api7Route.selected, ["specialist.security.owasp-api-2023-api7-ssrf", "specialist.security.owasp-api-top10-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: api7Route.selected}).status, "PASS");
const broadWebRoute = routeSpecialists({library, signals: ["SEC.OWASP_WEB_TOP10"], context: {request: {kind: "web"}, signals: ["SEC.OWASP_WEB_TOP10"], authority: "bound", source_lock: "fresh", custody: "bound", applicability: "pending-external-overlay", web: {application: "declared"}, standard: {edition: "2025"}, candidate: {identity: "candidate"}}});
assert.equal(broadWebRoute.status, "ROUTE");
assert.throws(() => validateAtomicSelection({library, selected: broadWebRoute.selected}), /broad router/u, "broad OWASP router cannot substitute for an evidenced atomic category");
const p1AtomicIds = ["specialist.software-language-runtime.rust-backend", "specialist.software-language-runtime.typescript-language", "specialist.software-language-runtime.react-components", "specialist.data.postgresql-rls", "specialist.product-client.openapi-contracts", "specialist.security.oauth-identity", "specialist.security.oidc-core", "specialist.platform.aws-iam-policy", "specialist.platform.cloudflare-dns", "specialist.platform.cloudflare-cache"];
assert(p1AtomicIds.every((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.required_upstream_router), "every first-wave P1 atomic package must bind an upstream router");
assert(p1AtomicIds.every((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.dependencies.some((dependency) => dependency.startsWith("specialist.standard."))), "every first-wave P1 atomic package must reuse an immutable STANDARD_BLOCK");
const overlay = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/atomic-inventory.v1.json"), "utf8"));
const p2RouterIds = ["specialist.security.owasp-web-top10-router", "specialist.security.owasp-api-top10-router", "specialist.security.owasp-asvs-router", "specialist.security.access-control-router", "specialist.security.supply-chain-router", "specialist.privacy.data-lifecycle-router"];
assert(p2RouterIds.every((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.role_kind === "ROUTER"), "every P2 priority router must be packaged as a router candidate");
const p2Generic = (genericId) => genericId.startsWith("SEC.OWASP_WEB_2025_") || genericId.startsWith("SEC.OWASP_API_2023_") || genericId.startsWith("SEC.ACCESS_CONTROL_") || ["SEC.RACE_CONDITION", "SEC.TOCTOU", "SEC.DEADLOCK", "SEC.IDEMPOTENCY", "SEC.REPLAY", "SEC.DOUBLE_SUBMISSION", "SEC.CONCURRENT_AUTHORIZATION", "SEC.CVE_INVENTORY", "SEC.CVE_APPLICABILITY", "SEC.DEPENDENCY_VULNERABILITY", "SEC.SBOM", "SEC.PATCH_REMEDIATION", "SEC.SUPPLY_CHAIN_PROVENANCE"].includes(genericId);
const p2AtomicIds = new Set(overlay.atomic_specialists.filter((item) => p2Generic(item.generic_id) && item.block_id).map((item) => item.block_id));
const p2AtomicBlocks = taskCompilerCatalog.filter((block) => p2AtomicIds.has(block.block_id));
assert.equal(p2AtomicBlocks.length, 41, "P2 security category/access/supply-chain atomic coverage is incomplete");
assert(p2AtomicBlocks.every((block) => p2RouterIds.includes(block.required_upstream_router) || block.required_upstream_router === "specialist.security.access-control-router" || block.required_upstream_router === "specialist.security.supply-chain-router"), "P2 atoms must bind to a packaged narrow upstream router");
assert(p2AtomicBlocks.every((block) => block.dependencies.filter((dependency) => dependency.startsWith("specialist.standard.")).length > 0), "P2 atoms must reuse immutable standard blocks");
const webStandardHashes = p2AtomicBlocks.filter((block) => block.block_id.startsWith("specialist.security.owasp-web-2025-")).map((block) => library.byId.get("specialist.standard.owasp-top10-2025")?.hash);
assert.equal(webStandardHashes.length, 10);
assert.equal(new Set(webStandardHashes).size, 1, "all OWASP Web category atoms must reuse one immutable Top 10 standard hash");
const apiStandardHashes = p2AtomicBlocks.filter((block) => block.block_id.startsWith("specialist.security.owasp-api-2023-")).map(() => library.byId.get("specialist.standard.owasp-api-top10-2023")?.hash);
assert.equal(apiStandardHashes.length, 10);
assert.equal(new Set(apiStandardHashes).size, 1, "all OWASP API category atoms must reuse one immutable API Top 10 standard hash");

const p3BlockIds = [
  "specialist.control.central-integrator",
  "specialist.control.release-manager",
  "specialist.control.worktree-custody",
  "specialist.delivery-operations.observability-router",
  "specialist.assurance-enterprise.test-architect",
  "specialist.delivery-operations.observability-incident",
  "specialist.data.migration-rollback",
];
assert(p3BlockIds.every((blockId) => taskCompilerCatalog.some((block) => block.block_id === blockId)), "P3 delivery/assurance candidates must be packaged");
assert.equal(taskCompilerCatalog.find((block) => block.block_id === "specialist.assurance-enterprise.test-architect")?.required_upstream_router, "specialist.assurance-enterprise.router");
assert.equal(taskCompilerCatalog.find((block) => block.block_id === "specialist.delivery-operations.observability-incident")?.required_upstream_router, "specialist.delivery-operations.observability-router");
assert.equal(taskCompilerCatalog.find((block) => block.block_id === "specialist.data.migration-rollback")?.required_upstream_router, "specialist.data.router");
assert(p3BlockIds.filter((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.role_kind !== "ROUTER").every((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.dependencies.some((dependency) => dependency.startsWith("specialist.standard.")) || taskCompilerCatalog.find((block) => block.block_id === blockId)?.role_kind === "CONTROL_PLANE"), "P3 atomic candidates must reuse existing immutable standards");
const p3Migration = taskCompilerCatalog.find((block) => block.block_id === "specialist.data.migration-rollback");
assert(p3Migration?.dependencies.includes("specialist.standard.nist-ssdf") && p3Migration?.dependencies.includes("specialist.standard.slsa"), "migration rollback must reuse NIST SSDF and SLSA by dependency identity");
const p3Release = taskCompilerCatalog.find((block) => block.block_id === "specialist.control.release-manager");
assert(p3Release?.dependencies.includes("specialist.standard.semantic-versioning-2-0-0") && p3Release?.dependencies.includes("specialist.standard.conventional-commits-1-0-0"), "release governance must reuse immutable SemVer and Conventional Commits standard blocks");
const p3MigrationRoute = routeSpecialists({library, signals: ["DATA.MIGRATION_ROLLBACK"], context: {request: "typed", signals: ["DATA.MIGRATION_ROLLBACK"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, data: {engine: "declared", migration: "declared", rollback: "declared", backup: "declared"}}});
assert.equal(p3MigrationRoute.status, "ROUTE");
assert.deepEqual(p3MigrationRoute.selected, ["specialist.data.migration-rollback", "specialist.data.router"]);
assert.deepEqual(validateAtomicSelection({library, selected: p3MigrationRoute.selected}).status, "PASS");
const p3ObservabilityRoute = routeSpecialists({library, signals: ["SRE.OBSERVABILITY_INCIDENT"], context: {request: "typed", signals: ["SRE.OBSERVABILITY_INCIDENT"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, service: {identity: "service"}, signal: {scope: "declared"}, incident: {identity: "incident"}, observability: {evidence: "declared"}}});
assert.equal(p3ObservabilityRoute.status, "ROUTE");
assert.deepEqual(p3ObservabilityRoute.selected, ["specialist.delivery-operations.observability-incident", "specialist.delivery-operations.observability-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: p3ObservabilityRoute.selected}).status, "PASS");
const p3TestRoute = routeSpecialists({library, signals: ["QA.TEST_ARCHITECT"], context: {request: "typed", signals: ["QA.TEST_ARCHITECT"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, test: {scope: "declared", strategy: "declared", evidence: "declared"}}});
assert.equal(p3TestRoute.status, "ROUTE");
assert.deepEqual(p3TestRoute.selected, ["specialist.assurance-enterprise.router", "specialist.assurance-enterprise.test-architect"]);
assert.deepEqual(validateAtomicSelection({library, selected: p3TestRoute.selected}).status, "PASS");

const p4BlockIds = [
  "specialist.product-client.desktop-offline-realtime-router",
  "specialist.product-client.product-interaction",
  "specialist.product-client.accessibility-wcag",
  "specialist.product-client.responsive-web",
  "specialist.product-client.ios-swiftui",
  "specialist.product-client.android-kotlin",
];
assert(p4BlockIds.every((blockId) => taskCompilerCatalog.some((block) => block.block_id === blockId)), "P4 client/UX candidates must be packaged");
const p4Router = taskCompilerCatalog.find((block) => block.block_id === "specialist.product-client.desktop-offline-realtime-router");
const p4RouterRoster = library.byId.get("specialist.product-client.desktop-offline-realtime-router");
assert.equal(p4Router?.role_kind, "ROUTER");
assert(p4RouterRoster?.split_required_when.some((rule) => rule === "failure mode differs"), "desktop/offline/realtime must retain an explicit split boundary");
const p4Atoms = p4BlockIds.filter((blockId) => blockId !== p4Router.block_id).map((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId));
assert(p4Atoms.every((block) => block.role_kind === "ATOMIC_SPECIALIST" && block.required_upstream_router === "specialist.product-client.router"), "P4 atoms must bind to the product/client router");
const p4Accessibility = taskCompilerCatalog.find((block) => block.block_id === "specialist.product-client.accessibility-wcag");
assert(p4Accessibility?.dependencies.includes("specialist.standard.wcag-2-2"), "WCAG accessibility atom must reuse the immutable WCAG 2.2 standard block");
const p4InteractionRoute = routeSpecialists({library, signals: ["UX.PRODUCT_INTERACTION"], context: {request: "typed", signals: ["UX.PRODUCT_INTERACTION"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, interaction: {scope: "declared", states: "declared"}}});
assert.equal(p4InteractionRoute.status, "ROUTE");
assert.deepEqual(p4InteractionRoute.selected, ["specialist.product-client.product-interaction", "specialist.product-client.router"]);
assert.deepEqual(validateAtomicSelection({library, selected: p4InteractionRoute.selected}).status, "PASS");
const p4AccessibilityRoute = routeSpecialists({library, signals: ["UX.ACCESSIBILITY_WCAG"], context: {request: "typed", signals: ["UX.ACCESSIBILITY_WCAG"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, accessibility: {scope: "declared", criteria: "declared"}, standard: {edition: "2.2"}}});
assert.equal(p4AccessibilityRoute.status, "ROUTE");
assert.deepEqual(p4AccessibilityRoute.selected, ["specialist.product-client.accessibility-wcag", "specialist.product-client.router"]);
assert.deepEqual(validateAtomicSelection({library, selected: p4AccessibilityRoute.selected}).status, "PASS");
const p4DesktopRoute = routeSpecialists({library, signals: ["CLIENT.DESKTOP_OFFLINE_REALTIME"], context: {request: "typed", signals: ["CLIENT.DESKTOP_OFFLINE_REALTIME"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, client: {surface: "declared", mode: "declared"}}});
assert.equal(p4DesktopRoute.status, "ROUTE");
assert.deepEqual(p4DesktopRoute.selected, ["specialist.product-client.desktop-offline-realtime-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: p4DesktopRoute.selected}).status, "PASS");

const p5BlockIds = [
  "specialist.domain.workflow-router",
  "specialist.domain.field-job-workflow",
  "specialist.domain.well-workflow",
  "specialist.graphics.industrial-3d-router",
  "specialist.graphics.industrial-3d",
  "specialist.ai.search-router",
  "specialist.ai.search-rag",
  "specialist.regulatory.applicability-router",
  "specialist.regulatory.fmcsa-applicability",
  "specialist.finance.accounting-router",
  "specialist.finance.job-cost-accounting",
];
assert(p5BlockIds.every((blockId) => taskCompilerCatalog.some((block) => block.block_id === blockId)), "P5 domain/AI/3D/regulatory/finance candidates must be packaged");
const p5Atoms = p5BlockIds.filter((blockId) => !blockId.endsWith("router")).map((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId));
assert(p5Atoms.every((block) => block.role_kind === "ATOMIC_SPECIALIST" && block.required_upstream_router), "P5 atomic candidates must bind to upstream routers");
assert(taskCompilerCatalog.find((block) => block.block_id === "specialist.graphics.industrial-3d")?.dependencies.includes("specialist.standard.gltf-2-0-1"));
assert(taskCompilerCatalog.find((block) => block.block_id === "specialist.ai.search-rag")?.dependencies.includes("specialist.standard.nist-ai-rmf-1-0"));
assert(taskCompilerCatalog.find((block) => block.block_id === "specialist.ai.search-rag")?.dependencies.includes("specialist.standard.nist-genai-profile-1-0"));
assert(taskCompilerCatalog.find((block) => block.block_id === "specialist.regulatory.fmcsa-applicability")?.dependencies.includes("specialist.standard.fmcsa-part-390-2025"));
assert(taskCompilerCatalog.find((block) => block.block_id === "specialist.finance.job-cost-accounting")?.dependencies.includes("specialist.standard.gao-green-book-2025"));
const fieldRoute = routeSpecialists({library, signals: ["DOMAIN.FIELD_JOB_WORKFLOW"], context: {request: "typed", signals: ["DOMAIN.FIELD_JOB_WORKFLOW"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, workflow: {domain: "declared", phase: "declared", task: "declared", dependencies: "declared"}}});
assert.equal(fieldRoute.status, "ROUTE");
assert.deepEqual(fieldRoute.selected, ["specialist.domain.field-job-workflow", "specialist.domain.workflow-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: fieldRoute.selected}).status, "PASS");
const wellRoute = routeSpecialists({library, signals: ["DOMAIN.WELL_WORKFLOW"], context: {request: "typed", signals: ["DOMAIN.WELL_WORKFLOW"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, workflow: {domain: "declared", phase: "declared", task: "declared", operation_scope: "declared"}}});
assert.equal(wellRoute.status, "ROUTE");
assert.deepEqual(wellRoute.selected, ["specialist.domain.well-workflow", "specialist.domain.workflow-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: wellRoute.selected}).status, "PASS");
const industrialRoute = routeSpecialists({library, signals: ["GRAPHICS.INDUSTRIAL_3D"], context: {request: "typed", signals: ["GRAPHICS.INDUSTRIAL_3D"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, asset: {domain: "declared", stage: "declared", identity: "declared", format: "declared", evidence: "declared"}}});
assert.equal(industrialRoute.status, "ROUTE");
assert.deepEqual(industrialRoute.selected, ["specialist.graphics.industrial-3d", "specialist.graphics.industrial-3d-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: industrialRoute.selected}).status, "PASS");
const searchRoute = routeSpecialists({library, signals: ["AI.SEARCH_RAG"], context: {request: "typed", signals: ["AI.SEARCH_RAG"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, ai: {system_scope: "declared"}, corpus: {scope: "declared", authority: "declared"}, retrieval: {task: "declared", evaluation: "declared"}}});
assert.equal(searchRoute.status, "ROUTE");
assert.deepEqual(searchRoute.selected, ["specialist.ai.search-rag", "specialist.ai.search-router"]);
assert.deepEqual(validateAtomicSelection({library, selected: searchRoute.selected}).status, "PASS");
const fmcsaRoute = routeSpecialists({library, signals: ["REG.FMCSA_APPLICABILITY"], context: {request: "typed", signals: ["REG.FMCSA_APPLICABILITY"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, regulation: {jurisdiction: "declared", entity: "declared", activity: "declared", commerce: "declared", vehicle: "declared", exception: "declared", version: "declared"}}});
assert.equal(fmcsaRoute.status, "ROUTE");
assert.deepEqual(fmcsaRoute.selected, ["specialist.regulatory.applicability-router", "specialist.regulatory.fmcsa-applicability"]);
assert.deepEqual(validateAtomicSelection({library, selected: fmcsaRoute.selected}).status, "PASS");
const costRoute = routeSpecialists({library, signals: ["FIN.JOB_COST_ACCOUNTING"], context: {request: "typed", signals: ["FIN.JOB_COST_ACCOUNTING"], authority: "bound", source_lock: "fresh", custody: "bound", candidate: {identity: "candidate"}, accounting: {entity: "declared", objective: "declared", period: "declared", cost_object: "declared", policy: "declared", evidence: "declared"}}});
assert.equal(costRoute.status, "ROUTE");
assert.deepEqual(costRoute.selected, ["specialist.finance.accounting-router", "specialist.finance.job-cost-accounting"]);
assert.deepEqual(validateAtomicSelection({library, selected: costRoute.selected}).status, "PASS");

assert.deepEqual(overlay.counts, {ROUTER: 19, ATOMIC_SPECIALIST: 92, CONTROL_PLANE: 16});
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.OWASP_API_2023_OBJECT_AUTHORIZATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.ACCESS_CONTROL_TENANT_ISOLATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "EDGE.CLOUDFLARE_ZERO_TRUST"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "UX.ACCESSIBILITY_WCAG"), true);
assert.equal(overlay.routers.some((item) => item.generic_id === "CLIENT.DESKTOP_OFFLINE_REALTIME"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "DOMAIN.FIELD_JOB_WORKFLOW"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "DOMAIN.WELL_WORKFLOW"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "GRAPHICS.INDUSTRIAL_3D"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "AI.SEARCH_RAG"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "REG.FMCSA_APPLICABILITY"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "FIN.JOB_COST_ACCOUNTING"), true);

console.log("PASS specialist block library: deterministic foundation/standard/P0/P1/P2/P3/P4/P5 compile, inactive roster, reusable standard digests, 12-gate four-valued semantics, atomic routing, hostile fixture coverage, and exact overlay counts");
