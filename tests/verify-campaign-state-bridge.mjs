#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileCampaignStateBridge, validateCampaignStateBridge} from "../control/campaign-state-bridge.mjs";

const SHA = "e".repeat(64);
const base = {
  campaign_id: "CAMPAIGN-1",
  campaign_version: "v1",
  logical_lineage_id: "LINE-1",
  policy_epoch: 1,
  policy_state_sha256: SHA,
  acceptance_contract_sha256: SHA,
};
const lifecycle = {...base, stage: "BUILDING", state_sha256: "f".repeat(64)};
const cascade = {...base, stage: "FIRST_PASS_BUILDING", state_sha256: "1".repeat(64)};
const bridge = compileCampaignStateBridge({lifecycle, cascade});
validateCampaignStateBridge(bridge);
assert.equal(bridge.serialization_rule, "ONE_SERIALIZED_STATE_TRANSITION");
assert.equal(bridge.bridge_sha256, compileCampaignStateBridge({lifecycle: structuredClone(lifecycle), cascade: structuredClone(cascade)}).bridge_sha256);

let hostiles = 0;
function hostile(operation) {
  assert.throws(operation);
  hostiles += 1;
}
hostile(() => compileCampaignStateBridge({lifecycle, cascade: {...cascade, policy_epoch: 2}}));
hostile(() => compileCampaignStateBridge({lifecycle, cascade: {...cascade, acceptance_contract_sha256: "2".repeat(64)}}));
hostile(() => validateCampaignStateBridge({...bridge, bridge_sha256: "0".repeat(64)}));
console.log(`PASS AgentOS campaign state bridge (${hostiles} hostile cases)`);
