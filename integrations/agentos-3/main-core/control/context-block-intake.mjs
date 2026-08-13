#!/usr/bin/env node

/*
 * Generic external context-block intake. It validates a source-backed,
 * project-agnostic companion block without importing it into the AgentOS
 * kernel, activating it, or mutating a consumer project.
 */

import crypto from "node:crypto";

export const CONTEXT_BLOCK_SCHEMA = "agentos.context_block_intake.v1";
export const GATE_OUTCOMES = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const BLOCK_ID = /^context\.[a-z0-9-]+\.[a-z0-9-]+$/u;
const SOURCE_ID = /^source\.[a-z0-9-]+$/u;
const STATEMENT_ID = /^statement\.[a-z0-9-]+$/u;
const FIXTURE_ID = /^fixture\.[a-z0-9-]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SOURCE_LOCATOR = /^(?:https:\/\/|PORTABLE_KERNEL$|PROJECT_CONTEXT$|PROJECT_CONTROL_PLANE$)/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key)\s*[:=]/iu;

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
}

function requireId(value, label, pattern = SAFE_ID) {
  requireString(value, label);
  assert(pattern.test(value), `${label} has an unsafe identity`);
}

function requireSha(value, label, nullable = false) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label, nullable = false) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains raw secret-like material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const normalized = [...new Set(values)].sort(compareUtf8);
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be sorted and unique`);
  return normalized;
}

function validateSourceDocuments(value) {
  assert(Array.isArray(value) && value.length > 0, "source_documents must be nonempty");
  const ids = [];
  for (const [index, source] of value.entries()) {
    requireRecord(source, `source_documents[${index}]`);
    requireId(source.source_id, `source_documents[${index}].source_id`, SOURCE_ID);
    requireString(source.title, `source_documents[${index}].title`);
    requireString(source.publisher, `source_documents[${index}].publisher`);
    requireString(source.source_locator, `source_documents[${index}].source_locator`);
    assert(SOURCE_LOCATOR.test(source.source_locator), `source_documents[${index}].source_locator is not a stable locator`);
    requireString(source.version, `source_documents[${index}].version`);
    requireString(source.immutable_identity, `source_documents[${index}].immutable_identity`);
    requireSha(source.content_sha256, `source_documents[${index}].content_sha256`);
    requireUtc(source.extracted_at_utc, `source_documents[${index}].extracted_at_utc`);
    assert(["PRIMARY_NORMATIVE", "PRIMARY_DESCRIPTIVE", "SECONDARY_RESEARCH", "AGENTOS_PORTABLE", "PROJECT_CONTEXT"].includes(source.authority_class), `source_documents[${index}].authority_class is invalid`);
    ids.push(source.source_id);
  }
  sortedUnique(ids, "source document identities");
}

function validateStatements(statements, sourceIds) {
  requireRecord(statements, "statements");
  const seen = new Set();
  for (const category of ["authoritative", "inference", "history"]) {
    assert(Array.isArray(statements[category]), `statements.${category} must be an array`);
    for (const [index, statement] of statements[category].entries()) {
      requireRecord(statement, `statements.${category}[${index}]`);
      requireId(statement.statement_id, `statements.${category}[${index}].statement_id`, STATEMENT_ID);
      assert(!seen.has(statement.statement_id), `duplicate statement identity: ${statement.statement_id}`);
      seen.add(statement.statement_id);
      requireString(statement.text, `statements.${category}[${index}].text`);
      const refs = sortedUnique(statement.source_refs, `statements.${category}[${index}].source_refs`);
      assert(refs.every((sourceId) => sourceIds.has(sourceId)), `statements.${category}[${index}] references an unknown source`);
    }
  }
}

function validateScope(scope) {
  requireRecord(scope, "atomic_scope");
  sortedUnique(scope.included, "atomic_scope.included");
  sortedUnique(scope.non_goals, "atomic_scope.non_goals");
  requireString(scope.smallest_sufficient_rule, "atomic_scope.smallest_sufficient_rule");
}

function validateGateMapping(mapping) {
  if (mapping === null) return;
  requireRecord(mapping, "gate_mapping");
  requireString(mapping.gate_path, "gate_mapping.gate_path");
  assert(mapping.gate_path.endsWith(".gate"), "gate_mapping.gate_path must point to a gate");
  sortedUnique(mapping.gate_ids, "gate_mapping.gate_ids");
  assert(JSON.stringify(mapping.allowed_outcomes) === JSON.stringify(GATE_OUTCOMES), "gate_mapping.allowed_outcomes must be the four-valued set");
  requireSha(mapping.mapping_sha256, "gate_mapping.mapping_sha256");
  assert(mapping.mapping_sha256 === canonicalDigest({...mapping, mapping_sha256: null}), "gate_mapping is not content-addressed");
}

function validateIndependentEvaluation(evaluation, block) {
  requireRecord(evaluation, "independent_evaluation");
  requireId(evaluation.evaluator_ref, "independent_evaluation.evaluator_ref");
  assert(evaluation.evaluator_ref !== block.author_ref, "author and evaluator identities must be distinct");
  assert(evaluation.independent === true, "independent evaluation is required");
  assert(["NOT_RUN", "STATIC_PASS_REVIEW_REQUIRED", "INTAKE_RECOMMENDED", "REJECTED"].includes(evaluation.status), "independent evaluation status is invalid");
  requireSha(evaluation.evaluated_block_sha256, "independent_evaluation.evaluated_block_sha256", true);
  requireSha(evaluation.receipt_sha256, "independent_evaluation.receipt_sha256", true);
  if (evaluation.status === "NOT_RUN") {
    assert(evaluation.evaluated_block_sha256 === null && evaluation.receipt_sha256 === null, "unrun evaluation cannot carry a receipt");
  } else {
    // The embedded evaluation record may omit the target digest to avoid a
    // self-referential block hash. The independent receipt supplied at intake
    // must still carry the exact block digest and is checked below.
    if (evaluation.evaluated_block_sha256 !== null) assert(evaluation.evaluated_block_sha256 === block.block_sha256, "evaluation does not bind to the exact block");
    assert(evaluation.receipt_sha256 !== null, "evaluated block is missing its receipt");
  }
  if (evaluation.status === "INTAKE_RECOMMENDED") assert(block.status === "WAITING_WITH_RECEIPT", "an intake recommendation requires a waiting block");
}

export function validateContextBlockIntake(block) {
  requireRecord(block, "context block");
  assert(block.schema === CONTEXT_BLOCK_SCHEMA && block.version === 1, "context block schema is invalid");
  assert(["CANDIDATE", "WAITING_WITH_RECEIPT", "REJECTED", "SUPERSEDED", "ARCHIVED"].includes(block.status), "context block status is invalid");
  requireId(block.block_id, "block_id", BLOCK_ID);
  assert(/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(block.revision), "revision must be semantic versioning");
  requireId(block.author_ref, "author_ref");
  assert(["PORTABLE", "PROJECT_SPECIFIC"].includes(block.classification), "classification is invalid");
  assert(["PORTABLE_KERNEL", "PROJECT_CONTROL_PLANE", "EXTERNAL_COMPANION_ONLY"].includes(block.authority_scope), "authority_scope is invalid");
  if (block.classification === "PROJECT_SPECIFIC") assert(block.authority_scope === "PROJECT_CONTROL_PLANE", "project-specific blocks must remain in the project control plane");
  if (block.classification === "PORTABLE") assert(["PORTABLE_KERNEL", "EXTERNAL_COMPANION_ONLY"].includes(block.authority_scope), "portable blocks cannot claim project-control-plane authority");
  requireString(block.purpose, "purpose");
  validateScope(block.atomic_scope);
  validateSourceDocuments(block.source_documents);
  const sourceIds = new Set(block.source_documents.map((source) => source.source_id));
  validateStatements(block.statements, sourceIds);
  requireRecord(block.freshness, "freshness");
  requireString(block.freshness.policy, "freshness.policy");
  requireUtc(block.freshness.expires_at_utc, "freshness.expires_at_utc", true);
  sortedUnique(block.freshness.revalidation_triggers, "freshness.revalidation_triggers");
  requireRecord(block.applicability, "applicability");
  sortedUnique(block.applicability.applies_when, "applicability.applies_when");
  sortedUnique(block.applicability.does_not_apply_when, "applicability.does_not_apply_when");
  sortedUnique(block.applicability.required_context_fields, "applicability.required_context_fields");
  assert(block.applicability.unknown_rule === "UNKNOWN_DENIES_DEPENDENT_ACTION;_NO_INFERENCE_OR_SCOPE_EXPANSION", "applicability unknown rule is weakened");
  sortedUnique(block.dependencies, "dependencies");
  sortedUnique(block.conflicts, "conflicts");
  sortedUnique(block.precedence, "precedence");
  sortedUnique(block.intended_roles, "intended_roles");
  requireRecord(block.minimal_context_payload, "minimal_context_payload");
  sortedUnique(block.minimal_context_payload.required_fields, "minimal_context_payload.required_fields");
  sortedUnique(block.minimal_context_payload.optional_fields, "minimal_context_payload.optional_fields");
  requireString(block.minimal_context_payload.redaction_profile, "minimal_context_payload.redaction_profile");
  requireSha(block.minimal_context_payload.payload_sha256, "minimal_context_payload.payload_sha256");
  validateGateMapping(block.gate_mapping);
  requireRecord(block.authority, "authority");
  sortedUnique(block.authority.allowed, "authority.allowed");
  sortedUnique(block.authority.prohibited, "authority.prohibited");
  requireString(block.authority.escalation, "authority.escalation");
  assert(block.authority.acceptance === "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT", "authority acceptance is weakened");
  requireRecord(block.evidence, "evidence");
  sortedUnique(block.evidence.minimum, "evidence.minimum");
  requireString(block.evidence.claim_boundary, "evidence.claim_boundary");
  assert(block.evidence.unknown_action === "RECORD_UNKNOWN_AND_CLOSE_ONLY_THE_DEPENDENT_ACTION", "evidence unknown action is weakened");
  requireRecord(block.privacy, "privacy");
  assert(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(block.privacy.classification), "privacy classification is invalid");
  assert(block.privacy.secret_handling === "DENY_RAW_SECRETS;_REDACT_AND_ESCALATE", "privacy secret handling is weakened");
  requireString(block.privacy.redaction_method, "privacy.redaction_method");
  requireSha(block.privacy.redaction_proof_sha256, "privacy.redaction_proof_sha256");
  assert(Array.isArray(block.adversarial_fixtures) && block.adversarial_fixtures.length >= 5, "adversarial fixture coverage is incomplete");
  const fixtureIds = [];
  for (const [index, fixture] of block.adversarial_fixtures.entries()) {
    requireRecord(fixture, `adversarial_fixtures[${index}]`);
    requireId(fixture.fixture_id, `adversarial_fixtures[${index}].fixture_id`, FIXTURE_ID);
    requireString(fixture.purpose, `adversarial_fixtures[${index}].purpose`);
    assert(["ACCEPT", "DENY", "UNKNOWN", "NOT_APPLICABLE"].includes(fixture.expected_outcome), `adversarial_fixtures[${index}].expected_outcome is invalid`);
    fixtureIds.push(fixture.fixture_id);
  }
  sortedUnique(fixtureIds, "adversarial fixture identities");
  validateIndependentEvaluation(block.independent_evaluation, block);
  requireRecord(block.supersession, "supersession");
  assert(["CURRENT", "SUPERSEDES", "SUPERSEDED", "BLOCKED_REVALIDATION"].includes(block.supersession.status), "supersession status is invalid");
  if (block.supersession.status === "CURRENT") assert(block.supersession.superseded_by === null, "current block cannot have a successor");
  if (block.supersession.status === "SUPERSEDED") assert(block.supersession.superseded_by !== null, "superseded block lacks a successor");
  requireString(block.supersession.migration_rule, "supersession.migration_rule");
  requireRecord(block.rollback, "rollback");
  requireString(block.rollback.legacy_source_identity, "rollback.legacy_source_identity");
  requireSha(block.rollback.preservation_receipt_sha256, "rollback.preservation_receipt_sha256");
  requireString(block.rollback.restore_procedure, "rollback.restore_procedure");
  requireSha(block.block_sha256, "block_sha256");
  assert(block.block_sha256 === canonicalDigest({...block, block_sha256: null}), "context block is not content-addressed");
  secretFree(block, "context block");
  return block;
}

export function compileContextBlockIntake(input) {
  requireRecord(input, "context block intake input");
  const block = {
    schema: CONTEXT_BLOCK_SCHEMA,
    version: 1,
    status: input.status ?? "CANDIDATE",
    ...structuredClone(input),
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest(block);
  return validateContextBlockIntake(block);
}

export function verifyContextBlockForIntake({block, evaluator}) {
  validateContextBlockIntake(block);
  requireRecord(evaluator, "context block evaluator receipt");
  assert(evaluator.evaluator_ref === block.independent_evaluation.evaluator_ref, "evaluator identity differs from the block receipt");
  assert(evaluator.independent === true && evaluator.status === "INTAKE_RECOMMENDED", "independent evaluator has not recommended intake");
  assert(evaluator.block_sha256 === block.block_sha256, "evaluator receipt targets a different block");
  requireSha(evaluator.receipt_sha256, "evaluator receipt");
  assert(block.status === "WAITING_WITH_RECEIPT", "context block is not waiting with a receipt");
  assert(block.independent_evaluation.status === "INTAKE_RECOMMENDED"
    && block.independent_evaluation.receipt_sha256 === evaluator.receipt_sha256,
  "block evaluation fields do not match the typed evaluator receipt");
  return {
    schema: "agentos.context_block_intake_receipt.v1",
    version: 1,
    status: "INTAKE_ELIGIBLE",
    block_id: block.block_id,
    block_sha256: block.block_sha256,
    evaluator_ref: evaluator.evaluator_ref,
    evaluator_receipt_sha256: evaluator.receipt_sha256,
    classification: block.classification,
    authority_scope: block.authority_scope,
    external_only: true,
    mutation: "NONE",
    activation: "OFF",
    admission: "NOT_PERFORMED",
    receipt_sha256: null,
  };
}

export function finalizeContextBlockIntakeReceipt(receipt) {
  requireRecord(receipt, "context block intake receipt");
  const body = {...receipt, receipt_sha256: null};
  receipt.receipt_sha256 = canonicalDigest(body);
  return receipt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({schema: CONTEXT_BLOCK_SCHEMA, status: "READY", mutation: "NONE", activation: "OFF"}, null, 2)}\n`);
}
