#!/usr/bin/env node

/* Resolve separately controlled evaluator output from a fixed sealed Git path. */

import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalJson} from "./content-addressing.mjs";
import {prepareProtectedEvaluatorProvisioning} from "./protected-evaluator-provisioning.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "./protected-spawner-review-provisioning.mjs";
import {assertSpawnerPortableInputs} from "./spawner-workspace-custody.mjs";
import {assertSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

const SHA = /^[0-9a-f]{64}$/u;
function fail(message, code = "CANONICAL_EVALUATOR_HANDOFF_INVALID") { const error = new Error(message); error.code = code; throw error; }
function safeJson(file, label) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is unsafe`); return JSON.parse(fs.readFileSync(file, "utf8")); }

export function resolveCanonicalSpawnerEvaluatorHandoff(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) || JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(["sealedAuthority"])) fail("Canonical evaluator handoff accepts only sealed authority", "CANONICAL_EVALUATOR_CALLER_AUTHORITY_FORBIDDEN");
  const {sealedAuthority} = options; assertSealedCanonicalAuthority(sealedAuthority);
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  assertSpawnerPortableInputs({repositoryRoot});
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  const gitCommon = fs.realpathSync.native(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repositoryRoot, encoding: "utf8"}).trim());
  const root = path.join(gitCommon, "agentos-independent-evaluator", commit);
  if (!fs.existsSync(root)) fail("Separately controlled evaluator handoff is not available for the current candidate", "CANONICAL_EVALUATOR_HANDOFF_REQUIRED");
  const realRoot = fs.realpathSync.native(root); if (realRoot !== root || fs.lstatSync(root).isSymbolicLink()) fail("Canonical evaluator handoff root is unsafe");
  const clearanceRoot = path.join(root, "clearance"), reviewRoot = path.join(root, "review");
  for (const directory of [clearanceRoot, reviewRoot]) if (!fs.existsSync(directory) || fs.realpathSync.native(directory) !== directory || fs.lstatSync(directory).isSymbolicLink()) fail("Canonical evaluator handoff directory is unsafe");
  const canonicalClearanceRegistry = readSealedAuthorityBinding(sealedAuthority, "spawner_independent_evaluator_registry").value;
  const canonicalReviewRegistry = readSealedAuthorityBinding(sealedAuthority, "spawner_external_reviewer_registry").value;
  if (canonicalJson(safeJson(path.join(clearanceRoot, "evaluator-registry.v2.json"), "Clearance registry")) !== canonicalJson(canonicalClearanceRegistry)) fail("Evaluator handoff clearance registry differs from sealed trust authority", "CANONICAL_EVALUATOR_REGISTRY_SUBSTITUTION");
  if (canonicalJson(safeJson(path.join(reviewRoot, "reviewer-registry.v1.json"), "Review registry")) !== canonicalJson(canonicalReviewRegistry)) fail("Evaluator handoff review registry differs from sealed trust authority", "CANONICAL_EVALUATOR_REGISTRY_SUBSTITUTION");
  const currentClearance = safeJson(path.join(clearanceRoot, "current-clearance.v1.json"), "Current clearance reference");
  if (currentClearance.schema !== "agentos.current_independent_spawner_clearance.v1" || currentClearance.version !== 1 || !SHA.test(currentClearance.receipt_sha256)) fail("Current independent clearance reference differs");
  const currentReview = safeJson(path.join(reviewRoot, "current-review.v1.json"), "Current review reference");
  if (currentReview.schema !== "agentos.current_external_spawner_review.v1" || currentReview.version !== 1 || !SHA.test(currentReview.receipt_sha256)) fail("Current external review reference differs");
  const evaluatorProvisioning = prepareProtectedEvaluatorProvisioning({sealedAuthority, clearanceStoreRoot: clearanceRoot, candidateRepositoryRoot: repositoryRoot});
  const reviewProvisioning = prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot: reviewRoot});
  return Object.freeze({evaluatorProvisioning, reviewProvisioning, clearance_receipt_sha256: currentClearance.receipt_sha256, review_receipt_sha256: currentReview.receipt_sha256, candidate_commit: commit});
}
