#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  applyPolicyAmendment,
  compileGlobalPolicyState,
  compilePolicyAmendment,
  compilePolicyApproval,
  evaluatePolicyQuestion,
  getPolicyValue,
  policyDigest,
  policyStateDigest,
  validatePolicyAmendment,
  validatePolicyState,
} from "../control/global-policy-state.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T01:00:00.000Z";
const failures = [];
let hostiles = 0;

function reject(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostiles += 1;
  }
}

try {
  const input = {
    projectId: "synthetic-project",
    nowUtc: NOW,
    values: {
      "PROJECT.NORTH_STAR": "Prove one useful workflow with honest evidence.",
      "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES": 30,
    },
  };
  const state = compileGlobalPolicyState(input);
  const repeated = compileGlobalPolicyState(structuredClone(input));
  assert.equal(state.policy_state_sha256, repeated.policy_state_sha256);
  assert.equal(policyStateDigest(state), state.policy_state_sha256);
  assert.equal(getPolicyValue(state, "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES"), 30);
  validatePolicyState(state);

  const question = evaluatePolicyQuestion({
    state,
    variableId: "MODEL.ROLE.FEATURE_AGENT",
    requestedValue: "ECONOMICAL",
    authority: "OWNER_BOUNDARY",
    currentBoundary: "NEXT_ASSIGNMENT",
  });
  assert.equal(question.decision, "COMPILE_AMENDMENT");
  assert.equal(question.effective_boundary, "NEXT_ASSIGNMENT");

  const amendment = compilePolicyAmendment({
    state,
    amendmentId: "AMENDMENT-FEATURE-MODEL",
    changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "ECONOMICAL"}],
    request: {
      requested_by: "OWNER",
      authority: "OWNER_BOUNDARY",
      reason: "Use the economical class for broad first-pass feature work.",
      requested_at_utc: NOW,
      effective_boundary: "NEXT_ASSIGNMENT",
      approval_state: "PENDING_EXACT_APPROVAL",
    },
    questionIdsByRoot: {
      FUNCTION_REQUIREMENTS: ["FR-MODEL-BOUNDARY"],
      DESIGN_BIBLE: ["DB-MODEL-BOUNDARY"],
      SECURITY: ["SEC-MODEL-BOUNDARY"],
    },
  });
  assert.equal(amendment.classification, "CURRENT_CAMPAIGN_RECOMPILE");
  assert(amendment.affected_variable_ids.includes("MODEL.ROLE.FEATURE_AGENT"));
  assert(amendment.rotations_required.includes("FEATURE_AGENT"));
  assert.deepEqual(amendment.invalidated_question_ids, []);

  const approval = compilePolicyApproval({
    amendment,
    approvedAtUtc: LATER,
    actorDigestSha256: SHA,
  });
  const next = applyPolicyAmendment({
    state,
    amendment,
    approval,
    currentBoundary: "NEXT_ASSIGNMENT",
  });
  assert.equal(next.policy_epoch, 2);
  assert.equal(getPolicyValue(next, "MODEL.ROLE.FEATURE_AGENT"), "ECONOMICAL");
  assert.equal(next.parent_policy_state_sha256, state.policy_state_sha256);
  assert.equal(next.amendment_ledger.length, 1);
  validatePolicyState(next);

  reject("constitutional acceptance-root weakening", () => compilePolicyAmendment({
    state,
    amendmentId: "AMENDMENT-ROOTS",
    changes: [{variable_id: "ACCEPTANCE.ROOTS", new_value: ["FUNCTION_REQUIREMENTS"]}],
    request: {
      requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "Remove a root.", requested_at_utc: NOW,
      effective_boundary: "GOVERNANCE_VERSION", approval_state: "PENDING_EXACT_APPROVAL",
    },
  }));
  reject("derived variable direct mutation", () => compilePolicyAmendment({
    state,
    amendmentId: "AMENDMENT-DERIVED",
    changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "NOT_A_MODEL_CLASS"}],
    request: {
      requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "Invalid class.", requested_at_utc: NOW,
      effective_boundary: "NEXT_ASSIGNMENT", approval_state: "PENDING_EXACT_APPROVAL",
    },
  }));
  reject("stale parent state", () => applyPolicyAmendment({
    state: next,
    amendment,
    approval,
    currentBoundary: "NEXT_ASSIGNMENT",
  }));
  reject("premature effective boundary", () => applyPolicyAmendment({
    state,
    amendment,
    approval,
    currentBoundary: "IMMEDIATE_SAFE",
  }));
  reject("unauthenticated conversational approval", () => applyPolicyAmendment({
    state,
    amendment,
    approval: compilePolicyApproval({amendment, approvalState: "OWNER_STATED_EXACT_APPROVAL", approvedAtUtc: LATER, actorDigestSha256: SHA}),
    currentBoundary: "NEXT_ASSIGNMENT",
  }));
  reject("secret in policy reason", () => compilePolicyAmendment({
    state,
    amendmentId: "AMENDMENT-SECRET",
    changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "ECONOMICAL"}],
    request: {
      requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "api_key=retained", requested_at_utc: NOW,
      effective_boundary: "NEXT_ASSIGNMENT", approval_state: "PENDING_EXACT_APPROVAL",
    },
  }));
  reject("tampered derived amendment impact", () => {
    const tampered = structuredClone(amendment);
    tampered.affected_variable_ids = [];
    tampered.amendment_sha256 = policyDigest({...tampered, amendment_sha256: null});
    validatePolicyAmendment(tampered);
  });
} catch (error) {
  failures.push(error.stack || error.message);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS AgentOS global policy state (${hostiles} hostile cases)`);
}
