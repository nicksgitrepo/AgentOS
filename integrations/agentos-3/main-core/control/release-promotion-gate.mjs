#!/usr/bin/env node

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const RELEASE_PROMOTION_GATE_SCHEMA = "agentos.release_promotion_gate.v1";
export const RELEASE_PROMOTION_STATUSES = Object.freeze([
  "BLOCKED_STERILE_RELEASE_NOT_PROMOTED",
  "READY_FOR_EXPLICIT_PROMOTION",
]);
export const RELEASE_CHECKOUT_ROLES = Object.freeze([
  "ACTIVE_DEVELOPMENT_CHECKOUT",
  "STERILE_RELEASE_CHECKOUT",
]);
export const RELEASE_VERIFICATION_NAMES = Object.freeze([
  "ARCHITECTURE",
  "CANONICAL",
  "HYGIENE",
  "PORTABILITY",
  "RELEASE_SAFETY",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/u;
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|.*(?:credential|secret|password|token|private[_-]?key|id_rsa).*|.*\.(?:pem|key|p12|pfx))$/iu;
const CHECKOUT_FIELDS = ["role", "status", "commit_sha256", "tree_sha256", "artifact_sha256", "manifest_sha256", "verification_sha256"];

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

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256 or null`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function sortedUniqueStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values) && (allowEmpty || values.length > 0), `${label} must ${allowEmpty ? "be an array" : "not be empty"}`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function validateChangedPath(value, label) {
  requireString(value, label);
  assert(SAFE_PATH.test(value) && !SENSITIVE_PATH.test(value), `${label} is not a safe relative path`);
}

function validateCheckoutEvidence(evidence, role, label) {
  exactKeys(evidence, CHECKOUT_FIELDS, label);
  assert(evidence.role === role, `${label} role is invalid`);
  assert(["VERIFIED", "NOT_VERIFIED"].includes(evidence.status), `${label} status is invalid`);
  for (const field of ["commit_sha256", "tree_sha256", "artifact_sha256", "manifest_sha256", "verification_sha256"]) {
    requireSha(evidence[field], `${label} ${field}`, {nullable: true});
  }
  if (evidence.status === "VERIFIED") {
    for (const field of ["commit_sha256", "tree_sha256", "artifact_sha256", "manifest_sha256", "verification_sha256"]) {
      requireSha(evidence[field], `${label} verified ${field}`);
    }
  } else {
    for (const field of ["commit_sha256", "tree_sha256", "artifact_sha256", "manifest_sha256", "verification_sha256"]) {
      assert(evidence[field] === null, `${label} unverified evidence carries identity`);
    }
  }
}

function validateVerification(verification) {
  exactKeys(verification, RELEASE_VERIFICATION_NAMES, "release verification");
  for (const name of RELEASE_VERIFICATION_NAMES) assert(["PASS", "PENDING"].includes(verification[name]), `release verification result is invalid: ${name}`);
}

function requiredActionsFor(status, verification) {
  if (status === "READY_FOR_EXPLICIT_PROMOTION") return ["OBTAIN_EXPLICIT_MAINTAINER_PROMOTION"];
  const actions = [
    "OBTAIN_EXPLICIT_MAINTAINER_PROMOTION",
    "RERUN_CANONICAL_PORTABILITY_ARCHITECTURE_AND_HYGIENE_SUITES",
    "REVIEW_EXACT_CHANGED_PATHS",
    "VERIFY_STERILE_RELEASE_CHECKOUT",
  ];
  if (verification.RELEASE_SAFETY !== "PASS") actions.push("SUPPLY_PASSING_RELEASE_SAFETY_EVIDENCE");
  return actions.sort(compareUtf8);
}

export function compileReleasePromotionGate({
  sourceEvidence,
  sterileReleaseEvidence,
  verification,
  changedPaths = [],
  safetyGateSha256 = null,
  explicitMaintainerPromotion = false,
} = {}) {
  validateCheckoutEvidence(sourceEvidence, "ACTIVE_DEVELOPMENT_CHECKOUT", "release source evidence");
  validateCheckoutEvidence(sterileReleaseEvidence, "STERILE_RELEASE_CHECKOUT", "sterile release evidence");
  validateVerification(verification);
  sortedUniqueStrings(changedPaths, "release changed paths", {allowEmpty: true});
  changedPaths.forEach((value) => validateChangedPath(value, "release changed path"));
  requireSha(safetyGateSha256, "release safety gate digest", {nullable: true});
  assert(typeof explicitMaintainerPromotion === "boolean", "explicit maintainer promotion must be boolean");
  const ready = sourceEvidence.status === "VERIFIED"
    && sterileReleaseEvidence.status === "VERIFIED"
    && Object.values(verification).every((value) => value === "PASS")
    && explicitMaintainerPromotion === false;
  const status = ready ? "READY_FOR_EXPLICIT_PROMOTION" : "BLOCKED_STERILE_RELEASE_NOT_PROMOTED";
  const gate = {
    schema: RELEASE_PROMOTION_GATE_SCHEMA,
    version: 1,
    release_candidate: "2.1rc",
    status,
    source: sourceEvidence,
    sterile_release: sterileReleaseEvidence,
    verification,
    changed_paths: [...changedPaths],
    safety_gate_sha256: safetyGateSha256,
    publishing: false,
    pushes: false,
    merges: false,
    deployment: false,
    activation: false,
    action_taken: "NONE",
    blockers: status === "BLOCKED_STERILE_RELEASE_NOT_PROMOTED" ? ["STERILE_RELEASE_NOT_PROMOTED"] : [],
    required_actions: requiredActionsFor(status, verification),
    explicit_maintainer_promotion: explicitMaintainerPromotion,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateReleasePromotionGate(gate);
}

export function validateReleasePromotionGate(gate) {
  exactKeys(gate, [
    "schema", "version", "release_candidate", "status", "source", "sterile_release", "verification", "changed_paths",
    "safety_gate_sha256", "publishing", "pushes", "merges", "deployment", "activation", "action_taken", "blockers", "required_actions",
    "explicit_maintainer_promotion", "gate_sha256",
  ], "release promotion gate");
  assert(gate.schema === RELEASE_PROMOTION_GATE_SCHEMA && gate.version === 1, "release promotion gate identity is invalid");
  assert(gate.release_candidate === "2.1rc", "release promotion gate candidate is invalid");
  assert(RELEASE_PROMOTION_STATUSES.includes(gate.status), "release promotion gate status is invalid");
  validateCheckoutEvidence(gate.source, "ACTIVE_DEVELOPMENT_CHECKOUT", "release source evidence");
  validateCheckoutEvidence(gate.sterile_release, "STERILE_RELEASE_CHECKOUT", "sterile release evidence");
  validateVerification(gate.verification);
  sortedUniqueStrings(gate.changed_paths, "release changed paths", {allowEmpty: true});
  gate.changed_paths.forEach((value) => validateChangedPath(value, "release changed path"));
  requireSha(gate.safety_gate_sha256, "release safety gate digest", {nullable: true});
  for (const field of ["publishing", "pushes", "merges", "deployment", "activation"]) assert(gate[field] === false, `release promotion gate ${field} must remain false`);
  assert(gate.action_taken === "NONE", "release promotion gate must not perform an action");
  sortedUniqueStrings(gate.blockers, "release blockers", {allowEmpty: true});
  sortedUniqueStrings(gate.required_actions, "release required actions");
  assert(typeof gate.explicit_maintainer_promotion === "boolean", "release promotion authority is invalid");
  const ready = gate.source.status === "VERIFIED"
    && gate.sterile_release.status === "VERIFIED"
    && Object.values(gate.verification).every((value) => value === "PASS")
    && gate.safety_gate_sha256 !== null
    && gate.explicit_maintainer_promotion === false
  const expectedStatus = ready ? "READY_FOR_EXPLICIT_PROMOTION" : "BLOCKED_STERILE_RELEASE_NOT_PROMOTED";
  assert(gate.status === expectedStatus, "release promotion gate status does not match evidence");
  if (gate.status === "BLOCKED_STERILE_RELEASE_NOT_PROMOTED") assert(gate.blockers.includes("STERILE_RELEASE_NOT_PROMOTED"), "release blocker is not typed");
  else assert(gate.blockers.length === 0, "ready release promotion gate carries a blocker");
  assert(JSON.stringify(gate.required_actions) === JSON.stringify(requiredActionsFor(gate.status, gate.verification)), "release promotion actions do not match status");
  requireSha(gate.gate_sha256, "release promotion gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "release promotion gate is not content-addressed");
  return gate;
}

export function compileBlockedDevelopmentPromotionGate({changedPaths = []} = {}) {
  return compileReleasePromotionGate({
    sourceEvidence: {role: "ACTIVE_DEVELOPMENT_CHECKOUT", status: "NOT_VERIFIED", commit_sha256: null, tree_sha256: null, artifact_sha256: null, manifest_sha256: null, verification_sha256: null},
    sterileReleaseEvidence: {role: "STERILE_RELEASE_CHECKOUT", status: "NOT_VERIFIED", commit_sha256: null, tree_sha256: null, artifact_sha256: null, manifest_sha256: null, verification_sha256: null},
    verification: {ARCHITECTURE: "PENDING", CANONICAL: "PENDING", HYGIENE: "PENDING", PORTABILITY: "PENDING", RELEASE_SAFETY: "PENDING"},
    changedPaths,
  });
}
