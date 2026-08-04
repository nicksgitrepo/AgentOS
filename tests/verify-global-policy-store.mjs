#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyAndPersistPolicyAmendment,
  readPolicyState,
  writePolicyStateCompareAndSwap,
} from "../control/global-policy-store.mjs";
import {
  compileGlobalPolicyState,
  compilePolicyAmendment,
  compilePolicyApproval,
} from "../control/global-policy-state.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T01:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-policy-store-"));
const statePath = path.join(root, "authority", "global-policy-state.json");
const state = compileGlobalPolicyState({projectId: "synthetic-project", nowUtc: NOW});
try {
  assert.equal(readPolicyState(statePath), null);
  writePolicyStateCompareAndSwap({filePath: statePath, expectedPolicyStateSha256: null, nextState: state});
  assert.equal(readPolicyState(statePath).policy_state_sha256, state.policy_state_sha256);
  const amendment = compilePolicyAmendment({
    state,
    amendmentId: "AMENDMENT-STORE-001",
    changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "ECONOMICAL"}],
    request: {
      requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "Use the economical role class.", requested_at_utc: NOW,
      effective_boundary: "NEXT_ASSIGNMENT", approval_state: "PENDING_EXACT_APPROVAL",
    },
    questionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-STORE"], DESIGN_BIBLE: ["DB-STORE"], SECURITY: ["SEC-STORE"]},
  });
  const approval = compilePolicyApproval({amendment, approvedAtUtc: LATER, actorDigestSha256: SHA});
  const persisted = applyAndPersistPolicyAmendment({filePath: statePath, state, amendment, approval});
  assert.equal(persisted.state.policy_epoch, 2);
  assert.equal(readPolicyState(statePath).amendment_ledger[0].amendment_id, "AMENDMENT-STORE-001");
  assert.throws(() => writePolicyStateCompareAndSwap({filePath: statePath, expectedPolicyStateSha256: state.policy_state_sha256, nextState: state}), /stale/u);
  const linkPath = path.join(root, "link.json");
  fs.symlinkSync(statePath, linkPath);
  assert.throws(() => readPolicyState(linkPath), /symbolic link/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS AgentOS durable global policy store (CAS, readback, append-only amendment state, symlink rejection)");

