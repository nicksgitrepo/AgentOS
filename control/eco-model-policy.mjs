#!/usr/bin/env node

/* Capability-first economic model policy compiled during Spawner bootstrap. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";

export const MODEL_POLICY_SNAPSHOT_SCHEMA = "agentos.model_policy_snapshot.v1";
export const MODEL_POLICY_PROJECTION_SCHEMA = "agentos.model_policy_projection.v1";
export const MODEL_POLICY_TASK_CLASSES = Object.freeze([
  "SIMPLE_EXTRACTION", "DETERMINISTIC_QA", "NARROW_CODING", "BROAD_ARCHITECTURE",
  "SECURITY_REVIEW", "LONG_CONTEXT_SYNTHESIS", "FINAL_INTEGRATION", "REAL_HOST_DEBUGGING",
]);
export const MODEL_POLICY_ROLE_CLASSES = Object.freeze([
  "CONTROLLER", "SPAWNER", "SCHEDULER", "RUNTIME", "ORCHESTRATOR", "PERMANENT_ROLE", "INERT_SEED", "WORKING_AGENT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EVIDENCE_MANIFEST = "fixtures/model-policy-evidence/manifest.json";
const CANONICAL_SOURCE_REGISTRY = "fixtures/model-policy-evidence/source-registry.v1.json";

function assert(condition, message, code = "MODEL_POLICY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "DIGEST_INVALID"); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function fileSha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = [...values].sort(compareUtf8);
  assert(new Set(result).size === result.length, `${label} contains duplicates`);
  return result;
}

function resolveArtifact(root, relativePath) {
  requireString(relativePath, "Model evidence artifact path");
  const resolved = path.resolve(root, relativePath);
  assert(resolved.startsWith(`${path.resolve(root)}${path.sep}`), "Model evidence artifact escapes authority root");
  const stat = fs.lstatSync(resolved);
  assert(stat.isFile() && !stat.isSymbolicLink(), "Model evidence artifact must be a regular canonical file");
  const bytes = fs.readFileSync(resolved);
  return {resolved, bytes, value: JSON.parse(bytes.toString("utf8"))};
}

function validateEvidence(evidence, snapshotObservedMs, nowMs, manifestEntry, artifactResolution, sourceEntry) {
  exactKeys(evidence, ["evidence_id", "authority_class", "source_url", "observed_at_utc", "expires_at_utc", "max_age_days", "uncertainty", "artifact_path", "artifact_sha256", "file_sha256", "summary_sha256", "raw_transcript_stored"], "Model evidence");
  requireString(evidence.evidence_id, "Model evidence ID");
  assert(["FIRST_PARTY_PROVIDER", "COMPARATIVE_BENCHMARK", "HOST_ATTESTATION"].includes(evidence.authority_class), "Model evidence authority class is invalid");
  assert(evidence.source_url === sourceEntry.canonical_source_url && evidence.authority_class === sourceEntry.authority_class, "Model evidence source identity is not in the canonical registry");
  requireUtc(evidence.observed_at_utc, "Model evidence observation time");
  requireUtc(evidence.expires_at_utc, "Model evidence expiry");
  const observedMs = Date.parse(evidence.observed_at_utc);
  assert(observedMs <= snapshotObservedMs && observedMs <= nowMs, `Model evidence is future-dated: ${evidence.evidence_id}`, "BENCHMARK_EVIDENCE_FUTURE");
  assert(Date.parse(evidence.expires_at_utc) > nowMs && nowMs - observedMs <= evidence.max_age_days * 86400000, `Model evidence is stale: ${evidence.evidence_id}`, "BENCHMARK_EVIDENCE_STALE");
  assert(Number.isInteger(evidence.max_age_days) && evidence.max_age_days > 0, "Model evidence max age is invalid");
  assert(["LOW", "MEDIUM", "HIGH"].includes(evidence.uncertainty), "Model evidence uncertainty is invalid");
  requireSha(evidence.summary_sha256, "Model evidence summary");
  requireSha(evidence.artifact_sha256, "Model evidence artifact digest");
  requireSha(evidence.file_sha256, "Model evidence file digest");
  requireString(evidence.artifact_path, "Model evidence artifact path");
  assert(evidence.raw_transcript_stored === false, "Raw browsing transcripts are forbidden");
  assert(manifestEntry.evidence_id === evidence.evidence_id && manifestEntry.authority_class === evidence.authority_class, "Model evidence manifest identity differs");
  assert(manifestEntry.artifact_sha256 === evidence.artifact_sha256 && manifestEntry.file_sha256 === evidence.file_sha256, "Model evidence manifest digest differs");
  assert(fileSha(artifactResolution.bytes) === evidence.file_sha256, "Model evidence file digest mismatch");
  const artifact = artifactResolution.value;
  exactKeys(artifact, ["schema", "version", "evidence_id", "authority_class", "provider_id", "source_url", "observed_at_utc", "expires_at_utc", "max_age_days", "uncertainty", "summary", "summary_sha256", "artifact_sha256"], "Model source artifact");
  assert(artifact.schema === "agentos.model_policy_source_artifact.v1" && artifact.version === 1, "Model source artifact identity is invalid");
  assert(artifact.evidence_id === evidence.evidence_id && artifact.authority_class === evidence.authority_class && artifact.source_url === evidence.source_url, "Model evidence source identity differs from artifact");
  assert(artifact.provider_id === sourceEntry.provider_id && evidence.artifact_path === sourceEntry.artifact_path, "Model evidence provider or artifact path differs from canonical source registry");
  if (sourceEntry.allowed_domain !== "HOST_ATTESTATION") assert(new URL(artifact.source_url).hostname === sourceEntry.allowed_domain, "Model evidence source domain is redirected or lookalike");
  const acquisitionReceipt = canonicalDigest({evidence_id: sourceEntry.evidence_id, canonical_source_url: sourceEntry.canonical_source_url, source_revision: sourceEntry.source_revision, acquired_at_utc: sourceEntry.acquired_at_utc, provider_id: sourceEntry.provider_id});
  assert(acquisitionReceipt === sourceEntry.acquisition_receipt_sha256, "Model evidence acquisition receipt is invalid");
  assert(Date.parse(sourceEntry.acquired_at_utc) <= Date.parse(evidence.observed_at_utc) && Date.parse(sourceEntry.acquired_at_utc) <= nowMs, "Model evidence acquisition time is future or inconsistent");
  assert(artifact.observed_at_utc === evidence.observed_at_utc && artifact.expires_at_utc === evidence.expires_at_utc && artifact.max_age_days === evidence.max_age_days && artifact.uncertainty === evidence.uncertainty, "Model evidence freshness differs from artifact");
  assert(artifact.summary_sha256 === canonicalDigest(artifact.summary) && artifact.summary_sha256 === evidence.summary_sha256, "Model evidence summary digest mismatch");
  assert(artifact.artifact_sha256 === canonicalDigest(digestBody(artifact, "artifact_sha256")) && artifact.artifact_sha256 === evidence.artifact_sha256, "Model evidence artifact digest mismatch");
  if (artifact.authority_class === "FIRST_PARTY_PROVIDER") {
    exactKeys(artifact.summary, ["models", "observation_note"], "First-party evidence summary");
    artifact.summary.models.forEach((model) => exactKeys(model, ["model_id", "input_usd_per_million", "output_usd_per_million", "context_tokens", "supported_reasoning_efforts", "capabilities"], "First-party model fact"));
  } else if (artifact.authority_class === "COMPARATIVE_BENCHMARK") {
    exactKeys(artifact.summary, ["methodology_scope", "models"], "Comparative evidence summary");
    artifact.summary.models.forEach((model) => {
      exactKeys(model, ["model_id", "source_url", "reasoning_effort", "capability_score", "output_tokens_per_second", "input_usd_per_million", "output_usd_per_million"], "Comparative model fact");
      assert(sourceEntry.model_source_urls?.[model.model_id] === model.source_url, `Comparative model source is not canonically bound: ${model.model_id}`);
      assert(new URL(model.source_url).hostname === sourceEntry.allowed_domain, `Comparative model source is redirected or lookalike: ${model.model_id}`);
    });
  } else {
    exactKeys(artifact.summary, ["host_id", "models"], "Host evidence summary");
    artifact.summary.models.forEach((model) => exactKeys(model, ["model_id", "available", "supported_reasoning_efforts"], "Host model fact"));
  }
  return artifact;
}

function validateModelPolicySnapshotAgainstEvidenceStore(snapshot, {nowUtc = snapshot?.observed_at_utc, requireActive = false, authorityRoot, evidenceManifestPath} = {}) {
  exactKeys(snapshot, ["schema", "version", "status", "project_agnostic", "visibility", "contains_consumer_context", "raw_browsing_transcripts", "observed_at_utc", "expires_at_utc", "evidence", "conflicts", "models", "task_classes", "snapshot_sha256"], "Model-policy snapshot");
  assert(snapshot.schema === MODEL_POLICY_SNAPSHOT_SCHEMA && snapshot.version === 1, "Model-policy snapshot identity is invalid");
  assert(["PREPARED_INACTIVE", "ACCEPTED_ACTIVE", "SUPERSEDED"].includes(snapshot.status), "Model-policy snapshot status is invalid");
  if (requireActive) assert(snapshot.status === "ACCEPTED_ACTIVE", "Model-policy snapshot is not active", "POLICY_SNAPSHOT_INACTIVE");
  assert(snapshot.project_agnostic === true && snapshot.visibility === "PRIVATE_GLOBAL_GOVERNANCE", "Model-policy snapshot privacy boundary is invalid");
  assert(snapshot.contains_consumer_context === false && snapshot.raw_browsing_transcripts === false, "Model-policy snapshot contains forbidden context");
  requireUtc(nowUtc, "Model-policy validation time");
  requireUtc(snapshot.observed_at_utc, "Model-policy observation time");
  requireUtc(snapshot.expires_at_utc, "Model-policy expiry");
  const nowMs = Date.parse(nowUtc);
  const snapshotObservedMs = Date.parse(snapshot.observed_at_utc);
  assert(snapshotObservedMs <= nowMs, "Model-policy snapshot is future-dated", "POLICY_SNAPSHOT_FUTURE");
  assert(Date.parse(snapshot.expires_at_utc) > nowMs, "Model-policy snapshot is stale", "POLICY_SNAPSHOT_STALE");
  assert(Array.isArray(snapshot.evidence) && snapshot.evidence.length >= 3, "Model-policy evidence is missing", "BENCHMARK_EVIDENCE_MISSING");
  const manifestResolution = resolveArtifact(authorityRoot, evidenceManifestPath);
  const manifest = manifestResolution.value;
  exactKeys(manifest, ["schema", "version", "source_registry_sha256", "entries", "manifest_sha256"], "Model evidence manifest");
  assert(manifest.schema === "agentos.model_policy_evidence_manifest.v1" && manifest.version === 1, "Model evidence manifest identity is invalid");
  assert(manifest.manifest_sha256 === canonicalDigest(digestBody(manifest, "manifest_sha256")), "Model evidence manifest digest mismatch");
  const sourceRegistry = resolveArtifact(authorityRoot, CANONICAL_SOURCE_REGISTRY).value;
  exactKeys(sourceRegistry, ["schema", "version", "entries", "registry_sha256"], "Model evidence source registry");
  assert(sourceRegistry.schema === "agentos.model_policy_source_registry.v1" && sourceRegistry.version === 1, "Model evidence source registry identity is invalid");
  assert(sourceRegistry.registry_sha256 === canonicalDigest(digestBody(sourceRegistry, "registry_sha256")) && sourceRegistry.registry_sha256 === manifest.source_registry_sha256, "Model evidence source registry digest is invalid or substituted");
  assert(Array.isArray(sourceRegistry.entries) && sourceRegistry.entries.length === manifest.entries.length, "Model evidence source registry coverage is incomplete");
  for (const sourceEntry of sourceRegistry.entries) {
    const sourceKeys = ["evidence_id", "authority_class", "provider_id", "canonical_source_url", "allowed_domain", "source_revision", "acquired_at_utc", "acquisition_receipt_sha256", "artifact_path"];
    if (sourceEntry.authority_class === "COMPARATIVE_BENCHMARK") sourceKeys.push("model_source_urls");
    exactKeys(sourceEntry, sourceKeys, "Model evidence source registry entry");
    assert(["FIRST_PARTY_PROVIDER", "COMPARATIVE_BENCHMARK", "HOST_ATTESTATION"].includes(sourceEntry.authority_class), "Model source authority class is invalid");
    requireSha(sourceEntry.acquisition_receipt_sha256, "Model source acquisition receipt"); requireUtc(sourceEntry.acquired_at_utc, "Model source acquisition time");
    if (sourceEntry.authority_class === "FIRST_PARTY_PROVIDER") assert(sourceEntry.provider_id === "OPENAI" && sourceEntry.allowed_domain === "developers.openai.com", "First-party model source identity is not allowlisted");
    if (sourceEntry.authority_class === "COMPARATIVE_BENCHMARK") {
      assert(sourceEntry.provider_id === "ARTIFICIAL_ANALYSIS" && sourceEntry.allowed_domain === "artificialanalysis.ai", "Comparative model source identity is not allowlisted");
      exactKeys(sourceEntry.model_source_urls, ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"], "Comparative model source URL registry");
      const allowedComparativeUrls = {
        "gpt-5.6-luna": "https://artificialanalysis.ai/models/gpt-5-6-luna",
        "gpt-5.6-sol": "https://artificialanalysis.ai/models/gpt-5-6-sol",
        "gpt-5.6-terra": "https://artificialanalysis.ai/models/gpt-5-6-terra",
      };
      for (const [modelId, sourceUrl] of Object.entries(sourceEntry.model_source_urls)) {
        assert(new URL(sourceUrl).hostname === sourceEntry.allowed_domain && sourceUrl === allowedComparativeUrls[modelId], `Comparative model source URL is not canonical: ${modelId}`);
      }
    }
    if (sourceEntry.authority_class === "HOST_ATTESTATION") assert(sourceEntry.provider_id === "CURRENT_CODEX_HOST" && sourceEntry.allowed_domain === "HOST_ATTESTATION", "Host source identity is not allowlisted");
  }
  assert(Array.isArray(manifest.entries) && manifest.entries.length === snapshot.evidence.length, "Model evidence manifest coverage is incomplete");
  manifest.entries.forEach((entry) => exactKeys(entry, ["evidence_id", "path", "authority_class", "artifact_sha256", "file_sha256"], "Model evidence manifest entry"));
  const artifactByEvidence = new Map();
  snapshot.evidence.forEach((entry) => {
    const manifestEntry = manifest.entries.find((candidate) => candidate.evidence_id === entry.evidence_id);
    const sourceEntry = sourceRegistry.entries.find((candidate) => candidate.evidence_id === entry.evidence_id);
    assert(manifestEntry, `Model evidence is absent from canonical manifest: ${entry.evidence_id}`, "BENCHMARK_EVIDENCE_MISSING");
    assert(sourceEntry, `Model evidence is absent from canonical source registry: ${entry.evidence_id}`, "BENCHMARK_EVIDENCE_MISSING");
    assert(entry.artifact_path === path.posix.join(path.posix.dirname(evidenceManifestPath), manifestEntry.path), "Model evidence artifact path differs from canonical manifest");
    artifactByEvidence.set(entry.evidence_id, validateEvidence(entry, snapshotObservedMs, nowMs, manifestEntry, resolveArtifact(authorityRoot, entry.artifact_path), sourceEntry));
  });
  assert(new Set(snapshot.evidence.map((entry) => entry.evidence_id)).size === snapshot.evidence.length, "Model evidence IDs contain duplicates");
  assert(snapshot.evidence.some((entry) => entry.authority_class === "FIRST_PARTY_PROVIDER") && snapshot.evidence.some((entry) => entry.authority_class === "COMPARATIVE_BENCHMARK") && snapshot.evidence.some((entry) => entry.authority_class === "HOST_ATTESTATION"), "Model evidence authority coverage is incomplete");
  assert(Array.isArray(snapshot.conflicts), "Model-policy conflicts must be explicit");
  for (const conflict of snapshot.conflicts) {
    exactKeys(conflict, ["field", "first_party_value", "comparative_value", "resolution"], "Model-policy conflict");
    assert(/^gpt-[a-z0-9.-]+\.(?:input|output)_usd_per_million$/u.test(conflict.field), "Model-policy conflict field is not an allowlisted pricing identifier");
    assert(/^\d+(?:\.\d+)?$/u.test(conflict.first_party_value) && /^\d+(?:\.\d+)?$/u.test(conflict.comparative_value), "Model-policy conflict values must be numeric facts");
    assert(conflict.resolution === "FIRST_PARTY_GOVERNS", "Model-policy conflict does not honor first-party authority");
  }
  assert(Array.isArray(snapshot.models) && snapshot.models.length > 0, "Model-policy models are missing");
  const modelIds = new Set();
  const providerArtifact = [...artifactByEvidence.values()].find((artifact) => artifact.authority_class === "FIRST_PARTY_PROVIDER");
  const benchmarkArtifact = [...artifactByEvidence.values()].find((artifact) => artifact.authority_class === "COMPARATIVE_BENCHMARK");
  const hostArtifact = [...artifactByEvidence.values()].find((artifact) => artifact.authority_class === "HOST_ATTESTATION");
  for (const model of snapshot.models) {
    exactKeys(model, ["model_id", "provider_id", "provider_evidence_id", "benchmark_evidence_id", "host_evidence_id", "host_available", "availability_evidence", "capability_score", "input_usd_per_million", "output_usd_per_million", "output_tokens_per_second", "context_tokens", "supported_reasoning_efforts", "host_supported_reasoning_efforts", "capabilities"], "Model-policy model");
    assert(MODEL.test(model.model_id), "Model ID is invalid");
    assert(!modelIds.has(model.model_id), "Model-policy contains duplicate models");
    modelIds.add(model.model_id);
    assert(model.host_available === true || model.host_available === false, "Host availability is unknown", "HOST_MODEL_AVAILABILITY_UNKNOWN");
    assert(["HOST_DECLARED_NOT_EXECUTION_PROVEN", "EXECUTION_PROVEN_MEDIUM_ONLY_OTHER_EFFORTS_DECLARED", "HOST_EXECUTION_PROVEN", "HOST_UNAVAILABLE"].includes(model.availability_evidence), "Host availability evidence is not an allowlisted state");
    assert(Number.isFinite(model.capability_score) && model.capability_score >= 0, "Model capability score is invalid");
    assert(Number.isFinite(model.input_usd_per_million) && model.input_usd_per_million >= 0, "Model input cost is unknown", "MODEL_COST_UNKNOWN");
    assert(Number.isFinite(model.output_usd_per_million) && model.output_usd_per_million >= 0, "Model output cost is unknown", "MODEL_COST_UNKNOWN");
    assert(Number.isFinite(model.output_tokens_per_second) && model.output_tokens_per_second > 0, "Model latency evidence is missing");
    assert(Number.isInteger(model.context_tokens) && model.context_tokens > 0, "Model context is invalid");
    assert(Array.isArray(model.supported_reasoning_efforts) && model.supported_reasoning_efforts.length > 0, "Model reasoning modes are missing");
    model.supported_reasoning_efforts.forEach((effort) => assert(EFFORTS.has(effort), `Unsupported reasoning mode in policy: ${effort}`));
    assert(Array.isArray(model.host_supported_reasoning_efforts) && model.host_supported_reasoning_efforts.length > 0, "Host reasoning modes are missing");
    model.host_supported_reasoning_efforts.forEach((effort) => assert(EFFORTS.has(effort), `Unsupported host reasoning mode in policy: ${effort}`));
    assert(Array.isArray(model.capabilities) && model.capabilities.every((capability) => /^[A-Z][A-Z0-9_]{1,63}$/u.test(capability)), "Model capabilities are missing or invalid");
    assert(model.provider_id === providerArtifact.provider_id, "Model provider identity conflicts with first-party evidence");
    assert(model.provider_evidence_id === providerArtifact.evidence_id && model.benchmark_evidence_id === benchmarkArtifact.evidence_id && model.host_evidence_id === hostArtifact.evidence_id, "Model source bindings are incomplete");
    const providerModel = providerArtifact.summary.models.find((entry) => entry.model_id === model.model_id);
    const benchmarkModel = benchmarkArtifact.summary.models.find((entry) => entry.model_id === model.model_id);
    const hostModel = hostArtifact.summary.models.find((entry) => entry.model_id === model.model_id);
    assert(providerModel && benchmarkModel && hostModel, `Model is unlisted in a governing source: ${model.model_id}`, "MODEL_SOURCE_UNLISTED");
    for (const field of ["input_usd_per_million", "output_usd_per_million", "context_tokens", "supported_reasoning_efforts", "capabilities"]) assert(canonicalJson(model[field]) === canonicalJson(providerModel[field]), `First-party model fact conflict: ${model.model_id}.${field}`);
    assert(model.capability_score === benchmarkModel.capability_score && model.output_tokens_per_second === benchmarkModel.output_tokens_per_second, `Comparative capability/latency binding differs: ${model.model_id}`);
    assert(model.host_available === hostModel.available, `Host availability binding differs: ${model.model_id}`);
    assert(canonicalJson(model.host_supported_reasoning_efforts) === canonicalJson(hostModel.supported_reasoning_efforts), `Host reasoning support differs: ${model.model_id}`);
    for (const costField of ["input_usd_per_million", "output_usd_per_million"]) if (benchmarkModel[costField] !== providerModel[costField]) {
      assert(snapshot.conflicts.some((conflict) => conflict.field === `${model.model_id}.${costField}` && conflict.first_party_value === String(providerModel[costField]) && conflict.comparative_value === String(benchmarkModel[costField]) && conflict.resolution === "FIRST_PARTY_GOVERNS"), `Source pricing conflict is not explicitly resolved: ${model.model_id}.${costField}`);
    }
  }
  assert(providerArtifact.summary.models.length === snapshot.models.length && benchmarkArtifact.summary.models.length === snapshot.models.length && hostArtifact.summary.models.length === snapshot.models.length, "Snapshot model coverage differs from governing sources");
  assert(Array.isArray(snapshot.task_classes) && snapshot.task_classes.length === MODEL_POLICY_TASK_CLASSES.length, "Model-policy task-class matrix is incomplete");
  const taskIds = new Set();
  for (const task of snapshot.task_classes) {
    exactKeys(task, ["task_class", "minimum_capability_score", "minimum_context_tokens", "required_capabilities", "preferred_reasoning_effort", "preferred_models", "fallback_models", "max_input_usd_per_million", "max_output_usd_per_million", "max_concurrency", "max_heavyweight_processes", "max_evidence_age_days", "escalation_triggers"], "Model-policy task class");
    assert(MODEL_POLICY_TASK_CLASSES.includes(task.task_class), "Model-policy task class is invalid");
    taskIds.add(task.task_class);
    assert(Number.isFinite(task.minimum_capability_score) && task.minimum_capability_score >= 0, "Task capability floor is invalid");
    assert(Number.isInteger(task.minimum_context_tokens) && task.minimum_context_tokens > 0, "Task context floor is invalid");
    assert(Number.isFinite(task.max_input_usd_per_million) && Number.isFinite(task.max_output_usd_per_million), "Task cost boundary is unknown", "MODEL_COST_BOUNDARY_UNKNOWN");
    assert(Number.isInteger(task.max_concurrency) && task.max_concurrency > 0, "Task concurrency ceiling is invalid");
    assert(Number.isInteger(task.max_heavyweight_processes) && task.max_heavyweight_processes >= 0, "Task heavyweight ceiling is invalid");
    assert(Number.isInteger(task.max_evidence_age_days) && task.max_evidence_age_days > 0, "Task evidence age is invalid");
    assert(EFFORTS.has(task.preferred_reasoning_effort), "Task reasoning preference is invalid");
    assert(new Set(task.preferred_models).size === task.preferred_models.length && task.preferred_models.length > 0, "Task preferred models must be unique and nonempty");
    task.preferred_models.forEach((model) => assert(modelIds.has(model), `Task references an unknown model: ${model}`));
    assert(new Set(task.fallback_models).size === task.fallback_models.length, "Task fallback models must be unique");
    task.fallback_models.forEach((model) => assert(modelIds.has(model), `Task references an unknown fallback model: ${model}`));
    assert(task.preferred_models.every((model) => !task.fallback_models.includes(model)), "Task preferred and fallback routes overlap");
    assert(Array.isArray(task.required_capabilities) && task.required_capabilities.every((capability) => /^[A-Z][A-Z0-9_]{1,63}$/u.test(capability)), "Task capabilities are invalid");
    assert(Array.isArray(task.escalation_triggers) && task.escalation_triggers.length > 0 && task.escalation_triggers.every((trigger) => /^[A-Z][A-Z0-9_]{1,63}$/u.test(trigger)), "Task escalation triggers are missing or invalid");
  }
  assert(taskIds.size === MODEL_POLICY_TASK_CLASSES.length, "Model-policy task classes contain duplicates");
  requireSha(snapshot.snapshot_sha256, "Model-policy snapshot digest");
  assert(snapshot.snapshot_sha256 === canonicalDigest(digestBody(snapshot, "snapshot_sha256")), "Model-policy snapshot digest mismatch", "DIGEST_INVALID");
  return snapshot;
}

export function validateModelPolicySnapshot(snapshot, {nowUtc = snapshot?.observed_at_utc, requireActive = false, authorityRoot = undefined, evidenceManifestPath = undefined} = {}) {
  assert(authorityRoot === undefined && evidenceManifestPath === undefined, "Caller-supplied model evidence roots or manifests are forbidden");
  return validateModelPolicySnapshotAgainstEvidenceStore(snapshot, {nowUtc, requireActive, authorityRoot: MODULE_ROOT, evidenceManifestPath: DEFAULT_EVIDENCE_MANIFEST});
}

export function auditModelPolicyEvidenceStore(snapshot, {nowUtc = snapshot?.observed_at_utc, requireActive = false, authorityRoot, evidenceManifestPath = DEFAULT_EVIDENCE_MANIFEST} = {}) {
  return validateModelPolicySnapshotAgainstEvidenceStore(snapshot, {nowUtc, requireActive, authorityRoot, evidenceManifestPath});
}

function projectedCost(model) { return model.input_usd_per_million + (model.output_usd_per_million * 3); }

export function selectEcoModelRoute({snapshot, taskClass, roleCapabilityFloor, requiredContextTokens, requiredCapabilities = [], nowUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc, requireActive: true});
  assert(MODEL_POLICY_TASK_CLASSES.includes(taskClass), "Requested task class is invalid");
  const task = snapshot.task_classes.find((entry) => entry.task_class === taskClass);
  const capabilityFloor = Math.max(task.minimum_capability_score, roleCapabilityFloor);
  const contextFloor = Math.max(task.minimum_context_tokens, requiredContextTokens);
  const required = new Set([...task.required_capabilities, ...requiredCapabilities]);
  const capable = snapshot.models.filter((model) => model.host_available
    && model.capability_score >= capabilityFloor
    && model.context_tokens >= contextFloor
    && model.input_usd_per_million <= task.max_input_usd_per_million
    && model.output_usd_per_million <= task.max_output_usd_per_million
    && model.supported_reasoning_efforts.includes(task.preferred_reasoning_effort)
    && model.host_supported_reasoning_efforts.includes(task.preferred_reasoning_effort)
    && [...required].every((capability) => model.capabilities.includes(capability)));
  const preferred = capable.filter((model) => task.preferred_models.includes(model.model_id));
  const fallback = capable.filter((model) => task.fallback_models.includes(model.model_id));
  const candidates = preferred.length > 0 ? preferred : fallback;
  assert(candidates.length > 0, "No listed preferred or fallback model satisfies the task capability/cost/context/reasoning floor", "NO_CAPABLE_ECONOMICAL_MODEL");
  candidates.sort((left, right) => projectedCost(left) - projectedCost(right)
    || right.capability_score - left.capability_score
    || compareUtf8(left.model_id, right.model_id));
  const selected = candidates[0];
  const route = {
    schema: "agentos.eco_model_route.v1", version: 1, status: "READY", task_class: taskClass,
    model_id: selected.model_id, reasoning_effort: task.preferred_reasoning_effort,
    capability_floor: capabilityFloor, selected_capability_score: selected.capability_score,
    context_floor_tokens: contextFloor, selected_context_tokens: selected.context_tokens,
    input_usd_per_million: selected.input_usd_per_million, output_usd_per_million: selected.output_usd_per_million,
    max_concurrency: task.max_concurrency, max_heavyweight_processes: task.max_heavyweight_processes,
    route_class: preferred.length > 0 ? "PREFERRED" : "FALLBACK", fallback_models: task.fallback_models, escalation_triggers: task.escalation_triggers,
    snapshot_sha256: snapshot.snapshot_sha256, route_sha256: null,
  };
  route.route_sha256 = canonicalDigest(digestBody(route, "route_sha256"));
  return route;
}

export function validateEcoModelRoute(route, {snapshot} = {}) {
  exactKeys(route, ["schema", "version", "status", "task_class", "model_id", "reasoning_effort", "capability_floor", "selected_capability_score", "context_floor_tokens", "selected_context_tokens", "input_usd_per_million", "output_usd_per_million", "max_concurrency", "max_heavyweight_processes", "route_class", "fallback_models", "escalation_triggers", "snapshot_sha256", "route_sha256"], "ECO model route");
  assert(route.schema === "agentos.eco_model_route.v1" && route.version === 1 && route.status === "READY", "ECO route identity is invalid");
  assert(snapshot?.snapshot_sha256 === route.snapshot_sha256, "ECO route is bound to another snapshot");
  const model = snapshot.models.find((entry) => entry.model_id === route.model_id);
  assert(model && model.host_available, "ECO route model is unavailable or unlisted");
  assert(model.supported_reasoning_efforts.includes(route.reasoning_effort) && model.host_supported_reasoning_efforts.includes(route.reasoning_effort), "ECO route reasoning mode is unsupported on the current host");
  assert(model.capability_score === route.selected_capability_score && model.context_tokens === route.selected_context_tokens && model.input_usd_per_million === route.input_usd_per_million && model.output_usd_per_million === route.output_usd_per_million, "ECO route source facts differ");
  requireSha(route.route_sha256, "ECO route digest");
  assert(route.route_sha256 === canonicalDigest(digestBody(route, "route_sha256")), "ECO route digest mismatch");
  return route;
}

export function validateModelPolicyProjection(projection, {snapshot, expectedRoleClass = null, nowUtc = projection?.projected_at_utc} = {}) {
  exactKeys(projection, ["schema", "version", "status", "read_only", "role_class", "snapshot_sha256", "expires_at_utc", "spawn_eligible", "selected", "mutation_authority", "projected_at_utc", "projection_sha256"], "Model-policy projection");
  validateModelPolicySnapshot(snapshot, {nowUtc, requireActive: true});
  assert(projection.schema === MODEL_POLICY_PROJECTION_SCHEMA && projection.version === 1 && projection.status === "READY" && projection.read_only === true && projection.spawn_eligible === true, "Model-policy projection identity is invalid");
  assert(MODEL_POLICY_ROLE_CLASSES.includes(projection.role_class) && (expectedRoleClass === null || projection.role_class === expectedRoleClass), "Model-policy projection role differs");
  assert(projection.snapshot_sha256 === snapshot.snapshot_sha256 && projection.expires_at_utc === snapshot.expires_at_utc, "Model-policy projection snapshot is stale");
  assert(projection.mutation_authority === ["SPAWNER", "GOVERNED_MEMORY_ADAPTER"].includes(projection.role_class), "Model-policy projection writer authority differs");
  if (["INERT_SEED", "WORKING_AGENT"].includes(projection.role_class)) {
    exactKeys(projection.selected, ["model_id", "reasoning_effort", "capability_floor", "context_floor_tokens", "input_usd_per_million", "output_usd_per_million", "max_concurrency", "max_heavyweight_processes", "fallback_models", "escalation_triggers"], "Compact model-policy selection");
    const model = snapshot.models.find((entry) => entry.model_id === projection.selected.model_id);
    assert(model && model.host_available && model.capability_score >= projection.selected.capability_floor && model.context_tokens >= projection.selected.context_floor_tokens, "Compact projection model is unavailable or below its floor");
    assert(model.supported_reasoning_efforts.includes(projection.selected.reasoning_effort) && model.host_supported_reasoning_efforts.includes(projection.selected.reasoning_effort), "Compact projection reasoning is unsupported on the current host");
    assert(model.input_usd_per_million === projection.selected.input_usd_per_million && model.output_usd_per_million === projection.selected.output_usd_per_million, "Compact projection economics differ");
  } else assert(projection.selected === null, "Non-worker projection was widened with task selection");
  requireSha(projection.projection_sha256, "Model-policy projection digest");
  assert(projection.projection_sha256 === canonicalDigest(digestBody(projection, "projection_sha256")), "Model-policy projection digest mismatch");
  return projection;
}

export function compileModelPolicyProjection({snapshot, roleClass, selectedRoute = null, projectedAtUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc: projectedAtUtc, requireActive: true});
  assert(MODEL_POLICY_ROLE_CLASSES.includes(roleClass), "Model-policy projection role class is invalid");
  if (["INERT_SEED", "WORKING_AGENT"].includes(roleClass)) assert(selectedRoute !== null, `${roleClass} requires a selected compact route`);
  if (selectedRoute !== null) validateEcoModelRoute(selectedRoute, {snapshot});
  const projection = {
    schema: MODEL_POLICY_PROJECTION_SCHEMA, version: 1, status: "READY", read_only: true,
    role_class: roleClass, snapshot_sha256: snapshot.snapshot_sha256, expires_at_utc: snapshot.expires_at_utc,
    spawn_eligible: true,
    selected: selectedRoute === null ? null : {
      model_id: selectedRoute.model_id, reasoning_effort: selectedRoute.reasoning_effort,
      capability_floor: selectedRoute.capability_floor, context_floor_tokens: selectedRoute.context_floor_tokens,
      input_usd_per_million: selectedRoute.input_usd_per_million, output_usd_per_million: selectedRoute.output_usd_per_million,
      max_concurrency: selectedRoute.max_concurrency, max_heavyweight_processes: selectedRoute.max_heavyweight_processes,
      fallback_models: selectedRoute.fallback_models, escalation_triggers: selectedRoute.escalation_triggers,
    },
    mutation_authority: ["SPAWNER", "GOVERNED_MEMORY_ADAPTER"].includes(roleClass),
    projected_at_utc: projectedAtUtc, projection_sha256: null,
  };
  projection.projection_sha256 = canonicalDigest(digestBody(projection, "projection_sha256"));
  return validateModelPolicyProjection(projection, {snapshot, expectedRoleClass: roleClass, nowUtc: projectedAtUtc});
}

export function compileBootstrapModelPolicyContext({snapshot, selectedRoute, projectedAtUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc: projectedAtUtc, requireActive: true});
  const projections = MODEL_POLICY_ROLE_CLASSES.map((roleClass) => compileModelPolicyProjection({
    snapshot,
    roleClass,
    selectedRoute: ["INERT_SEED", "WORKING_AGENT"].includes(roleClass) ? selectedRoute : null,
    projectedAtUtc,
  }));
  const context = {
    schema: "agentos.bootstrap_model_policy_context.v1",
    version: 1,
    status: "READY",
    injection: "AUTOMATIC_BEFORE_ROSTER_OR_WORKER_ADMISSION",
    snapshot_sha256: snapshot.snapshot_sha256,
    projections,
    invalidation_rule: "A changed accepted snapshot invalidates every dependent compiled role context and inert seed; active workers retain their exact bound snapshot until handoff or typed safe refresh.",
    context_sha256: null,
  };
  context.context_sha256 = canonicalDigest(digestBody(context, "context_sha256"));
  return context;
}
