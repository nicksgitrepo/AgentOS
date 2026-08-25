#!/usr/bin/env node

import crypto from "node:crypto";
import {canonicalDigest} from "./content-addressing.mjs";
import {findPrivateContextLeaks} from "./private-context-detector.mjs";

export const GOVERNANCE_ARCHITECTURE_PLAN_SCHEMA = "agentos.governance_architecture_plan.v1";
export const GOVERNANCE_ARCHITECTURE_PLAN_KIND = "ARCHITECTURE_ALIGNMENT_REPAIR";
export const GOVERNANCE_TREE_ROOTS = Object.freeze(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
export const ARCHITECTURE_ACCEPTANCE_REQUIREMENTS = Object.freeze([
  "SHARED_GENERAL_GOVERNANCE_LIBRARY_PRESENT",
  "ROLE_SPECIFIC_LIBRARY_GENERATED_FROM_GENERAL_LIBRARY_AND_GOVERNANCE_TREE",
  "GENERAL_AND_ROLE_LIBRARIES_SHARE_SOURCE_BINDING",
  "BOOTSTRAP_PLAN_ADMITS_BOTH_GOVERNANCE_LAYERS",
  "CONTROLLER_REPAIR_ADMISSION_REQUIRES_ARCHITECTURE_GATE",
  "ARCHITECTURE_GATE_REJECTS_MISSING_GENERAL_LIBRARY",
  "ARCHITECTURE_GATE_REJECTS_ROLE_LIBRARY_WITHOUT_TREE_BINDING",
  "PUBLIC_PORTABLE_AND_SECRET_FREE",
  "NO_UNRELATED_PATHS_CHANGED",
]);
export const UNIVERSAL_TASK_CLOSEOUT_SEQUENCE = Object.freeze([
  "PRESERVE_HANDOFF", "PERSIST_HANDOFF", "AUDIT_CANDIDATE", "INTEGRATE_ACCEPTED_WORK", "UNPIN_SESSION",
  "CLOSE_STALE_WORKTREE", "REMOVE_ACTIVE_TASK_SCOPE", "MARK_CHAT_OUT_OF_SCOPE", "ARCHIVE_VISIBLE_TASK",
]);
export const UNIVERSAL_TASK_CLOSEOUT_EVIDENCE = Object.freeze([
  "ARCHIVE_RECEIPT", "CHAT_OUT_OF_SCOPE_RECEIPT", "CLOSURE_RECEIPT", "HANDOFF_PRESERVATION_RECEIPT",
  "INDEPENDENT_AUDIT_RECEIPT", "INTEGRATION_RECEIPT", "ROSTER_READBACK", "STALE_WORKTREE_CLOSURE_RECEIPT",
  "TASK_SCOPE_REMOVAL_RECEIPT", "TYPED_HANDOFF",
]);
export const UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA = "agentos.universal_task_closeout_receipts.v1";
export const UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES = Object.freeze({
  PRESERVE_HANDOFF: "CONTROLLER_READBACK", PERSIST_HANDOFF: "CONTROLLER_RECORD", AUDIT_CANDIDATE: "INDEPENDENT_AUDITOR",
  INTEGRATE_ACCEPTED_WORK: "CONTROLLER_INTEGRATION", UNPIN_SESSION: "HOST_READBACK", CLOSE_STALE_WORKTREE: "CONTROLLER_RECORD",
  REMOVE_ACTIVE_TASK_SCOPE: "CONTROLLER_RECORD", MARK_CHAT_OUT_OF_SCOPE: "CONTROLLER_RECORD", ARCHIVE_VISIBLE_TASK: "HOST_READBACK",
});
export const UNIVERSAL_TASK_CLOSEOUT_MODES = Object.freeze([
  "APPRENTICESHIP", "BOOTSTRAP", "CAMPAIGN", "CASCADE", "ITERATION", "IMPORT", "RAPID_PROTOTYPE", "RAPID_PROTOTYPING",
]);
export const UNIVERSAL_DEVELOPMENT_MODES = Object.freeze([...UNIVERSAL_TASK_CLOSEOUT_MODES]);
export const UNIVERSAL_RESPONSE_GATING_POLICY = Object.freeze({
  controller: "control/universal-response-gating.mjs",
  contract: "schemas/universal-response-handoff.v1.json",
  catalog_source: "governance/gate-catalog.v1.json",
  catalog_compiler: "control/gate-catalog-compiler.mjs",
  applies_to_modes: Object.freeze([...UNIVERSAL_DEVELOPMENT_MODES, "ALL_DEVELOPMENT_MODES"]),
  applies_to: Object.freeze(["DOCUMENTATION", "HANDOFF", "PROGRESS", "RESPONSE", "CLOSURE"]),
  complete_requires: Object.freeze(["CATALOG_GRAPH_COMPLETE", "INDEPENDENT_CHECK_PASS", "PRESERVED_TYPED_HANDOFF"]),
  unknown_behavior: "NEVER_PASSES", not_applicable_behavior: "REQUIRES_APPLICABILITY_JUSTIFICATION", public_payload: "SECRET_FREE_PROJECT_AGNOSTIC",
});
export const UNIVERSAL_TASK_CLOSEOUT_APPLICABILITY = Object.freeze([...UNIVERSAL_DEVELOPMENT_MODES, "ALL_DEVELOPMENT_MODES"]);
export const UNIVERSAL_EXISTING_TASK_RECOVERY_POLICY = Object.freeze({
  contract: "schemas/existing-task-stop-resume.v1.json",
  controller: "control/existing-task-stop-resume.mjs",
  same_task_first: true,
  exact_pin_membership_required: true,
  single_replacement_role_lock_required: true,
  ordinary_orchestrator_bypass: true,
  archive_before_idle_process_zero_and_custody_preservation: "DENY",
});

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}
function assertPortable(value, label) { assert(findPrivateContextLeaks(JSON.stringify(value)).length === 0, `${label} contains private or provider-bound content`); }

export function universalTaskCloseoutPolicy(mode = "ALL_DEVELOPMENT_MODES") {
  assert(UNIVERSAL_TASK_CLOSEOUT_APPLICABILITY.includes(mode), `universal task closeout mode is invalid: ${mode}`);
  return {
    mode, applies_to: [...UNIVERSAL_TASK_CLOSEOUT_APPLICABILITY], receipt_schema: UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA,
    receipt_compiler: "compileUniversalTaskCloseoutReceipts", receipt_authorities: {...UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES},
    sequence: [...UNIVERSAL_TASK_CLOSEOUT_SEQUENCE], required_evidence: [...UNIVERSAL_TASK_CLOSEOUT_EVIDENCE],
    controller_must_wait_for_integration: true, archive_is_dynamic: true, archive_requires_chat_out_of_scope: true,
    archive_requires_active_scope_removal: true, archive_requires_stale_worktree_closed: true,
    archive_preconditions: ["HANDOFF_PRESERVED", "HANDOFF_PERSISTED", "CANDIDATE_INDEPENDENTLY_AUDITED", "WORKTREE_INTEGRATED", "STALE_WORKTREE_CLOSED", "ACTIVE_TASK_SCOPE_REMOVED", "CHAT_OUT_OF_SCOPE"],
  };
}

// Closeout references are content-addressed identities, not labels.  A bare
// `ref:...` or `opaque:...` token can be forged without resolving any receipt
// bytes, so only digest-bearing references are admissible at this boundary.
const CLOSEOUT_RECEIPT_REF = /^(?:(?:digest|sha256):[0-9a-f]{64}|opaque:sha256:[0-9a-f]{64})$/u;
const CLOSEOUT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function closeoutReceiptDigest(reference) {
  const match = /^(?:digest|sha256):([0-9a-f]{64})$|^opaque:sha256:([0-9a-f]{64})$/u.exec(reference);
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveCloseoutReference(reference, {receiptResolver, expectedStep, expectedAuthority, label} = {}) {
  assert(CLOSEOUT_RECEIPT_REF.test(reference), `${label} receipt reference is not content-addressed`);
  assert(typeof receiptResolver === "function", `${label} receipt resolver is invalid`);
  const resolved = receiptResolver(reference, {step: expectedStep, authority: expectedAuthority});
  assert(isRecord(resolved), `${label} receipt reference did not resolve to a record`);
  const digest = closeoutReceiptDigest(reference);
  assert(resolved.receipt_sha256 === digest, `${label} receipt digest does not match its resolved bytes`);
  let recomputed;
  if (Object.prototype.hasOwnProperty.call(resolved, "payload")) {
    recomputed = canonicalDigest(resolved.payload);
  } else if (typeof resolved.bytes === "string" || resolved.bytes instanceof Uint8Array) {
    recomputed = crypto.createHash("sha256").update(resolved.bytes).digest("hex");
  } else {
    assert(false, `${label} resolved receipt is missing immutable bytes or payload`);
  }
  assert(recomputed === digest, `${label} resolved receipt bytes do not match its reference digest`);
  assert(resolved.status === "PROVEN", `${label} resolved receipt is not proven`);
  assert(resolved.authority === expectedAuthority, `${label} resolved receipt authority is invalid for ${expectedStep}`);
}

export function validateUniversalTaskCloseoutReceipts(receipts, {closed = false, label = "universal task closeout receipts", receiptResolver} = {}) {
  assert(Array.isArray(receipts), `${label} must be an array`); assert(receipts.length <= UNIVERSAL_TASK_CLOSEOUT_SEQUENCE.length, `${label} contains too many receipts`);
  const seen = new Set();
  receipts.forEach((receipt, index) => {
    exactKeys(receipt, ["sequence", "step", "receipt_ref", "authority", "status", "observed_at"], `${label} ${index}`);
    assert(Number.isSafeInteger(receipt.sequence) && receipt.sequence === index + 1, `${label} ${index} sequence is invalid`);
    const expectedStep = UNIVERSAL_TASK_CLOSEOUT_SEQUENCE[index]; assert(receipt.step === expectedStep, `${label} ${index} must prove ${expectedStep}`);
    assert(typeof receipt.receipt_ref === "string", `${label} ${index} receipt reference is invalid`);
    resolveCloseoutReference(receipt.receipt_ref, {
      receiptResolver,
      expectedStep: receipt.step,
      expectedAuthority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES[receipt.step],
      label: `${label} ${index}`,
    });
    assert(receipt.authority === UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES[receipt.step], `${label} ${index} authority is invalid for ${receipt.step}`);
    assert(receipt.status === "PROVEN", `${label} ${index} is not proven`);
    assert(typeof receipt.observed_at === "string" && CLOSEOUT_TIMESTAMP.test(receipt.observed_at) && Number.isFinite(Date.parse(receipt.observed_at)), `${label} ${index} timestamp is invalid`);
    assert(!seen.has(receipt.receipt_ref), `${label} contains duplicate receipt references`); seen.add(receipt.receipt_ref); assertPortable(receipt, `${label} ${index}`);
  });
  if (closed) assert(receipts.length === UNIVERSAL_TASK_CLOSEOUT_SEQUENCE.length, `${label} is incomplete before archive`);
  return receipts;
}

export function compileUniversalTaskCloseoutReceipts({mode = "ALL_DEVELOPMENT_MODES", receiptRefs, observedAt, label = "universal task closeout receipts", receiptResolver} = {}) {
  assertUniversalTaskCloseoutMode(mode); exactKeys(receiptRefs, UNIVERSAL_TASK_CLOSEOUT_SEQUENCE, `${label} references`);
  assert(typeof observedAt === "string" && CLOSEOUT_TIMESTAMP.test(observedAt) && Number.isFinite(Date.parse(observedAt)), `${label} observation time is invalid`);
  return validateUniversalTaskCloseoutReceipts(UNIVERSAL_TASK_CLOSEOUT_SEQUENCE.map((step, index) => ({sequence: index + 1, step, receipt_ref: receiptRefs[step], authority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES[step], status: "PROVEN", observed_at: observedAt})), {closed: true, label, receiptResolver});
}
export function assertUniversalTaskCloseoutMode(mode) { return universalTaskCloseoutPolicy(mode); }
export function assertUniversalResponseGatingMode(mode, contexts = UNIVERSAL_RESPONSE_GATING_POLICY.applies_to) {
  assert(UNIVERSAL_DEVELOPMENT_MODES.includes(mode), `universal response-gating mode is invalid: ${mode}`); assert(Array.isArray(contexts) && contexts.length > 0, "universal response-gating contexts must not be empty");
  for (const context of contexts) assert(UNIVERSAL_RESPONSE_GATING_POLICY.applies_to.includes(context), `universal response-gating context is invalid: ${context}`); return true;
}
export function assertUniversalDevelopmentMode(mode, contexts = UNIVERSAL_RESPONSE_GATING_POLICY.applies_to) {
  assert(UNIVERSAL_DEVELOPMENT_MODES.includes(mode), `universal development mode is invalid: ${mode}`); assertUniversalTaskCloseoutMode(mode); assertUniversalResponseGatingMode(mode, contexts);
  return {mode, closeout: universalTaskCloseoutPolicy(mode), response_handoff_gating: {...structuredClone(UNIVERSAL_RESPONSE_GATING_POLICY), applies_to_modes: [...UNIVERSAL_RESPONSE_GATING_POLICY.applies_to_modes], applies_to: [...contexts]}};
}
export function validateUniversalTaskCloseoutForMode(mode, receipts, {closed = false, label = null, receiptResolver} = {}) { assertUniversalTaskCloseoutMode(mode); return validateUniversalTaskCloseoutReceipts(receipts, {closed, label: label ?? `${mode} universal task closeout receipts`, receiptResolver}); }
