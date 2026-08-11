import { createPublicKey, sign, verify } from "node:crypto";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

const BODY_SCHEMA = "agentos.memory.emergency_key_recovery.v1";
const CERT_SCHEMA = "agentos.memory.emergency_key_recovery_certificate.v1";
const DOMAIN = Buffer.from("agentos.memory.emergency-key-recovery.v1\0", "utf8");

function publicPem(value, label) {
  let canonical;
  try { canonical = Buffer.from(createPublicKey(value).export({ type: "spki", format: "pem" })); }
  catch (error) { invariant(false, "INVALID_RECOVERY_KEY", `${label} is invalid`, { cause: error.message }); }
  invariant(canonical.equals(Buffer.from(value)), "NON_CANONICAL_RECOVERY_KEY", `${label} must be canonical SPKI PEM`);
  return canonical;
}

function publicFromPrivate(value, label) {
  try { return Buffer.from(createPublicKey(value).export({ type: "spki", format: "pem" })); }
  catch (error) { invariant(false, "INVALID_RECOVERY_PRIVATE_KEY", `${label} is invalid`, { cause: error.message }); }
}

function keyId(pem) { return sha256Ref("agentos.memory.public-key.v1", pem); }
function bytes(body) { return Buffer.concat([DOMAIN, canonicalBytes(body)]); }

export function createEmergencyRecoveryCertificate({ project_id, compromised_key_id, compromised_generation,
  revocation_evidence_ref, recovery_event_sequence, next_private_key, next_public_key,
  recovery_authorities, created_at_utc = new Date().toISOString() }) {
  invariant(Array.isArray(recovery_authorities) && recovery_authorities.length === 2,
    "RECOVERY_DUAL_CONTROL_REQUIRED", "exactly two recovery authorities are required");
  const authorities = recovery_authorities.map(({ principal, private_key, public_key }) => {
    const pem = publicPem(public_key, `recovery public key ${principal}`);
    invariant(publicFromPrivate(private_key, `recovery private key ${principal}`).equals(pem),
      "RECOVERY_KEY_MISMATCH", `recovery key mismatch for ${principal}`);
    return { principal, private_key, public_key: pem, key_id: keyId(pem) };
  });
  invariant(authorities[0].principal !== authorities[1].principal && authorities[0].key_id !== authorities[1].key_id,
    "RECOVERY_PRINCIPALS_NOT_DISTINCT", "recovery authorities must be distinct principals and keys");
  const nextPem = publicPem(next_public_key, "replacement public key");
  invariant(publicFromPrivate(next_private_key, "replacement private key").equals(nextPem),
    "REPLACEMENT_KEY_MISMATCH", "replacement private key does not match replacement public key");
  const body = { schema: BODY_SCHEMA, project_id, compromised_key_id, compromised_generation,
    revocation_evidence_ref, recovery_event_sequence, next_key_id: keyId(nextPem),
    next_public_key_pem: nextPem.toString("utf8"), created_at_utc };
  const signingBytes = bytes(body);
  return { schema: CERT_SCHEMA, body, signature_profile: "pure-ed25519-v1",
    recovery_signatures: authorities.map(({ principal, key_id, private_key }) => ({ principal, key_id,
      signature: sign(null, signingBytes, private_key).toString("base64url") })),
    replacement_possession_signature: sign(null, signingBytes, next_private_key).toString("base64url") };
}

export function verifyEmergencyRecoveryCertificate(certificate, { project_id, compromised_key_id,
  compromised_generation, revocation_evidence_ref, recovery_event_sequence, recovery_authorities }) {
  invariant(certificate?.schema === CERT_SCHEMA && certificate.signature_profile === "pure-ed25519-v1",
    "INVALID_RECOVERY_CERTIFICATE", "unsupported recovery certificate");
  const exactCertificate = { schema: CERT_SCHEMA, body: certificate.body, signature_profile: "pure-ed25519-v1",
    recovery_signatures: certificate.recovery_signatures,
    replacement_possession_signature: certificate.replacement_possession_signature };
  invariant(canonicalJson(certificate) === canonicalJson(exactCertificate), "INVALID_RECOVERY_CERTIFICATE",
    "recovery certificate contains unsupported fields");
  const body = certificate.body;
  const nextPem = publicPem(body?.next_public_key_pem, "replacement public key");
  const expectedBody = { schema: BODY_SCHEMA, project_id, compromised_key_id, compromised_generation,
    revocation_evidence_ref, recovery_event_sequence, next_key_id: keyId(nextPem),
    next_public_key_pem: nextPem.toString("utf8"), created_at_utc: body.created_at_utc };
  invariant(canonicalJson(body) === canonicalJson(expectedBody), "RECOVERY_BINDING_MISMATCH",
    "recovery certificate binding is wrong or noncanonical");
  invariant(typeof body.created_at_utc === "string" && new Date(Date.parse(body.created_at_utc)).toISOString() === body.created_at_utc,
    "INVALID_RECOVERY_TIME", "recovery time must be canonical UTC");
  invariant(Array.isArray(certificate.recovery_signatures) && certificate.recovery_signatures.length === 2,
    "RECOVERY_DUAL_CONTROL_REQUIRED", "two recovery signatures are required");
  const authorityMap = new Map(recovery_authorities.map(({ principal, public_key }) => {
    const pem = publicPem(public_key, `recovery public key ${principal}`);
    return [principal, { pem, key_id: keyId(pem) }];
  }));
  invariant(certificate.recovery_signatures.every((proof, index) => proof.principal === recovery_authorities[index]?.principal),
    "RECOVERY_SIGNATURE_ORDER", "recovery signatures must follow the configured authority order");
  const seen = new Set();
  for (const proof of certificate.recovery_signatures) {
    invariant(!seen.has(proof.principal), "RECOVERY_PRINCIPALS_NOT_DISTINCT", "one principal cannot satisfy both controls");
    seen.add(proof.principal);
    const authority = authorityMap.get(proof.principal);
    invariant(authority && proof.key_id === authority.key_id, "UNAUTHORIZED_RECOVERY_PRINCIPAL",
      "recovery signature is not from a bound authority");
    invariant(verify(null, bytes(body), authority.pem, Buffer.from(proof.signature, "base64url")),
      "RECOVERY_SIGNATURE_INVALID", `invalid recovery signature for ${proof.principal}`);
  }
  invariant(seen.size === 2, "RECOVERY_DUAL_CONTROL_REQUIRED", "two distinct recovery principals are required");
  invariant(verify(null, bytes(body), nextPem, Buffer.from(certificate.replacement_possession_signature, "base64url")),
    "REPLACEMENT_POSSESSION_INVALID", "replacement key did not prove possession");
  return { next_key_id: body.next_key_id, next_public_key_pem: body.next_public_key_pem };
}
