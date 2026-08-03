#!/usr/bin/env node

import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SHA256 = /^[0-9a-f]{64}$/;
const MODES = new Set(["CHATGPT_GUIDED", "DIRECT"]);
const PHASES = ["FOUNDATION", "AUTHORITY_CORPUS", "DESIGN_BIBLE", "INTENT"];
const ANSWER_STATUSES = new Set([
  "USER_CONFIRMED", "DISCOVERY_CONFIRMED", "DEFERRED_NONMATERIAL",
]);
const QUESTION_TYPES = new Set([
  "STRING", "BOOLEAN", "INTEGER", "STRING_LIST", "ENUM", "JSON",
]);
const MODEL_RULE_SCOPES = new Set([
  "EXACT_FEATURE_AND_ROLE", "FEATURE", "ROLE", "CAMPAIGN_TYPE", "GLOBAL_ROLE",
  "GLOBAL_DEFAULT",
]);
const MODEL_RULE_PRECEDENCE = {
  EXACT_FEATURE_AND_ROLE: 600,
  FEATURE: 500,
  ROLE: 400,
  CAMPAIGN_TYPE: 300,
  GLOBAL_ROLE: 200,
  GLOBAL_DEFAULT: 100,
};
const MODEL_RULE_MATCH_KEYS = {
  EXACT_FEATURE_AND_ROLE: ["feature", "role"],
  FEATURE: ["feature"],
  ROLE: ["role"],
  CAMPAIGN_TYPE: ["campaign_type"],
  GLOBAL_ROLE: ["role"],
  GLOBAL_DEFAULT: [],
};
const MODEL_COST_MODES = new Set(["RECOMMENDED", "ECO", "USER_CUSTOM"]);
const AUTH_STATUSES = new Set([
  "NOT_REQUIRED", "NOT_CONFIGURED", "IDENTITY_VERIFIED",
  "IDENTITY_AND_PERMISSION_VERIFIED", "DEFERRED_UNAVAILABLE",
]);
const PERMISSION_STATUSES = new Set([
  "NOT_CHECKED", "VERIFIED", "INSUFFICIENT", "NOT_APPLICABLE",
]);
const AUTHORITY_CORPUS_OPERATIONS = new Set(["IMPORT", "ALIGN_AND_REFACTOR", "CREATE_NEW"]);
const DESIGN_OPERATIONS = new Set([
  "IMPORT", "ALIGN_AND_REFACTOR", "CREATE_NEW", "DEFER_EXPLICITLY",
]);
const PHASE_OPERATIONS = new Map([
  ["FOUNDATION", new Set(["CREATE_OR_ALIGN_PROJECT_CONFIGURATION"])],
  ["AUTHORITY_CORPUS", AUTHORITY_CORPUS_OPERATIONS],
  ["DESIGN_BIBLE", DESIGN_OPERATIONS],
  ["INTENT", new Set(["CREATE_OR_ALIGN_FEATURE_INTENT"])],
]);
const FEATURE_ARTICLE_SLOTS = {
  index: 0,
  intent: 1,
  gates: 2,
  workflows_and_context: 3,
  ownership_and_boundaries: 4,
  dependencies: 5,
  contracts_and_interfaces: 6,
  data_database_and_row_security: 7,
  backend_api_and_events: 8,
  ui_ux_and_views: 9,
  shell_and_navigation: 10,
  integrations: 11,
  security_and_privacy: 12,
  runtime_configuration_and_recovery: 13,
  testing_and_proof: 14,
  failure_and_unavailable: 15,
  accepted_implementation_map: 16,
  compact_event_and_build_log: 17,
  handoffs_and_session_lineage: 18,
  decisions: 19,
  release_history: 20,
  open_questions_and_context_gaps: 21,
  deferred_work: 22,
};
const GOVERNANCE_CORE_SLUGS = [
  "governance-index-and-constitution",
  "authority-order-and-conflict-resolution",
  "roles-scope-and-custody",
  "campaign-lifecycle",
  "worktree-checkpoint-and-handoff",
  "failure-reframe-and-blockers",
  "audit-proof-and-acceptance",
  "runtime-release-deploy-and-rollback",
  "security-secrets-and-provider-auth",
  "authority-corpus-generation-and-maintenance",
  "context-elicitation-and-bootstrap",
  "evidence-retention-and-archive",
  "model-selection-and-economics",
  "machine-schemas-and-verification",
  "governance-change-log",
];
const PROJECT_CORE_SLUGS = [
  "project-index",
  "vision-and-outcome",
  "users-and-use-cases",
  "non-goals-and-protected-boundaries",
  "architecture-and-system-map",
  "repositories-build-and-tooling",
  "data-database-and-row-security",
  "backend-api-and-events",
  "ui-views-shell-and-navigation",
  "design-bible",
  "security-privacy-and-authentication",
  "integrations-and-providers",
  "runtime-environments-and-recovery",
  "testing-and-proof",
  "release-promotion-and-rollback",
  "glossary",
  "decision-index",
  "case-and-failure-index",
  "feature-registry-and-dependency-graph",
  "campaign-registry",
  "owner-questions-and-context-gaps",
  "agent-and-model-policy",
  "evidence-library-index",
  "project-change-log",
];

const QUESTIONS = [
  {
    id: "setup.interaction_mode",
    phase: "FOUNDATION",
    type: "ENUM",
    prompt: "Do you want to use ChatGPT (recommended), or work with Bootstrap directly?",
    choices: ["CHATGPT_GUIDED", "DIRECT"],
    recommended: "CHATGPT_GUIDED",
    human_required: true,
  },
  {
    id: "project.name",
    phase: "FOUNDATION",
    type: "STRING",
    prompt: "What is the project name?",
    human_required: true,
  },
  {
    id: "project.outcome",
    phase: "FOUNDATION",
    type: "STRING",
    prompt: "What useful outcome should this project produce?",
    human_required: true,
  },
  {
    id: "project.users",
    phase: "FOUNDATION",
    type: "STRING_LIST",
    prompt: "Who are the intended users or operators?",
    human_required: true,
  },
  {
    id: "project.non_goals",
    phase: "FOUNDATION",
    type: "STRING_LIST",
    prompt: "What is explicitly outside the project scope?",
    human_required: true,
  },
  {
    id: "project.lifecycle",
    phase: "FOUNDATION",
    type: "ENUM",
    prompt: "Is this a new project, an existing project, or a governance upgrade?",
    choices: ["NEW", "EXISTING", "GOVERNANCE_UPGRADE"],
    human_required: true,
  },
  {
    id: "repositories.topology",
    phase: "FOUNDATION",
    type: "ENUM",
    prompt: "Should the project use one repository, multiple repositories, or local-only versioning?",
    choices: ["SINGLE_REPOSITORY", "MULTIPLE_REPOSITORIES", "LOCAL_ONLY"],
    human_required: true,
  },
  {
    id: "project.sensitivity",
    phase: "FOUNDATION",
    type: "STRING_LIST",
    prompt: "Which data, safety, legal, privacy, or owner-only boundaries apply?",
    human_required: true,
  },
  {
    id: "providers.capability_map",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "Which providers should own each required project capability and environment?",
    human_required: true,
  },
  {
    id: "deployment.policy",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "How should builds, environments, releases, rollback, promotion, and spending be handled?",
    human_required: true,
  },
  {
    id: "testing.interactive_browser",
    phase: "FOUNDATION",
    type: "STRING",
    prompt: "Which interactive browser, if any, should agents use?",
    human_required: true,
  },
  {
    id: "testing.browser_automation",
    phase: "FOUNDATION",
    type: "STRING",
    prompt: "Which browser automation framework, if any, should agents use?",
    human_required: true,
  },
  {
    id: "testing.authentication",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "How should builders, auditors, and Runtime authenticate in each environment?",
    human_required: true,
  },
  {
    id: "security.acceptance_baselines",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "Which versioned security standards and project-specific security overlays should compile the Security question tree?",
    human_required: true,
  },
  {
    id: "evidence.active_window_days",
    phase: "FOUNDATION",
    type: "INTEGER",
    prompt: "How many days should detailed evidence remain loose before permanent archive packaging?",
    recommended: 14,
    human_required: true,
  },
  {
    id: "workflow.progress_interval_minutes",
    phase: "FOUNDATION",
    type: "INTEGER",
    prompt: "How many minutes without concrete progress should trigger recovery?",
    recommended: 15,
    human_required: true,
  },
  {
    id: "workflow.agent_lifecycle",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "Which active roles should be pinned, which roles persist across campaigns, and how should completed sessions be retained?",
    human_required: true,
  },
  {
    id: "workflow.campaign_topology",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "Should campaigns default to one cumulative root or admitted multi-lane work, and what milestone handoff policy applies?",
    human_required: true,
  },
  {
    id: "workflow.gpt_assist_mode",
    phase: "FOUNDATION",
    type: "ENUM",
    prompt: "Should campaign Auditors also produce a compact GPT_ASSIST project-status brief for ChatGPT?",
    choices: ["GPT_ASSIST", "DIRECT_ONLY"],
    recommended: "GPT_ASSIST",
    human_required: true,
  },
  {
    id: "models.rules",
    phase: "FOUNDATION",
    type: "JSON",
    prompt: "Which model-selection rules should apply globally and to specific roles, features, or campaigns?",
    human_required: true,
  },
  {
    id: "authority_corpus.operation",
    phase: "AUTHORITY_CORPUS",
    type: "ENUM",
    prompt: "Should Bootstrap import, align/refactor, or create the project authority corpus?",
    choices: ["IMPORT", "ALIGN_AND_REFACTOR", "CREATE_NEW"],
    human_required: true,
  },
  {
    id: "authority_corpus.source",
    phase: "AUTHORITY_CORPUS",
    type: "JSON",
    prompt: "What exact read-only source should Bootstrap import or align, or NONE for a new authority corpus?",
    human_required: true,
  },
  {
    id: "authority_corpus.structure",
    phase: "AUTHORITY_CORPUS",
    type: "JSON",
    prompt: "Which authority roots, publication boundary, and historical-library layout should Bootstrap use?",
    human_required: true,
  },
  {
    id: "authority_corpus.terminology",
    phase: "AUTHORITY_CORPUS",
    type: "JSON",
    prompt: "Which project terms, architecture concepts, and ownership boundaries need canonical definitions?",
    human_required: true,
  },
  {
    id: "design.operation",
    phase: "DESIGN_BIBLE",
    type: "ENUM",
    prompt: "Should Bootstrap import, align/refactor, create, or explicitly defer the Design Bible?",
    choices: ["IMPORT", "ALIGN_AND_REFACTOR", "CREATE_NEW", "DEFER_EXPLICITLY"],
    human_required: true,
  },
  {
    id: "design.source",
    phase: "DESIGN_BIBLE",
    type: "JSON",
    prompt: "What exact read-only Design Bible source should Bootstrap import or align, or NONE when creating or deferring?",
    human_required: true,
  },
  {
    id: "design.system",
    phase: "DESIGN_BIBLE",
    type: "JSON",
    prompt: "What visual, interaction, accessibility, responsive, and protected-surface rules apply?",
    human_required: true,
  },
  {
    id: "intent.features",
    phase: "INTENT",
    type: "JSON",
    prompt: "Which initial features and user workflows should the authority corpus describe?",
    human_required: true,
  },
  {
    id: "intent.gates",
    phase: "INTENT",
    type: "JSON",
    prompt: "Which outcome gates, dependencies, honest unavailable states, and acceptance expectations apply?",
    human_required: true,
  },
];

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireUtc(value, label) {
  requireString(value, label);
  if (!value.endsWith("Z") || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be valid UTC`);
  }
}

function requireSha(value, label) {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function requireSafeRelativePath(value, label) {
  requireString(value, label);
  if (path.isAbsolute(value) || value.includes("\\") || value.includes("\0")
      || value.split("/").some((segment) => segment === "" || segment === "..")) {
    throw new Error(`${label} must be a safe relative path`);
  }
}

function requireCanonicalPathWithoutSymlinks(targetPath, label) {
  const lexical = path.resolve(targetPath);
  const parsed = path.parse(lexical);
  let current = parsed.root;
  for (const segment of lexical.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link`);
    }
  }
  if (fs.realpathSync(lexical) !== lexical) throw new Error(`${label} is not canonical`);
  return lexical;
}

function projectRootFromDiscovery(discovery) {
  const roots = discovery.filter((fact) => fact.fact_id === "environment.project_root");
  if (roots.length !== 1 || typeof roots[0].value !== "string"
      || !path.isAbsolute(roots[0].value)) {
    throw new Error("discovery must bind exactly one absolute project root");
  }
  const resolved = requireCanonicalPathWithoutSymlinks(
    roots[0].value, "discovered project root",
  );
  if (!fs.statSync(resolved).isDirectory()) throw new Error("project root is not a directory");
  return resolved;
}

function resolveContainedExisting(projectRoot, relativePath, label) {
  requireSafeRelativePath(relativePath, label);
  const root = fs.realpathSync(projectRoot);
  const lexical = path.resolve(root, relativePath);
  if (lexical !== root && !lexical.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the project root`);
  }
  let current = root;
  for (const segment of path.relative(root, lexical).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} traverses a symbolic link`);
  }
  const resolved = fs.realpathSync(lexical);
  if (resolved !== lexical) throw new Error(`${label} resolves through an alias`);
  return resolved;
}

function portableContentDigest(targetPath) {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) throw new Error("content source is a symbolic link");
  if (stat.isFile()) {
    return crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  }
  if (!stat.isDirectory()) throw new Error("content source is not a regular file or directory");
  const rows = [];
  const walk = (directory, prefix = "") => {
    const names = fs.readdirSync(directory).sort(compareUtf8);
    for (const name of names) {
      const absolute = path.join(directory, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const entry = fs.lstatSync(absolute);
      if (entry.isSymbolicLink()) throw new Error("content tree contains a symbolic link");
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        rows.push({
          path: relative,
          size: entry.size,
          sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"),
        });
      } else {
        throw new Error("content tree contains a non-regular entry");
      }
    }
  };
  walk(targetPath);
  return digest(rows);
}

export function computePortableContentSha256(targetPath) {
  requireString(targetPath, "content path");
  if (!path.isAbsolute(targetPath)) throw new Error("content path must be absolute");
  return portableContentDigest(fs.realpathSync(targetPath));
}

export function verifyGuidedImportSource(value, projectRoot) {
  validateImportSource(value, "import source");
  if (value.kind === "NONE") return null;
  let target;
  if (value.kind === "PROJECT_RELATIVE") {
    target = resolveContainedExisting(projectRoot, value.path, "project-relative import");
  } else {
    target = requireCanonicalPathWithoutSymlinks(value.path, "external import");
  }
  const observed = portableContentDigest(target);
  if (observed !== value.content_sha256) throw new Error("import source digest mismatch");
  return {resolved_path: target, content_sha256: observed};
}

function requireTimeNotBefore(value, boundary, label) {
  requireUtc(value, label);
  if (new Date(value).getTime() < new Date(boundary).getTime()) {
    throw new Error(`${label} predates the current state`);
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function validateValue(type, value, label) {
  if (!QUESTION_TYPES.has(type)) throw new Error(`${label} type is invalid`);
  if ((type === "STRING" || type === "ENUM")
      && (typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`${label} must be a nonempty string`);
  }
  if (type === "BOOLEAN" && typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
  if (type === "INTEGER" && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${label} must be a positive integer`);
  }
  if (type === "STRING_LIST"
      && (!Array.isArray(value) || value.some((item) =>
        typeof item !== "string" || item.trim().length === 0))) {
    throw new Error(`${label} must be a nonempty-string list`);
  }
  if (type === "JSON"
      && (value === undefined || JSON.stringify(value) === undefined)) {
    throw new Error(`${label} must be JSON-compatible`);
  }
}

function questionById(questionId) {
  const question = QUESTIONS.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`unknown question ${questionId}`);
  return question;
}

function unresolvedForPhase(state, phase) {
  return QUESTIONS.filter((question) =>
    question.phase === phase && state.answers[question.id] === undefined);
}

function currentPhase(state) {
  for (const phase of PHASES) {
    if (unresolvedForPhase(state, phase).length > 0) return phase;
    if (!state.phase_outputs[phase]) return null;
  }
  return null;
}

function validateDiscoveredFact(fact) {
  exactKeys(fact, [
    "fact_id", "value", "confidence", "source_kind", "source_locator",
    "observed_at", "secret_free",
  ], "discovered fact");
  requireString(fact.fact_id, "fact_id");
  requireString(fact.confidence, "fact confidence");
  requireString(fact.source_kind, "fact source kind");
  requireString(fact.source_locator, "fact source locator");
  requireUtc(fact.observed_at, "fact observation");
  if (fact.secret_free !== true) throw new Error("discovery fact is not secret-free");
}

function validateModelRules(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("models.rules must be a nonempty array");
  }
  const ids = new Set();
  for (const rule of value) {
    exactKeys(rule, [
      "rule_id", "scope", "match", "model", "reasoning", "cost_mode",
      "economics", "source", "source_observed_at", "source_digest_sha256",
    ], "model rule");
    requireString(rule.rule_id, "model rule ID");
    if (ids.has(rule.rule_id)) throw new Error("duplicate model rule ID");
    ids.add(rule.rule_id);
    if (!MODEL_RULE_SCOPES.has(rule.scope)) throw new Error("model rule scope invalid");
    requireRecord(rule.match, "model rule match");
    exactKeys(rule.match, MODEL_RULE_MATCH_KEYS[rule.scope], "model rule match");
    for (const [key, matchValue] of Object.entries(rule.match)) {
      requireString(matchValue, `model rule match ${key}`);
    }
    requireString(rule.model, "model");
    requireString(rule.reasoning, "reasoning");
    if (!MODEL_COST_MODES.has(rule.cost_mode)) throw new Error("model cost mode invalid");
    exactKeys(rule.economics, [
      "estimated_success_probability", "estimated_attempts",
      "relative_unit_cost", "expected_completion_cost", "value_rationale",
    ], "model economics");
    for (const field of [
      "estimated_success_probability", "estimated_attempts",
      "relative_unit_cost", "expected_completion_cost",
    ]) {
      if (typeof rule.economics[field] !== "number"
          || !Number.isFinite(rule.economics[field])
          || rule.economics[field] <= 0) throw new Error(`model economics ${field} invalid`);
    }
    if (rule.economics.estimated_success_probability > 1) {
      throw new Error("model success probability cannot exceed one");
    }
    if (rule.economics.estimated_attempts < 1
        || Math.abs(
          rule.economics.expected_completion_cost
            - rule.economics.estimated_attempts * rule.economics.relative_unit_cost,
        ) > 1e-9) {
      throw new Error("model expected completion cost is internally inconsistent");
    }
    requireString(rule.economics.value_rationale, "model value rationale");
    if (![
      "HOST_DISCOVERY", "HOST_AND_EXTERNAL_COMPARISON", "USER_CUSTOM",
    ].includes(rule.source)) throw new Error("model source invalid");
    requireUtc(rule.source_observed_at, "model source time");
    if (!SHA256.test(rule.source_digest_sha256)) throw new Error("model source digest invalid");
  }
  const signatures = new Set();
  for (const rule of value) {
    const signature = `${rule.scope}\0${JSON.stringify(canonicalize(rule.match))}`;
    if (signatures.has(signature)) throw new Error("ambiguous duplicate model rule");
    signatures.add(signature);
  }
  if (!value.some((rule) => rule.scope === "GLOBAL_DEFAULT")) {
    throw new Error("model rules lack GLOBAL_DEFAULT");
  }
}

function validateModelRulesAgainstDiscovery(rules, discovery) {
  const catalogs = discovery
    .filter((fact) => fact.fact_id === "models.rules.spawnable"
      || fact.fact_id.startsWith("models.rules.spawnable."))
    .flatMap((fact) => {
      if (!Array.isArray(fact.value)) throw new Error("spawnable model catalog is invalid");
      return fact.value;
    });
  if (catalogs.length === 0) throw new Error("spawnable model discovery is missing");
  const admitted = new Set();
  for (const entry of catalogs) {
    exactKeys(entry, ["model", "reasoning_levels"], "spawnable model entry");
    requireString(entry.model, "spawnable model");
    if (!Array.isArray(entry.reasoning_levels) || entry.reasoning_levels.length === 0
        || entry.reasoning_levels.some((level) =>
          typeof level !== "string" || level.length === 0)) {
      throw new Error("spawnable reasoning levels are invalid");
    }
    for (const level of entry.reasoning_levels) admitted.add(`${entry.model}\0${level}`);
  }
  for (const rule of rules) {
    if (!admitted.has(`${rule.model}\0${rule.reasoning}`)) {
      throw new Error("model rule is not in the discovered spawnable catalog");
    }
  }
}

function validateProviderCapabilityMap(value) {
  if (!Array.isArray(value)) throw new Error("providers.capability_map must be an array");
  const keys = new Set();
  for (const binding of value) {
    exactKeys(binding, [
      "capability", "environment", "provider", "account_label", "auth_method",
      "auth_status", "permission_status",
    ], "provider capability binding");
    for (const field of [
      "capability", "environment", "provider", "account_label", "auth_method",
    ]) requireString(binding[field], `provider ${field}`);
    if (!AUTH_STATUSES.has(binding.auth_status)) throw new Error("provider auth status invalid");
    if (!PERMISSION_STATUSES.has(binding.permission_status)) {
      throw new Error("provider permission status invalid");
    }
    if (binding.auth_status === "IDENTITY_AND_PERMISSION_VERIFIED"
        && binding.permission_status !== "VERIFIED") {
      throw new Error("provider permission claim is contradictory");
    }
    const key = `${binding.capability}\0${binding.environment}`;
    if (keys.has(key)) throw new Error("duplicate provider capability/environment");
    keys.add(key);
  }
}

function validateDeploymentPolicy(value) {
  exactKeys(value, [
    "deployment_enabled", "environments", "merge_strategy", "release_strategy",
    "promotion_authority", "rollback_strategy", "spend_policy",
  ], "deployment policy");
  if (typeof value.deployment_enabled !== "boolean") {
    throw new Error("deployment_enabled must be boolean");
  }
  if (!Array.isArray(value.environments) || value.environments.length === 0
      || value.environments.some((item) => typeof item !== "string" || item.length === 0)
      || new Set(value.environments).size !== value.environments.length) {
    throw new Error("deployment environments invalid");
  }
  for (const field of [
    "merge_strategy", "release_strategy", "promotion_authority",
    "rollback_strategy", "spend_policy",
  ]) requireString(value[field], `deployment ${field}`);
}

function validateAuthenticationPolicy(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("testing.authentication must be a nonempty array");
  }
  const keys = new Set();
  for (const route of value) {
    exactKeys(route, [
      "actor", "environment", "auth_route", "credential_handling",
      "unavailable_behavior",
    ], "authentication route");
    for (const field of Object.keys(route)) requireString(route[field], `authentication ${field}`);
    const key = `${route.actor}\0${route.environment}`;
    if (keys.has(key)) throw new Error("duplicate actor/environment authentication route");
    keys.add(key);
    if (!/runtime.only|runtime-only/i.test(route.credential_handling)) {
      throw new Error("authentication credentials must remain runtime-only");
    }
  }
}

function validateSecurityBaselines(value) {
  exactKeys(value, ["standards", "project_overlays", "update_policy"], "security baselines");
  if (!Array.isArray(value.standards) || value.standards.length === 0) {
    throw new Error("security standards must be a nonempty array");
  }
  const ids = new Set();
  for (const standard of value.standards) {
    exactKeys(standard, ["standard_id", "version", "applicability"], "security standard");
    for (const field of Object.keys(standard)) requireString(standard[field], `security standard ${field}`);
    if (ids.has(standard.standard_id)) throw new Error("duplicate security standard");
    ids.add(standard.standard_id);
  }
  if (!Array.isArray(value.project_overlays)
      || value.project_overlays.some((item) => typeof item !== "string" || item.length === 0)
      || new Set(value.project_overlays).size !== value.project_overlays.length) {
    throw new Error("security project overlays are invalid");
  }
  requireString(value.update_policy, "security update policy");
}

function validateAuthorityCorpusStructure(value) {
  exactKeys(value, [
    "authority_root", "authority_index_path", "campaigns_root",
    "design_bible_root", "evidence_library_root", "publication", "numbering",
  ], "authority corpus structure");
  for (const field of [
    "authority_root", "authority_index_path", "campaigns_root",
    "design_bible_root", "evidence_library_root",
  ]) requireSafeRelativePath(value[field], `authority corpus ${field}`);
  if (!["LOCAL_ONLY", "PRIVATE_REPOSITORY", "PUBLIC_REPOSITORY"].includes(value.publication)) {
    throw new Error("authority corpus publication is invalid");
  }
  exactKeys(value.numbering, [
    "bootstrap_article", "governance_start", "governance_end_exclusive",
    "project_start", "project_end_exclusive", "feature_block_size",
    "first_feature_start", "existing_feature_blocks", "registry_path",
  ], "authority corpus numbering");
  if (value.numbering.bootstrap_article !== 0
      || value.numbering.governance_start !== 1
      || value.numbering.governance_end_exclusive !== 100
      || value.numbering.project_start !== 100
      || value.numbering.project_end_exclusive !== 200
      || value.numbering.feature_block_size !== 100
      || value.numbering.first_feature_start !== 200) {
    throw new Error("portable article ranges are not canonical");
  }
  requireSafeRelativePath(value.numbering.registry_path, "article-number registry path");
  if (!Array.isArray(value.numbering.existing_feature_blocks)) {
    throw new Error("existing feature blocks must be an array");
  }
  const blockStarts = new Set();
  const primaryFeatures = new Set();
  for (const block of value.numbering.existing_feature_blocks) {
    exactKeys(block, [
      "feature_id", "start", "kind", "extends_start",
    ], "existing feature block");
    validateEntityId(block.feature_id, "existing feature ID");
    if (!Number.isSafeInteger(block.start)
        || block.start < 200 || block.start % 100 !== 0) {
      throw new Error("existing feature block start is invalid");
    }
    if (!["PRIMARY", "EXTENSION"].includes(block.kind)
        || (block.kind === "PRIMARY" && block.extends_start !== null)
        || (block.kind === "EXTENSION"
          && (!Number.isSafeInteger(block.extends_start)
            || block.extends_start < 200
            || block.extends_start % 100 !== 0
            || block.extends_start === block.start))) {
      throw new Error("existing feature block linkage is invalid");
    }
    if (block.kind === "PRIMARY") {
      if (primaryFeatures.has(block.feature_id)) {
        throw new Error("feature has multiple primary article blocks");
      }
      primaryFeatures.add(block.feature_id);
    }
    if (blockStarts.has(block.start)) throw new Error("existing feature block allocation collides");
    blockStarts.add(block.start);
  }
  for (const block of value.numbering.existing_feature_blocks) {
    if (block.kind === "EXTENSION") {
      const parent = value.numbering.existing_feature_blocks.find((candidate) =>
        candidate.feature_id === block.feature_id
          && candidate.start === block.extends_start);
      if (!parent) throw new Error("feature extension references a missing same-feature block");
    }
  }
  const allocatedFeatures = new Set(
    value.numbering.existing_feature_blocks.map((block) => block.feature_id),
  );
  for (const featureId of allocatedFeatures) {
    if (!primaryFeatures.has(featureId)) {
      throw new Error("feature article allocation lacks a primary block");
    }
  }
  for (const featureId of primaryFeatures) {
    const featureBlocks = value.numbering.existing_feature_blocks
      .filter((block) => block.feature_id === featureId);
    const primary = featureBlocks.find((block) => block.kind === "PRIMARY");
    const byStart = new Map(featureBlocks.map((block) => [block.start, block]));
    for (const extension of featureBlocks.filter((block) => block.kind === "EXTENSION")) {
      const visited = new Set();
      let cursor = extension;
      while (cursor.kind === "EXTENSION") {
        if (visited.has(cursor.start)) throw new Error("feature extension chain contains a cycle");
        visited.add(cursor.start);
        cursor = byStart.get(cursor.extends_start);
        if (!cursor) throw new Error("feature extension chain is orphaned");
      }
      if (cursor.start !== primary.start) {
        throw new Error("feature extension chain does not terminate at its primary block");
      }
    }
  }
}

function validateEntityId(value, label) {
  requireString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${label} contains an unsafe character`);
  }
}

function formatArticleNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("article number invalid");
  return String(value).padStart(4, "0");
}

export function compilePortableArticleNumbering(authorityCorpusStructure, features) {
  validateAuthorityCorpusStructure(authorityCorpusStructure);
  validateIntentFeatures(features);
  const existing = authorityCorpusStructure.numbering.existing_feature_blocks
    .map((block) => structuredClone(block));
  const byFeature = new Map(existing
    .filter((block) => block.kind === "PRIMARY")
    .map((block) => [block.feature_id, block.start]));
  const usedStarts = new Set(existing.map((block) => block.start));
  let candidateStart = authorityCorpusStructure.numbering.first_feature_start;
  const featureIds = features.map((feature) => feature.feature_id).sort(compareUtf8);
  for (const featureId of featureIds) {
    if (byFeature.has(featureId)) continue;
    while (usedStarts.has(candidateStart)) {
      candidateStart += authorityCorpusStructure.numbering.feature_block_size;
    }
    existing.push({
      feature_id: featureId,
      start: candidateStart,
      kind: "PRIMARY",
      extends_start: null,
    });
    byFeature.set(featureId, candidateStart);
    usedStarts.add(candidateStart);
    candidateStart += authorityCorpusStructure.numbering.feature_block_size;
  }
  const blocks = existing
    .sort((left, right) => left.start - right.start
      || compareUtf8(left.feature_id, right.feature_id))
    .map((block) => ({
      ...block,
      end_exclusive: block.start + authorityCorpusStructure.numbering.feature_block_size,
      articles: block.kind === "PRIMARY"
        ? Object.fromEntries(Object.entries(FEATURE_ARTICLE_SLOTS)
          .map(([name, offset]) => {
            const number = formatArticleNumber(block.start + offset);
            return [name, {
              number,
              relative_path: `${number}-${name.replaceAll("_", "-")}.md`,
            }];
          }))
        : {
          extension_index: {
            number: formatArticleNumber(block.start),
            relative_path: `${formatArticleNumber(block.start)}-feature-extension-index.md`,
          },
        },
    }));
  const numberedPages = (start, slugs) => slugs.map((slug, offset) => {
    const number = formatArticleNumber(start + offset);
    return {number, relative_path: `${number}-${slug}.md`};
  });
  const result = {
    schema: "governance.portable_article_numbering.v1",
    bootstrap: {number: "000", relative_path: "000-bootstrap.md"},
    governance: {start: "0001", end_exclusive: "0100"},
    project: {start: "0100", end_exclusive: "0200"},
    governance_core: numberedPages(1, GOVERNANCE_CORE_SLUGS),
    project_core: numberedPages(100, PROJECT_CORE_SLUGS),
    feature_block_size: authorityCorpusStructure.numbering.feature_block_size,
    registry_path: authorityCorpusStructure.numbering.registry_path,
    feature_blocks: blocks,
  };
  return {...result, allocation_sha256: digest(result)};
}

export function allocatePortableFeatureExtension(authorityCorpusStructure, featureId) {
  validateAuthorityCorpusStructure(authorityCorpusStructure);
  validateEntityId(featureId, "feature extension ID");
  const blocks = authorityCorpusStructure.numbering.existing_feature_blocks;
  const featureBlocks = blocks
    .filter((block) => block.feature_id === featureId)
    .sort((left, right) => left.start - right.start);
  if (featureBlocks.length === 0
      || !featureBlocks.some((block) => block.kind === "PRIMARY")) {
    throw new Error("feature extension requires an existing primary block");
  }
  const used = new Set(blocks.map((block) => block.start));
  let start = authorityCorpusStructure.numbering.first_feature_start;
  while (used.has(start)) start += authorityCorpusStructure.numbering.feature_block_size;
  const predecessor = featureBlocks.at(-1);
  const next = structuredClone(authorityCorpusStructure);
  next.numbering.existing_feature_blocks.push({
    feature_id: featureId,
    start,
    kind: "EXTENSION",
    extends_start: predecessor.start,
  });
  validateAuthorityCorpusStructure(next);
  return next;
}

function validateAgentLifecycle(value) {
  exactKeys(value, [
    "pin_when_supported", "persistent_roles", "completed_sessions",
    "naming_template", "handoff_event_log",
  ], "agent lifecycle");
  const roles = new Set([
    "BOOTSTRAP", "AUDITOR", "ORCHESTRATOR", "FEATURE_AGENT",
    "PLATFORM_AGENT", "RUNTIME",
  ]);
  for (const field of ["pin_when_supported", "persistent_roles"]) {
    if (!Array.isArray(value[field])
        || value[field].some((role) => !roles.has(role))
        || new Set(value[field]).size !== value[field].length) {
      throw new Error(`agent lifecycle ${field} invalid`);
    }
  }
  for (const required of ["AUDITOR", "ORCHESTRATOR", "FEATURE_AGENT", "PLATFORM_AGENT"]) {
    if (!value.pin_when_supported.includes(required)) {
      throw new Error(`active campaign ${required} must be visible when pinning is supported`);
    }
  }
  if (!value.persistent_roles.includes("RUNTIME")) {
    throw new Error("Runtime must remain persistent across campaigns");
  }
  if (![
    "ARCHIVE_UNPIN_KEEP_SESSION_ID", "KEEP_PINNED", "HOST_DEFAULT",
  ].includes(value.completed_sessions)) throw new Error("completed-session policy invalid");
  requireString(value.naming_template, "agent naming template");
  for (const token of ["{role}", "{release}", "{governance}"]) {
    if (!value.naming_template.includes(token)) {
      throw new Error(`agent naming template lacks ${token}`);
    }
  }
  if (value.handoff_event_log !== true) {
    throw new Error("agent lifecycle must preserve compact handoff session identity");
  }
}

function validateCampaignTopology(value) {
  exactKeys(value, [
    "default_mode", "maximum_parallel_lanes", "handoff_policy",
    "milestone_integration",
  ], "campaign topology");
  if (value.default_mode !== "SINGLE_CUMULATIVE_ROOT") {
    throw new Error("2.1rc activation supports exactly one cumulative workstream");
  }
  if (!Number.isSafeInteger(value.maximum_parallel_lanes)
      || value.maximum_parallel_lanes < 1 || value.maximum_parallel_lanes > 32) {
    throw new Error("campaign maximum parallel lanes invalid");
  }
  if (value.default_mode === "SINGLE_CUMULATIVE_ROOT"
      && value.maximum_parallel_lanes !== 1) {
    throw new Error("single-root default contradicts its lane maximum");
  }
  if (value.handoff_policy !== "CLEAN_PUSHED_CHECKPOINT_TO_NEXT_DEPENDENCY_OWNER"
      || value.milestone_integration !== "RUNTIME_AFTER_TERMINAL_CHECKPOINT") {
    throw new Error("campaign handoff or milestone policy invalid");
  }
}

function validateImportSource(value, label) {
  exactKeys(value, [
    "kind", "path", "source_governance_version", "content_sha256", "read_only",
  ], label);
  if (!["PROJECT_RELATIVE", "EXTERNAL_EXPLICIT", "NONE"].includes(value.kind)
      || value.read_only !== true) throw new Error(`${label} kind or read-only boundary invalid`);
  if (value.kind === "PROJECT_RELATIVE") {
    requireSafeRelativePath(value.path, `${label} path`);
    requireSha(value.content_sha256, `${label} content`);
  } else if (value.kind === "EXTERNAL_EXPLICIT") {
    requireString(value.path, `${label} external path`);
    if (!path.isAbsolute(value.path)) throw new Error(`${label} external path must be absolute`);
    requireSha(value.content_sha256, `${label} content`);
  } else if (value.path !== null || value.content_sha256 !== null) {
    throw new Error(`${label} NONE source must have null path and content digest`);
  }
  if (value.source_governance_version !== null
      && (typeof value.source_governance_version !== "string"
        || value.source_governance_version.length === 0)) {
    throw new Error(`${label} governance version invalid`);
  }
}

function validateIntentFeatures(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("intent.features is empty");
  const ids = new Set();
  for (const feature of value) {
    exactKeys(feature, [
      "feature_id", "outcome", "users", "owned_truth", "dependencies",
      "unavailable_behavior",
    ], "feature intent");
    for (const field of ["feature_id", "outcome", "owned_truth", "unavailable_behavior"]) {
      requireString(feature[field], `feature ${field}`);
    }
    for (const field of ["users", "dependencies"]) {
      if (!Array.isArray(feature[field])
          || feature[field].some((item) => typeof item !== "string" || item.length === 0)) {
        throw new Error(`feature ${field} invalid`);
      }
      if (new Set(feature[field]).size !== feature[field].length) {
        throw new Error(`feature ${field} contains duplicates`);
      }
    }
    if (feature.users.length === 0) throw new Error("feature users are empty");
    if (ids.has(feature.feature_id)) throw new Error("duplicate feature ID");
    ids.add(feature.feature_id);
  }
}

function validateIntentGates(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("intent.gates is empty");
  const ids = new Set();
  for (const gate of value) {
    exactKeys(gate, [
      "gate_id", "feature_id", "intent", "owner", "lifecycle_status",
      "evidence_disposition", "dependencies", "done_when",
      "proof_expectation", "failure_behavior", "accepted_live_closure",
    ], "intent gate");
    for (const field of [
      "gate_id", "feature_id", "intent", "owner", "done_when",
      "proof_expectation", "failure_behavior",
    ]) requireString(gate[field], `gate ${field}`);
    if (![
      "PLANNED", "BUILDING", "PROTOTYPED", "TESTING", "VERIFIED",
      "ACCEPTED_LIVE", "BLOCKED", "DEFERRED", "UNAVAILABLE", "SUPERSEDED",
    ].includes(gate.lifecycle_status)) throw new Error("gate lifecycle status invalid");
    if (![
      "PASS_WITH_EVIDENCE", "FAIL_ACTIVE_REPAIR", "UNPROVEN_ACTIVE_EVIDENCE",
      "NOT_APPLICABLE_WITH_EXACT_AUTHORITY", "OWNER_ONLY",
    ].includes(gate.evidence_disposition)) {
      throw new Error("gate evidence disposition invalid");
    }
    if (!Array.isArray(gate.dependencies)
        || gate.dependencies.some((dependency) =>
          typeof dependency !== "string" || dependency.length === 0)
        || new Set(gate.dependencies).size !== gate.dependencies.length) {
      throw new Error("gate dependencies invalid");
    }
    if (gate.lifecycle_status === "ACCEPTED_LIVE") {
      if (gate.evidence_disposition !== "PASS_WITH_EVIDENCE") {
        throw new Error("accepted-live gate lacks passing evidence");
      }
      exactKeys(gate.accepted_live_closure, [
        "deployed", "rollback", "audit_report_sha256",
        "closure_receipt_sha256",
      ], "accepted-live gate closure");
      for (const identity of ["deployed", "rollback"]) {
        exactKeys(gate.accepted_live_closure[identity], [
          "identity_sha256", "receipt_sha256",
        ], `${identity} release identity`);
        requireSha(
          gate.accepted_live_closure[identity].identity_sha256,
          `${identity} release identity`,
        );
        requireSha(
          gate.accepted_live_closure[identity].receipt_sha256,
          `${identity} release receipt`,
        );
      }
      requireSha(gate.accepted_live_closure.audit_report_sha256, "live audit report");
      requireSha(gate.accepted_live_closure.closure_receipt_sha256, "live closure receipt");
    } else if (gate.accepted_live_closure !== null) {
      throw new Error("non-live gate carries accepted-live closure authority");
    }
    if (ids.has(gate.gate_id)) throw new Error("duplicate gate ID");
    ids.add(gate.gate_id);
  }
}

function rejectDependencyCycle(nodes, dependenciesFor, label) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node)) throw new Error(`${label} contains a dependency cycle`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of dependenciesFor(node)) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  };
  [...nodes].sort(compareUtf8).forEach(visit);
}

function validateIntentGraph(features, gates) {
  validateIntentFeatures(features);
  validateIntentGates(gates);
  const featureById = new Map(features.map((feature) => [feature.feature_id, feature]));
  for (const feature of features) {
    for (const dependency of feature.dependencies) {
      if (!featureById.has(dependency) || dependency === feature.feature_id) {
        throw new Error("feature dependency is missing or self-referential");
      }
    }
  }
  rejectDependencyCycle(
    featureById.keys(),
    (featureId) => featureById.get(featureId).dependencies,
    "feature graph",
  );
  const gateById = new Map(gates.map((gate) => [gate.gate_id, gate]));
  for (const gate of gates) {
    if (!featureById.has(gate.feature_id)) throw new Error("gate references unknown feature");
    for (const dependency of gate.dependencies) {
      if (!gateById.has(dependency) || dependency === gate.gate_id) {
        throw new Error("gate dependency is missing or self-referential");
      }
    }
  }
  rejectDependencyCycle(
    gateById.keys(),
    (gateId) => gateById.get(gateId).dependencies,
    "gate graph",
  );
}

function validateSpecialAnswer(questionId, value) {
  if (questionId === "providers.capability_map") validateProviderCapabilityMap(value);
  if (questionId === "deployment.policy") validateDeploymentPolicy(value);
  if (questionId === "testing.authentication") validateAuthenticationPolicy(value);
  if (questionId === "security.acceptance_baselines") validateSecurityBaselines(value);
  if (questionId === "workflow.agent_lifecycle") validateAgentLifecycle(value);
  if (questionId === "workflow.campaign_topology") validateCampaignTopology(value);
  if (questionId === "authority_corpus.operation" && !AUTHORITY_CORPUS_OPERATIONS.has(value)) {
    throw new Error("authority corpus operation invalid");
  }
  if (questionId === "authority_corpus.source") validateImportSource(value, "authority corpus source");
  if (questionId === "authority_corpus.structure") validateAuthorityCorpusStructure(value);
  if (questionId === "design.operation" && !DESIGN_OPERATIONS.has(value)) {
    throw new Error("Design Bible operation invalid");
  }
  if (questionId === "design.source") validateImportSource(value, "Design Bible source");
  if (questionId === "intent.features") validateIntentFeatures(value);
  if (questionId === "intent.gates") validateIntentGates(value);
}

function validateAnswer(answer, expectedQuestion = null) {
  exactKeys(answer, [
    "question_id", "value", "status", "answered_by", "answered_at",
    "discovery_fact_ids", "rationale", "answer_sha256",
  ], "answer");
  const question = questionById(answer.question_id);
  if (expectedQuestion && answer.question_id !== expectedQuestion.id) {
    throw new Error("answer is not for the active question");
  }
  validateValue(question.type, answer.value, `answer ${answer.question_id}`);
  if (question.choices && !question.choices.includes(answer.value)) {
    throw new Error("answer is outside enumerated choices");
  }
  if (answer.question_id === "setup.interaction_mode" && !MODES.has(answer.value)) {
    throw new Error("interaction mode invalid");
  }
  if (answer.question_id === "evidence.active_window_days"
      && (answer.value < 1 || answer.value > 3650)) {
    throw new Error("retention interval invalid");
  }
  if (answer.question_id === "workflow.progress_interval_minutes"
      && (answer.value < 1 || answer.value > 1440)) {
    throw new Error("progress interval invalid");
  }
  if (answer.question_id === "project.users" && answer.value.length === 0) {
    throw new Error("project users cannot be empty");
  }
  if (answer.question_id === "models.rules") validateModelRules(answer.value);
  validateSpecialAnswer(answer.question_id, answer.value);
  if (!ANSWER_STATUSES.has(answer.status)) throw new Error("answer status invalid");
  requireString(answer.answered_by, "answer actor");
  requireUtc(answer.answered_at, "answer time");
  if (!Array.isArray(answer.discovery_fact_ids)
      || answer.discovery_fact_ids.some((id) => typeof id !== "string")) {
    throw new Error("answer discovery references invalid");
  }
  requireString(answer.rationale, "answer rationale");
  const body = structuredClone(answer);
  delete body.answer_sha256;
  if (digest(body) !== answer.answer_sha256) throw new Error("answer digest mismatch");
  return question;
}

export function createGuidedBootstrapState(
  discovery, now, bootstrapSessionId, discoveryReceiptSha256,
) {
  requireUtc(now, "state creation time");
  requireString(bootstrapSessionId, "Bootstrap session ID");
  requireSha(discoveryReceiptSha256, "discovery receipt");
  if (!Array.isArray(discovery)) throw new Error("discovery must be an array");
  discovery.forEach(validateDiscoveredFact);
  if (discovery.some((fact) =>
    new Date(fact.observed_at).getTime() > new Date(now).getTime())) {
    throw new Error("discovery fact postdates Bootstrap creation");
  }
  const factIds = discovery.map((fact) => fact.fact_id);
  if (new Set(factIds).size !== factIds.length) throw new Error("duplicate discovery fact");
  projectRootFromDiscovery(discovery);
  const state = {
    schema: "governance.guided_bootstrap_state.v1",
    governance_version: "2.1rc",
    bootstrap_session_id: bootstrapSessionId,
    created_at: now,
    revision: 0,
    updated_at: now,
    discovery: structuredClone(discovery),
    discovery_digest_sha256: digest(discovery),
    discovery_receipt_sha256: discoveryReceiptSha256,
    interaction_mode: null,
    answers: {},
    answer_order: [],
    exchange_chain_head_sha256: "0".repeat(64),
    imported_exchange_ids: [],
    imported_exchange_receipts: [],
    deferred_context: [],
    phase_outputs: {},
    setup_audit: null,
    sealed_snapshot: null,
    launch: null,
  };
  validateGuidedBootstrapState(state);
  return state;
}

export function nextGuidedQuestion(state) {
  validateGuidedBootstrapState(state);
  const phase = currentPhase(state);
  if (phase === null) return null;
  const question = unresolvedForPhase(state, phase)[0];
  const discovered = state.discovery.filter((fact) =>
    fact.fact_id === question.id || fact.fact_id.startsWith(`${question.id}.`));
  return {
    question_id: question.id,
    phase,
    prompt: question.prompt,
    type: question.type,
    choices: question.choices ?? null,
    recommendation: question.recommended ?? null,
    discovered_prefill: discovered.length === 0 ? null : discovered,
    confirmation_required: true,
  };
}

export function applyGuidedAnswer(state, proposed) {
  validateGuidedBootstrapState(state);
  if (state.sealed_snapshot !== null) throw new Error("sealed setup is immutable");
  const active = nextGuidedQuestion(state);
  if (active === null) throw new Error("no question is active");
  const body = {
    question_id: proposed.question_id,
    value: structuredClone(proposed.value),
    status: proposed.status,
    answered_by: proposed.answered_by,
    answered_at: proposed.answered_at,
    discovery_fact_ids: [...proposed.discovery_fact_ids],
    rationale: proposed.rationale,
  };
  const answer = {...body, answer_sha256: digest(body)};
  const question = validateAnswer(answer, questionById(active.question_id));
  if (answer.question_id === "models.rules") {
    validateModelRulesAgainstDiscovery(answer.value, state.discovery);
  }
  if (answer.question_id === "authority_corpus.source" || answer.question_id === "design.source") {
    verifyGuidedImportSource(answer.value, projectRootFromDiscovery(state.discovery));
  }
  requireTimeNotBefore(answer.answered_at, state.updated_at, "answer time");
  const factIds = new Set(state.discovery.map((fact) => fact.fact_id));
  if (answer.discovery_fact_ids.some((id) => !factIds.has(id))) {
    throw new Error("answer cites unknown discovery fact");
  }
  if (question.human_required && answer.status === "DISCOVERY_CONFIRMED"
      && answer.discovery_fact_ids.length === 0) {
    throw new Error("discovery-confirmed answer lacks discovery evidence");
  }
  const next = structuredClone(state);
  next.answers[answer.question_id] = answer;
  next.answer_order.push(answer.question_id);
  if (answer.question_id === "setup.interaction_mode") next.interaction_mode = answer.value;
  next.revision += 1;
  next.updated_at = answer.answered_at;
  validateGuidedBootstrapState(next);
  return next;
}

export function compileChatGptExchange(state, phase, packageId, createdAt) {
  validateGuidedBootstrapState(state);
  requireString(packageId, "package ID");
  requireUtc(createdAt, "package time");
  requireTimeNotBefore(createdAt, state.updated_at, "package time");
  if (state.interaction_mode !== "CHATGPT_GUIDED") {
    throw new Error("ChatGPT exchange is not selected");
  }
  if (!PHASES.includes(phase) || currentPhase(state) !== phase) {
    throw new Error("exchange phase is not active");
  }
  const questions = unresolvedForPhase(state, phase).map((question) => ({
    question_id: question.id,
    prompt: question.prompt,
    type: question.type,
    choices: question.choices ?? null,
    recommendation: question.recommended ?? null,
    discovered_prefill: state.discovery.filter((fact) =>
      fact.fact_id === question.id || fact.fact_id.startsWith(`${question.id}.`)),
  }));
  const body = {
    schema: "governance.chatgpt_bootstrap_exchange.v1",
    governance_version: "2.1rc",
    package_id: packageId,
    phase,
    created_at: createdAt,
    prior_exchange_sha256: state.exchange_chain_head_sha256,
    state_revision: state.revision,
    discovery_digest_sha256: state.discovery_digest_sha256,
    question_cadence: "EXACTLY_ONE_QUESTION_THEN_WAIT",
    sufficiency_rule: "STOP_WHEN_REASONABLY_SUFFICIENT_DEFER_NON_ROUTE_CHANGING_GAPS",
    secret_rule: "DO_NOT_REQUEST_OR_RETURN_SECRETS_CREDENTIALS_COOKIES_OR_TOKENS",
    authority_rule: "CHATGPT_ADVISES_BOOTSTRAP_VALIDATES_OWNER_CONFIRMS",
    model_research: {
      required_when_phase: phase === "FOUNDATION",
      source_url: "https://artificialanalysis.ai/models",
      treatment: "ADVISORY_CURRENT_SOURCE_NOT_AUTHORITY",
      required_outputs: [
        "recommended_configuration", "economical_configuration",
        "customizable_alternatives", "source_observed_at", "source_digest_sha256",
      ],
      selection_law: {
        recommended: "LEAST_EXPENSIVE_MODEL_STRONG_ENOUGH_TO_REACH_PROJECT_INTENT_RELIABLY",
        economical: "MINIMIZE_EXPECTED_TOTAL_COMPLETION_COST_NOT_UNIT_TOKEN_PRICE",
        light_model_preference: "PREFER_LIGHT_HIGH_REASONING_BUILDERS_WHEN_EXPECTED_REWORK_STAYS_LOWER",
        promotion: "PROMOTE_ORCHESTRATORS_AND_FEATURE_AGENTS_TO_THE_VALUE_KNEE_WHEN_RETRIES_REWORK_OR_COORDINATION_RISK_DOMINATE",
        hardcoded_model_names: "FORBIDDEN",
      },
    },
    questions,
  };
  return {...body, package_sha256: digest(body)};
}

export function renderChatGptExchangeMarkdown(exchange) {
  exactKeys(exchange, [
    "schema", "governance_version", "package_id", "phase", "created_at",
    "prior_exchange_sha256", "state_revision", "discovery_digest_sha256",
    "question_cadence", "sufficiency_rule", "secret_rule", "authority_rule",
    "model_research", "questions", "package_sha256",
  ], "ChatGPT exchange");
  const exchangeBody = structuredClone(exchange);
  delete exchangeBody.package_sha256;
  if (exchange.schema !== "governance.chatgpt_bootstrap_exchange.v1"
      || digest(exchangeBody) !== exchange.package_sha256) {
    throw new Error("Markdown exchange does not bind a valid canonical manifest");
  }
  const lines = [
    `# ${exchange.phase} Bootstrap conversation`,
    "",
    `Package: \`${exchange.package_id}\``,
    `Governance: \`${exchange.governance_version}\``,
    `Manifest SHA-256: \`${exchange.package_sha256}\``,
    "",
    "## Instruction",
    "",
    "Help the user clarify this phase. Ask exactly one question, wait for one response, then continue.",
    "Use the questions and discovery notes below as a starting point to riff from, not a script to recite.",
    "Explore scenarios, comparisons, and edge cases only when they could materially change the answer.",
    "Stop when the phase is reasonably sufficient. Do not over-question the user.",
    "Separate discovered facts, guesses, recommendations, and user-confirmed decisions.",
    "Do not request or return secrets, credentials, cookies, tokens, private keys, or signed links.",
    "Return the paired response JSON with the exact package identity, question IDs, order, values, and rationales.",
    "",
  ];
  if (exchange.model_research.required_when_phase) {
    lines.push(
      "## Model recommendation note",
      "",
      "Inspect currently spawnable models first and use the configured comparison source only as advisory evidence.",
      "Recommended means the least expensive model strong enough to reach intent reliably.",
      "Eco means the lowest expected total completion cost after retries and rework, not the cheapest attempt.",
      "Prefer light high-reasoning builders where economical; promote Orchestrators and Feature Agents near the value knee.",
      "Do not hardcode model names.",
      "",
    );
  }
  lines.push("## Questions", "");
  exchange.questions.forEach((question, index) => {
    lines.push(
      `### ${index + 1}. ${question.prompt}`,
      "",
      `- ID: \`${question.question_id}\``,
      `- Type: \`${question.type}\``,
    );
    if (question.choices) {
      lines.push(`- Choices: ${question.choices.map((value) => `\`${value}\``).join(", ")}`);
    }
    if (question.recommendation !== null) {
      lines.push(`- Initial recommendation: \`${JSON.stringify(question.recommendation)}\``);
    }
    if (question.discovered_prefill.length === 0) {
      lines.push("- Discovery: no reliable prefill");
    } else {
      lines.push("- Discovery guesses to confirm:");
      for (const fact of question.discovered_prefill) {
        lines.push(`  - ${JSON.stringify(fact.value)} (${fact.confidence}; ${fact.source_locator})`);
      }
    }
    lines.push("- Riff on: likely scenarios, route-changing exceptions, and a concise recommendation.", "");
  });
  lines.push(
    "## Return",
    "",
    "Return `governance.chatgpt_bootstrap_response.v1` JSON bound to this exact package.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function validateChatGptResponse(response, exchange) {
  exactKeys(response, [
    "schema", "package_id", "package_sha256", "completed_at",
    "answers", "remaining_material_questions", "deferred_nonmaterial_questions",
    "response_sha256",
  ], "ChatGPT response");
  if (response.schema !== "governance.chatgpt_bootstrap_response.v1"
      || response.package_id !== exchange.package_id
      || response.package_sha256 !== exchange.package_sha256) {
    throw new Error("ChatGPT response does not bind the exchange");
  }
  requireUtc(response.completed_at, "response time");
  if (new Date(response.completed_at).getTime() < new Date(exchange.created_at).getTime()) {
    throw new Error("ChatGPT response predates its exchange");
  }
  if (!Array.isArray(response.answers) || response.answers.length === 0) {
    throw new Error("ChatGPT response lacks answers");
  }
  const expectedIds = exchange.questions.map((question) => question.question_id);
  const actualIds = response.answers.map((answer) => answer.question_id);
  if (expectedIds.join("\0") !== actualIds.join("\0")) {
    throw new Error("ChatGPT response changed question order or membership");
  }
  let priorAnswerTime = new Date(exchange.created_at).getTime();
  const completionTime = new Date(response.completed_at).getTime();
  for (const answer of response.answers) {
    validateAnswer(answer);
    const answerTime = new Date(answer.answered_at).getTime();
    if (answerTime < priorAnswerTime || answerTime > completionTime) {
      throw new Error("ChatGPT answer chronology is outside its exchange");
    }
    priorAnswerTime = answerTime;
  }
  for (const key of ["remaining_material_questions", "deferred_nonmaterial_questions"]) {
    if (!Array.isArray(response[key])
        || response[key].some((item) => typeof item !== "string")) {
      throw new Error(`${key} must be a string list`);
    }
  }
  const body = structuredClone(response);
  delete body.response_sha256;
  if (digest(body) !== response.response_sha256) {
    throw new Error("ChatGPT response digest mismatch");
  }
}

export function importChatGptResponse(state, exchange, response) {
  validateGuidedBootstrapState(state);
  validateChatGptResponse(response, exchange);
  if (state.exchange_chain_head_sha256 !== exchange.prior_exchange_sha256
      || state.revision !== exchange.state_revision
      || state.imported_exchange_ids.includes(exchange.package_id)) {
    throw new Error("ChatGPT exchange is stale or replayed");
  }
  if (response.remaining_material_questions.length > 0) {
    throw new Error("material ChatGPT questions remain unresolved");
  }
  let next = structuredClone(state);
  for (const answer of response.answers) {
    next = applyGuidedAnswer(next, answer);
  }
  next.exchange_chain_head_sha256 = response.response_sha256;
  next.imported_exchange_ids.push(exchange.package_id);
  const receipt = {
    package_id: exchange.package_id,
    package_sha256: exchange.package_sha256,
    response_sha256: response.response_sha256,
    prior_exchange_sha256: exchange.prior_exchange_sha256,
    state_revision: exchange.state_revision,
    completed_at: response.completed_at,
    answer_ids: response.answers.map((answer) => answer.question_id),
  };
  next.imported_exchange_receipts.push({
    ...receipt,
    receipt_sha256: digest(receipt),
  });
  if (response.deferred_nonmaterial_questions.length > 0) {
    const deferred = {
      phase: exchange.phase,
      items: [...response.deferred_nonmaterial_questions],
      response_sha256: response.response_sha256,
    };
    next.deferred_context.push({...deferred, deferred_sha256: digest(deferred)});
  }
  next.revision += 1;
  next.updated_at = response.completed_at;
  validateGuidedBootstrapState(next);
  return next;
}

export function resolveModelRule(rules, context) {
  validateModelRules(rules);
  requireRecord(context, "model resolution context");
  const matches = rules.filter((rule) => {
    if (rule.scope === "GLOBAL_DEFAULT") return true;
    return Object.entries(rule.match).every(([key, value]) => context[key] === value);
  }).sort((left, right) =>
    MODEL_RULE_PRECEDENCE[right.scope] - MODEL_RULE_PRECEDENCE[left.scope]
      || compareUtf8(left.rule_id, right.rule_id));
  if (matches.length === 0) throw new Error("no model rule matches");
  const top = matches[0];
  const peers = matches.filter((rule) =>
    MODEL_RULE_PRECEDENCE[rule.scope] === MODEL_RULE_PRECEDENCE[top.scope]);
  if (peers.length !== 1) throw new Error("model resolution is ambiguous");
  return {
    rule_id: top.rule_id,
    model: top.model,
    reasoning: top.reasoning,
    cost_mode: top.cost_mode,
    resolution_sha256: digest({context, rule: top}),
  };
}

function validatePhaseChoiceConsistency(state, output) {
  if (output.phase === "AUTHORITY_CORPUS") {
    const operation = state.answers["authority_corpus.operation"]?.value;
    const source = state.answers["authority_corpus.source"]?.value;
    if (output.operation !== operation) {
      throw new Error("authority corpus output operation contradicts the confirmed choice");
    }
    validateImportSource(source, "confirmed authority corpus source");
    if ((operation === "IMPORT" || operation === "ALIGN_AND_REFACTOR")
        && source.kind === "NONE") {
      throw new Error("authority corpus import or alignment requires an exact source");
    }
    if (operation === "CREATE_NEW" && source.kind !== "NONE") {
      throw new Error("new authority corpus creation cannot claim an import source");
    }
    if (output.source_identity !== `sha256:${digest(source)}`) {
      throw new Error("authority corpus output does not bind the confirmed source");
    }
  }
  if (output.phase === "DESIGN_BIBLE") {
    const operation = state.answers["design.operation"]?.value;
    const source = state.answers["design.source"]?.value;
    if (output.operation !== operation) {
      throw new Error("Design Bible output operation contradicts the confirmed choice");
    }
    validateImportSource(source, "confirmed Design Bible source");
    if ((operation === "IMPORT" || operation === "ALIGN_AND_REFACTOR")
        && source.kind === "NONE") {
      throw new Error("Design Bible import or alignment requires an exact source");
    }
    if ((operation === "CREATE_NEW" || operation === "DEFER_EXPLICITLY")
        && source.kind !== "NONE") {
      throw new Error("Design Bible create/defer cannot claim an import source");
    }
    if (output.source_identity !== `sha256:${digest(source)}`) {
      throw new Error("Design Bible output does not bind the confirmed source");
    }
  }
}

function validatePhaseOutputReality(state, output) {
  if (!["GIT_COMMIT", "LOCAL_CONTENT"].includes(output.identity_kind)) {
    throw new Error("phase output identity kind invalid");
  }
  if (!Array.isArray(output.artifact_files) || output.artifact_files.length !== 4) {
    throw new Error("phase output must bind four artifact roles");
  }
  const expectedRoles = ["CONTEXT", "INDEX", "MAPPING", "VERIFICATION"];
  const roles = output.artifact_files.map((entry) => entry.role).sort(compareUtf8);
  if (JSON.stringify(roles) !== JSON.stringify(expectedRoles)) {
    throw new Error("phase output artifact roles are incomplete");
  }
  for (const entry of output.artifact_files) {
    exactKeys(entry, ["role", "path", "sha256"], "phase output artifact file");
    requireSafeRelativePath(entry.path, `phase ${entry.role} path`);
    requireSha(entry.sha256, `phase ${entry.role} digest`);
  }
  if (new Set(output.artifact_files.map((entry) => entry.path)).size !== 4) {
    throw new Error("phase output artifact roles must bind distinct paths");
  }
  const artifactPrefix = output.artifact_root === "."
    ? ""
    : `${output.artifact_root.replace(/\/+$/u, "")}/`;
  if (output.artifact_files.some((entry) =>
    artifactPrefix !== "" && !entry.path.startsWith(artifactPrefix))) {
    throw new Error("phase output artifact path is outside its artifact root");
  }
  const roleDigest = Object.fromEntries(
    output.artifact_files.map((entry) => [entry.role, entry.sha256]),
  );
  if (output.index_sha256 !== roleDigest.INDEX
      || output.context_sha256 !== roleDigest.CONTEXT
      || output.mapping_sha256 !== roleDigest.MAPPING) {
    throw new Error("phase output named digests disagree with its artifact manifest");
  }
  const projectRoot = projectRootFromDiscovery(state.discovery);
  if (output.identity_kind === "GIT_COMMIT") {
    requireSafeRelativePath(output.repository, "phase output repository");
    if (!/^[0-9a-f]{40,64}$/.test(output.commit)
        || !/^[0-9a-f]{40,64}$/.test(output.tree)
        || output.local_content_sha256 !== null) {
      throw new Error("phase output Git identity is malformed");
    }
    const repository = resolveContainedExisting(
      projectRoot, output.repository, "phase output repository",
    );
    const git = (...args) => execFileSync(
      "git", ["-C", repository, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]},
    ).trim();
    const commit = git("rev-parse", "--verify", `${output.commit}^{commit}`);
    const tree = git("show", "-s", "--format=%T", commit);
    if (commit !== output.commit || tree !== output.tree) {
      throw new Error("phase output Git commit/tree identity mismatch");
    }
    const rootType = output.artifact_root === "."
      ? git("cat-file", "-t", tree)
      : git("cat-file", "-t", `${commit}:${output.artifact_root}`);
    if (rootType !== "tree") throw new Error("phase output Git artifact root is not a tree");
    for (const entry of output.artifact_files) {
      if (git("cat-file", "-t", `${commit}:${entry.path}`) !== "blob") {
        throw new Error("phase output Git artifact is not a regular file blob");
      }
      const bytes = execFileSync(
        "git", ["-C", repository, "show", `${commit}:${entry.path}`],
        {stdio: ["ignore", "pipe", "pipe"]},
      );
      const observed = crypto.createHash("sha256").update(bytes).digest("hex");
      if (observed !== entry.sha256) throw new Error("phase output Git artifact digest mismatch");
    }
  } else {
    if (output.repository !== null || output.commit !== null || output.tree !== null) {
      throw new Error("local-only phase output carries Git identity");
    }
    const artifactRoot = resolveContainedExisting(
      projectRoot, output.artifact_root, "local phase artifact root",
    );
    if (!fs.statSync(artifactRoot).isDirectory()) {
      throw new Error("local phase artifact root is not a directory");
    }
    for (const entry of output.artifact_files) {
      const target = resolveContainedExisting(
        projectRoot, entry.path, `local phase ${entry.role}`,
      );
      if (target !== artifactRoot && !target.startsWith(`${artifactRoot}${path.sep}`)) {
        throw new Error("local phase artifact is outside its artifact root");
      }
      if (!fs.statSync(target).isFile()) throw new Error("local phase artifact is not a file");
      const observed = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      if (observed !== entry.sha256) throw new Error("local phase artifact digest mismatch");
    }
    const expectedLocal = digest(output.artifact_files);
    if (output.local_content_sha256 !== expectedLocal) {
      throw new Error("local phase content identity mismatch");
    }
  }
  const verificationBody = {
    identity_kind: output.identity_kind,
    repository: output.repository,
    commit: output.commit,
    tree: output.tree,
    artifact_files: output.artifact_files,
    local_content_sha256: output.local_content_sha256,
  };
  if (output.verification_sha256 !== digest(verificationBody)) {
    throw new Error("phase output verification receipt mismatch");
  }
}

export function recordPhaseOutput(state, output, at) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(at, state.updated_at, "phase output time");
  exactKeys(output, [
    "phase", "operation", "source_identity", "artifact_root", "identity_kind",
    "repository",
    "commit", "tree", "index_sha256", "context_sha256", "mapping_sha256",
    "artifact_files", "local_content_sha256", "verification_sha256",
    "status", "writer_session_id", "unavailable_reason",
  ], "phase output");
  if (!PHASES.includes(output.phase)) throw new Error("phase output phase invalid");
  if (state.phase_outputs[output.phase]) throw new Error("phase output is append-only");
  if (!PHASE_OPERATIONS.get(output.phase).has(output.operation)) {
    throw new Error("phase operation does not match the phase");
  }
  if (output.writer_session_id !== state.bootstrap_session_id) {
    throw new Error("only the bound Bootstrap session may record phase output");
  }
  requireString(output.source_identity, "phase output source identity");
  requireSafeRelativePath(output.artifact_root, "phase output artifact root");
  for (const key of [
    "index_sha256", "context_sha256", "mapping_sha256", "verification_sha256",
  ]) {
    requireSha(output[key], `phase output ${key}`);
  }
  if (output.status !== "VERIFIED") throw new Error("phase output is not verified");
  if (output.operation === "DEFER_EXPLICITLY") {
    requireString(output.unavailable_reason, "deferred Design Bible unavailable reason");
  } else if (output.unavailable_reason !== null) {
    throw new Error("non-deferred phase cannot carry unavailable reason");
  }
  if (unresolvedForPhase(state, output.phase).length > 0) {
    throw new Error("phase output precedes complete context");
  }
  validatePhaseChoiceConsistency(state, output);
  for (const sourceKey of ["authority_corpus.source", "design.source"]) {
    const source = state.answers[sourceKey]?.value;
    if (source) verifyGuidedImportSource(source, projectRootFromDiscovery(state.discovery));
  }
  validatePhaseOutputReality(state, output);
  const phaseIndex = PHASES.indexOf(output.phase);
  if (PHASES.slice(0, phaseIndex).some((phase) => !state.phase_outputs[phase])
      || PHASES.slice(phaseIndex + 1).some((phase) => state.phase_outputs[phase])) {
    throw new Error("phase output is outside deterministic phase order");
  }
  const next = structuredClone(state);
  const outputRecord = {...output, recorded_at: at};
  next.phase_outputs[output.phase] = {
    ...outputRecord,
    output_sha256: digest(outputRecord),
  };
  next.revision += 1;
  next.updated_at = at;
  validateGuidedBootstrapState(next);
  return next;
}

export function sealGuidedBootstrap(state, audit, sealedAt) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(sealedAt, state.updated_at, "seal time");
  exactKeys(audit, [
    "auditor_session_id", "report_sha256", "disposition", "audited_at",
  ], "setup audit");
  requireString(audit.auditor_session_id, "auditor session");
  if (audit.auditor_session_id === state.bootstrap_session_id) {
    throw new Error("setup Auditor must be independent from Bootstrap");
  }
  if (!SHA256.test(audit.report_sha256)) throw new Error("audit digest invalid");
  if (audit.disposition !== "ACCEPTED") throw new Error("setup audit not accepted");
  requireUtc(audit.audited_at, "audit time");
  if (new Date(audit.audited_at).getTime() < new Date(state.updated_at).getTime()
      || new Date(sealedAt).getTime() < new Date(audit.audited_at).getTime()) {
    throw new Error("setup audit or seal chronology is invalid");
  }
  if (currentPhase(state) !== null) throw new Error("setup questions remain");
  for (const phase of PHASES) {
    if (!state.phase_outputs[phase]) throw new Error(`missing ${phase} output`);
  }
  const next = structuredClone(state);
  next.setup_audit = {...structuredClone(audit), audit_sha256: digest(audit)};
  const articleNumbering = compilePortableArticleNumbering(
    next.answers["authority_corpus.structure"].value,
    next.answers["intent.features"].value,
  );
  const snapshot = {
    schema: "governance.guided_bootstrap_snapshot.v1",
    governance_version: "2.1rc",
    interaction_mode: next.interaction_mode,
    bootstrap_session_id: next.bootstrap_session_id,
    auditor_session_id: audit.auditor_session_id,
    discovery_digest_sha256: next.discovery_digest_sha256,
    discovery_receipt_sha256: next.discovery_receipt_sha256,
    answers_sha256: digest(next.answers),
    imported_exchange_receipts_sha256: digest(next.imported_exchange_receipts),
    deferred_context_sha256: digest(next.deferred_context),
    phase_outputs_sha256: digest(next.phase_outputs),
    model_rules_sha256: digest(next.answers["models.rules"].value),
    evidence_active_window_days: next.answers["evidence.active_window_days"].value,
    progress_interval_minutes: next.answers["workflow.progress_interval_minutes"].value,
    agent_lifecycle_sha256: digest(next.answers["workflow.agent_lifecycle"].value),
    campaign_topology_sha256: digest(next.answers["workflow.campaign_topology"].value),
    gpt_assist_mode: next.answers["workflow.gpt_assist_mode"].value,
    article_numbering: articleNumbering,
    testing_policy_sha256: digest({
      browser: next.answers["testing.interactive_browser"].value,
      automation: next.answers["testing.browser_automation"].value,
      authentication: next.answers["testing.authentication"].value,
    }),
    security_acceptance_baselines_sha256:
      digest(next.answers["security.acceptance_baselines"].value),
    audit_report_sha256: audit.report_sha256,
    setup_audit_sha256: next.setup_audit.audit_sha256,
    sealed_at: sealedAt,
  };
  next.sealed_snapshot = {...snapshot, snapshot_sha256: digest(snapshot)};
  const projectName = next.answers["project.name"].value;
  const launchQuestion = `${projectName}'s ${next.governance_version} environment is ready for launch. Proceed?`;
  const launch = {
    status: "READY_TO_ASK",
    question: launchQuestion,
    owner_decision: null,
    decision_at: null,
    auditor_activation: null,
    auditor_started: null,
    bootstrap_exit: null,
  };
  next.launch = {...launch, launch_sha256: digest(launch)};
  next.revision += 1;
  next.updated_at = sealedAt;
  validateGuidedBootstrapState(next);
  return next;
}

function validateLaunch(launch, state) {
  if (launch === null) return;
  exactKeys(launch, [
    "status", "question", "owner_decision", "decision_at",
    "auditor_activation", "auditor_started", "bootstrap_exit", "launch_sha256",
  ], "launch state");
  const body = structuredClone(launch);
  delete body.launch_sha256;
  if (digest(body) !== launch.launch_sha256) throw new Error("launch state digest mismatch");
  const expectedQuestion = `${state.answers["project.name"]?.value}'s 2.1rc environment is ready for launch. Proceed?`;
  if (launch.question !== expectedQuestion) throw new Error("launch question is not deterministic");
  if (![
    "READY_TO_ASK", "CONFIRMED", "AUDITOR_ACTIVATED", "AUDITOR_WORKING",
    "BOOTSTRAP_EXITED",
  ].includes(launch.status)) throw new Error("launch status invalid");
  if (launch.status === "READY_TO_ASK") {
    if (launch.owner_decision !== null || launch.decision_at !== null
        || launch.auditor_activation !== null || launch.auditor_started !== null
        || launch.bootstrap_exit !== null) throw new Error("premature launch evidence");
    return;
  }
  if (launch.owner_decision !== "PROCEED") throw new Error("launch lacks owner confirmation");
  requireUtc(launch.decision_at, "launch decision time");
  if (launch.status === "CONFIRMED") {
    if (launch.auditor_activation !== null || launch.auditor_started !== null
        || launch.bootstrap_exit !== null) {
      throw new Error("confirmed launch carries premature later evidence");
    }
    return;
  }
  requireRecord(launch.auditor_activation, "first Auditor activation");
  exactKeys(launch.auditor_activation, [
    "schema", "role", "session_id", "display_name", "governance_version", "project_name",
    "model_rule_id", "model", "reasoning", "pinned", "fresh", "instruction",
    "configuration_snapshot_sha256", "activated_at", "activation_sha256",
  ], "first Auditor activation");
  requireString(launch.auditor_activation.session_id, "first Auditor activation session");
  if (launch.auditor_activation.session_id === state.bootstrap_session_id
      || launch.auditor_activation.session_id === state.setup_audit.auditor_session_id
      || launch.auditor_activation.role !== "INDEPENDENT_AUDITOR"
      || launch.auditor_activation.pinned !== true
      || launch.auditor_activation.fresh !== true
      || launch.auditor_activation.governance_version !== "2.1rc"
      || launch.auditor_activation.configuration_snapshot_sha256
        !== state.sealed_snapshot.snapshot_sha256) {
    throw new Error("first Auditor activation identity mismatch");
  }
  requireUtc(launch.auditor_activation.activated_at, "first Auditor activation time");
  if (new Date(launch.auditor_activation.activated_at).getTime()
      < new Date(launch.decision_at).getTime()) {
    throw new Error("first Auditor activation predates launch confirmation");
  }
  const activationBody = structuredClone(launch.auditor_activation);
  delete activationBody.activation_sha256;
  if (digest(activationBody) !== launch.auditor_activation.activation_sha256) {
    throw new Error("first Auditor activation digest mismatch");
  }
  if (launch.status === "AUDITOR_ACTIVATED") {
    if (launch.auditor_started !== null || launch.bootstrap_exit !== null) {
      throw new Error("Auditor activation carries premature later evidence");
    }
    return;
  }
  exactKeys(launch.auditor_started, [
    "session_id", "pinned", "working_state", "progress_evidence_sha256", "observed_at",
  ], "first Auditor start");
  requireString(launch.auditor_started.session_id, "first Auditor session");
  if (launch.auditor_started.session_id !== launch.auditor_activation.session_id) {
    throw new Error("first Auditor working proof is from a different session");
  }
  requireSha(launch.auditor_started.progress_evidence_sha256, "first Auditor progress");
  requireUtc(launch.auditor_started.observed_at, "first Auditor observation");
  if (launch.auditor_started.pinned !== true
      || launch.auditor_started.working_state !== "ACTIVE_CAMPAIGN_DESIGN") {
    throw new Error("first Auditor is not pinned and working");
  }
  if (new Date(launch.auditor_started.observed_at).getTime()
      < new Date(launch.auditor_activation.activated_at).getTime()) {
    throw new Error("first Auditor working proof predates activation");
  }
  if (launch.status === "AUDITOR_WORKING") {
    if (launch.bootstrap_exit !== null) {
      throw new Error("Auditor working state carries premature Bootstrap exit");
    }
    return;
  }
  exactKeys(launch.bootstrap_exit, [
    "message", "unpin_bootstrap", "completed_at",
  ], "Bootstrap exit");
  if (launch.bootstrap_exit.message
      !== "Thank you for your time working with me. The first Auditor is pinned and building the initial campaign."
      || launch.bootstrap_exit.unpin_bootstrap !== true) {
    throw new Error("Bootstrap exit is incomplete");
  }
  requireUtc(launch.bootstrap_exit.completed_at, "Bootstrap exit time");
  if (new Date(launch.bootstrap_exit.completed_at).getTime()
      < new Date(launch.auditor_started.observed_at).getTime()) {
    throw new Error("Bootstrap exit predates first Auditor progress");
  }
}

function withLaunch(state, launch, at) {
  const next = structuredClone(state);
  next.launch = {...launch, launch_sha256: digest(launch)};
  next.revision += 1;
  next.updated_at = at;
  validateGuidedBootstrapState(next);
  return next;
}

export function confirmGuidedBootstrapLaunch(state, decision, actor, at) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(at, state.updated_at, "launch decision time");
  requireString(actor, "launch decision actor");
  if (state.launch?.status !== "READY_TO_ASK" || decision !== "PROCEED") {
    throw new Error("launch confirmation must answer the exact ready question with PROCEED");
  }
  const launch = structuredClone(state.launch);
  delete launch.launch_sha256;
  launch.status = "CONFIRMED";
  launch.owner_decision = "PROCEED";
  launch.decision_at = at;
  return withLaunch(state, launch, at);
}

export function compileFirstAuditActivation(state, auditorSessionId, at) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(at, state.updated_at, "Auditor activation time");
  if (state.launch?.status !== "CONFIRMED") throw new Error("launch is not confirmed");
  requireString(auditorSessionId, "first Auditor session");
  if (auditorSessionId === state.bootstrap_session_id
      || auditorSessionId === state.setup_audit.auditor_session_id) {
    throw new Error("first Auditor must be fresh and distinct");
  }
  const resolution = resolveModelRule(state.answers["models.rules"].value, {
    role: "auditor",
    campaign_type: "INITIAL_CAMPAIGN_DISCOVERY",
  });
  const body = {
    schema: "governance.first_campaign_auditor_activation.v1",
    role: "INDEPENDENT_AUDITOR",
    session_id: auditorSessionId,
    display_name: `Auditor 1 ${state.governance_version}`,
    governance_version: state.governance_version,
    project_name: state.answers["project.name"].value,
    model_rule_id: resolution.rule_id,
    model: resolution.model,
    reasoning: resolution.reasoning,
    pinned: true,
    fresh: true,
    instruction: "Audit the admitted project authority and current source read-only; build one deterministic dependency-ordered initial campaign; then create and pin the fresh campaign Orchestrator from the configured model rules. Do not take Product custody.",
    configuration_snapshot_sha256: state.sealed_snapshot.snapshot_sha256,
    activated_at: at,
  };
  return {...body, activation_sha256: digest(body)};
}

export function recordFirstAuditActivation(state, activation, at) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(at, state.updated_at, "Auditor activation record time");
  if (state.launch?.status !== "CONFIRMED") throw new Error("launch is not awaiting Auditor activation");
  const expected = compileFirstAuditActivation(state, activation.session_id, at);
  if (JSON.stringify(canonicalize(activation)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error("Auditor activation differs from resolved authority");
  }
  const launch = structuredClone(state.launch);
  delete launch.launch_sha256;
  launch.status = "AUDITOR_ACTIVATED";
  launch.auditor_activation = structuredClone(activation);
  return withLaunch(state, launch, at);
}

export function recordFirstAuditWorking(state, observation) {
  validateGuidedBootstrapState(state);
  if (state.launch?.status !== "AUDITOR_ACTIVATED") {
    throw new Error("first Auditor activation is not pending start proof");
  }
  requireTimeNotBefore(observation.observed_at, state.updated_at, "Auditor observation time");
  const launch = structuredClone(state.launch);
  delete launch.launch_sha256;
  launch.status = "AUDITOR_WORKING";
  launch.auditor_started = structuredClone(observation);
  return withLaunch(state, launch, observation.observed_at);
}

export function completeGuidedBootstrapExit(state, at) {
  validateGuidedBootstrapState(state);
  requireTimeNotBefore(at, state.updated_at, "Bootstrap exit time");
  if (state.launch?.status !== "AUDITOR_WORKING") {
    throw new Error("Bootstrap cannot exit before the first Auditor is working");
  }
  const launch = structuredClone(state.launch);
  delete launch.launch_sha256;
  launch.status = "BOOTSTRAP_EXITED";
  launch.bootstrap_exit = {
    message: "Thank you for your time working with me. The first Auditor is pinned and building the initial campaign.",
    unpin_bootstrap: true,
    completed_at: at,
  };
  return withLaunch(state, launch, at);
}

export function validateGuidedBootstrapState(state) {
  exactKeys(state, [
    "schema", "governance_version", "bootstrap_session_id", "created_at",
    "revision", "updated_at", "discovery",
    "discovery_digest_sha256", "discovery_receipt_sha256",
    "interaction_mode", "answers", "answer_order",
    "exchange_chain_head_sha256", "imported_exchange_ids",
    "imported_exchange_receipts", "deferred_context", "phase_outputs",
    "setup_audit", "sealed_snapshot", "launch",
  ], "guided Bootstrap state");
  if (state.schema !== "governance.guided_bootstrap_state.v1"
      || state.governance_version !== "2.1rc") {
    throw new Error("guided Bootstrap identity mismatch");
  }
  requireString(state.bootstrap_session_id, "Bootstrap session ID");
  requireUtc(state.created_at, "guided Bootstrap creation time");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error("guided Bootstrap revision invalid");
  }
  requireUtc(state.updated_at, "state time");
  if (!Array.isArray(state.discovery)) throw new Error("state discovery invalid");
  state.discovery.forEach(validateDiscoveredFact);
  projectRootFromDiscovery(state.discovery);
  if (digest(state.discovery) !== state.discovery_digest_sha256) {
    throw new Error("state discovery digest mismatch");
  }
  requireSha(state.discovery_receipt_sha256, "state discovery receipt");
  if (state.interaction_mode !== null && !MODES.has(state.interaction_mode)) {
    throw new Error("state interaction mode invalid");
  }
  requireRecord(state.answers, "state answers");
  if (!Array.isArray(state.answer_order)
      || state.answer_order.length !== Object.keys(state.answers).length
      || new Set(state.answer_order).size !== state.answer_order.length) {
    throw new Error("answer order invalid");
  }
  for (const [index, questionId] of state.answer_order.entries()) {
    if (QUESTIONS[index]?.id !== questionId) throw new Error("answers are out of order");
    validateAnswer(state.answers[questionId]);
  }
  const modeAnswer = state.answers["setup.interaction_mode"];
  if ((modeAnswer?.value ?? null) !== state.interaction_mode) {
    throw new Error("interaction mode contradicts its answer");
  }
  if (state.answers["intent.features"] && state.answers["intent.gates"]) {
    validateIntentGraph(
      state.answers["intent.features"].value,
      state.answers["intent.gates"].value,
    );
  }
  if (state.answers["repositories.topology"] && state.answers["providers.capability_map"]) {
    const topology = state.answers["repositories.topology"].value;
    const providers = state.answers["providers.capability_map"].value;
    if (topology !== "LOCAL_ONLY"
        && !providers.some((binding) => binding.capability === "source_control")) {
      throw new Error("version-controlled topology lacks a source-control provider");
    }
  }
  if (state.answers["deployment.policy"] && state.answers["providers.capability_map"]) {
    const deployment = state.answers["deployment.policy"].value;
    const providers = state.answers["providers.capability_map"].value;
    if (deployment.deployment_enabled
        && !providers.some((binding) =>
          ["hosting", "deployment", "runtime"].includes(binding.capability))) {
      throw new Error("enabled deployment lacks a deployment-capable provider");
    }
  }
  if (!SHA256.test(state.exchange_chain_head_sha256)) {
    throw new Error("exchange chain head invalid");
  }
  if (!Array.isArray(state.imported_exchange_ids)
      || new Set(state.imported_exchange_ids).size !== state.imported_exchange_ids.length) {
    throw new Error("imported exchange IDs invalid");
  }
  if (!Array.isArray(state.imported_exchange_receipts)
      || state.imported_exchange_receipts.length !== state.imported_exchange_ids.length) {
    throw new Error("imported exchange receipts invalid");
  }
  let priorExchangeSha = "0".repeat(64);
  let priorExchangeRevision = -1;
  for (const [index, receipt] of state.imported_exchange_receipts.entries()) {
    exactKeys(receipt, [
      "package_id", "package_sha256", "response_sha256",
      "prior_exchange_sha256", "state_revision", "completed_at",
      "answer_ids", "receipt_sha256",
    ], "imported exchange receipt");
    requireString(receipt.package_id, "imported exchange package ID");
    requireSha(receipt.package_sha256, "imported exchange package");
    requireSha(receipt.response_sha256, "imported exchange response");
    requireSha(receipt.prior_exchange_sha256, "imported exchange prior");
    requireUtc(receipt.completed_at, "imported exchange completion");
    if (!Number.isSafeInteger(receipt.state_revision)
        || receipt.state_revision <= priorExchangeRevision
        || receipt.package_id !== state.imported_exchange_ids[index]
        || receipt.prior_exchange_sha256 !== priorExchangeSha
        || !Array.isArray(receipt.answer_ids)
        || receipt.answer_ids.length === 0
        || new Set(receipt.answer_ids).size !== receipt.answer_ids.length) {
      throw new Error("imported exchange receipt sequence is invalid");
    }
    const body = structuredClone(receipt);
    delete body.receipt_sha256;
    if (digest(body) !== receipt.receipt_sha256) {
      throw new Error("imported exchange receipt digest mismatch");
    }
    priorExchangeSha = receipt.response_sha256;
    priorExchangeRevision = receipt.state_revision;
  }
  if (priorExchangeSha !== state.exchange_chain_head_sha256) {
    throw new Error("imported exchange receipts do not reach the chain head");
  }
  if (!Array.isArray(state.deferred_context)) throw new Error("deferred context is invalid");
  for (const deferred of state.deferred_context) {
    exactKeys(deferred, [
      "phase", "items", "response_sha256", "deferred_sha256",
    ], "deferred context");
    if (!PHASES.includes(deferred.phase)
        || !Array.isArray(deferred.items)
        || deferred.items.length === 0
        || deferred.items.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error("deferred context content is invalid");
    }
    requireSha(deferred.response_sha256, "deferred context response");
    if (!state.imported_exchange_receipts.some((receipt) =>
      receipt.response_sha256 === deferred.response_sha256)) {
      throw new Error("deferred context lacks an imported response");
    }
    const body = structuredClone(deferred);
    delete body.deferred_sha256;
    if (digest(body) !== deferred.deferred_sha256) {
      throw new Error("deferred context digest mismatch");
    }
  }
  requireRecord(state.phase_outputs, "phase outputs");
  for (const [phase, output] of Object.entries(state.phase_outputs)) {
    if (phase !== output.phase) throw new Error("phase output key mismatch");
    const isolated = structuredClone(state);
    isolated.phase_outputs = {};
    // Validate the immutable record without mutating state or rechecking completion.
    exactKeys(output, [
      "phase", "operation", "source_identity", "artifact_root", "identity_kind",
      "repository",
      "commit", "tree", "index_sha256", "context_sha256", "mapping_sha256",
      "artifact_files", "local_content_sha256", "verification_sha256",
      "status", "writer_session_id", "unavailable_reason",
      "recorded_at", "output_sha256",
    ], "stored phase output");
    if (!PHASES.includes(phase) || !PHASE_OPERATIONS.get(phase).has(output.operation)
        || output.writer_session_id !== state.bootstrap_session_id
        || output.status !== "VERIFIED") throw new Error("stored phase output is invalid");
    validatePhaseChoiceConsistency(state, output);
    requireString(output.source_identity, "stored phase source identity");
    requireSafeRelativePath(output.artifact_root, "stored phase artifact root");
    for (const key of [
      "index_sha256", "context_sha256", "mapping_sha256", "verification_sha256",
    ]) requireSha(output[key], `stored phase ${key}`);
    validatePhaseOutputReality(state, output);
    requireUtc(output.recorded_at, "stored phase time");
    const outputBody = structuredClone(output);
    delete outputBody.output_sha256;
    if (digest(outputBody) !== output.output_sha256) {
      throw new Error("stored phase output digest mismatch");
    }
    if (output.operation === "DEFER_EXPLICITLY") {
      requireString(output.unavailable_reason, "stored deferred reason");
    } else if (output.unavailable_reason !== null) {
      throw new Error("stored non-deferred phase carries unavailable reason");
    }
  }
  if (state.setup_audit !== null && state.sealed_snapshot === null) {
    throw new Error("setup audit exists without sealed snapshot");
  }
  if (state.sealed_snapshot !== null) {
    exactKeys(state.setup_audit, [
      "auditor_session_id", "report_sha256", "disposition", "audited_at",
      "audit_sha256",
    ], "stored setup audit");
    requireString(state.setup_audit.auditor_session_id, "stored Auditor session");
    if (state.setup_audit.auditor_session_id === state.bootstrap_session_id
        || state.setup_audit.disposition !== "ACCEPTED") {
      throw new Error("stored setup audit is not independent and accepted");
    }
    requireSha(state.setup_audit.report_sha256, "stored setup audit report");
    requireUtc(state.setup_audit.audited_at, "stored setup audit time");
    const auditBody = structuredClone(state.setup_audit);
    delete auditBody.audit_sha256;
    if (digest(auditBody) !== state.setup_audit.audit_sha256) {
      throw new Error("stored setup audit digest mismatch");
    }
    exactKeys(state.sealed_snapshot, [
      "schema", "governance_version", "interaction_mode", "bootstrap_session_id",
      "auditor_session_id", "discovery_digest_sha256", "discovery_receipt_sha256",
      "answers_sha256", "imported_exchange_receipts_sha256",
      "deferred_context_sha256", "phase_outputs_sha256", "model_rules_sha256",
      "evidence_active_window_days",
      "progress_interval_minutes", "agent_lifecycle_sha256", "campaign_topology_sha256",
      "gpt_assist_mode", "article_numbering", "testing_policy_sha256",
      "security_acceptance_baselines_sha256", "audit_report_sha256",
      "setup_audit_sha256", "sealed_at", "snapshot_sha256",
    ], "sealed snapshot");
    const body = structuredClone(state.sealed_snapshot);
    delete body.snapshot_sha256;
    if (digest(body) !== state.sealed_snapshot.snapshot_sha256) {
      throw new Error("sealed snapshot digest mismatch");
    }
    if (state.sealed_snapshot.bootstrap_session_id !== state.bootstrap_session_id
        || state.sealed_snapshot.auditor_session_id !== state.setup_audit.auditor_session_id
        || state.sealed_snapshot.discovery_receipt_sha256
          !== state.discovery_receipt_sha256
        || state.sealed_snapshot.audit_report_sha256 !== state.setup_audit.report_sha256
        || state.sealed_snapshot.setup_audit_sha256 !== state.setup_audit.audit_sha256
        || state.sealed_snapshot.answers_sha256 !== digest(state.answers)
        || state.sealed_snapshot.imported_exchange_receipts_sha256
          !== digest(state.imported_exchange_receipts)
        || state.sealed_snapshot.deferred_context_sha256
          !== digest(state.deferred_context)
        || state.sealed_snapshot.phase_outputs_sha256 !== digest(state.phase_outputs)
        || state.sealed_snapshot.agent_lifecycle_sha256
          !== digest(state.answers["workflow.agent_lifecycle"].value)
        || state.sealed_snapshot.campaign_topology_sha256
          !== digest(state.answers["workflow.campaign_topology"].value)
        || state.sealed_snapshot.gpt_assist_mode
          !== state.answers["workflow.gpt_assist_mode"].value
        || state.sealed_snapshot.security_acceptance_baselines_sha256
          !== digest(state.answers["security.acceptance_baselines"].value)
        || state.sealed_snapshot.article_numbering.allocation_sha256
          !== compilePortableArticleNumbering(
            state.answers["authority_corpus.structure"].value,
            state.answers["intent.features"].value,
          ).allocation_sha256) {
      throw new Error("sealed snapshot does not bind current setup authority");
    }
  }
  if ((state.sealed_snapshot === null) !== (state.launch === null)) {
    throw new Error("launch state and sealed setup must appear together");
  }
  validateLaunch(state.launch, state);
  const launchTransitions = state.launch === null ? 0 : {
    READY_TO_ASK: 0,
    CONFIRMED: 1,
    AUDITOR_ACTIVATED: 2,
    AUDITOR_WORKING: 3,
    BOOTSTRAP_EXITED: 4,
  }[state.launch.status];
  const expectedRevision = state.answer_order.length
    + state.imported_exchange_ids.length
    + Object.keys(state.phase_outputs).length
    + (state.sealed_snapshot === null ? 0 : 1)
    + launchTransitions;
  if (state.revision !== expectedRevision) {
    throw new Error("guided Bootstrap revision does not match its append-only transitions");
  }
  const eventTimes = [
    state.created_at,
    ...Object.values(state.answers).map((answer) => answer.answered_at),
    ...state.imported_exchange_receipts.map((receipt) => receipt.completed_at),
    ...Object.values(state.phase_outputs).map((output) => output.recorded_at),
  ];
  if (state.setup_audit) eventTimes.push(state.setup_audit.audited_at);
  if (state.sealed_snapshot) eventTimes.push(state.sealed_snapshot.sealed_at);
  if (state.launch?.decision_at) eventTimes.push(state.launch.decision_at);
  if (state.launch?.auditor_activation?.activated_at) {
    eventTimes.push(state.launch.auditor_activation.activated_at);
  }
  if (state.launch?.auditor_started?.observed_at) {
    eventTimes.push(state.launch.auditor_started.observed_at);
  }
  if (state.launch?.bootstrap_exit?.completed_at) {
    eventTimes.push(state.launch.bootstrap_exit.completed_at);
  }
  const expectedUpdatedAt = eventTimes.sort((left, right) =>
    new Date(left).getTime() - new Date(right).getTime()).at(-1);
  if (state.updated_at !== expectedUpdatedAt) {
    throw new Error("guided Bootstrap updated_at does not match its latest event");
  }
  return state;
}

function main() {
  const [command, statePath, payloadPath] = process.argv.slice(2);
  if (!command || !statePath) {
    throw new Error("usage: guided-bootstrap <validate|next|exchange> <state.json> [payload]");
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (command === "validate") {
    validateGuidedBootstrapState(state);
    process.stdout.write(`${JSON.stringify({status: "PASS"})}\n`);
  } else if (command === "next") {
    process.stdout.write(`${JSON.stringify(nextGuidedQuestion(state))}\n`);
  } else if (command === "exchange") {
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    process.stdout.write(`${JSON.stringify(compileChatGptExchange(
      state, payload.phase, payload.package_id, payload.created_at,
    ))}\n`);
  } else {
    throw new Error("unknown guided-bootstrap command");
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
