#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileProjectLifeContract} from "../control/project-life-contract.mjs";
import {
  compileDeliveryTarget,
  validateDeliveryTarget,
} from "../control/delivery-target.mjs";

const prototypeLife = compileProjectLifeContract({answer: {
  maturity: "PRIVATE_PROTOTYPE",
  audience: "OWNER_ONLY",
  data_posture: "NONE_OR_SYNTHETIC",
}});
const sitesPrototype = compileDeliveryTarget({
  route: "MANAGED",
  projectLifeContract: prototypeLife,
  answer: {family: "MANAGED_SITE", adapter_id: "CHATGPT_SITES", mode: "PROTOTYPE"},
});
assert.equal(sitesPrototype.family, "MANAGED_SITE");
assert.equal(sitesPrototype.adapter_id, "CHATGPT_SITES");
assert.deepEqual(sitesPrototype.adapter_profile.supported_modes, ["PROTOTYPE", "LIMITED_PRODUCT"]);
validateDeliveryTarget(sitesPrototype);

const limitedLife = compileProjectLifeContract({answer: {
  maturity: "LIMITED_PRODUCT",
  audience: "SELECTED_USERS",
  data_posture: "NONE_OR_SYNTHETIC",
}});
const sitesLimited = compileDeliveryTarget({
  route: "MANAGED",
  projectLifeContract: limitedLife,
  answer: {family: "MANAGED_SITE", adapter_id: "CHATGPT_SITES", mode: "LIMITED_PRODUCT", audience: "SELECTED_USERS"},
});
assert.equal(sitesLimited.mode, "LIMITED_PRODUCT");
assert.equal(sitesLimited.production_claim, "LIMITED_PRODUCT");

assert.throws(() => compileDeliveryTarget({
  route: "MANAGED",
  projectLifeContract: limitedLife,
  answer: {family: "MANAGED_SITE", adapter_id: "CHATGPT_SITES", mode: "STANDARD_PRODUCTION"},
}), /does not support/u);
assert.throws(() => compileDeliveryTarget({
  route: "MANAGED",
  projectLifeContract: prototypeLife,
  answer: {family: "MANAGED_SITE", adapter_id: "CHATGPT_SITES", mode: "PROTOTYPE", data_posture: "NON_SENSITIVE_DURABLE"},
}), /prototype delivery target/u);
assert.throws(() => compileDeliveryTarget({
  route: "MANAGED",
  projectLifeContract: prototypeLife,
  answer: {family: "MANAGED_SITE", adapter_id: "CHATGPT_SITES", mode: "LIMITED_PRODUCT"},
}), /exceeds the project life maturity/u);

const tampered = structuredClone(sitesLimited);
tampered.production_claim = "STANDARD_PRODUCTION";
delete tampered.target_sha256;
tampered.target_sha256 = "0".repeat(64);
assert.throws(() => validateDeliveryTarget(tampered), /production claim is invalid|production claim does not match|not content-addressed/u);

console.log("PASS AgentOS Delivery Target (managed-site prototype and limited-product modes, explicit limitations, determinism, and hostile coverage)");
