#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileMigrationRegistry, verifyMigrationRegistry} from "../control/migration-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = await verifyMigrationRegistry(ROOT);
assert.equal(registry.digest, compileMigrationRegistry().digest);
assert.equal(registry.seams.length, 11);
assert.equal(registry.seams.filter((seam) => seam.status === "MIGRATED").length >= 6, true);
assert.equal(registry.seams.some((seam) => seam.status === "EXTERNAL_HOST_REQUIRED"), true);
assert.equal(registry.seams.some((seam) => seam.status === "PARTIAL"), true);
console.log(JSON.stringify({status: "PASS", seams: registry.seams.length, line_limit: registry.max_control_module_lines}));
