#!/usr/bin/env node

/* Deterministic before/after governance replay evidence. */

import {
  assert,
  assertPortableRecord,
  compareUtf8,
  digestWithout,
  exactKeys,
  privacySummary,
  requireBoolean,
  requireIdentifier,
  requireSha,
  requireUtc,
  sortedUnique,
} from "./release-common.mjs";

export const POLICY_REPLAY_SCHEMA = "agentos.release_policy_replay.v1";
export const POLICY_REPLAY_RESULTS = Object.freeze(["PASS", "FAIL", "PENDING"]);

const REPLAY_FIELDS = [
  "schema", "version", "status", "subject_candidate_sha256", "before_policy_sha256", "after_policy_sha256",
  "cases", "changed_decision_case_ids", "changed_authority_case_ids", "owner_review_required",
  "independent_checker_sha256", "replayed_at_utc", "privacy", "replay_sha256",
];
const CASE_FIELDS = [
  "case_id", "input_sha256", "before_decision_sha256", "after_decision_sha256", "before_authority_sha256",
  "after_authority_sha256", "decision_changed", "authority_changed", "result", "evidence_sha256",
];

function sortCases(cases) {
  return [...cases].sort((left, right) => compareUtf8(left.case_id, right.case_id));
}

export function validatePolicyReplayCase(value, index = 0) {
  exactKeys(value, CASE_FIELDS, `policy replay case ${index}`);
  requireIdentifier(value.case_id, `policy replay case ${index} ID`);
  for (const field of ["input_sha256", "before_decision_sha256", "after_decision_sha256", "before_authority_sha256", "after_authority_sha256", "evidence_sha256"]) requireSha(value[field], `policy replay case ${index} ${field}`);
  requireBoolean(value.decision_changed, `policy replay case ${index} decision_changed`);
  requireBoolean(value.authority_changed, `policy replay case ${index} authority_changed`);
  assert(value.decision_changed === (value.before_decision_sha256 !== value.after_decision_sha256), `policy replay case ${index} decision diff is inconsistent`);
  assert(value.authority_changed === (value.before_authority_sha256 !== value.after_authority_sha256), `policy replay case ${index} authority diff is inconsistent`);
  assert(POLICY_REPLAY_RESULTS.includes(value.result), `policy replay case ${index} result is invalid`);
  return value;
}

export function validatePolicyReplay(value) {
  exactKeys(value, REPLAY_FIELDS, "policy replay");
  assert(value.schema === POLICY_REPLAY_SCHEMA && value.version === 1, "policy replay identity is invalid");
  assert(["PASS", "BLOCKED"].includes(value.status), "policy replay status is invalid");
  requireSha(value.subject_candidate_sha256, "policy replay subject candidate");
  requireSha(value.before_policy_sha256, "policy replay before policy");
  requireSha(value.after_policy_sha256, "policy replay after policy");
  assert(Array.isArray(value.cases) && value.cases.length > 0, "policy replay cases are required");
  const ordered = sortCases(value.cases);
  assert(JSON.stringify(value.cases) === JSON.stringify(ordered), "policy replay cases must be sorted");
  const caseIds = new Set();
  const changedDecisions = [];
  const changedAuthority = [];
  value.cases.forEach((item, index) => {
    validatePolicyReplayCase(item, index);
    assert(!caseIds.has(item.case_id), "policy replay case IDs must be unique");
    caseIds.add(item.case_id);
    if (item.decision_changed) changedDecisions.push(item.case_id);
    if (item.authority_changed) changedAuthority.push(item.case_id);
  });
  sortedUnique(value.changed_decision_case_ids, "changed decision case IDs", {allowEmpty: true});
  sortedUnique(value.changed_authority_case_ids, "changed authority case IDs", {allowEmpty: true});
  assert(JSON.stringify(value.changed_decision_case_ids) === JSON.stringify(changedDecisions.sort(compareUtf8)), "policy replay decision diff list is stale");
  assert(JSON.stringify(value.changed_authority_case_ids) === JSON.stringify(changedAuthority.sort(compareUtf8)), "policy replay authority diff list is stale");
  assert(value.owner_review_required === (value.changed_decision_case_ids.length > 0 || value.changed_authority_case_ids.length > 0), "policy replay owner-review flag is stale");
  requireSha(value.independent_checker_sha256, "policy replay independent checker");
  requireUtc(value.replayed_at_utc, "policy replay time");
  exactKeys(value.privacy, ["safe", "categories"], "policy replay privacy");
  assert(value.privacy.safe === true, "policy replay privacy check failed");
  for (const category of Object.keys(value.privacy.categories)) assert(value.privacy.categories[category] === 0, `policy replay privacy category is nonzero: ${category}`);
  const expectedStatus = value.cases.every((item) => item.result === "PASS") ? "PASS" : "BLOCKED";
  assert(value.status === expectedStatus, "policy replay status does not match cases");
  requireSha(value.replay_sha256, "policy replay digest");
  assert(value.replay_sha256 === digestWithout(value, "replay_sha256"), "policy replay digest does not match content");
  assertPortableRecord(value, "policy replay");
  return value;
}

export function compilePolicyReplay({subjectCandidateSha256, beforePolicySha256, afterPolicySha256, cases, independentCheckerSha256, replayedAtUtc} = {}) {
  requireSha(subjectCandidateSha256, "policy replay subject candidate");
  requireSha(beforePolicySha256, "policy replay before policy");
  requireSha(afterPolicySha256, "policy replay after policy");
  requireSha(independentCheckerSha256, "policy replay independent checker");
  requireUtc(replayedAtUtc, "policy replay time");
  assert(Array.isArray(cases), "policy replay cases are required");
  const ordered = sortCases(cases.map((item) => ({...item})));
  const changedDecisions = ordered.filter((item) => item.before_decision_sha256 !== item.after_decision_sha256).map((item) => item.case_id).sort(compareUtf8);
  const changedAuthority = ordered.filter((item) => item.before_authority_sha256 !== item.after_authority_sha256).map((item) => item.case_id).sort(compareUtf8);
  const replay = {
    schema: POLICY_REPLAY_SCHEMA,
    version: 1,
    status: ordered.length > 0 && ordered.every((item) => item.result === "PASS") ? "PASS" : "BLOCKED",
    subject_candidate_sha256: subjectCandidateSha256,
    before_policy_sha256: beforePolicySha256,
    after_policy_sha256: afterPolicySha256,
    cases: ordered,
    changed_decision_case_ids: changedDecisions,
    changed_authority_case_ids: changedAuthority,
    owner_review_required: changedDecisions.length > 0 || changedAuthority.length > 0,
    independent_checker_sha256: independentCheckerSha256,
    replayed_at_utc: replayedAtUtc,
    privacy: privacySummary({
      schema: POLICY_REPLAY_SCHEMA,
      version: 1,
      subject_candidate_sha256: subjectCandidateSha256,
      before_policy_sha256: beforePolicySha256,
      after_policy_sha256: afterPolicySha256,
      cases: ordered,
      changed_decision_case_ids: changedDecisions,
      changed_authority_case_ids: changedAuthority,
      owner_review_required: changedDecisions.length > 0 || changedAuthority.length > 0,
      independent_checker_sha256: independentCheckerSha256,
      replayed_at_utc: replayedAtUtc,
    }),
    replay_sha256: null,
  };
  replay.replay_sha256 = digestWithout(replay, "replay_sha256");
  return validatePolicyReplay(replay);
}

export function requirePolicyReplayPass(value) {
  validatePolicyReplay(value);
  assert(value.status === "PASS", "policy replay is not passing");
  return value;
}
