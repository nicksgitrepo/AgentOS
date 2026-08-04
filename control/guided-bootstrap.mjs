#!/usr/bin/env node

// Migration-only compatibility entrypoint. The former multi-phase questionnaire
// owns no setup authority; these exports delegate exact approved-plan execution
// to bootstrap-compiler.mjs.
export {
  approveBootstrapPlan,
  auditBootstrapSetup,
  compileBootstrapPlan,
  createBootstrapExecution,
  executeBootstrapPlan,
  planBootstrapQuestions,
  validateBootstrapPlan,
} from "./bootstrap-compiler.mjs";
