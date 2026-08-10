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
  const replies = [
    "A small planning team",
    "A clear decision-ready plan",
    "One bounded plan they can review",
    "The planning notes and agreed scope",
    "Implementation details outside the first plan",
    "Stop before protected actions or unclear choices",
    "Pause when the scope changes",
    "no",
    "1",
  ];
  let current = conversation;
  for (const reply of replies) {
    const question = nextBootstrapQuestion(current);
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
