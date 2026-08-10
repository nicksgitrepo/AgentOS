#!/usr/bin/env node

/*
 * Standalone compiler and evaluator for the named, human-readable gate slice.
 *
 * This module owns only declarative gate data and its focused validation. It
 * intentionally does not import Bootstrap, Runtime, host, campaign, or the
 * existing four-root governance libraries.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";

export const CATALOG_SCHEMA = "agentos.gate_catalog.v1";
export const DECISION_TREE_SCHEMA = "agentos.gate_decision_tree.v1";
export const CATALOG_VERSION = 1;
export const ANSWERS = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
export const FAILURE_CLASSIFICATIONS = Object.freeze([
  "OWNER_OR_HARD_BLOCKER",
  "REPAIRABLE_ENGINEERING_PUZZLE",
  "SOFT_BOUNDARY_REVIEW",
]);
export const ROUTES = Object.freeze([
  "BOUNDED_REPAIR",
  "HARD_STOP",
  "HOLD_FOR_EVIDENCE",
  "ORCHESTRATOR_REVIEW",
]);
export const TERMINAL_KINDS = Object.freeze([
  "COMPLETE",
  "HARD_STOP",
  "SOFT_REVIEW",
  "UNPROVEN",
]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const REF = /^REF_[A-Z0-9._:-]+$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/u;
const EVIDENCE_ID = /^EVIDENCE_[A-Z0-9._:-]+$/u;
const ISSUER_KINDS = new Set(["HOST_READBACK", "INDEPENDENT_AUDITOR"]);
const EVIDENCE_SOURCE_KINDS = new Set(["HOST_READBACK", "INDEPENDENT_AUDITOR", "REPRODUCIBLE_CHECK"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(SAFE_TEXT.test(value), `${label} contains control characters`);
}

function requireId(value, label) {
  assert(typeof value === "string" && ID.test(value), `${label} is invalid`);
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort();
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  return sorted;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const copy = structuredClone(value);
  copy[field] = null;
  return canonicalDigest(copy);
}

function validateAnswerValues(values, label) {
  assert(JSON.stringify(values) === JSON.stringify(ANSWERS), `${label} must preserve the four explicit answer values`);
}

function validateTarget(target, nodeIds, terminalIds, label) {
  requireId(target, label);
  assert(nodeIds.has(target) || terminalIds.has(target), `${label} names an unknown target`);
}

function terminalMap(terminals) {
  const map = new Map();
  for (const terminal of terminals) {
    exactKeys(terminal, ["terminal_id", "kind", "message"], `terminal ${terminal?.terminal_id ?? "unknown"}`);
    requireId(terminal.terminal_id, "terminal_id");
    assert(TERMINAL_KINDS.includes(terminal.kind), `terminal ${terminal.terminal_id} kind is invalid`);
    requireString(terminal.message, `terminal ${terminal.terminal_id} message`);
    assert(!map.has(terminal.terminal_id), `duplicate terminal ${terminal.terminal_id}`);
    map.set(terminal.terminal_id, terminal);
  }
  return map;
}

function categoryMap(categories) {
  const map = new Map();
  for (const category of categories) {
    exactKeys(category, ["category_id", "display_name"], `category ${category?.category_id ?? "unknown"}`);
    requireId(category.category_id, "category_id");
    requireString(category.display_name, `category ${category.category_id} display_name`);
    assert(!map.has(category.category_id), `duplicate category ${category.category_id}`);
    map.set(category.category_id, category);
  }
  return map;
}

function graphMap(graphs) {
  const map = new Map();
  for (const graph of graphs) {
    exactKeys(graph, [
      "graph_id", "display_name", "category", "entry_gate_id", "gate_ids",
      "terminal_ids", "repair_edges", "repair_limit_terminal",
    ], `graph ${graph?.graph_id ?? "unknown"}`);
    requireId(graph.graph_id, "graph_id");
    requireString(graph.display_name, `graph ${graph.graph_id} display_name`);
    requireId(graph.category, `graph ${graph.graph_id} category`);
    requireId(graph.entry_gate_id, `graph ${graph.graph_id} entry_gate_id`);
    sortedUnique(graph.gate_ids, `graph ${graph.graph_id} gate_ids`);
    sortedUnique(graph.terminal_ids, `graph ${graph.graph_id} terminal_ids`);
    assert(Array.isArray(graph.repair_edges), `graph ${graph.graph_id} repair_edges must be an array`);
    assert(graph.repair_limit_terminal === null || typeof graph.repair_limit_terminal === "string", `graph ${graph.graph_id} repair_limit_terminal is invalid`);
    assert(!map.has(graph.graph_id), `duplicate graph ${graph.graph_id}`);
    map.set(graph.graph_id, graph);
  }
  return map;
}

function validateFailurePolicy(policy, answer, transition, terminalKinds, nodeIds, label) {
  exactKeys(policy, ["classification", "route", "target", "terminal_behavior"], label);
  assert(FAILURE_CLASSIFICATIONS.includes(policy.classification), `${label} classification is invalid`);
  assert(ROUTES.includes(policy.route), `${label} route is invalid`);
  assert(policy.target === transition, `${label} target does not match its transition`);
  const targetKind = terminalKinds.get(transition);
  if (targetKind === undefined) {
    assert(policy.classification === "REPAIRABLE_ENGINEERING_PUZZLE", `${label} gate target must be a repairable puzzle`);
    assert(policy.route === "BOUNDED_REPAIR", `${label} gate target must use bounded repair`);
    assert(policy.terminal_behavior === "REPAIR_PENDING", `${label} repair behavior is invalid`);
    assert(nodeIds.has(transition), `${label} repair target is not a gate`);
    return;
  }
  if (targetKind === "HARD_STOP") {
    assert(policy.classification === "OWNER_OR_HARD_BLOCKER", `${label} hard stop classification is invalid`);
    assert(policy.route === "HARD_STOP" && policy.terminal_behavior === "HARD_STOP", `${label} hard stop route is invalid`);
  } else if (targetKind === "SOFT_REVIEW") {
    assert(policy.classification === "SOFT_BOUNDARY_REVIEW", `${label} soft review classification is invalid`);
    assert(policy.route === "ORCHESTRATOR_REVIEW" && policy.terminal_behavior === "SOFT_REVIEW", `${label} soft review route is invalid`);
  } else if (targetKind === "UNPROVEN") {
    assert(policy.classification === "OWNER_OR_HARD_BLOCKER", `${label} unproven classification is invalid`);
    assert(policy.route === "HOLD_FOR_EVIDENCE" && policy.terminal_behavior === "UNPROVEN", `${label} unproven route is invalid`);
  } else {
    throw new Error(`${label} has an unsupported terminal target`);
  }
  if (answer === "UNKNOWN") assert(policy.terminal_behavior !== "COMPLETE", `${label} UNKNOWN cannot complete`);
}

function validateGate(gate, graph, allGateIds, terminals, categories, graphGateIds) {
  exactKeys(gate, [
    "gate_id", "graph_id", "category", "context", "name", "question", "evidence",
    "not_applicable_requires", "transitions", "failure_policy", "terminal_behavior",
  ], `gate ${gate?.gate_id ?? "unknown"}`);
  requireId(gate.gate_id, "gate_id");
  requireId(gate.graph_id, `gate ${gate.gate_id} graph_id`);
  assert(gate.graph_id === graph.graph_id, `gate ${gate.gate_id} is assigned to the wrong graph`);
  requireId(gate.category, `gate ${gate.gate_id} category`);
  assert(categories.has(gate.category), `gate ${gate.gate_id} category is unknown`);
  requireString(gate.context, `gate ${gate.gate_id} context`);
  requireString(gate.name, `gate ${gate.gate_id} name`);
  requireString(gate.question, `gate ${gate.gate_id} question`);
  assert(gate.question.endsWith("?"), `gate ${gate.gate_id} question must end with a question mark`);
  sortedUnique(gate.evidence, `gate ${gate.gate_id} evidence`);
  assert(Array.isArray(gate.not_applicable_requires) && gate.not_applicable_requires.includes("applicability_justification"), `gate ${gate.gate_id} lacks applicability justification evidence`);
  exactKeys(gate.transitions, ANSWERS, `gate ${gate.gate_id} transitions`);
  exactKeys(gate.failure_policy, ["NO", "UNKNOWN", "NOT_APPLICABLE"], `gate ${gate.gate_id} failure_policy`);
  exactKeys(gate.terminal_behavior, ANSWERS, `gate ${gate.gate_id} terminal_behavior`);
  const nodeIds = new Set(graphGateIds);
  const terminalIds = new Set(graph.terminal_ids);
  const terminalKinds = new Map([...terminals.entries()]
    .filter(([id]) => terminalIds.has(id))
    .map(([id, terminal]) => [id, terminal.kind]));
  for (const answer of ANSWERS) validateTarget(gate.transitions[answer], nodeIds, terminalIds, `${gate.gate_id}.${answer}`);
  for (const answer of ["NO", "UNKNOWN", "NOT_APPLICABLE"]) {
    validateFailurePolicy(gate.failure_policy[answer], answer, gate.transitions[answer], terminalKinds, nodeIds, `${gate.gate_id}.${answer}`);
  }
  const yesTarget = gate.transitions.YES;
  const yesKind = terminalKinds.get(yesTarget);
  if (yesKind === undefined) assert(gate.terminal_behavior.YES === "ADVANCE", `${gate.gate_id} YES must advance to another gate`);
  else assert(gate.terminal_behavior.YES === yesKind, `${gate.gate_id} YES terminal behavior differs from its target`);
  for (const answer of ["NO", "UNKNOWN", "NOT_APPLICABLE"]) {
    const target = gate.transitions[answer];
    const kind = terminalKinds.get(target);
    if (kind !== undefined) assert(gate.terminal_behavior[answer] === kind, `${gate.gate_id} ${answer} terminal behavior differs from its target`);
  }
  assert(allGateIds.has(gate.gate_id), `gate ${gate.gate_id} is not in the catalog gate index`);
}

function reachesComplete(target, nodeMap, terminalKinds, visiting = new Set(), memo = new Map()) {
  if (memo.has(target)) return memo.get(target);
  if (terminalKinds.has(target)) return terminalKinds.get(target) === "COMPLETE";
  if (visiting.has(target)) return false;
  const node = nodeMap.get(target);
  assert(node, `reachability target ${target} is missing`);
  const nextVisiting = new Set(visiting).add(target);
  const result = ANSWERS.some((answer) => reachesComplete(node.transitions[answer], nodeMap, terminalKinds, nextVisiting, memo));
  memo.set(target, result);
  return result;
}

function validateGraphTopology(graph, gatesById, terminals) {
  const graphGates = new Map(graph.gate_ids.map((id) => [id, gatesById.get(id)]));
  assert(graphGates.get(graph.entry_gate_id), `${graph.graph_id} entry gate is missing`);
  const terminalKinds = new Map(graph.terminal_ids.map((id) => [id, terminals.get(id).kind]));
  for (const id of graph.gate_ids) assert(graphGates.get(id), `${graph.graph_id} gate ${id} is missing from the catalog`);
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id) || terminalKinds.has(id)) return;
    const gate = graphGates.get(id);
    assert(gate, `${graph.graph_id} reaches a gate outside its graph`);
    reachable.add(id);
    for (const answer of ANSWERS) if (graphGates.has(gate.transitions[answer])) visit(gate.transitions[answer]);
  };
  visit(graph.entry_gate_id);
  assert(reachable.size === graph.gate_ids.length, `${graph.graph_id} contains unreachable gates`);
  for (const gate of graphGates.values()) {
    for (const answer of ["NO", "UNKNOWN", "NOT_APPLICABLE"]) {
      assert(!reachesComplete(gate.transitions[answer], graphGates, terminalKinds), `${gate.gate_id}.${answer} can reach COMPLETE without YES`);
    }
  }
  const repairKeys = new Set();
  for (const edge of graph.repair_edges) {
    exactKeys(edge, ["from", "answer", "to", "max_visits"], `${graph.graph_id} repair edge`);
    assert(graphGates.has(edge.from) && graphGates.has(edge.to), `${graph.graph_id} repair edge references another graph`);
    assert(ANSWERS.includes(edge.answer), `${graph.graph_id} repair edge answer is invalid`);
    assert(graphGates.get(edge.from).transitions[edge.answer] === edge.to, `${graph.graph_id} repair edge does not match its transition`);
    assert(Number.isSafeInteger(edge.max_visits) && edge.max_visits > 0, `${graph.graph_id} repair edge max_visits must be positive`);
    const key = `${edge.from}\u0000${edge.answer}\u0000${edge.to}`;
    assert(!repairKeys.has(key), `${graph.graph_id} repair edge is duplicated`);
    repairKeys.add(key);
  }
  if (graph.repair_edges.length > 0) {
    assert(graph.repair_limit_terminal !== null, `${graph.graph_id} repair limit terminal is required`);
    assert(terminalKinds.get(graph.repair_limit_terminal) === "HARD_STOP", `${graph.graph_id} repair limit must be a hard stop`);
  } else assert(graph.repair_limit_terminal === null, `${graph.graph_id} has an unused repair limit terminal`);
}

export function validateGateCatalog(source) {
  requireRecord(source, "gate catalog");
  exactKeys(source, [
    "schema", "version", "status", "source_kind", "answer_values", "semantics",
    "failure_classifications", "categories", "graphs", "terminals", "gates", "digest",
  ], "gate catalog");
  assert(source.schema === CATALOG_SCHEMA && source.version === CATALOG_VERSION, "gate catalog identity is invalid");
  assert(source.status === "PREPARED_NOT_ACTIVATED", "gate catalog must remain prepared and inactive");
  assert(source.source_kind === "DECLARATIVE_GOVERNANCE_DATA", "gate catalog source kind is invalid");
  validateAnswerValues(source.answer_values, "gate catalog answer_values");
  exactKeys(source.semantics, ["pass_answer", "unknown_behavior", "not_applicable_behavior", "agent_statement_alone", "repair_limit"], "gate catalog semantics");
  assert(source.semantics.pass_answer === "YES", "YES must be the only pass answer");
  assert(source.semantics.unknown_behavior === "NEVER_PASSES", "UNKNOWN must never pass");
  assert(source.semantics.not_applicable_behavior === "REQUIRES_APPLICABILITY_JUSTIFICATION", "NOT_APPLICABLE justification policy is missing");
  assert(source.semantics.agent_statement_alone === "NEVER_SUFFICIENT", "agent statements cannot be evidence");
  assert(source.semantics.repair_limit === "POSITIVE_VISIT_LIMIT_THEN_HARD_STOP", "repair limit policy is invalid");
  assert(JSON.stringify([...source.failure_classifications].sort()) === JSON.stringify([...FAILURE_CLASSIFICATIONS].sort()), "failure classifications differ from the portable contract");
  const categories = categoryMap(source.categories);
  const graphs = graphMap(source.graphs);
  const terminals = terminalMap(source.terminals);
  const gatesById = new Map();
  for (const gate of source.gates) {
    assert(!gatesById.has(gate.gate_id), `duplicate gate ${gate.gate_id}`);
    gatesById.set(gate.gate_id, gate);
  }
  const allGateIds = new Set(gatesById.keys());
  assert(allGateIds.size === source.gates.length, "gate IDs must be unique");
  for (const graph of graphs.values()) {
    assert(categories.has(graph.category), `${graph.graph_id} category is not declared`);
    for (const id of graph.gate_ids) assert(allGateIds.has(id), `${graph.graph_id} references an undeclared gate`);
    for (const id of graph.terminal_ids) assert(terminals.has(id), `${graph.graph_id} references an undeclared terminal`);
    validateGraphTopology(graph, gatesById, terminals);
  }
  for (const gate of source.gates) {
    const graph = graphs.get(gate.graph_id);
    assert(graph, `gate ${gate.gate_id} references an undeclared graph`);
    assert(graph.gate_ids.includes(gate.gate_id), `gate ${gate.gate_id} is not listed by its graph`);
    validateGate(gate, graph, allGateIds, terminals, categories, graph.gate_ids);
  }
  if (source.digest !== null) {
    assert(DIGEST.test(source.digest), "gate catalog digest is invalid");
    assert(source.digest === digestWithout(source, "digest"), "gate catalog digest does not match content");
  }
  return source;
}

export function compileGateCatalog(source) {
  validateGateCatalog(source);
  const normalized = {
    schema: DECISION_TREE_SCHEMA,
    version: 1,
    status: source.status,
    catalog_schema: source.schema,
    catalog_digest: digestWithout(source, "digest"),
    answer_values: [...source.answer_values],
    semantics: structuredClone(source.semantics),
    failure_classifications: [...source.failure_classifications].sort(compareUtf8),
    categories: [...source.categories].sort((left, right) => compareUtf8(left.category_id, right.category_id)),
    graphs: [...source.graphs].sort((left, right) => compareUtf8(left.graph_id, right.graph_id)).map((graph) => ({
      ...structuredClone(graph),
      gate_ids: [...graph.gate_ids].sort(compareUtf8),
      terminal_ids: [...graph.terminal_ids].sort(compareUtf8),
      repair_edges: [...graph.repair_edges].sort((left, right) => compareUtf8(`${left.from}:${left.answer}:${left.to}`, `${right.from}:${right.answer}:${right.to}`)),
    })),
    terminals: [...source.terminals].sort((left, right) => compareUtf8(left.terminal_id, right.terminal_id)),
    gates: [...source.gates].sort((left, right) => compareUtf8(left.gate_id, right.gate_id)).map((gate) => structuredClone(gate)),
    digest: null,
  };
  normalized.digest = digestWithout(normalized, "digest");
  return validateCompiledGateTree(normalized);
}

export function validateCompiledGateTree(tree) {
  requireRecord(tree, "compiled gate tree");
  exactKeys(tree, [
    "schema", "version", "status", "catalog_schema", "catalog_digest", "answer_values",
    "semantics", "failure_classifications", "categories", "graphs", "terminals", "gates", "digest",
  ], "compiled gate tree");
  assert(tree.schema === DECISION_TREE_SCHEMA && tree.version === 1, "compiled gate tree identity is invalid");
  assert(tree.status === "PREPARED_NOT_ACTIVATED", "compiled gate tree must remain inactive");
  assert(tree.catalog_schema === CATALOG_SCHEMA && DIGEST.test(tree.catalog_digest), "compiled catalog binding is invalid");
  assert(DIGEST.test(tree.digest) && tree.digest === digestWithout(tree, "digest"), "compiled gate tree digest is invalid");
  const sourceLike = {
    schema: CATALOG_SCHEMA,
    version: CATALOG_VERSION,
    status: tree.status,
    source_kind: "DECLARATIVE_GOVERNANCE_DATA",
    answer_values: tree.answer_values,
    semantics: tree.semantics,
    failure_classifications: tree.failure_classifications,
    categories: tree.categories,
    graphs: tree.graphs,
    terminals: tree.terminals,
    gates: tree.gates,
    digest: null,
  };
  validateGateCatalog(sourceLike);
  return tree;
}

export async function loadGateCatalog(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  return validateGateCatalog(parsed);
}

export async function compileGateCatalogFile(filePath) {
  return compileGateCatalog(await loadGateCatalog(filePath));
}

function validateOpaqueRef(value, label) {
  assert(typeof value === "string" && REF.test(value), `${label} must be an opaque reference`);
}

function validateEvidenceRecord(record, label) {
  exactKeys(record, [
    "evidence_id", "evidence_digest", "issuer_kind", "issuer_ref", "source_kind",
    "observed_identity", "supports_answer",
  ], label);
  assert(typeof record.evidence_id === "string" && EVIDENCE_ID.test(record.evidence_id), `${label}.evidence_id is invalid`);
  assert(typeof record.evidence_digest === "string" && DIGEST.test(record.evidence_digest), `${label}.evidence_digest is invalid`);
  assert(ISSUER_KINDS.has(record.issuer_kind), `${label}.issuer_kind is invalid`);
  assert(EVIDENCE_SOURCE_KINDS.has(record.source_kind), `${label}.source_kind is invalid`);
  validateOpaqueRef(record.issuer_ref, `${label}.issuer_ref`);
  assert(record.supports_answer === true, `${label} does not support its answer`);
  assert(record.evidence_digest === digestWithout(record, "evidence_digest"), `${label}.evidence_digest does not match its canonical record`);
  exactKeys(record.observed_identity, ["source_ref", "worktree_ref", "session_ref", "goal_ref", "environment_ref"], `${label}.observed_identity`);
  for (const field of ["source_ref", "worktree_ref", "session_ref", "goal_ref", "environment_ref"]) validateOpaqueRef(record.observed_identity[field], `${label}.observed_identity.${field}`);
  assert(record.issuer_ref !== record.observed_identity.session_ref, `${label} issuer cannot be the worker session`);
  if (record.source_kind === "INDEPENDENT_AUDITOR") assert(record.issuer_kind === "INDEPENDENT_AUDITOR", `${label} Auditor source must have Auditor issuer`);
  return record;
}

export function validateGateEvidence(gate, answer, evidence) {
  assert(ANSWERS.includes(answer), "answer must be one of the four explicit values");
  requireRecord(evidence, `${gate.gate_id} evidence`);
  const required = [...gate.evidence, ...(answer === "NOT_APPLICABLE" ? gate.not_applicable_requires : [])].sort(compareUtf8);
  exactKeys(evidence, required, `${gate.gate_id} evidence`);
  for (const [slot, record] of Object.entries(evidence)) validateEvidenceRecord(record, `${gate.gate_id}.${slot}`);
  if (answer === "NOT_APPLICABLE") assert(Object.hasOwn(evidence, "applicability_justification"), `${gate.gate_id} NOT_APPLICABLE lacks justification`);
  return evidence;
}

function answerRecord(value, gate) {
  exactKeys(value, ["answer", "evidence"], `${gate.gate_id} answer`);
  assert(ANSWERS.includes(value.answer), `${gate.gate_id} answer must be explicit YES, NO, UNKNOWN, or NOT_APPLICABLE`);
  validateGateEvidence(gate, value.answer, value.evidence);
  return value;
}

export function evaluateGateDecisionTree({tree, graphId, answers, expectedIdentity = null}) {
  validateCompiledGateTree(tree);
  requireId(graphId, "graphId");
  requireRecord(answers, "answers");
  const graph = tree.graphs.find((candidate) => candidate.graph_id === graphId);
  assert(graph, `unknown graph ${graphId}`);
  const gateById = new Map(tree.gates.map((gate) => [gate.gate_id, gate]));
  const terminalById = new Map(tree.terminals.map((terminal) => [terminal.terminal_id, terminal]));
  const repairByKey = new Map(graph.repair_edges.map((edge) => [`${edge.from}\u0000${edge.answer}\u0000${edge.to}`, edge]));
  const repairVisits = new Map();
  const trace = [];
  let executionIdentity = expectedIdentity === null ? null : structuredClone(expectedIdentity);
  let current = graph.entry_gate_id;
  let steps = 0;
  const maxSteps = Math.max(32, graph.gate_ids.length + graph.repair_edges.reduce((sum, edge) => sum + edge.max_visits, 0) + 1);
  while (true) {
    assert(++steps <= maxSteps, `${graphId} exceeded its bounded execution steps`);
    const gate = gateById.get(current);
    assert(gate, `${graphId} current target ${current} is not a gate`);
    assert(Object.hasOwn(answers, gate.gate_id), `missing answer for ${gate.gate_id}`);
    const record = answerRecord(answers[gate.gate_id], gate);
    const evidenceIdentity = Object.values(record.evidence)[0].observed_identity;
    if (executionIdentity === null) executionIdentity = structuredClone(evidenceIdentity);
    else for (const field of Object.keys(evidenceIdentity)) assert(evidenceIdentity[field] === executionIdentity[field], `${gate.gate_id} evidence identity differs from the execution identity`);
    const destination = gate.transitions[record.answer];
    const repair = repairByKey.get(`${gate.gate_id}\u0000${record.answer}\u0000${destination}`);
    const traceEntry = {
      step: steps,
      gate_id: gate.gate_id,
      gate_name: gate.name,
      answer: record.answer,
      target: destination,
      ...(record.answer === "YES" ? {terminal_behavior: gate.terminal_behavior.YES} : {failure: gate.failure_policy[record.answer]}),
    };
    if (repair !== undefined) {
      const key = `${repair.from}\u0000${repair.answer}\u0000${repair.to}`;
      const visit = (repairVisits.get(key) ?? 0) + 1;
      repairVisits.set(key, visit);
      traceEntry.repair_visit = visit;
      traceEntry.repair_limit = repair.max_visits;
      if (visit > repair.max_visits) {
        const terminal = terminalById.get(graph.repair_limit_terminal);
        assert(terminal?.kind === "HARD_STOP", `${graphId} repair limit terminal is unavailable`);
        traceEntry.target = terminal.terminal_id;
        trace.push(traceEntry);
        return {status: terminal.kind, graph_id: graphId, terminal_id: terminal.terminal_id, terminal_message: terminal.message, trace};
      }
    }
    trace.push(traceEntry);
    const terminal = terminalById.get(destination);
    if (terminal !== undefined) return {status: terminal.kind, graph_id: graphId, terminal_id: terminal.terminal_id, terminal_message: terminal.message, trace};
    current = destination;
  }
}
