import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {listReleaseFiles, verifyReleaseBinding, verifyReleaseSourceIdentity} from "./release-source.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = resolve(ROOT, "../..");
const DIST = join(ROOT, "dist");
const EXCLUDED_INTEGRATION_PREFIXES = Object.freeze(["specialist-blocks/"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

const sourceManifest = JSON.parse(await readFile(join(ROOT, "main-core", "source-manifest.json"), "utf8"));
const releaseSource = verifyReleaseSourceIdentity({repositoryRoot: REPOSITORY_ROOT, sourceCommit: sourceManifest.source_commit, sourceTree: sourceManifest.source_tree});
await verifyReleaseBinding({integrationRoot: ROOT});

const entries = [];
for (const source of [
  {root: ROOT, prefix: ""},
  {root: join(REPOSITORY_ROOT, "schemas"), prefix: "schemas"},
]) for (const absolute of (await listReleaseFiles(source.root)).filter((entry) => !entry.startsWith(`${DIST}/`))) {
  const sourceRelative = relative(source.root, absolute).split("\\").join("/");
  if (source.root === ROOT && EXCLUDED_INTEGRATION_PREFIXES.some((prefix) => sourceRelative.startsWith(prefix))) continue;
  const bytes = await readFile(absolute);
  const path = join(source.prefix, sourceRelative).split("\\").join("/");
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
  source_base: sourceManifest.candidate_commit,
  source_tree: sourceManifest.candidate_tree,
  release_source: releaseSource,
  includes: ["current-main-core", "memory-m2", "agent-builder", "specialist-library-intake-seam", "root-schemas"],
  entries: entries.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest })),
  bundle_sha256: sha256(bundleBytes),
  rollback_identity: "AGENTOS_3_TEST_BUILD_ROLLBACK"
};
await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.bundle.json"), bundleBytes);
await writeFile(join(DIST, "AGENTOS_3_TEST_BUILD.manifest.json"), canonical(manifest));
console.log(`AGENTOS_3_BUILD ${manifest.bundle_sha256} ${entries.length}`);
