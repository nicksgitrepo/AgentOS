#!/usr/bin/env node

/*
 * Read-only Cloudflare Cache lane preflight.
 *
 * This entrypoint binds itself to the active repository root, reads the
 * sealed roster/model authority, and asks the canonical evaluator resolver
 * for the current candidate handoff. It never accepts a caller root, writes
 * governance state, or turns a protected blocker into clearance.
 */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {resolveCanonicalSpawnerEvaluatorHandoff} from "./canonical-spawner-evaluator-handoff.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";
import {getSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityIdentity, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PACKAGE_PATH = "specialist-blocks/wave-02/cloudflare-cache";
const STABLE_AGENT_ID = "AGENT.PLATFORM_CLOUDFLARE_CACHE";
const BLOCK_ID = "specialist.platform.cloudflare-cache";
const ROSTER_BINDINGS = Object.freeze([
  ["reusable_agent_roster_registry", "specialist-blocks/registry/agent-roster.v1.json"],
  ["specialist_roster_registry", "specialist-blocks/registry/roster.v1.json"],
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

function fail(message, code = "CLOUDFLARE_CACHE_REBIND_PREFLIGHT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function json(relativePath) {
  const file = path.join(ROOT, relativePath);
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Preflight artifact is not a regular file: ${relativePath}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(args) {
  return execFileSync("git", args, {cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
}

function candidateIdentity() {
  const commit = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  const parent = git(["rev-parse", "HEAD^1"]);
  const parentTree = git(["rev-parse", "HEAD^1^{tree}"]);
  const gitCommonDirectory = fs.realpathSync.native(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const status = git(["status", "--porcelain"]);
  const cleanPreview = git(["clean", "-nd"]);
  assert(GIT_OBJECT.test(commit) && GIT_OBJECT.test(tree) && GIT_OBJECT.test(parent) && GIT_OBJECT.test(parentTree), "Candidate Git identity is not content-addressed", "CLOUDFLARE_CACHE_CANDIDATE_IDENTITY_INVALID");
  return Object.freeze({
    repository_root: ROOT,
    branch: git(["branch", "--show-current"]),
    commit,
    tree,
    rollback: {commit: parent, tree: parentTree},
    git_common_directory: gitCommonDirectory,
    worktree_clean: status === "" && cleanPreview === "",
  });
}

function blocked(error, fallbackCode) {
  return Object.freeze({
    status: "BLOCKED_EXACT",
    code: typeof error?.code === "string" && error.code.length > 0 ? error.code : fallbackCode,
    message: String(error?.message ?? error),
  });
}

function rosterPreflight(sealedAuthority) {
  const binding = json("schemas/bootstrap-binding.v1.json");
  const bindings = ROSTER_BINDINGS.map(([bindingId, relativePath]) => {
    const declared = binding.normative?.[bindingId];
    assert(declared?.path === relativePath && SHA256.test(declared.sha256), `Roster binding ${bindingId} is not declared canonically`, "CLOUDFLARE_CACHE_ROSTER_BINDING_INVALID");
    const localBytes = fs.readFileSync(path.join(ROOT, relativePath));
    const localSha256 = sha256(localBytes);
    const sealedReadback = readSealedAuthorityBinding(sealedAuthority, bindingId);
    assert(localSha256 === declared.sha256 && localSha256 === sealedReadback.file_sha256, `Roster binding ${bindingId} is stale after canonical rebind`, "CLOUDFLARE_CACHE_ROSTER_BINDING_DRIFT");
    assert(Buffer.compare(localBytes, sealedReadback.bytes) === 0, `Roster binding ${bindingId} differs from sealed readback`, "CLOUDFLARE_CACHE_ROSTER_BINDING_DRIFT");
    return Object.freeze({binding_id: bindingId, path: relativePath, file_sha256: localSha256, sealed_readback_sha256: sealedReadback.file_sha256});
  });

  const agentRoster = JSON.parse(fs.readFileSync(path.join(ROOT, ROSTER_BINDINGS[0][1]), "utf8"));
  const specialistRoster = JSON.parse(fs.readFileSync(path.join(ROOT, ROSTER_BINDINGS[1][1]), "utf8"));
  const agentEntry = agentRoster.entries?.find((entry) => entry.stable_agent_id === STABLE_AGENT_ID);
  const block = json(`${PACKAGE_PATH}/block.json`);
  const specialistEntry = specialistRoster.blocks?.find((entry) => entry.block_id === BLOCK_ID);
  assert(agentEntry?.canonical_block_id === BLOCK_ID && agentEntry.package_path === PACKAGE_PATH && agentEntry.family === "platform", "Cloudflare Cache reusable roster entry is not canonical", "CLOUDFLARE_CACHE_ROSTER_ENTRY_INVALID");
  assert(specialistEntry?.candidate_digest === block.block_sha256, "Cloudflare Cache specialist roster candidate digest is stale", "CLOUDFLARE_CACHE_SPECIALIST_ROSTER_DRIFT");
  return Object.freeze({
    status: "PASS",
    code: null,
    bindings,
    package_entry: {stable_agent_id: STABLE_AGENT_ID, canonical_block_id: BLOCK_ID, package_path: PACKAGE_PATH, family: agentEntry.family, candidate_digest: specialistEntry.candidate_digest},
  });
}

function modelPolicyPreflight(sealedAuthority) {
  try {
    const snapshotBinding = readSealedAuthorityBinding(sealedAuthority, "initial_model_policy_snapshot_fixture");
    const snapshot = snapshotBinding.value;
    const identity = {
      binding_id: snapshotBinding.binding_id,
      relative_path: snapshotBinding.relative_path,
      file_sha256: snapshotBinding.file_sha256,
      snapshot_sha256: snapshot.snapshot_sha256,
      snapshot_status: snapshot.status,
      observed_at_utc: snapshot.observed_at_utc,
      expires_at_utc: snapshot.expires_at_utc,
    };
    try {
      validateModelPolicySnapshot(snapshot, {requireActive: false});
    } catch (error) {
      return Object.freeze({...blocked(error, "POLICY_SNAPSHOT_VALIDATION_FAILED"), ...identity});
    }
    try {
      validateModelPolicySnapshot(snapshot, {requireActive: true});
    } catch (error) {
      return Object.freeze({...blocked(error, "POLICY_SNAPSHOT_ADMISSION_FAILED"), ...identity});
    }
    return Object.freeze({status: "PASS", code: null, ...identity});
  } catch (error) {
    return blocked(error, "POLICY_SNAPSHOT_PREFLIGHT_FAILED");
  }
}

function evaluatorPreflight(sealedAuthority, candidate) {
  const handoffRoot = path.join(candidate.git_common_directory, "agentos-independent-evaluator", candidate.commit);
  try {
    const handoff = resolveCanonicalSpawnerEvaluatorHandoff({sealedAuthority});
    return Object.freeze({status: "PASS", code: null, handoff_root: handoffRoot, candidate_commit: handoff.candidate_commit, clearance_receipt_sha256: handoff.clearance_receipt_sha256, review_receipt_sha256: handoff.review_receipt_sha256});
  } catch (error) {
    return Object.freeze({...blocked(error, "CANONICAL_EVALUATOR_PREFLIGHT_FAILED"), handoff_root: handoffRoot, handoff_root_exists: fs.existsSync(handoffRoot)});
  }
}

function nextAction(roster, modelPolicy, evaluator, candidate) {
  const actions = [];
  if (candidate.worktree_clean === false) actions.push("Builder must freeze a clean immutable candidate commit and bind its rollback identity before review.");
  if (roster.status !== "PASS") actions.push("Spawner/root must repair and rebind the canonical reusable and specialist roster readbacks before any evaluator request.");
  if (modelPolicy.status !== "PASS") actions.push("Spawner/root must obtain a fresh canonical HOST.CODEX_MODEL_CATALOG attestation and validated active model-policy snapshot, then invalidate and rebind dependent model routes, contexts, memory, and roster projections.");
  if (evaluator.status !== "PASS") actions.push("Spawner/root must obtain the separately controlled signed evaluator and reviewer handoff for this exact candidate before requesting a fresh independent Luna-max audit.");
  return actions.length > 0 ? actions.join(" ") : "Freeze this candidate and request a fresh independent Luna-max audit against these exact bindings.";
}

export function runCloudflareCacheRebindPreflight() {
  const candidate = candidateIdentity();
  const block = json(`${PACKAGE_PATH}/block.json`);
  let sealedAuthority;
  let authority;
  try {
    sealedAuthority = getSealedCanonicalAuthority();
    authority = {identity: sealedAuthorityIdentity(sealedAuthority), repository_root: sealedAuthorityRepositoryRoot(sealedAuthority)};
  } catch (error) {
    const failure = blocked(error, "SEALED_AUTHORITY_PREFLIGHT_FAILED");
    const result = {schema: "agentos.cloudflare_cache_rebind_preflight.v1", version: 1, status: "BLOCKED_EXACT", observed_at_utc: new Date().toISOString(), candidate, package: {stable_agent_id: STABLE_AGENT_ID, block_id: block.block_id, package_path: PACKAGE_PATH, block_sha256: block.block_sha256}, authority: null, roster: failure, model_policy: failure, evaluator_handoff: failure, next_action: "Spawner/root must repair or refresh the sealed canonical authority before any roster, model-policy, or evaluator rebind can proceed.", preflight_sha256: null};
    result.preflight_sha256 = canonicalDigest({...result, preflight_sha256: null});
    return Object.freeze(result);
  }

  let roster;
  try {
    roster = rosterPreflight(sealedAuthority);
  } catch (error) {
    roster = blocked(error, "CLOUDFLARE_CACHE_ROSTER_PREFLIGHT_FAILED");
  }
  const modelPolicy = modelPolicyPreflight(sealedAuthority);
  const evaluator = evaluatorPreflight(sealedAuthority, candidate);
  const status = candidate.worktree_clean && [roster, modelPolicy, evaluator].every((probe) => probe.status === "PASS") ? "READY_FOR_FRESH_AUDIT" : "BLOCKED_EXACT";
  const result = {
    schema: "agentos.cloudflare_cache_rebind_preflight.v1",
    version: 1,
    status,
    observed_at_utc: new Date().toISOString(),
    candidate,
    package: {stable_agent_id: STABLE_AGENT_ID, block_id: block.block_id, package_path: PACKAGE_PATH, block_sha256: block.block_sha256},
    authority,
    roster,
    model_policy: modelPolicy,
    evaluator_handoff: evaluator,
    next_action: nextAction(roster, modelPolicy, evaluator, candidate),
    preflight_sha256: null,
  };
  result.preflight_sha256 = canonicalDigest({...result, preflight_sha256: null});
  return Object.freeze(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 2) {
    const error = new Error("Cloudflare Cache rebind preflight accepts no caller-supplied roots or inputs");
    error.code = "CLOUDFLARE_CACHE_REBIND_PREFLIGHT_CALLER_INPUT_FORBIDDEN";
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(runCloudflareCacheRebindPreflight(), null, 2)}\n`);
  }
}
