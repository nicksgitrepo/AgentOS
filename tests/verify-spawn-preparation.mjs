#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  canonicalDigest,
  compileSpawnPreparation,
  validateSpawnPreparation,
  verifySpawnReadback,
} from "../control/spawn-preparation.mjs";

const sha = (letter) => letter.repeat(64);
const baseRequest = {
  role_id: "BACKEND_RUST_BUILDER",
  task_id: "TASK-RUST-AI-001",
  project_context_digest: sha("a"),
  task_scope: "Build the declared Rust backend slice and return a typed candidate handoff.",
  non_goals: ["change owner intent", "deploy"],
  authority: {allowed: ["read admitted context", "write isolated candidate"], prohibited: ["accept own work", "deploy", "write consumer source"]},
  evidence_contract: {required: ["clean candidate identity", "focused tests", "independent audit"], claim_boundary: "Claims stop at the exact candidate and evidence recorded."},
  completion_definition: "A clean candidate, focused proof, and independent typed handoff are accepted.",
  model_duty: {model: "gpt-5.6-luna", reasoning_effort: "max", duty: "NARROW_IMPLEMENTATION", owner_exception: false},
  required_block_ids: ["block.backend", "block.rust"],
  composition_qa: {status: "PASS", contradictions: [], missing_seams: [], context_leaks: [], impossible_completion: [], unsafe_fallback: [], non_deterministic_handoff: []},
  independent_acceptance: {evaluator_ref: "INDEPENDENT-EVALUATOR", status: "REQUIRED"},
  no_subagents: true,
};

function block(id, dependencies = [], overrides = {}) {
  const base = {
    block_id: id,
    version: "1.0.0",
    digest: null,
    source_digest: sha("b"),
    status: "ACCEPTED",
    authority: "PORTABLE_KERNEL",
    privacy_classification: "PUBLIC",
    freshness: {status: "FRESH"},
    applicability: {outcome: "YES", evidence_status: "PROVEN"},
    dependencies: [...dependencies].sort(),
    conflicts: [],
    aliases: [],
    authority_contract: {allowed: ["perform narrow task"], prohibited: ["deploy", "self-accept"], overlap_with: []},
    quality: {hostile_fixtures_passed: true},
    evaluation: {independent: true, status: "ACCEPTED", receipt_sha256: sha("c")},
    privacy_redaction_proof: true,
    raw_secret_detected: false,
    required_model: {model: "gpt-5.6-luna", reasoning_effort: "max"},
    ...overrides,
  };
  const body = structuredClone(base);
  delete body.digest;
  base.digest = canonicalDigest(body);
  return base;
}

const catalog = [block("block.backend"), block("block.rust", ["block.backend"])];
const accepted = compileSpawnPreparation({request: baseRequest, catalog, nowUtc: "2026-08-13T00:00:00.000Z"});
assert.equal(accepted.status, "SPAWN_PACKAGE_ACCEPTED");
assert.equal(accepted.spawn_allowed, true);
assert.equal(accepted.role_context_manifest.status, "ACCEPTED");
validateSpawnPreparation(accepted);
assert.deepEqual(compileSpawnPreparation({request: baseRequest, catalog, nowUtc: "2026-08-13T00:00:00.000Z"}), accepted, "spawn preparation is not deterministic");

const missing = compileSpawnPreparation({request: {...baseRequest, required_block_ids: ["block.missing", "block.rust"]}, catalog});
assert.equal(missing.status, "BLOCK_QA_FAILED_REPAIRING");
assert.equal(missing.spawn_allowed, false);
assert(missing.failures.some((failure) => failure.code === "MISSING_REQUIRED_BLOCK"));

const conflictCatalog = [block("block.backend"), block("block.rust", ["block.backend"], {conflicts: ["block.security"]}), block("block.security", [], {aliases: ["backend-security"]})];
const conflict = compileSpawnPreparation({request: {...baseRequest, required_block_ids: ["block.backend", "block.rust", "block.security"]}, catalog: conflictCatalog});
assert.equal(conflict.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");

const stale = compileSpawnPreparation({request: baseRequest, catalog: [block("block.backend", [], {freshness: {status: "STALE"}}), block("block.rust", ["block.backend"]) ]});
assert.equal(stale.status, "BLOCK_QA_FAILED_REPAIRING");
assert(stale.failures.some((failure) => failure.code === "STALE_OR_UNKNOWN_SOURCE"));

const contradiction = compileSpawnPreparation({request: {...baseRequest, composition_qa: {...baseRequest.composition_qa, contradictions: ["block.backend conflicts with project context"]}}, catalog});
assert.equal(contradiction.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");

const unsupportedApplicability = compileSpawnPreparation({request: baseRequest, catalog: [block("block.backend", [], {applicability: {outcome: "UNKNOWN", evidence_status: "MISSING"}}), block("block.rust", ["block.backend"]) ]});
assert.equal(unsupportedApplicability.status, "BLOCK_QA_FAILED_REPAIRING");
assert(unsupportedApplicability.failures.some((failure) => failure.code === "UNPROVEN_APPLICABILITY"));

const privacyLeak = compileSpawnPreparation({request: baseRequest, catalog: [block("block.backend", [], {raw_secret_detected: true}), block("block.rust", ["block.backend"]) ]});
assert.equal(privacyLeak.status, "BLOCK_QA_FAILED_REPAIRING");
assert(privacyLeak.failures.some((failure) => failure.code === "BLOCK_INVALID"));

const aliasDuplicate = compileSpawnPreparation({request: {...baseRequest, required_block_ids: ["block.backend", "block.rust"]}, catalog: [block("block.backend", [], {aliases: ["same-semantic-block"]}), block("block.rust", ["block.backend"], {aliases: ["same-semantic-block"]})]});
assert.equal(aliasDuplicate.status, "CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP");

assert.throws(() => compileSpawnPreparation({request: {...baseRequest, model_duty: {...baseRequest.model_duty, model: "gpt-5.6-sol", reasoning_effort: "medium"}}, catalog}), /model\/duty is not permitted/u);
const incompleteDependency = compileSpawnPreparation({request: baseRequest, catalog: [block("block.rust", ["block.unavailable"])]});
assert(incompleteDependency.failures.some((failure) => failure.code === "MISSING_REQUIRED_BLOCK"));

const badReadback = verifySpawnReadback({acceptedPackage: accepted, kind: "WORKING_AGENT", readback: {role_id: accepted.role_context_manifest.role_id, task_id: accepted.role_context_manifest.task_id, model: "gpt-5.6-luna", reasoning_effort: "max", manifest_sha256: sha("f"), project_control_plane_ref: "opaque:control:abc", first_handoff_sha256: sha("e"), no_subagents: true}});
assert.equal(badReadback.status, "SPAWN_READBACK_FAILED");
const goodReadback = verifySpawnReadback({acceptedPackage: accepted, kind: "WORKING_AGENT", readback: {role_id: accepted.role_context_manifest.role_id, task_id: accepted.role_context_manifest.task_id, model: "gpt-5.6-luna", reasoning_effort: "max", manifest_sha256: accepted.role_context_manifest.manifest_sha256, project_control_plane_ref: "opaque:control:abc", first_handoff_sha256: sha("e"), no_subagents: true}});
assert.equal(goodReadback.status, "WORKING_AGENT_CREATED_READY");
const seedReadback = verifySpawnReadback({acceptedPackage: accepted, kind: "SEED", readback: {role_id: accepted.role_context_manifest.role_id, task_id: accepted.role_context_manifest.task_id, model: "gpt-5.6-luna", reasoning_effort: "max", manifest_sha256: accepted.role_context_manifest.manifest_sha256, project_control_plane_ref: "opaque:control:abc", first_handoff_sha256: sha("e"), no_subagents: true}});
assert.equal(seedReadback.status, "SEED_CREATED_IDLE");

console.log("PASS AgentOS fail-closed Agent Spawner: dependency closure, stale/applicability/privacy/model/alias checks, contradiction routing, composition QA, accepted role manifest, hostile readback, and seed-idle/working-ready separation");
