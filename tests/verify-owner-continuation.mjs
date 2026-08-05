#!/usr/bin/env node

import assert from "node:assert/strict";
import {createOwnerContinuation, createOwnerContinuationRunner, ownerAnswerDigest} from "../control/owner-continuation.mjs";
import {parseOwnerAnswer, renderOwnerQuestion} from "../control/owner-conversation.mjs";

const surface = renderOwnerQuestion({
  question_id: "OWNER.LAUNCH",
  prompt: "Would you like me to begin the local test now?",
  choices: [
    {value: "START_LOCAL_CAMPAIGN", label: "Begin the local test"},
    {value: "KEEP_PREPARED", label: "Keep it prepared"},
  ],
});
const answer = parseOwnerAnswer(surface, "1");
const protected_actions = ["PUBLISH", "PUSH", "MERGE", "DEPLOY", "ROLLBACK", "SPEND", "AUTHENTICATE", "REVEAL_SECRET", "DELETE_ACCEPTED_WORK"];
const initial = createOwnerContinuation({
  activation_id: "ACTIVATION-RC5",
  project_id: "PROJECT-RC5",
  campaign_id: "CAMPAIGN-RC5",
  campaign_version: "V1",
  goal_id: "GOAL-RC5",
  question_id: surface.question_id,
  expected_value: "START_LOCAL_CAMPAIGN",
  protected_actions,
});
assert.equal(ownerAnswerDigest(answer).length, 64);

let admitCalls = 0;
const runner = createOwnerContinuationRunner({
  admit: async (request) => {
    admitCalls += 1;
    await Promise.resolve();
    return {status: "ADMITTED", admission_id: "ADMISSION-RC5", request_digest: request.digest};
  },
});
const [first, second] = await Promise.all([
  runner.resumeAfterOwnerAnswer(initial, answer),
  runner.resumeAfterOwnerAnswer(initial, answer),
]);
assert.equal(admitCalls, 1);
assert.equal(first.status, "RESUMED");
assert.deepEqual(second, first);
assert.deepEqual(first.protected_actions, protected_actions);
assert.equal(first.admission.request_digest, first.resume_request.digest);
assert.equal((await runner.resumeAfterOwnerAnswer(first)).digest, first.digest);
assert.equal(admitCalls, 1);

const wrong = await createOwnerContinuationRunner({admit: async () => {
  throw new Error("admission must not run for a rejected answer");
}}).resumeAfterOwnerAnswer(initial, parseOwnerAnswer(surface, "2"));
assert.equal(wrong.status, "REJECTED");
assert.equal(wrong.failure.code, "OWNER_ANSWER_MISMATCH");

const blocked = await createOwnerContinuationRunner({admit: async () => {
  throw new Error("host admission unavailable");
}}).resumeAfterOwnerAnswer(initial, answer);
assert.equal(blocked.status, "BLOCKED");
assert.equal(blocked.failure.code, "ADMISSION_RESUME_FAILED");

console.log(JSON.stringify({status: "PASS", admit_calls: admitCalls, resumed: first.status, protected_actions: first.protected_actions.length}));
