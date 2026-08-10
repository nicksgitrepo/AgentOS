#!/usr/bin/env node

/*
 * Least-context projection for one admitted task. The packet is disposable
 * authority data: it binds opaque task/scope digests, one generated role
 * packet, one gate context, and only the selected questions applicable to
 * that task. It cannot add authority to the four-library result.
 */

import {
  TASK_GATE_CATALOG_SHA256,
  TASK_GATE_CONTEXTS,
  taskGateQuestionsFor,
} from "./task-gate-questions.mjs";
import {
  FOUR_LIBRARY_VERSION,
  assert,
  assertPortable,
  canonicalDigest,
  compareUtf8,
  digestWithout,
  exactKeys,
  requireDigest,
  requireIdentifier,
  requireLaneIdentifier,
  requireSafeToken,
  sortedUniqueStrings,
  validateBaseGeneralLibrary,
  validateBaseRoleLibrary,
  validateGeneratedProjectRoleLibrary,
  validatePacketDigest,
  validateProjectGeneralLibrary,
} from "./four-library-foundation.mjs";

export const GENERATED_TASK_ROLE_PACKET_SCHEMA = "agentos.generated_task_role_packet.v1";
export const GENERATED_TASK_ROLE_PACKET_VERSION = FOUR_LIBRARY_VERSION;
export const TASK_PACKET_STATUS = "COMPILED";
export const TASK_PACKET_AUTHORITY_EXPANSION = "REJECT";

const TASK_KIND = /^[A-Z][A-Z0-9._:-]*$/u;

function taskSelectionDigest({task_kind, role_id, lane_id, task_gate_context, selected_question_ids}) {
  return canonicalDigest({task_kind, role_id, lane_id, task_gate_context, selected_question_ids});
}

function selectedQuestion(question) {
  return {
    question_id: question.question_id,
    stage: question.stage,
    question: question.question,
    pass_answer: question.pass_answer,
    applies_to: [...question.applies_to],
    required_evidence: [...question.required_evidence],
    no_route: question.no_route,
    unknown_route: question.unknown_route,
  };
}

function questionIdsForContext(context) {
  return taskGateQuestionsFor(context)
    .map((question) => question.question_id)
    .sort(compareUtf8);
}

function validateTaskQuestions(questions, context, label) {
  assert(Array.isArray(questions) && questions.length > 0, label + " must not be empty");
  const applicable = new Map(taskGateQuestionsFor(context).map((question) => [question.question_id, question]));
  const ids = questions.map((question) => question.question_id);
  sortedUniqueStrings(ids, label + " question IDs");
  questions.forEach((question, index) => {
    const expected = applicable.get(question.question_id);
    assert(expected !== undefined, label + "[" + index + "] is not applicable to " + context);
    assert(JSON.stringify(question) === JSON.stringify(selectedQuestion(expected)), label + "[" + index + "] differs from the canonical gate question");
  });
  return questions;
}

function generatedRolePacket(roleLibrary, roleId, laneId) {
  const matches = roleLibrary.role_packets.filter((packet) => packet.role_id === roleId && packet.lane_id === laneId);
  assert(matches.length === 1, "generated role packet is not uniquely bound to " + roleId);
  return matches[0];
}

export function validateGeneratedTaskRolePacket(value, {
  baseGeneralLibrary = null,
  baseRoleLibrary = null,
  projectGeneralLibrary = null,
  generatedProjectRoleLibrary = null,
} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "project_id", "task_id_sha256", "task_scope_sha256",
    "task_kind", "role_id", "lane_id", "project_contract_sha256", "library_digests",
    "role_packet_digest", "task_gate_context", "task_gate_catalog_sha256",
    "selected_question_ids", "questions", "effective_graph_scope", "authority",
    "generation", "authority_expansion", "digest",
  ], "generated task-role packet");
  assert(value.schema === GENERATED_TASK_ROLE_PACKET_SCHEMA && value.version === GENERATED_TASK_ROLE_PACKET_VERSION, "generated task-role packet identity is invalid");
  assert(value.status === TASK_PACKET_STATUS, "generated task-role packet status is invalid");
  requireIdentifier(value.project_id, "generated task-role packet.project_id");
  requireDigest(value.task_id_sha256, "generated task-role packet.task_id_sha256");
  requireDigest(value.task_scope_sha256, "generated task-role packet.task_scope_sha256");
  assert(TASK_KIND.test(value.task_kind), "generated task-role packet.task_kind is invalid");
  requireIdentifier(value.role_id, "generated task-role packet.role_id");
  if (value.lane_id !== null) requireLaneIdentifier(value.lane_id, "generated task-role packet.lane_id");
  requireDigest(value.project_contract_sha256, "generated task-role packet.project_contract_sha256");
  exactKeys(value.library_digests, ["base_general", "base_role", "project_general", "generated_project_role"], "generated task-role packet.library_digests");
  Object.entries(value.library_digests).forEach(([key, digest]) => requireDigest(digest, "generated task-role packet.library_digests." + key));
  requireDigest(value.role_packet_digest, "generated task-role packet.role_packet_digest");
  assert(TASK_GATE_CONTEXTS.includes(value.task_gate_context), "generated task-role packet.task_gate_context is invalid");
  requireDigest(value.task_gate_catalog_sha256, "generated task-role packet.task_gate_catalog_sha256");
  assert(value.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "generated task-role packet task-gate catalog is stale");
  sortedUniqueStrings(value.selected_question_ids, "generated task-role packet.selected_question_ids");
  assert(JSON.stringify(value.selected_question_ids) === JSON.stringify(value.questions.map((question) => question.question_id)), "generated task-role packet question selection is not bound");
  validateTaskQuestions(value.questions, value.task_gate_context, "generated task-role packet.questions");
  exactKeys(value.effective_graph_scope, ["graph_ids", "graph_digests"], "generated task-role packet.effective_graph_scope");
  sortedUniqueStrings(value.effective_graph_scope.graph_ids, "generated task-role packet graph IDs");
  assert(Array.isArray(value.effective_graph_scope.graph_digests), "generated task-role packet graph digests are invalid");
  const graphIds = value.effective_graph_scope.graph_digests.map((item) => item.graph_id);
  sortedUniqueStrings(graphIds, "generated task-role packet graph digest IDs");
  assert(JSON.stringify(graphIds) === JSON.stringify(value.effective_graph_scope.graph_ids), "generated task-role packet graph digest coverage is incomplete");
  value.effective_graph_scope.graph_digests.forEach((item, index) => {
    exactKeys(item, ["graph_id", "graph_sha256", "source"], "generated task-role packet graph digest " + index);
    requireIdentifier(item.graph_id, "generated task-role packet graph digest " + index + ".graph_id");
    requireDigest(item.graph_sha256, "generated task-role packet graph digest " + index + ".graph_sha256");
    requireSafeToken(item.source, "generated task-role packet graph digest " + index + ".source");
  });
  exactKeys(value.authority, ["allowed_authority", "prohibited_authority", "required_evidence"], "generated task-role packet.authority");
  sortedUniqueStrings(value.authority.allowed_authority, "generated task-role packet allowed authority", {allowEmpty: true});
  sortedUniqueStrings(value.authority.prohibited_authority, "generated task-role packet prohibited authority", {allowEmpty: true});
  sortedUniqueStrings(value.authority.required_evidence, "generated task-role packet required evidence", {allowEmpty: true});
  exactKeys(value.generation, ["compiler", "compiler_version", "input_digests"], "generated task-role packet.generation");
  requireSafeToken(value.generation.compiler, "generated task-role packet compiler");
  requireSafeToken(value.generation.compiler_version, "generated task-role packet compiler version");
  sortedUniqueStrings(value.generation.input_digests, "generated task-role packet input digests");
  value.generation.input_digests.forEach((digest) => requireDigest(digest, "generated task-role packet input digest"));
  const expectedInputDigests = [
    ...Object.values(value.library_digests),
    value.project_contract_sha256,
    value.task_id_sha256,
    value.task_scope_sha256,
    value.task_gate_catalog_sha256,
    value.role_packet_digest,
    taskSelectionDigest({
      task_kind: value.task_kind,
      role_id: value.role_id,
      lane_id: value.lane_id,
      task_gate_context: value.task_gate_context,
      selected_question_ids: value.selected_question_ids,
    }),
  ].sort(compareUtf8);
  assert(JSON.stringify(value.generation.input_digests) === JSON.stringify(expectedInputDigests), "generated task-role packet generation inputs are incomplete or stale");
  assert(value.authority_expansion === TASK_PACKET_AUTHORITY_EXPANSION, "generated task-role packet authority expansion policy is invalid");
  if (generatedProjectRoleLibrary !== null) {
    validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
    assert(value.project_id === generatedProjectRoleLibrary.project_id, "generated task-role packet project differs");
    assert(value.library_digests.generated_project_role === generatedProjectRoleLibrary.digest, "generated task-role packet generated-library binding differs");
    const rolePacket = generatedRolePacket(generatedProjectRoleLibrary, value.role_id, value.lane_id);
    assert(value.role_packet_digest === rolePacket.digest, "generated task-role packet role binding differs");
    assert(JSON.stringify(value.effective_graph_scope.graph_ids) === JSON.stringify(rolePacket.graph_ids), "generated task-role packet expands graph scope");
    assert(JSON.stringify(value.authority.allowed_authority) === JSON.stringify(rolePacket.allowed_authority), "generated task-role packet expands allowed authority");
    assert(rolePacket.prohibited_authority.every((item) => value.authority.prohibited_authority.includes(item)), "generated task-role packet removes a role prohibition");
    assert(rolePacket.required_evidence.every((item) => value.authority.required_evidence.includes(item)), "generated task-role packet removes role evidence");
  }
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.library_digests.base_general === baseGeneralLibrary.digest, "generated task-role packet base-general binding differs");
  }
  if (baseRoleLibrary !== null) {
    validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
    assert(value.library_digests.base_role === baseRoleLibrary.digest, "generated task-role packet base-role binding differs");
  }
  if (projectGeneralLibrary !== null) {
    validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
    assert(value.library_digests.project_general === projectGeneralLibrary.digest, "generated task-role packet project-general binding differs");
  }
  validatePacketDigest(value, "generated task-role packet");
  assertPortable(value, "generated task-role packet");
  return value;
}

export function compileGeneratedTaskRolePacket({
  project_id,
  task_id_sha256,
  task_scope_sha256,
  task_kind,
  role_id,
  lane_id = null,
  project_contract_sha256,
  task_gate_context,
  selected_question_ids = null,
  baseGeneralLibrary,
  baseRoleLibrary,
  projectGeneralLibrary,
  generatedProjectRoleLibrary,
} = {}) {
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  validateProjectGeneralLibrary(projectGeneralLibrary, {baseGeneralLibrary, baseRoleLibrary});
  validateGeneratedProjectRoleLibrary(generatedProjectRoleLibrary, {baseGeneralLibrary, baseRoleLibrary, projectGeneralLibrary});
  requireIdentifier(project_id, "generated task-role packet.project_id");
  requireDigest(task_id_sha256, "generated task-role packet.task_id_sha256");
  requireDigest(task_scope_sha256, "generated task-role packet.task_scope_sha256");
  requireDigest(project_contract_sha256, "generated task-role packet.project_contract_sha256");
  assert(TASK_KIND.test(task_kind), "generated task-role packet.task_kind is invalid");
  assert(TASK_GATE_CONTEXTS.includes(task_gate_context), "generated task-role packet.task_gate_context is invalid");
  const rolePacket = generatedRolePacket(generatedProjectRoleLibrary, role_id, lane_id);
  const selectedIds = selected_question_ids === null
    ? questionIdsForContext(task_gate_context)
    : [...selected_question_ids].sort(compareUtf8);
  sortedUniqueStrings(selectedIds, "generated task-role packet.selected_question_ids");
  const questionsById = new Map(taskGateQuestionsFor(task_gate_context).map((question) => [question.question_id, question]));
  selectedIds.forEach((questionId) => assert(questionsById.has(questionId), "task question is not applicable to " + task_gate_context + ": " + questionId));
  const questions = selectedIds.map((questionId) => selectedQuestion(questionsById.get(questionId)));
  const libraryDigests = {
    base_general: baseGeneralLibrary.digest,
    base_role: baseRoleLibrary.digest,
    project_general: projectGeneralLibrary.digest,
    generated_project_role: generatedProjectRoleLibrary.digest,
  };
  const packet = {
    schema: GENERATED_TASK_ROLE_PACKET_SCHEMA,
    version: GENERATED_TASK_ROLE_PACKET_VERSION,
    status: TASK_PACKET_STATUS,
    project_id,
    task_id_sha256,
    task_scope_sha256,
    task_kind,
    role_id: rolePacket.role_id,
    lane_id: rolePacket.lane_id,
    project_contract_sha256,
    library_digests: libraryDigests,
    role_packet_digest: rolePacket.digest,
    task_gate_context,
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    selected_question_ids: selectedIds,
    questions,
    effective_graph_scope: {
      graph_ids: [...rolePacket.graph_ids],
      graph_digests: rolePacket.effective_graph_digests.map((item) => ({...item})),
    },
    authority: {
      allowed_authority: [...rolePacket.allowed_authority],
      prohibited_authority: [...rolePacket.prohibited_authority],
      required_evidence: [...rolePacket.required_evidence],
    },
    generation: {
      compiler: "TASK_ROLE_PACKET",
      compiler_version: "1",
      input_digests: [
        ...Object.values(libraryDigests),
        project_contract_sha256,
        task_id_sha256,
        task_scope_sha256,
        TASK_GATE_CATALOG_SHA256,
        rolePacket.digest,
        taskSelectionDigest({task_kind, role_id: rolePacket.role_id, lane_id: rolePacket.lane_id, task_gate_context, selected_question_ids: selectedIds}),
      ].sort(compareUtf8),
    },
    authority_expansion: TASK_PACKET_AUTHORITY_EXPANSION,
    digest: null,
  };
  packet.digest = digestWithout(packet, "digest");
  return validateGeneratedTaskRolePacket(packet, {
    baseGeneralLibrary,
    baseRoleLibrary,
    projectGeneralLibrary,
    generatedProjectRoleLibrary,
  });
}

