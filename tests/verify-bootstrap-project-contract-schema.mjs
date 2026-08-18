#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptBootstrapReply,
  createBootstrapConversation,
  nextBootstrapQuestion,
} from "../control/bootstrap-conversation.mjs";
import {
  compileProjectContractWithReceipt,
} from "../control/bootstrap-project-contract.mjs";
import {
  BOOTSTRAP_COMPILE_RECEIPT_SCHEMA,
  validateBootstrapCompileReceipt,
} from "../control/bootstrap-compile-receipt.mjs";

function readSchema(name) {
  return JSON.parse(fs.readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));
}

function answerRequired(conversation) {
  const replies = {
    "intent.audience": "A small planning team",
    "intent.outcome": "A clear decision-ready plan",
    "intent.first_result": "One bounded plan they can review",
    "project.starting_point": "1",
    "development.workflow": "2",
    "scope.allowed": "The planning notes and agreed scope",
    "scope.non_goals": "Implementation details outside the first plan",
    "project.capabilities": "10",
    "workflow.steps": "Capture the need, create the plan, check it, and hand it over",
    "technology.constraints": "Use portable supported tools and avoid unnecessary dependencies",
    "operations.conditions": "Normal small-team use with dependable recovery",
    "quality.priorities": "1",
    "boundaries.hard": "Stop before protected actions or unclear choices",
    "boundaries.soft": "Pause when the scope changes",
    "governance.memory": "no",
    "delivery.finish": "1",
    "acceptance.conditions": "The owner can review one complete bounded plan",
  };
  let current = conversation;
  while (nextBootstrapQuestion(current) !== null) {
    const question = nextBootstrapQuestion(current);
    const reply = replies[question.question_id];
    assert.notEqual(reply, undefined, `missing fixture reply for ${question.question_id}`);
    const accepted = acceptBootstrapReply(current, {questionId: question.question_id, reply});
    assert.equal(accepted.accepted, true, accepted.error?.message);
    current = accepted.session;
  }
  return current;
}

const projectSchema = readSchema("bootstrap-project-contract.v1.json");
const receiptSchema = readSchema("bootstrap-compile-receipt.v1.json");
assert.equal(projectSchema.$id, "agentos.project_contract.v1");
assert.equal(receiptSchema.$id, BOOTSTRAP_COMPILE_RECEIPT_SCHEMA);
assert.deepEqual(
  Object.keys(projectSchema.properties).sort(),
  [...projectSchema.required].sort(),
);
assert.deepEqual(
  Object.keys(receiptSchema.properties).sort(),
  [...receiptSchema.required].sort(),
);
assert.equal(projectSchema.properties.discovery_binding.additionalProperties, false);
assert(projectSchema.properties.source_binding.required.includes("question_map_sha256"));
assert(projectSchema.properties.discovery_binding.required.includes("fact_ids_by_epistemic_class"));
assert(projectSchema.properties.decisions.items.required.includes("scope"));
assert(projectSchema.properties.decisions.items.required.includes("lifetime"));
assert(projectSchema.properties.decisions.items.required.includes("revision_trigger"));
assert.equal(projectSchema.$defs.typedList.properties.value.type, "array");
assert.equal(receiptSchema.properties.failure_code.enum.includes(null), true);

const conversation = answerRequired(createBootstrapConversation({projectRef: "schema-project"}));
const result = compileProjectContractWithReceipt({conversation});
assert.equal(result.receipt.schema, BOOTSTRAP_COMPILE_RECEIPT_SCHEMA);
assert.equal(result.receipt.status, "READY");
validateBootstrapCompileReceipt(result.receipt);

console.log("PASS Bootstrap contract and compile-receipt schemas: strict top-level shape, typed lists, discovery binding, and receipt validation");
