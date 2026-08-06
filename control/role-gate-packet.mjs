import {assert, digestWithout, compareUtf8} from "./canonical-json.mjs";
import {validateRolePacket} from "./role-packet.mjs";
import {renderGatePacket, validateRenderedGatePacket} from "./question-catalog.mjs";

export const ROLE_GATE_PACKET_SCHEMA = "agentos.role_gate_packet.v1";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function renderRoleGraphs(rolePacket, graphs, catalog) {
  assert(graphs instanceof Map, "role gate packet graph map is required");
  return rolePacket.graph_ids.map((graphId) => {
    const graph = graphs.get(graphId);
    assert(graph, `role gate packet graph is missing: ${graphId}`);
    return renderGatePacket(graph, catalog);
  }).sort((left, right) => compareUtf8(left.graph_id, right.graph_id));
}

export function renderRoleGatePacket({rolePacket, graphs, catalog}) {
  validateRolePacket(rolePacket);
  const graph_packets = renderRoleGraphs(rolePacket, graphs, catalog);
  const packet = {
    schema: ROLE_GATE_PACKET_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    role_id: rolePacket.role_id,
    display_name: rolePacket.display_name,
    ...(rolePacket.lane_id === undefined ? {} : {lane_id: rolePacket.lane_id}),
    graph_ids: graph_packets.map((graph) => graph.graph_id),
    graph_packets,
    digest: null,
  };
  packet.digest = digestWithout(packet, "digest");
  return validateRoleGatePacket(packet, {catalog});
}

export function validateRoleGatePacket(packet, {catalog = null} = {}) {
  const expected = ["schema", "version", "status", "role_id", "display_name", "graph_ids", "graph_packets", "digest"];
  if (packet?.lane_id !== undefined) expected.push("lane_id");
  exactKeys(packet, expected, "role gate packet");
  assert(packet.schema === ROLE_GATE_PACKET_SCHEMA && packet.version === 1, "role gate packet identity is invalid");
  assert(packet.status === "PREPARED_NOT_ACTIVATED", "role gate packet status is invalid");
  assert(typeof packet.role_id === "string" && packet.role_id.length > 0, "role gate packet role is invalid");
  assert(typeof packet.display_name === "string" && packet.display_name.length > 0, "role gate packet display name is invalid");
  assert(Array.isArray(packet.graph_ids) && packet.graph_ids.length > 0, "role gate packet graph IDs are empty");
  assert(JSON.stringify(packet.graph_ids) === JSON.stringify(packet.graph_ids.slice().sort(compareUtf8)), "role gate packet graph IDs must be sorted");
  assert(Array.isArray(packet.graph_packets) && packet.graph_packets.length === packet.graph_ids.length, "role gate packet graph count differs");
  assert(JSON.stringify(packet.graph_packets.map((graph) => graph.graph_id)) === JSON.stringify(packet.graph_ids), "role gate packet graph order differs");
  for (const graph of packet.graph_packets) validateRenderedGatePacket(graph, {catalog});
  assert(/^[0-9a-f]{64}$/u.test(packet.digest) && packet.digest === digestWithout(packet, "digest"), "role gate packet digest does not match content");
  return packet;
}
