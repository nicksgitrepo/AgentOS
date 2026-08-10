import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

const readJson = (relativePath) => JSON.parse(
  fs.readFileSync(path.join(root, relativePath), "utf8"),
);

const projectMapContract = readJson("schemas/project-map.v1.json");
const derivedIndexContract = readJson("schemas/derived-index.v1.json");
const projectMapInstance = readJson("schemas/project-map-instance.v1.json");
const derivedIndexInstance = readJson("schemas/derived-index-instance.v1.json");
const queryInstance = readJson("schemas/derived-index-query-instance.v1.json");

const expectedMapFields = [
  "schema",
  "version",
  "contract_status",
  "visibility",
  "advisory_only",
  "acceptance_authority",
  "map_id",
  "project_ref",
  "campaign_ref",
  "goal_ref",
  "map_kind",
  "role_scope",
  "source_commit",
  "source_tree",
  "source_snapshot_sha256",
  "policy_sha256",
  "compiler_sha256",
  "status",
  "coverage",
  "bounds",
  "stale_source_digests",
  "nodes",
  "edges",
  "omissions",
  "uncertainties",
  "conflicts",
  "map_sha256",
];

const expectedIndexFields = [
  "schema",
  "version",
  "contract_status",
  "visibility",
  "advisory_only",
  "acceptance_authority",
  "index_id",
  "project_ref",
  "memory_role",
  "index_kind",
  "tokenization",
  "token_digest_algorithm",
  "source_snapshot_sha256",
  "policy_sha256",
  "compiler_sha256",
  "status",
  "bounds",
  "documents",
  "postings",
  "index_sha256",
];

const expectedQueryFields = [
  "schema",
  "version",
  "contract_status",
  "visibility",
  "advisory_only",
  "acceptance_authority",
  "index_sha256",
  "project_ref",
  "role",
  "query_sha256",
  "status",
  "limit",
  "matches",
  "omitted_match_count",
  "result_sha256",
];

const sorted = (items) => [...items].sort();

const assertInstanceShape = (schema, id, fields) => {
  assert.equal(schema.$id, id);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(sorted(schema.required), sorted(fields));
  for (const field of fields) assert.ok(schema.properties[field], `${id} missing ${field}`);
  assert.equal(schema.properties.advisory_only.const, true);
  assert.equal(schema.properties.acceptance_authority.const, false);
  assert.equal(schema.properties.contract_status.const, "PREPARED_NOT_ACTIVATED");
  assert.equal(schema.properties.visibility.const, "CONTROL_SPACE");
};

assert.equal(projectMapContract.status, "PREPARED_NOT_ACTIVATED");
assert.equal(projectMapContract.activation.active, false);
assert.equal(projectMapContract.activation.protected_actions_allowed, false);
assert.equal(projectMapContract.controller, "control/project-map.mjs");
assert.equal(projectMapContract.project_map.instance_schema, "schemas/project-map-instance.v1.json");

assert.equal(derivedIndexContract.status, "PREPARED_NOT_ACTIVATED");
assert.equal(derivedIndexContract.activation.active, false);
assert.equal(derivedIndexContract.activation.protected_actions_allowed, false);
assert.equal(derivedIndexContract.controller, "control/derived-index.mjs");
assert.equal(derivedIndexContract.derived_index.instance_schema, "schemas/derived-index-instance.v1.json");
assert.equal(derivedIndexContract.query_result.instance_schema, "schemas/derived-index-query-instance.v1.json");

assertInstanceShape(projectMapInstance, "governance.project_map.v1", expectedMapFields);
assertInstanceShape(derivedIndexInstance, "governance.derived_index.v1", expectedIndexFields);
assertInstanceShape(queryInstance, "governance.derived_index_query_result.v1", expectedQueryFields);

assert.equal(derivedIndexInstance.$defs.document.additionalProperties, false);
assert.equal(Object.hasOwn(derivedIndexInstance.$defs.document.properties, "content"), false);
assert.equal(Object.hasOwn(derivedIndexInstance.$defs.document.properties, "raw_content"), false);
assert.equal(Object.hasOwn(queryInstance.properties, "query"), false);
assert.equal(Object.hasOwn(queryInstance.properties, "raw_query"), false);
assert.equal(Object.hasOwn(queryInstance.properties, "raw_content"), false);

console.log("PASS map/index strict instance contracts and privacy shape");
