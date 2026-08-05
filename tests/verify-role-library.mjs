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
const auditor = library.packets.find((packet) => packet.role_id === "INDEPENDENT_AUDITOR");
assert.equal(auditor.graph_ids.filter((graphId) => graphId !== "CORE" && graphId.startsWith("GENERAL_")).length, 6);
assert.equal(auditor.graph_ids.filter((graphId) => !graphId.startsWith("GENERAL_") && graphId !== "CORE").length, 12);
for (const packet of workers) {
  assert.equal(packet.display_name, `${packet.lane_id} Worker`);
  assert(!packet.display_name.includes("Feature Agent"));
  assert(packet.graph_ids.includes("CORE"));
  assert(packet.graph_ids.includes("GENERAL_EVIDENCE"));
  assert(packet.graph_ids.includes("GENERAL_PROGRESS"));
  assert(packet.graph_ids.includes("GENERAL_RECOVERY"));
  assert(packet.graph_ids.includes("GENERAL_SECURITY"));
}
console.log(JSON.stringify({status: "PASS", packet_count: library.packets.length, digest: library.digest}));
