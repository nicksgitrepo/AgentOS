#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLifecycleTransition,
  lifecycleDigest,
  validateLifecycleState,
} from "./campaign-lifecycle.mjs";
import {
  applyCascadeTransition,
  cascadeDigest,
  validateCascadeState,
} from "./campaign-cascade.mjs";
import {
  compileCampaignStateBridge,
  bridgeDigest,
  validateCampaignStateBridge,
} from "./campaign-state-bridge.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function compactLifecycleBinding(state) {
  return {
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    logical_lineage_id: state.logical_lineage_id,
    policy_epoch: state.policy_epoch,
    policy_state_sha256: state.policy_state_sha256,
    acceptance_contract_sha256: state.acceptance_contract_sha256,
    stage: state.stage,
    state_sha256: state.state_sha256,
  };
}

function compactCascadeBinding(state) {
  return {
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    logical_lineage_id: state.logical_lineage_id,
    policy_epoch: state.policy_epoch,
    policy_state_sha256: state.policy_state_sha256,
    acceptance_contract_sha256: state.acceptance_contract_sha256,
    stage: state.stage,
    state_sha256: state.cascade_sha256,
  };
}

export function compileSerializedStateBridge({lifecycle, cascade}) {
  validateLifecycleState(lifecycle);
  validateCascadeState(cascade);
  return compileCampaignStateBridge({
    lifecycle: compactLifecycleBinding(lifecycle),
    cascade: compactCascadeBinding(cascade),
  });
}

export function validateSerializedStateOwnerResult(result) {
  requireRecord(result, "serialized state-owner result");
  assert(Object.keys(result).sort().join("\u0000") === "bridge\u0000cascade\u0000lifecycle", "serialized state-owner result fields mismatch");
  validateLifecycleState(result.lifecycle);
  validateCascadeState(result.cascade);
  validateCampaignStateBridge(result.bridge);
  const expected = compileSerializedStateBridge(result);
  assert(expected.bridge_sha256 === result.bridge.bridge_sha256, "state-owner bridge does not bind returned states");
  return result;
}

export function applySerializedCampaignTransition({
  lifecycle,
  cascade,
  nextLifecycle,
  nextCascade,
  lifecycleEvent = {},
  cascadeEvent = {},
}) {
  validateLifecycleState(lifecycle);
  validateCascadeState(cascade);
  validateLifecycleState(nextLifecycle);
  validateCascadeState(nextCascade);
  const beforeBridge = compileSerializedStateBridge({lifecycle, cascade});
  const lifecycleAfter = applyLifecycleTransition(lifecycle, nextLifecycle, lifecycleEvent);
  const cascadeAfter = applyCascadeTransition(cascade, nextCascade, cascadeEvent);
  const result = {
    lifecycle: lifecycleAfter,
    cascade: cascadeAfter,
    bridge: compileSerializedStateBridge({lifecycle: lifecycleAfter, cascade: cascadeAfter}),
  };
  assert(beforeBridge.campaign_id === result.bridge.campaign_id
    && beforeBridge.campaign_version === result.bridge.campaign_version
    && beforeBridge.logical_lineage_id === result.bridge.logical_lineage_id,
  "serialized transition changed campaign lineage");
  return validateSerializedStateOwnerResult(result);
}

function safeAuthorityPath(root, relativePath) {
  const resolvedRoot = fs.realpathSync.native(root);
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "state-owner path escapes authority root");
  return {resolvedRoot, target};
}

export function writeSerializedCampaignTransitionCompareAndSwap({
  authorityRoot,
  lifecyclePath = "campaign/lifecycle.json",
  cascadePath = "campaign/cascade.json",
  bridgePath = "campaign/state-bridge.json",
  expectedLifecycleSha256,
  expectedCascadeSha256,
  expectedBridgeSha256,
  result,
}) {
  requireRecord(result, "serialized state-owner result");
  validateSerializedStateOwnerResult(result);
  requireSha(expectedLifecycleSha256, "expected lifecycle state");
  requireSha(expectedCascadeSha256, "expected cascade state");
  requireSha(expectedBridgeSha256, "expected bridge state");
  const paths = [safeAuthorityPath(authorityRoot, lifecyclePath), safeAuthorityPath(authorityRoot, cascadePath), safeAuthorityPath(authorityRoot, bridgePath)];
  for (const {target} of paths) {
    assert(fs.existsSync(target), "state-owner parent artifact is missing");
    assert(!fs.lstatSync(target).isSymbolicLink(), "state-owner refuses a symlink target");
    assert(fs.lstatSync(target).isFile(), "state-owner parent artifact is not a regular file");
  }
  const current = paths.map(({target}) => fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0));
  const expected = [expectedLifecycleSha256, expectedCascadeSha256, expectedBridgeSha256];
  const actual = [
    lifecycleDigest(JSON.parse(current[0].toString("utf8"))),
    cascadeDigest(JSON.parse(current[1].toString("utf8"))),
    bridgeDigest(JSON.parse(current[2].toString("utf8"))),
  ];
  assert(actual.every((digest, index) => digest === expected[index]), "state-owner compare-and-swap parent mismatch");
  for (const {target} of paths) fs.mkdirSync(path.dirname(target), {recursive: true});
  const payloads = [
    JSON.stringify(result.lifecycle),
    JSON.stringify(result.cascade),
    JSON.stringify(result.bridge),
  ].map((value) => Buffer.from(`${value}\n`, "utf8"));
  const temporary = paths.map(({target}) => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`));
  try {
    for (let index = 0; index < temporary.length; index += 1) fs.writeFileSync(temporary[index], payloads[index], {flag: "wx", mode: 0o600});
    for (let index = 0; index < paths.length; index += 1) fs.renameSync(temporary[index], paths[index].target);
  } finally {
    for (const temporaryPath of temporary) if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, {force: true});
  }
  return {
    lifecycle_sha256: lifecycleDigest(result.lifecycle),
    cascade_sha256: cascadeDigest(result.cascade),
    bridge_sha256: result.bridge.bridge_sha256,
  };
}

export function stateOwnerTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-owner-"));
}
