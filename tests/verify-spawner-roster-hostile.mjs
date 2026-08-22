#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
  compileReusableAgentRoster,
  rosterCompileIsComplete,
  validateReusableAgentAcceptancePin,
} from "../control/reusable-agent-roster-compiler.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const root = fs.mkdtempSync(path.join(repositoryRoot, ".agentos-roster-hostile-"));
const runGit = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();

try {
  const compiled = compileReusableAgentRoster({repositoryRoot});
  const spawnerEntry = compiled.entries.find((entry) => entry.stable_agent_id === "AGENTOS.SPAWNER");
  assert(spawnerEntry, "Spawner roster entry missing");
  assert.equal(spawnerEntry.deterministic_gates.status, "BOUND", "canonical Spawner gate-entry manifest was not projected");
  assert.equal(spawnerEntry.deterministic_gates.gates.length, 9, "canonical Spawner gate-entry manifest lost a gate");
  const snapshotExpired = Date.parse(compiled.model_policy.expires_at_utc) <= Date.now();
  if (snapshotExpired) {
    assert.equal(compiled.build_queue.some((item) => item.eligible), false, "stale model policy left a roster item eligible");
    assert.match(compiled.build_queue[0]?.reason ?? "", /model-policy snapshot.*fresh/u);
  }
  assert.equal(compiled.entries.some((entry) => ["INCOMPLETE", "MISSING_GATE_MANIFEST"].includes(entry.deterministic_gates?.status)), false, "incomplete gate inventory was projected as a complete roster");
  assert.equal(compiled.entries.some((entry) => entry.hostile_fixtures?.status === "INCOMPLETE"), false, "incomplete hostile-fixture inventory was projected as a complete roster");

  fs.mkdirSync(path.join(root, "specialist-blocks/fixture"), {recursive: true});
  fs.writeFileSync(path.join(root, "specialist-blocks/fixture/block.json"), "{}\n");
  runGit(["init", "-q"]);
  runGit(["config", "user.name", "Spawner hostile fixture"]);
  runGit(["config", "user.email", "fixture@example.invalid"]);
  runGit(["add", "."]);
  runGit(["commit", "-q", "-m", "package baseline"]);
  const baseline = runGit(["rev-parse", "HEAD"]);
  runGit(["branch", "-M", "main"]);
  fs.writeFileSync(path.join(root, "main.txt"), "main\n");
  runGit(["add", "main.txt"]);
  runGit(["commit", "-q", "-m", "current authority"]);
  fs.writeFileSync(path.join(root, "stale.txt"), "stale\n");
  runGit(["checkout", "-q", "-b", "stale", baseline]);
  runGit(["add", "stale.txt"]);
  runGit(["commit", "-q", "-m", "stale continuation"]);
  const staleCommit = runGit(["rev-parse", "HEAD"]);
  const staleTree = runGit(["rev-parse", "HEAD^{tree}"]);
  runGit(["checkout", "-q", "main"]);
  const acceptance = {
    stable_agent_id: "BLOCK.SPAWNER.HOSTILE",
    package_path: "specialist-blocks/fixture",
    candidate_commit: staleCommit,
    candidate_tree: staleTree,
    independent_status: "PASS",
    receipt_ref: `INDEPENDENT_EVALUATOR_HANDOFF/${staleCommit}`,
    receipt_sha256: null,
    readback_scope: "READBACK_SUMMARY_ONLY",
  };
  assert.equal(validateReusableAgentAcceptancePin({repositoryRoot: root, acceptance}), false, "non-ancestor stale acceptance pin was reused");
  const validAcceptance = {...acceptance, candidate_commit: baseline, candidate_tree: runGit(["rev-parse", `${baseline}^{tree}`]), receipt_ref: `INDEPENDENT_EVALUATOR_HANDOFF/${baseline}`};
  assert.equal(validateReusableAgentAcceptancePin({repositoryRoot: root, acceptance: validAcceptance}), true, "current-authority acceptance pin was rejected");

  const partial = structuredClone(compiled.entries);
  partial[0].deterministic_gates.status = "INCOMPLETE";
  assert.equal(rosterCompileIsComplete(partial), false, "partial gate compile remained eligible");
  const missingFixture = structuredClone(compiled.entries);
  missingFixture[0].hostile_fixtures.status = "INCOMPLETE";
  assert.equal(rosterCompileIsComplete(missingFixture), false, "partial hostile-fixture compile remained eligible");
  console.log("PASS hostile roster governance: stale model blocks all eligibility, non-ancestor acceptance pins are rejected, and partial gate/fixture compiles cannot advance");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
