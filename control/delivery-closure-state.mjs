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
export {
  DELIVERY_OPERATION_GOVERNANCE_SCHEMA,
  RUNTIME_OPERATION_AUTHORIZATION_SCHEMA,
  RUNTIME_OPERATION_COST_PROJECTION_SCHEMA,
  RUNTIME_OPERATION_OWNER_DECISION_SCHEMA,
  RUNTIME_OPERATIONS,
  compileDeliveryOperationGovernance,
  validateDeliveryOperationGovernance,
  compileRuntimeOperationCostProjection,
  validateRuntimeOperationCostProjection,
  compileRuntimeOperationAuthorization,
  validateRuntimeOperationAuthorization,
  approveRuntimeOperationAuthorization,
  rejectRuntimeOperationAuthorization,
  createRuntimeOperationDecisionPacket,
  operationForDeliveryAction,
} from "./delivery-operation-governance.mjs";
