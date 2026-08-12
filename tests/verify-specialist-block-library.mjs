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
assert.equal(first.records.length, 32, "foundation, standard, P0, and first P1 router/atomic package count is wrong");

const library = loadSpecialistLibrary({repositoryRoot: root, compileIfMissing: false});
const taskCompilerCatalog = loadSpecialistBlockCatalog({repositoryRoot: root});
assert.equal(taskCompilerCatalog.length, 32, "task-shaped compiler catalog must load every compiled candidate package");
assert.deepEqual(taskCompilerCatalog.filter((block) => block.role_kind === "STANDARD_BLOCK").map((block) => block.block_id), ["specialist.standard.nist-ssdf", "specialist.standard.owasp-asvs", "specialist.standard.slsa"]);
assert(taskCompilerCatalog.filter((block) => block.role_kind === "STANDARD_BLOCK").every((block) => block.standard_identity && /^[0-9a-f]{64}$/u.test(block.source_lock_digest)), "loaded standard blocks must retain exact reuse and source-lock identities");
assert.equal(library.roster.activation, "OFF");
assert.equal(library.roster.lifecycle ?? "NOT_ADMITTED", "NOT_ADMITTED");
assert.equal(library.roster.blocks.every((block) => block.lifecycle === "NOT_ADMITTED" && block.activation === "OFF"), true);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "CONTROL_PLANE").length, 13);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "STANDARD_BLOCK").length, 3);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "ROUTER").length, 6);
assert.equal(library.roster.blocks.filter((block) => block.role_kind === "ATOMIC_SPECIALIST").length, 10);
assert.deepEqual(library.inventory.counts, {ROUTER: 631, CONTROL_PLANE: 13, KNOWLEDGE_BLOCK: 0, GOVERNANCE_BLOCK: 0, STANDARD_BLOCK: 0, CONTEXT_BLOCK: 0, ATOMIC_SPECIALIST: 79, COMPILED_AGENT_PACKAGE: 0});
assert.equal(library.inventory.entries.length, 619);
assert.equal(library.inventory.typed_overlay_entries.length, 104, "typed router/atomic/control overlay must be inspectable alongside the 619-title backlog");
assert.deepEqual(library.inventory.typed_overlay_counts, {ROUTER: 12, CONTROL_PLANE: 13, KNOWLEDGE_BLOCK: 0, GOVERNANCE_BLOCK: 0, STANDARD_BLOCK: 0, CONTEXT_BLOCK: 0, ATOMIC_SPECIALIST: 79, COMPILED_AGENT_PACKAGE: 0});

for (const record of first.records) {
  const packageDir = record.packageDir;
  assert.equal(record.block.gate_pack.ordered_gate_ids.length, 12);
  assert.deepEqual(record.block.gate_pack.outcomes, GATE_OUTCOMES);
  assert.equal(fs.readdirSync(path.join(packageDir, "gates")).filter((name) => name.endsWith(".gate")).length, 12);
  assert.equal(fs.readdirSync(path.join(packageDir, "fixtures")).length, CORE_EVALUATION_CLASSES.length + ATOMIC_EVALUATION_CLASSES.length);
  assert.deepEqual(new Set(record.evaluation.cases.map((item) => item.class)), new Set([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]));
  if (record.block.role_kind === "STANDARD_BLOCK") {
    assert.equal(record.standard.requirements.block_id, record.block.block_id);
    assert.equal(record.block.source_manifest_sha256, record.sources.manifest_sha256);
    assert.equal(record.block.normalized_requirements_sha256, canonicalDigest(record.standard.requirements));
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
const p1AtomicIds = ["specialist.software-language-runtime.rust-backend", "specialist.software-language-runtime.typescript-language", "specialist.software-language-runtime.react-components", "specialist.data.postgresql-rls", "specialist.product-client.openapi-contracts", "specialist.security.oauth-identity", "specialist.security.oidc-core", "specialist.platform.aws-iam-policy", "specialist.platform.cloudflare-dns", "specialist.platform.cloudflare-cache"];
assert(p1AtomicIds.every((blockId) => taskCompilerCatalog.find((block) => block.block_id === blockId)?.required_upstream_router), "every first-wave P1 atomic package must bind an upstream router");

const overlay = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/atomic-inventory.v1.json"), "utf8"));
assert.deepEqual(overlay.counts, {ROUTER: 12, ATOMIC_SPECIALIST: 79, CONTROL_PLANE: 13});
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.OWASP_API_2023_OBJECT_AUTHORIZATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.ACCESS_CONTROL_TENANT_ISOLATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "EDGE.CLOUDFLARE_ZERO_TRUST"), true);

console.log("PASS specialist block library: deterministic foundation/standard/P0 compile, inactive roster, reusable standard digests, 12-gate four-valued semantics, atomic routing, hostile fixture coverage, and exact overlay counts");
