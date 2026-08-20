#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const registryPath = path.join(root, "specialist-blocks/registry/agent-roster.v1.json");
const roster = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const safe = (p) => typeof p === "string" && !path.isAbsolute(p) && !p.split("/").includes("..") && fs.existsSync(path.join(root, p));
assert.equal(roster.schema, "agentos.reusable_agent_roster.v1");
assert.equal(roster.version, 1);
assert.equal(roster.project_agnostic, true);
assert.equal(roster.roster_sha256, canonicalDigest({...roster, roster_sha256: null}));
assert.equal(roster.policy.one_package_at_a_time, true);
assert.equal(roster.policy.permanent_before_platform, true);
assert.equal(roster.policy.platform_before_auditor, true);
assert.equal(roster.policy.seed_is_inert, true);
const ids = new Set();
for (const entry of roster.entries) {
  assert(!ids.has(entry.stable_agent_id), `duplicate roster identity: ${entry.stable_agent_id}`); ids.add(entry.stable_agent_id);
  assert(entry.project_agnostic !== false);
  assert(entry.forbidden_actions.length > 0 && entry.stop_conditions.length > 0);
  assert(entry.deterministic_gates.status);
  for (const gate of entry.deterministic_gates.gates) { assert(safe(gate.path), `${entry.stable_agent_id} gate path missing`); assert.equal(sha(gate.path), gate.file_sha256); }
  for (const fixture of entry.hostile_fixtures.fixtures) { assert(safe(fixture.path), `${entry.stable_agent_id} hostile fixture missing`); assert.equal(sha(fixture.path), fixture.file_sha256); }
  if (entry.package_path !== null && entry.build_state !== "PLANNED_MISSING_PACKAGE") assert(safe(`${entry.package_path}/block.json`), `${entry.stable_agent_id} package missing`);
  assert(entry.model_route.task_class && Number.isInteger(entry.model_route.minimum_capability));
}
// A roster projection must preserve each executable fixture's canonical
// expected disposition.  In particular, a valid accept/route vector must not
// silently collapse to the generic DENY fallback.
const memoryEntry = roster.entries.find((entry) => entry.stable_agent_id === "AGENTOS.MEMORY");
assert(memoryEntry, "Memory roster entry missing");
for (const rosterFixture of memoryEntry.hostile_fixtures.fixtures) {
  const source = JSON.parse(fs.readFileSync(path.join(root, rosterFixture.path), "utf8"));
  const canonicalDisposition = source.vector?.expected_readback?.disposition;
  if (canonicalDisposition) assert.equal(rosterFixture.expected_outcome, canonicalDisposition, `${rosterFixture.fixture_id} lost canonical disposition`);
}
assert.equal(new Set(roster.build_queue.map((item) => item.rank)).size, roster.build_queue.length);
assert.deepEqual(roster.tiers.map((tier) => tier.tier), ["PERMANENT_AGENTOS_ROLES", "PLATFORM_AGENTS", "SPECIALIST_AUDITORS"]);
assert.equal(roster.tiers[0].order[0], "AGENTOS.SPAWNER");
assert.equal(roster.tiers[0].order.includes("AGENTOS_CONTROLLER"), true);
assert.equal(roster.tiers[0].order.includes("AGENTOS.PRODUCT_OWNER"), true);
const acceptedPermanentIds = ["AGENTOS.SPAWNER", "AGENTOS_CONTROLLER", "AGENTOS.PRODUCT_OWNER", "AGENTOS.MEMORY", "AGENTOS.RUNTIME", "AGENTOS.SCHEDULER", "AGENTOS.ORCHESTRATOR"];
for (const id of acceptedPermanentIds) {
  const entry = roster.entries.find((candidate) => candidate.stable_agent_id === id);
  assert(entry, `${id} missing from roster`);
  assert.match(entry.build_state, /^ACCEPTED_/u, `${id} is not marked accepted in the readback index`);
}
const acceptedSecurity = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_ROUTER");
assert(acceptedSecurity, "Security Router missing from roster");
assert.match(acceptedSecurity.build_state, /^ACCEPTED_/u, "Security Router is not marked accepted in the readback index");
const acceptedData = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.DATA_ROUTER");
assert(acceptedData, "Data Router missing from roster");
assert.match(acceptedData.build_state, /^ACCEPTED_/u, "Data Router is not marked accepted in the readback index");
const acceptedObservability = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.DELIVERY_OPERATIONS_OBSERVABILITY_ROUTER");
assert(acceptedObservability, "Observability Router missing from roster");
assert.match(acceptedObservability.build_state, /^ACCEPTED_/u, "Observability Router is not marked accepted in the readback index");
const acceptedProviderEdge = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.PLATFORM_PROVIDER_EDGE_ROUTER");
assert(acceptedProviderEdge, "Provider Edge Router missing from roster");
assert.match(acceptedProviderEdge.build_state, /^ACCEPTED_/u, "Provider Edge Router is not marked accepted in the readback index");
const acceptedDesktopOfflineRealtime = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.PRODUCT_CLIENT_DESKTOP_OFFLINE_REALTIME_ROUTER");
assert(acceptedDesktopOfflineRealtime, "Desktop Offline Realtime Router missing from roster");
assert.match(acceptedDesktopOfflineRealtime.build_state, /^ACCEPTED_/u, "Desktop Offline Realtime Router is not marked accepted in the readback index");
const acceptedProductClient = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.PRODUCT_CLIENT_ROUTER");
assert(acceptedProductClient, "Product Client Router missing from roster");
assert.match(acceptedProductClient.build_state, /^ACCEPTED_/u, "Product Client Router is not marked accepted in the readback index");
const acceptedSoftwareLanguageRuntime = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SOFTWARE_LANGUAGE_RUNTIME_ROUTER");
assert(acceptedSoftwareLanguageRuntime, "Software Language and Runtime Router missing from roster");
assert.match(acceptedSoftwareLanguageRuntime.build_state, /^ACCEPTED_/u, "Software Language and Runtime Router is not marked accepted in the readback index");
assert.equal(roster.build_queue.find((item) => item.eligible)?.stable_agent_id, "AGENT.CONTROL_BOOTSTRAP_PROJECT_INITIALIZER");
assert(!JSON.stringify(roster).match(/Sociuna|ACME|\/Users\/|\/home\/|private[_ -]?path/iu), "project or private trace leaked into roster");
console.log(`PASS reusable AgentOS roster: ${roster.entries.length} entries, ${roster.build_queue.length} ordered package actions, project-agnostic, content-addressed gates and hostile fixtures`);
