#!/usr/bin/env node

/* Immutable review binding for one OpenAPI candidate commit/tree. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8, scanPersistedRecord} from "./content-addressing.mjs";
import {compileOpenApiContractsContext, resolveOpenApiContractsCanonicalAuthority, validateOpenApiContractsContext} from "./openapi-contracts-authority-binding.mjs";

export const OPENAPI_CONTRACTS_CANDIDATE_BINDING_SCHEMA = "agentos.openapi_contracts_candidate_binding.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "specialist-blocks/wave-02/openapi-contracts";
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness",
  "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime",
  "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);

function fail(message, code = "OPENAPI_CONTRACTS_CANDIDATE_BINDING_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(condition, message, code) { if (!condition) fail(message, code); }
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function fileSha(file) { return sha(fs.readFileSync(file)); }
function git(root, args) { try { return execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); } catch (error) { fail(`git readback failed: ${args.join(" ")}: ${error.stderr?.trim() || error.message}`, "OPENAPI_CONTRACTS_GIT_READBACK_FAILED"); } }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} is not a SHA-256`, "OPENAPI_CONTRACTS_CANDIDATE_DIGEST_INVALID"); }
function requireGitObject(value, label) { assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} is not a Git object ID`, "OPENAPI_CONTRACTS_CANDIDATE_GIT_OBJECT_INVALID"); }

function packageInventory(root) {
  const packageRoot = path.join(root, PACKAGE);
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json", "model-policy-route.json", "context-binding.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "operational-fixtures")).filter((name) => name.endsWith(".json"))) files.push(`operational-fixtures/${name}`);
  files.push("registry-entry.json");
  return files.sort(compareUtf8).map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: fileSha(path.join(packageRoot, relative_path))}));
}

function gitObject(root, expression, label) {
  const value = git(root, ["rev-parse", "--verify", expression]);
  requireGitObject(value, label);
  return value;
}

function assertClean(root) {
  assert(git(root, ["status", "--porcelain=v1"]) === "", "builder worktree is not clean at freeze", "OPENAPI_CONTRACTS_CUSTODY_DIRTY");
}

export function freezeOpenApiContractsCandidate({repositoryRoot = ROOT, candidateCommit, baseCommit, custodyOwner = "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS"} = {}) {
  const root = path.resolve(repositoryRoot);
  assert(git(root, ["rev-parse", "--show-toplevel"]) === root, "candidate freeze root is not the assigned Git root", "OPENAPI_CONTRACTS_CUSTODY_ROOT_INVALID");
  assert(custodyOwner === "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS", "candidate freeze custody owner is out of lane", "OPENAPI_CONTRACTS_CUSTODY_OWNER_INVALID");
  assertClean(root);
  const actualHead = gitObject(root, "HEAD", "candidate commit");
  const resolvedCandidate = candidateCommit ? gitObject(root, candidateCommit, "candidate commit") : actualHead;
  assert(resolvedCandidate === actualHead, "candidate freeze must bind the current clean HEAD", "OPENAPI_CONTRACTS_CANDIDATE_HEAD_MISMATCH");
  const resolvedBase = gitObject(root, baseCommit, "rollback commit");
  assert(git(root, ["merge-base", "--is-ancestor", resolvedBase, resolvedCandidate]) === "" || resolvedBase === resolvedCandidate, "rollback commit is not an ancestor of the candidate", "OPENAPI_CONTRACTS_ROLLBACK_ANCESTRY_INVALID");
  const candidateTree = gitObject(root, `${resolvedCandidate}^{tree}`, "candidate tree");
  const rollbackTree = gitObject(root, `${resolvedBase}^{tree}`, "rollback tree");
  const authority = resolveOpenApiContractsCanonicalAuthority();
  const files = packageInventory(root);
  const packageRootSha256 = canonicalDigest(files);
  const context = compileOpenApiContractsContext({authority, candidateCommit: resolvedCandidate, candidateTree, custodyStatus: "FROZEN_FOR_REVIEW"});
  validateOpenApiContractsContext(context, authority);
  const packageRoot = path.join(root, PACKAGE);
  const modelPolicySnapshot = json(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"));
  const modelRoute = json(path.join(packageRoot, "model-policy-route.json"));
  const binding = {
    schema: OPENAPI_CONTRACTS_CANDIDATE_BINDING_SCHEMA,
    version: 1,
    status: "FROZEN_FOR_INDEPENDENT_REVIEW",
    package_id: PACKAGE,
    block_id: authority.block_id,
    stable_agent_id: "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS",
    candidate_commit: resolvedCandidate,
    candidate_tree: candidateTree,
    base_commit: resolvedBase,
    rollback: {
      rollback_commit: resolvedBase,
      rollback_tree: rollbackTree,
      verified: true,
      strategy: "EXACT_LAST_CLEAN_AUTHORITY_TIP",
      external_action: false,
    },
    package_root_sha256: packageRootSha256,
    package_files: files,
    block_sha256: authority.block_sha256,
    gate_manifest_sha256: fileSha(path.join(packageRoot, "gates/manifest.json")),
    gate_execution_sha256: fileSha(path.join(packageRoot, "gates/execution.json")),
    gate_inventory: files.filter((entry) => entry.relative_path.includes("/gates/")),
    fixture_inventory: files.filter((entry) => entry.relative_path.includes("/fixtures/")),
    model_policy: {
      snapshot_file: "fixtures/model-policy-snapshot.initial.v1.json",
      snapshot_file_sha256: fileSha(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json")),
      snapshot_sha256: modelPolicySnapshot.snapshot_sha256,
      route_file: `${PACKAGE}/model-policy-route.json`,
      route_file_sha256: fileSha(path.join(packageRoot, "model-policy-route.json")),
      route_sha256: modelRoute.route_sha256,
      model_id: "gpt-5.6-luna",
      reasoning_effort: "max",
      spawn_eligible: false,
    },
    context: {
      artifact_path: `${PACKAGE}/context-binding.json`,
      artifact_sha256: fileSha(path.join(packageRoot, "context-binding.json")),
      artifact_context_sha256: json(path.join(packageRoot, "context-binding.json")).context_sha256,
      frozen_context_sha256: context.context_sha256,
      frozen_context: context,
    },
    source_binding: {
      source_manifest_sha256: authority.source_manifest_sha256,
      source_id: authority.source_id,
      source_version: authority.source_version,
      standard_block_sha256: authority.standard_block_sha256,
      standard_source_manifest_sha256: authority.standard_source_manifest_sha256,
      upstream_router_block_sha256: authority.router_block_sha256,
      upstream_router_result_sha256: authority.router_result_sha256,
    },
    custody: {
      owner: custodyOwner,
      builder_worktree: root,
      builder_branch: git(root, ["branch", "--show-current"]),
      builder_worktree_clean: true,
      auditor_read_only: true,
      auditor_can_edit: false,
      auditor_can_merge: false,
      auditor_can_admit: false,
      protected_authority_untouched: true,
      deployment: false,
      publication: false,
      promotion: false,
    },
    review: {
      required_identity: "AGENTOS.INDEPENDENT_AUDITOR",
      model_id: "gpt-5.6-luna",
      reasoning_effort: "max",
      public_entrypoint: "control/openapi-contracts-boundary-gate.mjs#evaluateOpenApiContractsBoundary",
      package_evaluator: "control/openapi-contracts-package-evaluator.mjs#evaluateOpenApiContractsPackage",
      exact_fixture_inputs: true,
      caller_pass_flags_ignored: true,
      acceptance_authority: "SPAWNER_ONLY",
    },
    scope: {
      exact_package: PACKAGE,
      exact_block: authority.block_id,
      non_goals: ["consumer_projects", "credentials", "deployment", "publication", "protected_branches"],
    },
    admission_allowed: false,
    activation: "OFF",
    binding_sha256: null,
  };
  assert(scanPersistedRecord(binding).safe, "candidate binding contains protected data", "OPENAPI_CONTRACTS_CANDIDATE_PRIVACY_DENIED");
  binding.binding_sha256 = canonicalDigest({...binding, binding_sha256: null});
  return Object.freeze(binding);
}

export function validateOpenApiContractsCandidateBinding(binding, {repositoryRoot = ROOT} = {}) {
  assert(binding?.schema === OPENAPI_CONTRACTS_CANDIDATE_BINDING_SCHEMA && binding.version === 1, "candidate binding schema is invalid", "OPENAPI_CONTRACTS_CANDIDATE_SCHEMA_INVALID");
  requireSha(binding.binding_sha256, "candidate binding");
  assert(binding.binding_sha256 === canonicalDigest({...binding, binding_sha256: null}), "candidate binding digest is invalid", "OPENAPI_CONTRACTS_CANDIDATE_DIGEST_INVALID");
  assert(binding.status === "FROZEN_FOR_INDEPENDENT_REVIEW" && binding.admission_allowed === false && binding.activation === "OFF", "candidate binding is not frozen inactive custody", "OPENAPI_CONTRACTS_CANDIDATE_STATE_INVALID");
  const root = path.resolve(repositoryRoot);
  assertClean(root);
  const actualHead = gitObject(root, "HEAD", "candidate commit");
  const actualTree = gitObject(root, `${actualHead}^{tree}`, "candidate tree");
  assert(actualHead === binding.candidate_commit && actualTree === binding.candidate_tree, "candidate binding is stale or points at another tree", "OPENAPI_CONTRACTS_CANDIDATE_STALE");
  const files = packageInventory(root);
  assert(canonicalDigest(files) === binding.package_root_sha256 && JSON.stringify(files) === JSON.stringify(binding.package_files), "candidate package bytes differ from frozen bytes", "OPENAPI_CONTRACTS_CANDIDATE_BYTES_CHANGED");
  assert(binding.custody.builder_worktree_clean === true && binding.custody.auditor_read_only === true && binding.custody.auditor_can_edit === false, "candidate custody is not read-only for the auditor", "OPENAPI_CONTRACTS_CUSTODY_INVALID");
  assert(binding.custody.builder_worktree === root, "candidate binding worktree differs", "OPENAPI_CONTRACTS_CUSTODY_ROOT_INVALID");
  return binding;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const outputIndex = process.argv.indexOf("--output");
  const baseIndex = process.argv.indexOf("--base");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : null;
  if (!base) fail("--base is required for a rollback-bound candidate freeze", "OPENAPI_CONTRACTS_ROLLBACK_REQUIRED");
  const binding = freezeOpenApiContractsCandidate({repositoryRoot: process.cwd(), baseCommit: base});
  if (output) fs.writeFileSync(path.resolve(process.cwd(), output), `${JSON.stringify(binding, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${JSON.stringify(binding, null, 2)}\n`);
}
