#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOOTSTRAP_QUESTIONS,
  createBootstrapQuestionMap,
} from "../control/bootstrap-conversation.mjs";
import {
  compileGeneratedTaskRolePacket,
  validateGeneratedTaskRolePacket,
} from "../control/four-library-governance.mjs";
import {
  LAYERED_GOVERNANCE_LAYER_ORDER,
  compileLayeredGovernanceContract,
  compareLayeredGovernanceEvidence,
  validateLayeredGovernanceContract,
  validateLayeredGovernanceEvidence,
} from "../control/layered-governance-contract.mjs";

const schemaNames = [
  "bootstrap-answer.v1.json",
  "bootstrap-conversation.v1.json",
  "bootstrap-conversation-handoff.v1.json",
  "bootstrap-conversation-replay.v1.json",
  "bootstrap-project-contract.v1.json",
  "generated-task-role-packet.v1.json",
  "layered-governance.v1.json",
  "layered-governance-check.v1.json",
];

for (const name of schemaNames) {
  const schema = JSON.parse(fs.readFileSync(new URL("../schemas/" + name, import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
}

const map = createBootstrapQuestionMap(BOOTSTRAP_QUESTIONS);
assert(map.questions.some((question) => question.id === "workflow.steps"));
assert(map.questions.some((question) => question.id === "terminology.preferred"));
assert(map.questions.some((question) => question.id === "acceptance.conditions"));
assert(map.questions.some((question) => question.id === "governance.providers"));
assert(map.questions.some((question) => question.id === "governance.retention"));
assert(map.questions.some((question) => question.id === "delivery.intent"));
assert.deepEqual(LAYERED_GOVERNANCE_LAYER_ORDER, [
  "GENERAL_GOVERNANCE",
  "BASE_ROLE_GOVERNANCE",
  "PERSISTENT_PROJECT_GOVERNANCE",
  "GENERATED_TASK_ROLE_GOVERNANCE",
]);

assert.equal(typeof compileGeneratedTaskRolePacket, "function");
assert.equal(typeof validateGeneratedTaskRolePacket, "function");
assert.equal(typeof compileLayeredGovernanceContract, "function");
assert.equal(typeof validateLayeredGovernanceContract, "function");
assert.equal(typeof compareLayeredGovernanceEvidence, "function");
assert.equal(typeof validateLayeredGovernanceEvidence, "function");

process.stdout.write("PASS layered governance static contract surface and schema inventory\n");

