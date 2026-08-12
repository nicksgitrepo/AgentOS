#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";

export const DISCOVERY_MODES = new Set([
  "RECOMMENDED", "GUIDED", "EXPERT", "LOCAL_ONLY",
]);

const SAFE_ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

const TOOL_NAMES = [
  ["VERSION_CONTROL", "git"],
  ["JAVASCRIPT_RUNTIME", "node"],
  ["PYTHON_RUNTIME", "python3"],
  ["PACKAGE_MANAGER", "npm"],
  ["CONTAINER_RUNTIME", "docker"],
  ["INFRASTRUCTURE_TOOL", "terraform"],
];

const PROJECT_MARKERS = [
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "composer.json", "requirements.txt", "Dockerfile", "pnpm-lock.yaml",
  "package-lock.json", "yarn.lock", "bun.lockb", "Makefile",
];

const AUTHORITY_CANDIDATES = [
  "authority", "authority-corpus", "docs/authority", "authority_corpus",
];

const DESIGN_CANDIDATES = [
  "Design Bible", "design-bible", "docs/design", "design-system",
];

const DEPLOYMENT_MARKERS = [
  "deployment", "deploy", "infra", "Dockerfile", "docker-compose.yml", "compose.yml",
];

const DELIVERY_MARKERS = [
  ["ci", ".github/workflows"],
  ["ci", ".gitlab-ci.yml"],
  ["ci", ".circleci"],
  ["ci", "Jenkinsfile"],
  ["ci", "buildkite.yml"],
  ["ci", "azure-pipelines.yml"],
  ["hosting", "wrangler.toml"],
  ["hosting", "vercel.json"],
  ["hosting", "netlify.toml"],
  ["hosting", "fly.toml"],
  ["hosting", "serverless.yml"],
  ["policy", ".agentos/delivery-policy.json"],
];

// Nested-repository discovery is deliberately shallow, bounded, and metadata-only.
// Bootstrap must recognize a parent project containing several repositories without
// walking Git object stores or following unsafe filesystem links.
const NESTED_REPOSITORY_SCAN_LIMITS = Object.freeze({
  max_depth: 8,
  max_directories: 2048,
  max_entries: 20000,
});
const TOPOLOGY_SCAN_IGNORED_DIRECTORIES = new Set([
  "node_modules", ".pnpm-store", ".yarn", ".next", ".turbo", "dist", "build",
  "coverage", ".cache", ".venv", "target", ".gradle",
]);

export const EPISTEMIC_CLASSES = Object.freeze([
  "OBSERVED",
  "OWNER_CONFIRMED",
  "ACCEPTED_AUTHORITY",
  "INFERRED_CANDIDATE",
  "CONFLICT",
  "UNKNOWN",
  "DEFERRED_NONBLOCKING",
]);

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function canonicalRoot(projectRoot) {
  requireString(projectRoot, "project root");
  if (!path.isAbsolute(projectRoot)) throw new Error("project root must be an absolute path");
  const absolute = path.resolve(projectRoot);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error("project root must not be a symbolic link");
  if (!stat.isDirectory()) throw new Error("project root must be a directory");
  return fs.realpathSync(absolute);
}

function safeRelative(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const prefix = `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error("discovery path escapes project root");
  }
  return absolute;
}

function inspectPath(root, relativePath) {
  const absolute = safeRelative(root, relativePath);
  if (!fs.existsSync(absolute)) return {exists: false, type: "MISSING"};
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return {exists: true, type: "SYMBOLIC_LINK"};
  if (stat.isDirectory()) return {exists: true, type: "DIRECTORY"};
  if (stat.isFile()) return {exists: true, type: "FILE"};
  return {exists: true, type: "UNSAFE_OBJECT"};
}

function runLocal(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: SAFE_ENVIRONMENT,
    windowsHide: true,
  });
  return {
    installed: result.error?.code !== "ENOENT",
    exit_code: Number.isInteger(result.status) ? result.status : null,
    stdout: (result.stdout ?? "").trim().slice(0, 2_000),
    stderr: (result.stderr ?? "").trim().slice(0, 2_000),
  };
}

export function readSourceControlBinding(projectRoot) {
  const root = canonicalRoot(projectRoot);
  const topLevel = runLocal("git", ["rev-parse", "--show-toplevel"], root);
  const commit = runLocal("git", ["rev-parse", "HEAD"], root);
  const tree = runLocal("git", ["rev-parse", "HEAD^{tree}"], root);
  const fail = (message) => {
    const error = new Error(message);
    error.code = "SOURCE_CONTROL_READBACK_REQUIRED";
    throw error;
  };
  if (!topLevel.installed || topLevel.exit_code !== 0 || !topLevel.stdout) fail("source control root readback is unavailable");
  if (canonicalRoot(topLevel.stdout) !== root) fail("source control root readback differs from the imported root");
  if (commit.exit_code !== 0 || !/^[0-9a-f]{40}$/u.test(commit.stdout)) fail("source control commit readback is unavailable");
  if (tree.exit_code !== 0 || !/^[0-9a-f]{40}$/u.test(tree.stdout)) fail("source control tree readback is unavailable");
  return Object.freeze({source_commit: commit.stdout, source_tree: tree.stdout});
}

function findExecutable(command) {
  for (const entry of (SAFE_ENVIRONMENT.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, command);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return true;
    } catch {
      // An unavailable or inaccessible tool is an observed absence, not a blocker.
    }
  }
  return false;
}

function normalizeRemote(raw) {
  requireString(raw, "remote URL");
  if (raw.includes("://")) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return {status: "CONFLICT", reason: "REMOTE_URL_UNPARSEABLE"};
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return {status: "CONFLICT", reason: "REMOTE_SECRET_OR_QUERY_MATERIAL_REJECTED"};
    }
    return {
      status: "OBSERVED_FACT",
      value: `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/u, ""),
    };
  }
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/u.test(raw)) {
    const separator = raw.indexOf(":");
    return {
      status: "OBSERVED_FACT",
      value: `ssh://${raw.slice(4, separator)}/${raw.slice(separator + 1)}`,
    };
  }
  if (/[\r\n\0@?#]/u.test(raw)) {
    return {status: "CONFLICT", reason: "REMOTE_UNSAFE_MATERIAL_REJECTED"};
  }
  return {status: "OBSERVED_FACT", value: raw};
}

function addFact(facts, status, factId, value, sourceKind, sourceLocator, epistemicClass = null, reason = null) {
  const classification = epistemicClass ?? (status === "CONFLICT" ? "CONFLICT" : status === "UNKNOWN" ? "UNKNOWN" : "OBSERVED");
  if (!EPISTEMIC_CLASSES.includes(classification)) throw new Error("discovery epistemic class is invalid");
  const fact = {
    fact_id: factId,
    status,
    source_kind: sourceKind,
    source_locator: sourceLocator,
    epistemic_class: classification,
    secret_free: true,
  };
  if (value !== undefined) fact.value = value;
  if (reason !== null) fact.reason = reason;
  facts.push(fact);
}

function addPathFact(facts, root, factId, relativePath, sourceKind = "FILESYSTEM") {
  const inspected = inspectPath(root, relativePath);
  if (inspected.type === "SYMBOLIC_LINK" || inspected.type === "UNSAFE_OBJECT") {
    addFact(facts, "CONFLICT", factId, inspected.type, sourceKind, relativePath, "CONFLICT",
      "UNSAFE_FILESYSTEM_OBJECT");
  } else if (inspected.exists) {
    addFact(facts, "OBSERVED_FACT", factId, inspected.type, sourceKind, relativePath);
  } else {
    addFact(facts, "UNKNOWN", factId, undefined, sourceKind, relativePath, "UNKNOWN",
      "NOT_PRESENT");
  }
}

function factPathToken(relativePath) {
  const bytes = Buffer.from(relativePath, "utf8").toString("hex");
  return bytes.length > 0 ? bytes : "00";
}

function discoverNestedRepositories(root) {
  const queue = [{absolute: root, relative: "", depth: 0}];
  const repositories = [];
  const issues = [];
  let scannedDirectories = 0;
  let scannedEntries = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    scannedDirectories += 1;
    if (scannedDirectories > NESTED_REPOSITORY_SCAN_LIMITS.max_directories) {
      issues.push({relative: current.relative || ".", reason: "DIRECTORY_SCAN_LIMIT_REACHED"});
      break;
    }

    let entries;
    try {
      entries = fs.readdirSync(current.absolute, {withFileTypes: true})
        .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    } catch {
      issues.push({relative: current.relative || ".", reason: "DIRECTORY_READ_FAILED"});
      continue;
    }

    for (const entry of entries) {
      scannedEntries += 1;
      const childRelative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (scannedEntries > NESTED_REPOSITORY_SCAN_LIMITS.max_entries) {
        issues.push({relative: childRelative, reason: "ENTRY_SCAN_LIMIT_REACHED"});
        queue.length = 0;
        break;
      }

      // The parent repository's own .git is handled by the Git readback above.
      // Never traverse any Git metadata directory.
      if (entry.name === ".git") {
        if (current.relative.length === 0) continue;
        const gitType = entry.isDirectory()
          ? "DIRECTORY"
          : entry.isFile()
            ? "FILE"
            : entry.isSymbolicLink()
              ? "SYMBOLIC_LINK"
              : "UNSAFE_OBJECT";
        repositories.push({
          relative_root: current.relative,
          git_relative_path: childRelative,
          git_type: gitType,
          status: ["DIRECTORY", "FILE"].includes(gitType) ? "OBSERVED_FACT" : "CONFLICT",
          reason: ["DIRECTORY", "FILE"].includes(gitType) ? null : "UNSAFE_GIT_OBJECT",
        });
        continue;
      }

      // Dependency and generated trees are not project repository boundaries.
      // Skipping them prevents package-manager symlinks and build output from
      // becoming false topology conflicts while preserving real source roots.
      if (TOPOLOGY_SCAN_IGNORED_DIRECTORIES.has(entry.name)) continue;

      if (entry.isSymbolicLink()) {
        issues.push({relative: childRelative, reason: "SYMLINK_NOT_FOLLOWED"});
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (current.depth >= NESTED_REPOSITORY_SCAN_LIMITS.max_depth) {
        issues.push({relative: childRelative, reason: "DIRECTORY_DEPTH_LIMIT_REACHED"});
        continue;
      }
      queue.push({absolute: path.join(current.absolute, entry.name), relative: childRelative, depth: current.depth + 1});
    }
  }

  return {repositories, issues, scanned_directories: scannedDirectories, scanned_entries: scannedEntries};
}

export function discoverProject(projectRoot, mode = "RECOMMENDED") {
  requireString(mode, "discovery mode");
  if (!DISCOVERY_MODES.has(mode)) throw new Error("discovery mode is invalid");
  const root = canonicalRoot(projectRoot);
  const facts = [];
  const git = runLocal("git", ["rev-parse", "--show-toplevel"], root);
  const nested = discoverNestedRepositories(root);
  for (const repository of nested.repositories) {
    addFact(
      facts,
      repository.status,
      `repositories.nested.${factPathToken(repository.relative_root)}`,
      repository.git_type,
      "FILESYSTEM",
      repository.git_relative_path,
      repository.status === "CONFLICT" ? "CONFLICT" : "OBSERVED",
      repository.reason,
    );
  }
  if (nested.repositories.length > 0) {
    addFact(facts, "OBSERVED_FACT", "repositories.nested.count", nested.repositories.length, "FILESYSTEM", root);
  }
  for (const issue of nested.issues) {
    addFact(
      facts,
      "CONFLICT",
      `repositories.nested.issue.${factPathToken(issue.relative)}`,
      issue.reason,
      "FILESYSTEM",
      issue.relative,
      "CONFLICT",
      issue.reason,
    );
  }

  const nestedRepositoryConflict = nested.repositories.some((repository) => repository.status === "CONFLICT");
  const nestedTopologyComplete = nested.issues.length === 0 && !nestedRepositoryConflict;
  if (nested.repositories.length > 0) {
    addFact(
      facts,
      nestedTopologyComplete ? "OBSERVED_FACT" : "CONFLICT",
      "repositories.topology",
      nestedTopologyComplete ? "MULTI_REPOSITORY_PROJECT_ROOT" : "MULTI_REPOSITORY_SCAN_INCOMPLETE",
      "FILESYSTEM",
      root,
      nestedTopologyComplete ? "OBSERVED" : "CONFLICT",
      nestedTopologyComplete ? null : "NESTED_REPOSITORY_SCAN_INCOMPLETE",
    );
  } else if (nested.issues.length > 0) {
    addFact(facts, "CONFLICT", "repositories.topology", undefined, "FILESYSTEM", root, "CONFLICT", "NESTED_REPOSITORY_SCAN_INCOMPLETE");
  } else if (git.exit_code === 0) {
    let gitTopLevel = null;
    try {
      gitTopLevel = fs.realpathSync(git.stdout);
    } catch {
      // The conflict below preserves the fact without retaining unsafe output.
    }
    if (gitTopLevel === root) {
      addFact(facts, "OBSERVED_FACT", "repositories.topology", "SINGLE_REPOSITORY", "GIT", root);
    } else {
      addFact(facts, "CONFLICT", "repositories.topology", "PARENT_OR_FOREIGN_REPOSITORY", "GIT", root,
        "CONFLICT", "GIT_TOP_LEVEL_DIFFERS_FROM_PROJECT_ROOT");
    }
  } else if (git.installed) {
    addFact(facts, "UNKNOWN", "repositories.topology", undefined, "GIT", root, "UNKNOWN", "NOT_A_GIT_REPOSITORY");
  } else {
    addFact(facts, "UNKNOWN", "repositories.topology", undefined, "GIT", root, "UNKNOWN", "GIT_NOT_INSTALLED");
  }

  if (git.exit_code === 0) {
    const remote = runLocal("git", ["config", "--get", "remote.origin.url"], root);
    if (remote.exit_code === 0 && remote.stdout.length > 0) {
      const normalized = normalizeRemote(remote.stdout);
      addFact(facts, normalized.status, "repositories.origin", normalized.value, "GIT", ".git/config", normalized.status === "CONFLICT" ? "CONFLICT" : "OBSERVED",
        normalized.reason ?? null);
    } else {
      addFact(facts, "UNKNOWN", "repositories.origin", undefined, "GIT", ".git/config", "UNKNOWN", "ORIGIN_NOT_CONFIGURED");
    }
    const branch = runLocal("git", ["branch", "--show-current"], root);
    if (branch.exit_code === 0 && branch.stdout.length > 0) {
      addFact(facts, "OBSERVED_FACT", "delivery.source_control.current_branch", branch.stdout, "GIT", ".git/HEAD");
    } else {
      addFact(facts, "UNKNOWN", "delivery.source_control.current_branch", undefined, "GIT", ".git/HEAD", "UNKNOWN", "DETACHED_OR_UNAVAILABLE");
    }
    const head = runLocal("git", ["rev-parse", "HEAD"], root);
    if (head.exit_code === 0 && /^[0-9a-f]{40}$/u.test(head.stdout)) {
      addFact(facts, "OBSERVED_FACT", "delivery.source_control.head", head.stdout, "GIT", ".git/HEAD");
    } else {
      addFact(facts, "UNKNOWN", "delivery.source_control.head", undefined, "GIT", ".git/HEAD", "UNKNOWN", "HEAD_UNAVAILABLE");
    }
    const status = runLocal("git", ["status", "--porcelain=v1"], root);
    if (status.exit_code === 0) {
      addFact(facts, "OBSERVED_FACT", "delivery.source_control.worktree_clean", status.stdout.length === 0, "GIT", root);
    } else {
      addFact(facts, "UNKNOWN", "delivery.source_control.worktree_clean", undefined, "GIT", root, "UNKNOWN", "STATUS_UNAVAILABLE");
    }
  }

  for (const relativePath of AUTHORITY_CANDIDATES) {
    addPathFact(facts, root, `authority-corpus.candidate.${relativePath}`, relativePath);
  }
  for (const relativePath of DESIGN_CANDIDATES) {
    addPathFact(facts, root, `design-authority.candidate.${relativePath}`, relativePath);
  }
  for (const relativePath of PROJECT_MARKERS) {
    const inspected = inspectPath(root, relativePath);
    if (inspected.exists) {
      addFact(facts, inspected.type === "FILE" ? "OBSERVED_FACT" : "CONFLICT",
        `project.marker.${relativePath}`, inspected.type, "FILESYSTEM", relativePath, inspected.type === "FILE" ? "OBSERVED" : "CONFLICT",
        inspected.type === "FILE" ? null : "UNSAFE_PROJECT_MARKER");
    }
  }
  for (const relativePath of DEPLOYMENT_MARKERS) {
    const inspected = inspectPath(root, relativePath);
    if (inspected.exists) {
      addFact(facts, inspected.type === "FILE" ? "OBSERVED_FACT" : "CONFLICT",
        `delivery.marker.${relativePath}`, inspected.type, "FILESYSTEM", relativePath, inspected.type === "FILE" ? "OBSERVED" : "CONFLICT",
        inspected.type === "FILE" ? null : "UNSAFE_DEPLOYMENT_MARKER");
    }
  }
  for (const [kind, relativePath] of DELIVERY_MARKERS) {
    addPathFact(facts, root, `delivery.marker.${kind}.${relativePath}`, relativePath);
  }

  for (const [toolId, command] of TOOL_NAMES) {
    addFact(facts, "OBSERVED_FACT", `tool.${toolId}.installed`, findExecutable(command), "LOCAL_TOOL_PATH", command);
  }

  facts.sort((left, right) => Buffer.compare(Buffer.from(left.fact_id), Buffer.from(right.fact_id)));
  return {
    schema: "agentos.bootstrap_discovery_result.v1",
    version: 1,
    status: "READ_ONLY_OBSERVATION",
    discovery_mode: mode,
    project_root: root,
    operations: {
      read_only: true,
      secrets_requested: false,
      authentication_attempted: false,
      spending_attempted: false,
      publication_attempted: false,
      deployment_attempted: false,
      deletion_attempted: false,
    },
    facts,
    rejected_operations: [
      "SECRETS",
      "AUTHENTICATION",
      "SPENDING",
      "PUBLICATION",
      "DEPLOYMENT",
      "DELETION",
    ],
  };
}

function main() {
  const [command, projectRoot, mode = "RECOMMENDED"] = process.argv.slice(2);
  if (command !== "discover" || !projectRoot) {
    throw new Error("usage: bootstrap-discovery discover <project-root> [RECOMMENDED|GUIDED|EXPERT|LOCAL_ONLY]");
  }
  process.stdout.write(`${JSON.stringify(discoverProject(projectRoot, mode))}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
