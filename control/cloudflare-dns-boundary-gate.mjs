#!/usr/bin/env node

/*
 * Read-only Cloudflare DNS specialist boundary.
 *
 * The boundary classifies a bounded, synthetic DNS-record evidence packet. It
 * never reads a zone, accesses credentials, writes a project, or mutates a
 * provider. The package evaluator is responsible for binding this public
 * entrypoint to the exact candidate artifacts.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const CLOUDFLARE_DNS_BOUNDARY_SCHEMA = "agentos.cloudflare_dns_boundary_input.v1";
export const CLOUDFLARE_DNS_RESULT_SCHEMA = "agentos.cloudflare_dns_boundary_result.v1";
export const CLOUDFLARE_DNS_BLOCK_ID = "specialist.platform.cloudflare-dns";
export const CLOUDFLARE_DNS_SPECIALIST = CLOUDFLARE_DNS_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set([
  "ANALYZE_DNS_RECORDS", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "CREATE_RECORD", "UPDATE_RECORD", "DELETE_RECORD", "MUTATE_ZONE",
  "DEPLOY", "PUBLISH", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW",
]);
const FORBIDDEN_REQUESTS = new Set([
  "CREATE_RECORD", "UPDATE_RECORD", "DELETE_RECORD", "MUTATE_ZONE",
  "DEPLOY", "PUBLISH", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW",
]);
const ALLOWED_TOOLS = new Set(["READ_CONTEXT", "READ_SOURCE"]);
const RECORD_TYPES = new Set(["A", "AAAA", "CAA", "CNAME", "MX", "NS", "SRV", "TXT"]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref",
  "source_status", "source_identity", "source_version", "source_effective_date",
  "source_retrieved_date", "provider_identity", "provider_version", "signal",
  "target_ref", "context_complete", "scope", "requested_action", "requested_tools",
  "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present",
  "secret_data_present", "provider_evidence", "dns_zone", "dns_records",
  "candidate_digest", "block_revision", "source_manifest_sha256", "source_content_sha256",
  "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256",
  "upstream_router_result_sha256", "memory_binding", "adversarial_flags",
]);
const FLAG_KEYS = new Set([
  "authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority",
  "umbrella_authority", "false_positive", "stale_source", "unsupported_tool",
  "missing_context", "unsafe_action",
]);

function fail(message, code = "CLOUDFLARE_DNS_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, allowed, label, code = "CLOUDFLARE_DNS_SHAPE_INVALID") {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "CLOUDFLARE_DNS_UNKNOWN_FIELD");
}

function bounded(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "CLOUDFLARE_DNS_FIELD_INVALID");
}

function safeId(value, label) {
  bounded(value, label);
  assert(SAFE_ID.test(value), `${label} is not canonical`, "CLOUDFLARE_DNS_ID_INVALID");
}

function hash(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "CLOUDFLARE_DNS_DIGEST_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: CLOUDFLARE_DNS_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      provider_reads: 0,
      account_mutations: 0,
      project_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateDnsZone(value) {
  exactKeys(value, new Set(["zone_ref", "record_count", "records_digest"]), "dns_zone");
  assert(OPAQUE_REF.test(value.zone_ref), "dns_zone.zone_ref must be opaque", "CLOUDFLARE_DNS_ZONE_REF_INVALID");
  assert(Number.isInteger(value.record_count) && value.record_count >= 0 && value.record_count <= 50, "dns_zone.record_count is invalid", "CLOUDFLARE_DNS_ZONE_INVALID");
  hash(value.records_digest, "dns_zone.records_digest");
}

function validateDnsRecords(value) {
  assert(Array.isArray(value) && value.length <= 50, "dns_records must be a bounded array", "CLOUDFLARE_DNS_RECORDS_INVALID");
  for (const [index, record] of value.entries()) {
    exactKeys(record, new Set(["type", "name", "content", "ttl", "proxied"]), `dns_records[${index}]`);
    assert(typeof record.type === "string" && RECORD_TYPES.has(record.type), `dns_records[${index}].type is invalid`, "CLOUDFLARE_DNS_RECORD_INVALID");
    bounded(record.name, `dns_records[${index}].name`, 253);
    bounded(record.content, `dns_records[${index}].content`, 512);
    assert(Number.isInteger(record.ttl) && record.ttl >= 1 && record.ttl <= 86400, `dns_records[${index}].ttl is invalid`, "CLOUDFLARE_DNS_RECORD_INVALID");
    assert(typeof record.proxied === "boolean", `dns_records[${index}].proxied is invalid`, "CLOUDFLARE_DNS_RECORD_INVALID");
  }
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "Cloudflare DNS evidence");
  for (const key of [
    "authority_status", "custody_status", "source_status", "source_identity", "source_version",
    "provider_identity", "provider_version", "signal", "target_ref", "scope", "requested_action",
    "provider_evidence", "block_revision", "memory_binding",
  ]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  safeId(evidence.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(evidence.custody_ref), "evidence.custody_ref is not opaque", "CLOUDFLARE_DNS_CUSTODY_REF_INVALID");
  for (const key of ["source_effective_date", "source_retrieved_date"]) {
    bounded(evidence[key], `evidence.${key}`, 20);
    assert(DATE.test(evidence[key]) && Number.isFinite(Date.parse(`${evidence[key]}T00:00:00.000Z`)), `evidence.${key} is invalid`, "CLOUDFLARE_DNS_DATE_INVALID");
  }
  assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length > 0 && evidence.requested_tools.length <= 2, "evidence.requested_tools is not bounded", "CLOUDFLARE_DNS_TOOL_LIST_INVALID");
  for (const tool of evidence.requested_tools) { bounded(tool, "evidence.requested_tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]) assert(typeof evidence[key] === "boolean", `evidence.${key} must be boolean`, "CLOUDFLARE_DNS_BOOLEAN_INVALID");
  exactKeys(evidence.adversarial_flags, FLAG_KEYS, "evidence.adversarial_flags");
  for (const [key, value] of Object.entries(evidence.adversarial_flags)) assert(typeof value === "boolean", `evidence.adversarial_flags.${key} must be boolean`, "CLOUDFLARE_DNS_BOOLEAN_INVALID");
  validateDnsZone(evidence.dns_zone);
  validateDnsRecords(evidence.dns_records);
  assert(evidence.dns_zone.record_count === evidence.dns_records.length, "dns zone count does not match records", "CLOUDFLARE_DNS_RECORD_COUNT_MISMATCH");
  for (const key of [
    "candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256",
    "context_receipt_sha256", "upstream_router_result_sha256",
  ]) hash(evidence[key], `evidence.${key}`);
  hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  assert(evidence.memory_binding === "TYPED_CONTEXT_INVALIDATION_V1", "memory binding is not canonical", "CLOUDFLARE_DNS_MEMORY_BINDING_INVALID");
  assert(scanPersistedRecord({schema: CLOUDFLARE_DNS_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "Cloudflare DNS evidence contains protected data", "CLOUDFLARE_DNS_PRIVACY_DENIED");
}

function missing(evidence) {
  return [
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity",
    "source_version", "source_effective_date", "source_retrieved_date", "provider_identity", "provider_version",
    "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools",
    "provider_evidence", "dns_zone", "dns_records", "candidate_digest", "source_manifest_sha256",
    "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256",
    "memory_binding",
  ].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateCloudflareDnsBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "Cloudflare DNS input");
  assert(input.schema === CLOUDFLARE_DNS_BOUNDARY_SCHEMA && input.version === 1, "Cloudflare DNS schema mismatch", "CLOUDFLARE_DNS_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "Cloudflare DNS request kind is not recognized", "CLOUDFLARE_DNS_REQUEST_INVALID");
  validateEvidence(input.evidence);
  const evidence = input.evidence;
  const flags = evidence.adversarial_flags;

  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_CLOUDFLARE_DNS_SCOPE", "CLOUDFLARE_DNS_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_DNS_SIDE_EFFECT", "CLOUDFLARE_DNS_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "CLOUDFLARE_DNS_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "CLOUDFLARE_DNS_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "CLOUDFLARE_DNS_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "CLOUDFLARE_DNS_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "CLOUDFLARE_DNS_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "CLOUDFLARE_DNS_PROVIDER_IDENTITY_INVALID", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "CLOUDFLARE_DNS_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "CLOUDFLARE_DNS_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CLOUDFLARE_DNS_CONTEXT_INCOMPLETE", input);
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CLOUDFLARE_DNS_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.PLATFORM_CLOUDFLARE_DNS") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "CLOUDFLARE_DNS_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "CLOUDFLARE_DNS_SOURCE_IDENTITY_INVALID", input);
  if (evidence.provider_identity !== "CLOUDFLARE" || evidence.provider_version !== "CURRENT" || !["EDGE.CLOUDFLARE_DNS", "CLOUDFLARE_DNS"].includes(evidence.signal)) return result("DENY", "SOURCE_REFRESH_REQUIRED", "CLOUDFLARE_DNS_PROVIDER_IDENTITY_INVALID", input);
  if (evidence.target_ref !== CLOUDFLARE_DNS_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "CLOUDFLARE_DNS_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_DNS_RECORDS") return result("DENY", "NARROW_SCOPE_REQUIRED", "CLOUDFLARE_DNS_SCOPE_INVALID", input);
  if (evidence.provider_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "CLOUDFLARE_DNS_EVIDENCE_UNBOUNDED", input);

  return result("ROUTE", "DNS_SPECIALIST_HANDOFF", "CLOUDFLARE_DNS_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: CLOUDFLARE_DNS_SPECIALIST,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the supplied typed DNS-record evidence; do not read or mutate provider state.",
      execution_instruction: false,
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] ?? "null");
  process.stdout.write(`${JSON.stringify(evaluateCloudflareDnsBoundary(input), null, 2)}\n`);
}
