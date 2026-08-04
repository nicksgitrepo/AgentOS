#!/usr/bin/env node

import crypto from "node:crypto";

export const PROJECT_LIFE_CONTRACT_SCHEMA = "agentos.project_life_contract.v1";

export const PROJECT_MATURITIES = Object.freeze([
  "CONCEPT",
  "PRIVATE_PROTOTYPE",
  "LIMITED_PRODUCT",
  "PRIVATE_BETA",
  "PUBLIC_BETA",
  "STANDARD_PRODUCTION",
  "HIGH_CONSEQUENCE_PRODUCTION",
]);
export const ASSURANCE_CLASSES = Object.freeze(["PROTOTYPE", "STANDARD", "ELEVATED", "HIGH_CONSEQUENCE"]);
export const AUDIENCES = Object.freeze(["OWNER_ONLY", "SELECTED_USERS", "WORKSPACE", "PUBLIC"]);
export const DATA_POSTURES = Object.freeze(["NONE_OR_SYNTHETIC", "NON_SENSITIVE_DURABLE", "SENSITIVE_DURABLE", "HIGH_CONSEQUENCE"]);
export const EXPECTED_LIFETIMES = Object.freeze(["PROBE_ONLY", "CAMPAIGN", "SHORT_LIVED", "LONG_LIVED", "INDEFINITE", "PROJECT_DEFINED"]);
export const MAINTENANCE_POSTURES = Object.freeze(["DISPOSABLE", "CAMPAIGN_BOUNDED", "ACTIVE_MAINTENANCE", "OWNER_MAINTAINED", "PROJECT_DEFINED"]);
export const SOURCE_CUSTODIES = Object.freeze(["PROJECT_CONTEXT_BOUND", "OWNER_CONTROLLED", "MANAGED_TARGET", "PROJECT_DEFINED"]);
export const ACCOUNT_CUSTODIES = Object.freeze(["NONE", "OWNER_CONTROLLED", "WORKSPACE_CONTROLLED", "PROJECT_DEFINED"]);
export const COMMERCIALIZATION_MODES = Object.freeze(["NONE", "INTERNAL", "PLANNED", "ACTIVE"]);
export const PORTABILITY_MODES = Object.freeze(["PORTABLE_REQUIRED", "PORTABLE_PREFERRED", "TARGET_BOUND", "PROJECT_DEFINED"]);
export const RETIREMENT_POLICIES = Object.freeze(["OWNER_DECISION", "EXPIRE_AFTER_CAMPAIGN", "EXPIRE_AFTER_DAYS", "KEEP_UNTIL_RETIRED", "PROJECT_DEFINED"]);
export const AVAILABILITY_MODES = Object.freeze(["ON_DEMAND", "CAMPAIGN_HOURS", "CONTINUOUS", "PROJECT_DEFINED"]);
export const USER_SCALE_MODES = Object.freeze(["OWNER_SCALE", "SMALL", "GROWING", "PUBLIC_SCALE", "PROJECT_DEFINED"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
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
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function rejectUnknown(record, allowed, label) {
  for (const key of Object.keys(record)) assert(allowed.includes(key), `${label} contains unsupported field: ${key}`);
}

function enumValue(value, choices, label, fallback) {
  const selected = value ?? fallback;
  assert(choices.includes(selected), `${label} is invalid`);
  return selected;
}

function stringArray(value, label) {
  const items = value ?? [];
  assert(Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim().length > 0), `${label} must be an array of nonempty strings`);
  return [...new Set(items)].sort(compareUtf8);
}

function positiveIntegerOrNull(value, label) {
  if (value === undefined || value === null) return null;
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function maturityDefaults(maturity) {
  if (maturity === "CONCEPT") return {assurance_class: "PROTOTYPE", audience: "OWNER_ONLY", expected_lifetime: "PROBE_ONLY", maintenance_posture: "DISPOSABLE", production_claim: "PROTOTYPE_ONLY"};
  if (maturity === "PRIVATE_PROTOTYPE") return {assurance_class: "PROTOTYPE", audience: "OWNER_ONLY", expected_lifetime: "CAMPAIGN", maintenance_posture: "CAMPAIGN_BOUNDED", production_claim: "PROTOTYPE_ONLY"};
  if (maturity === "LIMITED_PRODUCT") return {assurance_class: "STANDARD", audience: "SELECTED_USERS", expected_lifetime: "LONG_LIVED", maintenance_posture: "ACTIVE_MAINTENANCE", production_claim: "LIMITED_PRODUCT"};
  if (maturity === "PRIVATE_BETA") return {assurance_class: "ELEVATED", audience: "SELECTED_USERS", expected_lifetime: "LONG_LIVED", maintenance_posture: "ACTIVE_MAINTENANCE", production_claim: "BETA"};
  if (maturity === "PUBLIC_BETA") return {assurance_class: "ELEVATED", audience: "PUBLIC", expected_lifetime: "LONG_LIVED", maintenance_posture: "ACTIVE_MAINTENANCE", production_claim: "BETA"};
  if (maturity === "STANDARD_PRODUCTION") return {assurance_class: "ELEVATED", audience: "PUBLIC", expected_lifetime: "INDEFINITE", maintenance_posture: "OWNER_MAINTAINED", production_claim: "STANDARD_PRODUCTION"};
  return {assurance_class: "HIGH_CONSEQUENCE", audience: "PUBLIC", expected_lifetime: "INDEFINITE", maintenance_posture: "OWNER_MAINTAINED", production_claim: "HIGH_CONSEQUENCE_PRODUCTION"};
}

function defaultMaturityFromTarget(target) {
  if (target?.mode === "LIMITED_PRODUCT") return "LIMITED_PRODUCT";
  if (target?.mode === "PRIVATE_BETA") return "PRIVATE_BETA";
  if (target?.mode === "PUBLIC_BETA") return "PUBLIC_BETA";
  if (target?.mode === "STANDARD_PRODUCTION") return "STANDARD_PRODUCTION";
  return "PRIVATE_PROTOTYPE";
}

function observedDiscoverySignal(discovery) {
  return discovery.some((fact) => fact?.status === "OBSERVED_FACT"
    && /(?:public|production|beta|hosting|deployment|database|storage|migration|auth|identity|domain|persistent)/iu.test(fact.fact_id ?? ""));
}

function answerHasMaterialData(answer) {
  if (!isRecord(answer)) return false;
  return ["data", "storage", "database", "backup_and_recovery", "migrations", "authentication", "auth", "identity"].some((key) => answer[key] !== undefined && answer[key] !== null);
}

export function projectLifeContractNeedsOwner({answer, discovery = [], deliveryAnswer, technicalAnswer} = {}) {
  if (answer !== undefined) return false;
  const target = deliveryAnswer?.delivery_target ?? deliveryAnswer?.target ?? {};
  if (target.mode && target.mode !== "PROTOTYPE") return true;
  if (answerHasMaterialData(technicalAnswer)) return true;
  return observedDiscoverySignal(discovery);
}

export function compileProjectLifeContract({answer = undefined, discovery = [], deliveryAnswer = undefined} = {}) {
  if (answer !== undefined) {
    requireRecord(answer, "project life contract answer");
    secretFree(answer, "project life contract answer");
    rejectUnknown(answer, [
      "maturity", "assurance_class", "audience", "source_custody", "account_custody", "expected_lifetime",
      "maintenance_posture", "data_posture", "operating_envelope", "commercialization", "portability",
      "retirement", "retirement_after_days", "notes",
    ], "project life contract answer");
  }
  const input = answer ?? {};
  const target = deliveryAnswer?.delivery_target ?? deliveryAnswer?.target ?? {};
  const maturity = enumValue(input.maturity, PROJECT_MATURITIES, "project maturity", defaultMaturityFromTarget(target));
  const defaults = maturityDefaults(maturity);
  const operatingInput = input.operating_envelope ?? {};
  requireRecord(operatingInput, "project life operating envelope");
  rejectUnknown(operatingInput, ["availability", "user_scale", "support"], "project life operating envelope");
  const retirementAfterDays = positiveIntegerOrNull(input.retirement_after_days, "retirement_after_days");
  const retirement = enumValue(input.retirement, RETIREMENT_POLICIES, "retirement policy", maturity === "CONCEPT" || maturity === "PRIVATE_PROTOTYPE" ? "OWNER_DECISION" : "KEEP_UNTIL_RETIRED");
  assert(retirement !== "EXPIRE_AFTER_DAYS" || retirementAfterDays !== null, "retirement_after_days is required for EXPIRE_AFTER_DAYS");
  assert(maturity !== "HIGH_CONSEQUENCE_PRODUCTION" || (input.assurance_class ?? defaults.assurance_class) === "HIGH_CONSEQUENCE", "high-consequence production requires HIGH_CONSEQUENCE assurance");
  const contract = {
    schema: PROJECT_LIFE_CONTRACT_SCHEMA,
    version: 1,
    status: answer === undefined ? "DEFAULTED" : "OWNER_CONFIRMED",
    source: answer === undefined ? "PORTABLE_SAFE_DEFAULT" : "OWNER_INPUT_WITH_SAFE_DEFAULTS",
    maturity,
    assurance_class: enumValue(input.assurance_class, ASSURANCE_CLASSES, "assurance class", defaults.assurance_class),
    audience: enumValue(input.audience, AUDIENCES, "project audience", defaults.audience),
    source_custody: enumValue(input.source_custody, SOURCE_CUSTODIES, "source custody", "PROJECT_CONTEXT_BOUND"),
    account_custody: enumValue(input.account_custody, ACCOUNT_CUSTODIES, "account custody", maturity === "CONCEPT" || maturity === "PRIVATE_PROTOTYPE" ? "NONE" : "OWNER_CONTROLLED"),
    expected_lifetime: enumValue(input.expected_lifetime, EXPECTED_LIFETIMES, "expected lifetime", defaults.expected_lifetime),
    maintenance_posture: enumValue(input.maintenance_posture, MAINTENANCE_POSTURES, "maintenance posture", defaults.maintenance_posture),
    data_posture: enumValue(input.data_posture, DATA_POSTURES, "data posture", "NONE_OR_SYNTHETIC"),
    operating_envelope: {
      availability: enumValue(operatingInput.availability, AVAILABILITY_MODES, "operating availability", maturity === "CONCEPT" || maturity === "PRIVATE_PROTOTYPE" ? "ON_DEMAND" : "CONTINUOUS"),
      user_scale: enumValue(operatingInput.user_scale, USER_SCALE_MODES, "operating user scale", defaults.audience === "PUBLIC" ? "GROWING" : "OWNER_SCALE"),
      support: enumValue(operatingInput.support, ["NONE", "CAMPAIGN_ONLY", "ACTIVE_SUPPORT", "PROJECT_DEFINED"], "operating support", maturity === "CONCEPT" ? "NONE" : maturity === "PRIVATE_PROTOTYPE" ? "CAMPAIGN_ONLY" : "ACTIVE_SUPPORT"),
    },
    commercialization: enumValue(input.commercialization, COMMERCIALIZATION_MODES, "commercialization", "NONE"),
    portability: enumValue(input.portability, PORTABILITY_MODES, "portability", "PORTABLE_REQUIRED"),
    retirement,
    retirement_after_days: retirementAfterDays,
    production_claim: defaults.production_claim,
    limitations: maturity === "CONCEPT" || maturity === "PRIVATE_PROTOTYPE"
      ? ["NO_PRODUCTION_CLAIM", "NO_SENSITIVE_DURABLE_DATA_BY_DEFAULT", "EXPLICIT_OWNER_ONLY_OR_SELECTED_AUDIENCE"]
      : maturity === "LIMITED_PRODUCT"
        ? ["EXPLICIT_SUPPORTED_SCOPE", "EXPLICIT_OPERATING_ENVELOPE", "NO_UNBOUNDED_PRODUCTION_CLAIM"]
        : ["EXPLICIT_ACCEPTANCE_AND_ROLLBACK", "EXPLICIT_OWNER_AND_OPERATING_BOUNDARIES"],
    discovery_inputs: discovery.filter((fact) => fact?.status === "OBSERVED_FACT" && typeof fact.fact_id === "string" && /(?:project|delivery|hosting|deployment|database|storage|auth|identity)/iu.test(fact.fact_id))
      .map((fact) => fact.fact_id).sort(compareUtf8),
    notes: input.notes ?? null,
  };
  secretFree(contract, "compiled project life contract");
  contract.life_contract_sha256 = canonicalDigest(contract);
  validateProjectLifeContract(contract);
  return contract;
}

export function validateProjectLifeContract(contract) {
  requireRecord(contract, "project life contract");
  assert(contract.schema === PROJECT_LIFE_CONTRACT_SCHEMA && contract.version === 1, "project life contract identity is invalid");
  assert(["DEFAULTED", "OWNER_CONFIRMED"].includes(contract.status), "project life contract status is invalid");
  assert(["PORTABLE_SAFE_DEFAULT", "OWNER_INPUT_WITH_SAFE_DEFAULTS"].includes(contract.source), "project life contract source is invalid");
  for (const [value, choices, label] of [
    [contract.maturity, PROJECT_MATURITIES, "project maturity"],
    [contract.assurance_class, ASSURANCE_CLASSES, "assurance class"],
    [contract.audience, AUDIENCES, "project audience"],
    [contract.source_custody, SOURCE_CUSTODIES, "source custody"],
    [contract.account_custody, ACCOUNT_CUSTODIES, "account custody"],
    [contract.expected_lifetime, EXPECTED_LIFETIMES, "expected lifetime"],
    [contract.maintenance_posture, MAINTENANCE_POSTURES, "maintenance posture"],
    [contract.data_posture, DATA_POSTURES, "data posture"],
    [contract.commercialization, COMMERCIALIZATION_MODES, "commercialization"],
    [contract.portability, PORTABILITY_MODES, "portability"],
    [contract.retirement, RETIREMENT_POLICIES, "retirement"],
  ]) assert(choices.includes(value), `${label} is invalid`);
  requireRecord(contract.operating_envelope, "project life operating envelope");
  assert(AVAILABILITY_MODES.includes(contract.operating_envelope.availability), "operating availability is invalid");
  assert(USER_SCALE_MODES.includes(contract.operating_envelope.user_scale), "operating user scale is invalid");
  assert(["NONE", "CAMPAIGN_ONLY", "ACTIVE_SUPPORT", "PROJECT_DEFINED"].includes(contract.operating_envelope.support), "operating support is invalid");
  assert(Array.isArray(contract.limitations) && contract.limitations.length > 0 && contract.limitations.every((value) => typeof value === "string"), "project life limitations are invalid");
  assert(Array.isArray(contract.discovery_inputs) && contract.discovery_inputs.every((value) => typeof value === "string"), "project life discovery inputs are invalid");
  if (contract.retirement === "EXPIRE_AFTER_DAYS") assert(Number.isSafeInteger(contract.retirement_after_days) && contract.retirement_after_days > 0, "retirement_after_days is invalid");
  else assert(contract.retirement_after_days === null, "retirement_after_days is only allowed for EXPIRE_AFTER_DAYS");
  if (contract.maturity === "HIGH_CONSEQUENCE_PRODUCTION") assert(contract.assurance_class === "HIGH_CONSEQUENCE", "high-consequence production assurance is weakened");
  if (contract.status === "DEFAULTED") assert(contract.maturity === "PRIVATE_PROTOTYPE", "safe default life contract must remain a private prototype");
  requireSha(contract.life_contract_sha256, "project life contract digest");
  const body = structuredClone(contract);
  delete body.life_contract_sha256;
  assert(contract.life_contract_sha256 === canonicalDigest(body), "project life contract is not content-addressed");
  secretFree(contract, "project life contract");
  return contract;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("project life contract controller loaded\n");
