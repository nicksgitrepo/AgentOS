#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION,
  compileSealedBootstrapHandoff,
  validateSealedBootstrapHandoff,
  validateSealedBootstrapHandoffForController,
} from "../control/sealed-bootstrap-handoff.mjs";

const SHA = (char) => char.repeat(64);
const handoff = compileSealedBootstrapHandoff({
  handoffId: "BOOTSTRAP-HANDOFF-1",
  bootstrapSessionId: "BOOTSTRAP-SESSION-1",
  controllerTaskId: "CONTROLLER-TASK-1",
  hostId: "local",
  projectBindingSha256: SHA("a"),
  controlPlaneBindingSha256: SHA("b"),
  planSha256: SHA("c"),
  executionStateSha256: SHA("d"),
  setupAuditSha256: SHA("e"),
  runtimeReadbackSha256: SHA("f"),
  controllerRuntimeReadbackSha256: SHA("0"),
  capabilitySetSha256: SHA("1"),
  sourceMappingSha256: SHA("2"),
  memoryPlanSha256: SHA("3"),
  quarantineGateStateSha256: SHA("4"),
  productZeroTraceReceiptSha256: SHA("5"),
});
validateSealedBootstrapHandoff(handoff);
assert.equal(handoff.next_action, SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION);
assert.equal(handoff.setup_audit_status, "PASS");
assert.equal(handoff.memory_status, "PREPARED_NOT_ACTIVATED");
assert.equal(handoff.product_mutated, false);
assert.equal(handoff.permanent_roster_admitted, false);
assert.equal(handoff.source_boundaries.quarantine_access, "FORBIDDEN");
assert.equal(handoff.source_boundaries.opaque_exclusions.length, 2);
assert.deepEqual(validateSealedBootstrapHandoffForController(handoff, {controllerTaskId: "CONTROLLER-TASK-1", hostId: "local"}), {
  status: "SEALED_BOOTSTRAP_HANDOFF_VALID",
  handoff_sha256: handoff.handoff_sha256,
  next_action: SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION,
});

const identityDrift = {...handoff, controller_task_id: "CONTROLLER-TASK-2", handoff_sha256: null};
identityDrift.handoff_sha256 = canonicalDigest({...identityDrift, handoff_sha256: null});
assert.throws(() => validateSealedBootstrapHandoffForController(identityDrift, {controllerTaskId: "CONTROLLER-TASK-1", hostId: "local"}), /Controller identity differs/u);

const planDrift = {...handoff, plan_sha256: SHA("6"), handoff_sha256: null};
assert.throws(() => validateSealedBootstrapHandoff(planDrift), /handoff digest/u);

const activeMemory = {...handoff, memory_status: "ACTIVE", handoff_sha256: null};
activeMemory.handoff_sha256 = canonicalDigest({...activeMemory, handoff_sha256: null});
assert.throws(() => validateSealedBootstrapHandoff(activeMemory), /Memory posture is not prepared-only/u);

const productMutation = {...handoff, product_mutated: true, handoff_sha256: null};
productMutation.handoff_sha256 = canonicalDigest({...productMutation, handoff_sha256: null});
assert.throws(() => validateSealedBootstrapHandoff(productMutation), /claims Product mutation/u);

const openedExclusion = structuredClone(handoff);
openedExclusion.source_boundaries.opaque_exclusions[0].content_access = "READ";
openedExclusion.handoff_sha256 = canonicalDigest({...openedExclusion, handoff_sha256: null});
assert.throws(() => validateSealedBootstrapHandoff(openedExclusion), /opaque exclusion content access is invalid/u);

const missingRuntime = {...handoff, runtime_readback_sha256: null, handoff_sha256: null};
assert.throws(() => validateSealedBootstrapHandoff(missingRuntime), /runtime_readback_sha256/u);

console.log("PASS sealed Bootstrap handoff: identity, exact plan/runtime/audit digests, opaque source boundaries, prepared Memory posture, zero Product trace, and hostile fail-closed checks");
