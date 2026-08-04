#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

export const ROOT_VARIABLES = [
  "authority_root",
  "authority_index_path",
  "project_context_root",
  "project_goals_root",
  "design_system_root",
  "features_root",
  "platform_capabilities_root",
  "campaigns_root",
  "decisions_root",
  "cases_root",
  "evidence_index_root",
  "archive_root",
  "evidence_library_root",
];

const ENTITY_VARIABLES = {
  per_feature: ["feature_id", "feature_ids"],
  per_platform_capability: ["capability_id", "capability_ids"],
  campaign: ["campaign_id", "campaign_ids"],
  per_release: ["release_id", "release_ids"],
};

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export const compareUtf8 = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareUtf8)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export const canonicalCompactJson = (value) => JSON.stringify(canonicalize(value));
const canonicalJson = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;

const DIRECTORY_ROOT_VARIABLES = [
  "project_context_root",
  "project_goals_root",
  "design_system_root",
  "features_root",
  "platform_capabilities_root",
  "campaigns_root",
  "decisions_root",
  "cases_root",
  "evidence_index_root",
  "archive_root",
  "evidence_library_root",
];

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function normalizeRelativePath(value, label, allowDot = false) {
  requireString(value, label);
  if (path.isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${label} must be repository-relative`);
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || (normalized === "." && !allowDot)) {
    throw new Error(`${label} escapes or does not identify a file/directory`);
  }
  return normalized;
}

function validateEntityId(value, label) {
  requireString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${label} contains an unsafe character`);
  }
  return value;
}

function pathContains(parent, child) {
  return child === parent || child.startsWith(`${parent}/`);
}

function validateRootSeparation(roots) {
  for (let leftIndex = 0; leftIndex < DIRECTORY_ROOT_VARIABLES.length; leftIndex += 1) {
    const leftName = DIRECTORY_ROOT_VARIABLES[leftIndex];
    const left = roots[leftName];
    for (let rightIndex = leftIndex + 1; rightIndex < DIRECTORY_ROOT_VARIABLES.length; rightIndex += 1) {
      const rightName = DIRECTORY_ROOT_VARIABLES[rightIndex];
      const right = roots[rightName];
      if (pathContains(left, right) || pathContains(right, left)) {
        throw new Error(`${leftName} and ${rightName} overlap`);
      }
    }
    if (pathContains(left, roots.authority_index_path)
        || pathContains(roots.authority_index_path, left)) {
      throw new Error(`authority_index_path overlaps ${leftName}`);
    }
  }
}

function isInsideRealRoot(realRoot, candidate) {
  return candidate === realRoot || candidate.startsWith(`${realRoot}${path.sep}`);
}

function canonicalAuthorityRoot(root) {
  const realRoot = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(realRoot);
  if (!stat.isDirectory()) throw new Error("authority root is not a directory");
  return realRoot;
}

function resolveLexicallyInside(realRoot, relativePath, label) {
  const resolved = path.resolve(realRoot, relativePath);
  if (!isInsideRealRoot(realRoot, resolved)) {
    throw new Error(`${label} escapes authority root`);
  }
  return resolved;
}

function inspectExistingPath(realRoot, relativePath, label, requireLeaf = false) {
  const absolutePath = resolveLexicallyInside(realRoot, relativePath, label);
  const relative = path.relative(realRoot, absolutePath);
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (requireLeaf) throw new Error(`${label} missing`);
      break;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} traverses a symbolic link`);
    const realCurrent = fs.realpathSync.native(current);
    if (!isInsideRealRoot(realRoot, realCurrent)) {
      throw new Error(`${label} resolves outside authority root`);
    }
  }
  return absolutePath;
}

function ensureSafeDirectory(realRoot, relativeDirectory, label) {
  const absoluteDirectory = resolveLexicallyInside(realRoot, relativeDirectory, label);
  const relative = path.relative(realRoot, absoluteDirectory);
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} ancestor is not a real directory`);
    }
    const realCurrent = fs.realpathSync.native(current);
    if (!isInsideRealRoot(realRoot, realCurrent)) {
      throw new Error(`${label} ancestor resolves outside authority root`);
    }
  }
  return absoluteDirectory;
}

function noFollowFlag() {
  return fs.constants.O_NOFOLLOW ?? 0;
}

function writeNewFileNoFollow(realRoot, relativePath, bytes, label) {
  const absolutePath = resolveLexicallyInside(realRoot, relativePath, label);
  ensureSafeDirectory(realRoot, path.relative(realRoot, path.dirname(absolutePath)), `${label} parent`);
  inspectExistingPath(realRoot, path.relative(realRoot, path.dirname(absolutePath)), `${label} parent`, true);
  const descriptor = fs.openSync(
    absolutePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(),
    0o644,
  );
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} is not a regular file`);
  return absolutePath;
}

function readFileNoFollow(realRoot, relativePath, label) {
  const absolutePath = inspectExistingPath(realRoot, relativePath, label, true);
  const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateCorpusInputs(context, workflow) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("project context must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(context, "kernel")
      && context.kernel?.override_allowed !== false) {
    throw new Error("project context cannot override portable governance");
  }
  if (!workflow?.authority_corpus_system?.tree_template) {
    throw new Error("workflow authority-corpus tree template missing");
  }
  const roots = context.authority_corpus_roots;
  if (!roots || typeof roots !== "object" || Array.isArray(roots)) {
    throw new Error("authority_corpus_roots missing");
  }
  const normalizedRoots = {};
  for (const rootVariable of ROOT_VARIABLES) {
    normalizedRoots[rootVariable] = normalizeRelativePath(
      roots[rootVariable],
      rootVariable,
      rootVariable === "authority_root",
    );
  }
  validateRootSeparation(normalizedRoots);
  const entities = context.authority_corpus_entities ?? {};
  const normalizedEntities = {};
  for (const entityList of ["feature_ids", "capability_ids", "campaign_ids", "release_ids"]) {
    if (!Array.isArray(entities[entityList])) {
      throw new Error(`${entityList} must be an array`);
    }
    normalizedEntities[entityList] = entities[entityList]
      .map((value) => validateEntityId(value, entityList))
      .sort(compareUtf8);
    if (new Set(normalizedEntities[entityList]).size !== normalizedEntities[entityList].length) {
      throw new Error(`${entityList} contains duplicates`);
    }
  }
  return {roots: normalizedRoots, entities: normalizedEntities};
}

function expandTemplate(template, variables) {
  let expanded = template;
  for (const [name, value] of Object.entries(variables)) {
    expanded = expanded.replaceAll(`\${${name}}`, value);
  }
  if (/\$\{[^}]+\}/.test(expanded)) {
    throw new Error(`unresolved tree-template variable in ${template}`);
  }
  return normalizeRelativePath(expanded, "expanded authority path");
}

function pageTypeFor(section, relativePath) {
  return `${section}.${path.posix.basename(relativePath, path.posix.extname(relativePath))}`
    .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

export function compileCorpusPlan(context, workflow) {
  const {roots, entities} = validateCorpusInputs(context, workflow);
  const tree = workflow.authority_corpus_system.tree_template;
  const pages = [];
  for (const section of ["project", "corpus_indexes"]) {
    for (const template of tree[section]) {
      const relativePath = expandTemplate(template, roots);
      pages.push({relative_path: relativePath, page_type: pageTypeFor(section, relativePath)});
    }
  }
  for (const [section, [entityVariable, entityList]] of Object.entries(ENTITY_VARIABLES)) {
    for (const entityId of entities[entityList]) {
      for (const template of tree[section]) {
        const relativePath = expandTemplate(template, {...roots, [entityVariable]: entityId});
        pages.push({
          relative_path: relativePath,
          page_type: pageTypeFor(section, relativePath),
          entity_id: entityId,
        });
      }
    }
  }
  pages.sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  const paths = pages.map((page) => page.relative_path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("compiled authority tree contains duplicate paths");
  }
  const pageIds = new Set();
  for (const page of pages) {
    page.page_id = `authority-page-${sha256(Buffer.from(
      canonicalCompactJson(["governance.authority-page.v1", page.page_type, page.relative_path]),
      "utf8",
    )).slice(0, 24)}`;
    if (pageIds.has(page.page_id)) throw new Error("compiled authority tree contains duplicate page identity");
    pageIds.add(page.page_id);
  }
  const plan = {
    schema: "governance.authority_corpus_plan.v1",
    context_identity: {
      schema: context.schema ?? null,
      project_name: context.project_name ?? null,
      exact_context_digest: sha256(Buffer.from(canonicalCompactJson(context), "utf8")),
    },
    authority_index_path: roots.authority_index_path,
    pages,
  };
  plan.plan_sha256 = sha256(Buffer.from(canonicalCompactJson(plan), "utf8"));
  return plan;
}

export function renderDraftPage(page, plan) {
  if (page.page_type.endsWith(".overview")) {
    return [
      "---",
      `page_id: ${page.page_id}`,
      `page_type: ${page.page_type}`,
      "schema_version: 1",
      "authority_status: DRAFT_NONAUTHORITATIVE",
      "owner: UNASSIGNED",
      `source_identity: ${plan.context_identity.exact_context_digest}`,
      "created_at: PENDING_ACTIVATION",
      "last_verified_at: UNPROVEN",
      "supersedes: NONE",
      "freshness_and_invalidation: INVALIDATE_AFFECTED_GATES_ON_SOURCE_CONTRACT_ARTIFACT_OR_DEPLOYMENT_CHANGE",
      "---",
      "",
      "# Intent",
      "",
      "UNPROVEN — one compact observable user outcome.",
      "",
      "# Current",
      "",
      "Stage: UNPROVEN",
      "Owner: UNASSIGNED",
      "Worktree/lease/source: UNPROVEN",
      "Active substantial batch: UNPROVEN",
      "Next action: UNPROVEN",
      "",
      "# Gate register",
      "",
      "| Gate | Short intent | Progress | Audit | Owner | Evidence | Invalidation |",
      "|---|---|---|---|---|---|---|",
      "| UNPROVEN | Define from intended Product behavior | PLANNED | UNPROVEN | UNASSIGNED | NONE | ON_MATERIAL_IDENTITY_CHANGE |",
      "",
      "# Working / unavailable / deferred",
      "",
      "WORKING NOW: UNPROVEN",
      "HONESTLY UNAVAILABLE: UNPROVEN",
      "DEFERRED: UNPROVEN",
      "",
      "# Contracts and ownership",
      "",
      "UNPROVEN",
      "",
      "# Current blocker",
      "",
      "NONE",
      "",
      "# Latest handoff",
      "",
      "UNPROVEN — compact paths, symbols, contracts, proof pointer, known trap, and next owner only.",
      "",
      "# Recent substantial events",
      "",
      "Keep only the latest ten compact events. Detailed evidence belongs in the active release dossier.",
      "",
    ].join("\n");
  }
  if (page.page_type.startsWith("per_release.")) {
    return [
      "---",
      `page_id: ${page.page_id}`,
      `page_type: ${page.page_type}`,
      "schema_version: 1",
      "authority_status: DRAFT_NONAUTHORITATIVE",
      "owner: CAMPAIGN_ORCHESTRATOR",
      `source_identity: ${plan.context_identity.exact_context_digest}`,
      "created_at: PENDING_ACTIVATION",
      "last_verified_at: UNPROVEN",
      "supersedes: NONE",
      "freshness_and_invalidation: INVALIDATE_ON_RELEASE_IDENTITY_OR_ARCHIVE_DIGEST_CHANGE",
      "---",
      "",
      "# Release identity and disposition",
      "",
      "UNPROVEN",
      "",
      "# Source / artifact / deployment / rollback / audit",
      "",
      "UNPROVEN",
      "",
      "# Gate summary and durable decisions",
      "",
      "UNPROVEN",
      "",
      "# Historical evidence library",
      "",
      "Active dossier or historical ZIP path: UNPROVEN",
      "Archive SHA-256: UNPROVEN",
      "Manifest SHA-256: UNPROVEN",
      "",
      "# Next-cycle backlog",
      "",
      "UNPROVEN",
      "",
    ].join("\n");
  }
  return [
    "---",
    `page_id: ${page.page_id}`,
    `page_type: ${page.page_type}`,
    "schema_version: 1",
    "authority_status: DRAFT_NONAUTHORITATIVE",
    "owner: UNASSIGNED",
    `source_identity: ${plan.context_identity.exact_context_digest}`,
    "created_at: PENDING_ACTIVATION",
    "last_verified_at: UNPROVEN",
    "supersedes: NONE",
    "freshness_and_invalidation: INVALIDATE_ON_ACCEPTED_CONTEXT_OR_SOURCE_CHANGE",
    "---",
    "",
    "# Intent or outcome",
    "",
    "UNPROVEN — fill only from admitted context.",
    "",
    "# Current source and runtime reality",
    "",
    "UNPROVEN",
    "",
    "# Authority and ownership",
    "",
    "UNASSIGNED",
    "",
    "# Contracts and dependencies",
    "",
    "UNPROVEN",
    "",
    "# Failure and unavailable behavior",
    "",
    "HONESTLY_UNAVAILABLE until admitted.",
    "",
    "# Proof",
    "",
    "UNPROVEN",
    "",
    "# Open context",
    "",
    "Context elicitation pending.",
    "",
    "# Owner and next",
    "",
    "Campaign Orchestrator routes ownership after context admission.",
    "",
  ].join("\n");
}

function buildAuthorityIndex(realRoot, plan) {
  const entries = plan.pages.map((page) => {
    return {
      ...page,
      content_sha256: sha256(readFileNoFollow(realRoot, page.relative_path, "authority page")),
    };
  });
  return {
    schema: "governance.authority_corpus_index.v1",
    plan_sha256: plan.plan_sha256,
    context_identity: plan.context_identity,
    entries,
  };
}

export function applyCorpusPlan(authorityRoot, context, workflow) {
  if (context.authority_corpus_activation !== "ACTIVATED") {
    throw new Error("authority corpus apply requires authority_corpus_activation=ACTIVATED");
  }
  const plan = compileCorpusPlan(context, workflow);
  const realRoot = canonicalAuthorityRoot(authorityRoot);
  for (const page of plan.pages) {
    const absolutePath = inspectExistingPath(realRoot, page.relative_path, "authority page");
    if (fs.existsSync(absolutePath)) {
      readFileNoFollow(realRoot, page.relative_path, "authority page");
      continue;
    }
    writeNewFileNoFollow(realRoot, page.relative_path, renderDraftPage(page, plan), "authority page");
  }
  const index = buildAuthorityIndex(realRoot, plan);
  const indexPath = inspectExistingPath(realRoot, plan.authority_index_path, "authority index");
  ensureSafeDirectory(
    realRoot,
    path.relative(realRoot, path.dirname(indexPath)),
    "authority index parent",
  );
  if (fs.existsSync(indexPath)) readFileNoFollow(realRoot, plan.authority_index_path, "authority index");
  const indexBytes = canonicalJson(index);
  const temporaryRelativePath = `${plan.authority_index_path}.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  const temporaryPath = writeNewFileNoFollow(
    realRoot,
    temporaryRelativePath,
    indexBytes,
    "authority index temporary file",
  );
  inspectExistingPath(
    realRoot,
    path.relative(realRoot, path.dirname(indexPath)),
    "authority index parent",
    true,
  );
  fs.renameSync(temporaryPath, indexPath);
  readFileNoFollow(realRoot, plan.authority_index_path, "authority index");
  return {
    plan,
    index,
    index_sha256: sha256(Buffer.from(indexBytes, "utf8")),
  };
}

function parseCli(argv) {
  const parsed = {apply: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") parsed.apply = true;
    else if (argument === "--context") parsed.context = argv[++index];
    else if (argument === "--workflow") parsed.workflow = argv[++index];
    else if (argument === "--root") parsed.root = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!parsed.context || !parsed.workflow) {
    throw new Error("usage: authority-corpus.mjs --context <json> --workflow <json> [--root <directory> --apply]");
  }
  if (parsed.apply && !parsed.root) throw new Error("--apply requires --root");
  return parsed;
}

function main() {
  const options = parseCli(process.argv.slice(2));
  const context = JSON.parse(fs.readFileSync(options.context, "utf8"));
  const workflow = JSON.parse(fs.readFileSync(options.workflow, "utf8"));
  if (options.apply) {
    process.stdout.write(canonicalJson(applyCorpusPlan(options.root, context, workflow)));
  } else {
    process.stdout.write(canonicalJson(compileCorpusPlan(context, workflow)));
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}
