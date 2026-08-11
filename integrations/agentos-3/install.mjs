import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function safePath(root, relativePath) {
  const target = resolve(root, relativePath);
  if (!(target === resolve(root) || target.startsWith(`${resolve(root)}${sep}`))) throw new Error("INSTALL_PATH_ESCAPE");
  if (relativePath.startsWith("/") || relativePath.includes("..")) throw new Error("INSTALL_PATH_INVALID");
  return target;
}

export async function installBundle(bundlePath, targetRoot) {
  const bundle = JSON.parse(await readFile(resolve(bundlePath), "utf8"));
  if (bundle.schema !== "agentos.integration.bundle.v1") throw new Error("BUNDLE_SCHEMA_INVALID");
  for (const entry of bundle.entries) {
    const path = safePath(targetRoot, entry.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.from(entry.bytes_base64, "base64"), { flag: "wx", mode: 0o600 });
  }
  return { target_root: resolve(targetRoot), file_count: bundle.entries.length, activation: "OFF" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , bundlePath, targetRoot] = process.argv;
  if (!bundlePath || !targetRoot) throw new Error("USAGE install.mjs BUNDLE TARGET");
  await installBundle(bundlePath, targetRoot);
}
