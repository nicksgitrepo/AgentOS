#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const REGISTRY_URL = new URL("../specialist-blocks/control-plane/agent-spawner/controller-issuer-registry.v1.json", import.meta.url);
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields mismatch`);
}

export function loadCanonicalControllerIssuerRegistry() {
  const registryPath = fs.realpathSync.native(REGISTRY_URL);
  const stat = fs.lstatSync(registryPath);
  assert(stat.isFile() && !stat.isSymbolicLink(), "canonical Controller issuer registry must be a regular file");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  exactKeys(registry, ["schema", "version", "authority_epoch", "maximum_event_age_seconds", "maximum_future_skew_seconds", "issuers", "registry_sha256"], "Controller issuer registry");
  assert(registry.schema === "agentos.controller_issuer_registry.v1" && registry.version === 1, "Controller issuer registry identity is invalid");
  assert(Number.isSafeInteger(registry.authority_epoch) && registry.authority_epoch >= 1, "Controller issuer authority epoch is invalid");
  assert(Number.isSafeInteger(registry.maximum_event_age_seconds) && registry.maximum_event_age_seconds >= 1 && registry.maximum_event_age_seconds <= 3600, "Controller maximum event age is invalid");
  assert(Number.isSafeInteger(registry.maximum_future_skew_seconds) && registry.maximum_future_skew_seconds >= 0 && registry.maximum_future_skew_seconds <= 60, "Controller future skew is invalid");
  assert(Array.isArray(registry.issuers) && registry.issuers.length > 0, "Controller issuer registry is empty");
  const roles = new Set();
  const operations = new Set();
  for (const issuer of registry.issuers) {
    exactKeys(issuer, ["issuer_role", "event_types"], "Controller issuer record");
    assert(typeof issuer.issuer_role === "string" && /^[A-Z][A-Z0-9_]*$/u.test(issuer.issuer_role), "Controller issuer role is invalid");
    assert(!roles.has(issuer.issuer_role), "Controller issuer role is duplicated");
    roles.add(issuer.issuer_role);
    assert(Array.isArray(issuer.event_types) && issuer.event_types.length > 0, "Controller issuer operations are empty");
    for (const eventType of issuer.event_types) {
      assert(typeof eventType === "string" && /^[A-Z][A-Z0-9_]*$/u.test(eventType), "Controller issuer event type is invalid");
      assert(!operations.has(eventType), "Controller event type has multiple trusted issuers");
      operations.add(eventType);
    }
  }
  assert(typeof registry.registry_sha256 === "string" && SHA256.test(registry.registry_sha256), "Controller issuer registry digest is invalid");
  assert(registry.registry_sha256 === digest({...registry, registry_sha256: null}), "Controller issuer registry digest mismatch");
  return Object.freeze(structuredClone(registry));
}

export function resolveCanonicalControllerIssuer(eventType) {
  const registry = loadCanonicalControllerIssuerRegistry();
  const issuer = registry.issuers.find((record) => record.event_types.includes(eventType));
  assert(issuer !== undefined, `Controller event type is not registered: ${eventType}`);
  return {registry, issuer_role: issuer.issuer_role};
}

export function compileControllerEventNonce(event) {
  return digest({
    authority_epoch: event.authority_epoch,
    controller_id: event.controller_id,
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at_utc: event.occurred_at_utc,
    policy_epoch: event.policy_epoch,
    prior_controller_head_sha256: event.prior_controller_head_sha256,
    project_id: event.project_id,
    sequence: event.sequence,
    source_role: event.source_role,
  });
}

export function assertCanonicalControllerEventAuthority({event, state}) {
  const {registry, issuer_role: issuerRole} = resolveCanonicalControllerIssuer(event.event_type);
  assert(event.source_role === issuerRole, "Controller event issuer is not authorized for operation");
  assert(event.authority_epoch === registry.authority_epoch, "Controller event authority epoch is superseded");
  assert(state.policy_epoch >= registry.authority_epoch, "Controller state predates the current authority epoch");
  assert(event.nonce === compileControllerEventNonce(event), "Controller event nonce is invalid");
  assert(!event.payload || !Object.keys(event.payload).some((key) => /(?:issuer|role_registry|trusted_time|authority_registry|replay_state)/iu.test(key)), "Controller event payload attempts to override canonical authority");
  assert(typeof event.occurred_at_utc === "string" && ISO_UTC.test(event.occurred_at_utc), "Controller event time is invalid");
  const trustedNowMs = Date.now();
  const eventMs = Date.parse(event.occurred_at_utc);
  assert(Number.isFinite(eventMs), "Controller event time is invalid");
  assert(eventMs <= trustedNowMs + registry.maximum_future_skew_seconds * 1000, "Controller event time is in the future");
  assert(trustedNowMs - eventMs <= registry.maximum_event_age_seconds * 1000, "Controller event is stale");
  assert(event.sequence === state.event_cursor + 1, "Controller event sequence is not monotonic");
  assert(event.prior_controller_head_sha256 === state.event_ledger_head_sha256, "Controller replay ledger head is stale");
  return Object.freeze({
    authority_epoch: registry.authority_epoch,
    issuer_role: issuerRole,
    registry_sha256: registry.registry_sha256,
    trusted_at_utc: new Date(trustedNowMs).toISOString(),
  });
}
