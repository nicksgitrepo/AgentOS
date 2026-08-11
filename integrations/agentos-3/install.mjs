import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonical, makePrivateDirectory, projectCompanionRoots, sha256, snapshotProject, snapshotsEqual,
  syncDirectory, verifyBundle, writeCreateOnly, writeOwnedEntry
} from "./custody.mjs";

export async function installBundle(bundlePath, { projectRoot, companionRoot, mode = "EXTERNAL_SIBLING" } = {}) {
  const roots = await projectCompanionRoots(projectRoot, companionRoot, mode);
  const verified = await verifyBundle(bundlePath);
  const before = await snapshotProject(roots.projectRoot);
  const stage = `${roots.companionRoot}.stage-${randomBytes(12).toString("hex")}`;
  let stageOwned = false;
  try {
    await makePrivateDirectory(stage);
    stageOwned = true;
    await mkdir(join(stage, "payload"), { mode: 0o700 });
    for (const entry of verified.bundle.entries) await writeOwnedEntry(stage, entry);
    const receipt = {
      schema: "agentos.integration.install-receipt.v1",
      build_id: verified.bundle.build_id,
      bundle_sha256: verified.bundleSha256,
      manifest_sha256: verified.manifestSha256,
      project_ref: `ref_${sha256(Buffer.from(roots.projectRoot)).slice(0, 32)}`,
      companion_ref: `ref_${sha256(Buffer.from(roots.companionRoot)).slice(0, 32)}`,
      project_snapshot: before,
      project_snapshot_sha256: sha256(canonical(before)),
      entries: verified.manifest.entries
    };
    await writeCreateOnly(join(stage, "install-receipt.json"), canonical(receipt));
    const prePublish = await snapshotProject(roots.projectRoot);
    if (!snapshotsEqual(before, prePublish)) throw new Error("PROJECT_CHANGED_DURING_STAGE");
    await syncDirectory(stage);
    await rename(stage, roots.companionRoot);
    stageOwned = false;
    await syncDirectory(dirname(roots.companionRoot));
    const after = await snapshotProject(roots.projectRoot);
    if (!snapshotsEqual(before, after)) {
      throw new Error("PROJECT_CHANGED_AFTER_PUBLISH");
    }
    return { ...receipt, companion_root: roots.companionRoot, activation: "OFF" };
  } catch (error) {
    if (stageOwned) await rm(stage, { recursive: true, force: true });
    // A published companion remains intact for an accountable rollback if a
    // concurrent project change is observed after the atomic rename.
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , bundlePath, projectRoot, companionRoot] = process.argv;
  if (!bundlePath || !projectRoot || !companionRoot) throw new Error("USAGE install.mjs BUNDLE PROJECT_ROOT COMPANION_ROOT");
  console.log(JSON.stringify(await installBundle(bundlePath, { projectRoot, companionRoot }), null, 2));
}
