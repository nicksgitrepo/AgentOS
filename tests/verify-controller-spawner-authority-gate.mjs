#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import {
  CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA,
  CONTROLLER_SPAWNER_FORBIDDEN_MUTATIONS,
  CONTROLLER_SPAWNER_HOSTILE_FIXTURE_REFS,
  compileControllerSpawnerAuthorityGate,
  validateControllerSpawnerAuthorityGate,
} from "../control/controller-spawner-authority-gate.mjs";

const digest = (value) => canonicalDigest({value});
const authority = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  receipt_ref: "ref:control-plane/authority/controller-spawner",
  receipt_sha256: digest("authority"),
};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.CONTROLLER_SPAWNER.CUSTODY", reference: "ref:evidence/controller-custody", sha256: digest("custody")},
  {evidence_id: "EVIDENCE.CONTROLLER_SPAWNER.SPAWNER_ROLE", reference: "ref:evidence/spawner-role", sha256: digest("spawner-role")},
].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
const mutations = Object.fromEntries(CONTROLLER_SPAWNER_FORBIDDEN_MUTATIONS.map((key) => [key, false]));
const typedReadback = {readback_sha256: null, same_turn_successor: true, true_stop_gate: false};
typedReadback.readback_sha256 = canonicalDigest({...typedReadback, readback_sha256: null});

const gate = compileControllerSpawnerAuthorityGate({
  gateId: "GATE.CONTROLLER.SPAWNER.AUTHORITY.001",
  authorityBinding: authority,
  actionId: "ROUTE_TYPED_DEFECT",
  targetRole: "AGENT_SPAWNER",
  requestedMutations: mutations,
  readbackSha256: typedReadback.readback_sha256,
  sameTurnSuccessor: true,
  trueStopGate: false,
  evidenceRefs,
  nextHandler: "HANDLER.AGENTOS.SPAWNER.DEFECT.COMPILER",
});
validateControllerSpawnerAuthorityGate(gate, {expectedAuthorityBinding: authority});
assert.equal(gate.schema, CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA);
assert.deepEqual(gate.hostile_fixture_refs, CONTROLLER_SPAWNER_HOSTILE_FIXTURE_REFS);

const rejects = (candidate, pattern) => {
  candidate.gate_sha256 = canonicalDigest({...candidate, gate_sha256: null});
  assert.throws(() => validateControllerSpawnerAuthorityGate(candidate), pattern);
};

const directRosterMutation = structuredClone(gate);
directRosterMutation.action.requested_mutations.mutate_roster = true;
rejects(directRosterMutation, /cannot mutate roster/u);

const directSpawn = structuredClone(gate);
directSpawn.action.requested_mutations.spawn_agent_or_seed = true;
rejects(directSpawn, /cannot spawn agent or seed/u);

const directArchive = structuredClone(gate);
directArchive.action.requested_mutations.archive_ordinary_agent = true;
rejects(directArchive, /cannot archive ordinary agent/u);

const missingReadback = structuredClone(gate);
missingReadback.action.typed_readback.readback_sha256 = null;
rejects(missingReadback, /must be a lowercase SHA-256/u);

const missingSuccessor = structuredClone(gate);
missingSuccessor.action.typed_readback.same_turn_successor = false;
missingSuccessor.action.typed_readback.true_stop_gate = false;
rejects(missingSuccessor, /same-turn successor or true stop/u);

const readbackDigestDrift = structuredClone(gate);
readbackDigestDrift.action.typed_readback.readback_sha256 = digest("forged-readback");
rejects(readbackDigestDrift, /typed readback digest mismatch/u);

const handlerDrift = structuredClone(gate);
handlerDrift.next_handler = "HANDLER.TAMPERED";
rejects(handlerDrift, /handler is stale/u);

const targetRoleDrift = structuredClone(gate);
targetRoleDrift.action.target_role = "CONTROLLER_GOVERNANCE";
rejects(targetRoleDrift, /target role is stale/u);

const forbiddenAction = structuredClone(gate);
forbiddenAction.action.action_id = "CONSTRUCT_AGENT";
rejects(forbiddenAction, /outside the custody-only allowlist/u);

const fixtureCoverage = structuredClone(gate);
fixtureCoverage.hostile_fixture_refs = fixtureCoverage.hostile_fixture_refs.slice(1);
rejects(fixtureCoverage, /coverage is incomplete/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/controller-spawner-authority-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA);
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.spawner_sole_authority.const, true);
assert.deepEqual(Object.keys(schema.$defs.mutations.properties).sort(compareUtf8), [...CONTROLLER_SPAWNER_FORBIDDEN_MUTATIONS].sort(compareUtf8));

console.log("PASS Controller/Spawner authority gate: custody-only Controller allowlist, Spawner sole authority, typed readback/successor requirement, forbidden ordinary-agent/roster mutations, and hostile coverage");
