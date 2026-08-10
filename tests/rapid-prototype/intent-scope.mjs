#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  INTENT_CHANGE_CLASSIFICATIONS,
  compileIntentEnvelope,
  intentEnvelopeDigest,
  classifyIntentChange,
  validateIntentEnvelope,
} from "../../control/rapid-prototype/intent-scope.mjs";

const input = {
  goal: "Demonstrate one bounded governance workflow",
  workflow: ["compile the envelope", "classify the next observation"],
  inScope: ["deterministic normalization", "bounded classification"],
  outOfScope: ["external actions", "product deployment"],
  acceptance: ["same inputs produce the same digest", "material changes fail closed"],
  protectedBoundaries: ["no secrets", "no external side effects", "no hidden scope expansion"],
  assumptions: ["the source readback is current", "the host provides the admitted input"],
};

const baseline = compileIntentEnvelope(input);
const reordered = compileIntentEnvelope({
  ...input,
  inScope: [...input.inScope].reverse(),
  outOfScope: [...input.outOfScope].reverse(),
  acceptance: [...input.acceptance].reverse(),
  protectedBoundaries: [...input.protectedBoundaries].reverse(),
  assumptions: [...input.assumptions].reverse(),
});

assert.deepEqual(baseline, reordered, "intent envelope normalization is not deterministic");
assert.equal(baseline.intent_envelope_sha256, intentEnvelopeDigest(baseline));
validateIntentEnvelope(baseline);
assert.deepEqual([...INTENT_CHANGE_CLASSIFICATIONS], ["PROCEED", "PUZZLE", "SOFT_REVIEW", "HARD_STOP", "DEFERRED_ITERATION"]);
assert.equal(classifyIntentChange({baseline, candidate: baseline}), "PROCEED");

const puzzle = {...baseline, puzzle: {kind: "bounded-reversible-implementation", reversible: true}};
assert.equal(classifyIntentChange({baseline, candidate: puzzle}), "PUZZLE");

const softReview = {...baseline, soft_review: {choice: "use the simpler local arrangement"}};
assert.equal(classifyIntentChange({baseline, candidate: softReview}), "SOFT_REVIEW");

const deferred = {...baseline, deferred_iteration: {reason: "await the next bounded iteration"}};
assert.equal(classifyIntentChange({baseline, candidate: deferred}), "DEFERRED_ITERATION");
assert.equal(classifyIntentChange({baseline, candidate: {...baseline, classification: "deferred_iteration"}}), "DEFERRED_ITERATION");

const hardScopeChange = {...baseline, in_scope: [...baseline.in_scope, "a new outcome"]};
assert.equal(classifyIntentChange({baseline, candidate: hardScopeChange}), "HARD_STOP");
assert.equal(classifyIntentChange(baseline, {...baseline, condition: "the source is no longer current"}), "HARD_STOP");
assert.equal(classifyIntentChange({baseline, candidate: {...baseline, policy: "changed policy"}}), "HARD_STOP");

assert.throws(() => compileIntentEnvelope({...input, goal: ""}), /goal must be a nonempty string/u);
assert.throws(() => compileIntentEnvelope({...input, inScope: ["safe", 42]}), /inScope\[1\] must be a nonempty string/u);
assert.throws(() => compileIntentEnvelope({...input, assumptions: {password: "do-not-store"}}), /secret material/u);
assert.equal(classifyIntentChange({baseline, candidate: {...baseline, intent_envelope_sha256: "0".repeat(64)}}), "HARD_STOP");
assert.equal(classifyIntentChange({baseline, candidate: {...baseline, deferred_iteration: true, scope: "changed"}}), "HARD_STOP");
assert.equal(classifyIntentChange({baseline, candidate: null}), "HARD_STOP");

console.log("PASS AgentOS Rapid Prototype Intent and Scope (deterministic envelope, proceed, puzzle, soft review, hard stop, deferred iteration, and hostile input coverage)");
