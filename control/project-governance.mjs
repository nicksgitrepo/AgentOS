import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, compareUtf8, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";
import {compileGateFile} from "./gate-dsl.mjs";
import {validateGateGraph} from "./gate-model.mjs";
import {validateRolePacket} from "./role-packet.mjs";
import {getWorkspaceRuntimeBinding, validateWorkspaceBoundary} from "./workspace-boundary.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

export const PROJECT_GOVERNANCE_SCHEMA = "agentos.project_governance.v1";
export const PROJECT_ROLE_GOVERNANCE_SCHEMA = "agentos.project_role_governance.v1";
export const PROJECT_ROLE_LIBRARY_SCHEMA = "agentos.project_role_library.v1";

const ID = /^[A-Z][A-Z0-9._:-]*$/u;
const ROLE = /^(?:[A-Z][A-Z0-9._-]*|NAMED_LANE_WORKER:[a-z][a-z0-9._-]*)$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function relativePath(value, label) {
  const slash = String.fromCharCode(47);
  const backslash = String.fromCharCode(92);
  assert(typeof value === "string" && value.length > 0 && value[0] !== slash && value[0] !== backslash && !(value.length > 1 && value[1] === ":"), `${label} must be a relative path`);
  const normalized = path.posix.normalize(value.replaceAll(backslash, slash));
  assert(normalized !== "." && !normalized.startsWith("../") && normalized !== ".." && !normalized.includes("/../"), `${label} escapes the project control repository`);
  return normalized;
}

function validateBinding(binding, label) {
  exactKeys(binding, ["graph_id", "path", "graph_sha256"], label);
  assert(ID.test(binding.graph_id), `${label}.graph_id is invalid`);
  relativePath(binding.path, `${label}.path`);
  assert(DIGEST.test(binding.graph_sha256), `${label}.graph_sha256 is invalid`);
}

function validateOverlay(overlay, label) {
  exactKeys(overlay, ["role_id", "graph_ids"], label);
  assert(ROLE.test(overlay.role_id) || overlay.role_id === "ALL_ROLES", `${label}.role_id is invalid`);
  sortedUniqueStrings(overlay.graph_ids, `${label}.graph_ids`);
  overlay.graph_ids.forEach((graphId) => assert(ID.test(graphId), `${label}.graph_ids contains an invalid ID`));
}

function validateProjectGovernanceShape(source, {compiled = false} = {}) {
  assertPortableRecord(source, compiled ? "compiled project governance" : "project governance");
  exactKeys(source, compiled
    ? ["schema", "version", "status", "project_id", "source_revision", "graph_bindings", "default_graph_ids", "role_overlays", "graph_digests", "digest"]
    : ["schema", "version", "status", "project_id", "source_revision", "graph_bindings", "default_graph_ids", "role_overlays", "digest"],
  compiled ? "compiled project governance" : "project governance");
  assert(source.schema === PROJECT_GOVERNANCE_SCHEMA && source.version === 1 && source.status === "PREPARED_NOT_ACTIVATED", "project governance identity is invalid");
  assert(ID.test(source.project_id), "project governance project_id is invalid");
  nonempty(source.source_revision, "project governance source_revision");
  assert(Array.isArray(source.graph_bindings) && source.graph_bindings.length > 0, "project governance graph_bindings are empty");
  source.graph_bindings.forEach((binding, index) => validateBinding(binding, `project governance graph_bindings[${index}]`));
  const graphIds = source.graph_bindings.map((binding) => binding.graph_id);
  assert(new Set(graphIds).size === graphIds.length, "project governance graph IDs are duplicated");
  sortedUniqueStrings(source.default_graph_ids, "project governance default_graph_ids");
  source.default_graph_ids.forEach((graphId) => assert(graphIds.includes(graphId), `project default graph ${graphId} has no binding`));
  assert(Array.isArray(source.role_overlays), "project governance role_overlays are invalid");
  source.role_overlays.forEach((overlay, index) => {
    validateOverlay(overlay, `project governance role_overlays[${index}]`);
    overlay.graph_ids.forEach((graphId) => assert(graphIds.includes(graphId), `project role graph ${graphId} has no binding`));
  });
  return source;
}

export function validateProjectGovernance(source) {
  validateProjectGovernanceShape(source);
  assert(DIGEST.test(source.digest) && source.digest === digestWithout(source, "digest"), "project governance digest does not match content");
  return source;
}

function controlRootFor(boundary) {
  validateWorkspaceBoundary(boundary);
  return getWorkspaceRuntimeBinding(boundary).control_root;
}

function validateRoot(root, boundary) {
  const controlRoot = path.resolve(controlRootFor(boundary));
  const candidate = path.resolve(root);
  assert(candidate === controlRoot || candidate.startsWith(`${controlRoot}${path.sep}`), "project governance root must be inside the external control repository");
  return candidate;
}

async function readGraph(root, binding) {
  const graphPath = path.join(root, binding.path);
  const graph = await compileGateFile(graphPath);
  validateGateGraph(graph);
  assert(graph.graph_id === binding.graph_id, `${binding.graph_id} graph identity differs`);
  assert(graph.digest === binding.graph_sha256, `${binding.graph_id} graph digest differs`);
  assertPortableRecord(graph, `${binding.graph_id} project governance graph`);
  return graph;
}

export async function compileProjectGovernance(root, source, {workspace_boundary}) {
  validateProjectGovernance(source);
  const safeRoot = validateRoot(root, workspace_boundary);
  const graphs = [];
  for (const binding of source.graph_bindings) graphs.push(await readGraph(safeRoot, binding));
  const library = {
    schema: PROJECT_GOVERNANCE_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id: source.project_id,
    source_revision: source.source_revision,
    graph_bindings: source.graph_bindings.map((binding) => ({...binding})),
    default_graph_ids: [...source.default_graph_ids],
    role_overlays: source.role_overlays.map((overlay) => ({...overlay, graph_ids: [...overlay.graph_ids]})),
    graph_digests: graphs.map((graph) => ({graph_id: graph.graph_id, digest: graph.digest})).sort((left, right) => compareUtf8(left.graph_id, right.graph_id)),
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateProjectGovernanceLibrary(library);
}

export function validateProjectGovernanceLibrary(library) {
  validateProjectGovernanceShape(library, {compiled: true});
  assert(Array.isArray(library.graph_digests) && library.graph_digests.length === library.graph_bindings.length, "compiled project governance graph digests are incomplete");
  library.graph_digests.forEach((item, index) => {
    exactKeys(item, ["graph_id", "digest"], `compiled project governance graph_digests[${index}]`);
    assert(ID.test(item.graph_id) && DIGEST.test(item.digest), `compiled project governance graph_digests[${index}] is invalid`);
  });
  assert(DIGEST.test(library.digest) && library.digest === digestWithout(library, "digest"), "compiled project governance digest does not match content");
  return library;
}

function applicableProjectGraphs(projectLibrary, roleId, laneId) {
  const ids = new Set(projectLibrary.default_graph_ids);
  for (const overlay of projectLibrary.role_overlays) {
    if (overlay.role_id === "ALL_ROLES" || overlay.role_id === roleId || (roleId === "NAMED_LANE_WORKER" && overlay.role_id === `NAMED_LANE_WORKER:${laneId}`)) {
      overlay.graph_ids.forEach((graphId) => ids.add(graphId));
    }
  }
  return [...ids].sort(compareUtf8);
}

export function compileProjectRoleGovernance({baseRolePacket, projectLibrary}) {
  validateRolePacket(baseRolePacket);
  validateProjectGovernanceLibrary(projectLibrary);
  const laneId = baseRolePacket.lane_id ?? null;
  const projectGraphIds = applicableProjectGraphs(projectLibrary, baseRolePacket.role_id, laneId);
  const packet = {
    schema: PROJECT_ROLE_GOVERNANCE_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id: projectLibrary.project_id,
    role_id: baseRolePacket.role_id,
    display_name: baseRolePacket.display_name,
    ...(laneId === null ? {} : {lane_id: laneId}),
    lifetime: baseRolePacket.lifetime,
    base_role_packet_digest: baseRolePacket.digest,
    project_governance_digest: projectLibrary.digest,
    graph_ids: [...new Set([...baseRolePacket.graph_ids, ...projectGraphIds])].sort(compareUtf8),
    project_graph_ids: projectGraphIds,
    allowed_authority: [...baseRolePacket.allowed_authority],
    prohibited_authority: [...baseRolePacket.prohibited_authority],
    digest: null,
  };
  packet.digest = digestWithout(packet, "digest");
  return validateProjectRoleGovernance(packet);
}

export function validateProjectRoleGovernance(packet) {
  assertPortableRecord(packet, "project role governance");
  const expected = ["schema", "version", "status", "project_id", "role_id", "display_name", "lifetime", "base_role_packet_digest", "project_governance_digest", "graph_ids", "project_graph_ids", "allowed_authority", "prohibited_authority", "digest"];
  if (packet.lane_id !== undefined) expected.push("lane_id");
  exactKeys(packet, expected, "project role governance");
  assert(packet.schema === PROJECT_ROLE_GOVERNANCE_SCHEMA && packet.version === 1 && packet.status === "PREPARED_NOT_ACTIVATED", "project role governance identity is invalid");
  assert(ID.test(packet.project_id) && ID.test(packet.role_id), "project role governance IDs are invalid");
  if (packet.lane_id !== undefined) assert(/^[a-z][a-z0-9._-]*$/u.test(packet.lane_id), "project role governance lane_id is invalid");
  nonempty(packet.display_name, "project role governance display_name");
  nonempty(packet.lifetime, "project role governance lifetime");
  assert(DIGEST.test(packet.base_role_packet_digest) && DIGEST.test(packet.project_governance_digest), "project role governance source digests are invalid");
  sortedUniqueStrings(packet.graph_ids, "project role governance graph_ids");
  sortedUniqueStrings(packet.project_graph_ids, "project role governance project_graph_ids");
  packet.project_graph_ids.forEach((graphId) => assert(packet.graph_ids.includes(graphId), `project graph ${graphId} is not in effective graph_ids`));
  assert(Array.isArray(packet.allowed_authority) && Array.isArray(packet.prohibited_authority), "project role governance authority is invalid");
  assert(DIGEST.test(packet.digest) && packet.digest === digestWithout(packet, "digest"), "project role governance digest does not match content");
  return packet;
}

export function compileProjectRoleLibrary({baseRoleLibrary, projectLibrary}) {
  validateProjectGovernanceLibrary(projectLibrary);
  assert(baseRoleLibrary && Array.isArray(baseRoleLibrary.packets), "base role library is required");
  const packets = baseRoleLibrary.packets.map((basePacket) => compileProjectRoleGovernance({baseRolePacket: basePacket, projectLibrary}));
  const library = {
    schema: PROJECT_ROLE_LIBRARY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id: projectLibrary.project_id,
    base_role_library_digest: baseRoleLibrary.digest,
    project_governance_digest: projectLibrary.digest,
    packets,
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateProjectRoleLibrary(library);
}

export function validateProjectRoleLibrary(library) {
  assertPortableRecord(library, "project role library");
  exactKeys(library, ["schema", "version", "status", "project_id", "base_role_library_digest", "project_governance_digest", "packets", "digest"], "project role library");
  assert(library.schema === PROJECT_ROLE_LIBRARY_SCHEMA && library.version === 1 && library.status === "PREPARED_NOT_ACTIVATED", "project role library identity is invalid");
  assert(ID.test(library.project_id) && DIGEST.test(library.base_role_library_digest) && DIGEST.test(library.project_governance_digest), "project role library source identity is invalid");
  assert(Array.isArray(library.packets) && library.packets.length > 0, "project role library packets are empty");
  library.packets.forEach((packet) => validateProjectRoleGovernance(packet));
  assert(DIGEST.test(library.digest) && library.digest === digestWithout(library, "digest"), "project role library digest does not match content");
  return library;
}
