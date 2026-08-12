#!/usr/bin/env node

/*
 * Controller-owned routing for the active gate-evidence repair.
 * The Controller chooses and records the bounded task; the Feature Agent owns
 * the code change, the Orchestrator produces real gate evidence, and the
 * Auditor verifies the same changed checkpoint before the Controller rechecks.
 */

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {
  compileGovernanceDecisionTree,
  validateGovernanceDecisionTree,
} from "./governance-decision-tree.mjs";
import {controllerDigest} from "./agentos-controller.mjs";
import {
  validateLocalCampaignActivation,
  writeLocalCampaignRecord,
} from "./local-campaign-admission.mjs";
import {spawnWorker, validateLocalWorkerReadback} from "./local-agent-runtime.mjs";

const CAMPAIGN_ROOT_NAME = "tmp/agentos-local-self-development-1";
const CAMPAIGN_ID = "CAMPAIGN-AGENTOS-SELF-DEVELOPMENT-1";
const CAMPAIGN_VERSION = "v1";
const FEATURE_TASK_ID = "TASK-GOVERNANCE-EVIDENCE-REPAIR-9";
const ORCHESTRATOR_TASK_ID = "TASK-GOVERNANCE-EVIDENCE-ORCHESTRATOR-RECHECK-2";
const AUDITOR_TASK_ID = "TASK-GOVERNANCE-EVIDENCE-AUDITOR-RECHECK-2";
const FEATURE_TASK_KIND = "GOVERNANCE_EVIDENCE_REPAIR";
const RECHECK_TASK_KIND = "GOVERNANCE_EVIDENCE_RECHECK";
const ROOTS = ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "CODE_QUALITY_HYGIENE", "SECURITY"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function opaqueError(value) {
  const raw = value?.message ?? String(value);
  return `opaque:error:${controllerDigest(raw)}`;
}

function canonicalRoot(root) {
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "evidence repair repository root must be a real directory");
  return resolved;
}

function readJson(filePath) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `evidence repair record is not a regular file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function contentAddressed(record, field) {
  const value = structuredClone(record);
  value[field] = null;
  value[field] = controllerDigest(value);
  return value;
}

function record(root, fileName, value) {
  return writeLocalCampaignRecord({root, fileName, record: value});
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${label} must be a Git object`);
}

function verifyRca(value, field, label) {
  requireSha(value[field], `${label} digest`);
  const copy = structuredClone(value);
  copy[field] = null;
  assert(value[field] === controllerDigest(copy), `${label} digest mismatch`);
}

function readActive(root, fileName) {
  return readJson(path.join(root, fileName));
}

function workerCommand(scriptPath, role, taskId, taskKind) {
  return `${process.execPath} ${scriptPath} --role ${role} --task-id ${taskId} --task-kind ${taskKind}`;
}

function assertRealFeatureRepair(readback, originalFeature) {
  validateLocalWorkerReadback(readback);
  assert(readback.role === "FEATURE_AGENT" && readback.build_status === "COMPLETED", "Feature Agent evidence repair did not complete");
  assert(readback.source_commit === originalFeature.build_commit && readback.source_tree === originalFeature.build_tree, "Feature Agent repair source is not the previous Feature-Agent checkpoint");
  assert(readback.build_commit !== originalFeature.build_commit && readback.build_tree !== originalFeature.build_tree, "Feature Agent evidence repair did not create a changed commit/tree");
  for (const requiredPath of ["control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs"]) assert(readback.changed_paths.includes(requiredPath), `Feature Agent evidence repair omitted ${requiredPath}`);
  assert(readback.focused_checks.includes("node tests/verify-governance-decision-tree.mjs"), "Feature Agent evidence repair omitted the strict governance test");
}

function assertEvidencePlan(plan, sourceCommit, sourceTree) {
  assert(plan.custody_status === "CAMPAIGN_ORCHESTRATOR_CUSTODY", "Orchestrator evidence plan custody is invalid");
  assert(plan.source_commit === sourceCommit && plan.source_tree === sourceTree, "Orchestrator evidence plan source differs from Feature-Agent repair");
  assert(plan.gate_evaluation?.status === "PASS", "Orchestrator did not return a passing gate evaluation");
  assert(plan.gate_answers && plan.gate_evidence, "Orchestrator did not return actual gate answers and evidence");
  for (const root of ROOTS) assert(plan.gate_evaluation.completed_roots.includes(root), `Orchestrator did not complete ${root}`);
  for (const evidence of Object.values(plan.gate_evidence)) {
    assert(evidence.source_commit === sourceCommit && evidence.source_tree === sourceTree, "Orchestrator gate evidence is not source-bound");
    assert(!evidence.check_id.includes("PLACEHOLDER") && !evidence.check_id.includes("}"), "Orchestrator returned generic gate evidence");
    assert(evidence.observed?.exit_code === 0 && evidence.observed?.status === "PASS", "Orchestrator returned a non-passing gate observation");
  }
}

function assertAuditorRecheck(readback, featureReadback, artifact) {
  validateLocalWorkerReadback(readback);
  assert(readback.role === "INDEPENDENT_AUDITOR" && readback.build_status === "AUDIT_VERIFIED", "Auditor did not complete the evidence re-check");
  assert(readback.build_commit === featureReadback.build_commit && readback.build_tree === featureReadback.build_tree, "Auditor verified a different Feature-Agent commit/tree");
  assert(artifact.audit_status === "GOVERNANCE_EVIDENCE_VERIFIED", "Auditor artifact does not prove governance evidence verification");
  assert(artifact.audited_feature_commit === featureReadback.build_commit && artifact.audited_feature_tree === featureReadback.build_tree, "Auditor artifact source binding differs");
  assert(artifact.audited_gate_evaluation?.status === "PASS", "Auditor artifact does not contain a passing exact evaluation");
  assert(artifact.audited_gate_evidence && typeof artifact.audited_gate_evidence === "object", "Auditor artifact omitted the complete gate evidence");
}

function compileFailureRca({root, phase, command, error, task, featureReadback, orchestratorReadback, auditorReadback}) {
  const rca = contentAddressed({
    schema: "agentos.controller_gate_evidence_repair_failure_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: CAMPAIGN_ID,
    campaign_version: CAMPAIGN_VERSION,
    phase,
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    symptom: "The bounded source-bound governance evidence repair did not complete its assigned stage.",
    failed_command: command,
    error_message_exact: opaqueError(error),
    error_stack_exact: error?.stack === undefined ? null : opaqueError(error.stack),
    parent_task_sha256: task?.task_sha256 ?? null,
    feature_agent_readback: featureReadback,
    orchestrator_readback: orchestratorReadback,
    auditor_readback: auditorReadback,
    hard_boundary_crossed: false,
    external_actions_attempted: false,
    required_response: "Keep the campaign open, route the exact failure to a bounded Feature-Agent repair, and require the same source-bound Auditor and Controller re-check.",
    rca_sha256: null,
  }, "rca_sha256");
  record(root, `gate-evidence-repair-failure-rca-${FEATURE_TASK_ID}.json`, rca);
  return rca;
}

async function run(repoRoot) {
  const root = canonicalRoot(repoRoot);
  assert(root === canonicalRoot(process.cwd()), "evidence repair must run from the writable development copy");
  const campaignRoot = path.join(root, CAMPAIGN_ROOT_NAME);
  const nowUtc = new Date().toISOString();
  let phase = "READ_ACTIVE_CAMPAIGN";
  let attemptedCommand = null;
  let task = null;
  let featureReadback = null;
  let orchestratorReadback = null;
  let auditorReadback = null;
  try {
    const candidate = readActive(campaignRoot, "candidate.json");
    const activation = readActive(campaignRoot, "activation.json");
    const activeState = readActive(campaignRoot, "controller-state.json");
    const gateRca = readActive(campaignRoot, "gate-evidence-anti-drift-rca.json");
    const stallRca = readActive(campaignRoot, "supervisor-stall-rca.json");
    const priorFailureRca = readActive(campaignRoot, "gate-evidence-repair-failure-rca.json");
    validateLocalCampaignActivation(activation);
    verifyRca(gateRca, "finding_sha256", "gate-evidence anti-drift RCA");
    verifyRca(stallRca, "rca_sha256", "supervisor stall RCA");
    verifyRca(priorFailureRca, "rca_sha256", "prior gate-evidence repair failure RCA");
    assert(activation.campaign_id === CAMPAIGN_ID && activation.campaign_version === CAMPAIGN_VERSION, "active campaign identity differs");
    assert(activation.active_campaign === true, "active campaign is not active");
    assert(activation.permissions.local_development_writes_allowed === true && activation.permissions.local_worker_agent_spawns_allowed === true, "local repair permissions are unavailable");
    assert(activation.permissions.product_writes_allowed === false && activation.permissions.product_agent_spawns_allowed === false, "Product permissions are enabled");
    for (const key of ["external_deployment_allowed", "external_release_allowed", "external_publication_allowed", "external_push_allowed", "external_merge_allowed", "secrets_allowed", "destructive_work_allowed"]) assert(activation.permissions[key] === false, `${key} boundary was weakened`);
    const originalFeature = activation.spawn_readbacks.find((item) => item.role === "FEATURE_AGENT");
    assert(originalFeature, "active campaign lacks the prior Feature-Agent readback");
    validateLocalWorkerReadback(originalFeature);
    requireGitObject(originalFeature.build_commit, "prior Feature-Agent commit");
    requireGitObject(originalFeature.build_tree, "prior Feature-Agent tree");
    const controllerSourceCommit = candidate.source_commit;
    const controllerSourceTree = candidate.source_tree;

    phase = "ROUTE_FEATURE_AGENT_REPAIR";
    task = contentAddressed({
      schema: "agentos.controller_bounded_repair_task.v1",
      version: 1,
      status: "ROUTED_TO_FEATURE_AGENT",
      controller_role: "AGENTOS_CONTROLLER",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      candidate_sha256: candidate.candidate_sha256,
      activation_sha256: activation.activation_sha256,
      controller_state_sha256: activeState.state_sha256,
      parent_finding_id: "F-GOVERNANCE-EVIDENCE-PLACEHOLDER",
      parent_gate_rca_sha256: gateRca.finding_sha256,
      parent_stall_rca_sha256: stallRca.rca_sha256,
      prior_failure_rca_sha256: priorFailureRca.rca_sha256,
      task_id: FEATURE_TASK_ID,
      task_kind: FEATURE_TASK_KIND,
      source_checkpoint: {commit: originalFeature.build_commit, tree: originalFeature.build_tree},
      goal: "Replace fabricated four-root gate evidence with actual per-gate command/readback evidence bound to the tested source commit/tree.",
      custody: {
        controller: "Route, observe, classify, and re-check; do not claim the code repair.",
        feature_agent: "Change governance and worker code in the isolated Feature-Agent worktree and return a clean commit/tree.",
        auditor: "Independently verify the complete gate evidence against the same Feature-Agent commit/tree.",
      },
      acceptance: ["actual source-bound gate evidence", "generic evidence rejected", "Feature-Agent changed commit/tree", "Auditor verifies the same commit/tree", "Controller exact re-check"].sort(),
      protected_boundaries: structuredClone(activation.permissions),
      created_at_utc: nowUtc,
      task_sha256: null,
    }, "task_sha256");
    record(campaignRoot, "gate-evidence-repair-task.json", task);

    attemptedCommand = workerCommand("control/local-agent-worker.mjs", "FEATURE_AGENT", FEATURE_TASK_ID, FEATURE_TASK_KIND);
    featureReadback = spawnWorker({
      repoRoot: root,
      runtimeRoot: campaignRoot,
      role: "FEATURE_AGENT",
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: originalFeature.build_commit,
      sourceTree: originalFeature.build_tree,
      task: task.goal,
      taskId: FEATURE_TASK_ID,
      taskKind: FEATURE_TASK_KIND,
    });
    assertRealFeatureRepair(featureReadback, originalFeature);
    record(campaignRoot, "gate-evidence-feature-agent-readback.json", contentAddressed({
      schema: "agentos.controller_feature_agent_repair_readback.v1",
      version: 1,
      status: "FEATURE_AGENT_BUILD_COMPLETE",
      controller_role: "AGENTOS_CONTROLLER",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      task_sha256: task.task_sha256,
      feature_agent_readback: featureReadback,
      source_commit: featureReadback.build_commit,
      source_tree: featureReadback.build_tree,
      readback_sha256: null,
    }, "readback_sha256"));

    phase = "RUN_ORCHESTRATOR_GATE_EVIDENCE";
    const ownerIntent = readActive(campaignRoot, "owner-intent.json");
    const scope = readActive(campaignRoot, "scope.json");
    const repairTree = compileGovernanceDecisionTree({
      sourceCommit: featureReadback.build_commit,
      sourceTree: featureReadback.build_tree,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      scopeSha256: scope.scope_sha256,
      featureFiles: [...new Set([...scope.changed_paths, "control/governance-evidence.mjs"])].sort(),
    });
    validateGovernanceDecisionTree(repairTree);
    const repairTreeRecord = record(campaignRoot, "gate-evidence-repair-decision-tree.json", repairTree);
    const repairTreePath = path.join(campaignRoot, repairTreeRecord.path);
    const featureWorkerScript = path.join(featureReadback.worktree_path, "control/local-agent-worker.mjs");
    attemptedCommand = workerCommand(featureWorkerScript, "CAMPAIGN_ORCHESTRATOR", ORCHESTRATOR_TASK_ID, RECHECK_TASK_KIND);
    orchestratorReadback = spawnWorker({
      repoRoot: root,
      runtimeRoot: campaignRoot,
      role: "CAMPAIGN_ORCHESTRATOR",
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: featureReadback.build_commit,
      sourceTree: featureReadback.build_tree,
      task: "Produce actual per-gate command and readback evidence for the repaired governance tree.",
      taskId: ORCHESTRATOR_TASK_ID,
      taskKind: RECHECK_TASK_KIND,
      decisionTreePath: repairTreePath,
      workerScriptPath: featureWorkerScript,
    });
    validateLocalWorkerReadback(orchestratorReadback);
    const orchestratorArtifactPath = path.join(orchestratorReadback.worktree_path, orchestratorReadback.artifact_path);
    const orchestratorPlan = readJson(orchestratorArtifactPath);
    assertEvidencePlan(orchestratorPlan, featureReadback.build_commit, featureReadback.build_tree);
    record(campaignRoot, "gate-evidence-orchestrator-readback.json", contentAddressed({
      schema: "agentos.controller_orchestrator_gate_evidence_readback.v1",
      version: 1,
      status: "ORCHESTRATOR_REAL_EVIDENCE_COMPLETE",
      controller_role: "AGENTOS_CONTROLLER",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      task_sha256: task.task_sha256,
      orchestrator_readback: orchestratorReadback,
      source_commit: featureReadback.build_commit,
      source_tree: featureReadback.build_tree,
      evidence_plan_sha256: controllerDigest(orchestratorPlan),
      readback_sha256: null,
    }, "readback_sha256"));

    phase = "RUN_AUDITOR_GATE_EVIDENCE_RECHECK";
    attemptedCommand = workerCommand(featureWorkerScript, "INDEPENDENT_AUDITOR", AUDITOR_TASK_ID, RECHECK_TASK_KIND);
    auditorReadback = spawnWorker({
      repoRoot: root,
      runtimeRoot: campaignRoot,
      role: "INDEPENDENT_AUDITOR",
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: featureReadback.build_commit,
      sourceTree: featureReadback.build_tree,
      task: "Independently verify every governance gate evidence record and exact evaluation against the Feature-Agent checkpoint.",
      taskId: AUDITOR_TASK_ID,
      taskKind: RECHECK_TASK_KIND,
      featureWorktree: featureReadback.worktree_path,
      evidenceWorktree: orchestratorReadback.worktree_path,
      decisionTreePath: repairTreePath,
      workerScriptPath: featureWorkerScript,
    });
    const auditorArtifactPath = path.join(auditorReadback.worktree_path, auditorReadback.artifact_path);
    const auditorArtifact = readJson(auditorArtifactPath);
    assertAuditorRecheck(auditorReadback, featureReadback, auditorArtifact);

    phase = "CONTROLLER_EXACT_RECHECK";
    const {evaluateGovernanceDecisionTree} = await import(pathToFileURL(path.join(featureReadback.worktree_path, "control/governance-decision-tree.mjs")).href);
    const controllerEvaluation = evaluateGovernanceDecisionTree({tree: repairTree, answers: orchestratorPlan.gate_answers});
    assert(controllerEvaluation.status === "PASS", "Controller exact governance re-check did not pass");
    assert(controllerEvaluation.evaluation_sha256 === orchestratorPlan.gate_evaluation.evaluation_sha256, "Controller evaluation differs from Orchestrator evidence");
    assert(controllerEvaluation.evaluation_sha256 === auditorArtifact.audited_gate_evaluation.evaluation_sha256, "Controller evaluation differs from Auditor re-check");
    assert(controllerDigest(orchestratorPlan.gate_evidence) === controllerDigest(auditorArtifact.audited_gate_evidence), "Controller evidence digest differs from Auditor evidence digest");
    assert(orchestratorPlan.source_commit === featureReadback.build_commit && orchestratorPlan.source_tree === featureReadback.build_tree, "Controller evidence source differs from Feature-Agent checkpoint");
    const recheck = record(campaignRoot, "controller-gate-evidence-recheck.json", contentAddressed({
      schema: "agentos.controller_gate_evidence_recheck.v1",
      version: 1,
      status: "PASS_REPAIR_COMPONENT",
      controller_role: "AGENTOS_CONTROLLER",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      candidate_sha256: candidate.candidate_sha256,
      activation_sha256: activation.activation_sha256,
      controller_state_sha256: activeState.state_sha256,
      parent_finding_id: "F-GOVERNANCE-EVIDENCE-PLACEHOLDER",
      parent_task_sha256: task.task_sha256,
      feature_agent_task_id: FEATURE_TASK_ID,
      orchestrator_task_id: ORCHESTRATOR_TASK_ID,
      auditor_task_id: AUDITOR_TASK_ID,
      feature_agent_commit: featureReadback.build_commit,
      feature_agent_tree: featureReadback.build_tree,
      orchestrator_session_id: orchestratorReadback.session_id,
      auditor_session_id: auditorReadback.session_id,
      gate_evidence_sha256: controllerDigest(orchestratorPlan.gate_evidence),
      gate_evaluation_sha256: controllerEvaluation.evaluation_sha256,
      auditor_gate_evidence_sha256: controllerDigest(auditorArtifact.audited_gate_evidence),
      external_actions_attempted: false,
      campaign_acceptance: "OPEN_UNTIL_REMAINING_CAMPAIGN_AUDIT_AND_SUPERVISOR_REQUIREMENTS_SETTLE",
      recheck_sha256: null,
    }, "recheck_sha256"));
    record(campaignRoot, "gate-evidence-repair-handoff.json", contentAddressed({
      schema: "agentos.controller_gate_evidence_repair_handoff.v1",
      version: 1,
      status: "REPAIR_RECHECK_PASSED_ACCEPTANCE_STILL_OPEN",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "Intent Regulator",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      candidate_sha256: candidate.candidate_sha256,
      activation_sha256: activation.activation_sha256,
      parent_reconciliation_sha256: activeState.state_sha256,
      repair_task_sha256: task.task_sha256,
      recheck_sha256: recheck.record.recheck_sha256,
      custody: {
        controller: "Intent Regulator routed and re-checked the repair; it did not claim Feature-Agent code completion.",
        feature_agent: {session_id: featureReadback.session_id, commit: featureReadback.build_commit, tree: featureReadback.build_tree},
        auditor: {session_id: auditorReadback.session_id, verified_commit: auditorReadback.build_commit, verified_tree: auditorReadback.build_tree},
      },
      next_action: "Continue with the autonomous Controller supervisor loop and retain the one-shot worker lifecycle finding as the next bounded repair.",
      campaign_active: true,
      external_actions_allowed: false,
      undo: ["Retain the repair evidence and immutable parent audit records.", "Remove only the local repair worktrees and records if the owner later directs undo.", "Do not alter the sterile release copy."],
      handoff_sha256: null,
    }, "handoff_sha256"));
    process.stdout.write(`${JSON.stringify({status: "PASS_REPAIR_COMPONENT", campaign_id: CAMPAIGN_ID, feature_agent: {session_id: featureReadback.session_id, pid: featureReadback.pid, commit: featureReadback.build_commit, tree: featureReadback.build_tree}, orchestrator: {session_id: orchestratorReadback.session_id, pid: orchestratorReadback.pid, evidence_sha256: controllerDigest(orchestratorPlan.gate_evidence)}, auditor: {session_id: auditorReadback.session_id, pid: auditorReadback.pid, verified_commit: auditorReadback.build_commit, verified_tree: auditorReadback.build_tree}, controller_recheck_sha256: recheck.record.recheck_sha256}, null, 2)}\n`);
  } catch (error) {
    compileFailureRca({root: campaignRoot, phase, command: attemptedCommand, error, task, featureReadback, orchestratorReadback, auditorReadback});
    throw error;
  }
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  run(repoRoot).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

export {run};
