import { constants } from "node:fs";
import { link, lstat, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes, sign, verify } from "node:crypto";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { atomicWrite, fsyncDir } from "./io.mjs";

const SCHEMA = "agentos.memory.transition_journal.v1";
const PHASES = ["prepared", "authority_committed", "state_published", "cleanup_complete"];
const KINDS = new Set(["rotation", "revocation", "recovery"]);
const DIGEST = /^sha256:[a-z2-7]{52}$/;
const OBJECT = /^obj_[a-z2-7]{52}$/;
const DOMAIN = Buffer.from("agentos.memory.transition-journal-phase.v1\0", "utf8");

function exact(value, keys, code) {
  invariant(value && typeof value === "object" && !Array.isArray(value)
    && canonicalJson(Object.fromEntries(keys.map((key) => [key, value[key]]))) === canonicalJson(value),
  code, "journal record is missing fields or contains unsupported fields");
}

function validateBase(base) {
  exact(base, ["schema", "project_id", "transition_kind", "transition_id", "prior", "intended", "authority", "evidence"],
    "INVALID_JOURNAL_BODY");
  invariant(base.schema === SCHEMA && typeof base.project_id === "string" && KINDS.has(base.transition_kind)
    && typeof base.transition_id === "string" && /^[0-9a-f-]{36}$/.test(base.transition_id),
  "INVALID_JOURNAL_BODY", "journal identity or transition kind is invalid");
  for (const [label, state] of [["prior", base.prior], ["intended", base.intended]]) {
    exact(state, ["generation", "key_id", "head_sequence", "head_digest", "state_digest"], "INVALID_JOURNAL_STATE");
    invariant(Number.isSafeInteger(state.generation) && state.generation >= 0 && DIGEST.test(state.key_id)
      && Number.isSafeInteger(state.head_sequence) && state.head_sequence >= 1
      && DIGEST.test(state.head_digest) && DIGEST.test(state.state_digest),
    "INVALID_JOURNAL_STATE", `${label} state binding is invalid`);
  }
  exact(base.authority, ["event_sequence", "event_digest", "object_ref"], "INVALID_JOURNAL_AUTHORITY");
  invariant(base.authority.event_sequence === base.intended.head_sequence
    && DIGEST.test(base.authority.event_digest) && base.authority.event_digest === base.intended.head_digest
    && OBJECT.test(base.authority.object_ref), "INVALID_JOURNAL_AUTHORITY", "authority event binding is invalid");
  invariant(base.prior.head_sequence + 1 === base.intended.head_sequence,
    "INVALID_JOURNAL_SEQUENCE", "transition must advance exactly one authority sequence");
  const evidenceKeys = base.transition_kind === "rotation" ? ["rotation_certificate_ref"]
    : base.transition_kind === "revocation" ? ["revocation_evidence_ref"]
      : ["revocation_evidence_ref", "recovery_certificate_ref", "recovery_principals", "replacement_possession_key_id"];
  exact(base.evidence, evidenceKeys, "INVALID_JOURNAL_EVIDENCE");
  for (const [key, value] of Object.entries(base.evidence)) {
    if (key.endsWith("_ref")) invariant(OBJECT.test(value), "INVALID_JOURNAL_EVIDENCE", `${key} is invalid`);
  }
  if (base.transition_kind === "recovery") {
    invariant(Array.isArray(base.evidence.recovery_principals) && base.evidence.recovery_principals.length === 2
      && base.evidence.recovery_principals[0] !== base.evidence.recovery_principals[1]
      && DIGEST.test(base.evidence.replacement_possession_key_id),
    "INVALID_JOURNAL_EVIDENCE", "recovery evidence does not establish dual control and replacement possession");
  }
}

function phaseBytes(baseDigest, entry) {
  return Buffer.concat([DOMAIN, canonicalBytes({ journal_body_digest: baseDigest, index: entry.index,
    phase: entry.phase, previous_phase_digest: entry.previous_phase_digest, recorded_at_utc: entry.recorded_at_utc })]);
}

function canonicalUtc(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

export function createTransitionJournal(base, { writer_private_key, recorded_at_utc = new Date().toISOString() }) {
  validateBase(base);
  invariant(canonicalUtc(recorded_at_utc), "INVALID_JOURNAL_TIME", "journal phase time must be canonical UTC");
  const baseDigest = sha256Ref("agentos.memory.transition-journal-body.v1", canonicalBytes(base));
  const entry = { index: 0, phase: "prepared", previous_phase_digest: null, recorded_at_utc };
  const signature = sign(null, phaseBytes(baseDigest, entry), writer_private_key).toString("base64url");
  return { schema: SCHEMA, base, base_digest: baseDigest, phases: [{ ...entry, signature }] };
}

export function advanceTransitionJournal(journal, nextPhase, { writer_private_key, recorded_at_utc = new Date().toISOString() }) {
  invariant(PHASES[journal.phases.length] === nextPhase, "JOURNAL_PHASE_ORDER", "journal phase cannot skip, repeat, or regress");
  invariant(canonicalUtc(recorded_at_utc), "INVALID_JOURNAL_TIME", "journal phase time must be canonical UTC");
  const previous = journal.phases.at(-1);
  const entry = { index: journal.phases.length, phase: nextPhase,
    previous_phase_digest: sha256Ref("agentos.memory.transition-journal-phase.v1", canonicalBytes(previous)),
    recorded_at_utc };
  const signature = sign(null, phaseBytes(journal.base_digest, entry), writer_private_key).toString("base64url");
  return { ...journal, phases: [...journal.phases, { ...entry, signature }] };
}

export function verifyTransitionJournal(journal, { project_id, writer_public_key }) {
  exact(journal, ["schema", "base", "base_digest", "phases"], "INVALID_TRANSITION_JOURNAL");
  invariant(journal.schema === SCHEMA, "INVALID_TRANSITION_JOURNAL", "unsupported journal schema");
  validateBase(journal.base);
  invariant(journal.base.project_id === project_id, "JOURNAL_PROJECT_MISMATCH", "journal belongs to another project");
  const baseDigest = sha256Ref("agentos.memory.transition-journal-body.v1", canonicalBytes(journal.base));
  invariant(journal.base_digest === baseDigest, "JOURNAL_BODY_DIGEST_MISMATCH", "journal body digest mismatch");
  invariant(Array.isArray(journal.phases) && journal.phases.length >= 1 && journal.phases.length <= PHASES.length,
    "INVALID_JOURNAL_PHASES", "journal phase history is invalid");
  let prior = null;
  for (let index = 0; index < journal.phases.length; index += 1) {
    const entry = journal.phases[index];
    exact(entry, ["index", "phase", "previous_phase_digest", "recorded_at_utc", "signature"], "INVALID_JOURNAL_PHASE");
    invariant(entry.index === index && entry.phase === PHASES[index]
      && canonicalUtc(entry.recorded_at_utc)
      && entry.previous_phase_digest === (prior === null ? null
        : sha256Ref("agentos.memory.transition-journal-phase.v1", canonicalBytes(prior)))
      && (prior === null || entry.recorded_at_utc >= prior.recorded_at_utc),
    "JOURNAL_PHASE_ORDER", "journal phase history is reordered, gapped, or rolled back");
    invariant(verify(null, phaseBytes(baseDigest, entry), writer_public_key, Buffer.from(entry.signature, "base64url")),
      "JOURNAL_SIGNATURE_INVALID", `journal phase ${index} signature is invalid`);
    prior = entry;
  }
  return { ok: true, transition_id: journal.base.transition_id, phase: prior.phase, base: journal.base };
}

function sameProjection(actual, expected) {
  return actual && actual.generation === expected.generation && actual.state_digest === expected.state_digest;
}

function sameKey(actual, expected) {
  return actual && actual.key_id === expected.key_id;
}

function sameHead(actual, expected) {
  return actual && actual.head_sequence === expected.head_sequence && actual.head_digest === expected.head_digest;
}

export function decideTransitionJournalOutcome(journal, { durable_event: durableEvent = null, durable_state: durableState }) {
  const prior = journal.base.prior;
  const intended = journal.base.intended;
  invariant((sameProjection(durableState, prior) || sameProjection(durableState, intended))
    && (sameKey(durableState, prior) || sameKey(durableState, intended)), "JOURNAL_DURABLE_STATE_MISMATCH",
  "durable key or state does not match either authenticated journal boundary");
  if (durableEvent === null) {
    invariant(journal.phases.length === 1 && journal.phases[0].phase === "prepared",
      "JOURNAL_EVENT_MISSING", "a journal advanced beyond preparation without its authority event");
    invariant(sameProjection(durableState, prior) && sameKey(durableState, prior) && sameHead(durableState, prior),
      "JOURNAL_PREMATURE_STATE",
      "intended state cannot be visible before the authority event exists");
    return { outcome: "retain_prior", transition_id: journal.base.transition_id };
  }
  exact(durableEvent, ["sequence", "digest", "object_ref"], "INVALID_DURABLE_EVENT_RECEIPT");
  invariant(durableEvent.sequence === journal.base.authority.event_sequence
    && durableEvent.digest === journal.base.authority.event_digest
    && durableEvent.object_ref === journal.base.authority.object_ref,
  "JOURNAL_AUTHORITY_EVENT_MISMATCH", "durable authority event does not match the authenticated journal");
  invariant(sameHead(durableState, prior) || sameHead(durableState, intended), "JOURNAL_DURABLE_HEAD_MISMATCH",
    "durable head does not match either authenticated journal boundary");
  return { outcome: sameProjection(durableState, intended) && sameKey(durableState, intended)
    && sameHead(durableState, intended)
    ? "cleanup_committed" : "finalize_intended",
    transition_id: journal.base.transition_id };
}

async function privateRegular(path) {
  const info = await lstat(path);
  invariant(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    "INVALID_JOURNAL_CUSTODY", "transition journal must be a private regular file");
}

export async function publishTransitionJournal(root, journal) {
  const path = join(root, "state", "transition-journal.json");
  const temp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(`${canonicalJson(journal)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp, path); } finally { await rm(temp, { force: true }); }
  await fsyncDir(dirname(path));
  return path;
}

export async function replaceTransitionJournal(path, journal) {
  await privateRegular(path);
  await atomicWrite(path, Buffer.from(`${canonicalJson(journal)}\n`), 0o600);
}

export async function readTransitionJournal(path, options) {
  await privateRegular(path);
  const raw = await readFile(path);
  let journal;
  try { journal = JSON.parse(raw.toString("utf8")); } catch { invariant(false, "INVALID_TRANSITION_JOURNAL", "journal is not JSON"); }
  invariant(raw.equals(Buffer.from(`${canonicalJson(journal)}\n`)), "NON_CANONICAL_TRANSITION_JOURNAL", "journal is not canonical");
  verifyTransitionJournal(journal, options);
  return journal;
}
