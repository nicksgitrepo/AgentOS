#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateOwaspWebA04Package} from "../control/owasp-web-2025-a04-cryptographic-failures-package-evaluator.mjs";
import {compileReusableAgentRoster} from "../control/reusable-agent-roster-compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await evaluateOwaspWebA04Package();
assert.equal(result.status, "PASS");
assert.equal(result.fixture_results.length, 17);
assert.equal(result.gate_execution.results.length, 12);
assert.equal(result.mutation_sensitivity.mutation_detected, true);
assert.equal(result.canonical_binding_regression.status, "PASS");
assert.equal(result.shared_registry_integration.verdict, "ALIGNED");
assert.equal(result.shared_registry_regression.finding_code, "SHARED_REGISTRY_SPAWNER_INTEGRATION_DRIFT");
assert.equal(result.task_workspace_custody.status, "MATCHED");
assert.equal(result.task_workspace_custody.containment.project_root, true);
assert.equal(result.task_workspace_custody.containment.task_checkout, true);
assert.equal(result.task_workspace_custody.containment.task_worktree, true);

const readbackPath = path.join(root, "specialist-blocks/registry/owasp-web-2025-a04-cryptographic-failures-operational-readback.v1.json");
const readback = JSON.parse(fs.readFileSync(readbackPath, "utf8"));
assert.equal(readback.status, "PASS");
assert.equal(readback.readback_sha256, canonicalDigest({...readback, readback_sha256: null}));

const roster = compileReusableAgentRoster({repositoryRoot: root});
const web_a04 = roster.entries.find((entry) => entry.stable_agent_id === "AGENT.SECURITY_OWASP_WEB_2025_A04_CRYPTOGRAPHIC_FAILURES");
assert(web_a04, "WEB_A04 roster entry missing");
assert.equal(web_a04.qa_state, "EXECUTED_REVIEW_REQUIRED");
assert.equal(web_a04.independent_evaluation_state, "EXECUTED_REVIEW_REQUIRED");
assert.equal(roster.build_queue.find((entry) => entry.stable_agent_id === web_a04.stable_agent_id)?.eligible, false);
assert.equal(roster.build_queue.find((entry) => entry.eligible)?.stable_agent_id, "AGENT.SECURITY_OWASP_WEB_2025_A05_INJECTION");

const personalPath = new RegExp(`${["/", "Users", "/"].join("")}(?:[^/\\s]+/)+|${["/", "home", "/"].join("")}(?:[^/\\s]+/)`, "u");
const persisted = [
  "control/owasp-web-2025-a04-cryptographic-failures-authority-binding.mjs",
  "control/owasp-web-2025-a04-cryptographic-failures-boundary-gate.mjs",
  "control/owasp-web-2025-a04-cryptographic-failures-package-evaluator.mjs",
  "control/owasp-web-2025-a04-cryptographic-failures-rebind.mjs",
  "control/reusable-agent-roster-compiler.mjs",
  "schemas/owasp-web-a04-operational-readback.v1.json",
  "specialist-blocks/registry/agent-roster.v1.json",
  "specialist-blocks/registry/owasp-web-2025-a04-cryptographic-failures-operational-readback.v1.json",
  "specialist-blocks/wave-03/owasp-web-2025-a04-cryptographic-failures/context.json",
  "specialist-blocks/wave-03/owasp-web-2025-a04-cryptographic-failures/gates/execution.json",
  "specialist-blocks/wave-03/owasp-web-2025-a04-cryptographic-failures/model-route.json",
];
for (const relative of persisted) assert.equal(personalPath.test(fs.readFileSync(path.join(root, relative), "utf8")), false, `personal path literal found in ${relative}`);

console.log("PASS OWASP WEB_A04 boundary: executable readback, hostile regressions, roster queue advancement, and runtime portability");
