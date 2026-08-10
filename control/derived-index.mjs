#!/usr/bin/env node

/*
 * Privacy-safe hybrid-memory seam. Source text is accepted only transiently
 * from a typed document input and is reduced to deterministic token and
 * content digests. The persisted index can locate source records but cannot
 * replace the canonical record store or acceptance authority.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTRACT_STATUS,
  CONTROL_SPACE,
  assert,
  assertSafeRecord,
  digestWithout,
  exactKeys,
  requireIdentifier,
  requireRecord,
  requireSafeInteger,
  requireSafeText,
  requireSha,
  requireSortedUniqueDigests,
  requireSortedUniqueStrings,
  sortByUtf8,
} from "./map-memory-common.mjs";

export {CONTRACT_STATUS} from "./map-memory-common.mjs";

export const DERIVED_INDEX_SCHEMA = "governance.derived_index.v1";
export const DERIVED_INDEX_QUERY_SCHEMA = "governance.derived_index_query_result.v1";
export const DERIVED_INDEX_VERSION = 1;
export const DERIVED_INDEX_COMPILER_ID = "agentos.derived_index.compiler.v1";
export const DERIVED_INDEX_COMPILER_SHA256 = canonicalDigest({
  compiler: DERIVED_INDEX_COMPILER_ID,
  version: DERIVED_INDEX_VERSION,
  rules: [
    "typed-document-input-only",
    "no-source-text-persistence",
    "hashed-lexical-postings",
    "role-filtered-query",
    "advisory-only",
  ],
});
export const DERIVED_INDEX_KIND = "LEXICAL_HASHED";
export const DERIVED_INDEX_MEMORY_ROLE = "DERIVED_INDEX_ONLY";
export const DERIVED_INDEX_TOKENIZATION = "UNICODE_WORDS_NFKC_LOWER_V1";
export const DERIVED_INDEX_TOKEN_DIGEST_ALGORITHM = "SHA256_CANONICAL_TOKEN_V1";
export const DERIVED_INDEX_STATUSES = Object.freeze(["READY", "STALE"]);
export const DERIVED_INDEX_QUERY_STATUSES = Object.freeze(["MATCHED", "NO_MATCH", "STALE"]);
export const DOCUMENT_KINDS = Object.freeze([
  "OWNER_DECISION",
  "GOAL",
  "BOUNDARY",
  "PLAN_PHASE",
  "HANDOFF",
  "EVIDENCE_METADATA",
  "MAP_SOURCE",
  "OTHER",
]);

const INDEX_KEYS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority",
  "index_id", "project_ref", "memory_role", "index_kind", "tokenization", "token_digest_algorithm",
  "source_snapshot_sha256", "policy_sha256", "compiler_sha256", "status", "bounds", "documents", "postings",
  "index_sha256",
];
const INDEX_BOUNDS_KEYS = ["max_documents", "max_tokens_per_document", "truncated"];
const DOCUMENT_KEYS = ["document_id", "document_kind", "source_record_digests", "role_scope", "content_sha256", "token_count"];
const POSTING_KEYS = ["token_sha256", "document_ids"];
const QUERY_KEYS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority",
  "index_sha256", "project_ref", "role", "query_sha256", "status", "limit", "matches", "omitted_match_count",
  "result_sha256",
];
const MATCH_KEYS = ["document_id", "match_count"];

function normalizeContent(content, label) {
  requireSafeText(content, label, {maxLength: 100000});
  const normalized = content.normalize("NFKC").trim().replace(/\s+/gu, " ");
  assert(normalized.length > 0, `${label} must contain searchable text`);
  const rawTokens = normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = [...new Set(rawTokens)].sort(compareUtf8);
  return {normalized, tokens};
}

function tokenDigest(token) {
  return canonicalDigest({token});
}

function validateDocument(document, index, maxTokensPerDocument) {
  exactKeys(document, DOCUMENT_KEYS, `derived index document ${index}`);
  requireIdentifier(document.document_id, `derived index document ${index} ID`);
  assert(DOCUMENT_KINDS.includes(document.document_kind), `derived index document ${document.document_id} kind is invalid`);
  requireSortedUniqueDigests(document.source_record_digests, `derived index document ${document.document_id} source records`);
  requireSortedUniqueStrings(document.role_scope, `derived index document ${document.document_id} role scope`, {validator: requireIdentifier});
  requireSha(document.content_sha256, `derived index document ${document.document_id} content digest`);
  requireSafeInteger(document.token_count, `derived index document ${document.document_id} token count`, {min: 0, max: maxTokensPerDocument});
}

function validateIndexBounds(bounds, documentCount) {
  exactKeys(bounds, INDEX_BOUNDS_KEYS, "derived index bounds");
  requireSafeInteger(bounds.max_documents, "derived index maximum documents", {min: 1, max: 100000});
  requireSafeInteger(bounds.max_tokens_per_document, "derived index maximum tokens", {min: 1, max: 100000});
  assert(bounds.truncated === false, "derived index cannot silently truncate source documents");
  assert(documentCount > 0, "derived index must contain a document");
  assert(documentCount <= bounds.max_documents, "derived index exceeds its document bound");
}

function validatePostings(postings, documentMap) {
  assert(Array.isArray(postings), "derived index postings must be an array");
  const seenTokens = new Set();
  const observedCounts = new Map([...documentMap.keys()].map((documentId) => [documentId, 0]));
  let previousToken = null;
  for (const [index, posting] of postings.entries()) {
    exactKeys(posting, POSTING_KEYS, `derived index posting ${index}`);
    requireSha(posting.token_sha256, `derived index posting ${index} token digest`);
    assert(previousToken === null || compareUtf8(previousToken, posting.token_sha256) < 0, "derived index postings must be UTF-8 sorted and unique");
    previousToken = posting.token_sha256;
    assert(!seenTokens.has(posting.token_sha256), "derived index postings contain duplicate tokens");
    seenTokens.add(posting.token_sha256);
    requireSortedUniqueStrings(posting.document_ids, `derived index posting ${posting.token_sha256} documents`, {validator: requireIdentifier});
    for (const documentId of posting.document_ids) {
      assert(documentMap.has(documentId), `derived index posting references unknown document ${documentId}`);
      observedCounts.set(documentId, observedCounts.get(documentId) + 1);
    }
  }
  for (const [documentId, document] of documentMap.entries()) {
    assert(observedCounts.get(documentId) === document.token_count, `derived index token count mismatch for ${documentId}`);
  }
}

export function validateDerivedIndex(index, {
  currentSourceSnapshotSha256 = null,
  currentPolicySha256 = null,
} = {}) {
  requireRecord(index, "derived index");
  assertSafeRecord(index, "derived index");
  exactKeys(index, INDEX_KEYS, "derived index");
  assert(index.schema === DERIVED_INDEX_SCHEMA, "derived index schema mismatch");
  assert(index.version === DERIVED_INDEX_VERSION, "derived index version mismatch");
  assert(index.contract_status === CONTRACT_STATUS, "derived index is active or has an invalid contract status");
  assert(index.visibility === CONTROL_SPACE, "derived index must remain in control space");
  assert(index.advisory_only === true, "derived index must be advisory-only");
  assert(index.acceptance_authority === false, "derived index cannot be acceptance authority");
  requireIdentifier(index.index_id, "derived index ID");
  requireIdentifier(index.project_ref, "derived index project reference");
  assert(index.memory_role === DERIVED_INDEX_MEMORY_ROLE, "derived index memory role mismatch");
  assert(index.index_kind === DERIVED_INDEX_KIND, "derived index kind mismatch");
  assert(index.tokenization === DERIVED_INDEX_TOKENIZATION, "derived index tokenization mismatch");
  assert(index.token_digest_algorithm === DERIVED_INDEX_TOKEN_DIGEST_ALGORITHM, "derived index token digest algorithm mismatch");
  requireSha(index.source_snapshot_sha256, "derived index source snapshot");
  requireSha(index.policy_sha256, "derived index policy digest");
  requireSha(index.compiler_sha256, "derived index compiler digest");
  assert(index.compiler_sha256 === DERIVED_INDEX_COMPILER_SHA256, "derived index compiler digest mismatch");
  assert(DERIVED_INDEX_STATUSES.includes(index.status), "derived index status is invalid");
  validateIndexBounds(index.bounds, index.documents.length);

  const documentMap = new Map();
  let previousDocument = null;
  for (const [documentIndex, document] of index.documents.entries()) {
    validateDocument(document, documentIndex, index.bounds.max_tokens_per_document);
    assert(previousDocument === null || compareUtf8(previousDocument, document.document_id) < 0, "derived index documents must be UTF-8 sorted and unique");
    previousDocument = document.document_id;
    assert(!documentMap.has(document.document_id), `derived index contains duplicate document ${document.document_id}`);
    documentMap.set(document.document_id, document);
  }
  validatePostings(index.postings, documentMap);

  if (currentSourceSnapshotSha256 !== null) {
    requireSha(currentSourceSnapshotSha256, "current source snapshot");
    assert(index.source_snapshot_sha256 === currentSourceSnapshotSha256, "derived index source snapshot is stale");
  }
  if (currentPolicySha256 !== null) {
    requireSha(currentPolicySha256, "current policy digest");
    assert(index.policy_sha256 === currentPolicySha256, "derived index policy is stale");
  }
  requireSha(index.index_sha256, "derived index digest");
  assert(index.index_sha256 === digestWithout(index, "index_sha256"), "derived index digest mismatch");
  return index;
}

function normalizeDocument(value, index, maxTokensPerDocument) {
  requireRecord(value, `derived index input document ${index}`);
  const allowedKeys = ["document_id", "document_kind", "source_record_digests", "role_scope", "content"];
  exactKeys(value, allowedKeys, `derived index input document ${index}`);
  requireIdentifier(value.document_id, `derived index input document ${index} ID`);
  assert(DOCUMENT_KINDS.includes(value.document_kind), `derived index input document ${value.document_id} kind is invalid`);
  requireSortedUniqueDigests(value.source_record_digests, `derived index input document ${value.document_id} source records`);
  requireSortedUniqueStrings(value.role_scope, `derived index input document ${value.document_id} role scope`, {validator: requireIdentifier});
  const {normalized, tokens} = normalizeContent(value.content, `derived index input document ${value.document_id} content`);
  assert(tokens.length <= maxTokensPerDocument, `derived index input document ${value.document_id} exceeds the token bound`);
  return {
    document: {
      document_id: value.document_id,
      document_kind: value.document_kind,
      source_record_digests: [...value.source_record_digests],
      role_scope: [...value.role_scope],
      content_sha256: canonicalDigest({text: normalized}),
      token_count: tokens.length,
    },
    tokens,
  };
}

export function compileDerivedIndex({
  indexId,
  projectRef,
  sourceSnapshotSha256,
  policySha256,
  documents,
  maxDocuments = 128,
  maxTokensPerDocument = 1024,
}) {
  requireIdentifier(indexId, "derived index ID");
  requireIdentifier(projectRef, "derived index project reference");
  requireSha(sourceSnapshotSha256, "derived index source snapshot");
  requireSha(policySha256, "derived index policy digest");
  requireSafeInteger(maxDocuments, "derived index maximum documents", {min: 1, max: 100000});
  requireSafeInteger(maxTokensPerDocument, "derived index maximum tokens", {min: 1, max: 100000});
  assert(Array.isArray(documents) && documents.length > 0, "derived index documents must be nonempty");
  assert(documents.length <= maxDocuments, "derived index input exceeds its document bound");

  const normalized = documents.map((document, index) => normalizeDocument(document, index, maxTokensPerDocument));
  const sortedDocuments = sortByUtf8(normalized, (entry) => entry.document.document_id);
  const documentIds = new Set();
  const postingMap = new Map();
  const outputDocuments = [];
  for (const entry of sortedDocuments) {
    const {document, tokens} = entry;
    assert(!documentIds.has(document.document_id), `derived index input contains duplicate document ${document.document_id}`);
    documentIds.add(document.document_id);
    outputDocuments.push(document);
    for (const token of tokens) {
      const digest = tokenDigest(token);
      if (!postingMap.has(digest)) postingMap.set(digest, new Set());
      postingMap.get(digest).add(document.document_id);
    }
  }
  const postings = [...postingMap.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([tokenSha256, ids]) => ({
      token_sha256: tokenSha256,
      document_ids: [...ids].sort(compareUtf8),
    }));

  const index = {
    schema: DERIVED_INDEX_SCHEMA,
    version: DERIVED_INDEX_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    index_id: indexId,
    project_ref: projectRef,
    memory_role: DERIVED_INDEX_MEMORY_ROLE,
    index_kind: DERIVED_INDEX_KIND,
    tokenization: DERIVED_INDEX_TOKENIZATION,
    token_digest_algorithm: DERIVED_INDEX_TOKEN_DIGEST_ALGORITHM,
    source_snapshot_sha256: sourceSnapshotSha256,
    policy_sha256: policySha256,
    compiler_sha256: DERIVED_INDEX_COMPILER_SHA256,
    status: "READY",
    bounds: {
      max_documents: maxDocuments,
      max_tokens_per_document: maxTokensPerDocument,
      truncated: false,
    },
    documents: outputDocuments,
    postings,
    index_sha256: null,
  };
  index.index_sha256 = digestWithout(index, "index_sha256");
  assertSafeRecord(index, "compiled derived index");
  return validateDerivedIndex(index, {
    currentSourceSnapshotSha256: sourceSnapshotSha256,
    currentPolicySha256: policySha256,
  });
}

function validateMatch(match, index, position) {
  exactKeys(match, MATCH_KEYS, `derived index query match ${position}`);
  requireIdentifier(match.document_id, `derived index query match ${position} document`);
  assert(index.documents.some((document) => document.document_id === match.document_id), `derived index query match references unknown document ${match.document_id}`);
  requireSafeInteger(match.match_count, `derived index query match ${position} count`, {min: 1, max: 100000});
}

export function validateDerivedIndexQueryResult(result, {index = null} = {}) {
  requireRecord(result, "derived index query result");
  assertSafeRecord(result, "derived index query result");
  exactKeys(result, QUERY_KEYS, "derived index query result");
  assert(result.schema === DERIVED_INDEX_QUERY_SCHEMA, "derived index query result schema mismatch");
  assert(result.version === DERIVED_INDEX_VERSION, "derived index query result version mismatch");
  assert(result.contract_status === CONTRACT_STATUS, "derived index query result is active or has an invalid contract status");
  assert(result.visibility === CONTROL_SPACE, "derived index query result must remain in control space");
  assert(result.advisory_only === true, "derived index query result must be advisory-only");
  assert(result.acceptance_authority === false, "derived index query result cannot be acceptance authority");
  requireSha(result.index_sha256, "derived index query index digest");
  requireIdentifier(result.project_ref, "derived index query project reference");
  requireIdentifier(result.role, "derived index query role");
  requireSha(result.query_sha256, "derived index query digest");
  assert(DERIVED_INDEX_QUERY_STATUSES.includes(result.status), "derived index query status is invalid");
  requireSafeInteger(result.limit, "derived index query limit", {min: 1, max: 100});
  assert(Array.isArray(result.matches), "derived index query matches must be an array");
  const matchIndex = index === null ? {documents: result.matches} : index;
  if (index !== null) {
    validateDerivedIndex(index);
    assert(result.index_sha256 === index.index_sha256, "derived index query is bound to another index");
  }
  result.matches.forEach((match, matchPosition) => validateMatch(match, matchIndex, matchPosition));
  if (index !== null) {
    for (const match of result.matches) {
      const document = index.documents.find((candidate) => candidate.document_id === match.document_id);
      assert(document.role_scope.includes(result.role), `derived index query returned an unauthorized document ${match.document_id}`);
    }
  }
  for (let index = 1; index < result.matches.length; index += 1) {
    const previous = result.matches[index - 1];
    const current = result.matches[index];
    assert(previous.match_count > current.match_count || (previous.match_count === current.match_count && compareUtf8(previous.document_id, current.document_id) < 0), "derived index query matches are not ranked deterministically");
  }
  const matchIds = result.matches.map((match) => match.document_id);
  assert(new Set(matchIds).size === matchIds.length, "derived index query matches contain duplicates");
  requireSafeInteger(result.omitted_match_count, "derived index query omitted count", {min: 0, max: 100000});
  if (result.status === "STALE") assert(result.matches.length === 0 && result.omitted_match_count === 0, "stale derived index query must not return matches");
  if (result.status === "MATCHED") assert(result.matches.length > 0, "matched derived index query has no matches");
  if (result.status === "NO_MATCH") assert(result.matches.length === 0 && result.omitted_match_count === 0, "no-match query has matches");
  requireSha(result.result_sha256, "derived index query result digest");
  assert(result.result_sha256 === digestWithout(result, "result_sha256"), "derived index query result digest mismatch");
  return result;
}

export function queryDerivedIndex(index, {
  role,
  queryText,
  currentSourceSnapshotSha256 = null,
  currentPolicySha256 = null,
  limit = 20,
}) {
  validateDerivedIndex(index);
  requireIdentifier(role, "derived index query role");
  const {normalized, tokens} = normalizeContent(queryText, "derived index query text");
  requireSafeInteger(limit, "derived index query limit", {min: 1, max: 100});
  const documentMap = new Map(index.documents.map((document) => [document.document_id, document]));
  const postings = new Map(index.postings.map((posting) => [posting.token_sha256, posting.document_ids]));
  const counts = new Map();
  for (const token of tokens) {
    const documentIds = postings.get(tokenDigest(token)) ?? [];
    for (const documentId of documentIds) {
      const document = documentMap.get(documentId);
      if (document.role_scope.includes(role)) counts.set(documentId, (counts.get(documentId) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .map(([documentId, matchCount]) => ({document_id: documentId, match_count: matchCount}))
    .sort((left, right) => right.match_count - left.match_count || compareUtf8(left.document_id, right.document_id));
  let stale = false;
  if (currentSourceSnapshotSha256 !== null) {
    requireSha(currentSourceSnapshotSha256, "current source snapshot");
    stale = stale || currentSourceSnapshotSha256 !== index.source_snapshot_sha256;
  }
  if (currentPolicySha256 !== null) {
    requireSha(currentPolicySha256, "current policy digest");
    stale = stale || currentPolicySha256 !== index.policy_sha256;
  }
  const selected = stale ? [] : ranked.slice(0, limit);
  const result = {
    schema: DERIVED_INDEX_QUERY_SCHEMA,
    version: DERIVED_INDEX_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    index_sha256: index.index_sha256,
    project_ref: index.project_ref,
    role,
    query_sha256: canonicalDigest({project_ref: index.project_ref, role, query: normalized}),
    status: stale ? "STALE" : (selected.length > 0 ? "MATCHED" : "NO_MATCH"),
    limit,
    matches: selected,
    omitted_match_count: stale ? 0 : Math.max(0, ranked.length - selected.length),
    result_sha256: null,
  };
  result.result_sha256 = digestWithout(result, "result_sha256");
  assertSafeRecord(result, "derived index query result");
  return validateDerivedIndexQueryResult(result, {index});
}
