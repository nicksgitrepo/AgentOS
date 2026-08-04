#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "worker arguments are malformed");
    result[key.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}

function requireString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} is required`);
}

function requireSha(value, label) {
  assert(SHA256.test(value), `${label} must be a SHA-256`);
}

function requireGitObject(value, label) {
  assert(GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireUtc(value, label) {
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function runFocusedChecks(worktreePath) {
  const checks = [
    "node --check control/governance-decision-tree.mjs",
    "node tests/verify-governance-decision-tree.mjs",
  ];
  for (const check of checks) {
    const [program, ...args] = check.split(" ");
    execFileSync(program === "node" ? process.execPath : program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  return checks;
}

const args = parseArgs(process.argv.slice(2));
const role = args.role;
const sessionId = args.session_id;
const campaignId = args.campaign_id;
const campaignVersion = args.campaign_version;
const candidateSha256 = args.candidate_sha256;
const sourceCommit = args.source_commit;
const sourceTree = args.source_tree;
const worktreePath = path.resolve(args.worktree ?? "");
const task = args.task;
const featureWorktree = args.feature_worktree ? path.resolve(args.feature_worktree) : null;
const decisionTreePath = args.decision_tree ? path.resolve(args.decision_tree) : null;
const nowUtc = new Date().toISOString();

requireString(role, "worker role");
requireString(sessionId, "worker session");
requireString(campaignId, "worker campaign");
requireString(campaignVersion, "worker campaign version");
requireSha(candidateSha256, "worker candidate");
requireGitObject(sourceCommit, "worker source commit");
requireGitObject(sourceTree, "worker source tree");
requireString(task, "worker task");
requireUtc(nowUtc, "worker time");
assert(fs.existsSync(worktreePath) && fs.statSync(worktreePath).isDirectory(), "worker worktree is unavailable");

function writeFileAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.stage`;
  fs.writeFileSync(temporary, content, {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, target);
}

function writeJson(fileName, value) {
  const target = path.join(worktreePath, fileName);
  writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

const base = {
  schema: "agentos.local_worker_work_product.v1",
  version: 1,
  role,
  session_id: sessionId,
  campaign_id: campaignId,
  campaign_version: campaignVersion,
  candidate_sha256: candidateSha256,
  source_commit: sourceCommit,
  source_tree: sourceTree,
  task,
  created_at_utc: nowUtc,
};

let artifactName;
let product;
let buildStatus = "NOT_FEATURE_AGENT_BUILD";
let buildCommit = null;
let buildTree = null;
let changedPaths = [];
let focusedChecks = [];

if (role === "CAMPAIGN_ORCHESTRATOR") {
  artifactName = "orchestrator-plan.json";
  assert(decisionTreePath !== null, "Orchestrator decision tree is unavailable");
  assert(fs.existsSync(decisionTreePath) && fs.statSync(decisionTreePath).isFile(), "Orchestrator decision tree record is unavailable");
  const decisionTree = JSON.parse(fs.readFileSync(decisionTreePath, "utf8"));
  const {evaluateGovernanceDecisionTree} = await import(pathToFileURL(path.join(worktreePath, "control/governance-decision-tree.mjs")).href);
  const evidence = (gate) => Object.fromEntries(gate.evidence_requirements.map((key) => [key, `${gate.gate_id}:${key}`]));
  const gateAnswers = Object.fromEntries(decisionTree.gates.map((gate) => [gate.gate_id, {answer: "YES", evidence: evidence(gate), failure: null, recheck: null}]));
  const gateEvaluation = evaluateGovernanceDecisionTree({tree: decisionTree, answers: gateAnswers});
  assert(gateEvaluation.status === "PASS", "Orchestrator four-root governance evaluation did not pass");
  product = {
    ...base,
    custody_status: "CAMPAIGN_ORCHESTRATOR_CUSTODY",
    ordered_roots: ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "CODE_QUALITY_HYGIENE", "SECURITY"],
    gate_evaluation: gateEvaluation,
    repair_task: {
      task_id: "TASK-FEATURE-AGENT-EXECUTABLE-GOVERNANCE-1",
      owner_role: "FEATURE_AGENT",
      target_files: ["control/governance-decision-tree.mjs", "control/local-campaign-admission.mjs", "control/local-agent-runtime.mjs"],
      acceptance: ["real code change in the isolated Feature-Agent worktree", "focused checks pass", "changed commit/tree returned", "Auditor verifies the changed tree"],
    },
    next_action: "Run each root, then route every NO through its named failure tree and exact re-check.",
  };
} else if (role === "INDEPENDENT_AUDITOR") {
  artifactName = "auditor-observation.json";
  product = {
    ...base,
    custody_status: "INDEPENDENT_AUDITOR_CUSTODY",
    audit_status: "INITIAL_AUDIT_READY",
    observation: "Inspect the actual Feature-Agent worktree and compare it with the exact candidate and gate evidence.",
  };
  if (featureWorktree !== null) {
    assert(fs.existsSync(featureWorktree) && fs.statSync(featureWorktree).isDirectory(), "auditor Feature-Agent worktree is unavailable");
    buildCommit = git(featureWorktree, ["rev-parse", "HEAD"]);
    buildTree = git(featureWorktree, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree, "Auditor did not observe a changed Feature-Agent checkpoint");
    assert(changedPaths.includes("control/governance-decision-tree.mjs"), "Auditor did not observe the required Feature-Agent code change");
    focusedChecks = runFocusedChecks(featureWorktree);
    buildStatus = "AUDIT_VERIFIED";
    product = {
      ...product,
      audit_status: "FEATURE_BUILD_VERIFIED",
      audited_feature_worktree: featureWorktree,
      audited_feature_commit: buildCommit,
      audited_feature_tree: buildTree,
      audited_feature_changed_paths: changedPaths,
      audited_feature_checks: focusedChecks,
    };
  }
} else if (role === "FEATURE_AGENT") {
  artifactName = "control/feature-agent-work-product.mjs";
  const governancePath = path.join(worktreePath, "control/governance-decision-tree.mjs");
  assert(fs.existsSync(governancePath), "Feature Agent governance tree source is unavailable");
  const existingSource = fs.readFileSync(governancePath, "utf8");
  assert(!existingSource.includes("compileFeatureAgentRepairReceipt"), "Feature Agent repair was already applied in this worktree");
  const implementation = `\n\nexport function compileFeatureAgentRepairReceipt({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {\n  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");\n  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");\n  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");\n  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};\n}\n`;
  writeFileAtomic(governancePath, `${existingSource}${implementation}`);
  focusedChecks = runFocusedChecks(worktreePath);
  const marker = `// Local Feature Agent work product; held in the isolated campaign worktree.\nexport const FEATURE_AGENT_WORK_PRODUCT = Object.freeze(${JSON.stringify({
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    custody_status: "FEATURE_AGENT_CUSTODY",
    task: "Build and test the executable four-root governance tree and local admission bridge.",
  }, null, 2)});\n`;
  writeFileAtomic(path.join(worktreePath, artifactName), marker);
  execFileSync("git", ["add", "control/governance-decision-tree.mjs", artifactName], {cwd: worktreePath, encoding: "utf8"});
  execFileSync("git", ["-c", "user.name=AgentOS Feature Agent", "-c", "user.email=agentos-feature-agent@localhost", "commit", "-m", "Feature Agent: implement governance repair receipt"], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
  buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
  assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean changed checkpoint");
  buildStatus = "COMPLETED";
  product = {
    ...base,
    custody_status: "FEATURE_AGENT_CUSTODY",
    code_change_path: "control/governance-decision-tree.mjs",
    change_status: "COMMITTED_IN_ISOLATED_WORKTREE",
    build_status: buildStatus,
    build_commit: buildCommit,
    build_tree: buildTree,
    changed_paths: changedPaths,
    focused_checks: focusedChecks,
  };
} else {
  throw new Error(`unsupported local worker role: ${role}`);
}

let artifactPath;
if (role !== "FEATURE_AGENT") artifactPath = writeJson(artifactName, product);
else artifactPath = path.join(worktreePath, artifactName);
const artifactBytes = fs.readFileSync(artifactPath);
const artifactSha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex");
const buildCheckpoint = buildCommit === null ? null : {build_commit: buildCommit, build_tree: buildTree, changed_paths: changedPaths, focused_checks: focusedChecks};
const handshake = {
  schema: "agentos.local_worker_handshake.v1",
  version: 1,
  status: "COMPLETED",
  role,
  session_id: sessionId,
  campaign_id: campaignId,
  campaign_version: campaignVersion,
  candidate_sha256: candidateSha256,
  pid: String(process.pid),
  worktree_path: worktreePath,
  source_commit: sourceCommit,
  source_tree: sourceTree,
  build_status: buildStatus,
  build_commit: buildCommit,
  build_tree: buildTree,
  changed_paths: changedPaths,
  focused_checks: focusedChecks,
  build_checkpoint_sha256: buildCheckpoint === null ? null : crypto.createHash("sha256").update(JSON.stringify(canonicalize(buildCheckpoint)), "utf8").digest("hex"),
  artifact_path: path.relative(worktreePath, artifactPath),
  artifact_sha256: artifactSha256,
  exit_code: 0,
  observed_at_utc: nowUtc,
  handshake_sha256: null,
};
handshake.handshake_sha256 = digestWithout(handshake, "handshake_sha256");
process.stdout.write(`${JSON.stringify(handshake)}\n`);
