#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileReusableAgentRoster} from "../control/reusable-agent-roster-compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roster = compileReusableAgentRoster({repositoryRoot: root, writeGenerated: false});
const policyExpired = Date.parse(roster.model_policy.expires_at_utc) <= Date.now();
assert.equal(policyExpired, true, "hostile stale-policy regression requires the current snapshot to be expired");
assert.equal(roster.build_queue.some((item) => item.eligible), false, "stale policy left a roster action eligible");
assert.deepEqual(roster.entries.filter((entry) => entry.build_state.startsWith("ACCEPTED_"))
  .map((entry) => entry.stable_agent_id), ["AGENTOS.SPAWNER"]);
const openApi = roster.entries.find((entry) => entry.stable_agent_id === "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS");
assert(openApi, "OpenAPI roster entry is missing");
assert.equal(openApi.build_state, "CANDIDATE_READY_FOR_QUALIFICATION");
assert.match(roster.build_queue[0]?.reason ?? "", /model-policy snapshot.*fresh/u);
console.log(`PASS hostile stale roster projection: ${roster.entries.length} entries, no eligible successor, Spawner retained as the only admitted identity`);
