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
const SHA256 = /^[0-9a-f]{64}$/u;
export const compareUtf8 = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const PAGE_CONTRACT_METADATA = Object.freeze([
  "page_id",
  "page_type",
  "schema_version",
  "authority_status",
  "owner",
  "source_identity",
  "created_at",
  "last_verified_at",
  "supersedes",
  "freshness_and_invalidation",
]);

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

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function normalizeRelativePath(value, label, allowDot = false) {
  requireString(value, label);
  if (path.isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${label} must be repository-relative`);
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (path.posix.isAbsolute(normalized)
      || /^[A-Za-z]:\//u.test(normalized)
      || normalized === ".."
      || normalized.startsWith("../")
      || (normalized === "." && !allowDot)) {
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
  const relative = path.posix.relative(parent, child);
  return relative === ""
    || (relative !== ".."
      && !relative.startsWith("../")
      && !path.posix.isAbsolute(relative));
}

function pathStrictlyContains(parent, child) {
  return parent !== child && pathContains(parent, child);
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

function validateRootContainment(roots) {
  if (!pathStrictlyContains(roots.authority_root, roots.authority_index_path)) {
    throw new Error("authority_index_path must be beneath authority_root");
  }
  for (const rootName of DIRECTORY_ROOT_VARIABLES) {
    if (!pathStrictlyContains(roots.authority_root, roots[rootName])) {
      throw new Error(`${rootName} must be beneath authority_root`);
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

function normalizeRootSet(roots, label) {
  if (!roots || typeof roots !== "object" || Array.isArray(roots)) {
    throw new Error(`${label} missing`);
  }
  const normalizedRoots = {};
  for (const rootVariable of ROOT_VARIABLES) {
    normalizedRoots[rootVariable] = normalizeRelativePath(
      roots[rootVariable],
      `${label}.${rootVariable}`,
      rootVariable === "authority_root",
    );
  }
  validateRootContainment(normalizedRoots);
  validateRootSeparation(normalizedRoots);
  return normalizedRoots;
}

function normalizeEntitySet(entities, label) {
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    throw new Error(`${label} missing`);
  }
  const normalizedEntities = {};
  for (const entityList of ["feature_ids", "capability_ids", "campaign_ids", "release_ids"]) {
    if (!Array.isArray(entities[entityList])) {
      throw new Error(`${label}.${entityList} must be an array`);
    }
    normalizedEntities[entityList] = entities[entityList]
      .map((value) => validateEntityId(value, `${label}.${entityList}`))
      .sort(compareUtf8);
    if (new Set(normalizedEntities[entityList]).size !== normalizedEntities[entityList].length) {
      throw new Error(`${label}.${entityList} contains duplicates`);
    }
  }
  return normalizedEntities;
}

function portableTemplateDigest(portableTemplateInstance) {
  const body = structuredClone(portableTemplateInstance);
  delete body.project_identity.exact_context_digest;
  return sha256(Buffer.from(canonicalCompactJson(body), "utf8"));
}

function validatePortableTemplateInstance(context) {
  const portableTemplateInstance = context.portable_template_instance;
  if (!portableTemplateInstance
      || typeof portableTemplateInstance !== "object"
      || Array.isArray(portableTemplateInstance)) {
    throw new Error("portable_template_instance missing");
  }
  const projectIdentity = portableTemplateInstance.project_identity;
  if (!projectIdentity || typeof projectIdentity !== "object" || Array.isArray(projectIdentity)) {
    throw new Error("portable_template_instance.project_identity missing");
  }
  if (projectIdentity.context_version !== 1) {
    throw new Error("portable template context version is invalid");
  }
  requireString(projectIdentity.project_name, "portable template project name");
  requireSha(projectIdentity.exact_context_digest, "portable template exact context digest");
  const computedDigest = portableTemplateDigest(portableTemplateInstance);
  if (computedDigest !== projectIdentity.exact_context_digest) {
    throw new Error("portable template exact context digest is stale or mismatched");
  }
  return {portableTemplateInstance, portableContextDigest: computedDigest};
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
  const {portableTemplateInstance, portableContextDigest} = validatePortableTemplateInstance(context);
  const normalizedRoots = normalizeRootSet(context.authority_corpus_roots, "authority_corpus_roots");
  const portableRoots = normalizeRootSet(
    portableTemplateInstance.authority_corpus_roots,
    "portable_template_instance.authority_corpus_roots",
  );
  if (canonicalCompactJson(normalizedRoots) !== canonicalCompactJson(portableRoots)) {
    throw new Error("authority corpus roots are not bound to the portable template instance");
  }
  const normalizedEntities = normalizeEntitySet(context.authority_corpus_entities, "authority_corpus_entities");
  const portableEntities = normalizeEntitySet(
    portableTemplateInstance.authority_corpus_entities,
    "portable_template_instance.authority_corpus_entities",
  );
  if (canonicalCompactJson(normalizedEntities) !== canonicalCompactJson(portableEntities)) {
    throw new Error("authority corpus entities are not bound to the portable template instance");
  }
  return {
    roots: normalizedRoots,
    entities: normalizedEntities,
    portableTemplateInstance,
    portableContextDigest,
  };
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

function validateCompiledPagePath(relativePath, roots) {
  if (!pathStrictlyContains(roots.authority_root, relativePath)) {
    throw new Error(`compiled authority page escapes authority_root: ${relativePath}`);
  }
  if (pathContains(roots.authority_index_path, relativePath)
      || pathContains(relativePath, roots.authority_index_path)) {
    throw new Error(`compiled authority page overlaps authority_index_path: ${relativePath}`);
  }
}

export function compileCorpusPlan(context, workflow) {
  const {roots, entities, portableTemplateInstance, portableContextDigest} = validateCorpusInputs(context, workflow);
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
  for (const page of pages) validateCompiledPagePath(page.relative_path, roots);
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
      project_name: portableTemplateInstance.project_identity.project_name,
      exact_context_digest: portableContextDigest,
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

function requiredPageMetadata(workflow) {
  const required = workflow.authority_corpus_system.page_contract?.required_metadata;
  if (!Array.isArray(required)
      || required.length !== PAGE_CONTRACT_METADATA.length
      || PAGE_CONTRACT_METADATA.some((field) => !required.includes(field))) {
    throw new Error("authority page contract metadata does not match the portable compiler");
  }
  return required;
}

function parsePageMetadata(bytes, label) {
  const text = bytes.toString("utf8");
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`${label} has no front matter`);
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) throw new Error(`${label} front matter is not closed`);
  const metadata = {};
  for (const line of lines.slice(1, closingIndex)) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`${label} front matter contains an invalid field`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new Error(`${label} front matter repeats ${key}`);
    }
    metadata[key] = value;
  }
  return metadata;
}

function validatePageMetadata(page, plan, metadata, required, label) {
  for (const field of required) {
    requireString(metadata[field], `${label} ${field}`);
  }
  if (metadata.page_id !== page.page_id) throw new Error(`${label} page_id disagrees with the plan`);
  if (metadata.page_type !== page.page_type) throw new Error(`${label} page_type disagrees with the plan`);
  if (metadata.source_identity !== plan.context_identity.exact_context_digest) {
    throw new Error(`${label} source_identity disagrees with the portable context`);
  }
  requireSha(metadata.source_identity, `${label} source_identity`);
  if (metadata.owner === "UNASSIGNED" && metadata.authority_status !== "DRAFT_NONAUTHORITATIVE") {
    throw new Error(`${label} is unowned authority`);
  }
  return metadata;
}

function buildAuthorityIndex(realRoot, plan, workflow) {
  const required = requiredPageMetadata(workflow);
  const entries = plan.pages.map((page) => {
    const content = readFileNoFollow(realRoot, page.relative_path, "authority page");
    const metadata = validatePageMetadata(
      page,
      plan,
      parsePageMetadata(content, "authority page"),
      required,
      `authority page ${page.relative_path}`,
    );
    return {
      path: page.relative_path,
      ...page,
      schema_version: metadata.schema_version,
      authority_status: metadata.authority_status,
      owner: metadata.owner,
      source_identity: metadata.source_identity,
      created_at: metadata.created_at,
      last_verified_at: metadata.last_verified_at,
      supersedes: metadata.supersedes,
      freshness_and_invalidation: metadata.freshness_and_invalidation,
      dependencies: [],
      content_sha256: sha256(content),
    };
  });
  return {
    schema: "governance.authority_corpus_index.v1",
    plan_sha256: plan.plan_sha256,
    context_identity: plan.context_identity,
    entries,
  };
}

function validatePhysicalLayout(realRoot, roots) {
  inspectExistingPath(realRoot, roots.authority_root, "authority root");
  for (const rootName of DIRECTORY_ROOT_VARIABLES) {
    inspectExistingPath(realRoot, roots[rootName], `${rootName} root`);
  }
  inspectExistingPath(realRoot, roots.authority_index_path, "authority index");
}

function acquireExclusiveLock(realRoot, relativePath, label) {
  const lockRelativePath = `${relativePath}.lock`;
  ensureSafeDirectory(realRoot, path.posix.dirname(lockRelativePath), `${label} lock parent`);
  const lockPath = resolveLexicallyInside(realRoot, lockRelativePath, `${label} lock`);
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(
      lockPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    created = true;
    fs.writeSync(descriptor, Buffer.from("exclusive\n", "utf8"));
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (created) {
      try {
        fs.unlinkSync(lockPath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      }
    }
    if (error.code === "EEXIST") throw new Error(`${label} compare-and-swap is already in progress`);
    throw error;
  }
  fs.closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.unlinkSync(lockPath);
  };
}

function readExistingIndex(realRoot, relativePath) {
  const absolutePath = inspectExistingPath(realRoot, relativePath, "authority index");
  if (!fs.existsSync(absolutePath)) return null;
  const bytes = readFileNoFollow(realRoot, relativePath, "authority index");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`authority index is invalid JSON: ${error.message}`);
  }
  if (canonicalJson(value) !== bytes.toString("utf8")) {
    throw new Error("authority index is not canonical JSON");
  }
  return {absolutePath, bytes, value, digest: sha256(bytes)};
}

function syncDirectory(realRoot, relativeDirectory, label) {
  const directory = inspectExistingPath(realRoot, relativeDirectory, label, true);
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | noFollowFlag());
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function applyCorpusPlan(authorityRoot, context, workflow, {expectedParentDigest = null} = {}) {
  if (context.authority_corpus_activation !== "ACTIVATED") {
    throw new Error("authority corpus apply requires authority_corpus_activation=ACTIVATED");
  }
  if (expectedParentDigest !== null) requireSha(expectedParentDigest, "authority index expected parent digest");
  const {roots} = validateCorpusInputs(context, workflow);
  const plan = compileCorpusPlan(context, workflow);
  const realRoot = canonicalAuthorityRoot(authorityRoot);
  validatePhysicalLayout(realRoot, roots);
  ensureSafeDirectory(realRoot, roots.authority_root, "authority root");
  const indexParentRelativePath = path.posix.dirname(plan.authority_index_path);
  ensureSafeDirectory(realRoot, indexParentRelativePath, "authority index parent");
  const releaseLock = acquireExclusiveLock(realRoot, plan.authority_index_path, "authority index");
  let temporaryPath = null;
  try {
    const existing = readExistingIndex(realRoot, plan.authority_index_path);
    if (existing !== null && expectedParentDigest !== null && existing.digest !== expectedParentDigest) {
      throw new Error("authority index compare-and-swap parent is stale");
    }
    if (existing !== null && expectedParentDigest === null) {
      let currentIndex;
      try {
        currentIndex = buildAuthorityIndex(realRoot, plan, workflow);
      } catch (error) {
        throw new Error(`existing authority index requires an expected parent digest before replacement: ${error.message}`);
      }
      const currentBytes = Buffer.from(canonicalJson(currentIndex), "utf8");
      if (currentBytes.equals(existing.bytes)) {
        return {plan, index: currentIndex, index_sha256: existing.digest};
      }
      throw new Error("existing authority index requires an expected parent digest before replacement");
    }
    if (existing === null && expectedParentDigest !== null) {
      throw new Error("authority index expected parent digest is set but no parent index exists");
    }

    for (const page of plan.pages) {
      const absolutePath = inspectExistingPath(realRoot, page.relative_path, "authority page");
      if (fs.existsSync(absolutePath)) {
        readFileNoFollow(realRoot, page.relative_path, "authority page");
        continue;
      }
      writeNewFileNoFollow(realRoot, page.relative_path, renderDraftPage(page, plan), "authority page");
    }
    const index = buildAuthorityIndex(realRoot, plan, workflow);
    const indexBytes = Buffer.from(canonicalJson(index), "utf8");
    const latest = readExistingIndex(realRoot, plan.authority_index_path);
    if (existing === null && latest !== null) throw new Error("authority index appeared during compare-and-swap");
    if (existing !== null && (latest === null || latest.digest !== existing.digest)) {
      throw new Error("authority index changed during compare-and-swap");
    }
    const temporaryRelativePath = `${plan.authority_index_path}.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
    temporaryPath = writeNewFileNoFollow(
      realRoot,
      temporaryRelativePath,
      indexBytes,
      "authority index temporary file",
    );
    const indexPath = resolveLexicallyInside(realRoot, plan.authority_index_path, "authority index");
    inspectExistingPath(realRoot, indexParentRelativePath, "authority index parent", true);
    fs.renameSync(temporaryPath, indexPath);
    temporaryPath = null;
    syncDirectory(realRoot, indexParentRelativePath, "authority index parent");
    const readbackBytes = readFileNoFollow(realRoot, plan.authority_index_path, "authority index");
    if (!readbackBytes.equals(indexBytes)) throw new Error("authority index readback differs from the staged index");
    const readback = readExistingIndex(realRoot, plan.authority_index_path);
    if (readback.digest !== sha256(indexBytes)
        || readback.value.plan_sha256 !== plan.plan_sha256
        || canonicalCompactJson(readback.value) !== canonicalCompactJson(index)) {
      throw new Error("authority index readback identity differs from the compiled index");
    }
    return {plan, index: readback.value, index_sha256: readback.digest};
  } finally {
    if (temporaryPath !== null && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    releaseLock();
  }
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
