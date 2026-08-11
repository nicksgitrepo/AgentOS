#!/usr/bin/env node

import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {controllerDigest} from "./agentos-controller.mjs";
import {redactPersistedText} from "./persisted-record-privacy.mjs";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), label + " must be a SHA-256");
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), label + " must be a Git object");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function textDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEvidenceText(value) {
  try {
    return redactPersistedText(String(value)).text.replace(/\s+/gu, " ").trim().slice(0, 2000);
  } catch {
    return `opaque:error:${textDigest(String(value))}`;
  }
}

function git(worktreePath, args) {
  return execFileSync("git", ["-C", worktreePath, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function schedulerCandidateIdentity(worktreePath) {
  const commit = git(worktreePath, ["rev-parse", "HEAD"]);
  const tree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  const status = git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.length === 0) return {commit, tree, clean: true};
  const diff = execFileSync("git", ["-C", worktreePath, "diff", "--binary"], {encoding: "buffer", maxBuffer: 64 * 1024 * 1024});
  const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return {
    commit: "PRELIMINARY_DIAGNOSTIC",
    tree: controllerDigest({commit, tree, status, diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"), untracked}),
    clean: false,
  };
}

function nodeCommand(worktreePath, args) {
  return {program: process.execPath, args, display: "node " + args.join(" ")};
}

function gitCommand(worktreePath, args) {
  return {program: "git", args: ["-C", worktreePath, ...args], display: "git " + args.join(" ")};
}

function commandForEvidence(worktreePath, key) {
  if (key === "source_commit") return gitCommand(worktreePath, ["rev-parse", "HEAD"]);
  if (key === "source_tree") return gitCommand(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  const treeCheck = ["tests/verify-governance-decision-tree.mjs"];
  const ownerCheck = ["tests/verify-bootstrap-delivery-finish.mjs"];
  const admissionCheck = ["tests/verify-local-campaign-admission.mjs"];
  if (["root_order_trace", "focused_functionality_result", "ambiguous_answer_hostile_result", "typed_answer_result", "repair_route_trace", "exact_recheck_trace", "feature_path_trace", "specific_question_trace"].includes(key)) return nodeCommand(worktreePath, treeCheck);
  if (["owner_surface_term_check", "one_question_trace", "friendly_finish_question_check", "design_bible_result"].includes(key)) return nodeCommand(worktreePath, ownerCheck);
  if (["changed_surface_trace", "full_check_result", "portability_result", "boundary_matrix", "external_action_rejection_trace", "hostile_security_result"].includes(key)) return nodeCommand(worktreePath, admissionCheck);
  if (key === "static_source_check") return nodeCommand(worktreePath, ["--check", "control/governance-decision-tree.mjs"]);
  if (key === "hostile_fallback_check") return nodeCommand(worktreePath, treeCheck);
  if (key === "atomic_write_result" || key === "json_readback_result" || key === "identity_readback_result") return nodeCommand(worktreePath, admissionCheck);
  if (["spawn_identity_trace", "duplicate_spawn_rejection", "crash_readback_result"].includes(key)) return gitCommand(worktreePath, ["show", "HEAD:control/local-agent-runtime.mjs"]);
  throw new Error("No real command is declared for governance evidence key: " + key);
}

function observe(worktreePath, evidenceKey, sourceCommit, sourceTree) {
  const command = commandForEvidence(worktreePath, evidenceKey);
  const args = command.args;
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(command.program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  } catch (error) {
    exitCode = Number.isSafeInteger(error.status) ? error.status : 1;
    stdout = error.stdout?.toString() ?? "";
    stderr = error.stderr?.toString() ?? error.message;
  }
  const observed = {
    command: command.display,
    exit_code: exitCode,
    stdout_sha256: textDigest(stdout),
    stderr_sha256: textDigest(stderr),
    status: exitCode === 0 ? "PASS" : "FAIL",
  };
  assert(exitCode === 0, "governance evidence command failed for " + evidenceKey + ": " + command.display + " (" + safeEvidenceText(stderr) + ")");
  const evidence = {
    schema: "agentos.governance_gate_evidence.v1",
    version: 1,
    evidence_key: evidenceKey,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    check_id: "REAL-CHECK-" + evidenceKey.toUpperCase(),
    observed,
    result_sha256: controllerDigest(observed),
    evidence_sha256: null,
  };
  evidence.evidence_sha256 = digestWithout(evidence, "evidence_sha256");
  return evidence;
}

export function collectGovernanceGateEvidence({worktreePath, tree, schedulerRoot = null}) {
  const sourceCommit = git(worktreePath, ["rev-parse", "HEAD"]);
  const sourceTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  requireGitObject(sourceCommit, "observed governance source commit");
  requireGitObject(sourceTree, "observed governance source tree");
  assert(sourceCommit === tree.source_commit && sourceTree === tree.source_tree, "governance evidence source differs from the decision tree");
  assert(schedulerRoot !== null && schedulerRoot !== undefined, "governance evidence requires the shared durable scheduler");
  const keys = tree.gates.flatMap((gate) => gate.evidence_requirements.map((key) => `${gate.gate_id}:${key}`)).sort();
  const candidate = schedulerCandidateIdentity(worktreePath);
  const scheduler = createHybridScheduler({authorityRoot: schedulerRoot});
  const request = compileHybridSchedulerRequest({
    requestId: `GOVERNANCE-EVIDENCE-${controllerDigest({candidate, keys}).slice(0, 32).toUpperCase()}`,
    requesterId: "AGENTOS_GOVERNANCE_EVIDENCE",
    lane: "GOVERNANCE_EVIDENCE",
    repositoryId: `REPOSITORY-${controllerDigest(worktreePath).slice(0, 24).toUpperCase()}`,
    worktreeId: `WORKTREE-${controllerDigest(worktreePath).slice(0, 24).toUpperCase()}`,
    candidateCommit: candidate.commit,
    candidateTreeOrDigest: candidate.tree,
    cleanState: candidate.clean,
    resourceClass: "COMPILE_HEAVY",
    workingDirectoryRef: opaqueSchedulerWorktreeRef(worktreePath),
    commandArgv: ["AGENTOS_GOVERNANCE_EVIDENCE_PLAN", ...keys],
    toolchainProfile: "NODE_GOVERNANCE_EVIDENCE",
    proofClass: "TEST_BATCH",
    whyNeeded: "COLLECT_SOURCE_BOUND_GOVERNANCE_EVIDENCE",
    expectedProof: "ALL_GOVERNANCE_EVIDENCE_PASS",
    coverage: keys.map((key) => `EVIDENCE-${controllerDigest(key).slice(0, 16).toUpperCase()}`).sort(),
    timeoutClass: "BOUNDED",
    cachePolicy: "NO_SHARED_OUTPUT",
    secretPolicy: "REDACTED",
  });
 return scheduler.runSync({
   request,
    admission: {
      effectiveArgv: request.command_argv,
      workingDirectory: worktreePath,
      workingDirectoryRef: request.working_directory_ref,
      allowedScope: ["."],
      dependencyPreflight: () => ({status: "READY", identity: `DEPENDENCY_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
      runtimePreflight: () => ({status: "READY", identity: `RUNTIME_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
    },
   resolveCandidate: () => schedulerCandidateIdentity(worktreePath),
    execute: () => {
      const result = {};
      for (const gate of tree.gates) {
        for (const key of gate.evidence_requirements) result[gate.gate_id + ":" + key] = observe(worktreePath, key, sourceCommit, sourceTree);
      }
      return result;
    },
  }).output;
}
