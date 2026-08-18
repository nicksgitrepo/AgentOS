#!/usr/bin/env node

/*
 * Project-agnostic control-plane receipt serialization gate.
 *
 * Persisted JSON is a byte contract, not merely an object shape.  A receipt
 * must contain one JSON document followed by exactly one real LF byte.  A
 * literal two-character "\\n" suffix, trailing data, CRLF, or a digest drift
 * is rejected before the receipt can become current or spawnable.
 */

import fs from "node:fs";

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const RECEIPT_SERIALIZATION_GATE_SCHEMA = "agentos.receipt_serialization_gate.v1";
export const RECEIPT_SERIALIZATION_GATE_VERSION = 1;
export const RECEIPT_SERIALIZATION_REPAIR_ACTION = "REPAIR_BLOCKS";
export const RECEIPT_SERIALIZATION_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";
export const RECEIPT_SERIALIZATION_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.RECEIPT_SERIALIZATION.DIGEST_DRIFT",
  "FIXTURE.RECEIPT_SERIALIZATION.DOUBLE_TERMINAL_LF",
  "FIXTURE.RECEIPT_SERIALIZATION.LITERAL_ESCAPED_LF",
  "FIXTURE.RECEIPT_SERIALIZATION.MISSING_TERMINAL_LF",
  "FIXTURE.RECEIPT_SERIALIZATION.TRAILING_DATA",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const PROPERTY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,191}$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "status", "defect_id", "authority", "custody",
  "serialization_rule", "evidence_refs", "hostile_fixture_refs", "source_action",
  "next_action", "next_handler", "spawnable", "same_turn_dispatch", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["commit", "tree", "receipt_ref", "receipt_sha256"]);
const CUSTODY_KEYS = Object.freeze([
  "compiler_only", "controller_approval_required", "execution_owner", "direct_consumer",
  "product_mutation", "provider_access", "credential_access", "spend", "destructive_work",
  "worker_activation", "wave_activation",
]);
const SERIALIZATION_RULE_KEYS = Object.freeze([
  "parser", "terminal_byte", "terminal_lf_count", "reject_literal_escaped_lf",
  "reject_trailing_data", "canonical_digest_revalidation", "write_scope",
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
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireCommit(value, label) {
  assert(typeof value === "string" && COMMIT.test(value), `${label} must be a 40-character lowercase commit`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be a control-plane reference`);
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Receipt serialization evidence refs are required");
  const ids = refs.map((ref) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], "Receipt serialization evidence ref");
    requireIdentifier(ref.evidence_id, "Receipt serialization evidence id");
    requireReference(ref.reference, "Receipt serialization evidence reference");
    requireSha(ref.sha256, "Receipt serialization evidence digest");
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Receipt serialization evidence refs must be sorted and unique");
  return refs;
}

function validateHostileFixtureRefs(refs) {
  assert(Array.isArray(refs), "Receipt serialization hostile fixture refs are required");
  const ordered = [...refs].sort(compareUtf8);
  assert(JSON.stringify(refs) === JSON.stringify(ordered), "Receipt serialization hostile fixture refs must be sorted");
  assert(new Set(refs).size === refs.length, "Receipt serialization hostile fixture refs must be unique");
  assert(JSON.stringify(refs) === JSON.stringify(RECEIPT_SERIALIZATION_HOSTILE_FIXTURE_REFS), "Receipt serialization hostile fixture coverage is incomplete");
  return refs;
}

export function serializeReceiptJson(value) {
  assert(isRecord(value), "Persisted receipt must be an object");
  const serialized = JSON.stringify(value, null, 2);
  assert(typeof serialized === "string", "Persisted receipt could not be serialized");
  return `${serialized}\n`;
}

function decodeReceiptBytes(input, label) {
  assert(Buffer.isBuffer(input) || typeof input === "string", `${label} bytes must be a Buffer or string`);
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8: ${error.message}`);
  }
  assert(text.endsWith("\n"), `${label} must end with one actual terminal LF`);
  assert(!text.endsWith("\r\n"), `${label} must use LF, not CRLF`);
  const body = text.slice(0, -1);
  assert(body.length > 0 && !/\s$/u.test(body), `${label} has trailing bytes before its terminal LF`);
  return {bytes, text, body};
}

export function parseStrictReceiptJson(input, {label = "Persisted receipt"} = {}) {
  const {body} = decodeReceiptBytes(input, label);
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new Error(`${label} JSON.parse failed: ${error.message}`);
  }
  assert(isRecord(value), `${label} JSON root must be an object`);
  return value;
}

export function validateReceiptJsonBytes(input, {label = "Persisted receipt", digestField = null} = {}) {
  const {text} = decodeReceiptBytes(input, label);
  const value = parseStrictReceiptJson(input, {label});
  if (digestField !== null) {
    assert(typeof digestField === "string" && PROPERTY_NAME.test(digestField), `${label} digest field is invalid`);
    requireSha(value[digestField], `${label} ${digestField}`);
    assert(value[digestField] === canonicalDigest({...value, [digestField]: null}), `${label} ${digestField} does not match its content`);
  }
  assert(text.endsWith("\n") && !text.endsWith("\n\n"), `${label} terminal LF contract is invalid`);
  return value;
}

export function readStrictReceiptJson(filePath, options = {}) {
  assert(typeof filePath === "string" && filePath.length > 0, "Receipt path is required");
  return validateReceiptJsonBytes(fs.readFileSync(filePath), {...options, label: options.label ?? filePath});
}

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Receipt serialization authority");
  requireCommit(authority.commit, "Receipt serialization authority commit");
  requireCommit(authority.tree, "Receipt serialization authority tree");
  requireReference(authority.receipt_ref, "Receipt serialization authority reference");
  requireSha(authority.receipt_sha256, "Receipt serialization authority digest");
  return authority;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Receipt serialization custody");
  assert(custody.compiler_only === true, "Receipt serialization custody must remain compiler-only");
  assert(custody.controller_approval_required === false, "Receipt serialization custody cannot require Controller approval");
  assert(custody.execution_owner === "LANE_AGENT", "Receipt serialization execution owner is invalid");
  assert(custody.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Receipt serialization direct consumer is invalid");
  for (const key of ["product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "worker_activation", "wave_activation"]) {
    assert(custody[key] === false, `Receipt serialization custody ${key} must remain closed`);
  }
  return custody;
}

function validateSerializationRule(rule) {
  exactKeys(rule, SERIALIZATION_RULE_KEYS, "Receipt serialization rule");
  assert(rule.parser === "JSON.parse", "Receipt serialization parser rule is invalid");
  assert(rule.terminal_byte === 10 && rule.terminal_lf_count === 1, "Receipt serialization terminal LF rule is invalid");
  assert(rule.reject_literal_escaped_lf === true && rule.reject_trailing_data === true, "Receipt serialization trailing-byte rule is weakened");
  assert(rule.canonical_digest_revalidation === true, "Receipt serialization digest revalidation is required");
  assert(rule.write_scope === "CONTROL_PLANE_ONLY", "Receipt serialization write scope is invalid");
  return rule;
}

export function validateReceiptSerializationGate(gate) {
  exactKeys(gate, GATE_KEYS, "Receipt serialization gate");
  assert(gate.schema === RECEIPT_SERIALIZATION_GATE_SCHEMA && gate.version === RECEIPT_SERIALIZATION_GATE_VERSION, "Receipt serialization gate identity is invalid");
  requireIdentifier(gate.gate_id, "Receipt serialization gate id");
  assert(gate.status === "REPAIR_REQUIRED", "Receipt serialization gate must remain a repair requirement");
  requireIdentifier(gate.defect_id, "Receipt serialization defect id");
  validateAuthority(gate.authority);
  validateCustody(gate.custody);
  validateSerializationRule(gate.serialization_rule);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileFixtureRefs(gate.hostile_fixture_refs);
  assert(gate.source_action === "COMPILE_BLOCK_PATCH", "Receipt serialization source action is invalid");
  assert(gate.next_action === RECEIPT_SERIALIZATION_REPAIR_ACTION, "Receipt serialization gate must route to REPAIR_BLOCKS");
  assert(gate.next_handler === RECEIPT_SERIALIZATION_REPAIR_HANDLER, "Receipt serialization gate handler is invalid");
  assert(gate.spawnable === false, "Receipt serialization gate must be non-spawnable");
  assert(gate.same_turn_dispatch === true, "Receipt serialization gate requires same-turn dispatch evidence");
  requireSha(gate.gate_sha256, "Receipt serialization gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Receipt serialization gate digest mismatch");
  return gate;
}

export function compileReceiptSerializationGate({gateId, defectId, authority, custody, evidenceRefs, sameTurnDispatch = true} = {}) {
  requireIdentifier(gateId, "Receipt serialization gate id");
  requireIdentifier(defectId, "Receipt serialization defect id");
  const gate = {
    schema: RECEIPT_SERIALIZATION_GATE_SCHEMA,
    version: RECEIPT_SERIALIZATION_GATE_VERSION,
    gate_id: gateId,
    status: "REPAIR_REQUIRED",
    defect_id: defectId,
    authority: structuredClone(authority),
    custody: structuredClone(custody),
    serialization_rule: {
      parser: "JSON.parse",
      terminal_byte: 10,
      terminal_lf_count: 1,
      reject_literal_escaped_lf: true,
      reject_trailing_data: true,
      canonical_digest_revalidation: true,
      write_scope: "CONTROL_PLANE_ONLY",
    },
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...RECEIPT_SERIALIZATION_HOSTILE_FIXTURE_REFS],
    source_action: "COMPILE_BLOCK_PATCH",
    next_action: RECEIPT_SERIALIZATION_REPAIR_ACTION,
    next_handler: RECEIPT_SERIALIZATION_REPAIR_HANDLER,
    spawnable: false,
    same_turn_dispatch: sameTurnDispatch,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateReceiptSerializationGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Receipt serialization gate loaded\n");
