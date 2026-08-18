#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  RECEIPT_SERIALIZATION_GATE_SCHEMA,
  RECEIPT_SERIALIZATION_HOSTILE_FIXTURE_REFS,
  compileReceiptSerializationGate,
  parseStrictReceiptJson,
  serializeReceiptJson,
  validateReceiptJsonBytes,
  validateReceiptSerializationGate,
} from "../control/receipt-serialization-gate.mjs";

const sha = (value) => canonicalDigest({value});
const authority = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  receipt_ref: "ref:authority/receipt-serialization-test",
  receipt_sha256: "c".repeat(64),
};
const custody = {
  compiler_only: true,
  controller_approval_required: false,
  execution_owner: "LANE_AGENT",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  product_mutation: false,
  provider_access: false,
  credential_access: false,
  spend: false,
  destructive_work: false,
  worker_activation: false,
  wave_activation: false,
};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.RECEIPT_SERIALIZATION.MALFORMED", reference: "ref:control-plane/malformed", sha256: sha("malformed")},
  {evidence_id: "EVIDENCE.RECEIPT_SERIALIZATION.READBACK", reference: "ref:control-plane/readback", sha256: sha("readback")},
];

const gate = compileReceiptSerializationGate({
  gateId: "GATE.RECEIPT_SERIALIZATION.5E888C4",
  defectId: "DEFECT.WORKFLOW.RECEIPT_SERIALIZATION.TRAILING_LITERAL_LF.5E888C4",
  authority,
  custody,
  evidenceRefs,
});
assert.equal(gate.schema, RECEIPT_SERIALIZATION_GATE_SCHEMA);
validateReceiptSerializationGate(gate);
assert.deepEqual(gate.hostile_fixture_refs, RECEIPT_SERIALIZATION_HOSTILE_FIXTURE_REFS);

const record = {schema: "fixture.receipt.v1", status: "REPAIR_REQUIRED", record_sha256: null};
record.record_sha256 = canonicalDigest({...record, record_sha256: null});
const validBytes = serializeReceiptJson(record);
assert.equal(validBytes.at(-1), "\n");
assert.notEqual(validBytes.at(-2), "\n");
assert.deepEqual(parseStrictReceiptJson(validBytes), record);
assert.deepEqual(validateReceiptJsonBytes(validBytes, {digestField: "record_sha256", label: "valid fixture"}), record);

const rejects = (bytes, pattern) => assert.throws(() => parseStrictReceiptJson(bytes, {label: "hostile fixture"}), pattern);
rejects(validBytes.slice(0, -1), /terminal LF/u);
rejects(`${validBytes}\n`, /trailing bytes|terminal LF/u);
rejects(`${validBytes.slice(0, -1)}\\n\n`, /JSON\.parse/u);
rejects(`${validBytes.slice(0, -1)}\n{"trailing":true}\n`, /trailing bytes|JSON\.parse/u);
rejects(`${validBytes.slice(0, -1)}\r\n`, /CRLF/u);

const digestDrift = structuredClone(record);
digestDrift.status = "TAMPERED";
assert.throws(() => validateReceiptJsonBytes(serializeReceiptJson(digestDrift), {digestField: "record_sha256"}), /does not match/u);

const missingFixture = structuredClone(gate);
missingFixture.hostile_fixture_refs = missingFixture.hostile_fixture_refs.slice(1);
missingFixture.gate_sha256 = canonicalDigest({...missingFixture, gate_sha256: null});
assert.throws(() => validateReceiptSerializationGate(missingFixture), /fixture coverage is incomplete/u);

const digestTamper = structuredClone(gate);
digestTamper.gate_sha256 = "0".repeat(64);
assert.throws(() => validateReceiptSerializationGate(digestTamper), /digest mismatch/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/receipt-serialization-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, RECEIPT_SERIALIZATION_GATE_SCHEMA);
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.same_turn_dispatch.const, true);
assert.equal(schema.properties.spawnable.const, false);

console.log("PASS receipt serialization gate: strict JSON.parse single-document bytes, exactly one terminal LF, literal-escape/trailing-data rejection, canonical digest revalidation, non-spawnable custody, and hostile coverage");
