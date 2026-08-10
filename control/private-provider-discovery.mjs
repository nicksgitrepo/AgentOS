#!/usr/bin/env node

/* Provider-neutral, host-readback-bound capability records. */

import {
  assertPortableRecord,
  canonicalDigest,
  compareUtf8,
  digestWithout,
  exactKeys,
  invariant,
  requireDigest,
  requireEnvironmentReference,
  requireSafeIdentifier,
  requireUtc,
} from "./private-control-common.mjs";
import {OFFLINE_MODES, validateOfflinePolicy} from "./private-offline-mode.mjs";

export const PROVIDER_DISCOVERY_SCHEMA = "agentos.provider_discovery.v1";
export const PROVIDER_DISCOVERY_MODES = Object.freeze(["LOCAL_CATALOG_ONLY", "HOST_CATALOG_READ_ONLY", "HOST_ATTESTED_CAPABILITIES"]);
export const PROVIDER_DISCOVERY_STATUSES = Object.freeze([...PROVIDER_DISCOVERY_MODES, "EMPTY"]);
export const PROVIDER_CAPABILITIES = Object.freeze([
  "LOCAL_FILESYSTEM_READ",
  "LOCAL_FILESYSTEM_WRITE",
  "LOCAL_GIT_READ",
  "LOCAL_GIT_WRITE",
  "NETWORK_READ",
  "NETWORK_WRITE",
  "AUTHENTICATION",
  "PUBLISH",
  "MERGE",
  "DEPLOY",
  "SPEND",
]);
export const HOST_CAPABILITY_CATALOG_SCHEMA = "agentos.host_capability_catalog.v1";

const ENTRY_FIELDS = [
  "adapter_ref", "protocol", "capabilities", "network_required", "authentication_required", "external_write_required", "trust_status",
];
const FIELDS = [
  "schema", "version", "status", "offline_mode", "provider_discovery_mode", "workspace_binding_digest", "host_capability_catalog_digest", "catalog_digest",
  "entries", "operations", "digest",
];
const HOST_FIELDS = [
  "schema", "version", "status", "attestation_mode", "attachment_ref_sha256", "observed_at_utc", "models", "digest",
];
const HOST_MODEL_FIELDS = [
  "model", "reasoning_effort", "capabilities", "context_tokens", "tools", "verifier_strength", "permissions", "expected_cost", "estimated_wall_seconds", "estimated_success_probability", "cost_unit", "spawnable",
];
const HOST_REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "max"]);
const HOST_VERIFIER_STRENGTHS = Object.freeze(["NONE", "DETERMINISTIC", "INDEPENDENT_AUDITOR", "HIGH_ASSURANCE"]);
const HOST_PERMISSIONS = Object.freeze(["READ_SOURCE", "READ_ASSIGNED_WORKTREE", "WRITE_ASSIGNED_WORKTREE", "HOST_LIFECYCLE", "EMIT_EVIDENCE", "INDEPENDENT_REVIEW", "PROTECTED_EXTERNAL_ACTION"]);

function sortedUnique(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  invariant(values.every((value) => typeof value === "string"), `${label} must contain unique strings`);
  const result = [...new Set(values)].sort();
  invariant(result.length === values.length, `${label} must contain unique strings`);
  return result;
}

function validateEntry(entry, label, {normalize = false} = {}) {
  exactKeys(entry, ENTRY_FIELDS, label);
  requireEnvironmentReference(entry.adapter_ref, `${label}.adapter_ref`);
  requireSafeIdentifier(entry.protocol, `${label}.protocol`);
  const capabilities = sortedUnique(entry.capabilities, `${label}.capabilities`);
  if (normalize) entry.capabilities = capabilities;
  else invariant(JSON.stringify(entry.capabilities) === JSON.stringify(capabilities), `${label}.capabilities must be sorted`);
  capabilities.forEach((capability) => invariant(PROVIDER_CAPABILITIES.includes(capability), `${label} contains an unknown capability`));
  invariant(typeof entry.network_required === "boolean" && typeof entry.authentication_required === "boolean" && typeof entry.external_write_required === "boolean", `${label} capability flags are invalid`);
  invariant(["UNVERIFIED", "TRUSTED_HOST_CATALOG", "CAPABILITY_ATTESTED", "UNAVAILABLE"].includes(entry.trust_status), `${label}.trust_status is invalid`);
  const networkClaimed = capabilities.includes("NETWORK_READ") || capabilities.includes("NETWORK_WRITE");
  const authenticationClaimed = capabilities.includes("AUTHENTICATION");
  const externalWriteClaimed = capabilities.some((capability) => ["NETWORK_WRITE", "PUBLISH", "MERGE", "DEPLOY", "SPEND"].includes(capability));
  invariant(entry.network_required === networkClaimed, `${label} network requirement does not match capabilities`);
  invariant(entry.authentication_required === authenticationClaimed, `${label} authentication requirement does not match capabilities`);
  invariant(entry.external_write_required === externalWriteClaimed, `${label} external-write requirement does not match capabilities`);
  if (entry.trust_status === "UNAVAILABLE") {
    invariant(capabilities.length === 0 && entry.network_required === false && entry.authentication_required === false && entry.external_write_required === false,
      `${label} unavailable entries cannot carry usable capability claims`);
  }
  return entry;
}

function compareEntries(left, right) {
  const adapter = compareUtf8(left.adapter_ref, right.adapter_ref);
  return adapter !== 0 ? adapter : compareUtf8(left.protocol, right.protocol);
}

function validateEntryOrder(entries, label) {
  const sorted = [...entries].sort(compareEntries);
  invariant(JSON.stringify(entries.map(({adapter_ref, protocol}) => ({adapter_ref, protocol})))
    === JSON.stringify(sorted.map(({adapter_ref, protocol}) => ({adapter_ref, protocol}))), `${label} must be deterministically sorted`);
  invariant(new Set(entries.map((entry) => entry.adapter_ref)).size === entries.length, `${label} contains duplicate adapter references`);
}

function validateHostModel(model, label, {normalize = false} = {}) {
  exactKeys(model, HOST_MODEL_FIELDS, label);
  requireSafeIdentifier(model.model, `${label}.model`);
  invariant(HOST_REASONING_EFFORTS.includes(model.reasoning_effort), `${label}.reasoning_effort is invalid`);
  const capabilities = sortedUnique(model.capabilities, `${label}.capabilities`);
  const tools = sortedUnique(model.tools, `${label}.tools`);
  const permissions = sortedUnique(model.permissions, `${label}.permissions`);
  if (normalize) {
    model.capabilities = capabilities;
    model.tools = tools;
    model.permissions = permissions;
  } else {
    invariant(JSON.stringify(model.capabilities) === JSON.stringify(capabilities), `${label}.capabilities must be sorted`);
    invariant(JSON.stringify(model.tools) === JSON.stringify(tools), `${label}.tools must be sorted`);
    invariant(JSON.stringify(model.permissions) === JSON.stringify(permissions), `${label}.permissions must be sorted`);
  }
  capabilities.forEach((value) => requireSafeIdentifier(value, `${label}.capabilities entry`));
  tools.forEach((value) => requireSafeIdentifier(value, `${label}.tools entry`));
  permissions.forEach((value) => invariant(HOST_PERMISSIONS.includes(value), `${label}.permissions contains an unknown permission`));
  invariant(Number.isInteger(model.context_tokens) && model.context_tokens > 0, `${label}.context_tokens is invalid`);
  invariant(HOST_VERIFIER_STRENGTHS.includes(model.verifier_strength), `${label}.verifier_strength is invalid`);
  invariant(typeof model.expected_cost === "number" && Number.isFinite(model.expected_cost) && model.expected_cost >= 0, `${label}.expected_cost is invalid`);
  invariant(typeof model.estimated_wall_seconds === "number" && Number.isFinite(model.estimated_wall_seconds) && model.estimated_wall_seconds > 0, `${label}.estimated_wall_seconds is invalid`);
  invariant(typeof model.estimated_success_probability === "number" && Number.isFinite(model.estimated_success_probability) && model.estimated_success_probability > 0 && model.estimated_success_probability <= 1, `${label}.estimated_success_probability is invalid`);
  requireSafeIdentifier(model.cost_unit, `${label}.cost_unit`);
  invariant(typeof model.spawnable === "boolean", `${label}.spawnable is invalid`);
  return model;
}

function compareHostModels(left, right) {
  const model = compareUtf8(left.model, right.model);
  return model !== 0 ? model : compareUtf8(left.reasoning_effort, right.reasoning_effort);
}

function validateHostModelOrder(models, label) {
  const sorted = [...models].sort(compareHostModels);
  invariant(JSON.stringify(models.map(({model, reasoning_effort}) => ({model, reasoning_effort})))
    === JSON.stringify(sorted.map(({model, reasoning_effort}) => ({model, reasoning_effort}))), `${label} must be deterministically sorted`);
  invariant(new Set(models.map(({model, reasoning_effort}) => `${model}\u0000${reasoning_effort}`)).size === models.length, `${label} contains duplicate model identities`);
}

export function compileHostCapabilityCatalog({attachmentRefSha256, observedAtUtc, models = []} = {}) {
  requireDigest(attachmentRefSha256, "host capability attachment digest");
  requireUtc(observedAtUtc, "host capability observation time");
  invariant(Array.isArray(models) && models.length > 0, "host capability catalog requires at least one model");
  const normalizedModels = models.map((model, index) => validateHostModel({...model, capabilities: [...model.capabilities], tools: [...model.tools], permissions: [...model.permissions]}, `host capability model ${index}`, {normalize: true})).sort(compareHostModels);
  validateHostModelOrder(normalizedModels, "host capability models");
  const body = {
    schema: HOST_CAPABILITY_CATALOG_SCHEMA,
    version: 1,
    status: "HOST_ATTESTED",
    attestation_mode: "HOST_READBACK",
    attachment_ref_sha256: attachmentRefSha256,
    observed_at_utc: observedAtUtc,
    models: normalizedModels,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateHostCapabilityCatalog(body);
}

export function validateHostCapabilityCatalog(record) {
  exactKeys(record, HOST_FIELDS, "host capability catalog");
  invariant(record.schema === HOST_CAPABILITY_CATALOG_SCHEMA && record.version === 1, "host capability catalog identity is invalid");
  invariant(record.status === "HOST_ATTESTED" && record.attestation_mode === "HOST_READBACK", "host capability catalog attestation is invalid");
  requireDigest(record.attachment_ref_sha256, "host capability attachment digest");
  requireUtc(record.observed_at_utc, "host capability observation time");
  invariant(Array.isArray(record.models) && record.models.length > 0, "host capability catalog requires at least one model");
  record.models.forEach((model, index) => validateHostModel(model, `host capability model ${index}`));
  validateHostModelOrder(record.models, "host capability models");
  requireDigest(record.digest, "host capability catalog digest");
  invariant(record.digest === digestWithout(record, "digest"), "host capability catalog digest does not match content");
  assertPortableRecord(record, "host capability catalog");
  return record;
}

function expectedDiscoveryMode(offlineMode) {
  return offlineMode === "OFFLINE_ENFORCED"
    ? "LOCAL_CATALOG_ONLY"
    : offlineMode === "ONLINE_READ_ONLY"
      ? "HOST_CATALOG_READ_ONLY"
      : "HOST_ATTESTED_CAPABILITIES";
}

function validateTrustForMode(entries, mode) {
  if (mode === "LOCAL_CATALOG_ONLY" || mode === "HOST_CATALOG_READ_ONLY") {
    invariant(entries.every((entry) => entry.trust_status !== "CAPABILITY_ATTESTED"), `${mode} entries cannot claim capability attestation`);
  }
  if (mode === "HOST_ATTESTED_CAPABILITIES") {
    invariant(entries.every((entry) => entry.trust_status === "CAPABILITY_ATTESTED" || entry.trust_status === "UNAVAILABLE"), "host-attested entries require capability attestation or unavailable status");
  }
}

function requireHostEvidence(mode, hostCapabilityCatalog) {
  if (mode === "LOCAL_CATALOG_ONLY") {
    invariant(hostCapabilityCatalog === null, "offline provider discovery cannot carry host capability evidence");
    return null;
  }
  invariant(hostCapabilityCatalog !== null, "host capability readback is unavailable", "HOST_CAPABILITY_UNAVAILABLE");
  validateHostCapabilityCatalog(hostCapabilityCatalog);
  return hostCapabilityCatalog.digest;
}

export function compileProviderNeutralDiscovery({offlinePolicy, workspaceBindingDigest, catalog = [], hostCapabilityCatalog = null, catalogDigest = null} = {}) {
  validateOfflinePolicy(offlinePolicy);
  requireDigest(workspaceBindingDigest, "provider discovery workspace binding digest");
  invariant(workspaceBindingDigest === offlinePolicy.workspace_binding_digest, "provider discovery is bound to a different workspace");
  invariant(Array.isArray(catalog), "provider catalog must be an array");
  const mode = expectedDiscoveryMode(offlinePolicy.mode);
  const hostCapabilityCatalogDigest = requireHostEvidence(mode, hostCapabilityCatalog);
  const entries = catalog
    .map((entry, index) => {
      invariant(Array.isArray(entry.capabilities), `provider catalog entry ${index}.capabilities must be an array`);
      return validateEntry({...entry, capabilities: [...entry.capabilities]}, `provider catalog entry ${index}`, {normalize: true});
    })
    .sort(compareEntries);
  validateEntryOrder(entries, "provider catalog");
  validateTrustForMode(entries, mode);
  const computedCatalogDigest = canonicalDigest(entries);
  if (catalogDigest !== null) {
    requireDigest(catalogDigest, "provider catalog digest");
    invariant(catalogDigest === computedCatalogDigest, "provider catalog digest does not match entries");
  }
  const body = {
    schema: PROVIDER_DISCOVERY_SCHEMA,
    version: 1,
    status: entries.length === 0 ? "EMPTY" : mode,
    offline_mode: offlinePolicy.mode,
    provider_discovery_mode: mode,
    workspace_binding_digest: workspaceBindingDigest,
    host_capability_catalog_digest: hostCapabilityCatalogDigest,
    catalog_digest: computedCatalogDigest,
    entries,
    operations: {
      network_attempted: false,
      authentication_attempted: false,
      spending_attempted: false,
      external_write_attempted: false,
    },
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateProviderNeutralDiscovery(body, {hostCapabilityCatalog});
}

export function validateProviderNeutralDiscovery(record, {hostCapabilityCatalog = null} = {}) {
  exactKeys(record, FIELDS, "provider discovery record");
  invariant(record.schema === PROVIDER_DISCOVERY_SCHEMA && record.version === 1, "provider discovery identity is invalid");
  invariant(PROVIDER_DISCOVERY_STATUSES.includes(record.status), "provider discovery status is invalid");
  invariant(OFFLINE_MODES.includes(record.offline_mode), "provider discovery offline mode is invalid");
  invariant(PROVIDER_DISCOVERY_MODES.includes(record.provider_discovery_mode), "provider discovery mode is invalid");
  const mode = expectedDiscoveryMode(record.offline_mode);
  invariant(record.provider_discovery_mode === mode, "provider discovery mode does not match offline policy");
  requireDigest(record.workspace_binding_digest, "provider discovery workspace binding digest");
  const expectedHostDigest = requireHostEvidence(mode, hostCapabilityCatalog);
  invariant(record.host_capability_catalog_digest === expectedHostDigest, "provider discovery host capability binding does not match readback");
  requireDigest(record.catalog_digest, "provider catalog digest");
  invariant(Array.isArray(record.entries), "provider discovery entries are invalid");
  record.entries.forEach((entry, index) => validateEntry(entry, `provider discovery entry ${index}`));
  validateEntryOrder(record.entries, "provider discovery entries");
  validateTrustForMode(record.entries, mode);
  invariant(record.entries.length === 0 ? record.status === "EMPTY" : record.status === mode, "provider discovery status does not match its catalog");
  invariant(canonicalDigest(record.entries) === record.catalog_digest, "provider discovery catalog digest does not match entries");
  exactKeys(record.operations, ["network_attempted", "authentication_attempted", "spending_attempted", "external_write_attempted"], "provider discovery operations");
  for (const field of ["network_attempted", "authentication_attempted", "spending_attempted", "external_write_attempted"]) invariant(record.operations[field] === false, `provider discovery attempted a prohibited operation: ${field}`);
  requireDigest(record.digest, "provider discovery digest");
  invariant(record.digest === digestWithout(record, "digest"), "provider discovery digest does not match content");
  assertPortableRecord(record, "provider discovery record");
  return record;
}

export function findOfflineUsableAdapters(record, options = {}) {
  validateProviderNeutralDiscovery(record, options);
  return record.entries.filter((entry) => entry.trust_status !== "UNAVAILABLE"
    && ["TRUSTED_HOST_CATALOG", "CAPABILITY_ATTESTED"].includes(entry.trust_status)
    && entry.network_required === false
    && entry.authentication_required === false
    && entry.external_write_required === false
    && entry.capabilities.every((capability) => !["NETWORK_READ", "NETWORK_WRITE", "AUTHENTICATION", "PUBLISH", "MERGE", "DEPLOY", "SPEND"].includes(capability)));
}
