import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { canonicalBytes } from "./canonical.mjs";
import { MemoryError, invariant } from "./errors.mjs";
import { assertPortablePath, assertPublicExportManifestShape, exportEntry } from "./export-manifest.mjs";
import { fsyncDir } from "./io.mjs";

async function assertPrivateDirectory(path, label) {
  const info = await lstat(path);
  invariant(info.isDirectory() && !info.isSymbolicLink(), "INVALID_EXPORT_BUNDLE_DIRECTORY",
    `${label} must be a real directory`);
  invariant((info.mode & 0o077) === 0, "INSECURE_EXPORT_BUNDLE", `${label} must be private`);
}

async function assertPrivateFile(path, label) {
  const info = await lstat(path);
  invariant(info.isFile() && !info.isSymbolicLink(), "INVALID_EXPORT_BUNDLE_FILE",
    `${label} must be a real regular file`);
  invariant((info.mode & 0o077) === 0, "INSECURE_EXPORT_BUNDLE", `${label} must be private`);
}

async function readPrivateFile(path, label) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    invariant(info.isFile() && (info.mode & 0o077) === 0, "INSECURE_EXPORT_BUNDLE", `${label} must be a private file`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function ensurePrivateSubdirectories(root, parts) {
  let current = root;
  for (const part of parts) {
    const parent = current;
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); await fsyncDir(parent); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    await assertPrivateDirectory(current, `export bundle directory ${part}`);
  }
}

async function createOnlyFile(root, path, bytes) {
  const parts = path.split("/");
  await ensurePrivateSubdirectories(root, parts.slice(0, -1));
  const absolute = join(root, ...parts);
  const handle = await open(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fsyncDir(dirname(absolute));
}

function assertDisjointRoots(sourceRoot, targetRoot) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  const targetFromSource = relative(source, target);
  const sourceFromTarget = relative(target, source);
  invariant(targetFromSource.startsWith("..") && sourceFromTarget.startsWith(".."),
    "EXPORT_BUNDLE_ROOT_OVERLAP", "export bundle and source project roots must be disjoint");
}

async function listFiles(root, current = "") {
  const directory = current === "" ? root : join(root, ...current.split("/"));
  await assertPrivateDirectory(directory, current === "" ? "export bundle root" : `export bundle ${current}`);
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = current === "" ? name : `${current}/${name}`;
    assertPortablePath(path);
    const absolute = join(root, ...path.split("/"));
    const info = await lstat(absolute);
    invariant(!info.isSymbolicLink(), "INVALID_EXPORT_BUNDLE_FILE", `export bundle ${path} cannot be a symbolic link`);
    if (info.isDirectory()) files.push(...await listFiles(root, path));
    else {
      await assertPrivateFile(absolute, `export bundle ${path}`);
      files.push(path);
    }
  }
  return files;
}

export async function materializePublicExportBundle({ source_root: sourceRoot, target_root: targetRoot,
  manifest, fault_after_entries: faultAfterEntries = null }) {
  assertDisjointRoots(sourceRoot, targetRoot);
  assertPublicExportManifestShape(manifest);
  invariant(faultAfterEntries === null || (Number.isSafeInteger(faultAfterEntries) && faultAfterEntries >= 0),
    "INVALID_EXPORT_FAULT_POINT", "fault_after_entries must be null or a non-negative safe integer");
  const parent = dirname(resolve(targetRoot));
  await assertPrivateDirectory(parent, "export bundle parent");
  let created = false;
  try {
    await mkdir(resolve(targetRoot), { mode: 0o700 });
    created = true;
    await fsyncDir(parent);
    const portable = manifest.body.entries.filter(({ disposition }) => disposition === "portable_bytes");
    let published = 0;
    if (faultAfterEntries === 0) throw new MemoryError("INJECTED_EXPORT_FAILURE", "injected export failure");
    for (const entry of portable) {
      const source = join(resolve(sourceRoot), ...entry.path.split("/"));
      await assertPrivateFile(source, `export source ${entry.path}`);
      await createOnlyFile(resolve(targetRoot), `files/${entry.path}`,
        await readPrivateFile(source, `export source ${entry.path}`));
      published += 1;
      if (faultAfterEntries === published) throw new MemoryError("INJECTED_EXPORT_FAILURE", "injected export failure");
    }
    await createOnlyFile(resolve(targetRoot), "manifest.json", canonicalBytes(manifest));
    await fsyncDir(resolve(targetRoot));
    return { target_root: resolve(targetRoot), portable_entry_count: portable.length };
  } catch (error) {
    if (created) { await rm(resolve(targetRoot), { recursive: true, force: true }); await fsyncDir(parent); }
    throw error;
  }
}

export async function verifyPublicExportBundle({ target_root: targetRoot, manifest }) {
  const root = resolve(targetRoot);
  await assertPrivateDirectory(root, "export bundle root");
  await assertPrivateFile(join(root, "manifest.json"), "export bundle manifest");
  invariant((await readPrivateFile(join(root, "manifest.json"), "export bundle manifest")).equals(canonicalBytes(manifest)),
    "EXPORT_BUNDLE_MANIFEST_MISMATCH", "bundle manifest bytes are missing, changed, or noncanonical");
  const portable = manifest.body.entries.filter(({ disposition }) => disposition === "portable_bytes");
  const expected = ["manifest.json", ...portable.map(({ path }) => `files/${path}`)].sort();
  invariant((await listFiles(root)).sort().join("\n") === expected.join("\n"), "EXPORT_BUNDLE_CONTENT_MISMATCH",
    "export bundle contains missing, extra, or substituted files");
  for (const entry of portable) {
    const bytes = await readPrivateFile(join(root, "files", ...entry.path.split("/")), `export bundle ${entry.path}`);
    invariant(bytes.length === entry.size, "EXPORT_BUNDLE_CONTENT_MISMATCH", `bundle size mismatch for ${entry.path}`);
    invariant(exportEntry({ project_id: manifest.body.project_id, path: entry.path, bytes,
      disposition: "portable_bytes" }).byte_digest === entry.byte_digest,
    "EXPORT_BUNDLE_CONTENT_MISMATCH", `bundle digest mismatch for ${entry.path}`);
  }
  return { ok: true, portable_entry_count: portable.length };
}
