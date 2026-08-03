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
  compileProductAcceptance,
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
  compileProductAcceptance,
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
};

export {lifecycleDigest};

export function deriveChangedSurfaces(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) throw new Error("changed paths must be nonempty");
  const surfaces = new Set();
  for (const value of changedPaths) {
    if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("..")) {
      throw new Error("changed path is unsafe");
    }
    if (/\b(?:ui|view|component|route|shell|navigation)\b/iu.test(value)) surfaces.add("UI");
    if (/\b(?:auth|permission|policy|secret|credential|session)\b/iu.test(value)) surfaces.add("AUTHENTICATED_UI");
    if (/\b(?:api|server|service|handler|controller)\b/iu.test(value)) surfaces.add("BACKEND_API");
    if (/\b(?:migration|schema|database|rls|model)\b/iu.test(value)) surfaces.add("DATABASE_SCHEMA");
    if (/\b(?:provider|integration|adapter|client)\b/iu.test(value)) surfaces.add("PROVIDER_INTEGRATION");
    if (/\b(?:runtime|deploy|config|environment)\b/iu.test(value)) surfaces.add("RUNTIME_CONFIG");
  }
  return [...surfaces].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
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
    process.stdout.write(`${canonicalJson(decideHeartbeatAction(state, payload.observed_at_utc, payload.now_utc))}\n`);
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
