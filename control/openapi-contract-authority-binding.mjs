#!/usr/bin/env node

/*
 * Repository-bound authority for the OpenAPI HTTP Contract candidate.
 *
 * All artifact selection is derived from this worktree's Git root. Resolved
 * host paths never leave the runtime; receipts carry only relative artifact
 * names and digests. A stale protected model snapshot is preserved as an
 * exact blocker and cannot be replaced by a caller-supplied projection.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateProductClientRouterBoundary} from "./product-client-router-boundary-gate.mjs";

export const OPENAPI_CONTRACT_PACKAGE_PATH = "specialist-blocks/wave-02/openapi-contracts";
export const OPENAPI_CONTRACT_BLOCK_ID = "specialist.product-client.openapi-contracts";
export const OPENAPI_CONTRACT_AGENT_ID = "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS";
export const OPENAPI_CONTRACT_STANDARD_BLOCK_ID = "specialist.standard.openapi-3-1-1";
export const OPENAPI_CONTRACT_STANDARD_SOURCE_ID = "source.openapi-3-1-1";
export const OPENAPI_CONTRACT_SOURCE_ID = "source.atomic-specialization-law";
export const OPENAPI_CONTRACT_CUSTODY_REF = "opaque:OPENAPI.CONTRACT.CUSTODY";
export const OPENAPI_CONTRACT_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const OPENAPI_CONTRACT_MODEL_FILE_SHA256 = "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d";
export const OPENAPI_CONTRACT_MEMORY_BINDING = "TYPED_CONTEXT_INVALIDATION_V1";
export const OPENAPI_CONTRACT_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const OPENAPI_CONTRACT_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, OPENAPI_CONTRACT_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const FILE_SHA256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fail(message, code = "OPENAPI_CONTRACT_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "OPENAPI_CONTRACT_CANONICAL_DIGEST_INVALID");
}

function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "OPENAPI_CONTRACT_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "OPENAPI_CONTRACT_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "OPENAPI_CONTRACT_CANONICAL_ARTIFACT_INVALID"); }
  return {value, file_sha256: FILE_SHA256(file)};
}

function checkSelfDigest(value, field, label) {
  sha(value[field], `${label}.${field}`);
  assert(value[field] === canonicalDigest({...value, [field]: null}), `${label}.${field} does not match its bytes`, "OPENAPI_CONTRACT_CANONICAL_DIGEST_INVALID");
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "OPENAPI_CONTRACT_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...expected].sort(compareUtf8)), `${label} fields differ`, "OPENAPI_CONTRACT_CANONICAL_SCHEMA_INVALID");
}

function packageFiles() {
  const names = ["block.json", "sources.lock", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"];
  const gates = fs.readdirSync(path.join(PACKAGE_ROOT, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`);
  const fixtures = fs.readdirSync(path.join(PACKAGE_ROOT, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`);
  return [...new Set([...names, ...gates, ...fixtures])].sort(compareUtf8);
}

function canonicalRouterInput() {
  return {
    schema: "agentos.product_client_router_boundary_input.v1",
    version: 1,
    request_kind: "CLASSIFY_PRODUCT_CLIENT_SIGNAL",
    evidence: {
      authority_status: "CURRENT",
      custody_status: "BOUND",
      custody_owner: "AGENT.PRODUCT_CLIENT_ROUTER",
      custody_ref: "ref:PRODUCT_CLIENT_ROUTER/BOUND",
      source_status: "CURRENT",
      source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW",
      source_version: "1",
      client_surface: "WEB",
      signal: "API_CONTRACTS",
      target_ref: OPENAPI_CONTRACT_BLOCK_ID,
      context_complete: true,
      scope: "NARROW",
      requested_action: "CLASSIFY",
      requested_tools: ["READ_SOURCE", "READ_CONTEXT"],
      self_acceptance: false,
      scope_expanded: false,
      authority_conflict: false,
      project_data_present: false,
      secret_data_present: false,
      client_evidence: "BOUNDED",
    },
  };
}

function canonicalContext({blockSha, sourceManifestSha, standardBlockSha, standardSourceManifestSha, routerFileSha, routerResultSha, modelSnapshotSha}) {
  return {
    block_sha256: blockSha,
    source_manifest_sha256: sourceManifestSha,
    standard_block_sha256: standardBlockSha,
    standard_source_manifest_sha256: standardSourceManifestSha,
    authority_scope: "OPENAPI_CONTRACT",
    scope: "NARROW",
    custody_ref: OPENAPI_CONTRACT_CUSTODY_REF,
    operation_identity: "OPERATION.OPENAPI_CONTRACT",
    operation_version: "1",
    router_file_sha256: routerFileSha,
    router_result_sha256: routerResultSha,
    model_snapshot_sha256: modelSnapshotSha,
    memory_binding: OPENAPI_CONTRACT_MEMORY_BINDING,
    lifecycle_revision: "1.0.0",
  };
}

export function openApiContractContextReceiptSha256(values) {
  return canonicalDigest(canonicalContext(values));
}

function checkSourceManifest(artifact, expectedBlockId, label) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === expectedBlockId, `${label} identity differs`, "OPENAPI_CONTRACT_SOURCE_LOCK_INVALID");
  checkSelfDigest(source, "manifest_sha256", label);
  return source;
}

function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === expectedId && block.lifecycle === "CANDIDATE" && block.activation === "OFF", `${label} identity differs`, "OPENAPI_CONTRACT_CANONICAL_BINDING_INVALID");
  checkSelfDigest(block, "block_sha256", label);
  return block;
}

function checkGateArtifacts(manifestArtifact, executionArtifact) {
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === OPENAPI_CONTRACT_BLOCK_ID, "OpenAPI gate manifest identity differs", "OPENAPI_CONTRACT_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(OPENAPI_CONTRACT_GATE_IDS), "OpenAPI gate order differs", "OPENAPI_CONTRACT_GATE_ORDER_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(OPENAPI_CONTRACT_GATE_IDS.map((id) => `gates/${id}.gate`)), "OpenAPI gate paths differ", "OPENAPI_CONTRACT_GATE_PATH_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "OpenAPI gate outcomes differ", "OPENAPI_CONTRACT_GATE_OUTCOME_INVALID");
  checkSelfDigest(manifest, "manifest_sha256", "OpenAPI gate manifest");
  for (const [index, id] of OPENAPI_CONTRACT_GATE_IDS.entries()) {
    const artifact = readJson(path.join(PACKAGE_ROOT, "gates", `${id}.gate`), `OpenAPI gate ${id}`);
    const gate = artifact.value;
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === id && gate.block_id === OPENAPI_CONTRACT_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `OpenAPI gate ${id} is not executable`, "OPENAPI_CONTRACT_GATE_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(manifest.outcomes), `OpenAPI gate ${id} outcomes differ`, "OPENAPI_CONTRACT_GATE_OUTCOME_INVALID");
    assert(gate.next?.YES === (index === OPENAPI_CONTRACT_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : OPENAPI_CONTRACT_GATE_IDS[index + 1]), `OpenAPI gate ${id} YES branch differs`, "OPENAPI_CONTRACT_GATE_BRANCH_INVALID");
    assert(gate.next?.NO === "OUTCOME:DENY" && gate.next?.UNKNOWN === "OUTCOME:UNKNOWN_DEPENDENT_ONLY" && gate.next?.NOT_APPLICABLE === (index === OPENAPI_CONTRACT_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : OPENAPI_CONTRACT_GATE_IDS[index + 1]), `OpenAPI gate ${id} terminal branches differ`, "OPENAPI_CONTRACT_GATE_BRANCH_INVALID");
    checkSelfDigest(gate, "gate_sha256", `OpenAPI gate ${id}`);
  }
  const execution = executionArtifact.value;
  assert(execution.schema === "agentos.openapi_contract_gate_execution.v1" && execution.version === 1 && execution.block_id === OPENAPI_CONTRACT_BLOCK_ID, "OpenAPI gate execution identity differs", "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/openapi-contract-package-evaluator.mjs#evaluateOpenApiContractPackage", "OpenAPI gate execution evaluator is not canonical", "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(OPENAPI_CONTRACT_GATE_IDS) && execution.executions.length === OPENAPI_CONTRACT_GATE_IDS.length, "OpenAPI gate execution order is incomplete", "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
  checkSelfDigest(execution, "execution_sha256", "OpenAPI gate execution");
  return {manifest, manifest_file_sha256: manifestArtifact.file_sha256, execution, execution_file_sha256: executionArtifact.file_sha256};
}

function checkFixtures() {
  const directory = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === OPENAPI_CONTRACT_FIXTURE_CLASSES.length, "OpenAPI fixture inventory is not exact", "OPENAPI_CONTRACT_FIXTURE_INVENTORY_INVALID");
  const records = [];
  for (const name of names) {
    const artifact = readJson(path.join(directory, name), `OpenAPI fixture ${name}`);
    const fixture = artifact.value;
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === OPENAPI_CONTRACT_BLOCK_ID && fixture.hostile === true, `OpenAPI fixture ${name} identity is invalid`, "OPENAPI_CONTRACT_FIXTURE_ID_INVALID");
    assert(OPENAPI_CONTRACT_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `openapi-contracts-${fixture.class}`, `OpenAPI fixture ${name} class is invalid`, "OPENAPI_CONTRACT_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === "control/openapi-contract-boundary-gate.mjs#evaluateOpenApiContractBoundary" && fixture.vector.input?.schema === "agentos.openapi_contract_boundary_input.v1", `OpenAPI fixture ${name} is not bound to the public entrypoint`, "OPENAPI_CONTRACT_FIXTURE_UNBOUND");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `OpenAPI fixture ${name} lacks a typed readback`, "OPENAPI_CONTRACT_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.expected === fixture.vector.expected_readback.disposition, `OpenAPI fixture ${name} has contradictory expectations`, "OPENAPI_CONTRACT_FIXTURE_CONTRADICTION");
    records.push({fixture_id: fixture.fixture_id, class: fixture.class, path: `${OPENAPI_CONTRACT_PACKAGE_PATH}/fixtures/${name}`, file_sha256: artifact.file_sha256});
  }
  assert(new Set(records.map((record) => record.class)).size === OPENAPI_CONTRACT_FIXTURE_CLASSES.length, "OpenAPI fixture classes are not unique", "OPENAPI_CONTRACT_FIXTURE_CLASS_INVALID");
  return records.sort((left, right) => compareUtf8(left.fixture_id, right.fixture_id));
}

function checkHandoff() {
  const artifact = readJson(path.join(PACKAGE_ROOT, "handoff.json"), "OpenAPI handoff");
  const handoff = artifact.value;
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.openapi-contracts.v1" && handoff.block_id === OPENAPI_CONTRACT_BLOCK_ID, "OpenAPI handoff identity differs", "OPENAPI_CONTRACT_HANDOFF_INVALID");
  assert(handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "OpenAPI handoff disposition is unsafe", "OPENAPI_CONTRACT_HANDOFF_INVALID");
  assert(GIT_OBJECT.test(handoff.source_commit) && GIT_OBJECT.test(handoff.source_tree), "OpenAPI handoff source identity is not immutable", "OPENAPI_CONTRACT_HANDOFF_SOURCE_INVALID");
  let observedTree;
  try { observedTree = execFileSync("git", ["rev-parse", `${handoff.source_commit}^{tree}`], {cwd: ROOT, encoding: "utf8"}).trim(); } catch { fail("OpenAPI handoff source commit is unavailable", "OPENAPI_CONTRACT_HANDOFF_SOURCE_INVALID"); }
  assert(observedTree === handoff.source_tree, "OpenAPI handoff source tree does not match its commit", "OPENAPI_CONTRACT_HANDOFF_SOURCE_INVALID");
  assert(Array.isArray(handoff.changed_paths) && handoff.changed_paths.length > 0 && handoff.changed_paths.every((relativePath) => typeof relativePath === "string" && !path.isAbsolute(relativePath) && fs.existsSync(path.join(ROOT, relativePath))), "OpenAPI handoff changed-path receipt is incomplete", "OPENAPI_CONTRACT_HANDOFF_PATHS_INVALID");
  for (const proof of ["executable-public-boundary", "mutation-regression", "memory-context-invalidation", "source-freshness", "lifecycle-recovery"]) assert(handoff.proof.includes(proof), `OpenAPI handoff proof is missing ${proof}`, "OPENAPI_CONTRACT_HANDOFF_PROOF_INVALID");
  return {file_sha256: artifact.file_sha256, disposition: handoff.disposition, source_commit: handoff.source_commit, source_tree: handoff.source_tree, changed_paths: handoff.changed_paths};
}

function checkRoster() {
  const artifact = readJson(path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json"), "OpenAPI reusable-agent roster");
  const roster = artifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true, "OpenAPI roster identity is invalid", "OPENAPI_CONTRACT_ROSTER_INVALID");
  checkSelfDigest(roster, "roster_sha256", "OpenAPI reusable-agent roster");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === OPENAPI_CONTRACT_AGENT_ID);
  assert(entry && entry.canonical_block_id === OPENAPI_CONTRACT_BLOCK_ID && entry.package_path === OPENAPI_CONTRACT_PACKAGE_PATH, "OpenAPI roster binding is missing or substituted", "OPENAPI_CONTRACT_ROSTER_BINDING_INVALID");
  assert(entry.model_route?.task_class === "NARROW_CODING" && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "OpenAPI model-policy route is not bound", "OPENAPI_CONTRACT_MODEL_ROUTE_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.gates.length === OPENAPI_CONTRACT_GATE_IDS.length, "OpenAPI roster gate binding is incomplete", "OPENAPI_CONTRACT_ROSTER_GATE_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === OPENAPI_CONTRACT_FIXTURE_CLASSES.length, "OpenAPI roster fixture binding is incomplete", "OPENAPI_CONTRACT_ROSTER_FIXTURE_INVALID");
  assert(entry.required_evidence_handoff?.handoff_path === `${OPENAPI_CONTRACT_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.independent_review_required === true, "OpenAPI roster handoff binding is incomplete", "OPENAPI_CONTRACT_ROSTER_HANDOFF_INVALID");
  assert(entry.lifecycle?.kind === "SEED_TO_WORKER" && entry.supersession_invalidation?.links?.includes(`${OPENAPI_CONTRACT_PACKAGE_PATH}/evaluation.json`), "OpenAPI roster lifecycle binding is incomplete", "OPENAPI_CONTRACT_ROSTER_LIFECYCLE_INVALID");
  return {entry, file_sha256: artifact.file_sha256, roster_sha256: roster.roster_sha256};
}

function resolveRuntimeCustody() {
  let gitRoot;
  try { gitRoot = fs.realpathSync.native(execFileSync("git", ["rev-parse", "--show-toplevel"], {cwd: ROOT, encoding: "utf8"}).trim()); } catch { fail("OpenAPI custody Git root is unavailable", "OPENAPI_CONTRACT_CUSTODY_INVALID"); }
  const worktreeRoot = fs.realpathSync.native(ROOT);
  const workspaceRoot = fs.realpathSync.native(path.dirname(worktreeRoot));
  assert(gitRoot === worktreeRoot, "OpenAPI resolver is not executing from its Git worktree root", "OPENAPI_CONTRACT_CUSTODY_INVALID");
  assert(worktreeRoot === workspaceRoot || worktreeRoot.startsWith(`${workspaceRoot}${path.sep}`), "OpenAPI worktree is outside the runtime workspace root", "OPENAPI_CONTRACT_CUSTODY_INVALID");
  return {
    scope: "PROJECTS_DESCENDANT_RUNTIME",
    workspace_root_sha256: canonicalDigest(workspaceRoot),
    worktree_root_sha256: canonicalDigest(worktreeRoot),
    git_root_verified: true,
    resolved_paths_persisted: false,
  };
}

export function resolveOpenApiContractCanonicalAuthority() {
  const custody = resolveRuntimeCustody();
  const blockArtifact = readJson(path.join(PACKAGE_ROOT, "block.json"), "OpenAPI block");
  const block = checkBlock(blockArtifact, OPENAPI_CONTRACT_BLOCK_ID, "OpenAPI block");
  const sourceArtifact = readJson(path.join(PACKAGE_ROOT, "sources.lock"), "OpenAPI source lock");
  const source = checkSourceManifest(sourceArtifact, OPENAPI_CONTRACT_BLOCK_ID, "OpenAPI source lock");
  const atomicSource = source.sources?.find((candidate) => candidate.source_id === OPENAPI_CONTRACT_SOURCE_ID);
  assert(atomicSource?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomicSource.version === "1" && atomicSource.authority_class === "AGENTOS_PORTABLE", "OpenAPI atomic source identity is not canonical", "OPENAPI_CONTRACT_SOURCE_IDENTITY_INVALID");
  const standardArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/openapi-3-1-1/block.json"), "OpenAPI standard block");
  const standard = checkBlock(standardArtifact, OPENAPI_CONTRACT_STANDARD_BLOCK_ID, "OpenAPI standard block");
  const standardSourceArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/openapi-3-1-1/sources.lock"), "OpenAPI standard source manifest");
  const standardSource = checkSourceManifest(standardSourceArtifact, OPENAPI_CONTRACT_STANDARD_BLOCK_ID, "OpenAPI standard source manifest");
  const standardSourceIdentity = standardSource.sources?.find((candidate) => candidate.source_id === OPENAPI_CONTRACT_STANDARD_SOURCE_ID);
  assert(standardSourceIdentity?.publisher === "OpenAPI Initiative" && standardSourceIdentity.version === "3.1.1" && standardSourceIdentity.immutable_identity === "openapi-spec-3.1.1-2024-10-24", "OpenAPI standard source identity is not canonical", "OPENAPI_CONTRACT_STANDARD_SOURCE_INVALID");

  const modelArtifact = readJson(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), "Global model-policy snapshot");
  const model = modelArtifact.value;
  assert(model.snapshot_sha256 === OPENAPI_CONTRACT_MODEL_SNAPSHOT_SHA256, "OpenAPI model snapshot identity differs", "OPENAPI_CONTRACT_MODEL_POLICY_PROVENANCE_INVALID");
  assert(modelArtifact.file_sha256 === OPENAPI_CONTRACT_MODEL_FILE_SHA256, "OpenAPI model snapshot file identity differs", "OPENAPI_CONTRACT_MODEL_POLICY_PROVENANCE_INVALID");
  const modelExpired = model.status !== "ACTIVE" || Date.parse(model.expires_at_utc) <= Date.now();
  const modelPolicy = {
    status: modelExpired ? "BLOCKED_EXACT" : "BOUND_LOCAL_ONLY",
    code: modelExpired ? "POLICY_SNAPSHOT_STALE" : null,
    snapshot_sha256: model.snapshot_sha256,
    file_sha256: modelArtifact.file_sha256,
    observed_at_utc: model.observed_at_utc,
    expires_at_utc: model.expires_at_utc,
    source_status: model.status,
  };

  const routerFile = path.join(ROOT, "control/product-client-router-boundary-gate.mjs");
  const routerFileSha = FILE_SHA256(routerFile);
  const routerInput = canonicalRouterInput();
  const routerResult = evaluateProductClientRouterBoundary(routerInput);
  assert(routerResult.disposition === "ROUTE" && routerResult.route === "SPECIALIST_HANDOFF" && routerResult.selected_specialist === OPENAPI_CONTRACT_BLOCK_ID && routerResult.acceptance_allowed === false, "OpenAPI upstream router did not produce the exact route", "OPENAPI_CONTRACT_UPSTREAM_ROUTER_INVALID");
  const routerResultSha = canonicalDigest(routerResult);
  const contextValues = {
    blockSha: block.block_sha256,
    sourceManifestSha: source.manifest_sha256,
    standardBlockSha: standard.block_sha256,
    standardSourceManifestSha: standardSource.manifest_sha256,
    routerFileSha,
    routerResultSha,
    modelSnapshotSha: model.snapshot_sha256,
  };
  const contextReceiptSha = openApiContractContextReceiptSha256(contextValues);
  const gateArtifacts = checkGateArtifacts(
    readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "OpenAPI gate manifest"),
    readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "OpenAPI gate execution"),
  );
  const fixtures = checkFixtures();
  const handoff = checkHandoff();
  const roster = checkRoster();
  const files = packageFiles().map((relativePath) => ({relative_path: `${OPENAPI_CONTRACT_PACKAGE_PATH}/${relativePath}`, sha256: FILE_SHA256(path.join(PACKAGE_ROOT, relativePath))}));
  const binding = {
    schema: "agentos.openapi_contract_canonical_authority.v1",
    version: 1,
    status: modelPolicy.status,
    block_id: OPENAPI_CONTRACT_BLOCK_ID,
    stable_agent_id: OPENAPI_CONTRACT_AGENT_ID,
    package_path: OPENAPI_CONTRACT_PACKAGE_PATH,
    custody,
    candidate: {
      lifecycle: block.lifecycle,
      activation: block.activation,
      block_sha256: block.block_sha256,
      source_manifest_sha256: source.manifest_sha256,
      package_files_sha256: canonicalDigest(files),
    },
    standard: {
      block_id: OPENAPI_CONTRACT_STANDARD_BLOCK_ID,
      block_sha256: standard.block_sha256,
      source_manifest_sha256: standardSource.manifest_sha256,
      source_id: OPENAPI_CONTRACT_STANDARD_SOURCE_ID,
    },
    upstream_router: {
      boundary_path: "control/product-client-router-boundary-gate.mjs",
      file_sha256: routerFileSha,
      input_sha256: canonicalDigest(routerInput),
      result_sha256: routerResultSha,
      selected_specialist: routerResult.selected_specialist,
    },
    gates: {
      manifest_file_sha256: gateArtifacts.manifest_file_sha256,
      manifest_sha256: gateArtifacts.manifest.manifest_sha256,
      execution_file_sha256: gateArtifacts.execution_file_sha256,
      execution_sha256: gateArtifacts.execution.execution_sha256,
      ordered_gate_ids: OPENAPI_CONTRACT_GATE_IDS,
    },
    fixtures,
    handoff,
    model_policy: modelPolicy,
    context: {
      receipt_sha256: contextReceiptSha,
      memory_binding: OPENAPI_CONTRACT_MEMORY_BINDING,
      invalidation_links: [
        `${OPENAPI_CONTRACT_PACKAGE_PATH}/block.json`,
        `${OPENAPI_CONTRACT_PACKAGE_PATH}/sources.lock`,
        `${OPENAPI_CONTRACT_PACKAGE_PATH}/gates/execution.json`,
        `${OPENAPI_CONTRACT_PACKAGE_PATH}/evaluation.json`,
        `${OPENAPI_CONTRACT_PACKAGE_PATH}/handoff.json`,
        "fixtures/model-policy-snapshot.initial.v1.json",
        "specialist-blocks/registry/agent-roster.v1.json",
        "control/product-client-router-boundary-gate.mjs",
      ],
      invalidate_when: [
        "block semantic digest changes",
        "source or standard identity changes",
        "gate execution or hostile fixture bytes change",
        "model-policy snapshot or roster authority changes",
        "upstream router bytes or result changes",
        "runtime workspace custody changes",
      ],
    },
    registry: roster,
    authority_sha256: null,
  };
  binding.authority_sha256 = canonicalDigest({...binding, authority_sha256: null});
  return Object.freeze(binding);
}

export const resolveOpenAPIContractCanonicalAuthority = resolveOpenApiContractCanonicalAuthority;

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(resolveOpenApiContractCanonicalAuthority(), null, 2)}\n`);
