#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = path.join(root, "control/bootstrap-compiler.mjs");

function snapshotTree(directory) {
  const rows = [];
  const walk = (current, relative = "") => {
    const entries = fs.readdirSync(current, {withFileTypes: true}).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        rows.push({path: childRelative, type: "SYMLINK", target: fs.readlinkSync(child)});
      } else if (entry.isDirectory()) {
        rows.push({path: childRelative, type: "DIRECTORY"});
        walk(child, childRelative);
      } else if (entry.isFile()) {
        rows.push({
          path: childRelative,
          type: "FILE",
          sha256: crypto.createHash("sha256").update(fs.readFileSync(child)).digest("hex"),
        });
      } else {
        rows.push({path: childRelative, type: "UNSAFE_OBJECT"});
      }
    }
  };
  walk(directory);
  return JSON.stringify(rows);
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-multirepo-start-"));
try {
  fs.mkdirSync(path.join(fixture, "services", "api", ".git"), {recursive: true});
  fs.mkdirSync(path.join(fixture, "apps", "web"), {recursive: true});
  fs.writeFileSync(path.join(fixture, "apps", "web", ".git"), "gitdir: ../.git/worktrees/web\n");
  fs.writeFileSync(path.join(fixture, "README.md"), "generic multi-repository fixture\n");
  const before = snapshotTree(fixture);

  const result = spawnSync(process.execPath, [controller, "start", fixture, "RECOMMENDED"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "READ_ONLY_DISCOVERY_COMPLETE");
  assert.equal(output.discovery.project_root, fs.realpathSync.native(fixture));
  assert.equal(output.discovery.operations.read_only, true);
  assert.equal(output.discovery.operations.authentication_attempted, false);
  assert.equal(output.discovery.operations.publication_attempted, false);
  assert.equal(output.discovery.operations.deployment_attempted, false);
  assert.equal(output.discovery.operations.deletion_attempted, false);

  const topology = output.discovery.facts.find((entry) => entry.fact_id === "repositories.topology");
  assert.deepEqual({status: topology?.status, value: topology?.value}, {
    status: "OBSERVED_FACT",
    value: "MULTI_REPOSITORY_PROJECT_ROOT",
  });
  assert.equal(output.discovery.facts.find((entry) => entry.fact_id === "repositories.nested.count")?.value, 2);

  const importRow = output.question_plan.coverage.outputs.find((entry) => entry.output_id === "PROJECT_IMPORT");
  assert.equal(importRow?.status, "OWNER_REQUIRED");
  assert.equal(importRow?.blocking, true);
  assert(importRow?.discovery_inputs.some((id) => id.startsWith("repositories.nested.")));
  const preservationRow = output.question_plan.coverage.outputs.find((entry) => entry.output_id === "SOURCE_PRESERVATION");
  assert.equal(preservationRow?.status, "DEPENDENCY_PENDING");
  assert.equal(preservationRow?.blocking, true);
  assert.equal(output.question_plan.next, "project.north_star", "multi-repository import must not displace the first intent question");
  assert.deepEqual(output.question_plan.questions.map((question) => question.id), ["project.north_star"]);
  assert.equal(snapshotTree(fixture), before, "read-only Bootstrap start mutated the source fixture");

  console.log("PASS AgentOS Bootstrap read-only multi-repository start: explicit import/composition gate, source-preservation dependency, outcome-first question ordering, and zero-write proof");
} finally {
  fs.rmSync(fixture, {recursive: true, force: true});
}
