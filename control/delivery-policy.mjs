#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {compileProjectLifeContract} from "./project-life-contract.mjs";
import {compileDeliveryTarget, validateDeliveryTarget} from "./delivery-target.mjs";

export const DELIVERY_POLICY_SCHEMA = "agentos.delivery_policy.v1";
export const DELIVERY_PROBE_PLAN_SCHEMA = "agentos.delivery_probe_plan.v1";
export const DELIVERY_PROBE_RESULTS_SCHEMA = "agentos.delivery_probe_results.v1";

export const RUNNER_ROUTES = Object.freeze(["HOSTED", "VPS", "LOCAL", "HYBRID", "PROJECT_DEFINED"]);
export const DEPLOYMENT_ROUTES = Object.freeze(["MANAGED", "VPS", "LOCAL", "HYBRID", "PROJECT_DEFINED"]);
export const DELIVERY_PRIORITIES = Object.freeze(["COST", "BALANCED", "SPEED", "RELIABILITY"]);
export const PROBE_STATUSES = Object.freeze(["PASS", "CONFLICT", "NOT_RUN_OWNER_BOUNDARY", "UNAVAILABLE", "UNPROVEN"]);
const SAFE_PROBE_OPERATIONS = Object.freeze(["LOCAL_GIT_READBACK", "LOCAL_MARKER_READBACK", "LOCAL_TOOL_AVAILABILITY_READBACK"]);
const PROHIBITED_PROBE_OPERATIONS = Object.freeze(["AUTHENTICATION", "NETWORK", "PUSH", "MERGE", "SPENDING", "DEPLOYMENT", "ROLLBACK", "FILE_WRITES", "DELETION"]);

const PUSH_MODES = Object.freeze(["CHECKPOINTS_REMOTE_EQUAL", "LOCAL_UNTIL_HANDOFF", "EVERY_COMMIT_REMOTE_EQUAL", "PROJECT_DEFINED"]);
const PREVIEW_MODES = Object.freeze(["NOT_ASSUMED", "OWNER_DEFINED", "REQUIRED"]);
const BRANCH_RETENTION = Object.freeze(["UNTIL_ACCEPTED_LIVE_CLOSURE", "UNTIL_MERGED", "PROJECT_DEFINED"]);
const MERGE_AUTHORITIES = Object.freeze(["CENTRAL_SERIALIZED", "PROJECT_OWNER", "PROJECT_DEFINED"]);
const MERGE_GATES = Object.freeze(["REQUIRED_AFFECTED_CHECKS", "REQUIRED_ALL_CHECKS", "PROJECT_DEFINED"]);
const AUTO_MERGE_MODES = Object.freeze(["DISABLED_BY_DEFAULT", "OWNER_ADMITTED", "PROJECT_DEFINED"]);
const MERGE_METHODS = Object.freeze(["MERGE_COMMIT", "SQUASH", "REBASE", "PROJECT_DEFINED"]);
const DEPLOYMENT_TRIGGERS = Object.freeze(["EXACT_ACCEPTED_COMMIT", "PROJECT_DEFINED"]);
const COST_APPROVALS = Object.freeze(["OWNER_ONLY_ABOVE_BOUNDARY", "PROJECT_DEFINED"]);
const LIMIT_ACTIONS = Object.freeze(["PAUSE_NEW_LOW_PRIORITY_WORK", "FAIL_CLOSED", "PROJECT_DEFINED"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_BRANCH_TEMPLATE = /^[A-Za-z0-9._{}:/*-]+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HEX40 = /^[0-9a-f]{40}$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireId(value, label, pattern = SAFE_ID) {
  requireString(value, label);
  assert(pattern.test(value), `${label} contains an unsafe identifier`);
  assert(!value.includes("//") && !value.split("/").includes(".."), `${label} contains an unsafe path fragment`);
}

function optionalId(value, label, pattern = SAFE_ID) {
  if (value === null || value === undefined) return null;
  requireId(value, label, pattern);
  return value;
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function rejectUnknown(record, allowed, label) {
  for (const key of Object.keys(record)) assert(allowed.includes(key), `${label} contains unsupported field: ${key}`);
}

function enumValue(value, choices, label, fallback) {
  const selected = value ?? fallback;
  assert(choices.includes(selected), `${label} is invalid`);
  return selected;
}

function finiteNumber(value, label, {integer = false, minimum = 0} = {}) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= minimum, `${label} is invalid`);
  if (integer) assert(Number.isSafeInteger(value), `${label} must be an integer`);
  return value;
}

function optionalFiniteNumber(value, label, options = {}) {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, label, options);
}

function normalizeProvider(value, label) {
  return optionalId(value, label, SAFE_PROVIDER_ID);
}

function normalizeEnvironmentIds(value) {
  const environments = value ?? [];
  assert(Array.isArray(environments), "deployment environment_ids must be an array");
  const normalized = environments.map((entry, index) => {
    requireId(entry, `deployment environment_ids[${index}]`);
    return entry;
  });
  assert(new Set(normalized).size === normalized.length, "deployment environment_ids must be unique");
  return normalized.sort(compareUtf8);
}

function normalizeRouteCandidates(value, choices, label) {
  const candidates = value ?? [];
  assert(Array.isArray(candidates), `${label} must be an array`);
  const normalized = [...new Set(candidates.map((entry) => enumValue(entry, choices, label, null)))];
  return normalized.sort(compareUtf8);
}

function validateBranchNamespace(value) {
  requireString(value, "source_control.branch_namespace");
  assert(!value.startsWith("/") && !value.endsWith("/") && !value.includes("\\") && !value.includes("//"), "source_control.branch_namespace is not contained");
  assert(!value.split("/").includes("..") && SAFE_BRANCH_TEMPLATE.test(value), "source_control.branch_namespace contains unsafe material");
  return value;
}

function recommendationForRoute({selected, routeType, priority, available}) {
  if (selected !== "PROJECT_DEFINED") {
    return {
      recommended_route: selected,
      reason: "OWNER_SELECTED_ROUTE",
      confidence: "OWNER_BOUND",
      owner_confirmation_required: false,
      project_binding_required: selected === "HOSTED" || selected === "VPS" || selected === "MANAGED",
    };
  }
  const order = routeType === "RUNNER"
    ? (priority === "COST" ? ["LOCAL", "VPS", "HOSTED"] : priority === "SPEED" || priority === "RELIABILITY" ? ["HOSTED", "VPS", "LOCAL"] : ["HOSTED", "VPS", "LOCAL"])
    : (priority === "COST" ? ["VPS", "MANAGED", "LOCAL"] : priority === "SPEED" || priority === "RELIABILITY" ? ["MANAGED", "VPS", "LOCAL"] : ["MANAGED", "VPS", "LOCAL"]);
  const recommended = order.find((candidate) => available.length === 0 || available.includes(candidate)) ?? "PROJECT_DEFINED";
  const reason = recommended === "LOCAL"
    ? "LOW_EXTERNAL_SPEND_BUT_HOST_AVAILABILITY_IS_NOT_CONTINUOUSLY_PROVEN"
    : recommended === "VPS"
      ? "CONTINUOUS_HOSTING_CANDIDATE_WITH_EXPLICIT_HOST_MAINTENANCE_AND_ISOLATION_BOUNDARY"
      : recommended === "HOSTED"
        ? "REDUCES_LOCAL_HOST_SETUP_BUT_REQUIRES_PROVIDER_QUOTA_AND_COST_BINDING"
        : recommended === "MANAGED"
          ? "REDUCES_HOST_MAINTENANCE_BUT_REQUIRES_PROVIDER_COST_AND_ROLLBACK_BINDING"
          : "NO_ROUTE_IS_PROVEN_AVAILABLE";
  return {
    recommended_route: recommended,
    reason,
    confidence: "CANDIDATE_ONLY",
    owner_confirmation_required: true,
    project_binding_required: true,
  };
}

export function validateDeliveryPolicy(policy) {
  requireRecord(policy, "delivery policy");
  assert(policy.schema === DELIVERY_POLICY_SCHEMA && policy.version === 1, "delivery policy identity is invalid");
  assert(["COMPILED_OWNER_BOUND", "COMPILED_WITH_PROJECT_BINDING_GAPS"].includes(policy.status), "delivery policy status is invalid");
  for (const field of ["preferences", "source_control", "merge", "ci_runner", "deployment", "delivery_target", "rollback", "cost_boundaries", "recommendation"]) requireRecord(policy[field], `delivery policy ${field}`);
  assert(DELIVERY_PRIORITIES.includes(policy.preferences.priority), "delivery policy priority is invalid");
  assert(PUSH_MODES.includes(policy.source_control.push_mode), "delivery policy push mode is invalid");
  assert(PREVIEW_MODES.includes(policy.source_control.preview_on_push), "delivery policy push preview mode is invalid");
  assert(BRANCH_RETENTION.includes(policy.source_control.temporary_branch_retention), "delivery policy branch retention is invalid");
  validateBranchNamespace(policy.source_control.branch_namespace);
  assert(MERGE_AUTHORITIES.includes(policy.merge.authority), "delivery policy merge authority is invalid");
  assert(MERGE_GATES.includes(policy.merge.gate), "delivery policy merge gate is invalid");
  assert(AUTO_MERGE_MODES.includes(policy.merge.auto_merge), "delivery policy auto-merge mode is invalid");
  assert(MERGE_METHODS.includes(policy.merge.method), "delivery policy merge method is invalid");
  assert(RUNNER_ROUTES.includes(policy.ci_runner.route), "delivery policy runner route is invalid");
  assert(policy.ci_runner.provider_id === null || (typeof policy.ci_runner.provider_id === "string" && SAFE_PROVIDER_ID.test(policy.ci_runner.provider_id)), "delivery policy runner provider is invalid");
  assert(policy.ci_runner.fallback_route === null || RUNNER_ROUTES.includes(policy.ci_runner.fallback_route), "delivery policy runner fallback is invalid");
  finiteNumber(policy.ci_runner.max_concurrency, "delivery policy runner concurrency", {integer: true, minimum: 1});
  optionalFiniteNumber(policy.ci_runner.weekly_minutes_budget, "delivery policy runner minutes", {integer: true, minimum: 0});
  assert(policy.ci_runner.secrets === "PROJECT_CONTEXT_ONLY" && policy.ci_runner.network === "PROJECT_CONTEXT_BOUND", "delivery policy runner boundaries are weakened");
  assert(DEPLOYMENT_ROUTES.includes(policy.deployment.route), "delivery policy deployment route is invalid");
  assert(policy.deployment.provider_id === null || (typeof policy.deployment.provider_id === "string" && SAFE_PROVIDER_ID.test(policy.deployment.provider_id)), "delivery policy deployment provider is invalid");
  normalizeEnvironmentIds(policy.deployment.environment_ids);
  assert(DEPLOYMENT_TRIGGERS.includes(policy.deployment.trigger), "delivery policy deployment trigger is invalid");
  assert(policy.deployment.authority === "RUNTIME_AFTER_CENTRAL_ACCEPTANCE", "delivery policy deployment authority is invalid");
  assert(policy.deployment.artifact_identity === "COMMIT_TREE_BUILD_ARTIFACT", "delivery policy artifact identity is invalid");
  assert(PREVIEW_MODES.includes(policy.deployment.preview), "delivery policy deployment preview mode is invalid");
  validateDeliveryTarget(policy.delivery_target);
  assert(policy.rollback.required === true && policy.rollback.test_required === true, "delivery policy rollback cannot be weakened");
  assert(policy.rollback.identity === "EXACT_LAST_ACCEPTED_DEPLOYMENT", "delivery policy rollback identity is invalid");
  assert(policy.rollback.authority === "RUNTIME_WITH_OWNER_BOUNDARY", "delivery policy rollback authority is invalid");
  optionalFiniteNumber(policy.cost_boundaries.weekly_runner_minutes, "delivery policy cost runner minutes", {integer: true, minimum: 0});
  optionalFiniteNumber(policy.cost_boundaries.monthly_spend_ceiling, "delivery policy monthly spend ceiling", {minimum: 0});
  assert(policy.cost_boundaries.currency === null || /^[A-Z]{3}$/u.test(policy.cost_boundaries.currency), "delivery policy currency is invalid");
  assert(COST_APPROVALS.includes(policy.cost_boundaries.approval), "delivery policy cost approval is invalid");
  assert(LIMIT_ACTIONS.includes(policy.cost_boundaries.on_limit), "delivery policy limit action is invalid");
  assert(policy.policy_sha256 && SHA256.test(policy.policy_sha256), "delivery policy digest is invalid");
  const body = structuredClone(policy);
  delete body.policy_sha256;
  assert(policy.policy_sha256 === canonicalDigest(body), "delivery policy is not content-addressed");
  secretFree(policy, "delivery policy");
  return policy;
}

export function compileDeliveryPolicy({discovery = [], answer = undefined, projectLifeContract = null} = {}) {
  assert(Array.isArray(discovery), "delivery discovery must be an array");
  if (answer !== undefined) requireRecord(answer, "delivery policy answer");
  if (answer !== undefined) secretFree(answer, "delivery policy answer");
  const input = answer ?? {};
  rejectUnknown(input, ["priority", "available_runner_routes", "available_deployment_routes", "source_control", "merge", "ci_runner", "runner", "deployment", "delivery_target", "cost_boundaries"], "delivery policy answer");
  const priority = enumValue(input.priority, DELIVERY_PRIORITIES, "delivery policy priority", "BALANCED");
  const sourceControlInput = input.source_control ?? {};
  const mergeInput = input.merge ?? {};
  const runnerInput = input.ci_runner ?? input.runner ?? {};
  const deploymentInput = input.deployment ?? {};
  const costInput = input.cost_boundaries ?? {};
  const lifeContract = projectLifeContract ?? compileProjectLifeContract({discovery, deliveryAnswer: answer});
  for (const [record, allowed, label] of [
    [sourceControlInput, ["push_mode", "branch_namespace", "preview_on_push", "temporary_branch_retention"], "source_control answer"],
    [mergeInput, ["authority", "gate", "auto_merge", "method"], "merge answer"],
    [runnerInput, ["route", "runner_route", "provider_id", "fallback_route", "max_concurrency", "weekly_minutes_budget"], "ci_runner answer"],
    [deploymentInput, ["route", "hosting_route", "provider_id", "environment_ids", "trigger", "preview", "rollback_required", "rollback_strategy", "rollback_test"], "deployment answer"],
    [costInput, ["weekly_runner_minutes", "monthly_spend_ceiling", "currency", "approval", "on_limit"], "cost boundary answer"],
  ]) {
    requireRecord(record, label);
    rejectUnknown(record, allowed, label);
  }
  if (input.ci_runner !== undefined && input.runner !== undefined) throw new Error("delivery policy cannot provide both ci_runner and runner aliases");
  const availableRunnerRoutes = normalizeRouteCandidates(input.available_runner_routes, RUNNER_ROUTES.filter((route) => route !== "PROJECT_DEFINED"), "available_runner_routes");
  const availableDeploymentRoutes = normalizeRouteCandidates(input.available_deployment_routes, DEPLOYMENT_ROUTES.filter((route) => route !== "PROJECT_DEFINED"), "available_deployment_routes");
  const pushMode = enumValue(sourceControlInput.push_mode, PUSH_MODES, "source_control.push_mode", "CHECKPOINTS_REMOTE_EQUAL");
  const branchNamespace = validateBranchNamespace(sourceControlInput.branch_namespace ?? "campaign/{campaign_id}/{lane_id}");
  const previewOnPush = enumValue(sourceControlInput.preview_on_push, PREVIEW_MODES, "source_control.preview_on_push", "NOT_ASSUMED");
  const temporaryBranchRetention = enumValue(sourceControlInput.temporary_branch_retention, BRANCH_RETENTION, "source_control.temporary_branch_retention", "UNTIL_ACCEPTED_LIVE_CLOSURE");
  const runnerRoute = enumValue(runnerInput.route ?? runnerInput.runner_route, RUNNER_ROUTES, "ci_runner.route", "PROJECT_DEFINED");
  const deploymentRoute = enumValue(deploymentInput.route ?? deploymentInput.hosting_route, DEPLOYMENT_ROUTES, "deployment.route", "PROJECT_DEFINED");
  const runnerProvider = normalizeProvider(runnerInput.provider_id, "ci_runner.provider_id");
  const deploymentProvider = normalizeProvider(deploymentInput.provider_id, "deployment.provider_id");
  const fallbackRoute = runnerInput.fallback_route === undefined ? null : enumValue(runnerInput.fallback_route, RUNNER_ROUTES, "ci_runner.fallback_route", null);
  const environmentIds = normalizeEnvironmentIds(deploymentInput.environment_ids);
  const weeklyRunnerMinutes = optionalFiniteNumber(runnerInput.weekly_minutes_budget ?? costInput.weekly_runner_minutes, "weekly runner minutes", {integer: true, minimum: 0});
  const monthlySpendCeiling = optionalFiniteNumber(costInput.monthly_spend_ceiling, "monthly spend ceiling", {minimum: 0});
  const currency = costInput.currency ?? null;
  if (currency !== null) assert(typeof currency === "string" && /^[A-Z]{3}$/u.test(currency), "cost boundary currency is invalid");
  const policy = {
    schema: DELIVERY_POLICY_SCHEMA,
    version: 1,
    status: runnerRoute === "PROJECT_DEFINED" || deploymentRoute === "PROJECT_DEFINED" || (deploymentRoute !== "LOCAL" && deploymentProvider === null) || environmentIds.length === 0
      ? "COMPILED_WITH_PROJECT_BINDING_GAPS"
      : "COMPILED_OWNER_BOUND",
    source: answer === undefined ? "PORTABLE_SAFE_DEFAULTS" : "OWNER_INPUT_WITH_SAFE_DEFAULTS",
    preferences: {priority},
    source_control: {
      push_mode: pushMode,
      checkpoint_rule: "CLEAN_PUSHED_REMOTE_EQUAL_BEFORE_AUDIT_OR_HANDOFF",
      branch_namespace: branchNamespace,
      preview_on_push: previewOnPush,
      temporary_branch_retention: temporaryBranchRetention,
    },
    merge: {
      authority: enumValue(mergeInput.authority, MERGE_AUTHORITIES, "merge.authority", "CENTRAL_SERIALIZED"),
      gate: enumValue(mergeInput.gate, MERGE_GATES, "merge.gate", "REQUIRED_AFFECTED_CHECKS"),
      auto_merge: enumValue(mergeInput.auto_merge, AUTO_MERGE_MODES, "merge.auto_merge", "DISABLED_BY_DEFAULT"),
      method: enumValue(mergeInput.method, MERGE_METHODS, "merge.method", "PROJECT_DEFINED"),
      protected_default_branch: "REQUIRED",
    },
    ci_runner: {
      route: runnerRoute,
      provider_id: runnerProvider,
      fallback_route: fallbackRoute,
      max_concurrency: finiteNumber(runnerInput.max_concurrency ?? 1, "ci_runner.max_concurrency", {integer: true, minimum: 1}),
      weekly_minutes_budget: weeklyRunnerMinutes,
      secrets: "PROJECT_CONTEXT_ONLY",
      network: "PROJECT_CONTEXT_BOUND",
      execution_scope: "AFFECTED_STABLE_CHECKS_AND_PRODUCTION_BUILD",
    },
    deployment: {
      route: deploymentRoute,
      provider_id: deploymentProvider,
      environment_ids: environmentIds,
      trigger: enumValue(deploymentInput.trigger, DEPLOYMENT_TRIGGERS, "deployment.trigger", "EXACT_ACCEPTED_COMMIT"),
      authority: "RUNTIME_AFTER_CENTRAL_ACCEPTANCE",
      artifact_identity: "COMMIT_TREE_BUILD_ARTIFACT",
      preview: enumValue(deploymentInput.preview, PREVIEW_MODES, "deployment.preview", "NOT_ASSUMED"),
    },
    delivery_target: compileDeliveryTarget({answer: input.delivery_target, route: deploymentRoute, projectLifeContract: lifeContract}),
    rollback: {
      required: deploymentInput.rollback_required ?? true,
      identity: "EXACT_LAST_ACCEPTED_DEPLOYMENT",
      strategy: deploymentInput.rollback_strategy ?? "EXACT_LAST_ACCEPTED_DEPLOYMENT",
      test_required: deploymentInput.rollback_test ?? true,
      authority: "RUNTIME_WITH_OWNER_BOUNDARY",
    },
    cost_boundaries: {
      weekly_runner_minutes: weeklyRunnerMinutes,
      monthly_spend_ceiling: monthlySpendCeiling,
      currency,
      approval: enumValue(costInput.approval, COST_APPROVALS, "cost boundary approval", "OWNER_ONLY_ABOVE_BOUNDARY"),
      on_limit: enumValue(costInput.on_limit, LIMIT_ACTIONS, "cost boundary limit action", "PAUSE_NEW_LOW_PRIORITY_WORK"),
    },
    recommendation: {
      runner: recommendationForRoute({selected: runnerRoute, routeType: "RUNNER", priority, available: availableRunnerRoutes}),
      deployment: recommendationForRoute({selected: deploymentRoute, routeType: "DEPLOYMENT", priority, available: availableDeploymentRoutes}),
      rule: "RECOMMEND_ROUTE_CLASSES_ONLY; NEVER_AUTHENTICATE_SPEND_PUSH_MERGE_DEPLOY_OR_INVENT_PROVIDER_FACTS",
    },
    unresolved: [
      ...(runnerRoute === "PROJECT_DEFINED" ? ["CI_RUNNER_ROUTE"] : []),
      ...((runnerRoute === "HOSTED" || runnerRoute === "VPS") && runnerProvider === null ? ["CI_RUNNER_PROVIDER_BINDING"] : []),
      ...(deploymentRoute === "PROJECT_DEFINED" ? ["DEPLOYMENT_ROUTE"] : []),
      ...((deploymentRoute === "MANAGED" || deploymentRoute === "VPS") && deploymentProvider === null ? ["DEPLOYMENT_PROVIDER_BINDING"] : []),
      ...(environmentIds.length === 0 ? ["DEPLOYMENT_ENVIRONMENT_BINDING"] : []),
      ...(weeklyRunnerMinutes === null ? ["RUNNER_MINUTES_BOUNDARY"] : []),
    ],
    discovery_inputs: discovery.filter((fact) => typeof fact?.fact_id === "string" && (fact.fact_id.startsWith("delivery.") || fact.fact_id.startsWith("tool.") || fact.fact_id.startsWith("repositories.")))
      .map((fact) => fact.fact_id).sort(compareUtf8),
  };
  policy.policy_sha256 = canonicalDigest(policy);
  validateDeliveryPolicy(policy);
  return policy;
}

function validateDiscoveryFacts(discovery) {
  assert(Array.isArray(discovery), "delivery probe discovery must be an array");
  for (const fact of discovery) {
    requireRecord(fact, "delivery probe discovery fact");
    requireString(fact.fact_id, "delivery probe discovery fact ID");
    assert(fact.secret_free === true, "delivery probe discovery fact must be secret-free");
  }
}

export function createDeliveryProbePlan({policy, discovery = []} = {}) {
  validateDeliveryPolicy(policy);
  validateDiscoveryFacts(discovery);
  const base = {
    schema: DELIVERY_PROBE_PLAN_SCHEMA,
    version: 1,
    status: "READ_ONLY_PLAN",
    policy_sha256: policy.policy_sha256,
    discovery_digest_sha256: canonicalDigest(discovery),
    allowed_operations: [...SAFE_PROBE_OPERATIONS],
    prohibited_operations: [...PROHIBITED_PROBE_OPERATIONS],
    probes: [
      {
        probe_id: "SOURCE_CONTROL_LOCAL_READBACK",
        class: "LOCAL_GIT_READBACK",
        commands: ["git rev-parse --show-toplevel", "git branch --show-current", "git status --porcelain=v1", "git rev-parse HEAD"],
        expected_effects: {network: false, authentication: false, spending: false, writes: false},
      },
      {
        probe_id: "RUNNER_CAPABILITY_READBACK",
        class: "LOCAL_TOOL_AVAILABILITY_READBACK",
        route: policy.ci_runner.route,
        expected_effects: {network: false, authentication: false, spending: false, writes: false},
      },
      {
        probe_id: "DELIVERY_MARKER_READBACK",
        class: "LOCAL_MARKER_READBACK",
        route: policy.deployment.route,
        expected_effects: {network: false, authentication: false, spending: false, writes: false},
      },
      {
        probe_id: "REMOTE_PUSH_MERGE_AUTHORITY",
        class: "OWNER_BOUNDARY_NOT_RUN",
        expected_effects: {network: false, authentication: false, spending: false, writes: false},
      },
      {
        probe_id: "DEPLOYMENT_ROLLBACK_PROOF",
        class: "OWNER_BOUNDARY_NOT_RUN",
        expected_effects: {network: false, authentication: false, spending: false, writes: false},
      },
    ],
  };
  const plan = {...base, probe_plan_sha256: canonicalDigest(base)};
  secretFree(plan, "delivery probe plan");
  return plan;
}

export function validateDeliveryProbePlan(plan) {
  requireRecord(plan, "delivery probe plan");
  assert(plan.schema === DELIVERY_PROBE_PLAN_SCHEMA && plan.version === 1 && plan.status === "READ_ONLY_PLAN", "delivery probe plan identity is invalid");
  requireSha(plan.policy_sha256, "delivery probe policy digest");
  requireSha(plan.discovery_digest_sha256, "delivery probe discovery digest");
  assert(Array.isArray(plan.allowed_operations) && plan.allowed_operations.every((value) => SAFE_PROBE_OPERATIONS.includes(value))
    && new Set(plan.allowed_operations).size === plan.allowed_operations.length, "delivery probe allowed operations are invalid");
  assert(Array.isArray(plan.prohibited_operations) && PROHIBITED_PROBE_OPERATIONS.every((value) => plan.prohibited_operations.includes(value))
    && new Set(plan.prohibited_operations).size === plan.prohibited_operations.length
    && plan.allowed_operations.every((value) => !plan.prohibited_operations.includes(value)), "delivery probe prohibitions are incomplete");
  assert(Array.isArray(plan.probes) && plan.probes.length === 5, "delivery probe plan must contain the canonical five probes");
  const probeIds = new Set();
  for (const probe of plan.probes) {
    requireRecord(probe, "delivery probe plan entry");
    requireId(probe.probe_id, "delivery probe plan ID");
    assert(!probeIds.has(probe.probe_id), "delivery probe plan IDs must be unique");
    probeIds.add(probe.probe_id);
    requireString(probe.class, "delivery probe plan class");
    requireRecord(probe.expected_effects, "delivery probe expected effects");
    assert(probe.expected_effects.network === false && probe.expected_effects.authentication === false
      && probe.expected_effects.spending === false && probe.expected_effects.writes === false,
    "delivery probe plan permits a prohibited effect");
  }
  requireSha(plan.probe_plan_sha256, "delivery probe plan digest");
  const body = structuredClone(plan);
  delete body.probe_plan_sha256;
  assert(plan.probe_plan_sha256 === canonicalDigest(body), "delivery probe plan is not content-addressed");
  secretFree(plan, "delivery probe plan");
  return plan;
}

function canonicalRoot(projectRoot) {
  requireString(projectRoot, "delivery probe project root");
  const absolute = path.resolve(projectRoot);
  const stat = fs.lstatSync(absolute);
  assert(!stat.isSymbolicLink() && stat.isDirectory(), "delivery probe project root must be a real directory");
  return fs.realpathSync.native(absolute);
}

function localRead(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: process.env.PATH ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    windowsHide: true,
  });
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return {
    installed: result.error?.code !== "ENOENT",
    exit_code: Number.isInteger(result.status) ? result.status : null,
    stdout,
    stderr,
  };
}

function outputEvidence(value) {
  return {sha256: crypto.createHash("sha256").update(value, "utf8").digest("hex"), length: value.length};
}

function factStatus(discovery, prefix) {
  const matching = discovery.filter((fact) => fact.fact_id.startsWith(prefix));
  if (matching.some((fact) => fact.status === "CONFLICT" || fact.epistemic_class === "CONFLICT")) return "CONFLICT";
  if (matching.some((fact) => fact.status === "UNKNOWN" || fact.epistemic_class === "UNKNOWN")) return "UNPROVEN";
  if (matching.length > 0) return "PASS";
  return "UNPROVEN";
}

export function validateDeliveryProbeResults(results, {planSha256 = null, policySha256 = null, discoveryDigestSha256 = null} = {}) {
  requireRecord(results, "delivery probe results");
  assert(results.schema === DELIVERY_PROBE_RESULTS_SCHEMA && results.version === 1, "delivery probe result identity is invalid");
  assert(["READ_ONLY_PROBES_COMPLETE", "CONFLICT"].includes(results.status), "delivery probe results status is invalid");
  requireSha(results.probe_plan_sha256, "delivery probe plan digest");
  requireRecord(results.binding, "delivery probe binding");
  for (const field of ["plan_sha256", "delivery_policy_sha256", "discovery_digest_sha256"]) requireSha(results.binding[field], `delivery probe binding ${field}`);
  if (planSha256 !== null) assert(results.binding.plan_sha256 === planSha256, "delivery probe result is bound to a different exact plan");
  if (policySha256 !== null) assert(results.binding.delivery_policy_sha256 === policySha256, "delivery probe result is bound to a different delivery policy");
  if (discoveryDigestSha256 !== null) assert(results.binding.discovery_digest_sha256 === discoveryDigestSha256, "delivery probe result is bound to different discovery");
  requireString(results.binding.project_root, "delivery probe binding project root");
  assert(path.isAbsolute(results.binding.project_root) && !results.binding.project_root.endsWith(path.sep), "delivery probe binding project root must be canonical absolute path");
  assert(results.operations?.read_only === true && results.operations?.authentication_attempted === false
    && results.operations?.network_attempted === false && results.operations?.spending_attempted === false
    && results.operations?.writes_attempted === false && results.operations?.publication_attempted === false
    && results.operations?.deployment_attempted === false && results.operations?.rollback_attempted === false,
  "delivery probe results claim a prohibited operation");
  assert(Array.isArray(results.results) && results.results.length > 0, "delivery probe results are empty");
  const resultIds = new Set();
  for (const result of results.results) {
    requireRecord(result, "delivery probe result entry");
    requireId(result.probe_id, "delivery probe result ID");
    assert(!resultIds.has(result.probe_id), "delivery probe result IDs must be unique");
    resultIds.add(result.probe_id);
    assert(PROBE_STATUSES.includes(result.status), "delivery probe result status is invalid");
    requireString(result.observation, "delivery probe observation");
    requireRecord(result.evidence, "delivery probe evidence");
    secretFree(result, "delivery probe result");
  }
  requireSha(results.result_sha256, "delivery probe result digest");
  const body = structuredClone(results);
  delete body.result_sha256;
  assert(results.result_sha256 === canonicalDigest(body), "delivery probe results are not content-addressed");
  return results;
}

export function runDeliveryProbes({projectRoot, policy, discovery = [], planSha256} = {}) {
  validateDeliveryPolicy(policy);
  validateDiscoveryFacts(discovery);
  requireSha(planSha256, "delivery probe exact plan digest");
  const root = canonicalRoot(projectRoot);
  const probePlan = createDeliveryProbePlan({policy, discovery});
  validateDeliveryProbePlan(probePlan);
  const topLevel = localRead("git", ["rev-parse", "--show-toplevel"], root);
  const branch = localRead("git", ["branch", "--show-current"], root);
  const status = localRead("git", ["status", "--porcelain=v1"], root);
  const head = localRead("git", ["rev-parse", "HEAD"], root);
  const topLevelPath = topLevel.exit_code === 0 && topLevel.stdout.length > 0 ? (() => {
    try { return fs.realpathSync.native(topLevel.stdout); } catch { return null; }
  })() : null;
  const sourceControlStatus = topLevelPath === root && head.exit_code === 0 && HEX40.test(head.stdout)
    ? "PASS"
    : topLevel.installed ? "CONFLICT" : "UNAVAILABLE";
  const markerStatus = factStatus(discovery, "delivery.marker.");
  const toolStatus = factStatus(discovery, "tool.");
  const results = [
    {
      probe_id: "SOURCE_CONTROL_LOCAL_READBACK",
      status: sourceControlStatus,
      observation: sourceControlStatus === "PASS" ? `git repository readback succeeded; worktree_clean=${status.exit_code === 0 && status.stdout.length === 0}` : "git repository identity could not be proven inside the project root",
      evidence: {source: "LOCAL_READ_ONLY", branch: branch.exit_code === 0 ? branch.stdout : null, head_sha256: head.exit_code === 0 && HEX40.test(head.stdout) ? head.stdout : null, output: {top_level: outputEvidence(topLevel.stdout), branch: outputEvidence(branch.stdout), status: outputEvidence(status.stdout), head: outputEvidence(head.stdout)}},
    },
    {
      probe_id: "RUNNER_CAPABILITY_READBACK",
      status: toolStatus,
      observation: toolStatus === "PASS" ? "local tool availability was read from secret-free discovery facts" : "no runner capability fact was proven by discovery",
      evidence: {source: "DISCOVERY_READ_ONLY", matching_fact_ids: discovery.filter((fact) => fact.fact_id.startsWith("tool.")).map((fact) => fact.fact_id).sort(compareUtf8)},
    },
    {
      probe_id: "DELIVERY_MARKER_READBACK",
      status: markerStatus,
      observation: markerStatus === "PASS" ? "delivery markers were read from the project root" : markerStatus === "CONFLICT" ? "an unsafe delivery marker requires owner review" : "no delivery marker was proven",
      evidence: {source: "DISCOVERY_READ_ONLY", matching_fact_ids: discovery.filter((fact) => fact.fact_id.startsWith("delivery.marker.")).map((fact) => fact.fact_id).sort(compareUtf8)},
    },
    {
      probe_id: "REMOTE_PUSH_MERGE_AUTHORITY",
      status: "NOT_RUN_OWNER_BOUNDARY",
      observation: "remote authentication, push, merge, and provider quota were not attempted",
      evidence: {source: "GOVERNANCE_PROHIBITION", policy_sha256: policy.policy_sha256},
    },
    {
      probe_id: "DEPLOYMENT_ROLLBACK_PROOF",
      status: "NOT_RUN_OWNER_BOUNDARY",
      observation: "deployment, hosting, rollback, and production access were not attempted",
      evidence: {source: "GOVERNANCE_PROHIBITION", policy_sha256: policy.policy_sha256},
    },
  ];
  const body = {
    schema: DELIVERY_PROBE_RESULTS_SCHEMA,
    version: 1,
    status: results.some((result) => result.status === "CONFLICT") ? "CONFLICT" : "READ_ONLY_PROBES_COMPLETE",
    probe_plan_sha256: probePlan.probe_plan_sha256,
    binding: {plan_sha256: planSha256, delivery_policy_sha256: policy.policy_sha256, discovery_digest_sha256: canonicalDigest(discovery), project_root: root},
    operations: {
      read_only: true,
      authentication_attempted: false,
      network_attempted: false,
      spending_attempted: false,
      writes_attempted: false,
      publication_attempted: false,
      deployment_attempted: false,
      rollback_attempted: false,
    },
    results,
  };
  const output = {...body, result_sha256: canonicalDigest(body)};
  validateDeliveryProbeResults(output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("delivery policy controller loaded\n");
