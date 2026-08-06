#!/usr/bin/env node

import assert from "node:assert/strict";
import {readdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileMigrationRegistry, verifyMigrationRegistry} from "../control/migration-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = await verifyMigrationRegistry(ROOT);
const legacy = registry.seams.filter((seam) => seam.seam_id.startsWith("LEGACY_"));
assert.deepEqual(legacy.map((seam) => seam.seam_id).sort(), [
  "LEGACY_AGENTOS_CONTROLLER",
  "LEGACY_BOOTSTRAP_COMPILER",
  "LEGACY_BOOTSTRAP_COVERAGE",
  "LEGACY_CAMPAIGN_CASCADE",
  "LEGACY_CAMPAIGN_LIFECYCLE",
  "LEGACY_LOCAL_AGENT_WORKER",
  "LEGACY_NATIVE_SESSION_TEAM",
  "LEGACY_OWNER_REVIEW",
  "LEGACY_SUPERVISOR",
]);
assert(legacy.every((seam) => seam.status === "MIGRATED"));
assert(legacy.every((seam) => seam.replacement_paths.some((item) => item.startsWith("control/"))));
const entries = await readdir(path.join(ROOT, "control"), {withFileTypes: true});
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
  const lines = (await readFile(path.join(ROOT, "control", entry.name), "utf8")).split(/\r?\n/u).length - 1;
  assert(lines <= registry.max_control_module_lines, `control/${entry.name} is still monolithic`);
}
assert.equal(compileMigrationRegistry().digest, registry.digest);
console.log(JSON.stringify({status: "PASS", extracted_legacy_boundaries: legacy.length, max_control_module_lines: registry.max_control_module_lines}));
