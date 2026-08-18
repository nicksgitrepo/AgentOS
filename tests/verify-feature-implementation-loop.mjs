#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileFeatureImplementationDispatch, compileFeaturePlan, compileOrchestratorFeatureReview, validateFeatureImplementationDispatch, validateFeaturePlan, validateOrchestratorFeatureReview} from "../control/feature-implementation-loop.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-feature-loop-governance-"));
const governance = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});
const plan = compileFeaturePlan({featureId: "FEATURE.EXAMPLE", title: "Bounded example", request: "Add one bounded behavior with independent acceptance evidence.", plannerId: "AGENTOS.FEATURE_PLANNER.ONE", scope: {inScope: ["Feature behavior and direct tests"], outOfScope: ["Unrelated refactors and speculative frameworks"]}, requirements: ["Preserve existing behavior outside the feature boundary."], acceptanceCriteria: ["The new behavior and negative case pass deterministic checks."], nonGoals: ["Future abstractions", "Unrelated cleanup"], implementationInstructions: ["Read the current contract and change only the declared feature surface.", "Run the focused positive and negative tests and return raw evidence."], canonicalModelPolicyRef: "ref:global-model-policy:current", modelSuggestion: "economical capable implementer at a strong reasoning setting"});
validateFeaturePlan(plan); assert.deepEqual(plan.planning_principles, ["NO_OVER_ENGINEERING", "NO_PREMATURE_ABSTRACTIONS", "NO_SCOPE_CREEP"]); assert.equal(plan.model_routing.suggestion_is_authority, false);

const dispatch = compileFeatureImplementationDispatch({plan, implementerId: "AGENTOS.FEATURE_IMPLEMENTER.ONE", worktreeRef: "opaque:worktree:feature-one", globalGovernanceAuthorityStore: governance.authorityStore, priorReview: null});
validateFeatureImplementationDispatch(dispatch); assert.equal(dispatch.round, 1); assert.equal(dispatch.model_suggestion_is_authority, false);
assert.throws(() => compileFeatureImplementationDispatch({plan, implementerId: "AGENTOS.FEATURE_IMPLEMENTER.ONE", worktreeRef: "opaque:worktree:x", globalGovernanceAuthorityStore: governance.authorityStore, priorReview: null, model: "cheap-model"}), /fields mismatch/iu);
assert.throws(() => compileFeatureImplementationDispatch({plan, implementerId: plan.planner_id, worktreeRef: "opaque:worktree:x", globalGovernanceAuthorityStore: governance.authorityStore, priorReview: null}), /separate identities/iu);

const finding = {issue_id: "FEATURE.ISSUE.ONE", severity: "HIGH", location: "control/example.mjs", evidence_ref: "ref:test:failure", required_repair: "Correct the bounded negative path without widening the feature scope.", retest: "Run the focused negative-path test again."};
const repair = compileOrchestratorFeatureReview({plan, dispatch, orchestratorId: "AGENTOS.ORCHESTRATOR.ONE", candidateRef: "ref:candidate:one", evidenceRefs: ["ref:test:failed"], findings: [finding], protectedBlocker: null});
validateOrchestratorFeatureReview(repair); assert.equal(repair.status, "REPAIR_REQUIRED");
const retry = compileFeatureImplementationDispatch({plan, implementerId: dispatch.implementer_id, worktreeRef: dispatch.worktree_ref, globalGovernanceAuthorityStore: governance.authorityStore, priorReview: repair}); assert.equal(retry.round, 2); assert.match(retry.instructions[0], /FEATURE.ISSUE.ONE/u);
assert.throws(() => compileOrchestratorFeatureReview({plan, dispatch, orchestratorId: dispatch.implementer_id, candidateRef: "ref:candidate:self", evidenceRefs: ["ref:test:self"], findings: [], protectedBlocker: null}), /separate Orchestrator/iu);
assert.throws(() => compileOrchestratorFeatureReview({plan, dispatch, orchestratorId: "AGENTOS.ORCHESTRATOR.ONE", candidateRef: "ref:candidate:bad", evidenceRefs: ["ref:test:bad"], findings: [{...finding, required_repair: "Fix it"}], protectedBlocker: null}), /required feature repair/iu);
const accepted = compileOrchestratorFeatureReview({plan, dispatch: retry, orchestratorId: "AGENTOS.ORCHESTRATOR.ONE", candidateRef: "ref:candidate:accepted", evidenceRefs: ["ref:test:pass", "ref:scope:pass"], findings: [], protectedBlocker: null}); validateOrchestratorFeatureReview(accepted); assert.equal(accepted.status, "ACCEPTED");
fs.rmSync(governanceRoot, {recursive: true, force: true});
console.log("PASS feature implementation loop: bounded planning, advisory model suggestions, separated implementation, detailed repair re-entry, and Orchestrator-only acceptance");
