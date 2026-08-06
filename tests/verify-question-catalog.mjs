#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {loadQuestionCatalog, renderGatePacket, validateCatalogAgainstGraphs, validateRenderedGatePacket} from "../control/question-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generalManifest = JSON.parse(await readFile(path.join(ROOT, "governance/general-manifest.json"), "utf8"));
const laneManifest = JSON.parse(await readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
const bindings = [...generalManifest.graphs, ...laneManifest.lanes];
const graphs = new Map(await Promise.all(bindings.map(async (binding) => [binding.graph_id, await compileGateFile(path.join(ROOT, binding.path))])));
const catalog = await loadQuestionCatalog(ROOT);
validateCatalogAgainstGraphs(graphs, catalog);

let renderedQuestions = 0;
for (const graph of graphs.values()) {
  const packet = renderGatePacket(graph, catalog);
  validateRenderedGatePacket(packet, {graph, catalog});
  assert.equal(packet.questions.length, graph.nodes.length);
  for (const question of packet.questions) {
    renderedQuestions += 1;
    assert(!question.gate_name.includes(question.gate_id), `${question.gate_id} still exposes its machine ID as its name`);
    assert.equal(question.response_template, `Gate "${question.gate_name}" passed successfully.`);
    for (const answer of question.allowed_answers) {
      assert(question.next_by_answer[answer].target_id.length > 0);
      assert(question.repair_guidance[answer].length > 0);
    }
  }
}

const graph = graphs.get("FUNCTIONALITY");
const packet = renderGatePacket(graph, catalog);
const tampered = structuredClone(packet);
tampered.questions[0].gate_name = "FUNC-001";
tampered.questions[0].digest = "0".repeat(64);
assert.throws(() => validateRenderedGatePacket(tampered, {graph, catalog}), /human-readable|digest|differs/u);
assert(renderedQuestions >= 45, "question catalog rendered too few gates");
console.log(JSON.stringify({status: "PASS", graphs: graphs.size, rendered_questions: renderedQuestions, catalog_digest: catalog.digest}));

