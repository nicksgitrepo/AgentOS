#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileControllerNextLifecycleHandoff,
  validateControllerNextLifecycleHandoff,
} from "../control/controller-action-dispatcher.mjs";

const sha = (value) => canonicalDigest({value});
const sourceReceiptSha256 = sha("final-persisted-receipt");
const handoff = compileControllerNextLifecycleHandoff({
  sourceReceiptSha256,
  nextAction: "RUN_LOCAL_CANDIDATE_PROOF",
  nextHandler: "HANDLER.RUNTIME.RUN_LOCAL_CANDIDATE_PROOF",
  handoffRef: "ref:controller/next-lifecycle/runtime-proof",
});
validateControllerNextLifecycleHandoff(handoff, {
  sourceReceiptSha256,
  nextAction: "RUN_LOCAL_CANDIDATE_PROOF",
  nextHandler: "HANDLER.RUNTIME.RUN_LOCAL_CANDIDATE_PROOF",
});
assert.equal(handoff.status, "STARTED");
assert.equal(handoff.started_same_turn, true);

const rejects = (mutator, pattern) => {
  const candidate = structuredClone(handoff);
  mutator(candidate);
  assert.throws(() => validateControllerNextLifecycleHandoff(candidate), pattern);
};
rejects((candidate) => { candidate.started_same_turn = false; }, /started in the same turn|digest/u);
rejects((candidate) => { candidate.handoff_sha256 = sha("tampered"); }, /digest/u);
rejects((candidate) => { candidate.next_handler = "HANDLER.OWNER_REVIEW"; }, /handler/u);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/controller-next-lifecycle-handoff.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.deepEqual(schema.required, [
  "schema", "version", "status", "source_receipt_sha256", "next_action", "next_handler",
  "handoff_ref", "handoff_sha256", "started_same_turn",
]);
assert.match(schema.state_rules.failure, /Controller bounded workflow repair/u);
assert.doesNotMatch(schema.state_rules.failure, /Spawner repair path/u);

console.log("PASS Controller next-lifecycle handoff: bounded local successor must start a typed same-turn continuation or fail as workflow dead-end");
