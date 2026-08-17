#!/usr/bin/env node

/*
 * Project-agnostic parse-only gate for local harness binding collisions.
 *
 * The gate never executes harness code. It compiles the supplied source in a
 * vm.Script parser, binds the exact syntax evidence, and keeps a collision on
 * a typed repair route until the source is revalidated. Product, provider,
 * credential, protected, and heavyweight capabilities are not part of this
 * contract.
 */

import vm from "node:vm";

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const HARNESS_COLLISION_GATE_SCHEMA = "agentos.harness_collision_gate.v1";
export const HARNESS_COLLISION_GATE_VERSION = 1;
export const HARNESS_COLLISION_REPAIR_ACTION = "REPAIR_BLOCKS";
export const HARNESS_COLLISION_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";
export const HARNESS_COLLISION_DIRECT_CONSUMER = "INDEPENDENT_PLATFORM_REVIEW";
export const HARNESS_COLLISION_DEFECT_CODE = "RETRY_HARNESS_LOCAL_VARIABLE_COLLISION";

export const HARNESS_COLLISION_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.HARNESS.COLLISION.DUPLICATE_BINDING",
  "FIXTURE.HARNESS.COLLISION.MISSING_SOURCE",
  "FIXTURE.HARNESS.COLLISION.OBSERVED_MESSAGE_DRIFT",
  "FIXTURE.HARNESS.COLLISION.PLACEHOLDER_DIGEST",
  "FIXTURE.HARNESS.COLLISION.PROTECTED_SCOPE",
  "FIXTURE.HARNESS.COLLISION.SOURCE_AUTHORITY_DRIFT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const BINDING_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const COLLISION_MESSAGE = /^Identifier '([^']+)' has already been declared$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object id`);
  assert(!/^0+$/u.test(value) && !/^f+$/u.test(value), `${label} may not be a placeholder object id`);
}

function requireBindingName(value, label) {
  assert(typeof value === "string" && BINDING_NAME.test(value), `${label} must be a JavaScript binding name`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be a ref or opaque reference`);
}

function requireText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), `${label} must be non-empty text`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function sourceDigest(sourceText) {
  return canonicalDigest({source_text: sourceText});
}

function parseEvidenceBody(evaluation) {
  const copy = structuredClone(evaluation);
  copy.parse_evidence_sha256 = null;
  return copy;
}

function gateBody(gate) {
  const copy = structuredClone(gate);
  copy.gate_sha256 = null;
  return copy;
}

function observedFailureDigest(observedFailure) {
  return canonicalDigest({
    binding_name: observedFailure.binding_name,
    defect_code: observedFailure.defect_code,
    exact_failure: observedFailure.exact_failure,
  });
}

function validateAuthorityBinding(binding) {
  exactKeys(binding, ["authority_commit", "authority_tree", "authority_receipt_sha256", "source_mapping_sha256"], "Harness collision authority binding");
  requireGitObject(binding.authority_commit, "Harness collision authority commit");
  requireGitObject(binding.authority_tree, "Harness collision authority tree");
  requireSha(binding.authority_receipt_sha256, "Harness collision authority receipt");
  requireSha(binding.source_mapping_sha256, "Harness collision source mapping");
}

function validateSource(source) {
  exactKeys(source, ["source_ref", "source_sha256", "source_content_available", "source_preserved"], "Harness collision source");
  requireReference(source.source_ref, "Harness collision source reference");
  requireSha(source.source_sha256, "Harness collision source digest");
  assert(typeof source.source_content_available === "boolean", "Harness collision source availability must be boolean");
  assert(source.source_preserved === true, "Harness collision source must be preserved");
}

function validateObservedFailure(observedFailure) {
  exactKeys(observedFailure, ["defect_code", "exact_failure", "binding_name", "evidence_sha256"], "Harness collision observed failure");
  requireIdentifier(observedFailure.defect_code, "Harness collision defect code");
  requireText(observedFailure.exact_failure, "Harness collision exact failure");
  if (observedFailure.binding_name !== null) requireBindingName(observedFailure.binding_name, "Harness collision binding name");
  requireSha(observedFailure.evidence_sha256, "Harness collision observed evidence");
  assert(observedFailure.evidence_sha256 === observedFailureDigest(observedFailure), "Harness collision observed evidence digest mismatch");
}

function validateParseEvaluation(evaluation) {
  exactKeys(evaluation, [
    "status", "failure_class", "syntax_error_name", "syntax_error_message", "binding_name", "collision_detected",
    "evidence_complete", "missing_evidence", "parse_evidence_sha256",
  ], "Harness collision parse evaluation");
  assert(["PASS", "FAIL", "UNAVAILABLE"].includes(evaluation.status), "Harness collision parse status is invalid");
  assert(["NONE", "LOCAL_VARIABLE_COLLISION", "OTHER_SYNTAX_ERROR", "SOURCE_UNAVAILABLE"].includes(evaluation.failure_class), "Harness collision failure class is invalid");
  if (evaluation.syntax_error_name !== null) requireBindingName(evaluation.syntax_error_name, "Harness collision syntax error name");
  if (evaluation.syntax_error_message !== null) requireText(evaluation.syntax_error_message, "Harness collision syntax error message");
  if (evaluation.binding_name !== null) requireBindingName(evaluation.binding_name, "Harness collision parse binding name");
  assert(typeof evaluation.collision_detected === "boolean", "Harness collision detection flag must be boolean");
  assert(typeof evaluation.evidence_complete === "boolean", "Harness collision evidence flag must be boolean");
  assert(Array.isArray(evaluation.missing_evidence), "Harness collision missing evidence must be an array");
  evaluation.missing_evidence.forEach((item) => requireIdentifier(item, "Harness collision missing evidence item"));
  sortedUnique(evaluation.missing_evidence.length === 0 ? ["PLACEHOLDER.EMPTY"] : evaluation.missing_evidence, "Harness collision missing evidence");
  requireSha(evaluation.parse_evidence_sha256, "Harness collision parse evidence");
  assert(evaluation.parse_evidence_sha256 === canonicalDigest(parseEvidenceBody(evaluation)), "Harness collision parse evidence digest mismatch");
  if (evaluation.status === "PASS") {
    assert(evaluation.failure_class === "NONE" && evaluation.collision_detected === false, "Harness collision PASS evaluation is inconsistent");
    assert(evaluation.syntax_error_name === null && evaluation.syntax_error_message === null && evaluation.binding_name === null, "Harness collision PASS carries syntax failure evidence");
    assert(evaluation.evidence_complete === true && evaluation.missing_evidence.length === 0, "Harness collision PASS lacks complete evidence");
  }
  if (evaluation.status === "UNAVAILABLE") {
    assert(evaluation.failure_class === "SOURCE_UNAVAILABLE" && evaluation.evidence_complete === false, "Harness collision unavailable evaluation is inconsistent");
    assert(evaluation.missing_evidence.includes("SOURCE_TEXT_OR_PARSE_EVIDENCE"), "Harness collision unavailable evaluation lacks its blocker");
  }
  if (evaluation.collision_detected) {
    assert(evaluation.status === "FAIL" && evaluation.failure_class === "LOCAL_VARIABLE_COLLISION", "Harness collision flag is inconsistent with parse status");
    assert(evaluation.syntax_error_name === "SyntaxError" && evaluation.binding_name !== null, "Harness collision lacks exact SyntaxError binding evidence");
  }
}

function validateRepairBlock(block) {
  exactKeys(block, ["block_id", "classification", "route", "status", "required_evidence", "invalidation_rules", "spawnable"], "Harness collision repair block");
  requireIdentifier(block.block_id, "Harness collision block ID");
  assert(block.classification === "REPAIRABLE_GATE_GAP", "Harness collision block classification is invalid");
  assert(block.route === "COMPILE_BLOCK_PATCH", "Harness collision block route is invalid");
  assert(["CLEAR", "RETRY_REQUIRED"].includes(block.status), "Harness collision block status is invalid");
  sortedUnique(block.required_evidence, "Harness collision required evidence");
  sortedUnique(block.invalidation_rules, "Harness collision invalidation rules");
  assert(block.spawnable === false, "Harness collision block cannot be spawnable");
}

function validateCustody(custody) {
  exactKeys(custody, [
    "control_plane_only", "source_roots_preserved", "product_mutation", "protected_action", "provider_access", "credential_access",
    "external_sync", "spend", "destructive_work", "deployment", "publication", "merge", "spawnable", "worker_admission",
    "wave_activation", "timers", "polling",
  ], "Harness collision custody");
  for (const field of [
    "control_plane_only", "source_roots_preserved", "product_mutation", "protected_action", "provider_access", "credential_access",
    "external_sync", "spend", "destructive_work", "deployment", "publication", "merge", "spawnable", "worker_admission", "polling",
  ]) assert(typeof custody[field] === "boolean", `Harness collision custody ${field} must be boolean`);
  assert(custody.control_plane_only === true && custody.source_roots_preserved === true, "Harness collision custody is not source-preserving");
  assert(custody.product_mutation === false && custody.protected_action === false, "Harness collision crossed a protected/product boundary");
  assert(custody.wave_activation === "OFF" && custody.timers === 0, "Harness collision custody activated a wave or timer");
}

export function inspectHarnessSource(sourceText) {
  if (typeof sourceText !== "string" || sourceText.trim().length === 0) {
    const evaluation = {
      status: "UNAVAILABLE",
      failure_class: "SOURCE_UNAVAILABLE",
      syntax_error_name: null,
      syntax_error_message: null,
      binding_name: null,
      collision_detected: false,
      evidence_complete: false,
      missing_evidence: ["SOURCE_TEXT_OR_PARSE_EVIDENCE"],
      parse_evidence_sha256: null,
    };
    evaluation.parse_evidence_sha256 = canonicalDigest(parseEvidenceBody(evaluation));
    return evaluation;
  }
  try {
    new vm.Script(sourceText, {filename: "agentos-harness-source.mjs"});
    const evaluation = {
      status: "PASS",
      failure_class: "NONE",
      syntax_error_name: null,
      syntax_error_message: null,
      binding_name: null,
      collision_detected: false,
      evidence_complete: true,
      missing_evidence: [],
      parse_evidence_sha256: null,
    };
    evaluation.parse_evidence_sha256 = canonicalDigest(parseEvidenceBody(evaluation));
    return evaluation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const collision = COLLISION_MESSAGE.exec(message);
    const evaluation = {
      status: "FAIL",
      failure_class: collision === null ? "OTHER_SYNTAX_ERROR" : "LOCAL_VARIABLE_COLLISION",
      syntax_error_name: error?.name === "SyntaxError" ? "SyntaxError" : "Error",
      syntax_error_message: message,
      binding_name: collision?.[1] ?? null,
      collision_detected: collision !== null,
      evidence_complete: true,
      missing_evidence: [],
      parse_evidence_sha256: null,
    };
    evaluation.parse_evidence_sha256 = canonicalDigest(parseEvidenceBody(evaluation));
    return evaluation;
  }
}

export function validateHarnessCollisionGate(gate) {
  exactKeys(gate, [
    "schema", "version", "gate_id", "authority_binding", "source", "observed_failure", "parse_evaluation", "repair_block",
    "next_action", "next_handler", "execution_owner", "direct_consumer", "controller_approval_required", "same_turn_dispatch",
    "custody", "hostile_fixture_refs", "status", "gate_sha256",
  ], "Harness collision gate");
  assert(gate.schema === HARNESS_COLLISION_GATE_SCHEMA && gate.version === HARNESS_COLLISION_GATE_VERSION, "Harness collision gate identity is invalid");
  requireIdentifier(gate.gate_id, "Harness collision gate ID");
  validateAuthorityBinding(gate.authority_binding);
  validateSource(gate.source);
  validateObservedFailure(gate.observed_failure);
  validateParseEvaluation(gate.parse_evaluation);
  validateRepairBlock(gate.repair_block);
  requireIdentifier(gate.next_action, "Harness collision next action");
  assert(gate.next_action !== "NONE" && gate.next_action !== "DONE", "Harness collision gate cannot close without a successor");
  requireIdentifier(gate.next_handler, "Harness collision next handler");
  assert(gate.execution_owner === "LANE_AGENT", "Harness collision execution owner is invalid");
  assert(gate.direct_consumer === HARNESS_COLLISION_DIRECT_CONSUMER, "Harness collision direct consumer is invalid");
  assert(gate.controller_approval_required === false, "Harness collision cannot require Controller approval");
  assert(gate.same_turn_dispatch === true, "Harness collision successor must be same-turn dispatchable");
  validateCustody(gate.custody);
  sortedUnique(gate.hostile_fixture_refs, "Harness collision hostile fixtures");
  for (const fixture of HARNESS_COLLISION_HOSTILE_FIXTURE_REFS) assert(gate.hostile_fixture_refs.includes(fixture), `Harness collision hostile fixture is missing: ${fixture}`);
  assert(["CLEAR", "RETRY_REQUIRED"].includes(gate.status), "Harness collision gate status is invalid");
  if (gate.parse_evaluation.collision_detected) {
    assert(gate.status === "RETRY_REQUIRED" && gate.repair_block.status === "RETRY_REQUIRED", "Detected harness collision must remain on retry");
    assert(gate.observed_failure.exact_failure === gate.parse_evaluation.syntax_error_message, "Harness collision observed message drifted");
    assert(gate.observed_failure.binding_name === gate.parse_evaluation.binding_name, "Harness collision binding name drifted");
  }
  if (gate.parse_evaluation.status === "PASS") assert(gate.status === "CLEAR" && gate.repair_block.status === "CLEAR", "Passing harness parse cannot remain ambiguously routed");
  if (gate.parse_evaluation.status === "UNAVAILABLE") assert(gate.status === "RETRY_REQUIRED" && gate.repair_block.status === "RETRY_REQUIRED", "Unavailable harness evidence must fail closed");
  requireSha(gate.gate_sha256, "Harness collision gate digest");
  assert(gate.gate_sha256 === canonicalDigest(gateBody(gate)), "Harness collision gate digest mismatch");
  return gate;
}

export function compileHarnessCollisionGate({
  gateId,
  authorityBinding,
  source,
  observedFailure,
  nextAction = HARNESS_COLLISION_REPAIR_ACTION,
  nextHandler = HARNESS_COLLISION_REPAIR_HANDLER,
  hostileFixtureRefs = HARNESS_COLLISION_HOSTILE_FIXTURE_REFS,
} = {}) {
  requireIdentifier(gateId, "Harness collision gate ID");
  validateAuthorityBinding(authorityBinding);
  assert(isRecord(source), "Harness collision source input is required");
  requireReference(source.sourceRef, "Harness collision source input reference");
  const hasSourceText = typeof source.sourceText === "string" && source.sourceText.trim().length > 0;
  const sourceSha256 = hasSourceText ? sourceDigest(source.sourceText) : source.sourceSha256;
  requireSha(sourceSha256, "Harness collision source input digest");
  assert(isRecord(observedFailure), "Harness collision observed failure input is required");
  const observed = {
    defect_code: observedFailure.defectCode ?? HARNESS_COLLISION_DEFECT_CODE,
    exact_failure: observedFailure.exactFailure,
    binding_name: observedFailure.bindingName ?? null,
    evidence_sha256: null,
  };
  requireText(observed.exact_failure, "Harness collision exact failure input");
  observed.evidence_sha256 = observedFailure.evidenceSha256 ?? observedFailureDigest(observed);
  const parseEvaluation = inspectHarnessSource(hasSourceText ? source.sourceText : null);
  const collisionEvidenceMatches = parseEvaluation.collision_detected
    && observed.exact_failure === parseEvaluation.syntax_error_message
    && observed.binding_name === parseEvaluation.binding_name;
  const status = parseEvaluation.status === "PASS" && !parseEvaluation.collision_detected
    ? "CLEAR"
    : "RETRY_REQUIRED";
  if (parseEvaluation.collision_detected) assert(collisionEvidenceMatches, "Harness collision observed evidence does not match parsed source");
  const gate = {
    schema: HARNESS_COLLISION_GATE_SCHEMA,
    version: HARNESS_COLLISION_GATE_VERSION,
    gate_id: gateId,
    authority_binding: structuredClone(authorityBinding),
    source: {
      source_ref: source.sourceRef,
      source_sha256: sourceSha256,
      source_content_available: hasSourceText,
      source_preserved: true,
    },
    observed_failure: observed,
    parse_evaluation: parseEvaluation,
    repair_block: {
      block_id: "AGENTOS.HARNESS.LOCAL.BINDING.COLLISION",
      classification: "REPAIRABLE_GATE_GAP",
      route: "COMPILE_BLOCK_PATCH",
      status,
      required_evidence: ["EXACT_SYNTAX_ERROR", "REPAIR_VALIDATION", "SOURCE_TEXT_OR_PARSE_EVIDENCE", "UNIQUE_BINDING_NAMESPACE"],
      invalidation_rules: ["AUTHORITY_DIGEST_DRIFT", "OBSERVED_FAILURE_DRIFT", "SOURCE_BYTES_DRIFT", "TAMPERED_GATE_DIGEST", "UNSUPPORTED_SYNTAX_ERROR"],
      spawnable: false,
    },
    next_action: nextAction,
    next_handler: nextHandler,
    execution_owner: "LANE_AGENT",
    direct_consumer: HARNESS_COLLISION_DIRECT_CONSUMER,
    controller_approval_required: false,
    same_turn_dispatch: true,
    custody: {
      control_plane_only: true,
      source_roots_preserved: true,
      product_mutation: false,
      protected_action: false,
      provider_access: false,
      credential_access: false,
      external_sync: false,
      spend: false,
      destructive_work: false,
      deployment: false,
      publication: false,
      merge: false,
      spawnable: false,
      worker_admission: false,
      wave_activation: "OFF",
      timers: 0,
      polling: false,
    },
    hostile_fixture_refs: [...hostileFixtureRefs],
    status,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest(gateBody(gate));
  return validateHarnessCollisionGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Harness collision gate contract loaded\n");
