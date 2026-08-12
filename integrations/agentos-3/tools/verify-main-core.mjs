import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
    const repositoryRoot = resolve(sourceRoot, "..");
    const sourceCommit = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
    const sourceTree = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" });
    if (sourceCommit.status !== 0 || sourceTree.status !== 0 || sourceCommit.stdout.trim() !== existing.source_commit || sourceTree.stdout.trim() !== existing.source_tree) throw new Error("MAIN_CORE_SOURCE_GIT_IDENTITY_MISMATCH");
    const sourceFiles = await listFiles(resolve(sourceRoot));
    const sourceEntries = [];
    for (const absolute of sourceFiles) {
      const bytes = await readFile(absolute);
      sourceEntries.push({ path: relative(resolve(sourceRoot), absolute).split("\\").join("/"), size: bytes.length, sha256: sha256(bytes) });
    }
    if (JSON.stringify(sourceEntries) !== JSON.stringify(entries.map(({ path, size, sha256: digest }) => ({ path: path.replace(/^control\//u, ""), size, sha256: digest })))) {
      throw new Error("MAIN_CORE_SOURCE_BYTES_MISMATCH");
    }
  }
  if (writeManifest) throw new Error("WRITE_MANIFEST_REMOVED_USE_REBIND_MAIN_CORE");
  return { entry_count: entries.length, source_commit: existing.source_commit, source_tree: existing.source_tree, candidate_commit: existing.candidate_commit, candidate_tree: existing.candidate_tree };
}

if (process.argv[1]?.endsWith("verify-main-core.mjs") && process.argv[2]) {
  const [sourceRoot, coreRoot] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyMainCore({ sourceRoot, coreRoot }), null, 2));
}
