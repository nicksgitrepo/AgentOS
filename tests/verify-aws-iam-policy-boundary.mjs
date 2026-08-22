#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateAwsIamPolicyBoundary, AWS_IAM_POLICY_INPUT_SCHEMA, AWS_IAM_POLICY_RESULT_SCHEMA} from "../control/aws-iam-policy-boundary-gate.mjs";
import {resolveAwsIamPolicyCanonicalAuthority} from "../control/aws-iam-policy-authority-binding.mjs";
import {evaluateAwsIamPolicyPackage} from "../control/aws-iam-policy-package-evaluator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = path.join(ROOT, "specialist-blocks/wave-02/aws-iam-policy/fixtures");
const FLAGS = [
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
];
const REQUIRED_BLOCKS = [
  "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate", "specialist.platform.provider-edge-router",
  "specialist.standard.aws-iam-current",
];
const ZERO_SIDE_EFFECTS = {
  candidate_reads: 0, source_reads: 0, protected_data_reads: 0, policy_mutations: 0,
  project_writes: 0, memory_writes: 0, credential_accesses: 0, state_changes: 0,
};
const GATE_IDS = [
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
];
const GATE_RULES = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};

const authority = resolveAwsIamPolicyCanonicalAuthority();

function baseInput() {
  return {
    schema: AWS_IAM_POLICY_INPUT_SCHEMA,
    version: 1,
    request_kind: "ANALYZE_AWS_IAM_POLICY",
    evidence: {
      authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.PLATFORM_AWS_IAM_POLICY", custody_ref: authority.custody_ref,
      provider_identity: "AWS", provider_version: "CURRENT", policy_identity: "IAM_POLICY_ELEMENTS", policy_scope: "IAM_POLICY_ELEMENTS", policy_status: "BOUND",
      source_status: "CURRENT_VERIFIED", source_identity: authority.source_identity, source_version: authority.source_version,
      source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date,
      candidate_status: "CURRENT_CANDIDATE", candidate_digest: authority.block_sha256, signal: "CLOUD.AWS_IAM", signal_status: "BOUND",
      context_status: "AWS_IAM_POLICY_CONTEXT", context_complete: true, requested_action: "ANALYZE",
      requested_tools: ["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: [...REQUIRED_BLOCKS],
      model_policy_status: authority.model.snapshot_status, model_route_status: "BOUND", authority_scope: "AWS_IAM_POLICY", scope: "NARROW",
      standard_id: "source.aws-iam-policy-elements", standard_version: "current", standard_block_sha256: authority.standard_block_sha256,
      standard_source_manifest_sha256: authority.standard_source_manifest_sha256, model_snapshot_sha256: authority.model.snapshot_sha256,
      model_task_class: authority.model.task_class, model_capability_floor: authority.model.minimum_capability,
      model_required_capabilities: [...authority.model.required_capabilities], model_route_sha256: authority.model_route_sha256,
      context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256,
      project_data_present: false, secret_data_present: false, policy_mutation_requested: false, credential_issue_requested: false,
      adversarial_flags: Object.fromEntries(FLAGS.map((flag) => [flag, false])),
    },
  };
}

function fixtureInput(fixture) {
  const input = baseInput();
  input.request_kind = fixture.vector.input.request_kind;
  const overrides = fixture.vector.input.evidence_overrides ?? {};
  if (overrides.adversarial_flags) Object.assign(input.evidence.adversarial_flags, overrides.adversarial_flags);
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== "adversarial_flags") input.evidence[key] = structuredClone(value);
  }
  return input;
}

function assertResult(actual, expected, label) {
  assert.equal(actual.schema, AWS_IAM_POLICY_RESULT_SCHEMA, label);
  assert.equal(actual.disposition, expected.disposition, label);
  assert.equal(actual.route, expected.route, label);
  assert.equal(actual.error_code, expected.error_code, label);
  assert.deepEqual(actual.external_side_effects, ZERO_SIDE_EFFECTS, label);
  assert.equal(actual.acceptance_allowed, false, label);
  assert.equal(actual.policy_mutation_allowed, false, label);
  assert.equal(actual.credential_issue_allowed, false, label);
  assert.equal(actual.memory_write_allowed, false, label);
  assert.equal(actual.result_sha256, canonicalDigest({...actual, result_sha256: null}), label);
}

function assertDirectGateReadback() {
  const execution = JSON.parse(fs.readFileSync(path.join(ROOT, "specialist-blocks/wave-02/aws-iam-policy/gates/execution.json"), "utf8"));
  assert.equal(execution.boundary_entrypoint, "control/aws-iam-policy-boundary-gate.mjs#evaluateAwsIamPolicyBoundary");
  assert.deepEqual(execution.ordered_gate_ids, GATE_IDS);
  for (const [index, gateId] of GATE_IDS.entries()) {
    const gate = JSON.parse(fs.readFileSync(path.join(ROOT, "specialist-blocks/wave-02/aws-iam-policy/gates", `${gateId}.gate`), "utf8"));
    assert.equal(gate.gate_id, gateId);
    assert.equal(gate.status, "EXECUTABLE");
    assert.equal(gate.answer_type, "FOUR_VALUED");
    assert.deepEqual(gate.allowed_outcomes, ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
    assert.deepEqual(gate.rules, GATE_RULES);
    const next = index === GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : GATE_IDS[index + 1];
    assert.deepEqual(gate.next, {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next});
    assert.equal(gate.gate_sha256, canonicalDigest({...gate, gate_sha256: null}));
    const tampered = {...gate, next: {...gate.next, UNKNOWN: "OUTCOME:ROUTE"}};
    assert.notEqual(gate.gate_sha256, canonicalDigest({...tampered, gate_sha256: null}), `${gateId} hostile next-branch mutation was not detectable`);
  }
}

const files = fs.readdirSync(FIXTURE_ROOT).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
assertDirectGateReadback();
const fixtureIds = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, file), "utf8"));
  assert(!fixtureIds.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`);
  fixtureIds.add(fixture.fixture_id);
  const actual = evaluateAwsIamPolicyBoundary(fixtureInput(fixture));
  assertResult(actual, fixture.expected, fixture.fixture_id);
}

const valid = baseInput();
assertResult(evaluateAwsIamPolicyBoundary(valid), {
  disposition: "ROUTE", route: "AWS_IAM_POLICY_ANALYSIS_HANDOFF", error_code: "AWS_IAM_POLICY_ROUTE_READY",
}, "valid route");
assert.throws(() => evaluateAwsIamPolicyBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "AWS_IAM_POLICY_UNKNOWN_FIELD");
assert.throws(() => evaluateAwsIamPolicyBoundary({...valid, evidence: {...valid.evidence, candidate_digest: authority.standard_block_sha256}}), (error) => error.code === "AWS_IAM_POLICY_CANDIDATE_BINDING_INVALID");
assert.throws(() => evaluateAwsIamPolicyBoundary({...valid, evidence: {...valid.evidence, context_receipt_sha256: authority.router_result_sha256}}), (error) => error.code === "AWS_IAM_POLICY_CONTEXT_RECEIPT_INVALID");
assert.throws(() => evaluateAwsIamPolicyBoundary({...valid, evidence: {...valid.evidence, model_route_sha256: authority.router_result_sha256}}), (error) => error.code === "AWS_IAM_POLICY_MODEL_ROUTE_UNBOUND");
assert.throws(() => evaluateAwsIamPolicyBoundary({...valid, evidence: {...valid.evidence, candidate_status: "ARCHIVED"}}), (error) => error.code === "AWS_IAM_POLICY_CANDIDATE_BINDING_INVALID");
assertResult(evaluateAwsIamPolicyBoundary({...valid, request_kind: "SPAWN"}), {
  disposition: "DENY", route: "NO_AWS_IAM_POLICY_SIDE_EFFECT", error_code: "AWS_IAM_POLICY_OPERATION_FORBIDDEN",
}, "forbidden operation");
assertResult(evaluateAwsIamPolicyBoundary({...valid, request_kind: "NOT_APPLICABLE"}), {
  disposition: "DENY", route: "NO_AWS_IAM_POLICY_SCOPE", error_code: "AWS_IAM_POLICY_SCOPE_NOT_APPLICABLE",
}, "not applicable");

const operational = await evaluateAwsIamPolicyPackage();
assert.equal(operational.status, "PASS");
assert.equal(operational.fixture_results.length, 17);
assert.equal(operational.gate_execution.length, 12);
assert.equal(operational.mutation_sensitivity.status, "WEAKENED");
console.log("PASS AWS IAM Policy boundary: 17 hostile fixtures, 12 direct four-valued gate readbacks, hostile substitutions, and mutation checks; all side effects remain zero");
