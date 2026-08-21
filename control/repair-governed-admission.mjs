#!/usr/bin/env node

/*
 * Sealed admission boundary for the reusable AGENTOS.REPAIR platform role.
 *
 * This module deliberately separates package inspection from admission.  The
 * roster and package are resolved from the sealed AgentOS authority; caller
 * supplied packages, evaluations, projections, clocks, roots, and PASS flags
 * are never accepted.  A candidate can be inspected while it is prepared, but
 * no admission receipt can be produced until an independently signed,
 * candidate-bound review is provisioned and consumed by Spawner.
 */

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {getSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";
import {assertOperationalGlobalGovernanceContext, compileOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {consumeCanonicalRepairExternalReview} from "./repair-external-review-store.mjs";

export const REPAIR_GOVERNED_ADMISSION_SCHEMA = "agentos.repair_governed_admission.v1";
export const REPAIR_GOVERNED_ADMISSION_VERSION = 1;
export const REPAIR_ROLE_ID = "AGENTOS.REPAIR";
export const REPAIR_ROLE_CLASS = "REPAIR";
export const REPAIR_PACKAGE_PATH = "specialist-blocks/wave-07/repair";
export const REPAIR_ADMISSION_STATUS = "PREPARED_INACTIVE";

const SHA = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,191}$/u;
const REVIEW_REF = /^ref:temporary-role-review\/[0-9a-f]{64}$/u;
const OWNER_INTAKE_REF = /^(?:opaque|ref):owner-intake\/[A-Za-z0-9._:-]{1,191}$/u;
const PACKAGE_BINDING = "reusable_agent_roster_registry";
const ACCEPTANCE_BINDING = "reusable_agent_acceptance_ledger_registry";
const EXPECTED_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
const authorities = new WeakMap();
const admittedReceipts = new WeakMap();

function fail(message, code = "REPAIR_GOVERNED_ADMISSION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactOptions(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(Object.keys(value).every((key) => keys.includes(key)), `${label} rejects caller roots, packages, registries, evidence, projections, clocks, PASS flags, and writer authority`, "REPAIR_CALLER_AUTHORITY_FORBIDDEN");
}

function exact(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`);
}

function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be a SHA-256`); }
function gitObject(value, label) { assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object ID`); }
function stableId(value, label) { assert(typeof value === "string" && ID.test(value), `${label} must be a stable identifier`); }
function body(value, field) { return {...structuredClone(value), [field]: null}; }
function fileSha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function git(root, args) {
  try { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); }
  catch (error) { fail(`Repair candidate Git readback failed: ${args.join(" ")}`, "REPAIR_CANDIDATE_GIT_READBACK_REQUIRED"); }
}

function safeTarget(root, relative, label) {
  assert(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).some((part) => part === "" || part === ".."), `${label} path is unsafe`);
  const realRoot = fs.realpathSync.native(root);
  const target = path.resolve(realRoot, relative);
  assert(target.startsWith(`${realRoot}${path.sep}`), `${label} escaped the sealed repository`);
  return target;
}

function readJson(root, relative, label) {
  const target = safeTarget(root, relative, label);
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(target) === target, `${label} is not a canonical regular file`);
  const bytes = fs.readFileSync(target);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "REPAIR_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, relative, file_sha256: fileSha(bytes)});
}

function readBytes(root, relative, label) {
  const target = safeTarget(root, relative, label);
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(target) === target, `${label} is not a canonical regular file`);
  const bytes = fs.readFileSync(target);
  return Object.freeze({relative, file_sha256: fileSha(bytes), bytes});
}

function loadBoundArtifact(authority, bindingId, label) {
  try { return readSealedAuthorityBinding(authority, bindingId).value; }
  catch (error) { error.code ??= "REPAIR_CANONICAL_AUTHORITY_BINDING_REQUIRED"; throw error; }
}

function loadCanonicalRoster(authority) {
  const roster = loadBoundArtifact(authority, PACKAGE_BINDING, "Reusable-agent roster");
  exact(roster, ["schema", "version", "status", "governance_version", "project_agnostic", "source_inventory", "policy", "model_policy", "tiers", "aliases", "entries", "build_queue", "roster_sha256"], "Reusable-agent roster");
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true, "Reusable-agent roster identity differs");
  assert(roster.status === "COMPILED_CANDIDATE" || roster.status === "ACCEPTED", "Reusable-agent roster is not current");
  sha(roster.roster_sha256, "Reusable-agent roster digest");
  assert(roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")), "Reusable-agent roster digest differs");
  const entry = roster.entries.find((candidate) => candidate.stable_agent_id === REPAIR_ROLE_ID);
  assert(entry, "Canonical Repair roster entry is missing", "REPAIR_ROLE_NOT_CANONICAL");
  assert(entry.entry_type === "AGENT_ROLE" && entry.tier === "PLATFORM_AGENTS" && entry.package_path === REPAIR_PACKAGE_PATH, "Canonical Repair roster entry is substituted", "REPAIR_ROLE_BINDING_INVALID");
  assert(entry.build_state === "ACCEPTED_QUALIFIED" && entry.qa_state === "COMPLETE_QA_PASS" && entry.independent_evaluation_state === "INDEPENDENT_PASS_READBACK", "Repair roster entry is not qualified for admission", "REPAIR_QUALIFICATION_REQUIRED");
  return Object.freeze({roster, entry});
}

function loadAcceptanceRecord(authority) {
  const ledger = loadBoundArtifact(authority, ACCEPTANCE_BINDING, "Reusable-agent acceptance ledger");
  exact(ledger, ["schema", "version", "status", "project_agnostic", "provenance", "entries", "ledger_sha256"], "Reusable-agent acceptance ledger");
  assert(ledger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && ledger.version === 1 && ledger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && ledger.project_agnostic === true, "Acceptance ledger identity differs");
  sha(ledger.ledger_sha256, "Acceptance ledger digest");
  assert(ledger.ledger_sha256 === canonicalDigest(body(ledger, "ledger_sha256")), "Acceptance ledger digest differs");
  const record = ledger.entries.find((entry) => entry.stable_agent_id === REPAIR_ROLE_ID);
  assert(record, "Repair acceptance record is missing", "REPAIR_INDEPENDENT_CLEARANCE_REQUIRED");
  exact(record, ["stable_agent_id", "package_path", "candidate_commit", "candidate_tree", "independent_status", "receipt_ref", "receipt_sha256", "readback_scope"], "Repair acceptance record");
  assert(record.package_path === REPAIR_PACKAGE_PATH && record.independent_status === "PASS" && record.readback_scope === "READBACK_SUMMARY_ONLY", "Repair acceptance record is not a current independent readback", "REPAIR_INDEPENDENT_CLEARANCE_REQUIRED");
  return Object.freeze({ledger, record});
}

function inspectPackage(root, entry) {
  const packageRoot = safeTarget(root, REPAIR_PACKAGE_PATH, "Repair package");
  const packageStat = fs.lstatSync(packageRoot);
  assert(packageStat.isDirectory() && !packageStat.isSymbolicLink() && fs.realpathSync.native(packageRoot) === packageRoot, "Repair package directory is not canonical");
  const blockArtifact = readJson(root, `${REPAIR_PACKAGE_PATH}/block.json`, "Repair block");
  const block = blockArtifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === "specialist.control.repair", "Repair block identity differs");
  assert(block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Repair package crossed activation boundary", "REPAIR_PACKAGE_ACTIVE");
  sha(block.block_sha256, "Repair block digest");
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), "Repair block digest differs", "REPAIR_PACKAGE_DIGEST_INVALID");
  assert(entry.canonical_block_id === block.block_id, "Roster and Repair block IDs differ", "REPAIR_ROLE_BINDING_INVALID");
  const source = readJson(root, `${REPAIR_PACKAGE_PATH}/sources.lock`, "Repair source lock");
  const gatesManifest = readJson(root, `${REPAIR_PACKAGE_PATH}/gates/manifest.json`, "Repair gate manifest");
  const gateIds = gatesManifest.value.ordered_gate_ids;
  assert(Array.isArray(gateIds) && JSON.stringify(gateIds) === JSON.stringify(EXPECTED_GATE_IDS), "Repair gate inventory is incomplete or reordered", "REPAIR_GATE_INVENTORY_INVALID");
  const gatePaths = gatesManifest.value.gate_paths;
  assert(Array.isArray(gatePaths) && JSON.stringify(gatePaths) === JSON.stringify(EXPECTED_GATE_IDS.map((id) => `gates/${id}.gate`)), "Repair gate paths differ", "REPAIR_GATE_INVENTORY_INVALID");
  const gates = gateIds.map((gateId, index) => {
    const artifact = readJson(root, `${REPAIR_PACKAGE_PATH}/${gatePaths[index]}`, `Repair gate ${gateId}`);
    assert(artifact.value.gate_id === gateId && artifact.value.block_id === block.block_id && artifact.value.status === "EXECUTABLE", `Repair gate ${gateId} is not executable`, "REPAIR_GATE_INVALID");
    sha(artifact.value.gate_sha256, `Repair gate ${gateId} digest`);
    assert(artifact.value.gate_sha256 === canonicalDigest(body(artifact.value, "gate_sha256")), `Repair gate ${gateId} digest differs`, "REPAIR_GATE_DIGEST_INVALID");
    return Object.freeze({gate_id: gateId, path: artifact.relative, file_sha256: artifact.file_sha256, gate_sha256: artifact.value.gate_sha256});
  });
  const fixtureDirectory = safeTarget(root, `${REPAIR_PACKAGE_PATH}/fixtures`, "Repair hostile fixture directory");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === 19 && new Set(fixtureNames).size === 19, "Repair hostile fixture inventory is incomplete or aliased", "REPAIR_FIXTURE_INVENTORY_INVALID");
  const fixtures = fixtureNames.map((name) => {
    const artifact = readJson(root, `${REPAIR_PACKAGE_PATH}/fixtures/${name}`, `Repair hostile fixture ${name}`);
    const fixture = artifact.value;
    assert(fixture.schema === "agentos.repair_fixture.v1" && fixture.block_id === block.block_id && typeof fixture.fixture_id === "string" && fixture.vector?.entrypoint, `Repair hostile fixture ${name} is not operational`, "REPAIR_FIXTURE_INVALID");
    assert(fixture.vector.expected_readback && typeof fixture.vector.expected_readback === "object", `Repair hostile fixture ${name} lacks expected readback`, "REPAIR_FIXTURE_INVALID");
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, path: artifact.relative, file_sha256: artifact.file_sha256, entrypoint: fixture.vector.entrypoint, expected: fixture.vector.expected_readback.disposition, expected_readback_sha256: canonicalDigest(fixture.vector.expected_readback)});
  });
  assert(new Set(fixtures.map((fixture) => fixture.fixture_id)).size === 19 && new Set(fixtures.map((fixture) => fixture.class)).size === 19, "Repair hostile fixture identities are aliased", "REPAIR_FIXTURE_INVENTORY_INVALID");
  const evaluation = readJson(root, `${REPAIR_PACKAGE_PATH}/evaluation.json`, "Repair evaluation");
  const handoff = readJson(root, `${REPAIR_PACKAGE_PATH}/handoff.json`, "Repair handoff");
  const seed = readJson(root, `${REPAIR_PACKAGE_PATH}/seed.json`, "Repair inert seed");
  assert(seed.value.schema === "agentos.repair_inert_seed.v1" && seed.value.status === "VERIFIED_INERT" && seed.value.activation === "OFF" && seed.value.immutable === true && seed.value.performs_work === false && seed.value.can_spawn === false && seed.value.can_write === false && seed.value.can_deploy === false && seed.value.admission === "NOT_ADMITTED", "Repair seed is not an inert unadmitted checkpoint", "REPAIR_SEED_INVALID");
  sha(seed.value.seed_sha256, "Repair seed digest");
  assert(seed.value.seed_sha256 === canonicalDigest(body(seed.value, "seed_sha256")), "Repair seed digest differs", "REPAIR_SEED_DIGEST_INVALID");
  const candidateRoot = canonicalDigest({role_id: REPAIR_ROLE_ID, package_path: REPAIR_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_file_sha256: source.file_sha256, gate_manifest_sha256: gatesManifest.value.manifest_sha256, gate_manifest_file_sha256: gatesManifest.file_sha256, gates, fixtures, evaluation_file_sha256: evaluation.file_sha256, handoff_file_sha256: handoff.file_sha256, seed_file_sha256: seed.file_sha256});
  return Object.freeze({role_id: REPAIR_ROLE_ID, role_class: REPAIR_ROLE_CLASS, package_path: REPAIR_PACKAGE_PATH, candidate_root_sha256: candidateRoot, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_file_sha256: source.file_sha256, gate_inventory_sha256: canonicalDigest(gates), fixture_inventory_sha256: canonicalDigest(fixtures), gates, fixtures, evaluation_file_sha256: evaluation.file_sha256, handoff_file_sha256: handoff.file_sha256, seed_file_sha256: seed.file_sha256, seed_sha256: seed.value.seed_sha256});
}

export function inspectCanonicalRepairCandidate(options = {}) {
  exactOptions(options, [], "Repair candidate inspection");
  const authority = getSealedCanonicalAuthority();
  const {entry} = loadCanonicalRoster(authority);
  const acceptance = loadAcceptanceRecord(authority);
  const root = sealedAuthorityRepositoryRoot(authority);
  const candidate = inspectPackage(root, entry);
  const candidateCommit = git(root, ["rev-parse", "HEAD"]);
  const candidateTree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  gitObject(candidateCommit, "Repair candidate commit");
  gitObject(candidateTree, "Repair candidate tree");
  return Object.freeze({schema: "agentos.repair_candidate_readback.v1", version: 1, status: REPAIR_ADMISSION_STATUS, candidate, acceptance_record: Object.freeze({...acceptance.record}), accepted_predecessor_commit: acceptance.record.candidate_commit, accepted_predecessor_tree: acceptance.record.candidate_tree, candidate_commit: candidateCommit, candidate_tree: candidateTree, repository_clean: status.length === 0, roster_sha256: null, package_qualified: true, independent_clearance_available: false});
}

export function prepareRepairAdmissionAuthority(options = {}) {
  exactOptions(options, ["globalGovernanceAuthorityStore"], "Repair admission authority preparation");
  const {globalGovernanceAuthorityStore} = options;
  if (!globalGovernanceAuthorityStore || typeof globalGovernanceAuthorityStore !== "object" || Array.isArray(globalGovernanceAuthorityStore)) fail("Repair admission requires a governed global-memory store", "REPAIR_GLOBAL_GOVERNANCE_REQUIRED");
  const authority = getSealedCanonicalAuthority();
  const candidate = inspectCanonicalRepairCandidate();
  const context = compileOperationalGlobalGovernanceContext({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT", operationalId: "CONTEXT.AGENTOS_REPAIR.INTAKE"});
  assertOperationalGlobalGovernanceContext(context, {authorityStore: globalGovernanceAuthorityStore, expectedRoleClass: "WORKING_AGENT"});
  assert(context.compact_selection?.model_id && context.compact_selection?.reasoning_effort, "Repair model route is not currently selected", "REPAIR_MODEL_ROUTE_REQUIRED");
  const capability = Object.freeze(Object.create(null));
  authorities.set(capability, Object.freeze({
    authority,
    candidate,
    candidate_root_sha256: candidate.candidate.candidate_root_sha256,
    candidate_commit: candidate.candidate_commit,
    candidate_tree: candidate.candidate_tree,
    context,
    globalGovernanceAuthorityStore,
  }));
  return capability;
}

export function resolveRepairAdmission(options = {}) {
  exactOptions(options, ["authority", "admissionReceiptRef", "requestId", "ownerIntakeRef"], "Repair admission resolution");
  const {authority, admissionReceiptRef, requestId, ownerIntakeRef} = options;
  const state = authorities.get(authority);
  assert(state, "Repair admission requires an opaque sealed capability", "REPAIR_ADMISSION_AUTHORITY_REQUIRED");
  stableId(requestId, "Repair admission request");
  assert(typeof ownerIntakeRef === "string" && OWNER_INTAKE_REF.test(ownerIntakeRef), "Repair owner-intake reference is invalid", "REPAIR_OWNER_INTAKE_REF_INVALID");
  assert(typeof admissionReceiptRef === "string" && REVIEW_REF.test(admissionReceiptRef), "Repair admission receipt reference is invalid", "REPAIR_ADMISSION_RECEIPT_INVALID");
  const current = inspectCanonicalRepairCandidate();
  assert(current.repository_clean === true, "Repair candidate must be frozen in a clean committed tree", "REPAIR_CANDIDATE_NOT_FROZEN");
  assert(current.candidate.candidate_root_sha256 === state.candidate_root_sha256 && current.candidate_commit === state.candidate_commit && current.candidate_tree === state.candidate_tree, "Repair candidate changed; rebuild admission authority", "REPAIR_CANDIDATE_STALE");
  const candidate = Object.freeze({...current.candidate, candidate_commit: current.candidate_commit, candidate_tree: current.candidate_tree});
  const external = consumeCanonicalRepairExternalReview({sealedAuthority: state.authority, candidate, operationalContext: state.context, receiptRef: admissionReceiptRef});
  const receiptBody = {
    schema: REPAIR_GOVERNED_ADMISSION_SCHEMA,
    version: REPAIR_GOVERNED_ADMISSION_VERSION,
    status: "ADMITTED_ONE_USE",
    role_id: REPAIR_ROLE_ID,
    role_class: REPAIR_ROLE_CLASS,
    candidate_root_sha256: candidate.candidate_root_sha256,
    candidate_commit: candidate.candidate_commit,
    candidate_tree: candidate.candidate_tree,
    package_block_sha256: candidate.block_sha256,
    package_gate_inventory_sha256: candidate.gate_inventory_sha256,
    package_fixture_inventory_sha256: candidate.fixture_inventory_sha256,
    model_snapshot_sha256: state.context.snapshot_sha256,
    model_selection_sha256: canonicalDigest(state.context.compact_selection),
    global_context_sha256: state.context.context_sha256,
    owner_intake_ref: ownerIntakeRef,
    request_id: requestId,
    evaluator_id: external.evaluator_id,
    evaluator_admission_sha256: external.evaluator_admission_sha256,
    review_sha256: external.review_sha256,
    clearance_sha256: external.clearance_sha256,
    consumption_event_sha256: external.consumption_event_sha256,
    custody: "SEALED_SPAWNER_AND_SEPARATE_EXTERNAL_EVALUATOR",
    receipt_ref: admissionReceiptRef,
    receipt_sha256: null,
  };
  receiptBody.receipt_sha256 = canonicalDigest(receiptBody);
  const receipt = Object.freeze(receiptBody);
  admittedReceipts.set(receipt, Object.freeze({authority: state.authority, candidate, context: state.context, external}));
  return receipt;
}

export function assertRepairAdmissionReceipt(receipt, expectedAuthority) {
  const state = admittedReceipts.get(receipt);
  assert(state, "Shaped Repair admission objects are non-authoritative; resolve a canonical receipt reference", "REPAIR_SHAPED_RECEIPT_FORBIDDEN");
  if (expectedAuthority !== undefined) assert(state.authority === expectedAuthority, "Repair admission belongs to another sealed authority", "REPAIR_ADMISSION_AUTHORITY_MISMATCH");
  exact(receipt, ["schema", "version", "status", "role_id", "role_class", "candidate_root_sha256", "candidate_commit", "candidate_tree", "package_block_sha256", "package_gate_inventory_sha256", "package_fixture_inventory_sha256", "model_snapshot_sha256", "model_selection_sha256", "global_context_sha256", "owner_intake_ref", "request_id", "evaluator_id", "evaluator_admission_sha256", "review_sha256", "clearance_sha256", "consumption_event_sha256", "custody", "receipt_ref", "receipt_sha256"], "Repair admission receipt");
  assert(receipt.status === "ADMITTED_ONE_USE" && receipt.role_id === REPAIR_ROLE_ID && receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "Repair admission receipt digest or status is invalid", "REPAIR_ADMISSION_RECEIPT_INVALID");
  return state;
}
