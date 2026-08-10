#!/usr/bin/env node

import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_VERSION,
  REQUIRED_WORKER_PROHIBITIONS,
  assert,
  assertNonActivating,
  assertPortableRecord,
  clone,
  exactKeys,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireSafeReference,
  requireString,
  uniqueStrings,
  validateConsentDecision,
  validateDigest,
  validateEvidenceRefs,
  validateProvenance,
  validateProtectedActions,
  validateRevocationState,
  validateTimestamp,
  validateWorkerProhibitions,
  withDigest,
} from "./apprenticeship-common.mjs";

export const OBSERVATION_SCHEMA = "agentos.apprenticeship_observation.v1";
export const RECONSTRUCTION_SCHEMA = "agentos.apprenticeship_workflow_reconstruction.v1";
export const GATE_SOURCE_SCHEMA = "agentos.apprenticeship_gate_source.v1";
export const GOVERNANCE_PROPOSAL_SCHEMA = "agentos.apprenticeship_governance_proposal.v1";

export const OBSERVED_RESULT_KINDS = Object.freeze([
  "MEANINGFUL_RESULT",
  "HEARTBEAT_ONLY",
  "WAITING",
  "FAILURE_LIST",
  "TRUE_BLOCKER",
  "SOFT_BOUNDARY_REVIEW",
  "NO_RESULT",
]);
export const OBSERVATION_BASES = Object.freeze(["DIRECT_OBSERVATION", "INFERRED_FROM_OBSERVATION"]);

const FORBIDDEN_OBSERVATION_KEYS = new Set([
  "reasoning",
  "chain_of_thought",
  "hidden_context",
  "private_context",
  "transcript",
  "prompt",
  "credential",
  "secret",
  "environment_value",
  "session_id",
  "task_id",
]);

function assertNoHiddenKeys(value, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoHiddenKeys(item, `${label}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => {
    assert(!FORBIDDEN_OBSERVATION_KEYS.has(key), `${label} contains forbidden field ${key}`);
    assertNoHiddenKeys(child, `${label}.${key}`);
  });
}

function validateActionRecord(action, index, {allowResultless = true} = {}) {
  exactKeys(action, [
    "sequence",
    "action_id",
    "action",
    "tool_class",
    "observation_basis",
    "scope",
    "preconditions",
    "decision_boundary",
    "result_ref",
    "evidence_refs",
    "source_match",
    "scope_match",
    "observed_at",
  ], `observation action ${index}`);
  assert(Number.isSafeInteger(action.sequence) && action.sequence === index + 1, `observation action ${index} sequence is not contiguous`);
  requireIdentifier(action.action_id, `observation action ${index} ID`);
  requireString(action.action, `observation action ${index} description`);
  requireString(action.tool_class, `observation action ${index} tool class`);
  assert(OBSERVATION_BASES.includes(action.observation_basis), `observation action ${index} observation basis is invalid`);
  nonEmptyArray(action.scope, `observation action ${index} scope`);
  uniqueStrings(action.scope, `observation action ${index} scope`);
  action.scope.forEach((value) => requireIdentifier(value, `observation action ${index} scope item`));
  uniqueStrings(action.preconditions, `observation action ${index} preconditions`, {allowEmpty: true});
  requireString(action.decision_boundary, `observation action ${index} decision boundary`);
  if (action.result_ref === null) assert(allowResultless, `observation action ${index} result reference is required`);
  else requireSafeReference(action.result_ref, `observation action ${index} result reference`);
  validateEvidenceRefs(action.evidence_refs, `observation action ${index} evidence`, {allowEmpty: true});
  assert(typeof action.source_match === "boolean", `observation action ${index} source match is invalid`);
  assert(typeof action.scope_match === "boolean", `observation action ${index} scope match is invalid`);
  validateTimestamp(action.observed_at, `observation action ${index} timestamp`);
  assertPortableRecord(action, `observation action ${index}`);
}

function validateTypedHandoff(value, label = "typed handoff") {
  exactKeys(value, ["status", "next_action", "evidence_refs", "uncertainty", "protected_actions"], label);
  requireIdentifier(value.status, `${label} status`);
  requireString(value.next_action, `${label} next action`);
  validateEvidenceRefs(value.evidence_refs, `${label} evidence`);
  uniqueStrings(value.uncertainty, `${label} uncertainty`, {allowEmpty: true});
  validateProtectedActions(value.protected_actions, `${label} protected actions`);
  assertPortableRecord(value, label);
  return value;
}

export function classifyTaskResult({
  resultKind,
  evidenceRefs,
  typedHandoff,
  sourceMatch,
  scopeMatch,
} = {}) {
  assert(OBSERVED_RESULT_KINDS.includes(resultKind), `unknown observed result kind ${resultKind}`);
  validateEvidenceRefs(evidenceRefs, "task result evidence", {allowEmpty: true});
  if (typedHandoff !== null) validateTypedHandoff(typedHandoff);
  if (resultKind !== "MEANINGFUL_RESULT") return {meaningful: false, reason: resultKind};
  if (sourceMatch !== true) return {meaningful: false, reason: "SOURCE_BINDING_MISMATCH"};
  if (scopeMatch !== true) return {meaningful: false, reason: "SCOPE_BINDING_MISMATCH"};
  if (evidenceRefs.length === 0) return {meaningful: false, reason: "NO_RESULT_EVIDENCE"};
  if (typedHandoff === null) return {meaningful: false, reason: "NO_TYPED_HANDOFF"};
  return {meaningful: true, reason: "SOURCE_BOUND_TYPED_RESULT"};
}

export function compileTaskObservation({
  observationId,
  provenance,
  taskPattern,
  boundedScope,
  actionRecords,
  resultKind,
  resultRef,
  resultSummary,
  evidenceRefs,
  typedHandoff = null,
  sourceMatch,
  scopeMatch,
  consentRequired = false,
  consentRef = null,
  observedAt,
  completedAt,
} = {}) {
  requireIdentifier(observationId, "observation ID");
  validateProvenance(provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "model_ref"]});
  requireString(taskPattern, "task pattern");
  nonEmptyArray(boundedScope, "bounded scope");
  uniqueStrings(boundedScope, "bounded scope");
  boundedScope.forEach((value) => requireIdentifier(value, "bounded scope item"));
  nonEmptyArray(actionRecords, "observation action records");
  actionRecords.forEach((action, index) => validateActionRecord(action, index));
  assert(OBSERVED_RESULT_KINDS.includes(resultKind), `unknown observed result kind ${resultKind}`);
  requireSafeReference(resultRef, "observation result reference");
  requireString(resultSummary, "observation result summary");
  validateEvidenceRefs(evidenceRefs, "observation evidence", {allowEmpty: true});
  if (typedHandoff !== null) validateTypedHandoff(typedHandoff);
  assert(typeof sourceMatch === "boolean", "observation source match is invalid");
  assert(typeof scopeMatch === "boolean", "observation scope match is invalid");
  const consent = {
    required: consentRequired,
    recorded: consentRequired,
    reference: consentRef,
  };
  validateConsentDecision(consent, "observation consent decision");
  validateTimestamp(observedAt, "observation timestamp");
  validateTimestamp(completedAt, "observation completion timestamp");

  const classification = classifyTaskResult({resultKind, evidenceRefs, typedHandoff, sourceMatch, scopeMatch});
  const observation = withDigest({
    schema: OBSERVATION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    observation_id: observationId,
    status: classification.meaningful ? "REAL_RESULT_OBSERVED" : "NO_MEANINGFUL_RESULT",
    meaningful_progress: classification.meaningful,
    classification_reason: classification.reason,
    provenance: clone(provenance),
    task_pattern: taskPattern,
    bounded_scope: [...boundedScope],
    action_records: clone(actionRecords),
    result_kind: resultKind,
    result_ref: resultRef,
    result_summary: resultSummary,
    evidence_refs: [...evidenceRefs],
    typed_handoff: typedHandoff === null ? null : clone(typedHandoff),
    source_match: sourceMatch,
    scope_match: scopeMatch,
    consent,
    observed_at: observedAt,
    completed_at: completedAt,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateTaskObservation(observation);
  return observation;
}

export function validateTaskObservation(observation) {
  exactKeys(observation, [
    "schema",
    "version",
    "mode",
    "observation_id",
    "status",
    "meaningful_progress",
    "classification_reason",
    "provenance",
    "task_pattern",
    "bounded_scope",
    "action_records",
    "result_kind",
    "result_ref",
    "result_summary",
    "evidence_refs",
    "typed_handoff",
    "source_match",
    "scope_match",
    "consent",
    "observed_at",
    "completed_at",
    "protected_actions",
    "digest",
  ], "task observation");
  assert(observation.schema === OBSERVATION_SCHEMA && observation.version === APPRENTICESHIP_VERSION, "task observation identity is invalid");
  assert(observation.mode === APPRENTICESHIP_MODE, "task observation mode is invalid");
  requireIdentifier(observation.observation_id, "observation ID");
  assert(["REAL_RESULT_OBSERVED", "NO_MEANINGFUL_RESULT"].includes(observation.status), "task observation status is invalid");
  assert(typeof observation.meaningful_progress === "boolean", "task observation progress flag is invalid");
  requireIdentifier(observation.classification_reason, "observation classification reason");
  validateProvenance(observation.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "model_ref"]});
  requireString(observation.task_pattern, "task pattern");
  nonEmptyArray(observation.bounded_scope, "bounded scope");
  uniqueStrings(observation.bounded_scope, "bounded scope");
  observation.bounded_scope.forEach((value) => requireIdentifier(value, "bounded scope item"));
  nonEmptyArray(observation.action_records, "observation action records");
  observation.action_records.forEach((action, index) => validateActionRecord(action, index));
  assert(OBSERVED_RESULT_KINDS.includes(observation.result_kind), "observation result kind is invalid");
  requireSafeReference(observation.result_ref, "observation result reference");
  requireString(observation.result_summary, "observation result summary");
  validateEvidenceRefs(observation.evidence_refs, "observation evidence", {allowEmpty: true});
  if (observation.typed_handoff !== null) validateTypedHandoff(observation.typed_handoff);
  assert(typeof observation.source_match === "boolean" && typeof observation.scope_match === "boolean", "observation binding flags are invalid");
  validateConsentDecision(observation.consent, "observation consent decision");
  validateTimestamp(observation.observed_at, "observation timestamp");
  validateTimestamp(observation.completed_at, "observation completion timestamp");
  validateProtectedActions(observation.protected_actions);
  const expected = classifyTaskResult({
    resultKind: observation.result_kind,
    evidenceRefs: observation.evidence_refs,
    typedHandoff: observation.typed_handoff,
    sourceMatch: observation.source_match,
    scopeMatch: observation.scope_match,
  });
  assert(observation.meaningful_progress === expected.meaningful, "observation meaningful-progress classification is inconsistent");
  assert(observation.status === (expected.meaningful ? "REAL_RESULT_OBSERVED" : "NO_MEANINGFUL_RESULT"), "observation status is inconsistent with classification");
  assert(observation.classification_reason === expected.reason, "observation classification reason is inconsistent");
  assertNonActivating(observation, "task observation");
  assertNoHiddenKeys(observation, "task observation");
  assertPortableRecord(observation, "task observation");
  validateDigest(observation, "task observation");
  return observation;
}

export function reconstructWorkflow(observation, {doneWhen, failurePaths = []} = {}) {
  validateTaskObservation(observation);
  assert(observation.meaningful_progress === true, "workflow reconstruction requires a real meaningful result");
  requireString(doneWhen, "workflow DONE WHEN");
  uniqueStrings(failurePaths, "workflow failure paths", {allowEmpty: true});
  const steps = observation.action_records.map((action) => ({
    step_id: `STEP-${String(action.sequence).padStart(3, "0")}`,
    sequence: action.sequence,
    preconditions: [...action.preconditions],
    observable_action: action.action,
    tool_class: action.tool_class,
    observation_basis: action.observation_basis,
    decision_boundary: action.decision_boundary,
    required_evidence_refs: [...action.evidence_refs],
    source_evidence_refs: [...observation.evidence_refs],
    failure_route: failurePaths[action.sequence - 1] ?? "ROUTE_TO_WORKFLOW_AUDITOR",
    uncertainty: "OBSERVED",
  }));
  const reconstruction = withDigest({
    schema: RECONSTRUCTION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    status: "PROPOSED",
    observation_digest: observation.digest,
    provenance: clone(observation.provenance),
    task_pattern: observation.task_pattern,
    bounded_scope: [...observation.bounded_scope],
    consent: clone(observation.consent),
    steps,
    result_contract: {
      done_when: doneWhen,
      required_evidence_refs: [...observation.evidence_refs],
      result_ref: observation.result_ref,
    },
    failure_paths: [...failurePaths],
    privacy_boundary: {
      observable_actions_only: true,
      hidden_reasoning_excluded: true,
      private_context_excluded: true,
      unrelated_project_context_excluded: true,
    },
    protected_actions: protectedActions(),
    digest: null,
  });
  validateWorkflowReconstruction(reconstruction, {observation});
  return reconstruction;
}

function validateReconstructionStep(step, index) {
  exactKeys(step, [
    "step_id",
    "sequence",
    "preconditions",
    "observable_action",
    "tool_class",
    "observation_basis",
    "decision_boundary",
    "required_evidence_refs",
    "source_evidence_refs",
    "failure_route",
    "uncertainty",
  ], `workflow step ${index}`);
  requireIdentifier(step.step_id, `workflow step ${index} ID`);
  assert(Number.isSafeInteger(step.sequence) && step.sequence === index + 1, `workflow step ${index} sequence is invalid`);
  uniqueStrings(step.preconditions, `workflow step ${index} preconditions`, {allowEmpty: true});
  requireString(step.observable_action, `workflow step ${index} action`);
  requireString(step.tool_class, `workflow step ${index} tool class`);
  assert(OBSERVATION_BASES.includes(step.observation_basis), `workflow step ${index} observation basis is invalid`);
  requireString(step.decision_boundary, `workflow step ${index} decision boundary`);
  validateEvidenceRefs(step.required_evidence_refs, `workflow step ${index} required evidence`, {allowEmpty: true});
  validateEvidenceRefs(step.source_evidence_refs, `workflow step ${index} source evidence`);
  requireString(step.failure_route, `workflow step ${index} failure route`);
  requireIdentifier(step.uncertainty, `workflow step ${index} uncertainty`);
  assertPortableRecord(step, `workflow step ${index}`);
}

export function validateWorkflowReconstruction(reconstruction, {observation = null} = {}) {
  exactKeys(reconstruction, [
    "schema",
    "version",
    "status",
    "observation_digest",
    "provenance",
    "task_pattern",
    "bounded_scope",
    "consent",
    "steps",
    "result_contract",
    "failure_paths",
    "privacy_boundary",
    "protected_actions",
    "digest",
  ], "workflow reconstruction");
  assert(reconstruction.schema === RECONSTRUCTION_SCHEMA && reconstruction.version === APPRENTICESHIP_VERSION, "workflow reconstruction identity is invalid");
  assert(reconstruction.status === "PROPOSED", "workflow reconstruction must remain proposed");
  requireSafeReference(`sha256:${reconstruction.observation_digest}`, "workflow observation digest reference");
  if (observation !== null) assert(reconstruction.observation_digest === observation.digest, "workflow reconstruction observation binding differs");
  validateProvenance(reconstruction.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "model_ref"]});
  requireString(reconstruction.task_pattern, "workflow task pattern");
  nonEmptyArray(reconstruction.bounded_scope, "workflow bounded scope");
  uniqueStrings(reconstruction.bounded_scope, "workflow bounded scope");
  validateConsentDecision(reconstruction.consent, "workflow reconstruction consent decision");
  nonEmptyArray(reconstruction.steps, "workflow steps");
  reconstruction.steps.forEach(validateReconstructionStep);
  exactKeys(reconstruction.result_contract, ["done_when", "required_evidence_refs", "result_ref"], "workflow result contract");
  requireString(reconstruction.result_contract.done_when, "workflow DONE WHEN");
  validateEvidenceRefs(reconstruction.result_contract.required_evidence_refs, "workflow result evidence");
  requireSafeReference(reconstruction.result_contract.result_ref, "workflow result reference");
  uniqueStrings(reconstruction.failure_paths, "workflow failure paths", {allowEmpty: true});
  exactKeys(reconstruction.privacy_boundary, [
    "observable_actions_only",
    "hidden_reasoning_excluded",
    "private_context_excluded",
    "unrelated_project_context_excluded",
  ], "workflow privacy boundary");
  Object.values(reconstruction.privacy_boundary).forEach((value) => assert(value === true, "workflow privacy boundary must exclude hidden context"));
  validateProtectedActions(reconstruction.protected_actions);
  assertNonActivating(reconstruction, "workflow reconstruction");
  assertNoHiddenKeys(reconstruction, "workflow reconstruction");
  assertPortableRecord(reconstruction, "workflow reconstruction");
  validateDigest(reconstruction, "workflow reconstruction");
  return reconstruction;
}

function validateGate(gate, index) {
  exactKeys(gate, [
    "line_number",
    "gate_id",
    "name",
    "question",
    "allowed_answers",
    "required_evidence",
    "next_branch",
    "repair_recovery_branch",
    "terminal_state",
  ], `gate ${index}`);
  assert(Number.isSafeInteger(gate.line_number) && gate.line_number === index + 1, `gate ${index} line number is invalid`);
  requireIdentifier(gate.gate_id, `gate ${index} ID`);
  requireString(gate.name, `gate ${index} name`);
  requireString(gate.question, `gate ${index} question`);
  uniqueStrings(gate.allowed_answers, `gate ${index} allowed answers`);
  uniqueStrings(gate.required_evidence, `gate ${index} required evidence`);
  exactKeys(gate.next_branch, gate.allowed_answers, `gate ${index} branches`);
  gate.allowed_answers.forEach((answer) => requireString(gate.next_branch[answer], `gate ${index} branch ${answer}`));
  requireString(gate.repair_recovery_branch, `gate ${index} repair branch`);
  requireIdentifier(gate.terminal_state, `gate ${index} terminal state`);
  assert(!["PASS", "ACCEPTED", "ACTIVATED"].includes(gate.terminal_state), `gate ${index} has an activating terminal state`);
  assertPortableRecord(gate, `gate ${index}`);
}

export function compileGateSource({sourceId, reconstruction, gates} = {}) {
  requireIdentifier(sourceId, "gate source ID");
  validateWorkflowReconstruction(reconstruction);
  nonEmptyArray(gates, "gate source gates");
  gates.forEach(validateGate);
  const gateIds = gates.map((gate) => gate.gate_id);
  assert(new Set(gateIds).size === gateIds.length, "gate source contains duplicate gate IDs");
  const source = withDigest({
    schema: GATE_SOURCE_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    source_id: sourceId,
    status: "PROPOSED",
    reconstruction_digest: reconstruction.digest,
    gates: clone(gates),
    terminal_states: ["DRILL_COMPLETE_NON_ACCEPTING", "UNKNOWN_BLOCKED", "DRILL_INCOMPLETE"],
    activation_allowed: false,
    digest: null,
  });
  validateGateSource(source, {reconstruction});
  return source;
}

export function validateGateSource(source, {reconstruction = null} = {}) {
  exactKeys(source, [
    "schema",
    "version",
    "source_id",
    "status",
    "reconstruction_digest",
    "gates",
    "terminal_states",
    "activation_allowed",
    "digest",
  ], "gate source");
  assert(source.schema === GATE_SOURCE_SCHEMA && source.version === APPRENTICESHIP_VERSION, "gate source identity is invalid");
  requireIdentifier(source.source_id, "gate source ID");
  assert(source.status === "PROPOSED", "gate source must remain proposed");
  requireSha256DigestReference(source.reconstruction_digest, "gate source reconstruction digest");
  if (reconstruction !== null) assert(source.reconstruction_digest === reconstruction.digest, "gate source reconstruction binding differs");
  nonEmptyArray(source.gates, "gate source gates");
  source.gates.forEach(validateGate);
  uniqueStrings(source.terminal_states, "gate source terminal states");
  source.terminal_states.forEach((state) => requireIdentifier(state, "gate source terminal state"));
  assert(source.activation_allowed === false, "gate source cannot allow activation");
  assertNonActivating(source, "gate source");
  assertNoHiddenKeys(source, "gate source");
  assertPortableRecord(source, "gate source");
  validateDigest(source, "gate source");
  return source;
}

function requireSha256DigestReference(value, label) {
  requireString(value, label);
  assert(/^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256 digest`);
  return value;
}

function validateRoleBehavior(value, {boundedScope = null, observedTools = null} = {}) {
  exactKeys(value, [
    "role_id",
    "scope",
    "authority",
    "prohibited_actions",
    "admitted_tools",
    "evidence_requirements",
    "failure_paths",
    "done_when",
  ], "proposed role behavior");
  requireIdentifier(value.role_id, "proposed role ID");
  assert(value.role_id === "APPRENTICESHIP_WORKER", "worker proposals must target the apprenticeship worker role");
  uniqueStrings(value.scope, "proposed role scope");
  if (boundedScope !== null) {
    assert(JSON.stringify([...value.scope].sort()) === JSON.stringify([...boundedScope].sort()), "proposed role scope expands the bounded workflow");
  }
  uniqueStrings(value.authority, "proposed role authority", {allowEmpty: true});
  validateWorkerProhibitions(value.prohibited_actions, "proposed role prohibited actions");
  uniqueStrings(value.admitted_tools, "proposed role admitted tools", {allowEmpty: true});
  if (observedTools !== null) {
    const observed = new Set(observedTools);
    value.admitted_tools.forEach((tool) => assert(observed.has(tool), `proposed role admitted tool ${tool} was not observed`));
  }
  uniqueStrings(value.evidence_requirements, "proposed role evidence requirements");
  uniqueStrings(value.failure_paths, "proposed role failure paths", {allowEmpty: true});
  requireString(value.done_when, "proposed role DONE WHEN");
  REQUIRED_WORKER_PROHIBITIONS.forEach((prohibition) => {
    assert(!value.authority.includes(prohibition), `proposed role authority cannot include ${prohibition}`);
  });
  assertPortableRecord(value, "proposed role behavior");
}

export function compileGovernanceProposal({
  proposalId,
  provenance,
  reconstruction,
  gateSource,
  roleBehavior,
  workerRef,
  orchestratorRef,
  revocable = true,
  revocationStatus = "NOT_REVOKED",
  revocationRef = null,
  createdAt,
} = {}) {
  requireIdentifier(proposalId, "governance proposal ID");
  validateProvenance(provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  validateWorkflowReconstruction(reconstruction);
  validateGateSource(gateSource, {reconstruction});
  validateRoleBehavior(roleBehavior, {
    boundedScope: reconstruction.bounded_scope,
    observedTools: [...new Set(reconstruction.steps.map((step) => step.tool_class))],
  });
  requireSafeReference(workerRef, "proposal worker reference");
  requireSafeReference(orchestratorRef, "proposal Orchestrator reference");
  assert(workerRef === provenance.worker_ref, "proposal worker reference differs from provenance");
  assert(orchestratorRef === provenance.orchestrator_ref, "proposal Orchestrator reference differs from provenance");
  const revocation = {
    revocable,
    status: revocationStatus,
    reference: revocationRef,
  };
  validateRevocationState(revocation, "governance proposal revocation state");
  validateTimestamp(createdAt, "proposal creation timestamp");
  const proposal = withDigest({
    schema: GOVERNANCE_PROPOSAL_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    proposal_id: proposalId,
    status: revocation.status === "REVOKED" ? "REVOKED" : "PROPOSED",
    provenance: clone(provenance),
    author: {
      worker_ref: workerRef,
      role: "APPRENTICESHIP_WORKER",
    },
    compiled_by: {
      orchestrator_ref: orchestratorRef,
      role: "WALKTHROUGH_ORCHESTRATOR",
    },
    reconstruction_digest: reconstruction.digest,
    task_pattern: reconstruction.task_pattern,
    bounded_scope: [...reconstruction.bounded_scope],
    consent: clone(reconstruction.consent),
    observed_tools: [...new Set(reconstruction.steps.map((step) => step.tool_class))].sort(),
    revocation,
    gate_source: clone(gateSource),
    role_behavior: clone(roleBehavior),
    review: {
      independent_review_ref: null,
      status: "PENDING",
    },
    owner_approval: null,
    activation_allowed: false,
    created_at: createdAt,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateGovernanceProposal(proposal, {reconstruction});
  return proposal;
}

export function validateGovernanceProposal(proposal, {reconstruction = null} = {}) {
  exactKeys(proposal, [
    "schema",
    "version",
    "mode",
    "proposal_id",
    "status",
    "provenance",
    "author",
    "compiled_by",
    "reconstruction_digest",
    "task_pattern",
    "bounded_scope",
    "consent",
    "observed_tools",
    "revocation",
    "gate_source",
    "role_behavior",
    "review",
    "owner_approval",
    "activation_allowed",
    "created_at",
    "protected_actions",
    "digest",
  ], "governance proposal");
  assert(proposal.schema === GOVERNANCE_PROPOSAL_SCHEMA && proposal.version === APPRENTICESHIP_VERSION, "governance proposal identity is invalid");
  assert(proposal.mode === APPRENTICESHIP_MODE, "governance proposal mode is invalid");
  requireIdentifier(proposal.proposal_id, "governance proposal ID");
  assert(["PROPOSED", "REVOKED"].includes(proposal.status), "governance proposal status is invalid");
  validateProvenance(proposal.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  exactKeys(proposal.author, ["worker_ref", "role"], "proposal author");
  requireSafeReference(proposal.author.worker_ref, "proposal author worker reference");
  assert(proposal.author.worker_ref === proposal.provenance.worker_ref, "proposal author binding differs");
  assert(proposal.author.role === "APPRENTICESHIP_WORKER", "proposal author role is invalid");
  exactKeys(proposal.compiled_by, ["orchestrator_ref", "role"], "proposal compiler");
  requireSafeReference(proposal.compiled_by.orchestrator_ref, "proposal compiler reference");
  assert(proposal.compiled_by.orchestrator_ref === proposal.provenance.orchestrator_ref, "proposal compiler binding differs");
  assert(proposal.compiled_by.role === "WALKTHROUGH_ORCHESTRATOR", "proposal compiler role is invalid");
  requireSha256DigestReference(proposal.reconstruction_digest, "proposal reconstruction digest");
  requireString(proposal.task_pattern, "proposal task pattern");
  nonEmptyArray(proposal.bounded_scope, "proposal bounded scope");
  uniqueStrings(proposal.bounded_scope, "proposal bounded scope");
  validateConsentDecision(proposal.consent, "proposal consent decision");
  uniqueStrings(proposal.observed_tools, "proposal observed tools");
  validateRevocationState(proposal.revocation, "governance proposal revocation state");
  assert(proposal.status === (proposal.revocation.status === "REVOKED" ? "REVOKED" : "PROPOSED"), "governance proposal revocation/status binding is invalid");
  if (reconstruction !== null) {
    assert(proposal.reconstruction_digest === reconstruction.digest, "proposal reconstruction binding differs");
    assert(proposal.task_pattern === reconstruction.task_pattern, "proposal task pattern binding differs");
    assert(JSON.stringify(proposal.bounded_scope) === JSON.stringify(reconstruction.bounded_scope), "proposal bounded scope binding differs");
    assert(JSON.stringify(proposal.consent) === JSON.stringify(reconstruction.consent), "proposal consent binding differs");
    const observedTools = [...new Set(reconstruction.steps.map((step) => step.tool_class))].sort();
    assert(JSON.stringify(proposal.observed_tools) === JSON.stringify(observedTools), "proposal observed tools binding differs");
  }
  validateGateSource(proposal.gate_source, {reconstruction});
  validateRoleBehavior(proposal.role_behavior, {boundedScope: proposal.bounded_scope, observedTools: proposal.observed_tools});
  exactKeys(proposal.review, ["independent_review_ref", "status"], "proposal review");
  if (proposal.review.independent_review_ref !== null) requireSafeReference(proposal.review.independent_review_ref, "proposal independent review reference");
  assert(proposal.review.status === "PENDING", "proposal review status is invalid before independent review");
  assert(proposal.owner_approval === null || typeof proposal.owner_approval === "object", "proposal owner approval is invalid");
  assert(proposal.activation_allowed === false, "governance proposal cannot allow activation");
  validateTimestamp(proposal.created_at, "proposal creation timestamp");
  validateProtectedActions(proposal.protected_actions);
  assertNonActivating(proposal, "governance proposal");
  assertNoHiddenKeys(proposal, "governance proposal");
  assertPortableRecord(proposal, "governance proposal");
  validateDigest(proposal, "governance proposal");
  return proposal;
}

export function validateGovernanceProposalForUse(proposal) {
  validateGovernanceProposal(proposal);
  assert(proposal.revocation.status === "NOT_REVOKED", "governance proposal is revoked and cannot be used");
  return proposal;
}

export function proposalDigestReference(proposal) {
  validateGovernanceProposal(proposal);
  return `sha256:${proposal.digest}`;
}
