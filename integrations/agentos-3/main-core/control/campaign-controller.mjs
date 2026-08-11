#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  acquirePlatformLease,
  adoptFinalizerRoot,
  admitNextCampaign,
  appendLivingCampaignEvent,
  applyLifecycleTransition,
  archivePlatformAgent,
  canonicalJson,
  clearHold,
  compileAcceptedLiveClosureReceipt,
  compileCheckpoint,
  compileCheckpointLedger,
  compileDeploymentReceipt,
  compileLivingCampaignEvent,
  compileLiveAuditReceipt,
  compileRuntimeBinding,
  compileRepositoryCheckpointProof,
  compileProductAcceptance,
  compileNextCampaignCandidate,
  compileNextCampaignLiveDelta,
  compilePlatformAgent,
  completeFinalizer,
  createLifecycleState,
  decideHeartbeatAction,
  enqueuePlatformRequest,
  handoffToFinalizer,
  lifecycleDigest,
  markPlatformHandoffReady,
  orientNextCampaignOrchestrator,
  releasePlatformLease,
  recordLiveDelta,
  sealLifecycleState,
  setHold,
  startPlatformWork,
  validateCheckpoint,
  validateCheckpointLedger,
  validateLifecycleState,
  validateLivingCampaignLedger,
  validatePlatformAgent,
  writeStateCompareAndSwap,
} from "./campaign-lifecycle.mjs";
import {
  compileCampaignPolicyProjection,
  reconcileCampaignPolicy,
  validateCampaignPolicyProjection,
  validateCampaignPolicyReconciliation,
} from "./campaign-policy-reconcile.mjs";
import {
  applyAndWriteSerializedCampaignTransition,
  applySerializedCampaignTransition,
  compileSerializedStateOwnerSnapshot,
  compileSerializedStateBridge,
  readSerializedCampaignState,
  reconcilePolicyAtCampaignBoundary,
  stateOwnerTempRoot,
  stateOwnerDigest,
  validateSerializedStateOwnerSnapshot,
  validateSerializedStateOwnerResult,
  writeSerializedCampaignStateCompareAndSwap,
  writeSerializedCampaignTransitionCompareAndSwap,
} from "./campaign-state-owner.mjs";
import {validateControllerCampaignCandidate} from "./agentos-controller.mjs";
import {
  deriveChangedSurfacesFromPaths,
  validateAuditPlan,
  validateAuditReconciliation,
  validateFirstPassCandidate,
} from "./campaign-cascade.mjs";
import {readLocalGitCheckpoint} from "./repository-readback.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CAMPAIGN_IDENTITY_BINDING_SCHEMA = "agentos.campaign_identity_binding.v1";
const CAMPAIGN_IDENTITY_BINDING_KIND = "AUDIT_CHECKPOINT_WRAPPER";
const CAMPAIGN_IDENTITY_BINDING_KEYS = [
  "schema", "version", "mapping_kind", "project_id", "campaign_id", "campaign_version",
  "controller_candidate_sha256", "audit_candidate_id", "audit_candidate_sha256", "audit_candidate_commit",
  "audit_candidate_tree", "audit_plan_sha256", "audit_reconciliation_sha256", "binding_sha256",
];

function assertIdentity(condition, message) {
  if (!condition) throw new Error(message);
}

function requireIdentityString(value, label) {
  assertIdentity(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assertIdentity(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentityIdentifier(value, label) {
  requireIdentityString(value, label);
  assertIdentity(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireIdentitySha(value, label) {
  assertIdentity(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function identityBindingBody(binding) {
  const body = structuredClone(binding);
  body.binding_sha256 = null;
  return body;
}

export function campaignIdentityBindingDigest(value) {
  return lifecycleDigest(value);
}

export function validateCampaignIdentityBinding(binding) {
  assertIdentity(binding && typeof binding === "object" && !Array.isArray(binding), "campaign identity binding must be an object");
  const actual = Object.keys(binding).sort();
  const expected = [...CAMPAIGN_IDENTITY_BINDING_KEYS].sort();
  assertIdentity(actual.length === expected.length && actual.every((key, index) => key === expected[index]), "campaign identity binding fields mismatch");
  assertIdentity(binding.schema === CAMPAIGN_IDENTITY_BINDING_SCHEMA && binding.version === 1, "campaign identity binding identity is invalid");
  assertIdentity(binding.mapping_kind === CAMPAIGN_IDENTITY_BINDING_KIND, "campaign identity binding kind is invalid");
  for (const field of ["project_id", "campaign_id", "campaign_version", "audit_candidate_id", "audit_candidate_commit", "audit_candidate_tree"]) requireIdentityIdentifier(binding[field], `campaign identity binding ${field}`);
  for (const field of ["controller_candidate_sha256", "audit_candidate_sha256", "audit_plan_sha256", "audit_reconciliation_sha256", "binding_sha256"]) requireIdentitySha(binding[field], `campaign identity binding ${field}`);
  assertIdentity(binding.binding_sha256 === campaignIdentityBindingDigest(identityBindingBody(binding)), "campaign identity binding digest mismatch");
  return binding;
}

export function compileCampaignIdentityBinding({controllerCandidate, auditCandidate, auditPlan, auditReconciliation}) {
  validateControllerCampaignCandidate(controllerCandidate);
  validateFirstPassCandidate(auditCandidate);
  validateAuditPlan(auditPlan);
  validateAuditReconciliation(auditReconciliation, auditPlan);
  assertIdentity(controllerCandidate.campaign_id === auditCandidate.campaign_id && controllerCandidate.campaign_version === auditCandidate.campaign_version, "campaign identity binding campaign differs");
  assertIdentity(controllerCandidate.policy_epoch === auditCandidate.policy_epoch && controllerCandidate.policy_state_sha256 === auditCandidate.policy_snapshot_sha256, "campaign identity binding policy differs");
  assertIdentity(controllerCandidate.acceptance_contract_sha256 === auditCandidate.acceptance_contract_sha256, "campaign identity binding acceptance contract differs");
  assertIdentity(controllerCandidate.owner_intent_sha256 === auditCandidate.acceptance_contract.owner_intent_sha256, "campaign identity binding owner intent differs");
  assertIdentity(controllerCandidate.source_commit === auditCandidate.commit && controllerCandidate.source_tree === auditCandidate.tree, "campaign identity binding source checkpoint differs");
  const binding = {
    schema: CAMPAIGN_IDENTITY_BINDING_SCHEMA,
    version: 1,
    mapping_kind: CAMPAIGN_IDENTITY_BINDING_KIND,
    project_id: controllerCandidate.project_id,
    campaign_id: controllerCandidate.campaign_id,
    campaign_version: controllerCandidate.campaign_version,
    controller_candidate_sha256: controllerCandidate.candidate_sha256,
    audit_candidate_id: auditCandidate.candidate_id,
    audit_candidate_sha256: auditCandidate.candidate_sha256,
    audit_candidate_commit: auditCandidate.commit,
    audit_candidate_tree: auditCandidate.tree,
    audit_plan_sha256: auditPlan.plan_sha256,
    audit_reconciliation_sha256: auditReconciliation.reconciliation_sha256,
    binding_sha256: null,
  };
  binding.binding_sha256 = campaignIdentityBindingDigest(identityBindingBody(binding));
  return validateCampaignIdentityBinding(binding);
}

export {
  acquirePlatformLease,
  adoptFinalizerRoot,
  admitNextCampaign,
  appendLivingCampaignEvent,
  applyLifecycleTransition,
  archivePlatformAgent,
  canonicalJson,
  clearHold,
  compileAcceptedLiveClosureReceipt,
  compileCheckpoint,
  compileCheckpointLedger,
  compileDeploymentReceipt,
  compileLivingCampaignEvent,
  compileLiveAuditReceipt,
  compileRuntimeBinding,
  compileRepositoryCheckpointProof,
  compileProductAcceptance,
  compileNextCampaignCandidate,
  compileNextCampaignLiveDelta,
  compilePlatformAgent,
  completeFinalizer,
  createLifecycleState,
  decideHeartbeatAction,
  enqueuePlatformRequest,
  handoffToFinalizer,
  lifecycleDigest as campaignDigest,
  markPlatformHandoffReady,
  orientNextCampaignOrchestrator,
  releasePlatformLease,
  recordLiveDelta,
  sealLifecycleState,
  setHold,
  startPlatformWork,
  validateCheckpoint,
  validateCheckpointLedger,
  validateLifecycleState as validateCampaignState,
  validateLivingCampaignLedger,
  validatePlatformAgent,
  writeStateCompareAndSwap,
  compileCampaignPolicyProjection,
  reconcileCampaignPolicy,
  validateCampaignPolicyProjection,
  validateCampaignPolicyReconciliation,
  applySerializedCampaignTransition,
  applyAndWriteSerializedCampaignTransition,
  compileSerializedStateOwnerSnapshot,
  compileSerializedStateBridge,
  readSerializedCampaignState,
  reconcilePolicyAtCampaignBoundary,
  stateOwnerTempRoot,
  stateOwnerDigest,
  validateSerializedStateOwnerSnapshot,
  validateSerializedStateOwnerResult,
  writeSerializedCampaignStateCompareAndSwap,
  writeSerializedCampaignTransitionCompareAndSwap,
  readLocalGitCheckpoint,
};

export {lifecycleDigest};

export function deriveChangedSurfaces(changedPaths) {
  return deriveChangedSurfacesFromPaths(changedPaths);
}

export function compileChangeManifest(root, checkpointId, ownerRoleId, changedPaths) {
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("root is required");
  for (const field of ["root_id", "commit", "tree"]) if (typeof root[field] !== "string" || root[field].length === 0) throw new Error(`root ${field} is required`);
  if (typeof checkpointId !== "string" || checkpointId.length === 0) throw new Error("checkpoint ID is required");
  if (typeof ownerRoleId !== "string" || ownerRoleId.length === 0) throw new Error("owner role is required");
  const sortedPaths = [...changedPaths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const manifest = {
    schema: "governance.change_manifest.v2",
    checkpoint_id: checkpointId,
    owner_role_id: ownerRoleId,
    root: {root_id: root.root_id, commit: root.commit, tree: root.tree},
    changed_paths: sortedPaths,
    changed_surfaces: deriveChangedSurfaces(sortedPaths),
    manifest_sha256: "",
  };
  const body = structuredClone(manifest);
  delete body.manifest_sha256;
  manifest.manifest_sha256 = lifecycleDigest(body);
  return manifest;
}

export function validateCompactEvent(event) {
  return validateLivingCampaignLedger([event], {allowEmpty: false});
}

export function compileCompactEvent(fields) {
  return compileLivingCampaignEvent(fields);
}

export function validateSeamReviewBatch(batch, state) {
  validateLifecycleState(state);
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) throw new Error("audit transport batch is required");
  for (const field of ["candidate_id", "candidate_commit", "candidate_tree", "auditor_session_id", "reports", "batch_sha256"]) {
    if (!(field in batch)) throw new Error(`audit transport field missing: ${field}`);
  }
  if (batch.candidate_id !== state.checkpoint_ledger.active_candidate_id) throw new Error("audit transport is not bound to the current checkpoint");
  if (!Array.isArray(batch.reports)) throw new Error("audit transport reports must be an array");
  if (!/^[0-9a-f]{64}$/u.test(batch.batch_sha256)) throw new Error("audit transport digest is invalid");
  const body = structuredClone(batch);
  delete body.batch_sha256;
  if (lifecycleDigest(body) !== batch.batch_sha256) throw new Error("audit transport is not content-addressed");
  return batch;
}

export function readLivingCampaignLedger(authorityRoot, relativePath) {
  if (typeof authorityRoot !== "string" || typeof relativePath !== "string") throw new Error("living ledger path is required");
  const root = fs.realpathSync.native(path.resolve(authorityRoot));
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("living ledger escapes authority root");
  if (!fs.existsSync(target)) return [];
  const lines = fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

export function compileLivingCampaignView(state, events) {
  validateLifecycleState(state);
  validateLivingCampaignLedger(events);
  const view = {
    schema: "governance.living_campaign_view.v1",
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    state_sha256: state.state_sha256,
    event_count: events.length,
    latest_event_sha256: events.at(-1)?.event_sha256 ?? null,
    stage: state.stage,
    active_writer: state.active_writer,
    holds: state.holds,
    next_action: state.stage === "ACCEPTED_LIVE_CLOSED" ? "ADMIT_NEXT_CAMPAIGN_ORIENTED_PACKET_OR_ARCHIVE" : "CONTINUE_CURRENT_STAGE",
    view_sha256: "",
  };
  const body = structuredClone(view);
  delete body.view_sha256;
  view.view_sha256 = lifecycleDigest(body);
  return view;
}

export {setHold as addLifecycleHold};

function main() {
  const [command, statePath, payloadPath] = process.argv.slice(2);
  if (!command || !statePath) throw new Error("usage: campaign-controller <validate|heartbeat> <state.json> [observed-at-utc now-utc]");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (command === "validate") {
    process.stdout.write(`${canonicalJson(validateLifecycleState(state))}\n`);
    return;
  }
  if (command === "heartbeat") {
    const payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : {};
    process.stdout.write(`${canonicalJson(decideHeartbeatAction(state, payload.observed_at_utc, payload.now_utc, payload.policy_state))}\n`);
    return;
  }
  if (command === "reconcile-policy") {
    const payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : {};
    process.stdout.write(`${canonicalJson(reconcilePolicyAtCampaignBoundary(payload))}\n`);
    return;
  }
  throw new Error(`unknown campaign controller command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
