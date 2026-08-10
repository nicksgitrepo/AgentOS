#!/usr/bin/env node

/* Shared host-boundary constants kept separate so the binder and team controller do not cycle. */

// Execution identity is project configuration, not portable authority. The
// null defaults intentionally force callers to supply a typed profile.
export const DEFAULT_AGENT_MODEL = null;
export const DEFAULT_AGENT_REASONING_EFFORT = null;
export const NATIVE_SESSION_TOOLS = Object.freeze([
  "create_thread",
  "list_threads",
  "read_thread",
  "send_message_to_thread",
  "set_thread_archived",
  "set_thread_pinned",
  "wait_threads",
]);
