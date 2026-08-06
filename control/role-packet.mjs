import {assert, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";

export const ROLE_PACKET_SCHEMA = "agentos.role_packet.v1";
export const ROLE_SPECS = Object.freeze([
  {role_id: "CAMPAIGN_ORCHESTRATOR", display_name: "Campaign Orchestrator", lifetime: "CAMPAIGN"},
  {role_id: "INDEPENDENT_AUDITOR", display_name: "Independent Auditor", lifetime: "CAMPAIGN"},
  {role_id: "INTENT_REGULATOR", display_name: "Intent Regulator", lifetime: "PERSISTENT"},
  {role_id: "RUNTIME", display_name: "Runtime", lifetime: "PERSISTENT"},
  {role_id: "NAMED_LANE_WORKER", display_name: "Named Lane Worker", lifetime: "CAMPAIGN"},
]);

const AUTHORITY = Object.freeze({
  INTENT_REGULATOR: ["INTENT_REASSESSMENT", "PROJECT_GOVERNANCE_REVIEW"],
  RUNTIME: ["HOST_READBACK", "EXTERNAL_ACTION_REVIEW", "RELEASE_REVIEW"],
  CAMPAIGN_ORCHESTRATOR: ["CAMPAIGN_ROUTING", "WORKER_REPLACEMENT", "SOFT_BOUNDARY_REVIEW"],
  INDEPENDENT_AUDITOR: ["INDEPENDENT_ACCEPTANCE_OR_REJECTION"],
  NAMED_LANE_WORKER: ["ASSIGNED_LANE_REPAIR", "EVIDENCE_COLLECTION"],
});

const PROHIBITED = Object.freeze([
  "SELF_ACCEPTANCE",
  "UNAUTHORIZED_SCOPE_CHANGE",
  "INVENTED_EVIDENCE",
  "UNAUTHORIZED_EXTERNAL_ACTION",
  "SILENT_HARD_BOUNDARY_BYPASS",
]);

const GENERAL_GRAPH_IDS = new Set([
  "CORE", "GENERAL_CLOSURE", "GENERAL_CONVERSATION", "GENERAL_EVIDENCE",
  "GENERAL_PROGRESS", "GENERAL_RECOVERY", "GENERAL_RESPONSE", "GENERAL_SECURITY",
]);
const ROLE_GRAPH_IDS = Object.freeze({
  CAMPAIGN_ORCHESTRATOR: new Set(["BOOTSTRAP_CONTEXT", "DELIVERY_CLOSURE", "INTENT_SCOPE", "ROLE_ROUTING", "USER_CONVERSATION"]),
  INDEPENDENT_AUDITOR: new Set(["BOOTSTRAP_CONTEXT", "CODE_HYGIENE", "DELIVERY_CLOSURE", "EVIDENCE_IDENTITY", "FUNCTIONALITY", "INTENT_SCOPE", "PROGRESS_HEALTH", "RECOVERY_BOUNDARIES", "ROLE_ROUTING", "SECURITY_PRIVACY", "UI_UX", "USER_CONVERSATION"]),
  INTENT_REGULATOR: new Set(["DELIVERY_CLOSURE", "INTENT_SCOPE", "ROLE_ROUTING", "USER_CONVERSATION"]),
  RUNTIME: new Set(["DELIVERY_CLOSURE"]),
});

function laneGraphId(laneId) {
  return laneId.toUpperCase().replaceAll("-", "_");
}

function validateGraphScope(roleId, graphIds, laneId = null) {
  const extras = graphIds.filter((graphId) => !GENERAL_GRAPH_IDS.has(graphId));
  assert(GENERAL_GRAPH_IDS.size === graphIds.filter((graphId) => GENERAL_GRAPH_IDS.has(graphId)).length, `${roleId} graph scope must include the complete general foundation`);
  if (roleId === "NAMED_LANE_WORKER") {
    assert(extras.length === 1 && extras[0] === laneGraphId(laneId), `${roleId} graph scope must contain only its lane`);
    return;
  }
  const allowed = ROLE_GRAPH_IDS[roleId];
  assert(allowed, `${roleId} graph scope is not defined`);
  assert(extras.every((graphId) => allowed.has(graphId)), `${roleId} received governance for another role`);
  assert(extras.length === allowed.size, `${roleId} graph scope must contain its complete role governance`);
}

function spec(roleId) {
  const value = ROLE_SPECS.find((candidate) => candidate.role_id === roleId);
  assert(value, `unknown role ${roleId}`);
  return value;
}

export function composeRolePacket({role_id, lane_id = null, graph_ids, display_name = null}) {
  const role = spec(role_id);
  sortedUniqueStrings(graph_ids, `${role_id} graph_ids`);
  if (role_id === "NAMED_LANE_WORKER") {
    assert(typeof lane_id === "string" && /^[a-z][a-z0-9._-]*$/u.test(lane_id), "named lane worker requires a stable lane_id");
    display_name ??= `${lane_id} Worker`;
  } else {
    assert(lane_id === null, `${role_id} cannot carry a lane_id`);
    display_name ??= role.display_name;
  }
  validateGraphScope(role_id, graph_ids, lane_id);
  assert(typeof display_name === "string" && display_name.length > 0, "display_name is required");
  const packet = {
    schema: ROLE_PACKET_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    role_id,
    display_name,
    ...(lane_id === null ? {} : {lane_id}),
    lifetime: role.lifetime,
    graph_ids: [...graph_ids],
    allowed_authority: [...AUTHORITY[role_id]],
    prohibited_authority: [...PROHIBITED],
    digest: null,
  };
  return {...packet, digest: digestWithout(packet, "digest")};
}

export function validateRolePacket(packet) {
  assert(packet && packet.schema === ROLE_PACKET_SCHEMA && packet.version === 1, "role packet identity is invalid");
  const role = spec(packet.role_id);
  const expected = ["schema", "version", "status", "role_id", "display_name", "lifetime", "graph_ids", "allowed_authority", "prohibited_authority", "digest"];
  if (packet.lane_id !== undefined) expected.push("lane_id");
  assert(JSON.stringify(Object.keys(packet).sort()) === JSON.stringify(expected.sort()), "role packet fields mismatch");
  assert(packet.status === "PREPARED_NOT_ACTIVATED", "role packet status is invalid");
  assert(packet.lifetime === role.lifetime, "role packet lifetime is invalid");
  sortedUniqueStrings(packet.graph_ids, "role packet graph_ids");
  validateGraphScope(packet.role_id, packet.graph_ids, packet.lane_id ?? null);
  assert(JSON.stringify(packet.allowed_authority) === JSON.stringify(AUTHORITY[packet.role_id]), "role packet authority is invalid");
  assert(JSON.stringify(packet.prohibited_authority) === JSON.stringify(PROHIBITED), "role packet prohibitions are invalid");
  if (packet.role_id === "NAMED_LANE_WORKER") assert(typeof packet.lane_id === "string" && packet.lane_id.length > 0, "lane_id is required");
  else assert(packet.lane_id === undefined, `${packet.role_id} must not carry a lane_id`);
  assert(packet.digest === digestWithout(packet, "digest"), "role packet digest does not match content");
  return packet;
}
