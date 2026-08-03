#!/usr/bin/env node

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(IDENTIFIER.test(value), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function bridgeDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function validateBinding(binding, label) {
  const keys = ["campaign_id", "campaign_version", "logical_lineage_id", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "stage", "state_sha256"];
  requireRecord(binding, label);
  assert(JSON.stringify(Object.keys(binding).sort()) === JSON.stringify(keys.sort()), `${label} fields mismatch`);
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id", "stage"]) requireString(binding[field], `${label} ${field}`);
  assert(Number.isSafeInteger(binding.policy_epoch) && binding.policy_epoch >= 1, `${label} policy epoch invalid`);
  requireSha(binding.policy_state_sha256, `${label} policy state`);
  requireSha(binding.acceptance_contract_sha256, `${label} acceptance contract`);
  requireSha(binding.state_sha256, `${label} state digest`);
}

export function validateCampaignStateBridge(bridge) {
  const keys = ["schema", "campaign_id", "campaign_version", "logical_lineage_id", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "lifecycle", "cascade", "serialization_rule", "bridge_sha256"];
  requireRecord(bridge, "campaign state bridge");
  assert(JSON.stringify(Object.keys(bridge).sort()) === JSON.stringify(keys.sort()), "campaign state bridge fields mismatch");
  assert(bridge.schema === "governance.campaign_state_bridge.v1", "campaign state bridge schema mismatch");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) requireString(bridge[field], `bridge ${field}`);
  assert(Number.isSafeInteger(bridge.policy_epoch) && bridge.policy_epoch >= 1, "bridge policy epoch invalid");
  requireSha(bridge.policy_state_sha256, "bridge policy state");
  requireSha(bridge.acceptance_contract_sha256, "bridge acceptance contract");
  validateBinding(bridge.lifecycle, "lifecycle bridge");
  validateBinding(bridge.cascade, "cascade bridge");
  for (const source of [bridge.lifecycle, bridge.cascade]) {
    assert(source.campaign_id === bridge.campaign_id && source.campaign_version === bridge.campaign_version && source.logical_lineage_id === bridge.logical_lineage_id, "bridge campaign lineage differs from source");
    assert(source.policy_epoch === bridge.policy_epoch && source.policy_state_sha256 === bridge.policy_state_sha256 && source.acceptance_contract_sha256 === bridge.acceptance_contract_sha256, "bridge policy or acceptance identity differs from source");
  }
  assert(bridge.serialization_rule === "ONE_SERIALIZED_STATE_TRANSITION", "bridge serialization rule is invalid");
  requireSha(bridge.bridge_sha256, "campaign state bridge digest");
  assert(bridge.bridge_sha256 === bridgeDigest({...bridge, bridge_sha256: null}), "campaign state bridge digest mismatch");
  return bridge;
}

export function compileCampaignStateBridge({lifecycle, cascade}) {
  validateBinding(lifecycle, "lifecycle bridge input");
  validateBinding(cascade, "cascade bridge input");
  assert(lifecycle.campaign_id === cascade.campaign_id && lifecycle.campaign_version === cascade.campaign_version && lifecycle.logical_lineage_id === cascade.logical_lineage_id, "lifecycle and cascade campaign identity differs");
  assert(lifecycle.policy_epoch === cascade.policy_epoch && lifecycle.policy_state_sha256 === cascade.policy_state_sha256 && lifecycle.acceptance_contract_sha256 === cascade.acceptance_contract_sha256, "lifecycle and cascade policy identity differs");
  const bridge = {
    schema: "governance.campaign_state_bridge.v1",
    campaign_id: lifecycle.campaign_id,
    campaign_version: lifecycle.campaign_version,
    logical_lineage_id: lifecycle.logical_lineage_id,
    policy_epoch: lifecycle.policy_epoch,
    policy_state_sha256: lifecycle.policy_state_sha256,
    acceptance_contract_sha256: lifecycle.acceptance_contract_sha256,
    lifecycle: structuredClone(lifecycle),
    cascade: structuredClone(cascade),
    serialization_rule: "ONE_SERIALIZED_STATE_TRANSITION",
    bridge_sha256: null,
  };
  bridge.bridge_sha256 = bridgeDigest({...bridge, bridge_sha256: null});
  return validateCampaignStateBridge(bridge);
}
