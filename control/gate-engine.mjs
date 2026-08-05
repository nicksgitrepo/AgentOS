import crypto from "node:crypto";
import {assert, canonicalJson, sha256} from "./canonical-json.mjs";
import {validateEvidence, validateIdentity} from "./evidence.mjs";
import {ANSWERS, findGate, findTerminal, validateGateGraph} from "./gate-model.mjs";

export const EXECUTION_SCHEMA = "agentos.gate_execution.v1";

export function createExecutionAuthority(secret) {
  assert(typeof secret === "string" && secret.length >= 32, "execution authority secret is required");
  const active = new Set();
  const closed = new Set();
  const keyFor = (graph, binding) => sha256({graph_digest: graph.digest, binding});
  const tag = (state) => crypto.createHmac("sha256", secret).update(canonicalJson({...state, auth_tag: null}), "utf8").digest("hex");
  return Object.freeze({
    register(graph, binding) {
      const key = keyFor(graph, binding);
      assert(!active.has(key) && !closed.has(key), "execution is already active or permanently closed");
      active.add(key);
      return {execution_id: `EXEC-${key.slice(0, 24)}`, key};
    },
    seal(state) { return {...state, auth_tag: tag(state)}; },
    verify(state, graph) {
      assert(typeof state.auth_tag === "string" && state.auth_tag === tag(state), "execution state authentication failed");
      assert(state.graph_digest === graph.digest, "execution graph digest differs");
      return state;
    },
    finish(executionId, graph, binding) {
      const key = keyFor(graph, binding);
      assert(executionId === `EXEC-${key.slice(0, 24)}`, "execution ID differs from its binding");
      active.delete(key);
      closed.add(key);
    },
  });
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function validateEvidenceBundle(bundle, gate, graph, binding, answer) {
  assert(bundle && typeof bundle === "object" && !Array.isArray(bundle), `${gate.id} evidence must be an object`);
  const expected = [...gate.evidence].sort();
  assert(JSON.stringify(Object.keys(bundle).sort()) === JSON.stringify(expected), `${gate.id} evidence fields mismatch`);
  for (const key of gate.evidence) validateEvidence(bundle[key], {
    question_id: gate.id,
    graph_digest: graph.digest,
    evidence_slot: key,
    answer,
    binding,
  }, `${gate.id}.${key}`);
}

export function createExecution(graph, binding, {maxSteps = 128, authority} = {}) {
  validateGateGraph(graph);
  validateIdentity(binding, "execution binding");
  assert(authority && typeof authority.register === "function" && typeof authority.seal === "function", "execution authority is required");
  assert(Number.isInteger(maxSteps) && maxSteps > 0, "maxSteps must be positive");
  const execution = authority.register(graph, binding);
  return authority.seal({
    schema: EXECUTION_SCHEMA,
    version: 1,
    graph_id: graph.graph_id,
    graph_digest: graph.digest,
    execution_id: execution.execution_id,
    status: "ACTIVE",
    current_node: graph.entry,
    step_count: 0,
    max_steps: maxSteps,
    trace: [],
    binding: {...binding},
    result: null,
    auth_tag: null,
  });
}

export function answerCurrent(state, graph, answer, evidence, {authority} = {}) {
  validateGateGraph(graph);
  exactKeys(state, ["schema", "version", "graph_id", "graph_digest", "execution_id", "status", "current_node", "step_count", "max_steps", "trace", "binding", "result", "auth_tag"], "execution state");
  assert(state.schema === EXECUTION_SCHEMA && state.version === 1, "execution identity is invalid");
  assert(state.graph_id === graph.graph_id, "execution graph identity differs");
  assert(authority && typeof authority.verify === "function" && typeof authority.seal === "function", "execution authority is required");
  authority.verify(state, graph);
  assert(state.status === "ACTIVE", `execution is not active: ${state.status}`);
  assert(ANSWERS.includes(answer), "answer must be explicit");
  assert(state.step_count < state.max_steps, "execution step limit reached");
  validateIdentity(state.binding, "execution binding");

  const gate = findGate(graph, state.current_node);
  validateEvidenceBundle(evidence, gate, graph, state.binding, answer);
  const target = gate.transitions[answer];
  const trace = [...state.trace, {step: state.step_count + 1, gate_id: gate.id, answer, target}];
  if (graph.nodes.some((node) => node.id === target)) {
    return authority.seal({...state, current_node: target, step_count: state.step_count + 1, trace, auth_tag: null});
  }
  const terminal = findTerminal(graph, target);
  const next = {
    ...state,
    status: terminal.type,
    current_node: null,
    step_count: state.step_count + 1,
    trace,
    result: {terminal_id: terminal.id, terminal_type: terminal.type, message: terminal.message},
    auth_tag: null,
  };
  authority.finish(state.execution_id, graph, state.binding);
  return authority.seal(next);
}

export function replay(graph, binding, answers, evidenceFor, authority) {
  let state = createExecution(graph, binding, {authority});
  for (const answer of answers) {
    assert(state.status === "ACTIVE", "replay contains answers after termination");
    const gate = findGate(graph, state.current_node);
    state = answerCurrent(state, graph, answer, evidenceFor(gate, answer), {authority});
  }
  return state;
}
