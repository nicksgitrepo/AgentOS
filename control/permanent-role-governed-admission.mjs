#!/usr/bin/env node

/* Canonical permanent-role candidate resolver and fail-closed admission bridge. */

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {assertOperationalGlobalGovernanceContext, compileAllOperationalGlobalGovernanceContexts} from "./global-governance-operational-context.mjs";
import {loadCanonicalPermanentRoleRegistry, resolveCanonicalPermanentRole} from "./permanent-role-registry.mjs";
import {getSealedCanonicalAuthority, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";
import {validateGatePack, validateSourceLock, validateSpecialistBlock} from "./specialist-block-compiler.mjs";
import {consumeProvisionedPermanentRoleReview} from "./permanent-role-external-review-store.mjs";

export const PERMANENT_ROLE_GOVERNED_ADMISSION_SCHEMA = "agentos.permanent_role_governed_admission.v1";
export const PERMANENT_ROLE_ADMISSION_STATUS = "PREPARED_INACTIVE";
const SHA = /^[0-9a-f]{64}$/u;
const REF = /^(?:ref|opaque):[^\s]{1,512}$/u;
const authorities = new WeakMap();
const EXPECTED_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);

function fail(message, code = "PERMANENT_ROLE_ADMISSION_INVALID", details = null) {
  const error = new Error(message); error.code = code; if (details !== null) error.details = details; throw error;
}
function assert(value, message, code, details) { if (!value) fail(message, code, details); }
function exactOptions(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(Object.keys(value).every((key) => keys.includes(key)), `${label} rejects caller roots, paths, registries, packages, PASS claims, evidence arrays, projections, clocks, and writer authority`, "PERMANENT_ROLE_CALLER_AUTHORITY_FORBIDDEN");
}
function readJsonFile(root, relative, label) {
  assert(typeof relative === "string" && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).some((part) => part === "" || part === ".."), `${label} path is unsafe`);
  const target = path.resolve(root, relative), realRoot = fs.realpathSync(root);
  assert(target.startsWith(`${realRoot}${path.sep}`), `${label} escaped the sealed repository`);
  const stat = fs.lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink(), `${label} is not a real file`);
  const bytes = fs.readFileSync(target); return {value: JSON.parse(bytes.toString("utf8")), bytes_sha256: createHash("sha256").update(bytes).digest("hex"), relative_path: relative};
}
function readByteFile(root, relative, label) {
  assert(typeof relative === "string" && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).some((part) => part === "" || part === ".."), `${label} path is unsafe`);
  const target = path.resolve(root, relative), realRoot = fs.realpathSync(root);
  assert(target.startsWith(`${realRoot}${path.sep}`), `${label} escaped the sealed repository`);
  const stat = fs.lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink(), `${label} is not a real file`);
  return {bytes_sha256: createHash("sha256").update(fs.readFileSync(target)).digest("hex"), relative_path: relative};
}
function exactSorted(values, expected, label) {
  assert(Array.isArray(values) && JSON.stringify(values) === JSON.stringify(expected), `${label} differs from the canonical exact inventory`);
  assert(new Set(values).size === values.length, `${label} contains duplicate identities`);
}
function digestBody(record, field) { return {...structuredClone(record), [field]: null}; }

export function inspectCanonicalPermanentRoleCandidate({roleId} = {}) {
  assert(typeof roleId === "string", "Permanent role identity is required");
  const role = resolveCanonicalPermanentRole(roleId), repositoryRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  const packageRelative = role.package_path, packageRoot = path.resolve(repositoryRoot, packageRelative);
  assert(packageRoot.startsWith(`${repositoryRoot}${path.sep}`), "Permanent role package escaped the sealed repository");
  const stat = fs.lstatSync(packageRoot); assert(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(packageRoot) === packageRoot, "Permanent role package is not a canonical real directory");
  const blockArtifact = readJsonFile(repositoryRoot, `${packageRelative}/block.json`, "Permanent role block");
  const block = validateSpecialistBlock(blockArtifact.value);
  const sourceArtifact = readJsonFile(repositoryRoot, `${packageRelative}/sources.lock`, "Permanent role source lock"); validateSourceLock(sourceArtifact.value, block.block_id);
  const manifestArtifact = readJsonFile(repositoryRoot, `${packageRelative}/gates/manifest.json`, "Permanent role gate manifest");
  const gateManifest = validateGatePack(packageRoot, block);
  exactSorted(gateManifest.ordered_gate_ids, EXPECTED_GATE_IDS, "Permanent role gate IDs");
  exactSorted(gateManifest.gate_paths, EXPECTED_GATE_IDS.map((id) => `gates/${id}.gate`), "Permanent role gate paths");
  const gateArtifacts = EXPECTED_GATE_IDS.map((gateId) => {
    const artifact = readJsonFile(repositoryRoot, `${packageRelative}/gates/${gateId}.gate`, `Permanent role gate ${gateId}`), gate = artifact.value;
    assert(gate.gate_id === gateId && gate.block_id === block.block_id && gate.status === "EXECUTABLE", `Permanent role gate ${gateId} identity/status differs`);
    assert(SHA.test(gate.gate_sha256) && gate.gate_sha256 === canonicalDigest(digestBody(gate, "gate_sha256")), `Permanent role gate ${gateId} digest differs`);
    return Object.freeze({gate_id: gateId, path: artifact.relative_path, file_sha256: artifact.bytes_sha256, gate_sha256: gate.gate_sha256});
  });
  const fixtureDirectory = path.join(packageRoot, "fixtures"), fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === 17 && new Set(fixtureNames).size === 17, "Permanent role hostile fixture inventory must contain 17 unique files");
  const fixtureArtifacts = fixtureNames.map((name) => {
    const artifact = readJsonFile(repositoryRoot, `${packageRelative}/fixtures/${name}`, `Permanent role fixture ${name}`), fixture = artifact.value;
    assert(fixture.block_id === block.block_id && fixture.hostile === true && typeof fixture.class === "string" && typeof fixture.expected === "string", `Permanent role fixture ${name} identity differs`);
    const productOwnerVector = role.role_id === "AGENTOS.PRODUCT_OWNER" && fixture.vector?.entrypoint === "evaluateProductOwnerBoundary" && fixture.vector.expected_readback?.all_side_effect_counts === 0;
    const legacyVector = typeof fixture.vector?.entrypoint === "string" && Array.isArray(fixture.vector.assertions) && fixture.vector.assertions.length >= 3;
    assert(fixture.vector?.input && typeof fixture.vector.input === "object" && (productOwnerVector || legacyVector), `Permanent role fixture ${name} is not an executable operational vector`);
    const expectedEvidence = productOwnerVector
      ? fixture.vector.expected_readback
      : fixture.vector.assertions;
    return Object.freeze({fixture_id: fixture.fixture_id ?? `${block.block_id}.${fixture.class}`, fixture_class: fixture.class, path: artifact.relative_path, file_sha256: artifact.bytes_sha256, expected: fixture.expected, entrypoint: fixture.vector.entrypoint, assertions_sha256: canonicalDigest(expectedEvidence)});
  });
  assert(new Set(fixtureArtifacts.map((entry) => entry.fixture_id)).size === 17 && new Set(fixtureArtifacts.map((entry) => entry.fixture_class)).size === 17, "Permanent role hostile fixture identities/classes are aliased");
  const evaluationArtifact = readJsonFile(repositoryRoot, `${packageRelative}/evaluation.json`, "Permanent role evaluation");
  const evaluation = evaluationArtifact.value;
  assert(evaluation.block_id === block.block_id && evaluation.candidate_digest === block.block_sha256, "Permanent role evaluation candidate binding differs");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === 17 && new Set(evaluation.cases.map((entry) => entry.case_id)).size === 17, "Permanent role evaluation case inventory differs");
  assert(JSON.stringify([...evaluation.cases.map((entry) => entry.class)].sort(compareUtf8)) === JSON.stringify([...fixtureArtifacts.map((entry) => entry.fixture_class)].sort(compareUtf8)), "Permanent role evaluation/fixture coverage differs");
  const passed = evaluation.disposition === "PASS" && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.cases.every((entry) => entry.observed === "PASS");
  const implementationArtifacts = role.role_id === "AGENTOS.PRODUCT_OWNER" ? [readByteFile(repositoryRoot, "control/product-owner-boundary-gate.mjs", "Product Owner boundary implementation"), readByteFile(repositoryRoot, "control/product-owner-operational.mjs", "Product Owner operational adapter")].map((artifact) => ({path: artifact.relative_path, file_sha256: artifact.bytes_sha256})) : [];
  const candidateRootSha256 = canonicalDigest({role, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.bytes_sha256, source_file_sha256: sourceArtifact.bytes_sha256, gate_manifest_sha256: gateManifest.manifest_sha256, gate_manifest_file_sha256: manifestArtifact.bytes_sha256, gates: gateArtifacts, fixtures: fixtureArtifacts, implementation_artifacts: implementationArtifacts, evaluation_file_sha256: evaluationArtifact.bytes_sha256});
  return Object.freeze({schema: "agentos.permanent_role_candidate_readback.v1", version: 1, status: passed ? "EXECUTED_REVIEW_REQUIRED" : "PREPARED_INACTIVE", role: Object.freeze(role), block_id: block.block_id, block_sha256: block.block_sha256, candidate_root_sha256: candidateRootSha256, gate_count: 12, fixture_count: 17, gates: Object.freeze(gateArtifacts), fixtures: Object.freeze(fixtureArtifacts), implementation_artifacts: Object.freeze(implementationArtifacts), evaluation_status: evaluation.disposition, executed_fixture_results_complete: passed});
}

export function preparePermanentRoleAdmissionAuthority(options = {}) {
  exactOptions(options, ["globalGovernanceAuthorityStore"], "Permanent-role admission authority preparation");
  const {globalGovernanceAuthorityStore} = options;
  const operationalContexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: globalGovernanceAuthorityStore});
  const contextByRoleId = new Map();
  for (const roleId of loadCanonicalPermanentRoleRegistry().canonical_order) {
    const role = resolveCanonicalPermanentRole(roleId), context = operationalContexts[role.role_class];
    assertOperationalGlobalGovernanceContext(context, {authorityStore: globalGovernanceAuthorityStore, expectedRoleClass: role.role_class});
    assert(context.compact_selection && typeof context.compact_selection.model_id === "string" && typeof context.compact_selection.reasoning_effort === "string", `${roleId} lacks a current selected host model route`);
    contextByRoleId.set(roleId, context);
  }
  const capability = Object.freeze(Object.create(null));
  authorities.set(capability, Object.freeze({globalGovernanceAuthorityStore, contextByRoleId})); return capability;
}

export function resolvePermanentRoleOperationalContext(options = {}) {
  exactOptions(options, ["authority", "expectedRoleId"], "Permanent-role operational-context resolution");
  const {authority, expectedRoleId} = options, state = authorities.get(authority);
  assert(state, "Permanent-role operational context requires an opaque sealed authority", "PERMANENT_ROLE_ADMISSION_AUTHORITY_REQUIRED");
  const role = resolveCanonicalPermanentRole(expectedRoleId), context = state.contextByRoleId.get(role.role_id);
  assertOperationalGlobalGovernanceContext(context, {authorityStore: state.globalGovernanceAuthorityStore, expectedRoleClass: role.role_class});
  return context;
}

export function resolvePermanentRoleAdmission(options = {}) {
  exactOptions(options, ["authority", "receiptRef", "expectedRoleId"], "Permanent-role admission resolution");
  const {authority, receiptRef, expectedRoleId} = options, state = authorities.get(authority);
  assert(state, "Permanent-role admission requires an opaque sealed authority", "PERMANENT_ROLE_ADMISSION_AUTHORITY_REQUIRED");
  assert(typeof receiptRef === "string" && REF.test(receiptRef), "Permanent-role admission receipt reference is invalid");
  const role = resolveCanonicalPermanentRole(expectedRoleId), context = state.contextByRoleId.get(expectedRoleId);
  assertOperationalGlobalGovernanceContext(context, {authorityStore: state.globalGovernanceAuthorityStore, expectedRoleClass: role.role_class});
  const candidate = inspectCanonicalPermanentRoleCandidate({roleId: expectedRoleId});
  return consumeProvisionedPermanentRoleReview({receiptRef, role, candidate, operationalContext: context});
}

export function assertPermanentRoleAdmissionReceipt() {
  fail("Standalone shaped permanent-role receipts are non-authoritative; resolve a canonical receipt reference", "PERMANENT_ROLE_SHAPED_RECEIPT_FORBIDDEN");
}
