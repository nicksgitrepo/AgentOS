#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOOTSTRAP_QUESTIONS,
  canonicalDigest,
  compileBootstrapPlan,
  normalizeBootstrapChoiceReply,
  planBootstrapQuestions,
  validateBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {compileDeliveryPolicy} from "../control/delivery-policy.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-delivery-finish-"));
const discovery = discoverProject(root, "RECOMMENDED").facts;
const deliveryPolicy = {
  source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
  ci_runner: {route: "LOCAL", weekly_minutes_budget: 120},
  deployment: {route: "LOCAL", environment_ids: ["synthetic"]},
};
const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "owner", outcome: "complete the first useful workflow"},
  "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic Project", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["destructive production actions"], protected: ["secrets"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": deliveryPolicy,
  "project.delivery_finish": "5",
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-FINISH", environment_identity: "ENV-FINISH", capabilities: ["filesystem"]},
};

try {
  const finishDefinition = BOOTSTRAP_QUESTIONS.find((question) => question.id === "project.delivery_finish");
  assert.equal(finishDefinition.prompt, "When we're ready, what should I do with it?");
  assert.deepEqual(finishDefinition.owner_choices, [
    "Leave it ready for review",
    "Save it safely for later",
    "Share the saved work",
    "Make it part of the main version",
    "Put it live",
    "Release or share it",
  ]);

  const withoutFinish = {...answers};
  delete withoutFinish["project.delivery_finish"];
  const pending = planBootstrapQuestions({discovery, answers: withoutFinish});
  assert.equal(pending.next, "project.delivery_finish");
  assert.deepEqual(pending.owner_questions[0], {
    prompt: "When we're ready, what should I do with it?",
    choices: finishDefinition.owner_choices,
    reply_guidance: "Reply with one number.",
    optional: false,
  });
  const ownerSurface = JSON.stringify(pending.owner_questions[0]);
  for (const internalTerm of ["project.delivery_finish", "DELIVERY_POLICY", "ENUM", "schema", "campaign", "adapter", "commit", "branch", "exact plan", "policy", "push", "merge", "deploy"]) {
    assert(!ownerSurface.includes(internalTerm), `owner finish question exposes ${internalTerm}`);
  }

  const noPolicy = {...withoutFinish};
  delete noPolicy["project.delivery_policy"];
  const noPolicyPending = planBootstrapQuestions({discovery, answers: noPolicy});
  assert.equal(noPolicyPending.next, "project.delivery_finish");
  assert.equal(noPolicyPending.questions.length, 1);
  assert.equal(noPolicyPending.owner_questions.length, 1);
  const reviewOnlyAnswers = {...noPolicy, "project.delivery_finish": "1"};
  const reviewOnlyPlan = compileBootstrapPlan({discovery, answers: reviewOnlyAnswers, projectRoot: root});
  validateBootstrapPlan(reviewOnlyPlan);
  assert.equal(reviewOnlyPlan.delivery_policy.finish.selected, "REVIEW");
  assert.equal(reviewOnlyPlan.delivery_policy.status, "COMPILED_WITH_PROJECT_BINDING_GAPS");

  assert.equal(normalizeBootstrapChoiceReply("project.delivery_finish", "5"), "DEPLOY");
  assert.equal(normalizeBootstrapChoiceReply("project.delivery_finish", 5), "DEPLOY");
  assert.equal(normalizeBootstrapChoiceReply("project.delivery_finish", "Put it live"), "DEPLOY");
  assert.throws(() => normalizeBootstrapChoiceReply("project.delivery_finish", 7), /outside the matching question choices/u);
  assert.throws(() => normalizeBootstrapChoiceReply("project.delivery_finish", "y"), /ambiguous or unknown/u);
  assert.throws(() => normalizeBootstrapChoiceReply("project.unknown", "1"), /matching enum question/u);

  const plan = compileBootstrapPlan({discovery, answers, projectRoot: root});
  validateBootstrapPlan(plan);
  assert.equal(plan.delivery_policy.finish.selected, "DEPLOY");
  assert.deepEqual(plan.delivery_policy.finish.included_steps.slice(-2), ["MERGE", "DEPLOY"]);
  assert.equal(plan.exact_creation_plan.delivery_bindings.finish, "DEPLOY");
  assert.equal(plan.first_campaign.delivery_finish, "DEPLOY");
  assert.equal(plan.first_campaign.design_bible_sha256, canonicalDigest(plan.design_bible));
  assert.equal(plan.exact_creation_plan.campaign_design_sha256, canonicalDigest({
    design_bible: plan.design_bible,
    first_campaign: plan.first_campaign,
  }));
  assert(plan.exact_creation_plan.prohibited_actions.includes("DEPLOYMENT"));

  const legacyPolicy = compileDeliveryPolicy({discovery, answer: deliveryPolicy});
  assert.equal(legacyPolicy.finish.selected, null);
  assert(legacyPolicy.unresolved.includes("DELIVERY_FINISH_OWNER_CHOICE"));

  assert.throws(() => compileBootstrapPlan({
    discovery,
    answers: {
      ...answers,
      "project.delivery_policy": {...deliveryPolicy, finish: "REVIEW"},
      "project.delivery_finish": "DEPLOY",
    },
    projectRoot: root,
  }), /differs between the owner choice and typed policy/u);

  const tampered = structuredClone(plan);
  tampered.first_campaign.delivery_finish = "REVIEW";
  delete tampered.plan_sha256;
  tampered.plan_sha256 = canonicalDigest(tampered);
  assert.throws(() => validateBootstrapPlan(tampered), /campaign design delivery finish differs/u);

  console.log("PASS AgentOS Bootstrap delivery finish (friendly owner choice, numeric normalization, exact design binding, legacy compatibility, and hostile coverage)");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
