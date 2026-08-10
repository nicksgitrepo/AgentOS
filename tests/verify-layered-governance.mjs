#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import * as governance from "../control/four-library-governance.mjs";

const schemaNames = [
  "bootstrap-answer.v1.json",
  "bootstrap-conversation.v1.json",
  "bootstrap-project-contract.v1.json",
  "generated-task-role-packet.v1.json",
  "layered-governance.v1.json",
  "layered-governance-check.v1.json",
];

for (const name of schemaNames) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
}

assert.deepEqual(governance.LAYERED_GOVERNANCE_LAYER_ORDER, [
  "GENERAL_GOVERNANCE",
  "BASE_ROLE_GOVERNANCE",
  "PERSISTENT_PROJECT_GOVERNANCE",
  "GENERATED_TASK_ROLE_GOVERNANCE",
]);
assert.equal(typeof governance.compileGeneratedTaskRolePacket, "function");
assert.equal(typeof governance.validateGeneratedTaskRolePacket, "function");
assert.equal(typeof governance.compileLayeredGovernanceContract, "function");
assert.equal(typeof governance.validateLayeredGovernanceContract, "function");
assert.equal(typeof governance.activateLayeredGovernance, "function");
assert.equal(typeof governance.compareLayeredGovernanceEvidence, "function");
assert.equal(typeof governance.validateLayeredGovernanceEvidence, "function");
assert.equal(typeof governance.compileLegacyGeneratedTaskRolePacket, "function");
assert.equal(typeof governance.compileLegacyLayeredGovernanceContract, "function");

process.stdout.write("PASS layered governance public contract surface and schema inventory\n");
