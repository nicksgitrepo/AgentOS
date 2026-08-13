import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {listReleaseFiles, verifyReleaseSourceIdentity} from "./release-source.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
const SOURCE_BINDINGS = Object.freeze([
  Object.freeze({source: "control", target: "control"}),
  Object.freeze({source: "governance/3.0/audit-repair-convergence.binding.v1.json", target: "governance/3.0/audit-repair-convergence.binding.v1.json"}),
  Object.freeze({source: "governance/3.0/audit-repair-convergence.md", target: "governance/3.0/audit-repair-convergence.md"}),
  Object.freeze({source: "governance/3.0/permanent-role-authority-graph.v1.json", target: "governance/3.0/permanent-role-authority-graph.v1.json"}),
  Object.freeze({source: "governance/3.0/scheduler-runtime-custody-binding.v1.json", target: "governance/3.0/scheduler-runtime-custody-binding.v1.json"}),
  Object.freeze({source: "governance/3.0/scheduler-runtime-custody.md", target: "governance/3.0/scheduler-runtime-custody.md"}),
  Object.freeze({source: "migrations/audit-repair-convergence-v1.md", target: "migrations/audit-repair-convergence-v1.md"}),
  Object.freeze({source: "migrations/permanent-role-authority.v1.json", target: "migrations/permanent-role-authority.v1.json"}),
  Object.freeze({source: "migrations/scheduler-runtime-custody.v1.json", target: "migrations/scheduler-runtime-custody.v1.json"}),
]);

async function boundFiles(root) {
  const output = [];
  for (const binding of SOURCE_BINDINGS) {
    const target = join(root, binding.target);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`MAIN_CORE_BOUND_SOURCE_SYMLINK:${binding.target}`);
    if (info.isDirectory()) output.push(...await listReleaseFiles(target));
    else if (info.isFile()) output.push(target);
    else throw new Error(`MAIN_CORE_BOUND_SOURCE_SPECIAL_FILE:${binding.target}`);
  }
  return output.sort();
}

export async function verifyMainCore({ sourceRoot = null, coreRoot, writeManifest = false } = {}) {
  const root = resolve(coreRoot);
  const files = await boundFiles(root);
  const entries = [];
  for (const absolute of files) {
    const bytes = await readFile(absolute);
    entries.push({ path: relative(root, absolute).split("\\").join("/"), size: bytes.length, sha256: sha256(bytes) });
  }
  let existing = null;
  try { existing = JSON.parse(await readFile(join(root, "source-manifest.json"), "utf8")); } catch (error) {
    if (!writeManifest) throw error;
  }
  if (existing?.schema !== "agentos.integration.main-core-manifest.v3"
    || JSON.stringify(existing.source_bindings) !== JSON.stringify(SOURCE_BINDINGS)) {
    throw new Error("MAIN_CORE_SOURCE_BINDINGS_MISMATCH");
  }
  if (existing && JSON.stringify(existing.entries) !== JSON.stringify(entries)) throw new Error("MAIN_CORE_MANIFEST_MISMATCH");
  let releaseSource = null;
  if (sourceRoot !== null) {
    const requested = resolve(sourceRoot);
    const repositoryRoot = basename(requested) === "control" ? resolve(requested, "..") : requested;
    releaseSource = verifyReleaseSourceIdentity({repositoryRoot, sourceCommit: existing.source_commit, sourceTree: existing.source_tree});
    const sourceTree = spawnSync("git", ["-C", repositoryRoot, "rev-parse", `${existing.source_commit}^{tree}`], { encoding: "utf8" });
    if (sourceTree.status !== 0 || sourceTree.stdout.trim() !== existing.source_tree) throw new Error("MAIN_CORE_SOURCE_GIT_IDENTITY_MISMATCH");
    const listed = spawnSync("git", ["-C", repositoryRoot, "ls-tree", "-r", "--name-only", existing.source_commit, "--", ...SOURCE_BINDINGS.map((binding) => binding.source)], { encoding: "utf8" });
    if (listed.status !== 0) throw new Error("MAIN_CORE_SOURCE_GIT_IDENTITY_MISMATCH");
    const sourcePaths = listed.stdout.trim().split("\n").filter(Boolean).sort();
    if (JSON.stringify(sourcePaths) !== JSON.stringify(entries.map((entry) => entry.path))) throw new Error("MAIN_CORE_SOURCE_PATHS_MISMATCH");
    for (const entry of entries) {
      const object = spawnSync("git", ["-C", repositoryRoot, "show", `${existing.source_commit}:${entry.path}`], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
      if (object.status !== 0 || object.stdout.length !== entry.size || sha256(object.stdout) !== entry.sha256) throw new Error(`MAIN_CORE_SOURCE_BYTES_MISMATCH:${entry.path}`);
    }
  }
  if (writeManifest) throw new Error("WRITE_MANIFEST_REMOVED_USE_REBIND_MAIN_CORE");
  return { entry_count: entries.length, source_commit: existing.source_commit, source_tree: existing.source_tree, candidate_commit: existing.candidate_commit, candidate_tree: existing.candidate_tree, release_source: releaseSource };
}

if (process.argv[1]?.endsWith("verify-main-core.mjs") && process.argv[2]) {
  const [sourceRoot, coreRoot] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyMainCore({ sourceRoot, coreRoot }), null, 2));
}
