#!/usr/bin/env node

import crypto from "node:crypto";

export const DELIVERY_TARGET_SCHEMA = "agentos.delivery_target.v1";
export const DELIVERY_TARGET_FAMILIES = Object.freeze(["LOCAL_WORKSPACE", "MANAGED_SITE", "MANAGED_APP", "VPS_APPLICATION", "CLOUD_APPLICATION", "HYBRID", "PROJECT_DEFINED"]);
export const DELIVERY_TARGET_MODES = Object.freeze(["PROTOTYPE", "LIMITED_PRODUCT", "PRIVATE_BETA", "PUBLIC_BETA", "STANDARD_PRODUCTION"]);
export const DELIVERY_TARGET_AUDIENCES = Object.freeze(["OWNER_ONLY", "SELECTED_USERS", "WORKSPACE", "PUBLIC"]);
export const DELIVERY_TARGET_DATA_POSTURES = Object.freeze(["NONE_OR_SYNTHETIC", "NON_SENSITIVE_DURABLE", "SENSITIVE_DURABLE", "HIGH_CONSEQUENCE"]);
export const DELIVERY_TARGET_AUTHENTICATION = Object.freeze(["NONE", "PROJECT_CONTEXT_BOUND", "WORKSPACE_BOUND", "EXTERNAL_PROJECT_BOUND", "PROJECT_DEFINED"]);
export const DELIVERY_TARGET_PRODUCTION_CLAIMS = Object.freeze(["PROTOTYPE_ONLY", "LIMITED_PRODUCT", "BETA", "STANDARD_PRODUCTION"]);

// The adapter is a project-context selector, not a provider account or credential.
// The profile only constrains the supported maturity modes; capabilities and
// account bindings remain typed project facts.
export const MANAGED_SITE_ADAPTER_PROFILES = Object.freeze({
  GENERIC_MANAGED_SITE: Object.freeze({
    family: "MANAGED_SITE",
    supported_modes: Object.freeze(["PROTOTYPE", "LIMITED_PRODUCT"]),
    source: "PORTABLE_TARGET_PROFILE",
  }),
});

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
  assert(SAFE_ID.test(value) && !value.includes("//") && !value.split("/").includes(".."), `${label} contains an unsafe identifier`);
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

function stringArray(value, label, fallback = []) {
  const items = value ?? fallback;
  assert(Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim().length > 0), `${label} must be an array of nonempty strings`);
  return [...new Set(items)].sort(compareUtf8);
}

function targetFamilyForRoute(route) {
  return route === "LOCAL" ? "LOCAL_WORKSPACE"
    : route === "MANAGED" ? "MANAGED_SITE"
      : route === "VPS" ? "VPS_APPLICATION"
        : route === "HYBRID" ? "HYBRID" : "PROJECT_DEFINED";
}

function targetModeForMaturity(maturity) {
  return maturity === "CONCEPT" || maturity === "PRIVATE_PROTOTYPE" ? "PROTOTYPE"
    : maturity === "LIMITED_PRODUCT" ? "LIMITED_PRODUCT"
      : maturity === "PRIVATE_BETA" ? "PRIVATE_BETA"
        : maturity === "PUBLIC_BETA" ? "PUBLIC_BETA" : "STANDARD_PRODUCTION";
}

function productionClaimForMode(mode) {
  return mode === "PROTOTYPE" ? "PROTOTYPE_ONLY"
    : mode === "LIMITED_PRODUCT" ? "LIMITED_PRODUCT"
      : mode === "PRIVATE_BETA" || mode === "PUBLIC_BETA" ? "BETA" : "STANDARD_PRODUCTION";
}

function maturityRank(value) {
  return ["CONCEPT", "PRIVATE_PROTOTYPE", "LIMITED_PRODUCT", "PRIVATE_BETA", "PUBLIC_BETA", "STANDARD_PRODUCTION", "HIGH_CONSEQUENCE_PRODUCTION"].indexOf(value);
}

function targetModeRank(value) {
  return {PROTOTYPE: 0, LIMITED_PRODUCT: 2, PRIVATE_BETA: 3, PUBLIC_BETA: 4, STANDARD_PRODUCTION: 5}[value];
}

function audienceRank(value) {
  return {OWNER_ONLY: 0, SELECTED_USERS: 1, WORKSPACE: 2, PUBLIC: 3}[value];
}

function dataPostureRank(value) {
  return {NONE_OR_SYNTHETIC: 0, NON_SENSITIVE_DURABLE: 1, SENSITIVE_DURABLE: 2, HIGH_CONSEQUENCE: 3}[value];
}

function defaultLimitations(mode) {
  if (mode === "PROTOTYPE") return ["NO_PRODUCTION_CLAIM", "SYNTHETIC_OR_EXPLICITLY_ADMITTED_DATA_ONLY", "OWNER_OR_SELECTED_AUDIENCE_ONLY"];
  if (mode === "LIMITED_PRODUCT") return ["EXPLICIT_SUPPORTED_SCOPE", "EXPLICIT_OPERATING_ENVELOPE", "EXACT_ROLLBACK_REQUIRED"];
  return ["EXACT_ACCEPTANCE_REQUIRED", "EXACT_DEPLOYMENT_AND_ROLLBACK_IDENTITY_REQUIRED", "OWNER_BOUND_OPERATING_ENVELOPE_REQUIRED"];
}

export function compileDeliveryTarget({answer = undefined, route = "PROJECT_DEFINED", projectLifeContract} = {}) {
  if (answer !== undefined) {
    requireRecord(answer, "delivery target answer");
    secretFree(answer, "delivery target answer");
    rejectUnknown(answer, ["family", "adapter_id", "mode", "audience", "data_posture", "authentication", "custom_domain", "limitations", "capability_ids", "supported_scope", "operating_envelope", "rollback_path"], "delivery target answer");
  }
  requireRecord(projectLifeContract, "delivery target project life contract");
  const input = answer ?? {};
  const family = enumValue(input.family, DELIVERY_TARGET_FAMILIES, "delivery target family", targetFamilyForRoute(route));
  const mode = enumValue(input.mode, DELIVERY_TARGET_MODES, "delivery target mode", targetModeForMaturity(projectLifeContract.maturity));
  const adapterId = input.adapter_id === undefined || input.adapter_id === null ? null : input.adapter_id;
  if (adapterId !== null) requireId(adapterId, "delivery target adapter ID");
  const profile = adapterId === null ? null : MANAGED_SITE_ADAPTER_PROFILES[adapterId] ?? null;
  if (profile !== null) {
    assert(family === profile.family, `${adapterId} requires ${profile.family} delivery target family`);
    assert(profile.supported_modes.includes(mode), `${adapterId} does not support ${mode} delivery target mode`);
  }
  if (family === "MANAGED_SITE") assert(route === "MANAGED" || route === "HYBRID" || route === "PROJECT_DEFINED", "managed site target requires a managed or project-defined deployment route");
  const audience = enumValue(input.audience, DELIVERY_TARGET_AUDIENCES, "delivery target audience", projectLifeContract.audience);
  const dataPosture = enumValue(input.data_posture, DELIVERY_TARGET_DATA_POSTURES, "delivery target data posture", projectLifeContract.data_posture);
  const authentication = enumValue(input.authentication, DELIVERY_TARGET_AUTHENTICATION, "delivery target authentication", "NONE");
  const customDomain = enumValue(input.custom_domain, ["NOT_REQUIRED", "OWNER_DEFINED", "PROJECT_DEFINED"], "delivery target custom domain", "NOT_REQUIRED");
  const supportedScope = stringArray(input.supported_scope, "delivery target supported scope");
  const operatingEnvelope = stringArray(input.operating_envelope, "delivery target operating envelope");
  const rollbackPath = input.rollback_path ?? null;
  assert(rollbackPath === null || rollbackPath === "EXACT_LAST_ACCEPTED_DEPLOYMENT", "delivery target rollback path is invalid");
  assert(mode === "PROTOTYPE" || projectLifeContract.maturity !== "CONCEPT", "a concept cannot claim a working delivery target");
  if (mode === "PROTOTYPE") assert(dataPosture === "NONE_OR_SYNTHETIC", "prototype delivery target cannot use durable or sensitive data by default");
  if (mode === "STANDARD_PRODUCTION") assert(projectLifeContract.maturity === "STANDARD_PRODUCTION" || projectLifeContract.maturity === "HIGH_CONSEQUENCE_PRODUCTION", "standard production target requires a production life contract");
  if (mode !== "PROTOTYPE") {
    assert(supportedScope.length > 0, "non-prototype delivery target requires an explicit supported scope");
    assert(operatingEnvelope.length > 0, "non-prototype delivery target requires an explicit operating envelope");
    assert(rollbackPath === "EXACT_LAST_ACCEPTED_DEPLOYMENT", "non-prototype delivery target requires an exact rollback path");
  }
  const target = {
    schema: DELIVERY_TARGET_SCHEMA,
    version: 1,
    status: answer === undefined ? "DERIVED" : "OWNER_CONFIRMED",
    family,
    adapter_id: adapterId,
    adapter_profile: profile === null ? null : {supported_modes: [...profile.supported_modes], source: profile.source},
    mode,
    audience,
    data_posture: dataPosture,
    authentication,
    custom_domain: customDomain,
    supported_scope: supportedScope,
    operating_envelope: operatingEnvelope,
    rollback_path: rollbackPath,
    production_claim: productionClaimForMode(mode),
    limitations: stringArray(input.limitations, "delivery target limitations", defaultLimitations(mode)),
    capability_ids: stringArray(input.capability_ids, "delivery target capability IDs"),
    recommendation: {
      selected_from: answer === undefined ? "ROUTE_AND_PROJECT_LIFE_CONTRACT" : "OWNER_INPUT",
      managed_site_option: {
        family: "MANAGED_SITE",
        adapter_id: "GENERIC_MANAGED_SITE",
        supported_modes: [...MANAGED_SITE_ADAPTER_PROFILES.GENERIC_MANAGED_SITE.supported_modes],
        reason: "A_managed_site_can_reduce_setup_for_a_prototype_or_explicitly_limited_product;_it_does_not_imply_production_capability_or_provider_authority",
        confidence: "CANDIDATE_ONLY",
      },
      rule: "RECOMMEND_TARGET_CLASSES_AND_EXPLICITLY_PROFILED_ADAPTERS_ONLY;_NEVER_INVENT_PROVIDER_CAPABILITIES_OR_ACCOUNT_BINDINGS",
    },
  };
  secretFree(target, "compiled delivery target");
  target.target_sha256 = canonicalDigest(target);
  validateDeliveryTarget(target);
  validateDeliveryTargetAgainstLife(target, projectLifeContract);
  return target;
}

export function validateDeliveryTargetAgainstLife(target, projectLifeContract) {
  validateDeliveryTarget(target);
  requireRecord(projectLifeContract, "delivery target project life contract");
  assert(maturityRank(projectLifeContract.maturity) >= targetModeRank(target.mode), "delivery target mode exceeds the project life maturity");
  assert(audienceRank(projectLifeContract.audience) >= audienceRank(target.audience), "delivery target audience exceeds the project life audience");
  assert(dataPostureRank(projectLifeContract.data_posture) >= dataPostureRank(target.data_posture), "delivery target data posture exceeds the project life data posture");
  return target;
}

export function validateDeliveryTarget(target) {
  requireRecord(target, "delivery target");
  assert(target.schema === DELIVERY_TARGET_SCHEMA && target.version === 1, "delivery target identity is invalid");
  assert(["DERIVED", "OWNER_CONFIRMED"].includes(target.status), "delivery target status is invalid");
  assert(DELIVERY_TARGET_FAMILIES.includes(target.family), "delivery target family is invalid");
  assert(target.adapter_id === null || (typeof target.adapter_id === "string" && SAFE_ID.test(target.adapter_id)), "delivery target adapter ID is invalid");
  assert(DELIVERY_TARGET_MODES.includes(target.mode), "delivery target mode is invalid");
  assert(DELIVERY_TARGET_AUDIENCES.includes(target.audience), "delivery target audience is invalid");
  assert(DELIVERY_TARGET_DATA_POSTURES.includes(target.data_posture), "delivery target data posture is invalid");
  assert(DELIVERY_TARGET_AUTHENTICATION.includes(target.authentication), "delivery target authentication is invalid");
  assert(["NOT_REQUIRED", "OWNER_DEFINED", "PROJECT_DEFINED"].includes(target.custom_domain), "delivery target custom domain is invalid");
  assert(Array.isArray(target.supported_scope) && target.supported_scope.every((value) => typeof value === "string" && value.trim().length > 0), "delivery target supported scope is invalid");
  assert(Array.isArray(target.operating_envelope) && target.operating_envelope.every((value) => typeof value === "string" && value.trim().length > 0), "delivery target operating envelope is invalid");
  assert(target.rollback_path === null || target.rollback_path === "EXACT_LAST_ACCEPTED_DEPLOYMENT", "delivery target rollback path is invalid");
  assert(DELIVERY_TARGET_PRODUCTION_CLAIMS.includes(target.production_claim), "delivery target production claim is invalid");
  assert(target.production_claim === productionClaimForMode(target.mode), "delivery target production claim does not match target mode");
  assert(Array.isArray(target.limitations) && target.limitations.length > 0 && target.limitations.every((value) => typeof value === "string"), "delivery target limitations are invalid");
  assert(Array.isArray(target.capability_ids) && target.capability_ids.every((value) => typeof value === "string"), "delivery target capability IDs are invalid");
  requireRecord(target.recommendation, "delivery target recommendation");
  assert(target.recommendation.managed_site_option?.family === "MANAGED_SITE"
    && target.recommendation.managed_site_option?.adapter_id === "GENERIC_MANAGED_SITE"
    && JSON.stringify(target.recommendation.managed_site_option?.supported_modes) === JSON.stringify(["PROTOTYPE", "LIMITED_PRODUCT"]), "managed site recommendation is missing or weakened");
  requireString(target.recommendation.rule, "delivery target recommendation rule");
  if (target.adapter_id === "GENERIC_MANAGED_SITE") {
    assert(target.family === "MANAGED_SITE", "generic managed-site adapter is not a managed site target");
    assert(["PROTOTYPE", "LIMITED_PRODUCT"].includes(target.mode), "generic managed-site adapter mode is outside its profiled support");
  }
  if (target.mode === "PROTOTYPE") assert(target.data_posture === "NONE_OR_SYNTHETIC", "prototype target data posture is unsafe");
  if (target.mode !== "PROTOTYPE") {
    assert(target.supported_scope.length > 0, "non-prototype delivery target lacks supported scope");
    assert(target.operating_envelope.length > 0, "non-prototype delivery target lacks operating envelope");
    assert(target.rollback_path === "EXACT_LAST_ACCEPTED_DEPLOYMENT", "non-prototype delivery target lacks exact rollback path");
  }
  const body = structuredClone(target);
  delete body.target_sha256;
  requireSha(target.target_sha256, "delivery target digest");
  assert(target.target_sha256 === canonicalDigest(body), "delivery target is not content-addressed");
  secretFree(target, "delivery target");
  return target;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("delivery target controller loaded\n");
