#!/usr/bin/env node

/* Small finite-state model checker for release and migration custody. */

import {
  assert,
  assertPortableRecord,
  compareUtf8,
  digestWithout,
  exactKeys,
  privacySummary,
  requireBoolean,
  requireIdentifier,
  requireSha,
  requireUtc,
  sortedUnique,
} from "./release-common.mjs";

export const MODEL_CHECK_SCHEMA = "agentos.release_model_check.v1";
export const RECOVERY_ACTIONS = Object.freeze(["RECONCILE", "ROLLBACK", "RECOVER"]);

const MODEL_FIELDS = [
  "schema", "version", "status", "subject_candidate_sha256", "initial_state_id", "states", "transitions",
  "terminal_state_ids", "checks", "independent_checker_sha256", "checked_at_utc", "privacy", "model_sha256",
];
const STATE_FIELDS = ["state_id", "terminal", "owner_controlled", "requires_recovery", "activation"];
const TRANSITION_FIELDS = ["transition_id", "from_state_id", "to_state_id", "action", "requires_owner", "protected_action", "evidence_sha256"];
const CHECK_NAMES = ["reachability", "termination", "bypass_resistance", "recovery", "owner_control"];
const CHECK_FIELDS = {
  reachability: ["pass", "unreachable_state_ids"],
  termination: ["pass", "nonterminating_state_ids", "livelock_state_ids"],
  bypass_resistance: ["pass", "violating_transition_ids"],
  recovery: ["pass", "missing_recovery_state_ids"],
  owner_control: ["pass", "violating_transition_ids"],
};

function sortStates(states) {
  return [...states].sort((left, right) => compareUtf8(left.state_id, right.state_id));
}

function sortTransitions(transitions) {
  return [...transitions].sort((left, right) => compareUtf8(left.transition_id, right.transition_id));
}

function validateState(state, index) {
  exactKeys(state, STATE_FIELDS, `model state ${index}`);
  requireIdentifier(state.state_id, `model state ${index} ID`);
  requireBoolean(state.terminal, `model state ${index} terminal`);
  requireBoolean(state.owner_controlled, `model state ${index} owner_controlled`);
  requireBoolean(state.requires_recovery, `model state ${index} requires_recovery`);
  requireBoolean(state.activation, `model state ${index} activation`);
  assert(state.activation === false, `model state ${index} cannot activate a release`);
  return state;
}

function validateTransition(transition, index) {
  exactKeys(transition, TRANSITION_FIELDS, `model transition ${index}`);
  requireIdentifier(transition.transition_id, `model transition ${index} ID`);
  requireIdentifier(transition.from_state_id, `model transition ${index} source`);
  requireIdentifier(transition.to_state_id, `model transition ${index} target`);
  requireIdentifier(transition.action, `model transition ${index} action`);
  requireBoolean(transition.requires_owner, `model transition ${index} requires_owner`);
  requireBoolean(transition.protected_action, `model transition ${index} protected_action`);
  requireSha(transition.evidence_sha256, `model transition ${index} evidence`);
  return transition;
}

function adjacency(states, transitions) {
  const next = new Map(states.map((state) => [state.state_id, []]));
  const previous = new Map(states.map((state) => [state.state_id, []]));
  for (const transition of transitions) {
    next.get(transition.from_state_id).push(transition.to_state_id);
    previous.get(transition.to_state_id).push(transition.from_state_id);
  }
  return {next, previous};
}

function traverse(start, edges) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const target of edges.get(current) ?? []) if (!seen.has(target)) queue.push(target);
  }
  return seen;
}

function findCycleNodes(states, next) {
  const color = new Map(states.map((state) => [state.state_id, 0]));
  const stack = [];
  const cycleNodes = new Set();
  function visit(node) {
    color.set(node, 1);
    stack.push(node);
    for (const target of next.get(node) ?? []) {
      if (color.get(target) === 0) visit(target);
      else if (color.get(target) === 1) {
        const start = stack.lastIndexOf(target);
        for (const member of stack.slice(start)) cycleNodes.add(member);
      }
    }
    stack.pop();
    color.set(node, 2);
  }
  for (const state of states) if (color.get(state.state_id) === 0) visit(state.state_id);
  return [...cycleNodes].sort(compareUtf8);
}

function compileChecks({states, transitions, initialStateId, terminalStateIds}) {
  const {next, previous} = adjacency(states, transitions);
  const reachable = traverse([initialStateId], next);
  const canReachTerminal = traverse(terminalStateIds, previous);
  const nonterminating = states.map((state) => state.state_id).filter((id) => reachable.has(id) && !canReachTerminal.has(id)).sort(compareUtf8);
  const livelock = findCycleNodes(states.filter((state) => reachable.has(state.state_id) && !state.terminal), next);
  const violatingBypass = transitions.filter((transition) => transition.protected_action && !transition.requires_owner || transition.action === "ACTIVATE").map((transition) => transition.transition_id).sort(compareUtf8);
  const stateById = new Map(states.map((state) => [state.state_id, state]));
  const missingRecovery = states.filter((state) => state.requires_recovery && !(next.get(state.state_id) ?? []).some((target) => transitions.some((transition) => transition.from_state_id === state.state_id && transition.to_state_id === target && RECOVERY_ACTIONS.includes(transition.action)))).map((state) => state.state_id).sort(compareUtf8);
  const violatingOwner = transitions.filter((transition) => {
    const target = stateById.get(transition.to_state_id);
    return (transition.protected_action || target.owner_controlled) && !transition.requires_owner;
  }).map((transition) => transition.transition_id).sort(compareUtf8);
  return {
    reachability: {pass: reachable.size === states.length, unreachable_state_ids: states.map((state) => state.state_id).filter((id) => !reachable.has(id)).sort(compareUtf8)},
    termination: {pass: nonterminating.length === 0 && livelock.length === 0, nonterminating_state_ids: nonterminating, livelock_state_ids: livelock},
    bypass_resistance: {pass: violatingBypass.length === 0, violating_transition_ids: violatingBypass},
    recovery: {pass: missingRecovery.length === 0, missing_recovery_state_ids: missingRecovery},
    owner_control: {pass: violatingOwner.length === 0, violating_transition_ids: violatingOwner},
  };
}

function validateCheck(name, check) {
  exactKeys(check, CHECK_FIELDS[name], `${name} model check`);
  requireBoolean(check.pass, `${name} model check pass`);
  const listKey = Object.keys(check).find((key) => key.endsWith("_ids"));
  sortedUnique(check[listKey], `${name} model check findings`, {allowEmpty: true});
  return check;
}

export function validateReleaseModelCheck(value) {
  exactKeys(value, MODEL_FIELDS, "release model check");
  assert(value.schema === MODEL_CHECK_SCHEMA && value.version === 1, "release model check identity is invalid");
  assert(["PASS", "BLOCKED"].includes(value.status), "release model check status is invalid");
  requireSha(value.subject_candidate_sha256, "model subject candidate");
  requireIdentifier(value.initial_state_id, "model initial state");
  assert(Array.isArray(value.states) && value.states.length > 0, "model states are required");
  const states = sortStates(value.states);
  assert(JSON.stringify(value.states) === JSON.stringify(states), "model states must be sorted");
  const stateIds = new Set();
  states.forEach((state, index) => {
    validateState(state, index);
    assert(!stateIds.has(state.state_id), "model state IDs must be unique");
    stateIds.add(state.state_id);
  });
  assert(stateIds.has(value.initial_state_id), "model initial state is not declared");
  assert(Array.isArray(value.transitions), "model transitions are required");
  const transitions = sortTransitions(value.transitions);
  assert(JSON.stringify(value.transitions) === JSON.stringify(transitions), "model transitions must be sorted");
  const transitionIds = new Set();
  transitions.forEach((transition, index) => {
    validateTransition(transition, index);
    assert(!transitionIds.has(transition.transition_id), "model transition IDs must be unique");
    assert(stateIds.has(transition.from_state_id) && stateIds.has(transition.to_state_id), "model transition references an unknown state");
    transitionIds.add(transition.transition_id);
  });
  for (const transition of transitions) assert(!states.find((state) => state.state_id === transition.from_state_id)?.terminal, "terminal model state cannot have an outgoing transition");
  for (const state of states) assert(!(state.terminal && state.requires_recovery), "terminal model state cannot require recovery");
  const terminalIds = states.filter((state) => state.terminal).map((state) => state.state_id);
  sortedUnique(value.terminal_state_ids, "model terminal state IDs");
  assert(JSON.stringify(value.terminal_state_ids) === JSON.stringify([...terminalIds].sort(compareUtf8)), "model terminal state list is stale");
  exactKeys(value.checks, CHECK_NAMES, "release model checks");
  for (const name of CHECK_NAMES) validateCheck(name, value.checks[name]);
  const expectedStatus = CHECK_NAMES.every((name) => value.checks[name].pass) ? "PASS" : "BLOCKED";
  assert(value.status === expectedStatus, "release model check status does not match checks");
  requireSha(value.independent_checker_sha256, "model independent checker");
  requireUtc(value.checked_at_utc, "model check time");
  exactKeys(value.privacy, ["safe", "categories"], "model privacy");
  assert(value.privacy.safe === true, "model privacy check failed");
  for (const category of Object.keys(value.privacy.categories)) assert(value.privacy.categories[category] === 0, `model privacy category is nonzero: ${category}`);
  requireSha(value.model_sha256, "model check digest");
  assert(value.model_sha256 === digestWithout(value, "model_sha256"), "model check digest does not match content");
  assertPortableRecord(value, "release model check");
  return value;
}

export function compileReleaseModelCheck({subjectCandidateSha256, initialStateId, states, transitions, independentCheckerSha256, checkedAtUtc} = {}) {
  requireSha(subjectCandidateSha256, "model subject candidate");
  requireIdentifier(initialStateId, "model initial state");
  requireSha(independentCheckerSha256, "model independent checker");
  requireUtc(checkedAtUtc, "model check time");
  assert(Array.isArray(states) && states.length > 0, "model states are required");
  assert(Array.isArray(transitions), "model transitions are required");
  const orderedStates = sortStates(states.map((state) => ({...state})));
  const orderedTransitions = sortTransitions(transitions.map((transition) => ({...transition})));
  orderedStates.forEach((state, index) => validateState(state, index));
  const stateIds = new Set(orderedStates.map((state) => state.state_id));
  assert(stateIds.has(initialStateId), "model initial state is not declared");
  orderedTransitions.forEach((transition, index) => {
    validateTransition(transition, index);
    assert(stateIds.has(transition.from_state_id) && stateIds.has(transition.to_state_id), "model transition references an unknown state");
  });
  const terminalStateIds = orderedStates.filter((state) => state.terminal).map((state) => state.state_id).sort(compareUtf8);
  const checks = compileChecks({states: orderedStates, transitions: orderedTransitions, initialStateId, terminalStateIds});
  const value = {
    schema: MODEL_CHECK_SCHEMA,
    version: 1,
    status: CHECK_NAMES.every((name) => checks[name].pass) ? "PASS" : "BLOCKED",
    subject_candidate_sha256: subjectCandidateSha256,
    initial_state_id: initialStateId,
    states: orderedStates,
    transitions: orderedTransitions,
    terminal_state_ids: terminalStateIds,
    checks,
    independent_checker_sha256: independentCheckerSha256,
    checked_at_utc: checkedAtUtc,
    privacy: privacySummary({
      schema: MODEL_CHECK_SCHEMA,
      version: 1,
      subject_candidate_sha256: subjectCandidateSha256,
      initial_state_id: initialStateId,
      states: orderedStates,
      transitions: orderedTransitions,
      terminal_state_ids: terminalStateIds,
      checks,
      independent_checker_sha256: independentCheckerSha256,
      checked_at_utc: checkedAtUtc,
    }),
    model_sha256: null,
  };
  value.model_sha256 = digestWithout(value, "model_sha256");
  return validateReleaseModelCheck(value);
}

export function requireReleaseModelPass(value) {
  validateReleaseModelCheck(value);
  assert(value.status === "PASS", "release model check is not passing");
  return value;
}
