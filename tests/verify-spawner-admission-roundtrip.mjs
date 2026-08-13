#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  adjudicateContextInconsistency,
  assertContextAdmissible,
  extractTypedContext,
  invalidateRoleContextManifest,
  compileSpawnPreparation,
  validateSpawnPreparation,
  verifySpawnReadback,
  SYNTHETIC_ROUNDTRIP_SCHEMA,
} from "../control/spawner-admission-roundtrip.mjs";
import {canonicalDigest} from "../control/spawn-preparation.mjs";

const sha = (letter) => letter.repeat(64);
const modelDuty = {
  role_id: "AGENT_SPAWNER_COMPILER",
  model: "gpt-5.6-sol",
  reasoning_effort: "medium",
  duty: "CONTEXT_EXTRACTION_AND_GOVERNANCE_BLOCK_COMPILATION",
  owner_exception: true,
  cost_boundary: "ONE_NARROW_EXTRACTION_OR_COMPILATION_DUTY",
  fallback_model: "gpt-5.6-luna/max",
};
const source = {
  source_id: "source.synthetic-policy",
  version: "1.0.0",
  content_sha256: sha("1"),
  raw_claims: [
    {statement_id: "claim.route-allow", semantic_key: "route.policy", text: "The route may proceed after typed evidence.", category: "authoritative", scope: "synthetic-route", authority_class: "ACCEPTED_SOURCE_TRUTH", freshness: "FRESH", evidence_status: "PROVEN", generation: 1, commit: sha("a")},
    {statement_id: "claim.route-deny", semantic_key: "route.policy", text: "The route must stop without a protected decision.", category: "authoritative", scope: "synthetic-route", authority_class: "OWNER_INTENT", freshness: "FRESH", evidence_status: "PROVEN", generation: 2, commit: sha("b")},
    {statement_id: "claim.audit-boundary", semantic_key: "audit.boundary", text: "The auditor is read-only.", category: "authoritative", scope: "synthetic-audit", authority_class: "VERIFIED_LAW", freshness: "FRESH", evidence_status: "PROVEN", generation: 1, commit: sha("c")},
  ],
};

const {extraction, contradictions} = extractTypedContext({source, modelDuty, nowUtc: "2026-08-13T01:00:00.000Z"});
assert.equal(extraction.schema, SYNTHETIC_ROUNDTRIP_SCHEMA);
assert.equal(extraction.status, "EXTRACTED");
assert.equal(extraction.model_duty.model, "gpt-5.6-sol");
assert.equal(extraction.model_duty.reasoning_effort, "medium");
assert.equal(extraction.raw_material_retained, false);
assert.equal(contradictions.length, 1);
assert.equal(contradictions[0].schema, "agentos.context_inconsistency.v1");
assert.equal(contradictions[0].raw_admissible, false);
assert.equal(contradictions[0].extraction_sha256, null);
assert.throws(() => extractTypedContext({source, modelDuty: {...modelDuty, model: "gpt-5.6-luna"}}), /owner-authorized Spawner model/u);
assert.throws(() => extractTypedContext({source: {...source, raw_claims: [{...source.raw_claims[0], text: "password=never-accept"}]}, modelDuty}), /raw secret-like material/u);

assert.throws(() => assertContextAdmissible({packets: contradictions, adjudications: []}), /UNADJUDICATED/u, "raw contradiction entered without Bootstrap adjudication");
const highAuthority = adjudicateContextInconsistency({
  packet: contradictions[0],
  ownerIntentDigest: sha("d"),
  candidates: [
    {candidate_id: "candidate.source", authority_class: "ACCEPTED_SOURCE_TRUTH", scope: "synthetic-route", scope_specificity: 2, generation: 1, commit: sha("a"), freshness: "FRESH", evidence_status: "PROVEN", claim_digest: extraction.claims[0].claim_digest, owner_intent: false},
    {candidate_id: "candidate.owner", authority_class: "OWNER_INTENT", scope: "synthetic-route", scope_specificity: 1, generation: 2, commit: sha("b"), freshness: "FRESH", evidence_status: "PROVEN", claim_digest: extraction.claims[1].claim_digest, owner_intent: true},
  ],
});
assert.equal(highAuthority.status, "RESOLVED_BY_HIGHER_AUTHORITY");
assert.equal(highAuthority.selected_candidate_id, "candidate.owner");
assert.doesNotThrow(() => assertContextAdmissible({packets: contradictions, adjudications: [highAuthority]}));

const supersession = adjudicateContextInconsistency({
  packet: contradictions[0],
  candidates: [
    {candidate_id: "candidate.old", authority_class: "ACCEPTED_SOURCE_TRUTH", scope: "synthetic-route", scope_specificity: 2, generation: 1, commit: sha("a"), freshness: "FRESH", evidence_status: "PROVEN", claim_digest: extraction.claims[0].claim_digest, owner_intent: false, supersession: {status: "CURRENT"}},
    {candidate_id: "candidate.new", authority_class: "ACCEPTED_SOURCE_TRUTH", scope: "synthetic-route", scope_specificity: 2, generation: 2, commit: sha("b"), freshness: "FRESH", evidence_status: "PROVEN", claim_digest: extraction.claims[1].claim_digest, owner_intent: false, supersession: {status: "SUPERSEDES", supersedes_candidate_id: "candidate.old"}},
  ],
});
assert.equal(supersession.status, "RESOLVED_BY_SUPERSESSION");
assert.equal(supersession.selected_candidate_id, "candidate.new");
const sourceGap = adjudicateContextInconsistency({
  packet: contradictions[0],
  candidates: [
    {candidate_id: "candidate.stale-a", authority_class: "OWNER_INTENT", scope: "synthetic-route", generation: 1, commit: sha("a"), freshness: "STALE", evidence_status: "PROVEN", claim_digest: extraction.claims[0].claim_digest, owner_intent: true},
    {candidate_id: "candidate.stale-b", authority_class: "ACCEPTED_SOURCE_TRUTH", scope: "synthetic-route", generation: 1, commit: sha("b"), freshness: "UNKNOWN", evidence_status: "MISSING", claim_digest: extraction.claims[1].claim_digest, owner_intent: false},
  ],
});
assert.equal(sourceGap.status, "UNPROVEN_SOURCE_GAP");

const baseRequest = {
  role_id: "AGENT_SPAWNER_COMPILER",
  task_id: "TASK-SYNTHETIC-SPAWNER-001",
  project_context_digest: sha("e"),
  task_scope: "Compile and evaluate a generic role package from accepted typed blocks.",
  non_goals: ["activate a role", "deploy"],
  authority: {allowed: ["compile typed package", "emit typed receipt"], prohibited: ["deploy", "self-accept", "write consumer source"]},
  evidence_contract: {required: ["accepted block digests", "composition QA", "independent handoff"], claim_boundary: "Claims stop at the exact synthetic package and evidence."},
  completion_definition: "An accepted manifest and simulated readback match are emitted without side effects.",
  model_duty: modelDuty,
  required_block_ids: ["block.context", "block.governance"],
  composition_qa: {status: "PASS", contradictions: [], missing_seams: [], scope_excess: [], context_leaks: [], unsupported_applicability: [], impossible_completion: [], unsafe_fallback: [], non_deterministic_handoff: []},
  independent_acceptance: {evaluator_ref: "INDEPENDENT-SYNTHETIC-EVALUATOR", status: "REQUIRED"},
  no_subagents: true,
};
function block(id, dependencies = [], overrides = {}) {
  const candidate = {
    block_id: id,
    version: "1.0.0",
    digest: null,
    source_digest: sha("f"),
    status: "ACCEPTED",
    authority: "PORTABLE_KERNEL",
    privacy_classification: "PUBLIC",
    freshness: {status: "FRESH"},
    applicability: {outcome: "YES", evidence_status: "PROVEN"},
    dependencies: [...dependencies].sort(), conflicts: [], aliases: [],
    authority_contract: {allowed: ["compile narrow package"], prohibited: ["deploy", "self-accept"], overlap_with: []},
    quality: {hostile_fixtures_passed: true},
    evaluation: {independent: true, status: "ACCEPTED", receipt_sha256: sha("0")},
    privacy_redaction_proof: true,
    raw_secret_detected: false,
    required_model: {model: "gpt-5.6-sol", reasoning_effort: "medium"},
    ...overrides,
  };
  delete candidate.digest;
  candidate.digest = canonicalDigest(candidate);
  return candidate;
}
const goodCatalog = [block("block.governance"), block("block.context", ["block.governance"])]
  .sort((left, right) => left.block_id.localeCompare(right.block_id));
const accepted = compileSpawnPreparation({request: baseRequest, catalog: goodCatalog, nowUtc: "2026-08-13T01:00:00.000Z"});
assert.equal(accepted.status, "SPAWN_PACKAGE_ACCEPTED");
validateSpawnPreparation(accepted);

const missing = compileSpawnPreparation({request: baseRequest, catalog: [block("block.context", ["block.missing"])]});
assert.equal(missing.status, "BLOCK_QA_FAILED_REPAIRING");
assert(missing.failures.some((failure) => failure.code === "MISSING_REQUIRED_BLOCK"));
const stale = compileSpawnPreparation({request: baseRequest, catalog: [block("block.governance", [], {freshness: {status: "STALE"}}), block("block.context", ["block.governance"])]});
assert(stale.failures.some((failure) => failure.code === "STALE_OR_UNKNOWN_SOURCE"));
for (const field of ["scope_excess", "context_leaks", "unsupported_applicability"]) {
  const failed = compileSpawnPreparation({request: {...baseRequest, composition_qa: {...baseRequest.composition_qa, [field]: ["synthetic failure"]}}, catalog: goodCatalog});
  assert.equal(failed.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");
}
const conflict = compileSpawnPreparation({request: baseRequest, catalog: [block("block.governance", [], {conflicts: ["block.context"]}), block("block.context", ["block.governance"])]});
assert.equal(conflict.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");
const alias = compileSpawnPreparation({request: baseRequest, catalog: [block("block.governance", [], {aliases: ["same"]}), block("block.context", ["block.governance"], {aliases: ["same"]})]});
assert.equal(alias.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");
const wrongModel = compileSpawnPreparation({request: baseRequest, catalog: [block("block.governance", [], {required_model: {model: "gpt-5.6-luna", reasoning_effort: "max"}}), block("block.context", ["block.governance"])]});
assert(wrongModel.failures.some((failure) => failure.code === "MODEL_DUTY_MISMATCH"));
const rawContradictionHold = compileSpawnPreparation({request: {...baseRequest, composition_qa: {...baseRequest.composition_qa, contradictions: [contradictions[0].packet_sha256]}}, catalog: goodCatalog});
assert.equal(rawContradictionHold.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");

const expectedControlPlane = "opaque:synthetic-control-plane";
const expectedHandoff = sha("9");
const goodReadback = verifySpawnReadback({acceptedPackage: accepted, kind: "WORKING_AGENT", expectedProjectControlPlaneRef: expectedControlPlane, expectedFirstHandoffSha256: expectedHandoff, readback: {role_id: "AGENT_SPAWNER_COMPILER", task_id: "TASK-SYNTHETIC-SPAWNER-001", model: "gpt-5.6-sol", reasoning_effort: "medium", manifest_sha256: accepted.role_context_manifest.manifest_sha256, project_control_plane_ref: expectedControlPlane, first_handoff_sha256: expectedHandoff, no_subagents: true}});
assert.equal(goodReadback.status, "WORKING_AGENT_CREATED_READY");
const badReadback = verifySpawnReadback({acceptedPackage: accepted, kind: "WORKING_AGENT", expectedProjectControlPlaneRef: expectedControlPlane, expectedFirstHandoffSha256: expectedHandoff, readback: {role_id: "AGENT_SPAWNER_COMPILER", task_id: "TASK-SYNTHETIC-SPAWNER-001", model: "gpt-5.6-sol", reasoning_effort: "medium", manifest_sha256: accepted.role_context_manifest.manifest_sha256, project_control_plane_ref: "opaque:wrong", first_handoff_sha256: sha("8"), no_subagents: true}});
assert.equal(badReadback.status, "SPAWN_READBACK_FAILED");

const invalidation = invalidateRoleContextManifest({manifest: accepted.role_context_manifest, changedBlockId: "block.context", newDigest: sha("7"), reason: "governing synthetic context block revision"});
assert.equal(invalidation.status, "INVALIDATED");
assert.equal(invalidation.rebuild_required, true);
assert.equal(invalidation.prior_manifest_sha256, accepted.role_context_manifest.manifest_sha256);
const invalidationBody = {...invalidation};
delete invalidationBody.invalidation_sha256;
assert.equal(invalidation.invalidation_sha256, canonicalDigest(invalidationBody));

const envelope = {schema: SYNTHETIC_ROUNDTRIP_SCHEMA, version: 1, extraction, contradictions, adjudications: [highAuthority, supersession], invalidation, spawn_status: accepted.status, readback_status: goodReadback.status, mutation: "NONE", activation: "OFF", roundtrip_sha256: null};
envelope.roundtrip_sha256 = canonicalDigest({...envelope, roundtrip_sha256: null});
assert.equal(envelope.roundtrip_sha256, canonicalDigest({...envelope, roundtrip_sha256: null}));
console.log("PASS synthetic Agent Spawner admission: Sol/medium extraction, typed contradiction hold/adjudication, fail-closed block repair and composition QA, accepted manifest, bound readback, and dependency invalidation");
