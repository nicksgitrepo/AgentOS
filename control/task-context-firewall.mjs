#!/usr/bin/env node

/*
 * Portable, metadata-only context admission for task-shaped routing.
 *
 * Context content is a transient host concern. This module accepts content
 * only long enough to reject unsafe material and persists labels, digests,
 * provenance, freshness, and token bounds. It never returns raw content.
 */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8, scanPersistedRecord} from "./content-addressing.mjs";

export const TASK_CONTEXT_POLICY_SCHEMA = "agentos.task_context_policy.v1";
export const TASK_CONTEXT_ITEM_SCHEMA = "agentos.task_context_item.v1";
export const TASK_CONTEXT_SELECTION_SCHEMA = "agentos.task_context_selection.v1";

export const CONTEXT_SENSITIVITIES = Object.freeze(["NORMAL", "SENSITIVE", "CRITICAL"]);
export const CONTEXT_RELATIONS = Object.freeze(["TASK_RELEVANT", "GOAL_RELEVANT", "PROJECT_RELEVANT", "UNRELATED"]);
export const CONTEXT_CONTENT_CLASSES = Object.freeze([
  "TASK_INPUT",
  "SOURCE_METADATA",
  "DERIVED_SUMMARY",
  "REDACTED_EVIDENCE",
  "MEMORY_RECORD",
  "RAW_PRIVATE_CONTENT",
  "SECRET_MATERIAL",
]);
export const CONTEXT_AUTHORITIES = Object.freeze([
  "TASK_AUTHORITY",
  "GOAL_AUTHORITY",
  "PROJECT_AUTHORITY",
  "GENERAL_AUTHORITY",
  "MEMORY_AUTHORITY",
]);
export const MEMORY_AUTHORIZATIONS = Object.freeze(["DENY", "ALLOW_BOUND_MEMORY"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SENSITIVITY_RANK = new Map(CONTEXT_SENSITIVITIES.map((value, index) => [value, index]));

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assertCondition(isRecord(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const keys = [...expected].sort(compareUtf8);
  assertCondition(JSON.stringify(actual) === JSON.stringify(keys), `${label} fields mismatch`);
}

function requireString(value, label) {
  assertCondition(typeof value === "string" && value.length > 0 && value === value.trim(), `${label} must be a trimmed nonempty string`);
  assertCondition(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assertCondition(IDENTIFIER.test(value), `${label} is not a safe identifier`);
  return value;
}

function requireSha(value, label) {
  assertCondition(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function requireUtc(value, label) {
  requireString(value, label);
  assertCondition(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return value;
}

function requireEnum(value, values, label) {
  requireString(value, label);
  assertCondition(values.includes(value), `${label} is invalid`);
  return value;
}

function requirePositiveInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
}

function requireNonnegativeInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
  return value;
}

function sortedUnique(values, label) {
  assertCondition(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value) => requireIdentifier(value, `${label} item`));
  const sorted = [...normalized].sort(compareUtf8);
  assertCondition(new Set(sorted).size === sorted.length, `${label} must not contain duplicates`);
  assertCondition(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted and unique`);
  return values;
}

function requireDigestMatch(record, field, label) {
  requireSha(record[field], `${label}.${field}`);
  assertCondition(record[field] === canonicalDigest({...record, [field]: null}), `${label} digest does not match content`);
}

function privacyCheck(record, label) {
  try {
    assertPersistedRecordSafe(record);
  } catch (error) {
    throw new Error(`${label} failed persisted-record privacy check: ${error.message}`);
  }
  return record;
}

function validateBinding(binding, label) {
  requireRecord(binding, label);
  for (const field of ["source_binding_sha256", "project_context_sha256", "task_ref_sha256", "goal_ref_sha256"]) {
    requireSha(binding[field], `${label}.${field}`);
  }
  return binding;
}

function validateContextPolicyShape(policy) {
  exactKeys(policy, [
    "schema", "version", "status", "source_binding_sha256", "project_context_sha256", "task_ref_sha256", "goal_ref_sha256",
    "authority_allowlist", "allowed_content_classes", "max_age_seconds", "max_items", "memory_authorization", "digest",
  ], "task context policy");
  assertCondition(policy.schema === TASK_CONTEXT_POLICY_SCHEMA && policy.version === 1 && policy.status === "VALIDATED", "task context policy identity is invalid");
  validateBinding(policy, "task context policy");
  sortedUnique(policy.authority_allowlist, "task context policy authority_allowlist");
  assertCondition(policy.authority_allowlist.every((value) => CONTEXT_AUTHORITIES.includes(value)), "task context policy authority_allowlist contains an invalid authority");
  sortedUnique(policy.allowed_content_classes, "task context policy allowed_content_classes");
  assertCondition(policy.allowed_content_classes.every((value) => CONTEXT_CONTENT_CLASSES.includes(value)), "task context policy allowed_content_classes contains an invalid content class");
  assertCondition(!policy.allowed_content_classes.includes("RAW_PRIVATE_CONTENT") && !policy.allowed_content_classes.includes("SECRET_MATERIAL"), "task context policy cannot authorize raw private or secret material");
  requirePositiveInteger(policy.max_age_seconds, "task context policy max_age_seconds");
  requirePositiveInteger(policy.max_items, "task context policy max_items");
  requireEnum(policy.memory_authorization, MEMORY_AUTHORIZATIONS, "task context policy memory_authorization");
  requireDigestMatch(policy, "digest", "task context policy");
  return privacyCheck(policy, "task context policy");
}

export function compileTaskContextPolicy({
  sourceBindingSha256,
  projectContextSha256,
  taskRefSha256,
  goalRefSha256,
  authorityAllowlist = ["GENERAL_AUTHORITY", "GOAL_AUTHORITY", "PROJECT_AUTHORITY", "TASK_AUTHORITY"],
  allowedContentClasses = ["DERIVED_SUMMARY", "REDACTED_EVIDENCE", "SOURCE_METADATA", "TASK_INPUT"],
  maxAgeSeconds = 86400,
  maxItems = 32,
  memoryAuthorization = "DENY",
}) {
  const policy = {
    schema: TASK_CONTEXT_POLICY_SCHEMA,
    version: 1,
    status: "VALIDATED",
    source_binding_sha256: requireSha(sourceBindingSha256, "sourceBindingSha256"),
    project_context_sha256: requireSha(projectContextSha256, "projectContextSha256"),
    task_ref_sha256: requireSha(taskRefSha256, "taskRefSha256"),
    goal_ref_sha256: requireSha(goalRefSha256, "goalRefSha256"),
    authority_allowlist: [...authorityAllowlist].sort(compareUtf8),
    allowed_content_classes: [...allowedContentClasses].sort(compareUtf8),
    max_age_seconds: requirePositiveInteger(maxAgeSeconds, "maxAgeSeconds"),
    max_items: requirePositiveInteger(maxItems, "maxItems"),
    memory_authorization: requireEnum(memoryAuthorization, MEMORY_AUTHORIZATIONS, "memoryAuthorization"),
    digest: null,
  };
  policy.digest = canonicalDigest({...policy, digest: null});
  return validateContextPolicyShape(policy);
}

export function validateTaskContextPolicy(policy) {
  return validateContextPolicyShape(policy);
}

function validateContextItemShape(item) {
  exactKeys(item, [
    "schema", "version", "status", "item_ref_sha256", "source_binding_sha256", "project_context_sha256", "task_ref_sha256",
    "goal_ref_sha256", "authority", "content_class", "sensitivity", "captured_at_utc", "expires_at_utc", "token_count",
    "relation", "memory_authorized", "safe_label", "digest",
  ], "task context item");
  assertCondition(item.schema === TASK_CONTEXT_ITEM_SCHEMA && item.version === 1 && item.status === "VALIDATED", "task context item identity is invalid");
  requireSha(item.item_ref_sha256, "task context item item_ref_sha256");
  validateBinding(item, "task context item");
  requireEnum(item.authority, CONTEXT_AUTHORITIES, "task context item authority");
  requireEnum(item.content_class, CONTEXT_CONTENT_CLASSES, "task context item content_class");
  requireEnum(item.sensitivity, CONTEXT_SENSITIVITIES, "task context item sensitivity");
  requireUtc(item.captured_at_utc, "task context item captured_at_utc");
  if (item.expires_at_utc !== null) requireUtc(item.expires_at_utc, "task context item expires_at_utc");
  if (item.expires_at_utc !== null) assertCondition(Date.parse(item.expires_at_utc) > Date.parse(item.captured_at_utc), "task context item expiry must follow capture");
  requirePositiveInteger(item.token_count, "task context item token_count");
  requireEnum(item.relation, CONTEXT_RELATIONS, "task context item relation");
  assertCondition(typeof item.memory_authorized === "boolean", "task context item memory_authorized is invalid");
  requireIdentifier(item.safe_label, "task context item safe_label");
  requireDigestMatch(item, "digest", "task context item");
  return privacyCheck(item, "task context item");
}

export function compileTaskContextItem({
  itemRefSha256,
  sourceBindingSha256,
  projectContextSha256,
  taskRefSha256,
  goalRefSha256,
  authority,
  contentClass,
  sensitivity = "NORMAL",
  capturedAtUtc,
  expiresAtUtc = null,
  tokenCount,
  relation = "TASK_RELEVANT",
  memoryAuthorized = false,
  safeLabel,
  content = null,
}) {
  if (content !== null) {
    const scan = scanPersistedRecord(content);
    if (!scan.safe) throw new Error("UNSAFE_CONTEXT_CONTENT");
  }
  const item = {
    schema: TASK_CONTEXT_ITEM_SCHEMA,
    version: 1,
    status: "VALIDATED",
    item_ref_sha256: requireSha(itemRefSha256, "itemRefSha256"),
    source_binding_sha256: requireSha(sourceBindingSha256, "sourceBindingSha256"),
    project_context_sha256: requireSha(projectContextSha256, "projectContextSha256"),
    task_ref_sha256: requireSha(taskRefSha256, "taskRefSha256"),
    goal_ref_sha256: requireSha(goalRefSha256, "goalRefSha256"),
    authority: requireEnum(authority, CONTEXT_AUTHORITIES, "authority"),
    content_class: requireEnum(contentClass, CONTEXT_CONTENT_CLASSES, "contentClass"),
    sensitivity: requireEnum(sensitivity, CONTEXT_SENSITIVITIES, "sensitivity"),
    captured_at_utc: requireUtc(capturedAtUtc, "capturedAtUtc"),
    expires_at_utc: expiresAtUtc === null ? null : requireUtc(expiresAtUtc, "expiresAtUtc"),
    token_count: requirePositiveInteger(tokenCount, "tokenCount"),
    relation: requireEnum(relation, CONTEXT_RELATIONS, "relation"),
    memory_authorized: Boolean(memoryAuthorized),
    safe_label: requireIdentifier(safeLabel, "safeLabel"),
    digest: null,
  };
  item.digest = canonicalDigest({...item, digest: null});
  return validateContextItemShape(item);
}

export function validateTaskContextItem(item) {
  return validateContextItemShape(item);
}

function itemKey(item) {
  return `${item.item_ref_sha256}\u0000${item.safe_label}`;
}

function compareItems(left, right) {
  return left.token_count - right.token_count || compareUtf8(itemKey(left), itemKey(right));
}

function validateTaskProfileBinding(profile, label) {
  requireRecord(profile, label);
  for (const field of ["digest", "task_ref_sha256", "goal_ref_sha256", "project_context_sha256"]) requireSha(profile[field], `${label}.${field}`);
  requirePositiveInteger(profile.required_context_tokens, `${label}.required_context_tokens`);
  requireEnum(profile.sensitivity, CONTEXT_SENSITIVITIES, `${label}.sensitivity`);
  return profile;
}

function exclusion(item, reason) {
  return {item_ref_sha256: item.item_ref_sha256, safe_label: item.safe_label, reasons: [reason]};
}

function validateSelectedItem(value, index) {
  exactKeys(value, ["item_ref_sha256", "safe_label", "content_class", "authority", "token_count"], `task context selection selected item ${index}`);
  requireSha(value.item_ref_sha256, `task context selection selected item ${index}.item_ref_sha256`);
  requireIdentifier(value.safe_label, `task context selection selected item ${index}.safe_label`);
  requireEnum(value.content_class, CONTEXT_CONTENT_CLASSES, `task context selection selected item ${index}.content_class`);
  requireEnum(value.authority, CONTEXT_AUTHORITIES, `task context selection selected item ${index}.authority`);
  requirePositiveInteger(value.token_count, `task context selection selected item ${index}.token_count`);
}

function validateExcludedItem(value, index) {
  exactKeys(value, ["item_ref_sha256", "safe_label", "reasons"], `task context selection excluded item ${index}`);
  requireSha(value.item_ref_sha256, `task context selection excluded item ${index}.item_ref_sha256`);
  requireIdentifier(value.safe_label, `task context selection excluded item ${index}.safe_label`);
  sortedUnique(value.reasons, `task context selection excluded item ${index}.reasons`);
}

function validateContextSelectionShape(selection) {
  exactKeys(selection, [
    "schema", "version", "status", "task_profile_sha256", "policy_sha256", "source_binding_sha256", "project_context_sha256",
    "task_ref_sha256", "goal_ref_sha256", "required_tokens", "selected_tokens", "unmet_tokens", "selected_items", "excluded_items",
    "reason_code", "digest",
  ], "task context selection");
  assertCondition(selection.schema === TASK_CONTEXT_SELECTION_SCHEMA && selection.version === 1, "task context selection identity is invalid");
  requireEnum(selection.status, ["SELECTED", "UNAVAILABLE"], "task context selection status");
  for (const field of ["task_profile_sha256", "policy_sha256", "source_binding_sha256", "project_context_sha256", "task_ref_sha256", "goal_ref_sha256"]) requireSha(selection[field], `task context selection ${field}`);
  requirePositiveInteger(selection.required_tokens, "task context selection required_tokens");
  requireNonnegativeInteger(selection.selected_tokens, "task context selection selected_tokens");
  requireNonnegativeInteger(selection.unmet_tokens, "task context selection unmet_tokens");
  assertCondition(selection.unmet_tokens === Math.max(0, selection.required_tokens - selection.selected_tokens), "task context selection unmet_tokens is inconsistent");
  assertCondition(Array.isArray(selection.selected_items), "task context selection selected_items must be an array");
  selection.selected_items.forEach(validateSelectedItem);
  assertCondition(selection.selected_items.map((item) => item.item_ref_sha256).every((value, index, all) => index === 0 || compareUtf8(all[index - 1], value) < 0), "task context selection selected_items must be sorted");
  assertCondition(selection.selected_tokens === selection.selected_items.reduce((sum, item) => sum + item.token_count, 0), "task context selection selected_tokens is inconsistent");
  assertCondition(Array.isArray(selection.excluded_items), "task context selection excluded_items must be an array");
  selection.excluded_items.forEach(validateExcludedItem);
  assertCondition(selection.excluded_items.map((item) => item.item_ref_sha256).every((value, index, all) => index === 0 || compareUtf8(all[index - 1], value) < 0), "task context selection excluded_items must be sorted");
  requireEnum(selection.reason_code, ["CONTEXT_SELECTED", "CONTEXT_INSUFFICIENT"], "task context selection reason_code");
  if (selection.status === "SELECTED") {
    assertCondition(selection.reason_code === "CONTEXT_SELECTED" && selection.unmet_tokens === 0 && selection.selected_items.length > 0, "selected context must satisfy the task");
  } else {
    assertCondition(selection.reason_code === "CONTEXT_INSUFFICIENT" && selection.unmet_tokens > 0, "unavailable context must remain insufficient");
  }
  requireDigestMatch(selection, "digest", "task context selection");
  return privacyCheck(selection, "task context selection");
}

export function validateTaskContextSelection(selection) {
  return validateContextSelectionShape(selection);
}

function selectionBindingMatches(profile, policy, selection) {
  return selection.task_profile_sha256 === profile.digest
    && selection.policy_sha256 === policy.digest
    && selection.source_binding_sha256 === policy.source_binding_sha256
    && selection.project_context_sha256 === profile.project_context_sha256
    && selection.task_ref_sha256 === profile.task_ref_sha256
    && selection.goal_ref_sha256 === profile.goal_ref_sha256;
}

function itemIsFresh(item, nowMs, maxAgeMs) {
  const captured = Date.parse(item.captured_at_utc);
  const expires = item.expires_at_utc === null ? Number.POSITIVE_INFINITY : Date.parse(item.expires_at_utc);
  return captured <= nowMs && nowMs - captured <= maxAgeMs && nowMs < expires;
}

export function selectTaskContext({taskProfile, policy, items, nowUtc}) {
  validateTaskProfileBinding(taskProfile, "task profile");
  validateContextPolicyShape(policy);
  requireUtc(nowUtc, "nowUtc");
  assertCondition(Array.isArray(items), "context items must be an array");
  assertCondition(items.length <= policy.max_items * 4, "context item candidate set exceeds bounded retrieval");
  items.forEach(validateContextItemShape);
  assertCondition(new Set(items.map((item) => item.item_ref_sha256)).size === items.length, "context item candidates contain duplicate item references");
  assertCondition(selectionBindingMatches(taskProfile, policy, {
    task_profile_sha256: taskProfile.digest,
    policy_sha256: policy.digest,
    source_binding_sha256: policy.source_binding_sha256,
    project_context_sha256: taskProfile.project_context_sha256,
    task_ref_sha256: taskProfile.task_ref_sha256,
    goal_ref_sha256: taskProfile.goal_ref_sha256,
  }), "context selection binding is invalid");
  const nowMs = Date.parse(nowUtc);
  const maxAgeMs = policy.max_age_seconds * 1000;
  const allowed = [];
  const excluded = [];
  for (const item of items) {
    let reason = null;
    if (item.source_binding_sha256 !== policy.source_binding_sha256) reason = "SOURCE_MISMATCH";
    else if (item.project_context_sha256 !== taskProfile.project_context_sha256) reason = "PROJECT_MISMATCH";
    else if (item.task_ref_sha256 !== taskProfile.task_ref_sha256) reason = "TASK_MISMATCH";
    else if (item.goal_ref_sha256 !== taskProfile.goal_ref_sha256) reason = "GOAL_MISMATCH";
    else if (item.relation === "UNRELATED") reason = "UNRELATED_CONTEXT";
    else if (!policy.authority_allowlist.includes(item.authority)) reason = "AUTHORITY_NOT_ALLOWED";
    else if (item.content_class === "RAW_PRIVATE_CONTENT" || item.content_class === "SECRET_MATERIAL") reason = "UNSAFE_CONTENT";
    else if (!policy.allowed_content_classes.includes(item.content_class)) reason = "CONTENT_CLASS_NOT_ALLOWED";
    else if (item.content_class === "MEMORY_RECORD" && (policy.memory_authorization === "DENY" || item.memory_authorized !== true)) reason = "MEMORY_NOT_AUTHORIZED";
    else if (SENSITIVITY_RANK.get(item.sensitivity) > SENSITIVITY_RANK.get(taskProfile.sensitivity)) reason = "SENSITIVITY_EXCEEDS_TASK";
    else if (!itemIsFresh(item, nowMs, maxAgeMs)) reason = "STALE_CONTEXT";
    if (reason) excluded.push(exclusion(item, reason));
    else allowed.push(item);
  }
  allowed.sort(compareItems);
  const selected = [];
  let selectedTokens = 0;
  for (const item of allowed) {
    if (selected.length >= policy.max_items || selectedTokens >= taskProfile.required_context_tokens) break;
    selected.push({item_ref_sha256: item.item_ref_sha256, safe_label: item.safe_label, content_class: item.content_class, authority: item.authority, token_count: item.token_count});
    selectedTokens += item.token_count;
  }
  selected.sort((left, right) => compareUtf8(left.item_ref_sha256, right.item_ref_sha256));
  excluded.sort((left, right) => compareUtf8(left.item_ref_sha256, right.item_ref_sha256));
  const status = selectedTokens >= taskProfile.required_context_tokens ? "SELECTED" : "UNAVAILABLE";
  const selection = {
    schema: TASK_CONTEXT_SELECTION_SCHEMA,
    version: 1,
    status,
    task_profile_sha256: taskProfile.digest,
    policy_sha256: policy.digest,
    source_binding_sha256: policy.source_binding_sha256,
    project_context_sha256: taskProfile.project_context_sha256,
    task_ref_sha256: taskProfile.task_ref_sha256,
    goal_ref_sha256: taskProfile.goal_ref_sha256,
    required_tokens: taskProfile.required_context_tokens,
    selected_tokens: selectedTokens,
    unmet_tokens: Math.max(0, taskProfile.required_context_tokens - selectedTokens),
    selected_items: selected,
    excluded_items: excluded,
    reason_code: status === "SELECTED" ? "CONTEXT_SELECTED" : "CONTEXT_INSUFFICIENT",
    digest: null,
  };
  selection.digest = canonicalDigest({...selection, digest: null});
  return validateContextSelectionShape(selection);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("task-context-firewall module loaded\n");

