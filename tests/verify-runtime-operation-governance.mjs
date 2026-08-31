#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  approveRuntimeOperationAuthorization,
  compileDeliveryOperationGovernance,
  compileRuntimeOperationAuthorization,
  compileRuntimeOperationCostProjection,
  createRuntimeOperationDecisionPacket,
  rejectRuntimeOperationAuthorization,
  validateDeliveryOperationGovernance,
  validateRuntimeOperationAuthorization,
  compileDisposableOutputManifest,
  compilePostDeliveryCleanup,
  validatePostDeliveryCleanup,
} from "../control/delivery-operation-governance.mjs";

const POLICY = "a".repeat(64);
const ADAPTER = "b".repeat(64);
const CHOICE = "c".repeat(64);
const ARTIFACT = "d".repeat(64);
const SOURCE_COMMIT = "1".repeat(40);
const SOURCE_TREE = "2".repeat(40);
const BASE = Date.parse("2026-08-16T12:00:00.000Z");
const time = (seconds) => new Date(BASE + seconds * 1000).toISOString();

const governance = compileDeliveryOperationGovernance({
  runner_route: "LOCAL",
  weekly_runner_minutes: 120,
  deployment_route: "MANAGED",
  deployment_provider_id: "managed-host",
  deployment_environment_ids: ["staging", "production"],
  monthly_spend_ceiling: 40,
  currency: "USD",
});
validateDeliveryOperationGovernance(governance);
assert.equal(governance.runtime_authority.external_operations, "RUNTIME_ONLY");
assert.equal(governance.cost_policy.projection_required, true);
assert.equal(governance.owner_decision_policy.status_before_runtime, "REQUIRED_BEFORE_RUNTIME_AUTHORIZATION");
assert.equal(governance.route_bindings.CI_RUN.route_class, "LOCAL");
assert.equal(governance.route_bindings.HOSTING_DEPLOY.provider_id, "managed-host");

const projection = compileRuntimeOperationCostProjection({
  currency: "USD",
  one_time_cost: 0,
  recurring_monthly_cost: 12,
  runner_minutes: 8,
  expected_duration_minutes: 4,
  worst_case_duration_minutes: 12,
  max_concurrency: 1,
  rollback_one_time_cost: 0,
  rollback_recurring_monthly_cost: 0,
  confidence: "ESTIMATED",
  basis: ["PROJECT_BOUND_ESTIMATE", "PROVIDER_RATE_CARD"],
  boundary_status: "WITHIN",
});

const prepared = compileRuntimeOperationAuthorization({
  operation_id: "operation-deploy-001",
  operation: "HOSTING_DEPLOY",
  policy_digest: POLICY,
  adapter_contract_digest: ADAPTER,
  choice_digest: CHOICE,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  artifact_digest: ARTIFACT,
  environment_ref: "opaque:production",
  route_class: "MANAGED",
  provider_id: "managed-host",
  environment_ids: ["production"],
  cost_projection: projection,
  requested_at_utc: time(1),
});
assert.equal(prepared.status, "PREPARED_FOR_OWNER");
assert.equal(prepared.owner_decision.status, "PENDING_OWNER");
const packet = createRuntimeOperationDecisionPacket(prepared);
assert.equal(packet.next_action, "OWNER_APPROVE_REJECT_OR_RECOMPILE_POLICY");
assert.equal(packet.owner_decision_required, true);
assert.equal(packet.cost_projection.projection_sha256, projection.projection_sha256);
assert.throws(() => validateRuntimeOperationAuthorization(prepared, {requireApproved: true}), /explicit owner approval/u);

const approved = approveRuntimeOperationAuthorization(prepared, {
  decision_ref: "opaque:owner-decision-001",
  decision_kind: "WITHIN_POLICY",
  decided_at_utc: time(2),
});
assert.equal(approved.status, "APPROVED");
validateRuntimeOperationAuthorization(approved, {requireApproved: true, expected: {policy_digest: POLICY, adapter_contract_digest: ADAPTER, choice_digest: CHOICE, operation: "HOSTING_DEPLOY"}});

const routeChange = compileRuntimeOperationAuthorization({
  operation_id: "operation-deploy-route-change",
  operation: "HOSTING_DEPLOY",
  policy_digest: POLICY,
  adapter_contract_digest: ADAPTER,
  choice_digest: CHOICE,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  artifact_digest: ARTIFACT,
  environment_ref: "opaque:production",
  route_class: "VPS",
  provider_id: "new-host",
  environment_ids: ["production"],
  cost_projection: compileRuntimeOperationCostProjection({
    currency: "USD",
    one_time_cost: 5,
    recurring_monthly_cost: 55,
    runner_minutes: 8,
    expected_duration_minutes: 4,
    worst_case_duration_minutes: 20,
    max_concurrency: 1,
    rollback_one_time_cost: 10,
    rollback_recurring_monthly_cost: 0,
    confidence: "ESTIMATED",
    basis: ["ROUTE_CHANGE_ESTIMATE"],
    boundary_status: "EXCEEDS",
  }),
  route_change: true,
  requested_at_utc: time(3),
});
assert.throws(() => approveRuntimeOperationAuthorization(routeChange, {
  decision_ref: "opaque:owner-decision-route",
  decision_kind: "WITHIN_POLICY",
  decided_at_utc: time(4),
}), /one-time owner exception/u);
const approvedRouteChange = approveRuntimeOperationAuthorization(routeChange, {
  decision_ref: "opaque:owner-decision-route",
  decision_kind: "ONE_TIME_EXCEPTION",
  decided_at_utc: time(4),
});
assert.equal(approvedRouteChange.status, "APPROVED");

const excessCost = compileRuntimeOperationAuthorization({
  operation_id: "operation-excess-cost",
  operation: "CI_RUN",
  policy_digest: POLICY,
  adapter_contract_digest: ADAPTER,
  choice_digest: CHOICE,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  artifact_digest: ARTIFACT,
  route_class: "HOSTED",
  provider_id: "runner-provider",
  cost_projection: compileRuntimeOperationCostProjection({
    currency: "USD",
    one_time_cost: 0,
    recurring_monthly_cost: 100,
    runner_minutes: 240,
    expected_duration_minutes: 20,
    worst_case_duration_minutes: 45,
    max_concurrency: 1,
    rollback_one_time_cost: 0,
    rollback_recurring_monthly_cost: 0,
    confidence: "ESTIMATED",
    basis: ["PROVIDER_RATE_CARD"],
    boundary_status: "EXCEEDS",
  }),
  requested_at_utc: time(4.5),
});
assert.throws(() => approveRuntimeOperationAuthorization(excessCost, {
  decision_ref: "opaque:owner-decision-excess",
  decision_kind: "WITHIN_POLICY",
  decided_at_utc: time(4.6),
}), /excess-cost operations require an explicit one-time owner exception/u);
const approvedExcess = approveRuntimeOperationAuthorization(excessCost, {
  decision_ref: "opaque:owner-decision-excess",
  decision_kind: "ONE_TIME_EXCEPTION",
  decided_at_utc: time(4.7),
});
assert.equal(approvedExcess.status, "APPROVED");

const unboundRoute = compileRuntimeOperationAuthorization({
  operation_id: "operation-unbound-route",
  operation: "GIT_PUSH",
  policy_digest: POLICY,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  artifact_digest: ARTIFACT,
  route_class: "PROJECT_DEFINED",
  cost_projection: projection,
  requested_at_utc: time(4.8),
});
assert.throws(() => approveRuntimeOperationAuthorization(unboundRoute, {
  decision_ref: "opaque:owner-decision-unbound",
  decision_kind: "WITHIN_POLICY",
  decided_at_utc: time(4.9),
}), /exact project route binding/u);

const rejected = rejectRuntimeOperationAuthorization(prepared, {
  decision_ref: "opaque:owner-decision-reject",
  decided_at_utc: time(5),
});
assert.equal(rejected.status, "REJECTED");
assert.throws(() => validateRuntimeOperationAuthorization(rejected, {requireApproved: true}), /explicit owner approval/u);

const closeoutIssue = "AGENTOS-ISSUE-DELIVERY-1175";
const closeoutCommit = "3".repeat(40);
const closeoutTree = "4".repeat(40);
const closeoutManifest = compileDisposableOutputManifest({
  issueId: closeoutIssue,
  ownerTaskId: "TASK-DELIVERY-1175",
  operationId: "OP-DELIVERY-CLOSEOUT-1175",
  operationRoot: "/Users/nicholaspacheco/Projects/AgentOS/Temp/storage-regen-1175",
  outputs: [{issue_id: closeoutIssue, path: "target/generated.bin", kind: "BUILD_OUTPUT", lifecycle_class: "REGENERABLE", bytes: 8, fingerprint: "delivery-fp"}],
  deliveryVerified: true,
  deliveryReceiptSha256: "5".repeat(64),
  candidateCommit: closeoutCommit,
  candidateTree: closeoutTree,
  observedAtUtc: "2026-08-31T12:00:00.000Z",
});
const closeoutDelivery = {
  status: "DELIVERED_VERIFIED",
  independent_pass: true,
  identical_bytes: true,
  local_commit: closeoutCommit,
  origin_commit: closeoutCommit,
  github_commit: closeoutCommit,
  local_tree: closeoutTree,
  origin_tree: closeoutTree,
  github_tree: closeoutTree,
};
const cleanup = compilePostDeliveryCleanup({manifest: closeoutManifest, delivery: closeoutDelivery, issueId: closeoutIssue, observedAtUtc: "2026-08-31T12:01:00.000Z"});
assert.equal(validatePostDeliveryCleanup(cleanup, {manifest: closeoutManifest, delivery: closeoutDelivery}).cleanup_allowed, true);
assert.throws(() => compilePostDeliveryCleanup({manifest: {...closeoutManifest, delivery_verified: false, cleanup_action: "HOLD_UNTIL_DELIVERY_VERIFIED", manifest_sha256: "0".repeat(64)}, delivery: closeoutDelivery, issueId: closeoutIssue, observedAtUtc: "2026-08-31T12:01:00.000Z"}), /digest mismatch|DELIVERY_NOT_VERIFIED/u);

const unknownProjection = compileRuntimeOperationCostProjection();
assert.equal(unknownProjection.boundary_status, "UNKNOWN");
assert.throws(() => approveRuntimeOperationAuthorization(compileRuntimeOperationAuthorization({
  operation_id: "operation-unknown-cost",
  operation: "CI_RUN",
  policy_digest: POLICY,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  artifact_digest: ARTIFACT,
  route_class: "LOCAL",
  cost_projection: unknownProjection,
  requested_at_utc: time(6),
}), {
  decision_ref: "opaque:owner-decision-unknown",
  decision_kind: "WITHIN_POLICY",
  decided_at_utc: time(7),
}), /explicit owner decision|one-time owner exception|Runtime operation authorization/u);

console.log("PASS Runtime operation governance: Bootstrap route binding, Runtime-only authority, complete cost projection, owner packet, route exception, rejection, and unknown-cost fail-closed coverage");
