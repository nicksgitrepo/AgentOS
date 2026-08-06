import {assert, digestWithout, sha256} from "./canonical-json.mjs";
import {validateIdentity} from "./evidence.mjs";
import {validateRenderedGate} from "./question-catalog.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {assertOpaqueReference, isOpaqueReference, sessionReference} from "./opaque-reference.mjs";

export const GATE_RESPONSE_SCHEMA = "agentos.gate_response.v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const ANSWERS = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function validateIssuer(issuer_session_id, issuer_kind, identity) {
  assertOpaqueReference(issuer_session_id, "session", "gate response issuer_session_id");
  assert(issuer_session_id !== identity.session_id, "gate response issuer must differ from the worker");
  assert(["HOST_READBACK", "INDEPENDENT_AUDITOR"].includes(issuer_kind), "gate response issuer_kind is invalid");
}

function expectedStatement(rendered, answer) {
  return answer === "YES"
    ? rendered.response_template
    : `Gate "${rendered.gate_name}" did not pass; follow the displayed route.`;
}

export function createGateResponse({rendered, answer, evidence, identity, issuer_session_id, issuer_kind}) {
  validateRenderedGate(rendered);
  assert(ANSWERS.includes(answer), "gate response answer is invalid");
  const normalizedIdentity = {...identity};
  if (!isOpaqueReference(normalizedIdentity.session_id, "session")) normalizedIdentity.session_id = sessionReference(normalizedIdentity.session_id, normalizedIdentity);
  validateIdentity(normalizedIdentity, "gate response identity");
  const normalizedIssuer = isOpaqueReference(issuer_session_id, "session") ? issuer_session_id : sessionReference(issuer_session_id, normalizedIdentity);
  validateIssuer(normalizedIssuer, issuer_kind, normalizedIdentity);
  const response = {
    schema: GATE_RESPONSE_SCHEMA,
    version: 1,
    graph_id: rendered.graph_id,
    gate_id: rendered.gate_id,
    gate_name: rendered.gate_name,
    context: rendered.context,
    question: rendered.question,
    answer,
    statement: expectedStatement(rendered, answer),
    evidence_digest: sha256(evidence),
    identity: normalizedIdentity,
    issuer_session_id: normalizedIssuer,
    issuer_kind,
    status: answer === "YES" ? "PASS" : "ROUTED",
    digest: null,
  };
  response.digest = digestWithout(response, "digest");
  return validateGateResponse(response, rendered, {evidence});
}

export function validateGateResponse(response, rendered, {evidence = undefined, expectedIdentity = null, requireIndependent = false} = {}) {
  assertPortableRecord(response, "gate response");
  validateRenderedGate(rendered);
  exactKeys(response, ["schema", "version", "graph_id", "gate_id", "gate_name", "context", "question", "answer", "statement", "evidence_digest", "identity", "issuer_session_id", "issuer_kind", "status", "digest"], "gate response");
  assert(response.schema === GATE_RESPONSE_SCHEMA && response.version === 1, "gate response identity is invalid");
  assert(response.graph_id === rendered.graph_id && response.gate_id === rendered.gate_id, "gate response names a different gate");
  assert(response.gate_name === rendered.gate_name && response.context === rendered.context && response.question === rendered.question, "gate response display does not match the gate");
  assert(ANSWERS.includes(response.answer), "gate response answer is invalid");
  assert(response.statement === expectedStatement(rendered, response.answer), "gate response statement is not the governed statement");
  assert(response.status === (response.answer === "YES" ? "PASS" : "ROUTED"), "gate response status does not match its answer");
  assert(DIGEST.test(response.evidence_digest), "gate response evidence_digest is invalid");
  validateIdentity(response.identity, "gate response identity");
  validateIssuer(response.issuer_session_id, response.issuer_kind, response.identity);
  if (requireIndependent) assert(response.issuer_kind === "INDEPENDENT_AUDITOR", "gate response requires an Independent Auditor");
  if (expectedIdentity) {
    const normalizedExpected = {...expectedIdentity};
    if (!isOpaqueReference(normalizedExpected.session_id, "session")) normalizedExpected.session_id = sessionReference(normalizedExpected.session_id, normalizedExpected);
    for (const field of Object.keys(normalizedExpected)) assert(response.identity[field] === normalizedExpected[field], `gate response identity ${field} differs`);
  }
  if (evidence !== undefined) assert(response.evidence_digest === sha256(evidence), "gate response evidence digest differs from the evidence");
  assert(DIGEST.test(response.digest) && response.digest === digestWithout(response, "digest"), "gate response digest does not match content");
  return response;
}
