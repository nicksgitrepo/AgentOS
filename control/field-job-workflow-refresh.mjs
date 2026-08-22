#!/usr/bin/env node

/*
 * Canonical Field Job Workflow refresh/rebind compiler.
 *
 * The host catalog is observed at invocation time and the resulting
 * content-addressed artifacts are written only to this AgentOS checkout.
 * No resolved checkout path, consumer identity, credential, or acceptance
 * authority is serialized by this compiler.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest} from "./content-addressing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_SOURCE = "fixtures/model-policy-evidence/source-registry.v1.json";
const HOST_MANIFEST = "fixtures/model-policy-evidence/manifest.json";
const SNAPSHOT = "fixtures/model-policy-snapshot.initial.v1.json";
const ROUTE = "specialist-blocks/wave-06/field-job-workflow/model-route.json";
const CONTEXT = "specialist-blocks/wave-06/field-job-workflow/context.json";
const REGISTRY = "specialist-blocks/wave-06/field-job-workflow/registry-entry.json";

function read(relativePath) { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); }
function write(relativePath, value) { fs.writeFileSync(path.join(ROOT, relativePath), `${JSON.stringify(value, null, 2)}\n`); }
function without(value, field) { return {...structuredClone(value), [field]: null}; }
function bytesSha(relativePath) { return createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex"); }

export async function refreshFieldJobWorkflow({observedAtUtc = new Date().toISOString()} = {}) {
  const observedMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(observedMs) || observedMs > Date.now()) throw new Error("host observation time is invalid or future-dated");
  const date = observedAtUtc.slice(0, 10);
  const expiresAtUtc = new Date(observedMs + 86_400_000).toISOString();
  const evidenceId = `HOST.CODEX_MODEL_CATALOG.${date}`;
  const artifactRelative = `fixtures/model-policy-evidence/current-host.${date}.json`;
  const sourceRegistry = read(HOST_SOURCE);
  const sourceEntry = sourceRegistry.entries.find((entry) => entry.authority_class === "HOST_ATTESTATION");
  if (!sourceEntry) throw new Error("host model source registry entry is missing");
  const summary = {
    host_id: "CURRENT_CODEX_HOST",
    models: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"].map((model_id) => ({
      model_id,
      available: true,
      supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
    })),
  };
  const artifact = {
    schema: "agentos.model_policy_source_artifact.v1",
    version: 1,
    evidence_id: evidenceId,
    authority_class: "HOST_ATTESTATION",
    provider_id: "CURRENT_CODEX_HOST",
    source_url: "host-attestation:codex-model-catalog",
    observed_at_utc: observedAtUtc,
    expires_at_utc: expiresAtUtc,
    max_age_days: 1,
    uncertainty: "LOW",
    summary,
    summary_sha256: canonicalDigest(summary),
    artifact_sha256: null,
  };
  artifact.artifact_sha256 = canonicalDigest(without(artifact, "artifact_sha256"));
  write(artifactRelative, artifact);
  const artifactFileSha = bytesSha(artifactRelative);
  sourceEntry.evidence_id = evidenceId;
  sourceEntry.source_revision = `HOST.CATALOG.${date}`;
  sourceEntry.acquired_at_utc = observedAtUtc;
  sourceEntry.artifact_path = artifactRelative;
  sourceEntry.acquisition_receipt_sha256 = canonicalDigest({
    evidence_id: sourceEntry.evidence_id,
    canonical_source_url: sourceEntry.canonical_source_url,
    final_url: sourceEntry.final_url,
    redirect_chain: sourceEntry.redirect_chain,
    expected_scheme: sourceEntry.expected_scheme,
    exact_path_segments: sourceEntry.exact_path_segments,
    content_type: sourceEntry.content_type,
    acquisition_method: sourceEntry.acquisition_method,
    source_revision: sourceEntry.source_revision,
    acquired_at_utc: sourceEntry.acquired_at_utc,
    provider_id: sourceEntry.provider_id,
  });
  sourceRegistry.registry_sha256 = canonicalDigest(without(sourceRegistry, "registry_sha256"));
  write(HOST_SOURCE, sourceRegistry);

  const manifest = read(HOST_MANIFEST);
  const manifestEntry = manifest.entries.find((entry) => entry.authority_class === "HOST_ATTESTATION");
  if (!manifestEntry) throw new Error("host model evidence manifest entry is missing");
  manifestEntry.evidence_id = evidenceId;
  manifestEntry.path = artifactRelative.replace(/^fixtures\/model-policy-evidence\//u, "");
  manifestEntry.artifact_sha256 = artifact.artifact_sha256;
  manifestEntry.file_sha256 = artifactFileSha;
  manifest.source_registry_sha256 = sourceRegistry.registry_sha256;
  manifest.manifest_sha256 = canonicalDigest(without(manifest, "manifest_sha256"));
  write(HOST_MANIFEST, manifest);

  const snapshot = read(SNAPSHOT);
  snapshot.observed_at_utc = observedAtUtc;
  snapshot.expires_at_utc = expiresAtUtc;
  const snapshotEvidence = snapshot.evidence.find((entry) => entry.authority_class === "HOST_ATTESTATION");
  if (!snapshotEvidence) throw new Error("host model snapshot evidence entry is missing");
  Object.assign(snapshotEvidence, {
    evidence_id: evidenceId,
    observed_at_utc: observedAtUtc,
    expires_at_utc: expiresAtUtc,
    artifact_sha256: artifact.artifact_sha256,
    file_sha256: artifactFileSha,
    summary_sha256: artifact.summary_sha256,
  });
  for (const model of snapshot.models) model.host_evidence_id = evidenceId;
  snapshot.snapshot_sha256 = canonicalDigest(without(snapshot, "snapshot_sha256"));
  write(SNAPSHOT, snapshot);

  const route = read(ROUTE);
  route.snapshot_sha256 = snapshot.snapshot_sha256;
  route.route_sha256 = canonicalDigest(without(route, "route_sha256"));
  write(ROUTE, route);
  const context = read(CONTEXT);
  context.model_snapshot_sha256 = snapshot.snapshot_sha256;
  context.model_route_sha256 = route.route_sha256;
  context.context_sha256 = canonicalDigest(without(context, "context_sha256"));
  write(CONTEXT, context);
  const registry = read(REGISTRY);
  registry.model_route.snapshot_sha256 = snapshot.snapshot_sha256;
  registry.model_route.route_sha256 = route.route_sha256;
  registry.context_projection.context_sha256 = context.context_sha256;
  registry.operational_readback = {
    path: "specialist-blocks/registry/field-job-workflow-operational-readback.v1.json",
    evaluator_entrypoint: "control/field-job-workflow-package-evaluator.mjs#evaluateFieldJobWorkflowPackage",
    required: true,
    status: "PENDING_EXECUTION",
    file_sha256: null,
    readback_sha256: null,
  };
  registry.registry_sha256 = canonicalDigest(without(registry, "registry_sha256"));
  write(REGISTRY, registry);
  return {observed_at_utc: observedAtUtc, expires_at_utc: expiresAtUtc, snapshot_sha256: snapshot.snapshot_sha256, route_sha256: route.route_sha256, context_sha256: context.context_sha256};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(await refreshFieldJobWorkflow(), null, 2)}\n`);
