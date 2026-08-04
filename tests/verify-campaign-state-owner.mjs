#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applySerializedCampaignTransition,
  compileSerializedStateOwnerSnapshot,
  compileSerializedStateBridge,
  readSerializedCampaignState,
  stateOwnerTempRoot,
  validateSerializedStateOwnerSnapshot,
  validateSerializedStateOwnerResult,
  writeSerializedCampaignStateCompareAndSwap,
  writeSerializedCampaignTransitionCompareAndSwap,
} from "../control/campaign-controller.mjs";

assert.equal(typeof applySerializedCampaignTransition, "function");
assert.equal(typeof compileSerializedStateOwnerSnapshot, "function");
assert.equal(typeof writeSerializedCampaignStateCompareAndSwap, "function");
assert.equal(typeof readSerializedCampaignState, "function");
assert.equal(typeof compileSerializedStateBridge, "function");
assert.equal(typeof validateSerializedStateOwnerResult, "function");
assert.equal(typeof writeSerializedCampaignTransitionCompareAndSwap, "function");

const incomplete = {lifecycle: {}, cascade: {}, bridge: {}};
assert.throws(() => validateSerializedStateOwnerResult(incomplete), /lifecycle|campaign/u);
assert.throws(() => compileSerializedStateBridge({lifecycle: {}, cascade: {}}), /lifecycle|campaign/u);

const root = stateOwnerTempRoot();
try {
  assert.throws(() => writeSerializedCampaignTransitionCompareAndSwap({
    authorityRoot: root,
    expectedLifecycleSha256: "a".repeat(64),
    expectedCascadeSha256: "b".repeat(64),
    expectedBridgeSha256: "c".repeat(64),
    result: incomplete,
  }), /state-owner|lifecycle|campaign/u);
  assert.throws(() => validateSerializedStateOwnerSnapshot({}), /state-owner|lifecycle|campaign/u);
  assert.throws(() => compileSerializedStateOwnerSnapshot(incomplete), /lifecycle|campaign/u);
  assert.equal(readSerializedCampaignState({authorityRoot: root}), null);
  assert.throws(() => writeSerializedCampaignStateCompareAndSwap({
    authorityRoot: root,
    expectedStateOwnerSha256: null,
    snapshot: {},
  }), /state-owner|lifecycle|campaign/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS AgentOS campaign state owner: canonical paired-transition exports and fail-closed invalid-state boundaries verified");
