#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {auditModelPolicyEvidenceStore, compileModelPolicyProjection, selectEcoModelRoute, validateEcoModelRoute, validateModelPolicyProjection, validateModelPolicySnapshot} from "../control/eco-model-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-08-18T08:30:00.000Z";
const prepared = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json")));
const activate = (snapshot) => { snapshot.status = "ACCEPTED_ACTIVE"; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); return snapshot; };
const active = activate(structuredClone(prepared));
validateModelPolicySnapshot(active, {nowUtc: NOW, requireActive: true});
assert.equal(selectEcoModelRoute({snapshot: active, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE", "TOOLS"], nowUtc: NOW}).model_id, "gpt-5.6-luna");

const staleWithoutCallerClock = structuredClone(active);
staleWithoutCallerClock.observed_at_utc = "2020-01-01T00:00:00.000Z";
staleWithoutCallerClock.expires_at_utc = "2020-01-02T00:00:00.000Z";
staleWithoutCallerClock.snapshot_sha256 = canonicalDigest({...staleWithoutCallerClock, snapshot_sha256: null});
assert.throws(() => validateModelPolicySnapshot(staleWithoutCallerClock, {requireActive: true}), /stale/iu, "omitting validation time trusted the stale snapshot's own timestamp");

const narrowRoute = selectEcoModelRoute({snapshot: active, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE", "TOOLS"], nowUtc: NOW});
const forgedExpensivePreferred = structuredClone(narrowRoute);
const terra = active.models.find((model) => model.model_id === "gpt-5.6-terra");
Object.assign(forgedExpensivePreferred, {model_id: terra.model_id, selected_capability_score: terra.capability_score, selected_context_tokens: terra.context_tokens, input_usd_per_million: terra.input_usd_per_million, output_usd_per_million: terra.output_usd_per_million});
forgedExpensivePreferred.route_sha256 = canonicalDigest({...forgedExpensivePreferred, route_sha256: null});
assert.throws(() => validateEcoModelRoute(forgedExpensivePreferred, {snapshot: active}), /most economical/iu, "a more expensive preferred model bypassed economic selection");

const broadRoute = selectEcoModelRoute({snapshot: active, taskClass: "BROAD_ARCHITECTURE", roleCapabilityFloor: 55, requiredContextTokens: 256000, requiredCapabilities: ["CODE", "LONG_CONTEXT", "TOOLS"], nowUtc: NOW});
const forgedFallback = structuredClone(broadRoute);
const sol = active.models.find((model) => model.model_id === "gpt-5.6-sol");
Object.assign(forgedFallback, {model_id: sol.model_id, selected_capability_score: sol.capability_score, selected_context_tokens: sol.context_tokens, input_usd_per_million: sol.input_usd_per_million, output_usd_per_million: sol.output_usd_per_million, route_class: "FALLBACK"});
forgedFallback.route_sha256 = canonicalDigest({...forgedFallback, route_sha256: null});
assert.throws(() => validateEcoModelRoute(forgedFallback, {snapshot: active}), /most economical/iu, "fallback model bypassed an available preferred model");

const workerProjection = compileModelPolicyProjection({snapshot: active, roleClass: "WORKING_AGENT", selectedRoute: narrowRoute, projectedAtUtc: NOW});
const forgedProjection = structuredClone(workerProjection);
Object.assign(forgedProjection.selected, {model_id: terra.model_id, input_usd_per_million: terra.input_usd_per_million, output_usd_per_million: terra.output_usd_per_million});
forgedProjection.projection_sha256 = canonicalDigest({...forgedProjection, projection_sha256: null});
assert.throws(() => validateModelPolicyProjection(forgedProjection, {snapshot: active, expectedRoleClass: "WORKING_AGENT", nowUtc: NOW}), /most economical/iu, "a forged compact projection bypassed task routing");

function copiedAuthority() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-model-evidence-"));
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.cpSync(path.join(root, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
  return temp;
}
function rebindArtifact(authorityRoot, snapshot, evidenceId, mutate) {
  const manifestPath = path.join(authorityRoot, "fixtures/model-policy-evidence/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const entry = manifest.entries.find((item) => item.evidence_id === evidenceId);
  const artifactPath = path.join(authorityRoot, "fixtures/model-policy-evidence", entry.path);
  const artifact = JSON.parse(fs.readFileSync(artifactPath)); mutate(artifact);
  artifact.summary_sha256 = canonicalDigest(artifact.summary); artifact.artifact_sha256 = canonicalDigest({...artifact, artifact_sha256: null});
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  entry.artifact_sha256 = artifact.artifact_sha256; entry.file_sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null}); fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const evidence = snapshot.evidence.find((item) => item.evidence_id === evidenceId);
  Object.assign(evidence, {observed_at_utc: artifact.observed_at_utc, expires_at_utc: artifact.expires_at_utc, max_age_days: artifact.max_age_days, uncertainty: artifact.uncertainty, summary_sha256: artifact.summary_sha256, artifact_sha256: artifact.artifact_sha256, file_sha256: entry.file_sha256});
  snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null});
}
function hostile(mutate, pattern) {
  const authorityRoot = copiedAuthority(); const snapshot = structuredClone(active);
  try { mutate({authorityRoot, snapshot}); assert.throws(() => auditModelPolicyEvidenceStore(snapshot, {nowUtc: NOW, requireActive: true, authorityRoot}), pattern); }
  finally { fs.rmSync(authorityRoot, {recursive: true, force: true}); }
}
hostile(({authorityRoot}) => fs.unlinkSync(path.join(authorityRoot, "fixtures/model-policy-evidence/current-host.2026-08-18.json")), /ENOENT|artifact/iu);
hostile(({authorityRoot, snapshot}) => rebindArtifact(authorityRoot, snapshot, "HOST.CODEX_MODEL_CATALOG.2026-08-18", (artifact) => { artifact.observed_at_utc = "2026-08-18T17:00:00.000Z"; }), /future-dated/iu);
hostile(({snapshot}) => { snapshot.models.push({...snapshot.models[0], model_id: "unlisted-cheap-model"}); snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /unlisted|coverage differs/iu);
hostile(({snapshot}) => { snapshot.models[0].input_usd_per_million = 0.0001; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /First-party model fact conflict/iu);
hostile(({snapshot}) => { snapshot.task_classes[2].preferred_reasoning_effort = "ultra"; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /reasoning preference/iu);
hostile(({snapshot}) => { snapshot.conflicts = []; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /claims an explicit conflict|not explicitly resolved|Structured source conflicts/iu);
hostile(({snapshot}) => { snapshot.conflicts[0].comparative_value = "2"; snapshot.conflicts[0].conflict_sha256 = canonicalDigest({...snapshot.conflicts[0], conflict_sha256: null}); snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /not explicitly resolved|Structured source conflicts/iu);
hostile(({snapshot}) => { snapshot.conflicts[0].authority_ordering = ["COMPARATIVE_BENCHMARK", "FIRST_PARTY_PROVIDER"]; snapshot.conflicts[0].conflict_sha256 = canonicalDigest({...snapshot.conflicts[0], conflict_sha256: null}); snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null}); }, /authority ordering/iu);
hostile(({authorityRoot, snapshot}) => {
  rebindArtifact(authorityRoot, snapshot, "HOST.CODEX_MODEL_CATALOG.2026-08-18", (artifact) => artifact.summary.models.forEach((model) => { model.available = false; }));
}, /Host availability binding differs/iu);
hostile(({authorityRoot, snapshot}) => {
  const artifactPath = path.join(authorityRoot, "fixtures/model-policy-evidence/openai-model-catalog.2026-08-18.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath)); artifact.summary.observation_note = "tampered summary without digest repair"; fs.writeFileSync(artifactPath, JSON.stringify(artifact));
}, /file digest mismatch|summary digest mismatch/iu);
hostile(({authorityRoot, snapshot}) => rebindArtifact(authorityRoot, snapshot, "OPENAI.MODEL_CATALOG.2026-08-18", (artifact) => { artifact.source_url = "https://untrusted.invalid/models"; }), /canonical registry|source identity/iu);
hostile(({authorityRoot, snapshot}) => rebindArtifact(authorityRoot, snapshot, "OPENAI.MODEL_CATALOG.2026-08-18", (artifact) => { artifact.source_url = "https://developers.openai.com.lookalike.invalid/models"; }), /canonical registry|source identity|lookalike/iu);
hostile(({authorityRoot, snapshot}) => rebindArtifact(authorityRoot, snapshot, "ARTIFICIAL_ANALYSIS.GPT_5_6.2026-08-18", (artifact) => { artifact.summary.models[0].source_url = artifact.summary.models[1].source_url; }), /canonically bound/iu);
hostile(({authorityRoot, snapshot}) => rebindArtifact(authorityRoot, snapshot, "ARTIFICIAL_ANALYSIS.GPT_5_6.2026-08-18", (artifact) => { artifact.summary.models[0].source_url = "https://artificialanalysis.ai.lookalike.invalid/models/gpt-5-6-luna"; }), /canonically bound|lookalike/iu);
hostile(({authorityRoot}) => {
  const registryPath = path.join(authorityRoot, "fixtures/model-policy-evidence/source-registry.v1.json");
  const registry = JSON.parse(fs.readFileSync(registryPath));
  registry.entries[0].model_source_urls["gpt-5.6-luna"] = "https://untrusted.invalid/models/gpt-5-6-luna";
  registry.registry_sha256 = canonicalDigest({...registry, registry_sha256: null});
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}, /registry digest|source URL|allowlisted|canonical/iu);
assert.throws(() => validateModelPolicySnapshot(active, {nowUtc: NOW, requireActive: true, authorityRoot: copiedAuthority()}), /Caller-supplied model evidence roots/iu, "source registry substitution reached production validation");

console.log("PASS ECO model policy source binding: canonical files, trusted time, listed identity, first-party economics, host/reasoning support, and preferred economical routing");
