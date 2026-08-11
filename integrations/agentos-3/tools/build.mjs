import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
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
for (const absolute of await files()) {
  const bytes = await readFile(absolute);
  const path = relative(ROOT, absolute).split("\\").join("/");
  entries.push({ path, size: bytes.length, sha256: sha256(bytes), bytes_base64: bytes.toString("base64") });
}
const bundle = { schema: "agentos.integration.bundle.v1", build_id: "AGENTOS_3_TEST_BUILD", entries };
const bundleBytes = Buffer.from(canonical(bundle));
const manifest = {
  schema: "agentos.integration.manifest.v1",
  build_id: "AGENTOS_3_TEST_BUILD",
  lifecycle: "CANDIDATE_INACTIVE",
  activation: "OFF",
  source_base: "5f6b68d4a55a0ae6b7a3009a0e659ec256b2ae1e",
  entries: entries.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest })),
  bundle_sha256: sha256(bundleBytes),
  rollback_identity: "AGENTOS_3_TEST_BUILD_ROLLBACK"
};
await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.bundle.json"), bundleBytes);
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.manifest.json"), canonical(manifest));
console.log(`AGENTOS_3_BUILD ${manifest.bundle_sha256} ${entries.length}`);
