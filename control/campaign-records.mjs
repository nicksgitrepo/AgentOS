import {assert, compareUtf8, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {assertOpaqueReference, isOpaqueReference, opaqueReference, sessionReference} from "./opaque-reference.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function publicSession(value, plan) {
  return isOpaqueReference(value, "session")
    ? value
    : sessionReference(value, {...plan.source, goal_id: plan.goal_id});
}

function publicThread(value, plan) {
  return isOpaqueReference(value, "thread")
    ? value
    : opaqueReference("thread", value, `${plan.project_id}:${plan.campaign_id}:${plan.goal_id}`);
}

export function normalizeCandidate(candidate, plan) {
  return {...candidate, worker_session_id: publicSession(candidate.worker_session_id, plan)};
}

export function normalizeAcceptance(acceptance, plan) {
  const auditorReadback = {...acceptance.auditor_readback};
  if (auditorReadback.thread_id !== undefined) auditorReadback.thread_id = publicThread(auditorReadback.thread_id, plan);
  if (auditorReadback.host_id !== undefined) auditorReadback.host_id = publicSession(auditorReadback.host_id, plan);
  const normalized = {
    ...acceptance,
    reviewer_session_id: publicSession(acceptance.reviewer_session_id, plan),
    auditor_readback: auditorReadback,
    lane_results: acceptance.lane_results.map((item) => ({...item, worker_session_id: publicSession(item.worker_session_id, plan)})),
    acceptance_digest: null,
  };
  normalized.acceptance_digest = digestWithout(normalized, "acceptance_digest");
  return normalized;
}

export function validateCandidate(candidate, assignment, phase) {
  exactKeys(candidate, ["status", "phase_id", "lane_id", "result_digest", "worker_session_id", "result_type", "summary", "artifact_sha256", "evidence_sha256"], "lane candidate");
  assert(candidate.status === "AUDIT_CANDIDATE" && candidate.phase_id === phase.phase_id && candidate.lane_id === assignment.lane_id, "lane candidate identity differs");
  assert(DIGEST.test(candidate.result_digest), "lane candidate result digest is invalid");
  assertOpaqueReference(candidate.worker_session_id, "session", "lane candidate worker session");
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(candidate.result_type), "lane candidate result type is invalid");
  nonempty(candidate.summary, "lane candidate summary");
  assert(DIGEST.test(candidate.artifact_sha256) && DIGEST.test(candidate.evidence_sha256), "lane candidate evidence is invalid");
  return candidate;
}

export function validateAuditorReadback(readback, plan, phase) {
  exactKeys(readback, ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "phase_id", "role_id", "source_commit", "source_tree", "worktree_id"], "Auditor readback");
  for (const [value, label] of [[readback.thread_id, "Auditor readback.thread_id"], [readback.host_id, "Auditor readback.host_id"], [readback.project_id, "Auditor readback.project_id"], [readback.campaign_id, "Auditor readback.campaign_id"], [readback.campaign_version, "Auditor readback.campaign_version"], [readback.goal_id, "Auditor readback.goal_id"], [readback.phase_id, "Auditor readback.phase_id"], [readback.worktree_id, "Auditor readback.worktree_id"]]) nonempty(value, label);
  assertOpaqueReference(readback.thread_id, "thread", "Auditor readback.thread_id");
  assertOpaqueReference(readback.host_id, "session", "Auditor readback.host_id");
  assert(readback.role_id === "INDEPENDENT_AUDITOR", "Auditor readback role is invalid");
  assert(readback.project_id === plan.project_id && readback.campaign_id === plan.campaign_id && readback.campaign_version === plan.campaign_version && readback.goal_id === plan.goal_id && readback.phase_id === phase.phase_id, "Auditor readback campaign identity differs");
  assert(readback.source_commit === plan.source.source_commit && readback.source_tree === plan.source.source_tree && readback.worktree_id === plan.source.worktree_id, "Auditor readback source identity differs");
  return readback;
}

export function validatePhaseAcceptance(acceptance, phase, candidates, plan) {
  exactKeys(acceptance, ["status", "reviewer_role_id", "reviewer_session_id", "auditor_readback", "evidence_sha256", "reason", "lane_results", "reviewed_lane_ids", "acceptance_digest"], "phase acceptance");
  assertPortableRecord(acceptance, "phase acceptance");
  assert(acceptance.status === "ACCEPTED" && acceptance.reviewer_role_id === "INDEPENDENT_AUDITOR", "phase acceptance is not independent");
  assertOpaqueReference(acceptance.reviewer_session_id, "session", "phase acceptance reviewer session");
  const auditorReadback = validateAuditorReadback(acceptance.auditor_readback, plan, phase);
  assert(acceptance.reviewer_session_id === auditorReadback.host_id, "phase acceptance reviewer does not match Auditor readback");
  assert(DIGEST.test(acceptance.evidence_sha256), "phase acceptance evidence is invalid");
  nonempty(acceptance.reason, "phase acceptance reason");
  assert(Array.isArray(acceptance.lane_results) && acceptance.lane_results.length === candidates.length, "phase acceptance lane count differs");
  sortedUniqueStrings(acceptance.reviewed_lane_ids, "phase acceptance reviewed_lane_ids");
  const expected = new Map(candidates.map((candidate) => [candidate.lane_id, candidate]));
  assert(expected.size === candidates.length, "phase candidates contain duplicate lanes");
  assert(new Set(candidates.map((candidate) => candidate.worker_session_id)).size === candidates.length, "phase candidates reuse a worker session");
  const seen = new Set();
  for (const [index, item] of acceptance.lane_results.entries()) {
    exactKeys(item, ["lane_id", "result_digest", "worker_session_id"], `phase acceptance lane ${index}`);
    assertOpaqueReference(item.worker_session_id, "session", `phase acceptance lane ${index}.worker_session_id`);
    const candidate = expected.get(item.lane_id);
    assert(candidate && !seen.has(item.lane_id), `phase acceptance lane ${item.lane_id} is missing or duplicated`);
    assert(item.result_digest === candidate.result_digest && item.worker_session_id === candidate.worker_session_id, `phase acceptance lane ${item.lane_id} differs from candidate`);
    assert(item.worker_session_id !== acceptance.reviewer_session_id, "Auditor cannot accept its own result");
    seen.add(item.lane_id);
  }
  assert(seen.size === expected.size, "phase acceptance did not cover every lane");
  assert(JSON.stringify(acceptance.reviewed_lane_ids) === JSON.stringify([...expected.keys()].sort(compareUtf8)), "phase acceptance reviewed lane coverage differs");
  assert(DIGEST.test(acceptance.acceptance_digest) && acceptance.acceptance_digest === digestWithout(acceptance, "acceptance_digest"), "phase acceptance digest does not match content");
  return acceptance;
}
