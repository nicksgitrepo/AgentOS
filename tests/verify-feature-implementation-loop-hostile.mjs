#!/usr/bin/env node

/* Hostile checks for the feature planning, implementation, and review boundary. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(repositoryRoot, "control/feature-implementation-loop.mjs");
const fixtureRoot = path.join(repositoryRoot, "specialist-blocks/control-plane/agent-spawner/fixtures");
const fixtureCases = [
  {
    file: "feature-implementer-self-review.json",
    fixtureId: "FIXTURE.SPAWNER.FEATURE_IMPLEMENTER_SELF_REVIEW",
    vector: "FEATURE_IMPLEMENTER_SELF_REVIEW",
    entrypoint: "control/feature-implementation-loop.mjs#compileOrchestratorFeatureReview",
  },
  {
    file: "feature-model-hardcode-bypass.json",
    fixtureId: "FIXTURE.SPAWNER.FEATURE_MODEL_HARDCODE_BYPASS",
    vector: "FEATURE_MODEL_HARDCODE_BYPASS",
    entrypoint: "control/feature-implementation-loop.mjs#compileFeatureImplementationDispatch",
  },
];

function assertFixture(fixture, expected) {
  assert.equal(fixture.schema, "agentos.spawner_hostile_fixture.v1");
  assert.equal(fixture.version, 1);
  assert.equal(fixture.fixture_id, expected.fixtureId);
  assert.equal(fixture.attack_vector, expected.vector);
  assert.equal(fixture.input_class, "HOSTILE_NEGATIVE");
  assert.equal(fixture.expected_outcome, "REJECT_WITH_TYPED_DEFECT");
  assert.equal(fixture.operational_entrypoint, expected.entrypoint);
  assert.ok(fixture.setup.includes("SEALED_CANONICAL_TEST_AUTHORITY"));
  assert.deepEqual(fixture.canonical_input, {fixture_id: expected.fixtureId, vector_ref: expected.vector});
  assert.ok(fixture.required_assertions.includes("NO_UNAUTHORIZED_STATE_CHANGE"));
  assert.ok(fixture.required_assertions.includes("TYPED_DENIAL"));
  assert.ok(fixture.cleanup.includes("VERIFY_NO_SHARED_MUTATION"));
}

for (const expected of fixtureCases) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, expected.file), "utf8"));
  assertFixture(fixture, expected);
}

const engine = await import(new URL("../control/feature-implementation-loop.mjs", import.meta.url));

for (const exportName of ["compileFeaturePlan", "compileFeatureImplementationDispatch", "compileOrchestratorFeatureReview"]) {
  assert.equal(typeof engine[exportName], "function", `feature implementation loop must export ${exportName}`);
}

const compileFeaturePlan = engine.compileFeaturePlan;
const compileFeatureImplementationDispatch = engine.compileFeatureImplementationDispatch;
const compileOrchestratorFeatureReview = engine.compileOrchestratorFeatureReview;
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-feature-loop-hostile-"));
const governance = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});

// A plan is deliberately bounded and capability-oriented; the hostile checks
// below then attempt to widen authority at the implementation and review edges.
const plan = compileFeaturePlan({
  featureId: "FEATURE.HOSTILE.LOOP",
  title: "Bounded hostile feature",
  request: "Implement one bounded feature with explicit acceptance evidence.",
  plannerId: "AGENTOS.FEATURE_PLANNER.HOSTILE",
  scope: {inScope: ["one feature path"], outOfScope: ["unrelated refactors"]},
  requirements: ["The feature has a deterministic acceptance check."],
  acceptanceCriteria: ["The bounded acceptance check passes."],
  nonGoals: ["Premature abstractions", "Scope creep"],
  implementationInstructions: ["Change only the declared path and run the focused negative check."],
  canonicalModelPolicyRef: "ref:global-model-policy:current",
  modelSuggestion: "economical capable implementation profile",
});

assert.throws(() => compileFeatureImplementationDispatch({
  plan,
  implementerId: "FEATURE.IMPLEMENTER.HOSTILE",
  worktreeRef: "opaque:worktree:hostile-feature",
  globalGovernanceAuthorityStore: governance.authorityStore,
  priorReview: null,
  modelName: "ATTACKER.HARD_CODED_MODEL",
  model: "ATTACKER.HARD_CODED_MODEL",
}), /fields mismatch|model|authority|advisory|policy|caller|hard.?cod/iu, "caller model names must not become implementation authority");

const dispatch = compileFeatureImplementationDispatch({plan, implementerId: "FEATURE.IMPLEMENTER.HOSTILE", worktreeRef: "opaque:worktree:hostile-feature", globalGovernanceAuthorityStore: governance.authorityStore, priorReview: null});

assert.throws(() => compileOrchestratorFeatureReview({
  plan,
  dispatch,
  orchestratorId: "FEATURE.IMPLEMENTER.HOSTILE",
  candidateRef: "ref:candidate:hostile-self-review",
  evidenceRefs: ["ref:test:hostile-self-review"],
  findings: [],
  protectedBlocker: null,
}), /orchestrator|review|self|authority|role|implement/iu, "an implementer must not review or accept its own feature");

fs.rmSync(governanceRoot, {recursive: true, force: true});
console.log("PASS feature implementation loop hostile checks: bounded planning is present, model names cannot widen dispatch authority, and implementers cannot self-review or accept");
