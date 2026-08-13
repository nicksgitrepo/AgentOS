import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverProject } from "./main-core/control/bootstrap-discovery.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const asAbsolute = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/")) throw new Error(`${label}_ABSOLUTE_REQUIRED`);
  return resolve(value);
};
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);

async function realDirectory(path, label, { allowMissing = false, privateDirectory = true } = {}) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label}_SYMLINK_OR_NOT_DIRECTORY`);
    if (privateDirectory && (info.mode & 0o077) !== 0) throw new Error(`${label}_PERMISSIONS`);
    return info;
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
}

async function regularFile(path, label) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === "ENOENT") throw new Error(`${label}_MISSING`); throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label}_SYMLINK_OR_NOT_FILE`);
  return info;
}

export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { if (typeof handle.sync === "function") await handle.sync(); } finally { await handle.close(); }
}

export async function projectCompanionRoots(projectRootInput, companionRootInput, mode = "EXTERNAL_SIBLING", { allowExisting = false } = {}) {
  if (mode !== "EXTERNAL_SIBLING") throw new Error(`${mode}_FORBIDDEN`);
  const projectRoot = asAbsolute(projectRootInput, "PROJECT_ROOT");
  const companionRoot = asAbsolute(companionRootInput, "COMPANION_ROOT");
  const systemRoot = resolve(sep);
  const home = resolve(homedir());
  if ([systemRoot, home].includes(projectRoot) || [systemRoot, home].includes(companionRoot)) throw new Error("ROOT_OR_HOME_FORBIDDEN");
  if (projectRoot === companionRoot) throw new Error("PROJECT_COMPANION_COLLISION");
  if (isWithin(projectRoot, companionRoot) || isWithin(companionRoot, projectRoot)) throw new Error("PROJECT_COMPANION_OVERLAP");
  if (dirname(projectRoot) !== dirname(companionRoot)) throw new Error("COMPANION_MUST_BE_SIBLING");
  await realDirectory(dirname(companionRoot), "COMPANION_PARENT", { privateDirectory: false });
  if (await realpath(projectRoot) !== projectRoot || await realpath(dirname(companionRoot)) !== dirname(companionRoot)) throw new Error("NON_CANONICAL_ROOT");
  await realDirectory(projectRoot, "PROJECT_ROOT", { privateDirectory: false });
  const existingCompanion = await realDirectory(companionRoot, "COMPANION_ROOT", { allowMissing: true, privateDirectory: true });
  if (existingCompanion && !allowExisting) throw new Error("COMPANION_ALREADY_EXISTS");
  if (!existingCompanion && allowExisting) throw new Error("COMPANION_MISSING");
  return { projectRoot, companionRoot };
}

async function walkProjectContent(root, current = root, output = []) {
  for (const name of (await readdir(current)).sort()) {
    const absolute = join(current, name);
    const info = await lstat(absolute);
    const projectRelative = relative(root, absolute).split("\\").join("/");
    if (name === ".git") {
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new Error(`PROJECT_GIT_METADATA_UNSAFE:${projectRelative}`);
      }
      continue;
    }
    if (info.isSymbolicLink()) throw new Error(`PROJECT_SYMLINK:${relative(root, absolute)}`);
    if (info.isDirectory()) {
      output.push({ path: projectRelative, type: "DIRECTORY" });
      await walkProjectContent(root, absolute, output);
    }
    else if (info.isFile()) {
      const bytes = await readFile(absolute);
      output.push({ path: projectRelative, type: "FILE", size: bytes.length, sha256: sha256(bytes) });
    } else {
      throw new Error(`PROJECT_SPECIAL_FILE:${projectRelative}`);
    }
  }
  return output.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function runGit(repositoryRoot, args, { binary = false } = {}) {
  return spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: binary ? null : "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    timeout: 10_000,
    windowsHide: true,
  });
}

function exactRepositoryRoot(candidate) {
  const topLevel = runGit(candidate, ["rev-parse", "--show-toplevel"]);
  if (topLevel.status !== 0 || typeof topLevel.stdout !== "string" || topLevel.stdout.trim().length === 0) return null;
  let canonicalTopLevel;
  try { canonicalTopLevel = resolve(topLevel.stdout.trim()); } catch { return null; }
  return canonicalTopLevel === candidate ? candidate : null;
}

async function repositoryIdentity(projectRoot, relativeRoot) {
  const repositoryRoot = relativeRoot === "." ? projectRoot : resolve(projectRoot, relativeRoot);
  if (!isWithin(projectRoot, repositoryRoot) || exactRepositoryRoot(repositoryRoot) !== repositoryRoot) {
    throw new Error(`PROJECT_REPOSITORY_BINDING_INVALID:${relativeRoot}`);
  }
  const gitAdmin = await lstat(join(repositoryRoot, ".git"));
  if (gitAdmin.isSymbolicLink() || (!gitAdmin.isDirectory() && !gitAdmin.isFile())) {
    throw new Error(`PROJECT_GIT_METADATA_UNSAFE:${relativeRoot}/.git`);
  }
  const head = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  const tree = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"]);
  const branch = runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const status = runGit(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { binary: true });
  if (status.status !== 0 || !Buffer.isBuffer(status.stdout)) throw new Error(`PROJECT_REPOSITORY_STATUS_FAILED:${relativeRoot}`);
  const hasHead = head.status === 0 && tree.status === 0
    && /^[0-9a-f]{40}$/u.test(head.stdout.trim()) && /^[0-9a-f]{40}$/u.test(tree.stdout.trim());
  if ((head.status === 0) !== (tree.status === 0)) throw new Error(`PROJECT_REPOSITORY_HEAD_TREE_MISMATCH:${relativeRoot}`);
  const identity = {
    relative_root: relativeRoot,
    git_admin_kind: gitAdmin.isDirectory() ? "DIRECTORY" : "FILE",
    state: hasHead ? "HEAD_BOUND" : "UNBORN",
    head: hasHead ? head.stdout.trim() : null,
    tree: hasHead ? tree.stdout.trim() : null,
    branch: branch.status === 0 && branch.stdout.trim().length > 0 ? branch.stdout.trim() : null,
    status_base64: status.stdout.toString("base64"),
    status_sha256: sha256(status.stdout),
  };
  return identity;
}

function nestedRepositoryRoots(discovery) {
  return discovery.facts
    .filter((entry) => entry.fact_id.startsWith("repositories.nested.")
      && entry.fact_id !== "repositories.nested.count"
      && !entry.fact_id.startsWith("repositories.nested.issue.")
      && entry.status === "OBSERVED_FACT")
    .map((entry) => dirname(entry.source_locator).split("\\").join("/"))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

export async function snapshotProject(projectRootInput) {
  const requestedProjectRoot = asAbsolute(projectRootInput, "PROJECT_ROOT");
  await realDirectory(requestedProjectRoot, "PROJECT_ROOT", { privateDirectory: false });
  const discovery = discoverProject(requestedProjectRoot, "RECOMMENDED");
  const projectRoot = discovery.project_root;
  const topologyFact = discovery.facts.find((entry) => entry.fact_id === "repositories.topology");
  if (!topologyFact || topologyFact.status === "CONFLICT") {
    throw new Error(`PROJECT_TOPOLOGY_DISCOVERY_INCOMPLETE:${topologyFact?.reason ?? "MISSING_TOPOLOGY_FACT"}`);
  }
  const entries = await walkProjectContent(projectRoot);
  const repositoryRoots = new Set(nestedRepositoryRoots(discovery));
  if (exactRepositoryRoot(projectRoot) === projectRoot) repositoryRoots.add(".");
  const repositories = [];
  for (const relativeRoot of [...repositoryRoots].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    repositories.push(await repositoryIdentity(projectRoot, relativeRoot));
  }
  let topology;
  if (repositories.length > 1) topology = "MULTI_REPOSITORY_PROJECT_ROOT";
  else if (repositories.length === 1) topology = "SINGLE_REPOSITORY";
  else if (entries.length === 0) topology = "EMPTY_PROJECT_ROOT";
  else topology = "NON_GIT_PROJECT_ROOT";
  const snapshot = {
    schema: "agentos.integration.project_snapshot.v2",
    topology,
    entries,
    repositories,
    content_sha256: sha256(canonical(entries)),
    repository_state_sha256: sha256(canonical(repositories)),
  };
  return Object.freeze(snapshot);
}

export function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalPath(path) {
  const segments = typeof path === "string" ? path.split("/") : [];
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\u0000") || segments.some((segment) => segment.length === 0 || segment === ".." || segment === ".")) throw new Error("BUNDLE_PATH_NOT_CANONICAL");
  return path;
}

export async function verifyBundle(bundlePathInput) {
  const bundlePath = asAbsolute(bundlePathInput, "BUNDLE_PATH");
  await regularFile(bundlePath, "BUNDLE");
  const manifestPath = bundlePath.replace(/\.bundle\.json$/u, ".manifest.json");
  await regularFile(manifestPath, "MANIFEST");
  const bundleBytes = await readFile(bundlePath);
  const manifestBytes = await readFile(manifestPath);
  const bundle = JSON.parse(bundleBytes);
  const manifest = JSON.parse(manifestBytes);
  if (!bundleBytes.equals(canonical(bundle)) || !manifestBytes.equals(canonical(manifest))) throw new Error("BUNDLE_OR_MANIFEST_NON_CANONICAL");
  if (JSON.stringify(Object.keys(bundle).sort()) !== JSON.stringify(["build_id", "entries", "schema"]) || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(["activation", "build_id", "bundle_sha256", "entries", "includes", "lifecycle", "release_source", "rollback_identity", "schema", "source_base", "source_tree"])) throw new Error("BUNDLE_SCHEMA_INVALID");
  if (bundle.schema !== "agentos.integration.bundle.v1" || manifest.schema !== "agentos.integration.manifest.v1") throw new Error("BUNDLE_SCHEMA_INVALID");
  if (JSON.stringify(manifest.includes) !== JSON.stringify(["current-main-core", "memory-m2", "agent-builder", "specialist-block-library", "root-schemas"])) throw new Error("BUNDLE_COMPONENT_SET_INVALID");
  if (bundle.build_id !== "AGENTOS_3_TEST_BUILD" || manifest.lifecycle !== "CANDIDATE_INACTIVE" || manifest.activation !== "OFF" || manifest.rollback_identity !== "AGENTOS_3_TEST_BUILD_ROLLBACK") throw new Error("BUNDLE_LIFECYCLE_INVALID");
  if (!/^[0-9a-f]{40}$/u.test(manifest.source_base) || !/^[0-9a-f]{40}$/u.test(manifest.source_tree) || manifest.release_source?.source_commit !== manifest.source_base || manifest.release_source?.source_tree !== manifest.source_tree || manifest.release_source?.status !== "EXACT_SOURCE_OR_GENERATED_DESCENDANT" || !/^[0-9a-f]{64}$/u.test(manifest.release_source?.identity_sha256 ?? "")) throw new Error("BUNDLE_RELEASE_SOURCE_INVALID");
  if (manifest.bundle_sha256 !== sha256(bundleBytes)) throw new Error("BUNDLE_DIGEST_MISMATCH");
  if (bundle.build_id !== manifest.build_id || !Array.isArray(bundle.entries) || !Array.isArray(manifest.entries)) throw new Error("BUNDLE_MANIFEST_IDENTITY_MISMATCH");
  const paths = bundle.entries.map((entry) => canonicalPath(entry.path));
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) throw new Error("BUNDLE_DUPLICATE_OR_UNSORTED_PATH");
  if (manifest.entries.length !== bundle.entries.length) throw new Error("BUNDLE_ENTRY_COUNT_MISMATCH");
  for (let index = 0; index < bundle.entries.length; index += 1) {
    const entry = bundle.entries[index];
    const declared = manifest.entries[index];
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["bytes_base64", "path", "sha256", "size"]) || JSON.stringify(Object.keys(declared).sort()) !== JSON.stringify(["path", "sha256", "size"])) throw new Error("BUNDLE_ENTRY_SHAPE_INVALID");
    if (declared.path !== entry.path || declared.size !== entry.size || declared.sha256 !== entry.sha256) throw new Error("BUNDLE_MANIFEST_ENTRY_MISMATCH");
    const bytes = Buffer.from(entry.bytes_base64, "base64");
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error(`BUNDLE_ENTRY_DIGEST_MISMATCH:${entry.path}`);
  }
  return { bundlePath, manifestPath, bundleBytes, manifestBytes, bundle, manifest, bundleSha256: sha256(bundleBytes), manifestSha256: sha256(manifestBytes) };
}

export async function writeCreateOnly(path, bytes) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

export async function makePrivateDirectory(path) { await mkdir(path, { mode: 0o700 }); await realDirectory(path, "PRIVATE_DIRECTORY"); }

export async function writeOwnedEntry(root, entry) {
  const path = canonicalPath(entry.path);
  const target = resolve(root, "payload", ...path.split("/"));
  if (!isWithin(resolve(root, "payload"), target)) throw new Error("INSTALL_PATH_ESCAPE");
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await writeCreateOnly(target, Buffer.from(entry.bytes_base64, "base64"));
  return { path, target };
}

export async function listCompanion(root) {
  const result = [];
  async function visit(current, prefix = "") {
    for (const name of (await readdir(current)).sort()) {
      const absolute = join(current, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`COMPANION_SYMLINK:${name}`);
      const path = prefix ? `${prefix}/${name}` : name;
      if (info.isDirectory()) await visit(absolute, path);
      else if (info.isFile()) result.push(path);
      else throw new Error(`COMPANION_SPECIAL_FILE:${path}`);
    }
  }
  await visit(root);
  return result.sort();
}

export { canonical, sha256, asAbsolute, realDirectory, regularFile, resolve, join, dirname, relative };
