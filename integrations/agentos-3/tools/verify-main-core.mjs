import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function listFiles(root, current = root) {
  const output = [];
  for (const name of (await readdir(current)).sort()) {
    const absolute = join(current, name);
    const info = await stat(absolute);
    if (info.isDirectory()) output.push(...await listFiles(root, absolute));
    else if (info.isFile()) output.push(absolute);
  }
  return output.sort();
}

export async function verifyMainCore({ sourceRoot = null, coreRoot, writeManifest = false } = {}) {
  const root = resolve(coreRoot);
  const files = await listFiles(join(root, "control"));
  const entries = [];
  for (const absolute of files) {
    const bytes = await readFile(absolute);
    entries.push({ path: relative(root, absolute).split("\\").join("/"), size: bytes.length, sha256: sha256(bytes) });
  }
  let existing = null;
  try { existing = JSON.parse(await readFile(join(root, "source-manifest.json"), "utf8")); } catch (error) {
    if (!writeManifest) throw error;
  }
  if (existing && JSON.stringify(existing.entries) !== JSON.stringify(entries)) throw new Error("MAIN_CORE_MANIFEST_MISMATCH");
  if (sourceRoot !== null) {
    const requested = resolve(sourceRoot);
    const repositoryRoot = basename(requested) === "control" ? resolve(requested, "..") : requested;
    const sourceTree = spawnSync("git", ["-C", repositoryRoot, "rev-parse", `${existing.source_commit}^{tree}`], { encoding: "utf8" });
    if (sourceTree.status !== 0 || sourceTree.stdout.trim() !== existing.source_tree) throw new Error("MAIN_CORE_SOURCE_GIT_IDENTITY_MISMATCH");
    const listed = spawnSync("git", ["-C", repositoryRoot, "ls-tree", "-r", "--name-only", existing.source_commit, "--", "control"], { encoding: "utf8" });
    if (listed.status !== 0) throw new Error("MAIN_CORE_SOURCE_GIT_IDENTITY_MISMATCH");
    const sourcePaths = listed.stdout.trim().split("\n").filter(Boolean).sort();
    if (JSON.stringify(sourcePaths) !== JSON.stringify(entries.map((entry) => entry.path))) throw new Error("MAIN_CORE_SOURCE_PATHS_MISMATCH");
    for (const entry of entries) {
      const object = spawnSync("git", ["-C", repositoryRoot, "show", `${existing.source_commit}:${entry.path}`], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
      if (object.status !== 0 || object.stdout.length !== entry.size || sha256(object.stdout) !== entry.sha256) throw new Error(`MAIN_CORE_SOURCE_BYTES_MISMATCH:${entry.path}`);
    }
  }
  if (writeManifest) throw new Error("WRITE_MANIFEST_REMOVED_USE_REBIND_MAIN_CORE");
  return { entry_count: entries.length, source_commit: existing.source_commit, source_tree: existing.source_tree, candidate_commit: existing.candidate_commit, candidate_tree: existing.candidate_tree };
}

if (process.argv[1]?.endsWith("verify-main-core.mjs") && process.argv[2]) {
  const [sourceRoot, coreRoot] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyMainCore({ sourceRoot, coreRoot }), null, 2));
}
