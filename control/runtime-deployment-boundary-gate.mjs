#!/usr/bin/env node

/* Read-only Runtime/Deployment Operator boundary.
 *
 * This is evidence preparation only.  It never calls a deploy, rollback,
 * migration, publication, activation, provider, or credential adapter.
 * Callers provide a typed evidence record; the gate derives the disposition
 * from that record and returns a content-addressed handoff/result.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const RUNTIME_DEPLOYMENT_BOUNDARY_SCHEMA = "agentos.runtime_deployment_boundary_input.v1";
export const RUNTIME_DEPLOYMENT_BOUNDARY_RESULT_SCHEMA = "agentos.runtime_deployment_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:-]{1,160}$/u;
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,96}$/u;
const REQUESTS = new Set(["ARTIFACT_PROVENANCE", "RUNTIME_READINESS", "ROLLBACK_EVIDENCE", "UNRELATED_REQUEST", "NOT_APPLICABLE", "DEPLOY", "ROLLBACK", "MIGRATE", "PUBLISH", "ACTIVATE", "PROMOTE"]);
const EVIDENCE_ACTIONS = new Set(["ARTIFACT_PROVENANCE", "RUNTIME_READINESS", "ROLLBACK_EVIDENCE"]);
const FORBIDDEN_ACTIONS = new Set(["DEPLOY", "ROLLBACK", "MIGRATE", "PUBLISH", "ACTIVATE", "PROMOTE"]);
const EVIDENCE_KEYS = new Set(["authority", "artifact", "custody", "runtime_target", "rollback_target", "source_lock", "scope", "requested_tools", "sibling_authorities", "provider_claim", "data_class", "self_acceptance", "scope_expanded", "authority_conflict", "authority_scope", "tool_mode"]);

function fail(message, code = "RUNTIME_BOUNDARY_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function nonEmpty(value, name) { assert(typeof value === "string" && value.length > 0 && value.length <= 240, `${name} must be a bounded string`, "RUNTIME_BOUNDARY_FIELD_INVALID"); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "RUNTIME_BOUNDARY_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "RUNTIME_BOUNDARY_UNKNOWN_FIELD"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {
    schema: RUNTIME_DEPLOYMENT_BOUNDARY_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: code,
    execution_allowed: false,
    external_side_effects: {deploy_calls: 0, rollback_calls: 0, migration_calls: 0, publication_calls: 0, activation_calls: 0, credential_accesses: 0, state_changes: 0},
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "runtime boundary input");
  assert(input.schema === RUNTIME_DEPLOYMENT_BOUNDARY_SCHEMA && input.version === 1, "runtime boundary input schema mismatch", "RUNTIME_BOUNDARY_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "runtime request kind is not recognized", "RUNTIME_BOUNDARY_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "runtime evidence");
  const evidence = input.evidence;
  if (evidence.authority !== undefined) { exactKeys(evidence.authority, new Set(["status", "owner_approval", "source_status"]), "authority evidence"); for (const key of ["status", "owner_approval", "source_status"]) if (evidence.authority[key] !== undefined) nonEmpty(evidence.authority[key], `authority.${key}`); }
  if (evidence.artifact !== undefined) { exactKeys(evidence.artifact, new Set(["identity", "digest", "provenance_status", "provider_identity", "version"]), "artifact evidence"); nonEmpty(evidence.artifact.identity, "artifact.identity"); assert(SHA256.test(evidence.artifact.digest), "artifact digest is not content-addressed", "RUNTIME_ARTIFACT_DIGEST_INVALID"); nonEmpty(evidence.artifact.provenance_status, "artifact.provenance_status"); if (evidence.artifact.provider_identity !== undefined) nonEmpty(evidence.artifact.provider_identity, "artifact.provider_identity"); if (evidence.artifact.version !== undefined) nonEmpty(evidence.artifact.version, "artifact.version"); }
  if (evidence.custody !== undefined) { exactKeys(evidence.custody, new Set(["status", "ref", "owner"]), "custody evidence"); nonEmpty(evidence.custody.status, "custody.status"); assert(OPAQUE_REF.test(evidence.custody.ref), "custody reference is not opaque", "RUNTIME_CUSTODY_REF_INVALID"); nonEmpty(evidence.custody.owner, "custody.owner"); }
  if (evidence.source_lock !== undefined) { exactKeys(evidence.source_lock, new Set(["status", "identity", "version"]), "source-lock evidence"); nonEmpty(evidence.source_lock.status, "source_lock.status"); assert(SAFE_ID.test(evidence.source_lock.identity), "source lock identity is not canonical", "RUNTIME_SOURCE_LOCK_INVALID"); nonEmpty(evidence.source_lock.version, "source_lock.version"); }
  for (const key of ["runtime_target", "rollback_target", "scope", "provider_claim", "data_class", "authority_scope", "tool_mode"]) if (evidence[key] !== undefined) nonEmpty(evidence[key], `evidence.${key}`);
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 8, "requested tools must be a bounded list", "RUNTIME_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) nonEmpty(tool, "requested tool"); }
  if (evidence.sibling_authorities !== undefined) { assert(Array.isArray(evidence.sibling_authorities) && evidence.sibling_authorities.length <= 8, "sibling authorities must be a bounded list", "RUNTIME_AUTHORITY_LIST_INVALID"); for (const authority of evidence.sibling_authorities) nonEmpty(authority, "sibling authority"); }
  for (const key of ["self_acceptance", "scope_expanded", "authority_conflict"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "RUNTIME_BOOLEAN_INVALID");
  const privacy = scanPersistedRecord(input);
  assert(privacy.safe, "runtime evidence contains protected or secret-like data", "RUNTIME_PRIVACY_DENIED");
}

function missingEvidence(input) {
  const evidence = input.evidence;
  const required = ["artifact", "authority", "custody", "runtime_target", "source_lock"];
  if (input.request_kind === "ROLLBACK_EVIDENCE") required.push("rollback_target");
  return required.filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateRuntimeDeploymentBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_RUNTIME_SCOPE", "RUNTIME_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_ACTIONS.has(input.request_kind)) return result("DENY", "NO_EXECUTION", "RUNTIME_EXECUTION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "RUNTIME_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || evidence.authority?.status === "CONFLICT") return result("ESCALATE", "CONTROLLER_ESCALATION", "RUNTIME_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "RUNTIME_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "RUNTIME_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (evidence.sibling_authorities?.length > 1 || evidence.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "RUNTIME_DUPLICATE_AUTHORITY", input);
  if (evidence.provider_claim === "UNBOUND") return result("DENY", "PROVENANCE_REFRESH_REQUIRED", "RUNTIME_PROVIDER_VERSION_UNBOUND", input);
  if (evidence.data_class === "PROTECTED") return result("DENY", "PROTECTED_DATA_FORBIDDEN", "RUNTIME_PROTECTED_DATA_FORBIDDEN", input);
  if (evidence.tool_mode === "WRITE" || evidence.requested_tools?.some((tool) => /(?:deploy|rollback|migrate|publish|activate|credential|provider)/iu.test(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "RUNTIME_TOOL_SCOPE_FORBIDDEN", input);
  const missing = missingEvidence(input);
  if (missing.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUNTIME_CONTEXT_INCOMPLETE", input, {missing_fields: missing});
  if (evidence.authority.status !== "CURRENT" || evidence.authority.source_status !== "CURRENT") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "RUNTIME_AUTHORITY_UNVERIFIED", input);
  if (evidence.authority.owner_approval !== "BOUND") return result("DENY", "APPROVAL_REQUIRED", "RUNTIME_APPROVAL_REQUIRED", input);
  if (evidence.custody.status !== "BOUND") return result("DENY", "CUSTODY_BINDING_REQUIRED", "RUNTIME_CUSTODY_UNBOUND", input);
  if (evidence.source_lock?.status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "RUNTIME_SOURCE_STALE_OR_UNVERIFIED", input);
  if (evidence.artifact?.provenance_status !== "VERIFIED") return result("DENY", "PROVENANCE_REFRESH_REQUIRED", "RUNTIME_PROVENANCE_UNVERIFIED", input);
  if (!EVIDENCE_ACTIONS.has(input.request_kind)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUNTIME_REQUEST_NOT_EVIDENCE_PREPARATION", input);
  return result("ROUTE", "RUNTIME_EVIDENCE_HANDOFF", "RUNTIME_EVIDENCE_READY", input, {handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed evidence to the separately authorized owner; do not execute runtime action.", execution_instruction: false}});
}
