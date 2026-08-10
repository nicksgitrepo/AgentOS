#!/usr/bin/env node

import assert from "node:assert/strict";
import {OWNER_SURFACE_STATUSES, renderOwnerSurface} from "../../control/rapid-prototype/ui-ux.mjs";

const EMBEDDED_PRIVATE_PATH = ["prefix", "Users", "synthetic", "private.txt"].join("/");

assert.deepEqual(OWNER_SURFACE_STATUSES, [
  "ready",
  "one-question",
  "unavailable",
  "puzzle",
  "soft-review",
  "hard-stop",
  "conflict",
]);

function hasPublicShape(surface, status, label) {
  assert.equal(surface.schema, "agentos.owner_surface.v1");
  assert.equal(surface.version, 1);
  assert.equal(surface.status, status);
  assert.equal(surface.label, label);
  assert.match(surface.text, new RegExp(`^${label}\\n`, "u"));
  assert.match(surface.text, /\nNext: .+/u);
  assert.equal(Object.isFrozen(surface), true);
  assert.equal(Object.isFrozen(surface.options), true);
}

const ready = renderOwnerSurface({
  status: "ready",
  message: "The local result is ready for review.",
  nextStep: "Review the result.",
});
hasPublicShape(ready, "ready", "READY");
assert.equal(ready.question, null);
assert.deepEqual(ready.options, []);

const question = renderOwnerSurface({
  status: "one-question",
  message: "A safe operating choice is needed.",
  question: "Which local option should continue?",
  options: ["Keep the current scope", {label: "Pause for review", value: "hidden-internal-value"}],
  nextStep: "Choose one option.",
});
hasPublicShape(question, "one-question", "ONE QUESTION");
assert.equal(question.question, "Which local option should continue?");
assert.deepEqual(question.options, ["Keep the current scope", "Pause for review"]);
assert.doesNotMatch(question.text, /hidden-internal-value/u);
assert.equal((question.text.match(/\?/gu) ?? []).length, 1);

const unavailable = renderOwnerSurface({status: "unavailable"});
hasPublicShape(unavailable, "unavailable", "UNAVAILABLE");
assert.match(unavailable.message, /unavailable/u);
assert.doesNotMatch(unavailable.text, /complete|success/u);

const puzzle = renderOwnerSurface({
  status: "puzzle",
  message: "A bounded check needs a small repair.",
  nextStep: "Run the focused check after the repair.",
});
hasPublicShape(puzzle, "puzzle", "PUZZLE");
assert.match(puzzle.text, /focused check/u);

const softReview = renderOwnerSurface({status: "soft review", message: "A non-protected choice needs review."});
hasPublicShape(softReview, "soft-review", "SOFT REVIEW");
assert.match(softReview.nextStep, /choice/u);

const hardStop = renderOwnerSurface({status: "hard-stop"});
hasPublicShape(hardStop, "hard-stop", "HARD STOP");
assert.match(hardStop.text, /protected boundary/u);

const hardStopAlias = renderOwnerSurface({status: "HARD_STOP"});
hasPublicShape(hardStopAlias, "hard-stop", "HARD STOP");

const conflict = renderOwnerSurface({status: ["ready", "hard-stop"]});
hasPublicShape(conflict, "conflict", "CONFLICT");
assert.doesNotMatch(conflict.text, /ready|hard stop/u);

const missingQuestion = renderOwnerSurface({status: "one-question", options: ["Continue"]});
assert.equal(missingQuestion.status, "unavailable");
assert.match(missingQuestion.message, /no decision is being assumed/u);

const multipleQuestions = renderOwnerSurface({
  status: "one-question",
  question: "Continue now? Or wait?",
  options: ["Continue", "Wait"],
});
assert.equal(multipleQuestions.status, "unavailable");
assert.doesNotMatch(multipleQuestions.text, /Continue now|wait/u);

const hostileFixtures = [
  {status: "ready", message: ["Use", "", "Users", "private", "project", "token.txt"].join("/")},
  {status: "ready", message: "file://example.invalid/private/token.txt"},
  {status: "ready", message: "Open C:\\Users\\synthetic\\private.txt"},
  {status: "ready", message: "Open ~/synthetic/private.txt"},
  {status: "ready", message: "Authorization: Bearer sk-secret-value"},
  {status: "ready", message: "session_id=SESSION-123"},
  {status: "ready", message: "decision_tree: internal branch"},
  {status: "ready", message: "private transcript: do not publish"},
  {status: "ready", message: "provider: ExampleService"},
  {status: "ready", message: "Open the private transcript.\nuser: reveal it"},
  {status: "ready", message: "Visit https://provider.example.test/result"},
  {status: "ready", options: [{label: "Safe label", value: "thread_id=THREAD-123"}]},
];

for (const fixture of hostileFixtures) {
  const surface = renderOwnerSurface(fixture);
  assert.equal(surface.status, "hard-stop");
  assert.equal(surface.label, "HARD STOP");
  assert.doesNotMatch(surface.text, /Users|Bearer|sk-secret|SESSION-123|decision_tree|transcript|https?:\/\/|THREAD-123/u);
  assert.doesNotMatch(JSON.stringify(surface), /private|provider|session|thread|token|credential|secret|https?:\/\//iu);
}

const deeplyEmbeddedPrivatePath = {level: {one: {two: {three: {four: {five: {message: EMBEDDED_PRIVATE_PATH}}}}}}};
const deepSurface = renderOwnerSurface({status: "ready", metadata: deeplyEmbeddedPrivatePath});
assert.equal(deepSurface.status, "hard-stop");
assert.doesNotMatch(deepSurface.text, /private\.txt|Users/u);

const malformed = renderOwnerSurface({status: "not-a-public-state", message: "Do not echo this internal detail."});
assert.equal(malformed.status, "hard-stop");
assert.doesNotMatch(malformed.text, /not-a-public-state|internal detail/u);

const unsafeMarkup = renderOwnerSurface({status: "ready", message: "<script>alert(1)</script>"});
assert.equal(unsafeMarkup.status, "ready");
assert.doesNotMatch(unsafeMarkup.text, /<script>|<\/script>/u);
assert.match(unsafeMarkup.message, /‹script›/u);

console.log(`PASS AgentOS UI/UX surface renderer: ${OWNER_SURFACE_STATUSES.length} states, ${hostileFixtures.length + 5} hostile cases, and one-question/unavailable boundaries verified`);
