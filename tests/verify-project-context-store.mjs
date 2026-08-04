#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/bootstrap-compiler.mjs";
import {readProjectContext, writeProjectContextCompareAndSwap} from "../control/project-context-store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-context-"));
const filePath = path.join(root, "authority", "project-context.json");
try {
  const context = {
    schema: "agentos.project_context_binding.v1",
    version: 1,
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    source_plan_sha256: "a".repeat(64),
    north_star: "Keep the current accepted direction.",
    first_useful_workflow: "Complete one useful workflow.",
  };
  context.exact_context_digest = canonicalDigest(context);
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(context)}\n`);
  const first = readProjectContext(filePath);
  assert.equal(first.exact_context_digest, context.exact_context_digest);
  const next = writeProjectContextCompareAndSwap({
    filePath,
    expectedContextSha256: first.exact_context_digest,
    changes: [{field: "north_star", new_value: "Make the next owner outcome explicit."}],
    amendmentSha256: "b".repeat(64),
  });
  assert.equal(next.context.north_star, "Make the next owner outcome explicit.");
  assert.equal(readProjectContext(filePath).last_context_amendment_sha256, "b".repeat(64));
  assert.throws(() => writeProjectContextCompareAndSwap({
    filePath,
    expectedContextSha256: first.exact_context_digest,
    changes: [{field: "north_star", new_value: "Stale write."}],
    amendmentSha256: "c".repeat(64),
  }), /stale/u);
  const linkPath = path.join(root, "link.json");
  fs.symlinkSync(filePath, linkPath);
  assert.throws(() => readProjectContext(linkPath), /symbolic link/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS AgentOS project-context amendment store (exact digest, CAS, readback, and symlink rejection)");
