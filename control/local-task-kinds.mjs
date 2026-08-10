#!/usr/bin/env node

/* One admission list for local worker task kinds.  Unknown work must fail
 * before a worktree, session, child, or command slot is created. */

export const FEATURE_AGENT_TASK_KINDS = Object.freeze([
  "GOVERNANCE_EVIDENCE_REPAIR",
  "DURABLE_SESSION_LIVENESS_REPAIR",
  "DURABLE_SESSION_TEST_ROOT_REPAIR",
  "OWNER_CONVERSATION_SURFACE_REPAIR",
  "OWNER_FEEDBACK_REPAIR",
  "CONTROLLER_SUPERVISOR_BINDING_REPAIR",
  "LOCAL_AGENT_SESSION_BINDING_REPAIR",
  "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR",
  "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR",
  "CONTROLLER_SUPERVISOR_LIVENESS",
  "CONTROLLER_SUPERVISOR_REPAIR",
]);

const ROLE_TASK_KINDS = Object.freeze({
  CAMPAIGN_ORCHESTRATOR: Object.freeze(["INITIAL", "CONTROLLER_SUPERVISOR_LIVENESS", "CONTROLLER_SUPERVISOR_ORCHESTRATE", "GOVERNANCE_EVIDENCE_RECHECK"]),
  INDEPENDENT_AUDITOR: Object.freeze(["INITIAL", "CONTROLLER_SUPERVISOR_LIVENESS", "GOVERNANCE_EVIDENCE_RECHECK", ...FEATURE_AGENT_TASK_KINDS]),
  FEATURE_AGENT: FEATURE_AGENT_TASK_KINDS,
});

export function validateLocalTaskKindForRole({role, taskKind, label = "local worker task kind"}) {
  if (typeof role !== "string" || typeof taskKind !== "string") throw new Error(`${label} requires a role and task kind`);
  const allowed = ROLE_TASK_KINDS[role];
  if (!allowed || !allowed.includes(taskKind)) {
    throw new Error(`${label} ${taskKind} is not admitted for ${role}; unknown or INITIAL Feature work is rejected before mutation`);
  }
  return taskKind;
}

export function localTaskKindsForRole(role) {
  return [...(ROLE_TASK_KINDS[role] ?? [])];
}
