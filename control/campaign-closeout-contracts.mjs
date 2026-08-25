#!/usr/bin/env node

/* Public contract surface for the portable campaign closeout gates. */
export {
  CLOSEOUT_LIFECYCLE_SCHEMA,
  CORRELATED_READBACK,
  LOW_CONFIDENCE_CORRELATION_BLOCKER,
  PROJECTION_DIVERGENCE_SCHEMA,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  closeoutStateOrder,
  compileProjectionDivergenceReceipt,
  consumeRecoveredResultOnce,
  consumptionKey,
  correlateThreadReadback,
  createCloseoutLifecycle,
  createConsumptionLedger,
  createDurableHistoryAdapter,
  correctFalseBlocker,
  readOnlyDurableHistoryAdapter,
  readStableAuthorityDigest,
  reconcileReadbackProjection,
  reconcileThreadReadbackProjection,
  validateProjectionDivergenceReceipt,
} from "./campaign-closeout-lifecycle.mjs";
