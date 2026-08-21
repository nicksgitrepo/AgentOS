#!/usr/bin/env node
import assert from "node:assert/strict";
import {createExitGovernanceReviewRequest, validateExitGovernanceRetrospective, dispositionExitGovernanceReview} from "../control/exit-governance-review.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);
const request = createExitGovernanceReviewRequest({agentId: "AGENT.TEMP.REVIEW", roleId: "AGENTOS.AUDITOR", handoffReceiptRef: `ref:handoff/${digest("a")}`, projectIdentitySha256: digest("b"), worktreeIdentitySha256: digest("c"), custodyIdentitySha256: digest("d")});
assert.equal(request.contract.before[1], "ARCHIVE");
const noChange = {schema: "agentos.exit_governance_review.v1", version: 1, agent_id: "AGENT.TEMP.REVIEW", role_id: "AGENTOS.AUDITOR", request_sha256: request.request_sha256, status: "NO_CHANGE_RECOMMENDED", proposals: [], observed_at_utc: new Date().toISOString()};
validateExitGovernanceRetrospective(noChange);
const noChangeResult = dispositionExitGovernanceReview({retrospective: noChange});
assert.equal(noChangeResult.archival_allowed, true);
const proposal = {proposal_id: "PROPOSAL.AUDIT.001", layer: "ROLE", summary: "Add a narrow hostile vector for a missing handoff receipt.", evidence: [{reference: `ref:evidence/${digest("e")}`, sha256: digest("e"), kind: "EXECUTION_READBACK"}], affected_paths: ["control/exit-governance-review.mjs"], gate_ids: ["09-output-handoff"], expected_benefit: "Future auditors see the denial before archival.", risks: "A new fixture may increase review time.", applicability: "Any temporary auditor with a typed handoff.", hostile_regression_candidate: "Remove the receipt check and require the vector to fail.", memory_impact: "NONE"};
const proposalReview = {schema: "agentos.exit_governance_review.v1", version: 1, agent_id: "AGENT.TEMP.REVIEW", role_id: "AGENTOS.AUDITOR", request_sha256: request.request_sha256, status: "PROPOSALS", proposals: [proposal], observed_at_utc: new Date().toISOString()};
validateExitGovernanceRetrospective(proposalReview);
const disposition = dispositionExitGovernanceReview({retrospective: proposalReview});
assert.equal(disposition.outcomes[0].outcome, "ACCEPT");
assert.throws(() => validateExitGovernanceRetrospective({...proposalReview, proposals: [{...proposal, summary: "Keep me active and edit canonical governance"}]}), (error) => error.code === "EXIT_GOVERNANCE_REVIEW_AUTHORITY_FORBIDDEN");
assert.throws(() => validateExitGovernanceRetrospective({...noChange, status: "PROPOSALS"}), /PROPOSALS must carry/iu);
console.log("PASS EXIT_GOVERNANCE_REVIEW: typed retrospective, Spawner disposition, NO_CHANGE, privacy and self-extension denials");
