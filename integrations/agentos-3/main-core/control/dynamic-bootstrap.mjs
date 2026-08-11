#!/usr/bin/env node

// Migration-only compatibility entrypoint. It owns no setup authority; any
// execution export delegates an already approved exact plan to the canonical compiler.
export {
  discoverProject,
  DISCOVERY_MODES,
} from "./bootstrap-discovery.mjs";

export {
  compileBootstrapPlan,
  createBootstrapExecution,
  executeBootstrapPlan,
  planBootstrapQuestions,
} from "./bootstrap-compiler.mjs";
