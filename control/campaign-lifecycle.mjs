#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {verifyProductAcceptanceProof} from "./acceptance-bridge.mjs";
import {
  archiveContinuousAuditSentinel,
  compileContinuousAuditSentinel,
  validateContinuousAuditSentinel,
} from "./continuous-audit-sentinel.mjs";
import {getPolicyValue, validatePolicyState} from "./global-policy-state.mjs";

export const LIFECYCLE_STAGES = Object.freeze([
  "BUILDING",
  "TERMINAL_PROPOSED",
  "FIRST_PASS_REPAIR_REQUIRED",
  "TERMINAL_SETTLED",
  "FINALIZER_ACTIVE",
  "FINALIZER_COMPLETE",
  "DELTA_AUDIT",
  "READY_FOR_ACCEPTANCE",
  "DEPLOYMENT_CLEARED",
  "ACCEPTED_LIVE_PENDING_CLOSURE",
  "ACCEPTED_LIVE_CLOSED",
]);

export const PLATFORM_STATES = Object.freeze([
  "UNSPAWNED",
  "AVAILABLE",
  "LEASED",
  "WORKING",
  "HANDOFF_READY",
  "ARCHIVED_UNPINNED",
]);

export const HOLD_KINDS = Object.freeze([
  "CONTEXT",
  "AUTHORITY_BOUNDARY",
  "EXTERNAL_DEPENDENCY",
  "CREDENTIAL_ACCESS",
  "OWNER_DECISION",
  "PROTECTED_RESOURCE",
]);

export const SUCCESSOR_STATUSES = Object.freeze([
  "NONE",
  "ORCHESTRATOR_ORIENTED_HELD",
  "LIVE_DELTA_RECEIVED",
  "CAMPAIGN_ADMITTED",
]);

export const SUCCESSOR_CANDIDATE_SCHEMA = "governance.next_campaign_candidate.v1";
export const SUCCESSOR_LIVE_DELTA_SCHEMA = "governance.next_campaign_live_delta.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GENESIS_UTC = "1970-01-01T00:00:00.000Z";
const TRANSITION_KEYS = [
  "sequence", "from_state_sha256", "from_stage", "to_stage", "event_type", "payload", "at_utc", "event_sha256",
];

const ALLOWED_TRANSITIONS = Object.freeze({
  BUILDING: new Set(["BUILDING", "TERMINAL_PROPOSED"]),
  TERMINAL_PROPOSED: new Set(["TERMINAL_PROPOSED", "FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED"]),
  FIRST_PASS_REPAIR_REQUIRED: new Set(["FIRST_PASS_REPAIR_REQUIRED", "BUILDING"]),
  TERMINAL_SETTLED: new Set(["TERMINAL_SETTLED", "FINALIZER_ACTIVE", "READY_FOR_ACCEPTANCE"]),
  FINALIZER_ACTIVE: new Set(["FINALIZER_ACTIVE", "FINALIZER_COMPLETE"]),
  FINALIZER_COMPLETE: new Set(["FINALIZER_COMPLETE", "DELTA_AUDIT"]),
  DELTA_AUDIT: new Set(["DELTA_AUDIT", "FINALIZER_ACTIVE", "READY_FOR_ACCEPTANCE"]),
  READY_FOR_ACCEPTANCE: new Set(["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED"]),
  DEPLOYMENT_CLEARED: new Set(["DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE"]),
  ACCEPTED_LIVE_PENDING_CLOSURE: new Set(["ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"]),
  ACCEPTED_LIVE_CLOSED: new Set(["ACCEPTED_LIVE_CLOSED"]),
});

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

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function lifecycleDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function validateSuccessorCandidatePacket(packet, label, state, {kind = null, campaignId = null, campaignVersion = null} = {}) {
  exactKeys(packet, [
    "schema", "candidate_kind", "campaign_id", "campaign_version", "project_id", "source",
    "owner_intent", "policy", "acceptance", "model_plan", "scope", "parent_candidate_sha256",
    "live_delta_sha256", "candidate_sha256",
  ], label);
  assert(packet.schema === SUCCESSOR_CANDIDATE_SCHEMA, `${label} schema mismatch`);
  assert(["PREDEPLOYMENT", "FINAL"].includes(packet.candidate_kind), `${label} kind is invalid`);
  if (kind !== null) assert(packet.candidate_kind === kind, `${label} kind does not match its lifecycle boundary`);
  for (const field of ["campaign_id", "campaign_version", "project_id"]) requireIdentifier(packet[field], `${label} ${field}`);
  if (campaignId !== null) assert(packet.campaign_id === campaignId, `${label} campaign ID differs from its roster`);
  if (campaignVersion !== null) assert(packet.campaign_version === campaignVersion, `${label} campaign version differs from its roster`);
  exactKeys(packet.source, ["commit", "tree", "worktree_id"], `${label} source`);
  for (const field of ["commit", "tree", "worktree_id"]) requireString(packet.source[field], `${label} source ${field}`);
  exactKeys(packet.owner_intent, ["sha256", "summary_sha256"], `${label} owner intent`);
  exactKeys(packet.policy, ["epoch", "state_sha256"], `${label} policy`);
  exactKeys(packet.acceptance, ["contract_sha256", "question_tree_sha256"], `${label} acceptance`);
  exactKeys(packet.model_plan, ["sha256", "roles_sha256"], `${label} model plan`);
  exactKeys(packet.scope, ["sha256", "changed_paths"], `${label} scope`);
  for (const [value, field] of [
    [packet.owner_intent.sha256, "owner intent"],
    [packet.owner_intent.summary_sha256, "owner intent summary"],
    [packet.policy.state_sha256, "successor policy"],
    [packet.acceptance.contract_sha256, "successor acceptance contract"],
    [packet.acceptance.question_tree_sha256, "successor question tree"],
    [packet.model_plan.sha256, "successor model plan"],
    [packet.model_plan.roles_sha256, "successor model roles"],
    [packet.scope.sha256, "successor scope"],
  ]) requireSha(value, `${label} ${field}`);
  assert(Number.isSafeInteger(packet.policy.epoch) && packet.policy.epoch >= 1, `${label} policy epoch is invalid`);
  assert(packet.policy.epoch === state.policy_epoch && packet.policy.state_sha256 === state.policy_state_sha256,
    `${label} policy is not bound to the current policy snapshot`);
  assert(packet.acceptance.contract_sha256 === state.acceptance_contract_sha256,
    `${label} acceptance contract is not bound to the current campaign contract`);
  validatePathArray(packet.scope.changed_paths, `${label} changed paths`);
  if (packet.parent_candidate_sha256 !== null) requireSha(packet.parent_candidate_sha256, `${label} parent candidate`);
  if (packet.live_delta_sha256 !== null) requireSha(packet.live_delta_sha256, `${label} live delta`);
  if (packet.candidate_kind === "PREDEPLOYMENT") {
    assert(packet.parent_candidate_sha256 === null && packet.live_delta_sha256 === null,
      `${label} predeployment candidate has final-only lineage`);
  } else {
    requireSha(packet.parent_candidate_sha256, `${label} final candidate parent`);
    requireSha(packet.live_delta_sha256, `${label} final candidate live delta`);
  }
  requireSha(packet.candidate_sha256, `${label} digest`);
  assert(packet.candidate_sha256 === lifecycleDigest({...packet, candidate_sha256: null}), `${label} digest is not content-addressed`);
  return packet;
}

function validatePathArray(paths, label) {
  assert(Array.isArray(paths) && paths.length > 0, `${label} must be nonempty`);
  const sorted = [...paths].sort(compareUtf8);
  assert(sorted.every((value) => typeof value === "string" && value.length > 0
    && !value.startsWith("/") && !value.includes("\\")
    && !value.split("/").includes("..")), `${label} contains an unsafe path`);
  assert(new Set(sorted).size === sorted.length && canonicalJson(paths) === canonicalJson(sorted), `${label} must be unique and sorted`);
}

export function compileNextCampaignCandidate({
  candidateKind = "PREDEPLOYMENT", campaignId, campaignVersion, projectId, sourceCommit, sourceTree, sourceWorktreeId,
  ownerIntentSha256, ownerIntentSummarySha256, policyEpoch, policyStateSha256, acceptanceContractSha256,
  questionTreeSha256, modelPlanSha256, modelRolesSha256, scopeSha256, changedPaths,
  parentCandidateSha256 = null, liveDeltaSha256 = null, state,
}) {
  requireRecord(state, "successor source state");
  const packet = {
    schema: SUCCESSOR_CANDIDATE_SCHEMA,
    candidate_kind: candidateKind,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    project_id: projectId,
    source: {commit: sourceCommit, tree: sourceTree, worktree_id: sourceWorktreeId},
    owner_intent: {sha256: ownerIntentSha256, summary_sha256: ownerIntentSummarySha256},
    policy: {epoch: policyEpoch, state_sha256: policyStateSha256},
    acceptance: {contract_sha256: acceptanceContractSha256, question_tree_sha256: questionTreeSha256},
    model_plan: {sha256: modelPlanSha256, roles_sha256: modelRolesSha256},
    scope: {sha256: scopeSha256, changed_paths: [...changedPaths].sort(compareUtf8)},
    parent_candidate_sha256: parentCandidateSha256,
    live_delta_sha256: liveDeltaSha256,
    candidate_sha256: null,
  };
  packet.candidate_sha256 = lifecycleDigest(packet);
  return validateSuccessorCandidatePacket(packet, "next-campaign candidate", state, {
    kind: candidateKind, campaignId, campaignVersion,
  });
}

function validateSuccessorLiveDeltaPacket(packet, label, state, candidate) {
  exactKeys(packet, [
    "schema", "candidate_sha256", "campaign_id", "campaign_version", "environment_id", "observed_at_utc",
    "changed_paths", "change_summary_sha256", "live_delta_sha256",
  ], label);
  assert(packet.schema === SUCCESSOR_LIVE_DELTA_SCHEMA, `${label} schema mismatch`);
  requireSha(packet.candidate_sha256, `${label} candidate`);
  assert(packet.candidate_sha256 === candidate.candidate_sha256, `${label} targets a different candidate`);
  assert(packet.campaign_id === candidate.campaign_id && packet.campaign_version === candidate.campaign_version,
    `${label} campaign identity differs from its candidate`);
  for (const field of ["campaign_id", "campaign_version", "environment_id"]) requireIdentifier(packet[field], `${label} ${field}`);
  requireUtc(packet.observed_at_utc, `${label} observation time`);
  validatePathArray(packet.changed_paths, `${label} changed paths`);
  requireSha(packet.change_summary_sha256, `${label} change summary`);
  requireSha(packet.live_delta_sha256, `${label} digest`);
  assert(packet.live_delta_sha256 === lifecycleDigest({...packet, live_delta_sha256: null}), `${label} digest is not content-addressed`);
  return packet;
}

export function compileNextCampaignLiveDelta({candidate, environmentId, observedAtUtc, changedPaths, changeSummarySha256, state}) {
  requireRecord(state, "successor source state");
  validateSuccessorCandidatePacket(candidate, "live-delta candidate", state, {kind: "PREDEPLOYMENT"});
  const packet = {
    schema: SUCCESSOR_LIVE_DELTA_SCHEMA,
    candidate_sha256: candidate.candidate_sha256,
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    environment_id: environmentId,
    observed_at_utc: observedAtUtc,
    changed_paths: [...changedPaths].sort(compareUtf8),
    change_summary_sha256: changeSummarySha256,
    live_delta_sha256: null,
  };
  packet.live_delta_sha256 = lifecycleDigest(packet);
  return validateSuccessorLiveDeltaPacket(packet, "next-campaign live delta", state, candidate);
}

function runtimeContinuityDigest(runtime) {
  return lifecycleDigest({
    role_id: runtime.role_id,
    runtime_identity: runtime.runtime_identity,
    session_id: runtime.session_id,
    state_identity: runtime.state_identity,
    environment_id: runtime.environment_id,
    capability_set_sha256: runtime.capability_set_sha256,
    pinned: runtime.pinned,
    persistent: runtime.persistent,
    retention: runtime.retention,
  });
}

function validateRuntimeBinding(runtime) {
  exactKeys(runtime, ["role_id", "runtime_identity", "session_id", "state_identity", "deployed_identity", "rollback_identity", "environment_id", "capability_set_sha256", "pinned", "persistent", "retention", "continuity_receipt_sha256"], "Runtime binding");
  assert(runtime.role_id === "RUNTIME", "Runtime role is invalid");
  for (const field of ["runtime_identity", "session_id", "state_identity", "deployed_identity", "rollback_identity", "environment_id", "retention"]) requireString(runtime[field], `Runtime ${field}`);
  requireSha(runtime.capability_set_sha256, "Runtime capability set");
  assert(runtime.pinned === true && runtime.persistent === true && runtime.retention === "CROSS_CAMPAIGN", "Runtime is not persistent and pinned across campaigns");
  requireSha(runtime.continuity_receipt_sha256, "Runtime continuity receipt");
  assert(runtime.continuity_receipt_sha256 === runtimeContinuityDigest(runtime), "Runtime continuity receipt is not bound to its stable identity");
  return runtime;
}

const REPOSITORY_PROOF_KEYS = ["schema", "worktree_id", "commit", "tree", "remote_commit", "remote_tree", "clean", "pushed", "observed_by_role", "observed_by_session", "observed_at_utc", "verification_method", "observation_sha256"];

export function validateRepositoryCheckpointProof(proof, expected = {}) {
  exactKeys(proof, REPOSITORY_PROOF_KEYS, "repository checkpoint proof");
  assert(proof.schema === "governance.repository_checkpoint_proof.v1", "repository checkpoint proof schema mismatch");
  for (const field of ["worktree_id", "commit", "tree", "remote_commit", "remote_tree", "observed_by_role", "observed_by_session", "verification_method"]) requireString(proof[field], `repository checkpoint proof ${field}`);
  assert(["GIT_READBACK", "PROVIDER_READBACK", "ARTIFACT_READBACK"].includes(proof.verification_method), "repository checkpoint proof verification method is invalid");
  assert(typeof proof.clean === "boolean" && typeof proof.pushed === "boolean", "repository checkpoint proof flags are invalid");
  if (proof.pushed) assert(proof.clean === true && proof.commit === proof.remote_commit && proof.tree === proof.remote_tree, "pushed repository checkpoint proof is not clean and remote-equal");
  requireUtc(proof.observed_at_utc, "repository checkpoint observation time");
  requireSha(proof.observation_sha256, "repository checkpoint observation digest");
  assert(proof.observation_sha256 === lifecycleDigest({...proof, observation_sha256: null}), "repository checkpoint proof is not content-addressed");
  for (const [field, label] of [["worktree_id", "worktree"], ["commit", "commit"], ["tree", "tree"], ["remote_commit", "remote commit"], ["remote_tree", "remote tree"]]) {
    if (expected[field] !== undefined) assert(proof[field] === expected[field], `repository checkpoint proof ${label} differs from expected identity`);
  }
  return proof;
}

export function compileRepositoryCheckpointProof({worktreeId, commit, tree, remoteCommit, remoteTree, clean, pushed, observedByRole, observedBySession, observedAtUtc, verificationMethod = "GIT_READBACK"}) {
  const proof = {schema: "governance.repository_checkpoint_proof.v1", worktree_id: worktreeId, commit, tree, remote_commit: remoteCommit, remote_tree: remoteTree, clean, pushed, observed_by_role: observedByRole, observed_by_session: observedBySession, observed_at_utc: observedAtUtc, verification_method: verificationMethod, observation_sha256: null};
  proof.observation_sha256 = lifecycleDigest({...proof, observation_sha256: null});
  return validateRepositoryCheckpointProof(proof);
}

export function compileRuntimeBinding({runtimeIdentity, sessionId, stateIdentity, deployedIdentity, rollbackIdentity, environmentId, capabilitySetSha256}) {
  const runtime = {
    role_id: "RUNTIME",
    runtime_identity: runtimeIdentity,
    session_id: sessionId,
    state_identity: stateIdentity,
    deployed_identity: deployedIdentity,
    rollback_identity: rollbackIdentity,
    environment_id: environmentId,
    capability_set_sha256: capabilitySetSha256,
    pinned: true,
    persistent: true,
    retention: "CROSS_CAMPAIGN",
    continuity_receipt_sha256: null,
  };
  runtime.continuity_receipt_sha256 = runtimeContinuityDigest(runtime);
  return validateRuntimeBinding(runtime);
}

function sortedUniqueStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must be nonempty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(canonicalJson(values) === canonicalJson(sorted), `${label} must be UTF-8 sorted`);
  return sorted;
}

function validateRelativePath(value, label) {
  requireString(value, label);
  assert(RELATIVE_PATH.test(value), `${label} must be a safe project-relative path`);
}

function validateIdentity(identity, label) {
  requireRecord(identity, label);
  exactKeys(identity, ["role_id", "session_id", "campaign_id", "campaign_version", "orientation_only"], label);
  for (const field of ["role_id", "session_id", "campaign_id", "campaign_version"]) {
    requireIdentifier(identity[field], `${label} ${field}`);
  }
  assert(typeof identity.orientation_only === "boolean", `${label} orientation_only is invalid`);
}

function validateRoot(root) {
  exactKeys(root, [
    "root_id", "branch", "commit", "tree", "remote_commit", "remote_tree", "clean", "pushed",
  ], "campaign root");
  for (const field of ["root_id", "branch", "commit", "tree", "remote_commit", "remote_tree"]) {
    requireString(root[field], `campaign root ${field}`);
  }
  assert(typeof root.clean === "boolean" && typeof root.pushed === "boolean", "campaign root flags are invalid");
  if (root.pushed) {
    assert(root.commit === root.remote_commit && root.tree === root.remote_tree,
      "pushed campaign root is not remote-equal");
  }
}

const DEPLOYMENT_RECEIPT_KEYS = [
  "schema", "final_candidate_commit", "final_candidate_tree", "deployed_identity", "rollback_identity",
  "runtime_session_id", "deployed_at_utc", "receipt_sha256",
];
const LIVE_AUDIT_RECEIPT_KEYS = [
  "schema", "final_candidate_commit", "final_candidate_tree", "deployed_identity", "independent_audit_identity",
  "audited_at_utc", "audit_receipt_sha256",
];
const CLOSURE_RECEIPT_KEYS = [
  "schema", "final_candidate_commit", "final_candidate_tree", "deployment_receipt", "live_audit_receipt",
  "closed_at_utc", "closure_receipt_sha256",
];

export function validateDeploymentReceipt(receipt) {
  exactKeys(receipt, DEPLOYMENT_RECEIPT_KEYS, "live deployment receipt");
  assert(receipt.schema === "governance.live_deployment_receipt.v1", "live deployment receipt schema mismatch");
  for (const field of ["final_candidate_commit", "final_candidate_tree", "deployed_identity", "rollback_identity", "runtime_session_id"]) requireString(receipt[field], `live deployment ${field}`);
  requireUtc(receipt.deployed_at_utc, "live deployment time");
  requireSha(receipt.receipt_sha256, "live deployment receipt digest");
  assert(receipt.receipt_sha256 === lifecycleDigest({...receipt, receipt_sha256: null}), "live deployment receipt is not content-addressed");
  return receipt;
}

export function compileDeploymentReceipt({finalCandidateCommit, finalCandidateTree, deployedIdentity, rollbackIdentity, runtimeSessionId, deployedAtUtc}) {
  const receipt = {
    schema: "governance.live_deployment_receipt.v1",
    final_candidate_commit: finalCandidateCommit,
    final_candidate_tree: finalCandidateTree,
    deployed_identity: deployedIdentity,
    rollback_identity: rollbackIdentity,
    runtime_session_id: runtimeSessionId,
    deployed_at_utc: deployedAtUtc,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = lifecycleDigest({...receipt, receipt_sha256: null});
  return validateDeploymentReceipt(receipt);
}

export function validateLiveAuditReceipt(receipt) {
  exactKeys(receipt, LIVE_AUDIT_RECEIPT_KEYS, "independent live audit receipt");
  assert(receipt.schema === "governance.independent_live_audit_receipt.v1", "independent live audit receipt schema mismatch");
  for (const field of ["final_candidate_commit", "final_candidate_tree", "deployed_identity", "independent_audit_identity"]) requireString(receipt[field], `live audit ${field}`);
  requireUtc(receipt.audited_at_utc, "live audit time");
  requireSha(receipt.audit_receipt_sha256, "live audit receipt digest");
  assert(receipt.audit_receipt_sha256 === lifecycleDigest({...receipt, audit_receipt_sha256: null}), "independent live audit receipt is not content-addressed");
  return receipt;
}

export function compileLiveAuditReceipt({finalCandidateCommit, finalCandidateTree, deployedIdentity, independentAuditIdentity, auditedAtUtc}) {
  const receipt = {
    schema: "governance.independent_live_audit_receipt.v1",
    final_candidate_commit: finalCandidateCommit,
    final_candidate_tree: finalCandidateTree,
    deployed_identity: deployedIdentity,
    independent_audit_identity: independentAuditIdentity,
    audited_at_utc: auditedAtUtc,
    audit_receipt_sha256: null,
  };
  receipt.audit_receipt_sha256 = lifecycleDigest({...receipt, audit_receipt_sha256: null});
  return validateLiveAuditReceipt(receipt);
}

export function validateClosureReceipt(receipt) {
  exactKeys(receipt, CLOSURE_RECEIPT_KEYS, "accepted-live closure receipt");
  assert(receipt.schema === "governance.accepted_live_closure_receipt.v1", "accepted-live closure receipt schema mismatch");
  for (const field of ["final_candidate_commit", "final_candidate_tree"]) requireString(receipt[field], `closure ${field}`);
  validateDeploymentReceipt(receipt.deployment_receipt);
  validateLiveAuditReceipt(receipt.live_audit_receipt);
  assert(receipt.deployment_receipt.final_candidate_commit === receipt.final_candidate_commit && receipt.deployment_receipt.final_candidate_tree === receipt.final_candidate_tree, "closure deployment candidate mismatch");
  assert(receipt.live_audit_receipt.final_candidate_commit === receipt.final_candidate_commit && receipt.live_audit_receipt.final_candidate_tree === receipt.final_candidate_tree, "closure audit candidate mismatch");
  assert(receipt.live_audit_receipt.deployed_identity === receipt.deployment_receipt.deployed_identity, "closure audit deployment identity mismatch");
  requireUtc(receipt.closed_at_utc, "accepted-live closure time");
  requireSha(receipt.closure_receipt_sha256, "accepted-live closure digest");
  assert(receipt.closure_receipt_sha256 === lifecycleDigest({...receipt, closure_receipt_sha256: null}), "accepted-live closure receipt is not content-addressed");
  return receipt;
}

export function compileAcceptedLiveClosureReceipt({deploymentReceipt, liveAuditReceipt, closedAtUtc}) {
  validateDeploymentReceipt(deploymentReceipt);
  validateLiveAuditReceipt(liveAuditReceipt);
  assert(deploymentReceipt.final_candidate_commit === liveAuditReceipt.final_candidate_commit && deploymentReceipt.final_candidate_tree === liveAuditReceipt.final_candidate_tree, "closure inputs target different candidates");
  assert(deploymentReceipt.deployed_identity === liveAuditReceipt.deployed_identity, "closure inputs target different deployments");
  const receipt = {
    schema: "governance.accepted_live_closure_receipt.v1",
    final_candidate_commit: deploymentReceipt.final_candidate_commit,
    final_candidate_tree: deploymentReceipt.final_candidate_tree,
    deployment_receipt: structuredClone(deploymentReceipt),
    live_audit_receipt: structuredClone(liveAuditReceipt),
    closed_at_utc: closedAtUtc,
    closure_receipt_sha256: null,
  };
  receipt.closure_receipt_sha256 = lifecycleDigest({...receipt, closure_receipt_sha256: null});
  return validateClosureReceipt(receipt);
}

function validateLiveTransitionEvidence(state) {
  if (state.stage === "ACCEPTED_LIVE_PENDING_CLOSURE") {
    const event = [...state.transition_journal].reverse().find((entry) => entry.to_stage === "ACCEPTED_LIVE_PENDING_CLOSURE" && entry.payload?.deployment_receipt);
    assert(event, "accepted-live pending closure lacks its deployment transition");
    exactKeys(event.payload, ["deployment_receipt"], "accepted-live deployment transition payload");
    const receipt = validateDeploymentReceipt(event.payload.deployment_receipt);
    assert(receipt.final_candidate_commit === state.root.commit && receipt.final_candidate_tree === state.root.tree, "deployment receipt is not bound to the accepted root");
    assert(state.runtime.deployed_identity === receipt.deployed_identity && state.runtime.rollback_identity === receipt.rollback_identity, "Runtime identity does not match deployment receipt");
    assert(state.runtime.session_id === receipt.runtime_session_id, "Runtime session does not match deployment receipt");
  }
  if (state.stage === "ACCEPTED_LIVE_CLOSED") {
    const event = [...state.transition_journal].reverse().find((entry) => entry.to_stage === "ACCEPTED_LIVE_CLOSED" && entry.payload?.closure_receipt);
    assert(event, "accepted-live closure lacks its closure transition");
    exactKeys(event.payload, ["closure_receipt"], "accepted-live closure transition payload");
    const receipt = validateClosureReceipt(event.payload.closure_receipt);
    assert(receipt.final_candidate_commit === state.root.commit && receipt.final_candidate_tree === state.root.tree, "closure receipt is not bound to the accepted root");
    assert(state.runtime.deployed_identity === receipt.deployment_receipt.deployed_identity && state.runtime.rollback_identity === receipt.deployment_receipt.rollback_identity, "closed Runtime identity does not match closure receipt");
    assert(receipt.live_audit_receipt.independent_audit_identity === state.roster.auditor.session_id, "closed live audit is not bound to the independent campaign Auditor");
    assert(receipt.live_audit_receipt.independent_audit_identity !== state.runtime.session_id, "Runtime cannot perform the independent live audit");
  }
}

const WORKTREE_KEYS = ["worktree_id", "branch", "base_commit", "current_commit", "base_tree", "current_tree", "clean", "pushed", "checkpoint_proof"];

function validatePlatformWorktree(worktree, label) {
  exactKeys(worktree, WORKTREE_KEYS, label);
  for (const field of WORKTREE_KEYS.slice(0, 6)) requireString(worktree[field], `${label} ${field}`);
  assert(typeof worktree.clean === "boolean" && typeof worktree.pushed === "boolean", `${label} flags are invalid`);
  if (worktree.pushed) assert(worktree.current_commit.length > 0 && worktree.current_tree.length > 0, `${label} pushed identity is missing`);
  if (worktree.checkpoint_proof !== null) validateRepositoryCheckpointProof(worktree.checkpoint_proof, {worktree_id: worktree.worktree_id, commit: worktree.current_commit, tree: worktree.current_tree, remote_commit: worktree.current_commit, remote_tree: worktree.current_tree});
  if (worktree.pushed) assert(worktree.checkpoint_proof !== null && worktree.checkpoint_proof.pushed === true, `${label} pushed state lacks a mechanical checkpoint proof`);
}

function validateSupervision(value, label) {
  if (value === null) return;
  exactKeys(value, ["feature_agent_id", "feature_session_id", "assignment_id", "lease_id", "goal_sha256", "writable_scope", "acquired_at_utc"], label);
  for (const field of ["feature_agent_id", "feature_session_id", "assignment_id", "lease_id", "writable_scope"]) {
    requireIdentifier(value[field], `${label} ${field}`);
  }
  requireSha(value.goal_sha256, `${label} goal`);
  requireUtc(value.acquired_at_utc, `${label} acquired_at_utc`);
}

function validateRequestQueue(queue, label) {
  assert(Array.isArray(queue), `${label} must be an array`);
  let previous = null;
  for (const item of queue) {
    exactKeys(item, ["feature_id", "dependency", "critical_path_rank", "goal_sha256"], `${label} item`);
    requireIdentifier(item.feature_id, `${label} feature_id`);
    requireString(item.dependency, `${label} dependency`);
    assert(Number.isSafeInteger(item.critical_path_rank) && item.critical_path_rank >= 0, `${label} rank is invalid`);
    requireSha(item.goal_sha256, `${label} goal`);
    if (previous !== null) assert(compareUtf8(previous, item.feature_id) < 0, `${label} must be deterministically ordered`);
    previous = item.feature_id;
  }
}

function validateHandoffReceipts(receipts, label) {
  assert(Array.isArray(receipts), `${label} must be an array`);
  let previous = null;
  for (const receipt of receipts) {
    exactKeys(receipt, ["assignment_id", "from_feature_agent_id", "goal_sha256", "to_state", "commit", "tree", "receipt_sha256", "at_utc"], `${label} item`);
    for (const field of ["assignment_id", "from_feature_agent_id", "commit", "tree"]) requireIdentifier(receipt[field], `${label} ${field}`);
    requireSha(receipt.goal_sha256, `${label} goal`);
    assert(receipt.to_state === "AVAILABLE", `${label} must release to AVAILABLE`);
    requireSha(receipt.receipt_sha256, `${label} receipt`);
    requireUtc(receipt.at_utc, `${label} time`);
    if (previous !== null) assert(compareUtf8(previous, receipt.assignment_id) < 0, `${label} must be deterministically ordered`);
    previous = receipt.assignment_id;
    const body = structuredClone(receipt);
    delete body.receipt_sha256;
    assert(lifecycleDigest(body) === receipt.receipt_sha256, `${label} receipt is not content-addressed`);
  }
}

export function validatePlatformAgent(agent) {
  exactKeys(agent, [
    "logical_capability_id", "logical_agent_id", "execution_session_id", "state",
    "platform_worktree", "supervision", "request_queue", "handoff_receipts",
  ], "Platform Agent pool entry");
  for (const field of ["logical_capability_id", "logical_agent_id", "execution_session_id"]) {
    requireIdentifier(agent[field], `Platform Agent ${field}`);
  }
  assert(PLATFORM_STATES.includes(agent.state), "Platform Agent state is invalid");
  validatePlatformWorktree(agent.platform_worktree, "Platform Agent worktree");
  validateSupervision(agent.supervision, "Platform Agent supervision");
  validateRequestQueue(agent.request_queue, "Platform Agent request queue");
  validateHandoffReceipts(agent.handoff_receipts, "Platform Agent handoff receipts");
  if (agent.state === "UNSPAWNED") {
    assert(agent.supervision === null, "unspawned Platform Agent has a supervisor");
  }
  if (["AVAILABLE", "ARCHIVED_UNPINNED"].includes(agent.state)) {
    assert(agent.supervision === null, `${agent.state} Platform Agent has a supervisor`);
  }
  if (["LEASED", "WORKING", "HANDOFF_READY"].includes(agent.state)) {
    assert(agent.supervision !== null, `${agent.state} Platform Agent lacks a supervision lease`);
  }
  return agent;
}

export function compilePlatformAgent({
  logicalCapabilityId,
  logicalAgentId,
  executionSessionId,
  platformWorktree,
  state = "UNSPAWNED",
}) {
  const agent = {
    logical_capability_id: logicalCapabilityId,
    logical_agent_id: logicalAgentId,
    execution_session_id: executionSessionId,
    state,
    platform_worktree: {...structuredClone(platformWorktree), checkpoint_proof: platformWorktree.checkpoint_proof ?? null},
    supervision: null,
    request_queue: [],
    handoff_receipts: [],
  };
  validatePlatformAgent(agent);
  return agent;
}

export function enqueuePlatformRequest(agent, request) {
  validatePlatformAgent(agent);
  exactKeys(request, ["feature_id", "dependency", "critical_path_rank", "goal_sha256"], "Platform request");
  requireIdentifier(request.feature_id, "Platform request feature_id");
  requireString(request.dependency, "Platform request dependency");
  assert(Number.isSafeInteger(request.critical_path_rank) && request.critical_path_rank >= 0, "Platform request rank is invalid");
  requireSha(request.goal_sha256, "Platform request goal");
  assert(!agent.request_queue.some((item) => item.feature_id === request.feature_id), "duplicate Platform request");
  const next = structuredClone(agent);
  next.request_queue.push(structuredClone(request));
  next.request_queue.sort((left, right) => compareUtf8(left.feature_id, right.feature_id));
  validatePlatformAgent(next);
  return next;
}

export function acquirePlatformLease(agent, {featureAgentId, featureSessionId, assignmentId, leaseId, goalSha256, writableScope, acquiredAtUtc}) {
  validatePlatformAgent(agent);
  for (const [value, label] of [[featureAgentId, "feature agent"], [featureSessionId, "feature session"], [assignmentId, "assignment"], [leaseId, "lease"], [writableScope, "writable scope"]]) requireIdentifier(value, label);
  requireSha(goalSha256, "Platform lease goal");
  requireUtc(acquiredAtUtc, "Platform lease acquisition time");
  assert(["UNSPAWNED", "AVAILABLE"].includes(agent.state), "Platform Agent is not available for a new lease");
  assert(agent.supervision === null, "Platform Agent already has a supervisor");
  const next = structuredClone(agent);
  next.state = "LEASED";
  next.supervision = {
    feature_agent_id: featureAgentId,
    feature_session_id: featureSessionId,
    assignment_id: assignmentId,
    lease_id: leaseId,
    goal_sha256: goalSha256,
    writable_scope: writableScope,
    acquired_at_utc: acquiredAtUtc,
  };
  next.request_queue = next.request_queue.filter((item) => item.feature_id !== featureAgentId);
  validatePlatformAgent(next);
  return next;
}

export function startPlatformWork(agent) {
  validatePlatformAgent(agent);
  assert(agent.state === "LEASED", "Platform Agent must be LEASED before work starts");
  const next = structuredClone(agent);
  next.state = "WORKING";
  validatePlatformAgent(next);
  return next;
}

export function markPlatformHandoffReady(agent, currentCommit, currentTree, repositoryProof) {
  validatePlatformAgent(agent);
  requireString(currentCommit, "Platform current commit");
  requireString(currentTree, "Platform current tree");
  assert(agent.state === "WORKING", "Platform Agent must be WORKING before handoff");
  validateRepositoryCheckpointProof(repositoryProof, {worktree_id: agent.platform_worktree.worktree_id, commit: currentCommit, tree: currentTree, remote_commit: currentCommit, remote_tree: currentTree});
  assert(repositoryProof.clean === true && repositoryProof.pushed === true, "Platform handoff requires a clean pushed repository proof");
  const next = structuredClone(agent);
  next.state = "HANDOFF_READY";
  next.platform_worktree.current_commit = currentCommit;
  next.platform_worktree.current_tree = currentTree;
  next.platform_worktree.clean = repositoryProof.clean;
  next.platform_worktree.pushed = repositoryProof.pushed;
  next.platform_worktree.checkpoint_proof = structuredClone(repositoryProof);
  validatePlatformAgent(next);
  return next;
}

export function releasePlatformLease(agent, atUtc) {
  validatePlatformAgent(agent);
  requireUtc(atUtc, "Platform lease release time");
  assert(["LEASED", "WORKING", "HANDOFF_READY"].includes(agent.state), "Platform Agent is not leased");
  assert(agent.supervision !== null, "Platform lease release lacks supervision");
  assert(agent.platform_worktree.clean && agent.platform_worktree.pushed, "Platform Agent must release a clean pushed worktree");
  const supervision = agent.supervision;
  const receiptBody = {
    assignment_id: supervision.assignment_id,
    from_feature_agent_id: supervision.feature_agent_id,
    goal_sha256: supervision.goal_sha256,
    to_state: "AVAILABLE",
    commit: agent.platform_worktree.current_commit,
    tree: agent.platform_worktree.current_tree,
    at_utc: atUtc,
  };
  const receipt = {...receiptBody, receipt_sha256: lifecycleDigest(receiptBody)};
  const next = structuredClone(agent);
  next.state = "AVAILABLE";
  next.supervision = null;
  next.handoff_receipts.push(receipt);
  next.handoff_receipts.sort((left, right) => compareUtf8(left.assignment_id, right.assignment_id));
  validatePlatformAgent(next);
  return next;
}

export function archivePlatformAgent(agent) {
  validatePlatformAgent(agent);
  assert(agent.state === "AVAILABLE", "only an available Platform Agent may be archived");
  const next = structuredClone(agent);
  next.state = "ARCHIVED_UNPINNED";
  validatePlatformAgent(next);
  return next;
}

const CHECKPOINT_KEYS = [
  "candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "parent_candidate_id",
  "commit", "tree", "worktree_id", "clean", "pushed", "terminal", "status",
  "audit_plan_sha256", "audit_reconciliation_sha256", "finding_ids", "checkpoint_sha256",
];

export function compileCheckpoint(input) {
  requireRecord(input, "checkpoint");
  const checkpoint = {
    candidate_id: input.candidate_id,
    campaign_id: input.campaign_id,
    campaign_version: input.campaign_version,
    logical_lineage_id: input.logical_lineage_id,
    parent_candidate_id: input.parent_candidate_id ?? null,
    commit: input.commit,
    tree: input.tree,
    worktree_id: input.worktree_id,
    clean: input.clean,
    pushed: input.pushed,
    terminal: Boolean(input.terminal),
    status: input.status ?? (input.terminal ? "TERMINAL_PROPOSED" : "BUILDING"),
    audit_plan_sha256: input.audit_plan_sha256 ?? null,
    audit_reconciliation_sha256: input.audit_reconciliation_sha256 ?? null,
    finding_ids: [...(input.finding_ids ?? [])].sort(compareUtf8),
    checkpoint_sha256: "",
  };
  const body = structuredClone(checkpoint);
  delete body.checkpoint_sha256;
  checkpoint.checkpoint_sha256 = lifecycleDigest(body);
  validateCheckpoint(checkpoint);
  return checkpoint;
}

export function validateCheckpoint(checkpoint) {
  exactKeys(checkpoint, CHECKPOINT_KEYS, "checkpoint");
  for (const field of ["candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "commit", "tree", "worktree_id", "status"]) requireIdentifier(checkpoint[field], `checkpoint ${field}`);
  if (checkpoint.parent_candidate_id !== null) requireIdentifier(checkpoint.parent_candidate_id, "checkpoint parent");
  assert(typeof checkpoint.clean === "boolean" && typeof checkpoint.pushed === "boolean" && typeof checkpoint.terminal === "boolean", "checkpoint flags are invalid");
  if (checkpoint.pushed) assert(checkpoint.clean, "pushed checkpoint must be clean");
  if (checkpoint.terminal) assert(checkpoint.clean === true && checkpoint.pushed === true, "terminal checkpoint must be clean and pushed");
  for (const field of ["audit_plan_sha256", "audit_reconciliation_sha256"]) {
    if (checkpoint[field] !== null) requireSha(checkpoint[field], `checkpoint ${field}`);
  }
  sortedUniqueStrings(checkpoint.finding_ids, "checkpoint finding IDs", {allowEmpty: true});
  assert(["BUILDING", "AUDITING", "TERMINAL_PROPOSED", "REPAIR_REQUIRED", "SETTLED", "SUPERSEDED"].includes(checkpoint.status), "checkpoint status is invalid");
  if (checkpoint.status === "SETTLED") assert(checkpoint.audit_reconciliation_sha256 !== null, "settled checkpoint lacks audit reconciliation");
  const body = structuredClone(checkpoint);
  delete body.checkpoint_sha256;
  assert(checkpoint.checkpoint_sha256 === lifecycleDigest(body), "checkpoint digest is not content-addressed");
  return checkpoint;
}

export function compileCheckpointLedger(entries, activeCandidateId) {
  assert(Array.isArray(entries) && entries.length > 0, "checkpoint ledger must contain an entry");
  requireIdentifier(activeCandidateId, "active checkpoint candidate");
  const ledger = {
    entries: entries.map((entry) => structuredClone(entry)),
    active_candidate_id: activeCandidateId,
    ledger_sha256: "",
  };
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  ledger.ledger_sha256 = lifecycleDigest(body);
  validateCheckpointLedger(ledger);
  return ledger;
}

export function validateCheckpointLedger(ledger) {
  exactKeys(ledger, ["entries", "active_candidate_id", "ledger_sha256"], "checkpoint ledger");
  assert(Array.isArray(ledger.entries) && ledger.entries.length > 0, "checkpoint ledger entries are required");
  requireIdentifier(ledger.active_candidate_id, "active checkpoint candidate");
  const seen = new Set();
  for (const [index, checkpoint] of ledger.entries.entries()) {
    validateCheckpoint(checkpoint);
    assert(!seen.has(checkpoint.candidate_id), "checkpoint ledger contains duplicate candidate identity");
    seen.add(checkpoint.candidate_id);
    if (index === 0) assert(checkpoint.parent_candidate_id === null, "first checkpoint unexpectedly has a parent");
    else assert(checkpoint.parent_candidate_id === null || seen.has(checkpoint.parent_candidate_id), "checkpoint parent is not earlier in the ledger");
  }
  assert(seen.has(ledger.active_candidate_id), "checkpoint ledger active candidate is missing");
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  assert(ledger.ledger_sha256 === lifecycleDigest(body), "checkpoint ledger digest is not content-addressed");
  return ledger;
}

function validateHold(hold) {
  exactKeys(hold, ["hold_id", "kind", "scope", "affected_outcome_ids", "blocked_stages", "authority_boundary", "resume_condition", "resume_condition_sha256", "safe_alternatives_evidence_sha256", "owner_role_id", "created_at_utc"], "lifecycle hold");
  requireIdentifier(hold.hold_id, "hold ID");
  assert(HOLD_KINDS.includes(hold.kind), "hold kind is invalid");
  for (const field of ["scope", "authority_boundary", "resume_condition", "owner_role_id"]) requireString(hold[field], `hold ${field}`);
  sortedUniqueStrings(hold.affected_outcome_ids, "hold affected outcomes");
  sortedUniqueStrings(hold.blocked_stages, "hold blocked stages");
  assert(hold.blocked_stages.every((stage) => LIFECYCLE_STAGES.includes(stage)), "hold blocked stage is invalid");
  requireSha(hold.resume_condition_sha256, "hold resume condition");
  assert(hold.resume_condition_sha256 === lifecycleDigest({condition: hold.resume_condition}), "hold resume condition digest mismatch");
  requireSha(hold.safe_alternatives_evidence_sha256, "hold safe alternatives evidence");
  requireUtc(hold.created_at_utc, "hold created_at_utc");
}

function validateFinalizer(finalizer, state) {
  if (finalizer === null) return;
  exactKeys(finalizer, ["session_id", "worktree_id", "branch", "source_candidate_id", "source_commit", "source_tree", "lease_id", "goal_sha256", "status", "final_commit", "final_tree", "clean", "pushed", "repository_proof", "scope_finding_ids", "repair_passes", "reframes", "finalizer_sha256"], "Campaign Finalizer");
  for (const field of ["session_id", "worktree_id", "source_candidate_id", "source_commit", "source_tree", "lease_id", "status"]) requireIdentifier(finalizer[field], `Finalizer ${field}`);
  requireSha(finalizer.goal_sha256, "Finalizer goal");
  requireString(finalizer.branch, "Finalizer branch");
  assert(finalizer.source_candidate_id === state.checkpoint_ledger.active_candidate_id, "Finalizer source candidate is not the active terminal checkpoint");
  const sourceCheckpoint = state.checkpoint_ledger.entries.find((entry) => entry.candidate_id === finalizer.source_candidate_id);
  assert(sourceCheckpoint !== undefined && finalizer.worktree_id !== sourceCheckpoint.worktree_id, "Finalizer must use a fresh worktree");
  const occupiedSessions = new Set([
    state.roster.campaign_orchestrator.session_id,
    state.roster.auditor.session_id,
    ...state.roster.feature_agents.map((feature) => feature.session_id),
    ...state.platform_pool.map((agent) => agent.execution_session_id),
  ]);
  assert(!occupiedSessions.has(finalizer.session_id), "Finalizer session collides with current campaign custody");
  assert(finalizer.status === "ACTIVE" || finalizer.status === "COMPLETE", "Finalizer status is invalid");
  if (finalizer.status === "ACTIVE") {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.clean === null && finalizer.pushed === null && finalizer.repository_proof === null, "active Finalizer carries final identity");
  } else {
    for (const field of ["final_commit", "final_tree"]) requireString(finalizer[field], `Finalizer ${field}`);
    assert(finalizer.clean === true && finalizer.pushed === true, "complete Finalizer must be clean and pushed");
    validateRepositoryCheckpointProof(finalizer.repository_proof, {worktree_id: finalizer.worktree_id, commit: finalizer.final_commit, tree: finalizer.final_tree, remote_commit: finalizer.final_commit, remote_tree: finalizer.final_tree});
    assert(finalizer.repository_proof.clean === true && finalizer.repository_proof.pushed === true, "complete Finalizer lacks a clean pushed repository proof");
  }
  sortedUniqueStrings(finalizer.scope_finding_ids, "Finalizer finding scope", {allowEmpty: true});
  assert(Number.isSafeInteger(finalizer.repair_passes) && finalizer.repair_passes >= 0 && finalizer.repair_passes <= 1, "Finalizer repair pass limit exceeded");
  assert(Number.isSafeInteger(finalizer.reframes) && finalizer.reframes >= 0 && finalizer.reframes <= 1, "Finalizer reframe limit exceeded");
  requireSha(finalizer.finalizer_sha256, "Finalizer digest");
  const body = structuredClone(finalizer);
  delete body.finalizer_sha256;
  assert(finalizer.finalizer_sha256 === lifecycleDigest(body), "Finalizer digest is not content-addressed");
}

function emptySuccessorOrientation() {
  return {
    status: "NONE",
    orchestrator_binding: null,
    predeployment_candidate_sha256: null,
    predeployment_candidate: null,
    live_delta_sha256: null,
    live_delta: null,
    final_candidate_sha256: null,
    final_candidate: null,
    auditor_binding: null,
    feature_agent_bindings: [],
    platform_agent_bindings: [],
    product_writer_lease: "NONE",
  };
}

function validateSuccessorIdentity(identity, label, state) {
  validateIdentity(identity, label);
  assert(identity.campaign_id !== state.campaign_id || identity.campaign_version !== state.campaign_version,
    `${label} reuses the current campaign identity`);
  const occupiedSessions = new Set([
    state.roster.campaign_orchestrator.session_id,
    state.roster.auditor.session_id,
    ...state.roster.feature_agents.map((feature) => feature.session_id),
    ...state.platform_pool.map((agent) => agent.execution_session_id),
  ]);
  assert(!occupiedSessions.has(identity.session_id), `${label} reuses a completed campaign session`);
  return identity;
}

function validateSuccessorOrientation(orientation, state) {
  exactKeys(orientation, ["status", "orchestrator_binding", "predeployment_candidate_sha256", "predeployment_candidate", "live_delta_sha256", "live_delta", "final_candidate_sha256", "final_candidate", "auditor_binding", "feature_agent_bindings", "platform_agent_bindings", "product_writer_lease"], "next-campaign orientation");
  assert(SUCCESSOR_STATUSES.includes(orientation.status), "next-campaign orientation status is invalid");
  if (orientation.orchestrator_binding !== null) validateSuccessorIdentity(orientation.orchestrator_binding, "next-campaign Orchestrator", state);
  if (orientation.auditor_binding !== null) validateSuccessorIdentity(orientation.auditor_binding, "next-campaign Auditor", state);
  for (const field of ["predeployment_candidate_sha256", "live_delta_sha256", "final_candidate_sha256"]) {
    if (orientation[field] !== null) requireSha(orientation[field], `next-campaign ${field}`);
  }
  for (const [packet, digest, label] of [
    [orientation.predeployment_candidate, orientation.predeployment_candidate_sha256, "predeployment candidate"],
    [orientation.live_delta, orientation.live_delta_sha256, "live delta"],
    [orientation.final_candidate, orientation.final_candidate_sha256, "final candidate"],
  ]) {
    assert((packet === null) === (digest === null), `${label} packet and digest must be present together`);
    if (packet !== null) {
      const packetDigest = packet.schema === SUCCESSOR_LIVE_DELTA_SCHEMA ? packet.live_delta_sha256 : packet.candidate_sha256;
      assert(packetDigest === digest, `${label} packet digest mismatch`);
    }
  }
  if (orientation.predeployment_candidate !== null) {
    validateSuccessorCandidatePacket(orientation.predeployment_candidate, "oriented predeployment candidate", state, {
      kind: "PREDEPLOYMENT",
      campaignId: orientation.orchestrator_binding?.campaign_id ?? null,
      campaignVersion: orientation.orchestrator_binding?.campaign_version ?? null,
    });
  }
  if (orientation.live_delta !== null) {
    validateSuccessorLiveDeltaPacket(orientation.live_delta, "oriented live delta", state, orientation.predeployment_candidate);
  }
  if (orientation.final_candidate !== null) {
    validateSuccessorCandidatePacket(orientation.final_candidate, "admitted final candidate", state, {
      kind: "FINAL",
      campaignId: orientation.orchestrator_binding?.campaign_id ?? null,
      campaignVersion: orientation.orchestrator_binding?.campaign_version ?? null,
    });
    assert(orientation.final_candidate.parent_candidate_sha256 === orientation.predeployment_candidate_sha256,
      "final candidate does not name the oriented predeployment candidate");
    assert(orientation.final_candidate.live_delta_sha256 === orientation.live_delta_sha256,
      "final candidate does not name the recorded live delta");
  }
  assert(Array.isArray(orientation.feature_agent_bindings) && Array.isArray(orientation.platform_agent_bindings), "next-campaign roster bindings are invalid");
  assert(["NONE", "HELD_FOR_ADMISSION", "RELEASED"].includes(orientation.product_writer_lease), "next-campaign writer lease is invalid");
  if (orientation.status === "NONE") {
    assert(orientation.orchestrator_binding === null
      && orientation.predeployment_candidate_sha256 === null
      && orientation.predeployment_candidate === null
      && orientation.live_delta_sha256 === null
      && orientation.live_delta === null
      && orientation.final_candidate_sha256 === null
      && orientation.final_candidate === null
      && orientation.auditor_binding === null
      && orientation.feature_agent_bindings.length === 0
      && orientation.platform_agent_bindings.length === 0
      && orientation.product_writer_lease === "NONE", "empty next-campaign orientation contains invented state");
  }
  if (["ORCHESTRATOR_ORIENTED_HELD", "LIVE_DELTA_RECEIVED"].includes(orientation.status)) {
    assert(orientation.orchestrator_binding?.role_id === "CAMPAIGN_ORCHESTRATOR", "orientation must bind only the next Campaign Orchestrator");
    assert(orientation.orchestrator_binding.orientation_only === true, "oriented successor Orchestrator must be orientation-only");
    assert(orientation.predeployment_candidate_sha256 !== null && orientation.predeployment_candidate !== null, "oriented successor lacks predeployment candidate");
    assert(orientation.auditor_binding === null && orientation.feature_agent_bindings.length === 0 && orientation.platform_agent_bindings.length === 0, "oriented successor has a speculative roster");
    assert(orientation.product_writer_lease === "NONE", "oriented successor holds Product custody");
  }
  if (orientation.status === "ORCHESTRATOR_ORIENTED_HELD") assert(orientation.live_delta_sha256 === null, "oriented successor has premature live delta");
  if (orientation.status === "LIVE_DELTA_RECEIVED") assert(orientation.live_delta_sha256 !== null && orientation.live_delta !== null, "live-delta state lacks its delta packet");
  if (orientation.status === "CAMPAIGN_ADMITTED") {
    assert(orientation.orchestrator_binding?.role_id === "CAMPAIGN_ORCHESTRATOR", "admitted successor lacks Orchestrator");
    assert(orientation.orchestrator_binding.orientation_only === false, "admitted successor Orchestrator remains orientation-only");
    assert(orientation.auditor_binding?.role_id === "INDEPENDENT_AUDITOR", "admitted successor lacks Auditor");
    assert(orientation.feature_agent_bindings.length > 0, "admitted successor lacks Feature Agents");
    assert(orientation.final_candidate_sha256 !== null && orientation.final_candidate !== null && orientation.product_writer_lease === "HELD_FOR_ADMISSION", "admitted successor lacks final candidate or writer lease");
    assert(state.stage === "ACCEPTED_LIVE_CLOSED", "successor roster may be admitted only after accepted-live closure");
    const bindings = [orientation.orchestrator_binding, orientation.auditor_binding, ...orientation.feature_agent_bindings, ...orientation.platform_agent_bindings];
    const campaignKey = `${orientation.orchestrator_binding.campaign_id}\u0000${orientation.orchestrator_binding.campaign_version}`;
    const sessions = new Set();
    const roles = new Set();
    for (const binding of bindings) {
      validateSuccessorIdentity(binding, "admitted successor identity", state);
      assert(`${binding.campaign_id}\u0000${binding.campaign_version}` === campaignKey, "admitted successor roster mixes campaign identities");
      assert(!sessions.has(binding.session_id), "admitted successor roster reuses a session");
      sessions.add(binding.session_id);
    }
    assert(!roles.has(orientation.orchestrator_binding.role_id), "admitted successor roster has duplicate roles");
    roles.add(orientation.orchestrator_binding.role_id);
    assert(!roles.has(orientation.auditor_binding.role_id), "admitted successor roster has duplicate roles");
    roles.add(orientation.auditor_binding.role_id);
    for (const binding of orientation.feature_agent_bindings) {
      assert(binding.role_id.startsWith("FEATURE_AGENT:") && binding.orientation_only === false, "admitted successor Feature Agent binding is invalid");
      assert(!roles.has(binding.role_id), "admitted successor Feature Agent role is duplicated");
      roles.add(binding.role_id);
    }
    for (const binding of orientation.platform_agent_bindings) {
      assert(binding.role_id.startsWith("PLATFORM_AGENT:") && binding.orientation_only === false, "admitted successor Platform Agent binding is invalid");
      assert(!roles.has(binding.role_id), "admitted successor Platform Agent role is duplicated");
      roles.add(binding.role_id);
    }
  }
}

function validateAcceptance(acceptance, state) {
  exactKeys(acceptance, [
    "schema", "proof", "product_acceptance", "final_candidate_commit", "final_candidate_tree", "product_receipt_sha256",
  ], "Product acceptance");
  assert(acceptance.schema === "governance.lifecycle_product_acceptance.v1", "Product acceptance schema mismatch");
  requireRecord(acceptance.proof, "Product acceptance proof");
  requireRecord(acceptance.product_acceptance, "compiled Product acceptance");
  const rebuilt = verifyProductAcceptanceProof(acceptance.product_acceptance, acceptance.proof, state.campaign_id);
  assert(acceptance.product_acceptance.acceptance_receipt_sha256 === rebuilt.product_acceptance.acceptance_receipt_sha256,
    "lifecycle Product acceptance is not bound to the executable question-tree result");
  requireString(acceptance.final_candidate_commit, "accepted final commit");
  requireString(acceptance.final_candidate_tree, "accepted final tree");
  assert(acceptance.product_acceptance.auditor_session_id === acceptance.proof.auditor_attestation.auditor_session_id,
    "Product acceptance Auditor is not bound to its attestation");
  requireSha(acceptance.product_receipt_sha256, "Product acceptance receipt");
  const body = structuredClone(acceptance);
  delete body.product_receipt_sha256;
  assert(acceptance.product_receipt_sha256 === lifecycleDigest(body), "Product acceptance receipt is not content-addressed");
}

export function compileProductAcceptance({proof, finalCandidateCommit, finalCandidateTree}) {
  requireRecord(proof, "Product acceptance proof");
  const proofBody = proof.proof ?? proof;
  const productAcceptance = proof.product_acceptance ?? proof.productAcceptance;
  requireRecord(proofBody, "Product acceptance proof body");
  requireRecord(proofBody.tree, "Product acceptance question tree");
  const expected = verifyProductAcceptanceProof(productAcceptance, proofBody, proofBody.tree.campaign_id);
  const acceptance = {
    schema: "governance.lifecycle_product_acceptance.v1",
    proof: structuredClone(proofBody),
    product_acceptance: structuredClone(productAcceptance ?? expected.product_acceptance),
    final_candidate_commit: finalCandidateCommit,
    final_candidate_tree: finalCandidateTree,
    product_receipt_sha256: "",
  };
  const body = structuredClone(acceptance);
  delete body.product_receipt_sha256;
  acceptance.product_receipt_sha256 = lifecycleDigest(body);
  validateAcceptance(acceptance, {campaign_id: proofBody.tree.campaign_id});
  return acceptance;
}

function validateRoster(roster, state) {
  exactKeys(roster, ["campaign_orchestrator", "auditor", "feature_agents"], "campaign roster");
  validateIdentity(roster.campaign_orchestrator, "campaign Orchestrator");
  validateIdentity(roster.auditor, "campaign Auditor");
  assert(roster.campaign_orchestrator.role_id === "CAMPAIGN_ORCHESTRATOR" && roster.auditor.role_id === "INDEPENDENT_AUDITOR", "campaign roster roles are invalid");
  assert(Array.isArray(roster.feature_agents) && roster.feature_agents.length > 0, "campaign Feature roster is empty");
  const sessions = new Set([roster.campaign_orchestrator.session_id, roster.auditor.session_id]);
  const roles = new Set([roster.campaign_orchestrator.role_id, roster.auditor.role_id]);
  for (const identity of [roster.campaign_orchestrator, roster.auditor]) {
    assert(identity.campaign_id === state.campaign_id && identity.campaign_version === state.campaign_version, "campaign roster identity is bound to a different campaign");
    assert(identity.orientation_only === false, "active campaign roster cannot contain an orientation-only identity");
  }
  for (const feature of roster.feature_agents) {
    validateIdentity(feature, "campaign Feature Agent");
    assert(feature.role_id.startsWith("FEATURE_AGENT:"), "campaign Feature Agent role is invalid");
    assert(!sessions.has(feature.session_id), "campaign roster session is reused");
    assert(!roles.has(feature.role_id), "campaign roster role is reused");
    assert(feature.campaign_id === state.campaign_id && feature.campaign_version === state.campaign_version, "campaign Feature Agent is bound to a different campaign");
    assert(feature.orientation_only === false, "active campaign Feature Agent cannot be orientation-only");
    sessions.add(feature.session_id);
    roles.add(feature.role_id);
  }
  for (const agent of state.platform_pool) assert(!sessions.has(agent.execution_session_id), "Platform Agent execution session collides with the campaign roster");
  return sessions;
}

function validateLivingLedgerBinding(binding) {
  exactKeys(binding, ["events_root", "current_view_path", "event_count", "ledger_sha256", "current_view_sha256", "writer_heads"], "living ledger binding");
  for (const field of ["events_root", "current_view_path"]) validateRelativePath(binding[field], `living ledger ${field}`);
  assert(Number.isSafeInteger(binding.event_count) && binding.event_count >= 0, "living ledger event_count is invalid");
  requireSha(binding.ledger_sha256, "living ledger digest");
  requireSha(binding.current_view_sha256, "living current-view digest");
  requireRecord(binding.writer_heads, "living ledger writer heads");
  for (const [writer, head] of Object.entries(binding.writer_heads)) {
    requireIdentifier(writer, "living ledger writer");
    requireSha(head, "living ledger writer head");
  }
}

function validateTransitionJournal(journal, currentStage) {
  assert(Array.isArray(journal) && journal.length > 0, "lifecycle transition journal is required");
  for (const [index, entry] of journal.entries()) {
    exactKeys(entry, TRANSITION_KEYS, "lifecycle transition journal entry");
    assert(Number.isSafeInteger(entry.sequence) && entry.sequence === index, "lifecycle transition sequence is not contiguous");
    if (entry.from_state_sha256 !== null) requireSha(entry.from_state_sha256, "lifecycle transition parent state");
    assert(entry.from_stage === null || LIFECYCLE_STAGES.includes(entry.from_stage), "lifecycle transition source stage is invalid");
    assert(LIFECYCLE_STAGES.includes(entry.to_stage), "lifecycle transition target stage is invalid");
    requireIdentifier(entry.event_type, "lifecycle transition event type");
    requireRecord(entry.payload, "lifecycle transition payload");
    requireUtc(entry.at_utc, "lifecycle transition time");
    requireSha(entry.event_sha256, "lifecycle transition event digest");
    if (index === 0) {
      assert(entry.from_state_sha256 === null && entry.from_stage === null && entry.event_type === "GENESIS",
        "lifecycle transition journal has invalid genesis");
      assert(entry.to_stage === "BUILDING", "lifecycle genesis must begin at BUILDING");
    } else {
      const previous = journal[index - 1];
      assert(entry.from_state_sha256 !== null && entry.from_stage === previous.to_stage,
        "lifecycle transition journal parent is not bound to the previous stage");
      assert(ALLOWED_TRANSITIONS[previous.to_stage]?.has(entry.to_stage), "lifecycle transition journal contains an illegal stage edge");
    }
    const body = structuredClone(entry);
    delete body.event_sha256;
    assert(entry.event_sha256 === lifecycleDigest(body), "lifecycle transition event is not content-addressed");
  }
  assert(journal.at(-1).to_stage === currentStage, "lifecycle transition journal does not end at the current stage");
}

function appendTransition(next, previous, event) {
  assert(Array.isArray(previous.transition_journal) && Array.isArray(next.transition_journal), "lifecycle transition journal is missing");
  assert(canonicalJson(next.transition_journal) === canonicalJson(previous.transition_journal),
    "lifecycle transition replaced the prior journal before appending");
  requireString(event?.type ?? "", "lifecycle event type");
  const atUtc = event.at_utc ?? new Date().toISOString();
  const entryBody = {
    sequence: next.transition_journal.length,
    from_state_sha256: previous.state_sha256,
    from_stage: previous.stage,
    to_stage: next.stage,
    event_type: event.type,
    payload: structuredClone(event.payload ?? {}),
    at_utc: atUtc,
  };
  const entry = {...entryBody, event_sha256: lifecycleDigest(entryBody)};
  next.transition_journal.push(entry);
  return next;
}

export function validateLifecycleState(state) {
  exactKeys(state, ["schema", "governance_version", "status", "campaign_id", "campaign_version", "logical_lineage_id", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "stage", "root", "active_writer", "holds", "platform_pool", "checkpoint_ledger", "finalizer", "acceptance", "runtime", "roster", "continuous_audit_sentinel", "successor_orientation", "living_ledger", "transition_journal", "state_sha256"], "campaign lifecycle state");
  assert(state.schema === "governance.campaign_lifecycle_state.v1" && state.governance_version === "2.1rc", "campaign lifecycle identity is invalid");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "campaign lifecycle must remain prepared and inactive");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) requireIdentifier(state[field], `campaign ${field}`);
  assert(Number.isSafeInteger(state.policy_epoch) && state.policy_epoch >= 1, "campaign policy epoch is invalid");
  requireSha(state.policy_state_sha256, "campaign policy snapshot");
  requireSha(state.acceptance_contract_sha256, "campaign acceptance contract");
  assert(LIFECYCLE_STAGES.includes(state.stage), "campaign lifecycle stage is invalid");
  validateTransitionJournal(state.transition_journal, state.stage);
  validateRoot(state.root);
  if (state.active_writer !== null) {
    exactKeys(state.active_writer, ["kind", "role_id", "session_id", "lease_id", "worktree_id", "goal_sha256", "writable_scope"], "active writer");
    for (const field of ["kind", "role_id", "session_id", "lease_id", "worktree_id", "writable_scope"]) requireIdentifier(state.active_writer[field], `active writer ${field}`);
    requireSha(state.active_writer.goal_sha256, "active writer goal");
    assert(["FEATURE_AGENT", "CAMPAIGN_FINALIZER"].includes(state.active_writer.kind), "active writer kind is invalid");
  }
  assert(Array.isArray(state.holds), "lifecycle holds are missing");
  const holdIds = new Set();
  for (const hold of state.holds) {
    validateHold(hold);
    assert(!holdIds.has(hold.hold_id), "lifecycle hold IDs duplicate");
    holdIds.add(hold.hold_id);
  }
  assert(Array.isArray(state.platform_pool), "Platform pool is missing");
  const capabilityIds = new Set();
  const agentIds = new Set();
  for (const agent of state.platform_pool) {
    validatePlatformAgent(agent);
    assert(!capabilityIds.has(agent.logical_capability_id), "Platform capability is duplicated");
    assert(!agentIds.has(agent.logical_agent_id), "Platform logical agent is duplicated");
    capabilityIds.add(agent.logical_capability_id);
    agentIds.add(agent.logical_agent_id);
  }
  validateCheckpointLedger(state.checkpoint_ledger);
  const activeCheckpoint = state.checkpoint_ledger.entries.find((entry) => entry.candidate_id === state.checkpoint_ledger.active_candidate_id);
  assert(activeCheckpoint !== undefined, "active checkpoint is not in the ledger");
  if (["TERMINAL_PROPOSED", "FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED", "FINALIZER_ACTIVE", "FINALIZER_COMPLETE", "DELTA_AUDIT", "READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"].includes(state.stage)) {
    assert(activeCheckpoint.terminal, `${state.stage} requires a terminal checkpoint`);
  }
  if (state.stage === "FIRST_PASS_REPAIR_REQUIRED") assert(activeCheckpoint.status === "REPAIR_REQUIRED", "repair-required stage lacks a repair checkpoint");
  validateFinalizer(state.finalizer, state);
  validateAcceptance(state.acceptance, state);
  validateRuntimeBinding(state.runtime);
  validateContinuousAuditSentinel(state.continuous_audit_sentinel, {
    campaignId: state.campaign_id,
    campaignVersion: state.campaign_version,
    logicalLineageId: state.logical_lineage_id,
  });
  if (["ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"].includes(state.stage)) validateLiveTransitionEvidence(state);
  const rosterSessions = validateRoster(state.roster, state);
  assert(state.continuous_audit_sentinel.auditor_session_id === state.roster.auditor.session_id, "continuous audit sentinel is not bound to the current Auditor");
  if (state.stage === "ACCEPTED_LIVE_CLOSED") assert(state.continuous_audit_sentinel.status === "ARCHIVED_UNPINNED", "accepted-live closure did not archive the continuous audit sentinel");
  else assert(state.continuous_audit_sentinel.status === "ACTIVE", "campaign lost its active continuous audit sentinel before closure");
  if (state.active_writer !== null) {
    if (state.active_writer.kind === "FEATURE_AGENT") {
      const feature = state.roster.feature_agents.find((item) => item.session_id === state.active_writer.session_id);
      assert(feature?.role_id === state.active_writer.role_id, "active Feature writer is not the current roster owner");
    } else {
      assert(state.finalizer?.session_id === state.active_writer.session_id && state.active_writer.role_id === "CAMPAIGN_FINALIZER", "active Finalizer writer is not the admitted Finalizer");
    }
    assert(rosterSessions.has(state.active_writer.session_id) || state.active_writer.kind === "CAMPAIGN_FINALIZER", "active writer session is not bound to the current campaign");
  }
  assert(state.acceptance.product_acceptance.auditor_session_id === state.roster.auditor.session_id || state.stage === "BUILDING" || state.stage === "TERMINAL_PROPOSED" || state.stage === "FIRST_PASS_REPAIR_REQUIRED" || state.stage === "TERMINAL_SETTLED" || state.stage === "FINALIZER_ACTIVE" || state.stage === "FINALIZER_COMPLETE" || state.stage === "DELTA_AUDIT",
    "Product acceptance Auditor is not the current campaign Auditor");
  const featureBindings = new Map(state.roster.feature_agents.map((feature) => [feature.session_id, feature.role_id]));
  for (const agent of state.platform_pool) {
    if (agent.supervision === null) continue;
    const role = featureBindings.get(agent.supervision.feature_session_id);
    assert(role === `FEATURE_AGENT:${agent.supervision.feature_agent_id}`,
      "Platform supervision is not bound to the current Feature Agent roster");
  }
  validateSuccessorOrientation(state.successor_orientation, state);
  validateLivingLedgerBinding(state.living_ledger);
  if (state.stage === "FINALIZER_ACTIVE") assert(state.finalizer?.status === "ACTIVE" && state.active_writer?.kind === "CAMPAIGN_FINALIZER", "Finalizer custody is not active");
  if (state.stage === "FINALIZER_COMPLETE") assert(state.finalizer?.status === "COMPLETE" && state.active_writer === null, "completed Finalizer still holds Product custody");
  if (["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"].includes(state.stage)) {
    assert(state.acceptance.product_acceptance.rc_ready === true, `${state.stage} lacks all three Product roots`);
    assert(state.acceptance.final_candidate_commit === state.root.commit && state.acceptance.final_candidate_tree === state.root.tree,
      `${state.stage} Product acceptance is not bound to the campaign root`);
    assert(state.root.clean === true && state.root.pushed === true && state.root.commit === state.root.remote_commit && state.root.tree === state.root.remote_tree,
      `${state.stage} requires a clean pushed remote-equal campaign root`);
  }
  if (state.stage === "ACCEPTED_LIVE_CLOSED") assert(state.active_writer === null && state.holds.length === 0, "accepted-live closure is incomplete");
  const body = structuredClone(state);
  delete body.state_sha256;
  assert(state.state_sha256 === lifecycleDigest(body), "campaign lifecycle state is not content-addressed");
  return state;
}

export function sealLifecycleState(state) {
  const next = structuredClone(state);
  if (!Array.isArray(next.transition_journal) || next.transition_journal.length === 0) {
    assert(next.stage === "BUILDING", "a new lifecycle state must begin at BUILDING");
    const genesisBody = {
      sequence: 0,
      from_state_sha256: null,
      from_stage: null,
      to_stage: next.stage,
      event_type: "GENESIS",
      payload: {campaign_id: next.campaign_id, campaign_version: next.campaign_version, logical_lineage_id: next.logical_lineage_id},
      at_utc: GENESIS_UTC,
    };
    next.transition_journal = [{...genesisBody, event_sha256: lifecycleDigest(genesisBody)}];
  } else {
    assert(next.transition_journal.at(-1).to_stage === next.stage,
      "a stage change requires applyLifecycleTransition and a journal entry");
  }
  delete next.state_sha256;
  next.state_sha256 = lifecycleDigest(next);
  validateLifecycleState(next);
  return next;
}

export function createLifecycleState(input) {
  requireRecord(input, "campaign lifecycle input");
  assert(input.stage === undefined || input.stage === "BUILDING" || (Array.isArray(input.transition_journal) && input.transition_journal.length > 0), "lifecycle creation cannot skip the BUILDING genesis");
  const firstCheckpoint = input.checkpoint_ledger ?? compileCheckpointLedger([compileCheckpoint(input.first_checkpoint)], input.first_checkpoint.candidate_id);
  const state = {
    schema: "governance.campaign_lifecycle_state.v1",
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    campaign_id: input.campaign_id,
    campaign_version: input.campaign_version,
    logical_lineage_id: input.logical_lineage_id,
    policy_epoch: input.policy_epoch,
    policy_state_sha256: input.policy_state_sha256,
    acceptance_contract_sha256: input.acceptance_contract_sha256,
    stage: input.stage ?? "BUILDING",
    root: structuredClone(input.root),
    active_writer: input.active_writer ?? null,
    holds: structuredClone(input.holds ?? []),
    platform_pool: structuredClone(input.platform_pool ?? []),
    checkpoint_ledger: structuredClone(firstCheckpoint),
    finalizer: input.finalizer ?? null,
    acceptance: structuredClone(input.acceptance),
    runtime: structuredClone(input.runtime),
    roster: structuredClone(input.roster),
    continuous_audit_sentinel: structuredClone(input.continuous_audit_sentinel ?? compileContinuousAuditSentinel({
      campaignId: input.campaign_id,
      campaignVersion: input.campaign_version,
      logicalLineageId: input.logical_lineage_id,
      auditorSessionId: input.roster?.auditor?.session_id,
      startedAtUtc: input.continuous_audit_started_at_utc ?? GENESIS_UTC,
    })),
    successor_orientation: structuredClone(input.successor_orientation ?? emptySuccessorOrientation()),
    living_ledger: structuredClone(input.living_ledger),
    transition_journal: structuredClone(input.transition_journal ?? []),
    state_sha256: "",
  };
  return sealLifecycleState(state);
}

function assertLineage(previous, next) {
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) assert(previous[field] === next[field], `lifecycle transition changed ${field}`);
  for (const field of ["policy_epoch", "policy_state_sha256", "acceptance_contract_sha256"]) assert(previous[field] === next[field], `lifecycle transition changed ${field} without a policy or acceptance rebind`);
  for (const field of ["role_id", "runtime_identity", "session_id", "state_identity", "environment_id", "capability_set_sha256", "pinned", "persistent", "retention", "continuity_receipt_sha256"]) assert(previous.runtime[field] === next.runtime[field], `lifecycle transition changed persistent Runtime ${field}`);
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id", "role_id", "auditor_session_id", "scope", "started_at_utc"]) assert(previous.continuous_audit_sentinel[field] === next.continuous_audit_sentinel[field], `lifecycle transition changed continuous audit sentinel ${field}`);
}

export function applyLifecycleTransition(previous, next, event = {}) {
  validateLifecycleState(previous);
  const candidate = structuredClone(next);
  assertLineage(previous, candidate);
  assert(canonicalJson(candidate.transition_journal) === canonicalJson(previous.transition_journal),
    "lifecycle transition must append to the current journal");
  assert(ALLOWED_TRANSITIONS[previous.stage]?.has(candidate.stage), `illegal lifecycle transition ${previous.stage} -> ${candidate.stage}`);
  const custodyView = (state) => ({active_writer: state.active_writer, platform_pool: state.platform_pool, roster: state.roster});
  const custodyChanged = canonicalJson(custodyView(previous)) !== canonicalJson(custodyView(candidate));
  if (custodyChanged) {
    assert(candidate.stage === previous.stage || ["FINALIZER_ADMISSION", "FINALIZER_COMPLETION", "NEXT_CAMPAIGN_ADMITTED"].includes(event.type), "custody changed without a stage-boundary operation");
    requireSha(event.payload.before_custody_sha256, "custody transition before digest");
    requireSha(event.payload.after_custody_sha256, "custody transition after digest");
    assert(event.payload.before_custody_sha256 === lifecycleDigest(custodyView(previous)), "custody transition before digest mismatch");
    assert(event.payload.after_custody_sha256 === lifecycleDigest(custodyView(candidate)), "custody transition after digest mismatch");
  }
  for (const hold of previous.holds) {
    assert(!hold.blocked_stages.includes(candidate.stage), `lifecycle transition enters a stage blocked by hold ${hold.hold_id}`);
    if (event.payload?.outcome_id !== undefined) assert(!hold.affected_outcome_ids.includes(event.payload.outcome_id), `lifecycle transition advances an outcome blocked by hold ${hold.hold_id}`);
  }
  requireString(event.type ?? "LIFECYCLE_TRANSITION", "lifecycle event type");
  if (previous.stage === "TERMINAL_PROPOSED" && candidate.stage === "FIRST_PASS_REPAIR_REQUIRED") {
    const checkpoint = candidate.checkpoint_ledger.entries.find((entry) => entry.candidate_id === candidate.checkpoint_ledger.active_candidate_id);
    assert(checkpoint?.status === "REPAIR_REQUIRED", "immediate repair transition lacks repair-required checkpoint");
  }
  if (previous.stage === "FIRST_PASS_REPAIR_REQUIRED" && candidate.stage === "BUILDING") {
    assert(previous.checkpoint_ledger.active_candidate_id !== candidate.checkpoint_ledger.active_candidate_id, "first-pass repair rewrote the terminal candidate identity");
    const checkpoint = candidate.checkpoint_ledger.entries.find((entry) => entry.candidate_id === candidate.checkpoint_ledger.active_candidate_id);
    assert(checkpoint?.parent_candidate_id === previous.checkpoint_ledger.active_candidate_id, "repair checkpoint does not bind its terminal parent");
  }
  if (previous.stage === "TERMINAL_SETTLED" && candidate.stage === "FINALIZER_ACTIVE") {
    assert(previous.active_writer === null && candidate.active_writer?.kind === "CAMPAIGN_FINALIZER", "Finalizer handoff did not transfer exclusive writer custody");
  }
  if (previous.stage === "FINALIZER_ACTIVE" && candidate.stage === "FINALIZER_COMPLETE") {
    assert(candidate.active_writer === null && candidate.finalizer?.status === "COMPLETE", "Finalizer completion did not release custody");
  }
  if (previous.stage === "FINALIZER_COMPLETE" && candidate.stage === "DELTA_AUDIT") {
    const finalCommit = candidate.finalizer.final_commit;
    const finalTree = candidate.finalizer.final_tree;
    assert(candidate.root.commit === finalCommit && candidate.root.tree === finalTree && candidate.root.remote_commit === finalCommit && candidate.root.remote_tree === finalTree, "campaign root did not adopt exact Finalizer output");
  }
  if (previous.stage === "DEPLOYMENT_CLEARED" && candidate.stage === "ACCEPTED_LIVE_PENDING_CLOSURE") {
    exactKeys(event.payload, ["deployment_receipt"], "accepted-live deployment transition payload");
    const receipt = validateDeploymentReceipt(event.payload.deployment_receipt);
    assert(receipt.final_candidate_commit === candidate.root.commit && receipt.final_candidate_tree === candidate.root.tree, "deployment transition is not bound to the accepted root");
    assert(candidate.runtime.deployed_identity === receipt.deployed_identity && candidate.runtime.rollback_identity === receipt.rollback_identity, "deployment transition Runtime identity mismatch");
    assert(candidate.runtime.session_id === receipt.runtime_session_id, "deployment transition Runtime session mismatch");
  }
  if (previous.stage === "ACCEPTED_LIVE_PENDING_CLOSURE" && candidate.stage === "ACCEPTED_LIVE_CLOSED") {
    exactKeys(event.payload, ["closure_receipt"], "accepted-live closure transition payload");
    const receipt = validateClosureReceipt(event.payload.closure_receipt);
    assert(receipt.final_candidate_commit === candidate.root.commit && receipt.final_candidate_tree === candidate.root.tree, "closure transition is not bound to the accepted root");
    assert(candidate.runtime.deployed_identity === receipt.deployment_receipt.deployed_identity && candidate.runtime.rollback_identity === receipt.deployment_receipt.rollback_identity, "closure transition Runtime identity mismatch");
    candidate.continuous_audit_sentinel = archiveContinuousAuditSentinel(candidate.continuous_audit_sentinel, {archivedAtUtc: event.at_utc, reason: "ACCEPTED_LIVE_CLOSURE"});
  }
  appendTransition(candidate, previous, event);
  const sealed = sealLifecycleState(candidate);
  assert(sealed.state_sha256 !== previous.state_sha256, "lifecycle transition did not change state");
  return sealed;
}

export function handoffToFinalizer(state, finalizer, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "TERMINAL_SETTLED", "Finalizer handoff requires terminal audit settlement");
  assert(state.active_writer === null, "Feature writer must release custody before Finalizer handoff");
  const next = structuredClone(state);
  next.finalizer = structuredClone(finalizer);
  next.active_writer = {
    kind: "CAMPAIGN_FINALIZER",
    role_id: "CAMPAIGN_FINALIZER",
    session_id: finalizer.session_id,
    lease_id: finalizer.lease_id,
    worktree_id: finalizer.worktree_id,
    goal_sha256: finalizer.goal_sha256,
    writable_scope: "CONSOLIDATED_FINDINGS_ONLY",
  };
  next.stage = "FINALIZER_ACTIVE";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_ADMISSION",
    at_utc: atUtc,
    payload: {
      finalizer_session_id: finalizer.session_id,
      source_candidate_id: finalizer.source_candidate_id,
      before_custody_sha256: lifecycleDigest({active_writer: state.active_writer, platform_pool: state.platform_pool, roster: state.roster}),
      after_custody_sha256: lifecycleDigest({active_writer: next.active_writer, platform_pool: next.platform_pool, roster: next.roster}),
    },
  });
}

export function completeFinalizer(state, finalCommit, finalTree, repositoryProof, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "FINALIZER_ACTIVE", "Finalizer completion requires active Finalizer custody");
  requireIdentifier(finalCommit, "Finalizer final commit");
  requireIdentifier(finalTree, "Finalizer final tree");
  validateRepositoryCheckpointProof(repositoryProof, {worktree_id: state.finalizer.worktree_id, commit: finalCommit, tree: finalTree, remote_commit: finalCommit, remote_tree: finalTree});
  assert(repositoryProof.clean === true && repositoryProof.pushed === true, "Finalizer completion requires a clean pushed repository proof");
  const next = structuredClone(state);
  next.finalizer.status = "COMPLETE";
  next.finalizer.final_commit = finalCommit;
  next.finalizer.final_tree = finalTree;
  next.finalizer.clean = true;
  next.finalizer.pushed = true;
  next.finalizer.repository_proof = structuredClone(repositoryProof);
  const body = structuredClone(next.finalizer);
  delete body.finalizer_sha256;
  next.finalizer.finalizer_sha256 = lifecycleDigest(body);
  next.active_writer = null;
  next.stage = "FINALIZER_COMPLETE";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_COMPLETION",
    at_utc: atUtc,
    payload: {
      final_commit: finalCommit,
      final_tree: finalTree,
      before_custody_sha256: lifecycleDigest({active_writer: state.active_writer, platform_pool: state.platform_pool, roster: state.roster}),
      after_custody_sha256: lifecycleDigest({active_writer: next.active_writer, platform_pool: next.platform_pool, roster: next.roster}),
    },
  });
}

export function adoptFinalizerRoot(state, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "FINALIZER_COMPLETE", "Finalizer root adoption requires completed Finalizer");
  const next = structuredClone(state);
  const finalizer = next.finalizer;
  next.root.commit = finalizer.final_commit;
  next.root.tree = finalizer.final_tree;
  next.root.remote_commit = finalizer.final_commit;
  next.root.remote_tree = finalizer.final_tree;
  next.root.clean = true;
  next.root.pushed = true;
  next.stage = "DELTA_AUDIT";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_ROOT_ADOPTION",
    at_utc: atUtc,
    payload: {final_commit: finalizer.final_commit, final_tree: finalizer.final_tree},
  });
}

export function setHold(state, hold) {
  validateLifecycleState(state);
  validateHold(hold);
  const next = structuredClone(state);
  assert(!next.holds.some((item) => item.hold_id === hold.hold_id), "hold ID already exists");
  next.holds.push(structuredClone(hold));
  next.holds.sort((left, right) => compareUtf8(left.hold_id, right.hold_id));
  return applyLifecycleTransition(state, next, {
    type: "HOLD_SET",
    at_utc: hold.created_at_utc,
    payload: {hold_id: hold.hold_id, scope: hold.scope, kind: hold.kind},
  });
}

export function clearHold(state, holdId, evidenceSha256) {
  validateLifecycleState(state);
  requireIdentifier(holdId, "hold ID");
  exactKeys(evidenceSha256, ["condition_sha256", "affected_outcome_ids", "evidence_sha256", "resolved_at_utc"], "hold resolution");
  requireSha(evidenceSha256.condition_sha256, "hold resolution condition");
  sortedUniqueStrings(evidenceSha256.affected_outcome_ids, "hold resolution outcomes");
  requireSha(evidenceSha256.evidence_sha256, "hold resolution evidence");
  requireUtc(evidenceSha256.resolved_at_utc, "hold resolution time");
  const next = structuredClone(state);
  const hold = next.holds.find((item) => item.hold_id === holdId);
  assert(hold !== undefined, "hold is not active");
  assert(evidenceSha256.condition_sha256 === hold.resume_condition_sha256, "hold resolution does not satisfy the recorded resume condition");
  assert(canonicalJson(evidenceSha256.affected_outcome_ids) === canonicalJson(hold.affected_outcome_ids), "hold resolution outcome scope differs");
  assert(evidenceSha256.evidence_sha256 === lifecycleDigest({...evidenceSha256, evidence_sha256: null}), "hold resolution evidence is not content-addressed");
  const before = next.holds.length;
  next.holds = next.holds.filter((hold) => hold.hold_id !== holdId);
  assert(next.holds.length === before - 1, "hold is not active");
  return applyLifecycleTransition(state, next, {
    type: "HOLD_CLEARED",
    payload: {hold_id: holdId, resolution_evidence_sha256: evidenceSha256},
  });
}

export function orientNextCampaignOrchestrator(state, binding, predeploymentCandidate) {
  validateLifecycleState(state);
  assert(["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED"].includes(state.stage), "next Orchestrator orientation requires release clearance");
  validateSuccessorIdentity(binding, "next Campaign Orchestrator", state);
  assert(binding.role_id === "CAMPAIGN_ORCHESTRATOR" && binding.orientation_only === true, "successor orientation must be Orchestrator-only");
  validateSuccessorCandidatePacket(predeploymentCandidate, "predeployment candidate", state, {
    kind: "PREDEPLOYMENT", campaignId: binding.campaign_id, campaignVersion: binding.campaign_version,
  });
  assert(state.successor_orientation.status === "NONE", "next Orchestrator is already oriented");
  const next = structuredClone(state);
  next.successor_orientation = {
    ...emptySuccessorOrientation(),
    status: "ORCHESTRATOR_ORIENTED_HELD",
    orchestrator_binding: structuredClone(binding),
    predeployment_candidate_sha256: predeploymentCandidate.candidate_sha256,
    predeployment_candidate: structuredClone(predeploymentCandidate),
  };
  return applyLifecycleTransition(state, next, {
    type: "NEXT_ORCHESTRATOR_ORIENTED",
    payload: {orchestrator_session_id: binding.session_id, predeployment_candidate_sha256: predeploymentCandidate.candidate_sha256},
  });
}

export function recordLiveDelta(state, orchestratorSessionId, liveDelta) {
  validateLifecycleState(state);
  requireIdentifier(orchestratorSessionId, "oriented Orchestrator session");
  assert(state.stage === "ACCEPTED_LIVE_PENDING_CLOSURE", "live delta requires accepted-live pending closure");
  assert(state.successor_orientation.status === "ORCHESTRATOR_ORIENTED_HELD", "live delta has no oriented successor");
  assert(state.successor_orientation.orchestrator_binding.session_id === orchestratorSessionId, "live delta is bound to the wrong Orchestrator");
  validateSuccessorLiveDeltaPacket(liveDelta, "live delta", state, state.successor_orientation.predeployment_candidate);
  const next = structuredClone(state);
  next.successor_orientation.status = "LIVE_DELTA_RECEIVED";
  next.successor_orientation.live_delta_sha256 = liveDelta.live_delta_sha256;
  next.successor_orientation.live_delta = structuredClone(liveDelta);
  return applyLifecycleTransition(state, next, {
    type: "NEXT_ORCHESTRATOR_LIVE_DELTA_RECEIVED",
    payload: {orchestrator_session_id: orchestratorSessionId, live_delta_sha256: liveDelta.live_delta_sha256},
  });
}

export function admitNextCampaign(state, {finalCandidate, auditorBinding, featureAgentBindings, platformAgentBindings = []}) {
  validateLifecycleState(state);
  assert(state.stage === "ACCEPTED_LIVE_CLOSED", "next campaign admission requires accepted-live closure");
  assert(state.successor_orientation.status === "LIVE_DELTA_RECEIVED", "next campaign admission requires the live delta");
  validateSuccessorCandidatePacket(finalCandidate, "final next-campaign candidate", state, {
    kind: "FINAL",
    campaignId: state.successor_orientation.orchestrator_binding.campaign_id,
    campaignVersion: state.successor_orientation.orchestrator_binding.campaign_version,
  });
  assert(finalCandidate.parent_candidate_sha256 === state.successor_orientation.predeployment_candidate_sha256,
    "final next-campaign candidate does not name the predeployment candidate");
  assert(finalCandidate.live_delta_sha256 === state.successor_orientation.live_delta_sha256,
    "final next-campaign candidate does not name the live delta");
  validateSuccessorIdentity(auditorBinding, "next campaign Auditor", state);
  assert(auditorBinding.role_id === "INDEPENDENT_AUDITOR" && auditorBinding.orientation_only === false, "next campaign Auditor binding is invalid");
  assert(Array.isArray(featureAgentBindings) && featureAgentBindings.length > 0, "next campaign Feature roster is empty");
  for (const binding of featureAgentBindings) {
    validateSuccessorIdentity(binding, "next Feature Agent", state);
    assert(binding.role_id.startsWith("FEATURE_AGENT:") && binding.orientation_only === false, "next Feature Agent binding is invalid");
  }
  for (const binding of platformAgentBindings) {
    validateSuccessorIdentity(binding, "next Platform Agent", state);
    assert(binding.role_id.startsWith("PLATFORM_AGENT:") && binding.orientation_only === false, "next Platform Agent binding is invalid");
  }
  const next = structuredClone(state);
  next.successor_orientation.status = "CAMPAIGN_ADMITTED";
  next.successor_orientation.orchestrator_binding.orientation_only = false;
  next.successor_orientation.final_candidate_sha256 = finalCandidate.candidate_sha256;
  next.successor_orientation.final_candidate = structuredClone(finalCandidate);
  next.successor_orientation.auditor_binding = structuredClone(auditorBinding);
  next.successor_orientation.feature_agent_bindings = structuredClone(featureAgentBindings);
  next.successor_orientation.platform_agent_bindings = structuredClone(platformAgentBindings);
  next.successor_orientation.product_writer_lease = "HELD_FOR_ADMISSION";
  return applyLifecycleTransition(state, next, {
    type: "NEXT_CAMPAIGN_ADMITTED",
    payload: {final_candidate_sha256: finalCandidate.candidate_sha256, feature_count: featureAgentBindings.length, platform_count: platformAgentBindings.length},
  });
}

function validateEvent(event) {
  exactKeys(event, ["sequence", "event_id", "writer_session_id", "event_type", "payload", "prior_writer_head_sha256", "event_sha256", "created_at_utc"], "living campaign event");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 0, "living event sequence is invalid");
  requireIdentifier(event.event_id, "living event ID");
  requireIdentifier(event.writer_session_id, "living event writer");
  requireIdentifier(event.event_type, "living event type");
  requireRecord(event.payload, "living event payload");
  if (event.prior_writer_head_sha256 !== null) requireSha(event.prior_writer_head_sha256, "living prior writer head");
  requireSha(event.event_sha256, "living event digest");
  requireUtc(event.created_at_utc, "living event time");
  const body = structuredClone(event);
  delete body.event_sha256;
  assert(event.event_sha256 === lifecycleDigest(body), "living event digest is not content-addressed");
}

export function compileLivingCampaignEvent({sequence, eventId, writerSessionId, eventType, payload, priorWriterHeadSha256 = null, createdAtUtc}) {
  const body = {
    sequence,
    event_id: eventId,
    writer_session_id: writerSessionId,
    event_type: eventType,
    payload: structuredClone(payload),
    prior_writer_head_sha256: priorWriterHeadSha256,
    created_at_utc: createdAtUtc,
  };
  const event = {...body, event_sha256: lifecycleDigest(body)};
  validateEvent(event);
  return event;
}

export function validateLivingCampaignLedger(events, {allowEmpty = true} = {}) {
  assert(Array.isArray(events), "living campaign events must be an array");
  if (!allowEmpty) assert(events.length > 0, "living campaign events are empty");
  const heads = new Map();
  events.forEach((event, index) => {
    validateEvent(event);
    assert(event.sequence === index, "living events must have contiguous sequence numbers");
    const head = heads.get(event.writer_session_id) ?? null;
    assert(event.prior_writer_head_sha256 === head, "living event chain is not append-only per writer");
    heads.set(event.writer_session_id, event.event_sha256);
  });
  return Object.fromEntries([...heads.entries()].sort((left, right) => compareUtf8(left[0], right[0])));
}

export function appendLivingCampaignEvent(authorityRoot, relativePath, event, expectedBytes = null) {
  requireString(authorityRoot, "authority root");
  validateRelativePath(relativePath, "living event path");
  validateEvent(event);
  const root = fs.realpathSync.native(path.resolve(authorityRoot));
  const target = path.resolve(root, relativePath);
  assert(target === root || target.startsWith(`${root}${path.sep}`), "living event path escapes authority root");
  let current = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), "living event path traverses an unsafe directory");
    } else {
      fs.mkdirSync(current);
    }
  }
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "living event target is not a regular file");
    }
    const observed = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    if (expectedBytes !== null) assert(observed.equals(expectedBytes), "living event compare-and-swap failed");
    const existingEvents = observed.length === 0
      ? []
      : observed.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const existingHeads = validateLivingCampaignLedger(existingEvents);
    assert(event.sequence === existingEvents.length, "living event sequence does not append to the current ledger");
    assert(event.prior_writer_head_sha256 === (existingHeads[event.writer_session_id] ?? null), "living event writer head does not append to the current ledger");
    const line = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
    const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
    try {
      fs.writeFileSync(descriptor, line);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("living event compare-and-swap lock is already held");
    throw error;
  } finally {
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return {path: relativePath, event_sha256: event.event_sha256};
}

export function writeStateCompareAndSwap(targetPath, expectedBytes, nextState) {
  requireString(targetPath, "state path");
  assert(Buffer.isBuffer(expectedBytes), "expected state bytes must be a Buffer");
  validateLifecycleState(nextState);
  const target = path.resolve(targetPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, {recursive: true});
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target is not a regular file");
  }
  const current = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  assert(current.equals(expectedBytes), "state compare-and-swap expected bytes do not match");
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let temporary = null;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target is not a regular file");
    }
    const lockedCurrent = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    assert(lockedCurrent.equals(expectedBytes), "state compare-and-swap observed a changed state");
    temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.next`);
    const bytes = Buffer.from(`${canonicalJson(nextState)}\n`, "utf8");
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target changed to an unsafe object");
    }
    const beforeRename = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    assert(beforeRename.equals(expectedBytes), "state compare-and-swap changed before commit");
    fs.renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary !== null) {
      try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return nextState.state_sha256;
}

export function decideHeartbeatAction(state, observedAtUtc, nowUtc, policyState) {
  validateLifecycleState(state);
  validatePolicyState(policyState);
  assert(policyState.policy_epoch === state.policy_epoch && policyState.policy_state_sha256 === state.policy_state_sha256,
    "heartbeat policy state is not the lifecycle state policy snapshot");
  requireUtc(observedAtUtc, "last heartbeat");
  requireUtc(nowUtc, "current heartbeat");
  const intervalMinutes = getPolicyValue(policyState, "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES");
  const ageMinutes = (Date.parse(nowUtc) - Date.parse(observedAtUtc)) / 60_000;
  assert(ageMinutes >= 0, "heartbeat time moves backward");
  return {
    action: ageMinutes >= intervalMinutes ? "RECONCILE" : "NO_ACTION",
    age_minutes: ageMinutes,
    interval_minutes: intervalMinutes,
    unaffected_work_continues: true,
    hold_count: state.holds.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("campaign lifecycle controller loaded\n");
