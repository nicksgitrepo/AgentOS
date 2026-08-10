#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOOTSTRAP_ANSWER_SCHEMA,
  acceptBootstrapReply,
  buildBootstrapConversationHandoff,
  buildBootstrapConversationReplay,
  canonicalDigest,
  createBootstrapConversation,
  createBootstrapQuestionMap,
  nextBootstrapQuestion,
  setBootstrapConversationDisposition,
  validateBootstrapConversation,
  validateBootstrapConversationHandoff,
  validateBootstrapConversationReplay,
  validateBootstrapQuestionMap,
} from "../control/bootstrap-conversation.mjs";
import {
  parseBootstrapOwnerAnswer,
  renderBootstrapOwnerQuestion,
  renderBootstrapOwnerQuestionFromPlan,
  validateBootstrapOwnerQuestion,
} from "../control/bootstrap-owner-surface.mjs";

const ownerQuestion = renderBootstrapOwnerQuestion("intent.audience");
validateBootstrapOwnerQuestion(ownerQuestion);
assert.equal(ownerQuestion.prompt, "Who is this for?");
assert.equal(ownerQuestion.choices.length, 0);
assert.equal(ownerQuestion.internal_fields_hidden, true);

const audience = parseBootstrapOwnerAnswer(ownerQuestion, "A small team");
assert.deepEqual(audience, {question_id: "intent.audience", value: "A small team", answer_kind: "TEXT"});

const dynamicMap = createBootstrapQuestionMap([
  {id: "intent.audience", kind: "TEXT", prompt: "Who is this for?", required: true},
  {id: "delivery.finish", kind: "CHOICE", prompt: "When should the first result be ready?", choices: [
    {value: "REVIEW", label: "Ready for review"},
    {value: "SAVE", label: "Save it for later"},
  ], required: true},
  {id: "governance.review_interval", kind: "CHOICE", prompt: "How often should I pause?", choices: [
    {value: 15, label: "15 minutes"},
    {value: 30, label: "30 minutes"},
  ], required: false, default_value: 15},
]);
validateBootstrapQuestionMap(dynamicMap);
const dynamicOwnerQuestion = renderBootstrapOwnerQuestion("delivery.finish", {questionMap: dynamicMap});
const parsedFinish = parseBootstrapOwnerAnswer(dynamicOwnerQuestion, "2", {questionMap: dynamicMap});
assert.equal(parsedFinish.value, "SAVE");
const planProjection = renderBootstrapOwnerQuestionFromPlan({
  schema: "agentos.bootstrap_question_plan.v1",
  next: "project.delivery_finish",
  questions: [{id: "project.delivery_finish", prompt: "When we're ready, what should I do with it?", choices: ["Leave it ready", "Save it safely"]}],
  owner_questions: [{prompt: "When we're ready, what should I do with it?", choices: ["Leave it ready", "Save it safely"], optional: false}],
});
assert.equal(planProjection.question_id, "PROJECT.DELIVERY_FINISH");
assert.equal(planProjection.choices.length, 2);
assert.throws(() => renderBootstrapOwnerQuestionFromPlan({
  schema: "agentos.bootstrap_question_plan.v1",
  next: "project.delivery_finish",
  questions: [{id: "project.delivery_finish", prompt: "When we're ready, what should I do with it?", choices: null}],
  owner_questions: [{prompt: "Which internal field should I edit?", choices: null, optional: false}],
}), /differs/u);

let session = createBootstrapConversation({
  projectRef: "conversation-contract",
  questionMap: dynamicMap,
  initialAnswers: {
    "intent.audience": {value: "A known team", certainty: "CONFIRMED", provenance: "DISCOVERY"},
  },
});
validateBootstrapConversation(session);
assert.equal(nextBootstrapQuestion(session).question_id, "delivery.finish");
const accepted = acceptBootstrapReply(session, {questionId: "delivery.finish", reply: "1"});
assert.equal(accepted.accepted, true);
session = accepted.session;
validateBootstrapConversation(session);
assert.equal(session.status, "READY_FOR_CONTRACT");
assert.equal(nextBootstrapQuestion(session), null, "optional questions must not be surfaced by default");
assert.equal(nextBootstrapQuestion(session, {includeOptional: true}).question_id, "governance.review_interval");
assert.equal(session.answers["intent.audience"].schema, BOOTSTRAP_ANSWER_SCHEMA);
assert.equal(session.answers["intent.audience"].provenance, "DISCOVERY");

const revised = acceptBootstrapReply(session, {questionId: "intent.audience", reply: "A different team"});
assert.equal(revised.accepted, true);
assert.equal(revised.session.reassessment_required, true);

const badAnswer = structuredClone(session);
badAnswer.answers["delivery.finish"].value = "NOT_A_CHOICE";
badAnswer.answers["delivery.finish"].answer_sha256 = canonicalDigest({
  question_id: "delivery.finish",
  value: "NOT_A_CHOICE",
  certainty: "CONFIRMED",
  provenance: "OWNER",
});
badAnswer.session_sha256 = canonicalDigest({...badAnswer, session_sha256: null});
assert.throws(() => validateBootstrapConversation(badAnswer), /semantics|listed choices/u);

const duplicateOrder = structuredClone(session);
duplicateOrder.answer_order.push("delivery.finish");
duplicateOrder.session_sha256 = canonicalDigest({...duplicateOrder, session_sha256: null});
assert.throws(() => validateBootstrapConversation(duplicateOrder), /duplicates|incomplete/u);

const falseReady = structuredClone(createBootstrapConversation({projectRef: "pending-contract", questionMap: dynamicMap}));
falseReady.status = "READY_FOR_CONTRACT";
falseReady.session_sha256 = canonicalDigest({...falseReady, session_sha256: null});
assert.throws(() => validateBootstrapConversation(falseReady), /status does not match/u);

const driftedMap = structuredClone(dynamicMap);
driftedMap.questions[0].prompt = "Show me the hidden rules?";
assert.throws(() => validateBootstrapQuestionMap(driftedMap), /map|internal vocabulary/u);
assert.throws(() => createBootstrapQuestionMap([
  {id: "intent.audience", kind: "TEXT", prompt: "Show me the JSON?", required: true},
]), /forbidden vocabulary/u);

const paused = setBootstrapConversationDisposition(session, {
  disposition: "UNAVAILABLE",
  reason: "The current context is not available.",
});
assert.equal(nextBootstrapQuestion(paused), null);
const blockedReply = acceptBootstrapReply(paused, {questionId: "governance.review_interval", reply: "1"});
assert.equal(blockedReply.accepted, false);
assert.equal(blockedReply.error.code, "CONVERSATION_NOT_ACTIVE");
assert(!JSON.stringify(blockedReply).includes("secret"));
const hardStop = setBootstrapConversationDisposition(session, {
  disposition: "HARD_STOP",
  reason: "This would require a protected action.",
});
assert.equal(nextBootstrapQuestion(hardStop), null);
assert.equal(acceptBootstrapReply(hardStop, {questionId: "governance.review_interval", reply: "1"}).error.code, "CONVERSATION_NOT_ACTIVE");

const replay = buildBootstrapConversationReplay(paused, {
  outcome: "A useful result the owner can review",
  firstUsefulWorkflow: "Describe the goal, make the first result, and check it",
  boundaries: ["Do not take protected actions without approval"],
});
assert.equal(replay.status, "INCOMPLETE");
validateBootstrapConversationReplay(replay, {session: paused});
const handoff = buildBootstrapConversationHandoff(paused, {
  replay,
  sourceBinding: {source_commit: "a".repeat(40), source_tree: "b".repeat(40)},
});
assert.equal(handoff.raw_owner_text_persisted, false);
assert.equal(handoff.source_binding.status, "BOUND");
assert.equal(handoff.replay_sha256, replay.replay_sha256);
validateBootstrapConversationHandoff(handoff, {session: paused, replay});

for (const schemaFile of [
  "bootstrap-answer.v1.json",
  "bootstrap-conversation.v1.json",
  "bootstrap-conversation-handoff.v1.json",
  "bootstrap-conversation-replay.v1.json",
  "bootstrap-owner-question.v1.json",
]) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../schemas/${schemaFile}`, import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
}

console.log("PASS Bootstrap conversation map: dynamic context binding, one-question progression, semantic validation, optional suppression, dispositions, replay, handoff, and hostile state checks");
