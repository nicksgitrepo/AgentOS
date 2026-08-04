#!/usr/bin/env node

import crypto from "node:crypto";

export const NORMALIZATION_POLICY_SCHEMA = "agentos.normalization_policy.v1";
export const NORMALIZATION_SCOPES = Object.freeze([
  "NOT_APPLICABLE",
  "INTERNAL_AND_NEW_SURFACES",
  "FULL_WITH_COMPATIBILITY",
]);
export const NORMALIZATION_PRECEDENCE = Object.freeze([
  "EXTERNAL_PERSISTED_OR_PUBLIC_CONTRACT",
  "OFFICIAL_LANGUAGE_CONVENTION",
  "OFFICIAL_FRAMEWORK_OR_PLATFORM_CONVENTION",
  "ACCEPTED_PROJECT_GLOSSARY",
  "AGENTOS_FALLBACK",
]);
export const RENAME_DISPOSITIONS = Object.freeze([
  "PRESERVE_EXTERNAL",
  "ALIAS_THEN_MIGRATE",
  "RENAME_INTERNAL",
  "OWNER_REQUIRED_ON_CONFLICT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(
    Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
  );
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const result = [...new Set(values)].sort(compareUtf8);
  assert(result.length === values.length && result.every((value, index) => value === values[index]), `${label} must be unique and sorted`);
  return result;
}

const BASE_RULES = Object.freeze({
  directory: "lower-kebab-case; preserve framework-required entrypoint directories",
  filename: "lower-kebab-case; preserve published filenames and compatibility aliases",
  javascript_typescript: "camelCase variables and functions; PascalCase types and components; UPPER_SNAKE_CASE constants and environment names",
  python: "snake_case variables, functions, modules, and packages; PascalCase types",
  rust: "snake_case modules and functions; PascalCase types; SCREAMING_SNAKE_CASE constants",
  go: "lowercase package names; MixedCaps exported identifiers; preserve idiomatic initialisms",
  routes: "lower-kebab-case path segments; stable typed dynamic parameters; preserve public route identity",
  database: "snake_case tables, columns, indexes, and constraints; migrations are explicit and reversible",
  events: "lowercase dotted stable names with an explicit version when the payload contract changes",
  environment: "UPPER_SNAKE_CASE; never rename a consumed environment variable without an alias or migration",
  documents: "lowercase-kebab-case for new machine-readable filenames; preserve accepted article numbers and slugs",
});

export function classifyRename({
  surface = "INTERNAL",
  externallyConsumed = false,
  persisted = false,
  published = false,
  compatibilityAvailable = true,
  conflictsWithAcceptedGlossary = false,
} = {}) {
  requireString(surface, "rename surface");
  if (conflictsWithAcceptedGlossary) return "OWNER_REQUIRED_ON_CONFLICT";
  if (externallyConsumed || persisted || published) {
    return compatibilityAvailable ? "ALIAS_THEN_MIGRATE" : "PRESERVE_EXTERNAL";
  }
  return "RENAME_INTERNAL";
}

function modeScope(importMode) {
  if (importMode === null || importMode === undefined) return "INTERNAL_AND_NEW_SURFACES";
  if (importMode === "NORMALIZE_AND_AUDIT" || importMode === "RECONSTRUCT_FROM_INTENT") return "FULL_WITH_COMPATIBILITY";
  if (["ADOPT_IN_PLACE", "CLEAN_COPY"].includes(importMode)) return "INTERNAL_AND_NEW_SURFACES";
  throw new Error(`unknown project import mode: ${importMode}`);
}

function validateRules(rules) {
  requireRecord(rules, "normalization rules");
  for (const key of Object.keys(BASE_RULES)) {
    requireString(rules[key], `normalization rule ${key}`);
    assert(rules[key] === BASE_RULES[key], `portable normalization rule was modified: ${key}`);
  }
}

export function compileNormalizationPolicy({
  importMode = null,
  projectGlossary = [],
  frameworkConventions = {},
  protectedContracts = [],
  additionalRules = {},
} = {}) {
  assert(importMode === null || typeof importMode === "string", "normalization import mode is invalid");
  assert(Array.isArray(projectGlossary), "project glossary must be an array");
  assert(Array.isArray(protectedContracts), "protected contracts must be an array");
  const normalizedGlossary = [...new Set(projectGlossary)].sort(compareUtf8);
  const normalizedProtectedContracts = [...new Set(protectedContracts)].sort(compareUtf8);
  sortedUnique(normalizedGlossary, "project glossary");
  sortedUnique(normalizedProtectedContracts, "protected contracts");
  requireRecord(frameworkConventions, "framework conventions");
  requireRecord(additionalRules, "additional normalization rules");
  const forbiddenOverrideKeys = [
    "precedence", "scope", "rename_dispositions", "external_contract_rule", "weaken_compatibility",
    "allow_silent_public_rename", "allow_destructive_migration",
  ];
  for (const key of Object.keys(additionalRules)) assert(!forbiddenOverrideKeys.includes(key), `normalization extension cannot override ${key}`);
  for (const key of Object.keys(additionalRules)) assert(!Object.hasOwn(BASE_RULES, key), `normalization extension cannot override portable rule ${key}`);
  const rules = {...BASE_RULES, ...Object.fromEntries(Object.entries(additionalRules).map(([key, value]) => {
    requireString(value, `additional normalization rule ${key}`);
    return [key, value];
  }))};
  validateRules(rules);
  const policyBody = {
    schema: NORMALIZATION_POLICY_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "COMPILED",
    scope: modeScope(importMode),
    import_mode: importMode,
    precedence: [...NORMALIZATION_PRECEDENCE],
    rules,
    project_glossary: normalizedGlossary,
    framework_conventions: structuredClone(frameworkConventions),
    protected_contracts: normalizedProtectedContracts,
    rename_dispositions: [...RENAME_DISPOSITIONS],
    external_contract_rule: "PUBLIC_PERSISTED_OR_EXTERNAL_IDENTITIES_ARE_PRESERVED_OR_ALIAS_MIGRATED;_SILENT_RENAME_IS_FORBIDDEN",
    migration_rule: "RENAME_INTERNAL_ONLY_AFTER_REFERENCE_SCAN;_ALIAS_OR_VERSION_EXTERNAL_CONTRACTS;RECORD_EVERY_EXCLUSION_AND_UNAVAILABLE_SURFACE",
    campaign_rule: "BOOTSTRAP_COMPILES_POLICY_AND_PLAN;_THE_FIRST_GOVERNED_CAMPAIGN_EXECUTES_REFACTOR_AND_AUDIT",
  };
  const policy = {...policyBody, normalization_sha256: canonicalDigest(policyBody)};
  validateNormalizationPolicy(policy);
  return policy;
}

export function validateNormalizationPolicy(policy) {
  requireRecord(policy, "normalization policy");
  assert(policy.schema === NORMALIZATION_POLICY_SCHEMA && policy.version === 1
    && policy.governance_version === "2.1rc" && policy.status === "COMPILED", "normalization policy identity is invalid");
  assert(NORMALIZATION_SCOPES.includes(policy.scope), "normalization policy scope is invalid");
  assert(policy.import_mode === null || ["ADOPT_IN_PLACE", "CLEAN_COPY", "NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(policy.import_mode), "normalization policy import mode is invalid");
  assert(policy.scope === modeScope(policy.import_mode), "normalization policy scope does not match its import mode");
  assert(JSON.stringify(policy.precedence) === JSON.stringify(NORMALIZATION_PRECEDENCE), "normalization precedence is weakened or reordered");
  validateRules(policy.rules);
  sortedUnique(policy.project_glossary, "normalization project glossary");
  sortedUnique(policy.protected_contracts, "normalization protected contracts");
  requireRecord(policy.framework_conventions, "normalization framework conventions");
  assert(JSON.stringify(policy.rename_dispositions) === JSON.stringify(RENAME_DISPOSITIONS), "normalization rename dispositions are weakened or reordered");
  for (const field of ["external_contract_rule", "migration_rule", "campaign_rule"]) requireString(policy[field], `normalization policy ${field}`);
  assert(policy.external_contract_rule.includes("SILENT_RENAME_IS_FORBIDDEN"), "normalization policy permits silent external renames");
  assert(policy.migration_rule.includes("ALIAS") && policy.migration_rule.includes("RECORD"), "normalization migration rule is incomplete");
  assert(SHA256.test(policy.normalization_sha256), "normalization policy digest is invalid");
  const body = structuredClone(policy);
  delete body.normalization_sha256;
  assert(policy.normalization_sha256 === canonicalDigest(body), "normalization policy is not content-addressed");
  return policy;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("normalization policy controller loaded\n");
