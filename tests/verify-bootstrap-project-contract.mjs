#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptBootstrapReply,
  canonicalDigest,
  createBootstrapConversation,
  createBootstrapQuestionMap,
  nextBootstrapQuestion,
  validateBootstrapConversation,
} from "../control/bootstrap-conversation.mjs";
import {
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  JSA_REASSESSMENT,
  compileProjectContract,
  compileProjectContractWithReceipt,
  reassessProjectContract,
  validateProjectContract,
} from "../control/bootstrap-project-contract.mjs";
import {validateBootstrapCompileReceipt} from "../control/bootstrap-compile-receipt.mjs";

function answerAllRequired(conversation) {
  const replies = [
    "Keep their planning work clear",
    "One complete planning result they can review",
    "The first bounded planning workflow",
    "Anything outside that first workflow",
    "Stop whenever a protected action or unclear owner decision appears",
    "Pause when the request would change the agreed scope",
    "yes",
    "1",
  ];
  let current = conversation;
  for (const reply of replies) {
    const question = nextBootstrapQuestion(current);
    assert(question, "expected another Bootstrap question");
    const accepted = acceptBootstrapReply(current, {questionId: question.question_id, reply});
    assert.equal(accepted.accepted, true, accepted.error?.message);
    current = accepted.session;
  }
  return current;
}

let conversation = createBootstrapConversation({projectRef: "demo-project"});
validateBootstrapConversation(conversation);
assert.equal(nextBootstrapQuestion(conversation).prompt, "Who is this for?");

const outOfOrder = acceptBootstrapReply(conversation, {questionId: "delivery.finish", reply: "1"});
assert.equal(outOfOrder.accepted, false);
assert.equal(Object.keys(outOfOrder.session.answers).length, 0);

const acceptedAudience = acceptBootstrapReply(conversation, {questionId: "intent.audience", reply: "A small team"});
assert.equal(acceptedAudience.accepted, true);
conversation = acceptedAudience.session;

const replay = acceptBootstrapReply(conversation, {questionId: "intent.audience", reply: "A small team"});
assert.equal(replay.accepted, true);
assert.equal(replay.replayed, true);
conversation = replay.session;
const replayAgain = acceptBootstrapReply(conversation, {questionId: "intent.audience", reply: "A small team"});
assert.equal(replayAgain.replayed, true);
conversation = replayAgain.session;

conversation = answerAllRequired(conversation);
validateBootstrapConversation(conversation);
assert.equal(conversation.status, "READY_FOR_CONTRACT");

let contract = compileProjectContract({conversation});
validateProjectContract(contract);
assert.equal(contract.status, "READY");
assert.equal(contract.open_questions.some((question) => question.blocking), false);
assert.equal(contract.governance_inputs.review_interval_minutes.value, DEFAULT_REVIEW_INTERVAL_MINUTES);
assert.equal(contract.governance_inputs.review_interval_minutes.certainty, "RECOMMENDED");
assert.equal(contract.intent.audience.certainty, "CONFIRMED");
assert.equal(contract.intent.summary.certainty, "INFERRED");
assert.equal(contract.governance_inputs.delivery_route.certainty, "RECOMMENDED");
assert.equal(contract.source_binding.question_map_sha256, conversation.question_map.map_sha256);
assert.equal(contract.goals.length, 1);
assert.deepEqual(contract.phase_plan.map((phase) => phase.phase_id), ["UNDERSTAND", "BUILD", "CHECK", "HANDOFF"]);
assert(contract.boundaries.hard.some((boundary) => boundary.certainty === "CONFIRMED"));
assert(contract.boundaries.soft.some((boundary) => boundary.certainty === "RECOMMENDED"));
assert.equal(JSON.stringify(contract).includes("raw_owner_text"), true);
assert.equal(contract.privacy.raw_conversation_persisted, false);
assert.equal(contract.discovery_binding.status, "NONE");
assert.equal(contract.discovery_binding.fact_count, 0);
assert(contract.decisions.every((decision) => decision.scope === "PROJECT_CONTRACT"));
assert(contract.decisions.every((decision) => decision.lifetime === "CURRENT_CONTRACT"));
assert(contract.decisions.every((decision) => decision.revision_trigger === "OWNER_ANSWER_REVISED_OR_INTENT_SCOPE_CHANGED"));

const seeded = createBootstrapConversation({
  projectRef: "seeded-project",
  initialAnswers: {
    "intent.audience": {value: "A discovered planning group", certainty: "INFERRED", provenance: "DISCOVERY"},
  },
});
const seededContract = compileProjectContract({conversation: seeded});
assert.equal(seededContract.status, "DRAFT");
assert.equal(seededContract.intent.audience.provenance, "DISCOVERY");
assert(seededContract.open_questions.some((question) => question.question_id === "intent.audience" && question.blocking));
assert.equal(seededContract.decisions.some((decision) => decision.question_id === "intent.audience"), false);

const nonCanonicalMap = createBootstrapQuestionMap([{
  id: "intent.audience",
  kind: "TEXT",
  prompt: "Who is this for?",
  required: true,
}]);
const nonCanonical = createBootstrapConversation({projectRef: "adapter-project", questionMap: nonCanonicalMap});
const nonCanonicalResult = compileProjectContractWithReceipt({conversation: nonCanonical, failClosed: true});
assert.equal(nonCanonicalResult.contract, null);
assert.equal(nonCanonicalResult.receipt.status, "BLOCKED");

const readyResult = compileProjectContractWithReceipt({conversation});
assert.equal(readyResult.contract.contract_sha256, readyResult.receipt.contract_sha256);
assert.equal(readyResult.receipt.status, "READY");
assert.equal(readyResult.receipt.failure_code, null);
validateBootstrapCompileReceipt(readyResult.receipt);

const pendingResult = compileProjectContractWithReceipt({
  conversation: createBootstrapConversation({projectRef: "pending-project"}),
});
assert.equal(pendingResult.contract?.status, "DRAFT");
assert.equal(pendingResult.receipt.status, "QUESTION_PENDING");
assert(pendingResult.receipt.blocking_question_ids.includes("intent.audience"));
validateBootstrapCompileReceipt(pendingResult.receipt);

const discovery = {
  schema: "agentos.bootstrap_discovery_result.v1",
  version: 1,
  project_root: [String.fromCharCode(47), "transient", "project-root"].join(String.fromCharCode(47)),
  facts: [
    {
      fact_id: "project.marker.package.json",
      status: "OBSERVED_FACT",
      epistemic_class: "OBSERVED",
      value: "FILE",
      source_locator: [String.fromCharCode(47), "transient", "project-root", "package.json"].join(String.fromCharCode(47)),
      secret_free: true,
    },
    {
      fact_id: "delivery.source_control.worktree_clean",
      status: "UNKNOWN",
      epistemic_class: "UNKNOWN",
      reason: "STATUS_UNAVAILABLE",
      source_locator: [String.fromCharCode(47), "transient", "project-root"].join(String.fromCharCode(47)),
      secret_free: true,
    },
  ],
};
const discoveredContract = compileProjectContract({conversation, discovery});
validateProjectContract(discoveredContract);
assert.equal(discoveredContract.discovery_binding.status, "BOUND");
assert.equal(discoveredContract.discovery_binding.fact_count, 2);
assert.equal(discoveredContract.discovery_binding.epistemic_counts.OBSERVED, 1);
assert.equal(discoveredContract.discovery_binding.epistemic_counts.UNKNOWN, 1);
assert.deepEqual(discoveredContract.discovery_binding.fact_ids_by_epistemic_class.UNKNOWN, ["delivery.source_control.worktree_clean"]);
assert.equal(discoveredContract.discovery_binding.epistemic_sha256.length, 64);
assert(discoveredContract.open_questions.some((question) => question.question_id === "discovery.unknown" && question.blocking));
assert(!JSON.stringify(discoveredContract).includes([String.fromCharCode(47), "transient", "project-root"].join(String.fromCharCode(47))));
assert(!JSON.stringify(discoveredContract).includes("source_locator"));
assert(!JSON.stringify(discoveredContract).includes('"value":"FILE"'));

const reviewReply = acceptBootstrapReply(conversation, {
  questionId: "governance.review_interval",
  reply: "2",
});
assert.equal(reviewReply.accepted, true);
const configuredContract = compileProjectContract({conversation: reviewReply.session});
assert.equal(configuredContract.governance_inputs.review_interval_minutes.value, 30);
assert.equal(configuredContract.governance_inputs.review_interval_minutes.certainty, "CONFIRMED");

const changedConversation = acceptBootstrapReply(conversation, {
  questionId: "intent.outcome",
  reply: "Make a different outcome easier",
});
assert.equal(changedConversation.accepted, true);
const reassessed = reassessProjectContract({conversation: changedConversation.session, previousContract: contract});
assert.equal(reassessed.status, "REASSESSMENT_REQUIRED");
assert.equal(reassessed.reassessment.mode, JSA_REASSESSMENT);
assert.equal(reassessed.reassessment.reason, "OWNER_INTENT_OR_SCOPE_CHANGED");
assert(reassessed.open_questions.some((question) => question.blocking === false));
const reassessedResult = compileProjectContractWithReceipt({
  conversation: changedConversation.session,
  previousContract: contract,
});
assert.equal(reassessedResult.receipt.status, "REASSESSMENT_REQUIRED");
assert.equal(reassessedResult.receipt.reassessment_required, true);
validateBootstrapCompileReceipt(reassessedResult.receipt);

const incomplete = compileProjectContract({conversation: createBootstrapConversation({projectRef: "incomplete-project"})});
assert.equal(incomplete.status, "DRAFT");
assert(incomplete.open_questions.some((question) => question.blocking));
assert.equal(incomplete.goals[0].certainty, "UNKNOWN");

const tampered = structuredClone(contract);
tampered.intent.audience.certainty = "UNKNOWN";
assert.throws(() => validateProjectContract(tampered), /project contract is not content-addressed/u);

const rehashedPhaseTamper = structuredClone(contract);
rehashedPhaseTamper.phase_plan[0].phase_id = "UNAUTHORIZED";
rehashedPhaseTamper.contract_sha256 = canonicalDigest({...rehashedPhaseTamper, contract_sha256: null});
assert.throws(() => validateProjectContract(rehashedPhaseTamper), /phase sequence/u);

const tamperedConversation = structuredClone(conversation);
tamperedConversation.answers["governance.memory"].value = "yes";
tamperedConversation.answers["governance.memory"].answer_sha256 = canonicalDigest({question_id: "governance.memory", value: "yes"});
tamperedConversation.session_sha256 = canonicalDigest({...tamperedConversation, session_sha256: null});
assert.throws(() => validateBootstrapConversation(tamperedConversation), /canonical/u);

const extraConversationField = structuredClone(conversation);
extraConversationField.answers["intent.audience"].raw_owner_text = "unaccepted";
extraConversationField.session_sha256 = canonicalDigest({...extraConversationField, session_sha256: null});
assert.throws(() => validateBootstrapConversation(extraConversationField), /keys are invalid/u);

assert.throws(() => compileProjectContract({
  conversation,
  discovery: {
    schema: "agentos.bootstrap_discovery_result.v1",
    version: 1,
    facts: [{
      fact_id: "discovery.conflict-class-mismatch",
      status: "CONFLICT",
      epistemic_class: "OBSERVED",
      secret_free: true,
    }],
  },
}), /conflict status/u);

const unsafeAnswer = acceptBootstrapReply(createBootstrapConversation({projectRef: "safe-project"}), {
  questionId: "intent.audience",
  reply: ["", "not", "stored"].join("/"),
});
assert.equal(unsafeAnswer.accepted, false);
assert.equal(unsafeAnswer.error.code, "ANSWER_NOT_RECOGNIZED");
assert(!JSON.stringify(unsafeAnswer).includes("not/stored"));

const unsafeSecret = acceptBootstrapReply(createBootstrapConversation({projectRef: "secret-project"}), {
  questionId: "intent.audience",
  reply: "api" + "_key=" + "not-a-secret",
});
assert.equal(unsafeSecret.accepted, false);

const unsafeDiscoveryValue = ["api", "key"].join("_") + "=" + ["not", "a", "secret"].join("-");
const blockedResult = compileProjectContractWithReceipt({
  conversation,
  discovery: {
    schema: "agentos.bootstrap_discovery_result.v1",
    version: 1,
    facts: [{
      fact_id: "discovery.secret-free-claim",
      status: "OBSERVED_FACT",
      epistemic_class: "OBSERVED",
      value: unsafeDiscoveryValue,
      secret_free: true,
    }],
  },
  failClosed: true,
});
assert.equal(blockedResult.contract, null);
assert.equal(blockedResult.receipt.status, "BLOCKED");
assert.equal(blockedResult.receipt.failure_code, "PRIVACY_BOUNDARY_FAILURE");
assert(!JSON.stringify(blockedResult).includes(unsafeDiscoveryValue));
validateBootstrapCompileReceipt(blockedResult.receipt);

for (const schemaFile of ["bootstrap-conversation.v1.json", "bootstrap-project-contract.v1.json"]) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../schemas/${schemaFile}`, import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
}

console.log("PASS Bootstrap project contract slice: friendly answers, typed certainty, dynamic questions, defaults, JSA reassessment, boundaries, and privacy failures");
