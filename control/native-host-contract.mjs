#!/usr/bin/env node

/* Shared host-boundary constants kept separate so the binder and team controller do not cycle. */

// Ordinary AgentOS execution is pinned to the visible Luna/max profile. A
// caller may still provide an explicit typed profile when a governed host
// boundary requires it, but no ordinary path may fall back to an unspecified
// or lower-tier identity.
export const DEFAULT_AGENT_MODEL = "gpt-5.6-luna";
export const DEFAULT_AGENT_REASONING_EFFORT = "max";
export const NATIVE_SESSION_TOOLS = Object.freeze([
  "create_thread",
  "list_threads",
  "read_thread",
  "send_message_to_thread",
  "set_thread_archived",
  "set_thread_pinned",
  "wait_threads",
]);
