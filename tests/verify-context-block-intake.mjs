#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  canonicalDigest,
  compileContextBlockIntake,
  finalizeContextBlockIntakeReceipt,
  validateContextBlockIntake,
  verifyContextBlockForIntake,
} from "../control/context-block-intake.mjs";

const base = {
  block_id: "context.workflow.example",
  revision: "1.0.0",
  author_ref: "context-research-lane",
  classification: "PROJECT_SPECIFIC",
  authority_scope: "PROJECT_CONTROL_PLANE",
  purpose: "Supply one narrow, source-backed workflow context slice to an external companion agent.",
  atomic_scope: {
    included: ["typed evidence obligations", "workflow acceptance boundary"],
    non_goals: ["legal or certification conclusion", "product implementation"],
    smallest_sufficient_rule: "Select only this workflow slice when its typed context signals are present.",
  },
  source_documents: [{
    source_id: "source.example-doc",
    title: "Example source document",
    publisher: "Example publisher",
    source_locator: "PROJECT_CONTEXT",
    version: "2026-08",
    immutable_identity: "example-doc-2026-08",
    content_sha256: "a".repeat(64),
    extracted_at_utc: "2026-08-13T00:00:00.000Z",
    authority_class: "PROJECT_CONTEXT",
  }],
  statements: {
    authoritative: [{statement_id: "statement.authoritative-boundary", text: "The workflow requires an explicit acceptance record.", source_refs: ["source.example-doc"]}],
    inference: [{statement_id: "statement.inferred-risk", text: "Missing acceptance evidence may leave the workflow unresolved.", source_refs: ["source.example-doc"]}],
    history: [{statement_id: "statement.historical-note", text: "An earlier process used a manual handoff.", source_refs: ["source.example-doc"]}],
  },
  freshness: {
    policy: "Revalidate when the source changes, expires, or a contradiction is reported.",
    expires_at_utc: "2027-08-13T00:00:00.000Z",
    revalidation_triggers: ["contradiction", "expiry", "source revision"],
  },
  applicability: {
    applies_when: ["typed workflow context is present"],
    does_not_apply_when: ["scope is outside the declared workflow", "workflow context is absent"],
    required_context_fields: ["workflow.identity"],
    unknown_rule: "UNKNOWN_DENIES_DEPENDENT_ACTION;_NO_INFERENCE_OR_SCOPE_EXPANSION",
  },
  dependencies: ["specialist.control.project-controller"],
  conflicts: ["context.workflow.superseded-example"],
  precedence: ["inference", "owner intent", "project governance", "this context block"],
  intended_roles: ["specialist.control.project-controller"],
  minimal_context_payload: {
    required_fields: ["workflow.identity"],
    optional_fields: ["workflow.version"],
    redaction_profile: "NO_RAW_SOURCE_OR_SECRET_VALUES",
    payload_sha256: "b".repeat(64),
  },
  gate_mapping: {
    gate_path: "gates/05-context-completeness.gate",
    gate_ids: ["05-context-completeness"],
    allowed_outcomes: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"],
    mapping_sha256: null,
  },
  authority: {
    allowed: ["emit typed handoff", "read typed context"],
    prohibited: ["claim certification", "deploy", "self-accept", "write consumer source"],
    escalation: "Escalate missing, conflicting, stale, or protected context to the project controller.",
    acceptance: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT",
  },
  evidence: {
    minimum: ["freshness check", "independent evaluation", "source identity", "statement traceability"],
    claim_boundary: "Claims are limited to the declared workflow context and cited source statements.",
    unknown_action: "RECORD_UNKNOWN_AND_CLOSE_ONLY_THE_DEPENDENT_ACTION",
  },
  privacy: {
    classification: "INTERNAL",
    secret_handling: "DENY_RAW_SECRETS;_REDACT_AND_ESCALATE",
    redaction_method: "Retain field names and digests only; remove raw values before intake.",
    redaction_proof_sha256: "c".repeat(64),
  },
  adversarial_fixtures: [
    {fixture_id: "fixture.conflict", purpose: "Contradictory source is present.", expected_outcome: "UNKNOWN"},
    {fixture_id: "fixture.missing-source", purpose: "Source reference does not resolve.", expected_outcome: "UNKNOWN"},
    {fixture_id: "fixture.raw-secret", purpose: "Raw secret appears in candidate payload.", expected_outcome: "DENY"},
    {fixture_id: "fixture.scope-drift", purpose: "Request exceeds atomic scope.", expected_outcome: "DENY"},
    {fixture_id: "fixture.stale-source", purpose: "Source is outside freshness policy.", expected_outcome: "DENY"},
  ],
  independent_evaluation: {
    evaluator_ref: "independent-context-evaluator",
    status: "NOT_RUN",
    independent: true,
    evaluated_block_sha256: null,
    receipt_sha256: null,
  },
  supersession: {
    status: "CURRENT",
    supersedes: null,
    superseded_by: null,
    migration_rule: "Create a new immutable revision and preserve the prior receipt before replacing this block.",
  },
  rollback: {
    legacy_source_identity: "legacy-example-context-2026-08",
    preservation_receipt_sha256: "d".repeat(64),
    restore_procedure: "Restore the preserved source receipt and remove only this external companion candidate.",
  },
};

base.gate_mapping.mapping_sha256 = canonicalDigest({...base.gate_mapping, mapping_sha256: null});
const candidate = compileContextBlockIntake(base);
assert.equal(candidate.status, "CANDIDATE");
assert.equal(candidate.classification, "PROJECT_SPECIFIC");
assert.equal(candidate.authority_scope, "PROJECT_CONTROL_PLANE");
assert.equal(candidate.independent_evaluation.status, "NOT_RUN");
assert.equal(candidate.block_sha256, canonicalDigest({...candidate, block_sha256: null}));
assert.deepEqual(compileContextBlockIntake(structuredClone(base)), candidate, "context block compilation is not deterministic");

const waiting = structuredClone(candidate);
waiting.status = "WAITING_WITH_RECEIPT";
waiting.independent_evaluation.status = "INTAKE_RECOMMENDED";
waiting.independent_evaluation.evaluated_block_sha256 = null;
waiting.independent_evaluation.receipt_sha256 = "e".repeat(64);
delete waiting.block_sha256;
waiting.block_sha256 = canonicalDigest({...waiting, block_sha256: null});
validateContextBlockIntake(waiting);
const receipt = finalizeContextBlockIntakeReceipt(verifyContextBlockForIntake({
  block: waiting,
  evaluator: {
    evaluator_ref: "independent-context-evaluator",
    status: "INTAKE_RECOMMENDED",
    independent: true,
    block_sha256: waiting.block_sha256,
    receipt_sha256: "e".repeat(64),
  },
}));
assert.equal(receipt.status, "INTAKE_ELIGIBLE");
assert.equal(receipt.external_only, true);
assert.equal(receipt.mutation, "NONE");
assert.equal(receipt.activation, "OFF");
assert.equal(receipt.admission, "NOT_PERFORMED");
assert.equal(receipt.receipt_sha256, canonicalDigest({...receipt, receipt_sha256: null}));

const portableLeak = structuredClone(base);
portableLeak.classification = "PORTABLE";
portableLeak.authority_scope = "PROJECT_CONTROL_PLANE";
assert.throws(() => compileContextBlockIntake(portableLeak), /portable blocks cannot claim project-control-plane/u);

const missingSourceRef = structuredClone(base);
missingSourceRef.statements.authoritative[0].source_refs = ["source.missing"];
assert.throws(() => compileContextBlockIntake(missingSourceRef), /references an unknown source/u);

const rawSecret = structuredClone(base);
rawSecret.purpose = "password=do-not-accept";
assert.throws(() => compileContextBlockIntake(rawSecret), /raw secret-like material/u);

const sameAuthor = structuredClone(waiting);
sameAuthor.independent_evaluation.evaluator_ref = sameAuthor.author_ref;
delete sameAuthor.block_sha256;
sameAuthor.block_sha256 = canonicalDigest({...sameAuthor, block_sha256: null});
assert.throws(() => validateContextBlockIntake(sameAuthor), /author and evaluator identities must be distinct/u);

const wrongEvaluation = structuredClone(waiting);
wrongEvaluation.independent_evaluation.evaluated_block_sha256 = "f".repeat(64);
delete wrongEvaluation.block_sha256;
wrongEvaluation.block_sha256 = canonicalDigest({...wrongEvaluation, block_sha256: null});
assert.throws(() => validateContextBlockIntake(wrongEvaluation), /evaluation does not bind to the exact block/u);

console.log("PASS AgentOS context-block intake: typed source/provenance, classification boundary, applicability, gate mapping, privacy, hostile evaluation, supersession, rollback, and no-mutation intake proof");
