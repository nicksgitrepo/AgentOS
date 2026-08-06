#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {ANSWERS, validateGateGraph} from "../control/gate-model.mjs";
import {digestWithout} from "../control/canonical-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laneRoot = path.join(ROOT, "governance/lanes");
const files = (await readdir(laneRoot)).filter((file) => file.endsWith(".gate")).sort();
const manifest = JSON.parse(await readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
assert.equal(manifest.schema, "agentos.lane_manifest.v1");
assert.equal(manifest.version, 1);
assert.equal(manifest.status, "PREPARED_NOT_ACTIVATED");
assert.equal(manifest.digest, digestWithout(manifest, "digest"), "lane manifest digest must match content");
const expected = manifest.lanes.map((lane) => lane.path.slice("governance/lanes/".length)).sort();
assert.deepEqual(files, expected, "the lane directory and manifest must match exactly");
assert.equal(manifest.lanes.length, 12, "the lane manifest must enumerate exactly twelve lanes");
const graphs = await Promise.all(manifest.lanes.map((lane) => compileGateFile(path.join(ROOT, lane.path))));
const ids = graphs.map((graph) => graph.graph_id);
assert.equal(new Set(ids).size, ids.length, "lane graph IDs must be unique");
for (const [index, graph] of graphs.entries()) {
  const lane = manifest.lanes[index];
  validateGateGraph(graph);
  assert.equal(graph.graph_id, lane.graph_id, `${lane.lane_id} graph ID differs from manifest`);
  assert.equal(graph.digest, lane.graph_sha256, `${lane.lane_id} graph digest differs from manifest`);
  for (const node of graph.nodes) assert.deepEqual(Object.keys(node.transitions).sort(), [...ANSWERS].sort(), `${graph.graph_id} lacks an explicit answer path`);
  const publicText = JSON.stringify(graph).toLowerCase();
  assert(!publicText.includes("feature agent"), `${graph.graph_id} uses a generic worker role`);
}
console.log(JSON.stringify({status: "PASS", lane_count: graphs.length, lane_ids: ids}));
