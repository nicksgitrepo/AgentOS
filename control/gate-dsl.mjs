import {readFile} from "node:fs/promises";
import {assert, digestWithout} from "./canonical-json.mjs";
import {normalizeGateGraph, validateGateGraph} from "./gate-model.mjs";

const ANSWERS = ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"];
const TERMINAL_TYPES = new Set(["COMPLETE", "HARD_STOP", "SOFT_REVIEW", "UNPROVEN"]);

function quoted(value, label) {
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) { throw new Error(`${label} must be a JSON quoted string: ${error.message}`); }
  assert(typeof parsed === "string" && parsed.length > 0, `${label} must be nonempty`);
  return parsed;
}

function parts(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseGateDsl(text, source = "<memory>") {
  assert(typeof text === "string", `${source} must be text`);
  let graphId = null;
  let version = null;
  let entry = null;
  let current = null;
  const nodes = new Map();
  const terminals = new Map();
  const lines = text.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const fail = (message) => { throw new Error(`${source}:${lineNumber}: ${message}`); };

    let match = line.match(/^graph\s+(\S+)\s+(\d+)$/u);
    if (match) { if (graphId !== null) fail("duplicate graph declaration"); graphId = match[1]; version = Number(match[2]); continue; }
    match = line.match(/^entry\s+(\S+)$/u);
    if (match) { if (entry !== null) fail("duplicate entry declaration"); entry = match[1]; continue; }
    match = line.match(/^gate\s+(\S+)$/u);
    if (match) {
      if (current !== null) fail(`gate ${current.id} is missing end`);
      if (nodes.has(match[1]) || terminals.has(match[1])) fail(`duplicate target ${match[1]}`);
      current = {type: "GATE", id: match[1], context: null, question: null, evidence: [], transitions: Object.fromEntries(ANSWERS.map((answer) => [answer, null]))};
      nodes.set(match[1], current);
      continue;
    }
    if (line === "end") { if (current === null) fail("end has no open gate"); current = null; continue; }
    match = line.match(/^context\s+(\S+)$/u);
    if (match) { if (!current) fail("context must be inside a gate"); current.context = match[1]; continue; }
    match = line.match(/^question\s+(.+)$/u);
    if (match) { if (!current) fail("question must be inside a gate"); current.question = quoted(match[1], "question"); continue; }
    match = line.match(/^evidence\s+(.+)$/u);
    if (match) { if (!current) fail("evidence must be inside a gate"); current.evidence = match[1] === "none" ? [] : parts(match[1]); continue; }
    match = line.match(/^(YES|NO|UNKNOWN|NOT_APPLICABLE)\s+(\S+)$/u);
    if (match) { if (!current) fail("transition must be inside a gate"); current.transitions[match[1]] = match[2]; continue; }
    match = line.match(/^terminal\s+(\S+)\s+(\S+)\s+(.+)$/u);
    if (match) {
      if (current !== null) fail("terminal must be outside a gate");
      if (terminals.has(match[1]) || nodes.has(match[1])) fail(`duplicate target ${match[1]}`);
      if (!TERMINAL_TYPES.has(match[2])) fail(`unknown terminal type ${match[2]}`);
      terminals.set(match[1], {id: match[1], type: match[2], message: quoted(match[3], "terminal message")});
      continue;
    }
    fail(`unrecognized declaration ${line}`);
  }

  assert(current === null, `${source}: unterminated gate ${current?.id ?? "unknown"}`);
  assert(graphId !== null && version !== null && entry !== null, `${source}: graph, version, and entry are required`);
  const raw = {
    schema: "agentos.gate_graph.v1",
    version,
    graph_id: graphId,
    entry,
    nodes: [...nodes.values()],
    terminals: [...terminals.values()],
    digest: null,
  };
  return normalizeGateGraph(raw);
}

export async function compileGateFile(path) {
  return parseGateDsl(await readFile(path, "utf8"), path);
}

export function serializeGateGraph(graph) {
  validateGateGraph(graph);
  return JSON.stringify(graph, null, 2) + "\n";
}

export function graphDigest(graph) {
  return digestWithout(graph, "digest");
}
