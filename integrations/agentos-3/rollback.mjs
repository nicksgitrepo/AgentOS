import { readFile, rm, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  canonical, listCompanion, projectCompanionRoots, regularFile, sha256, snapshotProject, snapshotsEqual,
  syncDirectory, verifyBundle
} from "./custody.mjs";

export async function rollbackTestBuild({ projectRoot, companionRoot, bundlePath = null, mode = "EXTERNAL_SIBLING" } = {}) {
  if (bundlePath === null) throw new Error("ROLLBACK_MANIFEST_REQUIRED");
  const roots = await projectCompanionRoots(projectRoot, companionRoot, mode, { allowExisting: true });
  await regularFile(`${roots.companionRoot}/install-receipt.json`, "INSTALL_RECEIPT");
  const receiptBytes = await readFile(`${roots.companionRoot}/install-receipt.json`);
  const receipt = JSON.parse(receiptBytes);
  if (!receiptBytes.equals(canonical(receipt)) || receipt.schema !== "agentos.integration.install-receipt.v1" || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(["build_id", "bundle_sha256", "companion_ref", "entries", "manifest_sha256", "project_ref", "project_snapshot", "project_snapshot_sha256", "schema"])) throw new Error("INSTALL_RECEIPT_INVALID");
  const verified = await verifyBundle(bundlePath);
  if (verified.bundleSha256 !== receipt.bundle_sha256 || verified.manifestSha256 !== receipt.manifest_sha256 || receipt.build_id !== verified.bundle.build_id || JSON.stringify(receipt.entries) !== JSON.stringify(verified.manifest.entries)) throw new Error("ROLLBACK_MANIFEST_MISMATCH");
  if (receipt.project_ref !== `ref_${sha256(Buffer.from(roots.projectRoot)).slice(0, 32)}` || receipt.companion_ref !== `ref_${sha256(Buffer.from(roots.companionRoot)).slice(0, 32)}` || receipt.project_snapshot_sha256 !== sha256(canonical(receipt.project_snapshot))) throw new Error("ROLLBACK_RECEIPT_BINDING_INVALID");
  const currentProject = await snapshotProject(roots.projectRoot);
  if (!snapshotsEqual(currentProject, receipt.project_snapshot)) throw new Error("PROJECT_CHANGED_BEFORE_ROLLBACK");
  const actual = await listCompanion(roots.companionRoot);
  const expected = ["install-receipt.json", ...receipt.entries.map((entry) => `payload/${entry.path}`)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("ROLLBACK_FOREIGN_OR_MISSING_FILE");
  for (const entry of receipt.entries) {
    const path = `${roots.companionRoot}/payload/${entry.path}`;
    const bytes = await readFile(path);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error(`ROLLBACK_CHANGED_FILE:${entry.path}`);
  }
  for (const path of expected.filter((item) => item !== "install-receipt.json").sort((a, b) => b.length - a.length)) {
    await rm(`${roots.companionRoot}/${path}`, { force: false, recursive: false });
  }
  await rm(`${roots.companionRoot}/install-receipt.json`, { force: false, recursive: false });
  const directories = new Set(["payload"]);
  for (const entry of receipt.entries) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) directories.add(`payload/${parts.slice(0, index).join("/")}`);
  }
  for (const path of [...directories].sort((left, right) => right.length - left.length)) {
    await rmdir(`${roots.companionRoot}/${path}`);
  }
  await rmdir(roots.companionRoot);
  await syncDirectory(dirname(roots.projectRoot));
  const after = await snapshotProject(roots.projectRoot);
  if (!snapshotsEqual(currentProject, after)) throw new Error("PROJECT_CHANGED_DURING_ROLLBACK");
  return { rollback: "AGENTOS_3_TEST_BUILD_ROLLBACK", released: false, project_unchanged: true };
}
