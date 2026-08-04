#!/usr/bin/env node

import crypto from "node:crypto";

export const STANDARDS_REGISTRY_SCHEMA = "agentos.standards_registry.v1";
export const STANDARD_ROLES = Object.freeze([
  "NORMATIVE_GATE_SOURCE",
  "PROCESS_BASELINE",
  "INTERCHANGE_STANDARD",
  "AWARENESS_CROSSCHECK",
  "PROJECT_CONTEXT_OVERLAY",
]);
export const STANDARD_GATE_ROOTS = Object.freeze([
  "FUNCTION_REQUIREMENTS",
  "DESIGN_BIBLE",
  "SECURITY",
  "NONE",
]);
export const STANDARD_STATUSES = Object.freeze(["PINNED", "PROJECT_BOUND", "DEFERRED_NONBLOCKING"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const URL_WITHOUT_QUERY = /^https?:\/\/[^?#\s]+$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;

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

function requireId(value, label) {
  requireString(value, label);
  assert(SAFE_ID.test(value), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function stringArray(value, label, fallback = []) {
  const items = value ?? fallback;
  assert(Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim().length > 0), `${label} must be an array of nonempty strings`);
  const normalized = [...new Set(items)].sort(compareUtf8);
  assert(JSON.stringify(items) === JSON.stringify(normalized), `${label} must be unique and sorted`);
  return normalized;
}

function sourceForExternal(url, label) {
  requireString(url, label);
  assert(url === "PORTABLE_KERNEL" || url === "PROJECT_CONTEXT" || URL_WITHOUT_QUERY.test(url), `${label} must be a stable source URL or typed context source`);
  return url;
}

function standard(entry) {
  return Object.freeze({
    standard_id: entry.standard_id,
    title: entry.title,
    authority: entry.authority,
    version: entry.version,
    role: entry.role,
    status: entry.status ?? "PINNED",
    source: entry.source,
    applies_when: entry.applies_when,
    gate_root: entry.gate_root,
    requirement_identity_rule: entry.requirement_identity_rule,
    minimum_evidence: entry.minimum_evidence,
    rule: entry.rule,
  });
}

// These are version-pinned references, not a claim that every project must
// satisfy every standard. Applicability and gate role are explicit per entry.
export const PORTABLE_STANDARD_BASELINE = Object.freeze([
  standard({
    standard_id: "W3C_WCAG_2_2",
    title: "Web Content Accessibility Guidelines",
    authority: "W3C",
    version: "2.2",
    role: "NORMATIVE_GATE_SOURCE",
    source: "https://www.w3.org/TR/WCAG22/",
    applies_when: ["VISIBLE_WEB_CONTENT", "VISIBLE_INTERACTIVE_SURFACE"],
    gate_root: "DESIGN_BIBLE",
    requirement_identity_rule: "WCAG-2.2.<success-criterion-id>",
    minimum_evidence: "APPLICABLE_SUCCESS_CRITERIA_WITH_REAL_SURFACE_PROOF",
    rule: "Use the applicable WCAG 2.2 success criteria; do not claim conformance from screenshots or static source alone when live behavior is material.",
  }),
  standard({
    standard_id: "OWASP_ASVS_5_0_0",
    title: "Application Security Verification Standard",
    authority: "OWASP",
    version: "5.0.0",
    role: "NORMATIVE_GATE_SOURCE",
    source: "https://owasp.org/www-project-application-security-verification-standard/",
    applies_when: ["WEB_APPLICATION", "HTTP_API", "AUTHENTICATED_OR_SENSITIVE_DATA"],
    gate_root: "SECURITY",
    requirement_identity_rule: "ASVS-5.0.0-<chapter>.<section>.<requirement>",
    minimum_evidence: "VERSION_PINNED_ATOMIC_REQUIREMENTS_AND_HOSTILE_BOUNDARY_PROOF",
    rule: "Pin every selected requirement to the ASVS version; requirement IDs without a version are not sufficient acceptance identity.",
  }),
  standard({
    standard_id: "NIST_SSDF_1_1",
    title: "Secure Software Development Framework",
    authority: "NIST",
    version: "1.1",
    role: "PROCESS_BASELINE",
    source: "https://csrc.nist.gov/pubs/sp/800/218/final",
    applies_when: ["SOFTWARE_PROJECT", "SOFTWARE_SUPPLY_CHAIN", "RELEASED_ARTIFACT"],
    gate_root: "NONE",
    requirement_identity_rule: "NIST-SSDF-1.1-<practice>.<task>",
    minimum_evidence: "REQUIREMENT_TRACEABILITY_PROVENANCE_AND_VULNERABILITY_RESPONSE_RECORD",
    rule: "Use SSDF to shape secure development and provenance work; it is not by itself a Product acceptance root.",
  }),
  standard({
    standard_id: "JSON_SCHEMA_2020_12",
    title: "JSON Schema",
    authority: "JSON Schema",
    version: "2020-12",
    role: "INTERCHANGE_STANDARD",
    source: "https://json-schema.org/draft/2020-12",
    applies_when: ["MACHINE_READABLE_CONTRACT", "JSON_DOCUMENT"],
    gate_root: "NONE",
    requirement_identity_rule: "JSONSCHEMA-2020-12-<schema-id>",
    minimum_evidence: "SCHEMA_PARSE_AND_CONTRACT_VALIDATION",
    rule: "Use the 2020-12 dialect for new JSON contracts unless an admitted project contract requires another dialect.",
  }),
  standard({
    standard_id: "OPENAPI_3_1_2",
    title: "OpenAPI Specification",
    authority: "OpenAPI Initiative",
    version: "3.1.2",
    role: "INTERCHANGE_STANDARD",
    source: "https://spec.openapis.org/oas/v3.1.2.html",
    applies_when: ["HTTP_API", "PUBLIC_OR_PROJECT_API_CONTRACT"],
    gate_root: "FUNCTION_REQUIREMENTS",
    requirement_identity_rule: "OAS-3.1.2-<operation-or-schema-identity>",
    minimum_evidence: "OPENAPI_PARSE_REFERENCE_RESOLUTION_AND_CONTRACT_TESTS",
    rule: "Describe HTTP API behavior with an explicit OpenAPI document when an HTTP API is in scope; preserve public contract compatibility during normalization.",
  }),
  standard({
    standard_id: "SPDX_3_0_1",
    title: "SPDX Software Bill of Materials and Licensing Specification",
    authority: "SPDX",
    version: "3.0.1",
    role: "INTERCHANGE_STANDARD",
    source: "https://spdx.dev/use/specifications/",
    applies_when: ["DEPENDENCY_INVENTORY", "LICENSE_ORIGIN", "RELEASED_ARTIFACT"],
    gate_root: "SECURITY",
    requirement_identity_rule: "SPDX-3.0.1-<element-identity>",
    minimum_evidence: "DEPENDENCY_AND_LICENSE_INVENTORY_WITH_SOURCE_PROVENANCE",
    rule: "Use SPDX-compatible identity when licensing or dependency provenance is material; do not invent license facts from package names alone.",
  }),
  standard({
    standard_id: "CYCLONEDX_1_7",
    title: "CycloneDX Bill of Materials",
    authority: "OWASP CycloneDX",
    version: "1.7",
    role: "INTERCHANGE_STANDARD",
    source: "https://cyclonedx.org/specification/overview/",
    applies_when: ["DEPENDENCY_INVENTORY", "RELEASED_ARTIFACT", "SOFTWARE_SUPPLY_CHAIN"],
    gate_root: "SECURITY",
    requirement_identity_rule: "CDX-1.7-<bom-ref>",
    minimum_evidence: "MACHINE_READABLE_BOM_AND_COMPONENT_PROVENANCE",
    rule: "Use CycloneDX when a software, service, configuration, or model bill of materials is required; the BOM does not prove vulnerability absence.",
  }),
  standard({
    standard_id: "SEMVER_2_0_0",
    title: "Semantic Versioning",
    authority: "Semantic Versioning",
    version: "2.0.0",
    role: "PROCESS_BASELINE",
    source: "https://semver.org/spec/v2.0.0.html",
    applies_when: ["VERSIONED_PUBLIC_API", "PACKAGE_OR_RELEASE_IDENTITY"],
    gate_root: "FUNCTION_REQUIREMENTS",
    requirement_identity_rule: "SEMVER-2.0.0-<version>",
    minimum_evidence: "DECLARED_PUBLIC_API_AND_COMPATIBILITY_CLASSIFICATION",
    rule: "Use SemVer only where a public API or release contract is declared; it does not authorize breaking a persisted or external contract.",
  }),
  standard({
    standard_id: "HTTP_RFC_9110",
    title: "HTTP Semantics",
    authority: "IETF",
    version: "RFC 9110",
    role: "INTERCHANGE_STANDARD",
    source: "https://www.ietf.org/rfc/rfc9110.html",
    applies_when: ["HTTP_API", "WEB_APPLICATION"],
    gate_root: "FUNCTION_REQUIREMENTS",
    requirement_identity_rule: "RFC9110-<section>",
    minimum_evidence: "HTTP_METHOD_STATUS_HEADER_AND_CACHE_SEMANTICS_PROOF",
    rule: "Preserve HTTP semantics and status-code meaning when moving or renaming routes.",
  }),
  standard({
    standard_id: "HTTP_PROBLEM_DETAILS_RFC_9457",
    title: "Problem Details for HTTP APIs",
    authority: "IETF",
    version: "RFC 9457",
    role: "INTERCHANGE_STANDARD",
    source: "https://www.ietf.org/rfc/rfc9457.html",
    applies_when: ["HTTP_API", "MACHINE_READABLE_ERROR_CONTRACT"],
    gate_root: "FUNCTION_REQUIREMENTS",
    requirement_identity_rule: "RFC9457-<problem-type>",
    minimum_evidence: "PROBLEM_TYPE_STATUS_AND_SAFE_ERROR_PAYLOAD_CONTRACT",
    rule: "Use the standard problem-details envelope where an HTTP API needs machine-readable error details; do not expose implementation secrets in detail text.",
  }),
  standard({
    standard_id: "AGENTOS_NAMING_NORMALIZATION_V1",
    title: "AgentOS Naming and Structure Normalization",
    authority: "AgentOS",
    version: "1",
    role: "PROCESS_BASELINE",
    source: "PORTABLE_KERNEL",
    applies_when: ["PROJECT_IMPORT", "NORMALIZE_AND_AUDIT", "NEW_PROJECT_STRUCTURE"],
    gate_root: "NONE",
    requirement_identity_rule: "AGENTOS-NAMING-1-<rule-id>",
    minimum_evidence: "DETERMINISTIC_RENAME_MAP_COMPATIBILITY_CLASSIFICATION_AND_EXCLUSION_NOTE",
    rule: "Use language and framework conventions first, then the project glossary, then the AgentOS fallback rules; never rename an external contract silently.",
  }),
  standard({
    standard_id: "AGENTOS_DESIGN_NORMALIZATION_V1",
    title: "AgentOS Design Normalization",
    authority: "AgentOS",
    version: "1",
    role: "PROCESS_BASELINE",
    source: "PORTABLE_KERNEL",
    applies_when: ["VISIBLE_WEB_CONTENT", "PROJECT_IMPORT", "NORMALIZE_AND_AUDIT"],
    gate_root: "DESIGN_BIBLE",
    requirement_identity_rule: "AGENTOS-DESIGN-1-<rule-id>",
    minimum_evidence: "PAGE_FAMILY_STATE_MATRIX_ACCESSIBILITY_AND_LIVE_SURFACE_PROOF",
    rule: "Normalize only within the accepted Design Bible and preserve workflow-specific differences; WCAG applicability remains separate from visual preference.",
  }),
]);

function validateStandard(entry, label) {
  requireRecord(entry, label);
  for (const field of ["standard_id", "title", "authority", "version", "requirement_identity_rule", "minimum_evidence", "rule"]) {
    requireString(entry[field], `${label} ${field}`);
  }
  requireId(entry.standard_id, `${label} standard_id`);
  assert(STANDARD_ROLES.includes(entry.role), `${label} role is invalid`);
  assert(STANDARD_STATUSES.includes(entry.status), `${label} status is invalid`);
  assert(STANDARD_GATE_ROOTS.includes(entry.gate_root), `${label} gate root is invalid`);
  sourceForExternal(entry.source, `${label} source`);
  assert(Array.isArray(entry.applies_when) && entry.applies_when.length > 0
    && entry.applies_when.every((value) => typeof value === "string" && value.trim().length > 0), `${label} applicability is invalid`);
  secretFree(entry, label);
}

export function validateStandardsRegistry(registry) {
  requireRecord(registry, "standards registry");
  assert(registry.schema === STANDARDS_REGISTRY_SCHEMA && registry.version === 1 && registry.status === "COMPILED", "standards registry identity is invalid");
  assert(registry.governance_version === "2.1rc", "standards registry governance version is invalid");
  assert(Array.isArray(registry.standards) && registry.standards.length > 0, "standards registry is empty");
  const ids = new Set();
  const portableById = new Map(PORTABLE_STANDARD_BASELINE.map((entry) => [entry.standard_id, entry]));
  const seenPortable = new Set();
  for (const entry of registry.standards) {
    validateStandard(entry, "standards registry entry");
    assert(!ids.has(entry.standard_id), `duplicate standard: ${entry.standard_id}`);
    ids.add(entry.standard_id);
    if (portableById.has(entry.standard_id)) {
      const expectedPortable = portableById.get(entry.standard_id);
      assert(JSON.stringify(canonicalize(entry)) === JSON.stringify(canonicalize(expectedPortable)), `portable standard was modified: ${entry.standard_id}`);
      seenPortable.add(entry.standard_id);
    }
    if (entry.role === "PROJECT_CONTEXT_OVERLAY") assert(entry.status === "PROJECT_BOUND", "project overlays must be project-bound");
    else assert(entry.status === "PINNED" || entry.status === "DEFERRED_NONBLOCKING", "portable standards must remain pinned or deferred");
  }
  assert(seenPortable.size === portableById.size, "standards registry removed a portable baseline standard");
  const sorted = [...registry.standards].sort((left, right) => compareUtf8(left.standard_id, right.standard_id)).map((entry) => entry.standard_id);
  assert(JSON.stringify(sorted) === JSON.stringify(registry.standards.map((entry) => entry.standard_id)), "standards registry is not deterministically ordered");
  const requiredIds = stringArray(registry.required_standard_ids, "required standards");
  const overlayIds = stringArray(registry.overlay_ids, "overlay standards");
  assert(requiredIds.every((id) => ids.has(id)), "required standards are not bound to the registry");
  assert(overlayIds.every((id) => ids.has(id)), "overlay standards are not bound to the registry");
  assert(overlayIds.every((id) => registry.standards.find((entry) => entry.standard_id === id)?.role === "PROJECT_CONTEXT_OVERLAY"), "overlay IDs include a portable standard");
  assert(registry.extension_boundary === "PROJECT_CONTEXT_MAY_ADD_TYPED_STANDARDS_AND_STRICTER_REQUIREMENTS_ONLY;_IT_MAY_NOT_REMOVE_OR_WEAKEN_A_PINNED_BASELINE", "standards extension boundary is weakened");
  requireSha(registry.registry_sha256, "standards registry digest");
  const body = structuredClone(registry);
  delete body.registry_sha256;
  assert(registry.registry_sha256 === canonicalDigest(body), "standards registry is not content-addressed");
  secretFree(registry, "standards registry");
  return registry;
}

export function compileStandardsRegistry({overlays = [], requiredStandardIds = []} = {}) {
  assert(Array.isArray(overlays), "standards overlays must be an array");
  assert(Array.isArray(requiredStandardIds), "required standard IDs must be an array");
  const entries = PORTABLE_STANDARD_BASELINE.map((entry) => structuredClone(entry));
  const ids = new Set(entries.map((entry) => entry.standard_id));
  for (const [index, overlay] of overlays.entries()) {
    requireRecord(overlay, `standards overlay ${index}`);
    const allowed = ["standard_id", "title", "authority", "version", "source", "applies_when", "gate_root", "requirement_identity_rule", "minimum_evidence", "rule"];
    for (const key of Object.keys(overlay)) assert(allowed.includes(key), `standards overlay ${index} contains unsupported field: ${key}`);
    const entry = standard({...overlay, role: "PROJECT_CONTEXT_OVERLAY", status: "PROJECT_BOUND"});
    validateStandard(entry, `standards overlay ${index}`);
    assert(!ids.has(entry.standard_id), `standards overlay collides with portable standard: ${entry.standard_id}`);
    ids.add(entry.standard_id);
    entries.push(entry);
  }
  const required = [...new Set(requiredStandardIds.length > 0 ? requiredStandardIds : PORTABLE_STANDARD_BASELINE.map((entry) => entry.standard_id))].sort(compareUtf8);
  assert(required.every((id) => ids.has(id)), "required standard selection references an unknown standard");
  entries.sort((left, right) => compareUtf8(left.standard_id, right.standard_id));
  const registry = {
    schema: STANDARDS_REGISTRY_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "COMPILED",
    source: "PORTABLE_BASELINE_PLUS_TYPED_PROJECT_OVERLAYS",
    selection_rule: "PIN_VERSION_AND_SOURCE;_COMPILE_ONLY_APPLICABLE_REQUIREMENTS;_DO_NOT_TREAT_AWARENESS_OR_PROCESS_BASELINES_AS_PRODUCT_ACCEPTANCE_WITHOUT_A_MAPPED_ROOT_QUESTION",
    version_pinning: "EVERY_REQUIREMENT_ID_AND_EVIDENCE_RECORD_BINDS_STANDARD_ID_AND_VERSION",
    standards: entries,
    required_standard_ids: required,
    overlay_ids: entries.filter((entry) => entry.role === "PROJECT_CONTEXT_OVERLAY").map((entry) => entry.standard_id).sort(compareUtf8),
    extension_boundary: "PROJECT_CONTEXT_MAY_ADD_TYPED_STANDARDS_AND_STRICTER_REQUIREMENTS_ONLY;_IT_MAY_NOT_REMOVE_OR_WEAKEN_A_PINNED_BASELINE",
  };
  secretFree(registry, "compiled standards registry");
  registry.registry_sha256 = canonicalDigest(registry);
  validateStandardsRegistry(registry);
  return registry;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("standards registry controller loaded\n");
