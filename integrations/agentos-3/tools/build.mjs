import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = resolve(ROOT, "../..");
const DIST = join(ROOT, "dist");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function files(current = ROOT) {
  const names = (await readdir(current)).sort();
  const result = [];
  for (const name of names) {
    if (name === "dist") continue;
    const absolute = join(current, name);
    const info = await stat(absolute);
    if (info.isDirectory()) result.push(...await files(absolute));
    else if (info.isFile()) result.push(absolute);
  }
  return result.sort();
}

const entries = [];
for (const source of [
  {root: ROOT, prefix: ""},
  {root: join(REPOSITORY_ROOT, "schemas"), prefix: "schemas"},
  {root: join(REPOSITORY_ROOT, "specialist-blocks"), prefix: "specialist-blocks"},
]) for (const absolute of await files(source.root)) {
  const bytes = await readFile(absolute);
  const path = join(source.prefix, relative(source.root, absolute)).split("\\").join("/");
  entries.push({ path, size: bytes.length, sha256: sha256(bytes), bytes_base64: bytes.toString("base64") });
}
entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const bundle = { schema: "agentos.integration.bundle.v1", build_id: "AGENTOS_3_TEST_BUILD", entries };
const bundleBytes = Buffer.from(canonical(bundle));
const manifest = {
  schema: "agentos.integration.manifest.v1",
  build_id: "AGENTOS_3_TEST_BUILD",
  lifecycle: "CANDIDATE_INACTIVE",
  activation: "OFF",
  source_base: JSON.parse(await readFile(join(ROOT, "main-core", "source-manifest.json"), "utf8")).candidate_commit,
  includes: ["current-main-core", "memory-m2", "agent-builder", "specialist-block-library", "root-schemas"],
  entries: entries.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest })),
  bundle_sha256: sha256(bundleBytes),
  rollback_identity: "AGENTOS_3_TEST_BUILD_ROLLBACK"
};
await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.bundle.json"), bundleBytes);
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.manifest.json"), canonical(manifest));
console.log(`AGENTOS_3_BUILD ${manifest.bundle_sha256} ${entries.length}`);
