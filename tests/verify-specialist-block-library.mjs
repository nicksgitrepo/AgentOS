#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ATOMIC_EVALUATION_CLASSES,
  CORE_EVALUATION_CLASSES,
  GATE_OUTCOMES,
  SPECIALIST_GATE_IDS,
  compileSpecialistLibrary,
  evaluateGateAnswer,
} from "../control/specialist-block-compiler.mjs";
import {
  loadSpecialistLibrary,
  routeSpecialists,
  validateAtomicSelection,
} from "../control/specialist-block-loader.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const first = compileSpecialistLibrary({repositoryRoot: root, writeGenerated: false});
const second = compileSpecialistLibrary({repositoryRoot: root, writeGenerated: false});
assert.deepEqual(first.roster, second.roster, "specialist roster compilation is not deterministic");
assert.deepEqual(first.routing, second.routing, "specialist routing compilation is not deterministic");
assert.deepEqual(first.inventory, second.inventory, "specialist inventory materialization is not deterministic");
assert.equal(first.records.length, 13, "foundation plus exact six P0 package count is wrong");

const library = loadSpecialistLibrary({repositoryRoot: root, compileIfMissing: false});
assert.equal(library.roster.activation, "OFF");
assert.equal(library.roster.lifecycle ?? "NOT_ADMITTED", "NOT_ADMITTED");
assert.equal(library.roster.blocks.every((block) => block.lifecycle === "NOT_ADMITTED" && block.role_kind === "CONTROL_PLANE"), true);
assert.deepEqual(library.inventory.counts, {ROUTER: 626, CONTROL_PLANE: 13, KNOWLEDGE_BLOCK: 0, GOVERNANCE_BLOCK: 0, STANDARD_BLOCK: 0, CONTEXT_BLOCK: 0, ATOMIC_SPECIALIST: 79, COMPILED_AGENT_PACKAGE: 0});
assert.equal(library.inventory.entries.length, 619);

for (const record of first.records) {
  const packageDir = record.packageDir;
  assert.equal(record.block.gate_pack.ordered_gate_ids.length, 12);
  assert.deepEqual(record.block.gate_pack.outcomes, GATE_OUTCOMES);
  assert.equal(fs.readdirSync(path.join(packageDir, "gates")).filter((name) => name.endsWith(".gate")).length, 12);
  assert.equal(fs.readdirSync(path.join(packageDir, "fixtures")).length, CORE_EVALUATION_CLASSES.length + ATOMIC_EVALUATION_CLASSES.length);
  assert.deepEqual(new Set(record.evaluation.cases.map((item) => item.class)), new Set([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]));
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
assert.deepEqual(narrow.selected, [atomicId]);
assert.equal(narrow.smallest_sufficient, true);
assert.deepEqual(validateAtomicSelection({library: synthetic, selected: narrow.selected}).status, "PASS");
const missing = routeSpecialists({library: synthetic, signals: ["access-control"], context: {request: {kind: "web"}}});
assert.equal(missing.status, "UNKNOWN");
assert.equal(missing.denials[0].outcome, "UNKNOWN");

const overlay = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/atomic-inventory.v1.json"), "utf8"));
assert.deepEqual(overlay.counts, {ROUTER: 7, ATOMIC_SPECIALIST: 79, CONTROL_PLANE: 13});
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.OWASP_API_2023_OBJECT_AUTHORIZATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "SEC.ACCESS_CONTROL_TENANT_ISOLATION"), true);
assert.equal(overlay.atomic_specialists.some((item) => item.generic_id === "EDGE.CLOUDFLARE_ZERO_TRUST"), true);

console.log("PASS specialist block library: deterministic Wave 0 compile, inactive roster, 12-gate four-valued semantics, atomic routing, hostile fixture coverage, and exact overlay counts");
