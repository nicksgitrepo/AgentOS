#!/usr/bin/env node

import assert from "node:assert/strict";
import {runContinuousOperatingLoop, runContinuousOperatingLoopIteration} from "../control/continuous-operating-loop.mjs";

const retired = (error) => error.code === "RETIRED_ROLE_AUTHORITY_FORBIDDEN";
assert.throws(() => runContinuousOperatingLoopIteration({loop: {}, workers: []}), retired);
let observed = 0, iterated = 0, resolved = 0;
await assert.rejects(() => runContinuousOperatingLoop({
  observe() { observed += 1; return {}; },
  onIteration() { iterated += 1; },
  resolveIteration() { resolved += 1; },
  once: true,
}), retired);
assert.deepEqual({observed, iterated, resolved}, {observed: 0, iterated: 0, resolved: 0}, "retired loop invoked callbacks before denial");

console.log("PASS continuous operating loop retirement: the old combined Intent Regulator loop cannot observe, repair, replace, or route current work");
