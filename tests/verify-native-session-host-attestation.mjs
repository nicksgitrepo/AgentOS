#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileNativeSessionHostSpawnAttestation,
  compileNativeSessionHostSpawnAttestation as compileAttestation,
  compilePersistedNativeSessionHostSpawnAttestation,
  validateNativeSessionHostSpawnAttestation,
} from "../control/native-session-host-attestation.mjs";
import {compileNativeSessionSpawnRequest} from "../control/native-session-team.mjs";
import {scanPersistedRecord} from "../control/persisted-record-privacy.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const NOW = "2026-08-06T07:45:00.000Z";
const hostThreadId = (suffix) => ["00000000", "0000", "4000", "8000", `00000000000${suffix}`].join("-");
const request = compileNativeSessionSpawnRequest({
  teamId: "TEAM-ATTEST-1",
  projectId: "opaque-project",
  campaignId: "CAMPAIGN-ATTEST-1",
  campaignVersion: "v1",
  role: "FOUNDATION_FUNCTIONALITY",
  sourceCommit: COMMIT,
  sourceTree: TREE,
});

const acceptedWithoutReadback = compileNativeSessionHostSpawnAttestation({
  request,
  hostResponse: {
    threadId: hostThreadId("1"),
    hostId: "local",
  },
  observedAtUtc: NOW,
});
assert.equal(acceptedWithoutReadback.execution_identity_status, "CONTRACT_ACCEPTED_NO_READBACK");
assert.equal(acceptedWithoutReadback.readback_status, "NOT_RETURNED");
assert.equal(acceptedWithoutReadback.requested_model, "gpt-5.6-luna");
assert.equal(acceptedWithoutReadback.requested_reasoning_effort, "max");
assert.equal(acceptedWithoutReadback.host_accepted_model, "gpt-5.6-luna");
assert.equal(acceptedWithoutReadback.host_accepted_reasoning_effort, "max");
assert.equal(acceptedWithoutReadback.host_model_readback, null);
assert.equal(acceptedWithoutReadback.host_reasoning_readback, null);
assert.equal(acceptedWithoutReadback.acceptance, false);
assert.doesNotThrow(() => validateNativeSessionHostSpawnAttestation(acceptedWithoutReadback, {request}));
const persistedAttestation = compilePersistedNativeSessionHostSpawnAttestation(acceptedWithoutReadback);
assert.equal(persistedAttestation.status, "REDACTED");
assert.equal(scanPersistedRecord(persistedAttestation).safe, true);
assert(!JSON.stringify(persistedAttestation).includes(hostThreadId("1")), "raw host thread identity entered the persisted attestation envelope");

const returnedByHost = compileNativeSessionHostSpawnAttestation({
  request,
  hostResponse: {
    thread_id: hostThreadId("2"),
    host_id: "local",
    model: request.model,
    reasoningEffort: request.reasoning_effort,
  },
  observedAtUtc: NOW,
});
assert.equal(returnedByHost.execution_identity_status, "HOST_FIELDS_MATCHED");
assert.equal(returnedByHost.readback_status, "RETURNED_AND_MATCHED");
assert.equal(returnedByHost.host_model_readback, request.model);
assert.equal(returnedByHost.host_reasoning_readback, request.reasoning_effort);

assert.throws(() => compileAttestation({
  request,
  hostResponse: {
    threadId: hostThreadId("3"),
    hostId: "local",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
  },
  observedAtUtc: NOW,
}), /differs from the requested combination/u);

const inventedReadback = structuredClone(acceptedWithoutReadback);
inventedReadback.host_model_readback = request.model;
assert.throws(() => validateNativeSessionHostSpawnAttestation(inventedReadback, {request}), /digest mismatch|accepted-request attestation cannot invent/u);

assert.throws(() => compileNativeSessionHostSpawnAttestation({
  request,
  hostResponse: {threadId: "shell output: fake", hostId: "local"},
  observedAtUtc: NOW,
}), /host thread ID|stable host identity|forbidden substitute/u);

assert.throws(() => compileNativeSessionHostSpawnAttestation({
  request,
  hostResponse: {threadId: hostThreadId("4"), hostId: "local", stdout: "not a host receipt"},
  observedAtUtc: NOW,
}), /shell\/process/u);

console.log("PASS native host spawn attestation: accepted-request provenance stays separate from session readback and rejects mismatch, invented proof, shell IDs, and process output");
