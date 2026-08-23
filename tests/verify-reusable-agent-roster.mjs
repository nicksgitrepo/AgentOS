#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileReusableAgentRoster} from "../control/reusable-agent-roster-compiler.mjs";

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
const permanentEntries = roster.entries.filter((entry) => roster.tiers[0].order.includes(entry.stable_agent_id));
for (const entry of permanentEntries) {
  assert.equal(entry.lifecycle.kind, "LONG_RUNNING_NAMED_AGENT", `${entry.stable_agent_id} is not a long-running named agent`);
  assert.match(entry.lifecycle.worker_rule, /Project Owner explicitly approves that individual use/u, `${entry.stable_agent_id} permits unapproved delegation`);
  assert.match(entry.lifecycle.archive_rule, /INACTIVE/u, `${entry.stable_agent_id} archive rule lacks inactive-process proof`);
  assert.match(entry.lifecycle.archive_rule, /STALE_AND_NO_LONGER_USED/u, `${entry.stable_agent_id} archive rule lacks stale-worktree proof`);
  assert.match(entry.lifecycle.archive_rule, /zero live references/u, `${entry.stable_agent_id} archive rule lacks zero-reference proof`);
}
const spawner = roster.entries.find((entry) => entry.stable_agent_id === "AGENTOS.SPAWNER");
assert(spawner, "Spawner roster entry missing");
assert.match(spawner.exact_narrow_purpose, /host lifecycle operation/u);
assert.doesNotMatch(spawner.exact_narrow_purpose, /Compile exact governance|repair workers|comprehensive plan/u);
const runtime = compileReusableAgentRoster({repositoryRoot: root, writeGenerated: false});
assert.deepEqual(runtime.build_queue, roster.build_queue, "tracked queue differs from the current fail-closed runtime projection");
const stalePolicy = Date.parse(runtime.model_policy.expires_at_utc) <= Date.now();
if (stalePolicy) {
  assert.equal(runtime.build_queue.some((item) => item.eligible), false, "stale model policy left a roster item eligible");
  assert.equal(runtime.entries.filter((entry) => entry.stable_agent_id !== "AGENTOS.SPAWNER" && String(entry.build_state).startsWith("ACCEPTED_")).length, 0, "stale model policy reused a non-Spawner acceptance");
}
assert.notEqual(roster.build_queue.find((item) => item.eligible)?.stable_agent_id, "AGENT.DELIVERY_OPERATIONS_OBSERVABILITY_INCIDENT");
assert(!JSON.stringify(roster).match(/Sociuna|ACME|\/Users\/|\/home\/|private[_ -]?path/iu), "project or private trace leaked into roster");
console.log(`PASS reusable AgentOS roster: ${roster.entries.length} entries, ${roster.build_queue.length} ordered package actions, project-agnostic, content-addressed gates and hostile fixtures`);
