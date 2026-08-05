import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";

export const COVERAGE_MANIFEST_SCHEMA = "agentos.gate_coverage.v1";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function text(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

export function validateCoverageManifest(manifest) {
  exactKeys(manifest, ["schema", "version", "status", "scope_rules", "categories", "graph_coverage", "digest"], "coverage manifest");
  assert(manifest.schema === COVERAGE_MANIFEST_SCHEMA && manifest.version === 1, "coverage manifest identity is invalid");
  assert(manifest.status === "PREPARED_NOT_ACTIVATED", "coverage manifest status is invalid");
  exactKeys(manifest.scope_rules, ["NAMED_LANE_WORKER", "INDEPENDENT_AUDITOR"], "coverage scope rules");
  for (const [key, value] of Object.entries(manifest.scope_rules)) text(value, `coverage scope rule ${key}`);
  assert(Array.isArray(manifest.categories) && manifest.categories.length >= 13, "coverage categories are incomplete");
  const categories = new Set();
  for (const category of manifest.categories) {
    exactKeys(category, ["category_id", "display_name", "standard_families"], "coverage category");
    text(category.category_id, "coverage category_id");
    text(category.display_name, `coverage ${category.category_id} display_name`);
    sortedUniqueStrings(category.standard_families, `coverage ${category.category_id} standard_families`);
    assert(!categories.has(category.category_id), `duplicate coverage category ${category.category_id}`);
    categories.add(category.category_id);
  }
  assert(Array.isArray(manifest.graph_coverage) && manifest.graph_coverage.length > 0, "graph coverage is empty");
  const graphIds = new Set();
  const gateIds = new Set();
  for (const item of manifest.graph_coverage) {
    exactKeys(item, ["graph_id", "category_id", "gate_ids"], "graph coverage item");
    text(item.graph_id, "graph coverage graph_id");
    assert(categories.has(item.category_id), `graph coverage category is unknown: ${item.category_id}`);
    sortedUniqueStrings(item.gate_ids, `graph coverage ${item.graph_id} gate_ids`);
    assert(!graphIds.has(item.graph_id), `duplicate graph coverage ${item.graph_id}`);
    graphIds.add(item.graph_id);
    for (const gateId of item.gate_ids) {
      assert(!gateIds.has(gateId), `gate is covered more than once: ${gateId}`);
      gateIds.add(gateId);
    }
  }
  assert(/^[0-9a-f]{64}$/u.test(manifest.digest) && manifest.digest === digestWithout(manifest, "digest"), "coverage manifest digest does not match content");
  return manifest;
}

export async function loadCoverageManifest(root) {
  return validateCoverageManifest(JSON.parse(await readFile(path.join(root, "governance/coverage-manifest.json"), "utf8")));
}

export function validateCoverageAgainstGraphs(manifest, graphs, catalog) {
  validateCoverageManifest(manifest);
  assert(graphs instanceof Map && graphs.size === manifest.graph_coverage.length, "coverage graph count differs from compiled graphs");
  const entries = new Map(manifest.graph_coverage.map((item) => [item.graph_id, item]));
  const actualGates = new Set();
  for (const [graphId, graph] of graphs) {
    const item = entries.get(graphId);
    assert(item, `compiled graph has no coverage entry: ${graphId}`);
    const expected = graph.nodes.map((node) => node.id).sort();
    assert(JSON.stringify(expected) === JSON.stringify([...item.gate_ids].sort()), `coverage gate list differs for ${graphId}`);
    for (const node of graph.nodes) {
      assert(catalog.gate_names[node.id], `covered gate has no display name: ${node.id}`);
      actualGates.add(node.id);
    }
  }
  assert(actualGates.size === manifest.graph_coverage.flatMap((item) => item.gate_ids).length, "coverage gate identity is not unique");
  return manifest;
}
