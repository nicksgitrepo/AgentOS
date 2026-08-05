#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileDeliveryChoice, authorizeSelectedDelivery, validateDeliveryChoice} from "../control/delivery-closure.mjs";
import {compileAcceptedLiveClosure, compileCheckpoint, compileDeploymentReceipt, compileLiveAuditReceipt, validateAcceptedLiveClosure} from "../control/live-closure.mjs";
import {createPersistentRole} from "../control/persistent-role.mjs";
import {digestWithout} from "../control/canonical-json.mjs";

const source_commit = "a".repeat(40);
const source_tree = "b".repeat(40);
const accepted_result_digest = "c".repeat(64);
const final_audit_digest = "d".repeat(64);
const common = {
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "VERSION-001",
  goal_id: "GOAL-001",
  accepted_result_digest,
  final_audit_digest,
  source_commit,
  source_tree,
  worktree_id: "WORKTREE-001",
  environment_id: "ENV-001",
  selected_at_utc: "2026-01-01T00:20:00.000Z",
};
const owner_approval = {
  decision_id: "DECISION-001",
  decision: "APPROVE",
  actor_digest: "e".repeat(64),
  accepted_result_digest,
  final_audit_digest,
  decided_at_utc: "2026-01-01T00:19:00.000Z",
  digest: null,
};
owner_approval.digest = digestWithout(owner_approval, "digest");
const runtime = createPersistentRole({
  role_id: "RUNTIME",
  project_id: common.project_id,
  environment_id: common.environment_id,
  host_session_id: "RUNTIME-SESSION-001",
  source_commit,
  source_tree,
  governance_digest: "f".repeat(64),
  created_at_utc: "2026-01-01T00:00:00.000Z",
});

const deploy = compileDeliveryChoice({choice_id: "CHOICE-DEPLOY-001", mode: "DEPLOY", ...common, owner_approval});
assert.equal(validateDeliveryChoice(deploy).digest, deploy.digest);
const deployRequest = authorizeSelectedDelivery(runtime, deploy, {
  request_id: "REQUEST-DEPLOY-001",
  reason: "The owner selected deployment after the accepted result and final audit.",
  requested_at_utc: "2026-01-01T00:21:00.000Z",
});
assert.equal(deployRequest.action, "DEPLOY");
assert.equal(deployRequest.scope_digest, deploy.digest);
assert.equal(deployRequest.owner_approval.digest, owner_approval.digest);

const local = compileDeliveryChoice({choice_id: "CHOICE-LOCAL-001", mode: "LOCAL_ONLY", ...common, owner_approval});
const localAuthorization = authorizeSelectedDelivery(runtime, local, {
  request_id: "REQUEST-LOCAL-001",
  reason: "The owner selected a local accepted result only.",
  requested_at_utc: "2026-01-01T00:21:00.000Z",
});
assert.equal(localAuthorization.status, "NO_EXTERNAL_ACTION");
assert.equal(localAuthorization.choice_digest, local.digest);

const mismatchedApproval = {...owner_approval, accepted_result_digest: "0".repeat(64), digest: null};
mismatchedApproval.digest = digestWithout(mismatchedApproval, "digest");
assert.throws(() => compileDeliveryChoice({choice_id: "CHOICE-BAD-001", mode: "DEPLOY", ...common, owner_approval: mismatchedApproval}), /does not name/u);
assert.throws(() => compileDeliveryChoice({choice_id: "CHOICE-BAD-002", mode: "DEPLOY", ...common, owner_approval: {...owner_approval, decision: "REJECT"}}), /decision is not APPROVE/u);
assert.throws(() => authorizeSelectedDelivery({...runtime, project_id: "OTHER-PROJECT", digest: digestWithout({...runtime, project_id: "OTHER-PROJECT"}, "digest")}, deploy, {request_id: "REQUEST-BAD-001", reason: "wrong Runtime", requested_at_utc: "2026-01-01T00:21:00.000Z"}), /persistent role digest does not match|project/u);
assert.throws(() => validateDeliveryChoice({...deploy, final_audit_digest: "0".repeat(64)}), /owner approval does not name|digest does not match/u);

const localCheckpoint = compileCheckpoint({worktree_id: common.worktree_id, commit: source_commit, tree: source_tree, remote_commit: "NOT_PUSHED", remote_tree: "NOT_PUSHED", clean: false, pushed: false, observed_by_role: "RUNTIME", observed_by_session: "RUNTIME-SESSION-001", observed_at_utc: "2026-01-01T00:22:00.000Z"});
assert.equal(localCheckpoint.pushed, false);
const pushedCheckpoint = compileCheckpoint({worktree_id: common.worktree_id, commit: source_commit, tree: source_tree, remote_commit: source_commit, remote_tree: source_tree, clean: true, pushed: true, observed_by_role: "RUNTIME", observed_by_session: "RUNTIME-SESSION-001", observed_at_utc: "2026-01-01T00:23:00.000Z"});
assert.equal(pushedCheckpoint.remote_tree, source_tree);
assert.throws(() => compileCheckpoint({worktree_id: common.worktree_id, commit: source_commit, tree: source_tree, remote_commit: "0".repeat(40), remote_tree: source_tree, clean: true, pushed: true, observed_by_role: "RUNTIME", observed_by_session: "RUNTIME-SESSION-001", observed_at_utc: "2026-01-01T00:23:00.000Z"}), /remote-equal/u);
assert.throws(() => compileCheckpoint({worktree_id: common.worktree_id, commit: source_commit, tree: source_tree, remote_commit: source_commit, remote_tree: source_tree, clean: false, pushed: true, observed_by_role: "RUNTIME", observed_by_session: "RUNTIME-SESSION-001", observed_at_utc: "2026-01-01T00:23:00.000Z"}), /clean/u);

const deployment = compileDeploymentReceipt({final_candidate_commit: source_commit, final_candidate_tree: source_tree, deployed_identity: "DEPLOYMENT-001", rollback_identity: "ROLLBACK-001", runtime_session_id: "RUNTIME-SESSION-001", deployed_at_utc: "2026-01-01T00:24:00.000Z"});
const liveAudit = compileLiveAuditReceipt({final_candidate_commit: source_commit, final_candidate_tree: source_tree, deployed_identity: deployment.deployed_identity, independent_audit_identity: "AUDITOR-SESSION-001", audited_at_utc: "2026-01-01T00:25:00.000Z"});
const closure = compileAcceptedLiveClosure({delivery_choice: deploy, deployment_receipt: deployment, live_audit_receipt: liveAudit, closed_at_utc: "2026-01-01T00:26:00.000Z"});
assert.equal(validateAcceptedLiveClosure(closure, {delivery_choice: deploy, runtime_session_id: deployment.runtime_session_id}).digest, closure.digest);
assert.throws(() => compileLiveAuditReceipt({final_candidate_commit: source_commit, final_candidate_tree: source_tree, deployed_identity: deployment.deployed_identity, independent_audit_identity: deployment.deployed_identity, audited_at_utc: "2026-01-01T00:25:00.000Z"}), /independent/u);
const foreignAudit = compileLiveAuditReceipt({final_candidate_commit: "f".repeat(40), final_candidate_tree: "e".repeat(40), deployed_identity: deployment.deployed_identity, independent_audit_identity: "AUDITOR-SESSION-002", audited_at_utc: "2026-01-01T00:25:00.000Z"});
assert.throws(() => compileAcceptedLiveClosure({delivery_choice: deploy, deployment_receipt: deployment, live_audit_receipt: foreignAudit, closed_at_utc: "2026-01-01T00:26:00.000Z"}), /candidate/u);
assert.throws(() => validateAcceptedLiveClosure({...closure, digest: "0".repeat(64)}, {delivery_choice: deploy}), /digest does not match/u);

console.log(JSON.stringify({status: "PASS", protected_action: deployRequest.action, local_status: localAuthorization.status}));
