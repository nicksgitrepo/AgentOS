import crypto from "node:crypto";
import {assert, canonicalJson, sha256} from "./canonical-json.mjs";
import {validateEvidence, validateIdentity} from "./evidence.mjs";
import {ANSWERS, findGate, findTerminal, validateGateGraph} from "./gate-model.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

export const EXECUTION_SCHEMA = "agentos.gate_execution.v1";

function repairKey(from, answer, to) {
  return `${from}\u0000${answer}\u0000${to}`;
}

function repairFor(graph, from, answer, to) {
  return (graph.repair_edges ?? []).find((edge) => edge.from === from && edge.answer === answer && edge.to === to) ?? null;
}

export function createExecutionAuthority(secret) {
  assert(typeof secret === "string" && secret.length >= 32, "execution authority secret is required");
  const active = new Set();
  const closed = new Set();
  const currentTags = new Map();
  const keyFor = (graph, binding) => sha256({graph_digest: graph.digest, binding});
  const keyForState = (state) => sha256({graph_digest: state.graph_digest, binding: state.binding});
  const tag = (state) => crypto.createHmac("sha256", secret).update(canonicalJson({...state, auth_tag: null}), "utf8").digest("hex");
  return Object.freeze({
    register(graph, binding) {
      const key = keyFor(graph, binding);
      assert(!active.has(key) && !closed.has(key), "execution is already active or permanently closed");
      active.add(key);
      return {execution_id: `EXEC-${key.slice(0, 24)}`, key};
    },
    seal(state, previous_auth_tag = null) {
      const key = keyForState(state);
      assert(active.has(key), "execution is not active");
      if (currentTags.has(key)) assert(previous_auth_tag === currentTags.get(key), "cannot seal stale execution state");
      else assert(state.auth_tag === null, "new execution state must not carry an auth tag");
      const sealed = {...state, auth_tag: tag(state)};
      currentTags.set(key, sealed.auth_tag);
      return sealed;
    },
    verify(state, graph) {
      assert(typeof state.auth_tag === "string" && state.auth_tag === tag(state), "execution state authentication failed");
      assert(state.graph_digest === graph.digest, "execution graph digest differs");
      const key = keyFor(graph, state.binding);
      assert(active.has(key), "execution state is no longer active");
      assert(currentTags.get(key) === state.auth_tag, "execution state is stale");
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

function validateEvidenceBundle(bundle, gate, graph, binding, answer, attestation_secret) {
  assert(bundle && typeof bundle === "object" && !Array.isArray(bundle), `${gate.id} evidence must be an object`);
  const expected = [...gate.evidence].sort();
  assert(JSON.stringify(Object.keys(bundle).sort()) === JSON.stringify(expected), `${gate.id} evidence fields mismatch`);
  for (const key of gate.evidence) validateEvidence(bundle[key], {
    question_id: gate.id,
    graph_digest: graph.digest,
    evidence_slot: key,
    answer,
    binding,
    attestation_secret,
  }, `${gate.id}.${key}`);
}

export function createExecution(graph, binding, {maxSteps = 128, authority} = {}) {
  validateGateGraph(graph);
  validateIdentity(binding, "execution binding");
  assert(authority && typeof authority.register === "function" && typeof authority.seal === "function", "execution authority is required");
  assert(Number.isInteger(maxSteps) && maxSteps > 0, "maxSteps must be positive");
  const execution = authority.register(graph, binding);
  const state = authority.seal({
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
    repair_visits: {},
    binding: {...binding},
    result: null,
    auth_tag: null,
  });
  assertPortableRecord(state, "gate execution");
  return state;
}

export function answerCurrent(state, graph, answer, evidence, {authority, attestation_secret} = {}) {
  validateGateGraph(graph);
  exactKeys(state, ["schema", "version", "graph_id", "graph_digest", "execution_id", "status", "current_node", "step_count", "max_steps", "trace", "repair_visits", "binding", "result", "auth_tag"], "execution state");
  assert(state.schema === EXECUTION_SCHEMA && state.version === 1, "execution identity is invalid");
  assert(state.graph_id === graph.graph_id, "execution graph identity differs");
  assert(authority && typeof authority.verify === "function" && typeof authority.seal === "function", "execution authority is required");
  authority.verify(state, graph);
  assert(state.status === "ACTIVE", `execution is not active: ${state.status}`);
  assert(ANSWERS.includes(answer), "answer must be explicit");
  assert(state.step_count < state.max_steps, "execution step limit reached");
  validateIdentity(state.binding, "execution binding");

  const gate = findGate(graph, state.current_node);
  validateEvidenceBundle(evidence, gate, graph, state.binding, answer, attestation_secret);
  const target = gate.transitions[answer];
  const repair = repairFor(graph, gate.id, answer, target);
  const repairVisits = {...state.repair_visits};
  if (repair) repairVisits[repairKey(gate.id, answer, target)] = (repairVisits[repairKey(gate.id, answer, target)] ?? 0) + 1;
  const trace = [...state.trace, {
    step: state.step_count + 1,
    gate_id: gate.id,
    answer,
    target,
    ...(repair ? {repair_visit: repairVisits[repairKey(gate.id, answer, target)], repair_limit: repair.max_visits} : {}),
  }];
  if (repair && repairVisits[repairKey(gate.id, answer, target)] > repair.max_visits) {
    const terminal = findTerminal(graph, graph.repair_limit_terminal);
    const next = {
      ...state,
      status: terminal.type,
      current_node: null,
      step_count: state.step_count + 1,
      trace,
      repair_visits: repairVisits,
      result: {terminal_id: terminal.id, terminal_type: terminal.type, message: terminal.message},
      auth_tag: null,
    };
    const sealed = authority.seal(next, state.auth_tag);
    authority.finish(state.execution_id, graph, state.binding);
    assertPortableRecord(sealed, "gate execution");
    return sealed;
  }
  if (graph.nodes.some((node) => node.id === target)) {
    const sealed = authority.seal({...state, current_node: target, step_count: state.step_count + 1, trace, repair_visits: repairVisits, auth_tag: null}, state.auth_tag);
    assertPortableRecord(sealed, "gate execution");
    return sealed;
  }
  const terminal = findTerminal(graph, target);
  const next = {
    ...state,
    status: terminal.type,
    current_node: null,
    step_count: state.step_count + 1,
    trace,
    repair_visits: repairVisits,
    result: {terminal_id: terminal.id, terminal_type: terminal.type, message: terminal.message},
    auth_tag: null,
  };
  const sealed = authority.seal(next, state.auth_tag);
  authority.finish(state.execution_id, graph, state.binding);
  assertPortableRecord(sealed, "gate execution");
  return sealed;
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
