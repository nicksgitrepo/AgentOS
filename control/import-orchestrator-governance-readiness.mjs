#!/usr/bin/env node

/* Project-agnostic governance injection before the Import Orchestrator may plan or touch a campaign. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const IMPORT_ORCHESTRATOR_GOVERNANCE_SCHEMA = "agentos.import_orchestrator_governance.v1";
export const IMPORT_ORCHESTRATOR_GOVERNANCE_READINESS_SCHEMA = "agentos.import_orchestrator_governance_readiness.v1";
export const IMPORT_ORCHESTRATOR_CAMPAIGN_ACCEPTANCE_SCHEMA = "agentos.import_orchestrator_campaign_acceptance.v1";
export const IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION = 1;
export const IMPORT_ORCHESTRATOR_GOVERNANCE_INJECTION_ORDER = 5;

export const IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS = Object.freeze([
  "ORCHESTRATOR.GOVERNANCE.AUTHORITY",
  "ORCHESTRATOR.GOVERNANCE.CONTINUATION",
  "ORCHESTRATOR.GOVERNANCE.CUSTODY",
  "ORCHESTRATOR.GOVERNANCE.EVIDENCE",
  "ORCHESTRATOR.GOVERNANCE.HANDOFFS",
  "ORCHESTRATOR.GOVERNANCE.HOSTILE_TESTS",
  "ORCHESTRATOR.GOVERNANCE.IDENTITY",
  "ORCHESTRATOR.GOVERNANCE.NO_SIDE_EFFECTS",
  "ORCHESTRATOR.GOVERNANCE.SCOPE",
  "ORCHESTRATOR.GOVERNANCE.STOP_CONDITIONS",
].sort(compareUtf8));

export const IMPORT_ORCHESTRATOR_FORBIDDEN_CAPABILITIES = Object.freeze([
  "ACTIVATE_UNCLEARED_WORK",
  "ADMIT_INCOMPLETE_ROLE",
  "BYPASS_PROTECTED_CLEARANCE",
  "CHANGE_PROJECT_GOVERNANCE",
  "DEPLOY_OR_PUBLISH",
  "DESTRUCTIVE_USER_WORK",
  "MUTATE_PRODUCT",
  "SPEND_MATERIAL_COST",
  "USE_CREDENTIALS_OR_PROVIDERS",
].sort(compareUtf8));

export const IMPORT_ORCHESTRATOR_GOVERNANCE_READINESS_STATUSES = Object.freeze(["READY_TO_PLAN", "BLOCKED"]);
export const IMPORT_ORCHESTRATOR_GOVERNANCE_FAILURE_CODES = Object.freeze(["GOVERNANCE_MISSING", "GOVERNANCE_INVALID"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const GATE_ID = /^ORCHESTRATOR\.GOVERNANCE\.[A-Z0-9_]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PLACEHOLDER = /(?:^|[^A-Z])(TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)(?:$|[^A-Z])/iu;
const GOVERNANCE_KEYS = Object.freeze(["schema", "version", "role", "scope", "source_commit", "source_tree", "required_gate_ids", "gates", "forbidden_capabilities", "governance_sha256"]);
const GATE_KEYS = Object.freeze(["gate_id", "status", "rule", "evidence_sha256", "hostile_fixture_ids", "authority", "stop_condition"]);
const READINESS_KEYS = Object.freeze(["schema", "version", "orchestrator_id", "injection_order", "observed_at_utc", "governance_sha256", "required_gate_ids", "verified_gate_ids", "status", "acceptance_state", "failure_code", "readiness_sha256"]);
const ACCEPTANCE_KEYS = Object.freeze(["schema", "version", "orchestrator_id", "readiness_sha256", "campaign_request_sha256", "status", "accepted_at_utc", "acceptance_sha256"]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireToken(value, label) { assert(typeof value === "string" && TOKEN.test(value) && !PLACEHOLDER.test(value), `${label} is invalid`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function sortedUnique(values, label, {pattern = null, allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && (pattern === null || pattern.test(value))), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length, `${label} must be unique`);
  assert(JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted`);
  return values;
}
function digestWithout(value, field) { return canonicalDigest({...structuredClone(value), [field]: null}); }
function nonPlaceholderText(value, label, minimumLength = 24) {
  assert(typeof value === "string" && value.trim().length >= minimumLength, `${label} is incomplete`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value) && !PLACEHOLDER.test(value), `${label} is a placeholder or contains control characters`);
}

export function validateImportOrchestratorGovernance(governance) {
  exactKeys(governance, GOVERNANCE_KEYS, "Import Orchestrator governance");
  assert(governance.schema === IMPORT_ORCHESTRATOR_GOVERNANCE_SCHEMA && governance.version === IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION, "Import Orchestrator governance identity is invalid");
  assert(governance.role === "AGENTOS_IMPORT_ORCHESTRATOR", "Import Orchestrator governance role is invalid");
  assert(governance.scope === "PROJECT_AGNOSTIC_IMPORT_CONTROL_PLANE", "Import Orchestrator governance scope is invalid");
  requireToken(governance.source_commit, "Import Orchestrator governance source commit");
  requireToken(governance.source_tree, "Import Orchestrator governance source tree");
  sortedUnique(governance.required_gate_ids, "Import Orchestrator governance required gates", {pattern: GATE_ID});
  assert(JSON.stringify(governance.required_gate_ids) === JSON.stringify(IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS), "Import Orchestrator governance required gates are incomplete");
  sortedUnique(governance.forbidden_capabilities, "Import Orchestrator governance forbidden capabilities");
  assert(JSON.stringify(governance.forbidden_capabilities) === JSON.stringify(IMPORT_ORCHESTRATOR_FORBIDDEN_CAPABILITIES), "Import Orchestrator governance forbidden capabilities are incomplete");
  assert(Array.isArray(governance.gates) && governance.gates.length === IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS.length, "Import Orchestrator governance gates are incomplete");
  const seen = new Set();
  for (const gate of governance.gates) {
    exactKeys(gate, GATE_KEYS, "Import Orchestrator governance gate");
    assert(GATE_ID.test(gate.gate_id) && IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS.includes(gate.gate_id), "Import Orchestrator governance gate id is invalid");
    assert(!seen.has(gate.gate_id), "Import Orchestrator governance gate is duplicated");
    seen.add(gate.gate_id);
    assert(gate.status === "PASS", `Import Orchestrator governance gate ${gate.gate_id} is not passing`);
    nonPlaceholderText(gate.rule, `Import Orchestrator governance gate ${gate.gate_id} rule`);
    requireSha(gate.evidence_sha256, `Import Orchestrator governance gate ${gate.gate_id} evidence`);
    sortedUnique(gate.hostile_fixture_ids, `Import Orchestrator governance gate ${gate.gate_id} hostile fixtures`, {pattern: TOKEN});
    assert(gate.authority === "PROJECT_AGNOSTIC_ORCHESTRATOR", `Import Orchestrator governance gate ${gate.gate_id} authority is invalid`);
    nonPlaceholderText(gate.stop_condition, `Import Orchestrator governance gate ${gate.gate_id} stop condition`);
  }
  assert(JSON.stringify([...seen].sort(compareUtf8)) === JSON.stringify(IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS), "Import Orchestrator governance gate coverage is incomplete");
  assert(JSON.stringify(governance.gates.map(({gate_id}) => gate_id)) === JSON.stringify(IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS), "Import Orchestrator governance gates must be sorted");
  requireSha(governance.governance_sha256, "Import Orchestrator governance digest");
  assert(governance.governance_sha256 === digestWithout(governance, "governance_sha256"), "Import Orchestrator governance digest mismatch");
  return governance;
}

export function compileImportOrchestratorGovernance({sourceCommit, sourceTree, gates, forbiddenCapabilities = IMPORT_ORCHESTRATOR_FORBIDDEN_CAPABILITIES} = {}) {
  assert(Array.isArray(gates), "Import Orchestrator governance gates input is required");
  assert(Array.isArray(forbiddenCapabilities), "Import Orchestrator forbidden capabilities input is required");
  const governance = {
    schema: IMPORT_ORCHESTRATOR_GOVERNANCE_SCHEMA, version: IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION,
    role: "AGENTOS_IMPORT_ORCHESTRATOR", scope: "PROJECT_AGNOSTIC_IMPORT_CONTROL_PLANE", source_commit: sourceCommit, source_tree: sourceTree,
    required_gate_ids: [...IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS], gates: [...gates].sort((left, right) => compareUtf8(left.gate_id, right.gate_id)),
    forbidden_capabilities: [...forbiddenCapabilities].sort(compareUtf8), governance_sha256: null,
  };
  governance.governance_sha256 = digestWithout(governance, "governance_sha256");
  return validateImportOrchestratorGovernance(governance);
}

function blockedReadiness({orchestratorId, observedAtUtc, failureCode}) {
  const readiness = {
    schema: IMPORT_ORCHESTRATOR_GOVERNANCE_READINESS_SCHEMA, version: IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION,
    orchestrator_id: orchestratorId, injection_order: IMPORT_ORCHESTRATOR_GOVERNANCE_INJECTION_ORDER, observed_at_utc: observedAtUtc,
    governance_sha256: null, required_gate_ids: [...IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS], verified_gate_ids: [], status: "BLOCKED",
    acceptance_state: "CAMPAIGN_PLANNING_REJECTED", failure_code: failureCode, readiness_sha256: null,
  };
  readiness.readiness_sha256 = digestWithout(readiness, "readiness_sha256");
  return validateImportOrchestratorGovernanceReadiness(readiness);
}

export function validateImportOrchestratorGovernanceReadiness(readiness) {
  exactKeys(readiness, READINESS_KEYS, "Import Orchestrator governance readiness");
  assert(readiness.schema === IMPORT_ORCHESTRATOR_GOVERNANCE_READINESS_SCHEMA && readiness.version === IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION, "Import Orchestrator governance readiness identity is invalid");
  requireToken(readiness.orchestrator_id, "Import Orchestrator governance readiness orchestrator");
  assert(readiness.injection_order === IMPORT_ORCHESTRATOR_GOVERNANCE_INJECTION_ORDER, "Import Orchestrator governance injection order is invalid");
  requireUtc(readiness.observed_at_utc, "Import Orchestrator governance readiness observation");
  sortedUnique(readiness.required_gate_ids, "Import Orchestrator readiness required gates", {pattern: GATE_ID});
  assert(JSON.stringify(readiness.required_gate_ids) === JSON.stringify(IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS), "Import Orchestrator readiness required gates are incomplete");
  sortedUnique(readiness.verified_gate_ids, "Import Orchestrator readiness verified gates", {pattern: GATE_ID, allowEmpty: true});
  if (readiness.status === "READY_TO_PLAN") {
    requireSha(readiness.governance_sha256, "Import Orchestrator readiness governance digest");
    assert(JSON.stringify(readiness.verified_gate_ids) === JSON.stringify(IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS), "Import Orchestrator readiness does not verify every gate");
    assert(readiness.acceptance_state === "CAMPAIGN_PLANNING_ALLOWED" && readiness.failure_code === null, "Import Orchestrator ready acceptance state is invalid");
  } else {
    assert(readiness.status === "BLOCKED", "Import Orchestrator readiness status is invalid");
    assert(readiness.governance_sha256 === null && readiness.verified_gate_ids.length === 0, "Blocked Import Orchestrator readiness must not bind governance");
    assert(readiness.acceptance_state === "CAMPAIGN_PLANNING_REJECTED" && IMPORT_ORCHESTRATOR_GOVERNANCE_FAILURE_CODES.includes(readiness.failure_code), "Blocked Import Orchestrator readiness is invalid");
  }
  requireSha(readiness.readiness_sha256, "Import Orchestrator readiness digest");
  assert(readiness.readiness_sha256 === digestWithout(readiness, "readiness_sha256"), "Import Orchestrator readiness digest mismatch");
  return readiness;
}

export function compileImportOrchestratorGovernanceReadiness({orchestratorId, governance, observedAtUtc} = {}) {
  try { validateImportOrchestratorGovernance(governance); }
  catch { return blockedReadiness({orchestratorId, observedAtUtc, failureCode: governance === null || governance === undefined ? "GOVERNANCE_MISSING" : "GOVERNANCE_INVALID"}); }
  const readiness = {
    schema: IMPORT_ORCHESTRATOR_GOVERNANCE_READINESS_SCHEMA, version: IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION,
    orchestrator_id: orchestratorId, injection_order: IMPORT_ORCHESTRATOR_GOVERNANCE_INJECTION_ORDER, observed_at_utc: observedAtUtc,
    governance_sha256: governance.governance_sha256, required_gate_ids: [...IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS], verified_gate_ids: [...IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS],
    status: "READY_TO_PLAN", acceptance_state: "CAMPAIGN_PLANNING_ALLOWED", failure_code: null, readiness_sha256: null,
  };
  readiness.readiness_sha256 = digestWithout(readiness, "readiness_sha256");
  return validateImportOrchestratorGovernanceReadiness(readiness);
}

export function compileImportOrchestratorCampaignAcceptance({readiness, campaignRequestSha256, acceptedAtUtc} = {}) {
  validateImportOrchestratorGovernanceReadiness(readiness);
  assert(readiness.status === "READY_TO_PLAN", "Import Orchestrator campaign planning is rejected until governance readiness passes");
  requireSha(campaignRequestSha256, "Import Orchestrator campaign request digest");
  requireUtc(acceptedAtUtc, "Import Orchestrator campaign acceptance time");
  const acceptance = {
    schema: IMPORT_ORCHESTRATOR_CAMPAIGN_ACCEPTANCE_SCHEMA, version: IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION, orchestrator_id: readiness.orchestrator_id,
    readiness_sha256: readiness.readiness_sha256, campaign_request_sha256: campaignRequestSha256, status: "CAMPAIGN_PLANNING_ACCEPTED", accepted_at_utc: acceptedAtUtc, acceptance_sha256: null,
  };
  acceptance.acceptance_sha256 = digestWithout(acceptance, "acceptance_sha256");
  return validateImportOrchestratorCampaignAcceptance(acceptance, {readiness});
}

export function validateImportOrchestratorCampaignAcceptance(acceptance, {readiness = null} = {}) {
  exactKeys(acceptance, ACCEPTANCE_KEYS, "Import Orchestrator campaign acceptance");
  assert(acceptance.schema === IMPORT_ORCHESTRATOR_CAMPAIGN_ACCEPTANCE_SCHEMA && acceptance.version === IMPORT_ORCHESTRATOR_GOVERNANCE_VERSION, "Import Orchestrator campaign acceptance identity is invalid");
  requireToken(acceptance.orchestrator_id, "Import Orchestrator campaign acceptance orchestrator");
  requireSha(acceptance.readiness_sha256, "Import Orchestrator campaign acceptance readiness");
  requireSha(acceptance.campaign_request_sha256, "Import Orchestrator campaign request");
  assert(acceptance.status === "CAMPAIGN_PLANNING_ACCEPTED", "Import Orchestrator campaign acceptance status is invalid");
  requireUtc(acceptance.accepted_at_utc, "Import Orchestrator campaign acceptance time");
  if (readiness !== null) {
    validateImportOrchestratorGovernanceReadiness(readiness);
    assert(readiness.status === "READY_TO_PLAN" && readiness.orchestrator_id === acceptance.orchestrator_id && readiness.readiness_sha256 === acceptance.readiness_sha256, "Import Orchestrator campaign acceptance is stale");
  }
  requireSha(acceptance.acceptance_sha256, "Import Orchestrator campaign acceptance digest");
  assert(acceptance.acceptance_sha256 === digestWithout(acceptance, "acceptance_sha256"), "Import Orchestrator campaign acceptance digest mismatch");
  return acceptance;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Import Orchestrator governance readiness contract loaded\n");
