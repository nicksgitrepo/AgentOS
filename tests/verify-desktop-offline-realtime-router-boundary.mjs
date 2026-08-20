#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateDesktopOfflineRealtimeRouterBoundary, DESKTOP_OFFLINE_REALTIME_ROUTER_BOUNDARY_SCHEMA, DESKTOP_OFFLINE_REALTIME_ROUTER_RESULT_SCHEMA} from "../control/desktop-offline-realtime-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-05/desktop-offline-realtime-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/desktop-offline-realtime-router-boundary-gate.mjs#evaluateDesktopOfflineRealtimeRouterBoundary");
  assert.equal(fixture.vector.input.schema, DESKTOP_OFFLINE_REALTIME_ROUTER_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateDesktopOfflineRealtimeRouterBoundary(fixture.vector.input); const expected = fixture.expected_readback;
  assert.equal(actual.schema, DESKTOP_OFFLINE_REALTIME_ROUTER_RESULT_SCHEMA); assert.equal(actual.disposition, expected.disposition, fixture.fixture_id); assert.equal(actual.route, expected.route, fixture.fixture_id); assert.equal(actual.error_code, expected.error_code, fixture.fixture_id); assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {specialist_invocations: 0, client_reads: 0, client_mutations: 0, project_writes: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "narrowness.json"), "utf8")).vector.input;
assert.throws(() => evaluateDesktopOfflineRealtimeRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "DESKTOP_OFFLINE_REALTIME_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateDesktopOfflineRealtimeRouterBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}), (error) => error.code === "DESKTOP_OFFLINE_REALTIME_ROUTER_CUSTODY_REF_INVALID");
assert.equal(evaluateDesktopOfflineRealtimeRouterBoundary({...valid, evidence: {...valid.evidence, client_mode: "REALTIME"}}).error_code, "DESKTOP_OFFLINE_REALTIME_ROUTER_MODE_SIGNAL_MISMATCH");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateDesktopOfflineRealtimeRouterBoundary({...valid, evidence: {...valid.evidence, client_evidence: `PRIVATE CHAT ${privatePath}`}}), (error) => error.code === "DESKTOP_OFFLINE_REALTIME_ROUTER_PRIVACY_DENIED");
console.log("PASS Desktop/Offline/Realtime Client Router boundary: 17 typed hostile vectors executed with zero client, project, credential, or state side effects");
