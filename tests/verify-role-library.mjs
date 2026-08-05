#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileRoleLibrary} from "../control/role-library.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = await compileRoleLibrary(ROOT);
assert.equal(library.packets.length, 16);
const persistent = library.packets.filter((packet) => packet.lifetime === "PERSISTENT");
assert.deepEqual(persistent.map((packet) => packet.role_id).sort(), ["INTENT_REGULATOR", "RUNTIME"]);
const campaign = library.packets.filter((packet) => packet.lifetime === "CAMPAIGN");
assert.equal(campaign.length, 14);
const workers = library.packets.filter((packet) => packet.role_id === "NAMED_LANE_WORKER");
assert.equal(workers.length, 12);
assert.equal(new Set(workers.map((packet) => packet.lane_id)).size, 12);
for (const packet of workers) {
  assert.equal(packet.display_name, `${packet.lane_id} Worker`);
  assert(!packet.display_name.includes("Feature Agent"));
  assert(packet.graph_ids.includes("CORE"));
  assert(packet.graph_ids.includes("EVIDENCE_IDENTITY"));
  assert(packet.graph_ids.includes("PROGRESS_HEALTH"));
  assert(packet.graph_ids.includes("RECOVERY_BOUNDARIES"));
  assert(packet.graph_ids.includes("SECURITY_PRIVACY"));
}
console.log(JSON.stringify({status: "PASS", packet_count: library.packets.length, digest: library.digest}));

