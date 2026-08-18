#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  acceptBootstrapReply,
  bootstrapQuestionById,
  createBootstrapConversation,
  createBootstrapQuestionMap,
  nextBootstrapQuestion,
  parseBootstrapReply,
  validateBootstrapConversation,
} from "../control/bootstrap-conversation.mjs";
import {compileProjectContract, validateProjectContract} from "../control/bootstrap-project-contract.mjs";
import {parseBootstrapOwnerAnswer, renderBootstrapOwnerQuestion} from "../control/bootstrap-owner-surface.mjs";

const BASE_REPLIES = Object.freeze({
  "intent.audience": "A small operations team",
  "intent.outcome": "Make daily decisions faster and clearer",
  "intent.first_result": "One complete workflow the owner can review",
  "project.starting_point": "1",
  "development.workflow": "2",
  "scope.allowed": "The first workflow and its supporting records",
  "scope.non_goals": "Later workflows and public release",
  "workflow.steps": "Describe the need, produce the result, check it, and hand it over",
  "technology.constraints": "Use portable supported tools and avoid unnecessary dependencies",
  "operations.conditions": "A small team needs dependable normal-speed operation",
  "quality.priorities": "1,2,3",
  "boundaries.hard": "Stop before destructive or public actions",
  "boundaries.soft": "Pause when scope or cost materially changes",
  "governance.memory": "yes",
  "delivery.finish": "1",
  "acceptance.conditions": "The owner completes the workflow with an auditable result",
});

function answerUntil(conversation, stopId, replies = BASE_REPLIES) {
  let current = conversation;
  while (nextBootstrapQuestion(current)?.question_id !== stopId) {
    const question = nextBootstrapQuestion(current);
    assert(question, `question ${stopId} was never reached`);
    const reply = replies[question.question_id];
    assert.notEqual(reply, undefined, `missing reply for ${question.question_id}`);
    const accepted = acceptBootstrapReply(current, {questionId: question.question_id, reply});
    assert.equal(accepted.accepted, true, accepted.error?.message);
    current = accepted.session;
  }
  return current;
}

function answerAll(conversation, replies) {
  let current = conversation;
  while (nextBootstrapQuestion(current) !== null) {
    const question = nextBootstrapQuestion(current);
    const reply = replies[question.question_id];
    assert.notEqual(reply, undefined, `missing reply for ${question.question_id}`);
    const accepted = acceptBootstrapReply(current, {questionId: question.question_id, reply});
    assert.equal(accepted.accepted, true, accepted.error?.message);
    current = accepted.session;
  }
  return current;
}

const simpleReplies = {...BASE_REPLIES, "project.capabilities": "10"};
const simple = answerAll(createBootstrapConversation({projectRef: "simple-project"}), simpleReplies);
validateBootstrapConversation(simple);
assert.equal(simple.status, "READY_FOR_CONTRACT");
for (const conditionalId of ["data.posture", "access.model", "ai.behavior", "risk.applicability"]) {
  assert.equal(Object.hasOwn(simple.answers, conditionalId), false);
}
const simpleContract = compileProjectContract({conversation: simple});
validateProjectContract(simpleContract);
assert.equal(simpleContract.project_profile.data_posture.value, "NOT_APPLICABLE");
assert.equal(simpleContract.project_profile.ai_behavior.value, "NOT_APPLICABLE");
assert.equal(simpleContract.project_profile.development_workflow.value, "COLLABORATIVE_AUDIT");

const complexReplies = {
  ...BASE_REPLIES,
  "project.capabilities": "1,2,3,4,5,6,9",
  "experience.channels": "1,2",
  "backend.behavior": "A typed API and background evidence-processing worker",
  "data.posture": "Customer records and operational evidence with restricted access",
  "data.lifecycle": "Imported by staff, reviewed, corrected, retained, then deleted",
  "access.model": "Owners, staff, and reviewers stay separated by organization",
  "ai.behavior": "Find evidence and draft recommendations for a human reviewer",
  "ai.truth_boundary": "Cite the source, show uncertainty, and refuse unsupported claims",
  "integrations.boundaries": "Read approved records and never trigger changes without confirmation",
  "risk.applicability": "Privacy, accessibility, records retention, and industry safety rules",
};
const complex = answerAll(createBootstrapConversation({projectRef: "complex-project"}), complexReplies);
validateBootstrapConversation(complex);
assert.deepEqual(complex.answers["project.capabilities"].value, [
  "USER_INTERFACE", "BACKEND_API", "DATA", "ACCESS", "AI_SEARCH", "INTEGRATIONS", "SAFETY_REGULATED",
]);
const complexContract = compileProjectContract({conversation: complex});
validateProjectContract(complexContract);
assert.equal(complexContract.status, "READY");
assert.deepEqual(complexContract.project_profile.experience_channels.value, ["WEB", "MOBILE"]);
assert.match(complexContract.project_profile.backend_behavior.value, /typed API/u);
assert.match(complexContract.project_profile.ai_truth_boundary.value, /Cite the source/u);
assert.match(complexContract.project_profile.risk_applicability.value, /safety/u);

const existing = answerAll(createBootstrapConversation({projectRef: "existing-project"}), {
  ...BASE_REPLIES,
  "project.starting_point": "2",
  "existing.invariants": "Keep current records, public behavior, and accepted user workflows intact",
  "project.capabilities": "10",
});
assert.match(compileProjectContract({conversation: existing}).project_profile.existing_invariants.value, /current records/u);

let revised = answerUntil(createBootstrapConversation({projectRef: "revised-project"}), "project.capabilities");
revised = acceptBootstrapReply(revised, {questionId: "project.capabilities", reply: "3"}).session;
revised = acceptBootstrapReply(revised, {questionId: "data.posture", reply: "Temporary planning records"}).session;
revised = acceptBootstrapReply(revised, {questionId: "data.lifecycle", reply: "Created locally and deleted after review"}).session;
const changed = acceptBootstrapReply(revised, {questionId: "project.capabilities", reply: "10"});
assert.equal(changed.accepted, true);
assert.equal(Object.hasOwn(changed.session.answers, "data.posture"), false);
assert.equal(Object.hasOwn(changed.session.answers, "data.lifecycle"), false);
assert.equal(nextBootstrapQuestion(changed.session).question_id, "workflow.steps");

assert.throws(() => parseBootstrapReply("project.capabilities", "1,10"), /cannot combine/u);
assert.throws(() => createBootstrapConversation({
  projectRef: "invalid-seed",
  initialAnswers: {"data.posture": "Information that should not be accepted without its parent choice"},
}), /not applicable/u);
assert.throws(() => createBootstrapQuestionMap([
  {id: "child", kind: "TEXT", prompt: "What should happen next?", required: true, when: [{question_id: "parent", operator: "EQUALS", value: true}]},
  {id: "parent", kind: "BOOLEAN", prompt: "Should this be enabled?", required: true},
]), /earlier question/u);

const aiQuestion = bootstrapQuestionById("ai.behavior");
assert.equal(aiQuestion.when[0].question_id, "project.capabilities");
assert.equal(aiQuestion.when[0].operator, "CONTAINS");
const capabilitySurface = renderBootstrapOwnerQuestion("project.capabilities");
assert.equal(capabilitySurface.answer_kind, "MULTI_CHOICE");
assert.deepEqual(parseBootstrapOwnerAnswer(capabilitySurface, "1,5").value, ["USER_INTERFACE", "AI_SEARCH"]);
const legacyCompatibleMap = createBootstrapQuestionMap([
  {id: "intent.simple", kind: "TEXT", prompt: "What should this make easier?", required: true},
]);
assert.equal(Object.hasOwn(legacyCompatibleMap.questions[0], "when"), false);

console.log("PASS adaptive Bootstrap interview: ordered project discovery, conditional depth, multi-choice normalization, stale-branch pruning, typed profile compilation, and hostile rule rejection");
