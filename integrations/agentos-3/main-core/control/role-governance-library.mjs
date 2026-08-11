#!/usr/bin/env node

import {
  ARCHITECTURE_ACCEPTANCE_REQUIREMENTS,
  canonicalJson,
  sha256,
  validateGeneralGovernanceLibrary,
} from "./governance-library.mjs";
import {ROOTS, validateQuestionTree} from "./question-tree.mjs";
import {
  CANONICAL_ROLE_DEFINITION_SOURCE,
  ROLE_KINDS,
  ROLE_SCOPES,
  roleDefinitionSourceDigest,
  validateRoleDefinitionSource,
} from "./governance-role-definitions.mjs";
import {TASK_GATE_CATALOG_SHA256, TASK_GATE_QUESTIONS} from "./task-gate-questions.mjs";
import {findPrivateContextLeaks} from "./private-context-detector.mjs";

export const ROLE_GOVERNANCE_SCHEMA = "agentos.role_specific_governance_library.v1";
export const ARCHITECTURE_SCHEMA = "agentos.governance_architecture.v1";
export const ROLE_GOVERNANCE_KIND = "GENERATED_ROLE_SPECIFIC_GOVERNANCE";
export const ARCHITECTURE_KIND = "SHARED_PLUS_GENERATED_GOVERNANCE";
export const EXPLICIT_ROLE_GENERATION_SOURCE = "GENERAL_LIBRARY_PLUS_COMPILED_QUESTION_TREE";
export const CANONICAL_ROLE_GENERATION_SOURCE = "GENERAL_LIBRARY_PLUS_ROLE_DEFINITION_SOURCE_PLUS_COMPILED_QUESTION_TREE";
const UNIVERSAL_TASK_GATE_QUESTION_IDS = Object.freeze(TASK_GATE_QUESTIONS.map((question) => question.question_id).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const FORBIDDEN_ROLE_NAME = /(?:feature\s*agent|generic|shell|recursive|provider|project)/iu;
const FORBIDDEN_ROLE_CONTENT = /(?:feature\s*agent|generic|shell|recursive|provider|credential|password|secret|api[_-]?key|account[_-]?identity|deployment[_-]?identity)/iu;
const ROLE_METADATA_KEYS = ["role_scope", "role_kind", "lane_id"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function exactKeys(value, keys, label, {allow = []} = {}) {
  requireRecord(value, label);
  const allowed = new Set([...keys, ...allow]);
  const actual = Object.keys(value);
  const expected = [...keys];
  assert(actual.every((key) => allowed.has(key)), `${label} contains an unknown field`);
  assert(expected.every((key) => Object.hasOwn(value, key)), `${label} is missing a required field`);
}

function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  const sorted = [...value].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  assert(new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return value;
}

function sortedCopy(value) {
  return [...value].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function validateQuestionRoots(value, label) {
  sortedUniqueStrings(value, label);
  value.forEach((root) => assert(ROOTS.includes(root), `${label} contains an unknown root`));
}

function uniqueStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return sha256(body);
}

function assertPortable(value, label) {
  const text = JSON.stringify(value);
  assert(findPrivateContextLeaks(text).length === 0 && !FORBIDDEN_ROLE_CONTENT.test(text), `${label} contains private, secret, provider-bound, or generic role content`);
}

function defaultRoleScope(role) {
  return role.role_scope ?? "CAMPAIGN";
}

function defaultRoleKind(role) {
  return role.role_kind ?? "NAMED_ROLE";
}

function normalizeRoleDefinition(role, index, generalClauseIds, questionIds) {
  exactKeys(role, ["role_id", "public_name", "question_ids", "shared_clause_ids"], `role definition ${index}`, {allow: ROLE_METADATA_KEYS});
  requireIdentifier(role.role_id, `role definition ${index} ID`);
  requireString(role.public_name, `role definition ${role.role_id} name`);
  assert(!FORBIDDEN_ROLE_NAME.test(role.public_name) && !FORBIDDEN_ROLE_NAME.test(role.role_id), `role ${role.role_id} is not an admitted named role`);
  sortedUniqueStrings(role.question_ids, `${role.role_id} question IDs`, {allowEmpty: true});
  sortedUniqueStrings(role.shared_clause_ids, `${role.role_id} shared clauses`);
  if (questionIds.size > 0) role.question_ids.forEach((id) => assert(questionIds.has(id), `${role.role_id} selects a question outside the governance tree: ${id}`));
  if (generalClauseIds.size > 0) role.shared_clause_ids.forEach((id) => assert(generalClauseIds.has(id), `${role.role_id} selects a missing general clause: ${id}`));
  const roleScope = defaultRoleScope(role);
  const roleKind = defaultRoleKind(role);
  const laneId = role.lane_id ?? null;
  assert(ROLE_SCOPES.includes(roleScope), `${role.role_id} role scope is invalid`);
  assert(ROLE_KINDS.includes(roleKind), `${role.role_id} role kind is invalid`);
  if (laneId !== null) requireIdentifier(laneId, `${role.role_id} lane ID`);
  if (roleKind === "ONE_LANE_WORKER") {
    assert(roleScope === "CAMPAIGN" && laneId !== null, `${role.role_id} one-lane worker binding is invalid`);
    assert(role.role_id === `WORKER_${laneId}`, `${role.role_id} one-lane worker ID is not bound to its lane`);
  } else {
    assert(laneId === null, `${role.role_id} non-worker role carries a lane ID`);
  }
  assertPortable(role, `${role.role_id} role definition`);
  return {
    role_id: role.role_id,
    public_name: role.public_name,
    role_scope: roleScope,
    role_kind: roleKind,
    lane_id: laneId,
    question_ids: [...role.question_ids],
    shared_clause_ids: [...role.shared_clause_ids],
  };
}

function validateGeneratedRule(rule, roleId, question = null) {
  exactKeys(rule, ["rule_id", "question_id", "root", "required_evidence", "allowed_answers", "branches", "blocking_scope", "generation"], `${roleId} generated rule`);
  requireIdentifier(rule.rule_id, `${roleId} generated rule ID`);
  requireIdentifier(rule.question_id, `${roleId} generated question ID`);
  requireString(rule.root, `${roleId} generated rule root`);
  sortedUniqueStrings(rule.required_evidence, `${roleId} generated rule evidence`);
  uniqueStrings(rule.allowed_answers, `${roleId} generated rule answers`);
  requireRecord(rule.branches, `${roleId} generated rule branches`);
  requireString(rule.blocking_scope, `${roleId} generated rule scope`);
  assert(rule.generation === "QUESTION_TREE_RULE_PROJECTED_THROUGH_SHARED_GOVERNANCE", `${roleId} generated rule provenance is invalid`);
  if (question === null) return;
  assert(rule.rule_id === `${roleId}:${question.question_id}`, `${roleId} generated rule ID is invalid`);
  assert(rule.question_id === question.question_id && rule.root === question.root, `${roleId} generated rule question binding is invalid`);
  assert(canonicalJson(rule.required_evidence) === canonicalJson(question.required_evidence), `${roleId} generated rule evidence differs from tree`);
  assert(canonicalJson(rule.allowed_answers) === canonicalJson(question.allowed_answers), `${roleId} generated rule answers differ from tree`);
  assert(canonicalJson(rule.branches) === canonicalJson(question.branches), `${roleId} generated rule branches differ from tree`);
  assert(rule.blocking_scope === question.blocking_scope, `${roleId} generated rule scope differs from tree`);
}

function validateRoleRecord(record, {treeById, hasTree, generalClauseIds}) {
  exactKeys(record, ["role_id", "public_name", "role_scope", "role_kind", "lane_id", "shared_clause_ids", "question_ids", "universal_task_gate_question_ids", "generated_rules"], `generated role ${record.role_id ?? "unknown"}`);
  requireIdentifier(record.role_id, "generated role ID");
  requireString(record.public_name, `generated role ${record.role_id} name`);
  assert(!FORBIDDEN_ROLE_NAME.test(record.public_name) && !FORBIDDEN_ROLE_NAME.test(record.role_id), `generated role ${record.role_id} is not admitted`);
  assert(ROLE_SCOPES.includes(record.role_scope), `${record.role_id} role scope is invalid`);
  assert(ROLE_KINDS.includes(record.role_kind), `${record.role_id} role kind is invalid`);
  if (record.lane_id === null) {
    assert(record.role_kind !== "ONE_LANE_WORKER", `${record.role_id} worker lane is missing`);
  } else {
    requireIdentifier(record.lane_id, `${record.role_id} lane ID`);
    assert(record.role_kind === "ONE_LANE_WORKER" && record.role_scope === "CAMPAIGN", `${record.role_id} lane scope is invalid`);
    assert(record.role_id === `WORKER_${record.lane_id}`, `${record.role_id} lane binding is invalid`);
  }
  sortedUniqueStrings(record.shared_clause_ids, `${record.role_id} shared clauses`);
  assert(record.shared_clause_ids.includes("GENERAL_DELIVERY_CLOSURE"), `${record.role_id} is missing the universal delivery-closure clause`);
  assert(record.shared_clause_ids.includes("GENERAL_RESPONSE_HANDOFF_GATING"), `${record.role_id} is missing the universal response-handoff gate clause`);
  sortedUniqueStrings(record.question_ids, `${record.role_id} question IDs`, {allowEmpty: true});
  sortedUniqueStrings(record.universal_task_gate_question_ids, `${record.role_id} universal task-gate questions`);
  assert(JSON.stringify(record.universal_task_gate_question_ids) === JSON.stringify(UNIVERSAL_TASK_GATE_QUESTION_IDS), `${record.role_id} universal task-gate question inventory is incomplete or reordered`);
  if (generalClauseIds.size > 0) record.shared_clause_ids.forEach((id) => assert(generalClauseIds.has(id), `${record.role_id} has an unknown shared clause`));
  assert(Array.isArray(record.generated_rules) && record.generated_rules.length === record.question_ids.length, `${record.role_id} generated rules are incomplete`);
  assert(JSON.stringify(record.generated_rules.map((rule) => rule.question_id)) === JSON.stringify(record.question_ids), `${record.role_id} generated rules are not sorted by question ID`);
  record.generated_rules.forEach((rule) => {
    const question = treeById.get(rule.question_id);
    if (hasTree) assert(question, `${record.role_id} generated rule is outside the governance tree`);
    validateGeneratedRule(rule, record.role_id, question ?? null);
  });
  assertPortable(record, `${record.role_id} generated role`);
}

function validateFullRoleCatalog(roles) {
  const byId = new Map(roles.map((role) => [role.role_id, role]));
  const required = [
    ["INTENT_REGULATOR", "PERSISTENT", "INTENT_REGULATOR"],
    ["RUNTIME", "PERSISTENT", "RUNTIME"],
    ["CAMPAIGN_ORCHESTRATOR", "CAMPAIGN", "CAMPAIGN_ORCHESTRATOR"],
    ["INDEPENDENT_AUDITOR", "CAMPAIGN", "INDEPENDENT_AUDITOR"],
  ];
  required.forEach(([roleId, scope, kind]) => {
    const role = byId.get(roleId);
    assert(role, `full role catalog is missing ${roleId}`);
    assert(role.role_scope === scope && role.role_kind === kind, `${roleId} full catalog binding is invalid`);
    assert(role.lane_id === null, `${roleId} full catalog role carries a worker lane`);
  });
  roles.forEach((role) => assert(role.role_id !== "FEATURE_AGENT" && !/^FEATURE_AGENT[:_]/u.test(role.role_id), `generic Feature Agent role is not admitted: ${role.role_id}`));
}

export function validateRoleSpecificGovernanceLibrary(library, {generalLibrary = null, governanceTree = null, roleDefinitionSource = null} = {}) {
  exactKeys(library, [
    "schema", "version", "library_kind", "source_commit", "source_tree", "bootstrap_plan_sha256", "campaign_id",
    "task_gate_catalog_sha256", "governance_tree_sha256", "general_library_sha256", "role_definition_source_sha256", "generation_source", "roles", "digest",
  ], "role governance library");
  assert(library.schema === ROLE_GOVERNANCE_SCHEMA && library.version === 1, "role governance library identity is invalid");
  assert(library.library_kind === ROLE_GOVERNANCE_KIND, "role governance library kind is invalid");
  requireString(library.source_commit, "role governance source commit");
  requireString(library.source_tree, "role governance source tree");
  requireSha(library.bootstrap_plan_sha256, "role governance Bootstrap plan digest");
  requireString(library.campaign_id, "role governance campaign ID");
  requireSha(library.task_gate_catalog_sha256, "role governance task-gate catalog digest");
  assert(library.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "role governance task-gate catalog binding differs");
  requireSha(library.governance_tree_sha256, "role governance tree digest");
  requireSha(library.general_library_sha256, "role governance general library digest");
  requireSha(library.role_definition_source_sha256, "role governance role-definition source digest");
  assert([EXPLICIT_ROLE_GENERATION_SOURCE, CANONICAL_ROLE_GENERATION_SOURCE].includes(library.generation_source), "role governance generation source is invalid");
  assert(Array.isArray(library.roles) && library.roles.length > 0, "role governance roles are required");
  assert(JSON.stringify(library.roles.map((role) => role.role_id)) === JSON.stringify([...library.roles].map((role) => role.role_id).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))), "role governance roles must be sorted by ID");
  const roleIds = new Set();
  const treeById = new Map();
  const hasTree = governanceTree !== null;
  if (hasTree) {
    validateQuestionTree(governanceTree);
    assert(sha256(governanceTree) === library.governance_tree_sha256, "role governance tree digest differs from supplied tree");
    assert(library.campaign_id === governanceTree.campaign_id, "role governance campaign differs from supplied tree");
    governanceTree.questions.forEach((question) => treeById.set(question.question_id, question));
  }
  const generalClauseIds = new Set();
  if (generalLibrary !== null) {
    validateGeneralGovernanceLibrary(generalLibrary);
    assert(library.general_library_sha256 === generalLibrary.digest, "role governance general library binding differs");
    assert(library.task_gate_catalog_sha256 === generalLibrary.task_gate_catalog_sha256, "role governance task-gate catalog differs from general library");
    assert(library.source_commit === generalLibrary.source_commit && library.source_tree === generalLibrary.source_tree, "role governance source differs from general library");
    assert(library.bootstrap_plan_sha256 === generalLibrary.bootstrap_plan_sha256, "role governance Bootstrap plan differs from general library");
    generalLibrary.clauses.forEach((clause) => generalClauseIds.add(clause.clause_id));
  }
  const sourceToValidate = roleDefinitionSource ?? (library.generation_source === CANONICAL_ROLE_GENERATION_SOURCE ? CANONICAL_ROLE_DEFINITION_SOURCE : null);
  if (sourceToValidate !== null) {
    validateRoleDefinitionSource(sourceToValidate);
    assert(library.role_definition_source_sha256 === roleDefinitionSourceDigest(sourceToValidate), "role governance role-definition source binding differs");
  }
  library.roles.forEach((role) => {
    assert(!roleIds.has(role.role_id), `duplicate generated role ${role.role_id}`);
    roleIds.add(role.role_id);
    validateRoleRecord(role, {treeById, hasTree, generalClauseIds});
  });
  if (library.generation_source === CANONICAL_ROLE_GENERATION_SOURCE) validateFullRoleCatalog(library.roles);
  assertPortable(library, "role governance library");
  requireSha(library.digest, "role governance library digest");
  assert(library.digest === digestWithout(library, "digest"), "role governance library digest mismatch");
  return library;
}

function compileGeneratedRule(roleId, question) {
  return {
    rule_id: `${roleId}:${question.question_id}`,
    question_id: question.question_id,
    root: question.root,
    required_evidence: [...question.required_evidence],
    allowed_answers: [...question.allowed_answers],
    branches: structuredClone(question.branches),
    blocking_scope: question.blocking_scope,
    generation: "QUESTION_TREE_RULE_PROJECTED_THROUGH_SHARED_GOVERNANCE",
  };
}

function selectQuestionIds({questionSelector, questionRoots, explicitQuestionIds}, questions, label) {
  const known = new Map(questions.map((question) => [question.question_id, question]));
  let selected;
  if (explicitQuestionIds !== undefined && explicitQuestionIds !== null) {
    assert(Array.isArray(explicitQuestionIds), `${label} question IDs must be an array`);
    const explicit = sortedCopy(explicitQuestionIds);
    assert(new Set(explicit).size === explicit.length, `${label} question IDs contain duplicates`);
    explicit.forEach((questionId) => assert(known.has(questionId), `${label} selects a question outside the governance tree: ${questionId}`));
    selected = explicit;
  } else if (questionSelector === "ROOTS") {
    const roots = new Set(questionRoots);
    selected = questions.filter((question) => roots.has(question.root)).map((question) => question.question_id);
  } else {
    selected = questions.map((question) => question.question_id);
  }
  return sortedCopy(selected);
}

function firstDefined(record, keys) {
  for (const key of keys) if (Object.hasOwn(record, key) && record[key] !== undefined) return record[key];
  return undefined;
}

function normalizeWorkerLane(lane, index, template, questions) {
  if (typeof lane === "string") lane = {lane_id: lane};
  exactKeys(lane, [], `worker lane ${index}`, {allow: [
    "lane_id", "laneId", "name", "id", "role_id", "roleId", "public_name", "publicName",
    "question_ids", "questionIds", "question_roots", "questionRoots", "shared_clause_ids", "sharedClauseIds",
  ]});
  const rawLaneId = firstDefined(lane, ["lane_id", "laneId", "name", "id"]);
  requireString(rawLaneId, `worker lane ${index} ID`);
  assert(findPrivateContextLeaks(rawLaneId).length === 0 && !FORBIDDEN_ROLE_CONTENT.test(rawLaneId) && !FORBIDDEN_ROLE_NAME.test(rawLaneId), `worker lane ${index} is not an admitted named lane`);
  const normalizedLaneId = rawLaneId.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  requireIdentifier(normalizedLaneId, `worker lane ${index} normalized ID`);
  const roleId = firstDefined(lane, ["role_id", "roleId"]) ?? `${template.role_id_prefix}${normalizedLaneId}`;
  requireIdentifier(roleId, `worker lane ${index} role ID`);
  assert(roleId === `${template.role_id_prefix}${normalizedLaneId}`, `worker lane ${index} role ID must be derived from its lane`);
  const publicName = firstDefined(lane, ["public_name", "publicName"]) ?? `${template.public_name_prefix}${normalizedLaneId}`;
  requireString(publicName, `worker lane ${index} public name`);
  assert(!FORBIDDEN_ROLE_NAME.test(publicName), `worker lane ${index} public name is not an admitted named role`);
  const explicitQuestionIds = firstDefined(lane, ["question_ids", "questionIds"]);
  const questionRoots = firstDefined(lane, ["question_roots", "questionRoots"]);
  if (questionRoots !== undefined) validateQuestionRoots(questionRoots, `worker lane ${index} question roots`);
  const questionIds = explicitQuestionIds !== undefined
    ? selectQuestionIds({questionSelector: "EXPLICIT_OR_ALL", questionRoots, explicitQuestionIds}, questions, `worker lane ${index}`)
    : questionRoots !== undefined
      ? sortedCopy(questions.filter((question) => questionRoots.includes(question.root)).map((question) => question.question_id))
      : selectQuestionIds({questionSelector: template.question_selector, questionRoots: template.question_roots}, questions, `worker lane ${index}`);
  const sharedClauseIds = firstDefined(lane, ["shared_clause_ids", "sharedClauseIds"]) ?? template.shared_clause_ids;
  sortedUniqueStrings(sharedClauseIds, `worker lane ${index} shared clauses`);
  return {
    role_id: roleId,
    public_name: publicName,
    role_scope: template.role_scope,
    role_kind: template.role_kind,
    lane_id: normalizedLaneId,
    question_ids: questionIds,
    shared_clause_ids: [...sharedClauseIds],
  };
}

export function defaultRoleDefinitions({governanceTree, workerLanes = [], roleDefinitionSource = CANONICAL_ROLE_DEFINITION_SOURCE} = {}) {
  validateRoleDefinitionSource(roleDefinitionSource);
  validateQuestionTree(governanceTree);
  assert(Array.isArray(workerLanes), "worker lanes must be an array");
  const templates = roleDefinitionSource.role_templates;
  const definitions = templates.map((template) => ({
    role_id: template.role_id,
    public_name: template.public_name,
    role_scope: template.role_scope,
    role_kind: template.role_kind,
    lane_id: null,
    question_ids: selectQuestionIds({questionSelector: template.question_selector, questionRoots: template.question_roots}, governanceTree.questions, template.role_id),
    shared_clause_ids: [...template.shared_clause_ids],
  }));
  const workers = workerLanes.map((lane, index) => normalizeWorkerLane(lane, index, roleDefinitionSource.one_lane_worker_template, governanceTree.questions));
  const all = [...definitions, ...workers].sort((left, right) => Buffer.from(left.role_id).compare(Buffer.from(right.role_id)));
  const roleIds = new Set();
  all.forEach((role, index) => {
    assert(!roleIds.has(role.role_id), `duplicate role ${role.role_id}`);
    roleIds.add(role.role_id);
    assert(!FORBIDDEN_ROLE_NAME.test(role.role_id), `role ${role.role_id} is not an admitted named role`);
    normalizeRoleDefinition(role, index, new Set(), new Set(governanceTree.questions.map((question) => question.question_id)));
  });
  return all;
}

function explicitRoleDefinitionDigest(roles) {
  return sha256({schema: "agentos.role_definition_input.v1", version: 1, roles});
}

export function generateRoleSpecificGovernanceLibrary({
  sourceCommit,
  sourceTree,
  bootstrapPlanSha256,
  governanceTree,
  generalLibrary,
  roles = null,
  roleDefinitionSource = null,
} = {}) {
  if (roles === null) return compileRoleGovernanceCatalog({sourceCommit, sourceTree, bootstrapPlanSha256, governanceTree, generalLibrary, roleDefinitionSource: roleDefinitionSource ?? CANONICAL_ROLE_DEFINITION_SOURCE});
  validateGeneralGovernanceLibrary(generalLibrary);
  validateQuestionTree(governanceTree);
  requireString(sourceCommit, "role governance source commit");
  requireString(sourceTree, "role governance source tree");
  requireSha(bootstrapPlanSha256, "role governance Bootstrap plan digest");
  assert(sourceCommit === generalLibrary.source_commit && sourceTree === generalLibrary.source_tree, "role governance source does not match general library");
  assert(bootstrapPlanSha256 === generalLibrary.bootstrap_plan_sha256, "role governance Bootstrap plan does not match general library");
  assert(Array.isArray(roles) && roles.length > 0, "role governance role definitions are required");
  if (roleDefinitionSource !== null) validateRoleDefinitionSource(roleDefinitionSource);
  const questions = new Map(governanceTree.questions.map((question) => [question.question_id, question]));
  const generalClauseIds = new Set(generalLibrary.clauses.map((clause) => clause.clause_id));
  const definitions = structuredClone(roles).sort((left, right) => Buffer.from(left.role_id ?? "").compare(Buffer.from(right.role_id ?? "")));
  const roleIds = new Set();
  const generatedRoles = definitions.map((role, index) => {
    const normalized = normalizeRoleDefinition(role, index, generalClauseIds, new Set(questions.keys()));
    assert(!roleIds.has(normalized.role_id), `duplicate role ${normalized.role_id}`);
    roleIds.add(normalized.role_id);
    return {
      ...normalized,
      universal_task_gate_question_ids: [...UNIVERSAL_TASK_GATE_QUESTION_IDS],
      generated_rules: normalized.question_ids.map((questionId) => compileGeneratedRule(normalized.role_id, questions.get(questionId))),
    };
  });
  const sourceDigest = roleDefinitionSource === null ? explicitRoleDefinitionDigest(definitions) : roleDefinitionSourceDigest(roleDefinitionSource);
  const library = {
    schema: ROLE_GOVERNANCE_SCHEMA,
    version: 1,
    library_kind: ROLE_GOVERNANCE_KIND,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    bootstrap_plan_sha256: bootstrapPlanSha256,
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    campaign_id: governanceTree.campaign_id,
    governance_tree_sha256: sha256(governanceTree),
    general_library_sha256: generalLibrary.digest,
    role_definition_source_sha256: sourceDigest,
    generation_source: roleDefinitionSource === null ? EXPLICIT_ROLE_GENERATION_SOURCE : CANONICAL_ROLE_GENERATION_SOURCE,
    roles: generatedRoles,
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateRoleSpecificGovernanceLibrary(library, {generalLibrary, governanceTree, roleDefinitionSource});
}

export function compileRoleGovernanceCatalog({
  sourceCommit,
  sourceTree,
  bootstrapPlanSha256,
  governanceTree,
  generalLibrary,
  campaignId = null,
  workerLanes = [],
  roleDefinitions = null,
  roleDefinitionSource = CANONICAL_ROLE_DEFINITION_SOURCE,
} = {}) {
  validateQuestionTree(governanceTree);
  requireString(campaignId ?? governanceTree.campaign_id, "role governance campaign ID");
  assert((campaignId ?? governanceTree.campaign_id) === governanceTree.campaign_id, "role governance campaign does not match question tree");
  validateRoleDefinitionSource(roleDefinitionSource);
  const definitions = roleDefinitions === null
    ? defaultRoleDefinitions({governanceTree, workerLanes, roleDefinitionSource})
    : Array.isArray(roleDefinitions) ? roleDefinitions : roleDefinitions.roles;
  assert(Array.isArray(definitions), "role governance role definitions must be an array");
  const library = generateRoleSpecificGovernanceLibrary({
    sourceCommit,
    sourceTree,
    bootstrapPlanSha256,
    governanceTree,
    generalLibrary,
    roles: definitions,
    roleDefinitionSource,
  });
  assert(library.generation_source === CANONICAL_ROLE_GENERATION_SOURCE, "role governance catalog was not generated from canonical definitions");
  validateFullRoleCatalog(library.roles);
  return library;
}

export function compileGovernanceArchitecture({
  sourceCommit,
  sourceTree,
  bootstrapPlanSha256,
  governanceTree,
  generalLibrary,
  roleSpecificLibrary = null,
  roleDefinitions = null,
  workerLanes = [],
  roleDefinitionSource = null,
  acceptanceRequirements = ARCHITECTURE_ACCEPTANCE_REQUIREMENTS,
} = {}) {
  validateGeneralGovernanceLibrary(generalLibrary);
  validateQuestionTree(governanceTree);
  const generatedRoleLibrary = roleSpecificLibrary ?? compileRoleGovernanceCatalog({
    sourceCommit,
    sourceTree,
    bootstrapPlanSha256,
    governanceTree,
    generalLibrary,
    roleDefinitions,
    workerLanes,
    roleDefinitionSource: roleDefinitionSource ?? CANONICAL_ROLE_DEFINITION_SOURCE,
  });
  validateRoleSpecificGovernanceLibrary(generatedRoleLibrary, {generalLibrary, governanceTree, roleDefinitionSource});
  requireString(sourceCommit, "architecture source commit");
  requireString(sourceTree, "architecture source tree");
  requireSha(bootstrapPlanSha256, "architecture Bootstrap plan digest");
  assert(sourceCommit === generalLibrary.source_commit && sourceTree === generalLibrary.source_tree, "architecture source differs from general library");
  assert(sourceCommit === generatedRoleLibrary.source_commit && sourceTree === generatedRoleLibrary.source_tree, "architecture source differs from role library");
  assert(bootstrapPlanSha256 === generalLibrary.bootstrap_plan_sha256 && bootstrapPlanSha256 === generatedRoleLibrary.bootstrap_plan_sha256, "architecture Bootstrap plan binding differs");
  assert(sha256(governanceTree) === generatedRoleLibrary.governance_tree_sha256, "architecture tree binding differs");
  assert(JSON.stringify(acceptanceRequirements) === JSON.stringify(ARCHITECTURE_ACCEPTANCE_REQUIREMENTS), "architecture acceptance requirements are incomplete or reordered");
  const architecture = {
    schema: ARCHITECTURE_SCHEMA,
    version: 1,
    architecture_kind: ARCHITECTURE_KIND,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    bootstrap_plan_sha256: bootstrapPlanSha256,
    governance_tree_sha256: sha256(governanceTree),
    general_library_sha256: generalLibrary.digest,
    role_specific_library_sha256: generatedRoleLibrary.digest,
    role_definition_source_sha256: generatedRoleLibrary.role_definition_source_sha256,
    acceptance_requirements: [...ARCHITECTURE_ACCEPTANCE_REQUIREMENTS],
    status: "ARCHITECTURE_ACCEPTANCE_READY",
    digest: null,
  };
  architecture.digest = digestWithout(architecture, "digest");
  return validateGovernanceArchitecture(architecture, {generalLibrary, roleSpecificLibrary: generatedRoleLibrary, governanceTree, roleDefinitionSource});
}

export function validateGovernanceArchitecture(architecture, {generalLibrary = null, roleSpecificLibrary = null, governanceTree = null, roleDefinitionSource = null} = {}) {
  exactKeys(architecture, [
    "schema", "version", "architecture_kind", "source_commit", "source_tree", "bootstrap_plan_sha256", "governance_tree_sha256",
    "general_library_sha256", "role_specific_library_sha256", "role_definition_source_sha256", "acceptance_requirements", "status", "digest",
  ], "governance architecture");
  assert(architecture.schema === ARCHITECTURE_SCHEMA && architecture.version === 1, "governance architecture identity is invalid");
  assert(architecture.architecture_kind === ARCHITECTURE_KIND && architecture.status === "ARCHITECTURE_ACCEPTANCE_READY", "governance architecture status is invalid");
  requireString(architecture.source_commit, "architecture source commit");
  requireString(architecture.source_tree, "architecture source tree");
  requireSha(architecture.bootstrap_plan_sha256, "architecture Bootstrap plan digest");
  requireSha(architecture.governance_tree_sha256, "architecture tree digest");
  requireSha(architecture.general_library_sha256, "architecture general library digest");
  requireSha(architecture.role_specific_library_sha256, "architecture role library digest");
  requireSha(architecture.role_definition_source_sha256, "architecture role-definition source digest");
  assert(JSON.stringify(architecture.acceptance_requirements) === JSON.stringify(ARCHITECTURE_ACCEPTANCE_REQUIREMENTS), "architecture acceptance requirements are invalid");
  if (generalLibrary !== null) {
    validateGeneralGovernanceLibrary(generalLibrary);
    assert(architecture.general_library_sha256 === generalLibrary.digest, "architecture general library differs");
  }
  if (roleSpecificLibrary !== null) {
    validateRoleSpecificGovernanceLibrary(roleSpecificLibrary, {generalLibrary, governanceTree, roleDefinitionSource});
    assert(architecture.role_specific_library_sha256 === roleSpecificLibrary.digest, "architecture role library differs");
    assert(architecture.role_definition_source_sha256 === roleSpecificLibrary.role_definition_source_sha256, "architecture role-definition source differs");
  }
  if (governanceTree !== null) assert(architecture.governance_tree_sha256 === sha256(governanceTree), "architecture tree differs");
  requireSha(architecture.digest, "architecture digest");
  assert(architecture.digest === digestWithout(architecture, "digest"), "architecture digest mismatch");
  return architecture;
}
