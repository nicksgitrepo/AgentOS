#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {digestWithout} from "../control/canonical-json.mjs";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {validateGateGraph} from "../control/gate-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(ROOT, "governance/general-manifest.json"), "utf8"));
assert.equal(manifest.schema, "agentos.general_manifest.v1");
assert.equal(manifest.digest, digestWithout(manifest, "digest"));
assert.equal(manifest.graphs.length, 8);
const ids = new Set();
for (const binding of manifest.graphs) {
  const graph = await compileGateFile(path.join(ROOT, binding.path));
  validateGateGraph(graph);
  assert.equal(graph.graph_id, binding.graph_id);
  assert.equal(graph.digest, binding.graph_sha256);
  assert(!ids.has(graph.graph_id));
  ids.add(graph.graph_id);
}
assert(ids.has("CORE"));
assert(ids.has("GENERAL_EVIDENCE"));
assert(ids.has("GENERAL_SECURITY"));
console.log(JSON.stringify({status: "PASS", general_graph_count: manifest.graphs.length}));
