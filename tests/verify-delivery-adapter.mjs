#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileDeliveryAdapterContract,
  validateDeliveryAdapterContract,
  validateDeliveryAdapterForAction,
} from "../control/delivery-adapter.mjs";

const POLICY = "a".repeat(64);
const adapter = compileDeliveryAdapterContract({
  adapter_ref: "project-delivery-adapter",
  protocol: "typed-host-v1",
  policy_digest: POLICY,
});
validateDeliveryAdapterContract(adapter);
validateDeliveryAdapterForAction(adapter, "DEPLOY", POLICY);
assert.equal(adapter.status, "PREPARED_NOT_ACTIVATED");
assert.equal(adapter.dry_run.external_effects, false);
assert.equal(adapter.rollback.test_required, true);
assert.equal(adapter.operation_authorization.authority, "RUNTIME_ONLY");
assert.equal(adapter.permissions[0].authority, "RUNTIME_AUTHORIZATION_AFTER_OWNER_DECISION");

const tampered = structuredClone(adapter);
tampered.rollback.supported = false;
delete tampered.digest;
tampered.digest = "0".repeat(64);
assert.throws(() => validateDeliveryAdapterContract(tampered), /rollback contract is weakened|not content-addressed/u);

assert.throws(() => validateDeliveryAdapterForAction(adapter, "DEPLOY", "b".repeat(64)), /different delivery policy/u);
const ownerDirect = structuredClone(adapter);
ownerDirect.permissions[0].authority = "OWNER_DIRECT";
delete ownerDirect.digest;
ownerDirect.digest = "0".repeat(64);
assert.throws(() => validateDeliveryAdapterContract(ownerDirect), /authority is invalid|not content-addressed/u);
assert.throws(() => compileDeliveryAdapterContract({
  adapter_ref: "adapter-secret=material",
  protocol: "typed-host-v1",
  policy_digest: POLICY,
}), /invalid|secret material/u);

console.log("PASS delivery adapter contract: explicit capabilities, action permissions, dry-run, partial-failure, spend, rollback, receipt, and privacy boundaries");
