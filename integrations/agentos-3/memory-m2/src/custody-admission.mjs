import { canonicalJson } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

export const CUSTODY_ADMISSION_SCHEMA = "agentos.memory.custody-envelope-admission.v1";
export const CUSTODY_ADMISSION_ACTION = "CUSTODY_ENVELOPE_CONSUMED";
const DIGEST = /^sha256:[a-z2-7]{52}$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;

function canonicalUtc(value) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value,
  "INVALID_CUSTODY_ADMISSION_TIME", "custody admission time must be canonical UTC");
}

export function createCustodyAdmission({ project_id: projectId, recipient_id: recipientId,
  recipient_key_id: recipientKeyId, recipient_generation: recipientGeneration,
  recipient_authority_ref: recipientAuthorityRef, envelope_id: envelopeId,
  nonce_identity: nonceIdentity, source_head: sourceHead,
  consumed_at_utc: consumedAtUtc = new Date().toISOString() }) {
  invariant(typeof projectId === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(projectId),
    "INVALID_CUSTODY_ADMISSION", "custody admission project id is invalid");
  invariant(typeof recipientId === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(recipientId),
    "INVALID_CUSTODY_ADMISSION", "custody admission recipient id is invalid");
  invariant(DIGEST.test(recipientKeyId) && DIGEST.test(envelopeId)
    && OBJECT_REF.test(recipientAuthorityRef),
  "INVALID_CUSTODY_ADMISSION", "custody admission authority identity is invalid");
  invariant(Number.isSafeInteger(recipientGeneration) && recipientGeneration >= 0,
    "INVALID_CUSTODY_ADMISSION", "custody admission generation is invalid");
  invariant(nonceIdentity === `${recipientKeyId}:${nonceIdentity.split(":").at(-1)}`
    && /^[A-Za-z0-9_-]{16}$/.test(nonceIdentity.split(":").at(-1)),
  "INVALID_CUSTODY_ADMISSION", "custody admission nonce identity is invalid");
  invariant(sourceHead && Number.isSafeInteger(sourceHead.sequence) && sourceHead.sequence >= 1
    && DIGEST.test(sourceHead.digest), "INVALID_CUSTODY_ADMISSION", "custody admission source head is invalid");
  canonicalUtc(consumedAtUtc);
  return { schema: CUSTODY_ADMISSION_SCHEMA, project_id: projectId, recipient_id: recipientId,
    recipient_key_id: recipientKeyId, recipient_generation: recipientGeneration,
    recipient_authority_ref: recipientAuthorityRef, envelope_id: envelopeId,
    nonce_identity: nonceIdentity, source_head: sourceHead, consumed_at_utc: consumedAtUtc };
}

export function custodyAdmissionMetadata(record) {
  return { recipient_id: record.recipient_id, recipient_generation: record.recipient_generation,
    recipient_authority_ref: record.recipient_authority_ref, envelope_id: record.envelope_id,
    nonce_identity: record.nonce_identity, source_head: record.source_head };
}

export function applyCustodyAdmissionEvent({ envelopeAdmissions, nonceAdmissions }, record, eventBody,
  recipientAuthority) {
  invariant(record?.schema === CUSTODY_ADMISSION_SCHEMA,
    "INVALID_CUSTODY_ADMISSION", "custody admission schema is unsupported");
  const rebuilt = createCustodyAdmission(record);
  invariant(canonicalJson(record) === canonicalJson(rebuilt), "INVALID_CUSTODY_ADMISSION",
    "custody admission is noncanonical or contains unsupported fields");
  invariant(recipientAuthority && recipientAuthority.status === "active"
    && recipientAuthority.recipient_id === record.recipient_id
    && recipientAuthority.key_id === record.recipient_key_id
    && recipientAuthority.generation === record.recipient_generation
    && recipientAuthority.authority_ref === record.recipient_authority_ref,
  "STALE_CUSTODY_RECIPIENT_AUTHORITY", "custody admission recipient authority is stale or revoked");
  invariant(eventBody.actor === "system.custody-envelope"
    && eventBody.project_id === record.project_id
    && eventBody.action === CUSTODY_ADMISSION_ACTION
    && eventBody.subject_ref === `custody-envelope:${record.envelope_id}`
    && OBJECT_REF.test(eventBody.object_ref),
  "INVALID_CUSTODY_ADMISSION_EVENT", "custody admission event identity or actor is invalid");
  invariant(canonicalJson(eventBody.metadata) === canonicalJson(custodyAdmissionMetadata(record)),
    "INVALID_CUSTODY_ADMISSION_EVENT", "custody admission event metadata is invalid");
  invariant(record.consumed_at_utc <= eventBody.recorded_at_utc,
    "CUSTODY_ADMISSION_TIME_ORDER", "custody admission postdates its signed event");
  invariant(record.source_head.sequence === eventBody.sequence - 1
    && record.source_head.digest === eventBody.previous_digest,
  "STALE_CUSTODY_ADMISSION_HEAD", "custody admission source head is not the exact event predecessor");
  invariant(!envelopeAdmissions.has(record.envelope_id), "DUPLICATE_CUSTODY_ENVELOPE",
    "custody envelope was already consumed");
  invariant(!nonceAdmissions.has(record.nonce_identity), "DUPLICATE_CUSTODY_NONCE",
    "custody recipient nonce was already consumed");
  const accepted = { ...record, admission_ref: eventBody.object_ref, event_sequence: eventBody.sequence };
  envelopeAdmissions.set(record.envelope_id, accepted);
  nonceAdmissions.set(record.nonce_identity, accepted);
  return accepted;
}
