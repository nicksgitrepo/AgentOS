#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  BOUNDARY_CONFLICT_RULE,
  BOUNDARY_HOLD_RULE,
  compileBoundaryContract,
  validateBoundaryContract,
} from "../control/boundary-contract.mjs";
import {compileProjectLifeContract} from "../control/project-life-contract.mjs";
import {compileDeliveryPolicy} from "../control/delivery-policy.mjs";

const life = compileProjectLifeContract({answer: {maturity: "LIMITED_PRODUCT", audience: "SELECTED_USERS", data_posture: "NONE_OR_SYNTHETIC"}});
const delivery = compileDeliveryPolicy({answer: {
  ci_runner: {route: "LOCAL", weekly_minutes_budget: 100},
  deployment: {route: "LOCAL", environment_ids: ["test"]},
  delivery_target: {supported_scope: ["synthetic"], operating_envelope: ["local-test"], rollback_path: "EXACT_LAST_ACCEPTED_DEPLOYMENT"},
}, projectLifeContract: life});
const ownerBoundaries = {owner_only: ["production promotion", "destructive cleanup"], protected: ["secrets", "accepted truth"]};
const contract = compileBoundaryContract({
  ownerBoundaries,
  projectLifeContract: life,
  deliveryPolicy: delivery,
  technicalBaseline: {testing: "deterministic"},
  discovery: [],
});
validateBoundaryContract(contract);
assert.equal(contract.conflict_rule, BOUNDARY_CONFLICT_RULE);
assert.equal(contract.hold_rule, BOUNDARY_HOLD_RULE);
assert(contract.constitutional.length >= 10);
assert(contract.owner_sovereign.length >= 6);
assert(contract.derived_operating.length >= 4);
assert(contract.temporary_probes.length >= 3);
assert(contract.constitutional.every((row) => row.immutable === true));
assert(contract.owner_sovereign.every((row) => row.immutable === false));
assert.deepEqual(contract, compileBoundaryContract({
  ownerBoundaries,
  projectLifeContract: life,
  deliveryPolicy: delivery,
  technicalBaseline: {testing: "deterministic"},
  discovery: [],
}), "boundary contract is not deterministic");

const weakened = structuredClone(contract);
weakened.constitutional[0].forbidden = [];
delete weakened.boundary_contract_sha256;
weakened.boundary_contract_sha256 = "0".repeat(64);
assert.throws(() => validateBoundaryContract(weakened), /constitutional boundary 0 was weakened/u);

const weakenedRule = structuredClone(contract);
weakenedRule.hold_rule = "CONTINUE_ALL_WORK";
delete weakenedRule.boundary_contract_sha256;
weakenedRule.boundary_contract_sha256 = "0".repeat(64);
assert.throws(() => validateBoundaryContract(weakenedRule), /hold rule is weakened/u);

const unboundOwner = structuredClone(contract);
unboundOwner.owner_sovereign[0].owner_input = {owner_only: ["changed"]};
delete unboundOwner.boundary_contract_sha256;
unboundOwner.boundary_contract_sha256 = "0".repeat(64);
assert.throws(() => validateBoundaryContract(unboundOwner), /owner input is not bound/u);

console.log("PASS AgentOS Boundary Contract (four boundary classes, restrictive conflict law, append-safe owner binding, determinism, and hostile coverage)");
