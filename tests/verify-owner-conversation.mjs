#!/usr/bin/env node

import assert from "node:assert/strict";
import {parseOwnerAnswer, renderOwnerQuestion, validateOwnerQuestion} from "../control/owner-conversation.mjs";
import {digestWithout} from "../control/canonical-json.mjs";

const surface = renderOwnerQuestion({
  question_id: "OWNER-001",
  prompt: "When we're ready, what should I do with it?",
  choices: [
    {value: "SHOW", label: "Show it to me"},
    {value: "KEEP", label: "Keep working on it"},
    {value: "SHARE", label: "Share it with others"},
  ],
  allow_boolean: true,
});
assert.equal(parseOwnerAnswer(surface, "1").value, "SHOW");
assert.equal(parseOwnerAnswer(surface, "yes").answer, "YES");
assert.equal(parseOwnerAnswer(surface, "n").value, false);
assert.equal(surface.internal_fields_hidden, true);
assert.doesNotThrow(() => validateOwnerQuestion(surface));
assert.throws(() => renderOwnerQuestion({question_id: "OWNER-002", prompt: "Which schema should the campaign use?", choices: [{value: "A", label: "A"}, {value: "B", label: "B"}]}), /internal language/u);
const tampered = {...surface, prompt: "Which schema should we use?", digest: null};
tampered.digest = digestWithout(tampered, "digest");
assert.throws(() => validateOwnerQuestion(tampered), /internal language/u);
assert.throws(() => parseOwnerAnswer(surface, "4"), /shown choices/u);
console.log(JSON.stringify({status: "PASS", prompt: surface.prompt, options: surface.choices.length}));
