#!/usr/bin/env node

/* Real local process/worktree adapter for the AgentOS self-development campaign. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import {compileControllerAdapterReadback} from "./agentos-controller.mjs";
import {LOCAL_WORKER_ROLES} from "./local-campaign-admission.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
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

function canonicalRoot(root) {
  requireString(root, "local runtime repository root");
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local runtime repository root must be a real directory");
  return resolved;
}

function safeChild(root, child) {
  const resolvedRoot = canonicalRoot(root);
  const target = path.resolve(resolvedRoot, child);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "local runtime path escapes the development root");
  return target;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`local runtime git readback failed for git ${args.join(" ")}: ${detail}`);
  }
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assert(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink(), "local runtime record may not be a symlink");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, target);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "local runtime record must be a regular file");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function ensureWorktree({repoRoot, worktreePath, sourceCommit, sourceTree}) {
  const target = safeChild(repoRoot, path.relative(repoRoot, worktreePath));
  if (!fs.existsSync(target)) {
    execFileSync("git", ["-C", repoRoot, "worktree", "add", "--detach", target, sourceCommit], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  const stat = fs.lstatSync(target);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local worker worktree is not a real directory");
  assert(git(target, ["rev-parse", "HEAD"]) === sourceCommit, "local worker worktree commit differs");
  assert(git(target, ["rev-parse", "HEAD^{tree}"]) === sourceTree, "local worker worktree tree differs");
  return target;
}

function validateHandshake(handshake, expected) {
  assert(handshake && typeof handshake === "object" && !Array.isArray(handshake), "local worker handshake is missing");
  assert(handshake.schema === "agentos.local_worker_handshake.v1" && handshake.version === 1, "local worker handshake schema mismatch");
  assert(handshake.status === "COMPLETED", "local worker did not complete");
  for (const field of ["role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "pid", "worktree_path", "source_commit", "source_tree", "build_status", "artifact_path", "artifact_sha256", "observed_at_utc", "handshake_sha256"]) requireString(String(handshake[field]), `local worker handshake ${field}`);
  assert(handshake.role === expected.role && handshake.session_id === expected.sessionId, "local worker role/session identity differs");
  assert(handshake.campaign_id === expected.campaignId && handshake.campaign_version === expected.campaignVersion, "local worker campaign identity differs");
  assert(handshake.candidate_sha256 === expected.candidateSha256, "local worker candidate differs");
  assert(handshake.worktree_path === expected.worktreePath, "local worker worktree differs");
  assert(handshake.source_commit === expected.sourceCommit && handshake.source_tree === expected.sourceTree, "local worker source differs");
  assert(/^\d+$/u.test(handshake.pid) && Number(handshake.pid) > 0, "local worker PID is invalid");
  requireSha(handshake.artifact_sha256, "local worker artifact");
  requireSha(handshake.handshake_sha256, "local worker handshake digest");
  assert(handshake.handshake_sha256 === digestWithout(handshake, "handshake_sha256"), "local worker handshake digest mismatch");
  assert(["NOT_FEATURE_AGENT_BUILD", "COMPLETED", "AUDIT_VERIFIED"].includes(handshake.build_status), "local worker build status is invalid");
  if (expected.role === "FEATURE_AGENT") {
    assert(handshake.build_status === "COMPLETED" && handshake.build_commit !== null && handshake.build_tree !== null, "Feature Agent did not return a real build checkpoint");
    requireGitObject(handshake.build_commit, "Feature Agent build commit");
    requireGitObject(handshake.build_tree, "Feature Agent build tree");
    assert(handshake.build_commit !== expected.sourceCommit && handshake.build_tree !== expected.sourceTree, "Feature Agent build checkpoint did not change source");
    assert(Array.isArray(handshake.changed_paths) && handshake.changed_paths.includes("control/governance-decision-tree.mjs"), "Feature Agent build did not change governance code");
    assert(Array.isArray(handshake.focused_checks) && handshake.focused_checks.length > 0 && typeof handshake.build_checkpoint_sha256 === "string", "Feature Agent build evidence is incomplete");
  }
  if (expected.role === "INDEPENDENT_AUDITOR" && expected.featureWorktree !== null) assert(handshake.build_status === "AUDIT_VERIFIED" && Array.isArray(handshake.changed_paths) && handshake.changed_paths.includes("control/governance-decision-tree.mjs"), "Auditor did not verify the Feature-Agent code change");
  const artifactPath = safeChild(expected.worktreePath, handshake.artifact_path);
  assert(fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile(), "local worker artifact is missing");
  const actualArtifactSha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  assert(actualArtifactSha256 === handshake.artifact_sha256, "local worker artifact readback differs");
  return handshake;
}

function spawnWorker({repoRoot, runtimeRoot, role, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, task, featureWorktree = null, decisionTreePath = null}) {
  assert(LOCAL_WORKER_ROLES.includes(role), `unsupported local worker role: ${role}`);
  requireIdentifier(campaignId, "local worker campaign ID");
  requireString(campaignVersion, "local worker campaign version");
  requireSha(candidateSha256, "local worker candidate");
  requireGitObject(sourceCommit, "local worker source commit");
  requireGitObject(sourceTree, "local worker source tree");
  requireString(task, "local worker task");
  const root = canonicalRoot(repoRoot);
  const runtime = safeChild(root, path.relative(root, runtimeRoot));
  const decisionTree = decisionTreePath === null ? null : safeChild(root, path.relative(root, decisionTreePath));
  if (role === "CAMPAIGN_ORCHESTRATOR") assert(decisionTree !== null && fs.existsSync(decisionTree), "local runtime decision tree adapter is unavailable");
  const runtimeKey = `${campaignId}-${campaignVersion}`.replace(/[^A-Za-z0-9._-]/gu, "_");
  const sessionId = `LOCAL-${role}-${candidateSha256.slice(0, 12)}`;
  const roleKey = role.replaceAll(":", "_");
  const worktreePath = safeChild(runtime, path.join("worktrees", runtimeKey, roleKey));
  const recordPath = safeChild(runtime, path.join("spawn-records", `${roleKey}.json`));
  const existing = readJson(recordPath);
  if (existing !== null) {
    assert(existing.status === "COMPLETED", "local worker spawn record is stale or crashed; repair is required before retry");
    assert(existing.role === role && existing.session_id === sessionId && existing.candidate_sha256 === candidateSha256, "duplicate local worker spawn identity differs");
    return {...existing.readback, reused: true};
  }
  const worktree = ensureWorktree({repoRoot: root, worktreePath, sourceCommit, sourceTree});
  writeJsonAtomic(recordPath, {
    schema: "agentos.local_worker_spawn_record.v1",
    version: 1,
    status: "RUNNING",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    worktree_path: worktree,
    started_at_utc: new Date().toISOString(),
    readback: null,
  });
  const workerScript = new URL("./local-agent-worker.mjs", import.meta.url);
  const workerArgs = [workerScript.pathname, "--role", role, "--session-id", sessionId, "--campaign-id", campaignId, "--campaign-version", campaignVersion, "--candidate-sha256", candidateSha256, "--source-commit", sourceCommit, "--source-tree", sourceTree, "--worktree", worktree, "--task", task];
  if (featureWorktree !== null) workerArgs.push("--feature-worktree", featureWorktree);
  if (decisionTree !== null) workerArgs.push("--decision-tree", decisionTree);
  const result = spawnSync(process.execPath, workerArgs, {
    cwd: worktree,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    writeJsonAtomic(recordPath, {
      schema: "agentos.local_worker_spawn_record.v1",
      version: 1,
      status: "FAILED",
      role,
      session_id: sessionId,
      campaign_id: campaignId,
      campaign_version: campaignVersion,
      candidate_sha256: candidateSha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      worktree_path: worktree,
      started_at_utc: new Date().toISOString(),
      failure: result.error?.message ?? result.stderr ?? `worker exited with ${result.status}`,
      readback: null,
    });
    throw new Error(`local worker ${role} failed: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`);
  }
  const line = result.stdout.trim().split("\n")[0];
  let handshake;
  try {
    handshake = JSON.parse(line);
  } catch (error) {
    writeJsonAtomic(recordPath, {...readJson(recordPath), status: "FAILED", failure: `invalid worker handshake: ${error.message}`});
    throw new Error(`local worker ${role} returned invalid handshake: ${error.message}`);
  }
  validateHandshake(handshake, {role, sessionId, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, worktreePath: worktree, featureWorktree});
  const readback = {
    schema: "agentos.local_worker_spawn_readback.v1",
    version: 1,
    status: "COMPLETED",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    pid: handshake.pid,
    worktree_path: worktree,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    build_status: handshake.build_status,
    build_commit: handshake.build_commit,
    build_tree: handshake.build_tree,
    changed_paths: handshake.changed_paths,
    focused_checks: handshake.focused_checks,
    build_checkpoint_sha256: handshake.build_checkpoint_sha256,
    artifact_path: handshake.artifact_path,
    artifact_sha256: handshake.artifact_sha256,
    exit_code: result.status,
    observed_at_utc: handshake.observed_at_utc,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  writeJsonAtomic(recordPath, {
    schema: "agentos.local_worker_spawn_record.v1",
    version: 1,
    status: "COMPLETED",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    worktree_path: worktree,
    started_at_utc: new Date().toISOString(),
    readback,
  });
  return readback;
}

export function validateLocalWorkerReadback(readback) {
  assert(readback && typeof readback === "object" && !Array.isArray(readback), "local worker readback is required");
  const required = ["schema", "version", "status", "role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "pid", "worktree_path", "source_commit", "source_tree", "build_status", "build_commit", "build_tree", "changed_paths", "focused_checks", "build_checkpoint_sha256", "artifact_path", "artifact_sha256", "exit_code", "observed_at_utc", "readback_sha256"];
  assert(JSON.stringify(Object.keys(readback).sort()) === JSON.stringify([...required].sort()), "local worker readback fields mismatch");
  assert(readback.schema === "agentos.local_worker_spawn_readback.v1" && readback.version === 1 && readback.status === "COMPLETED", "local worker readback identity is invalid");
  assert(LOCAL_WORKER_ROLES.includes(readback.role), "local worker readback role is invalid");
  for (const field of ["session_id", "campaign_id", "campaign_version", "pid", "worktree_path", "source_commit", "source_tree", "artifact_path", "observed_at_utc"]) requireString(readback[field], `local worker readback ${field}`);
  requireSha(readback.candidate_sha256, "local worker readback candidate");
  requireGitObject(readback.source_commit, "local worker readback commit");
  requireGitObject(readback.source_tree, "local worker readback tree");
  assert(["NOT_FEATURE_AGENT_BUILD", "COMPLETED", "AUDIT_VERIFIED"].includes(readback.build_status), "local worker readback build status is invalid");
  assert(readback.build_commit === null || GIT_OBJECT.test(readback.build_commit), "local worker readback build commit is invalid");
  assert(readback.build_tree === null || GIT_OBJECT.test(readback.build_tree), "local worker readback build tree is invalid");
  assert(Array.isArray(readback.changed_paths) && Array.isArray(readback.focused_checks), "local worker readback build evidence is invalid");
  if (readback.role === "FEATURE_AGENT") assert(readback.build_status === "COMPLETED" && readback.build_commit !== null && readback.build_tree !== null && readback.changed_paths.includes("control/governance-decision-tree.mjs") && readback.focused_checks.length > 0 && readback.build_checkpoint_sha256 !== null, "metadata-only Feature Agent readback is not a completed build");
  requireSha(readback.artifact_sha256, "local worker readback artifact");
  assert(readback.exit_code === 0, "local worker readback exit status is not successful");
  requireSha(readback.readback_sha256, "local worker readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "local worker readback digest mismatch");
  return readback;
}

export function createLocalSelfDevelopmentAdapters({repoRoot, runtimeRoot, authorization, admission, candidate, identityBinding, decisionTreePath = null}) {
  requireString(repoRoot, "local adapter repository root");
  requireString(runtimeRoot, "local adapter runtime root");
  assert(authorization?.permissions?.local_worker_agent_spawns_allowed === true, "local adapter lacks worker-spawn authorization");
  assert(authorization?.permissions?.product_agent_spawns_allowed === false, "local adapter cannot spawn Product agents");
  let featureWorkerReadback = null;
  const spawn = (role, context, task, featureWorktree = null) => {
    const readback = spawnWorker({
      repoRoot,
      runtimeRoot,
      role,
      campaignId: candidate.campaign_id,
      campaignVersion: candidate.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: candidate.source_commit,
      sourceTree: candidate.source_tree,
      task,
      featureWorktree,
      decisionTreePath,
    });
    validateLocalWorkerReadback(readback);
    return compileControllerAdapterReadback({
      operation: context.operation,
      actionId: context.action_id,
      eventId: context.event.event_id,
      controllerId: context.controller_state.logical_controller_id,
      projectId: context.controller_state.project_id,
      policyEpoch: context.controller_state.policy_epoch,
      policyStateSha256: context.controller_state.policy_state_sha256,
      campaignId: candidate.campaign_id,
      externalIdentity: `LOCAL_PROCESS:${readback.pid}:${readback.session_id}`,
      observedAtUtc: readback.observed_at_utc,
      details: {session_id: readback.session_id, worker_readback: readback},
    });
  };
  const adapter = {
    admitLocalSelfDevelopment: (context) => {
      assert(context.payload.authorization.authorization_sha256 === authorization.authorization_sha256, "local admission authorization differs");
      assert(context.payload.admission.admission_sha256 === admission.admission_sha256, "local admission record differs");
      assert(context.payload.candidate.candidate_sha256 === candidate.candidate_sha256, "local admission candidate differs");
      assert(context.payload.identity_binding.binding_sha256 === identityBinding.binding_sha256, "local admission identity differs");
      return compileControllerAdapterReadback({
        operation: context.operation,
        actionId: context.action_id,
        eventId: context.event.event_id,
        controllerId: context.controller_state.logical_controller_id,
        projectId: context.controller_state.project_id,
        policyEpoch: context.controller_state.policy_epoch,
        policyStateSha256: context.controller_state.policy_state_sha256,
        campaignId: candidate.campaign_id,
        externalIdentity: `LOCAL_ADMISSION:${admission.admission_sha256.slice(0, 16)}`,
        observedAtUtc: context.event.occurred_at_utc,
        details: {
          status: "CAMPAIGN_ADMITTED",
          admission_sha256: admission.admission_sha256,
          authorization_sha256: authorization.authorization_sha256,
          candidate_sha256: candidate.candidate_sha256,
          identity_binding_sha256: identityBinding.binding_sha256,
        },
      });
    },
    spawnCampaignOrchestrator: (context) => spawn("CAMPAIGN_ORCHESTRATOR", context, "Coordinate this local AgentOS self-development campaign through the executable four-root governance tree."),
    spawnIndependentAuditor: (context) => spawn("INDEPENDENT_AUDITOR", context, "Audit the actual local Feature-Agent changed tree and exact build evidence.", featureWorkerReadback?.worktree_path ?? null),
    spawnFeatureAgents: (context) => {
      const readback = spawn("FEATURE_AGENT", context, "Own the bounded code repair for the executable four-root governance tree and local admission bridge in the isolated worktree.");
      featureWorkerReadback = readback.details.worker_readback;
      return compileControllerAdapterReadback({
        operation: context.operation,
        actionId: context.action_id,
        eventId: context.event.event_id,
        controllerId: context.controller_state.logical_controller_id,
        projectId: context.controller_state.project_id,
        policyEpoch: context.controller_state.policy_epoch,
        policyStateSha256: context.controller_state.policy_state_sha256,
        campaignId: candidate.campaign_id,
        externalIdentity: `LOCAL_PROCESS:${readback.details.worker_readback.pid}:${readback.details.session_id}`,
        observedAtUtc: readback.observed_at_utc,
        details: {
          session_id: readback.details.session_id,
          worker_readback: readback.details.worker_readback,
          feature_agent_session_ids: [readback.details.session_id],
          worker_readbacks: [readback.details.worker_readback],
        },
      });
    },
  };
  return adapter;
}

export {spawnWorker};
