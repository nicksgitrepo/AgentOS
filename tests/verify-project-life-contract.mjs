#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileProjectLifeContract,
  projectLifeContractNeedsOwner,
  validateProjectLifeContract,
} from "../control/project-life-contract.mjs";

const safe = compileProjectLifeContract({discovery: []});
assert.equal(safe.status, "DEFAULTED");
assert.equal(safe.maturity, "PRIVATE_PROTOTYPE");
assert.equal(safe.audience, "OWNER_ONLY");
assert.equal(safe.data_posture, "NONE_OR_SYNTHETIC");
validateProjectLifeContract(safe);
assert.deepEqual(safe, compileProjectLifeContract({discovery: []}), "default life contract is not deterministic");

assert.equal(projectLifeContractNeedsOwner({
  deliveryAnswer: {delivery_target: {mode: "LIMITED_PRODUCT"}},
  technicalAnswer: {},
  discovery: [],
}), true);
assert.equal(projectLifeContractNeedsOwner({deliveryAnswer: {deployment: {route: "LOCAL"}}, technicalAnswer: {}, discovery: []}), false);

const limited = compileProjectLifeContract({answer: {
  maturity: "LIMITED_PRODUCT",
  audience: "SELECTED_USERS",
  data_posture: "NON_SENSITIVE_DURABLE",
  expected_lifetime: "LONG_LIVED",
  maintenance_posture: "ACTIVE_MAINTENANCE",
  portability: "PORTABLE_REQUIRED",
}});
assert.equal(limited.status, "OWNER_CONFIRMED");
assert.equal(limited.production_claim, "LIMITED_PRODUCT");
assert.equal(limited.expected_lifetime, "LONG_LIVED");

assert.throws(() => compileProjectLifeContract({answer: {
  maturity: "HIGH_CONSEQUENCE_PRODUCTION",
  assurance_class: "STANDARD",
}}), /HIGH_CONSEQUENCE assurance/u);
assert.throws(() => compileProjectLifeContract({answer: {retirement: "EXPIRE_AFTER_DAYS"}}), /retirement_after_days/u);

const tampered = structuredClone(limited);
tampered.limitations = [];
delete tampered.life_contract_sha256;
tampered.life_contract_sha256 = "0".repeat(64);
assert.throws(() => validateProjectLifeContract(tampered), /limitations are invalid/u);

console.log("PASS AgentOS Project Life Contract (safe default, material-signal question boundary, maturity safety, determinism, and hostile coverage)");
