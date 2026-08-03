#!/usr/bin/env node

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const ROOTS = Object.freeze(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
const ROOT_PREFIX = Object.freeze({FUNCTION_REQUIREMENTS: "FR-", DESIGN_BIBLE: "DB-", SECURITY: "SEC-"});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
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

function sorted(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value) => requireString(value, `${label} item`));
  const normalized = [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be UTF-8 sorted`);
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function acceptanceContractDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function body(contract) {
  const result = structuredClone(contract);
  result.contract_sha256 = null;
  return result;
}

export function validateCampaignAcceptanceContract(contract) {
  const keys = [
    "schema", "campaign_id", "campaign_version", "logical_lineage_id", "policy_epoch", "policy_state_sha256", "question_tree_sha256",
    "ordered_roots", "required_question_ids_by_root", "required_question_ids", "operational_requirements", "evidence_requirements",
    "non_goals", "hard_rules", "stop_condition", "owner_intent_sha256", "contract_sha256",
  ];
  requireRecord(contract, "campaign acceptance contract");
  assert(JSON.stringify(Object.keys(contract).sort()) === JSON.stringify(keys.sort()), "campaign acceptance contract fields mismatch");
  assert(contract.schema === "governance.campaign_acceptance_contract.v1", "campaign acceptance contract schema mismatch");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id", "stop_condition"]) requireString(contract[field], `campaign acceptance ${field}`);
  assert(Number.isSafeInteger(contract.policy_epoch) && contract.policy_epoch >= 1, "campaign acceptance policy epoch invalid");
  for (const field of ["policy_state_sha256", "question_tree_sha256", "owner_intent_sha256", "contract_sha256"]) requireSha(contract[field], `campaign acceptance ${field}`);
  assert(JSON.stringify(contract.ordered_roots) === JSON.stringify(ROOTS), "campaign acceptance roots are not exactly ordered");
  assert(isRecord(contract.required_question_ids_by_root), "campaign acceptance question IDs by root are required");
  assert(JSON.stringify(Object.keys(contract.required_question_ids_by_root).sort()) === JSON.stringify([...ROOTS].sort()), "campaign acceptance question root map is incomplete");
  const byRoot = [];
  for (const root of ROOTS) {
    const ids = contract.required_question_ids_by_root[root];
    sorted(ids, `${root} acceptance question IDs`);
    assert(ids.every((questionId) => questionId.startsWith(ROOT_PREFIX[root])), `${root} contains a question from another acceptance root`);
    byRoot.push(...ids);
  }
  const derivedQuestionIds = [...byRoot].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  sorted(contract.required_question_ids, "campaign acceptance question IDs");
  assert(JSON.stringify(contract.required_question_ids) === JSON.stringify(derivedQuestionIds), "campaign acceptance question inventory is not derived from its roots");
  sorted(contract.operational_requirements, "campaign acceptance operational requirements");
  sorted(contract.evidence_requirements, "campaign acceptance evidence requirements");
  sorted(contract.non_goals, "campaign acceptance non-goals", {allowEmpty: true});
  sorted(contract.hard_rules, "campaign acceptance hard rules");
  assert(contract.contract_sha256 === acceptanceContractDigest(body(contract)), "campaign acceptance contract digest mismatch");
  return contract;
}

export function compileCampaignAcceptanceContract({
  campaignId,
  campaignVersion,
  logicalLineageId,
  policyEpoch,
  policyStateSha256,
  questionTreeSha256,
  requiredQuestionIds,
  requiredQuestionIdsByRoot,
  operationalRequirements,
  evidenceRequirements,
  nonGoals = [],
  hardRules,
  stopCondition,
  ownerIntentSha256,
}) {
  const contract = {
    schema: "governance.campaign_acceptance_contract.v1",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    logical_lineage_id: logicalLineageId,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    question_tree_sha256: questionTreeSha256,
    ordered_roots: [...ROOTS],
    required_question_ids_by_root: Object.fromEntries(ROOTS.map((root) => [root, [...(requiredQuestionIdsByRoot?.[root] ?? [])].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))])),
    required_question_ids: [...requiredQuestionIds].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    operational_requirements: [...operationalRequirements].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    evidence_requirements: [...evidenceRequirements].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    non_goals: [...nonGoals].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    hard_rules: [...hardRules].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))),
    stop_condition: stopCondition,
    owner_intent_sha256: ownerIntentSha256,
    contract_sha256: null,
  };
  contract.contract_sha256 = acceptanceContractDigest(body(contract));
  return validateCampaignAcceptanceContract(contract);
}

export function validateAcceptanceBinding({candidate, contract}) {
  validateCampaignAcceptanceContract(contract);
  assert(candidate.campaign_id === contract.campaign_id && candidate.campaign_version === contract.campaign_version && candidate.logical_lineage_id === contract.logical_lineage_id, "first-pass candidate acceptance contract lineage mismatch");
  assert(candidate.policy_epoch === contract.policy_epoch && candidate.policy_snapshot_sha256 === contract.policy_state_sha256, "first-pass candidate policy snapshot mismatch");
  assert(candidate.acceptance_contract_sha256 === contract.contract_sha256, "first-pass candidate acceptance contract digest mismatch");
  return true;
}
