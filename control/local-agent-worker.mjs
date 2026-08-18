#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {collectGovernanceGateEvidence} from "./governance-evidence.mjs";
import {pathToFileURL} from "node:url";
import {validateLocalTaskKindForRole} from "./local-task-kinds.mjs";
import {applyGovernanceEvidenceRepair} from "./feature-agent-governance-evidence-repair.mjs";
import {parseCheckCommand} from "./check-runner.mjs";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";
import {compileOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {openGlobalGovernanceAuthorityStore} from "./global-governance-bootstrap.mjs";
import {getSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";

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

const PROJECT_WORKER_COMMIT_NAME = "Project Worker";
const PROJECT_WORKER_COMMIT_EMAIL = "project-worker@localhost";
let checkScheduler = null;
let checkSchedulerContext = null;

function commitProjectWorktree(worktreePath, message) {
  execFileSync("git", [
    "-c", `user.name=${PROJECT_WORKER_COMMIT_NAME}`,
    "-c", `user.email=${PROJECT_WORKER_COMMIT_EMAIL}`,
    "commit", "-m", message,
  ], {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
}

function runChecks(worktreePath, checks) {
  const execute = () => {
    for (const check of checks) {
      const {program, args} = parseCheckCommand(check);
      execFileSync(program, args, {cwd: worktreePath, encoding: "utf8", maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"]});
    }
    return checks;
  };
  assert(checkScheduler !== null && checkSchedulerContext !== null, "worker checks require the shared Hybrid Scheduler");
  const candidate = schedulerCandidateIdentity(worktreePath);
  const heavyweight = checks.some((check) => /(?:build|compile|test|verify|integration|database|artifact)/iu.test(check));
  const request = compileHybridSchedulerRequest({
    requestId: `CHECK-${crypto.createHash("sha256").update(JSON.stringify({task: checkSchedulerContext.taskId, candidate, checks}), "utf8").digest("hex").slice(0, 32).toUpperCase()}`,
    requesterId: `WORKER-${crypto.createHash("sha256").update(String(checkSchedulerContext.taskId), "utf8").digest("hex").slice(0, 24).toUpperCase()}`,
    lane: `CHECK-${crypto.createHash("sha256").update(`${checkSchedulerContext.role}:${checkSchedulerContext.taskId}`, "utf8").digest("hex").slice(0, 24).toUpperCase()}`,
    repositoryId: "AGENTOS_PROJECT",
    worktreeId: `WORKTREE-${crypto.createHash("sha256").update(worktreePath, "utf8").digest("hex").slice(0, 24).toUpperCase()}`,
    candidateCommit: candidate.commit,
    candidateTreeOrDigest: candidate.tree,
    cleanState: candidate.clean,
    resourceClass: heavyweight ? "COMPILE_HEAVY" : "LIGHTWEIGHT_SOURCE_CHECK",
    workingDirectoryRef: opaqueSchedulerWorktreeRef(worktreePath),
    commandArgv: ["AGENTOS_CHECK_PLAN", ...checks],
    toolchainProfile: "NODE_HOST",
    proofClass: heavyweight ? "TEST_BATCH" : "SOURCE_CHECK",
    whyNeeded: "RUN_ADMITTED_CHECK_PLAN",
    expectedProof: "ALL_COMMANDS_EXIT_ZERO",
    coverage: checks.map((check) => `CHECK-${crypto.createHash("sha256").update(check, "utf8").digest("hex").slice(0, 16).toUpperCase()}`).sort(),
    timeoutClass: "BOUNDED",
    cachePolicy: "NO_SHARED_OUTPUT",
    secretPolicy: "REDACTED",
  });
  const scheduled = checkScheduler.runSync({
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
    execute,
  });
  return scheduled.output ?? checks;
}

function schedulerCandidateIdentity(worktreePath) {
  const commit = git(worktreePath, ["rev-parse", "HEAD"]);
  const tree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  const status = git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.length === 0) return {commit, tree, clean: true};
  const diff = execFileSync("git", ["-C", worktreePath, "diff", "--binary"], {encoding: "buffer", maxBuffer: 64 * 1024 * 1024});
  const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const dirtyDigest = crypto.createHash("sha256").update(JSON.stringify({
    commit,
    tree,
    status,
    diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"),
    untracked,
  }), "utf8").digest("hex");
  return {commit: "PRELIMINARY_DIAGNOSTIC", tree: dirtyDigest, clean: false};
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
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  assert(fs.existsSync(supervisorPath) && fs.existsSync(bindingPath), "Controller supervisor repair inputs are unavailable");
  const source = fs.readFileSync(supervisorPath, "utf8");
  const oldOrder = [
    '  if (observation.soft_boundary || hasOpenFinding(observation.findings, ["SOFT_BOUNDARY"])) return "REVIEW_SOFT_BOUNDARY";',
    '  if (hasOpenFinding(observation.findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) return "STOP_HARD_BOUNDARY";',
  ].join("\n");
  const newOrder = [
    '  if (hasOpenFinding(observation.findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) return "STOP_HARD_BOUNDARY";',
    '  if (observation.soft_boundary || hasOpenFinding(observation.findings, ["SOFT_BOUNDARY"])) return "REVIEW_SOFT_BOUNDARY";',
  ].join("\n");
  assert(source.includes(oldOrder) || source.includes(newOrder), "Controller supervisor boundary precedence is not at the expected source checkpoint");
  const oldGoalBoundary = "    boundary: structuredClone(observation.boundary),";
  const newGoalBoundary = [
    "    boundary: {",
    "      ...structuredClone(observation.boundary),",
    "      hard_stop: action === \"STOP_HARD_BOUNDARY\" || observation.boundary.hard_stop,",
    "    },",
  ].join("\n");
  assert(source.includes(oldGoalBoundary) || source.includes(newGoalBoundary), "Controller supervisor goal boundary is not at the expected source checkpoint");
  let repairedSource = source.includes(oldOrder) ? source.replace(oldOrder, newOrder) : source;
  if (repairedSource.includes(oldGoalBoundary)) repairedSource = repairedSource.replace(oldGoalBoundary, newGoalBoundary);
  writeFileAtomic(supervisorPath, repairedSource);
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const controllerEntry = Object.values(binding.normative ?? {}).find((entry) => entry?.path === "control/controller-supervisor.mjs");
  assert(controllerEntry !== undefined, "Controller supervisor binding entry is unavailable");
  controllerEntry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(supervisorPath)).digest("hex");
  writeFileAtomic(bindingPath, JSON.stringify(binding, null, 2) + "\n");
  return ["control/controller-supervisor.mjs", "schemas/bootstrap-binding.v1.json"];
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

function applyDurableSessionLivenessRepair(worktreePath) {
  const runtimePath = path.join(worktreePath, "control/local-agent-runtime.mjs");
  const testPath = path.join(worktreePath, "tests/verify-local-agent-session.mjs");
  assert(fs.existsSync(runtimePath) && fs.existsSync(testPath), "durable-session liveness repair inputs are unavailable");
  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const oldBranch = "  if (!pidAlive(session.pid)) return session;";
  const newBranch = [
    "  if (!pidAlive(session.pid)) {",
    "    return markDurableWorkerSessionFailed({sessionRecordPath, failure: \"durable worker process exited before stop\"});",
    "  }",
  ].join("\n");
  assert(runtimeSource.includes(oldBranch), "durable-session stop path is not at the expected liveness checkpoint");
  writeFileAtomic(runtimePath, runtimeSource.replace(oldBranch, newBranch));

  let testSource = fs.readFileSync(testPath, "utf8");
  if (!testSource.includes("SMOKE-UNEXPECTED-DEATH-1")) {
    const anchor = "\n} finally {\n  if (started && worktreePath) {";
    const livenessTest = [
      "  const unexpected = await startDurableWorkerSession({",
      "    repoRoot: root,",
      "    runtimeRoot,",
      "    role: \"FEATURE_AGENT\",",
      "    campaignId,",
      "    campaignVersion: \"v1\",",
      "    candidateSha256: crypto.createHash(\"sha256\").update(campaignId + \"-unexpected\").digest(\"hex\"),",
      "    sourceCommit,",
      "    sourceTree,",
      "    task: \"Run an abrupt session-exit durability test.\",",
      "    taskId: \"SMOKE-UNEXPECTED-DEATH-1\",",
      "    taskKind: \"INITIAL\",",
      "  });",
      "  const unexpectedWorktreePath = unexpected.session_record.worktree_path;",
      "  const unexpectedRecordPath = path.join(runtimeRoot, \"sessions\", campaignId + \"-v1\", \"FEATURE_AGENT-SMOKE-UNEXPECTED-DEATH-1\", \"session.json\");",
      "  try {",
      "    process.kill(Number(unexpected.session_record.pid), \"SIGKILL\");",
      "    await new Promise((resolve) => setTimeout(resolve, 100));",
      "    const failed = await stopDurableWorkerSession({sessionRecordPath: unexpectedRecordPath});",
      "    validateLocalDurableSessionRecord(failed);",
      "    assert.equal(failed.status, \"FAILED\");",
      "    assert.match(failed.failure, /process exited before stop/u);",
      "  } finally {",
      "    try {",
      "      execFileSync(\"git\", [\"-C\", root, \"worktree\", \"remove\", \"--force\", unexpectedWorktreePath], {encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"]});",
      "    } catch {",
      "      // The abrupt-exit test retains no user worktree; an already-removed test worktree is safe.",
      "    }",
      "  }",
    ].join("\n");
    assert(testSource.includes(anchor), "durable-session liveness test insertion point is unavailable");
    testSource = testSource.replace(anchor, `\n${livenessTest}${anchor}`);
  }
  writeFileAtomic(testPath, testSource);
  return ["control/local-agent-runtime.mjs", "tests/verify-local-agent-session.mjs"];
}

function applyAutonomousCampaignProgressRepair(worktreePath) {
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  assert(fs.existsSync(adapterPath), "autonomous campaign progress repair adapter is unavailable");
  let source = fs.readFileSync(adapterPath, "utf8");
  const taskRegion = /  const task = checkpointIsCurrent\n[\s\S]*?  if \(sameSource\) \{/u;
  const repairedTaskRegion = [
    "  const auditTaskId = `CONTROLLER-WORKFLOW-AUDIT-${sourceCommit.slice(0, 16).toUpperCase()}`;",
    "  const buildTaskId = `CAMPAIGN-PROGRESS-BUILD-${sourceCommit.slice(0, 16).toUpperCase()}`;",
    "  const sameSource = existing !== null && existing.source_commit === sourceCommit && existing.source_tree === sourceTree;",
    "  const completedCurrentAudit = sameSource && existing.tasks.some((candidate) => candidate.task_id === auditTaskId && candidate.status === \"COMPLETED\");",
    "  const task = completedCurrentAudit",
    "    ? {",
    "      task_id: buildTaskId,",
    "      status: \"OPEN\",",
    "      priority: 0,",
    "      summary: `Continue the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}. The Orchestrator selects the next bounded control-plane behavior, the Feature Agent builds it, and the Auditor checks the same result.`,",
    "      scope: [\"ACCEPTANCE_CONTRACT\", \"DECISION_TREE\", \"OWNER_INTENT\", \"SCOPED_CONTROL_PLANE_CODE\", \"WORKER_RECEIPTS\"].sort(),",
    "      owner_decision_required: false,",
    "    }",
    "    : checkpointIsCurrent",
    "    ? {",
    "      task_id: auditTaskId,",
    "      status: \"OPEN\",",
    "      priority: 0,",
    "      summary: \"Recheck the accepted local checkpoint, campaign handoff, worker receipts, retained failures, and the next safe control-plane action.\",",
    "      scope: [\"ACTIVE_CAMPAIGN_HANDOFF\", \"ACCEPTED_LOCAL_CHECKPOINT\", \"CONTROLLER_STATE\", \"WORKER_RECEIPTS\"].sort(),",
    "      owner_decision_required: false,",
    "    }",
    "    : {",
    "      task_id: buildTaskId,",
    "      status: \"OPEN\",",
    "      priority: 0,",
    "      summary: `Carry out the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}. The Orchestrator selects the next bounded control-plane repair, the Feature Agent builds it, and the Auditor checks the same result.`,",
    "      scope: [\"ACCEPTANCE_CONTRACT\", \"DECISION_TREE\", \"OWNER_INTENT\", \"SCOPED_CONTROL_PLANE_CODE\", \"WORKER_RECEIPTS\"].sort(),",
    "      owner_decision_required: false,",
    "    };",
    "  if (sameSource) {",
  ].join("\n");
  assert(taskRegion.test(source), "autonomous campaign queue state machine is not at the expected source checkpoint");
  source = source.replace(taskRegion, repairedTaskRegion);
  const oldReasons = [
    [
      "      generated_reason: checkpointIsCurrent",
      "        ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK\"",
      "        : \"ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED\",",
    ].join("\n"),
    [
      "    generated_reason: checkpointIsCurrent",
      "      ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK\"",
      "      : \"ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED\",",
    ].join("\n"),
  ];
  const newReasons = [
    [
      "      generated_reason: completedCurrentAudit",
      "        ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_NEXT_CAMPAIGN_BEHAVIOR\"",
      "        : checkpointIsCurrent",
      "        ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK\"",
      "        : \"ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED\",",
    ].join("\n"),
    [
      "    generated_reason: completedCurrentAudit",
      "      ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_NEXT_CAMPAIGN_BEHAVIOR\"",
      "      : checkpointIsCurrent",
      "      ? \"ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK\"",
      "      : \"ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED\",",
    ].join("\n"),
  ];
  for (let index = 0; index < oldReasons.length; index += 1) {
    assert(source.includes(oldReasons[index]), `autonomous campaign queue generated-reason ${index + 1} is not at the expected source checkpoint`);
    source = source.replace(oldReasons[index], newReasons[index]);
  }
  writeFileAtomic(adapterPath, source);
  return ["control/local-self-development-supervisor-adapter.mjs"];
}

function applyAutonomousCampaignContinuationRepair(worktreePath) {
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  assert(fs.existsSync(adapterPath), "autonomous campaign continuation repair adapter is unavailable");
  let source = fs.readFileSync(adapterPath, "utf8");
  const taskRegion = /  const task = firstUsefulWorkflowCompleted\n[\s\S]*?\n    : completedCurrentAudit/u;
  const repairedTaskRegion = [
    "  const continuationCount = Number.isSafeInteger(campaignProgress?.autonomous_continuation_count) ? campaignProgress.autonomous_continuation_count : 0;",
    "  const continuationEligible = firstUsefulWorkflowCompleted && continuationCount < 1;",
    "  const task = continuationEligible",
    "    ? {",
    "      task_id: buildTaskId,",
    "      status: \"OPEN\",",
    "      priority: 0,",
    "      summary: `The Controller selected one bounded next control-plane behavior from the standing owner intent: ${executionContext.firstUsefulWorkflow}. The Orchestrator selects its exact repair, the Feature Agent builds it, and the Auditor checks the same result.`,",
    "      scope: [\"ACCEPTANCE_CONTRACT\", \"DECISION_TREE\", \"OWNER_INTENT\", \"SCOPED_CONTROL_PLANE_CODE\", \"WORKER_RECEIPTS\"].sort(),",
    "      owner_decision_required: false,",
    "    }",
    "    : firstUsefulWorkflowCompleted",
    "    ? {",
    "      task_id: completedTaskId,",
    "      status: \"HELD\",",
    "      priority: 0,",
    "      summary: \"The owner-defined first useful workflow and one bounded autonomous continuation are complete at audited local checkpoints; no additional safe control-plane behavior is currently declared.\",",
    "      scope: [\"ACCEPTANCE_CONTRACT\", \"CONTROLLER_STATE\", \"OWNER_INTENT\", \"WORKER_RECEIPTS\"].sort(),",
    "      owner_decision_required: false,",
    "    }",
    "    : completedCurrentAudit",
  ].join("\n");
  assert(taskRegion.test(source), "autonomous campaign continuation queue is not at the expected source checkpoint");
  source = source.replace(taskRegion, repairedTaskRegion);
  const oldReasons = [
    [
      "      generated_reason: firstUsefulWorkflowCompleted",
      "        ? \"FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT\"",
      "        : completedCurrentAudit",
    ].join("\n"),
    [
      "    generated_reason: firstUsefulWorkflowCompleted",
      "      ? \"FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT\"",
      "      : completedCurrentAudit",
    ].join("\n"),
  ];
  const newReasons = [
    [
      "      generated_reason: continuationEligible",
      "        ? \"AUTONOMOUS_CONTINUATION_REQUIRED\"",
      "        : firstUsefulWorkflowCompleted",
      "        ? \"FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT\"",
      "        : completedCurrentAudit",
    ].join("\n"),
    [
      "    generated_reason: continuationEligible",
      "      ? \"AUTONOMOUS_CONTINUATION_REQUIRED\"",
      "      : firstUsefulWorkflowCompleted",
      "      ? \"FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT\"",
      "      : completedCurrentAudit",
    ].join("\n"),
  ];
  for (let index = 0; index < oldReasons.length; index += 1) {
    assert(source.includes(oldReasons[index]), `autonomous campaign continuation generated-reason ${index + 1} is not at the expected source checkpoint`);
    source = source.replace(oldReasons[index], newReasons[index]);
  }
  const oldProgressField = "        first_useful_workflow_completed: true,\n";
  const newProgressFields = [
    "        first_useful_workflow_completed: true,",
    "        autonomous_continuation_count: (existingCampaignProgress?.autonomous_continuation_count ?? 0) + (existingCampaignProgress?.first_useful_workflow_completed === true ? 1 : 0),",
  ].join("\n") + "\n";
  assert(source.includes(oldProgressField), "autonomous campaign progress completion field is not at the expected source checkpoint");
  source = source.replace(oldProgressField, newProgressFields);
  writeFileAtomic(adapterPath, source);
  return ["control/local-self-development-supervisor-adapter.mjs"];
}

function applyOwnerConversationSurfaceRepair(worktreePath) {
  const bootstrapPath = path.join(worktreePath, "control/bootstrap-compiler.mjs");
  const ownerReviewPath = path.join(worktreePath, "control/owner-review.mjs");
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  const testPath = path.join(worktreePath, "tests/verify-owner-conversation-surface.mjs");
  const ownerReviewVerifierPath = path.join(worktreePath, "tests/verify-owner-review.mjs");
  assert(fs.existsSync(bootstrapPath) && fs.existsSync(ownerReviewPath) && fs.existsSync(bindingPath) && fs.existsSync(ownerReviewVerifierPath), "owner conversation surface repair inputs are unavailable");
  let source = fs.readFileSync(bootstrapPath, "utf8");
  const replacements = new Map([
    ["May Bootstrap perform safe read-only discovery so it can answer technical setup questions for you?", "May I take a quick look around without changing anything, so I can understand how to set things up?"],
    ["Who is this for, what recurring moment matters, and what should be better after the project works?", "Who is this for, what would you like it to make easier, and what would a good result feel like?"],
    ["What is the smallest real workflow that proves the project is useful, and what does working mean?", "What is the first small thing you want people to be able to do, and how will you know it worked?"],
    ["How real should this project be for its first users: a prototype, a limited working product, a beta, or production; who may use it, what data may it hold, and how long should it live?", "How real should the first version be: a rough try, a small working version, a beta, or something ready for everyday use? Who should use it, what information may it keep, and how long should it live?"],
    ["Which repositories, data, environments, and external systems belong inside the project boundary?", "What should this project be allowed to touch, and what should stay off-limits?"],
    ["How much should AgentOS change while importing this existing project: use it as-is, make a clean copy, normalize and audit it, or reconstruct it from intent?", "Should I leave the current project as it is, make a separate copy, tidy it up, or use it as a reference for a fresh version?"],
    ["Which safety, legal, privacy, data-loss, spending, authentication, irreversible-action, or intent boundaries remain owner-controlled?", "What must I never do, change, share, or spend without you?"],
    ["Should Bootstrap import, refactor, or create the authority corpus, and which read-only source should be preserved?", "Are there notes, instructions, or an older version I should keep safe and use as background?"],
    ["Which users, devices, accessibility needs, protected visual surfaces, page families, and states must the Design Bible govern?", "Who will use it, what will they use it on, and are there any important look-and-feel or accessibility needs?"],
    ["Are any stack, authentication, testing, data, or observability choices required or forbidden?", "Is there anything you already want me to use or avoid? If not, I can choose a sensible starting point."],
    ["How should Bootstrap handle pushes, merges, CI runners, hosting, deployment, rollback, provider binding, and delivery cost limits?", "Is there anything special about how this should be saved, shared, or put online? If not, I can use the safest simple option."],
    ["Which operating conditions apply: continuous eco, standard workweek, performance-first, or typed custom conditions?", "Should I favor saving effort, finishing sooner, taking extra care, or should I recommend a balance?"],
    ["Which persistent Runtime session and environment should remain available across campaigns, and what capabilities may it use?", "Would you like me to remember this project between work sessions? If so, what should that memory be allowed to use?"],
  ]);
  for (const [oldText, newText] of replacements) {
    const oldLine = `prompt: "${oldText}"`;
    const newLine = `prompt: "${newText}"`;
    if (source.includes(oldLine)) source = source.replace(oldLine, newLine);
    else assert(source.includes(newLine), `owner conversation prompt is not at the expected source checkpoint: ${oldText}`);
  }
  source = source.replace('    owner_visible: false,\n', '');
  writeFileAtomic(bootstrapPath, source);

  let ownerReviewSource = fs.readFileSync(ownerReviewPath, "utf8");
  const oldReviewBlock = [
    '    "## A practical suggestion", "",',
    '    `For this conversation, ${friendlyLevel} is suggested. For the build itself, the current recommendation is ${friendlyModel(chat.model_class)}.`,',
    '    "The role recommendations are:", recommendedRoles, "",',
    '    `This task is currently described as ${packet.candidate_campaign.task_profile.difficulty.toLowerCase().replaceAll("_", " ")} work, with ${packet.candidate_campaign.task_profile.time_sensitivity.toLowerCase()} time sensitivity and ${packet.candidate_campaign.task_profile.cost_sensitivity.toLowerCase()} cost sensitivity.`, "",',
    '    "These are recommendations, not commitments. Tell me naturally if you care most about saving cost, finishing quickly, or getting the strongest reasoning, and I will reflect that preference.",',
  ].join("\n");
  const newReviewBlock = [
    '    "## A practical suggestion", "",',
    '    "I will keep the build details in the background. If you care most about saving effort, finishing sooner, or taking extra care, just tell me.",',
  ].join("\n");
  if (ownerReviewSource.includes(oldReviewBlock)) ownerReviewSource = ownerReviewSource.replace(oldReviewBlock, newReviewBlock);
  else assert(ownerReviewSource.includes(newReviewBlock), "owner review practical suggestion is not at the expected source checkpoint");
  ownerReviewSource = ownerReviewSource.replace(
    '    "Keep the packet, internal field names, hashes, and technical governance terms in the background. Do not expose schema questions. Ask a technical or operational question only when a genuine boundary or lasting decision requires it.",',
    '    "Keep the behind-the-scenes notes out of this conversation. Do not show internal questions. Ask for extra details only when a real boundary or lasting choice truly needs them.",',
  );
  ownerReviewSource = ownerReviewSource.replace(
    '    "When we are finished, I will play the plan back in ordinary language. You may answer in your own words; headings are optional. Do not say that the project changed. AgentOS will turn the conversation into a bound candidate and show the owner the exact result for separate approval. Saying that the plan sounds right is not approval by itself.",',
    '    "When we are finished, I will play the plan back in ordinary language. You may answer in your own words; headings are optional. The project will not change just because the conversation sounds right; you will see the clear plan before anything starts.",',
  );
  const promptListPattern = /    "Use only the prompts that are needed; they are examples, not a fixed script:",\n(?:    "\d\. [^"]*",\n){5}    \.\.\.modelBalancePrompt\.slice\(1\)\.map\(\(line\) => [^\n]*\n    "",/u;
  const newPromptList = [
    '    "Ask only what we need, one short question at a time. You do not need to fill out a checklist.",',
    '    "If I give you a few choices, reply with one number.",',
    '    "",',
  ].join("\n");
  assert(promptListPattern.test(ownerReviewSource) || ownerReviewSource.includes(newPromptList), "owner review question list is not at the expected source checkpoint");
  ownerReviewSource = ownerReviewSource.replace(promptListPattern, newPromptList);
  writeFileAtomic(ownerReviewPath, ownerReviewSource);

  let ownerReviewVerifierSource = fs.readFileSync(ownerReviewVerifierPath, "utf8");
  const oldOwnerReviewAssertion = '  assert(renderedPacket.includes("Do not expose schema questions"));';
  const existingOwnerReviewAssertions = [
    '  assert(renderedPacket.includes("Keep the behind-the-scenes notes out of this conversation"));',
    '  assert(!renderedPacket.includes("For the build itself, the current recommendation is"));',
    '  assert(!renderedPacket.includes("The role recommendations are:"));',
    '  assert(!renderedPacket.includes("This task is currently described as"));',
  ].join("\n");
  const newOwnerReviewAssertions = [
    existingOwnerReviewAssertions,
    '  assert(renderedPacket.includes("one short question at a time"));',
    '  assert(renderedPacket.includes("If I give you a few choices, reply with one number."));',
    '  assert(!renderedPacket.includes("What would you love this to make easier?"));',
  ].join("\n");
  if (ownerReviewVerifierSource.includes(oldOwnerReviewAssertion)) ownerReviewVerifierSource = ownerReviewVerifierSource.replace(oldOwnerReviewAssertion, newOwnerReviewAssertions);
  else if (ownerReviewVerifierSource.includes(existingOwnerReviewAssertions)) ownerReviewVerifierSource = ownerReviewVerifierSource.replace(existingOwnerReviewAssertions, newOwnerReviewAssertions);
  else assert(ownerReviewVerifierSource.includes(newOwnerReviewAssertions), "owner review verifier is not at the expected source checkpoint");
  const oldChecklistAssertion = '  assert(renderedPacket.includes("they are examples, not a fixed script"));';
  const newChecklistAssertion = '  assert(!renderedPacket.includes("they are examples, not a fixed script"));';
  if (ownerReviewVerifierSource.includes(oldChecklistAssertion)) ownerReviewVerifierSource = ownerReviewVerifierSource.replace(oldChecklistAssertion, newChecklistAssertion);
  else assert(ownerReviewVerifierSource.includes(newChecklistAssertion), "owner review checklist assertion is not at the expected source checkpoint");
  const oldNumericAssertion = '  assert(renderedPacket.includes("Reply with one number"));';
  const newNumericAssertion = '  assert(renderedPacket.includes("If I give you a few choices, reply with one number."));';
  if (ownerReviewVerifierSource.includes(oldNumericAssertion)) ownerReviewVerifierSource = ownerReviewVerifierSource.replace(oldNumericAssertion, newNumericAssertion);
  else assert(ownerReviewVerifierSource.includes(newNumericAssertion), "owner review numeric answer assertion is not at the expected source checkpoint");
  writeFileAtomic(ownerReviewVerifierPath, ownerReviewVerifierSource);

  const testSource = String.raw`#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {BOOTSTRAP_QUESTIONS, planBootstrapQuestions} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";

const FORBIDDEN_OWNER_TERMS = [
  /technical setup/iu,
  /\bproves?\b/iu,
  /\bproving\b/iu,
  /\bstack\b/iu,
  /\bauthentication\b/iu,
  /\bobservability\b/iu,
  /\brepositor(?:y|ies)\b/iu,
  /\benvironments?\b/iu,
  /\bexternal systems?\b/iu,
  /\bauthority corpus\b/iu,
  /\bdesign bible\b/iu,
  /\boperating conditions?\b/iu,
  /\bpersistent runtime\b/iu,
  /\bCI runners?\b/iu,
  /\bprovider binding\b/iu,
];

const FORBIDDEN_REVIEW_OUTPUT = [
  "For the build itself, the current recommendation is",
  "The role recommendations are:",
  "This task is currently described as",
  "technical governance terms",
  "exact result for separate approval",
  "Use only the prompts that are needed; they are examples, not a fixed script:",
  "What would you love this to make easier?",
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owner-conversation-surface-"));
try {
  const ownerReviewSource = fs.readFileSync(new URL("../control/owner-review.mjs", import.meta.url), "utf8");
  for (const phrase of FORBIDDEN_REVIEW_OUTPUT) assert(!ownerReviewSource.includes(phrase), "Ongoing owner review exposes " + phrase);
  for (const question of BOOTSTRAP_QUESTIONS) {
    for (const pattern of FORBIDDEN_OWNER_TERMS) assert(!pattern.test(question.prompt), "Bootstrap owner prompt exposes " + pattern + ": " + question.id);
  }
  const discovery = discoverProject(root, "RECOMMENDED").facts;
  const plan = planBootstrapQuestions({discovery, answers: {"bootstrap.discovery.mode": "RECOMMENDED"}});
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.owner_questions.length, 1);
  assert.equal(plan.owner_questions[0].prompt, plan.questions[0].prompt);
  for (const pattern of FORBIDDEN_OWNER_TERMS) {
    assert(!pattern.test(plan.questions[0].prompt), "Bootstrap question exposes " + pattern);
    assert(!pattern.test(plan.owner_questions[0].prompt), "Bootstrap owner question exposes " + pattern);
  }
  console.log("PASS Bootstrap owner conversation surface stays casual and nontechnical");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
`;
  writeFileAtomic(testPath, testSource);

  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const changedPaths = ["control/bootstrap-compiler.mjs", "control/owner-review.mjs", "schemas/bootstrap-binding.v1.json", "tests/verify-owner-conversation-surface.mjs", "tests/verify-owner-review.mjs"];
  let refreshed = 0;
  const bindingSources = new Map([
    ["control/bootstrap-compiler.mjs", bootstrapPath],
    ["control/owner-review.mjs", ownerReviewPath],
    ["tests/verify-owner-review.mjs", ownerReviewVerifierPath],
  ]);
  for (const entry of Object.values(binding.normative ?? {})) {
    const sourcePath = bindingSources.get(entry?.path);
    if (sourcePath === undefined) continue;
    entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    refreshed += 1;
  }
  assert(refreshed === 3, "Bootstrap, owner-review, or owner-review verifier binding entry is unavailable");
  writeFileAtomic(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  return changedPaths;
}

function applyOwnerFeedbackRepair(worktreePath, feedbackId) {
  const taskLoopPath = path.join(worktreePath, "control/task-run-loop.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-task-run-loop.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  assert(fs.existsSync(taskLoopPath) && fs.existsSync(verifierPath) && fs.existsSync(backlogPath) && fs.existsSync(bindingPath), "owner feedback repair inputs are unavailable");
  const taskLoopSource = fs.readFileSync(taskLoopPath, "utf8");
  const marker = "export function renderOwnerInactiveBoundaryMessage";
  assert(!taskLoopSource.includes(marker), "owner feedback inactive explanation repair was already applied");
  const helper = [
    "export function renderOwnerInactiveBoundaryMessage({taskId, boundary}) {",
    "  requireIdentifier(taskId, \"inactive task\");",
    "  requireRecord(boundary, \"inactive task boundary\");",
    "  assert(boundary.active_campaign === false && boundary.campaign_activation_allowed === false, \"inactive explanation requires an inactive boundary\");",
    "  for (const field of [\"product_writes_allowed\", \"product_agent_spawns_allowed\", \"deployment_allowed\", \"publication_allowed\", \"push_allowed\", \"merge_allowed\"]) {",
    "    assert(boundary[field] === false, `inactive explanation boundary ${field} is not closed`);",
    "  }",
    "  return \"I am keeping this safely paused while setup is still in place. I have not changed the project, started extra agents, or sent anything out. The next safe step is to review the prepared work; it will stay paused until you choose to turn it on.\";",
    "}",
    "",
  ].join("\n");
  const prepareMarker = "export function prepareQueuedContinuationTask";
  assert(taskLoopSource.includes(prepareMarker), "queued continuation task function is unavailable");
  let repairedTaskLoop = taskLoopSource.replace(prepareMarker, `${helper}${prepareMarker}`);
  const oldNextAction = '    next_action: "AgentOS Controller will run only the queued control-plane task; keep the campaign inactive.",';
  const newNextAction = "    next_action: renderOwnerInactiveBoundaryMessage({taskId: task.task_id, boundary: task.boundary}),";
  assert(repairedTaskLoop.includes(oldNextAction), "inactive continuation next action is not at the expected source checkpoint");
  repairedTaskLoop = repairedTaskLoop.replace(oldNextAction, newNextAction);
  writeFileAtomic(taskLoopPath, repairedTaskLoop);

  let verifierSource = fs.readFileSync(verifierPath, "utf8");
  const oldImport = "  prepareQueuedContinuationTask,\n";
  assert(verifierSource.includes(oldImport), "task run loop verifier import is unavailable");
  verifierSource = verifierSource.replace(oldImport, `${oldImport}  renderOwnerInactiveBoundaryMessage,\n`);
  const oldAssertion = 'assert.equal(prepared.startHandoff.next_action.includes("AgentOS Controller"), true);';
  const newAssertions = [
    "const inactiveMessage = renderOwnerInactiveBoundaryMessage({taskId: prepared.task.task_id, boundary: prepared.task.boundary});",
    "assert.equal(prepared.startHandoff.next_action, inactiveMessage);",
    'assert.match(inactiveMessage, /safely paused while setup is still in place/u);',
    'assert.match(inactiveMessage, /have not changed the project, started extra agents, or sent anything out/u);',
    'assert.doesNotMatch(inactiveMessage, /campaign_activation_allowed/u);',
    'reject("inactive explanation crosses activation", () => renderOwnerInactiveBoundaryMessage({taskId: prepared.task.task_id, boundary: {...prepared.task.boundary, campaign_activation_allowed: true}}));',
  ].join("\n");
  assert(verifierSource.includes(oldAssertion), "task run loop verifier inactive handoff assertion is unavailable");
  verifierSource = verifierSource.replace(oldAssertion, newAssertions);
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith(`| \`${feedbackId}\` |`) && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));

  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const bindingSources = new Map([
    ["control/task-run-loop.mjs", taskLoopPath],
    ["tests/verify-task-run-loop.mjs", verifierPath],
  ]);
  let refreshed = 0;
  for (const entry of Object.values(binding.normative ?? {})) {
    const sourcePath = bindingSources.get(entry?.path);
    if (sourcePath === undefined) continue;
    entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    refreshed += 1;
  }
  assert(refreshed === 2, "task run loop binding entries are unavailable");
  writeFileAtomic(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);

  const artifactName = "control/owner-feedback-inactive-explanation-repair-receipt.mjs";
  const changedByRepair = ["control/task-run-loop.mjs", "docs/owner-feedback-backlog.md", "schemas/bootstrap-binding.v1.json", "tests/verify-task-run-loop.mjs"];
  return {changedByRepair, artifactName};
}

function applyOwnerFeedbackStatusRepair(worktreePath, feedbackId) {
  const runtimePath = path.join(worktreePath, "control/local-agent-runtime.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-local-agent-session.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  const bindingPath = path.join(worktreePath, "schemas/bootstrap-binding.v1.json");
  assert(fs.existsSync(runtimePath) && fs.existsSync(verifierPath) && fs.existsSync(backlogPath) && fs.existsSync(bindingPath), "owner feedback status repair inputs are unavailable");
  const runtimeMarker = "export function durableWorkerTaskStatus";
  let runtimeSource = fs.readFileSync(runtimePath, "utf8");
  assert(!runtimeSource.includes(runtimeMarker), "owner feedback status reconciliation repair was already applied");
  const runtimeInsertionMarker = "export function compileDurableWorkerSessionCommand";
  assert(runtimeSource.includes(runtimeInsertionMarker), "durable worker session command function is unavailable");
  const helper = [
    "export function durableWorkerTaskStatus(session) {",
    "  validateLocalDurableSessionRecord(session);",
    "  if (session.initial_readback?.status === \"COMPLETED\") return \"COMPLETED\";",
    "  if (session.status === \"FAILED\") return \"FAILED\";",
    "  if (session.status === \"STOPPED\") return \"STOPPED\";",
    "  if (session.status === \"STOPPING\") return \"STOPPING\";",
    "  if (session.status === \"STARTING\") return \"STARTING\";",
    "  return \"IN_PROGRESS\";",
    "}",
    "",
  ].join("\n");
  runtimeSource = runtimeSource.replace(runtimeInsertionMarker, `${helper}${runtimeInsertionMarker}`);
  writeFileAtomic(runtimePath, runtimeSource);

  let verifierSource = fs.readFileSync(verifierPath, "utf8");
  const oldImport = "  compileDurableWorkerSessionCommand,\n";
  assert(verifierSource.includes(oldImport), "durable session verifier import is unavailable");
  verifierSource = verifierSource.replace(oldImport, `${oldImport}  durableWorkerTaskStatus,\n`);
  const oldAssertion = '  assert.equal(started.readback.status, "COMPLETED");';
  assert(verifierSource.includes(oldAssertion), "durable session verifier completion assertion is unavailable");
  verifierSource = verifierSource.replace(oldAssertion, `${oldAssertion}\n  assert.equal(durableWorkerTaskStatus(started.session_record), "COMPLETED");`);
  const stoppedAssertion = '  assert.equal(stopped.status, "STOPPED");';
  assert(verifierSource.includes(stoppedAssertion), "durable session verifier stopped assertion is unavailable");
  verifierSource = verifierSource.replace(stoppedAssertion, `${stoppedAssertion}\n  assert.equal(durableWorkerTaskStatus(stopped), "COMPLETED");`);
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith(`| \`${feedbackId}\` |`) && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));

  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  let refreshed = 0;
  for (const entry of Object.values(binding.normative ?? {})) {
    if (entry?.path !== "tests/verify-local-agent-session.mjs") continue;
    entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(verifierPath)).digest("hex");
    refreshed += 1;
  }
  assert(refreshed === 1, "durable session verifier binding entry is unavailable");
  writeFileAtomic(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  return {
    changedByRepair: ["control/local-agent-runtime.mjs", "docs/owner-feedback-backlog.md", "schemas/bootstrap-binding.v1.json", "tests/verify-local-agent-session.mjs"],
    artifactName: "control/owner-feedback-status-reconciliation-repair-receipt.mjs",
  };
}

function applyOwnerFeedbackDigestRepair(worktreePath, feedbackId) {
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-owner-feedback-digest.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  assert(fs.existsSync(adapterPath) && fs.existsSync(backlogPath), "owner feedback digest repair inputs are unavailable");

  let adapterSource = fs.readFileSync(adapterPath, "utf8");
  const conflictMarker = "export function resolveAddressedRecordConflict";
  assert(!adapterSource.includes(conflictMarker), "owner feedback digest repair was already applied");
  const writerStartMarker = "function writeAddressed(root, name, value, field = \"record_sha256\") {";
  const writerEndMarker = "function readAddressed(root, name, field) {";
  const writerStart = adapterSource.indexOf(writerStartMarker);
  const writerEnd = adapterSource.indexOf(writerEndMarker);
  assert(writerStart >= 0 && writerEnd > writerStart, "addressed record writer is unavailable");
  const replacementWriter = [
    "export function resolveAddressedRecordConflict({recordName, digestField, existingRecord, replacementRecord}) {",
    "  requireString(recordName, \"addressed record name\");",
    "  requireString(digestField, \"addressed record digest field\");",
    "  assert(existingRecord && typeof existingRecord === \"object\" && !Array.isArray(existingRecord), \"existing addressed record is required\");",
    "  assert(replacementRecord && typeof replacementRecord === \"object\" && !Array.isArray(replacementRecord), \"replacement addressed record is required\");",
    "  requireSha(existingRecord[digestField], \"existing addressed record digest\");",
    "  requireSha(replacementRecord[digestField], \"replacement addressed record digest\");",
    "  if (existingRecord[digestField] === replacementRecord[digestField]) return {action: \"KEEP_EXISTING\", record_name: recordName, digest_field: digestField, original_digest: existingRecord[digestField], replacement_digest: replacementRecord[digestField]};",
    "  return {",
    "    action: \"PRESERVE_AND_REPLACE\",",
    "    record_name: recordName,",
    "    digest_field: digestField,",
    "    original_digest: existingRecord[digestField],",
    "    replacement_digest: replacementRecord[digestField],",
    "    reason: \"existing completion record is bound to a stale parent; preserve it before writing the current parent-bound record\",",
    "  };",
    "}",
    "",
    "function writeAddressed(root, name, value, field = \"record_sha256\") {",
    "  const target = path.join(root, name);",
    "  const record = structuredClone(value);",
    "  record[field] = null;",
    "  record[field] = digestWithout(record, field);",
    "  if (fs.existsSync(target)) {",
    "    const existing = readJson(target);",
    "    const conflict = resolveAddressedRecordConflict({recordName: name, digestField: field, existingRecord: existing, replacementRecord: record});",
    "    if (conflict.action === \"KEEP_EXISTING\") return existing;",
    "    const safeName = name.replaceAll(\"/\", \"__\").replace(/[^A-Za-z0-9._-]/gu, \"_\");",
    "    const archiveDirectory = path.join(root, \"autonomous-supervisor-stale-records\");",
    "    const archivePath = path.join(archiveDirectory, `${safeName}-${conflict.original_digest}.json`);",
    "    const originalBytes = fs.readFileSync(target);",
    "    fs.mkdirSync(archiveDirectory, {recursive: true});",
    "    if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, originalBytes, {flag: \"wx\", mode: 0o600});",
    "    else { assert(!fs.lstatSync(archivePath).isSymbolicLink(), \"stale addressed record archive may not be a symlink\"); assert(fs.readFileSync(archivePath).equals(originalBytes), \"stale addressed record archive changed\"); }",
    "    const mismatch = {...conflict, schema: \"agentos.controller_stale_completion_record_mismatch.v1\", version: 1, original_evidence_path: path.relative(root, archivePath), observed_at_utc: new Date().toISOString(), mismatch_sha256: null};",
    "    mismatch.mismatch_sha256 = digestWithout(mismatch, \"mismatch_sha256\");",
    "    const mismatchPath = `${archivePath}.mismatch.json`;",
    "    if (!fs.existsSync(mismatchPath)) fs.writeFileSync(mismatchPath, `${JSON.stringify(mismatch)}\\n`, {flag: \"wx\", mode: 0o600});",
    "  }",
    "  fs.mkdirSync(path.dirname(target), {recursive: true});",
    "  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;",
    "  try {",
    "    fs.writeFileSync(temporary, `${JSON.stringify(record)}\\n`, {flag: \"wx\", mode: 0o600});",
    "    fs.renameSync(temporary, target);",
    "  } finally {",
    "    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);",
    "  }",
    "  return readJson(target);",
    "}",
    "",
  ].join("\n");
  adapterSource = adapterSource.slice(0, writerStart) + replacementWriter + adapterSource.slice(writerEnd);
  const lifecycleParentMarker = "    source_finding_sha256: finding.source_sha256,\n";
  assert(adapterSource.includes(lifecycleParentMarker), "lifecycle completion parent field is unavailable");
  adapterSource = adapterSource.replace(lifecycleParentMarker, `${lifecycleParentMarker}    parent_handoff_sha256: goal.parent_handoff_sha256,\n`);
  const finalizerParentMarker = "      task_id: taskId,\n      source_commit: sourceCommit,\n";
  assert(adapterSource.includes(finalizerParentMarker), "finalizer completion parent field is unavailable");
  adapterSource = adapterSource.replace(finalizerParentMarker, `      task_id: taskId,\n      parent_handoff_sha256: goal.parent_handoff_sha256,\n      source_commit: sourceCommit,\n`);
  const progressParentMarker = "        task_id: autonomousTask.task_id,\n        source_commit: finalizerResult.adopted_commit,\n";
  assert(adapterSource.includes(progressParentMarker), "campaign progress completion parent field is unavailable");
  adapterSource = adapterSource.replace(progressParentMarker, `        task_id: autonomousTask.task_id,\n        parent_handoff_sha256: goal.parent_handoff_sha256,\n        source_commit: finalizerResult.adopted_commit,\n`);
  writeFileAtomic(adapterPath, adapterSource);

  const verifierSource = [
    "#!/usr/bin/env node",
    "",
    "import assert from \"node:assert/strict\";",
    "import {execFileSync} from \"node:child_process\";",
    "import {resolveAddressedRecordConflict} from \"../control/local-self-development-supervisor-adapter.mjs\";",
    "",
    "const existing = {schema: \"agentos.controller_completion_record.v1\", record_sha256: \"a\".repeat(64), parent_handoff_sha256: \"1\".repeat(64), source_commit: \"2\".repeat(40), source_tree: \"3\".repeat(40)};",
    "const replacement = {...existing, record_sha256: \"b\".repeat(64), parent_handoff_sha256: \"4\".repeat(64), source_commit: \"5\".repeat(40), source_tree: \"6\".repeat(40)};",
    "const conflict = resolveAddressedRecordConflict({recordName: \"autonomous-supervisor-lifecycle-resolutions/FINDING.json\", digestField: \"record_sha256\", existingRecord: existing, replacementRecord: replacement});",
    "assert.equal(conflict.action, \"PRESERVE_AND_REPLACE\");",
    "assert.equal(conflict.original_digest, existing.record_sha256);",
    "assert.equal(conflict.replacement_digest, replacement.record_sha256);",
    "assert.match(conflict.reason, /stale parent/u);",
    "assert.equal(resolveAddressedRecordConflict({recordName: \"same.json\", digestField: \"record_sha256\", existingRecord: existing, replacementRecord: existing}).action, \"KEEP_EXISTING\");",
    "assert.throws(() => resolveAddressedRecordConflict({recordName: \"bad.json\", digestField: \"record_sha256\", existingRecord: {...existing, record_sha256: \"bad\"}, replacementRecord: replacement}), /SHA-256/u);",
    "console.log(\"PASS owner feedback completion records preserve stale evidence and classify current-parent replacement\");",
  ].join("\n") + "\n";
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith("| `" + feedbackId + "` |") && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));
  return {
    changedByRepair: ["control/local-self-development-supervisor-adapter.mjs", "docs/owner-feedback-backlog.md", "tests/verify-owner-feedback-digest.mjs"],
    artifactName: "control/owner-feedback-digest-repair-receipt.mjs",
  };
}

function applyOwnerFeedbackProgressRepair(worktreePath, feedbackId) {
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-owner-feedback-progress.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  assert(fs.existsSync(adapterPath) && fs.existsSync(backlogPath), "owner feedback progress repair inputs are unavailable");

  let adapterSource = fs.readFileSync(adapterPath, "utf8");
  const progressConstant = 'const CONTROLLER_PLANNING_PROGRESS_FILE = "autonomous-supervisor-planning-progress.json";';
  assert(!adapterSource.includes(progressConstant), "owner feedback progress repair was already applied");
  const progressConstantMarker = 'const CAMPAIGN_PROGRESS_FILE = "autonomous-supervisor-campaign-progress.json";';
  assert(adapterSource.includes(progressConstantMarker), "campaign progress constant is unavailable");
  adapterSource = adapterSource.replace(progressConstantMarker, `${progressConstantMarker}\n${progressConstant}`);

  const progressHelperMarker = "function readCampaignProgress(campaignRoot, campaignId, campaignVersion) {";
  assert(adapterSource.includes(progressHelperMarker), "campaign progress reader is unavailable");
  const progressHelper = [
    "const CONTROLLER_PLANNING_PHASES = Object.freeze([\"ORCHESTRATOR_REVIEW\", \"FEATURE_BUILD\", \"INDEPENDENT_AUDIT\", \"FINALIZER_REVIEW\", \"COMPLETED\", \"FAILED\"]);",
    "",
    "export function compileControllerPlanningProgress({goal, taskId, sourceCommit, sourceTree, status = \"IN_PROGRESS\", phase, message, nextAction, updatedAtUtc = new Date().toISOString()}) {",
    "  assert(goal && typeof goal === \"object\" && !Array.isArray(goal), \"planning progress goal is required\");",
    "  requireString(taskId, \"planning progress task ID\");",
    "  requireGitObject(sourceCommit, \"planning progress source commit\");",
    "  requireGitObject(sourceTree, \"planning progress source tree\");",
    "  assert([\"IN_PROGRESS\", \"COMPLETED\", \"FAILED\"].includes(status), \"planning progress status is invalid\");",
    "  assert(CONTROLLER_PLANNING_PHASES.includes(phase), \"planning progress phase is invalid\");",
    "  requireString(message, \"planning progress message\");",
    "  requireString(nextAction, \"planning progress next action\");",
    "  requireString(updatedAtUtc, \"planning progress time\");",
    "  assert(updatedAtUtc.endsWith(\"Z\") && Number.isFinite(Date.parse(updatedAtUtc)), \"planning progress time must be UTC\");",
    "  const progress = {",
    "    schema: \"agentos.controller_planning_progress.v1\",",
    "    version: 1,",
    "    status,",
    "    controller_role: \"AGENTOS_CONTROLLER\",",
    "    controller_display_name: \"AgentOS Controller\",",
    "    project_id: goal.project_id,",
    "    campaign_id: goal.campaign_id,",
    "    campaign_version: goal.campaign_version,",
    "    goal_id: goal.goal_id,",
    "    goal_sha256: goal.goal_sha256,",
    "    task_id: taskId,",
    "    source_commit: sourceCommit,",
    "    source_tree: sourceTree,",
    "    phase,",
    "    message,",
    "    next_action: nextAction,",
    "    updated_at_utc: updatedAtUtc,",
    "    progress_sha256: null,",
    "  };",
    "  requireString(progress.project_id, \"planning progress project ID\");",
    "  requireString(progress.campaign_id, \"planning progress campaign ID\");",
    "  requireString(progress.campaign_version, \"planning progress campaign version\");",
    "  requireString(progress.goal_id, \"planning progress goal ID\");",
    "  requireSha(progress.goal_sha256, \"planning progress goal digest\");",
    "  progress.progress_sha256 = digestWithout(progress, \"progress_sha256\");",
    "  return progress;",
    "}",
    "",
    "function readControllerPlanningProgress(campaignRoot, campaignId, campaignVersion) {",
    "  const progress = readAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, \"progress_sha256\");",
    "  if (progress === null) return null;",
    "  assert(progress.schema === \"agentos.controller_planning_progress.v1\" && progress.version === 1, \"Controller planning progress identity is invalid\");",
    "  assert(progress.campaign_id === campaignId && progress.campaign_version === campaignVersion, \"Controller planning progress campaign differs\");",
    "  assert([\"IN_PROGRESS\", \"COMPLETED\", \"FAILED\"].includes(progress.status), \"Controller planning progress status is invalid\");",
    "  assert(CONTROLLER_PLANNING_PHASES.includes(progress.phase), \"Controller planning progress phase is invalid\");",
    "  requireGitObject(progress.source_commit, \"Controller planning progress source commit\");",
    "  requireGitObject(progress.source_tree, \"Controller planning progress source tree\");",
    "  requireSha(progress.goal_sha256, \"Controller planning progress goal digest\");",
    "  requireString(progress.message, \"Controller planning progress message\");",
    "  requireString(progress.next_action, \"Controller planning progress next action\");",
    "  return progress;",
    "}",
    "",
    "function writeControllerPlanningProgress({campaignRoot, goal, taskId, sourceCommit, sourceTree, status = \"IN_PROGRESS\", phase, message, nextAction}) {",
    "  const existing = readAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, \"progress_sha256\");",
    "  const progress = compileControllerPlanningProgress({goal, taskId, sourceCommit, sourceTree, status, phase, message, nextAction});",
    "  return writeMutableAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, progress, \"progress_sha256\", existing?.progress_sha256 ?? null);",
    "}",
    "",
  ].join("\n");
  adapterSource = adapterSource.replace(progressHelperMarker, `${progressHelper}${progressHelperMarker}`);

  const observeProgressMarker = "    const campaignProgress = handoff.campaign_active\n      ? readCampaignProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version)\n      : null;";
  assert(adapterSource.includes(observeProgressMarker), "campaign progress observation checkpoint is unavailable");
  const observeProgressReplacement = `${observeProgressMarker}\n    const planningProgress = handoff.campaign_active\n      ? readControllerPlanningProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version)\n      : null;`;
  adapterSource = adapterSource.replace(observeProgressMarker, observeProgressReplacement);

  const nextActionMarker = "      nextAction: handoff.next_action,";
  assert(adapterSource.includes(nextActionMarker), "Controller observation next action is unavailable");
  adapterSource = adapterSource.replace(nextActionMarker, "      nextAction: planningProgress?.status === \"IN_PROGRESS\" ? planningProgress.next_action : handoff.next_action,");

  const taskIdMarker = "    const taskRecordPath = `autonomous-supervisor-tasks/${taskId}.json`;";
  assert(adapterSource.includes(taskIdMarker), "Controller route task identity checkpoint is unavailable");
  const initialProgress = [
    "    writeControllerPlanningProgress({",
    "      campaignRoot,",
    "      goal,",
    "      taskId,",
    "      sourceCommit,",
    "      sourceTree,",
    "      phase: \"ORCHESTRATOR_REVIEW\",",
    "      message: \"The Controller has selected a bounded repair and started the campaign handoff.\",",
    "      nextAction: \"The Campaign Orchestrator is selecting the exact repair; no Product or external work is allowed.\",",
    "    });",
  ].join("\n");
  adapterSource = adapterSource.replace(taskIdMarker, `${initialProgress}\n${taskIdMarker}`);

  const featureReadbackMarker = "    const featureReadback = feature.readback;";
  assert(adapterSource.includes(featureReadbackMarker), "Feature-Agent readback checkpoint is unavailable");
  const featureProgress = [
    "    writeControllerPlanningProgress({",
    "      campaignRoot,",
    "      goal,",
    "      taskId,",
    "      sourceCommit,",
    "      sourceTree,",
    "      phase: \"INDEPENDENT_AUDIT\",",
    "      message: \"The bounded build is complete and the independent audit is running against the same source.\",",
    "      nextAction: \"The Independent Auditor is checking the exact files, checks, source identity, and boundaries.\",",
    "    });",
  ].join("\n");
  adapterSource = adapterSource.replace(featureReadbackMarker, `${featureProgress}\n${featureReadbackMarker}`);

  const controllerChecksMarkers = [
    "    const controllerChecks = campaignProgressTask\n      ? runCampaignProgressChecks(feature.session_record.worktree_path)\n      : runControllerChecks(feature.session_record.worktree_path, repairKind);",
    "    const controllerChecks = campaignProgressTask\n      ? runCampaignProgressChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: feature.session_record.worktree_path})\n      : runControllerChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: feature.session_record.worktree_path, taskKind: repairKind});",
  ];
  const controllerChecksMarker = controllerChecksMarkers.find((marker) => adapterSource.includes(marker));
  assert(controllerChecksMarker !== undefined, "Controller recheck checkpoint is unavailable");
  const finalizerProgress = [
    "    writeControllerPlanningProgress({",
    "      campaignRoot,",
    "      goal,",
    "      taskId,",
    "      sourceCommit,",
    "      sourceTree,",
    "      phase: \"FINALIZER_REVIEW\",",
    "      message: \"The audit readback is complete and the Controller is checking the local checkpoint before adoption.\",",
    "      nextAction: \"The Controller Finalizer is checking the audited checkpoint; external actions remain closed.\",",
    "    });",
  ].join("\n");
  adapterSource = adapterSource.replace(controllerChecksMarker, `${finalizerProgress}\n${controllerChecksMarker}`);

  const priorPointerMarker = "    const priorPointer = readAddressed(campaignRoot, \"autonomous-supervisor-current-handoff.json\", \"pointer_sha256\");";
  assert(adapterSource.includes(priorPointerMarker), "Controller handoff transition checkpoint is unavailable");
  const completedProgress = [
    "    writeControllerPlanningProgress({",
    "      campaignRoot,",
    "      goal,",
    "      taskId,",
    "      sourceCommit: finalizerResult.adopted_commit,",
    "      sourceTree: finalizerResult.adopted_tree,",
    "      status: \"COMPLETED\",",
    "      phase: \"COMPLETED\",",
    "      message: \"The Controller finished the bounded campaign and retained the audited local checkpoint.\",",
    "      nextAction: \"The Controller will inspect the next bounded item automatically; no outside prompt is needed.\",",
    "    });",
  ].join("\n");
  adapterSource = adapterSource.replace(priorPointerMarker, `${completedProgress}\n${priorPointerMarker}`);
  writeFileAtomic(adapterPath, adapterSource);

  const verifierSource = [
    "#!/usr/bin/env node",
    "",
    "import assert from \"node:assert/strict\";",
    "import {compileControllerPlanningProgress} from \"../control/local-self-development-supervisor-adapter.mjs\";",
    "import {supervisorDigest} from \"../control/controller-supervisor.mjs\";",
    "",
    "const goal = {project_id: \"PROJECT\", campaign_id: \"CAMPAIGN-1\", campaign_version: \"v1\", goal_id: \"CONTROLLER-GOAL-1\", goal_sha256: \"a\".repeat(64)};",
    "const progress = compileControllerPlanningProgress({goal, taskId: \"TASK-1\", sourceCommit: \"b\".repeat(40), sourceTree: \"c\".repeat(40), phase: \"ORCHESTRATOR_REVIEW\", message: \"The Controller selected one bounded repair.\", nextAction: \"The Campaign Orchestrator is selecting the exact repair.\", updatedAtUtc: \"2026-01-01T00:00:00.000Z\"});",
    "assert.equal(progress.schema, \"agentos.controller_planning_progress.v1\");",
    "assert.equal(progress.status, \"IN_PROGRESS\");",
    "assert.equal(progress.phase, \"ORCHESTRATOR_REVIEW\");",
    "assert.equal(progress.next_action, \"The Campaign Orchestrator is selecting the exact repair.\");",
    "assert.equal(progress.progress_sha256, supervisorDigest({...progress, progress_sha256: null}));",
    "assert.throws(() => compileControllerPlanningProgress({goal, taskId: \"TASK-1\", sourceCommit: \"b\".repeat(40), sourceTree: \"c\".repeat(40), phase: \"UNKNOWN\", message: \"The Controller selected one bounded repair.\", nextAction: \"The Campaign Orchestrator is selecting the exact repair.\"}), /phase is invalid/u);",
    "console.log(\"PASS Controller exposes concise source-bound planning progress and next action\");",
  ].join("\n") + "\n";
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith("| `" + feedbackId + "` |") && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));
  return {
    changedByRepair: ["control/local-self-development-supervisor-adapter.mjs", "docs/owner-feedback-backlog.md", "tests/verify-owner-feedback-progress.mjs"],
    artifactName: "control/owner-feedback-progress-repair-receipt.mjs",
  };
}

function applyOwnerFeedbackContinuationRepair(worktreePath, feedbackId) {
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-owner-feedback-continuation.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  assert(fs.existsSync(adapterPath) && fs.existsSync(backlogPath), "owner feedback continuation repair inputs are unavailable");

  let adapterSource = fs.readFileSync(adapterPath, "utf8");
  const helperMarker = "export function selectValidatedAutonomousTask";
  assert(!adapterSource.includes(helperMarker), "owner feedback continuation repair was already applied");
  const findingMarker = "function autonomousTaskFinding({campaignRoot, handoff, activation, findings, activeCampaign}) {";
  assert(adapterSource.includes(findingMarker), "autonomous task finding function is unavailable");
  const helper = [
    "export function selectValidatedAutonomousTask({tasks, boundary, findings = [], activeCampaign}) {",
    "  const selection = selectAutonomousNextTask({tasks, boundary, findings, activeCampaign});",
    "  if (selection.action === \"ROUTE_REPAIRABLE_PUZZLE\" && selection.task_id !== null) {",
    "    const selectedTask = tasks.find((task) => task.task_id === selection.task_id);",
    "    assert(selectedTask !== undefined && selectedTask.status === \"OPEN\", \"Controller selected task is not an open queued task\");",
    "    assert(selectedTask.owner_decision_required === false, \"Controller selected task requires an owner decision\");",
    "  }",
    "  return selection;",
    "}",
    "",
  ].join("\n");
  adapterSource = adapterSource.replace(findingMarker, `${helper}${findingMarker}`);
  const selectionMarker = "  const selection = selectAutonomousNextTask({tasks: queue.tasks, boundary, findings, activeCampaign});";
  assert(adapterSource.includes(selectionMarker), "autonomous task selection call is unavailable");
  adapterSource = adapterSource.replace(selectionMarker, "  const selection = selectValidatedAutonomousTask({tasks: queue.tasks, boundary, findings, activeCampaign});");
  writeFileAtomic(adapterPath, adapterSource);

  const verifierSource = [
    "#!/usr/bin/env node",
    "",
    "import assert from \"node:assert/strict\";",
    "import {selectValidatedAutonomousTask} from \"../control/local-self-development-supervisor-adapter.mjs\";",
    "",
    "const boundary = {hard_stop: false, soft_review: false, owner_decision_required: false, scope_changed: false, local_development_writes_allowed: true, local_worker_agent_spawns_allowed: true, product_writes_allowed: false, product_agent_spawns_allowed: false, external_deployment_allowed: false, external_release_allowed: false, external_publication_allowed: false, external_push_allowed: false, external_merge_allowed: false, secrets_allowed: false, destructive_work_allowed: false};",
    "const tasks = [{task_id: \"CONTROLLER-TASK-FIRST\", status: \"OPEN\", priority: 0, summary: \"First bounded task.\", scope: [\"CONTROL_PLANE\"], owner_decision_required: false}, {task_id: \"CONTROLLER-TASK-LATER\", status: \"OPEN\", priority: 1, summary: \"Later bounded task.\", scope: [\"CONTROL_PLANE\"], owner_decision_required: false}];",
    "const selection = selectValidatedAutonomousTask({tasks, boundary, findings: [], activeCampaign: true});",
    "assert.equal(selection.action, \"ROUTE_REPAIRABLE_PUZZLE\");",
    "assert.equal(selection.task_id, \"CONTROLLER-TASK-FIRST\");",
    "const ownerDecisionTask = [{...tasks[0], owner_decision_required: true}];",
    "assert.equal(selectValidatedAutonomousTask({tasks: ownerDecisionTask, boundary, findings: [], activeCampaign: true}).action, \"STOP_HARD_BOUNDARY\");",
    "const higherPriorityPuzzle = [{finding_id: \"F-REPAIR\", classification: \"REPAIRABLE_ENGINEERING_PUZZLE\", status: \"OPEN_REPAIR_REQUIRED\", summary: \"Repair first.\", source_sha256: \"a\".repeat(64)}];",
    "assert.equal(selectValidatedAutonomousTask({tasks, boundary, findings: higherPriorityPuzzle, activeCampaign: true}).task_id, null);",
    "console.log(\"PASS Controller selects one validated queued task without a manual task declaration\");",
  ].join("\n") + "\n";
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith("| `" + feedbackId + "` |") && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));
  return {
    changedByRepair: ["control/local-self-development-supervisor-adapter.mjs", "docs/owner-feedback-backlog.md", "tests/verify-owner-feedback-continuation.mjs"],
    artifactName: "control/owner-feedback-continuation-repair-receipt.mjs",
  };
}

function applyOwnerFeedbackExecutionBoundaryRepair(worktreePath, feedbackId) {
  const admissionPath = path.join(worktreePath, "control/local-campaign-admission.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-owner-feedback-execution-boundary.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  assert(fs.existsSync(admissionPath) && fs.existsSync(backlogPath), "owner feedback execution-boundary repair inputs are unavailable");

  let admissionSource = fs.readFileSync(admissionPath, "utf8");
  const boundaryMarker = "export function compileLocalCampaignExecutionBoundary";
  assert(!admissionSource.includes(boundaryMarker), "owner feedback execution-boundary repair was already applied");
  const transitionMarker = "export function validateLocalStartTransition({authorization, admission}) {";
  assert(admissionSource.includes(transitionMarker), "local start transition function is unavailable");
  const boundaryHelper = [
    "export function validateLocalCampaignExecutionBoundary(boundary) {",
    "  exactKeys(boundary, [",
    "    \"schema\", \"version\", \"status\", \"controller_role\", \"campaign_id\", \"campaign_version\", \"source_commit\", \"source_tree\",",
    "    \"candidate_sha256\", \"authorization_sha256\", \"admission_sha256\", \"owner_authorized\", \"active_campaign\", \"campaign_start_allowed\",",
    "    \"required_worker_roles\", \"local_development_writes_allowed\", \"local_worker_agent_spawns_allowed\", \"product_writes_allowed\", \"product_agent_spawns_allowed\",",
    "    \"external_deployment_allowed\", \"external_release_allowed\", \"external_publication_allowed\", \"external_push_allowed\", \"external_merge_allowed\", \"secrets_allowed\", \"destructive_work_allowed\", \"next_event\", \"boundary_sha256\",",
    "  ], \"local campaign execution boundary\");",
    "  assert(boundary.schema === \"agentos.local_campaign_execution_boundary.v1\" && boundary.version === 1, \"local campaign execution boundary schema mismatch\");",
    "  assert(boundary.status === \"PREPARED_OWNER_AUTHORIZED\", \"local campaign execution boundary status is invalid\");",
    "  assert(boundary.controller_role === \"AGENTOS_CONTROLLER\", \"local campaign execution boundary role is invalid\");",
    "  requireIdentifier(boundary.campaign_id, \"local execution boundary campaign ID\");",
    "  requireString(boundary.campaign_version, \"local execution boundary campaign version\");",
    "  requireGitObject(boundary.source_commit, \"local execution boundary source commit\");",
    "  requireGitObject(boundary.source_tree, \"local execution boundary source tree\");",
    "  for (const field of [\"candidate_sha256\", \"authorization_sha256\", \"admission_sha256\", \"boundary_sha256\"]) requireSha(boundary[field], `local execution boundary ${field}`);",
    "  assert(boundary.owner_authorized === true && boundary.active_campaign === false && boundary.campaign_start_allowed === true, \"local execution boundary is not an owner-authorized inactive start\");",
    "  validateWorkerRoles(boundary.required_worker_roles);",
    "  assert(boundary.local_development_writes_allowed === true && boundary.local_worker_agent_spawns_allowed === true, \"local execution boundary lacks local worker permissions\");",
    "  for (const key of [\"product_writes_allowed\", \"product_agent_spawns_allowed\", \"external_deployment_allowed\", \"external_release_allowed\", \"external_publication_allowed\", \"external_push_allowed\", \"external_merge_allowed\", \"secrets_allowed\", \"destructive_work_allowed\"]) assert(boundary[key] === false, `local execution boundary ${key} must remain closed`);",
    "  assert(boundary.next_event === \"LOCAL_SELF_DEVELOPMENT_AUTHORIZED\", \"local execution boundary next event is invalid\");",
    "  assert(boundary.boundary_sha256 === digestWithout(boundary, \"boundary_sha256\"), \"local execution boundary digest mismatch\");",
    "  return boundary;",
    "}",
    "",
    "export function compileLocalCampaignExecutionBoundary({authorization, admission}) {",
    "  validateLocalDevelopmentAuthorization(authorization);",
    "  validateLocalCampaignAdmission(admission);",
    "  assert(authorization.campaign_id === admission.campaign_id && authorization.campaign_version === admission.campaign_version, \"local execution boundary campaign differs\");",
    "  assert(authorization.source_commit === admission.source_commit && authorization.source_tree === admission.source_tree, \"local execution boundary source differs\");",
    "  assert(authorization.authorization_sha256 && admission.admission_sha256, \"local execution boundary authority digests are missing\");",
    "  const boundary = {",
    "    schema: \"agentos.local_campaign_execution_boundary.v1\",",
    "    version: 1,",
    "    status: \"PREPARED_OWNER_AUTHORIZED\",",
    "    controller_role: \"AGENTOS_CONTROLLER\",",
    "    campaign_id: admission.campaign_id,",
    "    campaign_version: admission.campaign_version,",
    "    source_commit: admission.source_commit,",
    "    source_tree: admission.source_tree,",
    "    candidate_sha256: admission.controller_candidate_sha256,",
    "    authorization_sha256: authorization.authorization_sha256,",
    "    admission_sha256: admission.admission_sha256,",
    "    owner_authorized: authorization.status === \"AUTHORIZED\" && authorization.owner_decision.decision === \"START_LOCAL_AGENTOS_SELF_DEVELOPMENT\",",
    "    active_campaign: admission.active_campaign,",
    "    campaign_start_allowed: authorization.status === \"AUTHORIZED\" && admission.active_campaign === false,",
    "    required_worker_roles: [...authorization.worker_roles].sort(),",
    "    local_development_writes_allowed: authorization.permissions.local_development_writes_allowed,",
    "    local_worker_agent_spawns_allowed: authorization.permissions.local_worker_agent_spawns_allowed,",
    "    product_writes_allowed: authorization.permissions.product_writes_allowed,",
    "    product_agent_spawns_allowed: authorization.permissions.product_agent_spawns_allowed,",
    "    external_deployment_allowed: authorization.permissions.external_deployment_allowed,",
    "    external_release_allowed: authorization.permissions.external_release_allowed,",
    "    external_publication_allowed: authorization.permissions.external_publication_allowed,",
    "    external_push_allowed: authorization.permissions.external_push_allowed,",
    "    external_merge_allowed: authorization.permissions.external_merge_allowed,",
    "    secrets_allowed: authorization.permissions.secrets_allowed,",
    "    destructive_work_allowed: authorization.permissions.destructive_work_allowed,",
    "    next_event: admission.next_event,",
    "    boundary_sha256: null,",
    "  };",
    "  boundary.boundary_sha256 = digestWithout(boundary, \"boundary_sha256\");",
    "  return validateLocalCampaignExecutionBoundary(boundary);",
    "}",
    "",
  ].join("\n");
  admissionSource = admissionSource.replace(transitionMarker, `${boundaryHelper}${transitionMarker}`);
  const transitionEventMarker = '  assert(admission.next_event === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "valid local authorization cannot remain on a queued-only path");';
  assert(admissionSource.includes(transitionEventMarker), "local start transition event checkpoint is unavailable");
  admissionSource = admissionSource.replace(transitionEventMarker, `${transitionEventMarker}\n  const executionBoundary = compileLocalCampaignExecutionBoundary({authorization, admission});\n  assert(executionBoundary.campaign_start_allowed === true && executionBoundary.active_campaign === false, "local start transition crossed its execution boundary");`);
  writeFileAtomic(admissionPath, admissionSource);

  const verifierSource = [
    "#!/usr/bin/env node",
    "",
    "import assert from \"node:assert/strict\";",
    "import {compileControllerCampaignCandidate} from \"../control/agentos-controller.mjs\";",
    "import {",
    "  compileLocalCampaignAdmission,",
    "  compileLocalCampaignExecutionBoundary,",
    "  compileLocalCampaignIdentityBinding,",
    "  compileLocalDevelopmentAuthorization,",
    "  validateLocalCampaignExecutionBoundary,",
    "} from \"../control/local-campaign-admission.mjs\";",
    "",
    "const SHA = \"a\".repeat(64);",
    "const COMMIT = \"1\".repeat(40);",
    "const TREE = \"2\".repeat(40);",
    "const authorization = compileLocalDevelopmentAuthorization({campaignId: \"CAMPAIGN-BOUNDARY-1\", campaignVersion: \"v1\", sourceCommit: COMMIT, sourceTree: TREE, parentAuditPacketSha256: SHA, parentAuditAddendumSha256: SHA, ownerIntentSha256: SHA, decisionTreeRequirementSha256: SHA, policyEpoch: 1, policyStateSha256: SHA, acceptanceContractSha256: SHA, modelPlanSha256: SHA, scopeSha256: SHA});",
    "const candidate = compileControllerCampaignCandidate({projectId: \"PROJECT-BOUNDARY\", campaignId: authorization.campaign_id, campaignVersion: authorization.campaign_version, policyEpoch: 1, policyStateSha256: SHA, ownerIntentSha256: SHA, acceptanceContractSha256: SHA, modelPlanSha256: SHA, scopeSha256: SHA, sourceCommit: COMMIT, sourceTree: TREE});",
    "const binding = compileLocalCampaignIdentityBinding({authorization, candidate, auditCandidate: {candidate_id: \"CANDIDATE-BOUNDARY\", candidate_sha256: SHA, commit: COMMIT, tree: TREE}, auditPlanSha256: SHA, auditReconciliationSha256: SHA, parentAuditPacketSha256: SHA, parentAuditAddendumSha256: SHA});",
    "const admission = compileLocalCampaignAdmission({authorization, candidate, identityBinding: binding, nowUtc: \"2026-08-04T12:00:00.000Z\"});",
    "const boundary = compileLocalCampaignExecutionBoundary({authorization, admission});",
    "assert.equal(boundary.status, \"PREPARED_OWNER_AUTHORIZED\");",
    "assert.equal(boundary.campaign_start_allowed, true);",
    "assert.equal(boundary.active_campaign, false);",
    "assert.deepEqual(boundary.required_worker_roles, [\"CAMPAIGN_ORCHESTRATOR\", \"FEATURE_AGENT\", \"INDEPENDENT_AUDITOR\"]);",
    "assert.equal(boundary.product_writes_allowed, false);",
    "assert.equal(boundary.product_agent_spawns_allowed, false);",
    "assert.equal(boundary.external_push_allowed, false);",
    "assert.doesNotThrow(() => validateLocalCampaignExecutionBoundary(boundary));",
    "assert.throws(() => validateLocalCampaignExecutionBoundary({...boundary, product_writes_allowed: true}), /product_writes_allowed must remain closed|digest mismatch/u);",
    "console.log(\"PASS local campaign execution has a separate owner-authorized inactive boundary with closed Product and external permissions\");",
  ].join("\n") + "\n";
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith("| `" + feedbackId + "` |") && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));
  return {
    changedByRepair: ["control/local-campaign-admission.mjs", "docs/owner-feedback-backlog.md", "tests/verify-owner-feedback-execution-boundary.mjs"],
    artifactName: "control/owner-feedback-execution-boundary-repair-receipt.mjs",
  };
}

function applyOwnerFeedbackCheckRepair(worktreePath, feedbackId) {
  const runnerPath = path.join(worktreePath, "control/check-runner.mjs");
  const workerPath = path.join(worktreePath, "control/local-agent-worker.mjs");
  const adapterPath = path.join(worktreePath, "control/local-self-development-supervisor-adapter.mjs");
  const verifierPath = path.join(worktreePath, "tests/verify-owner-feedback-check-repair.mjs");
  const backlogPath = path.join(worktreePath, "docs/owner-feedback-backlog.md");
  assert(fs.existsSync(workerPath) && fs.existsSync(adapterPath) && fs.existsSync(backlogPath), "owner feedback check-repair inputs are unavailable");
  assert(!fs.existsSync(runnerPath), "owner feedback check-repair runner was already applied");

  const runnerSource = [
    "#!/usr/bin/env node",
    "",
    "import crypto from \"node:crypto\";",
    "import fs from \"node:fs\";",
    "import path from \"node:path\";",
    "import {execFileSync} from \"node:child_process\";",
    "import {compileHybridSchedulerRequest, createHybridScheduler, opaqueSchedulerWorktreeRef} from \"./hybrid-scheduler.mjs\";",
    "",
    "const SHA256 = /^[0-9a-f]{64}$/u;",
    "const GIT_OBJECT = /^[0-9a-f]{40}$/u;",
    "const ISO_UTC = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/u;",
    "const MAX_OUTPUT_BYTES = 64 * 1024;",
    "",
    "function assert(condition, message) { if (!condition) throw new Error(message); }",
    "function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (value && typeof value === \"object\") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])); return value; }",
    "function digestWithout(value, field) { const body = structuredClone(value); body[field] = null; return crypto.createHash(\"sha256\").update(JSON.stringify(canonicalize(body)), \"utf8\").digest(\"hex\"); }",
    "function requireString(value, label) { assert(typeof value === \"string\" && value.length > 0, `${label} is required`); }",
    "function requireSha(value, label) { assert(typeof value === \"string\" && SHA256.test(value), `${label} must be a SHA-256`); }",
    "function requireGitObject(value, label) { assert(typeof value === \"string\" && GIT_OBJECT.test(value), `${label} must be a Git object`); }",
    "function requireUtc(value, label) { assert(typeof value === \"string\" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }",
    "function parseCheckCommand(command) {",
    "  assert(typeof command === \"string\" && command.length > 0 && command.length <= 240 && !(/[\\r\\n\\0]/u.test(command)), \"check command is invalid\");",
    "  const parts = command.trim().split(/\\s+/u);",
    "  assert(parts[0] === \"node\" && (parts.length === 2 || (parts.length === 3 && parts[1] === \"--check\")), \"check executable or arguments are not authorized\");",
    "  const script = parts.at(-1);",
    "  assert(/^(?:control|tests)\\/[A-Za-z0-9._/-]+\\.mjs$/u.test(script) && !script.includes(\"..\"), \"check script is outside the authorized source areas\");",
    "  return {program: process.execPath, args: parts.slice(1)};",
    "}",
    "function sourceIdentity(worktreePath) { const absolute = path.resolve(worktreePath); assert(!fs.lstatSync(absolute).isSymbolicLink(), \"check worktree may not be a symlink\"); const root = fs.realpathSync.native(absolute); const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink(), \"check worktree must be a real directory\"); const commit = gitValue(root, [\"rev-parse\", \"HEAD\"]); const tree = gitValue(root, [\"rev-parse\", \"HEAD^{tree}\"]); requireGitObject(commit, \"observed source commit\"); requireGitObject(tree, \"observed source tree\"); return {root, commit, tree}; }",
    "function schedulerId(prefix, value) { return prefix + \"-\" + crypto.createHash(\"sha256\").update(String(value), \"utf8\").digest(\"hex\").slice(0, 24).toUpperCase(); }",
    "function gitValue(worktreePath, args, encoding = \"utf8\") { return execFileSync(\"git\", [\"-C\", worktreePath, ...args], {encoding}).toString().trim(); }",
    "function candidateIdentity(worktreePath, sourceCommit, sourceTree) { try { const commit = gitValue(worktreePath, [\"rev-parse\", \"HEAD\"]); const tree = gitValue(worktreePath, [\"rev-parse\", \"HEAD^{tree}\"]); const status = gitValue(worktreePath, [\"status\", \"--porcelain\", \"--untracked-files=all\"]); if (status.length === 0) return {commit, tree, clean: true}; const diff = execFileSync(\"git\", [\"-C\", worktreePath, \"diff\", \"--binary\"], {encoding: \"buffer\"}); const untracked = gitValue(worktreePath, [\"ls-files\", \"--others\", \"--exclude-standard\", \"-z\"]); return {commit: \"PRELIMINARY_DIAGNOSTIC\", tree: crypto.createHash(\"sha256\").update(JSON.stringify({commit, tree, status, diff_sha256: crypto.createHash(\"sha256\").update(diff).digest(\"hex\"), untracked}), \"utf8\").digest(\"hex\"), clean: false}; } catch { return {commit: sourceCommit, tree: sourceTree, clean: false}; } }",
    "",
    "export function validateCheckFailureReceipt(receipt) {",
    "  const keys = [\"schema\", \"version\", \"status\", \"task_id\", \"role\", \"source_commit\", \"source_tree\", \"check_index\", \"command\", \"exit_code\", \"signal\", \"stdout_sha256\", \"stderr_sha256\", \"stdout_bytes\", \"stderr_bytes\", \"diagnostics_redacted\", \"observed_at_utc\", \"failure_sha256\"];",
    "  assert(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify([...keys].sort()), \"check failure receipt fields mismatch\");",
    "  assert(receipt.schema === \"agentos.local_check_failure_receipt.v1\" && receipt.version === 1 && receipt.status === \"FAILED\", \"check failure receipt identity is invalid\");",
    "  requireString(receipt.task_id, \"check failure task ID\");",
    "  requireString(receipt.role, \"check failure role\");",
    "  requireGitObject(receipt.source_commit, \"check failure source commit\");",
    "  requireGitObject(receipt.source_tree, \"check failure source tree\");",
    "  assert(Number.isSafeInteger(receipt.check_index) && receipt.check_index >= 0, \"check failure index is invalid\");",
    "  requireString(receipt.command, \"check failure command\");",
    "  assert(receipt.exit_code === null || (Number.isSafeInteger(receipt.exit_code) && receipt.exit_code !== 0), \"check failure exit code is invalid\");",
    "  assert(receipt.signal === null || typeof receipt.signal === \"string\", \"check failure signal is invalid\");",
    "  requireSha(receipt.stdout_sha256, \"check failure stdout digest\");",
    "  requireSha(receipt.stderr_sha256, \"check failure stderr digest\");",
    "  assert(Number.isSafeInteger(receipt.stdout_bytes) && receipt.stdout_bytes >= 0 && receipt.stdout_bytes <= MAX_OUTPUT_BYTES, \"check failure stdout size is invalid\");",
    "  assert(Number.isSafeInteger(receipt.stderr_bytes) && receipt.stderr_bytes >= 0 && receipt.stderr_bytes <= MAX_OUTPUT_BYTES, \"check failure stderr size is invalid\");",
    "  assert(receipt.diagnostics_redacted === true, \"check failure diagnostics must be redacted\");",
    "  requireUtc(receipt.observed_at_utc, \"check failure time\");",
    "  requireSha(receipt.failure_sha256, \"check failure digest\");",
    "  assert(receipt.failure_sha256 === digestWithout(receipt, \"failure_sha256\"), \"check failure digest mismatch\");",
    "  return receipt;",
    "}",
    "",
    "export function compileCheckFailureReceipt({taskId, role, sourceCommit, sourceTree, checkIndex, command, error, observedAtUtc = new Date().toISOString()}) {",
    "  const stdout = typeof error?.stdout === \"string\" ? error.stdout : String(error?.stdout ?? \"\"); const stderr = typeof error?.stderr === \"string\" ? error.stderr : String(error?.stderr ?? \"\");",
    "  assert(Buffer.byteLength(stdout, \"utf8\") <= MAX_OUTPUT_BYTES && Buffer.byteLength(stderr, \"utf8\") <= MAX_OUTPUT_BYTES, \"check failure output exceeds the bounded evidence limit\");",
    "  const receipt = {schema: \"agentos.local_check_failure_receipt.v1\", version: 1, status: \"FAILED\", task_id: taskId, role, source_commit: sourceCommit, source_tree: sourceTree, check_index: checkIndex, command, exit_code: Number.isSafeInteger(error?.status) ? error.status : null, signal: error?.signal ?? null, stdout_sha256: crypto.createHash(\"sha256\").update(stdout, \"utf8\").digest(\"hex\"), stderr_sha256: crypto.createHash(\"sha256\").update(stderr, \"utf8\").digest(\"hex\"), stdout_bytes: Buffer.byteLength(stdout, \"utf8\"), stderr_bytes: Buffer.byteLength(stderr, \"utf8\"), diagnostics_redacted: true, observed_at_utc: observedAtUtc, failure_sha256: null};",
    "  receipt.failure_sha256 = digestWithout(receipt, \"failure_sha256\");",
    "  return validateCheckFailureReceipt(receipt);",
    "}",
    "",
    "function writeReceipt(root, receipt) {",
    "  const evidenceRoot = path.join(root, \"control\", \"check-failure-receipts\");",
    "  fs.mkdirSync(path.join(root, \"control\"), {recursive: true, mode: 0o700});",
    "  fs.mkdirSync(evidenceRoot, {recursive: true, mode: 0o700});",
    "  assert(!fs.lstatSync(evidenceRoot).isSymbolicLink(), \"check evidence directory may not be a symlink\");",
    "  const safeTaskId = receipt.task_id.replace(/[^A-Za-z0-9._-]/gu, \"_\");",
    "  const target = path.join(evidenceRoot, `${safeTaskId}-${String(receipt.check_index).padStart(3, \"0\")}-${receipt.failure_sha256}.json`);",
    "  if (fs.existsSync(target)) { assert(!fs.lstatSync(target).isSymbolicLink(), \"check failure receipt may not be a symlink\"); assert(fs.readFileSync(target, \"utf8\") === `${JSON.stringify(receipt)}\\n`, \"check failure receipt changed\"); return; }",
    "  const temporary = `${target}.${process.pid}.stage`;",
    "  try { fs.writeFileSync(temporary, `${JSON.stringify(receipt)}\\n`, {flag: \"wx\", mode: 0o600}); fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }",
    "}",
    "",
    "export function runChecksWithEvidence({worktreePath, checks, taskId, role, sourceCommit, sourceTree, schedulerRoot}) {",
    "  assert(fs.existsSync(worktreePath) && fs.statSync(worktreePath).isDirectory(), \"check worktree is unavailable\");",
    "  const observed = sourceIdentity(worktreePath);",
    "  assert(Array.isArray(checks) && checks.length > 0 && checks.length <= 64 && checks.every((check) => typeof check === \"string\" && check.trim().length > 0), \"check list is invalid\");",
    "  requireString(taskId, \"check task ID\"); requireString(role, \"check role\"); requireGitObject(sourceCommit, \"check source commit\"); requireGitObject(sourceTree, \"check source tree\"); requireString(schedulerRoot, \"check scheduler authority root\"); assert(path.isAbsolute(schedulerRoot), \"check scheduler authority root must be absolute\");",
    "  assert(sourceCommit === observed.commit && sourceTree === observed.tree, \"check source identity differs from worktree HEAD\");",
    "  const candidate = candidateIdentity(observed.root, sourceCommit, sourceTree);",
    "  const execute = () => { for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {",
    "    const command = checks[checkIndex]; const {program, args} = parseCheckCommand(command);",
    "    try { execFileSync(program, args, {cwd: observed.root, encoding: \"utf8\", maxBuffer: MAX_OUTPUT_BYTES, stdio: [\"ignore\", \"pipe\", \"pipe\"]}); }",
    "    catch (error) { const receipt = compileCheckFailureReceipt({taskId, role, sourceCommit, sourceTree, checkIndex, command, error}); writeReceipt(observed.root, receipt); throw error; }",
    "  } return checks; };",
    "  const scheduler = createHybridScheduler({authorityRoot: schedulerRoot});",
    "  const request = compileHybridSchedulerRequest({requestId: `CHECK-${crypto.createHash(\"sha256\").update(JSON.stringify({taskId, role, candidate, checks}), \"utf8\").digest(\"hex\").slice(0, 32).toUpperCase()}`, requesterId: schedulerId(\"WORKER\", taskId), lane: schedulerId(\"CHECK\", `${role}:${taskId}`), repositoryId: \"AGENTOS_PROJECT\", worktreeId: schedulerId(\"WORKTREE\", observed.root), candidateCommit: candidate.commit, candidateTreeOrDigest: candidate.tree, cleanState: candidate.clean, resourceClass: checks.some((check) => /(?:build|compile|test|verify|integration|database|artifact)/iu.test(check)) ? \"COMPILE_HEAVY\" : \"LIGHTWEIGHT_SOURCE_CHECK\", workingDirectoryRef: opaqueSchedulerWorktreeRef(observed.root), commandArgv: [\"AGENTOS_CHECK_PLAN\", ...checks], toolchainProfile: \"NODE_HOST\", proofClass: \"TEST_BATCH\", whyNeeded: \"RUN_ADMITTED_CHECK_PLAN\", expectedProof: \"ALL_COMMANDS_EXIT_ZERO\", coverage: checks.map((check) => `CHECK-${crypto.createHash(\"sha256\").update(check, \"utf8\").digest(\"hex\").slice(0, 16).toUpperCase()}`).sort(), timeoutClass: \"BOUNDED\", cachePolicy: \"NO_SHARED_OUTPUT\", secretPolicy: \"REDACTED\"});",
    "  return scheduler.runSync({request, admission: {effectiveArgv: request.command_argv, workingDirectory: observed.root, workingDirectoryRef: request.working_directory_ref, allowedScope: [\".\"], dependencyPreflight: () => ({status: \"READY\", identity: \"DEPENDENCY_\" + request.request_sha256.slice(0, 24).toUpperCase()}), runtimePreflight: () => ({status: \"READY\", identity: \"RUNTIME_\" + request.request_sha256.slice(0, 24).toUpperCase()})}, resolveCandidate: () => candidateIdentity(observed.root, sourceCommit, sourceTree), execute}).output ?? checks;",
    "}",
    "",
  ].join("\n");
  writeFileAtomic(runnerPath, runnerSource);

  let workerSource = fs.readFileSync(workerPath, "utf8");
  const workerImportMarker = 'import {pathToFileURL} from "node:url";';
  assert(workerSource.includes(workerImportMarker), "worker URL import is unavailable");
  workerSource = workerSource.replace(workerImportMarker, `${workerImportMarker}\nimport {runChecksWithEvidence} from "./check-runner.mjs";`);
  const workerChecksMarker = [
    "function runChecks(worktreePath, checks) {",
    "  for (const check of checks) {",
    "    const [program, ...args] = check.split(\" \");",
    "    execFileSync(program === \"node\" ? process.execPath : program, args, {cwd: worktreePath, encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"]});",
    "  }",
    "  return checks;",
    "}",
  ].join("\n");
  assert(workerSource.includes(workerChecksMarker), "worker check runner is unavailable");
  workerSource = workerSource.replace(workerChecksMarker, "function runChecks(worktreePath, checks) {\n  return runChecksWithEvidence({worktreePath, checks, taskId, role, sourceCommit, sourceTree, schedulerRoot});\n}");
  writeFileAtomic(workerPath, workerSource);

  let adapterSource = fs.readFileSync(adapterPath, "utf8");
  const adapterImportMarker = 'import {pathToFileURL} from "node:url";';
  assert(adapterSource.includes(adapterImportMarker), "adapter URL import is unavailable");
  const adapterUsesSharedScheduler = adapterSource.includes("function runScheduledControllerChecks(");
  if (!adapterUsesSharedScheduler) adapterSource = adapterSource.replace(adapterImportMarker, `${adapterImportMarker}\nimport {runChecksWithEvidence} from "./check-runner.mjs";`);
  const adapterChecksMarker = [
    "function runChecks(worktreePath, checks) {",
    "  for (const check of checks) {",
    "    const [program, ...args] = check.split(\" \");",
    "    execFileSync(program === \"node\" ? process.execPath : program, args, {cwd: worktreePath, encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"]});",
    "  }",
    "  return checks;",
    "}",
  ].join("\n");
  const adapterRunChecks = [
    "function runChecks(worktreePath, checks) {",
    "  const sourceCommit = git(worktreePath, [\"rev-parse\", \"HEAD\"]);",
    "  const sourceTree = git(worktreePath, [\"rev-parse\", \"HEAD^{tree}\"]);",
    "  return runChecksWithEvidence({worktreePath, checks, taskId: \"CONTROLLER-RECHECK\", role: \"AGENTOS_CONTROLLER\", sourceCommit, sourceTree, schedulerRoot: process.env.AGENTOS_SCHEDULER_ROOT});",
    "}",
  ].join("\n");
  if (adapterUsesSharedScheduler) {
    // The current Controller adapter already routes its check batches through
    // the shared scheduler. Keep that source intact when this legacy repair
    // generator runs against a current checkout.
  } else if (adapterSource.includes(adapterChecksMarker)) {
    adapterSource = adapterSource.replace(adapterChecksMarker, adapterRunChecks);
  } else {
    const adapterFunctionMarker = "function runControllerChecks(worktreePath, taskKind = \"CONTROLLER_SUPERVISOR_REPAIR\") {";
    assert(adapterSource.includes(adapterFunctionMarker), "adapter check runner is unavailable");
    adapterSource = adapterSource.replace(adapterFunctionMarker, adapterRunChecks + "\n\n" + adapterFunctionMarker);
  }
  const campaignProgressChecksMarker = [
    "function runCampaignProgressChecks(worktreePath) {",
    "  const checks = [",
    "    \"node --check control/governance-decision-tree.mjs\",",
    "    \"node tests/verify-governance-decision-tree.mjs\",",
    "    \"node --check control/controller-supervisor.mjs\",",
    "    \"node tests/verify-controller-supervisor.mjs\",",
    "  ];",
    "  for (const check of checks) {",
    "    const [program, ...args] = check.split(\" \");",
    "    execFileSync(program === \"node\" ? process.execPath : program, args, {cwd: worktreePath, encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"]});",
    "  }",
    "  return checks;",
    "}",
  ].join("\n");
  if (adapterSource.includes(campaignProgressChecksMarker)) {
    adapterSource = adapterSource.replace(campaignProgressChecksMarker, [
      "function runCampaignProgressChecks(worktreePath) {",
      "  return runChecks(worktreePath, [",
      "    \"node --check control/governance-decision-tree.mjs\",",
      "    \"node tests/verify-governance-decision-tree.mjs\",",
      "    \"node --check control/controller-supervisor.mjs\",",
      "    \"node tests/verify-controller-supervisor.mjs\",",
      "  ]);",
      "}",
    ].join("\n"));
  }
  const adapterLoopMarker = [
    "  for (const check of checks) {",
    "    const [program, ...args] = check.split(\" \");",
    "    execFileSync(program === \"node\" ? process.execPath : program, args, {cwd: worktreePath, encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"]});",
    "  }",
    "  return checks;",
  ].join("\n");
  const adapterLoopCount = adapterSource.split(adapterLoopMarker).length - 1;
  if (adapterLoopCount >= 2) adapterSource = adapterSource.replaceAll(adapterLoopMarker, "  return runChecks(worktreePath, checks);");
  writeFileAtomic(adapterPath, adapterSource);

  const verifierSource = [
    "#!/usr/bin/env node",
    "",
    "import assert from \"node:assert/strict\";",
    "import fs from \"node:fs\";",
    "import os from \"node:os\";",
    "import path from \"node:path\";",
    "import {compileCheckFailureReceipt, runChecksWithEvidence, validateCheckFailureReceipt} from \"../control/check-runner.mjs\";",
    "",
    "const root = fs.mkdtempSync(path.join(os.tmpdir(), \"agentos-check-repair-\"));",
    "const schedulerRoot = path.join(root, \"scheduler\");",
    "fs.mkdirSync(path.join(root, \"control\"), {recursive: true});",
    "fs.mkdirSync(path.join(root, \"tests\"), {recursive: true});",
    "fs.writeFileSync(path.join(root, \"tests\", \"always-fails.mjs\"), \"process.stdout.write('CHECK_STDOUT'); process.stderr.write('CHECK_STDERR'); process.exit(7);\\n\");",
    "execFileSync(\"git\", [\"-C\", root, \"init\", \"-q\"]);",
    "execFileSync(\"git\", [\"-C\", root, \"config\", \"user.email\", \"agentos@example.invalid\"]);",
    "execFileSync(\"git\", [\"-C\", root, \"config\", \"user.name\", \"AgentOS Check Repair\"]);",
    "execFileSync(\"git\", [\"-C\", root, \"add\", \"tests/always-fails.mjs\"]);",
    "execFileSync(\"git\", [\"-C\", root, \"commit\", \"-qm\", \"fixture\"]);",
    "const sourceCommit = execFileSync(\"git\", [\"-C\", root, \"rev-parse\", \"HEAD\"], {encoding: \"utf8\"}).trim();",
    "const sourceTree = execFileSync(\"git\", [\"-C\", root, \"rev-parse\", \"HEAD^{tree}\"], {encoding: \"utf8\"}).trim();",
    "try {",
    "  const receipt = compileCheckFailureReceipt({taskId: \"TASK-CHECK-1\", role: \"FEATURE_AGENT\", sourceCommit: \"a\".repeat(40), sourceTree: \"b\".repeat(40), checkIndex: 0, command: \"node tests/always-fails.mjs\", error: {status: 7, signal: null, stdout: \"out\", stderr: \"err\"}, observedAtUtc: \"2026-08-04T12:00:00.000Z\"});",
    "  assert.doesNotThrow(() => validateCheckFailureReceipt(receipt));",
    "  assert.equal(receipt.exit_code, 7);",
    "  assert.equal(receipt.stdout_bytes, 3);",
    "  assert.equal(receipt.stderr_bytes, 3);",
    "  assert.equal(receipt.diagnostics_redacted, true);",
    "  assert.throws(() => runChecksWithEvidence({worktreePath: root, schedulerRoot, taskId: \"TASK-CHECK-2\", role: \"FEATURE_AGENT\", sourceCommit, sourceTree, checks: [\"node tests/always-fails.mjs\"]}));",
    "  const files = fs.readdirSync(path.join(root, \"control\", \"check-failure-receipts\"));",
    "  assert.equal(files.length, 1);",
    "  const retained = JSON.parse(fs.readFileSync(path.join(root, \"control\", \"check-failure-receipts\", files[0]), \"utf8\"));",
    "  assert.equal(retained.status, \"FAILED\");",
    "  assert.equal(retained.exit_code, 7);",
    "  assert.equal(retained.stdout_bytes, 11);",
    "  assert.equal(retained.stderr_bytes, 11);",
    "  assert.equal(retained.diagnostics_redacted, true);",
    "  assert.doesNotMatch(JSON.stringify(retained), /CHECK_STDOUT|CHECK_STDERR/u);",
    "  assert.doesNotThrow(() => validateCheckFailureReceipt(retained));",
    "  console.log(\"PASS failed checks retain command, output classes, output digests, source identity, and failure digest without raw output\");",
    "} finally { fs.rmSync(root, {recursive: true, force: true}); }",
  ].join("\n") + "\n";
  writeFileAtomic(verifierPath, verifierSource);

  const backlogSource = fs.readFileSync(backlogPath, "utf8");
  const backlogLines = backlogSource.split(/\r?\n/u);
  const backlogRowIndex = backlogLines.findIndex((row) => row.startsWith("| `" + feedbackId + "` |") && /\|\s*`?OPEN`?\s*\|$/u.test(row));
  assert(backlogRowIndex >= 0, `owner feedback ${feedbackId} is not open at the expected source checkpoint`);
  backlogLines[backlogRowIndex] = backlogLines[backlogRowIndex].replace(/`OPEN`(?=\s*\|$)/u, "`RESOLVED`").replace(/OPEN(?=\s*\|$)/u, "RESOLVED");
  writeFileAtomic(backlogPath, backlogLines.join("\n"));
  return {
    changedByRepair: ["control/check-runner.mjs", "control/local-agent-worker.mjs", "control/local-self-development-supervisor-adapter.mjs", "docs/owner-feedback-backlog.md", "tests/verify-owner-feedback-check-repair.mjs"],
    artifactName: "control/owner-feedback-check-repair-receipt.mjs",
  };
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
const schedulerRootInput = args.scheduler_root ?? process.env.AGENTOS_SCHEDULER_ROOT;
const globalGovernanceStoreRoot = args.global_governance_store_root;
const globalGovernanceStoreBootstrap = args.global_governance_store_bootstrap;

requireString(role, "worker role");
requireString(sessionId, "worker session");
requireString(campaignId, "worker campaign");
requireString(campaignVersion, "worker campaign version");
requireSha(candidateSha256, "worker candidate");
requireGitObject(sourceCommit, "worker source commit");
requireGitObject(sourceTree, "worker source tree");
requireString(task, "worker task");
requireString(schedulerRootInput, "worker scheduler authority root");
assert(path.isAbsolute(schedulerRootInput), "worker scheduler authority root must be absolute");
validateLocalTaskKindForRole({role, taskKind});
requireUtc(nowUtc, "worker time");
assert(fs.existsSync(worktreePath) && fs.statSync(worktreePath).isDirectory(), "worker worktree is unavailable");
const schedulerRoot = path.resolve(schedulerRootInput);
process.env.AGENTOS_SCHEDULER_ROOT = schedulerRoot;
const globalGovernanceAuthorityStore = openGlobalGovernanceAuthorityStore({sealedAuthority: getSealedCanonicalAuthority(), authorityRoot: path.resolve(globalGovernanceStoreRoot), bootstrapSha256: globalGovernanceStoreBootstrap});
const schedulerGovernanceContext = compileOperationalGlobalGovernanceContext({authorityStore: globalGovernanceAuthorityStore, roleClass: "SCHEDULER", operationalId: `CONTEXT.SCHEDULER.WORKER.${crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24).toUpperCase()}`});
checkScheduler = createHybridScheduler({authorityRoot: schedulerRoot, globalGovernanceContext: schedulerGovernanceContext, globalGovernanceAuthorityStore});
checkSchedulerContext = {taskId, role};

function writeFileAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.stage`;
  const handle = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
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
  const gateEvidence = collectGovernanceGateEvidence({worktreePath, tree: decisionTree, schedulerRoot});
  const evidence = (gate) => Object.fromEntries(gate.evidence_requirements.map((key) => [key, gateEvidence[gate.gate_id + ":" + key]]));
  const gateAnswers = Object.fromEntries(decisionTree.gates.map((gate) => [gate.gate_id, {answer: "YES", evidence: evidence(gate), failure: null, recheck: null}]));
  const gateEvaluation = evaluateGovernanceDecisionTree({tree: decisionTree, answers: gateAnswers});
  assert(gateEvaluation.status === "PASS", "Orchestrator four-root governance evaluation did not pass");
  product = {
    ...base,
    custody_status: "CAMPAIGN_ORCHESTRATOR_CUSTODY",
    ordered_roots: ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "CODE_QUALITY_HYGIENE", "SECURITY"],
    gate_evidence: gateEvidence,
    gate_answers: gateAnswers,
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
  if (taskKind === "GOVERNANCE_EVIDENCE_RECHECK") {
    assert(featureWorktree !== null && fs.existsSync(featureWorktree) && fs.statSync(featureWorktree).isDirectory(), "auditor Feature-Agent worktree is unavailable");
    assert(evidenceWorktree !== null && fs.existsSync(evidenceWorktree) && fs.statSync(evidenceWorktree).isDirectory(), "auditor evidence worktree is unavailable");
    assert(decisionTreePath !== null && fs.existsSync(decisionTreePath), "auditor decision tree is unavailable");
    const decisionTree = JSON.parse(fs.readFileSync(decisionTreePath, "utf8"));
    const evidencePlanPath = path.join(evidenceWorktree, "orchestrator-plan.json");
    assert(fs.existsSync(evidencePlanPath), "auditor orchestrator evidence plan is unavailable");
    const evidencePlan = JSON.parse(fs.readFileSync(evidencePlanPath, "utf8"));
    const {evaluateGovernanceDecisionTree} = await import(pathToFileURL(path.join(worktreePath, "control/governance-decision-tree.mjs")).href);
    const {controllerDigest} = await import(pathToFileURL(path.join(worktreePath, "control/agentos-controller.mjs")).href);
    const evaluation = evaluateGovernanceDecisionTree({tree: decisionTree, answers: evidencePlan.gate_answers});
    assert(evaluation.status === "PASS", "Auditor governance evidence re-check did not pass");
    assert(evidencePlan.gate_evaluation?.evaluation_sha256 === evaluation.evaluation_sha256, "Auditor observed a different governance evaluation");
    const auditedFeatureCommit = git(featureWorktree, ["rev-parse", "HEAD"]);
    const auditedFeatureTree = git(featureWorktree, ["rev-parse", "HEAD^{tree}"]);
    assert(auditedFeatureCommit === sourceCommit && auditedFeatureTree === sourceTree, "Auditor source differs from the repaired Feature-Agent checkpoint");
    assert(evidencePlan.source_commit === sourceCommit && evidencePlan.source_tree === sourceTree, "Auditor evidence plan source differs from the repaired checkpoint");
    const flattenedEvidence = {};
    for (const gate of decisionTree.gates) {
      const gateAnswer = evidencePlan.gate_answers?.[gate.gate_id];
      assert(gateAnswer?.answer === "YES", "Auditor evidence plan contains a non-YES gate answer");
      for (const key of gate.evidence_requirements) {
        const compositeKey = gate.gate_id + ":" + key;
        const record = evidencePlan.gate_evidence?.[compositeKey];
        assert(record && gateAnswer.evidence?.[key], "Auditor evidence plan is missing a declared gate record");
        assert(record.source_commit === sourceCommit && record.source_tree === sourceTree, "Auditor gate evidence source differs from the repaired checkpoint");
        assert(!record.check_id.includes("PLACEHOLDER") && !record.check_id.includes("}"), "Auditor accepted generic gate evidence");
        assert(controllerDigest(record) === controllerDigest(gateAnswer.evidence[key]), "Auditor gate evidence map differs from each gate answer");
        flattenedEvidence[compositeKey] = gateAnswer.evidence[key];
      }
    }
    assert(controllerDigest(flattenedEvidence) === controllerDigest(evidencePlan.gate_evidence), "Auditor gate evidence contains an undeclared or missing record");
    buildCommit = auditedFeatureCommit;
    buildTree = auditedFeatureTree;
    changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    for (const requiredPath of ["control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs"]) assert(changedPaths.includes(requiredPath), "Auditor did not observe the complete Feature-Agent evidence repair");
    focusedChecks = runFocusedChecks(featureWorktree);
    buildStatus = "AUDIT_VERIFIED";
    product = {
      ...product,
      task_id: taskId,
      task_kind: taskKind,
      audit_status: "GOVERNANCE_EVIDENCE_VERIFIED",
      audited_feature_worktree: featureWorktree,
      audited_feature_commit: buildCommit,
      audited_feature_tree: buildTree,
      audited_feature_changed_paths: changedPaths,
      audited_feature_checks: focusedChecks,
      audited_gate_evidence: evidencePlan.gate_evidence,
      audited_gate_answers: evidencePlan.gate_answers,
      audited_gate_evaluation: evaluation,
      evidence_worktree: evidenceWorktree,
    };
  } else if (featureWorktree !== null) {
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
          : taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : taskKind === "DURABLE_SESSION_LIVENESS_REPAIR"
            ? "control/local-agent-runtime.mjs"
          : taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? "tests/verify-local-agent-session.mjs"
          : taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
            ? "control/bootstrap-compiler.mjs"
          : taskKind === "OWNER_FEEDBACK_REPAIR"
            ? "control/task-run-loop.mjs"
          : "control/governance-decision-tree.mjs";
      const ownerFeedbackCodeChanged = taskKind === "OWNER_FEEDBACK_REPAIR"
        && ["control/check-runner.mjs", "control/local-campaign-admission.mjs", "control/task-run-loop.mjs", "control/local-agent-runtime.mjs", "control/local-self-development-supervisor-adapter.mjs"].some((candidatePath) => changedPaths.includes(candidatePath));
      assert(taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs"].some((candidatePath) => changedPaths.includes(candidatePath))
        : ownerFeedbackCodeChanged
          ? true
        : changedPaths.includes(requiredChangedPath), "Auditor did not observe the required Feature-Agent code change");
      focusedChecks = taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? runControllerSupervisorChecks(featureWorktree)
        : taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
          ? runControllerSupervisorBindingChecks(featureWorktree, taskKind)
          : taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
            ? runChecks(featureWorktree, ["node --check control/local-self-development-supervisor-adapter.mjs", "node tests/verify-controller-supervisor.mjs"])
          : taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
            ? runChecks(featureWorktree, ["node --check control/local-self-development-supervisor-adapter.mjs", "node tests/verify-controller-supervisor.mjs"])
          : taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? runDurableSessionChecks(featureWorktree)
          : taskKind === "DURABLE_SESSION_LIVENESS_REPAIR"
            ? runChecks(featureWorktree, ["node --check control/local-agent-runtime.mjs", "node tests/verify-local-agent-session.mjs"])
          : taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
            ? runChecks(featureWorktree, ["node --check control/bootstrap-compiler.mjs", "node tests/verify-owner-conversation-surface.mjs", "node tests/verify-owner-review.mjs", "node tests/verify-bootstrap-delivery-finish.mjs"])
          : taskKind === "OWNER_FEEDBACK_REPAIR"
            ? runChecks(featureWorktree, ["node --check control/task-run-loop.mjs", "node --check control/local-agent-runtime.mjs", "node tests/verify-task-run-loop.mjs", "node tests/verify-local-agent-session.mjs", "node tests/verify-owner-feedback-backlog.mjs", "node tests/verify-all.mjs"])
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
    commitProjectWorktree(worktreePath, "Project Worker: bind real governance gate evidence");
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
  } else if (taskKind === "DURABLE_SESSION_LIVENESS_REPAIR") {
    artifactName = "control/durable-session-liveness-repair-receipt.mjs";
    const changedByRepair = applyDurableSessionLivenessRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/local-agent-runtime.mjs",
      "node tests/verify-local-agent-session.mjs",
    ]);
    const marker = `// Local Feature Agent durable-session liveness repair receipt; held in the isolated campaign worktree.\nexport const DURABLE_SESSION_LIVENESS_REPAIR = Object.freeze(${JSON.stringify({
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
    commitProjectWorktree(worktreePath, "Project Worker: recover abruptly exited durable sessions");
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean durable-session liveness checkpoint");
    assert(changedPaths.includes("control/local-agent-runtime.mjs") && changedPaths.includes("tests/verify-local-agent-session.mjs"), "Feature Agent durable-session liveness repair did not change runtime and hostile verifier");
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
    commitProjectWorktree(worktreePath, "Project Worker: make durable-session verifier worktree-safe");
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
  } else if (taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR") {
    artifactName = "control/owner-conversation-surface-repair-receipt.mjs";
    const changedByRepair = applyOwnerConversationSurfaceRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/bootstrap-compiler.mjs",
      "node tests/verify-owner-conversation-surface.mjs",
      "node tests/verify-owner-review.mjs",
      "node tests/verify-bootstrap-delivery-finish.mjs",
    ]);
    const marker = `// Local Feature Agent owner-conversation repair receipt; held in the isolated campaign worktree.\nexport const OWNER_CONVERSATION_SURFACE_REPAIR = Object.freeze(${JSON.stringify({
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
    commitProjectWorktree(worktreePath, "Project Worker: keep Bootstrap owner conversation casual");
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean owner-conversation checkpoint");
    assert(["control/bootstrap-compiler.mjs", "control/owner-review.mjs"].some((candidatePath) => changedPaths.includes(candidatePath)), "Feature Agent owner-conversation repair did not change a conversation surface");
    assert(changedPaths.includes("tests/verify-owner-review.mjs"), "Feature Agent owner-conversation repair did not update its focused verifier");
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
  } else if (taskKind === "OWNER_FEEDBACK_REPAIR") {
    const feedbackId = task.match(/owner feedback (FEEDBACK-\d+)/iu)?.[1] ?? taskId.match(/(FEEDBACK-\d+)(?:-|$)/u)?.[1];
    assert(feedbackId !== undefined, "owner feedback task ID is missing its feedback item");
    let repair;
    if (feedbackId === "FEEDBACK-001") repair = applyOwnerFeedbackRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-002") repair = applyOwnerFeedbackStatusRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-003") repair = applyOwnerFeedbackDigestRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-004") repair = applyOwnerFeedbackProgressRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-005") repair = applyOwnerFeedbackContinuationRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-006") repair = applyOwnerFeedbackExecutionBoundaryRepair(worktreePath, feedbackId);
    else if (feedbackId === "FEEDBACK-007") repair = applyOwnerFeedbackCheckRepair(worktreePath, feedbackId);
    else throw new Error(`owner feedback ${feedbackId} requires its own repair recipe`);
    artifactName = repair.artifactName;
    focusedChecks = runChecks(worktreePath, [
      "node --check control/task-run-loop.mjs",
      "node --check control/local-agent-runtime.mjs",
      "node --check control/local-self-development-supervisor-adapter.mjs",
      "node tests/verify-task-run-loop.mjs",
      "node tests/verify-local-agent-session.mjs",
      "node tests/verify-owner-feedback-digest.mjs",
      "node tests/verify-owner-feedback-progress.mjs",
      "node tests/verify-owner-feedback-continuation.mjs",
      "node tests/verify-owner-feedback-execution-boundary.mjs",
      "node tests/verify-owner-feedback-check-repair.mjs",
      "node tests/verify-owner-feedback-backlog.mjs",
      "node tests/verify-all.mjs",
    ]);
    const marker = `// Local Feature Agent owner-feedback repair receipt; held in the isolated campaign worktree.\nexport const OWNER_FEEDBACK_REPAIR = Object.freeze(${JSON.stringify({
      task_id: taskId,
      task_kind: taskKind,
      feedback_id: feedbackId,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      custody_status: "FEATURE_AGENT_CUSTODY",
      changed_by_repair: repair.changedByRepair,
    }, null, 2)});\n`;
    writeFileAtomic(path.join(worktreePath, artifactName), marker);
    const stagedPaths = [...repair.changedByRepair, artifactName];
    execFileSync("git", ["add", ...stagedPaths], {cwd: worktreePath, encoding: "utf8"});
    commitProjectWorktree(worktreePath, `Project Worker: repair owner feedback ${feedbackId}`);
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean owner feedback checkpoint");
    const changedOwnerFeedbackCode = (changedPaths.includes("control/task-run-loop.mjs") && changedPaths.includes("tests/verify-task-run-loop.mjs"))
      || (changedPaths.includes("control/local-agent-runtime.mjs") && changedPaths.includes("tests/verify-local-agent-session.mjs"))
      || (changedPaths.includes("control/local-self-development-supervisor-adapter.mjs") && changedPaths.includes("tests/verify-owner-feedback-digest.mjs"))
      || (changedPaths.includes("control/local-self-development-supervisor-adapter.mjs") && changedPaths.includes("tests/verify-owner-feedback-progress.mjs"))
      || (changedPaths.includes("control/local-self-development-supervisor-adapter.mjs") && changedPaths.includes("tests/verify-owner-feedback-continuation.mjs"))
      || (changedPaths.includes("control/local-campaign-admission.mjs") && changedPaths.includes("tests/verify-owner-feedback-execution-boundary.mjs"))
      || (changedPaths.includes("control/check-runner.mjs") && changedPaths.includes("tests/verify-owner-feedback-check-repair.mjs"));
    assert(changedOwnerFeedbackCode, "Feature Agent owner feedback repair changed neither the requested code nor its focused test");
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
    commitProjectWorktree(worktreePath, localBindingRepair ? "Project Worker: refresh local session verifier binding" : "Project Worker: refresh Controller supervisor binding");
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
  } else if (taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR") {
    artifactName = "control/autonomous-campaign-progress-repair-receipt.mjs";
    const changedByRepair = applyAutonomousCampaignProgressRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/local-self-development-supervisor-adapter.mjs",
      "node tests/verify-controller-supervisor.mjs",
    ]);
    const marker = `// Local Feature Agent autonomous-campaign-progress repair receipt; held in the isolated campaign worktree.\nexport const AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR = Object.freeze(${JSON.stringify({
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
    commitProjectWorktree(worktreePath, "Project Worker: mint next autonomous campaign behavior");
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean autonomous campaign progress checkpoint");
    assert(changedPaths.includes("control/local-self-development-supervisor-adapter.mjs"), "Feature Agent autonomous campaign progress repair did not change the Controller queue");
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
  } else if (taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR") {
    artifactName = "control/autonomous-campaign-continuation-repair-receipt.mjs";
    const changedByRepair = applyAutonomousCampaignContinuationRepair(worktreePath);
    focusedChecks = runChecks(worktreePath, [
      "node --check control/local-self-development-supervisor-adapter.mjs",
      "node tests/verify-controller-supervisor.mjs",
    ]);
    const marker = `// Local Feature Agent autonomous-campaign-continuation repair receipt; held in the isolated campaign worktree.\nexport const AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR = Object.freeze(${JSON.stringify({
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
    commitProjectWorktree(worktreePath, "Project Worker: continue bounded campaigns automatically");
    buildCommit = git(worktreePath, ["rev-parse", "HEAD"]);
    buildTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree && git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) === "", "Feature Agent did not produce a clean autonomous continuation checkpoint");
    assert(changedPaths.includes("control/local-self-development-supervisor-adapter.mjs"), "Feature Agent autonomous continuation repair did not change the Controller queue");
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
    commitProjectWorktree(worktreePath, "Project Worker: enforce supervisor boundary stops");
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
    const receiptFunctionName = existingSource.includes("compileFeatureAgentRepairReceipt")
      ? `compileFeatureAgentTaskReceipt_${taskId.replace(/[^A-Za-z0-9_]/gu, "_")}`
      : "compileFeatureAgentRepairReceipt";
    assert(!existingSource.includes(`export function ${receiptFunctionName}`), "Feature Agent task receipt was already applied in this worktree");
    const implementation = `\n\nexport function ${receiptFunctionName}({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {\n  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");\n  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");\n  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");\n  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};\n}\n`;
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
    commitProjectWorktree(worktreePath, "Project Worker: implement governance repair receipt");
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
