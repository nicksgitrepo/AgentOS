#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";

const SHA256 = /^[0-9a-f]{64}$/;
const SOURCES = new Set(["DETECTED", "RECOMMENDED", "USER_SELECTED", "IMPORTED"]);
const EFFECTS = new Set([
  "IMMEDIATE", "NEXT_HANDOFF", "NEXT_CAMPAIGN",
  "REQUIRES_MIGRATION", "OWNER_CONFIRMATION",
]);
const AUTHORITY_CORPUS_CHOICES = new Set(["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW"]);
const DESIGN_CHOICES = new Set([
  ...AUTHORITY_CORPUS_CHOICES, "DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE",
]);
const WORKER_STATUSES = new Set([
  "NOT_READY", "READY_TO_SPAWN", "ACTIVE", "RETURNED_FINDINGS",
  "RECONCILED", "ARCHIVED",
]);
const CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW", "UNCONFIRMED"]);
const VALUE_TYPES = new Set(["STRING", "BOOLEAN", "INTEGER", "STRING_LIST", "JSON"]);
const REQUIRED_GROUPS = [
  "project", "authority_corpus", "design_bible", "version_control", "models",
  "agents", "evidence", "hosting", "workflow",
];
const PROVIDER_DISCOVERY = [
  ["GITHUB", "gh", ["auth", "status"]],
  ["GITLAB", "glab", ["auth", "status"]],
  ["AWS", "aws", ["sts", "get-caller-identity"]],
  ["CLOUDFLARE", "wrangler", ["whoami"]],
  ["VERCEL", "vercel", ["whoami"]],
  ["NETLIFY", "netlify", ["status"]],
  ["FLY_IO", "flyctl", ["auth", "whoami"]],
  ["GOOGLE_CLOUD", "gcloud", ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]],
  ["AZURE", "az", ["account", "show", "--output", "none"]],
  ["DIGITALOCEAN", "doctl", ["account", "get", "--output", "json"]],
  ["KUBERNETES", "kubectl", ["config", "current-context"]],
  ["DOCKER", "docker", ["info", "--format", "{{json .Name}}"]],
  ["TERRAFORM", "terraform", ["version"]],
];
const WORKER_TRANSITIONS = new Map([
  ["NOT_READY", new Set(["READY_TO_SPAWN"])],
  ["READY_TO_SPAWN", new Set(["ACTIVE"])],
  ["ACTIVE", new Set(["RETURNED_FINDINGS"])],
  ["RETURNED_FINDINGS", new Set(["RECONCILED"])],
  ["RECONCILED", new Set(["ARCHIVED"])],
  ["ARCHIVED", new Set()],
]);
const AUDIT_TRANSITIONS = new Map([
  ["NOT_READY", new Set(["ACTIVE"])],
  ["ACTIVE", new Set(["RETURNED"])],
  ["RETURNED", new Set(["ACCEPTED"])],
  ["ACCEPTED", new Set()],
]);

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields mismatch`);
  }
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(utf8Compare).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function requireUtc(value, label) {
  requireString(value, label);
  if (!value.endsWith("Z") || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be a valid UTC timestamp`);
  }
}

function validateTypedValue(value, valueType, label) {
  if (!VALUE_TYPES.has(valueType)) throw new Error(`${label} value_type is invalid`);
  if (valueType === "STRING" && (typeof value !== "string" || value.length === 0)) {
    throw new Error(`${label} must be a nonempty string`);
  }
  if (valueType === "BOOLEAN" && typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
  if (valueType === "INTEGER" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  if (valueType === "STRING_LIST"
      && (!Array.isArray(value) || value.some((item) =>
        typeof item !== "string" || item.length === 0))) {
    throw new Error(`${label} must be a string list`);
  }
  if (valueType === "JSON"
      && (value === undefined || typeof value === "function" || typeof value === "symbol"
        || JSON.stringify(value) === undefined)) {
    throw new Error(`${label} must be JSON-compatible`);
  }
}

function inferValueType(value) {
  if (typeof value === "string") return "STRING";
  if (typeof value === "boolean") return "BOOLEAN";
  if (Number.isSafeInteger(value)) return "INTEGER";
  if (Array.isArray(value)
      && value.every((item) => typeof item === "string" && item.length > 0)) {
    return "STRING_LIST";
  }
  return "JSON";
}

function validatePreferenceRecord(record, label) {
  exactKeys(record, [
    "value", "value_type", "source", "confidence", "last_changed_at",
    "changed_by", "effective_from", "requires_revalidation",
  ], label);
  validateTypedValue(record.value, record.value_type, `${label} value`);
  requireString(record.changed_by, `${label} actor`);
  requireUtc(record.last_changed_at, `${label} timestamp`);
  if (!SOURCES.has(record.source) || !CONFIDENCE.has(record.confidence)
      || !EFFECTS.has(record.effective_from)
      || !Array.isArray(record.requires_revalidation)
      || record.requires_revalidation.some((item) =>
        typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} metadata is invalid`);
  }
}

function appendPreferenceHistory(
  state, group, key, previousRecord, nextRecord, actor, at,
) {
  const entry = {
    sequence: state.preference_history.length + 1,
    group,
    key,
    previous_preference_sha256: previousRecord === undefined || previousRecord === null
      ? null : digest(previousRecord),
    new_preference_sha256: digest(nextRecord),
    changed_by: actor,
    changed_at: at,
    previous_event_sha256: state.preference_history_head_sha256,
  };
  const sealed = {...entry, event_sha256: digest(entry)};
  state.preference_history.push(sealed);
  state.preference_history_head_sha256 = sealed.event_sha256;
}

function canonicalRoot(root) {
  requireString(root, "project root");
  const resolved = fs.realpathSync(root);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("project root must be a directory");
  return resolved;
}

function existsInside(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  const prefix = `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new Error("discovery path escapes project root");
  }
  return fs.existsSync(candidate);
}

function existingDistinctPaths(root, candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (!existsInside(root, candidate)) continue;
    const real = fs.realpathSync(path.resolve(root, candidate));
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
      throw new Error("discovery path escapes project root through symlink");
    }
    const stat = fs.statSync(real);
    const identity = `${stat.dev}:${stat.ino}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(candidate);
    }
  }
  return result;
}

function fixedCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 10_000, env: process.env,
  });
  return {
    installed: result.error?.code !== "ENOENT",
    exit_code: Number.isInteger(result.status) ? result.status : null,
    stdout: (result.stdout ?? "").trim().slice(0, 2_000),
    stderr: (result.stderr ?? "").trim().slice(0, 2_000),
  };
}

export function discoverEnvironment(projectRoot) {
  const root = canonicalRoot(projectRoot);
  const git = fixedCommand("git", ["rev-parse", "--show-toplevel"], root);
  const gitTopLevel = git.exit_code === 0 ? fs.realpathSync(git.stdout) : null;
  const repositoryVerified = gitTopLevel === root;
  const remote = repositoryVerified
    ? fixedCommand("git", ["remote", "get-url", "origin"], root)
    : {installed: git.installed, exit_code: null, stdout: "", stderr: ""};
  let safeRemote = null;
  let remoteSecretMaterialRejected = false;
  if (remote.exit_code === 0) {
    if (remote.stdout.includes("://")) {
      const parsed = new URL(remote.stdout);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        remoteSecretMaterialRejected = true;
      } else {
        safeRemote = parsed.toString();
      }
    } else if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(remote.stdout)) {
      const separator = remote.stdout.indexOf(":");
      const host = remote.stdout.slice(4, separator);
      const repositoryPath = remote.stdout.slice(separator + 1);
      safeRemote = `ssh://${host}/${repositoryPath}`;
    } else if (!/[\r\n\0@?#]/.test(remote.stdout)) {
      safeRemote = remote.stdout;
    } else {
      remoteSecretMaterialRejected = true;
    }
  }
  const authorityCandidates = existingDistinctPaths(root, [
    "authority", "authority-corpus", "docs/authority", "authority_corpus",
  ]);
  const designCandidates = existingDistinctPaths(root, [
    "Design Bible", "design-bible", "docs/design", "design-system",
  ]);
  const deploymentMarkers = [
    ".openai/hosting.json", "wrangler.toml", "vercel.json", "Dockerfile",
    "docker-compose.yml", "compose.yml", "fly.toml", "netlify.toml",
  ].filter((candidate) => existsInside(root, candidate));
  return {
    schema: "governance.bootstrap_discovery.v1",
    project_root: root,
    authority_candidates: authorityCandidates,
    design_candidates: designCandidates,
    version_control: {
      git_installed: git.installed,
      repository_verified: repositoryVerified,
      parent_repository_rejected: git.exit_code === 0 && !repositoryVerified,
      remote_present: safeRemote !== null,
      remote: safeRemote,
      remote_secret_material_rejected: remoteSecretMaterialRejected,
    },
    provider_tools: Object.fromEntries(PROVIDER_DISCOVERY.map(
      ([provider, command, args]) => {
        const result = fixedCommand(command, args, root);
        return [provider, {
          command,
          installed: result.installed,
          authenticated_identity_verified: result.exit_code === 0,
          required_permission_verified: false,
        }];
      },
    )),
    deployment_markers: deploymentMarkers,
    secret_values_read_or_retained: false,
  };
}

function preference(
  value, valueType, source, changedBy, changedAt, effect, revalidation,
  confidence = source === "DETECTED" ? "HIGH" : "UNCONFIRMED",
) {
  validateTypedValue(value, valueType, "preference value");
  requireString(changedBy, "preference actor");
  requireUtc(changedAt, "preference timestamp");
  if (!SOURCES.has(source) || !EFFECTS.has(effect) || !CONFIDENCE.has(confidence)
      || !Array.isArray(revalidation)
      || revalidation.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("preference metadata is invalid");
  }
  return {
    value,
    value_type: valueType,
    source,
    confidence,
    last_changed_at: changedAt,
    changed_by: changedBy,
    effective_from: effect,
    requires_revalidation: revalidation,
  };
}

export function createBootstrapState(discovery, now = new Date().toISOString()) {
  requireRecord(discovery, "discovery");
  if (discovery.schema !== "governance.bootstrap_discovery.v1") {
    throw new Error("discovery schema mismatch");
  }
  return {
    schema: "governance.dynamic_bootstrap_state.v1",
    governance_version: "2.1rc",
    bootstrap_role: "Bootstrap 2.1rc",
    state_revision: 0,
    updated_at: now,
    project_root: discovery.project_root,
    discovery: structuredClone(discovery),
    discovery_digest_sha256: digest(discovery),
    tracks: {
      authority_corpus: {
        choice: null,
        source_path: null,
        detected_source_paths: [...discovery.authority_candidates],
        worker_status: "NOT_READY",
        worker_binding: null,
        findings_digest_sha256: null,
      },
      design_bible: {
        choice: null,
        source_path: null,
        detected_source_paths: [...discovery.design_candidates],
        worker_status: "NOT_READY",
        worker_binding: null,
        findings_digest_sha256: null,
      },
    },
    configuration: Object.fromEntries(REQUIRED_GROUPS.map((group) => [group, {}])),
    answers: {},
    preference_history: [],
    preference_history_head_sha256: "0".repeat(64),
    active_question_id: "authority_corpus_choice",
    blocker: null,
    audit: {
      status: "NOT_READY",
      auditor_binding: null,
      report_digest_sha256: null,
    },
    sealed_snapshots: [],
  };
}

const QUESTIONS = [
  {
    id: "authority_corpus_choice",
    applies: (state) => state.tracks.authority_corpus.choice === null,
    fact: "No admitted authority corpus choice exists.",
    prompt: "Should Bootstrap import an existing corpus, refactor a previous governance corpus, or create a new one?",
    recommended: "CREATE_NEW",
    choices: ["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW"],
  },
  {
    id: "authority_corpus_source_path",
    applies: (state) => ["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(
      state.tracks.authority_corpus.choice?.value,
    ) && state.tracks.authority_corpus.source_path === null,
    fact: "The selected authority-corpus operation requires an explicit source.",
    prompt: "Which detected authority-corpus source should remain read-only input?",
    recommended: (state) => state.tracks.authority_corpus.detected_source_paths[0] ?? null,
    choices: (state) => state.tracks.authority_corpus.detected_source_paths,
  },
  {
    id: "project_name",
    applies: (state) => state.configuration.project.name === undefined,
    fact: "The portable project has no admitted display name.",
    prompt: "What should this project be called?",
    recommended: (state) => path.basename(state.project_root),
    choices: (state) => [path.basename(state.project_root)],
    answer_type: "STRING",
    allow_custom: true,
  },
  {
    id: "versioning_enabled",
    applies: (state) => state.configuration.version_control.enabled === undefined,
    fact: "Version-control preference is not established.",
    prompt: "Should this project use version control?",
    recommended: true,
    choices: [true, false],
  },
  {
    id: "version_control_provider",
    applies: (state) => state.configuration.version_control.enabled?.value === true
      && state.configuration.version_control.provider === undefined,
    fact: "Version control is enabled but its provider is not selected.",
    prompt: "Which version-control provider should hold the project?",
    recommended: "GITHUB",
    choices: ["GITHUB", "GITLAB", "BITBUCKET", "LOCAL_GIT_ONLY", "OTHER"],
  },
  {
    id: "provider_inventory",
    applies: (state) => state.configuration.version_control.enabled?.value === true
      && state.configuration.version_control.providers === undefined,
    fact: "The complete provider inventory is not established.",
    prompt: "Which version-control, hosting, infrastructure, routing, database, or API providers should Bootstrap track?",
    recommended: (state) => {
      const detected = Object.entries(state.discovery.provider_tools)
        .filter(([, value]) => value.installed)
        .map(([provider]) => provider);
      const primary = state.configuration.version_control.provider?.value;
      return [...new Set([primary, ...detected].filter(Boolean))];
    },
    choices: (state) => {
      const primary = state.configuration.version_control.provider?.value;
      return [[primary].filter(Boolean), ["GITHUB"], ["GITLAB"], []];
    },
    answer_type: "STRING_LIST",
    allow_custom: true,
  },
  {
    id: "release_strategy",
    applies: (state) => state.configuration.version_control.enabled?.value === true
      && state.configuration.version_control.release_strategy === undefined,
    fact: "Release/version handling is not established.",
    prompt: "How should accepted milestones be versioned?",
    recommended: "SEMANTIC_TAGS_AT_ACCEPTED_MILESTONES",
    choices: [
      "SEMANTIC_TAGS_AT_ACCEPTED_MILESTONES",
      "DATE_BASED_TAGS_AT_ACCEPTED_MILESTONES",
      "COMMITS_ONLY_NO_RELEASE_TAGS",
      "CUSTOM",
    ],
  },
  {
    id: "repository_visibility",
    applies: (state) => ["GITHUB", "GITLAB", "BITBUCKET"].includes(
      state.configuration.version_control.provider?.value,
    ) && state.configuration.version_control.visibility === undefined,
    fact: "A remote provider is selected but repository visibility is unset.",
    prompt: "Should the authority repository be private or public?",
    recommended: "PRIVATE",
    choices: ["PRIVATE", "PUBLIC"],
  },
  {
    id: "authority_relative_path",
    applies: (state) => state.configuration.authority_corpus.location !== undefined
      && state.configuration.authority_corpus.relative_path === undefined,
    fact: "The authority-corpus path inside its selected location is unset.",
    prompt: "Which relative path should contain the authority corpus?",
    recommended: "authority",
    choices: ["authority", "docs/authority", ".governance/authority"],
    answer_type: "STRING",
    allow_custom: true,
  },
  {
    id: "merge_strategy",
    applies: (state) => state.configuration.version_control.enabled?.value === true
      && state.configuration.version_control.merge_strategy === undefined,
    fact: "Merge behavior is not established.",
    prompt: "How should accepted changes enter the default branch?",
    recommended: "SQUASH",
    choices: ["SQUASH", "MERGE_COMMIT", "REBASE_FAST_FORWARD"],
  },
  {
    id: "deployment_providers",
    applies: (state) => state.configuration.hosting.enabled?.value === true
      && state.configuration.hosting.providers === undefined,
    fact: "Deployment is enabled but its provider set is unset.",
    prompt: "Which one or more deployment, VPS, routing, DNS, database, storage, or API providers should Runtime use?",
    recommended: [],
    choices: [["AWS"], ["CLOUDFLARE"], ["VERCEL"], ["NETLIFY"], []],
    answer_type: "STRING_LIST",
    allow_custom: true,
  },
  {
    id: "authority_location",
    applies: (state) => state.configuration.authority_corpus.location === undefined,
    fact: "The authority-corpus destination is not established.",
    prompt: "Where should the project authority corpus live?",
    recommended: "CURRENT_PROJECT_DIRECTORY",
    choices: ["CURRENT_PROJECT_DIRECTORY", "SEPARATE_LOCAL_DIRECTORY", "SEPARATE_REPOSITORY"],
  },
  {
    id: "deployment_enabled",
    applies: (state) => state.configuration.hosting.enabled === undefined,
    fact: "Deployment intent is not established.",
    prompt: "Will this project be deployed?",
    recommended: false,
    choices: [true, false],
  },
  {
    id: "deployment_mode",
    applies: (state) => state.configuration.hosting.enabled?.value === true
      && state.configuration.hosting.mode === undefined,
    fact: "Deployment is enabled but the hosting mode is unset.",
    prompt: "Which hosting mode should Bootstrap configure?",
    recommended: "MANAGED_HOSTING",
    choices: ["MANAGED_HOSTING", "VPS", "CONTAINER_PLATFORM", "SERVERLESS", "OTHER"],
  },
  {
    id: "evidence_retention_days",
    applies: (state) => state.configuration.evidence.active_days === undefined,
    fact: "Active loose-evidence retention is not established.",
    prompt: "How many days should release evidence remain loose before verified ZIP compaction?",
    recommended: 14,
    choices: [7, 14, 30, 90],
    answer_type: "INTEGER",
    allow_custom: true,
  },
  {
    id: "orchestrator_model_policy",
    applies: (state) => state.configuration.models.orchestrator_policy === undefined,
    fact: "The orchestration model policy is unset.",
    prompt: "Which mutable model policy should resolve the campaign Orchestrator?",
    recommended: "HIGH_RETURN_LOW_OVERENGINEERING",
    choices: [
      "HIGH_RETURN_LOW_OVERENGINEERING",
      "STRONGEST_AVAILABLE",
      "LOW_COST_BALANCED",
      "CUSTOM",
    ],
  },
  {
    id: "specialist_model_policy",
    applies: (state) => state.configuration.models.specialist_policy === undefined,
    fact: "The feature/audit specialist model policy is unset.",
    prompt: "Which mutable model policy should resolve fresh campaign specialists?",
    recommended: "STRONGEST_EFFICIENT",
    choices: ["STRONGEST_EFFICIENT", "STRONGEST_AVAILABLE", "LOW_COST_BALANCED", "CUSTOM"],
  },
  {
    id: "pin_campaign_agents",
    applies: (state) => state.configuration.agents.pin_campaign_agents === undefined,
    fact: "Campaign agent visibility is unset.",
    prompt: "Should fresh campaign Orchestrator, Auditor, Feature, and on-demand Platform agents be pinned while active?",
    recommended: true,
    choices: [true, false],
  },
  {
    id: "archive_completed_agents",
    applies: (state) => state.configuration.agents.archive_completed_agents === undefined,
    fact: "Completed-agent retention behavior is unset.",
    prompt: "Should completed agents be archived without deletion after their compact handoff is recorded?",
    recommended: true,
    choices: [true, false],
  },
  {
    id: "campaign_topology_default",
    applies: (state) => state.configuration.workflow.topology_default === undefined,
    fact: "The default campaign topology is unset.",
    prompt: "Which topology should new campaigns prefer?",
    recommended: "SINGLE_CUMULATIVE_ROOT",
    choices: ["SINGLE_CUMULATIVE_ROOT"],
  },
  {
    id: "progress_interval_minutes",
    applies: (state) => state.configuration.workflow.progress_interval_minutes === undefined,
    fact: "The campaign progress interval is unset.",
    prompt: "How many minutes may pass without concrete progress before broken-chain recovery runs?",
    recommended: 15,
    choices: [5, 10, 15, 30, 60],
    answer_type: "INTEGER",
    allow_custom: true,
  },
  {
    id: "design_bible_choice",
    applies: (state) => state.tracks.design_bible.choice === null,
    fact: "No Design Bible choice exists.",
    prompt: "Should Bootstrap import, refactor, create, or explicitly defer the Design Bible?",
    recommended: "CREATE_NEW",
    choices: [
      "IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW",
      "DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE",
    ],
  },
  {
    id: "design_bible_source_path",
    applies: (state) => ["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(
      state.tracks.design_bible.choice?.value,
    ) && state.tracks.design_bible.source_path === null,
    fact: "The selected Design Bible operation requires an explicit source.",
    prompt: "Which detected Design Bible source should remain read-only input?",
    recommended: (state) => state.tracks.design_bible.detected_source_paths[0] ?? null,
    choices: (state) => state.tracks.design_bible.detected_source_paths,
  },
];

const QUESTION_TARGETS = new Map([
  ["authority_corpus_choice", ["authority_corpus_track", "choice"]],
  ["authority_corpus_source_path", ["authority_corpus_track", "source_path"]],
  ["project_name", ["project", "name"]],
  ["versioning_enabled", ["version_control", "enabled"]],
  ["version_control_provider", ["version_control", "provider"]],
  ["provider_inventory", ["version_control", "providers"]],
  ["repository_visibility", ["version_control", "visibility"]],
  ["merge_strategy", ["version_control", "merge_strategy"]],
  ["release_strategy", ["version_control", "release_strategy"]],
  ["authority_location", ["authority_corpus", "location"]],
  ["authority_relative_path", ["authority_corpus", "relative_path"]],
  ["deployment_enabled", ["hosting", "enabled"]],
  ["deployment_mode", ["hosting", "mode"]],
  ["deployment_providers", ["hosting", "providers"]],
  ["evidence_retention_days", ["evidence", "active_days"]],
  ["orchestrator_model_policy", ["models", "orchestrator_policy"]],
  ["specialist_model_policy", ["models", "specialist_policy"]],
  ["pin_campaign_agents", ["agents", "pin_campaign_agents"]],
  ["archive_completed_agents", ["agents", "archive_completed_agents"]],
  ["campaign_topology_default", ["workflow", "topology_default"]],
  ["progress_interval_minutes", ["workflow", "progress_interval_minutes"]],
  ["design_bible_choice", ["design_bible_track", "choice"]],
  ["design_bible_source_path", ["design_bible_track", "source_path"]],
]);

function choicesFor(question, state) {
  return typeof question.choices === "function" ? question.choices(state) : question.choices;
}

function recommendedFor(question, state) {
  return typeof question.recommended === "function"
    ? question.recommended(state) : question.recommended;
}

function answerMatchesQuestion(question, state, choice) {
  const choices = choicesFor(question, state);
  if (choices.some((candidate) => JSON.stringify(candidate) === JSON.stringify(choice))) {
    return true;
  }
  if (!question.allow_custom) return false;
  validateTypedValue(choice, question.answer_type ?? inferValueType(choice), "custom answer");
  if (question.id === "evidence_retention_days"
      && (choice < 1 || choice > 3650)) return false;
  if (question.id === "progress_interval_minutes"
      && (choice < 1 || choice > 1440)) return false;
  if (question.answer_type === "STRING_LIST"
      && new Set(choice).size !== choice.length) return false;
  return true;
}

function computeNextQuestion(state) {
  if (state.blocker !== null) return null;
  return QUESTIONS.find((candidate) => candidate.applies(state)) ?? null;
}

function answerPolicy(questionId, choice) {
  let effect = "IMMEDIATE";
  let revalidation = [];
  if (questionId === "repository_visibility" && choice === "PUBLIC") {
    effect = "OWNER_CONFIRMATION";
    revalidation = [
      "SECRET_SCAN", "PRIVATE_CONTEXT_SCAN", "EXPLICIT_PUBLICATION_CONFIRMATION",
    ];
  } else if (questionId === "authority_location"
      && choice !== "CURRENT_PROJECT_DIRECTORY") {
    effect = "REQUIRES_MIGRATION";
  } else if ([
    "deployment_mode", "deployment_providers", "evidence_retention_days",
    "orchestrator_model_policy", "specialist_model_policy",
    "campaign_topology_default", "progress_interval_minutes",
  ].includes(questionId)) {
    effect = "NEXT_CAMPAIGN";
  }
  return {effect, revalidation};
}

export function nextBootstrapQuestion(state) {
  validateBootstrapState(state);
  const question = computeNextQuestion(state);
  if (!question) return null;
  const choices = choicesFor(question, state);
  const recommended = recommendedFor(question, state);
  if (choices.length === 0 && !question.allow_custom) {
    throw new Error(`question ${question.id} has no admitted source choices`);
  }
  return {
    question_id: question.id,
    detected_fact: question.fact,
    prompt: question.prompt,
    recommended_choice: recommended,
    choices,
    answer_type: question.answer_type ?? inferValueType(recommended),
    allow_custom: question.allow_custom === true,
    consequences: choices.map((choice) => ({
      choice,
      consequence: `Apply ${JSON.stringify(choice)} to current configuration; sealed history is unchanged.`,
    })),
  };
}

function assignAnswer(state, questionId, choice, actor, at) {
  const selected = QUESTIONS.find((question) => question.id === questionId);
  if (!selected || !selected.applies(state)
      || !answerMatchesQuestion(selected, state, choice)) {
    throw new Error("answer does not match the next applicable question");
  }
  const {effect, revalidation} = answerPolicy(questionId, choice);
  const record = preference(
    choice, inferValueType(choice), "USER_SELECTED", actor, at,
    effect, revalidation, "HIGH",
  );
  const setTrack = (trackName, key) => {
    const previous = state.tracks[trackName][key];
    state.tracks[trackName][key] = record;
    appendPreferenceHistory(
      state, `${trackName}_track`, key, previous, record, actor, at,
    );
  };
  const setConfiguration = (group, key) => {
    const previous = state.configuration[group][key];
    state.configuration[group][key] = record;
    appendPreferenceHistory(state, group, key, previous, record, actor, at);
  };
  const [group, key] = QUESTION_TARGETS.get(questionId);
  if (group === "authority_corpus_track") setTrack("authority_corpus", key);
  else if (group === "design_bible_track") setTrack("design_bible", key);
  else setConfiguration(group, key);
  state.answers[questionId] = {
    choice,
    answered_by: actor,
    answered_at: at,
    preference_sha256: digest(record),
  };
}

export function validateBootstrapTransition(previous, next) {
  validateBootstrapState(previous);
  validateBootstrapState(next);
  if (next.state_revision !== previous.state_revision + 1) {
    throw new Error("bootstrap transition revision is not monotonic");
  }
  if (new Date(next.updated_at).getTime() <= new Date(previous.updated_at).getTime()) {
    throw new Error("bootstrap transition time is not monotonic");
  }
  for (const field of [
    "schema", "governance_version", "bootstrap_role", "project_root",
    "discovery_digest_sha256",
  ]) {
    if (next[field] !== previous[field]) throw new Error(`bootstrap ${field} changed`);
  }
  if (digest(next.discovery) !== digest(previous.discovery)) {
    throw new Error("bootstrap discovery changed");
  }
  for (const field of ["preference_history", "sealed_snapshots"]) {
    if (next[field].length < previous[field].length) {
      throw new Error(`${field} was deleted`);
    }
    for (let index = 0; index < previous[field].length; index += 1) {
      if (JSON.stringify(next[field][index]) !== JSON.stringify(previous[field][index])) {
        throw new Error(`${field} prefix was rewritten`);
      }
    }
  }
}

export function applyBootstrapAnswer(state, answer) {
  validateBootstrapState(state);
  exactKeys(answer, ["question_id", "choice", "answered_by", "answered_at"], "bootstrap answer");
  requireString(answer.question_id, "answer question_id");
  requireString(answer.answered_by, "answer actor");
  requireUtc(answer.answered_at, "answer timestamp");
  const next = structuredClone(state);
  const expected = nextBootstrapQuestion(state);
  if (!expected || expected.question_id !== answer.question_id) {
    throw new Error("answer is not for the one active question");
  }
  assignAnswer(next, answer.question_id, answer.choice, answer.answered_by, answer.answered_at);
  next.state_revision += 1;
  next.updated_at = answer.answered_at;
  next.active_question_id = computeNextQuestion(next)?.id ?? null;
  validateBootstrapTransition(state, next);
  return next;
}

export function changePreference(state, change) {
  validateBootstrapState(state);
  exactKeys(change, [
    "group", "key", "value", "value_type", "source", "confidence",
    "changed_by", "changed_at", "effective_from", "requires_revalidation",
  ], "preference change");
  if (!REQUIRED_GROUPS.includes(change.group)) throw new Error("unknown preference group");
  requireString(change.key, "preference key");
  requireString(change.changed_by, "preference change actor");
  requireUtc(change.changed_at, "preference change time");
  const next = structuredClone(state);
  const record = preference(
    change.value, change.value_type, change.source, change.changed_by,
    change.changed_at, change.effective_from, change.requires_revalidation,
    change.confidence,
  );
  const previous = next.configuration[change.group][change.key];
  if (previous !== undefined && previous.value_type !== change.value_type) {
    throw new Error("preference type change requires an admitted schema migration");
  }
  next.configuration[change.group][change.key] = record;
  appendPreferenceHistory(
    next, change.group, change.key, previous, record,
    change.changed_by, change.changed_at,
  );
  next.state_revision += 1;
  next.updated_at = change.changed_at;
  next.active_question_id = computeNextQuestion(next)?.id ?? null;
  validateBootstrapTransition(state, next);
  return next;
}

function minimumAuthorityCorpusReady(state) {
  const choice = state.tracks.authority_corpus.choice?.value;
  return AUTHORITY_CORPUS_CHOICES.has(choice)
    && (!["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(choice)
      || state.tracks.authority_corpus.source_path !== null)
    && state.configuration.project.name !== undefined
    && state.configuration.version_control.enabled !== undefined
    && state.configuration.authority_corpus.location !== undefined
    && state.configuration.authority_corpus.relative_path !== undefined
    && state.configuration.evidence.active_days !== undefined;
}

function minimumDesignReady(state) {
  const choice = state.tracks.design_bible.choice?.value;
  return minimumAuthorityCorpusReady(state)
    && DESIGN_CHOICES.has(choice)
    && (!["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(choice)
      || state.tracks.design_bible.source_path !== null)
    && state.configuration.models.orchestrator_policy !== undefined
    && state.configuration.models.specialist_policy !== undefined
    && state.configuration.agents.pin_campaign_agents !== undefined
    && state.configuration.agents.archive_completed_agents !== undefined
    && state.configuration.workflow.topology_default !== undefined
    && state.configuration.workflow.progress_interval_minutes !== undefined;
}

export function compileWorkerActivation(state, workerKind, resolvedModel) {
  validateBootstrapState(state);
  requireRecord(resolvedModel, "resolved model");
  exactKeys(resolvedModel, ["model", "reasoning", "policy"], "resolved model");
  requireString(resolvedModel.model, "resolved worker model");
  requireString(resolvedModel.reasoning, "resolved worker reasoning");
  requireString(resolvedModel.policy, "resolved worker model policy");
  const isAuthorityCorpus = workerKind === "AUTHORITY_CORPUS";
  if (!isAuthorityCorpus && workerKind !== "DESIGN_BIBLE") throw new Error("worker kind is invalid");
  if ((isAuthorityCorpus && !minimumAuthorityCorpusReady(state)) || (!isAuthorityCorpus && !minimumDesignReady(state))) {
    throw new Error("worker foundation is incomplete");
  }
  const track = isAuthorityCorpus ? state.tracks.authority_corpus : state.tracks.design_bible;
  if (!["NOT_READY", "READY_TO_SPAWN"].includes(track.worker_status)) {
    throw new Error("worker already exists or completed");
  }
  return {
    schema: "governance.bootstrap_worker_activation.v1",
    worker_kind: workerKind,
    display_name: isAuthorityCorpus ? "authority corpus 2.1rc" : "DesignBible 2.1rc",
    governance_version: "2.1rc",
    model_policy: resolvedModel.policy,
    resolved_model: resolvedModel.model,
    reasoning: resolvedModel.reasoning,
    goal_kind: isAuthorityCorpus ? "AUTHORITY_CORPUS_SETUP" : "DESIGN_BIBLE_SETUP",
    source_mode: track.choice.value,
    source_path: track.source_path?.value ?? null,
    source_mutation_forbidden: true,
    bootstrap_state_digest_sha256: digest(state),
    return: "ONE_COMPACT_SELF_CHECK_FINDINGS_REPORT_TO_BOOTSTRAP",
  };
}

export function nextBootstrapHostAction(state, resolvedModel = null) {
  validateBootstrapState(state);
  const question = nextBootstrapQuestion(state);
  if (question !== null) return {action: "ASK_ONE_QUESTION", question};
  const designDeferred = state.tracks.design_bible.choice?.value
    === "DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE";
  for (const [workerKind, trackName] of [
    ["AUTHORITY_CORPUS", "authority_corpus"], ["DESIGN_BIBLE", "design_bible"],
  ]) {
    if (trackName === "design_bible" && designDeferred) continue;
    const track = state.tracks[trackName];
    if (["NOT_READY", "READY_TO_SPAWN"].includes(track.worker_status)) {
      if (resolvedModel === null) {
        return {
          action: "RESOLVE_MODEL_POLICY",
          policy: "balanced_large_low_overengineering",
          recipient: workerKind,
        };
      }
      return {
        action: "SPAWN_AND_PIN_TEMPORARY_WORKER",
        activation: compileWorkerActivation(state, workerKind, resolvedModel),
      };
    }
    if (track.worker_status === "ACTIVE") {
      return {action: "WAIT_FOR_BOUND_WORKER", worker_kind: workerKind};
    }
    if (track.worker_status === "RETURNED_FINDINGS") {
      return {
        action: "RECONCILE_MATERIAL_FINDINGS_ONE_QUESTION_AT_A_TIME",
        worker_kind: workerKind,
        findings_digest_sha256: track.findings_digest_sha256,
      };
    }
    if (track.worker_status === "RECONCILED") {
      return {
        action: "ARCHIVE_TEMPORARY_WORKER_WITHOUT_DELETION",
        worker_kind: workerKind,
        session_id: track.worker_binding.session_id,
      };
    }
  }
  if (state.audit.status === "NOT_READY") {
    return {
      action: "SPAWN_AND_PIN_FRESH_SETUP_AUDITOR",
      display_name: "Auditor 2.1rc",
      governance_version: "2.1rc",
      model_policy: state.configuration.models.specialist_policy.value,
      scope: "READ_ONLY_BOOTSTRAP_AUTHORITY_CORPUS_DESIGN_CONSISTENCY",
    };
  }
  if (state.audit.status === "ACTIVE") {
    return {action: "WAIT_FOR_BOUND_SETUP_AUDITOR"};
  }
  if (state.audit.status === "RETURNED") {
    return {
      action: "RECONCILE_AUDIT_FINDINGS_ONE_QUESTION_AT_A_TIME",
      report_digest_sha256: state.audit.report_digest_sha256,
    };
  }
  if (state.audit.status === "ACCEPTED") {
    return {action: "SEAL_APPEND_ONLY_CONFIGURATION_SNAPSHOT"};
  }
  throw new Error("Bootstrap has no deterministic next host action");
}

export function applyWorkerTransition(state, transition) {
  validateBootstrapState(state);
  exactKeys(transition, [
    "worker_kind", "from_status", "to_status", "worker_binding",
    "findings_digest_sha256", "changed_by", "changed_at",
  ], "worker transition");
  const trackName = transition.worker_kind === "AUTHORITY_CORPUS"
    ? "authority_corpus"
    : transition.worker_kind === "DESIGN_BIBLE"
      ? "design_bible"
      : null;
  if (trackName === null) throw new Error("worker transition kind is invalid");
  requireString(transition.changed_by, "worker transition actor");
  requireUtc(transition.changed_at, "worker transition time");
  const current = state.tracks[trackName];
  if (current.worker_status !== transition.from_status
      || !WORKER_TRANSITIONS.get(transition.from_status)?.has(transition.to_status)) {
    throw new Error("worker transition is not monotonic");
  }
  const next = structuredClone(state);
  const target = next.tracks[trackName];
  target.worker_status = transition.to_status;
  if (transition.to_status === "READY_TO_SPAWN") {
    if (transition.worker_binding !== null || transition.findings_digest_sha256 !== null) {
      throw new Error("ready worker transition cannot carry execution evidence");
    }
  } else {
    validateWorkerBinding(
      transition.worker_binding,
      trackName === "authority_corpus" ? "authority corpus 2.1rc" : "DesignBible 2.1rc",
      `${trackName} worker transition binding`,
    );
    if (current.worker_binding !== null
        && JSON.stringify(current.worker_binding) !== JSON.stringify(transition.worker_binding)) {
      throw new Error("worker identity changed during one setup lifecycle");
    }
    target.worker_binding = structuredClone(transition.worker_binding);
    if (transition.to_status === "ACTIVE") {
      if (transition.findings_digest_sha256 !== null) {
        throw new Error("active worker cannot carry final findings");
      }
    } else {
      if (!SHA256.test(transition.findings_digest_sha256 ?? "")
          || transition.findings_digest_sha256 === "0".repeat(64)) {
        throw new Error("completed worker transition lacks findings evidence");
      }
      if (current.findings_digest_sha256 !== null
          && current.findings_digest_sha256 !== transition.findings_digest_sha256) {
        throw new Error("worker findings identity changed after return");
      }
      target.findings_digest_sha256 = transition.findings_digest_sha256;
    }
  }
  next.state_revision += 1;
  next.updated_at = transition.changed_at;
  validateBootstrapTransition(state, next);
  return next;
}

export function applyAuditTransition(state, transition) {
  validateBootstrapState(state);
  exactKeys(transition, [
    "from_status", "to_status", "auditor_binding", "report_digest_sha256",
    "changed_by", "changed_at",
  ], "audit transition");
  requireString(transition.changed_by, "audit transition actor");
  requireUtc(transition.changed_at, "audit transition time");
  if (state.audit.status !== transition.from_status
      || !AUDIT_TRANSITIONS.get(transition.from_status)?.has(transition.to_status)) {
    throw new Error("audit transition is not monotonic");
  }
  validateAuditBinding(transition.auditor_binding);
  if (state.audit.auditor_binding !== null
      && JSON.stringify(state.audit.auditor_binding) !== JSON.stringify(
        transition.auditor_binding,
      )) {
    throw new Error("Auditor identity changed during one setup audit");
  }
  const next = structuredClone(state);
  next.audit.status = transition.to_status;
  next.audit.auditor_binding = structuredClone(transition.auditor_binding);
  if (transition.to_status === "ACTIVE") {
    if (transition.report_digest_sha256 !== null) {
      throw new Error("active audit cannot carry a final report");
    }
  } else {
    if (!SHA256.test(transition.report_digest_sha256 ?? "")
        || transition.report_digest_sha256 === "0".repeat(64)) {
      throw new Error("completed audit transition lacks report evidence");
    }
    if (state.audit.report_digest_sha256 !== null
        && state.audit.report_digest_sha256 !== transition.report_digest_sha256) {
      throw new Error("audit report identity changed after return");
    }
    next.audit.report_digest_sha256 = transition.report_digest_sha256;
  }
  next.state_revision += 1;
  next.updated_at = transition.changed_at;
  validateBootstrapTransition(state, next);
  return next;
}

function validateWorkerBinding(binding, expectedName, label) {
  exactKeys(binding, [
    "session_id", "display_name", "governance_version", "model_policy",
    "model", "reasoning", "pinned", "spawn_reason",
  ], label);
  requireString(binding.session_id, `${label} session`);
  requireString(binding.model_policy, `${label} model policy`);
  requireString(binding.model, `${label} model`);
  requireString(binding.reasoning, `${label} reasoning`);
  if (binding.display_name !== expectedName || binding.governance_version !== "2.1rc"
      || binding.pinned !== true || binding.spawn_reason !== "FRESH_BOOTSTRAP_SETUP") {
    throw new Error(`${label} identity is invalid`);
  }
}

function validateAuditBinding(binding) {
  exactKeys(binding, [
    "session_id", "display_name", "governance_version", "pinned", "spawn_reason",
  ], "auditor binding");
  requireString(binding.session_id, "auditor session");
  if (binding.display_name !== "Auditor 2.1rc"
      || binding.governance_version !== "2.1rc"
      || binding.pinned !== true || binding.spawn_reason !== "FRESH_BOOTSTRAP_AUDIT") {
    throw new Error("auditor identity is invalid");
  }
}

function validateSnapshot(
  snapshot, previousSha, previousTime, releaseIds, expectedProjectRoot,
) {
  exactKeys(snapshot, [
    "schema", "release_identity", "governance_version", "project_root",
    "configuration", "authority_corpus_choice", "design_bible_choice",
    "authority_corpus_worker_session_id", "design_bible_worker_session_id",
    "authority_corpus_findings_digest_sha256", "design_bible_findings_digest_sha256",
    "auditor_session_id", "audit_report_digest_sha256", "sealed_at",
    "previous_snapshot_sha256",
    "snapshot_sha256",
  ], "configuration snapshot");
  requireString(snapshot.release_identity, "snapshot release");
  requireString(snapshot.project_root, "snapshot project root");
  requireUtc(snapshot.sealed_at, "snapshot time");
  if (snapshot.schema !== "governance.bootstrap_configuration_snapshot.v1"
      || snapshot.governance_version !== "2.1rc"
      || snapshot.project_root !== expectedProjectRoot
      || snapshot.previous_snapshot_sha256 !== previousSha
      || typeof snapshot.authority_corpus_worker_session_id !== "string"
      || snapshot.authority_corpus_worker_session_id.length === 0
      || typeof snapshot.auditor_session_id !== "string"
      || snapshot.auditor_session_id.length === 0
      || !SHA256.test(snapshot.authority_corpus_findings_digest_sha256)
      || !SHA256.test(snapshot.design_bible_findings_digest_sha256)
      || !SHA256.test(snapshot.audit_report_digest_sha256)
      || !SHA256.test(snapshot.snapshot_sha256)) {
    throw new Error("configuration snapshot identity is invalid");
  }
  exactKeys(snapshot.configuration, REQUIRED_GROUPS, "snapshot configuration");
  for (const group of REQUIRED_GROUPS) {
    requireRecord(snapshot.configuration[group], `snapshot configuration ${group}`);
    for (const [key, record] of Object.entries(snapshot.configuration[group])) {
      requireString(key, "snapshot preference key");
      validatePreferenceRecord(record, `snapshot preference ${group}.${key}`);
    }
  }
  validatePreferenceRecord(snapshot.authority_corpus_choice, "snapshot authority corpus choice");
  validatePreferenceRecord(snapshot.design_bible_choice, "snapshot Design Bible choice");
  if (!AUTHORITY_CORPUS_CHOICES.has(snapshot.authority_corpus_choice.value)
      || !DESIGN_CHOICES.has(snapshot.design_bible_choice.value)
      || snapshot.authority_corpus_findings_digest_sha256 === "0".repeat(64)
      || snapshot.audit_report_digest_sha256 === "0".repeat(64)) {
    throw new Error("snapshot setup evidence is invalid");
  }
  const designDeferred = snapshot.design_bible_choice.value
    === "DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE";
  if (designDeferred !== (snapshot.design_bible_findings_digest_sha256 === "0".repeat(64))) {
    throw new Error("snapshot Design Bible evidence contradicts its choice");
  }
  if (designDeferred !== (snapshot.design_bible_worker_session_id === null)) {
    throw new Error("snapshot Design Bible worker identity contradicts its choice");
  }
  const sessions = [
    snapshot.authority_corpus_worker_session_id,
    snapshot.design_bible_worker_session_id,
    snapshot.auditor_session_id,
  ].filter(Boolean);
  if (new Set(sessions).size !== sessions.length) {
    throw new Error("snapshot completion identities are not distinct");
  }
  if (previousTime !== null
      && new Date(snapshot.sealed_at).getTime() <= new Date(previousTime).getTime()) {
    throw new Error("configuration snapshots are not ordered");
  }
  if (releaseIds.has(snapshot.release_identity)) {
    throw new Error("configuration snapshot release is duplicated");
  }
  releaseIds.add(snapshot.release_identity);
  const body = structuredClone(snapshot);
  delete body.snapshot_sha256;
  if (digest(body) !== snapshot.snapshot_sha256) {
    throw new Error("configuration snapshot digest mismatch");
  }
}

export function appendConfigurationSnapshot(state, releaseIdentity, sealedAt) {
  validateBootstrapState(state);
  requireString(releaseIdentity, "release identity");
  requireUtc(sealedAt, "snapshot time");
  const designDeferred = state.tracks.design_bible.choice?.value
    === "DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE";
  if (nextBootstrapQuestion(state) !== null
      || !["RECONCILED", "ARCHIVED"].includes(state.tracks.authority_corpus.worker_status)
      || (!designDeferred
        && !["RECONCILED", "ARCHIVED"].includes(state.tracks.design_bible.worker_status))
      || state.audit.status !== "ACCEPTED") {
    throw new Error("configuration cannot be sealed before setup and independent audit");
  }
  const next = structuredClone(state);
  const previousSnapshot = next.sealed_snapshots.at(-1) ?? null;
  const snapshot = {
    schema: "governance.bootstrap_configuration_snapshot.v1",
    release_identity: releaseIdentity,
    governance_version: next.governance_version,
    project_root: next.project_root,
    configuration: structuredClone(next.configuration),
    authority_corpus_choice: structuredClone(next.tracks.authority_corpus.choice),
    design_bible_choice: structuredClone(next.tracks.design_bible.choice),
    authority_corpus_worker_session_id: next.tracks.authority_corpus.worker_binding.session_id,
    design_bible_worker_session_id: designDeferred
      ? null : next.tracks.design_bible.worker_binding.session_id,
    authority_corpus_findings_digest_sha256: next.tracks.authority_corpus.findings_digest_sha256,
    design_bible_findings_digest_sha256: designDeferred
      ? "0".repeat(64) : next.tracks.design_bible.findings_digest_sha256,
    audit_report_digest_sha256: next.audit.report_digest_sha256,
    auditor_session_id: next.audit.auditor_binding.session_id,
    sealed_at: sealedAt,
    previous_snapshot_sha256: previousSnapshot?.snapshot_sha256 ?? "0".repeat(64),
  };
  next.sealed_snapshots.push({...snapshot, snapshot_sha256: digest(snapshot)});
  next.state_revision += 1;
  next.updated_at = sealedAt;
  validateBootstrapTransition(state, next);
  return next;
}

export const sealConfigurationSnapshot = appendConfigurationSnapshot;

export function validateBootstrapState(state) {
  exactKeys(state, [
    "schema", "governance_version", "bootstrap_role", "state_revision",
    "updated_at", "project_root", "discovery", "discovery_digest_sha256", "tracks",
    "configuration", "answers", "active_question_id", "blocker", "audit",
    "preference_history", "preference_history_head_sha256", "sealed_snapshots",
  ], "bootstrap state");
  if (state.schema !== "governance.dynamic_bootstrap_state.v1"
      || state.governance_version !== "2.1rc"
      || state.bootstrap_role !== "Bootstrap 2.1rc") {
    throw new Error("bootstrap identity mismatch");
  }
  if (!Number.isSafeInteger(state.state_revision) || state.state_revision < 0) {
    throw new Error("bootstrap revision is invalid");
  }
  requireUtc(state.updated_at, "bootstrap updated_at");
  requireString(state.project_root, "bootstrap project_root");
  requireRecord(state.discovery, "bootstrap discovery");
  if (!SHA256.test(state.discovery_digest_sha256)
      || digest(state.discovery) !== state.discovery_digest_sha256
      || state.discovery.project_root !== state.project_root) {
    throw new Error("discovery digest or project-root binding is invalid");
  }
  exactKeys(state.tracks, ["authority_corpus", "design_bible"], "bootstrap tracks");
  for (const [name, choices] of [["authority_corpus", AUTHORITY_CORPUS_CHOICES], ["design_bible", DESIGN_CHOICES]]) {
    const track = state.tracks[name];
    exactKeys(track, [
      "choice", "source_path", "detected_source_paths", "worker_status",
      "worker_binding", "findings_digest_sha256",
    ], `${name} track`);
    if (!Array.isArray(track.detected_source_paths)
        || track.detected_source_paths.some((item) =>
          typeof item !== "string" || item.length === 0)) {
      throw new Error(`${name} detected sources invalid`);
    }
    if (track.choice !== null) {
      validatePreferenceRecord(track.choice, `${name} choice`);
      if (!choices.has(track.choice.value)) throw new Error(`${name} choice invalid`);
    }
    if (track.source_path !== null) {
      validatePreferenceRecord(track.source_path, `${name} source path`);
      if (!track.detected_source_paths.includes(track.source_path.value)) {
        throw new Error(`${name} source path was not detected`);
      }
    }
    if (["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(track.choice?.value)
        && track.source_path === null) {
      // This is an incomplete but valid interview state.
    } else if (!["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(track.choice?.value)
        && track.source_path !== null) {
      throw new Error(`${name} source path is not applicable`);
    }
    if (!WORKER_STATUSES.has(track.worker_status)) throw new Error(`${name} worker status invalid`);
    if (track.findings_digest_sha256 !== null && !SHA256.test(track.findings_digest_sha256)) {
      throw new Error(`${name} findings digest invalid`);
    }
    const noEvidence = ["NOT_READY", "READY_TO_SPAWN"].includes(track.worker_status);
    if (noEvidence && (track.worker_binding !== null
        || track.findings_digest_sha256 !== null)) {
      throw new Error(`${name} pre-worker status carries evidence`);
    }
    if (!noEvidence) {
      validateWorkerBinding(
        track.worker_binding, name === "authority_corpus" ? "authority corpus 2.1rc" : "DesignBible 2.1rc",
        `${name} worker binding`,
      );
      if (track.worker_status === "ACTIVE" && track.findings_digest_sha256 !== null) {
        throw new Error(`${name} active worker cannot have final findings`);
      }
      if (["RETURNED_FINDINGS", "RECONCILED", "ARCHIVED"].includes(track.worker_status)
          && !SHA256.test(track.findings_digest_sha256 ?? "")) {
        throw new Error(`${name} completed worker lacks findings evidence`);
      }
    }
  }
  exactKeys(state.configuration, REQUIRED_GROUPS, "bootstrap configuration");
  for (const group of REQUIRED_GROUPS) {
    requireRecord(state.configuration[group], `configuration ${group}`);
    for (const [key, record] of Object.entries(state.configuration[group])) {
      requireString(key, "preference key");
      validatePreferenceRecord(record, `preference ${group}.${key}`);
    }
  }
  requireRecord(state.answers, "bootstrap answers");
  for (const [questionId, answer] of Object.entries(state.answers)) {
    const target = QUESTION_TARGETS.get(questionId);
    const question = QUESTIONS.find((candidate) => candidate.id === questionId);
    if (!target || !question) throw new Error(`unknown bootstrap answer: ${questionId}`);
    exactKeys(answer, [
      "choice", "answered_by", "answered_at", "preference_sha256",
    ], `bootstrap answer ${questionId}`);
    requireString(answer.answered_by, `bootstrap answer ${questionId} actor`);
    requireUtc(answer.answered_at, `bootstrap answer ${questionId} time`);
    if (!SHA256.test(answer.preference_sha256)) {
      throw new Error(`bootstrap answer ${questionId} preference digest is invalid`);
    }
    if (!answerMatchesQuestion(question, state, answer.choice)) {
      throw new Error(`bootstrap answer ${questionId} choice is invalid`);
    }
    const {effect, revalidation} = answerPolicy(questionId, answer.choice);
    const expectedRecord = preference(
      answer.choice,
      inferValueType(answer.choice),
      "USER_SELECTED",
      answer.answered_by,
      answer.answered_at,
      effect,
      revalidation,
      "HIGH",
    );
    if (digest(expectedRecord) !== answer.preference_sha256) {
      throw new Error(`bootstrap answer ${questionId} digest does not bind its choice`);
    }
    const [group, key] = target;
    const historyEntry = state.preference_history.find((entry) =>
      entry.group === group
      && entry.key === key
      && entry.new_preference_sha256 === answer.preference_sha256
      && entry.changed_by === answer.answered_by
      && entry.changed_at === answer.answered_at);
    if (!historyEntry) {
      throw new Error(`bootstrap answer ${questionId} is not bound to its preference`);
    }
  }
  if (!Array.isArray(state.preference_history)) {
    throw new Error("preference history must be an array");
  }
  let historyHead = "0".repeat(64);
  const preferenceHeads = new Map();
  for (const [index, entry] of state.preference_history.entries()) {
    exactKeys(entry, [
      "sequence", "group", "key", "previous_preference_sha256",
      "new_preference_sha256", "changed_by", "changed_at",
      "previous_event_sha256", "event_sha256",
    ], "preference history entry");
    if (entry.sequence !== index + 1 || !REQUIRED_GROUPS.includes(entry.group)
        && !["authority_corpus_track", "design_bible_track"].includes(entry.group)
        || !SHA256.test(entry.new_preference_sha256)
        || entry.previous_preference_sha256 !== null
          && !SHA256.test(entry.previous_preference_sha256)
        || entry.previous_event_sha256 !== historyHead
        || !SHA256.test(entry.event_sha256)) {
      throw new Error("preference history chain is invalid");
    }
    requireString(entry.key, "preference history key");
    requireString(entry.changed_by, "preference history actor");
    requireUtc(entry.changed_at, "preference history time");
    const body = structuredClone(entry);
    delete body.event_sha256;
    if (digest(body) !== entry.event_sha256) {
      throw new Error("preference history digest mismatch");
    }
    const preferenceIdentity = `${entry.group}\0${entry.key}`;
    const expectedPrevious = preferenceHeads.get(preferenceIdentity) ?? null;
    if (entry.previous_preference_sha256 !== expectedPrevious) {
      throw new Error("preference value history is not monotonic");
    }
    preferenceHeads.set(preferenceIdentity, entry.new_preference_sha256);
    historyHead = entry.event_sha256;
  }
  if (state.preference_history_head_sha256 !== historyHead) {
    throw new Error("preference history head mismatch");
  }
  for (const group of REQUIRED_GROUPS) {
    for (const [key, record] of Object.entries(state.configuration[group])) {
      if (preferenceHeads.get(`${group}\0${key}`) !== digest(record)) {
        throw new Error(`preference ${group}.${key} is not bound to history`);
      }
    }
  }
  for (const trackName of ["authority_corpus", "design_bible"]) {
    for (const key of ["choice", "source_path"]) {
      const record = state.tracks[trackName][key];
      if (record !== null
          && preferenceHeads.get(`${trackName}_track\0${key}`) !== digest(record)) {
        throw new Error(`${trackName} ${key} is not bound to history`);
      }
    }
  }
  if (state.active_question_id !== null) requireString(state.active_question_id, "active question");
  if (state.blocker !== null) {
    exactKeys(state.blocker, [
      "class", "provider", "public_authorization_url", "chrome_required",
      "resume_check", "sensitive_link",
    ], "bootstrap blocker");
    let url;
    try {
      url = new URL(state.blocker.public_authorization_url);
    } catch {
      throw new Error("bootstrap blocker URL invalid");
    }
    if (state.blocker.class !== "UNAVAILABLE_CREDENTIAL_OR_EXTERNAL_ACCESS"
        || url.protocol !== "https:" || url.username || url.password
        || url.search || url.hash || state.blocker.chrome_required !== true
        || state.blocker.sensitive_link !== false) {
      throw new Error("bootstrap provider blocker retains unsafe authorization material");
    }
  }
  const expectedActiveQuestion = computeNextQuestion(state)?.id ?? null;
  if (state.active_question_id !== expectedActiveQuestion) {
    throw new Error("active question does not match deterministic unresolved state");
  }
  exactKeys(state.audit, [
    "status", "auditor_binding", "report_digest_sha256",
  ], "bootstrap audit");
  if (!["NOT_READY", "ACTIVE", "RETURNED", "ACCEPTED"].includes(state.audit.status)) {
    throw new Error("bootstrap audit status invalid");
  }
  if (state.audit.report_digest_sha256 !== null
      && !SHA256.test(state.audit.report_digest_sha256)) {
    throw new Error("bootstrap audit digest invalid");
  }
  if (state.audit.status === "NOT_READY"
      && (state.audit.auditor_binding !== null
        || state.audit.report_digest_sha256 !== null)) {
    throw new Error("not-ready audit carries evidence");
  }
  if (state.audit.status !== "NOT_READY") {
    validateAuditBinding(state.audit.auditor_binding);
    if (state.audit.status === "ACTIVE" && state.audit.report_digest_sha256 !== null) {
      throw new Error("active audit cannot carry final report");
    }
    if (["RETURNED", "ACCEPTED"].includes(state.audit.status)
        && !SHA256.test(state.audit.report_digest_sha256 ?? "")) {
      throw new Error("completed audit lacks report evidence");
    }
    const workerSessions = Object.values(state.tracks)
      .map((track) => track.worker_binding?.session_id)
      .filter(Boolean);
    if (workerSessions.includes(state.audit.auditor_binding.session_id)) {
      throw new Error("auditor is not independent from setup workers");
    }
  }
  const workerSessions = Object.values(state.tracks)
    .map((track) => track.worker_binding?.session_id)
    .filter(Boolean);
  if (new Set(workerSessions).size !== workerSessions.length) {
    throw new Error("setup worker identities are not distinct");
  }
  if (!Array.isArray(state.sealed_snapshots)) throw new Error("sealed snapshots must be an array");
  let previousSha = "0".repeat(64);
  let previousTime = null;
  const releaseIds = new Set();
  for (const snapshot of state.sealed_snapshots) {
    validateSnapshot(snapshot, previousSha, previousTime, releaseIds, state.project_root);
    previousSha = snapshot.snapshot_sha256;
    previousTime = snapshot.sealed_at;
  }
  return state;
}

function persistStateAtomically(statePath, state) {
  const absolute = path.resolve(statePath);
  const parent = fs.realpathSync(path.dirname(absolute));
  if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("bootstrap state path must be a regular non-symlink file");
    }
  }
  const temporary = path.join(
    parent,
    `.${path.basename(absolute)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  const descriptor = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(canonicalize(state))}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, absolute);
  const directoryDescriptor = fs.openSync(parent, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
  return digest(state);
}

function main() {
  const [command, firstPath, secondPath, thirdPath] = process.argv.slice(2);
  if (command === "discover") {
    process.stdout.write(`${JSON.stringify(discoverEnvironment(firstPath))}\n`);
    return;
  }
  if (!command || !firstPath) {
    throw new Error("usage: dynamic-bootstrap <validate|next|action|answer|apply-answer|change|worker-transition|audit-transition|snapshot|discover> ...");
  }
  const state = JSON.parse(fs.readFileSync(firstPath, "utf8"));
  if (command === "validate") {
    validateBootstrapState(state);
    process.stdout.write('{"status":"VALID"}\n');
  } else if (command === "next") {
    process.stdout.write(`${JSON.stringify(nextBootstrapQuestion(state))}\n`);
  } else if (command === "action") {
    const resolvedModel = secondPath
      ? JSON.parse(fs.readFileSync(secondPath, "utf8")) : null;
    process.stdout.write(`${JSON.stringify(nextBootstrapHostAction(state, resolvedModel))}\n`);
  } else if (command === "answer" || command === "apply-answer") {
    if (!secondPath) throw new Error("answer requires an answer JSON path");
    const answer = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    const next = applyBootstrapAnswer(state, answer);
    if (command === "apply-answer") {
      process.stdout.write(`${JSON.stringify({
        status: "STATE_APPLIED",
        state_sha256: persistStateAtomically(firstPath, next),
      })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(next)}\n`);
    }
  } else if (["change", "worker-transition", "audit-transition", "snapshot"].includes(command)) {
    if (!secondPath) throw new Error(`${command} requires an input JSON path`);
    const input = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    const next = command === "change"
      ? changePreference(state, input)
      : command === "worker-transition"
        ? applyWorkerTransition(state, input)
        : command === "audit-transition"
          ? applyAuditTransition(state, input)
          : appendConfigurationSnapshot(state, input.release_identity, input.sealed_at);
    const shouldPersist = thirdPath === "--write";
    process.stdout.write(`${JSON.stringify(shouldPersist ? {
      status: "STATE_APPLIED",
      state_sha256: persistStateAtomically(firstPath, next),
    } : next)}\n`);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
