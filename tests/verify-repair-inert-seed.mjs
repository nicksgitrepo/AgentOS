#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const seed = JSON.parse(fs.readFileSync("specialist-blocks/wave-07/repair/seed.json", "utf8"));
assert.equal(seed.schema, "agentos.repair_inert_seed.v1");
assert.equal(seed.status, "VERIFIED_INERT");
assert.equal(seed.activation, "OFF");
assert.equal(seed.immutable, true);
assert.equal(seed.performs_work, false);
assert.equal(seed.can_spawn, false);
assert.equal(seed.can_write, false);
assert.equal(seed.can_deploy, false);
assert.equal(seed.admission, "NOT_ADMITTED");
assert.equal(seed.seed_sha256, canonicalDigest({...seed, seed_sha256: null}));
assert.equal(seed.model_route.selected_model, null);
assert.equal(seed.model_route.reasoning, null);
console.log("PASS Repair inert seed: immutable clean checkpoint, no work/spawn/write/deploy, governed admission required");
