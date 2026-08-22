#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileGovernedRosterProjection,
  GOVERNED_ROSTER_PREREQUISITES,
  validateGovernedRosterProjection,
} from "../control/governed-roster-projection.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const sha = (value) => canonicalDigest({value});
const git = (digit) => String(digit).repeat(40);
const candidate = {
  commit: git("1"),
  tree: git("2"),
  rollback: {commit: git("3"), tree: git("4")},
};
const sourceRoster = {
  status: "PASS",
  roster_sha256: sha("roster"),
  entry_count: 128,
  package_count: 97,
  model_policy_snapshot_sha256: sha("policy"),
};
const prerequisites = GOVERNED_ROSTER_PREREQUISITES.map((prerequisite_id) => ({
  prerequisite_id,
  status: "PASS",
  owner_role: "Spawner/root",
  code: "PROTECTED_PREREQUISITE_PASS",
  action: "Preserve the exact protected prerequisite binding.",
}));

function candidateRecord(overrides = {}) {
  return {
    stable_agent_id: "AGENT.PLATFORM.TEST",
    candidate: structuredClone(candidate),
    provenance: {source_ref: "ref:agentos-candidate/test", source_sha256: sha("provenance")},
    model_binding: {
      status: "PASS",
      model_id: "gpt-5.6-luna",
      reasoning_effort: "max",
      fresh: true,
      policy_snapshot_sha256: sourceRoster.model_policy_snapshot_sha256,
      host_attestation_sha256: sha("host"),
      evaluation_receipt_sha256: sha("model-evaluation"),
    },
    context_binding: {
      status: "PASS",
      model_policy_snapshot_sha256: sourceRoster.model_policy_snapshot_sha256,
      operational_context_sha256: sha("operational-context"),
      governance_memory_sha256: sha("governance-memory"),
      roster_projection_sha256: sourceRoster.roster_sha256,
    },
    final_review: {
      status: "PASS",
      approved: true,
      receipt_sha256: sha("final-review"),
      reviewer_ref: "ref:final-review/test",
      separately_controlled: true,
    },
    luna_max_review: {
      status: "PASS",
      model_id: "gpt-5.6-luna",
      reasoning_effort: "max",
      fresh: true,
      receipt_sha256: sha("luna-max"),
      reviewer_ref: "ref:luna-max/test",
      separately_controlled: true,
    },
    protected_prerequisites: structuredClone(prerequisites),
    ...overrides,
  };
}

const ready = candidateRecord();
const stale = candidateRecord({candidate: {...candidate, commit: git("5")}});
const readyProjection = compileGovernedRosterProjection({currentCandidate: candidate, sourceRoster, candidates: [ready, stale]});
assert.equal(readyProjection.status, "READY");
assert.equal(readyProjection.ready.length, 1, "one exact ready entry must replace the stale duplicate");
assert.equal(readyProjection.ready[0].candidate.commit, candidate.commit);
assert.equal(readyProjection.ready[0].candidate.tree, candidate.tree);
assert.equal(readyProjection.ready[0].candidate.rollback.commit, candidate.rollback.commit);
assert.equal(readyProjection.ready[0].final_review.receipt_sha256, ready.final_review.receipt_sha256);
assert.equal(readyProjection.ready[0].luna_max_review.receipt_sha256, ready.luna_max_review.receipt_sha256);
assert(readyProjection.blocked_ledger.some((entry) => entry.status === "STALE_DUPLICATE" && entry.reason_code === "STALE_CANDIDATE_SUPERSEDED"));
validateGovernedRosterProjection(readyProjection);

const identicalDuplicate = compileGovernedRosterProjection({currentCandidate: candidate, sourceRoster, candidates: [ready, structuredClone(ready)]});
assert.equal(identicalDuplicate.status, "READY");
assert.equal(identicalDuplicate.ready.length, 1);
assert(identicalDuplicate.blocked_ledger.some((entry) => entry.reason_code === "DUPLICATE_EXACT_SUPERSEDED"));

const divergentExact = candidateRecord({context_binding: {...ready.context_binding, governance_memory_sha256: sha("different-memory")} });
const divergentProjection = compileGovernedRosterProjection({currentCandidate: candidate, sourceRoster, candidates: [ready, divergentExact]});
assert.equal(divergentProjection.status, "UNKNOWN");
assert.equal(divergentProjection.ready.length, 0);
assert(divergentProjection.blocked_ledger.every((entry) => entry.reason_code === "DIVERGENT_EXACT_DUPLICATES"));

const unknownLuna = candidateRecord({luna_max_review: {status: "UNKNOWN", model_id: null, reasoning_effort: null, fresh: false, receipt_sha256: null, reviewer_ref: null, separately_controlled: false}});
const unknownProjection = compileGovernedRosterProjection({currentCandidate: candidate, sourceRoster, candidates: [unknownLuna]});
assert.equal(unknownProjection.status, "UNKNOWN");
assert.equal(unknownProjection.ready.length, 0);
assert.equal(unknownProjection.blocked_ledger[0].reason_code, "LUNA_MAX_FRESH_PASS_REQUIRED");

const blockedPrerequisite = candidateRecord({protected_prerequisites: prerequisites.map((entry, index) => index === 0 ? {...entry, status: "BLOCKED_EXACT", code: "HOST_ATTESTATION_REQUIRED"} : entry)});
const blockedProjection = compileGovernedRosterProjection({currentCandidate: candidate, sourceRoster, candidates: [blockedPrerequisite]});
assert.equal(blockedProjection.status, "BLOCKED_EXACT");
assert.equal(blockedProjection.ready.length, 0);
assert.equal(blockedProjection.blocked_ledger[0].reason_code, "HOST_ATTESTATION_REQUIRED");

const contract = JSON.parse(fs.readFileSync(path.join(root, "schemas/governed-roster-projection.v1.json"), "utf8"));
assert.equal(contract.$id, "agentos.governed_roster_projection.v1");
assert(!JSON.stringify(contract).match(new RegExp(["/", "Users", "/"].join(""), "u")));
assert(!JSON.stringify(contract).match(new RegExp(["/", "home", "/"].join(""), "u")));

console.log("PASS governed roster projection: exact commit/tree/rollback READY binding, Final Review plus fresh Luna-max admission, stale replacement, divergent duplicate denial, UNKNOWN preservation, blocked ledger retention, and portable contract");
