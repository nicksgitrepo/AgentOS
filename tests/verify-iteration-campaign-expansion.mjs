#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ITERATION_CAMPAIGN_EXPANSION_SCHEMA,
  ITERATION_CAMPAIGN_ID,
  ITERATION_CAMPAIGN_ROLE,
  ITERATION_CAMPAIGN_SCOPE,
  PREPARED_RELEASE_STATE,
  classifyIterationCampaignExpansion,
  compileIterationCampaignExpansionAdmission,
  iterationCampaignExpansionDigest,
  validateIterationCampaignExpansionAdmission,
} from "../control/iteration-campaign-expansion.mjs";
import {universalTaskCloseoutPolicy} from "../control/governance-library.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const OTHER_COMMIT = "3".repeat(40);
const OTHER_TREE = "4".repeat(40);

function sourceBinding({commit = COMMIT, tree = TREE, expectedCommit = COMMIT, expectedTree = TREE} = {}) {
  return {sourceCommit: commit, sourceTree: tree, expectedSourceCommit: expectedCommit, expectedSourceTree: expectedTree};
}

function protectedActions(overrides = {}) {
  return {
    externalAction: false,
    authorityChange: false,
    destructiveAction: false,
    newProductScope: false,
    finalizerCompletion: false,
    push: false,
    publication: false,
    deployment: false,
    activation: false,
    selfAcceptance: false,
    ...overrides,
  };
}

function admittedInput(overrides = {}) {
  return {
    campaignId: ITERATION_CAMPAIGN_ID,
    campaignVersion: "v1",
    sourceBinding: sourceBinding(),
    scopeClass: ITERATION_CAMPAIGN_SCOPE,
    dependencySatisfied: true,
    ownerIntentResolved: true,
    identityMatch: true,
    capabilityAvailable: true,
    role: ITERATION_CAMPAIGN_ROLE,
    protectedActions: protectedActions(),
    releaseCandidateState: PREPARED_RELEASE_STATE,
    ...overrides,
  };
}

function blocked(label, input, classification, ownerChoiceRequired = false) {
  const result = compileIterationCampaignExpansionAdmission(input);
  assert.equal(result.status, "BLOCKED", `${label} was not blocked`);
  assert.equal(result.decision, "STOP", `${label} did not stop`);
  assert.equal(result.classification, classification, `${label} classification changed`);
  assert.equal(result.owner_choice_required, ownerChoiceRequired, `${label} owner-choice state changed`);
  assert.equal(result.effects.release_candidate_active, false, `${label} activated the prepared release`);
  return result;
}

const admitted = compileIterationCampaignExpansionAdmission(admittedInput());
assert.equal(admitted.schema, ITERATION_CAMPAIGN_EXPANSION_SCHEMA);
assert.equal(admitted.status, "ADMITTED");
assert.equal(admitted.classification, "INTERNAL_AGENTOS_CONTINUATION");
assert.equal(admitted.decision, "CONTINUE_WITHOUT_OWNER_APPROVAL");
assert.equal(admitted.route, "INTENT_REGULATOR_CONTINUE");
assert.equal(admitted.continuation, "CONTINUE");
assert.equal(admitted.owner_choice_required, false);
assert.equal(admitted.source_binding.status, "MATCH");
assert.equal(admitted.campaign_binding.campaign_id, ITERATION_CAMPAIGN_ID);
assert.equal(admitted.campaign_binding.scope_class, ITERATION_CAMPAIGN_SCOPE);
assert.equal(admitted.release_candidate_state, PREPARED_RELEASE_STATE);
assert.deepEqual(admitted.universal_closeout, universalTaskCloseoutPolicy("ITERATION"), "iteration admission does not carry the general universal closeout policy");
assert.deepEqual(admitted.effects, {
  external_action_performed: false,
  authority_changed: false,
  destructive_action_performed: false,
  finalizer_completed: false,
  pushed: false,
  published: false,
  deployed: false,
  activated: false,
  self_accepted: false,
  release_candidate_active: false,
});
assert.equal(admitted.admission_sha256, iterationCampaignExpansionDigest(admitted));
validateIterationCampaignExpansionAdmission(admitted);

const reordered = compileIterationCampaignExpansionAdmission({
  ...admittedInput(),
  protectedActions: Object.fromEntries(Object.entries(protectedActions()).reverse()),
});
assert.deepEqual(admitted, reordered, "admitted internal classification is not deterministic");
assert.deepEqual(classifyIterationCampaignExpansion(admittedInput()), classifyIterationCampaignExpansion(admittedInput()), "classification is not repeatable");

blocked("missing source binding", {...admittedInput(), sourceBinding: undefined}, "SOURCE_BINDING_INVALID");
blocked("invalid source commit", {...admittedInput(), sourceBinding: sourceBinding({commit: "not-a-commit"})}, "SOURCE_BINDING_INVALID");
blocked("mismatched source binding", {...admittedInput(), sourceBinding: sourceBinding({expectedCommit: OTHER_COMMIT, expectedTree: OTHER_TREE})}, "SOURCE_BINDING_MISMATCH");
blocked("identity mismatch", {...admittedInput(), identityMatch: false}, "IDENTITY_MISMATCH");
blocked("unavailable capability", {...admittedInput(), capabilityAvailable: false}, "CAPABILITY_UNAVAILABLE");
blocked("unsatisfied dependency", {...admittedInput(), dependencySatisfied: false}, "DEPENDENCY_UNSATISFIED");
blocked("unresolved owner intent", {...admittedInput(), ownerIntentResolved: false}, "OWNER_INTENT_UNRESOLVED", true);
blocked("generic Feature Agent role", {...admittedInput(), role: "FEATURE_AGENT"}, "GENERIC_FEATURE_AGENT_ROLE");
blocked("private context", {...admittedInput(), privateContext: "SYNTHETIC_CONTEXT"}, "PRODUCT_OR_PRIVATE_CONTEXT");

for (const [field, classification] of [
  ["externalAction", "EXTERNAL_ACTION"],
  ["authorityChange", "AUTHORITY_CHANGE"],
  ["destructiveAction", "DESTRUCTIVE_ACTION"],
  ["newProductScope", "NEW_PRODUCT_SCOPE"],
  ["finalizerCompletion", "FINALIZER_COMPLETION"],
  ["push", "PUSH"],
  ["publication", "PUBLICATION"],
  ["deployment", "DEPLOYMENT"],
  ["activation", "ACTIVATION"],
  ["selfAcceptance", "SELF_ACCEPTANCE"],
]) blocked(`protected action ${field}`, {...admittedInput(), protectedActions: protectedActions({[field]: true})}, classification, ["externalAction", "authorityChange", "destructiveAction", "newProductScope", "push", "publication", "deployment", "activation"].includes(field));

blocked("scope mismatch", {...admittedInput(), scopeClass: "EXTERNAL"}, "SCOPE_OUT_OF_BOUNDS", true);
blocked("campaign mismatch", {...admittedInput(), campaignId: "ITER-004"}, "CAMPAIGN_BINDING_MISMATCH");
blocked("unsupported role", {...admittedInput(), role: "CAMPAIGN_FINALIZER"}, "ROLE_NOT_ADMITTED");
blocked("active release candidate", {...admittedInput(), releaseCandidateState: "ACTIVE"}, "ACTIVATION", true);

const precedenceSource = compileIterationCampaignExpansionAdmission({
  ...admittedInput(),
  sourceBinding: sourceBinding({expectedCommit: OTHER_COMMIT, expectedTree: OTHER_TREE}),
  identityMatch: false,
  capabilityAvailable: false,
});
assert.equal(precedenceSource.classification, "SOURCE_BINDING_MISMATCH", "source failure was hidden by later failures");

const precedenceIdentity = compileIterationCampaignExpansionAdmission({
  ...admittedInput(),
  identityMatch: false,
  capabilityAvailable: false,
});
assert.equal(precedenceIdentity.classification, "IDENTITY_MISMATCH", "identity failure was hidden by capability failure");

const precedenceCapability = compileIterationCampaignExpansionAdmission({
  ...admittedInput(),
  capabilityAvailable: false,
  protectedActions: protectedActions({externalAction: true}),
});
assert.equal(precedenceCapability.classification, "CAPABILITY_UNAVAILABLE", "capability failure was hidden by protected scope");

for (const bad of [null, [], "untyped", {...admittedInput(), dependencySatisfied: "true"}, {...admittedInput(), protectedActions: {...protectedActions(), push: "false"}}]) {
  const result = compileIterationCampaignExpansionAdmission(bad);
  assert.equal(result.status, "BLOCKED", "untyped input was not blocked");
  assert.equal(result.route, "FAIL_CLOSED", "untyped input did not fail closed");
}

console.log("PASS AgentOS ITER-003 continuation gate (admitted internal path, deterministic precedence, protected boundaries, and hostile coverage)");
