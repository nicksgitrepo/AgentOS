import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, digestWithout} from "./canonical-json.mjs";
import {findGate, findTerminal} from "./gate-model.mjs";

export const QUESTION_CATALOG_SCHEMA = "agentos.question_catalog.v1";
export const RENDERED_GATE_SCHEMA = "agentos.rendered_gate.v1";
export const RENDERED_PACKET_SCHEMA = "agentos.rendered_gate_packet.v1";
export const ANSWERS = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function name(value, label) {
  nonempty(value, label);
  assert(!ID.test(value), `${label} must be human-readable, not a machine ID`);
  assert(value.split(/\s+/u).length >= 2, `${label} must contain a descriptive name`);
}

function objectOfStrings(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    nonempty(key, `${label} key`);
    name(item, `${label}.${key}`);
  }
}

export function validateQuestionCatalog(catalog) {
  exactKeys(catalog, ["schema", "version", "status", "graph_names", "gate_names", "evidence_labels", "digest"], "question catalog");
  assert(catalog.schema === QUESTION_CATALOG_SCHEMA && catalog.version === 1, "question catalog identity is invalid");
  assert(catalog.status === "PREPARED_NOT_ACTIVATED", "question catalog must remain prepared");
  objectOfStrings(catalog.graph_names, "question catalog graph_names");
  objectOfStrings(catalog.gate_names, "question catalog gate_names");
  objectOfStrings(catalog.evidence_labels, "question catalog evidence_labels");
  assert(DIGEST.test(catalog.digest) && catalog.digest === digestWithout(catalog, "digest"), "question catalog digest does not match content");
  return catalog;
}

export async function loadQuestionCatalog(root) {
  return validateQuestionCatalog(JSON.parse(await readFile(path.join(root, "governance/question-catalog.json"), "utf8")));
}

function targetDetails(graph, target, catalog) {
  const node = graph.nodes.find((candidate) => candidate.id === target);
  if (node) {
    return {target_id: node.id, target_kind: "QUESTION", target_name: catalog.gate_names[node.id], target_type: "QUESTION", message: null};
  }
  const terminal = findTerminal(graph, target);
  return {target_id: terminal.id, target_kind: "TERMINAL", target_name: terminal.message, target_type: terminal.type, message: terminal.message};
}

function guidance(answer, target) {
  if (answer === "YES") return `Answer YES only after the required evidence is attached; then continue to ${target.target_name}.`;
  if (target.target_type === "HARD_STOP") return `Do not continue. Preserve the evidence, stop work, and follow the hard-stop route: ${target.target_name}.`;
  if (target.target_type === "SOFT_REVIEW") return `Pause this lane and send the evidence to the Campaign Orchestrator for review: ${target.target_name}.`;
  if (target.target_type === "UNPROVEN") return `Do not claim a pass. Gather the missing evidence or return this result as unproven: ${target.target_name}.`;
  return `Do not advance from this question. Repair the named issue, collect fresh evidence, and then continue to ${target.target_name}.`;
}

function evidenceEntries(node, catalog) {
  return node.evidence.map((slot_id) => ({
    slot_id,
    label: catalog.evidence_labels[slot_id] ?? slot_id.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase()),
    required: true,
  }));
}

export function validateCatalogAgainstGraphs(graphs, catalog) {
  validateQuestionCatalog(catalog);
  assert(graphs instanceof Map && graphs.size > 0, "governance graph map is required");
  const seen = new Set();
  for (const [graphId, graph] of graphs) {
    assert(graph.graph_id === graphId, `graph map key differs for ${graphId}`);
    name(catalog.graph_names[graphId], `graph ${graphId} display name`);
    for (const node of graph.nodes) {
      assert(catalog.gate_names[node.id], `gate ${node.id} has no human-readable name`);
      name(catalog.gate_names[node.id], `gate ${node.id} display name`);
      for (const slot of node.evidence) assert(catalog.evidence_labels[slot], `gate ${node.id} evidence slot ${slot} has no label`);
      assert(!seen.has(node.id), `gate ID is reused across graphs: ${node.id}`);
      seen.add(node.id);
    }
  }
  return catalog;
}

export function renderGateQuestion(graph, gateId, catalog) {
  validateCatalogAgainstGraphs(new Map([[graph.graph_id, graph]]), catalog);
  const node = findGate(graph, gateId);
  const next_by_answer = Object.fromEntries(ANSWERS.map((answer) => [answer, targetDetails(graph, node.transitions[answer], catalog)]));
  const rendered = {
    schema: RENDERED_GATE_SCHEMA,
    version: 1,
    graph_id: graph.graph_id,
    graph_name: catalog.graph_names[graph.graph_id],
    gate_id: node.id,
    gate_name: catalog.gate_names[node.id],
    context: node.context,
    question: node.question,
    evidence: evidenceEntries(node, catalog),
    allowed_answers: [...ANSWERS],
    pass_answers: ["YES"],
    next_by_answer,
    repair_guidance: Object.fromEntries(ANSWERS.map((answer) => [answer, guidance(answer, next_by_answer[answer])])),
    response_template: `Gate "${catalog.gate_names[node.id]}" passed successfully.`,
    digest: null,
  };
  rendered.digest = digestWithout(rendered, "digest");
  return rendered;
}

export function validateRenderedGate(rendered, {graph = null, catalog = null} = {}) {
  exactKeys(rendered, ["schema", "version", "graph_id", "graph_name", "gate_id", "gate_name", "context", "question", "evidence", "allowed_answers", "pass_answers", "next_by_answer", "repair_guidance", "response_template", "digest"], "rendered gate");
  assert(rendered.schema === RENDERED_GATE_SCHEMA && rendered.version === 1, "rendered gate identity is invalid");
  assert(ID.test(rendered.graph_id) && ID.test(rendered.gate_id), "rendered gate IDs are invalid");
  name(rendered.graph_name, "rendered graph name");
  name(rendered.gate_name, "rendered gate name");
  nonempty(rendered.context, "rendered gate context");
  nonempty(rendered.question, "rendered gate question");
  assert(JSON.stringify(rendered.allowed_answers) === JSON.stringify(ANSWERS), "rendered gate answer set is incomplete");
  assert(JSON.stringify(rendered.pass_answers) === JSON.stringify(["YES"]), "rendered gate pass answer is unsafe");
  assert(Array.isArray(rendered.evidence) && rendered.evidence.length > 0, "rendered gate evidence is missing");
  for (const item of rendered.evidence) {
    exactKeys(item, ["slot_id", "label", "required"], "rendered evidence slot");
    nonempty(item.slot_id, "rendered evidence slot_id");
    name(item.label, `rendered evidence ${item.slot_id} label`);
    assert(item.required === true, `rendered evidence ${item.slot_id} must be required`);
  }
  exactKeys(rendered.next_by_answer, ANSWERS, "rendered gate routes");
  exactKeys(rendered.repair_guidance, ANSWERS, "rendered gate repair guidance");
  for (const answer of ANSWERS) {
    exactKeys(rendered.next_by_answer[answer], ["target_id", "target_kind", "target_name", "target_type", "message"], `rendered route ${answer}`);
    name(rendered.next_by_answer[answer].target_name, `rendered route ${answer} target name`);
    nonempty(rendered.repair_guidance[answer], `rendered route ${answer} repair guidance`);
  }
  assert(rendered.response_template === `Gate "${rendered.gate_name}" passed successfully.`, "rendered response template is not bound to the gate name");
  assert(DIGEST.test(rendered.digest) && rendered.digest === digestWithout(rendered, "digest"), "rendered gate digest does not match content");
  if (graph && catalog) {
    const expected = renderGateQuestion(graph, rendered.gate_id, catalog);
    assert(expected.digest === rendered.digest, "rendered gate differs from the graph and catalog");
  }
  return rendered;
}

export function renderGatePacket(graph, catalog) {
  validateCatalogAgainstGraphs(new Map([[graph.graph_id, graph]]), catalog);
  const questions = graph.nodes.map((node) => renderGateQuestion(graph, node.id, catalog));
  const packet = {schema: RENDERED_PACKET_SCHEMA, version: 1, graph_id: graph.graph_id, graph_name: catalog.graph_names[graph.graph_id], questions, digest: null};
  packet.digest = digestWithout(packet, "digest");
  return packet;
}

export function validateRenderedGatePacket(packet, {graph = null, catalog = null} = {}) {
  exactKeys(packet, ["schema", "version", "graph_id", "graph_name", "questions", "digest"], "rendered gate packet");
  assert(packet.schema === RENDERED_PACKET_SCHEMA && packet.version === 1, "rendered gate packet identity is invalid");
  name(packet.graph_name, "rendered packet graph name");
  assert(Array.isArray(packet.questions) && packet.questions.length > 0, "rendered gate packet is empty");
  for (const question of packet.questions) validateRenderedGate(question, {graph: graph && question.graph_id === graph.graph_id ? graph : null, catalog});
  assert(DIGEST.test(packet.digest) && packet.digest === digestWithout(packet, "digest"), "rendered gate packet digest does not match content");
  if (graph && catalog) assert(packet.digest === renderGatePacket(graph, catalog).digest, "rendered gate packet differs from the graph and catalog");
  return packet;
}
