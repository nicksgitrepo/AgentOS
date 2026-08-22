#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {selectEcoModelRoute, validateModelPolicySnapshot} from "../control/eco-model-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prepared = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
const stale = structuredClone(prepared);
stale.status = "ACCEPTED_ACTIVE";
stale.observed_at_utc = "2026-08-21T04:09:00.000Z";
stale.expires_at_utc = "2000-01-01T00:00:00.000Z";
stale.snapshot_sha256 = canonicalDigest({...stale, snapshot_sha256: null});

const staleError = (error) => error?.code === "POLICY_SNAPSHOT_STALE";
assert.throws(() => validateModelPolicySnapshot(stale, {requireActive: true, nowUtc: "2026-08-22T05:40:00.000Z"}), staleError, "expired model policy must remain stale despite an active status and historical caller clock");
assert.throws(() => selectEcoModelRoute({snapshot: stale, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE", "TOOLS"], nowUtc: "2026-08-22T05:40:00.000Z"}), staleError, "route selection must fail closed on an expired model policy");

console.log("PASS AWS IAM Policy model freshness regression: expired snapshots cannot be revived by activation, route selection, or caller-controlled time");
