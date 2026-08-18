#!/usr/bin/env node

/* Governed Product Owner entrypoint. Structural conversation compilers grant no authority. */

import {compileProjectOwnerResponse} from "./project-owner-conversation.mjs";
import {compileProjectOwnerMonitorTick} from "./project-owner-bootstrap.mjs";
import {resolvePermanentRoleAdmission, resolvePermanentRoleOperationalContext} from "./permanent-role-governed-admission.mjs";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateProductOwnerBoundary, PRODUCT_OWNER_BOUNDARY_INPUT_SCHEMA} from "./product-owner-boundary-gate.mjs";

export const PRODUCT_OWNER_OPERATIONAL_SCHEMA = "agentos.product_owner_operational.v1";
const REF = /^(?:ref|opaque):[^\s]{1,512}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const authorities = new WeakMap();
const DENIED_SIDE_EFFECT_BOUNDARY = Object.freeze(new Proxy({}, {get() { return () => { fail("Product Owner boundary attempted an operational side effect", "PRODUCT_OWNER_SIDE_EFFECT_FORBIDDEN"); }; }}));

function fail(message, code = "PRODUCT_OWNER_OPERATIONAL_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactOptions(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(Object.keys(value).every((key) => keys.includes(key)), `${label} rejects caller authority, roots, paths, adapters, clocks, and PASS claims`);
}
function resolveCanonicalIntentContext() {
  fail("Canonical project intent-context readback resolver is not installed; Product Owner remains inactive", "PRODUCT_OWNER_INTENT_CONTEXT_RESOLVER_UNAVAILABLE");
}
function receiptBody(value) { return {...structuredClone(value), receipt_sha256: null}; }

export function prepareProductOwnerOperationalAuthority(options = {}) {
  exactOptions(options, ["permanentRoleAdmissionAuthority", "admissionReceiptRef", "intentContextRef"], "Product Owner authority preparation");
  const {permanentRoleAdmissionAuthority, admissionReceiptRef, intentContextRef} = options;
  const productOwnerContext = resolvePermanentRoleOperationalContext({authority: permanentRoleAdmissionAuthority, expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  assert(productOwnerContext.compact_selection && typeof productOwnerContext.compact_selection.model_id === "string", "Product Owner requires a current selected model route");
  assert(typeof admissionReceiptRef === "string" && REF.test(admissionReceiptRef), "Product Owner admission receipt reference is invalid");
  assert(typeof intentContextRef === "string" && REF.test(intentContextRef), "Product Owner intent context reference is invalid");
  const admission = resolvePermanentRoleAdmission({authority: permanentRoleAdmissionAuthority, receiptRef: admissionReceiptRef, expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  assert(admission.operational_context_sha256 === productOwnerContext.context_sha256, "Product Owner admission is bound to another operational context");
  const intentContextReadback = resolveCanonicalIntentContext(intentContextRef);
  const capability = Object.freeze(Object.create(null));
  authorities.set(capability, Object.freeze({permanentRoleAdmissionAuthority, productOwnerContext, admission, admissionReceiptRef, intentContextRef, intentContextReadback}));
  return capability;
}

function authorityState(authority) {
  const state = authorities.get(authority);
  assert(state, "Product Owner operation requires an opaque governed authority", "PRODUCT_OWNER_AUTHORITY_REQUIRED");
  const current = resolvePermanentRoleOperationalContext({authority: state.permanentRoleAdmissionAuthority, expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  assert(current.context_sha256 === state.productOwnerContext.context_sha256, "Product Owner global policy changed and authority must be rebuilt", "PRODUCT_OWNER_CONTEXT_STALE");
  const admission = resolvePermanentRoleAdmission({authority: state.permanentRoleAdmissionAuthority, receiptRef: state.admissionReceiptRef, expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  assert(admission.receipt_sha256 === state.admission.receipt_sha256 && admission.operational_context_sha256 === current.context_sha256, "Product Owner admission changed, expired, or was revoked", "PRODUCT_OWNER_ADMISSION_STALE");
  const intent = resolveCanonicalIntentContext(state.intentContextRef);
  assert(intent.readback_sha256 === state.intentContextReadback.readback_sha256, "Product Owner intent context changed and authority must be rebuilt", "PRODUCT_OWNER_INTENT_CONTEXT_STALE");
  return state;
}

export function runProductOwnerOperationalRequest(options = {}) {
  exactOptions(options, ["authority", "operation", "requestId", "request"], "Product Owner operation");
  const {authority, operation, requestId, request} = options;
  const state = authorityState(authority);
  assert(["RESPOND_TO_USER", "CHECK_INTENT_ALIGNMENT"].includes(operation), "Product Owner operation is outside intent custody");
  assert(typeof requestId === "string" && ID.test(requestId), "Product Owner request identity is invalid");
  assert(request && typeof request === "object" && !Array.isArray(request), "Product Owner request is invalid");
  assert(Object.keys(request).every((key) => ["boundary", "content"].includes(key)) && request.boundary && request.content, "Product Owner request must carry typed boundary and content fields");
  assert(Object.keys(request.boundary).every((key) => ["request_kind", "detail_level"].includes(key)), "Product Owner caller cannot supply authority or context status claims");
  const boundary = evaluateProductOwnerBoundary({schema: PRODUCT_OWNER_BOUNDARY_INPUT_SCHEMA, version: 1, request_kind: request.boundary.request_kind, detail_level: request.boundary.detail_level, admission_status: "CURRENT", model_context_status: "CURRENT", intent_context_status: "CURRENT", project_binding_status: "MATCHED"}, DENIED_SIDE_EFFECT_BOUNDARY);
  let output = null;
  if (boundary.disposition === "ALLOW_CONVERSATION") output = operation === "RESPOND_TO_USER" ? compileProjectOwnerResponse(request.content) : compileProjectOwnerMonitorTick(request.content);
  else if (["ROUTE_HANDOFF", "ESCALATE_USER"].includes(boundary.disposition)) output = Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: boundary.disposition, route: boundary.route, reason_code: boundary.reason_code, question_style: boundary.user_question_style});
  assert(output === null || output.authority_status === "NON_AUTHORITATIVE_TEMPLATE", "Product Owner structural output must remain explicitly non-authoritative", "PRODUCT_OWNER_TEMPLATE_AUTHORITY_INVALID");
  const receipt = {
    schema: PRODUCT_OWNER_OPERATIONAL_SCHEMA, version: 1, status: "AUTHORITATIVE_GOVERNED_OUTPUT",
    role_id: "AGENTOS.PRODUCT_OWNER", request_id: requestId, operation,
    admission_receipt_sha256: state.admission.receipt_sha256,
    global_ledger_head_sha256: state.productOwnerContext.ledger_head_sha256,
    model_snapshot_sha256: state.productOwnerContext.snapshot_sha256,
    model_selection_sha256: canonicalDigest(state.productOwnerContext.compact_selection),
    intent_context_ref: state.intentContextRef,
    intent_context_readback_sha256: state.intentContextReadback.readback_sha256,
    boundary_result_sha256: boundary.result_sha256, disposition: boundary.disposition,
    request_sha256: canonicalDigest(request), output_sha256: canonicalDigest(output),
    occurred_at_utc: new Date().toISOString(), output, receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest(receiptBody(receipt)); return Object.freeze(receipt);
}
