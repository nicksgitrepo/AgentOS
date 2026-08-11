import { createPublicKey, sign, verify } from "node:crypto";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

const ROTATION_BODY_SCHEMA = "agentos.memory.signing_key_rotation.v1";
const ROTATION_CERTIFICATE_SCHEMA = "agentos.memory.signing_key_rotation_certificate.v1";
const SIGNATURE_PROFILE = "pure-ed25519-v1";
const DOMAIN = Buffer.from("agentos.memory.signing-key-rotation.v1\0", "utf8");

function publicPem(value, label) {
  invariant(typeof value === "string" || Buffer.isBuffer(value), "INVALID_PUBLIC_KEY", `${label} is required`);
  const supplied = Buffer.from(value);
  let canonical;
  try {
    canonical = Buffer.from(createPublicKey(supplied).export({ type: "spki", format: "pem" }));
  } catch (error) {
    invariant(false, "INVALID_PUBLIC_KEY", `${label} is not a valid public key`, { cause: error.message });
  }
  invariant(canonical.equals(supplied), "NON_CANONICAL_PUBLIC_KEY", `${label} must use canonical SPKI PEM encoding`);
  return canonical;
}

function publicFromPrivate(value, label) {
  invariant(typeof value === "string" || Buffer.isBuffer(value), "INVALID_PRIVATE_KEY", `${label} is required`);
  try {
    return Buffer.from(createPublicKey(value).export({ type: "spki", format: "pem" }));
  } catch (error) {
    invariant(false, "INVALID_PRIVATE_KEY", `${label} is not a valid private key`, { cause: error.message });
  }
}

function keyId(pem) {
  return sha256Ref("agentos.memory.public-key.v1", pem);
}

function signingBytes(body) {
  return Buffer.concat([DOMAIN, canonicalBytes(body)]);
}

function validateBody(body, { projectId, previousPublicKey }) {
  invariant(body && typeof body === "object" && !Array.isArray(body), "INVALID_ROTATION_BODY", "rotation body must be an object");
  const priorPem = publicPem(previousPublicKey, "previous public key");
  const nextPem = publicPem(body.next_public_key_pem, "next public key");
  const expected = {
    schema: ROTATION_BODY_SCHEMA,
    project_id: projectId,
    previous_key_id: keyId(priorPem),
    next_key_id: keyId(nextPem),
    next_public_key_pem: nextPem.toString("utf8"),
    effective_after_sequence: body.effective_after_sequence,
    reason: body.reason,
    created_at_utc: body.created_at_utc
  };
  invariant(canonicalJson(body) === canonicalJson(expected), "INVALID_ROTATION_BODY",
    "rotation body is noncanonical, mismatched, or contains unsupported fields");
  invariant(typeof projectId === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(projectId),
    "INVALID_PROJECT_ID", "project id is invalid");
  invariant(body.project_id === projectId, "ROTATION_PROJECT_MISMATCH", "rotation belongs to another project");
  invariant(body.previous_key_id !== body.next_key_id, "ROTATION_KEY_UNCHANGED", "rotation requires a different next key");
  invariant(Number.isSafeInteger(body.effective_after_sequence) && body.effective_after_sequence >= 1,
    "INVALID_ROTATION_SEQUENCE", "effective_after_sequence must be a positive safe integer");
  invariant(typeof body.reason === "string" && body.reason.length > 0 && body.reason.normalize("NFC") === body.reason,
    "INVALID_ROTATION_REASON", "rotation reason must be non-empty NFC text");
  invariant(typeof body.created_at_utc === "string" && Number.isFinite(Date.parse(body.created_at_utc))
    && new Date(Date.parse(body.created_at_utc)).toISOString() === body.created_at_utc,
    "INVALID_ROTATION_TIMESTAMP", "rotation timestamp must be canonical UTC");
  return { priorPem, nextPem };
}

export function createRotationCertificate({
  project_id: projectId,
  previous_private_key: previousPrivateKey,
  previous_public_key: previousPublicKey,
  next_private_key: nextPrivateKey,
  next_public_key: nextPublicKey,
  effective_after_sequence: effectiveAfterSequence,
  reason,
  created_at_utc: createdAtUtc = new Date().toISOString()
}) {
  const priorPem = publicPem(previousPublicKey, "previous public key");
  const nextPem = publicPem(nextPublicKey, "next public key");
  invariant(publicFromPrivate(previousPrivateKey, "previous private key").equals(priorPem),
    "PREVIOUS_KEY_MISMATCH", "previous private key does not match previous public key");
  invariant(publicFromPrivate(nextPrivateKey, "next private key").equals(nextPem),
    "NEXT_KEY_MISMATCH", "next private key does not match next public key");
  const body = {
    schema: ROTATION_BODY_SCHEMA,
    project_id: projectId,
    previous_key_id: keyId(priorPem),
    next_key_id: keyId(nextPem),
    next_public_key_pem: nextPem.toString("utf8"),
    effective_after_sequence: effectiveAfterSequence,
    reason,
    created_at_utc: createdAtUtc
  };
  validateBody(body, { projectId, previousPublicKey: priorPem });
  const bytes = signingBytes(body);
  return {
    schema: ROTATION_CERTIFICATE_SCHEMA,
    body,
    signature_profile: SIGNATURE_PROFILE,
    previous_signature: sign(null, bytes, previousPrivateKey).toString("base64url"),
    next_signature: sign(null, bytes, nextPrivateKey).toString("base64url")
  };
}

export function verifyRotationCertificate(certificate, { project_id: projectId, previous_public_key: previousPublicKey }) {
  invariant(certificate && typeof certificate === "object" && !Array.isArray(certificate),
    "INVALID_ROTATION_CERTIFICATE", "rotation certificate must be an object");
  const expected = {
    schema: ROTATION_CERTIFICATE_SCHEMA,
    body: certificate.body,
    signature_profile: SIGNATURE_PROFILE,
    previous_signature: certificate.previous_signature,
    next_signature: certificate.next_signature
  };
  invariant(canonicalJson(certificate) === canonicalJson(expected), "INVALID_ROTATION_CERTIFICATE",
    "rotation certificate contains unsupported fields");
  invariant(certificate.signature_profile === SIGNATURE_PROFILE, "INVALID_ROTATION_SIGNATURE_PROFILE",
    "rotation certificate has unsupported signature profile");
  invariant(typeof certificate.previous_signature === "string" && typeof certificate.next_signature === "string",
    "INVALID_ROTATION_CERTIFICATE", "rotation certificate signatures are required");
  const { priorPem, nextPem } = validateBody(certificate.body, { projectId, previousPublicKey });
  const bytes = signingBytes(certificate.body);
  invariant(verify(null, bytes, priorPem, Buffer.from(certificate.previous_signature, "base64url")),
    "PREVIOUS_ROTATION_SIGNATURE_INVALID", "outgoing key did not authorize rotation");
  invariant(verify(null, bytes, nextPem, Buffer.from(certificate.next_signature, "base64url")),
    "NEXT_ROTATION_SIGNATURE_INVALID", "incoming key did not prove possession");
  return {
    ok: true,
    project_id: projectId,
    previous_key_id: certificate.body.previous_key_id,
    next_key_id: certificate.body.next_key_id,
    next_public_key_pem: certificate.body.next_public_key_pem,
    effective_after_sequence: certificate.body.effective_after_sequence
  };
}

export function advanceSigningKey(certificate, {
  project_id: projectId,
  current_public_key: currentPublicKey,
  rotation_event_sequence: rotationEventSequence
}) {
  invariant(Number.isSafeInteger(rotationEventSequence) && rotationEventSequence >= 1,
    "INVALID_ROTATION_SEQUENCE", "rotation event sequence must be a positive safe integer");
  const verified = verifyRotationCertificate(certificate, {
    project_id: projectId,
    previous_public_key: currentPublicKey
  });
  invariant(verified.effective_after_sequence === rotationEventSequence, "ROTATION_SEQUENCE_MISMATCH",
    "rotation certificate is not bound to this authority-event sequence");
  return {
    previous_key_id: verified.previous_key_id,
    active_key_id: verified.next_key_id,
    active_public_key_pem: verified.next_public_key_pem,
    activated_after_sequence: rotationEventSequence
  };
}

export const keyLifecycleInternals = {
  ROTATION_BODY_SCHEMA,
  ROTATION_CERTIFICATE_SCHEMA,
  SIGNATURE_PROFILE,
  signingBytes
};
