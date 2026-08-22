#!/usr/bin/env node

/* Focused lane verifier: public entrypoint, hostile fixtures, gates, and custody. */

import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {evaluateOpenApiContractsPackage} from "../control/openapi-contracts-package-evaluator.mjs";
import {freezeOpenApiContractsCandidate} from "../control/openapi-contracts-candidate-freeze.mjs";

const evaluation = await evaluateOpenApiContractsPackage();
assert.equal(evaluation.schema, "agentos.specialist_openapi_contracts_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS_PENDING_INDEPENDENT_REVIEW");
assert.equal(evaluation.deterministic_status, "PASS");
assert.equal(evaluation.admission_allowed, false);
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.context_invalidation.bound.reuse_allowed, true);
assert.equal(evaluation.context_invalidation.stale.reuse_allowed, false);
assert.equal(evaluation.context_invalidation.stale.action, "INVALIDATE_DEPENDENT_CONTEXT");
assert.equal(evaluation.lifecycle_readback.builder_admission_attempt.allowed, false);
assert.equal(evaluation.independent_signature_required, true);
assert.equal(evaluation.independent_auditor_model, "gpt-5.6-luna");
assert.equal(evaluation.independent_auditor_reasoning_effort, "max");
const baseCommit = execFileSync("git", ["rev-parse", "HEAD^"], {encoding: "utf8"}).trim();
const frozen = freezeOpenApiContractsCandidate({baseCommit});
assert.match(frozen.candidate_commit, /^[0-9a-f]{40}$/u);
assert.match(frozen.candidate_tree, /^[0-9a-f]{40}$/u);
assert.equal(frozen.status, "FROZEN_FOR_INDEPENDENT_REVIEW");
assert.equal(frozen.custody.workspace_root_ref, "ref:OPENAPI_CONTRACTS.WORKSPACE_ROOT");
assert.equal(frozen.custody.repository_root_ref, "ref:OPENAPI_CONTRACTS.REPOSITORY_ROOT");
assert.equal(frozen.custody.task_worktree_ref, "ref:OPENAPI_CONTRACTS.TASK_WORKTREE");
assert.match(frozen.custody.runtime_custody_receipt_sha256, /^[0-9a-f]{64}$/u);
assert.equal(Object.hasOwn(frozen.custody, "builder_worktree"), false);
assert.equal(frozen.custody.auditor_read_only, true);
assert.equal(frozen.admission_allowed, false);
console.log("PASS OpenAPI HTTP Contract package: " + evaluation.fixture_results.length + " hostile public vectors, " + evaluation.gate_execution.length + " executable four-valued gates, source/model/context/lifecycle invalidation, and mutation proof");
