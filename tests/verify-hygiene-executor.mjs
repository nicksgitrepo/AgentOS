#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileHygieneDryRun, executeHygiene, validateDeletionManifest, validateHygieneAfterState} from "../control/hygiene-executor.mjs";

const tempParent = "/Users/nicholaspacheco/Projects/AgentOS/Temp";
fs.mkdirSync(tempParent, {recursive: true});
const root = fs.mkdtempSync(path.join(tempParent, "route037-hygiene-"));
try {
  fs.writeFileSync(path.join(root, "disposable.txt"), "disposable\n");
  const manifest = {
    schema: "agentos.cleanup_deletion_manifest.v1",
    version: 1,
    targets: [{path: "disposable.txt", kind: "TEMP", active: false, dirty: false, referenced: false, shared: false}],
    manifest_sha256: null,
  };
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  validateDeletionManifest(manifest);
  const dry = compileHygieneDryRun({manifest, authorityRoot: root});
  const removed = [];
  const execution = executeHygiene({manifest, dryRun: dry, authorityRoot: root, executionAdmitted: true, removeTarget: ({absolutePath, path: relative}) => { fs.rmSync(absolutePath); removed.push(relative); }});
  assert.deepEqual(removed, ["disposable.txt"]);
  assert.equal(fs.existsSync(path.join(root, "disposable.txt")), false);
  validateHygieneAfterState({execution, afterTargets: []});
  assert.throws(() => executeHygiene({manifest, dryRun: dry, authorityRoot: root, executionAdmitted: false, removeTarget: () => {}}), /separate admission/u);
  const broad = {...manifest, targets: [{...manifest.targets[0], path: "**/*"}]};
  broad.manifest_sha256 = canonicalDigest({...broad, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(broad), /globbed/u);
  const active = {...manifest, targets: [{...manifest.targets[0], active: true}]};
  active.manifest_sha256 = canonicalDigest({...active, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(active), /safely removable/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS hygiene executor: digest-bound dry-run, separate execution admission, safe target validation, injected mutation boundary, and hostile refusal");
