#!/usr/bin/env node

/*
 * One explicit local start transition for the AgentOS self-development campaign.
 * It is intentionally not a generic delivery path: campaign roles require the
 * host's true session tools, while every external side effect remains disabled
 * and every worker must return a real readback.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {
  applyAndWriteAgentOSControllerEvent,
  applyAndWriteAgentOSControllerEventAsync,
  compileAgentOSControllerState,
  compileControllerEvent,
  compileControllerRuntimeReadback,
  compileControllerCampaignCandidate,
  controllerDigest,
  writeAgentOSControllerStateCompareAndSwap,
} from "./agentos-controller.mjs";
import {compileGlobalPolicyState} from "./global-policy-state.mjs";
import {
  compileGovernanceDecisionTree,
  validateGovernanceDecisionTree,
} from "./governance-decision-tree.mjs";
import {
  compileLocalCampaignActivation,
  compileLocalCampaignAdmission,
  compileLocalCampaignIdentityBinding,
  compileLocalDevelopmentAuthorization,
  validateLocalCampaignActivation,
  validateLocalCampaignAdmission,
  validateLocalCampaignIdentityBinding,
  validateLocalDevelopmentAuthorization,
  validateLocalStartTransition,
  writeLocalCampaignRecord,
} from "./local-campaign-admission.mjs";
import {createLocalSelfDevelopmentAdapters, validateLocalWorkerReadback} from "./local-agent-runtime.mjs";
import {createNativeSelfDevelopmentAdapters} from "./native-self-development-adapter.mjs";
import {redactPersistedRecord, redactPersistedText} from "./persisted-record-privacy.mjs";

const HANDOFF_RECORDS = Object.freeze({
  parentPacket: "audit-packet.json",
  parentAddendum: "audit-handoff-addendum.json",
  staleApproval: "approval-packet.json",
  staleStatus: "campaign-status.json",
});
const CAMPAIGN_ID = "CAMPAIGN-AGENTOS-SELF-DEVELOPMENT-1";
const CAMPAIGN_VERSION = "v3.0.0-tb-01";
const PROJECT_ID = "agentos-self-development";
const CONTROLLER_ID = "AGENTOS-CONTROLLER-SELF-DEVELOPMENT-1";
const RUNTIME_ID = "AGENTOS-LOCAL-SELF-DEVELOPMENT-RUNTIME-1";
const CONTROLLER_RUNTIME_ID = "AGENTOS-LOCAL-SELF-DEVELOPMENT-CONTROLLER-RUNTIME-1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function throwTyped(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function canonicalRoot(root) {
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local start repository root must be a real directory");
  return resolved;
}

function pathWithin(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function parseLocalStartArgs(argv = []) {
  assert(Array.isArray(argv), "local start arguments must be an array");
  let repoRoot = null;
  let bootstrapHandoffRoot = null;
  let runtimeAuthorityRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--bootstrap-handoff-root") {
      assert(bootstrapHandoffRoot === null, "local start bootstrap handoff root was supplied more than once");
      bootstrapHandoffRoot = argv[++index];
      assert(typeof bootstrapHandoffRoot === "string" && bootstrapHandoffRoot.length > 0, "--bootstrap-handoff-root needs a directory");
    } else if (value === "--runtime-authority-root") {
      assert(runtimeAuthorityRoot === null, "local start runtime authority root was supplied more than once");
      runtimeAuthorityRoot = argv[++index];
      assert(typeof runtimeAuthorityRoot === "string" && runtimeAuthorityRoot.length > 0, "--runtime-authority-root needs a directory");
    } else if (value.startsWith("--")) {
      throw new Error(`UNKNOWN_LOCAL_START_ARGUMENT: ${value}`);
    } else {
      assert(repoRoot === null, "local start repository root was supplied more than once");
      repoRoot = value;
    }
  }
  if (bootstrapHandoffRoot === null) throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_REQUIRED", "supply --bootstrap-handoff-root from the typed Bootstrap handoff");
  return Object.freeze({repoRoot: repoRoot ?? process.cwd(), bootstrapHandoffRoot, runtimeAuthorityRoot});
}

export function resolveLocalStartInputs({repoRoot, bootstrapHandoffRoot}) {
  const canonicalRepoRoot = canonicalRoot(repoRoot);
  if (typeof bootstrapHandoffRoot !== "string" || bootstrapHandoffRoot.length === 0) {
    throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_REQUIRED", "Bootstrap must supply an external handoff directory");
  }
  let handoffRoot;
  try {
    handoffRoot = canonicalRoot(bootstrapHandoffRoot);
  } catch (error) {
    throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_INVALID", error?.message ?? String(error));
  }
  if (pathWithin(canonicalRepoRoot, handoffRoot)) {
    throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_INVALID", "the Bootstrap handoff must remain outside the AgentOS repository");
  }
  const paths = Object.fromEntries(Object.entries(HANDOFF_RECORDS).map(([key, fileName]) => {
    const target = path.resolve(handoffRoot, fileName);
    if (!pathWithin(handoffRoot, target)) throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_INVALID", `${key} escapes the handoff directory`);
    return [key, target];
  }));
  const missing = Object.entries(paths).filter(([, target]) => !fs.existsSync(target)).map(([key]) => key);
  if (missing.length > 0) throwTyped("MISSING_RETAINED_INPUTS", `Bootstrap handoff is missing ${missing.join(", ")}; provide the four typed records in ${handoffRoot}`);
  for (const [key, target] of Object.entries(paths)) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throwTyped("AGENTOS_BOOTSTRAP_HANDOFF_INVALID", `${key} is not a regular file`);
  }
  return Object.freeze({repoRoot: canonicalRepoRoot, handoffRoot, ...paths});
}

function resolveRuntimeAuthorityRoot({repoRoot, handoffRoot, requestedRoot = null}) {
  const candidate = requestedRoot
    ?? process.env.AGENTOS_RUNTIME_ROOT
    ?? path.join(handoffRoot, "agentos-runtime");
  requireString(candidate, "local start runtime authority root");
  assert(path.isAbsolute(candidate), "local start runtime authority root must be absolute");
  fs.mkdirSync(candidate, {recursive: true, mode: 0o700});
  const authorityRoot = canonicalRoot(candidate);
  assert(!pathWithin(repoRoot, authorityRoot), "local start runtime authority must remain outside the AgentOS repository");
  return authorityRoot;
}

function readJson(filePath) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `local start record is not a regular file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function contentAddressed(record, field) {
  const result = structuredClone(record);
  result[field] = null;
  result[field] = controllerDigest(result);
  return result;
}

export function localStartEventId(sourceCommit) {
  assert(typeof sourceCommit === "string" && sourceCommit.length >= 12, "local start source commit is incomplete");
  return `LOCAL-SELF-DEVELOPMENT-AUTHORIZED-${sourceCommit.slice(0, 12).toUpperCase()}`;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const failure = new Error(`git command failed; command_ref:${controllerDigest({program: "git", args})}; error_ref:opaque:error:${controllerDigest(stderr || error.message)}`);
    failure.code = "LOCAL_GIT_COMMAND_FAILED";
    throw failure;
  }
}

function writeRecord(root, fileName, record, validate = (value) => value) {
  return writeLocalCampaignRecord({root, fileName, record, validate});
}

function compileNativeCampaignActivation({admission, authorization, identityBinding, candidate, spawnReadbacks, controllerStateSha256, startedAtUtc, hostAttachment}) {
  assert(Array.isArray(spawnReadbacks) && spawnReadbacks.length >= 3, "native campaign activation requires the admitted native roster");
  const roles = spawnReadbacks.map((readback) => readback.role).sort();
  assert(roles.includes("CAMPAIGN_ORCHESTRATOR") && roles.includes("INDEPENDENT_AUDITOR") && roles.includes("FEATURE_AGENT"), "native campaign activation roster is incomplete");
  const sessionIds = spawnReadbacks.map((readback) => readback.session_id);
  assert(sessionIds.every((value) => typeof value === "string" && value.length > 0) && new Set(sessionIds).size === sessionIds.length, "native campaign activation session identities are invalid");
  for (const readback of spawnReadbacks) {
    assert(readback.campaign_id === candidate.campaign_id && readback.campaign_version === candidate.campaign_version, "native activation worker campaign differs");
    assert(readback.project_id === candidate.project_id && readback.source_commit === candidate.source_commit && readback.source_tree === candidate.source_tree, "native activation worker source differs");
    assert(readback.status === "ACTIVE" && readback.pinned === true && readback.archived === false, "native activation worker is not active and pinned");
  }
  const activation = contentAddressed({
    schema: "agentos.native_campaign_activation.v1",
    version: 1,
    status: "CAMPAIGN_ACTIVE",
    controller_role: "AGENTOS_CONTROLLER",
    host_attachment_sha256: hostAttachment.digest,
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    source_commit: candidate.source_commit,
    source_tree: candidate.source_tree,
    controller_candidate_sha256: candidate.candidate_sha256,
    authorization_sha256: authorization.authorization_sha256,
    admission_sha256: admission.admission_sha256,
    identity_binding_sha256: identityBinding.binding_sha256,
    permissions: structuredClone(authorization.permissions),
    worker_roles: roles,
    spawn_readbacks: structuredClone(spawnReadbacks),
    controller_state_sha256: controllerStateSha256,
    started_at_utc: startedAtUtc,
    active_campaign: true,
    protected_actions: {
      published: false,
      pushed: false,
      merged: false,
      deployed: false,
      revealed_secrets: false,
      product_writes: false,
    },
    activation_sha256: null,
  }, "activation_sha256");
  return activation;
}

function validateParentEvidence(parentPacket, parentAddendum) {
  assert(parentPacket.packet_sha256 === digestWithout(parentPacket, "packet_sha256"), "retained parent audit packet digest is invalid");
  assert(parentAddendum.addendum_sha256 === digestWithout(parentAddendum, "addendum_sha256"), "retained parent audit addendum digest is invalid");
  assert(parentPacket.status.current_commit === parentAddendum.source_checkpoint.commit, "retained audit packet/addendum commit differs");
  assert(parentPacket.status.current_tree === parentAddendum.source_checkpoint.tree, "retained audit packet/addendum tree differs");
}

function compileStaleCandidateRejection({staleApproval, staleStatus, sourceCommit, sourceTree, nowUtc, parentPacketSha256, parentAddendumSha256}) {
  const rejected = {
    schema: "agentos.anti_drift_candidate_rejection.v1",
    version: 1,
    status: "REJECTED_STALE_NOT_ADMITTED",
    controller_role: "AGENTOS_CONTROLLER",
    observed_at_utc: nowUtc,
    observed_source_commit: sourceCommit,
    observed_source_tree: sourceTree,
    stale_packet: {
      approval_packet_sha256: staleApproval.approval_packet_sha256,
      candidate_sha256: staleApproval.candidate_sha256,
      project_id: staleApproval.project_id,
      campaign_id: staleApproval.exact_candidate?.source_binding?.current_campaign_id ?? "CAMPAIGN-OWNER-REVIEW-1",
      owner_intent: staleApproval.exact_candidate?.owner_intent?.desired_outcome ?? null,
      candidate_status: staleApproval.exact_candidate?.candidate_status ?? null,
      approval_state: staleApproval.approval_state,
      active_campaign: staleApproval.exact_candidate?.active_campaign ?? staleStatus.active_campaign,
      product_writes_allowed: staleApproval.exact_candidate?.product_writes_allowed ?? false,
      product_agent_spawns_allowed: staleApproval.exact_candidate?.product_agent_spawns_allowed ?? false,
      release_stop: staleApproval.release_stop,
    },
    rejection_reasons: [
      "The candidate is bound to synthetic-project instead of AgentOS self-development.",
      "The candidate carries the old generic owner intent instead of the current local self-development authorization.",
      "The candidate is CANDIDATE_ONLY with PENDING_EXACT_APPROVAL and cannot be promoted by the local start event.",
      "The candidate keeps local worker spawning and Product writes disabled and stops before admission/publication/deployment.",
      "Source rebinding alone cannot rebind changed owner intent, project identity, or local-development permissions.",
    ].sort(),
    stale_status_readback: structuredClone(staleStatus),
    linked_findings: [
      "F-REAL-WORKER-EXECUTION",
      "F-CONTROLLER-ADMISSION",
      "F-CONTROLLER-ENFORCEMENT",
      "F-ANTI-DRIFT-CANDIDATE",
    ].sort(),
    parent_audit_packet_sha256: parentPacketSha256,
    parent_audit_addendum_sha256: parentAddendumSha256,
    admission_allowed: false,
    spawn_allowed: false,
    rca: {
      classification: "REPAIRABLE_ENGINEERING_PUZZLE",
      route: "COMPILE_FRESH_CURRENT_SOURCE_CANDIDATE_AND_BOUNDARY",
      required_recheck: "Fresh AgentOS self-development candidate, authorization, identity binding, admission, and real worker readbacks must validate together.",
    },
    rejection_sha256: null,
  };
  rejected.rejection_sha256 = digestWithout(rejected, "rejection_sha256");
  return rejected;
}

function compileStallRca({sourceCommit, sourceTree, parentAuditPacketSha256, parentAuditAddendumSha256, nowUtc}) {
  return contentAddressed({
    schema: "agentos.anti_drift_stall_rca.v1",
    version: 1,
    status: "RETAINED_BEFORE_START",
    controller_role: "AGENTOS_CONTROLLER",
    observed_at_utc: nowUtc,
    observed_source_commit: sourceCommit,
    observed_source_tree: sourceTree,
    symptom: "Valid local self-development consent existed, but no campaign activation, spawn record, or worker readback had been produced.",
    observed_state: {
      active_campaign: false,
      controller_status: "PREPARED_NOT_ACTIVATED",
      approval_state: "PENDING_EXACT_APPROVAL",
      local_start_event: "MISSING",
      orchestrator_spawn_record: "MISSING",
      auditor_spawn_record: "MISSING",
      feature_agent_spawn_record: "MISSING",
      worker_readbacks: "MISSING",
    },
    required_immediate_action: [
      "Run only focused syntax and hostile checks for the minimum local bridge.",
      "Bind the current source to the already-recorded local owner authorization.",
      "Invoke the local campaign start event and require three real process readbacks.",
      "Hand the bounded code repair to the Feature Agent after verified spawn.",
      "Stop and retain the exact command and error if a worker or adapter is unavailable.",
    ],
    linked_findings: ["F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"],
    parent_audit_packet_sha256: parentAuditPacketSha256,
    parent_audit_addendum_sha256: parentAuditAddendumSha256,
    rca_sha256: null,
  }, "rca_sha256");
}

function localFailureRca({campaignRoot, error, phase, sourceCommit = null, sourceTree = null, nowUtc, attemptedCommand = null}) {
  const spawnFailures = [];
  const recordsRoot = path.join(campaignRoot, "spawn-records");
  if (fs.existsSync(recordsRoot)) {
    for (const name of fs.readdirSync(recordsRoot).sort()) {
      const filePath = path.join(recordsRoot, name);
      try {
        const record = readJson(filePath);
        if (record.status === "FAILED") spawnFailures.push(record);
      } catch (readError) {
        spawnFailures.push({file: name, readback_error: readError.message});
      }
    }
  }
  const redactText = (value, fallback = "UNAVAILABLE") => {
    if (value === null || value === undefined) return fallback;
    try {
      return redactPersistedText(String(value)).text;
    } catch {
      return `opaque:error:${controllerDigest(String(value))}`;
    }
  };
  const redactRecord = (value) => {
    try {
      return redactPersistedRecord(value).record;
    } catch {
      return {status: "REDACTED", value_sha256: controllerDigest(value)};
    }
  };
  return contentAddressed({
    schema: "agentos.local_campaign_start_failure_rca.v1",
    version: 1,
    status: "HARD_UNAVAILABLE_BLOCKER",
    controller_role: "AGENTOS_CONTROLLER",
    phase,
    observed_at_utc: nowUtc,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    failed_command: redactText(attemptedCommand, "LOCAL_START").slice(0, 500),
    failure_code: error?.code ?? "LOCAL_START_FAILED",
    error_message_exact: redactText(error?.message ?? String(error)).slice(0, 2000),
    error_stack: error?.stack === undefined ? null : redactText(error.stack).slice(0, 4000),
    spawn_failures: spawnFailures.map(redactRecord),
    required_response: "Stop the start sequence, repair or provide the missing local adapter, then rerun from a fresh exact current-source binding.",
    external_actions_attempted: false,
    rca_sha256: null,
  }, "rca_sha256");
}

export function compileLocalStartOutcome(error) {
  const code = typeof error?.code === "string" && error.code.length > 0
    ? error.code
    : "LOCAL_START_FAILED";
  const unavailableCodes = new Set([
    "AGENTOS_BOOTSTRAP_HANDOFF_REQUIRED",
    "MISSING_RETAINED_INPUTS",
    "AGENTOS_BOOTSTRAP_HANDOFF_INVALID",
    "NATIVE_SESSION_TOOLING_REQUIRED",
    "NATIVE_SESSION_TOOLING_UNAVAILABLE",
    "NATIVE_HOST_ATTACHMENT_REQUIRED",
    "NATIVE_HOST_ATTACHMENT_INVALID",
    "HOST_MODEL_REASONING_READBACK_UNAVAILABLE",
    "PROJECT_BINDING_REQUIRED",
  ]);
  return {
    schema: "agentos.local_start_outcome.v1",
    status: unavailableCodes.has(code) ? "UNAVAILABLE" : "HARD_STOP",
    code,
    started: false,
    external_actions_attempted: false,
    message: unavailableCodes.has(code)
      ? "The local campaign did not start because a required setup item or host capability is unavailable."
      : "The local campaign stopped before it could start. Review the retained failure record before trying again.",
  };
}

async function main(argv = process.argv.slice(2), options = {}) {
  throw Object.assign(new Error("Legacy local self-development start is retired; governed Bootstrap may start only one Spawner"), {code: "RETIRED_ROLE_AUTHORITY_FORBIDDEN"});
  const nativeMode = options.nativeHost !== undefined || options.host !== undefined || options.hostAttachment !== undefined;
  if (nativeMode) {
    assert(options.nativeHost ?? options.host, "native start requires the in-process Codex host adapter");
    assert(options.hostAttachment, "native start requires a bound host attachment");
  }
  const args = parseLocalStartArgs(argv);
  const repoRoot = canonicalRoot(args.repoRoot);
  assert(repoRoot === canonicalRoot(process.cwd()), "local start must run from the writable development copy");
  assert(fs.existsSync(path.join(repoRoot, ".git")), "local start repository is not a Git development copy");
  const nowUtc = new Date().toISOString();
  let campaignRoot = null;
  let phase = "INITIALIZE";
  let attemptedCommand = null;
  let sourceCommit = null;
  let sourceTree = null;
  let inputs = null;

  try {
    phase = "READ_RETAINED_AUDIT";
    inputs = resolveLocalStartInputs({repoRoot, bootstrapHandoffRoot: args.bootstrapHandoffRoot});
    const authorityRoot = resolveRuntimeAuthorityRoot({repoRoot, handoffRoot: inputs.handoffRoot, requestedRoot: args.runtimeAuthorityRoot});
    campaignRoot = path.join(authorityRoot, "campaigns", CAMPAIGN_ID);
    fs.mkdirSync(campaignRoot, {recursive: true, mode: 0o700});
    const parentPacket = readJson(inputs.parentPacket);
    const parentAddendum = readJson(inputs.parentAddendum);
    validateParentEvidence(parentPacket, parentAddendum);
    const parentAuditPacketSha256 = parentPacket.packet_sha256;
    const parentAuditAddendumSha256 = parentAddendum.addendum_sha256;
    sourceCommit = git(repoRoot, ["rev-parse", "HEAD"]);
    sourceTree = git(repoRoot, ["rev-parse", "HEAD^{tree}"]);
    assert(sourceCommit !== parentPacket.status.current_commit || sourceTree !== parentPacket.status.current_tree, "fresh local campaign source did not advance from the frozen audit checkpoint");
    assert(git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]) === "", "local start requires a clean committed bridge checkpoint");

    phase = "RETAIN_ANTI_DRIFT_EVIDENCE";
    const staleApproval = readJson(inputs.staleApproval);
    const staleStatus = readJson(inputs.staleStatus);
    const staleRejection = compileStaleCandidateRejection({staleApproval, staleStatus, sourceCommit, sourceTree, nowUtc, parentPacketSha256: parentAuditPacketSha256, parentAddendumSha256: parentAuditAddendumSha256});
    const stallRca = compileStallRca({sourceCommit, sourceTree, parentAuditPacketSha256, parentAuditAddendumSha256, nowUtc});
    writeRecord(campaignRoot, "anti-drift-register.json", contentAddressed({
      schema: "agentos.controller_anti_drift_register.v1",
      version: 1,
      controller_role: "AGENTOS_CONTROLLER",
      source_commit: sourceCommit,
      source_tree: sourceTree,
      retained_records: [staleRejection, stallRca],
      open_findings: ["F-ANTI-DRIFT-CANDIDATE", "F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"].sort(),
      status: "OPEN_UNTIL_REAL_START_AND_SUPERVISION_EVIDENCE",
      register_sha256: null,
    }, "register_sha256"));
    writeRecord(campaignRoot, "stale-candidate-rejection.json", staleRejection);
    writeRecord(campaignRoot, "stall-rca.json", stallRca);

    phase = "COMPILE_CURRENT_OWNER_INTENT_AND_BOUNDARY";
    const ownerIntent = contentAddressed({
      schema: "agentos.agentos_self_development_owner_intent.v1",
      version: 1,
      source: "OWNER_EXISTING_CONSENT",
      project_id: PROJECT_ID,
      owner_decision: "START_LOCAL_AGENTOS_SELF_DEVELOPMENT",
      goal: "Run AgentOS as an all-in-one system that turns complicated development into casual conversations and lets agents build from those conversations.",
      current_run: "Build and audit AgentOS itself in the writable development copy through a local governed campaign.",
      controller_role: "Controller",
      role_custody: {
        controller: "Supervise, compare intent with actual events and evidence, classify drift, and enforce re-checks.",
        orchestrator: "Coordinate the bounded campaign and traverse the executable four-root governance tree.",
        auditor: "Independently inspect the Feature-Agent changed tree and evidence.",
        feature_agent: "Own the actual bounded code repair in an isolated worktree.",
      },
      decision_tree_requirement: "FUNCTIONALITY, DESIGN_UI_SHELL_NAVIGATION, CODE_QUALITY_HYGIENE, then SECURITY; YES requires evidence and sub-gates; NO requires classification, repair path, and exact re-check.",
      parent_audit_packet_sha256: parentAuditPacketSha256,
      parent_audit_addendum_sha256: parentAuditAddendumSha256,
      protected_external_actions: ["deployment", "release", "publication", "push", "merge", "secrets", "destructive_work"].sort(),
      deferred_candidates: ["direct Feature-Agent targeting", "optional parallel development schemes"].sort(),
      owner_intent_sha256: null,
    }, "owner_intent_sha256");
    const scope = contentAddressed({
      schema: "agentos.local_self_development_scope.v1",
      version: 1,
      project_id: PROJECT_ID,
      allowed_root_kind: "WRITABLE_DEVELOPMENT_COPY",
      allowed_work: ["AgentOS control-plane code", "schemas", "tests", "documentation", "isolated local worker worktrees"].sort(),
      changed_paths: [
        "control/agentos-controller.mjs",
        "control/governance-decision-tree.mjs",
        "control/local-agent-runtime.mjs",
        "control/local-agent-worker.mjs",
        "control/local-campaign-admission.mjs",
        "control/start-local-self-development.mjs",
        "schemas/agentos-controller.v1.json",
        "tests/verify-governance-decision-tree.mjs",
        "tests/verify-local-campaign-admission.mjs",
        "tests/verify-local-agent-runtime.mjs",
      ].sort(),
      excluded_work: ["Product code", "Product agents", "external deployment", "release", "publication", "push", "merge", "sterile-copy changes", "secrets", "destructive work"].sort(),
      local_worker_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"].sort(),
      scope_sha256: null,
    }, "scope_sha256");
    const decisionTree = compileGovernanceDecisionTree({
      sourceCommit,
      sourceTree,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      scopeSha256: scope.scope_sha256,
      featureFiles: scope.changed_paths,
    });
    validateGovernanceDecisionTree(decisionTree);
    const decisionTreeRequirement = contentAddressed({
      schema: "agentos.executable_decision_tree_requirement.v1",
      version: 1,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      scope_sha256: scope.scope_sha256,
      decision_tree_sha256: decisionTree.tree_sha256,
      ordered_roots: decisionTree.ordered_roots,
      yes_rule: decisionTree.yes_rule,
      no_rule: decisionTree.no_rule,
      ambiguity_rule: decisionTree.ambiguity_rule,
      linked_findings: ["F-REAL-WORKER-EXECUTION", "F-CONTROLLER-ADMISSION", "F-CONTROLLER-ENFORCEMENT"].sort(),
      decision_tree_requirement_sha256: null,
    }, "decision_tree_requirement_sha256");
    const policy = compileGlobalPolicyState({
      projectId: PROJECT_ID,
      values: {
        "CAMPAIGN.MODE": "STANDARD_SUBSTANTIAL",
        "PROJECT.NORTH_STAR": "AgentOS turns complicated development into casual conversations and lets agents build from those conversations.",
        "PROJECT.FIRST_USEFUL_WORKFLOW": "The Controller starts one local AgentOS campaign, the Feature Agent makes a bounded code repair, and the Auditor verifies it.",
        "PROJECT.ASSURANCE_CLASS": "LIMITED_PRODUCT",
        "REVIEW.USER_REVIEW_MODE": "RECOMMENDED",
        "REVIEW.APPROVAL_ROUTE": "DIRECT_AGENTOS_CONFIRMATION",
      },
      nowUtc,
      timeBasis: "OBSERVED_UTC",
    });
    const modelPlan = contentAddressed({
      schema: "agentos.local_self_development_model_plan.v1",
      version: 1,
      project_id: PROJECT_ID,
      worker_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"].sort(),
      execution_adapter: nativeMode ? "CODEX_NATIVE_SESSION_HOST" : "LOCAL_NODE_PROCESS_AND_GIT_WORKTREE",
      real_spawn_requirements: ["PID", "session", "isolated worktree", "source commit/tree", "handshake", "artifact", "readback"].sort(),
      feature_agent_completion_requirements: ["actual code change", "focused checks", "changed commit/tree", "Auditor verification"].sort(),
      model_plan_sha256: null,
    }, "model_plan_sha256");
    const acceptance = contentAddressed({
      schema: "agentos.local_self_development_acceptance.v1",
      version: 1,
      project_id: PROJECT_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      policy_epoch: policy.policy_epoch,
      policy_state_sha256: policy.policy_state_sha256,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      decision_tree_requirement_sha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      scope_sha256: scope.scope_sha256,
      required_evidence: ["fresh current-source candidate", "identity binding", "admission", "three real worker readbacks", "Feature-Agent changed checkpoint", "Auditor verification", "atomic JSON readback"].sort(),
      non_goals: ["external side effects", "Product work", "release readiness"].sort(),
      stop_conditions: ["Any identity, scope, intent, evidence, source, or boundary mismatch.", "Any unavailable or fake local adapter.", "Any missing or metadata-only worker build."].sort(),
      acceptance_sha256: null,
    }, "acceptance_sha256");
    writeRecord(campaignRoot, "owner-intent.json", ownerIntent);
    writeRecord(campaignRoot, "scope.json", scope);
    writeRecord(campaignRoot, "decision-tree.json", decisionTree, validateGovernanceDecisionTree);
    writeRecord(campaignRoot, "decision-tree-requirement.json", decisionTreeRequirement);
    writeRecord(campaignRoot, "policy-state.json", policy);
    writeRecord(campaignRoot, "model-plan.json", modelPlan);
    writeRecord(campaignRoot, "acceptance-contract.json", acceptance);

    phase = "COMPILE_CURRENT_CANDIDATE_AUTHORIZATION_AND_ADMISSION";
    const authorization = compileLocalDevelopmentAuthorization({
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      sourceCommit,
      sourceTree,
      parentAuditPacketSha256,
      parentAuditAddendumSha256,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      decisionTreeRequirementSha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      acceptanceContractSha256: acceptance.acceptance_sha256,
      modelPlanSha256: modelPlan.model_plan_sha256,
      scopeSha256: scope.scope_sha256,
      recordedFrom: "NICK_CURRENT_LOCAL_SELF_DEVELOPMENT_AUTHORIZATION",
    });
    const candidate = compileControllerCampaignCandidate({
      projectId: PROJECT_ID,
      campaignId: CAMPAIGN_ID,
      campaignVersion: CAMPAIGN_VERSION,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      ownerIntentSha256: ownerIntent.owner_intent_sha256,
      acceptanceContractSha256: acceptance.acceptance_sha256,
      modelPlanSha256: modelPlan.model_plan_sha256,
      scopeSha256: scope.scope_sha256,
      sourceCommit,
      sourceTree,
    });
    const auditCandidate = {
      candidate_id: parentPacket.candidate.candidate_id,
      candidate_sha256: parentPacket.candidate.candidate_sha256,
      commit: parentPacket.candidate.commit,
      tree: parentPacket.candidate.tree,
    };
    const identityBinding = compileLocalCampaignIdentityBinding({
      authorization,
      candidate,
      auditCandidate,
      auditCampaignVersion: parentPacket.campaign_version,
      auditPlanSha256: parentPacket.audit_plan.plan_sha256,
      auditReconciliationSha256: parentPacket.reconciliation.reconciliation_sha256,
      parentAuditPacketSha256,
      parentAuditAddendumSha256,
    });
    const admission = compileLocalCampaignAdmission({authorization, candidate, identityBinding, nowUtc});
    validateLocalStartTransition({authorization, admission});
    writeRecord(campaignRoot, "authorization.json", authorization, validateLocalDevelopmentAuthorization);
    writeRecord(campaignRoot, "candidate.json", candidate);
    writeRecord(campaignRoot, "identity-binding.json", identityBinding, validateLocalCampaignIdentityBinding);
    writeRecord(campaignRoot, "admission.json", admission, validateLocalCampaignAdmission);

    phase = "INITIALIZE_CONTROLLER_STATE";
    const controllerSessionId = `AGENTOS-CONTROLLER-SESSION-${sourceCommit.slice(0, 12)}`;
    const capabilitySetSha256 = controllerDigest({adapter: nativeMode ? "CODEX_NATIVE_SESSION_HOST" : "LOCAL_NODE_PROCESS_AND_GIT_WORKTREE", roles: authorization.worker_roles, root_kind: "WRITABLE_DEVELOPMENT_COPY"});
    const runtimeReadback = compileControllerRuntimeReadback({
      projectId: PROJECT_ID,
      controllerRuntimeId: CONTROLLER_RUNTIME_ID,
      runtimeId: RUNTIME_ID,
      environmentIdentity: "LOCAL_DEVELOPMENT_COPY",
      capabilitySetSha256,
      observedBySession: controllerSessionId,
      observedAtUtc: nowUtc,
    });
    const initialState = compileAgentOSControllerState({
      projectId: PROJECT_ID,
      logicalControllerId: CONTROLLER_ID,
      currentSessionId: controllerSessionId,
      policyState: policy,
      controllerRuntimeReadback: runtimeReadback,
      nowUtc,
    });
    writeRecord(campaignRoot, "runtime-readback.json", runtimeReadback);
    writeRecord(campaignRoot, "controller-state-before-start.json", initialState);
    const controllerStatePath = "controller-state.json";
    writeAgentOSControllerStateCompareAndSwap({authorityRoot: campaignRoot, statePath: controllerStatePath, expectedStateSha256: null, state: initialState});

    phase = "START_LOCAL_CAMPAIGN_WITH_REAL_WORKERS";
    attemptedCommand = nativeMode ? "CODEX_NATIVE_SESSION_HOST_CAMPAIGN_START" : "LOCAL_CAMPAIGN_START";
    const decisionTreePath = path.join(campaignRoot, "decision-tree.json");
    const adapters = nativeMode
      ? createNativeSelfDevelopmentAdapters({
        host: options.nativeHost ?? options.host,
        hostAttachment: options.hostAttachment,
        authorization,
        admission,
        candidate,
        identityBinding,
        projectBinding: options.projectBinding ?? null,
        schedulerRoot: path.join(campaignRoot, "scheduler-authority"),
        now: () => new Date().toISOString(),
      })
      : createLocalSelfDevelopmentAdapters({repoRoot, runtimeRoot: campaignRoot, authorization, admission, candidate, identityBinding, decisionTreePath});
    const event = compileControllerEvent({
      eventId: localStartEventId(sourceCommit),
      eventType: "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
      sourceRole: "AGENTOS_CONTROLLER",
      controllerId: CONTROLLER_ID,
      projectId: PROJECT_ID,
      policyEpoch: policy.policy_epoch,
      policyStateSha256: policy.policy_state_sha256,
      campaignId: CAMPAIGN_ID,
      sequence: 1,
      priorControllerHeadSha256: null,
      payload: {authorization, admission, candidate, identity_binding: identityBinding},
      occurredAtUtc: nowUtc,
    });
    const result = nativeMode
      ? await applyAndWriteAgentOSControllerEventAsync({authorityRoot: campaignRoot, statePath: controllerStatePath, expectedStateSha256: initialState.state_sha256, event, adapters, nowUtc})
      : applyAndWriteAgentOSControllerEvent({authorityRoot: campaignRoot, statePath: controllerStatePath, expectedStateSha256: initialState.state_sha256, event, adapters, nowUtc});
    const finalState = result.state;
    writeRecord(campaignRoot, "start-event.json", event);
    writeRecord(campaignRoot, "controller-state.json", finalState);
    const receiptsByOperation = Object.fromEntries(finalState.action_receipts.filter((receipt) => receipt.event_id === event.event_id).map((receipt) => [receipt.operation, receipt]));
    const spawnReadbacks = ["spawnCampaignOrchestrator", "spawnIndependentAuditor", "spawnFeatureAgents"].map((operation) => {
      const receipt = receiptsByOperation[operation];
      assert(receipt?.details?.worker_readback, `${operation} did not return a worker readback`);
      if (!nativeMode) validateLocalWorkerReadback(receipt.details.worker_readback);
      return receipt.details.worker_readback;
    });
    if (!nativeMode) {
      assert(spawnReadbacks.every((readback) => /^\d+$/u.test(readback.pid)), "real worker PID readback is missing");
      assert(spawnReadbacks.every((readback) => fs.existsSync(readback.worktree_path)), "real worker worktree readback is missing");
    } else {
      assert(spawnReadbacks.every((readback) => typeof readback.session_id === "string" && readback.session_id.length > 0), "native worker session readback is missing");
    }
    assert(spawnReadbacks.every((readback) => readback.source_commit === sourceCommit && readback.source_tree === sourceTree), "real worker source identity differs");
    const activation = nativeMode
      ? compileNativeCampaignActivation({admission, authorization, identityBinding, candidate, spawnReadbacks, controllerStateSha256: finalState.state_sha256, startedAtUtc: nowUtc, hostAttachment: options.hostAttachment})
      : compileLocalCampaignActivation({admission, authorization, identityBinding, candidate, spawnReadbacks, controllerStateSha256: finalState.state_sha256, startedAtUtc: nowUtc});
    if (!nativeMode) validateLocalCampaignActivation(activation);
    writeRecord(campaignRoot, "activation.json", activation, nativeMode
      ? (value) => assert(value.schema === "agentos.native_campaign_activation.v1" && value.active_campaign === true, "native campaign activation is invalid")
      : validateLocalCampaignActivation);
    const handoff = contentAddressed({
      schema: "agentos.local_campaign_start_handoff.v1",
      version: 1,
      status: "CAMPAIGN_ACTIVE_BUILDING_AND_AUDITING",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "Controller",
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      project_id: PROJECT_ID,
      source_checkpoint: {commit: sourceCommit, tree: sourceTree, clean: true, pushed: false},
      parent_audit_packet_sha256: parentAuditPacketSha256,
      parent_audit_addendum_sha256: parentAuditAddendumSha256,
      owner_intent_sha256: ownerIntent.owner_intent_sha256,
      decision_tree_requirement_sha256: decisionTreeRequirement.decision_tree_requirement_sha256,
      policy_state_sha256: policy.policy_state_sha256,
      acceptance_sha256: acceptance.acceptance_sha256,
      candidate_sha256: candidate.candidate_sha256,
      authorization_sha256: authorization.authorization_sha256,
      identity_binding_sha256: identityBinding.binding_sha256,
      admission_sha256: admission.admission_sha256,
      activation_sha256: activation.activation_sha256,
      controller_state_sha256: finalState.state_sha256,
      event_sha256: event.event_sha256,
      runtime_authority_ref: "EXTERNAL_RUNTIME_AUTHORITY",
      spawn_readbacks: structuredClone(spawnReadbacks),
      custody: {
        controller: "Controller regulates workflow; it does not claim builder completion or Product Owner intent authority.",
        orchestrator: receiptsByOperation.spawnCampaignOrchestrator.details.worker_readback.session_id,
        auditor: receiptsByOperation.spawnIndependentAuditor.details.worker_readback.session_id,
        feature_agent: receiptsByOperation.spawnFeatureAgents.details.worker_readback.session_id,
        feature_agent_build_commit: nativeMode ? null : receiptsByOperation.spawnFeatureAgents.details.worker_readback.build_commit,
        feature_agent_build_tree: nativeMode ? null : receiptsByOperation.spawnFeatureAgents.details.worker_readback.build_tree,
        auditor_verified_commit: nativeMode ? null : receiptsByOperation.spawnIndependentAuditor.details.worker_readback.build_commit,
        auditor_verified_tree: nativeMode ? null : receiptsByOperation.spawnIndependentAuditor.details.worker_readback.build_tree,
      },
      permissions: structuredClone(authorization.permissions),
      next_action: "Keep the local campaign open for Controller supervision, four-root audit reconciliation, and exact repair re-check; external actions remain disabled.",
      stop_conditions: authorization.stop_conditions,
      undo: ["Retain the immutable parent audit packet and addendum.", "Remove only this local campaign runtime and its isolated worktrees if the owner later directs undo.", "Do not alter the sterile release copy."],
      handoff_sha256: null,
    }, "handoff_sha256");
    writeRecord(campaignRoot, "campaign-start-handoff.json", handoff);
    process.stdout.write(`${JSON.stringify({status: handoff.status, campaign_id: CAMPAIGN_ID, campaign_root_ref: "EXTERNAL_RUNTIME_AUTHORITY", candidate_sha256: candidate.candidate_sha256, activation_sha256: activation.activation_sha256, controller_state_sha256: finalState.state_sha256, worker_roles: spawnReadbacks.map((readback) => ({role: readback.role, session_id: readback.session_id ?? null, worktree_ref: readback.worktree_ref ?? (readback.worktree_path === undefined ? null : `opaque:worktree:${controllerDigest(readback.worktree_path)}`), source_commit: readback.source_commit, source_tree: readback.source_tree, build_status: readback.build_status ?? null, build_commit: readback.build_commit ?? null, build_tree: readback.build_tree ?? null}))}, null, 2)}\n`);
    return handoff;
  } catch (error) {
    if (campaignRoot !== null) {
      const rca = localFailureRca({campaignRoot, error, phase, sourceCommit, sourceTree, nowUtc, attemptedCommand});
      try {
        writeRecord(campaignRoot, "start-failure-rca.json", rca);
      } catch (writeError) {
        process.stderr.write(`Failed to retain local start RCA: ${writeError.message}\n`);
      }
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  try {
    await main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify(compileLocalStartOutcome(error))}\n`);
    process.exitCode = 1;
  }
}

export {compileStaleCandidateRejection, compileStallRca, localFailureRca, main, main as startLocalSelfDevelopment};
