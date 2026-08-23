#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {auditModelPolicyEvidenceStore} from "./eco-model-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBSERVED_AT = "2026-08-23T00:36:45.000Z";
const PROVIDER_EXPIRES_AT = "2026-08-30T00:36:45.000Z";
const HOST_EXPIRES_AT = "2026-08-24T00:36:45.000Z";
const EVIDENCE_DIRECTORY = path.join(ROOT, "fixtures/model-policy-evidence");
const SNAPSHOT_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const PROVIDER_ID = "OPENAI.MODEL_CATALOG.2026-08-23";
const HOST_ID = "HOST.CODEX_MODEL_CATALOG.2026-08-23";
const BENCHMARK_ID = "ARTIFICIAL_ANALYSIS.GPT_5_6.2026-08-20";

function body(record, digestField) { return {...structuredClone(record), [digestField]: null}; }
function fileSha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeJson(target, value) { fs.writeFileSync(target, serialize(value), {encoding: "utf8", mode: 0o644}); }
function artifact(record) {
  record.summary_sha256 = canonicalDigest(record.summary);
  record.artifact_sha256 = canonicalDigest(body(record, "artifact_sha256"));
  return record;
}
function receipt(entry) {
  return canonicalDigest({
    evidence_id: entry.evidence_id,
    canonical_source_url: entry.canonical_source_url,
    final_url: entry.final_url,
    redirect_chain: entry.redirect_chain,
    expected_scheme: entry.expected_scheme,
    exact_path_segments: entry.exact_path_segments,
    content_type: entry.content_type,
    acquisition_method: entry.acquisition_method,
    source_revision: entry.source_revision,
    acquired_at_utc: entry.acquired_at_utc,
    provider_id: entry.provider_id,
  });
}

export function refreshModelPolicyEvidence() {
const provider = artifact({
  schema: "agentos.model_policy_source_artifact.v1",
  version: 1,
  evidence_id: PROVIDER_ID,
  authority_class: "FIRST_PARTY_PROVIDER",
  provider_id: "OPENAI",
  source_url: "https://developers.openai.com/api/docs/models/compare",
  observed_at_utc: OBSERVED_AT,
  expires_at_utc: PROVIDER_EXPIRES_AT,
  max_age_days: 7,
  uncertainty: "LOW",
  summary: {
    models: [
      {model_id: "gpt-5.6-luna", input_usd_per_million: 0.2, output_usd_per_million: 1.2, context_tokens: 1050000, supported_reasoning_efforts: ["none", "low", "medium", "high", "xhigh", "max"], capabilities: ["CODE", "LONG_CONTEXT", "TEXT", "TOOLS", "VISION"]},
      {model_id: "gpt-5.6-sol", input_usd_per_million: 4, output_usd_per_million: 20, context_tokens: 1050000, supported_reasoning_efforts: ["none", "low", "medium", "high", "xhigh", "max"], capabilities: ["CODE", "LONG_CONTEXT", "SECURITY", "TEXT", "TOOLS", "VISION"]},
      {model_id: "gpt-5.6-terra", input_usd_per_million: 2, output_usd_per_million: 12, context_tokens: 1050000, supported_reasoning_efforts: ["none", "low", "medium", "high", "xhigh", "max"], capabilities: ["CODE", "LONG_CONTEXT", "TEXT", "TOOLS", "VISION"]},
    ],
    observation_note: "Direct OpenAI compare-page readback governs model identity, pricing, context, and supported reasoning. Sol pricing differs from the retained comparative benchmark, and the structured snapshot conflict records apply first-party authority.",
  },
  summary_sha256: null,
  artifact_sha256: null,
});

const host = artifact({
  schema: "agentos.model_policy_source_artifact.v1",
  version: 1,
  evidence_id: HOST_ID,
  authority_class: "HOST_ATTESTATION",
  provider_id: "CURRENT_CODEX_HOST",
  source_url: "host-attestation:codex-model-catalog",
  observed_at_utc: OBSERVED_AT,
  expires_at_utc: HOST_EXPIRES_AT,
  max_age_days: 1,
  uncertainty: "LOW",
  summary: {
    host_id: "CURRENT_CODEX_HOST",
    models: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"].map((model_id) => ({model_id, available: true, supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"]})),
  },
  summary_sha256: null,
  artifact_sha256: null,
});

const providerPath = path.join(EVIDENCE_DIRECTORY, "openai-model-catalog.2026-08-23.json");
const hostPath = path.join(EVIDENCE_DIRECTORY, "current-host.2026-08-23.json");
writeJson(providerPath, provider);
writeJson(hostPath, host);

const benchmarkPath = path.join(EVIDENCE_DIRECTORY, "artificial-analysis.2026-08-20.json");
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
const providerBytes = fs.readFileSync(providerPath);
const hostBytes = fs.readFileSync(hostPath);
const benchmarkBytes = fs.readFileSync(benchmarkPath);

const registry = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIRECTORY, "source-registry.v1.json"), "utf8"));
const benchmarkRegistry = registry.entries.find((entry) => entry.evidence_id === BENCHMARK_ID);
const hostRegistry = {
  evidence_id: HOST_ID, authority_class: "HOST_ATTESTATION", provider_id: "CURRENT_CODEX_HOST",
  canonical_source_url: "host-attestation:codex-model-catalog", expected_scheme: "host-attestation:", exact_path_segments: ["codex-model-catalog"],
  query_policy: "DENY", fragment_policy: "DENY", port_policy: "NOT_APPLICABLE", redirect_policy: "NOT_APPLICABLE",
  content_type: "application/vnd.agentos.host-attestation+json", acquisition_method: "SUPPORTED_HOST_MODEL_CATALOG_READBACK",
  final_url: "host-attestation:codex-model-catalog", redirect_chain: [], allowed_domain: "HOST_ATTESTATION",
  source_revision: "HOST.CATALOG.2026-08-23", acquired_at_utc: OBSERVED_AT, acquisition_receipt_sha256: null,
  artifact_path: "fixtures/model-policy-evidence/current-host.2026-08-23.json",
};
hostRegistry.acquisition_receipt_sha256 = receipt(hostRegistry);
const providerRegistry = {
  evidence_id: PROVIDER_ID, authority_class: "FIRST_PARTY_PROVIDER", provider_id: "OPENAI",
  canonical_source_url: "https://developers.openai.com/api/docs/models/compare", expected_scheme: "https:", exact_path_segments: ["api", "docs", "models", "compare"],
  query_policy: "DENY", fragment_policy: "DENY", port_policy: "DEFAULT_ONLY", redirect_policy: "DENY", content_type: "text/html",
  acquisition_method: "GOVERNED_OFFICIAL_DOCUMENTATION_READBACK", final_url: "https://developers.openai.com/api/docs/models/compare", redirect_chain: [], allowed_domain: "developers.openai.com",
  source_revision: "DOCS.MODEL_COMPARE.2026-08-23", acquired_at_utc: OBSERVED_AT, acquisition_receipt_sha256: null,
  artifact_path: "fixtures/model-policy-evidence/openai-model-catalog.2026-08-23.json",
};
providerRegistry.acquisition_receipt_sha256 = receipt(providerRegistry);
registry.entries = [benchmarkRegistry, hostRegistry, providerRegistry].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
registry.registry_sha256 = canonicalDigest(body(registry, "registry_sha256"));
writeJson(path.join(EVIDENCE_DIRECTORY, "source-registry.v1.json"), registry);

const manifest = {
  schema: "agentos.model_policy_evidence_manifest.v1", version: 1, source_registry_sha256: registry.registry_sha256,
  entries: [
    {evidence_id: BENCHMARK_ID, path: "artificial-analysis.2026-08-20.json", authority_class: "COMPARATIVE_BENCHMARK", artifact_sha256: benchmark.artifact_sha256, file_sha256: fileSha(benchmarkBytes)},
    {evidence_id: HOST_ID, path: "current-host.2026-08-23.json", authority_class: "HOST_ATTESTATION", artifact_sha256: host.artifact_sha256, file_sha256: fileSha(hostBytes)},
    {evidence_id: PROVIDER_ID, path: "openai-model-catalog.2026-08-23.json", authority_class: "FIRST_PARTY_PROVIDER", artifact_sha256: provider.artifact_sha256, file_sha256: fileSha(providerBytes)},
  ].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
  manifest_sha256: null,
};
manifest.manifest_sha256 = canonicalDigest(body(manifest, "manifest_sha256"));
writeJson(path.join(EVIDENCE_DIRECTORY, "manifest.json"), manifest);

const previous = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
const evidenceRecord = (source, bytes) => ({
  evidence_id: source.evidence_id, authority_class: source.authority_class, observed_at_utc: source.observed_at_utc,
  expires_at_utc: source.expires_at_utc, max_age_days: source.max_age_days, uncertainty: source.uncertainty,
  artifact_sha256: source.artifact_sha256, file_sha256: fileSha(bytes), summary_sha256: source.summary_sha256, raw_transcript_stored: false,
});
const conflict = (field, providerValue, benchmarkValue) => {
  const record = {
    conflict_id: `CONFLICT.GPT_5_6_SOL.${field.endsWith("input_usd_per_million") ? "INPUT" : "OUTPUT"}_PRICE.2026-08-23`,
    field, first_party_evidence_id: PROVIDER_ID, first_party_artifact_sha256: provider.artifact_sha256,
    first_party_value: String(providerValue), comparative_evidence_id: BENCHMARK_ID, comparative_artifact_sha256: benchmark.artifact_sha256,
    comparative_value: String(benchmarkValue), authority_ordering: ["FIRST_PARTY_PROVIDER", "COMPARATIVE_BENCHMARK"], selected_value: String(providerValue),
    resolution: "FIRST_PARTY_GOVERNS", rationale_code: "PROVIDER_FACT_OVERRIDES_COMPARATIVE_ECONOMICS",
    observed_at_utc: OBSERVED_AT, expires_at_utc: PROVIDER_EXPIRES_AT, supersession_trigger: "ANY_BOUND_SOURCE_REVISION_OR_VALUE_CHANGE", conflict_sha256: null,
  };
  record.conflict_sha256 = canonicalDigest(body(record, "conflict_sha256"));
  return record;
};
const snapshot = structuredClone(previous);
Object.assign(snapshot, {observed_at_utc: OBSERVED_AT, expires_at_utc: HOST_EXPIRES_AT});
snapshot.evidence = [evidenceRecord(provider, providerBytes), evidenceRecord(benchmark, benchmarkBytes), evidenceRecord(host, hostBytes)];
snapshot.models.forEach((model) => {
  model.provider_evidence_id = PROVIDER_ID;
  model.host_evidence_id = HOST_ID;
  const facts = provider.summary.models.find((candidate) => candidate.model_id === model.model_id);
  Object.assign(model, {input_usd_per_million: facts.input_usd_per_million, output_usd_per_million: facts.output_usd_per_million, context_tokens: facts.context_tokens, supported_reasoning_efforts: facts.supported_reasoning_efforts, capabilities: facts.capabilities});
});
const providerSol = provider.summary.models.find((model) => model.model_id === "gpt-5.6-sol");
const benchmarkSol = benchmark.summary.models.find((model) => model.model_id === "gpt-5.6-sol");
snapshot.conflicts = [
  conflict("gpt-5.6-sol.input_usd_per_million", providerSol.input_usd_per_million, benchmarkSol.input_usd_per_million),
  conflict("gpt-5.6-sol.output_usd_per_million", providerSol.output_usd_per_million, benchmarkSol.output_usd_per_million),
];
snapshot.snapshot_sha256 = canonicalDigest(body(snapshot, "snapshot_sha256"));
writeJson(SNAPSHOT_PATH, snapshot);
auditModelPolicyEvidenceStore(snapshot, {nowUtc: OBSERVED_AT, requireActive: false, authorityRoot: ROOT});
process.stdout.write(`PASS refreshed model-policy evidence ${snapshot.snapshot_sha256}\n`);
return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshModelPolicyEvidence();
}
