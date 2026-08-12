#!/usr/bin/env node

import crypto from "node:crypto";

export const EVIDENCE_RECEIPT_SCHEMA = "agentos.rapid_prototype_evidence_receipt.v1";
export const EVIDENCE_RECEIPT_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;
const URL = /\b(?:https?|wss?):\/\/\S+/iu;
const SECRET_SHAPE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key)\s*[:=]/iu;
const SECRET_VALUE = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:ghp|github_pat|sk|rk)[_-][A-Za-z0-9_-]{20,}\b/u;
const PRIVATE_FIELD = /(?:^|_)(?:session|thread|chat|provider|account|credential|secret|password|token|cookie|authorization|deployment|subscription|tenant|private)(?:_|$)/iu;
const RESULT_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "UNAVAILABLE"]);
const HANDOFF_STATUSES = new Set(["READY_FOR_INDEPENDENT_CLEARANCE", "BLOCKED", "UNAVAILABLE"]);
const INDEPENDENT_CHECK_STATUSES = new Set(["REQUESTED", "NOT_YET_RUN"]);
const HOST_AUTHORITY = "NATIVE_SESSION_HOST_READBACK";
const PLACEHOLDER_EVIDENCE = /\b(?:synthetic|placeholder|fake|fixture|example|test(?:[-_ ]only)?)\b/iu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
  return value;
}

function requireString(value, label, {allowEmpty = false} = {}) {
  assert(typeof value === "string", `${label} must be a string`);
  assert(allowEmpty ? value.length >= 0 : value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
  return value;
}

function compareUtf8(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function evidenceReceiptDigest(receipt) {
  const body = structuredClone(receipt);
  body.receipt_sha256 = null;
  return sha256(canonicalJson(body));
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(requireRecord(value, label)).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function firstDefined(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

export function verifyHostAuthority({input = {}, source = {}, suppliedRole = {}} = {}) {
  const supplied = input.host_authority ?? input.hostAuthority ?? input.nativeHostReadback;
  if (!isRecord(supplied)) return {status: "UNAVAILABLE", verified: false, sourceReadback: null, projectIdentity: null};

  const sourceReadback = firstDefined(supplied, ["source_readback", "sourceReadback"]) ?? supplied;
  const projectIdentity = firstDefined(supplied, ["project_identity", "projectIdentity"]) ?? supplied;
  const closure = input.closure ?? {};
  const expectedSource = source.observed ?? {};
  const sourceFields = [
    ["project_id", ["project_id", "projectId", "project"]],
    ["cwd", ["cwd", "pwd", "working_directory", "workingDirectory"]],
    ["git_top_level", ["git_top_level", "gitTopLevel", "top_level", "topLevel"]],
    ["source_commit", ["source_commit", "sourceCommit", "head", "commit"]],
    ["source_tree", ["source_tree", "sourceTree", "tree"]],
  ];
  const sourceMatches = sourceFields.every(([, names]) => {
    const observed = firstDefined(expectedSource, names);
    const proved = firstDefined(sourceReadback, names);
    return observed !== undefined && proved !== undefined && observed === proved;
  });
  const proofProject = firstDefined(projectIdentity, ["project_id", "projectId", "id"]);
  const proofRole = firstDefined(supplied, ["role", "lane", "role_id", "roleId"]);
  const proofSession = firstDefined(supplied, ["session_id", "sessionId", "real_session_id", "realSessionId"]);
  const proofThread = firstDefined(supplied, ["thread_id", "threadId"]);
  const proofHost = firstDefined(supplied, ["host_id", "hostId"]);
  const proofCapabilities = firstDefined(supplied, ["capabilities", "available_capabilities", "availableCapabilities"]);
  const requiredCapabilities = suppliedRole.requiredCapabilities
    ?? suppliedRole.required_capabilities
    ?? input.required_capabilities
    ?? input.requiredCapabilities
    ?? ["local_check"];
  const expectedProject = suppliedRole.expectedProject;
  const expectedSession = suppliedRole.sessionIdentity?.sessionId;
  const expectedThread = closure.threadId ?? closure.thread_id ?? input.threadId ?? input.thread_id;
  const expectedHost = closure.hostId ?? closure.host_id ?? input.hostId ?? input.host_id;
  const identifiers = [proofProject, proofRole, proofSession, proofThread, proofHost, ...sourceFields.map(([, names]) => firstDefined(sourceReadback, names))];
  const hasPlaceholder = identifiers.some((value) => typeof value === "string" && PLACEHOLDER_EVIDENCE.test(value));
  const verified = supplied.authority === HOST_AUTHORITY
    && supplied.status === "MATCH"
    && supplied.verified === true
    && sourceMatches
    && proofProject === expectedProject
    && proofRole === suppliedRole.role
    && proofSession === expectedSession
    && expectedThread !== undefined
    && proofThread === expectedThread
    && expectedHost !== undefined
    && proofHost === expectedHost
    && Array.isArray(proofCapabilities)
    && Array.isArray(requiredCapabilities)
    && proofCapabilities.every((capability) => typeof capability === "string" && capability.length > 0)
    && requiredCapabilities.every((capability) => typeof capability === "string" && capability.length > 0)
    && new Set(proofCapabilities).size === proofCapabilities.length
    && new Set(requiredCapabilities).size === requiredCapabilities.length
    && requiredCapabilities.every((capability) => proofCapabilities.includes(capability))
    && !hasPlaceholder;
  return {
    status: verified ? "VERIFIED" : "UNPROVEN",
    verified,
    sourceReadback: isRecord(sourceReadback) ? structuredClone(sourceReadback) : null,
    projectIdentity: isRecord(projectIdentity) ? structuredClone(projectIdentity) : null,
  };
}

function requireSafeIdentifier(value, label) {
  requireString(value, label);
  assert(SAFE_ID.test(value), `${label} is not a stable identifier`);
  return value;
}

function normalizePath(value, label) {
  requireString(value, label);
  assert(!ABSOLUTE_PATH.test(value), `${label} must be a relative path`);
  assert(!value.includes("\\"), `${label} must use portable separators`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} contains an unsafe segment`);
  return value;
}

function normalizePaths(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
  const paths = value.map((entry, index) => normalizePath(entry, `${label}[${index}]`));
  const unique = new Set(paths);
  assert(unique.size === paths.length, `${label} must not contain duplicates`);
  return [...paths].sort(compareUtf8);
}

function normalizeWorkingTree(value, label) {
  if (Array.isArray(value)) {
    assert(value.every((entry) => typeof entry === "string"), `${label} must contain strings`);
    return value.join("\n");
  }
  return requireString(value ?? "", label, {allowEmpty: true});
}

function normalizePrivatePathDigest(input, rawNames, digestNames, label) {
  const raw = firstDefined(input, rawNames);
  const suppliedDigest = firstDefined(input, digestNames);
  if (raw !== undefined) {
    const normalized = requireString(raw, label);
    const digest = sha256(normalized);
    if (suppliedDigest !== undefined) {
      requireSha(suppliedDigest, `${label} digest`);
      assert(suppliedDigest === digest, `${label} digest does not match the host value`);
    }
    return digest;
  }
  return requireSha(suppliedDigest, `${label} digest`);
}

function normalizeSourceReadback(sourceReadback) {
  const input = requireRecord(sourceReadback, "source readback");
  const statusField = firstDefined(input, [
    "readback_status",
    "readbackStatus",
    "binding_status",
    "bindingStatus",
    "identity_status",
    "identityStatus",
  ]);
  const suppliedStatus = statusField ?? (
    input.status === "MATCH" || input.status === "MISMATCH" ? input.status : "MATCH"
  );
  assert(suppliedStatus === "MATCH", "source readback identity is not MATCH");

  const workingDirectory = firstDefined(input, ["pwd", "working_directory", "workingDirectory", "cwd"]);
  const gitTopLevel = firstDefined(input, ["git_top_level", "gitTopLevel", "top_level", "topLevel"]);
  const workingDirectoryDigest = normalizePrivatePathDigest(
    input,
    ["pwd", "working_directory", "workingDirectory", "cwd"],
    ["cwd_sha256", "pwd_sha256", "working_directory_sha256", "workingDirectorySha256"],
    "source readback working directory",
  );
  const gitTopLevelDigest = normalizePrivatePathDigest(
    input,
    ["git_top_level", "gitTopLevel", "top_level", "topLevel"],
    ["git_top_level_sha256", "gitTopLevelSha256", "top_level_sha256", "topLevelSha256"],
    "source readback Git top level",
  );
  const sourceCommit = firstDefined(input, ["source_commit", "sourceCommit", "head", "HEAD", "commit"]);
  const sourceTree = firstDefined(input, ["source_tree", "sourceTree", "tree", "head_tree", "headTree", "HEAD_tree"]);
  const workingTree = firstDefined(input, [
    "working_tree_status",
    "workingTreeStatus",
    "git_status",
    "gitStatus",
    "working_tree",
    "workingTree",
  ]) ?? (input.status === "MATCH" || input.status === "MISMATCH" ? "" : input.status);

  if (workingDirectory !== undefined && gitTopLevel !== undefined) {
    requireString(workingDirectory, "source readback working directory");
    requireString(gitTopLevel, "source readback Git top level");
    assert(workingDirectory === gitTopLevel, "source readback working directory and Git top level differ");
  } else {
    assert(workingDirectoryDigest === gitTopLevelDigest, "source readback working directory and Git top level differ");
  }
  requireGitObject(sourceCommit, "source readback commit");
  requireGitObject(sourceTree, "source readback tree");

  return {
    status: "MATCH",
    cwd_sha256: workingDirectoryDigest,
    git_top_level_sha256: gitTopLevelDigest,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    git_status: normalizeWorkingTree(workingTree, "source readback working-tree status"),
  };
}

function normalizeProjectIdentity(projectIdentity, sourceReadback) {
  const input = requireRecord(projectIdentity, "project identity");
  const projectId = firstDefined(input, ["project_id", "projectId", "id"]);
  const projectRoot = firstDefined(input, ["project_root", "projectRoot", "root", "cwd", "working_directory", "workingDirectory"]);
  const gitTopLevel = firstDefined(input, ["git_top_level", "gitTopLevel", "top_level", "topLevel"]);
  const projectRootDigest = normalizePrivatePathDigest(
    input,
    ["project_root", "projectRoot", "root", "cwd", "working_directory", "workingDirectory"],
    ["project_root_sha256", "projectRootSha256", "root_sha256", "cwd_sha256"],
    "project identity root",
  );
  const gitTopLevelDigest = gitTopLevel === undefined
    && firstDefined(input, ["git_top_level_sha256", "gitTopLevelSha256", "top_level_sha256", "topLevelSha256"]) === undefined
    ? sourceReadback.git_top_level_sha256
    : normalizePrivatePathDigest(
      input,
      ["git_top_level", "gitTopLevel", "top_level", "topLevel"],
      ["git_top_level_sha256", "gitTopLevelSha256", "top_level_sha256", "topLevelSha256"],
      "project identity Git top level",
    );
  const environment = firstDefined(input, ["environment", "environment_kind", "environmentKind"]) ?? "LOCAL_PROJECT";

  requireSafeIdentifier(projectId, "project identity project ID");
  requireString(environment, "project identity environment");
  if (projectRoot !== undefined) {
    requireString(projectRoot, "project identity project root");
    assert(projectRootDigest === sourceReadback.cwd_sha256, "project identity root does not match source readback");
  } else {
    assert(projectRootDigest === sourceReadback.cwd_sha256, "project identity root does not match source readback");
  }
  if (gitTopLevel !== undefined) {
    requireString(gitTopLevel, "project identity Git top level");
    assert(gitTopLevelDigest === sourceReadback.git_top_level_sha256, "project identity Git top level does not match source readback");
  } else {
    assert(gitTopLevelDigest === sourceReadback.git_top_level_sha256, "project identity Git top level does not match source readback");
  }

  return {
    project_id: projectId,
    project_root_sha256: projectRootDigest,
    git_top_level_sha256: gitTopLevelDigest,
    environment,
  };
}

function declaredTaskPaths(task) {
  const scope = isRecord(task.scope) ? task.scope : {};
  return firstDefined(task, ["allowed_changed_paths", "allowedChangedPaths", "changed_paths", "changedPaths", "write_scope"])
    ?? firstDefined(scope, ["allowed_changed_paths", "allowedChangedPaths", "changed_paths", "changedPaths", "paths"]);
}

function normalizeTask(task) {
  const input = requireRecord(task, "task");
  const taskId = firstDefined(input, ["task_id", "taskId", "id"]);
  const role = firstDefined(input, ["role", "lane", "role_id", "roleId"]) ?? "IMPLEMENTATION_LANE";
  const allowedPaths = declaredTaskPaths(input);

  requireSafeIdentifier(taskId, "task ID");
  requireString(role, "task role");
  return {
    task_id: taskId,
    role,
    allowed_changed_paths: normalizePaths(allowedPaths, "task allowed changed paths"),
  };
}

function normalizeGoal(goal) {
  if (typeof goal === "string") {
    requireString(goal, "goal");
    return {goal_id: `GOAL-${sha256(goal).slice(0, 16)}`, summary: goal};
  }
  const input = requireRecord(goal, "goal");
  const goalId = firstDefined(input, ["goal_id", "goalId", "id"]);
  const summary = firstDefined(input, ["summary", "description", "goal"]);
  requireSafeIdentifier(goalId, "goal ID");
  requireString(summary, "goal summary");
  return {goal_id: goalId, summary};
}

function normalizeBehaviorResult(behaviorResult) {
  const input = requireRecord(behaviorResult, "behavior result");
  const status = firstDefined(input, ["status", "outcome", "result"]);
  const summary = firstDefined(input, ["summary", "message", "details"]);
  requireString(status, "behavior result status");
  assert(RESULT_STATUSES.has(status), "behavior result status is invalid");
  requireString(summary, "behavior result summary");
  return {status, summary};
}

function normalizeFocusedCheck(focusedCheck, sourceReadback) {
  const input = requireRecord(focusedCheck, "focused check");
  const test = firstDefined(input, ["test", "command", "test_command", "check"]);
  const status = firstDefined(input, ["status", "outcome", "result"]);
  const sourceCommit = firstDefined(input, ["source_commit", "sourceCommit", "commit"]) ?? sourceReadback.source_commit;
  const sourceTree = firstDefined(input, ["source_tree", "sourceTree", "tree"]) ?? sourceReadback.source_tree;
  const summary = firstDefined(input, ["summary", "message", "details"]) ?? "Focused test passed";

  requireString(test, "focused check test");
  assert(status === "PASS", "focused check must be PASS");
  requireGitObject(sourceCommit, "focused check source commit");
  requireGitObject(sourceTree, "focused check source tree");
  requireString(summary, "focused check summary");
  assert(sourceCommit === sourceReadback.source_commit, "focused check commit differs from source readback");
  assert(sourceTree === sourceReadback.source_tree, "focused check tree differs from source readback");

  const result = {test, status, source_commit: sourceCommit, source_tree: sourceTree, summary};
  return {...result, result_sha256: sha256(canonicalJson(result))};
}

function normalizeHostileCoverage(hostileCoverage) {
  let entries;
  if (Array.isArray(hostileCoverage)) {
    entries = hostileCoverage;
  } else if (isRecord(hostileCoverage)) {
    entries = Object.entries(hostileCoverage).map(([id, value]) => (
      isRecord(value) ? {id, ...value} : {id, disposition: value}
    ));
  } else {
    throw new Error("hostile coverage must be an array or object");
  }
  assert(entries.length >= 3, "hostile coverage must include at least three cases");
  const normalized = entries.map((entry, index) => {
    if (typeof entry === "string") return {id: requireSafeIdentifier(entry, `hostile coverage[${index}]`), disposition: "COVERED"};
    const input = requireRecord(entry, `hostile coverage[${index}]`);
    const id = firstDefined(input, ["id", "case_id", "caseId"]);
    const disposition = firstDefined(input, ["disposition", "status", "result"]);
    requireSafeIdentifier(id, `hostile coverage[${index}] ID`);
    requireString(disposition, `hostile coverage[${index}] disposition`);
    return {id, disposition};
  });
  const ids = normalized.map(({id}) => id);
  assert(new Set(ids).size === ids.length, "hostile coverage contains duplicate cases");
  return normalized.sort((left, right) => compareUtf8(left.id, right.id));
}

function normalizeHandoff(handoff) {
  const input = requireRecord(handoff, "handoff");
  const status = firstDefined(input, ["status", "result"]);
  const independent = firstDefined(input, ["independent_check", "independentCheck"]);
  const independentStatus = isRecord(independent)
    ? firstDefined(independent, ["status", "result"])
    : independent;
  const nextHandoff = firstDefined(input, ["next_handoff", "nextHandoff", "next"]);

  requireString(status, "handoff status");
  assert(HANDOFF_STATUSES.has(status), "handoff status is invalid");
  requireString(independentStatus, "handoff independent-check status");
  assert(INDEPENDENT_CHECK_STATUSES.has(independentStatus), "independent check must remain pending");
  requireSafeIdentifier(nextHandoff, "handoff next route");
  return {
    status,
    independent_check: independentStatus,
    next_handoff: nextHandoff,
  };
}

function normalizeRelevantDigests(relevantDigests) {
  const input = requireRecord(relevantDigests, "relevant digests");
  const keys = Object.keys(input);
  assert(keys.length > 0, "relevant digests must be nonempty");
  const result = {};
  for (const key of keys.sort(compareUtf8)) {
    requireSafeIdentifier(key, `relevant digest ${key}`);
    result[key] = requireSha(input[key], `relevant digest ${key}`);
  }
  return result;
}

function assertNoPrivateData(value) {
  function visit(current, location) {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (isRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        const digestLabel = location === "receipt.relevant_digests";
        assert(digestLabel || !PRIVATE_FIELD.test(key), `private data is not allowed in evidence receipt: ${location}.${key}`);
        visit(child, `${location}.${key}`);
      }
      return;
    }
    if (typeof current !== "string") return;
    assert(!ABSOLUTE_PATH.test(current), `private data is not allowed in evidence receipt: ${location}`);
    assert(!URL.test(current), `private data is not allowed in evidence receipt: ${location}`);
    assert(!SECRET_SHAPE.test(current) && !SECRET_VALUE.test(current), `private data is not allowed in evidence receipt: ${location}`);
  }
  visit(value, "receipt");
}

function validateChangedPathBinding(changedPaths, task) {
  const expected = task.allowed_changed_paths;
  assert(JSON.stringify(changedPaths) === JSON.stringify(expected), "changed paths do not match task scope");
}

function validateReceiptShape(receipt) {
  exactKeys(receipt, [
    "schema",
    "version",
    "status",
    "source_readback",
    "project_identity",
    "task",
    "goal",
    "changed_paths",
    "behavior_result",
    "focused_check",
    "hostile_coverage",
    "handoff",
    "relevant_digests",
    "receipt_sha256",
  ], "evidence receipt");
  assert(receipt.schema === EVIDENCE_RECEIPT_SCHEMA && receipt.version === EVIDENCE_RECEIPT_VERSION, "evidence receipt identity is invalid");
  assert(receipt.status === "READY_FOR_INDEPENDENT_CLEARANCE", "evidence receipt status is invalid");
  requireSha(receipt.receipt_sha256, "evidence receipt digest");
  return receipt;
}

export function compileEvidenceReceipt({
  sourceReadback,
  projectIdentity,
  task,
  goal,
  changedPaths,
  behaviorResult,
  focusedCheck,
  hostileCoverage,
  handoff,
  relevantDigests,
} = {}) {
  const source = normalizeSourceReadback(sourceReadback);
  const project = normalizeProjectIdentity(projectIdentity, source);
  const normalizedTask = normalizeTask(task);
  const normalizedGoal = normalizeGoal(goal);
  const paths = normalizePaths(changedPaths, "changed paths");
  validateChangedPathBinding(paths, normalizedTask);
  const receipt = {
    schema: EVIDENCE_RECEIPT_SCHEMA,
    version: EVIDENCE_RECEIPT_VERSION,
    status: "READY_FOR_INDEPENDENT_CLEARANCE",
    source_readback: source,
    project_identity: project,
    task: normalizedTask,
    goal: normalizedGoal,
    changed_paths: paths,
    behavior_result: normalizeBehaviorResult(behaviorResult),
    focused_check: normalizeFocusedCheck(focusedCheck, source),
    hostile_coverage: normalizeHostileCoverage(hostileCoverage),
    handoff: normalizeHandoff(handoff),
    relevant_digests: normalizeRelevantDigests(relevantDigests),
    receipt_sha256: null,
  };
  assertNoPrivateData(receipt);
  receipt.receipt_sha256 = evidenceReceiptDigest(receipt);
  return verifyEvidenceReceipt(receipt);
}

export function verifyEvidenceReceipt(receipt) {
  validateReceiptShape(receipt);
  const source = normalizeSourceReadback(receipt.source_readback);
  const project = normalizeProjectIdentity(receipt.project_identity, source);
  const task = normalizeTask(receipt.task);
  const goal = normalizeGoal(receipt.goal);
  const paths = normalizePaths(receipt.changed_paths, "evidence receipt changed paths");
  const behavior = normalizeBehaviorResult(receipt.behavior_result);
  const focused = normalizeFocusedCheck(receipt.focused_check, source);
  const hostile = normalizeHostileCoverage(receipt.hostile_coverage);
  const normalizedHandoff = normalizeHandoff(receipt.handoff);
  const digests = normalizeRelevantDigests(receipt.relevant_digests);

  assert(canonicalJson(source) === canonicalJson(receipt.source_readback), "source readback is not canonical");
  assert(canonicalJson(project) === canonicalJson(receipt.project_identity), "project identity is not canonical");
  assert(canonicalJson(task) === canonicalJson(receipt.task), "task is not canonical");
  assert(canonicalJson(goal) === canonicalJson(receipt.goal), "goal is not canonical");
  assert(canonicalJson(paths) === canonicalJson(receipt.changed_paths), "changed paths are not canonical");
  assert(canonicalJson(behavior) === canonicalJson(receipt.behavior_result), "behavior result is not canonical");
  assert(canonicalJson(focused) === canonicalJson(receipt.focused_check), "focused check is not canonical");
  assert(canonicalJson(hostile) === canonicalJson(receipt.hostile_coverage), "hostile coverage is not canonical");
  assert(canonicalJson(normalizedHandoff) === canonicalJson(receipt.handoff), "handoff is not canonical");
  assert(canonicalJson(digests) === canonicalJson(receipt.relevant_digests), "relevant digests are not canonical");
  validateChangedPathBinding(paths, task);
  assertNoPrivateData(receipt);
  assert(receipt.receipt_sha256 === evidenceReceiptDigest(receipt), "evidence receipt digest mismatch");
  return receipt;
}
