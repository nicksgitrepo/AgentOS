#!/usr/bin/env node

/*
 * Portable synthetic Agent Spawner admission round trip.
 *
 * This module is deliberately fixture-oriented: it extracts only digests and
 * typed claims, never raw source, and it never creates a task, seed, worktree,
 * or activation.  The real Spawner may use the same contracts after Bootstrap
 * has admitted an external source train.
 */

import crypto from "node:crypto";
import {
  canonicalDigest as spawnCanonicalDigest,
  compileSpawnPreparation,
  validateSpawnPreparation,
  verifySpawnReadback,
} from "./spawn-preparation.mjs";

export const SYNTHETIC_ROUNDTRIP_SCHEMA = "agentos.spawner_admission_roundtrip.v1";
export const CONTEXT_INCONSISTENCY_SCHEMA = "agentos.context_inconsistency.v1";
export const ADJUDICATION_SCHEMA = "agentos.context_adjudication.v1";
export const MANIFEST_INVALIDATION_SCHEMA = "agentos.role_context_manifest_invalidation.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CLAIM_CATEGORIES = new Set(["authoritative", "inference", "history"]);
const FRESHNESS = new Set(["FRESH", "STALE", "UNKNOWN"]);
const EVIDENCE = new Set(["PROVEN", "UNPROVEN", "MISSING"]);
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key)\s*[:=]/iu;
const AUTHORITY_RANK = Object.freeze({
  HUMAN_SAFETY: 100,
  VERIFIED_LAW: 90,
  OWNER_INTENT: 80,
  ACCEPTED_SOURCE_TRUTH: 70,
  MOST_SPECIFIC_AUTHORITY: 60,
  CHARTER: 50,
  BOUNDED_PLAN: 40,
  CONVENIENCE: 10,
});

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`); }
function requireId(value, label) { requireString(value, label); assert(SAFE_ID.test(value), `${label} has an unsafe identity`); }
function requireSha(value, label, nullable = false) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function digestWithout(value, field) { const body = structuredClone(value); delete body[field]; return spawnCanonicalDigest(body); }
function sorted(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const normalized = [...new Set(values)].sort();
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be sorted and unique`);
  return values;
}

function validateSpawnerDuty(modelDuty) {
  requireRecord(modelDuty, "extractor model duty");
  assert(modelDuty.model === "gpt-5.6-sol", "context extraction requires the owner-authorized Spawner model");
  assert(modelDuty.reasoning_effort === "medium", "context extraction requires medium reasoning");
  assert(modelDuty.role_id === "AGENT_SPAWNER_COMPILER", "context extraction role is not Agent Spawner");
  assert(modelDuty.duty === "CONTEXT_EXTRACTION_AND_GOVERNANCE_BLOCK_COMPILATION", "context extraction duty is too broad");
  assert(modelDuty.owner_exception === true, "context extraction lacks the explicit owner exception");
  assert(modelDuty.cost_boundary === "ONE_NARROW_EXTRACTION_OR_COMPILATION_DUTY", "context extraction cost boundary is missing");
  assert(modelDuty.fallback_model === "gpt-5.6-luna/max", "context extraction fallback is missing");
}

function claimDigest(claim) {
  return spawnCanonicalDigest({
    semantic_key: claim.semantic_key,
    text: claim.text,
    category: claim.category,
    scope: claim.scope,
    authority_class: claim.authority_class,
    freshness: claim.freshness,
    evidence_status: claim.evidence_status,
    generation: claim.generation,
    commit: claim.commit,
    supersession: claim.supersession ?? null,
  });
}

function makeContradictionPacket({source, semanticKey, claims, extractionDigest}) {
  const body = {
    schema: CONTEXT_INCONSISTENCY_SCHEMA,
    version: 1,
    status: "AWAITING_BOOTSTRAP",
    semantic_key: semanticKey,
    source_id: source.source_id,
    source_digest: source.content_sha256,
    extraction_sha256: extractionDigest ?? null,
    statement_refs: claims.map((claim) => claim.statement_id).sort(),
    claim_digests: claims.map((claim) => claim.claim_digest ?? claimDigest(claim)).sort(),
    reason: "Distinct claims share one semantic key; raw contradiction cannot enter a role package.",
    raw_admissible: false,
    mutation: "NONE",
    activation: "OFF",
    packet_sha256: null,
  };
  body.packet_sha256 = digestWithout(body, "packet_sha256");
  return body;
}

/**
 * Extract typed, digest-only claims under the narrow Sol/medium Spawner duty.
 * The raw fixture is caller-owned and is never copied into the receipt.
 */
export function extractTypedContext({source, modelDuty, nowUtc = "1970-01-01T00:00:00.000Z"} = {}) {
  validateSpawnerDuty(modelDuty);
  requireRecord(source, "extraction source");
  requireId(source.source_id, "extraction source.source_id");
  requireSha(source.content_sha256, "extraction source.content_sha256");
  requireString(source.version, "extraction source.version");
  requireUtc(nowUtc, "extraction timestamp");
  assert(Array.isArray(source.raw_claims) && source.raw_claims.length > 0, "extraction source.raw_claims must be nonempty");
  const claims = source.raw_claims.map((claim, index) => {
    requireRecord(claim, `raw_claims[${index}]`);
    for (const field of ["statement_id", "semantic_key", "text", "scope", "authority_class", "commit"]) requireString(claim[field], `raw_claims[${index}].${field}`);
    requireId(claim.statement_id, `raw_claims[${index}].statement_id`);
    assert(CLAIM_CATEGORIES.has(claim.category), `raw_claims[${index}].category is invalid`);
    assert(!SECRET_PATTERN.test(claim.text), `raw_claims[${index}] contains raw secret-like material`);
    assert(Number.isInteger(claim.generation) && claim.generation >= 0, `raw_claims[${index}].generation is invalid`);
    requireSha(claim.commit, `raw_claims[${index}].commit`);
    assert(FRESHNESS.has(claim.freshness), `raw_claims[${index}].freshness is invalid`);
    assert(EVIDENCE.has(claim.evidence_status), `raw_claims[${index}].evidence_status is invalid`);
    return {
      statement_id: claim.statement_id,
      semantic_key: claim.semantic_key,
      claim_digest: claimDigest(claim),
      category: claim.category,
      scope: claim.scope,
      authority_class: claim.authority_class,
      freshness: claim.freshness,
      evidence_status: claim.evidence_status,
      generation: claim.generation,
      commit: claim.commit,
      supersession: claim.supersession ?? null,
    };
  });
  const seen = new Set();
  for (const claim of claims) {
    assert(!seen.has(claim.statement_id), `duplicate extracted statement: ${claim.statement_id}`);
    seen.add(claim.statement_id);
  }
  const grouped = new Map();
  for (const claim of claims) grouped.set(claim.semantic_key, [...(grouped.get(claim.semantic_key) ?? []), claim]);
  const contradictions = [];
  for (const [semanticKey, group] of grouped.entries()) {
    if (new Set(group.map((claim) => claim.claim_digest)).size > 1) contradictions.push(makeContradictionPacket({source, semanticKey, claims: group}));
  }
  const body = {
    schema: SYNTHETIC_ROUNDTRIP_SCHEMA,
    version: 1,
    status: "EXTRACTED",
    source_id: source.source_id,
    source_version: source.version,
    source_digest: source.content_sha256,
    extracted_at_utc: nowUtc,
    model_duty: structuredClone(modelDuty),
    claims,
    contradiction_packet_ids: contradictions.map((packet) => packet.packet_sha256).sort(),
    raw_material_retained: false,
    mutation: "NONE",
    activation: "OFF",
    extraction_sha256: null,
  };
  body.extraction_sha256 = digestWithout(body, "extraction_sha256");
  return {extraction: body, contradictions};
}

function validatePacket(packet) {
  requireRecord(packet, "contradiction packet");
  assert(packet.schema === CONTEXT_INCONSISTENCY_SCHEMA && packet.version === 1, "contradiction packet schema is invalid");
  assert(packet.status === "AWAITING_BOOTSTRAP", "contradiction packet is already adjudicated");
  requireSha(packet.source_digest, "contradiction packet source digest");
  requireSha(packet.packet_sha256, "contradiction packet digest");
  assert(packet.raw_admissible === false && packet.mutation === "NONE" && packet.activation === "OFF", "contradiction packet permits side effects");
  assert(packet.packet_sha256 === digestWithout(packet, "packet_sha256"), "contradiction packet is not content-addressed");
}

function candidateScore(candidate) {
  const authority = AUTHORITY_RANK[candidate.authority_class] ?? 0;
  const fresh = candidate.freshness === "FRESH" ? 1 : 0;
  const evidence = candidate.evidence_status === "PROVEN" ? 1 : 0;
  const ownerIntent = candidate.owner_intent === true ? 1 : 0;
  const scope = Number.isInteger(candidate.scope_specificity) ? candidate.scope_specificity : 0;
  const supersession = candidate.supersession?.status === "SUPERSEDES" ? 1 : 0;
  return [authority, fresh, evidence, ownerIntent, scope, supersession, candidate.generation, candidate.commit];
}

function compareScores(left, right) {
  const a = candidateScore(left);
  const b = candidateScore(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    if (typeof a[index] === "string") return a[index] < b[index] ? -1 : 1;
    return a[index] > b[index] ? -1 : 1;
  }
  return 0;
}

/** Bootstrap-only deterministic contradiction adjudication. */
export function adjudicateContextInconsistency({packet, candidates, ownerIntentDigest = null} = {}) {
  validatePacket(packet);
  assert(Array.isArray(candidates) && candidates.length >= 2, "adjudication requires at least two candidates");
  requireSha(ownerIntentDigest, "owner intent digest", true);
  const normalized = candidates.map((candidate, index) => {
    requireRecord(candidate, `adjudication candidate[${index}]`);
    for (const field of ["candidate_id", "authority_class", "scope", "commit", "freshness", "evidence_status", "claim_digest"]) requireString(candidate[field], `adjudication candidate[${index}].${field}`);
    requireId(candidate.candidate_id, `adjudication candidate[${index}].candidate_id`);
    requireSha(candidate.commit, `adjudication candidate[${index}].commit`);
    requireSha(candidate.claim_digest, `adjudication candidate[${index}].claim_digest`);
    assert(packet.claim_digests.includes(candidate.claim_digest), `adjudication candidate[${index}] is not bound to the contradiction packet`);
    assert(FRESHNESS.has(candidate.freshness) && EVIDENCE.has(candidate.evidence_status), `adjudication candidate[${index}] freshness/evidence is invalid`);
    assert(Number.isInteger(candidate.generation) && candidate.generation >= 0, `adjudication candidate[${index}].generation is invalid`);
    return structuredClone(candidate);
  });
  const eligible = normalized.filter((candidate) => candidate.freshness === "FRESH" && candidate.evidence_status === "PROVEN");
  let status = "UNPROVEN_SOURCE_GAP";
  let selected = null;
  let retained = [];
  let reason = "No candidate has both fresh source evidence and a proven evidence status.";
  if (eligible.length > 0) {
    const ranked = [...eligible].sort(compareScores);
    const top = ranked[0];
    const tie = ranked.filter((candidate) => compareScores(candidate, top) === 0);
    const superseding = ranked.find((candidate) => candidate.supersession?.status === "SUPERSEDES" && candidate.supersession.supersedes_candidate_id);
    const scopes = new Set(ranked.map((candidate) => candidate.scope));
    const intentionalVariants = ranked.every((candidate) => candidate.variant_intentionally_valid === true);
    if (superseding) {
      status = "RESOLVED_BY_SUPERSESSION"; selected = superseding; reason = "A fresh, proven successor explicitly supersedes the predecessor.";
    } else if (tie.length > 1 && scopes.size > 1) {
      status = "RESOLVED_AS_SCOPE_DISTINCTION"; retained = tie.map((candidate) => candidate.candidate_id).sort(); reason = "Both claims are valid only within distinct declared scopes.";
    } else if (tie.length > 1 && intentionalVariants) {
      status = "RETAIN_BOTH_TYPED"; retained = tie.map((candidate) => candidate.candidate_id).sort(); reason = "The equally authoritative variants are explicitly typed as intentionally valid.";
    } else if (tie.length > 1) {
      status = "OWNER_DECISION_REQUIRED"; reason = "Equally ranked fresh, proven claims materially change the route and cannot be silently harmonized.";
    } else {
      status = "RESOLVED_BY_HIGHER_AUTHORITY"; selected = top; reason = "Bootstrap selected the highest authoritative fresh, proven claim using the governed comparison tuple.";
    }
  }
  const body = {
    schema: ADJUDICATION_SCHEMA,
    version: 1,
    status,
    packet_sha256: packet.packet_sha256,
    owner_intent_sha256: ownerIntentDigest,
    selected_candidate_id: selected?.candidate_id ?? null,
    retained_candidate_ids: retained,
    comparison_order: ["authority", "freshness", "evidence", "owner_intent", "scope_specificity", "supersession", "generation", "commit"],
    candidate_ids: normalized.map((candidate) => candidate.candidate_id).sort(),
    reason,
    mutation: "NONE",
    activation: "OFF",
    decision_sha256: null,
  };
  body.decision_sha256 = digestWithout(body, "decision_sha256");
  return body;
}

/** Prevent an unresolved raw packet from entering any role package. */
export function assertContextAdmissible({packets, adjudications} = {}) {
  assert(Array.isArray(packets) && Array.isArray(adjudications), "context admission requires packets and adjudications");
  const byPacket = new Map(adjudications.map((decision) => [decision.packet_sha256, decision]));
  for (const packet of packets) {
    validatePacket(packet);
    const decision = byPacket.get(packet.packet_sha256);
    assert(decision, `CONTEXT_INCONSISTENCY_UNADJUDICATED: ${packet.packet_sha256}`);
    assert(["RESOLVED_BY_HIGHER_AUTHORITY", "RESOLVED_BY_SUPERSESSION", "RESOLVED_AS_SCOPE_DISTINCTION", "RETAIN_BOTH_TYPED"].includes(decision.status), `CONTEXT_INCONSISTENCY_BLOCKS_SEED: ${packet.packet_sha256}`);
  }
  return {schema: "agentos.context_admission_receipt.v1", version: 1, status: "CONTEXT_ADMISSIBLE", packet_sha256s: packets.map((packet) => packet.packet_sha256).sort(), mutation: "NONE", activation: "OFF", receipt_sha256: spawnCanonicalDigest({packet_sha256s: packets.map((packet) => packet.packet_sha256).sort(), status: "CONTEXT_ADMISSIBLE"})};
}

/** A block change invalidates the whole dependent role manifest and forces rebuild. */
export function invalidateRoleContextManifest({manifest, changedBlockId, newDigest, reason = "governing block changed"} = {}) {
  requireRecord(manifest, "role context manifest");
  requireSha(manifest.manifest_sha256, "role context manifest digest");
  assert(manifest.manifest_sha256 === digestWithout(manifest, "manifest_sha256"), "role context manifest is not content-addressed");
  requireId(changedBlockId, "changed block identity");
  requireSha(newDigest, "new block digest");
  assert(manifest.block_refs.some((ref) => ref.block_id === changedBlockId), `changed block is not a manifest dependency: ${changedBlockId}`);
  const body = {
    schema: MANIFEST_INVALIDATION_SCHEMA,
    version: 1,
    status: "INVALIDATED",
    prior_manifest_sha256: manifest.manifest_sha256,
    changed_block_id: changedBlockId,
    new_block_digest: newDigest,
    dependent_block_ids: manifest.block_refs.map((ref) => ref.block_id).sort(),
    reason,
    rebuild_required: true,
    migration_rule: "Freeze the predecessor, rebuild the complete transitive closure, rerun composition QA and independent acceptance, then issue a new manifest digest.",
    mutation: "NONE",
    activation: "OFF",
    invalidation_sha256: null,
  };
  body.invalidation_sha256 = digestWithout(body, "invalidation_sha256");
  return body;
}

export {compileSpawnPreparation, validateSpawnPreparation, verifySpawnReadback};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({schema: SYNTHETIC_ROUNDTRIP_SCHEMA, status: "READY", mutation: "NONE", activation: "OFF"}, null, 2)}\n`);
}
