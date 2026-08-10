#!/usr/bin/env node

/*
 * Controller-owned platform-foundation merge receipt.
 *
 * This is deliberately a receipt compiler, not a merge executor. It
 * reconciles the preserved platform handoffs, inventory parity, source
 * identity, independent audit, and cumulative integration evidence into one
 * deterministic candidate. A dirty source or missing independent evidence
 * remains a hold; it cannot be upgraded by narration.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  assertUniversalDevelopmentMode,
  universalTaskCloseoutPolicy,
} from "./governance-library.mjs";

export const PLATFORM_FOUNDATION_MERGE_SCHEMA = "agentos.platform_foundation_merge_receipt.v1";
export const PLATFORM_FOUNDATION_MERGE_VERSION = 1;
export const PLATFORM_FOUNDATION_MERGE_STATUSES = Object.freeze([
  "PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE",
  "PLATFORM_MERGE_ACCEPTED",
]);
export const PLATFORM_FOUNDATION_FEATURE_ADMISSION = Object.freeze(["HOLD", "READY"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RECEIPT_REF = /^(?:digest|opaque|ref|sha1|sha256):[A-Za-z0-9._:-]+$/u;

const RECEIPT_KEYS = [
  "schema", "version", "status", "activation_status", "source", "foundation_receipt_sha256",
  "inventory_sha256", "lane_handoffs", "inventory", "candidate", "independent_audit", "integration",
  "feature_admission", "universal_closeout", "merge_sha256",
];
const SOURCE_KEYS = ["commit", "tree", "working_tree"];
const LANE_KEYS = ["lane_id", "handoff_path", "handoff_sha256", "lane_file", "lane_sha256"];
const INVENTORY_KEYS = ["feature_count", "feature_report_count", "governance_count", "governance_report_count", "parity", "active_lane_ids"];
const CANDIDATE_KEYS = ["changed_paths", "path_sha256", "question_queue_path", "implementation_started", "candidate_sha256"];
const AUDIT_KEYS = ["status", "receipt_ref", "findings_ref"];
const INTEGRATION_KEYS = ["status", "receipt_ref", "candidate_ref"];
const UNIVERSAL_CLOSEOUT_KEYS = ["mode", "applies_to", "receipt_schema", "receipt_compiler", "receipt_authorities", "sequence", "required_evidence", "controller_must_wait_for_integration", "archive_is_dynamic", "archive_requires_chat_out_of_scope", "archive_requires_active_scope_removal", "archive_requires_stale_worktree_closed", "archive_preconditions"];

function assert(condition, message, code = "PLATFORM_FOUNDATION_MERGE_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(RELATIVE_PATH.test(value), `${label} must be a safe relative path`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireReceiptRef(value, label, {nullable = true} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && RECEIPT_REF.test(value), `${label} must be a typed receipt reference`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const sorted = [...values].sort(compareUtf8);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  return values;
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function validateSource(source, label = "platform source") {
  exactKeys(source, SOURCE_KEYS, label);
  requireGitObject(source.commit, `${label} commit`);
  requireGitObject(source.tree, `${label} tree`);
  assert(["CLEAN", "DIRTY", "UNKNOWN"].includes(source.working_tree), `${label} working-tree status is invalid`);
  return source;
}

function validateLaneHandoffs(lanes, inventory = null) {
  assert(Array.isArray(lanes), "platform merge lane handoffs are required", "PLATFORM_HANDOFF_REQUIRED");
  const activeLaneIds = inventory?.active_lane_ids ?? [];
  assert(Array.isArray(activeLaneIds), "platform merge requires a source-bound active lane set", "PLATFORM_APPLICABILITY_REQUIRED");
  assert(lanes.length === activeLaneIds.length, "platform merge handoff count differs from the active lane set", "PLATFORM_HANDOFF_PARITY_REQUIRED");
  const expected = new Set(activeLaneIds);
  for (const handoff of lanes) assert(expected.has(handoff.lane_id), "platform merge contains a handoff for an inactive or unknown lane", "PLATFORM_HANDOFF_SCOPE_INVALID");
  const ids = new Set();
  let previous = null;
  for (const [index, lane] of lanes.entries()) {
    exactKeys(lane, LANE_KEYS, `platform lane handoff ${index}`);
    requireString(lane.lane_id, `platform lane handoff ${index} ID`);
    assert(IDENTIFIER.test(lane.lane_id), `platform lane handoff ${index} ID is invalid`);
    assert(previous === null || compareUtf8(previous, lane.lane_id) < 0, "platform lane handoffs must be sorted by lane ID");
    previous = lane.lane_id;
    assert(!ids.has(lane.lane_id), `platform lane handoff ${index} is duplicated`);
    ids.add(lane.lane_id);
    requireRelativePath(lane.handoff_path, `platform lane handoff ${index} path`);
    requireSha(lane.handoff_sha256, `platform lane handoff ${index} digest`);
    requireRelativePath(lane.lane_file, `platform lane handoff ${index} lane file`);
    requireSha(lane.lane_sha256, `platform lane handoff ${index} lane digest`);
  }
  return lanes;
}

function validateInventory(inventory) {
  exactKeys(inventory, INVENTORY_KEYS, "platform merge inventory");
  for (const field of ["feature_count", "feature_report_count", "governance_count", "governance_report_count"]) {
    assert(Number.isSafeInteger(inventory[field]) && inventory[field] >= 0, `platform merge ${field} is invalid`);
  }
  assert(Array.isArray(inventory.active_lane_ids)
    && inventory.active_lane_ids.every((laneId) => typeof laneId === "string" && laneId.length > 0)
    && new Set(inventory.active_lane_ids).size === inventory.active_lane_ids.length
    && [...inventory.active_lane_ids].sort(compareUtf8).join("\u0000") === inventory.active_lane_ids.join("\u0000"),
  "platform merge active lane set is invalid",
  "PLATFORM_APPLICABILITY_INVALID");
  exactKeys(inventory.parity, ["features", "governance"], "platform merge inventory parity");
  assert(inventory.parity.features === inventory.feature_count && inventory.feature_count === inventory.feature_report_count, "feature inventory parity is incomplete");
  assert(inventory.parity.governance === inventory.governance_count && inventory.governance_count === inventory.governance_report_count, "governance inventory parity is incomplete");
  return inventory;
}

function validateCandidate(candidate) {
  exactKeys(candidate, CANDIDATE_KEYS, "platform merge candidate");
  sortedUnique(candidate.changed_paths, "platform merge candidate changed paths");
  candidate.changed_paths.forEach((value) => requireRelativePath(value, "platform merge candidate changed path"));
  exactKeys(candidate.path_sha256, candidate.changed_paths, "platform merge candidate path digests");
  candidate.changed_paths.forEach((value) => requireSha(candidate.path_sha256[value], `platform merge candidate ${value} digest`));
  requireRelativePath(candidate.question_queue_path, "platform merge question queue path");
  assert(typeof candidate.implementation_started === "boolean", "platform merge implementation flag is invalid");
  requireSha(candidate.candidate_sha256, "platform merge candidate digest");
  assert(candidate.candidate_sha256 === digestWithout(candidate, "candidate_sha256"), "platform merge candidate digest mismatch");
  return candidate;
}

function validateAudit(audit) {
  exactKeys(audit, AUDIT_KEYS, "platform independent audit");
  assert(["PENDING", "ACCEPTED", "REJECTED"].includes(audit.status), "platform independent audit status is invalid");
  requireReceiptRef(audit.receipt_ref, "platform independent audit receipt");
  requireReceiptRef(audit.findings_ref, "platform independent audit findings");
  if (audit.status === "ACCEPTED") {
    assert(audit.receipt_ref !== null && audit.findings_ref !== null, "accepted platform audit lacks both receipts");
  }
  return audit;
}

function validateIntegration(integration) {
  exactKeys(integration, INTEGRATION_KEYS, "platform integration");
  assert(["PENDING", "ACCEPTED", "REJECTED"].includes(integration.status), "platform integration status is invalid");
  requireReceiptRef(integration.receipt_ref, "platform integration receipt");
  requireReceiptRef(integration.candidate_ref, "platform integration candidate");
  if (integration.status === "ACCEPTED") {
    assert(integration.receipt_ref !== null && integration.candidate_ref !== null, "accepted platform integration lacks both receipts");
  }
  return integration;
}

function validateUniversalCloseout(policy) {
  exactKeys(policy, UNIVERSAL_CLOSEOUT_KEYS, "platform universal closeout");
  assert(policy.mode === "ALL_DEVELOPMENT_MODES", "platform merge must use universal closeout governance");
  assert(JSON.stringify(policy.applies_to) === JSON.stringify(universalTaskCloseoutPolicy().applies_to), "platform universal closeout mode coverage differs from general governance");
  assert(policy.receipt_schema === "agentos.universal_task_closeout_receipts.v1", "platform universal closeout receipt schema is invalid");
  assert(policy.receipt_compiler === "compileUniversalTaskCloseoutReceipts", "platform universal closeout compiler is invalid");
  assert(JSON.stringify(policy.receipt_authorities) === JSON.stringify(universalTaskCloseoutPolicy().receipt_authorities), "platform universal closeout authorities differ from general governance");
  assert(JSON.stringify(policy.sequence) === JSON.stringify(universalTaskCloseoutPolicy().sequence), "platform universal closeout sequence differs from general governance");
  assert(JSON.stringify(policy.required_evidence) === JSON.stringify(universalTaskCloseoutPolicy().required_evidence), "platform universal closeout evidence differs from general governance");
  assert(policy.controller_must_wait_for_integration === true, "platform Controller may not archive before integration");
  assert(policy.archive_is_dynamic === true && policy.archive_requires_chat_out_of_scope === true && policy.archive_requires_active_scope_removal === true && policy.archive_requires_stale_worktree_closed === true, "platform archive preconditions are incomplete");
  assert(JSON.stringify(policy.archive_preconditions) === JSON.stringify(universalTaskCloseoutPolicy().archive_preconditions), "platform archive preconditions differ from general governance");
  return policy;
}

export function validatePlatformFoundationMergeReceipt(receipt) {
  assertUniversalDevelopmentMode("BOOTSTRAP");
  exactKeys(receipt, RECEIPT_KEYS, "platform foundation merge receipt");
  assert(receipt.schema === PLATFORM_FOUNDATION_MERGE_SCHEMA && receipt.version === PLATFORM_FOUNDATION_MERGE_VERSION, "platform foundation merge receipt identity is invalid");
  assert(PLATFORM_FOUNDATION_MERGE_STATUSES.includes(receipt.status), "platform foundation merge status is invalid");
  assert(receipt.activation_status === "PREPARED_NOT_ACTIVATED", "platform foundation merge cannot activate");
  validateSource(receipt.source);
  requireSha(receipt.foundation_receipt_sha256, "foundation receipt digest");
  requireSha(receipt.inventory_sha256, "platform inventory digest");
  validateLaneHandoffs(receipt.lane_handoffs, receipt.inventory);
  validateInventory(receipt.inventory);
  validateCandidate(receipt.candidate);
  validateAudit(receipt.independent_audit);
  validateIntegration(receipt.integration);
  assert(PLATFORM_FOUNDATION_FEATURE_ADMISSION.includes(receipt.feature_admission), "platform feature admission status is invalid");
  validateUniversalCloseout(receipt.universal_closeout);
  const ready = receipt.independent_audit.status === "ACCEPTED"
    && receipt.integration.status === "ACCEPTED"
    && receipt.source.working_tree === "CLEAN";
  assert(receipt.feature_admission === (ready ? "READY" : "HOLD"), "platform feature admission does not match independent readiness");
  assert(receipt.status === (ready ? "PLATFORM_MERGE_ACCEPTED" : "PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE"), "platform merge status does not match evidence");
  requireSha(receipt.merge_sha256, "platform foundation merge receipt digest");
  assert(receipt.merge_sha256 === digestWithout(receipt, "merge_sha256"), "platform foundation merge receipt digest mismatch");
  return receipt;
}

export function compilePlatformFoundationMergeReceipt({
  source,
  foundationReceiptSha256,
  inventorySha256,
  laneHandoffs,
  inventory,
  candidate,
  independentAudit = {status: "PENDING", receipt_ref: null, findings_ref: null},
  integration = {status: "PENDING", receipt_ref: null, candidate_ref: null},
} = {}) {
  const policy = universalTaskCloseoutPolicy();
  requireSha(inventorySha256, "full canonical platform inventory digest");
  const candidateBody = {...candidate, candidate_sha256: null};
  candidateBody.candidate_sha256 = digestWithout(candidateBody, "candidate_sha256");
  const inventoryBody = {
    ...structuredClone(inventory),
    active_lane_ids: [...(inventory?.active_lane_ids ?? laneHandoffs.map((handoff) => handoff.lane_id))].sort(compareUtf8),
  };
  const body = {
    schema: PLATFORM_FOUNDATION_MERGE_SCHEMA,
    version: PLATFORM_FOUNDATION_MERGE_VERSION,
    status: "PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE",
    activation_status: "PREPARED_NOT_ACTIVATED",
    source: structuredClone(source),
    foundation_receipt_sha256: foundationReceiptSha256,
    inventory_sha256: inventorySha256,
    lane_handoffs: [...laneHandoffs].sort((left, right) => compareUtf8(left.lane_id, right.lane_id)),
    inventory: inventoryBody,
    candidate: candidateBody,
    independent_audit: structuredClone(independentAudit),
    integration: structuredClone(integration),
    feature_admission: "HOLD",
    universal_closeout: structuredClone(policy),
    merge_sha256: null,
  };
  const ready = body.independent_audit.status === "ACCEPTED"
    && body.integration.status === "ACCEPTED"
    && body.source.working_tree === "CLEAN";
  body.status = ready ? "PLATFORM_MERGE_ACCEPTED" : "PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE";
  body.feature_admission = ready ? "READY" : "HOLD";
  body.merge_sha256 = digestWithout(body, "merge_sha256");
  return validatePlatformFoundationMergeReceipt(body);
}
