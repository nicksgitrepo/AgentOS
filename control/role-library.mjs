import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";
import {compileGateFile} from "./gate-dsl.mjs";
import {validateGateGraph} from "./gate-model.mjs";
import {composeRolePacket, validateRolePacket} from "./role-packet.mjs";

export const ROLE_LIBRARY_SCHEMA = "agentos.role_library.v1";

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function validateSelection(selection) {
  assert(selection && selection.schema === "agentos.role_selection.v1", "role selection schema is invalid");
  assert(selection.version === 1 && selection.status === "PREPARED_NOT_ACTIVATED", "role selection identity is invalid");
  assert(selection.digest === digestWithout(selection, "digest"), "role selection digest does not match content");
  sortedUniqueStrings(selection.general_graph_ids, "general graph IDs");
  assert(Array.isArray(selection.roles) && selection.roles.length === 4, "role selection must contain four persistent/campaign roles");
  const roleIds = selection.roles.map((role) => role.role_id);
  assert(JSON.stringify(roleIds) === JSON.stringify([...roleIds].sort()), "role selections must be sorted");
  for (const role of selection.roles) {
    assert(typeof role.role_id === "string" && typeof role.display_name === "string", "role selection identity is incomplete");
    sortedUniqueStrings(role.graph_ids, `${role.role_id} graph IDs`);
  }
  const template = selection.worker_template;
  assert(template?.role_id === "NAMED_LANE_WORKER", "worker template role is invalid");
  sortedUniqueStrings(template.base_graph_ids, "worker base graph IDs");
  sortedUniqueStrings(template.lane_ids, "worker lane IDs");
  return selection;
}

function validateLibrary(library) {
  assert(library.schema === ROLE_LIBRARY_SCHEMA && library.version === 1, "role library identity is invalid");
  assert(library.status === "PREPARED_NOT_ACTIVATED", "role library status is invalid");
  assert(library.source && typeof library.source.lane_manifest_sha256 === "string" && typeof library.source.role_selection_sha256 === "string", "role library source binding is incomplete");
  assert(Array.isArray(library.packets) && library.packets.length === 16, "role library must contain four fixed roles and twelve lane workers");
  for (const packet of library.packets) validateRolePacket(packet);
  assert(library.digest === digestWithout(library, "digest"), "role library digest does not match content");
  return library;
}

export async function compileRoleLibrary(root) {
  const manifest = await readJson(root, "governance/lane-manifest.json");
  const selection = validateSelection(await readJson(root, "governance/role-selection.json"));
  assert(manifest.schema === "agentos.lane_manifest.v1" && manifest.digest === digestWithout(manifest, "digest"), "lane manifest is not bound");

  const graphs = new Map();
  const core = await compileGateFile(path.join(root, "governance/general/core.gate"));
  graphs.set(core.graph_id, core);
  for (const lane of manifest.lanes) {
    const graph = await compileGateFile(path.join(root, lane.path));
    validateGateGraph(graph);
    assert(graph.graph_id === lane.graph_id && graph.digest === lane.graph_sha256, `${lane.lane_id} graph binding differs`);
    graphs.set(graph.graph_id, graph);
  }
  const graphFor = (id) => { const graph = graphs.get(id); assert(graph, `role selection references unknown graph ${id}`); return graph; };
  const packets = [];
  for (const role of selection.roles) {
    const graphIds = [...new Set([...selection.general_graph_ids, ...role.graph_ids])].sort();
    graphIds.forEach(graphFor);
    packets.push(composeRolePacket({role_id: role.role_id, display_name: role.display_name, graph_ids: graphIds}));
  }
  const manifestByLane = new Map(manifest.lanes.map((lane) => [lane.lane_id, lane]));
  for (const laneId of selection.worker_template.lane_ids) {
    const lane = manifestByLane.get(laneId);
    assert(lane, `worker template references unknown lane ${laneId}`);
    const graphIds = [...new Set([...selection.worker_template.base_graph_ids, lane.graph_id])].sort();
    graphIds.forEach(graphFor);
    packets.push(composeRolePacket({role_id: "NAMED_LANE_WORKER", lane_id: laneId, graph_ids: graphIds}));
  }
  packets.sort((left, right) => `${left.role_id}:${left.lane_id ?? ""}`.localeCompare(`${right.role_id}:${right.lane_id ?? ""}`));
  const library = {
    schema: ROLE_LIBRARY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    source: {lane_manifest_sha256: manifest.digest, role_selection_sha256: selection.digest},
    packets,
    digest: null,
  };
  return validateLibrary({...library, digest: digestWithout(library, "digest")});
}

