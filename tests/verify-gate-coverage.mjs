#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {readFile} from "node:fs/promises";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {validateGateGraph} from "../control/gate-model.mjs";
import {loadQuestionCatalog, validateCatalogAgainstGraphs} from "../control/question-catalog.mjs";
import {loadCoverageManifest, validateCoverageAgainstGraphs} from "../control/coverage-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const general = JSON.parse(await readFile(path.join(ROOT, "governance/general-manifest.json"), "utf8"));
const lanes = JSON.parse(await readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
const graphs = new Map();
for (const binding of [...general.graphs, ...lanes.lanes]) {
  const graph = await compileGateFile(path.join(ROOT, binding.path));
  validateGateGraph(graph);
  graphs.set(graph.graph_id, graph);
}
const catalog = await loadQuestionCatalog(ROOT);
validateCatalogAgainstGraphs(graphs, catalog);
const coverage = await loadCoverageManifest(ROOT);
validateCoverageAgainstGraphs(coverage, graphs, catalog);
assert(coverage.categories.some((category) => category.category_id === "code_hygiene_repository" && category.standard_families.includes("race conditions")));
assert(coverage.categories.some((category) => category.category_id === "response_gating" && category.standard_families.includes("YES-only pass")));
console.log(JSON.stringify({status: "PASS", graph_count: graphs.size, gate_count: coverage.graph_coverage.flatMap((item) => item.gate_ids).length, category_count: coverage.categories.length}));
