#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";

export const DISCOVERY_MODES = new Set([
  "RECOMMENDED", "GUIDED", "EXPERT", "LOCAL_ONLY", "MANUAL",
]);

const SAFE_ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

const TOOL_NAMES = [
  ["GIT", "git"],
  ["GITHUB", "gh"],
  ["GITLAB", "glab"],
  ["AWS", "aws"],
  ["CLOUDFLARE", "wrangler"],
  ["VERCEL", "vercel"],
  ["NETLIFY", "netlify"],
  ["FLY_IO", "flyctl"],
  ["GOOGLE_CLOUD", "gcloud"],
  ["AZURE", "az"],
  ["DIGITALOCEAN", "doctl"],
  ["KUBERNETES", "kubectl"],
  ["DOCKER", "docker"],
  ["TERRAFORM", "terraform"],
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
  ".openai/hosting.json", "wrangler.toml", "vercel.json", "Dockerfile",
  "docker-compose.yml", "compose.yml", "fly.toml", "netlify.toml",
];

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function canonicalRoot(projectRoot) {
  requireString(projectRoot, "project root");
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

function addFact(facts, status, factId, value, sourceKind, sourceLocator, confidence = "HIGH", reason = null) {
  const fact = {
    fact_id: factId,
    status,
    source_kind: sourceKind,
    source_locator: sourceLocator,
    confidence,
    secret_free: true,
  };
  if (value !== undefined) fact.value = value;
  if (reason !== null) fact.reason = reason;
  facts.push(fact);
}

function addPathFact(facts, root, factId, relativePath, sourceKind = "FILESYSTEM") {
  const inspected = inspectPath(root, relativePath);
  if (inspected.type === "SYMBOLIC_LINK" || inspected.type === "UNSAFE_OBJECT") {
    addFact(facts, "CONFLICT", factId, inspected.type, sourceKind, relativePath, "HIGH",
      "UNSAFE_FILESYSTEM_OBJECT");
  } else if (inspected.exists) {
    addFact(facts, "OBSERVED_FACT", factId, inspected.type, sourceKind, relativePath);
  } else {
    addFact(facts, "UNKNOWN", factId, undefined, sourceKind, relativePath, "LOW",
      "NOT_PRESENT");
  }
}

export function discoverProject(projectRoot, mode = "RECOMMENDED") {
  requireString(mode, "discovery mode");
  if (!DISCOVERY_MODES.has(mode)) throw new Error("discovery mode is invalid");
  if (mode === "MANUAL") throw new Error("MANUAL mode disables Bootstrap Discovery");
  const root = canonicalRoot(projectRoot);
  const facts = [];
  const git = runLocal("git", ["rev-parse", "--show-toplevel"], root);
  if (git.exit_code === 0) {
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
        "HIGH", "GIT_TOP_LEVEL_DIFFERS_FROM_PROJECT_ROOT");
    }
  } else if (git.installed) {
    addFact(facts, "UNKNOWN", "repositories.topology", undefined, "GIT", root, "LOW", "NOT_A_GIT_REPOSITORY");
  } else {
    addFact(facts, "UNKNOWN", "repositories.topology", undefined, "GIT", root, "LOW", "GIT_NOT_INSTALLED");
  }

  if (git.exit_code === 0) {
    const remote = runLocal("git", ["config", "--get", "remote.origin.url"], root);
    if (remote.exit_code === 0 && remote.stdout.length > 0) {
      const normalized = normalizeRemote(remote.stdout);
      addFact(facts, normalized.status, "repositories.origin", normalized.value, "GIT", ".git/config", "HIGH",
        normalized.reason ?? null);
    } else {
      addFact(facts, "UNKNOWN", "repositories.origin", undefined, "GIT", ".git/config", "LOW", "ORIGIN_NOT_CONFIGURED");
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
        `project.marker.${relativePath}`, inspected.type, "FILESYSTEM", relativePath, "HIGH",
        inspected.type === "FILE" ? null : "UNSAFE_PROJECT_MARKER");
    }
  }
  for (const relativePath of DEPLOYMENT_MARKERS) {
    const inspected = inspectPath(root, relativePath);
    if (inspected.exists) {
      addFact(facts, inspected.type === "FILE" ? "OBSERVED_FACT" : "CONFLICT",
        `delivery.marker.${relativePath}`, inspected.type, "FILESYSTEM", relativePath, "HIGH",
        inspected.type === "FILE" ? null : "UNSAFE_DEPLOYMENT_MARKER");
    }
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
    throw new Error("usage: bootstrap-discovery discover <project-root> [RECOMMENDED|GUIDED|EXPERT|LOCAL_ONLY|MANUAL]");
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
