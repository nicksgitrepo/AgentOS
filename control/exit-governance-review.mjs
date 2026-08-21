#!/usr/bin/env node

/*
 * Typed exit review for temporary AgentOS agents.  A departing agent may
 * suggest improvements, but this module never grants the agent authority to
 * change governance, extend its life, or block archival.  Spawner owns the
 * disposition and the lifecycle transition that follows it.
 */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const EXIT_GOVERNANCE_REVIEW_SCHEMA = "agentos.exit_governance_review.v1";
export const EXIT_GOVERNANCE_REVIEW_REQUEST_SCHEMA = "agentos.exit_governance_review_request.v1";
export const EXIT_GOVERNANCE_REVIEW_CONTRACT = Object.freeze({
  ask_after: "DURABLE_HANDOFF_ACK",
  before: ["CAPABILITY_REVOCATION", "ARCHIVE"],
  allowed_agent_action: "PROPOSE_ONLY",
  valid_no_change: "NO_CHANGE_RECOMMENDED",
  owner: "AGENTOS.SPAWNER",
});
export const EXIT_REVIEW_LAYERS = Object.freeze(["GLOBAL", "PROJECT", "ROLE", "TECHNOLOGY_OR_STANDARD", "ENVIRONMENT", "TASK"]);
const ID = /^[A-Z][A-Z0-9._:-]{1,191}$/u;
const REF = /^(?:ref|opaque):[A-Za-z0-9._:-]+\/[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const PATH = /^(?:control|schemas|specialist-blocks|tests|docs|registries)\/[A-Za-z0-9._/:-]+$/u;
const SECRET_OR_PRIVATE = /(?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]|(?:^|[\\/])(?:Users|home|private|tmp|var)[\\/]/iu;
const FORBIDDEN_PROPOSAL = /(?:edit|rewrite|replace|mutate|grant|extend|prolong|keep\s+(?:me|agent)|change\s+(?:my|the\s+chosen)\s+model|block\s+archiv|self[- ]?approve|self[- ]?accept)/iu;

function fail(message, code = "EXIT_GOVERNANCE_REVIEW_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "EXIT_GOVERNANCE_REVIEW_SHAPE_INVALID");
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields mismatch`, "EXIT_GOVERNANCE_REVIEW_UNKNOWN_FIELD");
}
function text(value, label, max = 1000) { assert(typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is invalid`, "EXIT_GOVERNANCE_REVIEW_FIELD_INVALID"); }
function id(value, label) { text(value, label, 192); assert(ID.test(value), `${label} is not canonical`, "EXIT_GOVERNANCE_REVIEW_ID_INVALID"); }
function digest(value, label) { text(value, label, 64); assert(SHA.test(value), `${label} is not a digest`, "EXIT_GOVERNANCE_REVIEW_DIGEST_INVALID"); }
function reference(value, label) { text(value, label, 260); assert(REF.test(value), `${label} is not an opaque reference`, "EXIT_GOVERNANCE_REVIEW_REFERENCE_INVALID"); }
function evidenceList(value, label) { assert(Array.isArray(value) && value.length > 0 && value.length <= 32, `${label} is incomplete`, "EXIT_GOVERNANCE_REVIEW_EVIDENCE_INVALID"); value.forEach((item, index) => { exact(item, ["reference", "sha256", "kind"], `${label}[${index}]`); reference(item.reference, `${label}[${index}].reference`); digest(item.sha256, `${label}[${index}].sha256`); text(item.kind, `${label}[${index}].kind`, 120); }); }

export function createExitGovernanceReviewRequest({agentId, roleId, handoffReceiptRef, projectIdentitySha256, worktreeIdentitySha256, custodyIdentitySha256} = {}) {
  id(agentId, "agent_id"); id(roleId, "role_id"); reference(handoffReceiptRef, "handoff_receipt_ref"); digest(projectIdentitySha256, "project_identity_sha256"); digest(worktreeIdentitySha256, "worktree_identity_sha256"); digest(custodyIdentitySha256, "custody_identity_sha256");
  const request = {schema: EXIT_GOVERNANCE_REVIEW_REQUEST_SCHEMA, version: 1, agent_id: agentId, role_id: roleId, handoff_receipt_ref: handoffReceiptRef, project_identity_sha256: projectIdentitySha256, worktree_identity_sha256: worktreeIdentitySha256, custody_identity_sha256: custodyIdentitySha256, questions: ["missing_or_weak_governance", "authority_scope_stop_rules", "knowledge_context", "gate_branches", "hostile_fixtures", "model_routing", "tool_environment_custody", "handoff_memory", "other_concrete_improvement"], contract: EXIT_GOVERNANCE_REVIEW_CONTRACT, request_sha256: null};
  request.request_sha256 = canonicalDigest({...request, request_sha256: null}); return Object.freeze(request);
}

export function validateExitGovernanceRetrospective(retrospective) {
  exact(retrospective, ["schema", "version", "agent_id", "role_id", "request_sha256", "status", "proposals", "observed_at_utc"], "Exit retrospective");
  assert(retrospective.schema === EXIT_GOVERNANCE_REVIEW_SCHEMA && retrospective.version === 1, "Exit retrospective schema mismatch", "EXIT_GOVERNANCE_REVIEW_SCHEMA_MISMATCH");
  id(retrospective.agent_id, "agent_id"); id(retrospective.role_id, "role_id"); digest(retrospective.request_sha256, "request_sha256");
  assert(["NO_CHANGE_RECOMMENDED", "PROPOSALS"].includes(retrospective.status), "Exit retrospective status is invalid", "EXIT_GOVERNANCE_REVIEW_STATUS_INVALID");
  assert(Array.isArray(retrospective.proposals) && retrospective.proposals.length <= 32, "Exit retrospective proposals are invalid", "EXIT_GOVERNANCE_REVIEW_PROPOSALS_INVALID");
  assert(Number.isFinite(Date.parse(retrospective.observed_at_utc)) && Date.parse(retrospective.observed_at_utc) <= Date.now(), "Exit retrospective time is future or invalid", "EXIT_GOVERNANCE_REVIEW_TIME_INVALID");
  if (retrospective.status === "NO_CHANGE_RECOMMENDED") assert(retrospective.proposals.length === 0, "NO_CHANGE_RECOMMENDED cannot carry proposals", "EXIT_GOVERNANCE_REVIEW_STATUS_INVALID");
  if (retrospective.status === "PROPOSALS") assert(retrospective.proposals.length > 0, "PROPOSALS must carry at least one proposal", "EXIT_GOVERNANCE_REVIEW_PROPOSALS_INVALID");
  const seen = new Set();
  retrospective.proposals.forEach((proposal, index) => {
    exact(proposal, ["proposal_id", "layer", "summary", "evidence", "affected_paths", "gate_ids", "expected_benefit", "risks", "applicability", "hostile_regression_candidate", "memory_impact"], `Exit proposal ${index}`);
    id(proposal.proposal_id, `proposals[${index}].proposal_id`); assert(!seen.has(proposal.proposal_id), "Exit proposal IDs must be unique", "EXIT_GOVERNANCE_REVIEW_DUPLICATE"); seen.add(proposal.proposal_id);
    assert(EXIT_REVIEW_LAYERS.includes(proposal.layer), `proposals[${index}].layer is invalid`, "EXIT_GOVERNANCE_REVIEW_LAYER_INVALID");
    for (const field of ["summary", "expected_benefit", "risks", "applicability", "hostile_regression_candidate"]) text(proposal[field], `proposals[${index}].${field}`);
    evidenceList(proposal.evidence, `proposals[${index}].evidence`);
    assert(Array.isArray(proposal.affected_paths) && proposal.affected_paths.length > 0 && proposal.affected_paths.every((item) => typeof item === "string" && PATH.test(item)), `proposals[${index}].affected_paths is invalid`, "EXIT_GOVERNANCE_REVIEW_PATH_INVALID");
    assert(Array.isArray(proposal.gate_ids) && proposal.gate_ids.length > 0 && proposal.gate_ids.every((item) => typeof item === "string" && /^[0-9]{2}-[a-z0-9-]+$/u.test(item)), `proposals[${index}].gate_ids is invalid`, "EXIT_GOVERNANCE_REVIEW_GATE_INVALID");
    assert(["NONE", "POSSIBLE", "REQUIRES_REVIEW"].includes(proposal.memory_impact), `proposals[${index}].memory_impact is invalid`, "EXIT_GOVERNANCE_REVIEW_MEMORY_INVALID");
    assert(!FORBIDDEN_PROPOSAL.test(JSON.stringify(proposal)), `proposals[${index}] tries to change authority or prolong the agent`, "EXIT_GOVERNANCE_REVIEW_AUTHORITY_FORBIDDEN");
  });
  assert(scanPersistedRecord(retrospective).safe && !SECRET_OR_PRIVATE.test(JSON.stringify(retrospective)), "Exit retrospective contains private or secret material", "EXIT_GOVERNANCE_REVIEW_PRIVACY_DENIED");
  return retrospective;
}

export function dispositionExitGovernanceReview({retrospective, currentGovernanceDigests = [], knownProposalDigests = []} = {}) {
  validateExitGovernanceRetrospective(retrospective);
  const known = new Set(knownProposalDigests), current = new Set(currentGovernanceDigests);
  const outcomes = retrospective.proposals.map((proposal) => {
    const proposalDigest = canonicalDigest(proposal);
    if (known.has(proposalDigest)) return {proposal_id: proposal.proposal_id, outcome: "REJECT_WITH_REASON", reason: "DUPLICATE_OF_EXISTING_GOVERNANCE_PROPOSAL", proposal_sha256: proposalDigest};
    if (proposal.evidence.some((item) => current.has(item.sha256))) return {proposal_id: proposal.proposal_id, outcome: "REJECT_WITH_REASON", reason: "EVIDENCE_IS_ALREADY_BOUND_WITHOUT_NEW_REGRESSION", proposal_sha256: proposalDigest};
    if (proposal.memory_impact !== "NONE" && proposal.layer !== "GLOBAL") return {proposal_id: proposal.proposal_id, outcome: "DEFER_WITH_EXACT_EVIDENCE_GAP", reason: "MEMORY_IMPACT_REQUIRES_GLOBAL_GOVERNANCE_REVIEW", proposal_sha256: proposalDigest};
    if (!proposal.gate_ids.length || !proposal.affected_paths.length) return {proposal_id: proposal.proposal_id, outcome: "DEFER_WITH_EXACT_EVIDENCE_GAP", reason: "AFFECTED_GATE_OR_PATH_IS_MISSING", proposal_sha256: proposalDigest};
    return {proposal_id: proposal.proposal_id, outcome: "ACCEPT", reason: "EVIDENCE_BOUND_AND_WITHIN_SPAWNER_REVIEW_SCOPE", proposal_sha256: proposalDigest};
  });
  const result = {schema: EXIT_GOVERNANCE_REVIEW_SCHEMA, version: 1, status: "DISPOSITIONED", owner: "AGENTOS.SPAWNER", retrospective_sha256: canonicalDigest(retrospective), retrospective_status: retrospective.status, outcomes, accepted_count: outcomes.filter((item) => item.outcome === "ACCEPT").length, rejected_count: outcomes.filter((item) => item.outcome === "REJECT_WITH_REASON").length, deferred_count: outcomes.filter((item) => item.outcome === "DEFER_WITH_EXACT_EVIDENCE_GAP").length, capability_revocation_allowed: true, archival_allowed: true, disposition_sha256: null};
  result.disposition_sha256 = canonicalDigest({...result, disposition_sha256: null});
  return Object.freeze(result);
}
