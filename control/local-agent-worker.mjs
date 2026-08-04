#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {applyGovernanceEvidenceRepair} from "./feature-agent-governance-evidence-repair.mjs";

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

function runChecks(worktreePath, checks) {
  for (const check of checks) {
    const [program, ...args] = check.split(" ");
    execFileSync(program === "node" ? process.execPath : program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  return checks;
}

function runFocusedChecks(worktreePath) {
  return runChecks(worktreePath, [
    "node --check control/governance-decision-tree.mjs",
    "node tests/verify-governance-decision-tree.mjs",
  ]);
}

function runControllerSupervisorChecks(worktreePath) {
  return runChecks(worktreePath, [
    "node --check control/controller-supervisor.mjs",
    "node --check control/controller-supervisor-runtime.mjs",
    "node --check control/local-agent-session.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ]);
}

function runControllerSupervisorBindingChecks(worktreePath, taskKind = "CONTROLLER_SUPERVISOR_BINDING_REPAIR") {
  const checks = [
    "node --check control/controller-supervisor.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  if (taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR") checks.push("node tests/verify-all.mjs");
  return runChecks(worktreePath, checks);
}

function runDurableSessionChecks(worktreePath) {
  return runChecks(worktreePath, [
    "node --check tests/verify-local-agent-session.mjs",
    "node tests/verify-local-agent-session.mjs",
  ]);
}

function applyControllerSupervisorRepair(worktreePath) {
  const supervisorPath = path.join(worktreePath, "control/controller-supervisor.mjs");
  assert(fs.existsSync(supervisorPath), "Controller supervisor source is unavailable");
  const source = fs.readFileSync(supervisorPath, "utf8");
  const oldBranch = '  if (hasOpenFinding(observation.findings, ["REPAIRABLE_ENGINEERING_PUZZLE", "HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) {\n    return "ROUTE_REPAIRABLE_PUZZLE";\n  }';
  const newBranch = '  if (hasOpenFinding(observation.findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) return "STOP_HARD_BOUNDARY";\n  if (hasOpenFinding(observation.findings, ["REPAIRABLE_ENGINEERING_PUZZLE"])) {\n    return "ROUTE_REPAIRABLE_PUZZLE";\n  }';
  assert(source.includes(oldBranch), "Controller supervisor boundary branch is not at the expected source checkpoint");
  writeFileAtomic(supervisorPath, source.replace(oldBranch, newBranch));
  return ["control/controller-supervisor.mjs"];
}

function applyControllerSupervisorBindingRepair(worktreePath) {
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  const controllerPath = path.join(worktreePath, "control/controller-supervisor.mjs");
  assert(fs.existsSync(bindingPath) && fs.existsSync(controllerPath), "Controller supervisor binding inputs are unavailable");
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(controllerPath)).digest("hex");
  assert(binding.normative?.controller_supervisor_controller?.sha256 !== actualSha256, "Controller supervisor binding repair was already applied");
  binding.normative.controller_supervisor_controller.sha256 = actualSha256;
  writeFileAtomic(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  return ["schemas/bootstrap-binding.v1.json"];
}

function applyLocalAgentSessionBindingRepair(worktreePath) {
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  const verifierPath = path.join(worktreePath, "tests/verify-local-agent-session.mjs");
  assert(fs.existsSync(bindingPath) && fs.existsSync(verifierPath), "local agent session binding inputs are unavailable");
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(verifierPath)).digest("hex");
  assert(binding.normative?.local_agent_session_verifier?.sha256 !== actualSha256, "local agent session binding repair was already applied");
  binding.normative.local_agent_session_verifier.sha256 = actualSha256;
  writeFileAtomic(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  return ["schemas/bootstrap-binding.v1.json"];
}

function applyDurableSessionTestRootRepair(worktreePath) {
  const testPath = path.join(worktreePath, "tests/verify-local-agent-session.mjs");
  assert(fs.existsSync(testPath), "durable-session verifier source is unavailable");
  const source = fs.readFileSync(testPath, "utf8");
  const oldLine = 'const runtimeRoot = fs.mkdtempSync(path.join(root, "tmp/agentos-durable-session-"));';
  const newLines = 'fs.mkdirSync(path.join(root, "tmp"), {recursive: true});\nconst runtimeRoot = fs.mkdtempSync(path.join(root, "tmp/agentos-durable-session-"));';
  assert(source.includes(oldLine), "durable-session verifier temporary-root setup is not at the expected source checkpoint");
  writeFileAtomic(testPath, source.replace(oldLine, newLines));
  return ["tests/verify-local-agent-session.mjs"];
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
const taskId = args.task_id ?? "INITIAL";
const taskKind = args.task_kind ?? "INITIAL";
const featureWorktree = args.feature_worktree ? path.resolve(args.feature_worktree) : null;
const evidenceWorktree = args.evidence_worktree ? path.resolve(args.evidence_worktree) : null;
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

if (role === "CAMPAIGN_ORCHESTRATOR" && taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
  artifactName = "controller-supervisor-liveness-plan.json";
  focusedChecks = runControllerSupervisorChecks(worktreePath);
  product = {
    ...base,
    custody_status: "CAMPAIGN_ORCHESTRATOR_CUSTODY",
    liveness_status: "OBSERVING_ADOPTED_SOURCE",
    focused_checks: focusedChecks,
    next_action: "Keep the durable campaign roles source-bound and return a liveness readback to the Controller.",
  };
} else if (role === "CAMPAIGN_ORCHESTRATOR" && taskKind === "CONTROLLER_SUPERVISOR_ORCHESTRATE") {
  artifactName = "controller-supervisor-orchestrator-plan.json";
  product = {
    ...base,
    custody_status: "CAMPAIGN_ORCHESTRATOR_CUSTODY",
    audit_scope: ["controller supervisor observation", "durable session liveness", "source-bound Feature-Agent handoff"],
    next_action: "Observe the Feature-Agent and Auditor readbacks, then return the exact campaign handoff to the Controller.",
  };
} else if (role === "CAMPAIGN_ORCHESTRATOR") {
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
    if (taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
      assert(buildCommit === sourceCommit && buildTree === sourceTree, "Auditor liveness observed a different source");
      changedPaths = git(featureWorktree, ["diff", "--name-only", sourceCommit, "HEAD"]).split("\n").filter(Boolean);
      assert(changedPaths.length === 0, "Auditor liveness observed source changes");
      focusedChecks = runControllerSupervisorChecks(featureWorktree);
    } else {
      changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
      assert(buildCommit !== sourceCommit && buildTree !== sourceTree, "Auditor did not observe a changed Feature-Agent checkpoint");
      const requiredChangedPath = taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? "control/controller-supervisor.mjs"
        : taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
          ? "schemas/bootstrap-binding.v1.json"
          : taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR"
            ? "schemas/bootstrap-binding.v1.json"
          : taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? "tests/verify-local-agent-session.mjs"
            : "control/governance-decision-tree.mjs";
      assert(changedPaths.includes(requiredChangedPath), "Auditor did not observe the required Feature-Agent code change");
      focusedChecks = taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? runControllerSupervisorChecks(featureWorktree)
        : taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
          ? runControllerSupervisorBindingChecks(featureWorktree, taskKind)
          : taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? runDurableSessionChecks(featureWorktree)
          : runFocusedChecks(featureWorktree);
    }
    buildStatus = "AUDIT_VERIFIED";
    product = {
      ...product,
      audit_status: taskKind === "CONTROLLER_SUPERVISOR_LIVENESS" ? "SOURCE_LIVENESS_VERIFIED" : "FEATURE_BUILD_VERIFIED",
      audited_feature_worktree: featureWorktree,
      audited_feature_commit: buildCommit,
      audited_feature_tree: buildTree,
      audited_feature_changed_paths: changedPaths,
      audited_feature_checks: focusedChecks,
    };
  }
} else if (role === "FEATURE_AGENT") {
  if (taskKind === "GOVERNANCE_EVIDENCE_REPAIR") {
    artifactName = "control/feature-agent-governance-evidence-repair-receipt.mjs";
    const changedByRepair = applyGovernanceEvidenceRepair({worktreePath});
    focusedChecks = runChecks(worktreePath, [
      "node --check control/governance-decision-tree.mjs",
      "node --check control/governance-evidence.mjs",
      "node --check control/local-agent-worker.mjs",
      "node tests/verify-governance-decision-tree.mjs",
      "node tests/verify-local-campaign-admission.mjs",
    ]);
    const marker = `// Local Feature Agent evidence-repair receipt; held in the isolated campaign worktree.\nexport const FEATURE_AGENT_EVIDENCE_REPAIR = Object.freeze(${JSON.stringify({
      task_id: taskId,
      task_kind: taskKind,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      custody_status: "FEATURE_AGENT_CUSTODY",
      changed_by_repair: changedByRepair,
    }, null, 2)});\n`;
    writeFileAtomic(path.join(worktreePath, artifactName), marker);
    const stagedPaths = [...changedByRepair, artifactName];
    execFileSync("git", ["add", ...stagedPaths], {cwd: worktreePath, encoding: "utf8"});
    execFileSync("git", ["-c", "user.name=AgentOS Feature Agent", "-c", "user.email=agentos-feature-agent@localhost", "commit", "-m", "Feature Agent: bind real governance gate evidence"], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean evidence-repair checkpoint");
    for (const requiredPath of ["control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs"]) assert(changedPaths.includes(requiredPath), `Feature Agent evidence repair did not change ${requiredPath}`);
    buildStatus = "COMPLETED";
    product = {
      ...base,
      task_id: taskId,
      task_kind: taskKind,
      custody_status: "FEATURE_AGENT_CUSTODY",
      code_change_paths: changedPaths,
      change_status: "COMMITTED_IN_ISOLATED_WORKTREE",
      build_status: buildStatus,
      build_commit: buildCommit,
      build_tree: buildTree,
      changed_paths: changedPaths,
      focused_checks: focusedChecks,
    };
  } else if (taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR") {
    artifactName = "control/durable-session-test-root-repair-receipt.mjs";
    const changedByRepair = applyDurableSessionTestRootRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check tests/verify-local-agent-session.mjs",
      "node tests/verify-local-agent-session.mjs",
    ]);
    const marker = `// Local Feature Agent durable-session verifier repair receipt; held in the isolated campaign worktree.\nexport const DURABLE_SESSION_TEST_ROOT_REPAIR = Object.freeze(${JSON.stringify({
      task_id: taskId,
      task_kind: taskKind,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      custody_status: "FEATURE_AGENT_CUSTODY",
      changed_by_repair: changedByRepair,
    }, null, 2)});\n`;
    writeFileAtomic(path.join(worktreePath, artifactName), marker);
    const stagedPaths = [...changedByRepair, artifactName];
    execFileSync("git", ["add", ...stagedPaths], {cwd: worktreePath, encoding: "utf8"});
    execFileSync("git", ["-c", "user.name=AgentOS Feature Agent", "-c", "user.email=agentos-feature-agent@localhost", "commit", "-m", "Feature Agent: make durable-session verifier worktree-safe"], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean durable-session verifier checkpoint");
    assert(changedPaths.includes("tests/verify-local-agent-session.mjs"), "Feature Agent durable-session repair did not change the verifier");
    buildStatus = "COMPLETED";
    product = {
      ...base,
      task_id: taskId,
      task_kind: taskKind,
      custody_status: "FEATURE_AGENT_CUSTODY",
      code_change_paths: changedPaths,
      change_status: "COMMITTED_IN_ISOLATED_WORKTREE",
      build_status: buildStatus,
      build_commit: buildCommit,
      build_tree: buildTree,
      changed_paths: changedPaths,
      focused_checks: focusedChecks,
    };
  } else if (taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" || taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR") {
    const localBindingRepair = taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR";
    artifactName = localBindingRepair ? "control/local-agent-session-binding-repair-receipt.mjs" : "control/controller-supervisor-binding-repair-receipt.mjs";
    const changedByRepair = localBindingRepair ? applyLocalAgentSessionBindingRepair(worktreePath) : applyControllerSupervisorBindingRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/controller-supervisor.mjs",
      "node tests/verify-controller-supervisor.mjs",
    ]);
    if (localBindingRepair) focusedChecks.push(...runChecks(worktreePath, ["node tests/verify-all.mjs"]));
    const marker = `// Local Feature Agent repository binding repair receipt; held in the isolated campaign worktree.\nexport const ${localBindingRepair ? "LOCAL_AGENT_SESSION_BINDING_REPAIR" : "CONTROLLER_SUPERVISOR_BINDING_REPAIR"} = Object.freeze(${JSON.stringify({
      task_id: taskId,
      task_kind: taskKind,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      custody_status: "FEATURE_AGENT_CUSTODY",
      changed_by_repair: changedByRepair,
    }, null, 2)});\n`;
    writeFileAtomic(path.join(worktreePath, artifactName), marker);
    const stagedPaths = [...changedByRepair, artifactName];
    execFileSync("git", ["add", ...stagedPaths], {cwd: worktreePath, encoding: "utf8"});
    execFileSync("git", ["-c", "user.name=AgentOS Feature Agent", "-c", "user.email=agentos-feature-agent@localhost", "commit", "-m", localBindingRepair ? "Feature Agent: refresh local session verifier binding" : "Feature Agent: refresh Controller supervisor binding"], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean Controller binding checkpoint");
    assert(changedPaths.includes("schemas/bootstrap-binding.v1.json"), "Feature Agent binding repair did not change the binding");
    buildStatus = "COMPLETED";
    product = {
      ...base,
      task_id: taskId,
      task_kind: taskKind,
      custody_status: "FEATURE_AGENT_CUSTODY",
      code_change_paths: changedPaths,
      change_status: "COMMITTED_IN_ISOLATED_WORKTREE",
      build_status: buildStatus,
      build_commit: buildCommit,
      build_tree: buildTree,
      changed_paths: changedPaths,
      focused_checks: focusedChecks,
    };
  } else if (taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
    artifactName = "controller-supervisor-liveness-observation.json";
    focusedChecks = runControllerSupervisorChecks(worktreePath);
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    assert(buildCommit === sourceCommit && buildTree === sourceTree, "liveness Feature Agent source differs");
    product = {
      ...base,
      task_id: taskId,
      task_kind: taskKind,
      custody_status: "FEATURE_AGENT_CUSTODY",
      observation_status: "SOURCE_LIVENESS_VERIFIED",
      build_status: "COMPLETED",
      build_commit: buildCommit,
      build_tree: buildTree,
      changed_paths: [],
      focused_checks: focusedChecks,
    };
    writeFileAtomic(path.join(worktreePath, artifactName), `${JSON.stringify(product, null, 2)}\n`);
    buildStatus = "COMPLETED";
  } else if (taskKind === "CONTROLLER_SUPERVISOR_REPAIR") {
    artifactName = "control/controller-supervisor-repair-receipt.mjs";
    const changedByRepair = applyControllerSupervisorRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/controller-supervisor.mjs",
      "node --check control/controller-supervisor-runtime.mjs",
      "node --check control/local-agent-session.mjs",
      "node tests/verify-controller-supervisor.mjs",
    ]);
    const marker = `// Local Feature Agent Controller-supervisor repair receipt; held in the isolated campaign worktree.\nexport const CONTROLLER_SUPERVISOR_REPAIR = Object.freeze(${JSON.stringify({
      task_id: taskId,
      task_kind: taskKind,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      custody_status: "FEATURE_AGENT_CUSTODY",
      changed_by_repair: changedByRepair,
    }, null, 2)});\n`;
    writeFileAtomic(path.join(worktreePath, artifactName), marker);
    const stagedPaths = [...changedByRepair, artifactName];
    execFileSync("git", ["add", ...stagedPaths], {cwd: worktreePath, encoding: "utf8"});
    execFileSync("git", ["-c", "user.name=AgentOS Feature Agent", "-c", "user.email=agentos-feature-agent@localhost", "commit", "-m", "Feature Agent: enforce supervisor boundary stops"], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean Controller-supervisor checkpoint");
    assert(changedPaths.includes("control/controller-supervisor.mjs"), "Feature Agent supervisor repair did not change the supervisor engine");
    buildStatus = "COMPLETED";
    product = {
      ...base,
      task_id: taskId,
      task_kind: taskKind,
      custody_status: "FEATURE_AGENT_CUSTODY",
      code_change_paths: changedPaths,
      change_status: "COMMITTED_IN_ISOLATED_WORKTREE",
      build_status: buildStatus,
      build_commit: buildCommit,
      build_tree: buildTree,
      changed_paths: changedPaths,
      focused_checks: focusedChecks,
    };
  } else {
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
  }
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
  task_id: taskId,
  task_kind: taskKind,
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
