#!/usr/bin/env node

/*
 * Portable protected-authority intake and rebind coordinator.
 *
 * The coordinator resolves its repository and workspace custody from the
 * sealed authority's active Git context.  It accepts no caller-supplied
 * authority root, model artifact, evaluator root, clock, or dependent
 * projection.  A successful run only compiles a candidate invalidation and
 * rebind plan; admission, signing, promotion, and review remain external.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {auditModelPolicyEvidenceStore} from "./eco-model-policy.mjs";
import {compileReusableAgentRoster} from "./reusable-agent-roster-compiler.mjs";
import {resolveCanonicalSpawnerEvaluatorHandoff} from "./canonical-spawner-evaluator-handoff.mjs";
import {
  assertSealedCanonicalAuthority,
  getSealedCanonicalAuthority,
  readSealedAuthorityBinding,
  sealedAuthorityIdentity,
  sealedAuthorityRepositoryRoot,
} from "./sealed-canonical-authority.mjs";

export const PROTECTED_AUTHORITY_INTAKE_REBIND_SCHEMA = "agentos.protected_authority_intake_rebind.v1";
export const PROTECTED_AUTHORITY_QUEUE_SCHEMA = "agentos.protected_authority_queue_receipt.v1";
export const PROTECTED_AUTHORITY_INTAKE_REBIND_VERSION = 1;
export const PROTECTED_AUTHORITY_QUEUE_VERSION = 1;

export const PROTECTED_AUTHORITY_DEPENDENTS = Object.freeze([
  "MODEL_ROUTES",
  "OPERATIONAL_CONTEXTS",
  "GLOBAL_GOVERNANCE_MEMORY",
  "REUSABLE_AGENT_ROSTER",
]);

export const PROTECTED_AUTHORITY_PREREQUISITES = Object.freeze([
  "HOST.CODEX_MODEL_CATALOG_CURRENT",
  "MODEL_POLICY_ACCEPTED_ACTIVE_EXACT",
  "EVALUATOR_REVIEWER_HANDOFF_EXACT",
  "DEPENDENT_INVALIDATION_REBIND",
  "REUSABLE_AGENT_ROSTER_PROJECTION",
]);

const MODEL_POLICY_BINDING_ID = "initial_model_policy_snapshot_fixture";
const MODEL_POLICY_RELATIVE_PATH = "fixtures/model-policy-snapshot.initial.v1.json";
const MODEL_EVIDENCE_MANIFEST_PATH = "fixtures/model-policy-evidence/manifest.json";
const ROSTER_BINDING_ID = "reusable_agent_roster_registry";
const EVALUATOR_NAMESPACE_REF = "agentos-independent-evaluator";
const HOST_EVIDENCE_ID = /^HOST\.CODEX_MODEL_CATALOG\.[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,191}$/u;

const MODULE_ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

function fail(message, code = "PROTECTED_AUTHORITY_INTAKE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(record(value), `${label} must be an object`, "PROTECTED_AUTHORITY_SHAPE_INVALID");
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields differ`, "PROTECTED_AUTHORITY_SHAPE_INVALID");
}

function sha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} must be a non-placeholder SHA-256`, "PROTECTED_AUTHORITY_DIGEST_INVALID");
}

function gitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object ID`, "PROTECTED_AUTHORITY_GIT_ID_INVALID");
}

function safeId(value, label) {
  assert(typeof value === "string" && SAFE_ID.test(value), `${label} must be a stable identifier`, "PROTECTED_AUTHORITY_ID_INVALID");
}

function body(value, field) {
  return {...structuredClone(value), [field]: null};
}

function digestPath(value) {
  return crypto.createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function realDirectory(value, label) {
  assert(typeof value === "string" && path.isAbsolute(value), `${label} must be an absolute path`, "PROTECTED_AUTHORITY_CUSTODY_INVALID");
  let stat;
  try { stat = fs.lstatSync(value); } catch { fail(`${label} is missing`, "PROTECTED_AUTHORITY_CUSTODY_MISSING"); }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real non-symlink directory`, "PROTECTED_AUTHORITY_CUSTODY_INVALID");
  const real = fs.realpathSync.native(value);
  assert(real === value, `${label} must already be canonical`, "PROTECTED_AUTHORITY_CUSTODY_INVALID");
  return real;
}

function isDescendant(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertWorkspaceDescendant({projectsRoot, taskRoot} = {}) {
  const realProjectsRoot = realDirectory(projectsRoot, "Projects workspace root");
  const realTaskRoot = realDirectory(taskRoot, "task checkout root");
  assert(isDescendant(realProjectsRoot, realTaskRoot), "task checkout is outside the runtime Projects workspace", "PROTECTED_AUTHORITY_CUSTODY_ESCAPE");
  return Object.freeze({projects_root: realProjectsRoot, task_root: realTaskRoot, descendant: true});
}

function git(repositoryRoot, args) {
  return execFileSync("git", args, {cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
}

function resolveRuntimeCustody(sealedAuthority) {
  assertSealedCanonicalAuthority(sealedAuthority);
  const repositoryRoot = realDirectory(sealedAuthorityRepositoryRoot(sealedAuthority), "sealed authority repository root");
  const gitTopLevel = realDirectory(git(repositoryRoot, ["rev-parse", "--show-toplevel"]), "Git checkout root");
  assert(gitTopLevel === repositoryRoot, "sealed authority repository is not the active checkout", "PROTECTED_AUTHORITY_CUSTODY_REBOUND");
  const gitCommonDirectory = realDirectory(git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "Git common directory");
  const canonicalRepositoryRoot = realDirectory(path.dirname(gitCommonDirectory), "canonical Git repository root");
  const projectsRoot = realDirectory(path.dirname(canonicalRepositoryRoot), "runtime Projects workspace root");
  assertWorkspaceDescendant({projectsRoot, taskRoot: repositoryRoot});
  assertWorkspaceDescendant({projectsRoot, taskRoot: canonicalRepositoryRoot});

  const commit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  const parent = git(repositoryRoot, ["rev-parse", "HEAD^1"]);
  const parentTree = git(repositoryRoot, ["rev-parse", "HEAD^1^{tree}"]);
  const branch = git(repositoryRoot, ["branch", "--show-current"]);
  gitObject(commit, "candidate commit");
  gitObject(tree, "candidate tree");
  gitObject(parent, "candidate rollback commit");
  gitObject(parentTree, "candidate rollback tree");
  assert(branch.length > 0, "candidate branch is missing", "PROTECTED_AUTHORITY_CANDIDATE_INVALID");

  const worktreeClean = git(repositoryRoot, ["status", "--porcelain"]) === "" && git(repositoryRoot, ["clean", "-nd"]) === "";
  return Object.freeze({
    repositoryRoot,
    gitCommonDirectory,
    canonicalRepositoryRoot,
    projectsRoot,
    candidate: Object.freeze({branch, commit, tree, rollback: Object.freeze({commit: parent, tree: parentTree}), clean: worktreeClean}),
    custody: Object.freeze({
      projects_root_resolution: "PARENT_OF_RUNTIME_GIT_COMMON_REPOSITORY_ROOT",
      projects_root_descendant: true,
      projects_root_sha256: digestPath(projectsRoot),
      candidate_root_sha256: digestPath(repositoryRoot),
      canonical_repository_root_sha256: digestPath(canonicalRepositoryRoot),
      git_common_directory_sha256: digestPath(gitCommonDirectory),
    }),
  });
}

function safeRelativePath(relativePath, label) {
  assert(typeof relativePath === "string" && relativePath.length > 0 && !path.isAbsolute(relativePath), `${label} must be relative`, "PROTECTED_AUTHORITY_PATH_INVALID");
  const parts = relativePath.split(/[\\/]/u);
  assert(parts.every((part) => part.length > 0 && part !== "." && part !== ".."), `${label} escapes its root`, "PROTECTED_AUTHORITY_PATH_ESCAPE");
  return relativePath;
}

function readCanonicalArtifact(repositoryRoot, relativePath, label) {
  safeRelativePath(relativePath, label);
  const target = path.resolve(repositoryRoot, relativePath);
  assert(isDescendant(repositoryRoot, target), `${label} escapes the repository root`, "PROTECTED_AUTHORITY_PATH_ESCAPE");
  for (let cursor = target; cursor !== repositoryRoot; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), `${label} contains a symbolic-link path component`, "PROTECTED_AUTHORITY_SYMLINK");
  }
  let stat;
  try { stat = fs.lstatSync(target); } catch { fail(`${label} is missing`, "PROTECTED_AUTHORITY_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(target) === target, `${label} is not a canonical regular file`, "PROTECTED_AUTHORITY_ARTIFACT_INVALID");
  const bytes = fs.readFileSync(target);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "PROTECTED_AUTHORITY_ARTIFACT_INVALID"); }
  return Object.freeze({relative_path: relativePath, file_sha256: digestFile(target), bytes, value});
}

function blocked(error, fallbackCode) {
  return Object.freeze({
    status: "BLOCKED_EXACT",
    code: typeof error?.code === "string" && error.code.length > 0 ? error.code : fallbackCode,
    message: String(error?.message ?? error),
  });
}

export function assertExactCandidateBinding({candidate, expectedCandidate} = {}) {
  assert(record(candidate) && record(expectedCandidate), "candidate binding records are required", "PROTECTED_AUTHORITY_CANDIDATE_INVALID");
  for (const field of ["commit", "tree"]) {
    gitObject(candidate[field], `candidate ${field}`);
    gitObject(expectedCandidate[field], `expected candidate ${field}`);
    assert(candidate[field] === expectedCandidate[field], `candidate ${field} diverges from the current exact candidate`, "PROTECTED_AUTHORITY_DIVERGED");
  }
  return true;
}

export function assertExactArtifactBinding({actualSha256, expectedSha256, label = "authority artifact"} = {}) {
  sha(actualSha256, `${label} actual digest`);
  sha(expectedSha256, `${label} expected digest`);
  assert(actualSha256 === expectedSha256, `${label} diverges from the sealed current binding`, "PROTECTED_AUTHORITY_DIVERGED");
  return true;
}

function inspectModelPolicy({sealedAuthority, custody} = {}) {
  try {
    const binding = readSealedAuthorityBinding(sealedAuthority, MODEL_POLICY_BINDING_ID);
    assert(binding.relative_path === MODEL_POLICY_RELATIVE_PATH, "model-policy binding path is not canonical", "POLICY_SNAPSHOT_BINDING_INVALID");
    const local = readCanonicalArtifact(custody.repositoryRoot, binding.relative_path, "model-policy snapshot");
    assertExactArtifactBinding({actualSha256: local.file_sha256, expectedSha256: binding.file_sha256, label: "model-policy snapshot file"});
    assert(Buffer.compare(local.bytes, binding.bytes) === 0, "local model-policy snapshot bytes diverge from sealed authority", "PROTECTED_AUTHORITY_DIVERGED");
    const snapshot = local.value;
    const hostEvidence = snapshot.evidence?.filter((entry) => entry?.authority_class === "HOST_ATTESTATION" && HOST_EVIDENCE_ID.test(entry.evidence_id)) ?? [];
    assert(hostEvidence.length === 1, "model-policy snapshot must bind exactly one current HOST.CODEX_MODEL_CATALOG attestation", "HOST_ATTESTATION_BINDING_INVALID");
    const identity = {
      binding_id: binding.binding_id,
      relative_path: binding.relative_path,
      file_sha256: binding.file_sha256,
      snapshot_sha256: snapshot.snapshot_sha256,
      snapshot_status: snapshot.status,
      observed_at_utc: snapshot.observed_at_utc,
      expires_at_utc: snapshot.expires_at_utc,
    };
    let audited;
    try {
      audited = auditModelPolicyEvidenceStore(snapshot, {
        authorityRoot: custody.repositoryRoot,
        evidenceManifestPath: MODEL_EVIDENCE_MANIFEST_PATH,
        requireActive: false,
      });
    } catch (error) {
      return Object.freeze({...blocked(error, "POLICY_SNAPSHOT_INTAKE_FAILED"), ...identity});
    }
    try {
      audited = auditModelPolicyEvidenceStore(snapshot, {
      authorityRoot: custody.repositoryRoot,
      evidenceManifestPath: MODEL_EVIDENCE_MANIFEST_PATH,
      requireActive: true,
      });
    } catch (error) {
      return Object.freeze({...blocked(error, "POLICY_SNAPSHOT_ADMISSION_FAILED"), ...identity});
    }
    const manifest = readCanonicalArtifact(custody.repositoryRoot, MODEL_EVIDENCE_MANIFEST_PATH, "model-policy evidence manifest").value;
    const manifestEntry = manifest.entries?.find((entry) => entry.evidence_id === hostEvidence[0].evidence_id);
    assert(manifestEntry, "current host attestation is absent from the canonical evidence manifest", "HOST_ATTESTATION_MISSING");
    return Object.freeze({
      status: "PASS",
      code: null,
      ...identity,
      snapshot_sha256: audited.snapshot_sha256,
      snapshot_status: audited.status,
      observed_at_utc: audited.observed_at_utc,
      expires_at_utc: audited.expires_at_utc,
      host_attestation: Object.freeze({
        evidence_id: hostEvidence[0].evidence_id,
        artifact_sha256: hostEvidence[0].artifact_sha256,
        file_sha256: hostEvidence[0].file_sha256,
        manifest_path: manifestEntry.path,
        observed_at_utc: hostEvidence[0].observed_at_utc,
        expires_at_utc: hostEvidence[0].expires_at_utc,
      }),
    });
  } catch (error) {
    return blocked(error, "POLICY_SNAPSHOT_INTAKE_FAILED");
  }
}

function inspectEvaluatorHandoff({sealedAuthority, custody} = {}) {
  try {
    const handoff = resolveCanonicalSpawnerEvaluatorHandoff({sealedAuthority});
    assert(handoff.candidate_commit === custody.candidate.commit, "evaluator/reviewer handoff is bound to a diverged candidate", "PROTECTED_AUTHORITY_DIVERGED");
    sha(handoff.clearance_receipt_sha256, "evaluator clearance receipt");
    sha(handoff.review_receipt_sha256, "reviewer receipt");
    return Object.freeze({
      status: "PASS",
      code: null,
      namespace_ref: `${EVALUATOR_NAMESPACE_REF}/${custody.candidate.commit}`,
      candidate_commit: handoff.candidate_commit,
      clearance_receipt_sha256: handoff.clearance_receipt_sha256,
      review_receipt_sha256: handoff.review_receipt_sha256,
      separately_controlled: true,
    });
  } catch (error) {
    return blocked(error, "CANONICAL_EVALUATOR_HANDOFF_REQUIRED");
  }
}

function compileRosterProjection({custody} = {}) {
  const first = compileReusableAgentRoster({repositoryRoot: custody.repositoryRoot, writeGenerated: false});
  const second = compileReusableAgentRoster({repositoryRoot: custody.repositoryRoot, writeGenerated: false});
  assert(first.roster_sha256 === second.roster_sha256, "reusable-agent roster compilation is nondeterministic", "ROSTER_COMPILATION_NONDETERMINISTIC");
  assert(canonicalDigest({...first, roster_sha256: null}) === first.roster_sha256, "reusable-agent roster digest is not self-consistent", "ROSTER_COMPILATION_INVALID");
  return Object.freeze({status: "PASS", roster_sha256: first.roster_sha256, entry_count: first.entries.length, package_count: first.source_inventory.package_count, model_policy_snapshot_sha256: first.model_policy.snapshot_sha256});
}

function validatePreviousBindings(previousBindings) {
  const keys = [...PROTECTED_AUTHORITY_DEPENDENTS].sort(compareUtf8);
  exactKeys(previousBindings, keys, "dependent binding inventory");
  for (const kind of PROTECTED_AUTHORITY_DEPENDENTS) {
    exactKeys(previousBindings[kind], ["snapshot_sha256", "binding_sha256"], `${kind} dependent binding`);
    sha(previousBindings[kind].snapshot_sha256, `${kind} dependent snapshot`, {nullable: true});
    sha(previousBindings[kind].binding_sha256, `${kind} dependent binding`, {nullable: true});
  }
}

export function compileProtectedAuthorityInvalidation({successorSnapshotSha256, successorRosterSha256, previousBindings} = {}) {
  sha(successorSnapshotSha256, "successor model-policy snapshot");
  sha(successorRosterSha256, "successor reusable-agent roster");
  const prior = previousBindings ?? Object.fromEntries(PROTECTED_AUTHORITY_DEPENDENTS.map((kind) => [kind, {snapshot_sha256: null, binding_sha256: null}]));
  validatePreviousBindings(prior);
  const dependents = PROTECTED_AUTHORITY_DEPENDENTS.map((kind) => {
    const previousSnapshot = prior[kind].snapshot_sha256;
    const successorBinding = kind === "REUSABLE_AGENT_ROSTER" ? successorRosterSha256 : null;
    const current = previousSnapshot === successorSnapshotSha256 && (kind !== "REUSABLE_AGENT_ROSTER" || prior[kind].binding_sha256 === successorBinding);
    const row = {
      dependent_kind: kind,
      previous_snapshot_sha256: previousSnapshot,
      previous_binding_sha256: prior[kind].binding_sha256,
      successor_snapshot_sha256: successorSnapshotSha256,
      successor_binding_sha256: successorBinding,
      disposition: current ? "CURRENT" : "INVALIDATED_PENDING_REBUILD",
      action: current ? "PRESERVE_EXACT_BINDING" : "INVALIDATE_AND_REBUILD_FROM_SUCCESSOR",
      invalidation_sha256: null,
    };
    row.invalidation_sha256 = canonicalDigest(body(row, "invalidation_sha256"));
    return row;
  });
  const result = {
    schema: "agentos.protected_authority_dependent_invalidation.v1",
    version: 1,
    status: dependents.some((entry) => entry.disposition !== "CURRENT") ? "INVALIDATION_PLAN_COMPILED" : "NO_DEPENDENT_CHANGE",
    read_only: true,
    rebind_required: dependents.some((entry) => entry.disposition !== "CURRENT"),
    dependent_kinds: [...PROTECTED_AUTHORITY_DEPENDENTS],
    dependents,
    external_side_effects: {route_writes: 0, context_writes: 0, memory_writes: 0, roster_writes: 0},
    invalidation_sha256: null,
  };
  result.invalidation_sha256 = canonicalDigest(body(result, "invalidation_sha256"));
  return Object.freeze(result);
}

function priorBindingsFromCurrentRoster({sealedAuthority, rosterProjection} = {}) {
  const rosterBinding = readSealedAuthorityBinding(sealedAuthority, ROSTER_BINDING_ID);
  const currentRoster = rosterBinding.value;
  const previousSnapshot = typeof currentRoster?.model_policy?.snapshot_sha256 === "string" && SHA256.test(currentRoster.model_policy.snapshot_sha256) ? currentRoster.model_policy.snapshot_sha256 : null;
  return Object.fromEntries(PROTECTED_AUTHORITY_DEPENDENTS.map((kind) => [kind, {
    snapshot_sha256: previousSnapshot,
    binding_sha256: kind === "REUSABLE_AGENT_ROSTER" ? rosterBinding.file_sha256 : null,
  }]));
}

function resultBlockers({custody, modelPolicy, evaluator} = {}) {
  const blockers = [];
  if (!custody.candidate.clean) blockers.push({kind: "CANDIDATE", code: "CANDIDATE_WORKTREE_DIRTY", detail: "Candidate must be committed and clean before protected intake."});
  if (modelPolicy.status !== "PASS") blockers.push({kind: "MODEL_POLICY", code: modelPolicy.code, detail: modelPolicy.message});
  if (evaluator.status !== "PASS") blockers.push({kind: "EVALUATOR_HANDOFF", code: evaluator.code, detail: evaluator.message});
  return blockers;
}

function compileBlockedPrerequisiteQueue({custody, modelPolicy, evaluatorHandoff, blocked} = {}) {
  const modelBlocked = modelPolicy.status !== "PASS";
  const evaluatorBlocked = evaluatorHandoff.status !== "PASS";
  const rows = [
    {
      prerequisite_id: "HOST.CODEX_MODEL_CATALOG_CURRENT",
      status: modelBlocked ? "BLOCKED_EXACT" : "PASS",
      owner_role: "Spawner/root",
      code: modelBlocked ? "HOST_ATTESTATION_REQUIRED" : null,
      action: modelBlocked ? "Obtain an authorized current HOST.CODEX_MODEL_CATALOG attestation bound into the candidate evidence store." : "Preserve the exact host attestation binding.",
    },
    {
      prerequisite_id: "MODEL_POLICY_ACCEPTED_ACTIVE_EXACT",
      status: modelBlocked ? "BLOCKED_EXACT" : "PASS",
      owner_role: "Spawner/root",
      code: modelBlocked ? modelPolicy.code : null,
      action: modelBlocked ? "Obtain and bind an ACCEPTED_ACTIVE model-policy snapshot whose evidence store validates at trusted current time." : "Preserve the exact active model-policy snapshot binding.",
    },
    {
      prerequisite_id: "EVALUATOR_REVIEWER_HANDOFF_EXACT",
      status: evaluatorBlocked ? "BLOCKED_EXACT" : "PASS",
      owner_role: "Spawner/root",
      code: evaluatorBlocked ? evaluatorHandoff.code : null,
      action: evaluatorBlocked ? "Provision the separately controlled evaluator and reviewer handoff under the exact candidate commit namespace." : "Preserve the exact separately controlled handoff.",
    },
    {
      prerequisite_id: "DEPENDENT_INVALIDATION_REBIND",
      status: blocked ? "DEFERRED_PROTECTED_BLOCK" : "PASS",
      owner_role: "Spawner/root",
      code: blocked ? "DEPENDENT_REBIND_DEFERRED" : null,
      action: blocked ? "Invalidate and rebuild model routes, operational contexts, global governance memory, and roster projections only after all protected prerequisites pass." : "Apply the compiled read-only invalidation/rebind plan through the authorized writer.",
    },
    {
      prerequisite_id: "REUSABLE_AGENT_ROSTER_PROJECTION",
      status: blocked ? "DEFERRED_PROTECTED_BLOCK" : "PASS",
      owner_role: "Spawner/root",
      code: blocked ? "ROSTER_PROJECTION_DEFERRED" : null,
      action: blocked ? "Keep the deterministic roster projection non-admitting until policy and handoff prerequisites pass." : "Preserve the deterministic roster projection and await independent admission.",
    },
  ];
  return rows.filter((entry) => entry.status !== "PASS");
}

export function validateProtectedAuthorityQueueReceipt(receipt) {
  exactKeys(receipt, [
    "schema", "version", "queue_id", "status", "candidate", "custody", "required_authority",
    "blockers", "blocked_prerequisite_queue", "dependent_kinds", "rehome", "side_effects", "source_result_sha256", "queue_sha256",
  ], "protected-authority queue receipt");
  assert(receipt.schema === PROTECTED_AUTHORITY_QUEUE_SCHEMA && receipt.version === PROTECTED_AUTHORITY_QUEUE_VERSION, "protected-authority queue receipt identity differs", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  safeId(receipt.queue_id, "protected-authority queue ID");
  assert(receipt.status === "BLOCKED_EXACT", "protected-authority queue receipt is not blocked", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  exactKeys(receipt.candidate, ["branch", "commit", "tree", "rollback", "clean"], "queue candidate");
  gitObject(receipt.candidate.commit, "queue candidate commit");
  gitObject(receipt.candidate.tree, "queue candidate tree");
  exactKeys(receipt.candidate.rollback, ["commit", "tree"], "queue rollback");
  gitObject(receipt.candidate.rollback.commit, "queue rollback commit");
  gitObject(receipt.candidate.rollback.tree, "queue rollback tree");
  assert(typeof receipt.candidate.clean === "boolean", "queue candidate cleanliness is invalid", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  exactKeys(receipt.custody, ["projects_root_resolution", "projects_root_descendant", "projects_root_sha256", "candidate_root_sha256", "canonical_repository_root_sha256", "git_common_directory_sha256"], "queue custody");
  assert(receipt.custody.projects_root_descendant === true, "queue custody is outside Projects", "PROTECTED_AUTHORITY_CUSTODY_ESCAPE");
  for (const field of ["projects_root_sha256", "candidate_root_sha256", "canonical_repository_root_sha256", "git_common_directory_sha256"]) sha(receipt.custody[field], `queue custody ${field}`);
  assert(Array.isArray(receipt.required_authority) && JSON.stringify(receipt.required_authority) === JSON.stringify([
    "HOST.CODEX_MODEL_CATALOG_CURRENT", "MODEL_POLICY_ACCEPTED_ACTIVE_EXACT", "EVALUATOR_REVIEWER_HANDOFF_EXACT",
  ]), "queue required authority ordering differs", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  assert(Array.isArray(receipt.blockers) && receipt.blockers.length > 0, "queue blockers are missing", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  for (const blocker of receipt.blockers) exactKeys(blocker, ["kind", "code", "detail"], "queue blocker");
  assert(Array.isArray(receipt.blocked_prerequisite_queue) && receipt.blocked_prerequisite_queue.length > 0, "blocked prerequisite queue is missing", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  let priorPrerequisiteIndex = -1;
  const seenPrerequisites = new Set();
  for (const entry of receipt.blocked_prerequisite_queue) {
    exactKeys(entry, ["prerequisite_id", "status", "owner_role", "code", "action"], "blocked prerequisite queue entry");
    const prerequisiteIndex = PROTECTED_AUTHORITY_PREREQUISITES.indexOf(entry.prerequisite_id);
    assert(prerequisiteIndex > priorPrerequisiteIndex && !seenPrerequisites.has(entry.prerequisite_id), "blocked prerequisite queue ordering or uniqueness differs", "PROTECTED_AUTHORITY_QUEUE_INVALID");
    assert(entry.status === "BLOCKED_EXACT" || entry.status === "DEFERRED_PROTECTED_BLOCK", "blocked prerequisite queue contains an admitted entry", "PROTECTED_AUTHORITY_QUEUE_INVALID");
    assert(entry.owner_role === "Spawner/root" && typeof entry.code === "string" && entry.code.length > 0 && typeof entry.action === "string" && entry.action.length > 0, "blocked prerequisite queue entry is incomplete", "PROTECTED_AUTHORITY_QUEUE_INVALID");
    priorPrerequisiteIndex = prerequisiteIndex;
    seenPrerequisites.add(entry.prerequisite_id);
  }
  assert(JSON.stringify(receipt.dependent_kinds) === JSON.stringify([...PROTECTED_AUTHORITY_DEPENDENTS]), "queue dependent ordering differs", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  exactKeys(receipt.rehome, ["owner_role", "action"], "queue rehome");
  assert(receipt.rehome.owner_role === "Spawner/root" && receipt.rehome.action.length > 32, "queue rehome action is incomplete", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  exactKeys(receipt.side_effects, ["source_tree_mutations", "protected_authority_mutations", "evaluator_consumptions", "roster_writes", "audit_requests"], "queue side effects");
  for (const value of Object.values(receipt.side_effects)) assert(value === 0, "blocked queue receipt records a side effect", "PROTECTED_AUTHORITY_QUEUE_SIDE_EFFECT");
  sha(receipt.source_result_sha256, "queue source result");
  sha(receipt.queue_sha256, "queue receipt digest");
  assert(receipt.queue_sha256 === canonicalDigest(body(receipt, "queue_sha256")), "queue receipt digest mismatch", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  return receipt;
}

export function compileProtectedAuthorityQueueReceipt({result} = {}) {
  assert(record(result) && result.status === "BLOCKED_EXACT", "queue receipt requires an exact blocked intake result", "PROTECTED_AUTHORITY_QUEUE_INVALID");
  const receipt = {
    schema: PROTECTED_AUTHORITY_QUEUE_SCHEMA,
    version: PROTECTED_AUTHORITY_QUEUE_VERSION,
    queue_id: `PROTECTED_AUTHORITY_QUEUE.${result.candidate.commit.toUpperCase()}`,
    status: "BLOCKED_EXACT",
    candidate: structuredClone(result.candidate),
    custody: structuredClone(result.custody),
    required_authority: ["HOST.CODEX_MODEL_CATALOG_CURRENT", "MODEL_POLICY_ACCEPTED_ACTIVE_EXACT", "EVALUATOR_REVIEWER_HANDOFF_EXACT"],
    blockers: result.blockers.map((entry) => structuredClone(entry)),
    blocked_prerequisite_queue: result.blocked_prerequisite_queue.map((entry) => structuredClone(entry)),
    dependent_kinds: [...PROTECTED_AUTHORITY_DEPENDENTS],
    rehome: {
      owner_role: "Spawner/root",
      action: "Obtain authorized current host attestation and active exact-bound model policy, then obtain the separately controlled evaluator/reviewer handoff for this exact commit/tree. Preserve this queue receipt; only after validation may dependents be invalidated/rebuilt and a new independent audit be requested.",
    },
    side_effects: {source_tree_mutations: 0, protected_authority_mutations: 0, evaluator_consumptions: 0, roster_writes: 0, audit_requests: 0},
    source_result_sha256: result.result_sha256,
    queue_sha256: null,
  };
  receipt.queue_sha256 = canonicalDigest(body(receipt, "queue_sha256"));
  return validateProtectedAuthorityQueueReceipt(receipt);
}

function queueReceiptPath(custody) {
  return path.join(custody.gitCommonDirectory, "agentos-spawner-queues", "protected-authority", `${custody.candidate.commit}.json`);
}

function queueStateDigest(receipt) {
  const projection = structuredClone(receipt);
  projection.source_result_sha256 = null;
  projection.queue_sha256 = null;
  return canonicalDigest(projection);
}

export function writeProtectedAuthorityQueueReceipt({sealedAuthority, receipt} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  validateProtectedAuthorityQueueReceipt(receipt);
  const custody = resolveRuntimeCustody(sealedAuthority);
  assert(receipt.candidate.commit === custody.candidate.commit && receipt.candidate.tree === custody.candidate.tree, "queue receipt is not bound to the active exact candidate", "PROTECTED_AUTHORITY_DIVERGED");
  const target = queueReceiptPath(custody);
  fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
  if (fs.existsSync(target)) {
    const readback = JSON.parse(fs.readFileSync(target, "utf8"));
    validateProtectedAuthorityQueueReceipt(readback);
    assert(queueStateDigest(readback) === queueStateDigest(receipt), "existing protected-authority queue receipt is a divergent replay", "PROTECTED_AUTHORITY_QUEUE_REPLAY");
    return Object.freeze({status: "IDEMPOTENT_REPLAY", path: target, queue_sha256: readback.queue_sha256});
  }
  const descriptor = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const readback = JSON.parse(fs.readFileSync(target, "utf8"));
  validateProtectedAuthorityQueueReceipt(readback);
  return Object.freeze({status: "WRITTEN", path: target, queue_sha256: readback.queue_sha256});
}

export function runProtectedAuthorityIntakeRebind(options = {}) {
  assert(record(options) && Object.keys(options).every((key) => ["sealedAuthority", "writeQueueReceipt"].includes(key)), "protected-authority intake accepts only sealed authority and an explicit runtime queue-write flag", "PROTECTED_AUTHORITY_CALLER_INPUT_FORBIDDEN");
  const sealedAuthority = options.sealedAuthority ?? getSealedCanonicalAuthority();
  assertSealedCanonicalAuthority(sealedAuthority);
  if (options.writeQueueReceipt !== undefined) assert(typeof options.writeQueueReceipt === "boolean", "queue-write flag must be boolean", "PROTECTED_AUTHORITY_CALLER_INPUT_FORBIDDEN");
  const custody = resolveRuntimeCustody(sealedAuthority);
  const modelPolicy = inspectModelPolicy({sealedAuthority, custody});
  const evaluatorHandoff = inspectEvaluatorHandoff({sealedAuthority, custody});
  const blockers = resultBlockers({custody, modelPolicy, evaluator: evaluatorHandoff});
  const authority = sealedAuthorityIdentity(sealedAuthority);
  const base = {
    schema: PROTECTED_AUTHORITY_INTAKE_REBIND_SCHEMA,
    version: PROTECTED_AUTHORITY_INTAKE_REBIND_VERSION,
    observed_at_utc: new Date().toISOString(),
    status: blockers.length === 0 ? "REBOUND_CANDIDATE_NOT_ADMITTED" : "BLOCKED_EXACT",
    readiness_claimed: false,
    candidate: structuredClone(custody.candidate),
    custody: structuredClone(custody.custody),
    authority,
    intake: {model_policy: modelPolicy, evaluator_handoff: evaluatorHandoff},
    blockers,
    blocked_prerequisite_queue: compileBlockedPrerequisiteQueue({custody, modelPolicy, evaluatorHandoff, blocked: blockers.length > 0}),
    invalidation: null,
    roster: null,
    external_side_effects: {source_tree_mutations: 0, protected_authority_mutations: 0, evaluator_consumptions: 0, route_writes: 0, context_writes: 0, memory_writes: 0, roster_writes: 0, audit_requests: 0},
    queue_receipt: null,
    result_sha256: null,
  };

  if (blockers.length === 0) {
    const roster = compileRosterProjection({custody});
    const previousBindings = priorBindingsFromCurrentRoster({sealedAuthority, rosterProjection: roster});
    const invalidation = compileProtectedAuthorityInvalidation({successorSnapshotSha256: modelPolicy.snapshot_sha256, successorRosterSha256: roster.roster_sha256, previousBindings});
    base.roster = roster;
    base.invalidation = invalidation;
  } else {
    base.roster = {status: "NOT_COMPILED_PROTECTED_BLOCK", reason: "Exact protected prerequisites are not concurrently valid."};
    base.invalidation = {status: "NOT_EXECUTED_PROTECTED_BLOCK", dependent_kinds: [...PROTECTED_AUTHORITY_DEPENDENTS], read_only: true};
  }

  base.result_sha256 = canonicalDigest(body(base, "result_sha256"));
  const result = Object.freeze(base);
  if (result.status === "BLOCKED_EXACT" && options.writeQueueReceipt === true) {
    const receipt = compileProtectedAuthorityQueueReceipt({result});
    const write = writeProtectedAuthorityQueueReceipt({sealedAuthority, receipt});
    return Object.freeze({...result, queue_receipt: write});
  }
  return result;
}

export function compileProtectedAuthorityRosterForCurrentCandidate() {
  const sealedAuthority = getSealedCanonicalAuthority();
  const custody = resolveRuntimeCustody(sealedAuthority);
  return compileRosterProjection({custody});
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== "--write-queue-receipt")) {
    const error = new Error("protected-authority intake accepts no caller roots or artifact inputs");
    error.code = "PROTECTED_AUTHORITY_CALLER_INPUT_FORBIDDEN";
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    const result = runProtectedAuthorityIntakeRebind({writeQueueReceipt: process.argv[2] === "--write-queue-receipt"});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
