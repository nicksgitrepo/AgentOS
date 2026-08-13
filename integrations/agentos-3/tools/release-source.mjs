import {createHash} from "node:crypto";
import {lstat, readdir, readFile} from "node:fs/promises";
import {join, relative, resolve, sep} from "node:path";
import {spawnSync} from "node:child_process";

const GENERATED_PATH_PREFIXES = Object.freeze([
  "integrations/agentos-3/dist/",
  "integrations/agentos-3/main-core/control/",
  "integrations/agentos-3/main-core/governance/",
  "integrations/agentos-3/main-core/migrations/",
]);
const GENERATED_EXACT_PATHS = Object.freeze([
  "integrations/agentos-3/main-core/source-manifest.json",
]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function git(repositoryRoot, args, {encoding = "utf8"} = {}) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {encoding, maxBuffer: 128 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`RELEASE_SOURCE_GIT_FAILED:${args.join(" ")}:${String(result.stderr).trim()}`);
  return encoding === null ? result.stdout : result.stdout.trim();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function digest(value) { return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex"); }
function safeGitPath(value) {
  assert(typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0"), "RELEASE_SOURCE_PATH_UNSAFE");
  assert(value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "RELEASE_SOURCE_PATH_UNSAFE");
  return value;
}
function generatedPath(value) {
  const path = safeGitPath(value);
  return GENERATED_EXACT_PATHS.includes(path) || GENERATED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}
function changedPaths(repositoryRoot, sourceCommit, headCommit) {
  const output = git(repositoryRoot, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", `${sourceCommit}..${headCommit}`, "--"], {encoding: null});
  return output.toString("utf8").split("\0").filter(Boolean).map(safeGitPath).sort();
}
function dirtyPaths(repositoryRoot) {
  const output = git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {encoding: null});
  const records = output.toString("utf8").split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const path = safeGitPath(record.slice(3));
    paths.push(path);
    if (status.includes("R") || status.includes("C")) {
      index += 1;
      assert(index < records.length, "RELEASE_SOURCE_RENAME_RECORD_INVALID");
      paths.push(safeGitPath(records[index]));
    }
  }
  return [...new Set(paths)].sort();
}

export function verifyReleaseSourceIdentity({repositoryRoot, sourceCommit, sourceTree} = {}) {
  const root = resolve(repositoryRoot ?? "");
  assert(/^[0-9a-f]{40}$/u.test(sourceCommit ?? ""), "RELEASE_SOURCE_COMMIT_INVALID");
  assert(/^[0-9a-f]{40}$/u.test(sourceTree ?? ""), "RELEASE_SOURCE_TREE_INVALID");
  assert(git(root, ["rev-parse", `${sourceCommit}^{tree}`]) === sourceTree, "RELEASE_SOURCE_TREE_MISMATCH");
  const ancestor = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sourceCommit, "HEAD"], {encoding: "utf8"});
  assert(ancestor.status === 0, "RELEASE_SOURCE_NOT_ANCESTOR_OF_HEAD");
  const headCommit = git(root, ["rev-parse", "HEAD"]);
  const headTree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const committedChanges = changedPaths(root, sourceCommit, headCommit);
  const dirtyChanges = dirtyPaths(root);
  const nonGeneratedCommitted = committedChanges.filter((path) => !generatedPath(path));
  const nonGeneratedDirty = dirtyChanges.filter((path) => !generatedPath(path));
  assert(nonGeneratedCommitted.length === 0, `RELEASE_SOURCE_DRIFT:${nonGeneratedCommitted.join(",")}`);
  assert(nonGeneratedDirty.length === 0, `RELEASE_SOURCE_DIRTY:${nonGeneratedDirty.join(",")}`);
  const body = {
    schema: "agentos.integration.release_source_identity.v1",
    source_commit: sourceCommit,
    source_tree: sourceTree,
    observed_head_commit: headCommit,
    observed_head_tree: headTree,
    generated_committed_paths: committedChanges,
    generated_dirty_paths: dirtyChanges,
    non_generated_drift: [],
    status: "EXACT_SOURCE_OR_GENERATED_DESCENDANT",
    identity_sha256: null,
  };
  body.identity_sha256 = digest({...body, identity_sha256: null});
  return body;
}

export async function listReleaseFiles(root, current = root) {
  const repositoryRoot = resolve(root);
  const directory = resolve(current);
  assert(directory === repositoryRoot || directory.startsWith(`${repositoryRoot}${sep}`), "RELEASE_FILE_ROOT_ESCAPE");
  const output = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = join(directory, name);
    const info = await lstat(absolute);
    const path = relative(repositoryRoot, absolute).split("\\").join("/");
    if (info.isSymbolicLink()) throw new Error(`RELEASE_SYMLINK_FORBIDDEN:${path}`);
    if (info.isDirectory()) output.push(...await listReleaseFiles(repositoryRoot, absolute));
    else if (info.isFile()) output.push(absolute);
    else throw new Error(`RELEASE_SPECIAL_FILE_FORBIDDEN:${path}`);
  }
  return output.sort();
}

export async function verifyReleaseBinding({integrationRoot} = {}) {
  const root = resolve(integrationRoot ?? "");
  const repositoryRoot = resolve(root, "../..");
  const binding = JSON.parse(await readFile(join(root, "contracts", "release-source-binding.v1.json"), "utf8"));
  assert(binding.schema === "agentos.integration.release_source_binding.v1" && binding.version === 1, "RELEASE_SOURCE_BINDING_INVALID");
  assert(binding.status === "BOUND_INACTIVE_RELEASE_CANDIDATE" && binding.activation === "OFF", "RELEASE_SOURCE_BINDING_AUTHORITY_INVALID");
  assert(Array.isArray(binding.entries) && binding.entries.length > 0, "RELEASE_SOURCE_BINDING_EMPTY");
  const seen = new Set();
  for (const entry of binding.entries) {
    const path = safeGitPath(entry.path);
    assert(!seen.has(path), `RELEASE_SOURCE_BINDING_DUPLICATE:${path}`);
    const bytes = await readFile(join(repositoryRoot, path));
    assert(/^[0-9a-f]{64}$/u.test(entry.sha256) && createHash("sha256").update(bytes).digest("hex") === entry.sha256, `RELEASE_SOURCE_BINDING_DIGEST_MISMATCH:${path}`);
    seen.add(path);
  }
  return binding;
}

export const RELEASE_GENERATED_PATHS = Object.freeze({prefixes: GENERATED_PATH_PREFIXES, exact: GENERATED_EXACT_PATHS});
