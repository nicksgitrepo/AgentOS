#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import {
  IMPORT_ORCHESTRATOR_FORBIDDEN_CAPABILITIES,
  IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS,
  compileImportOrchestratorCampaignAcceptance,
  compileImportOrchestratorGovernance,
  compileImportOrchestratorGovernanceReadiness,
  validateImportOrchestratorCampaignAcceptance,
  validateImportOrchestratorGovernance,
  validateImportOrchestratorGovernanceReadiness,
} from "../control/import-orchestrator-governance-readiness.mjs";

const HASH = (value) => canonicalDigest({value});
const NOW = "2026-08-16T00:00:00.000Z";
const gateFor = (gateId) => ({
  gate_id: gateId,
  status: "PASS",
  rule: `The ${gateId} gate has a deterministic project-agnostic rule and exact stop behavior.`,
  evidence_sha256: HASH(`evidence:${gateId}`),
  hostile_fixture_ids: [`FIXTURE.ORCHESTRATOR.${gateId.split(".").at(-1)}.MISSING`, `FIXTURE.ORCHESTRATOR.${gateId.split(".").at(-1)}.BYPASS`].sort(compareUtf8),
  authority: "PROJECT_AGNOSTIC_ORCHESTRATOR",
  stop_condition: "Reject campaign planning and preserve the typed blocked readiness receipt until this gate passes.",
});
const governance = compileImportOrchestratorGovernance({sourceCommit: "AGENTOS-COMMIT-ORCHESTRATOR", sourceTree: "AGENTOS-TREE-ORCHESTRATOR", gates: IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS.map(gateFor)});
validateImportOrchestratorGovernance(governance);
assert.deepEqual(governance.required_gate_ids, IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS);
assert.deepEqual(governance.forbidden_capabilities, IMPORT_ORCHESTRATOR_FORBIDDEN_CAPABILITIES);

const readiness = compileImportOrchestratorGovernanceReadiness({orchestratorId: "ORCHESTRATOR.IMPORT.SYNTHETIC", governance, observedAtUtc: NOW});
validateImportOrchestratorGovernanceReadiness(readiness);
assert.equal(readiness.injection_order, 5);
assert.equal(readiness.status, "READY_TO_PLAN");
assert.equal(readiness.acceptance_state, "CAMPAIGN_PLANNING_ALLOWED");
assert.deepEqual(readiness.verified_gate_ids, IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS);

const acceptance = compileImportOrchestratorCampaignAcceptance({readiness, campaignRequestSha256: HASH("campaign-request"), acceptedAtUtc: NOW});
validateImportOrchestratorCampaignAcceptance(acceptance, {readiness});
assert.equal(acceptance.readiness_sha256, readiness.readiness_sha256);
assert.equal(acceptance.orchestrator_id, readiness.orchestrator_id);

const missing = compileImportOrchestratorGovernanceReadiness({orchestratorId: "ORCHESTRATOR.IMPORT.SYNTHETIC", governance: null, observedAtUtc: NOW});
assert.equal(missing.status, "BLOCKED");
assert.equal(missing.failure_code, "GOVERNANCE_MISSING");
assert.throws(() => compileImportOrchestratorCampaignAcceptance({readiness: missing, campaignRequestSha256: HASH("campaign-request"), acceptedAtUtc: NOW}), /rejected until governance readiness passes/u);

const incomplete = structuredClone(governance);
incomplete.gates = incomplete.gates.slice(0, -1);
assert.equal(compileImportOrchestratorGovernanceReadiness({orchestratorId: readiness.orchestrator_id, governance: incomplete, observedAtUtc: NOW}).failure_code, "GOVERNANCE_INVALID");
const placeholder = structuredClone(governance);
placeholder.gates[0].rule = "TODO";
assert.equal(compileImportOrchestratorGovernanceReadiness({orchestratorId: readiness.orchestrator_id, governance: placeholder, observedAtUtc: NOW}).failure_code, "GOVERNANCE_INVALID");
const reordered = structuredClone(governance);
reordered.gates.reverse();
assert.equal(compileImportOrchestratorGovernanceReadiness({orchestratorId: readiness.orchestrator_id, governance: reordered, observedAtUtc: NOW}).failure_code, "GOVERNANCE_INVALID");
assert.throws(() => compileImportOrchestratorGovernance({sourceCommit: "x", sourceTree: "y", gates: null}), /gates input is required/u);

const staleAcceptance = structuredClone(acceptance);
staleAcceptance.readiness_sha256 = HASH("stale-readiness");
staleAcceptance.acceptance_sha256 = canonicalDigest({...staleAcceptance, acceptance_sha256: null});
assert.throws(() => validateImportOrchestratorCampaignAcceptance(staleAcceptance, {readiness}), /acceptance is stale/u);
const tamperedReadiness = structuredClone(readiness);
tamperedReadiness.governance_sha256 = HASH("tampered-governance");
assert.throws(() => validateImportOrchestratorGovernanceReadiness(tamperedReadiness), /readiness digest mismatch/u);
const tamperedGovernance = structuredClone(governance);
tamperedGovernance.forbidden_capabilities = tamperedGovernance.forbidden_capabilities.slice(1);
assert.throws(() => validateImportOrchestratorGovernance(tamperedGovernance), /forbidden capabilities are incomplete/u);

for (const field of ["product_mutation", "provider_access", "credential_access", "external_sync", "protected_release"]) {
  assert(!Object.hasOwn(governance, field), `Governance must not widen authority with ${field}`);
}

console.log("PASS Import Orchestrator governance readiness: ordered self-injection, complete gates, campaign acceptance, compiler-only boundaries, stale/placeholder/incomplete hostile rejection, and digest custody");
