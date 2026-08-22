#!/usr/bin/env node

/* Repository-bound React Component Runtime authority; host paths are runtime-only. */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateSoftwareLanguageRuntimeRouterBoundary} from "./software-language-runtime-router-boundary-gate.mjs";

export const REACT_COMPONENTS_PACKAGE_PATH = "specialist-blocks/wave-02/react-components";
export const REACT_COMPONENTS_BLOCK_ID = "specialist.software-language-runtime.react-components";
export const REACT_COMPONENTS_AGENT_ID = "AGENT.SOFTWARE_LANGUAGE_RUNTIME_REACT_COMPONENTS";
export const REACT_COMPONENTS_STANDARD_BLOCK_ID = "specialist.standard.react-19-2";
export const REACT_COMPONENTS_STANDARD_SOURCE_ID = "source.react-19-2";
export const REACT_COMPONENTS_SOURCE_ID = "source.atomic-specialization-law";
export const REACT_COMPONENTS_CUSTODY_REF = "opaque:REACT.COMPONENTS.CUSTODY";
export const REACT_COMPONENTS_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const REACT_COMPONENTS_MODEL_FILE_SHA256 = "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d";
export const REACT_COMPONENTS_MEMORY_BINDING = "TYPED_CONTEXT_INVALIDATION_V1";
export const REACT_COMPONENTS_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness",
  "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const REACT_COMPONENTS_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority",
  "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion",
  "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, REACT_COMPONENTS_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const FILE_SHA256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fail(message, code = "REACT_COMPONENTS_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "REACT_COMPONENTS_CANONICAL_DIGEST_INVALID"); }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "REACT_COMPONENTS_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "REACT_COMPONENTS_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "REACT_COMPONENTS_CANONICAL_ARTIFACT_INVALID"); }
  return {value, file_sha256: FILE_SHA256(file)};
}
function checkSelfDigest(value, field, label) {
  sha(value[field], `${label}.${field}`);
  assert(value[field] === canonicalDigest({...value, [field]: null}), `${label}.${field} does not match its bytes`, "REACT_COMPONENTS_CANONICAL_DIGEST_INVALID");
}
function packageFiles() {
  const names = ["block.json", "sources.lock", "hostile-fixtures.manifest.json", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"];
  const gates = fs.readdirSync(path.join(PACKAGE_ROOT, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`);
  const fixtures = fs.readdirSync(path.join(PACKAGE_ROOT, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`);
  return [...new Set([...names, ...gates, ...fixtures])].sort(compareUtf8);
}
function canonicalRouterInput() {
  return {
    schema: "agentos.software_language_runtime_router_boundary_input.v1", version: 1, request_kind: "CLASSIFY_LANGUAGE_RUNTIME_SIGNAL", evidence: {
      authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SOFTWARE_LANGUAGE_RUNTIME_ROUTER", custody_ref: "opaque:SOFTWARE.LANGUAGE.RUNTIME.ROUTER.CUSTODY",
      source_status: "CURRENT", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", runtime_surface: "WEB", signal: "REACT",
      target_ref: REACT_COMPONENTS_BLOCK_ID, context_complete: true, scope: "NARROW", requested_action: "CLASSIFY", requested_tools: ["READ_SOURCE", "READ_CONTEXT"],
      self_acceptance: false, scope_expanded: false, authority_conflict: false, project_data_present: false, secret_data_present: false, runtime_evidence: "BOUNDED",
    },
  };
}
function canonicalContext({blockSha, sourceManifestSha, standardBlockSha, standardSourceManifestSha, routerFileSha, routerResultSha, modelSnapshotSha}) {
  return {
    block_sha256: blockSha, source_manifest_sha256: sourceManifestSha, standard_block_sha256: standardBlockSha,
    standard_source_manifest_sha256: standardSourceManifestSha, authority_scope: "REACT_COMPONENTS", scope: "NARROW", custody_ref: REACT_COMPONENTS_CUSTODY_REF,
    operation_identity: "OPERATION.REACT_COMPONENTS", operation_version: "1", router_file_sha256: routerFileSha, router_result_sha256: routerResultSha,
    model_snapshot_sha256: modelSnapshotSha, memory_binding: REACT_COMPONENTS_MEMORY_BINDING, lifecycle_revision: "1.0.0",
  };
}
export function reactComponentsContextReceiptSha256(values) { return canonicalDigest(canonicalContext(values)); }
function checkSourceManifest(artifact, expectedBlockId, label) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === expectedBlockId, `${label} identity differs`, "REACT_COMPONENTS_SOURCE_LOCK_INVALID");
  checkSelfDigest(source, "manifest_sha256", label); return source;
}
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === expectedId && block.lifecycle === "CANDIDATE" && block.activation === "OFF", `${label} identity differs`, "REACT_COMPONENTS_CANONICAL_BINDING_INVALID");
  checkSelfDigest(block, "block_sha256", label); return block;
}
function checkGateArtifacts(manifestArtifact, executionArtifact) {
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === REACT_COMPONENTS_BLOCK_ID, "React gate manifest identity differs", "REACT_COMPONENTS_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(REACT_COMPONENTS_GATE_IDS), "React gate order differs", "REACT_COMPONENTS_GATE_ORDER_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(REACT_COMPONENTS_GATE_IDS.map((id) => `gates/${id}.gate`)), "React gate paths differ", "REACT_COMPONENTS_GATE_PATH_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "React gate outcomes differ", "REACT_COMPONENTS_GATE_OUTCOME_INVALID");
  checkSelfDigest(manifest, "manifest_sha256", "React gate manifest");
  for (const [index, id] of REACT_COMPONENTS_GATE_IDS.entries()) {
    const gate = readJson(path.join(PACKAGE_ROOT, "gates", `${id}.gate`), `React gate ${id}`).value;
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === id && gate.block_id === REACT_COMPONENTS_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `React gate ${id} is not executable`, "REACT_COMPONENTS_GATE_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(manifest.outcomes), `React gate ${id} outcomes differ`, "REACT_COMPONENTS_GATE_OUTCOME_INVALID");
    assert(gate.next?.YES === (index === REACT_COMPONENTS_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : REACT_COMPONENTS_GATE_IDS[index + 1]), `React gate ${id} YES branch differs`, "REACT_COMPONENTS_GATE_BRANCH_INVALID");
    assert(gate.next?.NO === "OUTCOME:DENY" && gate.next?.UNKNOWN === "OUTCOME:UNKNOWN_DEPENDENT_ONLY" && gate.next?.NOT_APPLICABLE === (index === REACT_COMPONENTS_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : REACT_COMPONENTS_GATE_IDS[index + 1]), `React gate ${id} terminal branches differ`, "REACT_COMPONENTS_GATE_BRANCH_INVALID");
    checkSelfDigest(gate, "gate_sha256", `React gate ${id}`);
  }
  const execution = executionArtifact.value;
  assert(execution.schema === "agentos.react_components_gate_execution.v1" && execution.version === 1 && execution.block_id === REACT_COMPONENTS_BLOCK_ID, "React gate execution identity differs", "REACT_COMPONENTS_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/react-components-package-evaluator.mjs#evaluateReactComponentsPackage", "React gate execution evaluator is not canonical", "REACT_COMPONENTS_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(REACT_COMPONENTS_GATE_IDS) && Array.isArray(execution.executions) && execution.executions.length === REACT_COMPONENTS_GATE_IDS.length, "React gate execution order is incomplete", "REACT_COMPONENTS_GATE_EXECUTION_INVALID");
  checkSelfDigest(execution, "execution_sha256", "React gate execution");
  return {manifest, manifest_file_sha256: manifestArtifact.file_sha256, execution, execution_file_sha256: executionArtifact.file_sha256};
}
function checkFixtures() {
  const directory = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === REACT_COMPONENTS_FIXTURE_CLASSES.length, "React fixture inventory is not exact", "REACT_COMPONENTS_FIXTURE_INVENTORY_INVALID");
  const records = [];
  for (const name of names) {
    const artifact = readJson(path.join(directory, name), `React fixture ${name}`); const fixture = artifact.value;
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === REACT_COMPONENTS_BLOCK_ID && fixture.hostile === true, `React fixture ${name} identity is invalid`, "REACT_COMPONENTS_FIXTURE_ID_INVALID");
    assert(REACT_COMPONENTS_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `react-components-${fixture.class}`, `React fixture ${name} class is invalid`, "REACT_COMPONENTS_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === "control/react-components-boundary-gate.mjs#evaluateReactComponentsBoundary" && fixture.vector.input?.schema === "agentos.react_components_boundary_input.v1", `React fixture ${name} is not bound to the public entrypoint`, "REACT_COMPONENTS_FIXTURE_UNBOUND");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `React fixture ${name} lacks a typed readback`, "REACT_COMPONENTS_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.expected === fixture.vector.expected_readback.disposition, `React fixture ${name} has contradictory expectations`, "REACT_COMPONENTS_FIXTURE_CONTRADICTION");
    records.push({fixture_id: fixture.fixture_id, class: fixture.class, path: `${REACT_COMPONENTS_PACKAGE_PATH}/fixtures/${name}`, file_sha256: artifact.file_sha256});
  }
  assert(new Set(records.map((record) => record.class)).size === REACT_COMPONENTS_FIXTURE_CLASSES.length, "React fixture classes are not unique", "REACT_COMPONENTS_FIXTURE_CLASS_INVALID");
  return records.sort((left, right) => compareUtf8(left.fixture_id, right.fixture_id));
}
function checkHandoff() {
  const artifact = readJson(path.join(PACKAGE_ROOT, "handoff.json"), "React handoff"); const handoff = artifact.value;
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.react-components.v1" && handoff.block_id === REACT_COMPONENTS_BLOCK_ID, "React handoff identity differs", "REACT_COMPONENTS_HANDOFF_INVALID");
  assert(handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "React handoff disposition is unsafe", "REACT_COMPONENTS_HANDOFF_INVALID");
  assert(GIT_OBJECT.test(handoff.source_commit) && GIT_OBJECT.test(handoff.source_tree), "React handoff source identity is not immutable", "REACT_COMPONENTS_HANDOFF_SOURCE_INVALID");
  let observedTree; try { observedTree = execFileSync("git", ["rev-parse", `${handoff.source_commit}^{tree}`], {cwd: ROOT, encoding: "utf8"}).trim(); } catch { fail("React handoff source commit is unavailable", "REACT_COMPONENTS_HANDOFF_SOURCE_INVALID"); }
  assert(observedTree === handoff.source_tree, "React handoff source tree does not match its commit", "REACT_COMPONENTS_HANDOFF_SOURCE_INVALID");
  assert(Array.isArray(handoff.changed_paths) && handoff.changed_paths.length > 0 && handoff.changed_paths.every((relativePath) => typeof relativePath === "string" && !path.isAbsolute(relativePath) && fs.existsSync(path.join(ROOT, relativePath)) && relativePath.startsWith(`${REACT_COMPONENTS_PACKAGE_PATH}/`)), "React handoff changed-path receipt is incomplete", "REACT_COMPONENTS_HANDOFF_PATHS_INVALID");
  for (const proof of ["12-gate-pack-digests", "atomic-scope-and-upstream-router", "executable-public-boundary", "hostile-fixture-catalog", "independent-reviewer-required", "lifecycle-recovery", "memory-context-invalidation", "mutation-regression", "source-freshness", "source-lock-digest"]) assert(handoff.proof.includes(proof), `React handoff proof is missing ${proof}`, "REACT_COMPONENTS_HANDOFF_PROOF_INVALID");
  return {file_sha256: artifact.file_sha256, disposition: handoff.disposition, source_commit: handoff.source_commit, source_tree: handoff.source_tree, changed_paths: handoff.changed_paths};
}
function checkRoster() {
  const artifact = readJson(path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json"), "React reusable-agent roster"); const roster = artifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true, "React roster identity is invalid", "REACT_COMPONENTS_ROSTER_INVALID");
  checkSelfDigest(roster, "roster_sha256", "React reusable-agent roster");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === REACT_COMPONENTS_AGENT_ID);
  assert(entry && entry.canonical_block_id === REACT_COMPONENTS_BLOCK_ID && entry.package_path === REACT_COMPONENTS_PACKAGE_PATH, "React roster binding is missing or substituted", "REACT_COMPONENTS_ROSTER_BINDING_INVALID");
  assert(entry.model_route?.task_class === "NARROW_CODING" && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "React model-policy route is not bound", "REACT_COMPONENTS_MODEL_ROUTE_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.gates.length === REACT_COMPONENTS_GATE_IDS.length, "React roster gate binding is incomplete", "REACT_COMPONENTS_ROSTER_GATE_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === REACT_COMPONENTS_FIXTURE_CLASSES.length, "React roster fixture binding is incomplete", "REACT_COMPONENTS_ROSTER_FIXTURE_INVALID");
  assert(entry.required_evidence_handoff?.handoff_path === `${REACT_COMPONENTS_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.independent_review_required === true, "React roster handoff binding is incomplete", "REACT_COMPONENTS_ROSTER_HANDOFF_INVALID");
  assert(entry.lifecycle?.kind === "SEED_TO_WORKER" && entry.supersession_invalidation?.links?.includes(`${REACT_COMPONENTS_PACKAGE_PATH}/evaluation.json`), "React roster lifecycle binding is incomplete", "REACT_COMPONENTS_ROSTER_LIFECYCLE_INVALID");
  return {entry, file_sha256: artifact.file_sha256, roster_sha256: roster.roster_sha256};
}
function resolveRuntimeCustody() {
  let gitRoot; try { gitRoot = fs.realpathSync.native(execFileSync("git", ["rev-parse", "--show-toplevel"], {cwd: ROOT, encoding: "utf8"}).trim()); } catch { fail("React custody Git root is unavailable", "REACT_COMPONENTS_CUSTODY_INVALID"); }
  const worktreeRoot = fs.realpathSync.native(ROOT); const workspaceRoot = fs.realpathSync.native(path.dirname(worktreeRoot));
  assert(gitRoot === worktreeRoot, "React resolver is not executing from its Git worktree root", "REACT_COMPONENTS_CUSTODY_INVALID");
  assert(worktreeRoot === workspaceRoot || worktreeRoot.startsWith(`${workspaceRoot}${path.sep}`), "React worktree is outside the runtime workspace root", "REACT_COMPONENTS_CUSTODY_INVALID");
  return {scope: "PROJECTS_DESCENDANT_RUNTIME", workspace_root_sha256: canonicalDigest(workspaceRoot), worktree_root_sha256: canonicalDigest(worktreeRoot), git_root_verified: true, resolved_paths_persisted: false};
}

export function resolveReactComponentsCanonicalAuthority() {
  const custody = resolveRuntimeCustody();
  const blockArtifact = readJson(path.join(PACKAGE_ROOT, "block.json"), "React block"); const block = checkBlock(blockArtifact, REACT_COMPONENTS_BLOCK_ID, "React block");
  const sourceArtifact = readJson(path.join(PACKAGE_ROOT, "sources.lock"), "React source lock"); const source = checkSourceManifest(sourceArtifact, REACT_COMPONENTS_BLOCK_ID, "React source lock");
  const atomicSource = source.sources?.find((candidate) => candidate.source_id === REACT_COMPONENTS_SOURCE_ID);
  assert(atomicSource?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomicSource.version === "1" && atomicSource.authority_class === "AGENTOS_PORTABLE", "React atomic source identity is not canonical", "REACT_COMPONENTS_SOURCE_IDENTITY_INVALID");
  const standardArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/react-19-2/block.json"), "React standard block"); const standard = checkBlock(standardArtifact, REACT_COMPONENTS_STANDARD_BLOCK_ID, "React standard block");
  const standardSourceArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/react-19-2/sources.lock"), "React standard source manifest"); const standardSource = checkSourceManifest(standardSourceArtifact, REACT_COMPONENTS_STANDARD_BLOCK_ID, "React standard source manifest");
  const standardSourceIdentity = standardSource.sources?.find((candidate) => candidate.source_id === REACT_COMPONENTS_STANDARD_SOURCE_ID);
  assert(standardSourceIdentity?.publisher === "React" && standardSourceIdentity.version === "19.2" && standardSourceIdentity.effective_date === "2025-10-01" && standardSourceIdentity.immutable_identity === "react-19.2-release-2025-10-01", "React standard source identity is not canonical", "REACT_COMPONENTS_STANDARD_SOURCE_INVALID");
  const modelArtifact = readJson(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), "Global model-policy snapshot"); const model = modelArtifact.value;
  assert(model.snapshot_sha256 === REACT_COMPONENTS_MODEL_SNAPSHOT_SHA256, "React model snapshot identity differs", "REACT_COMPONENTS_MODEL_POLICY_PROVENANCE_INVALID");
  assert(modelArtifact.file_sha256 === REACT_COMPONENTS_MODEL_FILE_SHA256, "React model snapshot file identity differs", "REACT_COMPONENTS_MODEL_POLICY_PROVENANCE_INVALID");
  const modelExpired = model.status !== "ACTIVE" || Date.parse(model.expires_at_utc) <= Date.now();
  const modelPolicy = {status: modelExpired ? "BLOCKED_EXACT" : "BOUND_LOCAL_ONLY", code: modelExpired ? "POLICY_SNAPSHOT_STALE" : null, snapshot_sha256: model.snapshot_sha256, file_sha256: modelArtifact.file_sha256, observed_at_utc: model.observed_at_utc, expires_at_utc: model.expires_at_utc, source_status: model.status};
  const routerFile = path.join(ROOT, "control/software-language-runtime-router-boundary-gate.mjs"); const routerFileSha = FILE_SHA256(routerFile); const routerInput = canonicalRouterInput(); const routerResult = evaluateSoftwareLanguageRuntimeRouterBoundary(routerInput);
  assert(routerResult.disposition === "ROUTE" && routerResult.route === "SPECIALIST_HANDOFF" && routerResult.selected_specialist === REACT_COMPONENTS_BLOCK_ID && routerResult.acceptance_allowed === false, "React upstream router did not produce the exact route", "REACT_COMPONENTS_UPSTREAM_ROUTER_INVALID");
  const routerResultSha = canonicalDigest(routerResult); const contextReceiptSha = reactComponentsContextReceiptSha256({blockSha: block.block_sha256, sourceManifestSha: source.manifest_sha256, standardBlockSha: standard.block_sha256, standardSourceManifestSha: standardSource.manifest_sha256, routerFileSha, routerResultSha, modelSnapshotSha: model.snapshot_sha256});
  const gateArtifacts = checkGateArtifacts(readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "React gate manifest"), readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "React gate execution"));
  const fixtures = checkFixtures(); const handoff = checkHandoff(); const roster = checkRoster();
  const files = packageFiles().map((relativePath) => ({relative_path: `${REACT_COMPONENTS_PACKAGE_PATH}/${relativePath}`, sha256: FILE_SHA256(path.join(PACKAGE_ROOT, relativePath))}));
  const protectedBlockers = [
    {code: "POLICY_SNAPSHOT_STALE", status: "BLOCKED_EXACT", owner: "Spawner/root protected global authority", artifact: "fixtures/model-policy-snapshot.initial.v1.json", snapshot_sha256: model.snapshot_sha256, next_action: "Refresh and validate the canonical model-policy snapshot, then rebind this candidate before review."},
    {code: "CANONICAL_EVALUATOR_HANDOFF_REQUIRED", status: "BLOCKED_EXACT", owner: "Spawner/root protected evaluator authority", artifact: "canonical-spawner-evaluator-handoff", next_action: "Supply a fresh signed evaluator/reviewer handoff for this exact candidate; do not self-sign or audit locally as independent clearance."},
  ];
  const binding = {
    schema: "agentos.react_components_canonical_authority.v1", version: 1, status: modelPolicy.status, block_id: REACT_COMPONENTS_BLOCK_ID, stable_agent_id: REACT_COMPONENTS_AGENT_ID, package_path: REACT_COMPONENTS_PACKAGE_PATH, custody,
    candidate: {lifecycle: block.lifecycle, activation: block.activation, block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, package_files_sha256: canonicalDigest(files)},
    standard: {block_id: REACT_COMPONENTS_STANDARD_BLOCK_ID, block_sha256: standard.block_sha256, source_manifest_sha256: standardSource.manifest_sha256, source_id: REACT_COMPONENTS_STANDARD_SOURCE_ID},
    upstream_router: {boundary_path: "control/software-language-runtime-router-boundary-gate.mjs", file_sha256: routerFileSha, input_sha256: canonicalDigest(routerInput), result_sha256: routerResultSha, selected_specialist: routerResult.selected_specialist},
    gates: {manifest_file_sha256: gateArtifacts.manifest_file_sha256, manifest_sha256: gateArtifacts.manifest.manifest_sha256, execution_file_sha256: gateArtifacts.execution_file_sha256, execution_sha256: gateArtifacts.execution.execution_sha256, ordered_gate_ids: REACT_COMPONENTS_GATE_IDS},
    fixtures, handoff, model_policy: modelPolicy, protected_blockers: protectedBlockers,
    context: {receipt_sha256: contextReceiptSha, memory_binding: REACT_COMPONENTS_MEMORY_BINDING, invalidation_links: [`${REACT_COMPONENTS_PACKAGE_PATH}/block.json`, `${REACT_COMPONENTS_PACKAGE_PATH}/sources.lock`, `${REACT_COMPONENTS_PACKAGE_PATH}/gates/execution.json`, `${REACT_COMPONENTS_PACKAGE_PATH}/evaluation.json`, `${REACT_COMPONENTS_PACKAGE_PATH}/handoff.json`, "fixtures/model-policy-snapshot.initial.v1.json", "specialist-blocks/registry/agent-roster.v1.json", "control/software-language-runtime-router-boundary-gate.mjs"], invalidate_when: ["block semantic digest changes", "source or standard identity changes", "gate execution or hostile fixture bytes change", "model-policy snapshot or roster authority changes", "upstream router bytes or result changes", "runtime workspace custody changes"]},
    registry: roster, authority_sha256: null,
  };
  binding.authority_sha256 = canonicalDigest({...binding, authority_sha256: null}); return Object.freeze(binding);
}

export const resolveReactComponentCanonicalAuthority = resolveReactComponentsCanonicalAuthority;

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(resolveReactComponentsCanonicalAuthority(), null, 2)}\n`);
