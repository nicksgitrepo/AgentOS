#!/usr/bin/env node

import {
  BASE_GENERAL_SCHEMA,
  BASE_ROLE_SCHEMA,
  PROJECT_GENERAL_SCHEMA,
  GENERATED_PROJECT_ROLE_SCHEMA,
  GOVERNANCE_BINDING_SCHEMA,
  GOVERNANCE_MIGRATION_SCHEMA,
  FOUR_LIBRARY_VERSION,
  GOVERNANCE_VERSION,
  GENERATED_PROJECT_ROLE_KIND,
  PROJECT_GENERAL_KIND,
  RETIRED_CURRENT_ROLE_IDS,
  GOVERNANCE_UPDATE_MODES,
  GovernanceValidationError,
  assert,
  assertPortable,
  compareUtf8,
  digestWithout,
  exactKeys,
  failConflict,
  graphIds,
  graphNamespaceCollisions,
  makeLineage,
  requireDigest,
  requireIdentifier,
  requireLaneIdentifier,
  requirePositiveInteger,
  requireSafeToken,
  requireString,
  rolePacketKey,
  roleSort,
  sortedUniqueStrings,
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateCommonLibrary,
  validateLineage,
  validateMigrationConflicts,
  validateOwnership,
  validatePacketDigest,
  validatePrevious,
  validateProjectGeneralLibrary,
  validateRoleAuthority,
  validateStatus,
} from "./four-library-foundation.mjs";
import {
  TASK_GATE_CATALOG_SHA256,
  TASK_GATE_QUESTIONS,
} from "./task-gate-questions.mjs";

function projectGraphSelection(projectLibrary, packet) {
  const ids = new Set(projectLibrary.default_graph_ids);
  const prohibited = new Set();
  const evidence = new Set();
  for (const overlay of projectLibrary.role_overlays) {
    const applies = overlay.role_id === "ALL_ROLES" || overlay.role_id === packet.role_id;
    if (!applies) continue;
    overlay.graph_ids.forEach((graphId) => ids.add(graphId));
    overlay.additional_prohibited_authority.forEach((item) => prohibited.add(item));
    overlay.additional_required_evidence.forEach((item) => evidence.add(item));
  }
  return {
    graph_ids: [...ids].sort(compareUtf8),
    prohibited_authority: [...prohibited].sort(compareUtf8),
    required_evidence: [...evidence].sort(compareUtf8),
  };
}

function validateGeneratedRolePacket(packet, label, {baseRolePacket, projectGeneralLibrary, projectGraphBindings} = {}) {
  exactKeys(packet, [
    "role_id", "display_name", "role_kind", "lifetime", "lane_id", "base_role_packet_digest",
    "project_general_library_digest", "graph_ids", "project_graph_ids", "effective_graph_digests",
    "allowed_authority", "prohibited_authority", "required_evidence", "digest",
  ], label);
  requireIdentifier(packet.role_id, `${label}.role_id`);
  assert(!RETIRED_CURRENT_ROLE_IDS.includes(packet.role_id), `${label}.role_id is retired and cannot hold generated authority`);
  requireString(packet.display_name, `${label}.display_name`);
  requireString(packet.role_kind, `${label}.role_kind`);
  requireString(packet.lifetime, `${label}.lifetime`);
  if (packet.lane_id !== null) requireLaneIdentifier(packet.lane_id, `${label}.lane_id`);
  requireDigest(packet.base_role_packet_digest, `${label}.base_role_packet_digest`);
  requireDigest(packet.project_general_library_digest, `${label}.project_general_library_digest`);
  if (baseRolePacket !== undefined && baseRolePacket !== null) {
    assert(packet.base_role_packet_digest === baseRolePacket.digest, `${label}.base_role_packet_digest differs`);
    assert(packet.role_id === baseRolePacket.role_id && packet.lane_id === baseRolePacket.lane_id, `${label} role identity differs from base packet`);
    assert(packet.display_name === baseRolePacket.display_name && packet.role_kind === baseRolePacket.role_kind && packet.lifetime === baseRolePacket.lifetime, `${label} role metadata differs from base packet`);
    assert(packet.allowed_authority.length === baseRolePacket.allowed_authority.length && JSON.stringify(packet.allowed_authority) === JSON.stringify(baseRolePacket.allowed_authority), `${label} expands allowed authority`);
    assert(baseRolePacket.prohibited_authority.every((item) => packet.prohibited_authority.includes(item)), `${label} removes base prohibitions`);
  }
  if (projectGeneralLibrary !== undefined && projectGeneralLibrary !== null) assert(packet.project_general_library_digest === projectGeneralLibrary.digest, `${label}.project_general_library_digest differs`);
  sortedUniqueStrings(packet.graph_ids, `${label}.graph_ids`);
  sortedUniqueStrings(packet.project_graph_ids, `${label}.project_graph_ids`, {allowEmpty: true});
  packet.project_graph_ids.forEach((graphId) => assert(projectGraphBindings.some((binding) => binding.graph_id === graphId), `${label} has an unbound project graph`));
  assert(packet.project_graph_ids.every((graphId) => packet.graph_ids.includes(graphId)), `${label} project graph is not effective`);
  assert(Array.isArray(packet.effective_graph_digests), `${label}.effective_graph_digests must be an array`);
  const effectiveIds = packet.effective_graph_digests.map((item) => item.graph_id);
  sortedUniqueStrings(effectiveIds, `${label}.effective_graph_digests graph IDs`);
  assert(JSON.stringify(effectiveIds) === JSON.stringify(packet.graph_ids), `${label}.effective_graph_digests do not cover effective graph IDs`);
  packet.effective_graph_digests.forEach((item, index) => {
    exactKeys(item, ["graph_id", "graph_sha256", "source"], `${label}.effective_graph_digests[${index}]`);
    requireIdentifier(item.graph_id, `${label}.effective_graph_digests[${index}].graph_id`);
    requireDigest(item.graph_sha256, `${label}.effective_graph_digests[${index}].graph_sha256`);
    requireString(item.source, `${label}.effective_graph_digests[${index}].source`);
  });
  validateRoleAuthority({
    allowed_authority: packet.allowed_authority,
    prohibited_authority: packet.prohibited_authority,
    required_evidence: packet.required_evidence,
  }, label);
  if (baseRolePacket !== undefined && baseRolePacket !== null && projectGeneralLibrary !== undefined && projectGeneralLibrary !== null) {
    const selected = projectGraphSelection(projectGeneralLibrary, baseRolePacket);
    assert(JSON.stringify(packet.project_graph_ids) === JSON.stringify(selected.graph_ids), `${label}.project_graph_ids differ from project overlays`);
    assert(selected.prohibited_authority.every((item) => packet.prohibited_authority.includes(item)), `${label} omits project prohibitions`);
    assert(selected.required_evidence.every((item) => packet.required_evidence.includes(item)), `${label} omits project evidence requirements`);
  }
  validatePacketDigest(packet, label);
}

export function validateGeneratedProjectRoleLibrary(value, {baseGeneralLibrary = null, baseRoleLibrary = null, projectGeneralLibrary = null} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "library_kind", "governance_version", "ownership", "lineage",
    "project_id", "base_general_library_digest", "base_role_library_digest", "project_general_library_digest",
    "generation", "role_packets", "digest",
  ], "generated project role library");
  validateCommonLibrary(value, GENERATED_PROJECT_ROLE_SCHEMA, GENERATED_PROJECT_ROLE_KIND, "generated project role library");
  assert(value.ownership.owner_role === "GOVERNANCE_COMPILER", "generated project role library ownership.owner_role is invalid");
  assert(value.ownership.authoring_role === "GOVERNANCE_COMPILER", "generated project role library ownership.authoring_role is invalid");
  requireIdentifier(value.project_id, "generated project role library.project_id");
  requireDigest(value.base_general_library_digest, "generated project role library.base_general_library_digest");
  requireDigest(value.base_role_library_digest, "generated project role library.base_role_library_digest");
  requireDigest(value.project_general_library_digest, "generated project role library.project_general_library_digest");
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.base_general_library_digest === baseGeneralLibrary.digest, "generated project role base-general binding differs");
  }
  if (baseRoleLibrary !== null) {
    validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
    assert(value.base_role_library_digest === baseRoleLibrary.digest, "generated project role base-role binding differs");
  }
  if (projectGeneralLibrary !== null) {
    validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
    assert(value.project_id === projectGeneralLibrary.project_id, "generated project role project differs");
    assert(value.project_general_library_digest === projectGeneralLibrary.digest, "generated project role project-general binding differs");
  }
  exactKeys(value.generation, ["compiler", "compiler_version", "input_digests"], "generated project role library.generation");
  requireSafeToken(value.generation.compiler, "generated project role compiler");
  requireSafeToken(value.generation.compiler_version, "generated project role compiler version");
  sortedUniqueStrings(value.generation.input_digests, "generated project role input digests");
  value.generation.input_digests.forEach((item) => requireDigest(item, "generated project role input digest"));
  if (baseGeneralLibrary !== null && baseRoleLibrary !== null && projectGeneralLibrary !== null) {
    const expectedInputs = [baseGeneralLibrary.digest, baseRoleLibrary.digest, projectGeneralLibrary.digest].sort(compareUtf8);
    assert(JSON.stringify(value.generation.input_digests) === JSON.stringify(expectedInputs), "generated project role input bindings are incomplete or reordered");
  }
  assert(Array.isArray(value.role_packets) && value.role_packets.length > 0, "generated project role library.role_packets must not be empty");
  const baseByKey = new Map(baseRoleLibrary === null ? [] : baseRoleLibrary.role_packets.map((packet) => [rolePacketKey(packet), packet]));
  const projectBindings = projectGeneralLibrary === null ? [] : projectGeneralLibrary.project_graph_bindings;
  const keys = new Set();
  value.role_packets.forEach((packet, index) => {
    const basePacket = baseByKey.get(rolePacketKey(packet));
    assert(basePacket !== undefined, `generated project role packet ${rolePacketKey(packet)} has no base packet`);
    assert(!keys.has(rolePacketKey(packet)), `generated project role packet is duplicated: ${rolePacketKey(packet)}`);
    keys.add(rolePacketKey(packet));
    validateGeneratedRolePacket(packet, `generated project role library.role_packets[${index}]`, {
      baseRolePacket: basePacket,
      projectGeneralLibrary,
      projectGraphBindings: projectBindings,
    });
  });
  if (baseRoleLibrary !== null) assert(keys.size === baseRoleLibrary.role_packets.length, "generated project role inventory differs from base role inventory");
  assert(JSON.stringify(value.role_packets) === JSON.stringify([...value.role_packets].sort(roleSort)), "generated project role packets must be sorted");
  return value;
}

export function compileGeneratedProjectRoleLibrary({
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  previous = null,
  previousBaseGeneralLibrary = null,
  previousBaseRoleLibrary = null,
  previousProjectGeneralLibrary = null,
} = {}) {
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
  validatePrevious(previous, (record) => validateGeneratedProjectRoleLibrary(record, {
    baseGeneralLibrary: previousBaseGeneralLibrary ?? baseGeneralLibrary,
    baseRoleLibrary: previousBaseRoleLibrary ?? baseRoleLibrary,
    projectGeneralLibrary: previousProjectGeneralLibrary ?? projectGeneralLibrary,
  }), "generated project role previous record");
  const projectBindings = projectGeneralLibrary.project_graph_bindings;
  const packets = baseRoleLibrary.role_packets.map((basePacket) => {
    const selected = projectGraphSelection(projectGeneralLibrary, basePacket);
    const projectGraphIds = selected.graph_ids;
    const effectiveGraphIds = [...new Set([...basePacket.graph_ids, ...projectGraphIds])].sort(compareUtf8);
    const effectiveGraphDigests = effectiveGraphIds.map((graphId) => {
      const baseBinding = baseGeneralLibrary.general_graph_bindings.find((binding) => binding.graph_id === graphId);
      const roleBinding = baseRoleLibrary.role_graph_bindings.find((binding) => binding.graph_id === graphId);
      const projectBinding = projectBindings.find((binding) => binding.graph_id === graphId);
      const binding = baseBinding ?? roleBinding ?? projectBinding;
      assert(binding !== undefined, `generated project role graph is not bound: ${graphId}`);
      return {
        graph_id: graphId,
        graph_sha256: binding.graph_sha256,
        source: baseBinding !== undefined ? "BASE_GENERAL" : roleBinding !== undefined ? "BASE_ROLE" : "PROJECT_GENERAL",
      };
    });
    const packet = {
      role_id: basePacket.role_id,
      display_name: basePacket.display_name,
      role_kind: basePacket.role_kind,
      lifetime: basePacket.lifetime,
      lane_id: basePacket.lane_id,
      base_role_packet_digest: basePacket.digest,
      project_general_library_digest: projectGeneralLibrary.digest,
      graph_ids: effectiveGraphIds,
      project_graph_ids: projectGraphIds,
      effective_graph_digests: effectiveGraphDigests,
      allowed_authority: [...basePacket.allowed_authority],
      prohibited_authority: [...new Set([...basePacket.prohibited_authority, ...selected.prohibited_authority])].sort(compareUtf8),
      required_evidence: [...new Set([...basePacket.required_evidence, ...selected.required_evidence])].sort(compareUtf8),
      digest: null,
    };
    packet.digest = digestWithout(packet, "digest");
    return packet;
  }).sort(roleSort);
  const library = {
    schema: GENERATED_PROJECT_ROLE_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "COMPILED",
    library_kind: GENERATED_PROJECT_ROLE_KIND,
    governance_version: GOVERNANCE_VERSION,
    ownership: {owner_role: "GOVERNANCE_COMPILER", authoring_role: "GOVERNANCE_COMPILER"},
    lineage: makeLineage(previous),
    project_id: projectGeneralLibrary.project_id,
    base_general_library_digest: baseGeneralLibrary.digest,
    base_role_library_digest: baseRoleLibrary.digest,
    project_general_library_digest: projectGeneralLibrary.digest,
    generation: {
      compiler: "FOUR_LIBRARY_GOVERNANCE",
      compiler_version: "1",
      input_digests: [baseGeneralLibrary.digest, baseRoleLibrary.digest, projectGeneralLibrary.digest].sort(compareUtf8),
    },
    role_packets: packets,
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateGeneratedProjectRoleLibrary(library, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
}

export const GENERATED_TASK_ROLE_PACKET_SCHEMA = "agentos.generated_task_role_packet.v1";

function taskRolePacketFor(library, roleId, laneId) {
  return library.role_packets.find((packet) => packet.role_id === roleId && (laneId === null || packet.lane_id === laneId))
    ?? null;
}

export function validateGeneratedTaskRolePacket(value, {generatedProjectRoleLibrary = null} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "task_id_sha256", "task_kind", "role_id", "lane_id",
    "generated_project_role_library_digest", "task_gate_catalog_sha256", "applicable_question_ids",
    "graph_ids", "allowed_authority", "prohibited_authority", "required_evidence", "digest",
  ], "generated task role packet");
  assert(value.schema === GENERATED_TASK_ROLE_PACKET_SCHEMA && value.version === FOUR_LIBRARY_VERSION, "generated task role packet identity is invalid");
  assert(value.status === "PREPARED_NOT_ACTIVATED", "generated task role packet status is invalid");
  requireDigest(value.task_id_sha256, "generated task role packet task id");
  requireSafeToken(value.task_kind, "generated task role packet task kind");
  requireIdentifier(value.role_id, "generated task role packet role id");
  assert(!RETIRED_CURRENT_ROLE_IDS.includes(value.role_id), "generated task role packet role is retired");
  if (value.lane_id !== null) requireLaneIdentifier(value.lane_id, "generated task role packet lane id");
  requireDigest(value.generated_project_role_library_digest, "generated task role packet library digest");
  assert(value.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "generated task role packet task-gate catalog differs");
  sortedUniqueStrings(value.applicable_question_ids, "generated task role packet applicable questions");
  const knownQuestionIds = new Set(TASK_GATE_QUESTIONS.map((question) => question.question_id));
  value.applicable_question_ids.forEach((questionId) => assert(knownQuestionIds.has(questionId), "generated task role packet has an unknown task-gate question"));
  sortedUniqueStrings(value.graph_ids, "generated task role packet graph IDs");
  validateRoleAuthority({
    allowed_authority: value.allowed_authority,
    prohibited_authority: value.prohibited_authority,
    required_evidence: value.required_evidence,
  }, "generated task role packet");
  if (generatedProjectRoleLibrary !== null) {
    requireDigest(generatedProjectRoleLibrary.digest, "generated project role library digest");
    assert(value.generated_project_role_library_digest === generatedProjectRoleLibrary.digest, "generated task role packet library binding differs");
    const rolePacket = taskRolePacketFor(generatedProjectRoleLibrary, value.role_id, value.lane_id);
    assert(rolePacket !== null, "generated task role packet role is not present in generated library");
    assert(value.lane_id === rolePacket.lane_id, "generated task role packet lane differs");
    assert(JSON.stringify(value.graph_ids) === JSON.stringify(rolePacket.graph_ids), "generated task role packet graph scope differs");
    assert(JSON.stringify(value.allowed_authority) === JSON.stringify(rolePacket.allowed_authority), "generated task role packet expands authority");
    assert(rolePacket.prohibited_authority.every((item) => value.prohibited_authority.includes(item)), "generated task role packet removes prohibitions");
    assert(rolePacket.required_evidence.every((item) => value.required_evidence.includes(item)), "generated task role packet removes evidence requirements");
  }
  assertPortable(value, "generated task role packet");
  validatePacketDigest(value, "generated task role packet");
  return value;
}

export function compileGeneratedTaskRolePacket({
  generatedProjectRoleLibrary,
  baseGeneralLibrary = null,
  baseRoleLibrary = null,
  projectGeneralLibrary = null,
  roleId,
  laneId = null,
  taskIdSha256,
  taskKind,
  applicableQuestionIds,
} = {}) {
  assert(generatedProjectRoleLibrary !== null && generatedProjectRoleLibrary !== undefined, "generated project role library is required");
  assert(generatedProjectRoleLibrary.schema === GENERATED_PROJECT_ROLE_SCHEMA, "generated project role library schema is invalid");
  validatePacketDigest(generatedProjectRoleLibrary, "generated project role library");
  if (baseGeneralLibrary !== null && baseRoleLibrary !== null && projectGeneralLibrary !== null) {
    validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
  }
  requireDigest(taskIdSha256, "task id digest");
  requireIdentifier(roleId, "task role id");
  if (laneId !== null) requireLaneIdentifier(laneId, "task lane id");
  requireSafeToken(taskKind, "task kind");
  assert(Array.isArray(applicableQuestionIds) && applicableQuestionIds.length > 0, "applicable task-gate questions are required");
  const selectedQuestionIds = [...applicableQuestionIds].sort(compareUtf8);
  const packet = taskRolePacketFor(generatedProjectRoleLibrary, roleId, laneId);
  assert(packet !== null, "task role is not present in generated project role library");
  const taskPacket = {
    schema: GENERATED_TASK_ROLE_PACKET_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "PREPARED_NOT_ACTIVATED",
    task_id_sha256: taskIdSha256,
    task_kind: taskKind,
    role_id: packet.role_id,
    lane_id: packet.lane_id,
    generated_project_role_library_digest: generatedProjectRoleLibrary.digest,
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    applicable_question_ids: selectedQuestionIds,
    graph_ids: [...packet.graph_ids],
    allowed_authority: [...packet.allowed_authority],
    prohibited_authority: [...packet.prohibited_authority],
    required_evidence: [...packet.required_evidence],
    digest: null,
  };
  taskPacket.digest = digestWithout(taskPacket, "digest");
  return validateGeneratedTaskRolePacket(taskPacket, {generatedProjectRoleLibrary});
}

export function validateGovernanceBinding(value, {baseGeneralLibrary = null, baseRoleLibrary = null, projectGeneralLibrary = null, generatedProjectRoleLibrary = null} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "project_id", "policy_epoch", "library_digests", "ownership", "lineage", "digest",
  ], "governance binding");
  assert(value.schema === GOVERNANCE_BINDING_SCHEMA && value.version === FOUR_LIBRARY_VERSION, "governance binding identity is invalid");
  validateStatus(value.status, "governance binding.status");
  requireIdentifier(value.project_id, "governance binding.project_id");
  requirePositiveInteger(value.policy_epoch, "governance binding.policy_epoch");
  exactKeys(value.library_digests, ["base_general", "base_role", "project_general", "generated_project_role"], "governance binding.library_digests");
  for (const field of Object.keys(value.library_digests)) requireDigest(value.library_digests[field], `governance binding.library_digests.${field}`);
  validateOwnership(value.ownership, "governance binding.ownership");
  assert(value.ownership.owner_role === "AGENTOS.PRODUCT_OWNER", "governance binding ownership.owner_role is invalid");
  assert(value.ownership.authoring_role === "AGENTOS.SPAWNER", "governance binding ownership.authoring_role is invalid");
  validateLineage(value.lineage, "governance binding.lineage");
  validatePacketDigest(value, "governance binding");
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.library_digests.base_general === baseGeneralLibrary.digest, "governance binding base-general differs");
  }
  if (baseRoleLibrary !== null) {
    validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
    assert(value.library_digests.base_role === baseRoleLibrary.digest, "governance binding base-role differs");
  }
  if (projectGeneralLibrary !== null) {
    validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
    assert(value.project_id === projectGeneralLibrary.project_id, "governance binding project differs");
    assert(value.library_digests.project_general === projectGeneralLibrary.digest, "governance binding project-general differs");
  }
  if (generatedProjectRoleLibrary !== null) {
    validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
    assert(value.library_digests.generated_project_role === generatedProjectRoleLibrary.digest, "governance binding generated-role differs");
  }
  return value;
}

export function compileGovernanceBinding({
  project_id,
  policy_epoch,
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  generatedProjectRoleLibrary,
  previous = null,
} = {}) {
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
  validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
  requireIdentifier(project_id, "governance binding.project_id");
  assert(project_id === projectGeneralLibrary.project_id && project_id === generatedProjectRoleLibrary.project_id, "governance binding project IDs differ");
  requirePositiveInteger(policy_epoch, "governance binding.policy_epoch");
  if (previous !== null) {
    validateGovernanceBinding(previous);
    assert(previous.project_id === project_id, "governance binding previous record belongs to another project");
  }
  const binding = {
    schema: GOVERNANCE_BINDING_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "COMPILED",
    project_id,
    policy_epoch,
    library_digests: {
      base_general: baseGeneralLibrary.digest,
      base_role: baseRoleLibrary.digest,
      project_general: projectGeneralLibrary.digest,
      generated_project_role: generatedProjectRoleLibrary.digest,
    },
    ownership: {owner_role: "AGENTOS.PRODUCT_OWNER", authoring_role: "AGENTOS.SPAWNER"},
    lineage: makeLineage(previous),
    digest: null,
  };
  binding.digest = digestWithout(binding, "digest");
  return validateGovernanceBinding(binding, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary, generatedProjectRoleLibrary});
}

function validateGovernanceRecord(value, parents = {}) {
  switch (value?.schema) {
    case BASE_GENERAL_SCHEMA:
      return validateBaseGeneralLibrary(value);
    case BASE_ROLE_SCHEMA:
      return validateBaseRoleLibrary(value, {baseGeneralLibrary: parents.baseGeneralLibrary ?? null});
    case PROJECT_GENERAL_SCHEMA:
      return validateProjectGeneralLibrary(value, {
        baseGeneralLibrary: parents.baseGeneralLibrary ?? null,
        baseRoleLibrary: parents.baseRoleLibrary ?? null,
      });
    case GENERATED_PROJECT_ROLE_SCHEMA:
      return validateGeneratedProjectRoleLibrary(value, {
        baseGeneralLibrary: parents.baseGeneralLibrary ?? null,
        baseRoleLibrary: parents.baseRoleLibrary ?? null,
        projectGeneralLibrary: parents.projectGeneralLibrary ?? null,
      });
    case GOVERNANCE_BINDING_SCHEMA:
      return validateGovernanceBinding(value, {
        baseGeneralLibrary: parents.baseGeneralLibrary ?? null,
        baseRoleLibrary: parents.baseRoleLibrary ?? null,
        projectGeneralLibrary: parents.projectGeneralLibrary ?? null,
        generatedProjectRoleLibrary: parents.generatedProjectRoleLibrary ?? null,
      });
    default:
      throw new GovernanceValidationError("governance record schema is not transitionable");
  }
}

const STATUS_TRANSITIONS = Object.freeze({
  COMPILED: new Set(["INDEPENDENTLY_CHECKED", "REJECTED", "BLOCKED"]),
  INDEPENDENTLY_CHECKED: new Set(["OWNER_ACCEPTED", "REJECTED", "BLOCKED"]),
  OWNER_ACCEPTED: new Set(["PREPARED_NOT_ACTIVATED", "REJECTED", "BLOCKED"]),
  PREPARED_NOT_ACTIVATED: new Set(["ACTIVE", "SUPERSEDED", "REJECTED", "BLOCKED"]),
  ACTIVE: new Set(["SUPERSEDED", "BLOCKED"]),
  SUPERSEDED: new Set(),
  REJECTED: new Set(),
  BLOCKED: new Set(),
});

export function transitionGovernanceRecord(record, {
  nextStatus,
  ownerDecisionDigest = null,
  independentCheckDigest = null,
  parents = {},
} = {}) {
  validateGovernanceRecord(record, parents);
  validateStatus(nextStatus, "next governance status");
  assert(STATUS_TRANSITIONS[record.status]?.has(nextStatus), `governance status transition is not allowed: ${record.status}->${nextStatus}`);
  if (nextStatus === "INDEPENDENTLY_CHECKED" || nextStatus === "ACTIVE") requireDigest(independentCheckDigest ?? record.lineage.independent_check_digest, "independent check digest");
  if (nextStatus === "OWNER_ACCEPTED" || nextStatus === "ACTIVE") requireDigest(ownerDecisionDigest ?? record.lineage.owner_decision_digest, "owner decision digest");
  const transitioned = structuredClone(record);
  transitioned.status = nextStatus;
  transitioned.lineage = {
    revision: record.lineage.revision + 1,
    supersedes: record.digest,
    owner_decision_digest: ownerDecisionDigest ?? record.lineage.owner_decision_digest,
    independent_check_digest: independentCheckDigest ?? record.lineage.independent_check_digest,
  };
  transitioned.digest = digestWithout(transitioned, "digest");
  return validateGovernanceRecord(transitioned, parents);
}

export function activateGovernanceBinding(binding, {ownerDecisionDigest, independentCheckDigest} = {}) {
  return transitionGovernanceRecord(binding, {
    nextStatus: "ACTIVE",
    ownerDecisionDigest,
    independentCheckDigest,
  });
}

export function rebaseProjectGeneralLibrary({projectGeneralLibrary, replacementBaseGeneralLibrary, replacementBaseRoleLibrary} = {}) {
  validateProjectGeneralLibrary(projectGeneralLibrary);
  validateBaseGeneralLibrary(replacementBaseGeneralLibrary);
  validateBaseRoleLibrary(replacementBaseRoleLibrary, {baseGeneralLibrary: replacementBaseGeneralLibrary});
  const replacementBaseBindings = [
    ...replacementBaseGeneralLibrary.general_graph_bindings,
    ...replacementBaseRoleLibrary.role_graph_bindings,
  ];
  const collisions = graphNamespaceCollisions(projectGeneralLibrary.project_graph_bindings, replacementBaseBindings);
  if (collisions.graphIds.length > 0) failConflict({
    conflict_code: "PROJECT_GRAPH_ID_COLLISION_AFTER_UPGRADE",
    affected_library: PROJECT_GENERAL_KIND,
    project_id: projectGeneralLibrary.project_id,
    left_digest: projectGeneralLibrary.digest,
    right_digest: replacementBaseGeneralLibrary.digest,
    resolution: `PRESERVE_PROJECT_SOURCE_AND_RENAME_OR_REVIEW:${collisions.graphIds[0]}`,
  });
  if (collisions.paths.length > 0) failConflict({
    conflict_code: "PROJECT_GRAPH_PATH_COLLISION_AFTER_UPGRADE",
    affected_library: PROJECT_GENERAL_KIND,
    project_id: projectGeneralLibrary.project_id,
    left_digest: projectGeneralLibrary.digest,
    right_digest: replacementBaseGeneralLibrary.digest,
    resolution: `PRESERVE_PROJECT_SOURCE_AND_RENAME_OR_REVIEW_PATH:${collisions.paths[0]}`,
  });
  const rebased = structuredClone(projectGeneralLibrary);
  rebased.status = "COMPILED";
  rebased.lineage = makeLineage(projectGeneralLibrary);
  rebased.base_general_library_digest = replacementBaseGeneralLibrary.digest;
  rebased.base_role_library_digest = replacementBaseRoleLibrary.digest;
  rebased.digest = digestWithout(rebased, "digest");
  return validateProjectGeneralLibrary(rebased, {baseGeneralLibrary: replacementBaseGeneralLibrary, baseRoleLibrary: replacementBaseRoleLibrary});
}

export function validateGovernanceMigration(value, label = "governance migration") {
  exactKeys(value, [
    "schema", "version", "status", "project_id", "mode", "from_binding_digest", "replacement_base_general_digest",
    "replacement_base_role_digest", "preservation", "candidate_binding_digest", "conflicts", "rollback", "digest",
  ], label);
  assert(value.schema === GOVERNANCE_MIGRATION_SCHEMA && value.version === FOUR_LIBRARY_VERSION, `${label} identity is invalid`);
  assert(value.status === "READY" || value.status === "BLOCKED", `${label}.status is invalid`);
  requireIdentifier(value.project_id, `${label}.project_id`);
  assert(GOVERNANCE_UPDATE_MODES.includes(value.mode), `${label}.mode is invalid`);
  requireDigest(value.from_binding_digest, `${label}.from_binding_digest`);
  requireDigest(value.replacement_base_general_digest, `${label}.replacement_base_general_digest`);
  requireDigest(value.replacement_base_role_digest, `${label}.replacement_base_role_digest`);
  exactKeys(value.preservation, ["project_general_library_digest", "project_history_digest", "source_remains_unmodified"], `${label}.preservation`);
  requireDigest(value.preservation.project_general_library_digest, `${label}.preservation.project_general_library_digest`);
  if (value.preservation.project_history_digest !== null) requireDigest(value.preservation.project_history_digest, `${label}.preservation.project_history_digest`);
  assert(value.preservation.source_remains_unmodified === true, `${label}.preservation.source_remains_unmodified must be true`);
  if (value.candidate_binding_digest !== null) requireDigest(value.candidate_binding_digest, `${label}.candidate_binding_digest`);
  validateMigrationConflicts(value.conflicts, `${label}.conflicts`);
  exactKeys(value.rollback, ["previous_binding_digest", "old_binding_remains_active_until_checked"], `${label}.rollback`);
  requireDigest(value.rollback.previous_binding_digest, `${label}.rollback.previous_binding_digest`);
  assert(value.rollback.old_binding_remains_active_until_checked === true, `${label}.rollback policy is invalid`);
  validatePacketDigest(value, label);
  assertPortable(value, label);
  return value;
}

export function prepareGovernanceUpgrade({
  currentBinding,
  currentBaseGeneralLibrary,
  currentBaseRoleLibrary,
  currentProjectGeneralLibrary,
  currentGeneratedProjectRoleLibrary,
  replacementBaseGeneralLibrary,
  replacementBaseRoleLibrary,
  policy_epoch,
  mode = "KEEP_PROJECT_GOVERNANCE",
  projectHistoryDigest = null,
} = {}) {
  validateGovernanceBinding(currentBinding);
  validateBaseGeneralLibrary(currentBaseGeneralLibrary);
  validateBaseRoleLibrary(currentBaseRoleLibrary, {baseGeneralLibrary: currentBaseGeneralLibrary});
  validateProjectGeneralLibrary(currentProjectGeneralLibrary, {baseGeneralLibrary: currentBaseGeneralLibrary, baseRoleLibrary: currentBaseRoleLibrary});
  validateGeneratedProjectRoleLibrary(currentGeneratedProjectRoleLibrary, {
    baseGeneralLibrary: currentBaseGeneralLibrary,
    baseRoleLibrary: currentBaseRoleLibrary,
    projectGeneralLibrary: currentProjectGeneralLibrary,
  });
  validateBaseGeneralLibrary(replacementBaseGeneralLibrary);
  validateBaseRoleLibrary(replacementBaseRoleLibrary, {baseGeneralLibrary: replacementBaseGeneralLibrary});
  assert(currentBinding.project_id === currentProjectGeneralLibrary.project_id, "upgrade project-general does not match current binding");
  assert(currentBinding.project_id === currentGeneratedProjectRoleLibrary.project_id, "upgrade generated library does not match current binding");
  assert(currentBinding.library_digests.base_general === currentBaseGeneralLibrary.digest, "current base-general digest is not bound");
  assert(currentBinding.library_digests.base_role === currentBaseRoleLibrary.digest, "current base-role digest is not bound");
  assert(currentBinding.library_digests.project_general === currentProjectGeneralLibrary.digest, "current project-general digest is not bound");
  assert(currentBinding.library_digests.generated_project_role === currentGeneratedProjectRoleLibrary.digest, "current generated-role digest is not bound");
  assert(GOVERNANCE_UPDATE_MODES.includes(mode), "governance upgrade mode is invalid");
  requirePositiveInteger(policy_epoch, "upgrade policy_epoch");
  if (projectHistoryDigest !== null) requireDigest(projectHistoryDigest, "project history digest");

  if (mode === "RESET_GOVERNANCE_CLEAN") {
    const migration = {
      schema: GOVERNANCE_MIGRATION_SCHEMA,
      version: FOUR_LIBRARY_VERSION,
      status: "READY",
      project_id: currentBinding.project_id,
      mode,
      from_binding_digest: currentBinding.digest,
      replacement_base_general_digest: replacementBaseGeneralLibrary.digest,
      replacement_base_role_digest: replacementBaseRoleLibrary.digest,
      preservation: {
        project_general_library_digest: currentProjectGeneralLibrary.digest,
        project_history_digest: projectHistoryDigest,
        source_remains_unmodified: true,
      },
      candidate_binding_digest: null,
      conflicts: [],
      rollback: {
        previous_binding_digest: currentBinding.digest,
        old_binding_remains_active_until_checked: true,
      },
      digest: null,
    };
    migration.digest = digestWithout(migration, "digest");
    return {migration: validateGovernanceMigration(migration), candidate: null, projectGeneral: currentProjectGeneralLibrary, generatedProjectRole: null};
  }

  let projectGeneralLibrary = currentProjectGeneralLibrary;
  if (projectGeneralLibrary.base_general_library_digest !== replacementBaseGeneralLibrary.digest
    || projectGeneralLibrary.base_role_library_digest !== replacementBaseRoleLibrary.digest) {
    projectGeneralLibrary = rebaseProjectGeneralLibrary({
      projectGeneralLibrary,
      replacementBaseGeneralLibrary,
      replacementBaseRoleLibrary,
    });
  }
  const generatedProjectRole = compileGeneratedProjectRoleLibrary({
    baseGeneralLibrary: replacementBaseGeneralLibrary,
    baseRoleLibrary: replacementBaseRoleLibrary,
    projectGeneralLibrary,
    previous: currentGeneratedProjectRoleLibrary,
    previousBaseGeneralLibrary: currentBaseGeneralLibrary,
    previousBaseRoleLibrary: currentBaseRoleLibrary,
    previousProjectGeneralLibrary: currentProjectGeneralLibrary,
  });
  const candidate = compileGovernanceBinding({
    project_id: currentBinding.project_id,
    policy_epoch,
    baseGeneralLibrary: replacementBaseGeneralLibrary,
    baseRoleLibrary: replacementBaseRoleLibrary,
    projectGeneralLibrary,
    generatedProjectRoleLibrary: generatedProjectRole,
    previous: currentBinding,
  });
  const migration = {
    schema: GOVERNANCE_MIGRATION_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "READY",
    project_id: currentBinding.project_id,
    mode,
    from_binding_digest: currentBinding.digest,
    replacement_base_general_digest: replacementBaseGeneralLibrary.digest,
    replacement_base_role_digest: replacementBaseRoleLibrary.digest,
    preservation: {
      project_general_library_digest: currentProjectGeneralLibrary.digest,
      project_history_digest: projectHistoryDigest,
      source_remains_unmodified: true,
    },
    candidate_binding_digest: candidate.digest,
    conflicts: [],
    rollback: {
      previous_binding_digest: currentBinding.digest,
      old_binding_remains_active_until_checked: true,
    },
    digest: null,
  };
  migration.digest = digestWithout(migration, "digest");
  return {migration: validateGovernanceMigration(migration), candidate, projectGeneral: projectGeneralLibrary, generatedProjectRole};
}
