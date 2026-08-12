#!/usr/bin/env node

/*
 * Deterministic compiler and validator for the portable Specialist Block
 * Library.  Packages are inert candidate data.  This module never activates a
 * block, grants Product custody, writes secrets, or performs external work.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SPECIALIST_BLOCK_SCHEMA = "agentos.specialist_block.v1";
export const SPECIALIST_GATE_SCHEMA = "agentos.specialist_gate.v1";
export const SPECIALIST_SOURCE_SCHEMA = "agentos.specialist_source_manifest.v1";
export const SPECIALIST_EVALUATION_SCHEMA = "agentos.specialist_evaluation.v1";
export const SPECIALIST_HANDOFF_SCHEMA = "agentos.specialist_handoff.v1";
export const ROLE_KINDS = Object.freeze(["ROUTER", "CONTROL_PLANE", "KNOWLEDGE_BLOCK", "GOVERNANCE_BLOCK", "STANDARD_BLOCK", "CONTEXT_BLOCK", "ATOMIC_SPECIALIST", "COMPILED_AGENT_PACKAGE"]);
export const GATE_OUTCOMES = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
export const SPECIALIST_GATE_IDS = Object.freeze([
  "00-intake",
  "01-applicability",
  "02-authority-precedence",
  "03-scope-nongoals",
  "04-source-evidence-freshness",
  "05-context-completeness",
  "06-tool-resource-custody",
  "07-data-secret-privacy",
  "08-build-browser-runtime",
  "09-output-handoff",
  "10-proof-acceptance",
  "11-lifecycle-recovery-archive",
]);
export const ATOMIC_EVALUATION_CLASSES = Object.freeze([
  "umbrella_authority",
  "unrelated_scope",
  "silent_scope_expansion",
  "duplicate_sibling_authority",
  "router_self_accept",
  "broad_when_narrow_exists",
  "cross_provider_version_claim",
]);
export const CORE_EVALUATION_CLASSES = Object.freeze([
  "narrowness",
  "routing",
  "missing_context",
  "stale_source",
  "authority_conflict",
  "tool_limit",
  "data_limit",
  "false_positive",
  "unsafe_action",
  "handoff",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const PRIVATE_PATH_PATTERN = /(?:^|[\\/])(?:Users|home|private|tmp|var)[\\/]/u;

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

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const normalized = [...values].sort();
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be sorted`);
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret-like material`);
  assert(!PRIVATE_PATH_PATTERN.test(text), `${label} contains a private filesystem path`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function readJson(filePath, label = filePath) {
  assert(fs.existsSync(filePath), `${label} is missing`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  secretFree(parsed, label);
  return parsed;
}

function requireStringArray(value, label, {minItems = 0} = {}) {
  assert(Array.isArray(value) && value.length >= minItems, `${label} is invalid`);
  assert(value.every((item) => typeof item === "string" && item.trim().length > 0), `${label} contains an invalid value`);
  sortedUnique(value, label);
}

function validateAtomicity(block) {
  assert(ROLE_KINDS.includes(block.role_kind), `${block.block_id} role_kind is invalid`);
  requireString(block.atomic_scope_statement, `${block.block_id} atomic_scope_statement`);
  requireStringArray(block.permitted_decisions, `${block.block_id} permitted_decisions`, {minItems: 1});
  requireStringArray(block.forbidden_decisions, `${block.block_id} forbidden_decisions`, {minItems: 1});
  requireString(block.maximum_authority, `${block.block_id} maximum_authority`);
  if (block.required_upstream_router !== null) requireString(block.required_upstream_router, `${block.block_id} required_upstream_router`);
  requireStringArray(block.sibling_conflicts, `${block.block_id} sibling_conflicts`);
  requireStringArray(block.composition_rules, `${block.block_id} composition_rules`, {minItems: 1});
  requireString(block.escalation_target, `${block.block_id} escalation_target`);
  requireStringArray(block.split_required_when, `${block.block_id} split_required_when`, {minItems: 1});
  if (block.role_kind === "ROUTER") {
    assert(block.required_upstream_router === null, `${block.block_id} router cannot require an upstream router`);
    assert(/(?:NO_PRODUCT_WRITE|NO_PRODUCT|ADVISORY|NO_ACCEPTANCE)/iu.test(block.maximum_authority), `${block.block_id} router has excessive authority`);
    assert(block.permitted_decisions.every((decision) => !/(?:write|accept|admit|deploy|publish)/iu.test(decision)), `${block.block_id} router has Product or acceptance authority`);
  }
  if (block.role_kind === "ATOMIC_SPECIALIST") {
    assert(block.required_upstream_router !== null, `${block.block_id} atomic specialist lacks an upstream router`);
    assert(block.forbidden_decisions.some((decision) => /(?:broaden|sibling|family|router|provider|version)/iu.test(decision)), `${block.block_id} atomic specialist lacks an anti-broadening decision`);
    assert(block.maximum_authority.includes("NO_PRODUCT"), `${block.block_id} atomic specialist has Product authority`);
  }
  if (["CONTROL_PLANE", "KNOWLEDGE_BLOCK", "GOVERNANCE_BLOCK", "STANDARD_BLOCK", "CONTEXT_BLOCK", "COMPILED_AGENT_PACKAGE"].includes(block.role_kind)) {
    assert(block.required_upstream_router === null, `${block.block_id} control-plane block cannot require a Product router`);
    assert(/(?:NO_PRODUCT_WRITE|NO_PRODUCT|ADVISORY|NO_ACCEPTANCE)/iu.test(block.maximum_authority), `${block.block_id} composable block has excessive authority`);
  }
}

export function validateSpecialistBlock(block) {
  requireRecord(block, "specialist block");
  assert(block.schema === SPECIALIST_BLOCK_SCHEMA && block.version === 1, "specialist block schema mismatch");
  requireString(block.block_id, "specialist block ID");
  assert(/^specialist\.[a-z0-9-]+\.[a-z0-9-]+$/u.test(block.block_id), "specialist block ID is invalid");
  assert(/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(block.revision), `${block.block_id} revision is invalid`);
  assert(/^P[0-6]$/u.test(block.priority), `${block.block_id} priority is invalid`);
  validateAtomicity(block);
  requireString(block.title, `${block.block_id} title`);
  assert(["PLANNED", "RESEARCHING", "CANDIDATE", "EVALUATED", "ADMITTED", "DEPRECATED", "NOT_APPLICABLE", "SUSPENDED", "ARCHIVED"].includes(block.lifecycle), `${block.block_id} lifecycle is invalid`);
  assert(block.lifecycle !== "ADMITTED", `${block.block_id} cannot be self-admitted`);
  assert(block.activation === "OFF", `${block.block_id} activation must be OFF`);
  requireString(block.purpose, `${block.block_id} purpose`);
  requireStringArray(block.scope.included, `${block.block_id} scope.included`, {minItems: 1});
  requireStringArray(block.scope.non_goals, `${block.block_id} scope.non_goals`, {minItems: 1});
  requireString(block.scope.smallest_sufficient_rule, `${block.block_id} smallest-sufficient rule`);
  requireStringArray(block.required_knowledge, `${block.block_id} required_knowledge`, {minItems: 1});
  requireString(block.intake.context_schema, `${block.block_id} context schema`);
  requireStringArray(block.intake.required_context, `${block.block_id} required context`);
  requireStringArray(block.intake.optional_context, `${block.block_id} optional context`);
  requireStringArray(block.intake.deny_if_missing, `${block.block_id} deny-if-missing`);
  requireStringArray(block.intake.acceptance_signals, `${block.block_id} acceptance signals`, {minItems: 1});
  requireStringArray(block.intake.rejection_signals, `${block.block_id} rejection signals`, {minItems: 1});
  requireString(block.output.contract_id, `${block.block_id} output contract`);
  requireString(block.output.typed_schema, `${block.block_id} output schema`);
  requireStringArray(block.output.required_fields, `${block.block_id} required output fields`, {minItems: 1});
  requireStringArray(block.output.evidence_obligations, `${block.block_id} output evidence obligations`, {minItems: 1});
  requireStringArray(block.output.handoff_fields, `${block.block_id} output handoff fields`, {minItems: 1});
  requireStringArray(block.authority.allowed_authority, `${block.block_id} allowed authority`, {minItems: 1});
  requireStringArray(block.authority.precedence, `${block.block_id} precedence`, {minItems: 1});
  requireStringArray(block.authority.prohibited_authority, `${block.block_id} prohibited authority`, {minItems: 1});
  requireString(block.authority.jurisdiction_rule, `${block.block_id} jurisdiction rule`);
  requireString(block.authority.escalation_rule, `${block.block_id} authority escalation rule`);
  assert(block.authority.acceptance_authority === "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT", `${block.block_id} acceptance authority is invalid`);
  assert(block.evidence.source_lock === "sources.lock", `${block.block_id} source lock must be sources.lock`);
  requireString(block.evidence.freshness_policy, `${block.block_id} freshness policy`);
  requireString(block.evidence.claim_rule, `${block.block_id} claim rule`);
  requireString(block.evidence.unknown_rule, `${block.block_id} unknown rule`);
  requireStringArray(block.controls.read, `${block.block_id} read controls`);
  requireStringArray(block.controls.write, `${block.block_id} write controls`);
  requireStringArray(block.controls.tools, `${block.block_id} tool controls`);
  requireStringArray(block.controls.data, `${block.block_id} data controls`, {minItems: 1});
  assert(block.controls.secrets === "DENY" || block.controls.secrets === "REDACT_AND_ESCALATE", `${block.block_id} secret control is invalid`);
  assert(["DENY", "READ_ONLY_PRIMARY_SOURCES", "READ_ONLY_PROJECT_CONTEXT"].includes(block.controls.browser), `${block.block_id} browser control is invalid`);
  assert(["DENY", "LOCAL_READ_ONLY", "LOCAL_ISOLATED_CANDIDATE"].includes(block.controls.build), `${block.block_id} build control is invalid`);
  assert(block.controls.deploy === "DENY", `${block.block_id} deploy control must be DENY`);
  assert(["NONE", "TYPED_HANDOFF_ONLY", "OWNER_REVIEW_ONLY"].includes(block.controls.communication), `${block.block_id} communication control is invalid`);
  assert(block.controls.acceptance_authority === "INDEPENDENT_AUTHORITY_ONLY", `${block.block_id} control acceptance authority is invalid`);
  assert(block.failure.ambiguous === "DENY_AND_REQUEST_TYPED_CONTEXT", `${block.block_id} ambiguous failure is not closed`);
  assert(block.failure.missing_context === "DENY_AND_REQUEST_TYPED_CONTEXT", `${block.block_id} missing-context failure is not closed`);
  assert(block.failure.stale_source === "DENY_AND_REFRESH_OR_ESCALATE", `${block.block_id} stale-source failure is not closed`);
  assert(block.failure.authority_conflict === "DENY_AND_ESCALATE", `${block.block_id} authority-conflict failure is not closed`);
  assert(block.failure.unsafe_action === "DENY_AND_PRESERVE_CUSTODY", `${block.block_id} unsafe-action failure is not closed`);
  requireStringArray(block.failure.recovery, `${block.block_id} recovery`, {minItems: 1});
  requireStringArray(block.failure.terminal_statuses, `${block.block_id} terminal statuses`, {minItems: 1});
  for (const field of ["candidate_entry", "evaluation_entry", "suspension", "archive", "reactivation"]) requireString(block.lifecycle_rules[field], `${block.block_id} lifecycle ${field}`);
  requireString(block.gate_path, `${block.block_id} gate path`);
  assert(block.gate_pack.manifest_path === "gates/manifest.json", `${block.block_id} gate manifest path is invalid`);
  assert(JSON.stringify(block.gate_pack.outcomes) === JSON.stringify(GATE_OUTCOMES), `${block.block_id} gate outcomes are invalid`);
  assert(JSON.stringify(block.gate_pack.ordered_gate_ids) === JSON.stringify(SPECIALIST_GATE_IDS), `${block.block_id} gate order is invalid`);
  requireString(block.schema_path, `${block.block_id} block schema path`);
  requireStringArray(block.dependencies, `${block.block_id} dependencies`);
  requireStringArray(block.conflicts, `${block.block_id} conflicts`);
  requireStringArray(block.aliases, `${block.block_id} aliases`);
  requireString(block.evaluation.dossier_path, `${block.block_id} evaluation dossier path`);
  requireString(block.evaluation.receipt_id, `${block.block_id} evaluation receipt ID`);
  assert(block.evaluation.independent_reviewer_required === true, `${block.block_id} lacks independent reviewer requirement`);
  requireStringArray(block.evaluation.fixture_classes, `${block.block_id} evaluation fixture classes`, {minItems: 5});
  assert(block.reuse.content_addressed === true, `${block.block_id} is not content-addressed for reuse`);
  assert(/^block-lock\.[a-z0-9-]+$/u.test(block.reuse.reuse_key), `${block.block_id} reuse key is invalid`);
  assert(block.reuse.applicability_overlay === "EXTERNAL_TYPED_COMPANION_ONLY", `${block.block_id} stores applicability inside the generic block`);
  requireString(block.reuse.edition_rule, `${block.block_id} edition rule`);
  requireString(block.reuse.freshness_rule, `${block.block_id} reuse freshness rule`);
  if (block.role_kind === "STANDARD_BLOCK") {
    requireRecord(block.reuse.standard_identity, `${block.block_id} standard identity`);
    for (const field of ["publisher", "identifier", "edition"]) requireString(block.reuse.standard_identity[field], `${block.block_id} standard identity ${field}`);
    assert(typeof block.reuse.compatibility_map_path === "string" && typeof block.reuse.supersession_path === "string", `${block.block_id} standard reuse maps are missing`);
    assert(block.normalized_requirements_path === "requirements.json", `${block.block_id} normalized requirements are missing`);
    requireStringArray(block.applicability_inputs, `${block.block_id} applicability inputs`, {minItems: 1});
    requireStringArray(block.exceptions, `${block.block_id} exceptions`, {minItems: 1});
    requireString(block.supersession_status, `${block.block_id} supersession status`);
    requireSha(block.source_manifest_sha256, `${block.block_id} source manifest digest`);
    requireSha(block.normalized_requirements_sha256, `${block.block_id} normalized requirements digest`);
    requireSha(block.compatibility_sha256, `${block.block_id} compatibility digest`);
    requireSha(block.supersession_sha256, `${block.block_id} supersession digest`);
  }
  requireSha(block.block_sha256, `${block.block_id} block digest`);
  assert(block.block_sha256 === digestWithout(block, "block_sha256"), `${block.block_id} block digest mismatch`);
  secretFree(block, block.block_id);
  return block;
}

export function validateSourceLock(manifest, blockId) {
  requireRecord(manifest, `${blockId} sources.lock`);
  assert(manifest.schema === SPECIALIST_SOURCE_SCHEMA && manifest.version === 1, `${blockId} source lock schema mismatch`);
  assert(manifest.block_id === blockId, `${blockId} source lock block mismatch`);
  assert(Array.isArray(manifest.sources) && manifest.sources.length > 0, `${blockId} source lock is empty`);
  const sourceIds = new Set();
  for (const source of manifest.sources) {
    requireRecord(source, `${blockId} source`);
    for (const field of ["source_id", "title", "publisher", "url", "version", "retrieved_date", "immutable_identity", "scope"]) requireString(source[field], `${blockId} source ${field}`);
    assert(/^source\.[a-z0-9-]+$/u.test(source.source_id), `${blockId} source ID is invalid`);
    assert(!sourceIds.has(source.source_id), `${blockId} source IDs are duplicated`);
    sourceIds.add(source.source_id);
    assert(/^(https?:\/\/|PORTABLE_KERNEL)/u.test(source.url), `${blockId} source URL is not primary or portable`);
    assert(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(source.retrieved_date), `${blockId} source retrieved date is invalid`);
    assert(["PRIMARY_NORMATIVE", "PRIMARY_DESCRIPTIVE", "SECONDARY_RESEARCH", "AGENTOS_PORTABLE"].includes(source.authority_class), `${blockId} source authority class is invalid`);
    if (source.content_sha256 !== null) requireSha(source.content_sha256, `${blockId} source content digest`);
    assert(source.content_sha256 !== null || source.immutable_identity.length >= 8, `${blockId} source lacks digest and immutable identity`);
  }
  requireString(manifest.freshness_rule, `${blockId} source freshness rule`);
  assert(/(?:DENY|STALE|EXPIRE|REFRESH)/iu.test(manifest.freshness_rule), `${blockId} source freshness rule is not fail-closed`);
  requireSha(manifest.manifest_sha256, `${blockId} source manifest digest`);
  assert(manifest.manifest_sha256 === digestWithout(manifest, "manifest_sha256"), `${blockId} source manifest digest mismatch`);
  secretFree(manifest, `${blockId} sources.lock`);
  return manifest;
}

export function validateSpecialistGate(gate, blockId, expectedGateId) {
  requireRecord(gate, `${blockId} gate`);
  assert(gate.schema === SPECIALIST_GATE_SCHEMA && gate.version === 1, `${blockId} gate schema mismatch`);
  assert(gate.block_id === blockId, `${blockId} gate block mismatch`);
  assert(gate.gate_id === expectedGateId, `${blockId} gate ID mismatch`);
  assert(gate.status === "EXECUTABLE", `${blockId} gate is not executable`);
  assert(gate.answer_type === "FOUR_VALUED", `${blockId} gate answer type is invalid`);
  assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(GATE_OUTCOMES), `${blockId} gate outcomes are invalid`);
  requireString(gate.question, `${blockId} ${expectedGateId} question`);
  requireStringArray(gate.evidence, `${blockId} ${expectedGateId} evidence`, {minItems: 1});
  exactKeys(gate.next, GATE_OUTCOMES, `${blockId} ${expectedGateId} next map`);
  for (const outcome of GATE_OUTCOMES) requireString(gate.next[outcome], `${blockId} ${expectedGateId} ${outcome} transition`);
  exactKeys(gate.rules, ["ambiguity", "missing_evidence", "stale_source", "authority_conflict", "unsafe_action", "unknown_scope"], `${blockId} ${expectedGateId} rules`);
  assert(gate.rules.ambiguity === "DENY" && gate.rules.missing_evidence === "DENY" && gate.rules.stale_source === "DENY" && gate.rules.authority_conflict === "ESCALATE" && gate.rules.unsafe_action === "DENY" && gate.rules.unknown_scope === "DEPENDENT_ACTION_ONLY", `${blockId} ${expectedGateId} rules are not fail-closed`);
  requireSha(gate.gate_sha256, `${blockId} ${expectedGateId} digest`);
  assert(gate.gate_sha256 === digestWithout(gate, "gate_sha256"), `${blockId} ${expectedGateId} digest mismatch`);
  secretFree(gate, `${blockId} ${expectedGateId}`);
  return gate;
}

export function validateGatePack(packageDir, block) {
  const manifestPath = path.join(packageDir, "gates", "manifest.json");
  const manifest = readJson(manifestPath, `${block.block_id} gate manifest`);
  exactKeys(manifest, ["schema", "version", "block_id", "ordered_gate_ids", "outcomes", "gate_paths", "manifest_sha256"], `${block.block_id} gate manifest`);
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1, `${block.block_id} gate manifest schema mismatch`);
  assert(manifest.block_id === block.block_id, `${block.block_id} gate manifest block mismatch`);
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(SPECIALIST_GATE_IDS), `${block.block_id} gate manifest order mismatch`);
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(GATE_OUTCOMES), `${block.block_id} gate manifest outcomes mismatch`);
  assert(Array.isArray(manifest.gate_paths) && manifest.gate_paths.length === SPECIALIST_GATE_IDS.length, `${block.block_id} gate manifest paths are incomplete`);
  for (let index = 0; index < SPECIALIST_GATE_IDS.length; index += 1) {
    const gateId = SPECIALIST_GATE_IDS[index];
    assert(manifest.gate_paths[index] === `gates/${gateId}.gate`, `${block.block_id} gate path order mismatch`);
    const gate = readJson(path.join(packageDir, "gates", `${gateId}.gate`), `${block.block_id} ${gateId}`);
    validateSpecialistGate(gate, block.block_id, gateId);
  }
  requireSha(manifest.manifest_sha256, `${block.block_id} gate manifest digest`);
  assert(manifest.manifest_sha256 === digestWithout(manifest, "manifest_sha256"), `${block.block_id} gate manifest digest mismatch`);
  return manifest;
}

function validateStandardPackage(packageDir, block, sources) {
  assert(block.role_kind === "STANDARD_BLOCK", `${block.block_id} standard package validator received a non-standard block`);
  assert(block.source_manifest_sha256 === sources.manifest_sha256, `${block.block_id} source manifest binding mismatch`);
  const lockedSource = sources.sources.find((source) => source.version === block.reuse.standard_identity.edition);
  assert(lockedSource && lockedSource.publisher === block.reuse.standard_identity.publisher, `${block.block_id} source publisher/edition does not match the standard identity`);
  assert(Object.prototype.hasOwnProperty.call(lockedSource, "effective_date"), `${block.block_id} source lock omits effective-date status`);
  const requirements = readJson(path.join(packageDir, "requirements.json"), `${block.block_id} normalized requirements`);
  assert(requirements.schema === "agentos.specialist_standard_requirements.v1" && requirements.version === 1, `${block.block_id} normalized requirements schema mismatch`);
  assert(requirements.block_id === block.block_id, `${block.block_id} normalized requirements block mismatch`);
  assert(canonicalDigest(requirements) === block.normalized_requirements_sha256, `${block.block_id} normalized requirements digest mismatch`);
  assert(requirements.standard_identity && JSON.stringify(requirements.standard_identity) === JSON.stringify(block.reuse.standard_identity), `${block.block_id} normalized standard identity mismatch`);
  assert(Array.isArray(requirements.requirements) && requirements.requirements.length > 0, `${block.block_id} normalized requirements are empty`);
  const requirementIds = requirements.requirements.map((item) => item.requirement_id);
  assert(requirementIds.every((item) => typeof item === "string" && item.length > 0), `${block.block_id} requirement identifier is missing`);
  assert(new Set(requirementIds).size === requirementIds.length, `${block.block_id} requirement identifiers are duplicated`);
  const compatibility = readJson(path.join(packageDir, block.reuse.compatibility_map_path), `${block.block_id} compatibility map`);
  assert(compatibility.schema === "agentos.specialist_standard_compatibility.v1" && compatibility.version === 1, `${block.block_id} compatibility schema mismatch`);
  assert(compatibility.block_id === block.block_id, `${block.block_id} compatibility block mismatch`);
  assert(canonicalDigest(compatibility) === block.compatibility_sha256, `${block.block_id} compatibility digest mismatch`);
  const supersession = readJson(path.join(packageDir, block.reuse.supersession_path), `${block.block_id} supersession map`);
  assert(supersession.schema === "agentos.specialist_standard_supersession.v1" && supersession.version === 1, `${block.block_id} supersession schema mismatch`);
  assert(supersession.block_id === block.block_id, `${block.block_id} supersession block mismatch`);
  assert(canonicalDigest(supersession) === block.supersession_sha256, `${block.block_id} supersession digest mismatch`);
  assert(supersession.status === block.supersession_status && Array.isArray(supersession.known_non_superseding), `${block.block_id} supersession status is not bound to the block`);
  return {requirements, compatibility, supersession};
}

function validateEvaluation(evaluation, block) {
  assert(evaluation.schema === SPECIALIST_EVALUATION_SCHEMA && evaluation.version === 1, `${block.block_id} evaluation schema mismatch`);
  assert(evaluation.block_id === block.block_id, `${block.block_id} evaluation block mismatch`);
  assert(evaluation.candidate_digest === block.block_sha256, `${block.block_id} evaluation digest mismatch`);
  assert(evaluation.model_requirement === "gpt-5.6-luna/max", `${block.block_id} evaluation model requirement mismatch`);
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length >= CORE_EVALUATION_CLASSES.length + ATOMIC_EVALUATION_CLASSES.length, `${block.block_id} evaluation case set is incomplete`);
  const classes = new Set(evaluation.cases.map((item) => item.class));
  for (const className of [...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]) assert(classes.has(className), `${block.block_id} evaluation lacks ${className}`);
  for (const item of evaluation.cases) {
    assert(["ROUTE", "DENY", "ESCALATE"].includes(item.expected), `${block.block_id} evaluation expected outcome is invalid`);
    assert(["PASS", "FAIL", "PENDING"].includes(item.observed), `${block.block_id} evaluation observed outcome is invalid`);
  }
  assert(evaluation.independence_rule === "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION", `${block.block_id} evaluation independence rule is invalid`);
  return evaluation;
}

function validateHandoff(handoff, block, packageDir) {
  assert(handoff.schema === SPECIALIST_HANDOFF_SCHEMA && handoff.version === 1, `${block.block_id} handoff schema mismatch`);
  assert(handoff.block_id === block.block_id, `${block.block_id} handoff block mismatch`);
  assert(handoff.candidate_digest === block.block_sha256, `${block.block_id} handoff digest mismatch`);
  requireGitObject(handoff.source_commit, `${block.block_id} handoff source commit`);
  requireGitObject(handoff.source_tree, `${block.block_id} handoff source tree`);
  assert(Array.isArray(handoff.changed_paths) && handoff.changed_paths.length > 0, `${block.block_id} handoff changed paths are missing`);
  assert(handoff.changed_paths.every((changedPath) => changedPath.startsWith(`${path.relative(process.cwd(), packageDir)}/`) || changedPath.startsWith("specialist-blocks/")), `${block.block_id} handoff escapes package scope`);
  assert(handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", `${block.block_id} handoff authority is invalid`);
  return handoff;
}

function normalizeRoleId(family, title) {
  const slug = title.toLowerCase().replace(/\+\+/gu, "-plus-plus").replace(/#/gu, "-sharp").replace(/&/gu, "-and-").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").replace(/-+/gu, "-");
  return `inventory.${family}.${slug}`;
}

export function materializeMasterInventory(raw, atomicOverlay) {
  requireRecord(raw, "master inventory");
  requireRecord(atomicOverlay, "atomic inventory");
  const entries = [];
  for (const family of raw.families) {
    for (const subfamily of family.subfamilies) {
      for (const title of subfamily.roles) {
        if (entries.some((entry) => entry.title === title)) continue;
        entries.push({
          canonical_id: normalizeRoleId(family.family, title),
          title,
          aliases: [],
          family: family.family,
          subfamily: subfamily.name,
          purpose: raw.entry_defaults.purpose,
          triggers: [...raw.entry_defaults.triggers],
          exclusions: [...raw.entry_defaults.exclusions],
          dependencies: [...raw.entry_defaults.dependencies],
          conflicts: [...raw.entry_defaults.conflicts],
          source_requirements: [...raw.entry_defaults.source_requirements],
          freshness_policy: raw.entry_defaults.freshness_policy,
          priority_score: family.rank,
          gate_status: raw.entry_defaults.gate_status,
          gate_path: raw.entry_defaults.gate_path,
          schema_path: raw.entry_defaults.schema_path,
          package_status: raw.entry_defaults.package_status,
          evaluator_status: raw.entry_defaults.evaluator_status,
          evaluator_receipt: raw.entry_defaults.evaluator_receipt,
          lifecycle: raw.entry_defaults.lifecycle,
          role_kind: "ROUTER",
        });
      }
    }
  }
  const byTitle = new Map(entries.map((entry) => [entry.title, entry]));
  for (const alias of raw.alias_mappings) {
    const canonical = byTitle.get(alias.canonical_title);
    assert(canonical, `alias target is absent: ${alias.canonical_title}`);
    canonical.aliases.push(alias.alias);
  }
  for (const entry of entries) entry.aliases.sort();
  const atomicEntries = [];
  for (const item of atomicOverlay.atomic_specialists) {
    atomicEntries.push({
      canonical_id: item.generic_id,
      title: item.title,
      aliases: [],
      family: item.router.split(".")[1] ?? "atomic",
      subfamily: "atomic",
      purpose: `Analyze only ${item.title} under its version lock.`,
      triggers: [`upstream router selects ${item.generic_id}`],
      exclusions: ["unrelated sibling failure modes", "provider or standard versions not named in the source lock"],
      dependencies: [item.router],
      conflicts: [],
      source_requirements: ["primary source with version and immutable identity", "sources.lock required"],
      freshness_policy: "Stale, superseded, or applicability-unknown source denies the dependent action.",
      priority_score: "P1",
      gate_status: item.gate_status ?? "PLANNED",
      gate_path: null,
      schema_path: "schemas/specialist-block.v1.json",
      package_status: item.package_status ?? "UNPACKAGED",
      evaluator_status: item.evaluator_status ?? "NOT_RUN",
      evaluator_receipt: item.evaluator_receipt ?? null,
      lifecycle: item.lifecycle ?? "PLANNED",
      role_kind: "ATOMIC_SPECIALIST",
      version: item.version,
      required_upstream_router: item.router,
      block_id: item.block_id ?? null,
      block_ids: item.block_ids ?? [],
    });
  }
  const controlEntries = atomicOverlay.control_plane.map((item) => ({
    canonical_id: item.generic_id,
    title: item.title,
    aliases: [],
    family: "control-plane",
    subfamily: "control-plane",
    purpose: `Operate the portable governance control for ${item.title}.`,
    triggers: ["typed control-plane request"],
    exclusions: ["consumer Product implementation", "provider activation", "self-acceptance"],
    dependencies: ["specialist.foundation.evaluation-admission-gate"],
    conflicts: [],
    source_requirements: ["portable AgentOS authority corpus and exact local evidence"],
    freshness_policy: "Stale authority or missing custody evidence stops the dependent control transition.",
    priority_score: "P0",
    gate_status: "PLANNED",
    gate_path: null,
    schema_path: "schemas/specialist-block.v1.json",
    package_status: "UNPACKAGED",
    evaluator_status: "NOT_RUN",
    evaluator_receipt: null,
    lifecycle: "PLANNED",
    role_kind: "CONTROL_PLANE",
    required_upstream_router: null,
  }));
  const routers = atomicOverlay.routers.map((item) => ({
    canonical_id: item.generic_id,
    title: item.title,
    aliases: [],
    family: item.block_id.split(".")[1] ?? "router",
    subfamily: "router",
    purpose: `Classify and assemble context for ${item.title}; never perform the atomic work.`,
    triggers: ["typed family-level request"],
    exclusions: ["Product writing", "acceptance", "substituting for an atomic specialist"],
    dependencies: ["specialist.foundation.role-intake-classifier"],
    conflicts: [],
    source_requirements: ["versioned primary source and applicability evidence"],
    freshness_policy: "Unknown or stale applicability denies the dependent route.",
    priority_score: "P1",
    gate_status: "PLANNED",
    gate_path: null,
    schema_path: "schemas/specialist-block.v1.json",
    package_status: item.package_status ?? "UNPACKAGED",
    evaluator_status: item.evaluator_status ?? "NOT_RUN",
    evaluator_receipt: item.evaluator_receipt ?? null,
    lifecycle: item.lifecycle ?? "PLANNED",
    role_kind: "ROUTER",
    required_upstream_router: null,
    block_id: item.block_id ?? null,
  }));
  const all = [...entries, ...routers, ...atomicEntries, ...controlEntries];
  const seen = new Set();
  for (const entry of all) {
    assert(!seen.has(entry.canonical_id), `materialized inventory ID collision: ${entry.canonical_id}`);
    seen.add(entry.canonical_id);
  }
  all.sort((left, right) => left.canonical_id.localeCompare(right.canonical_id));
  const counts = Object.fromEntries(ROLE_KINDS.map((kind) => [kind, all.filter((entry) => entry.role_kind === kind).length]));
  const typedOverlayEntries = [...routers, ...atomicEntries, ...controlEntries].sort((left, right) => left.canonical_id.localeCompare(right.canonical_id));
  const typedOverlayCounts = Object.fromEntries(ROLE_KINDS.map((kind) => [kind, typedOverlayEntries.filter((entry) => entry.role_kind === kind).length]));
  assert(counts.ROUTER >= raw.role_kind_counts.ROUTER, "master inventory router count regressed");
  assert(counts.ATOMIC_SPECIALIST === raw.role_kind_counts.ATOMIC_SPECIALIST, "atomic inventory count differs from declared count");
  assert(counts.CONTROL_PLANE === raw.role_kind_counts.CONTROL_PLANE, "control-plane inventory count differs from declared count");
  return {schema: "agentos.specialist_materialized_inventory.v1", version: 1, status: "COMPILED_CANDIDATE", activation: "OFF", counts, entries, typed_overlay_entries: typedOverlayEntries, typed_overlay_counts: typedOverlayCounts, inventory_sha256: null};
}

function packageDirectories(libraryRoot) {
  const roots = ["foundation", "standards", "wave-01", "wave-02"];
  const packages = [];
  for (const root of roots) {
    const rootPath = path.join(libraryRoot, root);
    if (!fs.existsSync(rootPath)) continue;
    for (const family of fs.readdirSync(rootPath, {withFileTypes: true}).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const packageDir = path.join(rootPath, family.name);
      if (fs.existsSync(path.join(packageDir, "block.json"))) packages.push(packageDir);
    }
  }
  return packages;
}

export function compileSpecialistLibrary({repositoryRoot = process.cwd(), writeGenerated = false} = {}) {
  const libraryRoot = path.join(repositoryRoot, "specialist-blocks");
  const packagePaths = packageDirectories(libraryRoot);
  const records = [];
  for (const packageDir of packagePaths) {
    const block = validateSpecialistBlock(readJson(path.join(packageDir, "block.json"), `${packageDir}/block.json`));
    const sources = validateSourceLock(readJson(path.join(packageDir, "sources.lock"), `${block.block_id}/sources.lock`), block.block_id);
    validateGatePack(packageDir, block);
    const standard = block.role_kind === "STANDARD_BLOCK" ? validateStandardPackage(packageDir, block, sources) : null;
    const evaluation = validateEvaluation(readJson(path.join(packageDir, "evaluation.json"), `${block.block_id}/evaluation.json`), block);
    const handoff = validateHandoff(readJson(path.join(packageDir, "handoff.json"), `${block.block_id}/handoff.json`), block, packageDir);
    records.push({block, sources, standard, evaluation, handoff, packageDir});
  }
  records.sort((left, right) => left.block.block_id.localeCompare(right.block.block_id));
  const ids = new Set();
  for (const record of records) {
    assert(!ids.has(record.block.block_id), `duplicate specialist block: ${record.block.block_id}`);
    ids.add(record.block.block_id);
    if (record.block.role_kind === "ATOMIC_SPECIALIST") assert(record.block.required_upstream_router, `${record.block.block_id} atomic block lacks upstream router`);
  }
  const roster = compileRoster(records);
  const routing = compileRoutingIndex(records);
  const rawInventory = readJson(path.join(libraryRoot, "registry", "master-inventory.v1.json"), "master inventory");
  const atomicInventory = readJson(path.join(libraryRoot, "registry", "atomic-inventory.v1.json"), "atomic inventory");
  const inventory = materializeMasterInventory(rawInventory, atomicInventory);
  inventory.inventory_sha256 = digestWithout(inventory, "inventory_sha256");
  roster.roster_sha256 = digestWithout(roster, "roster_sha256");
  routing.routing_sha256 = digestWithout(routing, "routing_sha256");
  if (writeGenerated) {
    fs.writeFileSync(path.join(libraryRoot, "registry", "master-inventory.materialized.v1.json"), `${JSON.stringify(inventory, null, 2)}\n`);
    fs.writeFileSync(path.join(libraryRoot, "registry", "roster.v1.json"), `${JSON.stringify(roster, null, 2)}\n`);
    fs.writeFileSync(path.join(libraryRoot, "registry", "routing-index.v1.json"), `${JSON.stringify(routing, null, 2)}\n`);
  }
  return {records, roster, routing, inventory};
}

function compileRoster(records) {
  const blocks = records.map(({block, sources, evaluation}) => ({
    block_id: block.block_id,
    candidate_digest: block.block_sha256,
    role_kind: block.role_kind,
    atomic_scope_statement: block.atomic_scope_statement,
    permitted_decisions: block.permitted_decisions,
    forbidden_decisions: block.forbidden_decisions,
    maximum_authority: block.maximum_authority,
    required_upstream_router: block.required_upstream_router,
    sibling_conflicts: block.sibling_conflicts,
    composition_rules: block.composition_rules,
    escalation_target: block.escalation_target,
    split_required_when: block.split_required_when,
    priority: block.priority,
    family: block.family,
    revision: block.revision,
    status: block.lifecycle === "EVALUATED" ? "EVALUATED" : "CANDIDATE",
    primary_sources: sources.sources.map((source) => source.source_id).sort(),
    dependencies: block.dependencies,
    conflicts: block.conflicts,
    gate_path: block.gate_path,
    schema_path: block.schema_path,
    evaluator_receipt: evaluation.receipt_id,
    owner: "specialist-library-controller",
    lifecycle: "NOT_ADMITTED",
    activation: "OFF",
  })).sort((left, right) => left.block_id.localeCompare(right.block_id));
  const aliases = [];
  for (const {block} of records) for (const alias of block.aliases) aliases.push({alias, canonical_block_id: block.block_id, reason: "Declared package alias; canonical block owns the authority."});
  aliases.sort((left, right) => left.alias.localeCompare(right.alias));
  return {schema: "agentos.specialist_roster.v1", version: 1, status: "COMPILED_CANDIDATE", governance_version: "2.1rc", blocks, aliases, routing_index: "routing-index.v1.json", activation: "OFF", roster_sha256: null};
}

function compileRoutingIndex(records) {
  const routes = records.map(({block}) => ({
    route_id: `route.${block.block_id.slice("specialist.".length)}`,
    family: block.family,
    role_kind: block.role_kind,
    signals: block.routing.signals,
    required_context: block.intake.required_context,
    select: [block.block_id],
    deny_if: block.routing.deny_if,
    priority: Number(block.priority.slice(1)),
  })).sort((left, right) => left.route_id.localeCompare(right.route_id));
  return {schema: "agentos.specialist_routing.v1", version: 1, status: "COMPILED_CANDIDATE", routes, default_rule: "SELECT_THE_SMALLEST_SUFFICIENT_SET;_DENY_AMBIGUITY_AND_UNSUPPORTED_APPLICABILITY", routing_sha256: null};
}

export function evaluateGateAnswer(gate, answer, evidence = {}) {
  assert(GATE_OUTCOMES.includes(answer), `gate answer must be one of ${GATE_OUTCOMES.join(", ")}`);
  const required = new Set(gate.evidence);
  const present = new Set(Object.keys(evidence));
  if (answer === "YES") assert([...required].every((key) => present.has(key)), `${gate.gate_id} YES lacks required evidence`);
  if (answer === "UNKNOWN") return {outcome: "UNKNOWN", dependent_action: "CLOSED", unrelated_work: "CONTINUES", missing_evidence: [...required].filter((key) => !present.has(key)).sort()};
  if (answer === "NO") return {outcome: "NO", dependent_action: "DENIED", unrelated_work: "CONTINUES"};
  if (answer === "NOT_APPLICABLE") return {outcome: "NOT_APPLICABLE", dependent_action: "SKIPPED", unrelated_work: "CONTINUES"};
  return {outcome: "YES", dependent_action: "ADVANCES", unrelated_work: "CONTINUES"};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "compile";
  if (command === "compile") {
    const result = compileSpecialistLibrary({repositoryRoot: process.cwd(), writeGenerated: true});
    process.stdout.write(JSON.stringify({status: "PASS", packages: result.records.length, roster_sha256: result.roster.roster_sha256, routing_sha256: result.routing.routing_sha256, inventory_sha256: result.inventory.inventory_sha256}, null, 2) + "\n");
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}
