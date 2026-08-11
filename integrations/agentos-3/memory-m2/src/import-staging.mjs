import { canonicalJson } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

export const IMPORT_STAGE_SCHEMA = "agentos.memory.custody-import-stage.v1";
export const IMPORT_STAGE_ACTION = "CUSTODY_IMPORT_STAGED";
export const IMPORT_DISPOSAL_SCHEMA = "agentos.memory.custody-import-disposal.v1";
export const IMPORT_DISPOSAL_ACTIONS = Object.freeze({
  authorize: "CUSTODY_IMPORT_DISPOSAL_AUTHORIZED",
  complete: "CUSTODY_IMPORT_DISPOSAL_COMPLETED"
});
const DIGEST = /^sha256:[a-z2-7]{52}$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;

export function createImportStageRecord({ project_id, envelope_id, admission_ref,
  recipient_authority_ref, recipient_generation, nonce_identity, source_head,
  payload_manifest_digest, entry_count, staged_at_utc = new Date().toISOString() }) {
  const record = { schema: IMPORT_STAGE_SCHEMA, project_id, envelope_id, admission_ref,
    recipient_authority_ref, recipient_generation, nonce_identity, source_head,
    payload_manifest_digest, entry_count, staged_at_utc };
  invariant(typeof project_id === "string" && DIGEST.test(envelope_id) && OBJECT_REF.test(admission_ref)
    && OBJECT_REF.test(recipient_authority_ref) && Number.isSafeInteger(recipient_generation)
    && recipient_generation >= 0 && typeof nonce_identity === "string" && source_head
    && Number.isSafeInteger(source_head.sequence) && DIGEST.test(source_head.digest)
    && DIGEST.test(payload_manifest_digest) && Number.isSafeInteger(entry_count) && entry_count > 0
    && Number.isFinite(Date.parse(staged_at_utc)) && new Date(Date.parse(staged_at_utc)).toISOString() === staged_at_utc,
  "INVALID_IMPORT_STAGE", "custody import stage record is invalid");
  return record;
}

export function importStageMetadata(record) {
  return { envelope_id: record.envelope_id, admission_ref: record.admission_ref,
    recipient_authority_ref: record.recipient_authority_ref,
    payload_manifest_digest: record.payload_manifest_digest, entry_count: record.entry_count };
}

export function applyImportStageEvent(stages, record, eventBody, admission) {
  invariant(record?.schema === IMPORT_STAGE_SCHEMA
    && canonicalJson(record) === canonicalJson(createImportStageRecord(record)),
  "INVALID_IMPORT_STAGE", "custody import stage record is noncanonical");
  invariant(admission && admission.admission_ref === record.admission_ref
    && admission.envelope_id === record.envelope_id
    && admission.recipient_authority_ref === record.recipient_authority_ref
    && admission.recipient_generation === record.recipient_generation
    && admission.nonce_identity === record.nonce_identity
    && canonicalJson(admission.source_head) === canonicalJson(record.source_head),
  "IMPORT_STAGE_ADMISSION_MISMATCH", "custody import stage does not match durable envelope admission");
  invariant(eventBody.project_id === record.project_id && eventBody.actor === "system.custody-import"
    && eventBody.action === IMPORT_STAGE_ACTION
    && eventBody.subject_ref === `custody-import:${record.envelope_id}` && OBJECT_REF.test(eventBody.object_ref)
    && canonicalJson(eventBody.metadata) === canonicalJson(importStageMetadata(record)),
  "INVALID_IMPORT_STAGE_EVENT", "custody import stage event is invalid");
  invariant(record.staged_at_utc <= eventBody.recorded_at_utc, "IMPORT_STAGE_TIME_ORDER",
    "custody import stage postdates its event");
  invariant(!stages.has(record.envelope_id), "REPLAYED_CUSTODY_IMPORT", "custody envelope was already staged");
  const accepted = { ...record, stage_ref: eventBody.object_ref, event_sequence: eventBody.sequence };
  stages.set(record.envelope_id, accepted);
  return accepted;
}

export function createImportDisposalRecord({ project_id, envelope_id, stage_ref,
  admission_ref, source_head, candidate_receipt_digest, transition,
  prior_disposal_ref = null, recorded_at_utc = new Date().toISOString() }) {
  invariant(["authorize", "complete"].includes(transition) && typeof project_id === "string"
    && DIGEST.test(envelope_id) && OBJECT_REF.test(stage_ref) && OBJECT_REF.test(admission_ref)
    && source_head && Number.isSafeInteger(source_head.sequence) && DIGEST.test(source_head.digest)
    && DIGEST.test(candidate_receipt_digest)
    && (transition === "authorize" ? prior_disposal_ref === null : OBJECT_REF.test(prior_disposal_ref))
    && Number.isFinite(Date.parse(recorded_at_utc))
    && new Date(Date.parse(recorded_at_utc)).toISOString() === recorded_at_utc,
  "INVALID_IMPORT_DISPOSAL", "custody import disposal record is invalid");
  return { schema: IMPORT_DISPOSAL_SCHEMA, project_id, envelope_id, stage_ref, admission_ref,
    source_head, candidate_receipt_digest, transition, prior_disposal_ref, recorded_at_utc };
}

export function importDisposalMetadata(record) {
  return { envelope_id: record.envelope_id, stage_ref: record.stage_ref,
    candidate_receipt_digest: record.candidate_receipt_digest,
    transition: record.transition, prior_disposal_ref: record.prior_disposal_ref };
}

export function applyImportDisposalEvent(disposals, record, eventBody, stage) {
  invariant(record?.schema === IMPORT_DISPOSAL_SCHEMA
    && canonicalJson(record) === canonicalJson(createImportDisposalRecord(record)),
  "INVALID_IMPORT_DISPOSAL", "custody import disposal record is noncanonical");
  invariant(stage && stage.stage_ref === record.stage_ref && stage.admission_ref === record.admission_ref
    && stage.envelope_id === record.envelope_id
    && canonicalJson(stage.source_head) === canonicalJson(record.source_head),
  "IMPORT_DISPOSAL_STAGE_MISMATCH", "custody import disposal does not match signed stage lineage");
  const current = disposals.get(record.envelope_id) ?? null;
  invariant(record.transition === "authorize"
    ? current === null && record.prior_disposal_ref === null
    : current?.status === "authorized" && record.prior_disposal_ref === current.disposal_ref
      && record.candidate_receipt_digest === current.candidate_receipt_digest,
  "IMPORT_DISPOSAL_ORDER", "custody import disposal transition is stale, duplicated, or reordered");
  invariant(eventBody.project_id === record.project_id && eventBody.actor === "system.custody-import-disposal"
    && eventBody.action === IMPORT_DISPOSAL_ACTIONS[record.transition]
    && eventBody.subject_ref === `custody-import:${record.envelope_id}` && OBJECT_REF.test(eventBody.object_ref)
    && canonicalJson(eventBody.metadata) === canonicalJson(importDisposalMetadata(record)),
  "INVALID_IMPORT_DISPOSAL_EVENT", "custody import disposal event is invalid");
  invariant(record.recorded_at_utc <= eventBody.recorded_at_utc, "IMPORT_DISPOSAL_TIME_ORDER",
    "custody import disposal record postdates its event");
  const next = { ...record, status: record.transition === "authorize" ? "authorized" : "completed",
    disposal_ref: eventBody.object_ref, event_sequence: eventBody.sequence };
  disposals.set(record.envelope_id, next);
  return next;
}
