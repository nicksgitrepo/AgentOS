#!/usr/bin/env node

/*
 * Portable Blueprint publication and coordination contract.
 *
 * A Blueprint is a sealed, content-addressed release.  Consumers read the
 * release and index files directly and prove one fresh repair preflight; they
 * do not coordinate through per-issue messages.  This module deliberately has
 * no product, host, task, or provider knowledge.
 */

import fs from "node:fs";
import path from "node:path";
import {
  canonicalDigest,
  compareUtf8,
} from "./content-addressing.mjs";

export const BLUEPRINT_RELEASE_SCHEMA = "agentos.blueprint_release_governance.v1";
export const BLUEPRINT_INDEX_SCHEMA = "agentos.blueprint_index.v1";
export const BLUEPRINT_NOTICE_SCHEMA = "agentos.blueprint_producer_notice.v1";
export const BLUEPRINT_PREFLIGHT_SCHEMA = "agentos.blueprint_repair_preflight.v1";
export const BLUEPRINT_REFERENCE_SCHEMA = "agentos.blueprint_reference.v1";
export const BLUEPRINT_VERSION = 1;
export const BLUEPRINT_RELEASE_STATUS = "SEALED";
export const BLUEPRINT_FORBIDDEN_TRAFFIC = Object.freeze(["BLUEPRINT_CONSUMED"]);
export const BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC = Object.freeze([
  "ISSUE_STARTED",
  "SCOPE_ADDITION_REQUIRES_ISSUE_ID",
  "EVIDENCE_COMPLETE_TRUE_BLOCKER",
  "DELIVERED_VERIFIED",
]);
export const BLUEPRINT_FACTUAL_FIELDS = Object.freeze([
  "evidence", "root_cause", "constraints", "acceptance_criteria",
]);
export const BLUEPRINT_ADVISORY_FIELDS = Object.freeze([
  "batching_suggestions", "implementation_suggestions",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assert(condition, code, message, details = undefined) {
  if (!condition) throw fail(code, message, details);
}

function requireText(value, label, code = "BLUEPRINT_INVALID_TEXT") {
  assert(typeof value === "string" && value.trim().length > 0, code, `${label} must be non-empty text`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), code, `${label} contains control characters`);
  return value.trim();
}

function requireIdentifier(value, label) {
  const text = requireText(value, label, "BLUEPRINT_INVALID_IDENTIFIER");
  assert(ID.test(text), "BLUEPRINT_INVALID_IDENTIFIER", `${label} is not a stable identifier`);
  return text;
}

function requireSha(value, label, code = "BLUEPRINT_INVALID_DIGEST") {
  assert(typeof value === "string" && SHA256.test(value), code, `${label} must be a lowercase SHA-256`);
  return value;
}

function requireUtc(value, label) {
  assert(typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)), "BLUEPRINT_INVALID_TIMESTAMP", `${label} must be UTC`);
}

function digestWithout(value, field) {
  const body = clone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function sortedStrings(values, label, {allowEmpty = true} = {}) {
  assert(Array.isArray(values), "BLUEPRINT_INVALID_ARRAY", `${label} must be an array`);
  const result = values.map((value) => requireText(value, `${label} item`)).sort(compareUtf8);
  assert(new Set(result).size === result.length, "BLUEPRINT_DUPLICATE_VALUE", `${label} must be unique`);
  if (!allowEmpty) assert(result.length > 0, "BLUEPRINT_REQUIRED_VALUE", `${label} cannot be empty`);
  return result;
}

function relativeReference(value, label) {
  const text = requireText(value, label, "BLUEPRINT_INVALID_REFERENCE");
  assert(!path.isAbsolute(text) && !text.includes("\\"), "BLUEPRINT_INVALID_REFERENCE", `${label} must be a portable relative path`);
  const normalized = path.posix.normalize(text);
  assert(normalized === text && normalized !== "." && !normalized.startsWith("../") && normalized !== "..", "BLUEPRINT_INVALID_REFERENCE", `${label} escapes its package root`);
  return text;
}

function normalizeFacts(value = {}) {
  assert(isRecord(value), "BLUEPRINT_INVALID_FACTS", "factual inputs must be an object");
  return {
    evidence: sortedStrings(value.evidence ?? [], "factual evidence"),
    root_cause: sortedStrings(value.root_cause ?? value.root_causes ?? [], "factual root causes"),
    constraints: sortedStrings(value.constraints ?? [], "factual constraints"),
    acceptance_criteria: sortedStrings(value.acceptance_criteria ?? value.acceptanceCriteria ?? [], "factual acceptance criteria"),
  };
}

function normalizeAdvisory(value = {}) {
  assert(isRecord(value), "BLUEPRINT_INVALID_ADVISORY", "advisory inputs must be an object");
  return {
    batching_suggestions: sortedStrings(value.batching_suggestions ?? value.batchingSuggestions ?? [], "batching suggestions"),
    implementation_suggestions: sortedStrings(value.implementation_suggestions ?? value.implementationSuggestions ?? [], "implementation suggestions"),
  };
}

function normalizeEntry(entry, index) {
  assert(isRecord(entry), "BLUEPRINT_INVALID_ENTRY", `Blueprint entry ${index + 1} must be an object`);
  const issueId = requireIdentifier(entry.issue_id ?? entry.issueId, "Blueprint issue ID");
  const status = requireText(entry.status ?? "UNSPECIFIED", "Blueprint issue status").toUpperCase();
  const issueSha = entry.issue_sha256 ?? entry.issueSha256 ?? null;
  if (issueSha !== null) requireSha(issueSha, "Blueprint issue digest");
  const blueprintPath = entry.blueprint_path ?? entry.blueprintPath ?? null;
  if (blueprintPath !== null) relativeReference(blueprintPath, "Blueprint entry path");
  const blueprintSha = entry.blueprint_sha256 ?? entry.blueprintSha256 ?? null;
  if (blueprintSha !== null) requireSha(blueprintSha, "Blueprint entry content digest");
  const sourceHashes = sortedStrings(entry.source_hashes ?? entry.sourceHashes ?? [], "Blueprint source digests");
  sourceHashes.forEach((value) => requireSha(value, "Blueprint source digest"));
  const batchLinks = sortedStrings(entry.batch_links ?? entry.batchLinks ?? [], "Blueprint batch links");
  batchLinks.forEach((value) => requireIdentifier(value, "Blueprint batch link"));
  const recommendedOrder = entry.recommended_order ?? entry.recommendedOrder ?? null;
  if (recommendedOrder !== null) assert(Number.isSafeInteger(recommendedOrder) && recommendedOrder > 0, "BLUEPRINT_INVALID_ORDER", "Blueprint recommendation order is invalid");
  return {
    issue_id: issueId,
    status,
    issue_sha256: issueSha,
    blueprint_path: blueprintPath,
    blueprint_sha256: blueprintSha,
    source_hashes: sourceHashes,
    completeness: entry.completeness === undefined ? null : requireText(entry.completeness, "Blueprint completeness"),
    batch_links: batchLinks,
    recommended_order: recommendedOrder,
  };
}

function normalizeSupersedes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return {release_id: requireIdentifier(value, "superseded release ID"), release_sha256: null};
  assert(isRecord(value), "BLUEPRINT_INVALID_SUPERSEDES", "supersedes must be a release reference");
  const result = {
    release_id: requireIdentifier(value.release_id ?? value.releaseId, "superseded release ID"),
    release_sha256: value.release_sha256 ?? value.releaseSha256 ?? null,
  };
  if (result.release_sha256 !== null) requireSha(result.release_sha256, "superseded release digest");
  return result;
}

function normalizeManifest(value, releaseId, entries) {
  if (value === null || value === undefined) {
    return {
      path: `blueprints/${releaseId}/manifest.json`,
      sha256: canonicalDigest({release_id: releaseId, entries}),
      entry_count: entries.length,
    };
  }
  assert(isRecord(value), "BLUEPRINT_INVALID_MANIFEST", "Blueprint manifest must be an object");
  const result = {
    path: relativeReference(value.path ?? value.path_ref ?? `blueprints/${releaseId}/manifest.json`, "Blueprint manifest path"),
    sha256: value.sha256 ?? value.manifest_sha256,
    entry_count: value.entry_count ?? value.entryCount ?? entries.length,
  };
  requireSha(result.sha256, "Blueprint manifest digest");
  assert(Number.isSafeInteger(result.entry_count) && result.entry_count >= 0, "BLUEPRINT_INVALID_MANIFEST", "Blueprint manifest entry count is invalid");
  assert(result.entry_count === entries.length, "BLUEPRINT_MANIFEST_COUNT_MISMATCH", "Blueprint manifest entry count does not match entries");
  return result;
}

export function compileBlueprintRelease({
  releaseId = null,
  release_id = null,
  releaseSequence = 1,
  release_sequence = null,
  publishedAtUtc = undefined,
  published_at_utc = undefined,
  releasePath = null,
  release_path = null,
  entries = null,
  blueprints = null,
  manifest = null,
  factualInputs = null,
  factual_inputs = null,
  advisoryInputs = null,
  advisory_inputs = null,
  supersedes = null,
  correction = false,
  producerNoticeId = null,
  producer_notice_id = null,
} = {}) {
  const id = requireIdentifier(release_id ?? releaseId ?? `BLUEPRINT.RELEASE.${String(releaseSequence ?? release_sequence ?? 1).padStart(4, "0")}`, "Blueprint release ID");
  const sequence = release_sequence ?? releaseSequence;
  assert(Number.isSafeInteger(sequence) && sequence > 0, "BLUEPRINT_INVALID_ORDER", "Blueprint release sequence is invalid");
  const atUtc = published_at_utc ?? publishedAtUtc ?? new Date().toISOString();
  requireUtc(atUtc, "Blueprint publication time");
  const rawEntries = entries ?? blueprints ?? [];
  assert(Array.isArray(rawEntries), "BLUEPRINT_INVALID_ENTRIES", "Blueprint entries must be an array");
  const normalizedEntries = rawEntries.map(normalizeEntry,).sort((left, right) => compareUtf8(left.issue_id, right.issue_id));
  const issueIds = normalizedEntries.map((entry) => entry.issue_id);
  assert(new Set(issueIds).size === issueIds.length, "BLUEPRINT_DUPLICATE_ISSUE", "Blueprint issue IDs must be unique");
  const predecessor = normalizeSupersedes(supersedes);
  if (correction === true) assert(predecessor !== null, "BLUEPRINT_CORRECTION_REQUIRES_SUPERSEDES", "a correction must supersede an earlier release");
  const release = {
    schema: BLUEPRINT_RELEASE_SCHEMA,
    version: BLUEPRINT_VERSION,
    release_id: id,
    release_sequence: sequence,
    status: BLUEPRINT_RELEASE_STATUS,
    published_at_utc: atUtc,
    release_path: relativeReference(release_path ?? releasePath ?? `blueprints/${id}.json`, "Blueprint release path"),
    manifest: normalizeManifest(manifest, id, normalizedEntries),
    issue_ids: issueIds,
    entries: normalizedEntries,
    factual_inputs: normalizeFacts(factual_inputs ?? factualInputs ?? {}),
    advisory_inputs: normalizeAdvisory(advisory_inputs ?? advisoryInputs ?? {}),
    producer_notice_id: producer_notice_id ?? producerNoticeId ?? null,
    acknowledgement_required: false,
    coordination: {
      source: "DIRECT_RELEASE_AND_INDEX_FILES",
      forbidden_traffic: [...BLUEPRINT_FORBIDDEN_TRAFFIC],
      allowed_lifecycle_traffic: [...BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC],
    },
    supersedes: predecessor,
    release_sha256: null,
  };
  if (release.producer_notice_id !== null) requireIdentifier(release.producer_notice_id, "Blueprint producer notice ID");
  release.release_sha256 = digestWithout(release, "release_sha256");
  return validateBlueprintRelease(release);
}

export function validateBlueprintRelease(release, {priorRelease = null} = {}) {
  assert(isRecord(release), "BLUEPRINT_INVALID_RELEASE", "Blueprint release must be an object");
  assert(release.schema === BLUEPRINT_RELEASE_SCHEMA && release.version === BLUEPRINT_VERSION, "BLUEPRINT_INVALID_RELEASE", "Blueprint release schema/version is invalid");
  requireIdentifier(release.release_id, "Blueprint release ID");
  assert(Number.isSafeInteger(release.release_sequence) && release.release_sequence > 0, "BLUEPRINT_INVALID_ORDER", "Blueprint release sequence is invalid");
  assert(release.status === BLUEPRINT_RELEASE_STATUS, "BLUEPRINT_INVALID_RELEASE_STATUS", "only sealed Blueprint releases may be consumed");
  requireUtc(release.published_at_utc, "Blueprint publication time");
  relativeReference(release.release_path, "Blueprint release path");
  assert(isRecord(release.manifest), "BLUEPRINT_INVALID_MANIFEST", "Blueprint manifest is required");
  const entries = release.entries;
  assert(Array.isArray(entries), "BLUEPRINT_INVALID_ENTRIES", "Blueprint entries are required");
  const normalized = entries.map(normalizeEntry).sort((left, right) => compareUtf8(left.issue_id, right.issue_id));
  assert(JSON.stringify(normalized) === JSON.stringify(entries), "BLUEPRINT_NONDETERMINISTIC_ORDER", "Blueprint entries are not canonical");
  assert(JSON.stringify(release.issue_ids) === JSON.stringify(entries.map((entry) => entry.issue_id)), "BLUEPRINT_ISSUE_INDEX_MISMATCH", "Blueprint issue index does not match entries");
  const manifest = normalizeManifest(release.manifest, release.release_id, entries);
  assert(JSON.stringify(manifest) === JSON.stringify(release.manifest), "BLUEPRINT_INVALID_MANIFEST", "Blueprint manifest is not canonical");
  assert(isRecord(release.factual_inputs), "BLUEPRINT_INVALID_FACTS", "factual inputs are required");
  assert(JSON.stringify(normalizeFacts(release.factual_inputs)) === JSON.stringify(release.factual_inputs), "BLUEPRINT_INVALID_FACTS", "factual inputs are not canonical");
  assert(isRecord(release.advisory_inputs), "BLUEPRINT_INVALID_ADVISORY", "advisory inputs are required");
  assert(JSON.stringify(normalizeAdvisory(release.advisory_inputs)) === JSON.stringify(release.advisory_inputs), "BLUEPRINT_INVALID_ADVISORY", "advisory inputs are not canonical");
  if (release.producer_notice_id !== null) requireIdentifier(release.producer_notice_id, "Blueprint producer notice ID");
  assert(release.acknowledgement_required === false, "BLUEPRINT_ACKNOWLEDGEMENT_FORBIDDEN", "Blueprint consumers must not require acknowledgement");
  assert(isRecord(release.coordination), "BLUEPRINT_INVALID_COORDINATION", "Blueprint coordination contract is required");
  assert(release.coordination.source === "DIRECT_RELEASE_AND_INDEX_FILES", "BLUEPRINT_INVALID_COORDINATION", "Blueprint coordination must consume direct files");
  assert(JSON.stringify(sortedStrings(release.coordination.forbidden_traffic, "Blueprint forbidden traffic")) === JSON.stringify([...BLUEPRINT_FORBIDDEN_TRAFFIC]), "BLUEPRINT_INVALID_COORDINATION", "forbidden Blueprint traffic drifted");
  assert(JSON.stringify(sortedStrings(release.coordination.allowed_lifecycle_traffic, "Blueprint lifecycle traffic")) === JSON.stringify([...BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC].sort(compareUtf8)), "BLUEPRINT_INVALID_COORDINATION", "allowed lifecycle traffic drifted");
  const predecessor = normalizeSupersedes(release.supersedes);
  if (predecessor !== null) assert(predecessor.release_id !== release.release_id, "BLUEPRINT_SUPERSEDES_SELF", "a release cannot supersede itself");
  if (priorRelease !== null) {
    validateBlueprintRelease(priorRelease);
    assert(predecessor !== null && predecessor.release_id === priorRelease.release_id, "BLUEPRINT_SUPERSEDES_MISMATCH", "successor does not bind the prior release");
    if (predecessor.release_sha256 !== null) assert(predecessor.release_sha256 === priorRelease.release_sha256, "BLUEPRINT_SUPERSEDES_MISMATCH", "successor prior digest does not match");
    assert(release.release_id !== priorRelease.release_id, "BLUEPRINT_SEALED_RELEASE_IMMUTABLE", "a sealed release cannot be rewritten in place");
    assert(release.release_sha256 !== priorRelease.release_sha256, "BLUEPRINT_SUCCESSOR_NOT_DISTINCT", "a correction must change the sealed bytes");
  }
  if (release.supersedes !== null) assert(predecessor !== null, "BLUEPRINT_INVALID_SUPERSEDES", "supersedes is invalid");
  requireSha(release.release_sha256, "Blueprint release digest");
  assert(release.release_sha256 === digestWithout(release, "release_sha256"), "BLUEPRINT_DIGEST_MISMATCH", "Blueprint release digest mismatch");
  return release;
}

export function sealBlueprintRelease(release, {existingRelease = null, priorRelease = null} = {}) {
  if (existingRelease !== null) {
    validateBlueprintRelease(existingRelease);
    if (existingRelease.release_id === release.release_id) {
      const oldBody = clone(existingRelease); oldBody.release_sha256 = null;
      const newBody = clone(release); newBody.release_sha256 = null;
      assert(JSON.stringify(oldBody) === JSON.stringify(newBody) && existingRelease.release_sha256 === release.release_sha256, "BLUEPRINT_SEALED_RELEASE_IMMUTABLE", "a sealed release cannot be rewritten");
    }
  }
  validateBlueprintRelease(release, {priorRelease});
  return clone(release);
}

export function correctBlueprintRelease(previousRelease, fields = {}) {
  validateBlueprintRelease(previousRelease);
  const next = compileBlueprintRelease({...fields, supersedes: {release_id: previousRelease.release_id, release_sha256: previousRelease.release_sha256}, correction: true, releaseSequence: Math.max(previousRelease.release_sequence + 1, fields.releaseSequence ?? 0)});
  return validateBlueprintRelease(next, {priorRelease: previousRelease});
}

export function compileBlueprintIndex({indexId = "BLUEPRINT.INDEX", index_id = null, releases = [], activeReleaseId = null, active_release_id = null, generatedAtUtc = undefined, generated_at_utc = undefined} = {}) {
  requireIdentifier(index_id ?? indexId, "Blueprint index ID");
  assert(Array.isArray(releases), "BLUEPRINT_INVALID_INDEX", "Blueprint index releases must be an array");
  const normalized = releases.map((release) => {
    validateBlueprintRelease(release);
    return {
      release_id: release.release_id,
      release_path: release.release_path,
      release_sha256: release.release_sha256,
      manifest_path: release.manifest.path,
      manifest_sha256: release.manifest.sha256,
      issue_count: release.entries.length,
      status: release.status,
      supersedes: release.supersedes,
    };
  }).sort((left, right) => compareUtf8(left.release_id, right.release_id));
  const ids = normalized.map((entry) => entry.release_id);
  assert(new Set(ids).size === ids.length, "BLUEPRINT_DUPLICATE_RELEASE", "Blueprint index release IDs must be unique");
  const active = active_release_id ?? activeReleaseId ?? (normalized.at(-1)?.release_id ?? null);
  if (active !== null) assert(ids.includes(active), "BLUEPRINT_INDEX_ACTIVE_MISSING", "active Blueprint release is absent from index");
  const atUtc = generated_at_utc ?? generatedAtUtc ?? new Date().toISOString();
  requireUtc(atUtc, "Blueprint index generation time");
  const index = {
    schema: BLUEPRINT_INDEX_SCHEMA,
    version: BLUEPRINT_VERSION,
    index_id: index_id ?? indexId,
    generated_at_utc: atUtc,
    release_ids: ids,
    active_release_id: active,
    releases: normalized,
    index_sha256: null,
  };
  index.index_sha256 = digestWithout(index, "index_sha256");
  return validateBlueprintIndex(index);
}

export function validateBlueprintIndex(index) {
  assert(isRecord(index) && index.schema === BLUEPRINT_INDEX_SCHEMA && index.version === BLUEPRINT_VERSION, "BLUEPRINT_INVALID_INDEX", "Blueprint index schema/version is invalid");
  requireIdentifier(index.index_id, "Blueprint index ID"); requireUtc(index.generated_at_utc, "Blueprint index generation time");
  assert(Array.isArray(index.release_ids) && Array.isArray(index.releases), "BLUEPRINT_INVALID_INDEX", "Blueprint index releases are required");
  const ordered = [...index.releases].sort((left, right) => compareUtf8(left.release_id, right.release_id));
  assert(JSON.stringify(ordered) === JSON.stringify(index.releases), "BLUEPRINT_NONDETERMINISTIC_ORDER", "Blueprint index releases are not sorted");
  const ids = index.releases.map((entry) => { assert(isRecord(entry), "BLUEPRINT_INVALID_INDEX", "Blueprint index entry must be an object"); requireIdentifier(entry.release_id, "Blueprint indexed release ID"); relativeReference(entry.release_path, "Blueprint indexed release path"); requireSha(entry.release_sha256, "Blueprint indexed release digest"); relativeReference(entry.manifest_path, "Blueprint indexed manifest path"); requireSha(entry.manifest_sha256, "Blueprint indexed manifest digest"); assert(Number.isSafeInteger(entry.issue_count) && entry.issue_count >= 0, "BLUEPRINT_INVALID_INDEX", "Blueprint indexed issue count is invalid"); assert(entry.status === BLUEPRINT_RELEASE_STATUS, "BLUEPRINT_INVALID_INDEX", "index may contain only sealed releases"); return entry.release_id; });
  assert(new Set(ids).size === ids.length, "BLUEPRINT_DUPLICATE_RELEASE", "Blueprint index release IDs must be unique");
  assert(JSON.stringify(ids) === JSON.stringify(index.release_ids), "BLUEPRINT_INDEX_ID_MISMATCH", "Blueprint index IDs do not match entries");
  if (index.active_release_id !== null) assert(ids.includes(index.active_release_id), "BLUEPRINT_INDEX_ACTIVE_MISSING", "active Blueprint release is absent from index");
  requireSha(index.index_sha256, "Blueprint index digest"); assert(index.index_sha256 === digestWithout(index, "index_sha256"), "BLUEPRINT_DIGEST_MISMATCH", "Blueprint index digest mismatch");
  return index;
}

export function compileBlueprintProducerNotice({noticeId = null, notice_id = null, releaseId = null, release_id = null, issueIds = null, issue_ids = null, sentAtUtc = undefined, sent_at_utc = undefined, existingNotices = [], existing_notices = undefined} = {}) {
  const id = requireIdentifier(notice_id ?? noticeId ?? "BLUEPRINT.NOTICE.FINAL", "Blueprint producer notice ID");
  const release = requireIdentifier(release_id ?? releaseId, "Blueprint notice release ID");
  const ids = sortedStrings(issue_ids ?? issueIds ?? [], "Blueprint notice issue IDs", {allowEmpty: false}); ids.forEach((value) => assert(/^[A-Z][A-Z0-9._:-]*$/u.test(value), "BLUEPRINT_INVALID_IDENTIFIER", "Blueprint notice issue ID is invalid"));
  const previous = existing_notices === undefined || existing_notices === null ? (existingNotices ?? []) : existing_notices;
  assert(Array.isArray(previous), "BLUEPRINT_INVALID_NOTICE", "existing notices must be an array");
  assert(!previous.some((notice) => notice.release_id === release || notice.notice_id === id), "BLUEPRINT_DUPLICATE_NOTICE", "only one consolidated notice may be emitted");
  const notice = {schema: BLUEPRINT_NOTICE_SCHEMA, version: BLUEPRINT_VERSION, notice_id: id, release_id: release, issue_ids: ids, notice_kind: "FINAL_CONSOLIDATED_BATCH", sent_at_utc: sent_at_utc ?? sentAtUtc ?? new Date().toISOString(), acknowledgement_required: false, per_issue: false, notice_sha256: null};
  requireUtc(notice.sent_at_utc, "Blueprint notice time"); notice.notice_sha256 = digestWithout(notice, "notice_sha256"); return validateBlueprintProducerNotice(notice);
}

export function validateBlueprintProducerNotice(notice) {
  assert(isRecord(notice) && notice.schema === BLUEPRINT_NOTICE_SCHEMA && notice.version === BLUEPRINT_VERSION, "BLUEPRINT_INVALID_NOTICE", "Blueprint notice schema/version is invalid");
  requireIdentifier(notice.notice_id, "Blueprint producer notice ID"); requireIdentifier(notice.release_id, "Blueprint notice release ID");
  const ids = sortedStrings(notice.issue_ids, "Blueprint notice issue IDs", {allowEmpty: false}); assert(JSON.stringify(ids) === JSON.stringify(notice.issue_ids), "BLUEPRINT_NONDETERMINISTIC_ORDER", "Blueprint notice issue IDs are not sorted");
  requireUtc(notice.sent_at_utc, "Blueprint notice time"); assert(notice.notice_kind === "FINAL_CONSOLIDATED_BATCH", "BLUEPRINT_NOTICE_KIND_INVALID", "only one consolidated final notice is permitted"); assert(notice.acknowledgement_required === false && notice.per_issue === false, "BLUEPRINT_ACKNOWLEDGEMENT_FORBIDDEN", "Blueprint notices cannot require acknowledgement or become per-issue traffic");
  requireSha(notice.notice_sha256, "Blueprint notice digest"); assert(notice.notice_sha256 === digestWithout(notice, "notice_sha256"), "BLUEPRINT_DIGEST_MISMATCH", "Blueprint notice digest mismatch"); return notice;
}

export function compileBlueprintRepairPreflight({preflightId = null, preflight_id = null, releaseId = null, release_id = null, indexSha256 = null, index_sha256 = null, checkedAtUtc = undefined, checked_at_utc = undefined, sourceBase = null, source_base = null, custody = null, collision = null} = {}) {
  const preflight = {
    schema: BLUEPRINT_PREFLIGHT_SCHEMA,
    version: BLUEPRINT_VERSION,
    preflight_id: requireIdentifier(preflight_id ?? preflightId ?? "BLUEPRINT.PREFLIGHT.0001", "Blueprint preflight ID"),
    release_id: requireIdentifier(release_id ?? releaseId, "Blueprint preflight release ID"),
    index_sha256: index_sha256 ?? indexSha256,
    checked_at_utc: checked_at_utc ?? checkedAtUtc ?? new Date().toISOString(),
    fresh: true,
    status: "PASS",
    checks_performed: ["COLLISION_FREE", "CURRENT_STATUS", "CUSTODY_CLEAN", "SOURCE_BASE"],
    source_base: source_base ?? sourceBase ?? {commit: "0".repeat(40), tree: "0".repeat(40)},
    custody: custody ?? {clean: true, unstaged_count: 0, untracked_count: 0, process_count: 0},
    collision: collision ?? {target_preexisting: false, process_overlap: 0, active_writer_overlap: 0},
    preflight_sha256: null,
  };
  requireSha(preflight.index_sha256, "Blueprint preflight index digest"); requireUtc(preflight.checked_at_utc, "Blueprint preflight time"); preflight.preflight_sha256 = digestWithout(preflight, "preflight_sha256"); return validateBlueprintRepairPreflight(preflight);
}

export function validateBlueprintRepairPreflight(preflight) {
  assert(isRecord(preflight) && preflight.schema === BLUEPRINT_PREFLIGHT_SCHEMA && preflight.version === BLUEPRINT_VERSION, "BLUEPRINT_PREFLIGHT_INVALID", "Blueprint preflight schema/version is invalid");
  requireIdentifier(preflight.preflight_id, "Blueprint preflight ID"); requireIdentifier(preflight.release_id, "Blueprint preflight release ID"); requireSha(preflight.index_sha256, "Blueprint preflight index digest"); requireUtc(preflight.checked_at_utc, "Blueprint preflight time"); assert(preflight.fresh === true && preflight.status === "PASS", "BLUEPRINT_PREFLIGHT_NOT_FRESH", "Repair requires one fresh passing preflight");
  assert(JSON.stringify(sortedStrings(preflight.checks_performed, "Blueprint preflight checks")) === JSON.stringify(["COLLISION_FREE", "CURRENT_STATUS", "CUSTODY_CLEAN", "SOURCE_BASE"]), "BLUEPRINT_PREFLIGHT_INCOMPLETE", "preflight must prove current status, source base, custody, and collision checks");
  assert(isRecord(preflight.source_base), "BLUEPRINT_PREFLIGHT_INVALID", "preflight source base is required"); assert(GIT_OBJECT.test(preflight.source_base.commit) && GIT_OBJECT.test(preflight.source_base.tree), "BLUEPRINT_PREFLIGHT_INVALID", "preflight source base identity is invalid");
  assert(isRecord(preflight.custody) && preflight.custody.clean === true, "BLUEPRINT_PREFLIGHT_CUSTODY_DIRTY", "preflight custody is not clean");
  for (const field of ["unstaged_count", "untracked_count", "process_count"]) {
    assert(Number.isSafeInteger(preflight.custody[field]), "BLUEPRINT_PREFLIGHT_CUSTODY_DIRTY", `preflight ${field} is required`);
    assert(preflight.custody[field] === 0, "BLUEPRINT_PREFLIGHT_CUSTODY_DIRTY", `preflight ${field} must be zero`);
  }
  assert(isRecord(preflight.collision), "BLUEPRINT_PREFLIGHT_COLLISION", "preflight collision evidence is required");
  assert(typeof preflight.collision.target_preexisting === "boolean" && preflight.collision.target_preexisting === false, "BLUEPRINT_PREFLIGHT_COLLISION", "Blueprint target collision evidence is required and must be clear");
  for (const field of ["process_overlap", "active_writer_overlap"]) {
    assert(Number.isSafeInteger(preflight.collision[field]), "BLUEPRINT_PREFLIGHT_COLLISION", `preflight ${field} is required`);
    assert(preflight.collision[field] === 0, "BLUEPRINT_PREFLIGHT_COLLISION", `preflight ${field} must be zero`);
  }
  requireSha(preflight.preflight_sha256, "Blueprint preflight digest"); assert(preflight.preflight_sha256 === digestWithout(preflight, "preflight_sha256"), "BLUEPRINT_DIGEST_MISMATCH", "Blueprint preflight digest mismatch"); return preflight;
}

export function validateBlueprintReference(reference) {
  assert(isRecord(reference) && reference.schema === BLUEPRINT_REFERENCE_SCHEMA && reference.version === BLUEPRINT_VERSION, "BLUEPRINT_REFERENCE_INVALID", "Blueprint reference schema/version is invalid");
  for (const field of ["content", "blueprint", "advice", "advisory", "producer_notice", "acknowledgement_required"]) assert(reference[field] === undefined || reference[field] === null, "BLUEPRINT_REFERENCE_EMBEDDED_CONTENT", "Registrar references cannot embed Blueprint content or advice");
  const expectedKeys = ["schema", "version", "release_id", "path", "sha256", "reference_sha256"].sort(compareUtf8);
  const actualKeys = Object.keys(reference).sort(compareUtf8);
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), "BLUEPRINT_REFERENCE_INVALID", "Blueprint reference fields are not canonical");
  requireIdentifier(reference.release_id, "Blueprint reference release ID"); relativeReference(reference.path, "Blueprint reference path"); requireSha(reference.sha256, "Blueprint reference digest");
  requireSha(reference.reference_sha256, "Blueprint reference digest"); assert(reference.reference_sha256 === digestWithout(reference, "reference_sha256"), "BLUEPRINT_DIGEST_MISMATCH", "Blueprint reference self-digest mismatch"); return reference;
}

export function compileBlueprintReference({releaseId = null, release_id = null, path: referencePath, sha256, releaseSha256 = null, release_sha256 = null} = {}) {
  const reference = {schema: BLUEPRINT_REFERENCE_SCHEMA, version: BLUEPRINT_VERSION, release_id: requireIdentifier(release_id ?? releaseId, "Blueprint reference release ID"), path: relativeReference(referencePath, "Blueprint reference path"), sha256: sha256 ?? release_sha256 ?? releaseSha256, reference_sha256: null}; requireSha(reference.sha256, "Blueprint reference digest"); reference.reference_sha256 = digestWithout(reference, "reference_sha256"); return validateBlueprintReference(reference);
}

export function validateBlueprintLifecycleTraffic(message) {
  assert(isRecord(message), "BLUEPRINT_TRAFFIC_INVALID", "Blueprint lifecycle traffic must be an object");
  const kind = String(message.kind ?? message.type ?? message.event ?? "").toUpperCase();
  assert(kind.length > 0, "BLUEPRINT_TRAFFIC_INVALID", "lifecycle traffic requires an event kind");
  assert(!BLUEPRINT_FORBIDDEN_TRAFFIC.includes(kind), "BLUEPRINT_CONSUMED_TRAFFIC_FORBIDDEN", "BLUEPRINT_CONSUMED traffic is forbidden");
  assert(message.acknowledgement_required !== true && message.ack_required !== true && message.acknowledgementRequired !== true && message.ackRequired !== true, "BLUEPRINT_ACKNOWLEDGEMENT_FORBIDDEN", "acknowledgement traffic is forbidden");
  assert(message.per_issue !== true && message.issue_notice !== true && message.perIssue !== true && message.issueNotice !== true && message.perIssueNotice !== true, "BLUEPRINT_PER_ISSUE_NOTICE_FORBIDDEN", "per-issue Blueprint notices are forbidden");
  if (kind.length > 0) assert(BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC.includes(kind), "BLUEPRINT_TRAFFIC_FORBIDDEN", `lifecycle traffic ${kind} is not allowed`);
  return message;
}

export function consumeBlueprintRelease({release, index, preflight, traffic = [], messages = [], acknowledgementRequired = false, acknowledgement_required = false, consumer = "REPAIR"} = {}) {
  validateBlueprintRelease(release); validateBlueprintIndex(index); validateBlueprintRepairPreflight(preflight);
  assert(preflight.release_id === release.release_id, "BLUEPRINT_PREFLIGHT_RELEASE_MISMATCH", "preflight release differs from consumed release");
  assert(preflight.index_sha256 === index.index_sha256, "BLUEPRINT_PREFLIGHT_INDEX_MISMATCH", "preflight index digest differs from consumed index");
  const indexed = index.releases.find((entry) => entry.release_id === release.release_id); assert(indexed && indexed.release_sha256 === release.release_sha256 && indexed.release_path === release.release_path, "BLUEPRINT_INDEX_RELEASE_MISMATCH", "index does not bind the consumed release");
  assert(acknowledgementRequired !== true && acknowledgement_required !== true, "BLUEPRINT_ACKNOWLEDGEMENT_FORBIDDEN", "consumption cannot require acknowledgement"); requireIdentifier(consumer, "Blueprint consumer");
  const allTraffic = [...(Array.isArray(traffic) ? traffic : []), ...(Array.isArray(messages) ? messages : [])]; allTraffic.forEach(validateBlueprintLifecycleTraffic);
  assert(!allTraffic.some((message) => String(message.kind ?? message.type ?? message.event ?? "").toUpperCase() === "BLUEPRINT_CONSUMED"), "BLUEPRINT_CONSUMED_TRAFFIC_FORBIDDEN", "consumption must not emit BLUEPRINT_CONSUMED traffic");
  return {accepted: true, status: "BLUEPRINT_READY_FOR_REPAIR", release_id: release.release_id, release_sha256: release.release_sha256, index_sha256: index.index_sha256, preflight_sha256: preflight.preflight_sha256, consumed_via: "DIRECT_RELEASE_AND_INDEX_FILES", fresh_preflight_verified: true, blueprint_consumed_traffic: false, acknowledgement_required: false, consumer};
}

export function consumeBlueprintFiles({indexPath, releasePath, preflight, ...options} = {}) {
  relativeReference(path.basename(indexPath ?? ""), "Blueprint index path");
  assert(typeof indexPath === "string" && path.isAbsolute(indexPath), "BLUEPRINT_FILE_INPUT_REQUIRED", "Blueprint index path must be an absolute admitted file");
  assert(typeof releasePath === "string" && path.isAbsolute(releasePath), "BLUEPRINT_FILE_INPUT_REQUIRED", "Blueprint release path must be an absolute admitted file");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")); const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  return consumeBlueprintRelease({release, index, preflight, ...options});
}

export const compileBlueprint = compileBlueprintRelease;
export const validateBlueprint = validateBlueprintRelease;
export const compileBlueprintPublication = compileBlueprintRelease;
export const validateBlueprintPublication = validateBlueprintRelease;
export const compileBlueprintReleaseIndex = compileBlueprintIndex;
export const validateBlueprintReleaseIndex = validateBlueprintIndex;
export const compileConsolidatedProducerNotice = compileBlueprintProducerNotice;
export const validateConsolidatedProducerNotice = validateBlueprintProducerNotice;
export const compileRepairCustodyPreflight = compileBlueprintRepairPreflight;
export const validateRepairCustodyPreflight = validateBlueprintRepairPreflight;
export const consumeBlueprintDirectly = consumeBlueprintRelease;
export const validateBlueprintConsumerTraffic = validateBlueprintLifecycleTraffic;
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Blueprint release governance contract loaded\n");
