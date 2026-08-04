#!/usr/bin/env node

// Compatibility import only. Bootstrap authority lives in bootstrap-compiler.mjs.
// This file exists so earlier callers can migrate without retaining a second setup engine.
export {
  BOOTSTRAP_QUESTIONS,
  DISCOVERY_MODES,
  MODEL_PROFILES,
  PLAN_APPROVAL,
  compileBootstrapPlan,
  compileModelEconomics,
  normalizeModelProfile,
  planBootstrapInterview,
  planBootstrapQuestions,
  recommendModels,
  validateBootstrapAnswer,
} from "./bootstrap-compiler.mjs";
