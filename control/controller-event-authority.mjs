#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {getSealedCanonicalAuthority, readSealedAuthorityBinding} from "./sealed-canonical-authority.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const USED_EVENT_PATH = "agentos/controller-used-events.jsonl";

function assert(condition, message, code = "CONTROLLER_EVENT_AUTHORITY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}
function safeStatePath(authorityRoot, relativePath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Controller state root must be absolute");
  assert(typeof relativePath === "string" && !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/u).some((part) => part === "" || part === ".."), "Controller event ledger path is unsafe");
  const root = fs.realpathSync.native(authorityRoot), target = path.resolve(root, relativePath);
  assert(target.startsWith(`${root}${path.sep}`), "Controller event ledger escaped state root");
  return target;
}

export function loadCanonicalControllerOperationRegistry() {
  const artifact = readSealedAuthorityBinding(getSealedCanonicalAuthority(), "controller_operation_registry");
  const registry = artifact.value;
  exactKeys(registry, ["schema", "version", "operations", "forbidden_adapter_classes", "registry_sha256"], "Controller operation registry");
  assert(registry.schema === "agentos.controller_operation_registry.v1" && registry.version === 1, "Controller operation registry identity is invalid");
  assert(registry.registry_sha256 === canonicalDigest({...registry, registry_sha256: null}), "Controller operation registry digest mismatch");
  assert(Array.isArray(registry.operations) && registry.operations.length > 0, "Controller operation registry is empty");
  const events = new Set(), adapters = new Set();
  for (const operation of registry.operations) {
    exactKeys(operation, ["event_type", "issuer_role", "adapters", "authority"], "Controller operation");
    assert(!events.has(operation.event_type), `Controller operation event is duplicated: ${operation.event_type}`); events.add(operation.event_type);
    assert(Array.isArray(operation.adapters) && operation.adapters.length > 0, `Controller operation adapters are missing: ${operation.event_type}`);
    for (const adapter of operation.adapters) { assert(!adapters.has(adapter), `Controller adapter is assigned twice: ${adapter}`); adapters.add(adapter); }
  }
  return Object.freeze(structuredClone(registry));
}

export function loadCanonicalControllerIssuerRegistry() {
  const registry = readSealedAuthorityBinding(getSealedCanonicalAuthority(), "controller_issuer_registry").value;
  exactKeys(registry, ["schema", "version", "authority_epoch", "nonce_domain", "trusted_time_policy", "issuers", "operation_registry_sha256", "registry_sha256"], "Controller issuer registry");
  assert(registry.schema === "agentos.controller_issuer_registry.v2" && registry.version === 2, "Controller issuer registry identity is invalid");
  assert(Number.isSafeInteger(registry.authority_epoch) && registry.authority_epoch >= 1, "Controller issuer authority epoch is invalid");
  assert(registry.nonce_domain === "AGENTOS.CONTROLLER.EVENT.V2", "Controller nonce domain is invalid");
  exactKeys(registry.trusted_time_policy, ["clock_source", "maximum_event_age_seconds", "maximum_future_skew_seconds"], "Controller trusted-time policy");
  assert(registry.trusted_time_policy.clock_source === "HOST_MONOTONIC_WALLCLOCK", "Controller trusted-time source is invalid");
  assert(Number.isSafeInteger(registry.trusted_time_policy.maximum_event_age_seconds) && registry.trusted_time_policy.maximum_event_age_seconds > 0 && registry.trusted_time_policy.maximum_event_age_seconds <= 3600, "Controller maximum event age is invalid");
  assert(Number.isSafeInteger(registry.trusted_time_policy.maximum_future_skew_seconds) && registry.trusted_time_policy.maximum_future_skew_seconds >= 0 && registry.trusted_time_policy.maximum_future_skew_seconds <= 60, "Controller future skew is invalid");
  const operations = loadCanonicalControllerOperationRegistry();
  assert(registry.operation_registry_sha256 === operations.registry_sha256, "Controller issuer/operation registry binding differs");
  const ids = new Set(), rolesAndEvents = new Set();
  for (const issuer of registry.issuers) {
    exactKeys(issuer, ["issuer_id", "issuer_role", "status", "activated_at_utc", "revoked_at_utc", "public_key_pem", "event_types", "sequence_domain"], "Controller issuer record");
    assert(/^ISSUER\.[A-Z0-9._:-]+$/u.test(issuer.issuer_id) && !ids.has(issuer.issuer_id), "Controller issuer identity is invalid or duplicated"); ids.add(issuer.issuer_id);
    assert(issuer.status === "ACTIVE" || issuer.status === "REVOKED", "Controller issuer status is invalid");
    assert(ISO_UTC.test(issuer.activated_at_utc) && (issuer.revoked_at_utc === null || ISO_UTC.test(issuer.revoked_at_utc)), "Controller issuer activation/revocation time is invalid");
    assert(issuer.status === "ACTIVE" ? issuer.revoked_at_utc === null : issuer.revoked_at_utc !== null, "Controller issuer revocation state is inconsistent");
    assert(issuer.sequence_domain === "CONTROLLER_STATE_EVENT_CURSOR", "Controller issuer sequence domain is invalid");
    crypto.createPublicKey(issuer.public_key_pem);
    for (const eventType of issuer.event_types) {
      const operation = operations.operations.find((entry) => entry.event_type === eventType);
      assert(operation?.issuer_role === issuer.issuer_role, `Controller issuer operation is unregistered or role-mismatched: ${eventType}`);
      assert(!rolesAndEvents.has(eventType), `Controller event has multiple issuers: ${eventType}`); rolesAndEvents.add(eventType);
    }
  }
  assert(rolesAndEvents.size === operations.operations.length, "Controller issuer registry operation coverage differs");
  assert(typeof registry.registry_sha256 === "string" && SHA256.test(registry.registry_sha256) && registry.registry_sha256 === canonicalDigest({...registry, registry_sha256: null}), "Controller issuer registry digest mismatch");
  return Object.freeze(structuredClone(registry));
}

export function resolveCanonicalControllerIssuer(eventType) {
  const registry = loadCanonicalControllerIssuerRegistry();
  const issuer = registry.issuers.find((record) => record.event_types.includes(eventType));
  assert(issuer !== undefined, `Controller event type is not registered: ${eventType}`);
  return Object.freeze({registry, issuer});
}

export function compileControllerEventNonce(event) {
  const registry = loadCanonicalControllerIssuerRegistry();
  return canonicalDigest({
    nonce_domain: registry.nonce_domain, issuer_id: event.issuer_id, authority_epoch: event.authority_epoch,
    controller_id: event.controller_id, event_id: event.event_id, event_type: event.event_type,
    occurred_at_utc: event.occurred_at_utc, policy_epoch: event.policy_epoch,
    prior_controller_head_sha256: event.prior_controller_head_sha256, project_id: event.project_id,
    sequence: event.sequence,
  });
}

export function controllerSignedEventDigest(event) {
  return canonicalDigest({...structuredClone(event), event_sha256: null, signature_base64: null});
}

export function assertCanonicalControllerEventAuthority({event, state}) {
  const {registry, issuer} = resolveCanonicalControllerIssuer(event.event_type);
  assert(event.issuer_id === issuer.issuer_id && event.source_role === issuer.issuer_role, "Controller event signed issuer identity is not authorized");
  assert(issuer.status === "ACTIVE" && issuer.revoked_at_utc === null, "Controller event issuer is revoked");
  assert(event.authority_epoch === registry.authority_epoch, "Controller event authority epoch is superseded");
  assert(event.nonce === compileControllerEventNonce(event), "Controller event nonce is invalid");
  assert(!event.payload || !Object.keys(event.payload).some((key) => /(?:issuer|role_registry|trusted_time|authority_registry|replay_state|used_event|public_key)/iu.test(key)), "Controller event payload attempts to override canonical authority");
  assert(typeof event.occurred_at_utc === "string" && ISO_UTC.test(event.occurred_at_utc), "Controller event time is invalid");
  const trustedNowMs = Date.now(), eventMs = Date.parse(event.occurred_at_utc), activatedMs = Date.parse(issuer.activated_at_utc);
  assert(Number.isFinite(eventMs) && eventMs >= activatedMs, "Controller event predates issuer activation");
  assert(eventMs <= trustedNowMs + registry.trusted_time_policy.maximum_future_skew_seconds * 1000, "Controller event time is in the future");
  assert(trustedNowMs - eventMs <= registry.trusted_time_policy.maximum_event_age_seconds * 1000, "Controller event is stale");
  assert(event.event_sha256 === controllerSignedEventDigest(event), "Controller signed event body was mutated");
  assert(typeof event.signature_base64 === "string" && crypto.verify(null, Buffer.from(event.event_sha256, "hex"), issuer.public_key_pem, Buffer.from(event.signature_base64, "base64")), "Controller event signature is invalid");
  assert(event.sequence === state.event_cursor + 1, "Controller event sequence is not monotonic");
  assert(event.prior_controller_head_sha256 === state.event_ledger_head_sha256, "Controller replay ledger head is stale");
  return Object.freeze({authority_epoch: registry.authority_epoch, issuer_id: issuer.issuer_id, issuer_role: issuer.issuer_role, registry_sha256: registry.registry_sha256, trusted_at_utc: new Date(trustedNowMs).toISOString()});
}

export function readUsedControllerEvents({stateRoot, relativePath = USED_EVENT_PATH}) {
  const target = safeStatePath(stateRoot, relativePath);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink(), "Controller used-event ledger is unsafe");
  const text = fs.readFileSync(target, "utf8"); assert(text.length === 0 || text.endsWith("\n"), "Controller used-event ledger is truncated");
  return text.length === 0 ? [] : text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

export function consumeControllerEventOnce({stateRoot, event, relativePath = USED_EVENT_PATH}) {
  const target = safeStatePath(stateRoot, relativePath); fs.mkdirSync(path.dirname(target), {recursive: true});
  const lock = `${target}.lock`; let descriptor;
  try { descriptor = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600); fs.writeFileSync(descriptor, `${process.pid}\n`); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined; }
  catch (error) { if (descriptor !== undefined) fs.closeSync(descriptor); if (error.code === "EEXIST") assert(false, "Controller used-event ledger is locked", "CONTROLLER_EVENT_LEDGER_LOCKED"); throw error; }
  try {
    const used = readUsedControllerEvents({stateRoot, relativePath});
    assert(!used.some((entry) => entry.event_sha256 === event.event_sha256 || entry.nonce === event.nonce), "Controller signed event was already consumed", "CONTROLLER_EVENT_REPLAYED");
    const record = {schema:"agentos.controller_used_event.v1",event_sha256:event.event_sha256,nonce:event.nonce,issuer_id:event.issuer_id,authority_epoch:event.authority_epoch,sequence:event.sequence,consumed_at_utc:new Date().toISOString(),record_sha256:null};
    record.record_sha256 = canonicalDigest({...record, record_sha256:null});
    const temporary = `${target}.${record.record_sha256}.stage`, next = [...used, record];
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(fd, `${next.map(canonicalJson).join("\n")}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target); const dfd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    assert(readUsedControllerEvents({stateRoot, relativePath}).at(-1)?.record_sha256 === record.record_sha256, "Controller used-event durable readback differs");
    return Object.freeze(record);
  } finally { try { fs.unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
