#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalDigest,
  compileDeliveryPolicy,
  createDeliveryProbePlan,
  runDeliveryProbes,
  validateDeliveryPolicy,
  validateDeliveryProbePlan,
  validateDeliveryProbeResults,
} from "../control/delivery-policy.mjs";

const discovery = [
  {fact_id: "delivery.source_control.current_branch", status: "OBSERVED_FACT", secret_free: true},
  {fact_id: "delivery.source_control.worktree_clean", status: "OBSERVED_FACT", secret_free: true},
  {fact_id: "tool.VERSION_CONTROL.installed", status: "OBSERVED_FACT", secret_free: true},
  {fact_id: "delivery.marker.ci.synthetic", status: "UNKNOWN", secret_free: true},
];

const answer = {
  priority: "BALANCED",
  available_runner_routes: ["HOSTED", "VPS", "LOCAL"],
  available_deployment_routes: ["MANAGED", "VPS"],
  source_control: {
    push_mode: "CHECKPOINTS_REMOTE_EQUAL",
    branch_namespace: "campaign/{campaign_id}/{lane_id}",
    preview_on_push: "NOT_ASSUMED",
    temporary_branch_retention: "UNTIL_ACCEPTED_LIVE_CLOSURE",
  },
  merge: {
    authority: "CENTRAL_SERIALIZED",
    gate: "REQUIRED_AFFECTED_CHECKS",
    auto_merge: "DISABLED_BY_DEFAULT",
    method: "PROJECT_DEFINED",
  },
  ci_runner: {
    route: "HOSTED",
    provider_id: "runner-provider",
    fallback_route: "VPS",
    max_concurrency: 2,
    weekly_minutes_budget: 1200,
  },
  deployment: {
    route: "MANAGED",
    provider_id: "hosting-provider",
    environment_ids: ["staging", "production"],
    trigger: "EXACT_ACCEPTED_COMMIT",
    preview: "NOT_ASSUMED",
    rollback_required: true,
    rollback_strategy: "EXACT_LAST_ACCEPTED_DEPLOYMENT",
    rollback_test: true,
  },
  cost_boundaries: {
    monthly_spend_ceiling: 40,
    currency: "USD",
    approval: "OWNER_ONLY_ABOVE_BOUNDARY",
    on_limit: "PAUSE_NEW_LOW_PRIORITY_WORK",
  },
  finish: "DEPLOY",
};

const policy = compileDeliveryPolicy({discovery, answer});
const reorderedPolicy = compileDeliveryPolicy({discovery: structuredClone(discovery), answer: {
  cost_boundaries: answer.cost_boundaries,
  deployment: answer.deployment,
  ci_runner: answer.ci_runner,
  merge: answer.merge,
  source_control: answer.source_control,
  available_deployment_routes: answer.available_deployment_routes,
  available_runner_routes: answer.available_runner_routes,
  priority: answer.priority,
  finish: answer.finish,
}});
validateDeliveryPolicy(policy);
validateDeliveryPolicy(reorderedPolicy);
assert.equal(policy.policy_sha256, reorderedPolicy.policy_sha256, "delivery policy digest is not deterministic");
assert.equal(policy.recommendation.runner.recommended_route, "HOSTED");
assert.equal(policy.recommendation.deployment.recommended_route, "MANAGED");
assert.equal(policy.source_control.checkpoint_rule, "CLEAN_PUSHED_REMOTE_EQUAL_BEFORE_AUDIT_OR_HANDOFF");
assert.equal(policy.merge.auto_merge, "DISABLED_BY_DEFAULT");
assert.equal(policy.deployment.authority, "RUNTIME_AFTER_CENTRAL_ACCEPTANCE");
assert.equal(policy.rollback.identity, "EXACT_LAST_ACCEPTED_DEPLOYMENT");
assert.equal(policy.finish.selected, "DEPLOY");
assert.deepEqual(policy.finish.included_steps, ["PREPARE", "CHECK", "AUDIT", "HANDOFF", "SAVE_BRANCH", "PUSH", "MERGE", "DEPLOY"]);
assert(policy.finish.protected_action_rule.includes("EXACT_ROUTE"));

const defaultPolicy = compileDeliveryPolicy({discovery: []});
assert.equal(defaultPolicy.status, "COMPILED_WITH_PROJECT_BINDING_GAPS");
assert(defaultPolicy.unresolved.includes("CI_RUNNER_ROUTE"));
assert(defaultPolicy.unresolved.includes("DEPLOYMENT_ROUTE"));
assert(defaultPolicy.unresolved.includes("DELIVERY_FINISH_OWNER_CHOICE"));
assert.equal(defaultPolicy.source_control.push_mode, "CHECKPOINTS_REMOTE_EQUAL");
assert.equal(defaultPolicy.rollback.test_required, true);

const probePlan = createDeliveryProbePlan({policy, discovery});
const repeatedProbePlan = createDeliveryProbePlan({policy: structuredClone(policy), discovery: structuredClone(discovery)});
validateDeliveryProbePlan(probePlan);
assert.equal(probePlan.probe_plan_sha256, repeatedProbePlan.probe_plan_sha256, "delivery probe plan digest is not deterministic");
assert.equal(probePlan.probes.length, 5);
assert(probePlan.prohibited_operations.includes("AUTHENTICATION"));
assert(probePlan.prohibited_operations.includes("DEPLOYMENT"));

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-delivery-policy-project-"));
const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-delivery-policy-external-"));
const symlinkRoot = path.join(projectRoot, "symlink-root");
try {
  const results = runDeliveryProbes({projectRoot, policy, discovery, planSha256: "a".repeat(64)});
  validateDeliveryProbeResults(results, {
    planSha256: "a".repeat(64),
    policySha256: policy.policy_sha256,
    discoveryDigestSha256: canonicalDigest(discovery),
  });
  assert.equal(results.operations.read_only, true);
  assert.equal(results.operations.authentication_attempted, false);
  assert.equal(results.operations.network_attempted, false);
  assert.equal(results.operations.writes_attempted, false);
  assert(results.results.some((entry) => entry.status === "NOT_RUN_OWNER_BOUNDARY"));

  const tamperedResults = structuredClone(results);
  tamperedResults.binding.discovery_digest_sha256 = "b".repeat(64);
  delete tamperedResults.result_sha256;
  tamperedResults.result_sha256 = canonicalDigest(tamperedResults);
  assert.throws(() => validateDeliveryProbeResults(tamperedResults, {discoveryDigestSha256: canonicalDigest(discovery)}), /different discovery/u);

  fs.symlinkSync(externalRoot, symlinkRoot, "dir");
  assert.throws(() => runDeliveryProbes({projectRoot: symlinkRoot, policy, discovery, planSha256: "a".repeat(64)}), /real directory/u);
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
  fs.rmSync(externalRoot, {recursive: true, force: true});
}

assert.throws(() => compileDeliveryPolicy({discovery, answer: {...answer, deployment: {...answer.deployment, provider_id: "https://provider.invalid"}}}), /provider_id/u);
assert.throws(() => compileDeliveryPolicy({discovery, answer: {...answer, source_control: {...answer.source_control, branch_namespace: "../outside"}}}), /branch_namespace/u);
assert.throws(() => compileDeliveryPolicy({discovery, answer: {...answer, ci_runner: {...answer.ci_runner, provider_id: "api_key=material"}}}), /secret material|provider_id/u);
assert.throws(() => compileDeliveryPolicy({discovery, answer: {...answer, finish: "RELEASE_NOW"}}), /delivery finish/u);

const weakened = structuredClone(policy);
weakened.deployment.authority = "OWNER_DIRECT";
delete weakened.policy_sha256;
weakened.policy_sha256 = canonicalDigest(weakened);
assert.throws(() => validateDeliveryPolicy(weakened), /deployment authority/u);

const mismatchedFinish = structuredClone(policy);
mismatchedFinish.finish.selected = "MERGE";
delete mismatchedFinish.policy_sha256;
mismatchedFinish.policy_sha256 = canonicalDigest(mismatchedFinish);
assert.throws(() => validateDeliveryPolicy(mismatchedFinish), /finish steps do not match/u);

const tamperedProbePlan = structuredClone(probePlan);
tamperedProbePlan.probes[0].expected_effects.network = true;
assert.throws(() => validateDeliveryProbePlan(tamperedProbePlan), /not content-addressed|prohibited effect/u);
const broadenedProbePlan = structuredClone(probePlan);
broadenedProbePlan.allowed_operations = ["PUSH"];
assert.throws(() => validateDeliveryProbePlan(broadenedProbePlan), /allowed operations/u);

console.log("PASS AgentOS delivery policy controller (portable routes, deterministic recommendations, exact probe binding, prohibited-operation, containment, and hostile suites)");
