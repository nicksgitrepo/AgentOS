#!/usr/bin/env node

import assert from "node:assert/strict";
import {assertPortableRecord, isPortableRecord} from "../control/portable-record.mjs";

const slash = String.fromCharCode(47);
const privatePath = `${slash}Users${slash}private${slash}project${slash}token.txt`;

const safe = {
  schema: "agentos.example.v1",
  workspace_root_ref: "AGENTOS_CONTROL_ROOT",
  source_digest: "a".repeat(64),
};
assert.equal(assertPortableRecord(safe, "safe record"), safe);
assert.equal(isPortableRecord(safe), true);

assert.throws(() => assertPortableRecord({workspace_path: privatePath}, "raw path"), /raw path field/u);
assert.throws(() => assertPortableRecord({nested: privatePath}, "raw value"), /raw path/u);
assert.throws(() => assertPortableRecord({message: `Use${privatePath}`}, "embedded raw value"), /raw path/u);
assert.throws(() => assertPortableRecord({access_token: "opaque"}, "secret field"), /secret field/u);
assert.throws(() => assertPortableRecord({message: "Bearer abc123"}, "secret value"), /secret-like value/u);
assert.equal(isPortableRecord({git_top_level_ref: "AGENTOS_PROJECT_ROOT", value: "ok"}), true);

console.log(JSON.stringify({status: "PASS", safe_reference: safe.workspace_root_ref}));
