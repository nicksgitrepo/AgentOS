#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../control/bootstrap-runtime.mjs", import.meta.url), "utf8");

assert.match(source, /monitorResolveIteration = null/u, "Bootstrap must expose the same-turn monitor resolver");
assert.match(source, /monitorOnSameTurnBoundExhausted = null/u, "Bootstrap must expose the replacement-bound failure callback");
assert(source.includes('assert(monitorResolveIteration === null || typeof monitorResolveIteration === "function"'),
  "Bootstrap must type-check the same-turn monitor resolver");
assert(source.includes('assert(monitorOnSameTurnBoundExhausted === null || typeof monitorOnSameTurnBoundExhausted === "function"'),
  "Bootstrap must type-check the replacement-bound callback");

const resolverIndex = source.indexOf("resolveIteration: monitorResolveIteration");
const boundCallbackIndex = source.indexOf("onSameTurnBoundExhausted: monitorOnSameTurnBoundExhausted");
assert(resolverIndex > 0, "Bootstrap did not route the same-turn resolver to Intent Regulator");
assert(boundCallbackIndex > resolverIndex, "Bootstrap did not route the replacement-bound callback after the resolver");

console.log("PASS Bootstrap monitor routing: same-turn repair resolver and explicit replacement-bound failure callback are exposed, validated, and forwarded");
