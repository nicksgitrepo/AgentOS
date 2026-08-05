import {assert} from "./canonical-json.mjs";
import {validateEvidence, validateIdentity} from "./evidence.mjs";
import {ANSWERS, findGate, findTerminal, validateGateGraph} from "./gate-model.mjs";

export const EXECUTION_SCHEMA = "agentos.gate_execution.v1";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function validateEvidenceBundle(bundle, gate) {
  assert(bundle && typeof bundle === "object" && !Array.isArray(bundle), `${gate.id} evidence must be an object`);
  const expected = [...gate.evidence].sort();
  assert(JSON.stringify(Object.keys(bundle).sort()) === JSON.stringify(expected), `${gate.id} evidence fields mismatch`);
  for (const key of gate.evidence) validateEvidence(bundle[key], gate.id, `${gate.id}.${key}`);
}

export function createExecution(graph, binding, {maxSteps = 128} = {}) {
  validateGateGraph(graph);
  validateIdentity(binding, "execution binding");
  assert(Number.isInteger(maxSteps) && maxSteps > 0, "maxSteps must be positive");
  return {
    schema: EXECUTION_SCHEMA,
    version: 1,
    graph_id: graph.graph_id,
    status: "ACTIVE",
    current_node: graph.entry,
    step_count: 0,
    max_steps: maxSteps,
    trace: [],
    binding: {...binding},
    result: null,
  };
}

export function answerCurrent(state, graph, answer, evidence) {
  validateGateGraph(graph);
  exactKeys(state, ["schema", "version", "graph_id", "status", "current_node", "step_count", "max_steps", "trace", "binding", "result"], "execution state");
  assert(state.schema === EXECUTION_SCHEMA && state.version === 1, "execution identity is invalid");
  assert(state.graph_id === graph.graph_id, "execution graph identity differs");
  assert(state.status === "ACTIVE", `execution is not active: ${state.status}`);
  assert(ANSWERS.includes(answer), "answer must be explicit");
  assert(state.step_count < state.max_steps, "execution step limit reached");
  validateIdentity(state.binding, "execution binding");

  const gate = findGate(graph, state.current_node);
  validateEvidenceBundle(evidence, gate);
  const target = gate.transitions[answer];
  const trace = [...state.trace, {step: state.step_count + 1, gate_id: gate.id, answer, target}];
  if (graph.nodes.some((node) => node.id === target)) {
    return {...state, current_node: target, step_count: state.step_count + 1, trace};
  }
  const terminal = findTerminal(graph, target);
  return {
    ...state,
    status: terminal.type,
    current_node: null,
    step_count: state.step_count + 1,
    trace,
    result: {terminal_id: terminal.id, terminal_type: terminal.type, message: terminal.message},
  };
}

export function replay(graph, binding, answers, evidenceFor) {
  let state = createExecution(graph, binding);
  for (const answer of answers) {
    assert(state.status === "ACTIVE", "replay contains answers after termination");
    const gate = findGate(graph, state.current_node);
    state = answerCurrent(state, graph, answer, evidenceFor(gate, answer));
  }
  return state;
}

