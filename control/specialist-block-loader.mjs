#!/usr/bin/env node

/* Read-only loader and smallest-sufficient router for compiled candidate data. */

import fs from "node:fs";
import path from "node:path";
import {
  GATE_OUTCOMES,
  canonicalDigest,
  compileSpecialistLibrary,
  validateSpecialistBlock,
} from "./specialist-block-compiler.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath, label = filePath) {
  assert(fs.existsSync(filePath), `${label} is missing`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function verifyDigest(value, field, label) {
  const expected = canonicalDigest({...value, [field]: null});
  assert(value[field] === expected, `${label} digest mismatch`);
}

export function loadSpecialistLibrary({repositoryRoot = process.cwd(), compileIfMissing = true} = {}) {
  const registryRoot = path.join(repositoryRoot, "specialist-blocks", "registry");
  const rosterPath = path.join(registryRoot, "roster.v1.json");
  const routingPath = path.join(registryRoot, "routing-index.v1.json");
  const inventoryPath = path.join(registryRoot, "master-inventory.materialized.v1.json");
  if (compileIfMissing && (!fs.existsSync(rosterPath) || !fs.existsSync(routingPath) || !fs.existsSync(inventoryPath))) compileSpecialistLibrary({repositoryRoot, writeGenerated: true});
  const roster = readJson(rosterPath, "specialist roster");
  const routing = readJson(routingPath, "specialist routing index");
  const inventory = readJson(inventoryPath, "materialized specialist inventory");
  assert(roster.schema === "agentos.specialist_roster.v1" && roster.status === "COMPILED_CANDIDATE" && roster.activation === "OFF", "specialist roster is not an inactive candidate");
  assert(routing.schema === "agentos.specialist_routing.v1" && routing.status === "COMPILED_CANDIDATE", "specialist routing index is invalid");
  assert(inventory.schema === "agentos.specialist_materialized_inventory.v1" && inventory.status === "COMPILED_CANDIDATE" && inventory.activation === "OFF", "specialist inventory is invalid");
  verifyDigest(roster, "roster_sha256", "specialist roster");
  verifyDigest(routing, "routing_sha256", "specialist routing index");
  verifyDigest(inventory, "inventory_sha256", "materialized specialist inventory");
  const byId = new Map(roster.blocks.map((block) => [block.block_id, block]));
  assert(byId.size === roster.blocks.length, "specialist roster has duplicate block IDs");
  for (const route of routing.routes) {
    for (const blockId of route.select) {
      const block = byId.get(blockId);
      assert(block, `${route.route_id} selects an unknown block`);
      if (block.role_kind === "ROUTER") assert(!/Product|accept|admit|write/iu.test(block.maximum_authority), `${route.route_id} gives router excessive authority`);
      if (block.role_kind === "ATOMIC_SPECIALIST") assert(block.required_upstream_router, `${route.route_id} selects atomic specialist without upstream router`);
    }
  }
  return {roster, routing, inventory, byId};
}

function normalizeSignals(signals) {
  assert(Array.isArray(signals), "routing signals must be an array");
  const normalized = [...new Set(signals.filter((signal) => typeof signal === "string" && signal.trim().length > 0))].sort();
  return normalized;
}

function contextHas(context, key) {
  const parts = key.split(".");
  let current = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object" || !(part in current)) return false;
    current = current[part];
  }
  return current !== null && current !== undefined && current !== "";
}

export function routeSpecialists({library, signals = [], context = {}, requestedBlockIds = []}) {
  assert(library?.routing && library?.byId, "compiled specialist library is required");
  const normalizedSignals = normalizeSignals(signals);
  const requested = new Set(requestedBlockIds);
  const candidates = [];
  const denials = [];
  for (const route of library.routing.routes) {
    const signalMatch = route.signals.some((signal) => normalizedSignals.includes(signal));
    const requestedMatch = route.select.some((blockId) => requested.has(blockId));
    if (!signalMatch && !requestedMatch) continue;
    const missing = route.required_context.filter((key) => !contextHas(context, key));
    const denied = route.deny_if.some((key) => contextHas(context, key));
    if (denied || missing.length > 0) {
      denials.push({route_id: route.route_id, outcome: missing.length > 0 ? "UNKNOWN" : "NO", missing_context: missing.sort()});
      continue;
    }
    candidates.push(route);
  }
  if (candidates.length === 0) return {status: denials.length > 0 ? "UNKNOWN" : "NO_MATCH", selected: [], denials, signals: normalizedSignals};
  const selected = [];
  const atomic = candidates.filter((route) => route.role_kind === "ATOMIC_SPECIALIST");
  const routers = candidates.filter((route) => route.role_kind === "ROUTER");
  const controls = candidates.filter((route) => route.role_kind === "CONTROL_PLANE");
  for (const route of atomic) selected.push(...route.select);
  for (const route of controls) selected.push(...route.select);
  for (const route of routers) {
    const hasAtomicUnderRouter = atomic.some((atomicRoute) => atomicRoute.select.some((blockId) => library.byId.get(blockId)?.required_upstream_router === route.select[0]));
    if (!hasAtomicUnderRouter || atomic.length === 0) selected.push(...route.select);
  }
  const uniqueSelected = [...new Set(selected)].sort();
  if (uniqueSelected.length === 0) return {status: "UNKNOWN", selected: [], denials: [{outcome: "UNKNOWN", reason: "No narrow route survived the context contract."}], signals: normalizedSignals};
  return {status: "ROUTE", selected: uniqueSelected, denials, signals: normalizedSignals, smallest_sufficient: true};
}

export function validateAtomicSelection({library, selected}) {
  assert(Array.isArray(selected) && selected.length > 0, "selected specialist set is empty");
  const blocks = selected.map((blockId) => library.byId.get(blockId));
  assert(blocks.every(Boolean), "selected specialist set contains an unknown block");
  const atomic = blocks.filter((block) => block.role_kind === "ATOMIC_SPECIALIST");
  const routers = blocks.filter((block) => block.role_kind === "ROUTER");
  for (const block of routers) {
    const hasNarrower = atomic.some((candidate) => candidate.required_upstream_router === block.block_id);
    assert(!hasNarrower, `broad router ${block.block_id} was selected instead of a narrower atomic block`);
  }
  const ids = new Set(blocks.map((block) => block.block_id));
  for (const block of atomic) {
    assert(block.required_upstream_router === null || ids.has(block.required_upstream_router) || typeof block.required_upstream_router === "string", `${block.block_id} lacks an upstream route identity`);
    assert(!block.sibling_conflicts.some((conflict) => ids.has(conflict)), `${block.block_id} has a sibling conflict in the selected set`);
  }
  return {status: "PASS", selected: [...ids].sort(), outcomes: GATE_OUTCOMES};
}

export function validateLoadedBlock(block) {
  return validateSpecialistBlock(block);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const library = loadSpecialistLibrary({repositoryRoot: process.cwd()});
  process.stdout.write(JSON.stringify({status: "PASS", blocks: library.roster.blocks.length, routes: library.routing.routes.length, inventory_counts: library.inventory.counts}, null, 2) + "\n");
}
