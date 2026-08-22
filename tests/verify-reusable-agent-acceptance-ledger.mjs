#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileReusableAgentRoster, validateReusableAgentAcceptancePin} from "../control/reusable-agent-roster-compiler.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const ledgerPath = path.join(root, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
const schemaPath = path.join(root, "schemas/reusable-agent-acceptance-ledger.v1.json");
const registryPath = path.join(root, "specialist-blocks/registry/agent-roster.v1.json");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const roster = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const runGit = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
const runtimeRoster = compileReusableAgentRoster({repositoryRoot: root, writeGenerated: false});
const modelPolicyFresh = Date.parse(runtimeRoster.model_policy.expires_at_utc) > Date.now();

assert.equal(schema.$id, "https://agentos.dev/schemas/reusable-agent-acceptance-ledger.v1.json");
assert.equal(ledger.schema, "agentos.reusable_agent_acceptance_ledger.v1");
assert.equal(ledger.status, "READ_ONLY_INDEPENDENT_EVALUATION_INDEX");
assert.equal(ledger.project_agnostic, true);
assert.deepEqual(ledger.provenance, {
  evaluator_identity: "AGENTOS.INDEPENDENT_EVALUATOR",
  source_kind: "TYPED_INDEPENDENT_HANDOFF_READBACK",
  activation_allowed: false,
  spawn_authority: "SEALED_SPAWNER_ONLY",
});
assert.equal(ledger.ledger_sha256, canonicalDigest({...ledger, ledger_sha256: null}));
assert(Array.isArray(ledger.entries) && ledger.entries.length > 0);
const ids = ledger.entries.map((entry) => entry.stable_agent_id);
assert.deepEqual(ids, [...ids].sort(), "acceptance entries must be sorted by stable identity");
assert.equal(new Set(ids).size, ids.length, "acceptance entries must have unique stable identities");

for (const entry of ledger.entries) {
  assert.equal(entry.independent_status, "PASS");
  assert.match(entry.candidate_commit, /^[0-9a-f]{40}$/u);
  assert.match(entry.candidate_tree, /^[0-9a-f]{40}$/u);
  assert.match(entry.receipt_ref, /^INDEPENDENT_EVALUATOR_HANDOFF\/[0-9a-f]{40}$/u);
  assert(!path.isAbsolute(entry.package_path) && !entry.package_path.split("/").includes(".."));
  const packageBlockPath = path.join(root, entry.package_path, "block.json");
  assert(fs.existsSync(packageBlockPath), `${entry.stable_agent_id} package is missing`);
  assert.equal(runGit(["rev-parse", `${entry.candidate_commit}^{tree}`]), entry.candidate_tree, `${entry.stable_agent_id} candidate tree mismatch`);
  // A qualified package must remain on the current authority ancestry.  Exact
  // package bytes alone do not authorize reuse after a governance rebind.
  assert.doesNotThrow(() => execFileSync("git", ["diff", "--quiet", entry.candidate_commit, "--", entry.package_path], {cwd: root, stdio: "ignore"}), `${entry.stable_agent_id} package changed since independent review`);
  if (entry.readback_scope === "EXACT_RECEIPT_RETAINED") assert.match(entry.receipt_sha256, /^[0-9a-f]{64}$/u);
  if (entry.readback_scope === "READBACK_SUMMARY_ONLY") assert.equal(entry.receipt_sha256, null);
  const rosterEntry = roster.entries.find((candidate) => candidate.stable_agent_id === entry.stable_agent_id);
  assert(rosterEntry, `${entry.stable_agent_id} missing from roster`);
  assert.equal(rosterEntry.package_path, entry.package_path);
  const currentAuthorityPin = validateReusableAgentAcceptancePin({repositoryRoot: root, acceptance: entry});
  const shouldReuse = entry.stable_agent_id === "AGENTOS.SPAWNER" || (modelPolicyFresh && currentAuthorityPin);
  assert.equal(String(rosterEntry.build_state).startsWith("ACCEPTED_"), shouldReuse, `${entry.stable_agent_id} acceptance was reused outside current policy/authority`);
}

assert.equal(ledger.provenance.activation_allowed, false);
assert.equal(ledger.provenance.spawn_authority, "SEALED_SPAWNER_ONLY");
console.log(`PASS reusable-agent acceptance ledger: ${ledger.entries.length} independent readbacks verified against current package bytes; index remains non-authoritative`);
