import { createPublicKey } from "node:crypto";
import { canonicalJson } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { custodyRecipientKeyId } from "./custody-envelope.mjs";

export const RECIPIENT_AUTHORITY_SCHEMA = "agentos.memory.custody-recipient-authority.v1";
export const RECIPIENT_ACTIONS = Object.freeze({
  register: "CUSTODY_RECIPIENT_REGISTERED",
  rotate: "CUSTODY_RECIPIENT_ROTATED",
  revoke: "CUSTODY_RECIPIENT_REVOKED"
});
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;

function canonicalUtc(value) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value,
  "INVALID_RECIPIENT_AUTHORITY_TIME", "recipient authority time must be canonical UTC");
}

function recipientId(value) {
  invariant(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value),
    "INVALID_RECIPIENT_ID", "recipient id must be portable lowercase identity text");
  return value;
}

function canonicalX25519(value) {
  let pem;
  try { pem = Buffer.from(createPublicKey(value).export({ type: "spki", format: "pem" })); }
  catch (error) { invariant(false, "INVALID_RECIPIENT_PUBLIC_KEY", "recipient public key is invalid"); }
  invariant(createPublicKey(pem).asymmetricKeyType === "x25519" && pem.equals(Buffer.from(value)),
    "INVALID_RECIPIENT_PUBLIC_KEY", "recipient public key must be canonical X25519 SPKI PEM");
  return pem;
}

export function createRecipientAuthority({ project_id: projectId, recipient_id: id,
  recipient_public_key: suppliedPublicKey = null, transition, current = null, reason,
  created_at_utc: createdAtUtc = new Date().toISOString() }) {
  recipientId(id);
  invariant(typeof projectId === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(projectId),
    "INVALID_RECIPIENT_PROJECT", "recipient authority project id is invalid");
  canonicalUtc(createdAtUtc);
  invariant(["register", "rotate", "revoke"].includes(transition),
    "INVALID_RECIPIENT_TRANSITION", "recipient transition is invalid");
  if (transition === "register") {
    invariant(current === null, "RECIPIENT_ALREADY_REGISTERED", "recipient is already registered");
  } else {
    invariant(current && current.project_id === projectId && current.recipient_id === id,
      "RECIPIENT_AUTHORITY_MISSING", "recipient transition requires current project authority");
    invariant(current.status === "active", "RECIPIENT_AUTHORITY_REVOKED", "revoked recipient authority cannot transition");
    invariant(createdAtUtc >= current.created_at_utc, "RECIPIENT_AUTHORITY_TIME_ROLLBACK",
      "recipient authority time cannot move backwards");
  }
  const publicPem = transition === "revoke" ? Buffer.from(current.public_key_pem) : canonicalX25519(suppliedPublicKey);
  const keyId = custodyRecipientKeyId(publicPem);
  if (transition === "rotate") invariant(keyId !== current.key_id,
    "RECIPIENT_KEY_UNCHANGED", "recipient rotation requires a new key");
  invariant(typeof reason === "string" && reason.length > 0 && reason.normalize("NFC") === reason,
    "INVALID_RECIPIENT_REASON", "recipient transition reason must be non-empty NFC text");
  return {
    schema: RECIPIENT_AUTHORITY_SCHEMA,
    project_id: projectId,
    recipient_id: id,
    transition,
    generation: transition === "register" ? 0 : transition === "rotate" ? current.generation + 1 : current.generation,
    status: transition === "revoke" ? "revoked" : "active",
    key_id: keyId,
    public_key_pem: publicPem.toString("utf8"),
    previous_authority_ref: transition === "register" ? null : current.authority_ref,
    reason,
    created_at_utc: createdAtUtc
  };
}

export function applyRecipientAuthorityEvent(current, record, eventBody) {
  invariant(record && record.schema === RECIPIENT_AUTHORITY_SCHEMA,
    "INVALID_RECIPIENT_AUTHORITY", "recipient authority schema is unsupported");
  const rebuilt = createRecipientAuthority({ project_id: eventBody.project_id, recipient_id: record.recipient_id,
    recipient_public_key: record.transition === "revoke" ? null : Buffer.from(record.public_key_pem),
    transition: record.transition, current, reason: record.reason, created_at_utc: record.created_at_utc });
  invariant(canonicalJson(record) === canonicalJson(rebuilt), "INVALID_RECIPIENT_AUTHORITY",
    "recipient authority is noncanonical, stale, or contains unsupported fields");
  invariant(eventBody.actor === "owner" && eventBody.action === RECIPIENT_ACTIONS[record.transition]
    && eventBody.subject_ref === `custody-recipient:${record.recipient_id}`
    && OBJECT_REF.test(eventBody.object_ref),
  "INVALID_RECIPIENT_AUTHORITY_EVENT", "recipient authority event identity or actor is invalid");
  const expectedMetadata = { recipient_id: record.recipient_id, generation: record.generation,
    key_id: record.key_id, status: record.status, previous_authority_ref: record.previous_authority_ref };
  invariant(canonicalJson(eventBody.metadata) === canonicalJson(expectedMetadata),
    "INVALID_RECIPIENT_AUTHORITY_EVENT", "recipient authority event metadata is invalid");
  invariant(record.created_at_utc <= eventBody.recorded_at_utc,
    "RECIPIENT_AUTHORITY_TIME_ORDER", "recipient authority postdates its signed event");
  invariant(current === null || eventBody.sequence > current.event_sequence,
    "RECIPIENT_AUTHORITY_SEQUENCE_ROLLBACK", "recipient authority event sequence must advance");
  return { ...record, authority_ref: eventBody.object_ref, event_sequence: eventBody.sequence };
}

export function recipientAuthorityMetadata(record) {
  return { recipient_id: record.recipient_id, generation: record.generation,
    key_id: record.key_id, status: record.status, previous_authority_ref: record.previous_authority_ref };
}
