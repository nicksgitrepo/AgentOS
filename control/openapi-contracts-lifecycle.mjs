#!/usr/bin/env node

/* Lifecycle custody for the inactive OpenAPI candidate. */

import {canonicalDigest} from "./content-addressing.mjs";

export const OPENAPI_CONTRACTS_LIFECYCLE_SCHEMA = "agentos.openapi_contracts_lifecycle_readback.v1";
export const OPENAPI_CONTRACTS_LIFECYCLE_STATES = Object.freeze([
  "CANDIDATE", "EVALUATION_PENDING", "INDEPENDENT_PASS_PENDING", "SUSPENDED", "ARCHIVED", "ADMITTED", "ACTIVE",
]);

function fail(message, code = "OPENAPI_CONTRACTS_LIFECYCLE_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(condition, message, code) { if (!condition) fail(message, code); }

const BUILDER = "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS";
const SPAWNER = "AGENTOS.SPAWNER";
const AUDITOR = "AGENTOS.INDEPENDENT_AUDITOR";

export function transitionOpenApiContractsLifecycle({from, to, actor, independentReceipt = false, invalidationTriggers = [], newRevision = false, archiveReceipt = false} = {}) {
  assert(OPENAPI_CONTRACTS_LIFECYCLE_STATES.includes(from) && OPENAPI_CONTRACTS_LIFECYCLE_STATES.includes(to), "lifecycle state is unknown", "OPENAPI_CONTRACTS_LIFECYCLE_STATE_INVALID");
  assert(typeof actor === "string" && actor.length > 0, "lifecycle actor is missing", "OPENAPI_CONTRACTS_LIFECYCLE_ACTOR_INVALID");
  let allowed = false;
  let reason = "";
  if (from === "CANDIDATE" && to === "EVALUATION_PENDING" && actor === BUILDER) { allowed = true; reason = "BOUND_CANDIDATE_READY_FOR_REVIEW"; }
  if (from === "EVALUATION_PENDING" && to === "INDEPENDENT_PASS_PENDING" && actor === AUDITOR && independentReceipt === true) { allowed = true; reason = "INDEPENDENT_READBACK_RETAINED"; }
  if (["EVALUATION_PENDING", "INDEPENDENT_PASS_PENDING", "ADMITTED", "ACTIVE"].includes(from) && to === "SUSPENDED" && invalidationTriggers.length > 0) { allowed = true; reason = "DEPENDENCY_INVALIDATION_CLOSED_ACTION"; }
  if (from === "SUSPENDED" && to === "EVALUATION_PENDING" && actor === BUILDER && newRevision === true) { allowed = true; reason = "SUCCESSOR_REVISION_REQUIRES_FRESH_REVIEW"; }
  if (from === "ADMITTED" && to === "ACTIVE" && actor === SPAWNER) { allowed = true; reason = "SPAWNER_ONLY_ACTIVATION"; }
  if (from !== "ACTIVE" && to === "ARCHIVED" && actor === SPAWNER && archiveReceipt === true) { allowed = true; reason = "SPAWNER_ARCHIVE_RECEIPT"; }
  const result = {
    schema: OPENAPI_CONTRACTS_LIFECYCLE_SCHEMA,
    version: 1,
    from,
    to,
    actor,
    allowed,
    reason: reason || "TRANSITION_FORBIDDEN",
    invalidation_triggers: [...invalidationTriggers],
    independent_receipt: independentReceipt,
    new_revision: newRevision,
    archive_receipt: archiveReceipt,
    activation: to === "ACTIVE" ? "ON" : "OFF",
    admission_allowed: to === "ADMITTED" || to === "ACTIVE",
    lifecycle_sha256: null,
  };
  result.lifecycle_sha256 = canonicalDigest({...result, lifecycle_sha256: null});
  return Object.freeze(result);
}

export function assertOpenApiContractsLifecycleReadback(record) {
  assert(record && record.schema === OPENAPI_CONTRACTS_LIFECYCLE_SCHEMA && record.version === 1, "lifecycle readback identity is invalid", "OPENAPI_CONTRACTS_LIFECYCLE_SCHEMA_INVALID");
  assert(record.lifecycle_sha256 === canonicalDigest({...record, lifecycle_sha256: null}), "lifecycle readback digest is invalid", "OPENAPI_CONTRACTS_LIFECYCLE_DIGEST_INVALID");
  assert(record.activation === "OFF" || (record.to === "ACTIVE" && record.actor === SPAWNER), "lifecycle activation escaped Spawner custody", "OPENAPI_CONTRACTS_LIFECYCLE_AUTHORITY_INVALID");
  if (record.allowed && (record.to === "ADMITTED" || record.to === "ACTIVE")) assert(record.actor === SPAWNER, "builder or auditor cannot admit or activate", "OPENAPI_CONTRACTS_LIFECYCLE_AUTHORITY_INVALID");
  return record;
}
