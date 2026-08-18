#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PERMANENT_ROLE_IDS,
  PERMANENT_ROLE_KINDS,
  admitNextPermanentRole,
  compilePermanentRoleCandidate,
  compilePermanentRoleRoster,
} from "../control/permanent-role-roster.mjs";
import {canonicalPermanentRoleIds} from "../control/permanent-role-registry.mjs";

const expected = [
  "AGENTOS_CONTROLLER",
  "AGENTOS.PRODUCT_OWNER",
  "AGENTOS.MEMORY",
  "AGENTOS.RUNTIME",
  "AGENTOS.SCHEDULER",
  "AGENTOS.ORCHESTRATOR",
];
assert.deepEqual(PERMANENT_ROLE_IDS, expected);
assert.deepEqual(PERMANENT_ROLE_IDS, canonicalPermanentRoleIds());
assert.equal(PERMANENT_ROLE_KINDS["AGENTOS_CONTROLLER"], "CONTROLLER");
assert.equal(PERMANENT_ROLE_KINDS["AGENTOS.PRODUCT_OWNER"], "PRODUCT_OWNER");

const forged = {
  roleId: "AGENTOS_CONTROLLER",
  blockSetSha256: "a".repeat(64),
  independentEvaluationSha256: "b".repeat(64),
  hostileFixtureIds: ["PASS.CALLER.CLAIM"],
  stopConditions: "Caller claims that all stop conditions were tested and passed.",
  globalGovernanceContext: {context_sha256: "c".repeat(64)},
  globalGovernanceAuthorityStore: {},
};
assert.throws(() => compilePermanentRoleCandidate(forged), /Caller-authored.*forbidden/u);
assert.throws(() => compilePermanentRoleCandidate({roleId: "AGENTOS_CONTROLLER"}), /requires canonical package execution.*independent review/u);
assert.throws(() => compilePermanentRoleCandidate({roleId: "AGENTOS.PRODUCT_OWNER"}), /requires canonical package execution.*independent review/u);
assert.throws(() => compilePermanentRoleCandidate({roleId: "AGENTOS.INTENT_REGULATOR"}), /not canonical/u);

assert.throws(() => compilePermanentRoleRoster({spawnerAdmissionSha256: "d".repeat(64), candidates: [], admittedRoleIds: []}), /Caller-authored permanent-role rosters/u);
assert.throws(() => compilePermanentRoleRoster(), /sealed Spawner admission adapter/u);
assert.throws(() => admitNextPermanentRole({next_role_id: "AGENTOS_CONTROLLER"}, "AGENTOS_CONTROLLER", {globalGovernanceContext: {}, globalGovernanceAuthorityStore: {}}), /Caller-authored roster.*forbidden/u);
assert.throws(() => admitNextPermanentRole(undefined, "AGENTOS_CONTROLLER"), /sealed Spawner adapter/u);

console.log("PASS permanent role roster: sealed six-role identity is readable, while caller hashes, PASS claims, contexts, rosters, and direct promotion routes fail closed pending canonical independent admission");
