#!/usr/bin/env node

/*
 * Repository-bound authority for the Cloudflare DNS candidate.
 *
 * The resolver owns the artifact selection. Callers can observe the exact
 * binding, but cannot supply a different package, source, standard, router,
 * model snapshot, roster entry, or context receipt.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateProviderEdgeRouterBoundary} from "./provider-edge-router-boundary-gate.mjs";

export const CLOUDFLARE_DNS_PACKAGE_PATH = "specialist-blocks/wave-02/cloudflare-dns";
export const CLOUDFLARE_DNS_BLOCK_ID = "specialist.platform.cloudflare-dns";
export const CLOUDFLARE_DNS_AGENT_ID = "AGENT.PLATFORM_CLOUDFLARE_DNS";
export const CLOUDFLARE_DNS_STANDARD_BLOCK_ID = "specialist.standard.cloudflare-dns-current";
export const CLOUDFLARE_DNS_STANDARD_SOURCE_ID = "source.cloudflare-dns-records";
export const CLOUDFLARE_DNS_SOURCE_ID = "source.atomic-specialization-law";
export const CLOUDFLARE_DNS_CUSTODY_REF = "opaque:CLOUDFLARE.DNS.CUSTODY";
export const CLOUDFLARE_DNS_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const CLOUDFLARE_DNS_MODEL_FILE_SHA256 = "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d";
export const CLOUDFLARE_DNS_MEMORY_BINDING = "TYPED_CONTEXT_INVALIDATION_V1";
export const CLOUDFLARE_DNS_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const CLOUDFLARE_DNS_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, CLOUDFLARE_DNS_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const FILE_SHA256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fail(message, code = "CLOUDFLARE_DNS_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "CLOUDFLARE_DNS_CANONICAL_DIGEST_INVALID");
}

function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "CLOUDFLARE_DNS_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "CLOUDFLARE_DNS_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "CLOUDFLARE_DNS_CANONICAL_ARTIFACT_INVALID"); }
  return {value, file_sha256: FILE_SHA256(file)};
}

function digestWithout(value, field) {
  const copy = structuredClone(value);
  copy[field] = null;
  return canonicalDigest(copy);
}

function checkSelfDigest(value, field, label) {
  sha(value[field], `${label}.${field}`);
  assert(value[field] === digestWithout(value, field), `${label}.${field} does not match its bytes`, "CLOUDFLARE_DNS_CANONICAL_DIGEST_INVALID");
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "CLOUDFLARE_DNS_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...expected].sort(compareUtf8)), `${label} fields differ`, "CLOUDFLARE_DNS_CANONICAL_SCHEMA_INVALID");
}

function packageFiles() {
  const names = ["block.json", "sources.lock", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"];
  const gates = fs.readdirSync(path.join(PACKAGE_ROOT, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`);
  const fixtures = fs.readdirSync(path.join(PACKAGE_ROOT, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`);
  return [...new Set([...names, ...gates, ...fixtures])].sort(compareUtf8);
}

function canonicalRouterInput() {
  return {
    schema: "agentos.provider_edge_router_boundary_input.v1",
    version: 1,
    request_kind: "CLASSIFY_PROVIDER_SIGNAL",
    evidence: {
      authority_status: "CURRENT",
      custody_status: "BOUND",
      custody_owner: "AGENT.PLATFORM_PROVIDER_EDGE_ROUTER",
      custody_ref: "opaque:PROVIDER.EDGE.ROUTER",
      source_status: "CURRENT",
      source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW",
      source_version: "1",
      provider_identity: "CLOUDFLARE",
      provider_version: "CURRENT",
      signal: "EDGE.CLOUDFLARE_DNS",
      target_ref: CLOUDFLARE_DNS_BLOCK_ID,
      context_complete: true,
      scope: "NARROW",
      requested_action: "CLASSIFY",
      requested_tools: ["READ_SOURCE", "READ_CONTEXT"],
      self_acceptance: false,
      scope_expanded: false,
      authority_conflict: false,
      project_data_present: false,
      secret_data_present: false,
      provider_evidence: "BOUNDED",
    },
  };
}

function canonicalContext({blockSha, sourceManifestSha, standardBlockSha, standardSourceManifestSha, routerFileSha, routerResultSha, modelSnapshotSha}) {
  return {
    block_sha256: blockSha,
    source_manifest_sha256: sourceManifestSha,
    standard_block_sha256: standardBlockSha,
    standard_source_manifest_sha256: standardSourceManifestSha,
    authority_scope: "CLOUDFLARE_DNS",
    scope: "NARROW",
    custody_ref: CLOUDFLARE_DNS_CUSTODY_REF,
    operation_identity: "OPERATION.CLOUDFLARE_DNS",
    operation_version: "1",
    router_file_sha256: routerFileSha,
    router_result_sha256: routerResultSha,
    model_snapshot_sha256: modelSnapshotSha,
    memory_binding: CLOUDFLARE_DNS_MEMORY_BINDING,
    lifecycle_revision: "1.0.0",
  };
}

export function cloudflareDnsContextReceiptSha256(values) {
  return canonicalDigest(canonicalContext(values));
}

function checkSourceManifest(artifact, expectedBlockId, label) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === expectedBlockId, `${label} identity differs`, "CLOUDFLARE_DNS_SOURCE_LOCK_INVALID");
  checkSelfDigest(source, "manifest_sha256", label);
  return source;
}

function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === expectedId && block.activation === "OFF", `${label} identity differs`, "CLOUDFLARE_DNS_CANONICAL_BINDING_INVALID");
  checkSelfDigest(block, "block_sha256", label);
  return block;
}

function checkGateArtifacts(manifestArtifact, executionArtifact) {
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === CLOUDFLARE_DNS_BLOCK_ID, "Cloudflare DNS gate manifest identity differs", "CLOUDFLARE_DNS_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(CLOUDFLARE_DNS_GATE_IDS), "Cloudflare DNS gate order differs", "CLOUDFLARE_DNS_GATE_ORDER_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(CLOUDFLARE_DNS_GATE_IDS.map((id) => `gates/${id}.gate`)), "Cloudflare DNS gate paths differ", "CLOUDFLARE_DNS_GATE_PATH_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Cloudflare DNS gate outcomes differ", "CLOUDFLARE_DNS_GATE_OUTCOME_INVALID");
  checkSelfDigest(manifest, "manifest_sha256", "Cloudflare DNS gate manifest");
  for (const [index, id] of CLOUDFLARE_DNS_GATE_IDS.entries()) {
    const artifact = readJson(path.join(PACKAGE_ROOT, "gates", `${id}.gate`), `Cloudflare DNS gate ${id}`);
    const gate = artifact.value;
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === id && gate.block_id === CLOUDFLARE_DNS_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Cloudflare DNS gate ${id} is not executable`, "CLOUDFLARE_DNS_GATE_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(manifest.outcomes), `Cloudflare DNS gate ${id} outcomes differ`, "CLOUDFLARE_DNS_GATE_OUTCOME_INVALID");
    assert(gate.next?.YES === (index === CLOUDFLARE_DNS_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : CLOUDFLARE_DNS_GATE_IDS[index + 1]), `Cloudflare DNS gate ${id} YES branch differs`, "CLOUDFLARE_DNS_GATE_BRANCH_INVALID");
    assert(gate.next?.NO === "OUTCOME:DENY" && gate.next?.UNKNOWN === "OUTCOME:UNKNOWN_DEPENDENT_ONLY" && gate.next?.NOT_APPLICABLE === (index === CLOUDFLARE_DNS_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : CLOUDFLARE_DNS_GATE_IDS[index + 1]), `Cloudflare DNS gate ${id} terminal branches differ`, "CLOUDFLARE_DNS_GATE_BRANCH_INVALID");
    checkSelfDigest(gate, "gate_sha256", `Cloudflare DNS gate ${id}`);
  }
  const execution = executionArtifact.value;
  assert(execution.schema === "agentos.cloudflare_dns_gate_execution.v1" && execution.version === 1 && execution.block_id === CLOUDFLARE_DNS_BLOCK_ID, "Cloudflare DNS gate execution identity differs", "CLOUDFLARE_DNS_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(CLOUDFLARE_DNS_GATE_IDS) && execution.executions.length === CLOUDFLARE_DNS_GATE_IDS.length, "Cloudflare DNS gate execution order is incomplete", "CLOUDFLARE_DNS_GATE_EXECUTION_INVALID");
  return {manifest, execution};
}

function checkFixtures() {
  const directory = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === CLOUDFLARE_DNS_FIXTURE_CLASSES.length, "Cloudflare DNS fixture inventory is not exact", "CLOUDFLARE_DNS_FIXTURE_INVENTORY_INVALID");
  const records = [];
  for (const name of names) {
    const artifact = readJson(path.join(directory, name), `Cloudflare DNS fixture ${name}`);
    const fixture = artifact.value;
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === CLOUDFLARE_DNS_BLOCK_ID && fixture.hostile === true, `Cloudflare DNS fixture ${name} identity is invalid`, "CLOUDFLARE_DNS_FIXTURE_ID_INVALID");
    assert(CLOUDFLARE_DNS_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `cloudflare-dns-${fixture.class}`, `Cloudflare DNS fixture ${name} class is invalid`, "CLOUDFLARE_DNS_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === "control/cloudflare-dns-boundary-gate.mjs#evaluateCloudflareDnsBoundary", `Cloudflare DNS fixture ${name} is not bound to the public entrypoint`, "CLOUDFLARE_DNS_FIXTURE_UNBOUND");
    records.push({fixture_id: fixture.fixture_id, class: fixture.class, path: `${CLOUDFLARE_DNS_PACKAGE_PATH}/fixtures/${name}`, file_sha256: artifact.file_sha256});
  }
  assert(new Set(records.map((record) => record.class)).size === CLOUDFLARE_DNS_FIXTURE_CLASSES.length, "Cloudflare DNS fixture classes are not unique", "CLOUDFLARE_DNS_FIXTURE_CLASS_INVALID");
  return records.sort((left, right) => compareUtf8(left.fixture_id, right.fixture_id));
}

function checkRoster() {
  const artifact = readJson(path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json"), "Cloudflare DNS reusable-agent roster");
  const roster = artifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true, "Cloudflare DNS roster identity is invalid", "CLOUDFLARE_DNS_ROSTER_INVALID");
  checkSelfDigest(roster, "roster_sha256", "Cloudflare DNS reusable-agent roster");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === CLOUDFLARE_DNS_AGENT_ID);
  assert(entry && entry.canonical_block_id === CLOUDFLARE_DNS_BLOCK_ID && entry.package_path === CLOUDFLARE_DNS_PACKAGE_PATH, "Cloudflare DNS roster binding is missing or substituted", "CLOUDFLARE_DNS_ROSTER_BINDING_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.gates.length === CLOUDFLARE_DNS_GATE_IDS.length, "Cloudflare DNS roster gate binding is incomplete", "CLOUDFLARE_DNS_ROSTER_GATE_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === CLOUDFLARE_DNS_FIXTURE_CLASSES.length, "Cloudflare DNS roster fixture binding is incomplete", "CLOUDFLARE_DNS_ROSTER_FIXTURE_INVALID");
  assert(entry.required_evidence_handoff?.handoff_path === `${CLOUDFLARE_DNS_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.independent_review_required === true, "Cloudflare DNS roster handoff binding is incomplete", "CLOUDFLARE_DNS_ROSTER_HANDOFF_INVALID");
  assert(entry.lifecycle?.kind === "SEED_TO_WORKER" && entry.supersession_invalidation?.links?.includes(`${CLOUDFLARE_DNS_PACKAGE_PATH}/evaluation.json`), "Cloudflare DNS roster lifecycle binding is incomplete", "CLOUDFLARE_DNS_ROSTER_LIFECYCLE_INVALID");
  return {entry, file_sha256: artifact.file_sha256, roster_sha256: roster.roster_sha256};
}

export function resolveCloudflareDnsCanonicalAuthority() {
  const blockArtifact = readJson(path.join(PACKAGE_ROOT, "block.json"), "Cloudflare DNS block");
  const block = checkBlock(blockArtifact, CLOUDFLARE_DNS_BLOCK_ID, "Cloudflare DNS block");
  const sourceArtifact = readJson(path.join(PACKAGE_ROOT, "sources.lock"), "Cloudflare DNS source lock");
  const source = checkSourceManifest(sourceArtifact, CLOUDFLARE_DNS_BLOCK_ID, "Cloudflare DNS source lock");
  const atomicSource = source.sources?.find((candidate) => candidate.source_id === CLOUDFLARE_DNS_SOURCE_ID);
  assert(atomicSource?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomicSource.version === "1" && atomicSource.authority_class === "AGENTOS_PORTABLE", "Cloudflare DNS atomic source identity is not canonical", "CLOUDFLARE_DNS_SOURCE_IDENTITY_INVALID");
  const standardArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/cloudflare-dns-current/block.json"), "Cloudflare DNS standard block");
  const standard = checkBlock(standardArtifact, CLOUDFLARE_DNS_STANDARD_BLOCK_ID, "Cloudflare DNS standard block");
  const standardSourceArtifact = readJson(path.join(ROOT, "specialist-blocks/standards/cloudflare-dns-current/sources.lock"), "Cloudflare DNS standard source manifest");
  const standardSource = checkSourceManifest(standardSourceArtifact, CLOUDFLARE_DNS_STANDARD_BLOCK_ID, "Cloudflare DNS standard source manifest");
  const standardSourceIdentity = standardSource.sources?.find((candidate) => candidate.source_id === CLOUDFLARE_DNS_STANDARD_SOURCE_ID);
  assert(standardSourceIdentity?.publisher === "Cloudflare" && standardSourceIdentity.version === "current" && standardSourceIdentity.immutable_identity === "cloudflare-dns-records-current-2026-06-24", "Cloudflare DNS standard source identity is not canonical", "CLOUDFLARE_DNS_STANDARD_SOURCE_INVALID");

  const modelArtifact = readJson(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), "Global model-policy snapshot");
  const model = modelArtifact.value;
  assert(model.snapshot_sha256 === CLOUDFLARE_DNS_MODEL_SNAPSHOT_SHA256, "Cloudflare DNS model snapshot identity differs", "CLOUDFLARE_DNS_MODEL_POLICY_PROVENANCE_INVALID");
  assert(modelArtifact.file_sha256 === CLOUDFLARE_DNS_MODEL_FILE_SHA256, "Cloudflare DNS model snapshot file identity differs", "CLOUDFLARE_DNS_MODEL_POLICY_PROVENANCE_INVALID");
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

  const routerFile = path.join(ROOT, "control/provider-edge-router-boundary-gate.mjs");
  const routerFileSha = FILE_SHA256(routerFile);
  const routerInput = canonicalRouterInput();
  const routerResult = evaluateProviderEdgeRouterBoundary(routerInput);
  assert(routerResult.disposition === "ROUTE" && routerResult.route === "SPECIALIST_HANDOFF" && routerResult.selected_specialist === CLOUDFLARE_DNS_BLOCK_ID && routerResult.acceptance_allowed === false, "Cloudflare DNS upstream router did not produce the exact route", "CLOUDFLARE_DNS_UPSTREAM_ROUTER_INVALID");
  const routerResultSha = canonicalDigest(routerResult);
  const context = canonicalContext({
    blockSha: block.block_sha256,
    sourceManifestSha: source.manifest_sha256,
    standardBlockSha: standard.block_sha256,
    standardSourceManifestSha: standardSource.manifest_sha256,
    routerFileSha,
    routerResultSha,
    modelSnapshotSha: model.snapshot_sha256,
  });
  const contextReceiptSha = cloudflareDnsContextReceiptSha256({
    blockSha: block.block_sha256,
    sourceManifestSha: source.manifest_sha256,
    standardBlockSha: standard.block_sha256,
    standardSourceManifestSha: standardSource.manifest_sha256,
    routerFileSha,
    routerResultSha,
    modelSnapshotSha: model.snapshot_sha256,
  });
  const gateArtifact = checkGateArtifacts(
    readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "Cloudflare DNS gate manifest"),
    readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "Cloudflare DNS gate execution"),
  );
  const fixtures = checkFixtures();
  const roster = checkRoster();
  const files = packageFiles().map((relativePath) => ({relative_path: `${CLOUDFLARE_DNS_PACKAGE_PATH}/${relativePath}`, sha256: FILE_SHA256(path.join(PACKAGE_ROOT, relativePath))}));
  const binding = {
    schema: "agentos.cloudflare_dns_canonical_authority.v1",
    version: 1,
    status: modelPolicy.status,
    block_id: CLOUDFLARE_DNS_BLOCK_ID,
    stable_agent_id: CLOUDFLARE_DNS_AGENT_ID,
    package_path: CLOUDFLARE_DNS_PACKAGE_PATH,
    candidate: {
      lifecycle: block.lifecycle,
      activation: block.activation,
      block_sha256: block.block_sha256,
      source_manifest_sha256: source.manifest_sha256,
      package_files_sha256: canonicalDigest(files),
    },
    standard: {
      block_id: CLOUDFLARE_DNS_STANDARD_BLOCK_ID,
      block_sha256: standard.block_sha256,
      source_manifest_sha256: standardSource.manifest_sha256,
      source_id: CLOUDFLARE_DNS_STANDARD_SOURCE_ID,
    },
    upstream_router: {
      boundary_path: "control/provider-edge-router-boundary-gate.mjs",
      file_sha256: routerFileSha,
      input_sha256: canonicalDigest(routerInput),
      result_sha256: routerResultSha,
      selected_specialist: routerResult.selected_specialist,
    },
    gates: {
      manifest_file_sha256: gateArtifact.manifestArtifactSha256 ?? FILE_SHA256(path.join(PACKAGE_ROOT, "gates/manifest.json")),
      manifest_sha256: gateArtifact.manifest.manifest_sha256,
      execution_file_sha256: FILE_SHA256(path.join(PACKAGE_ROOT, "gates/execution.json")),
      execution_sha256: canonicalDigest(gateArtifact.execution),
      ordered_gate_ids: CLOUDFLARE_DNS_GATE_IDS,
    },
    fixtures,
    model_policy: modelPolicy,
    context: {
      receipt_sha256: contextReceiptSha,
      memory_binding: CLOUDFLARE_DNS_MEMORY_BINDING,
      invalidation_links: [
        `${CLOUDFLARE_DNS_PACKAGE_PATH}/block.json`,
        `${CLOUDFLARE_DNS_PACKAGE_PATH}/sources.lock`,
        `${CLOUDFLARE_DNS_PACKAGE_PATH}/evaluation.json`,
        "fixtures/model-policy-snapshot.initial.v1.json",
        "specialist-blocks/registry/agent-roster.v1.json",
      ],
      invalidate_when: [
        "block semantic digest changes",
        "source or standard identity changes",
        "gate or hostile fixture bytes change",
        "model-policy snapshot or roster authority changes",
        "upstream router bytes or result changes",
      ],
    },
    registry: roster,
    authority_sha256: null,
  };
  binding.authority_sha256 = canonicalDigest({...binding, authority_sha256: null});
  return Object.freeze(binding);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(resolveCloudflareDnsCanonicalAuthority(), null, 2)}\n`);
}
