import {assert, compareUtf8, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";

export const GATE_SCHEMA = "agentos.gate_graph.v1";
export const ANSWERS = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
export const TERMINAL_TYPES = Object.freeze(["COMPLETE", "HARD_STOP", "SOFT_REVIEW", "UNPROVEN"]);
const ID = /^[A-Z][A-Z0-9._-]*$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function validateTarget(target, nodes, terminals, label) {
  assert(typeof target === "string" && ID.test(target), `${label} target is invalid`);
  assert(nodes.has(target) || terminals.has(target), `${label} target is unknown`);
}

function repairKey(from, answer, to) {
  return `${from}\u0000${answer}\u0000${to}`;
}

function repairEdgeSet(graph, nodes) {
  const edges = graph.repair_edges ?? [];
  assert(Array.isArray(edges), "gate repair_edges must be an array");
  const seen = new Set();
  for (const edge of edges) {
    assert(edge && typeof edge === "object" && !Array.isArray(edge), "gate repair edge must be an object");
    const actual = Object.keys(edge).sort();
    assert(JSON.stringify(actual) === JSON.stringify(["answer", "from", "max_visits", "to"]), "gate repair edge fields mismatch");
    assert(typeof edge.from === "string" && nodes.has(edge.from), "gate repair edge source is invalid");
    assert(ANSWERS.includes(edge.answer), "gate repair edge answer is invalid");
    assert(typeof edge.to === "string" && nodes.has(edge.to), "gate repair edge target is invalid");
    assert(nodes.get(edge.from).transitions[edge.answer] === edge.to, "gate repair edge does not match its transition");
    assert(Number.isInteger(edge.max_visits) && edge.max_visits > 0, "gate repair edge max_visits must be positive");
    const key = repairKey(edge.from, edge.answer, edge.to);
    assert(!seen.has(key), "duplicate gate repair edge");
    seen.add(key);
  }
  if (edges.length > 0) {
    assert(typeof graph.repair_limit_terminal === "string" && ID.test(graph.repair_limit_terminal), "repair_limit_terminal is required when repair edges exist");
  } else {
    assert(graph.repair_limit_terminal === undefined, "repair_limit_terminal requires a repair edge");
  }
  return seen;
}

function assertAcyclic(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const repairs = repairEdgeSet(graph, nodes);
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    assert(!visiting.has(id), `graph contains an unbounded cycle through ${id}`);
    visiting.add(id);
    for (const answer of ANSWERS) {
      const target = nodes.get(id).transitions[answer];
      if (repairs.has(repairKey(id, answer, target))) continue;
      if (nodes.has(target)) visit(target);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of graph.nodes) visit(node.id);
  const reachable = new Set();
  function mark(id) {
    if (reachable.has(id)) return;
    reachable.add(id);
    const node = nodes.get(id);
    if (!node) return;
    for (const target of Object.values(node.transitions)) if (nodes.has(target)) mark(target);
  }
  mark(graph.entry);
  assert(reachable.size === nodes.size, "gate graph contains unreachable gates");
  return repairs;
}

function reachesComplete(target, nodes, terminals, memo = new Map(), visiting = new Set()) {
  if (memo.has(target)) return memo.get(target);
  if (visiting.has(target)) return false;
  if (terminals.has(target)) return terminals.get(target).type === "COMPLETE";
  const node = nodes.get(target);
  assert(node, `unknown reachability target ${target}`);
  visiting.add(target);
  const result = Object.values(node.transitions).some((next) => reachesComplete(next, nodes, terminals, memo, visiting));
  visiting.delete(target);
  memo.set(target, result);
  return result;
}

export function validateGateGraph(graph, {checkDigest = true} = {}) {
  const allowedKeys = ["schema", "version", "graph_id", "entry", "nodes", "terminals", "digest", "repair_edges", "repair_limit_terminal"];
  const requiredKeys = ["schema", "version", "graph_id", "entry", "nodes", "terminals", "digest"];
  for (const key of requiredKeys) assert(Object.prototype.hasOwnProperty.call(graph, key), `gate graph is missing ${key}`);
  assert(Object.keys(graph).every((key) => allowedKeys.includes(key)), "gate graph contains unknown fields");
  assert(graph.schema === GATE_SCHEMA, "gate graph schema is invalid");
  assert(graph.version === 1, "gate graph version is invalid");
  assert(typeof graph.graph_id === "string" && ID.test(graph.graph_id), "gate graph ID is invalid");
  assert(typeof graph.entry === "string" && ID.test(graph.entry), "gate graph entry is invalid");
  assert(Array.isArray(graph.nodes) && graph.nodes.length > 0, "gate graph nodes are empty");
  assert(Array.isArray(graph.terminals), "gate graph terminals are invalid");
  assert((graph.digest === null && !checkDigest) || (typeof graph.digest === "string" && /^[0-9a-f]{64}$/u.test(graph.digest)), "gate graph digest is invalid");

  const nodes = new Map();
  for (const node of graph.nodes) {
    exactKeys(node, ["type", "id", "context", "question", "evidence", "transitions"], `gate ${node?.id ?? "unknown"}`);
    assert(node.type === "GATE", `gate ${node.id} type is invalid`);
    assert(typeof node.id === "string" && ID.test(node.id), "gate ID is invalid");
    assert(!nodes.has(node.id), `duplicate gate ${node.id}`);
    nodes.set(node.id, node);
    assert(typeof node.context === "string" && node.context.length > 0, `gate ${node.id} context is invalid`);
    assert(typeof node.question === "string" && node.question.length > 0, `gate ${node.id} question is empty`);
    sortedUniqueStrings(node.evidence, `gate ${node.id} evidence`);
    exactKeys(node.transitions, ANSWERS, `gate ${node.id} transitions`);
  }

  const terminals = new Map();
  for (const terminal of graph.terminals) {
    exactKeys(terminal, ["id", "type", "message"], `terminal ${terminal?.id ?? "unknown"}`);
    assert(typeof terminal.id === "string" && ID.test(terminal.id), "terminal ID is invalid");
    assert(!terminals.has(terminal.id) && !nodes.has(terminal.id), `duplicate graph target ${terminal.id}`);
    assert(TERMINAL_TYPES.includes(terminal.type), `terminal ${terminal.id} type is invalid`);
    assert(typeof terminal.message === "string" && terminal.message.length > 0, `terminal ${terminal.id} message is empty`);
    terminals.set(terminal.id, terminal);
  }

  assert(nodes.has(graph.entry), "graph entry does not name a gate");
  assertAcyclic(graph);
  if (graph.repair_limit_terminal !== undefined) {
    const limitTerminal = terminals.get(graph.repair_limit_terminal);
    assert(limitTerminal?.type === "HARD_STOP", "repair limit terminal must be a HARD_STOP terminal");
  }
  for (const node of nodes.values()) for (const answer of ANSWERS) {
    validateTarget(node.transitions[answer], nodes, terminals, `${node.id}.${answer}`);
    if (answer !== "YES") assert(!reachesComplete(node.transitions[answer], nodes, terminals), `${node.id}.${answer} can reach COMPLETE without YES`);
  }
  if (checkDigest) assert(graph.digest === digestWithout(graph, "digest"), "gate graph digest does not match content");
  return graph;
}

export function normalizeGateGraph(graph) {
  const repairEdges = [...(graph.repair_edges ?? [])].sort((left, right) => compareUtf8(
    `${left.from}:${left.answer}:${left.to}`,
    `${right.from}:${right.answer}:${right.to}`,
  ));
  const normalized = {
    schema: GATE_SCHEMA,
    version: 1,
    graph_id: graph.graph_id,
    entry: graph.entry,
    nodes: [...graph.nodes].sort((a, b) => compareUtf8(a.id, b.id)).map((node) => ({
      type: "GATE",
      id: node.id,
      context: node.context,
      question: node.question,
      evidence: [...node.evidence].sort(compareUtf8),
      transitions: Object.fromEntries(ANSWERS.map((answer) => [answer, node.transitions[answer]])),
    })),
    terminals: [...graph.terminals].sort((a, b) => compareUtf8(a.id, b.id)).map((terminal) => ({...terminal})),
    digest: null,
  };
  if (repairEdges.length > 0) {
    normalized.repair_edges = repairEdges.map((edge) => ({
      from: edge.from,
      answer: edge.answer,
      to: edge.to,
      max_visits: edge.max_visits,
    }));
    normalized.repair_limit_terminal = graph.repair_limit_terminal;
  }
  validateGateGraph(normalized, {checkDigest: false});
  return {...normalized, digest: digestWithout(normalized, "digest")};
}

export function findGate(graph, id) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  assert(node, `gate ${id} was not found`);
  return node;
}

export function findTerminal(graph, id) {
  const terminal = graph.terminals.find((candidate) => candidate.id === id);
  assert(terminal, `terminal ${id} was not found`);
  return terminal;
}
