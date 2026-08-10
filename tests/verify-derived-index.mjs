#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {scanPersistedRecord} from "../control/content-addressing.mjs";
import {
  CONTRACT_STATUS,
  DERIVED_INDEX_COMPILER_SHA256,
  DERIVED_INDEX_MEMORY_ROLE,
  DERIVED_INDEX_QUERY_SCHEMA,
  DERIVED_INDEX_SCHEMA,
  compileDerivedIndex,
  queryDerivedIndex,
  validateDerivedIndex,
  validateDerivedIndexQueryResult,
} from "../control/derived-index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/derived-index.v1.json"), "utf8"));
assert.equal(schema.status, CONTRACT_STATUS);
assert.equal(schema.controller, "control/derived-index.mjs");
assert.equal(schema.activation.active, false);
assert.equal(schema.derived_index.schema, DERIVED_INDEX_SCHEMA);
assert.equal(schema.derived_index.memory_role, DERIVED_INDEX_MEMORY_ROLE);
assert.equal(schema.derived_index.advisory_only, true);
assert.equal(schema.derived_index.acceptance_authority, false);
assert.equal(schema.query_result.schema, DERIVED_INDEX_QUERY_SCHEMA);

const sourceSnapshotSha256 = "a".repeat(64);
const policySha256 = "b".repeat(64);
const recordA = "c".repeat(64);
const recordB = "d".repeat(64);
const documents = [
  {
    document_id: "DOC-2",
    document_kind: "GOAL",
    source_record_digests: [recordB],
    role_scope: ["ORCHESTRATOR", "OWNER"],
    content: "Review project outcome and preserve boundaries",
  },
  {
    document_id: "DOC-1",
    document_kind: "BOUNDARY",
    source_record_digests: [recordA],
    role_scope: ["OWNER"],
    content: "Keep project records private",
  },
];
const compileArgs = {
  indexId: "INDEX-1",
  projectRef: "PROJECT-1",
  sourceSnapshotSha256,
  policySha256,
  documents,
};

const index = compileDerivedIndex(compileArgs);
assert.equal(index.schema, DERIVED_INDEX_SCHEMA);
assert.equal(index.contract_status, CONTRACT_STATUS);
assert.equal(index.advisory_only, true);
assert.equal(index.acceptance_authority, false);
assert.equal(index.memory_role, DERIVED_INDEX_MEMORY_ROLE);
assert.equal(index.compiler_sha256, DERIVED_INDEX_COMPILER_SHA256);
assert.equal(index.status, "READY");
assert.deepEqual(index.documents.map((document) => document.document_id), ["DOC-1", "DOC-2"]);
assert.ok(index.postings.length > 0);
assert.equal(Object.hasOwn(index.documents[0], "content"), false);
assert.equal(JSON.stringify(index).includes("Review project outcome"), false);
assert.equal(scanPersistedRecord(index).safe, true);
assert.doesNotThrow(() => validateDerivedIndex(index, {
  currentSourceSnapshotSha256: sourceSnapshotSha256,
  currentPolicySha256: policySha256,
}));

const rebuiltIndex = compileDerivedIndex({...compileArgs, documents: [...documents].reverse()});
assert.deepEqual(rebuiltIndex, index, "derived index compilation must be independent of input order");

const ownerQuery = queryDerivedIndex(index, {role: "OWNER", queryText: "project review"});
assert.equal(ownerQuery.schema, DERIVED_INDEX_QUERY_SCHEMA);
assert.equal(ownerQuery.status, "MATCHED");
assert.deepEqual(ownerQuery.matches.map((match) => match.document_id), ["DOC-2", "DOC-1"]);
assert.equal(JSON.stringify(ownerQuery).includes("project review"), false);
assert.equal(scanPersistedRecord(ownerQuery).safe, true);
assert.doesNotThrow(() => validateDerivedIndexQueryResult(ownerQuery));

const orchestratorPrivateQuery = queryDerivedIndex(index, {role: "ORCHESTRATOR", queryText: "private"});
assert.equal(orchestratorPrivateQuery.status, "NO_MATCH");
assert.deepEqual(orchestratorPrivateQuery.matches, []);

const staleQuery = queryDerivedIndex(index, {
  role: "OWNER",
  queryText: "project",
  currentSourceSnapshotSha256: "e".repeat(64),
});
assert.equal(staleQuery.status, "STALE");
assert.deepEqual(staleQuery.matches, []);

assert.throws(
  () => validateDerivedIndex(index, {currentSourceSnapshotSha256: "e".repeat(64)}),
  /source snapshot is stale/u,
);
const tamperedIndex = structuredClone(index);
tamperedIndex.postings[0].document_ids = [];
assert.throws(() => validateDerivedIndex(tamperedIndex), /must not be empty|digest mismatch/u);

const syntheticPath = ["", "synthetic", "private", "record"].join("/");
assert.throws(
  () => compileDerivedIndex({...compileArgs, documents: [{...documents[0], content: syntheticPath}]}),
  /privacy-safe|ABSOLUTE_PATH/u,
);
const syntheticSecret = ["API", "_KEY=placeholder"].join("");
assert.throws(
  () => compileDerivedIndex({...compileArgs, documents: [{...documents[0], content: syntheticSecret}]}),
  /privacy-safe|ENVIRONMENT_VALUE|SECRET_LIKE_VALUE/u,
);
const syntheticIdentity = ["00000000", "0000", "4000", "8000", "000000000000"].join("-");
assert.throws(
  () => compileDerivedIndex({...compileArgs, documents: [{...documents[0], document_id: syntheticIdentity}]}),
  /session|task|SESSION_OR_TASK_IDENTITY/u,
);

console.log("PASS derived index: privacy-safe hashed retrieval, role filtering, stale handling, and hostile inputs verified");
