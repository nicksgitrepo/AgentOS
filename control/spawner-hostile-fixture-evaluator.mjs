#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {auditSpawnerAdmissionArtifactsAtUntrustedRoot, assertControllerOperationAuthorized, compileExactSpawnerAdmission, compileOwnershipClassification, compileSpawnerTurnCloseout, resolveCanonicalSpawnerBootstrapPackage, transitionInertSeed} from "./spawner-bootstrap-governance.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";
import {assertProjectAgnosticGovernanceValue} from "./global-governance-memory.mjs";
import {verifyIndependentSpawnerClearance} from "./independent-spawner-clearance.mjs";
import {compileRepositoryCheckpointProof} from "./campaign-lifecycle.mjs";
import {compileSpawnerDefectEnvelope, compileSpawnerRepairReceipt} from "./spawner-defect-repair-loop.mjs";
import {GLOBAL_GOVERNANCE_MEMORY_GENESIS, compileGlobalGovernanceMemoryEvent, compileGlobalGovernanceMemoryReadback, validateGlobalGovernanceMemoryReadback} from "./global-governance-memory.mjs";
import {resolveSpawnerGitAncestry, validateSpawnerGitAncestry} from "./spawner-git-ancestry.mjs";
import {compileAgentSpawnerGovernedAdmission} from "./agent-spawner-governed-admission.mjs";
import {openGlobalGovernanceAuthorityStore} from "./global-governance-bootstrap.mjs";
import {authorizeAgentDespawn} from "./agent-lifecycle-custody.mjs";
import {compileCollaborativeAuditWave} from "./collaborative-audit-workflow.mjs";
import {compileProjectOwnerResponse} from "./project-owner-conversation.mjs";

export const SPAWNER_HOSTILE_EVALUATION_SCHEMA = "agentos.spawner_hostile_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, "specialist-blocks/control-plane/agent-spawner");
const NOW = "2026-08-18T08:30:00.000Z";
function typedRejection(code, message) { const error = new Error(message); error.code = code; throw error; }

function mutateJson(file, mutate) { const value = JSON.parse(fs.readFileSync(file)); mutate(value); fs.writeFileSync(file, `${JSON.stringify(value)}\n`); }
function copiedAuthority() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hostile-vector-")); fs.mkdirSync(path.join(root, "specialist-blocks/control-plane"), {recursive: true}); fs.cpSync(PACKAGE_ROOT, path.join(root, "specialist-blocks/control-plane/agent-spawner"), {recursive: true}); fs.mkdirSync(path.join(root, "fixtures/model-policy-evidence"), {recursive: true}); fs.cpSync(path.join(ROOT, "fixtures/model-policy-evidence"), path.join(root, "fixtures/model-policy-evidence"), {recursive: true}); return root; }
function auditMutation(mutate) { const root = copiedAuthority(); try { mutate(root); return auditSpawnerAdmissionArtifactsAtUntrustedRoot({authorityRoot: root, observedAtUtc: NOW}); } finally { fs.rmSync(root, {recursive: true, force: true}); } }
function mutateAdmissionManifest(root, mutate) { const file = path.join(root, "specialist-blocks/control-plane/agent-spawner/admission/manifest.json"); mutateJson(file, (value) => { mutate(value); value.manifest_sha256 = canonicalDigest({...value, manifest_sha256: null}); }); }
function mutateGateManifest(root, mutate) { const file = path.join(root, "specialist-blocks/control-plane/agent-spawner/gates/manifest.json"); mutateJson(file, (value) => { mutate(value); value.manifest_sha256 = canonicalDigest({...value, manifest_sha256: null}); }); }
function activePolicy() { const value = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))); value.status = "ACCEPTED_ACTIVE"; value.snapshot_sha256 = canonicalDigest({...value, snapshot_sha256: null}); return value; }
function acceptedGlobalPolicyEvent() {
  return compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: activePolicy(), priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
}

const VECTORS = Object.freeze({
  CALLER_ASSERTED_QA: () => compileExactSpawnerAdmission({requestId: "REQUEST.HOSTILE.CALLER_QA", spawnerPackage: {status: "PASS"}, applicableBlocks: [{status: "PASS"}]}),
  CONTROLLER_ASYNC_SIDE_EFFECT: () => {
    execFileSync(process.execPath, [path.join(ROOT, "tests/verify-agentos-controller.mjs")], {cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024});
    typedRejection("CONTROLLER_ASYNC_OPERATIONAL_DENIAL_PROVED", "applyAndWriteAgentOSControllerEventAsync rejected every forbidden/invalid route before adapter invocation or state change");
  },
  CONTROLLER_DIRECT_SPAWN: () => assertControllerOperationAuthorized("spawnCampaignOrchestrator"),
  CROSS_PROJECT_LEAKAGE: () => assertProjectAgnosticGovernanceValue({safe_label: "%2FUsers%2Fprivate%2Fconsumer-context.json"}),
  DIGEST_ALIAS: () => auditMutation((root) => mutateAdmissionManifest(root, (value) => { value.entries[1].file_sha256 = value.entries[0].file_sha256; })),
  DIRTY_REMOTE_READBACK: () => compileRepositoryCheckpointProof({worktreeId: "WORKTREE.HOSTILE.DIRTY", commit: "a".repeat(40), tree: "b".repeat(40), remoteCommit: "c".repeat(40), remoteTree: "d".repeat(40), clean: false, pushed: true, observedByRole: "AGENT.INDEPENDENT_EVALUATOR", observedBySession: "SESSION.HOSTILE", observedAtUtc: NOW}),
  DUPLICATE_GATE_ID: () => auditMutation((root) => mutateGateManifest(root, (value) => { value.entries[1].gate_id = value.entries[0].gate_id; })),
  FABRICATED_ECONOMICS: () => { const policy = activePolicy(); policy.models[0].input_usd_per_million = 0.00001; policy.snapshot_sha256 = canonicalDigest({...policy, snapshot_sha256: null}); return validateModelPolicySnapshot(policy, {nowUtc: NOW, requireActive: true}); },
  FALSE_PROTECTED_BLOCKER: () => compileOwnershipClassification({defectId: "DEFECT.HOSTILE.FALSE_BLOCKER", defectKind: "FAILED_GATE", affectedLayer: "GLOBAL", withinSpawnerAuthority: true, protectedBoundary: "ROUTINE_TEST_FAILURE", evidenceSha256: "a".repeat(64), observedAtUtc: NOW}),
  FORGED_MANIFEST: () => auditMutation((root) => mutateAdmissionManifest(root, (value) => { value.entries[0].block_id = "AGENTOS.BLOCK.ATTACKER"; })),
  INCOMPLETE_LAYER: () => auditMutation((root) => mutateAdmissionManifest(root, (value) => { value.entries.pop(); })),
  INCONCLUSIVE_QA: () => compileExactSpawnerAdmission({requestId: "REQUEST.HOSTILE.INCONCLUSIVE", applicableBlocks: [{status: "INCONCLUSIVE"}]}),
  INVALID_DIGEST: () => auditMutation((root) => mutateAdmissionManifest(root, (value) => { value.entries[0].file_sha256 = "a".repeat(64); })),
  MISSING_FILE: () => auditMutation((root) => fs.unlinkSync(path.join(root, "specialist-blocks/control-plane/agent-spawner/admission/task.block.json"))),
  MISSING_MODEL_EVIDENCE: () => { const policy = activePolicy(); policy.evidence.pop(); policy.snapshot_sha256 = canonicalDigest({...policy, snapshot_sha256: null}); return validateModelPolicySnapshot(policy, {nowUtc: NOW, requireActive: true}); },
  MODEL_UNAVAILABLE: () => { const policy = activePolicy(); policy.models.forEach((model) => { model.host_available = false; }); policy.snapshot_sha256 = canonicalDigest({...policy, snapshot_sha256: null}); return validateModelPolicySnapshot(policy, {nowUtc: NOW, requireActive: true}); },
  OUT_OF_LANE_MUTATION: () => {
    const defect = compileSpawnerDefectEnvelope({defectId: "DEFECT.HOSTILE.OUT_OF_LANE", defectKind: "INVALID_HANDOFF", owningLayer: "LANE_TASK", withinSpawnerAuthority: false, evidenceSha256: "a".repeat(64), affectedDigests: ["b".repeat(64)], requiredRepair: "Redistribute this protected external lane without mutation.", observedAtUtc: NOW});
    return compileSpawnerRepairReceipt({defect, patchedLayer: "LANE_TASK"});
  },
  PLACEHOLDER_CONTENT: () => auditMutation((root) => { const file = path.join(root, "specialist-blocks/control-plane/agent-spawner/admission/project.block.json"); mutateJson(file, (value) => { value.semantic_content.purpose = "TODO"; }); }),
  SEED_EXECUTION: () => transitionInertSeed({seed_sha256: "a".repeat(64)}, {transition: "EXECUTE_WORK", observedAtUtc: NOW}),
  SELF_ISSUED_CLEARANCE: () => verifyIndependentSpawnerClearance({receiptSha256: "a".repeat(64), authorityRoot: ROOT}),
  STALE_BLOCK: () => auditMutation((root) => { const file = path.join(root, "specialist-blocks/control-plane/agent-spawner/admission/global.block.json"); mutateJson(file, (value) => { value.expires_at_utc = "2026-08-16T00:00:00.000Z"; }); }),
  STALE_MEMORY_READBACK: () => {
    const accepted = acceptedGlobalPolicyEvent();
    const readback = compileGlobalGovernanceMemoryReadback({events: [accepted], historicalActivationReceiptSha256: "c".repeat(64), observedAtUtc: NOW});
    const superseded = compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_SUPERSEDED", writerRole: "GOVERNED_MEMORY_ADAPTER", targetSnapshotSha256: accepted.snapshot.snapshot_sha256, reasonCode: "HOSTILE_STALE_READBACK", priorEventSha256: accepted.event_sha256, observedAtUtc: NOW});
    return validateGlobalGovernanceMemoryReadback(readback, {events: [accepted, superseded]});
  },
  SWAPPED_FILE: () => auditMutation((root) => mutateAdmissionManifest(root, (value) => { [value.entries[0].path, value.entries[1].path] = [value.entries[1].path, value.entries[0].path]; })),
  TURN_WITHOUT_SUCCESSOR: () => compileSpawnerTurnCloseout({turnId: "TURN.HOSTILE.NO_SUCCESSOR", outcome: "NEXT_REPAIR_STARTED"}),
  UNLISTED_MODEL: () => { const policy = activePolicy(); policy.models.push({...policy.models[0], model_id: "attacker-cheap-model"}); policy.snapshot_sha256 = canonicalDigest({...policy, snapshot_sha256: null}); return validateModelPolicySnapshot(policy, {nowUtc: NOW, requireActive: true}); },
  WRONG_GLOBAL_MEMORY_WRITER: () => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "CONTROLLER", snapshot: activePolicy(), priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}),
  AUTHORITY_CHAIN_MISMATCH: () => {
    const receipt = resolveSpawnerGitAncestry({repositoryRoot: ROOT, candidateCommit: "b6d52608984cd330dee52f1068827ccd312ac7b5", authorizedPredecessor: "7da8ea556073ff593bf96e95854efa08240b661b"});
    const omitted = structuredClone(receipt); omitted.direct_parent_commits = [omitted.authorized_predecessor_commit];
    return validateSpawnerGitAncestry(omitted, {repositoryRoot: ROOT});
  },
  AUTHORITY_ROOT_SUBSTITUTION: () => openGlobalGovernanceAuthorityStore({authorityRoot: os.tmpdir(), bootstrapSha256: "a".repeat(64)}),
  EVENT_ID_SUBSTITUTION: () => compileGlobalGovernanceMemoryEvent({eventId: "PROJECT.ACME.123", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: activePolicy(), priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}),
  FIXTURE_INVENTORY_ALIAS: async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "hostile-fixtures.manifest.json")));
    manifest.entries[1].fixture_id = manifest.entries[0].fixture_id;
    manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hostile-alias-"));
    const file = path.join(root, "manifest.json"); fs.writeFileSync(file, JSON.stringify(manifest));
    try { return await evaluateCanonicalSpawnerHostileFixtures({fixtureManifestPath: file}); } finally { fs.rmSync(root, {recursive: true, force: true}); }
  },
  REVIEW_ISSUER_UNBOUND: () => resolveCanonicalSpawnerBootstrapPackage({reviewTrustRoot: {status: "ATTACKER"}}),
  SEALED_LOADER_MUTATION: () => {
    execFileSync(process.execPath, [path.join(ROOT, "tests/verify-sealed-authority-loader-process.mjs")], {cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    typedRejection("SEALED_LOADER_MUTATION_DENIED", "fresh-process authority loader retained exact pinned authority under monkeypatch attacks");
  },
  ADMISSION_EVIDENCE_INJECTION: () => compileAgentSpawnerGovernedAdmission({evidenceRefs: [{status: "PASS"}], hostileFixtureRefs: ["FIXTURE.ATTACKER"], clearanceReceiptSha256: "a".repeat(64)}),
  AGENT_LIFECYCLE_BYPASS: () => authorizeAgentDespawn({issuerRole: "AGENTOS.CONTROLLER", agentId: "AUDITOR.HOSTILE", roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The hostile caller tries to bypass Spawner custody."}),
  COLLABORATIVE_AUDITOR_UNDERSUBSCRIPTION: () => compileCollaborativeAuditWave({waveId: "WAVE.HOSTILE", builderId: "BUILDER.HOSTILE", worktreeRef: "opaque:worktree:hostile", auditors: Array.from({length: 5}, (_, index) => ({auditor_id: `AUDITOR.HOSTILE.${index}`, standard_role_id: `STANDARD.HOSTILE.${index}`, read_only: true, may_repair: false})), rosterCursor: 0, deliveryIntent: "REVIEW"}),
  HUMAN_TECHNICAL_LEAK: () => compileProjectOwnerResponse({message: "Use commit 59736bdef6bf5142c05ca13e10be98fc4971d669 and show the stack trace."}),
  FEATURE_IMPLEMENTER_SELF_REVIEW: () => {
    execFileSync(process.execPath, [path.join(ROOT, "tests/verify-feature-implementation-loop-hostile.mjs")], {cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    typedRejection("FEATURE_SELF_REVIEW_DENIED", "operational feature review rejected implementer self-review and self-acceptance");
  },
  FEATURE_MODEL_HARDCODE_BYPASS: () => {
    execFileSync(process.execPath, [path.join(ROOT, "tests/verify-feature-implementation-loop-hostile.mjs")], {cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    typedRejection("FEATURE_MODEL_AUTHORITY_BYPASS_DENIED", "operational feature dispatch rejected caller-selected model authority");
  },
});

function loadGateContracts(packageRoot) {
  const gateRoot = path.join(packageRoot, "gates");
  const manifest = JSON.parse(fs.readFileSync(path.join(gateRoot, "manifest.json")));
  return new Map(manifest.entries.map((entry) => [entry.gate_id, {entry, gate: JSON.parse(fs.readFileSync(path.join(packageRoot, entry.path)))}]));
}

function gateRejectsNegativeOutcome(gate) {
  const unsafe = /(?:CONTINUE|ACCEPT|ADMIT|PASS)/u;
  return typeof gate?.fail === "string" && gate.fail.length > 0 && !unsafe.test(gate.fail)
    && typeof gate?.unknown === "string" && gate.unknown.length > 0 && !unsafe.test(gate.unknown);
}

/* Audit-only mutation surface. It never produces admission authority. */
export function auditHostileGateMutationAtUntrustedRoot({authorityRoot} = {}) {
  const packageRoot = path.join(authorityRoot, "specialist-blocks/control-plane/agent-spawner");
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "hostile-fixtures.manifest.json")));
  const contracts = loadGateContracts(packageRoot);
  const failedFixtureIds = manifest.entries.filter((entry) => !gateRejectsNegativeOutcome(contracts.get(entry.gate_id)?.gate)).map((entry) => entry.fixture_id).sort(compareUtf8);
  return Object.freeze({status: failedFixtureIds.length === 0 ? "PASS" : "FAIL", failed_fixture_ids: failedFixtureIds, negative_gate_contract_count: contracts.size});
}

export async function evaluateCanonicalSpawnerHostileFixtures({fixtureManifestPath = path.join(PACKAGE_ROOT, "hostile-fixtures.manifest.json")} = {}) {
  const manifest = JSON.parse(fs.readFileSync(fixtureManifestPath));
  if (manifest.manifest_sha256 !== canonicalDigest({...manifest, manifest_sha256: null})) typedRejection("HOSTILE_FIXTURE_MANIFEST_DIGEST_INVALID", "Hostile fixture manifest digest differs");
  const fixtureIds = manifest.entries.map((entry) => entry.fixture_id), fixturePaths = manifest.entries.map((entry) => entry.path), attackVectors = [];
  if (new Set(fixtureIds).size !== fixtureIds.length || new Set(fixturePaths).size !== fixturePaths.length) typedRejection("HOSTILE_FIXTURE_INVENTORY_ALIAS", "Hostile fixture IDs and paths must be one-to-one and unique");
  const gateContracts = loadGateContracts(PACKAGE_ROOT);
  const results = [];
  for (const entry of manifest.entries) {
    const fixturePath = path.join(PACKAGE_ROOT, entry.path.replace(/^fixtures\//u, "fixtures/"));
    const fixtureBytes = fs.readFileSync(fixturePath);
    if (crypto.createHash("sha256").update(fixtureBytes).digest("hex") !== entry.file_sha256) typedRejection("HOSTILE_FIXTURE_FILE_DIGEST_INVALID", `Hostile fixture bytes differ: ${entry.fixture_id}`);
    const fixture = JSON.parse(fixtureBytes);
    if (fixture.fixture_id !== entry.fixture_id || fixture.gate_id !== entry.gate_id || fixture.expected_outcome !== entry.expected_outcome || fixture.input_class !== "HOSTILE_NEGATIVE") typedRejection("HOSTILE_FIXTURE_BINDING_INVALID", `Hostile fixture binding differs: ${entry.fixture_id}`);
    if (typeof fixture.operational_entrypoint !== "string" || !fixture.operational_entrypoint.startsWith("control/") || !Array.isArray(fixture.setup) || !fixture.setup.includes("SEALED_CANONICAL_TEST_AUTHORITY") || fixture.canonical_input?.fixture_id !== fixture.fixture_id || fixture.canonical_input?.vector_ref !== fixture.attack_vector || !Array.isArray(fixture.required_assertions) || !fixture.required_assertions.includes("TYPED_DENIAL") || !fixture.required_assertions.includes("NO_UNAUTHORIZED_STATE_CHANGE") || !Array.isArray(fixture.cleanup) || !fixture.cleanup.includes("VERIFY_NO_SHARED_MUTATION")) typedRejection("HOSTILE_FIXTURE_OPERATIONAL_CONTRACT_INCOMPLETE", `Hostile fixture lacks executable operational setup/assertions: ${entry.fixture_id}`);
    if (attackVectors.includes(fixture.attack_vector)) typedRejection("HOSTILE_FIXTURE_VECTOR_ALIAS", `Hostile attack vector is aliased: ${fixture.attack_vector}`);
    attackVectors.push(fixture.attack_vector);
    const execute = VECTORS[fixture.attack_vector];
    let rejected = false, errorCode = null, errorMessage = null;
    try {
      if (!gateRejectsNegativeOutcome(gateContracts.get(fixture.gate_id)?.gate)) { results.push({fixture_id: fixture.fixture_id, gate_id: fixture.gate_id, attack_vector: fixture.attack_vector, expected_outcome: fixture.expected_outcome, actual_outcome: "ACCEPTED_UNSAFELY", implementation_entrypoint: "control/spawner-hostile-fixture-evaluator.mjs", negative_assertion_count: 0, error_code: "GATE_NEGATIVE_BRANCH_WEAKENED", error_message_sha256: null, result: "FAIL"}); continue; }
      if (typeof execute !== "function") throw Object.assign(new Error("Hostile vector has no executable implementation"), {code: "HOSTILE_VECTOR_UNIMPLEMENTED"});
      await execute(fixture);
    }
    catch (error) { rejected = true; errorCode = error.code ?? error.name; errorMessage = String(error.message); }
    const rejectionEvidenceSha256 = errorMessage === null ? null : canonicalDigest({fixture_id: fixture.fixture_id, attack_vector: fixture.attack_vector, error_code: errorCode, outcome: "REJECT_WITH_TYPED_DEFECT"});
    results.push({fixture_id: fixture.fixture_id, gate_id: fixture.gate_id, attack_vector: fixture.attack_vector, expected_outcome: fixture.expected_outcome, actual_outcome: rejected ? "REJECT_WITH_TYPED_DEFECT" : "ACCEPTED_UNSAFELY", implementation_entrypoint: fixture.operational_entrypoint, negative_assertion_count: rejected ? fixture.required_assertions.length : 0, error_code: errorCode, error_message_sha256: rejectionEvidenceSha256, result: rejected ? "PASS" : "FAIL"});
  }
  results.sort((left, right) => compareUtf8(left.fixture_id, right.fixture_id));
  if (new Set(results.map((entry) => entry.fixture_id)).size !== manifest.entries.length || results.length !== manifest.entries.length) typedRejection("HOSTILE_FIXTURE_EXECUTION_INVENTORY_MISMATCH", "Executed hostile inventory is not exactly one-to-one with the manifest");
  const mutationSensitivity = [...gateContracts.entries()].map(([gateId, {entry, gate}]) => {
    const weakened = {...gate, fail: "CONTINUE_WITHOUT_REJECTION", unknown: "CONTINUE_WITHOUT_REJECTION"};
    const failedFixtureIds = gateRejectsNegativeOutcome(weakened) ? [] : [...entry.hostile_fixture_ids].sort(compareUtf8);
    return {gate_id: gateId, mutation: "NEGATIVE_BRANCHES_REPLACED_WITH_CONTINUE", failed_fixture_ids: failedFixtureIds, failed_fixture_count: failedFixtureIds.length, result: failedFixtureIds.length > 0 ? "PASS" : "FAIL"};
  }).sort((left, right) => compareUtf8(left.gate_id, right.gate_id));
  const evaluation = {schema: SPAWNER_HOSTILE_EVALUATION_SCHEMA, version: 1, candidate_package_file_sha256: null, fixture_manifest_sha256: manifest.manifest_sha256, gate_contracts_sha256: canonicalDigest([...gateContracts.entries()].map(([gateId, {gate}]) => ({gate_id: gateId, gate_sha256: gate.gate_sha256})).sort((left, right) => compareUtf8(left.gate_id, right.gate_id))), result_count: results.length, negative_assertion_count: results.reduce((sum, result) => sum + result.negative_assertion_count, 0), mutation_sensitivity: mutationSensitivity, results, status: results.every((result) => result.result === "PASS") && mutationSensitivity.every((entry) => entry.result === "PASS") ? "PASS" : "FAIL", evaluation_sha256: null};
  evaluation.candidate_package_file_sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(PACKAGE_ROOT, "block.json"))).digest("hex");
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateCanonicalSpawnerHostileFixtures())}\n`);
