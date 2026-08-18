#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {auditControllerGateWeakeningAtUntrustedRoot, evaluateCanonicalControllerHostileFixtures} from "../control/controller-hostile-fixture-evaluator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "specialist-blocks/wave-01/project-controller");
const evaluation = await evaluateCanonicalControllerHostileFixtures();
assert.equal(evaluation.schema, "agentos.controller_hostile_evaluation.v1");
assert.equal(evaluation.status, "PENDING");
assert.equal(evaluation.operational_ceiling, "CONTROLLER_OPERATIONAL_STORE_INACTIVE");
assert.equal(evaluation.result_count, 17);
assert.equal(evaluation.results.length, 17);
assert(evaluation.results.every((result) => result.result === "PENDING"));
assert(evaluation.results.every((result) => result.adapter_invocation_count === 0 && result.state_change_count === 0), "hostile Controller evaluation observed an adapter or state mutation");
assert(evaluation.results.every((result) => result.implementation_entrypoint.startsWith("control/") && /^[0-9a-f]{64}$/u.test(result.implementation_file_sha256)));
assert(evaluation.results.every((result) => result.negative_assertion_count >= 3));
assert(evaluation.results.every((result) => result.expected_outcome === result.actual_outcome), "Controller semantic outcome differs from the canonical fixture expectation");
assert(evaluation.results.some((result) => result.operational_ceiling === "CONTROLLER_OPERATIONAL_STORE_INACTIVE"));
assert(!evaluation.results.some((result) => result.result === "PASS"), "pending evaluation must not claim metadata PASS");

const weakenedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-gate-weakening-"));
fs.mkdirSync(path.dirname(path.join(weakenedRoot, "specialist-blocks/wave-01/project-controller")), {recursive: true});
fs.cpSync(packageRoot, path.join(weakenedRoot, "specialist-blocks/wave-01/project-controller"), {recursive: true});
try {
  const gatePath = path.join(weakenedRoot, "specialist-blocks/wave-01/project-controller/gates/01-applicability.gate");
  const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  gate.next.NO = "OUTCOME:CONTINUE";
  gate.next.UNKNOWN = "OUTCOME:CONTINUE";
  gate.rules.ambiguity = "CONTINUE";
  gate.rules.missing_evidence = "CONTINUE";
  fs.writeFileSync(gatePath, `${JSON.stringify(gate)}\n`);
  const mutation = auditControllerGateWeakeningAtUntrustedRoot({authorityRoot: weakenedRoot});
  assert.equal(mutation.status, "WEAKENED");
  assert.equal(mutation.mutation_detected, true);
  assert(mutation.weakened_gate_ids.includes("01-applicability"));
} finally {
  fs.rmSync(weakenedRoot, {recursive: true, force: true});
}

console.log("PASS Controller hostile evaluator: canonical fixture bytes, production validators, zero-side-effect evidence, inactive-store ceiling, and gate-weakening sensitivity");
