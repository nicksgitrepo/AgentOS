#!/usr/bin/env node

/* Shared host-boundary constants kept separate so the binder and team controller do not cycle. */

// These are fail-closed route sentinels, not executable defaults. Bootstrap
// must replace both values with a selection from the accepted global model
// policy snapshot before any native session request reaches admission.
export const DEFAULT_AGENT_MODEL = "GLOBAL_MODEL_POLICY_SELECTION_REQUIRED";
export const DEFAULT_AGENT_REASONING_EFFORT = "POLICY_SELECTED_REASONING_REQUIRED";
export const NATIVE_SESSION_TOOLS = Object.freeze([
  "create_thread",
  "list_threads",
  "read_thread",
  "send_message_to_thread",
  "set_thread_archived",
  "set_thread_pinned",
  "wait_threads",
]);
