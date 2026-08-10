#!/usr/bin/env node

/* Joins compatibility, replay, and model evidence before promotion. */

import {
  assert,
  assertPortableRecord,
  digestWithout,
  exactKeys,
  privacySummary,
  requireBoolean,
  requireSha,
  requireUtc,
} from "./release-common.mjs";
import {requireCompatibilityPass, validateCompatibilityEvidence} from "./release-compatibility.mjs";
import {requirePolicyReplayPass, validatePolicyReplay} from "./release-policy-replay.mjs";
import {requireReleaseModelPass, validateReleaseModelCheck} from "./release-model-check.mjs";

export const RELEASE_SAFETY_GATE_SCHEMA = "agentos.release_safety_gate.v1";
export const INDEPENDENT_RELEASE_AUDITOR = "INDEPENDENT_RELEASE_AUDITOR";

const SAFETY_FIELDS = [
  "schema", "version", "status", "subject_candidate_sha256", "release_version", "migration_plan_sha256",
  "compatibility_evidence_sha256", "policy_replay_sha256", "model_check_sha256", "checker_role",
  "independent_checker_sha256", "owner_review_required", "activation", "checked_at_utc", "privacy", "safety_sha256",
];

export function validateReleaseSafetyGate(value, {compatibility = null, policyReplay = null, modelCheck = null} = {}) {
  exactKeys(value, SAFETY_FIELDS, "release safety gate");
  assert(value.schema === RELEASE_SAFETY_GATE_SCHEMA && value.version === 1, "release safety gate identity is invalid");
  assert(["PASS", "BLOCKED"].includes(value.status), "release safety gate status is invalid");
  requireSha(value.subject_candidate_sha256, "safety subject candidate");
  requireSha(value.migration_plan_sha256, "safety migration plan");
  requireSha(value.compatibility_evidence_sha256, "safety compatibility evidence");
  requireSha(value.policy_replay_sha256, "safety policy replay");
  requireSha(value.model_check_sha256, "safety model check");
  assert(value.checker_role === INDEPENDENT_RELEASE_AUDITOR, "safety checker role is invalid");
  requireSha(value.independent_checker_sha256, "safety independent checker");
  requireBoolean(value.owner_review_required, "safety owner review flag");
  assert(value.owner_review_required === true, "safety gate must require owner review");
  assert(value.activation === false, "safety gate cannot activate a release");
  requireUtc(value.checked_at_utc, "safety check time");
  exactKeys(value.privacy, ["safe", "categories"], "safety privacy");
  assert(value.privacy.safe === true, "safety privacy check failed");
  for (const category of Object.keys(value.privacy.categories)) assert(value.privacy.categories[category] === 0, `safety privacy category is nonzero: ${category}`);
  if (compatibility !== null) {
    validateCompatibilityEvidence(compatibility);
    assert(compatibility.compatibility_sha256 === value.compatibility_evidence_sha256, "safety compatibility evidence differs");
    assert(compatibility.subject_candidate_sha256 === value.subject_candidate_sha256, "safety compatibility subject differs");
    assert(compatibility.release_version === value.release_version, "safety compatibility release differs");
    assert(compatibility.migration_plan_sha256 === value.migration_plan_sha256, "safety migration plan differs");
    assert(compatibility.independent_checker_sha256 === value.independent_checker_sha256, "safety compatibility checker differs");
  }
  if (policyReplay !== null) {
    validatePolicyReplay(policyReplay);
    assert(policyReplay.replay_sha256 === value.policy_replay_sha256, "safety policy replay differs");
    assert(policyReplay.subject_candidate_sha256 === value.subject_candidate_sha256, "safety replay subject differs");
    assert(policyReplay.independent_checker_sha256 === value.independent_checker_sha256, "safety replay checker differs");
  }
  if (modelCheck !== null) {
    validateReleaseModelCheck(modelCheck);
    assert(modelCheck.model_sha256 === value.model_check_sha256, "safety model check differs");
    assert(modelCheck.subject_candidate_sha256 === value.subject_candidate_sha256, "safety model subject differs");
    assert(modelCheck.independent_checker_sha256 === value.independent_checker_sha256, "safety model checker differs");
  }
  if (value.status === "PASS") {
    assert(compatibility !== null && compatibility.status === "PASS", "passing safety gate lacks passing compatibility evidence");
    assert(policyReplay !== null && policyReplay.status === "PASS", "passing safety gate lacks passing policy replay");
    assert(modelCheck !== null && modelCheck.status === "PASS", "passing safety gate lacks passing model check");
  }
  requireSha(value.safety_sha256, "release safety gate digest");
  assert(value.safety_sha256 === digestWithout(value, "safety_sha256"), "release safety gate digest does not match content");
  assertPortableRecord(value, "release safety gate");
  return value;
}

export function compileReleaseSafetyGate({subjectCandidateSha256, releaseVersion, compatibility, policyReplay, modelCheck, independentCheckerSha256, checkedAtUtc} = {}) {
  requireCompatibilityPass(compatibility);
  requirePolicyReplayPass(policyReplay);
  requireReleaseModelPass(modelCheck);
  requireSha(subjectCandidateSha256, "safety subject candidate");
  requireSha(independentCheckerSha256, "safety independent checker");
  requireUtc(checkedAtUtc, "safety check time");
  assert(compatibility.subject_candidate_sha256 === subjectCandidateSha256, "safety compatibility subject differs");
  assert(policyReplay.subject_candidate_sha256 === subjectCandidateSha256, "safety replay subject differs");
  assert(modelCheck.subject_candidate_sha256 === subjectCandidateSha256, "safety model subject differs");
  assert(compatibility.release_version === releaseVersion, "safety compatibility release differs");
  assert(independentCheckerSha256 === compatibility.independent_checker_sha256, "safety checker differs from compatibility checker");
  assert(independentCheckerSha256 === policyReplay.independent_checker_sha256, "safety checker differs from replay checker");
  assert(independentCheckerSha256 === modelCheck.independent_checker_sha256, "safety checker differs from model checker");
  const value = {
    schema: RELEASE_SAFETY_GATE_SCHEMA,
    version: 1,
    status: "PASS",
    subject_candidate_sha256: subjectCandidateSha256,
    release_version: releaseVersion,
    migration_plan_sha256: compatibility.migration_plan_sha256,
    compatibility_evidence_sha256: compatibility.compatibility_sha256,
    policy_replay_sha256: policyReplay.replay_sha256,
    model_check_sha256: modelCheck.model_sha256,
    checker_role: INDEPENDENT_RELEASE_AUDITOR,
    independent_checker_sha256: independentCheckerSha256,
    owner_review_required: true,
    activation: false,
    checked_at_utc: checkedAtUtc,
    privacy: privacySummary({
      schema: RELEASE_SAFETY_GATE_SCHEMA,
      version: 1,
      status: "PASS",
      subject_candidate_sha256: subjectCandidateSha256,
      release_version: releaseVersion,
      migration_plan_sha256: compatibility.migration_plan_sha256,
      compatibility_evidence_sha256: compatibility.compatibility_sha256,
      policy_replay_sha256: policyReplay.replay_sha256,
      model_check_sha256: modelCheck.model_sha256,
      checker_role: INDEPENDENT_RELEASE_AUDITOR,
      independent_checker_sha256: independentCheckerSha256,
      owner_review_required: true,
      activation: false,
      checked_at_utc: checkedAtUtc,
    }),
    safety_sha256: null,
  };
  value.safety_sha256 = digestWithout(value, "safety_sha256");
  return validateReleaseSafetyGate(value, {compatibility, policyReplay, modelCheck});
}

export function requireReleaseSafetyPass(value, evidence) {
  validateReleaseSafetyGate(value, evidence);
  assert(value.status === "PASS", "release safety gate is not passing");
  return value;
}

export function validateReleaseSafetyBundle(bundle) {
  exactKeys(bundle, ["gate", "compatibility", "policyReplay", "modelCheck"], "release safety evidence bundle");
  validateReleaseSafetyGate(bundle.gate, {
    compatibility: bundle.compatibility,
    policyReplay: bundle.policyReplay,
    modelCheck: bundle.modelCheck,
  });
  assert(bundle.gate.status === "PASS", "release safety evidence bundle is not passing");
  return bundle;
}
