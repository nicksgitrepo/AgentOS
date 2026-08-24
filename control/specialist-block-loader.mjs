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
      if (block.role_kind === "ROUTER") {
        const positiveAuthority = String(block.maximum_authority).replace(/NO_[A-Z_]+/gu, "");
        assert(!/(?:Product|accept|admit|write)/iu.test(positiveAuthority), `${route.route_id} gives router excessive authority`);
      }
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

const FALSE_DENY_VALUES = new Set(["", "false", "no", "none", "null", "undefined", "bound", "declared", "fresh", "valid", "pass", "safe"]);
const STATUS_DENY_VALUES = /\b(?:absent|ambiguous|conflict(?:ing)?|denied|expired|expanded|forbidden|invalid|missing|pending|stale|superseded|unresolved|unsafe|unverifiable)\b/iu;
const ACTION_DENY_VALUES = /\b(?:accept(?:ance)?|activate|admit|adoption|credential|deploy|execute|external[-_ ]state|migrate|production|provider[-_ ]identity|publish|secret|self[-_ ]accept(?:ance)?|side[-_ ]effect|write)\b/iu;

function normalizeDenyPath(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function flattenContext(value, prefix = "", entries = []) {
  if (value === null || value === undefined) return entries;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenContext(child, prefix ? `${prefix}.${key}` : key, entries);
    return entries;
  }
  entries.push([prefix, value]);
  return entries;
}

function denyValue(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !FALSE_DENY_VALUES.has(normalized);
}

function denyAliases(predicate) {
  const normalized = normalizeDenyPath(predicate);
  const aliases = new Set([normalized]);
  if (/(?:unsafe|side_effect|external_state).*action|action.*(?:unsafe|side_effect|external_state)/u.test(normalized)) {
    aliases.add("unsafe_action");
    aliases.add("side_effect_request");
    aliases.add("request_unsafe_action");
  }
  if (normalized.includes("scope_expansion")) {
    aliases.add("scope_expansion");
    aliases.add("requested_scope_expansion");
    aliases.add("scope_expanded");
  }
  if (normalized.includes("authority_conflict")) {
    aliases.add("authority_conflict");
    aliases.add("authority_conflicted");
  }
  if (normalized.includes("stale_source") || normalized.includes("superseded_source")) {
    aliases.add("stale_source");
    aliases.add("superseded_source");
    aliases.add("source_stale");
    aliases.add("source_superseded");
  }
  if (normalized.includes("missing_authority")) aliases.add("missing_authority");
  if (normalized.includes("missing_custody")) aliases.add("missing_custody");
  if (normalized.includes("missing_source_lock")) aliases.add("missing_source_lock");
  if (normalized.includes("self_acceptance")) {
    aliases.add("self_acceptance");
    aliases.add("self_accept");
  }
  return aliases;
}

function contextHasDenyPredicate(context, predicate) {
  const normalized = normalizeDenyPath(predicate);
  const flattened = flattenContext(context);
  const aliases = denyAliases(predicate);
  for (const [path, value] of flattened) {
    if (aliases.has(normalizeDenyPath(path)) && denyValue(value)) return true;
  }

  const actionValues = flattened
    .filter(([path]) => /(?:^|_)(?:action|request|requested_action|operation|intent|assertion|claim|chat|tool|access|data|scope)(?:$|_)/u.test(normalizeDenyPath(path)))
    .map(([, value]) => String(value));
  if (/(?:unsafe|write|deploy|publish|migrate|runtime|execution|activation|adoption|external_state|side_effect|credential|provider_identity)/u.test(normalized) && actionValues.some((value) => ACTION_DENY_VALUES.test(value))) return true;

  const statusValues = flattened
    .filter(([path]) => /(?:authority|custody|source|lock|jurisdiction|platform|provider|standard|version|scope|evidence|lifecycle|artifact|provenance|rollback|runtime|candidate|resource|setup|publisher|effective|identity|entity|activity)/u.test(normalizeDenyPath(path)))
    .map(([, value]) => String(value));
  if (normalized.includes("ambiguous") && flattened.some(([, value]) => STATUS_DENY_VALUES.test(String(value)))) return true;
  if (/(?:stale|superseded|unverifiable|conflicting|conflict)/u.test(normalized) && statusValues.some((value) => STATUS_DENY_VALUES.test(value))) return true;
  if (normalized.includes("unresolved") && statusValues.some((value) => /\b(?:unresolved|unknown|pending|missing|ambiguous)\b/iu.test(value))) return true;
  if (normalized.includes("missing") && statusValues.some((value) => /\b(?:missing|absent|unbound|invalid)\b/iu.test(value))) return true;
  if (/(?:missing|absent|unbound)/u.test(normalized) && statusValues.some((value) => /\b(?:missing|absent|unbound|invalid)\b/iu.test(value))) return true;
  if (normalized.includes("applicability") && flattened.some(([path, value]) => /applicability/u.test(normalizeDenyPath(path)) && /\b(?:missing|absent|unbound|invalid)\b/iu.test(String(value)))) return true;
  if (normalized.includes("unsafe") && flattened.some(([path, value]) => /(?:action|request|status|scope|operation|intent)/u.test(normalizeDenyPath(path)) && STATUS_DENY_VALUES.test(String(value)))) return true;
  if (normalized.includes("provider_identity") && flattened.some(([path, value]) => /(?:provider|identity|action|request|operation|intent)/u.test(normalizeDenyPath(path)) && ACTION_DENY_VALUES.test(String(value)))) return true;
  if (normalized.includes("self_acceptance") && flattened.some(([path, value]) => /(?:self|accept|action|request|operation|intent)/u.test(normalizeDenyPath(path)) && ACTION_DENY_VALUES.test(String(value)))) return true;
  if (normalized.includes("scope_expansion") && flattened.some(([path, value]) => /(?:scope|action|request|operation|intent)/u.test(normalizeDenyPath(path)) && /\b(?:expanded|expansion|broadened|broaden)\b/iu.test(String(value)))) return true;
  if (normalized.includes("certification") && actionValues.some((value) => /\b(?:certif|legal|attest)\w*/iu.test(value))) return true;
  if (normalized.includes("chat_only") && actionValues.some((value) => /\b(?:chat|assertion|claimed)\w*/iu.test(value))) return true;
  if (normalized.includes("unsupported_tool") && actionValues.some((value) => /\b(?:tool|data|access)\w*/iu.test(value))) return true;
  return false;
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
    const denied = route.deny_if.some((key) => contextHasDenyPredicate(context, key));
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
  const requiredRouterIds = new Set(atomic.flatMap((route) => route.select.map((blockId) => library.byId.get(blockId)?.required_upstream_router).filter(Boolean)));
  for (const route of routers) {
    if (route.select.some((blockId) => requiredRouterIds.has(blockId)) || atomic.length === 0) selected.push(...route.select);
  }
  let missingUpstream = false;
  for (const routerId of [...requiredRouterIds].sort()) {
    const router = library.byId.get(routerId);
    if (!router || router.role_kind !== "ROUTER") {
      denials.push({outcome: "UNKNOWN", reason: `Atomic selection requires missing upstream router ${routerId}.`});
      missingUpstream = true;
      continue;
    }
    selected.push(routerId);
  }
  if (missingUpstream) return {status: "UNKNOWN", selected: [], denials, signals: normalizedSignals};
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
    const availableNarrowers = [...library.byId.values()].filter((candidate) => candidate.role_kind === "ATOMIC_SPECIALIST" && candidate.required_upstream_router === block.block_id);
    const selectedNarrowers = atomic.filter((candidate) => candidate.required_upstream_router === block.block_id);
    if (availableNarrowers.length > 0) assert(selectedNarrowers.length > 0, `broad router ${block.block_id} was selected instead of a narrower atomic block`);
  }
  const ids = new Set(blocks.map((block) => block.block_id));
  for (const block of atomic) {
    assert(typeof block.required_upstream_router === "string" && block.required_upstream_router.length > 0, `${block.block_id} lacks an upstream route identity`);
    assert(ids.has(block.required_upstream_router), `${block.block_id} requires upstream router ${block.required_upstream_router} in the selected set`);
    assert(library.byId.get(block.required_upstream_router)?.role_kind === "ROUTER", `${block.block_id} upstream ${block.required_upstream_router} is not a ROUTER`);
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
