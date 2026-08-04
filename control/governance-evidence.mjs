#!/usr/bin/env node

import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {controllerDigest} from "./agentos-controller.mjs";

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

function git(worktreePath, args) {
  return execFileSync("git", ["-C", worktreePath, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function nodeCommand(worktreePath, args) {
  return {program: process.execPath, args, display: "node " + args.join(" ")};
}

function gitCommand(worktreePath, args) {
  return {program: "git", args: ["-C", worktreePath, ...args], display: "git -C " + worktreePath + " " + args.join(" ")};
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
  assert(exitCode === 0, "governance evidence command failed for " + evidenceKey + ": " + command.display + " (" + stderr + ")");
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

export function collectGovernanceGateEvidence({worktreePath, tree}) {
  const sourceCommit = git(worktreePath, ["rev-parse", "HEAD"]);
  const sourceTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  requireGitObject(sourceCommit, "observed governance source commit");
  requireGitObject(sourceTree, "observed governance source tree");
  assert(sourceCommit === tree.source_commit && sourceTree === tree.source_tree, "governance evidence source differs from the decision tree");
  const result = {};
  for (const gate of tree.gates) {
    for (const key of gate.evidence_requirements) result[gate.gate_id + ":" + key] = observe(worktreePath, key, sourceCommit, sourceTree);
  }
  return result;
}
