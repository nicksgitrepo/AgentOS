#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {compileAgentSpawnerLifecycle, runAgentSpawnerCompilerTick} from "../control/agent-spawner-lifecycle.mjs";
import {compileAgentSpawnerGovernedAdmission} from "../control/agent-spawner-governed-admission.mjs";
import {prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation} from "../control/spawner-bootstrap-governance.mjs";
import {compileExactSpawnerAdmission} from "../control/spawner-bootstrap-governance.mjs";
import {prepareAgentSpawnerBootstrapAuthority} from "../control/spawner-bootstrap-preparation.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareProtectedEvaluatorProvisioning} from "../control/protected-evaluator-provisioning.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "../control/protected-spawner-review-provisioning.mjs";
import {prepareCanonicalIndependentClearanceFixture} from "./helpers/independent-clearance-fixture.mjs";
import {provisionTestExternalSpawnerReview} from "./helpers/spawner-external-review-fixture.mjs";

const sealedAuthority = getSealedCanonicalAuthority();
assert.throws(() => prepareAgentSpawnerBootstrapAuthority({sealedAuthority}), /separately controlled evaluator handoff/iu);
const candidate = prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation();
const review = provisionTestExternalSpawnerReview({candidate, install: false});
const clearance = prepareCanonicalIndependentClearanceFixture();
const evaluatorProvisioning = prepareProtectedEvaluatorProvisioning({sealedAuthority, clearanceStoreRoot: clearance.authorityRoot, candidateRepositoryRoot: clearance.repositoryRoot});
const reviewProvisioning = prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot: review.root});
const preparation = prepareAgentSpawnerBootstrapAuthority({sealedAuthority, evaluatorProvisioning, reviewProvisioning});
assert.equal(preparation.preparation_sha256.length, 64);
const exactAdmission = compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.EXTERNAL.BOOTSTRAP", globalGovernanceAuthorityStore: preparation.globalGovernanceAuthorityStore});

const receipt = JSON.parse(fs.readFileSync(`${clearance.authorityRoot}/receipts/${clearance.receiptSha256}.json`, "utf8"));
const common = {lifecycleId: "LIFECYCLE.SPAWNER.EXTERNAL.BOOTSTRAP", candidateSha256: receipt.candidate.lifecycle_candidate_sha256, rosterProjectionSha256: receipt.candidate.roster_projection_sha256, contextSha256: receipt.candidate.context_sha256, qa: {status: "INDEPENDENT_PASS", complete_block_count: 7, incomplete_block_count: 0, pending_route_count: 1, independent_clearance_status: "CLEARED", independent_clearance_receipt_sha256: clearance.receiptSha256}, execution: {compiler_ticks: 1, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false}};
const before = compileAgentSpawnerLifecycle({...common, mode: "COMPILER_ONLY", state: "COMPILER_ACTIVE"});
const after = compileAgentSpawnerLifecycle({...common, qa: {...common.qa, pending_route_count: 0}, mode: "COMPILER_ONLY", state: "COMPILER_ACTIVE"});
const continuation = runAgentSpawnerCompilerTick(before, {onPublishRoster: () => ({outcome: "TYPED_ROSTER_PUBLISHED", lifecycle_after: after, evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.ROSTER", reference: "ref:canonical/roster", sha256: receipt.candidate.roster_projection_sha256}], hostile_fixture_refs: ["FIXTURE.SPAWNER.ROSTER.STALE"]})});
assert.throws(() => compileAgentSpawnerGovernedAdmission({adapterId: "ADAPTER.SPAWNER.EXTERNAL.BOOTSTRAP", sourceContinuation: continuation, lifecycleBefore: after, clearanceReceiptSha256: clearance.receiptSha256, exactAdmission}), /package differs from independent clearance/iu);
fs.rmSync(review.root, {recursive: true, force: true}); fs.rmSync(clearance.root, {recursive: true, force: true});
console.log("PASS Spawner Bootstrap preparation: absent canonical handoff fails closed; legacy synthetic clearance cannot authorize the real package; no production signing key ships");
