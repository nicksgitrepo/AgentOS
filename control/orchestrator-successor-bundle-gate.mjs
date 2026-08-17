#!/usr/bin/env node

/*
 * Project-agnostic persistence gate for an autonomous Orchestrator handoff.
 *
 * Individual action-result, Controller-receipt, and dispatch-readback
 * validators are necessary but insufficient: a caller can still persist a
 * wrapper whose nested digest slots are null or point at different records.
 * This gate makes the handoff atomic at the governance boundary and binds
 * the lane's direct consumer without introducing a Controller approval step.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateActionResultContinuation} from "./action-result-continuation.mjs";
import {validateControllerActionReceipt} from "./controller-action-dispatcher.mjs";
import {validateOrchestratorSuccessorDispatchReadback} from "./orchestrator-successor-dispatch.mjs";

export const ORCHESTRATOR_SUCCESSOR_BUNDLE_SCHEMA = "agentos.orchestrator_successor_bundle.v1";
export const ORCHESTRATOR_SUCCESSOR_BUNDLE_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const BUNDLE_KEYS = Object.freeze([
  "schema", "version", "bundle_id", "source_successor", "dispatch_readback", "final_receipt",
  "execution_owner", "direct_consumer", "controller_approval_required", "evidence_refs",
  "hostile_fixture_refs", "bundle_sha256",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a non-null lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Orchestrator successor bundle evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Orchestrator successor bundle evidence ${index}`);
    requireIdentifier(ref.evidence_id, `Orchestrator successor bundle evidence ${index} id`);
    requireReference(ref.reference, `Orchestrator successor bundle evidence ${index} reference`);
    requireSha(ref.sha256, `Orchestrator successor bundle evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Orchestrator successor bundle evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Orchestrator successor bundle hostile fixtures are required");
  assert(refs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Orchestrator successor bundle hostile fixture is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Orchestrator successor bundle hostile fixtures must be sorted and unique");
  return refs;
}

function bundleBody(bundle) {
  const copy = structuredClone(bundle);
  copy.bundle_sha256 = null;
  return copy;
}

export function validateOrchestratorSuccessorBundle(bundle) {
  exactKeys(bundle, BUNDLE_KEYS, "Orchestrator successor bundle");
  assert(bundle.schema === ORCHESTRATOR_SUCCESSOR_BUNDLE_SCHEMA && bundle.version === ORCHESTRATOR_SUCCESSOR_BUNDLE_VERSION, "Orchestrator successor bundle identity is invalid");
  requireIdentifier(bundle.bundle_id, "Orchestrator successor bundle id");
  validateActionResultContinuation(bundle.source_successor);
  validateOrchestratorSuccessorDispatchReadback(bundle.dispatch_readback);
  validateControllerActionReceipt(bundle.final_receipt);
  requireIdentifier(bundle.execution_owner, "Orchestrator successor bundle execution owner");
  requireIdentifier(bundle.direct_consumer, "Orchestrator successor bundle direct consumer");
  assert(bundle.controller_approval_required === false, "Autonomous Orchestrator successor bundle cannot require Controller approval");
  const sourceResult = bundle.source_successor.result;
  assert(sourceResult.controller_approval_required === false, "Autonomous source successor cannot require Controller approval");
  assert(sourceResult.execution_owner === bundle.execution_owner, "Autonomous source execution owner diverges from bundle");
  assert(sourceResult.direct_consumer === bundle.direct_consumer, "Autonomous source direct consumer diverges from bundle");
  assert(bundle.source_successor.record_sha256 === bundle.dispatch_readback.source_successor_sha256, "Bundle source successor digest does not bind dispatch readback");
  assert(bundle.source_successor.next_action === bundle.dispatch_readback.source_action, "Bundle source action does not bind dispatch readback");
  assert(bundle.final_receipt.receipt_sha256 === bundle.dispatch_readback.final_receipt_sha256, "Bundle final receipt digest does not bind dispatch readback");
  assert(bundle.final_receipt.next_action === bundle.dispatch_readback.final_next_action, "Bundle final action does not bind dispatch readback");
  assert(bundle.final_receipt.next_handler === bundle.dispatch_readback.final_next_handler, "Bundle final handler does not bind dispatch readback");
  validateEvidenceRefs(bundle.evidence_refs);
  validateHostileRefs(bundle.hostile_fixture_refs);
  requireSha(bundle.bundle_sha256, "Orchestrator successor bundle digest");
  assert(bundle.bundle_sha256 === canonicalDigest(bundleBody(bundle)), "Orchestrator successor bundle digest mismatch");
  return bundle;
}

export function compileOrchestratorSuccessorBundle({
  bundleId,
  sourceSuccessor,
  dispatchReadback,
  finalReceipt,
  executionOwner = "LANE_AGENT",
  directConsumer,
  evidenceRefs,
  hostileFixtureRefs,
} = {}) {
  requireIdentifier(bundleId, "Orchestrator successor bundle id");
  requireIdentifier(executionOwner, "Orchestrator successor bundle execution owner");
  requireIdentifier(directConsumer, "Orchestrator successor bundle direct consumer");
  const bundle = {
    schema: ORCHESTRATOR_SUCCESSOR_BUNDLE_SCHEMA,
    version: ORCHESTRATOR_SUCCESSOR_BUNDLE_VERSION,
    bundle_id: bundleId,
    source_successor: structuredClone(sourceSuccessor),
    dispatch_readback: structuredClone(dispatchReadback),
    final_receipt: structuredClone(finalReceipt),
    execution_owner: executionOwner,
    direct_consumer: directConsumer,
    controller_approval_required: false,
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    bundle_sha256: null,
  };
  bundle.bundle_sha256 = canonicalDigest(bundleBody(bundle));
  return validateOrchestratorSuccessorBundle(bundle);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Orchestrator successor bundle gate loaded\n");
