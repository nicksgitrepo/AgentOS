#!/usr/bin/env node

/* Public compatibility façade for the delivery and closure boundary. */

export * from "./delivery-closure-foundation.mjs";
export {
  validateDeliveryChoice,
  compileDeliveryChoice,
  validateDeliveryState,
  createDeliveryState,
  validateRuntimeRequest,
  compileRuntimeRequest,
  authorizeRuntimeRequest,
  validateRuntimeReceipt,
  compileRuntimeReceipt,
  compileNoExternalActionReceipt,
  validateRollbackReceipt,
  compileRollbackReceipt,
  validateLiveAuditReceipt,
  compileLiveAuditReceipt,
  validateFinalHandoff,
  compileFinalHandoff,
  validateClosureRecord,
  compileClosureRecord,
} from "./delivery-closure-records.mjs";
export {
  DELIVERY_TRANSITIONS,
  advanceDeliveryState,
  assertCampaignCompletionEligible,
} from "./delivery-closure-transitions.mjs";
export { DELIVERY_ADAPTER_SCHEMA, DELIVERY_ADAPTER_ACTIONS, DELIVERY_ADAPTER_STATUS, compileDeliveryAdapterContract, validateDeliveryAdapterContract, validateDeliveryAdapterForAction, } from "./delivery-adapter.mjs";
