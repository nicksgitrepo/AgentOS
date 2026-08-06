#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {readFile} from "node:fs/promises";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {compileRoleLibrary} from "../control/role-library.mjs";
import {loadQuestionCatalog} from "../control/question-catalog.mjs";
import {renderRoleGatePacket, validateRoleGatePacket} from "../control/role-gate-packet.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = await compileRoleLibrary(ROOT);
const catalog = await loadQuestionCatalog(ROOT);
const general = JSON.parse(await readFile(path.join(ROOT, "governance/general-manifest.json"), "utf8"));
const lanes = JSON.parse(await readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
const graphs = new Map();
for (const binding of [...general.graphs, ...lanes.graphs ?? lanes.lanes]) graphs.set(binding.graph_id, await compileGateFile(path.join(ROOT, binding.path)));

const worker = library.packets.find((packet) => packet.role_id === "NAMED_LANE_WORKER" && packet.lane_id === "functionality");
const workerPacket = renderRoleGatePacket({rolePacket: worker, graphs, catalog});
validateRoleGatePacket(workerPacket, {catalog});
assert.equal(workerPacket.graph_packets.find((packet) => packet.graph_id === "FUNCTIONALITY").questions.length, 12);
assert(workerPacket.graph_ids.every((graphId) => graphId === "FUNCTIONALITY" || graphId === "CORE" || graphId.startsWith("GENERAL_")));
assert(!workerPacket.graph_ids.includes("UI_UX"));

const auditor = library.packets.find((packet) => packet.role_id === "INDEPENDENT_AUDITOR");
const auditorPacket = renderRoleGatePacket({rolePacket: auditor, graphs, catalog});
validateRoleGatePacket(auditorPacket, {catalog});
assert.equal(auditorPacket.graph_packets.length, 20);
assert.equal(auditorPacket.graph_packets.flatMap((packet) => packet.questions).length, 90);
assert(auditorPacket.graph_ids.includes("UI_UX") && auditorPacket.graph_ids.includes("GENERAL_RESPONSE"));

const tampered = {...workerPacket, graph_packets: workerPacket.graph_packets.slice(0, -1), digest: workerPacket.digest};
assert.throws(() => validateRoleGatePacket(tampered, {catalog}), /graph count differs/u);
console.log(JSON.stringify({status: "PASS", builder_questions: workerPacket.graph_packets.flatMap((packet) => packet.questions).length, auditor_questions: auditorPacket.graph_packets.flatMap((packet) => packet.questions).length}));
