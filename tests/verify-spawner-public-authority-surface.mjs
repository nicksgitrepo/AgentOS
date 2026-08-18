#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as agentos from "../control/agentos.mjs";
import {compileExactSpawnerAdmission, compileInertSeed, prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation, resolveCanonicalSpawnerBootstrapPackage, transitionInertSeed} from "../control/spawner-bootstrap-governance.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "../control/global-governance-bootstrap.mjs";
import {verifyIndependentSpawnerClearance} from "../control/independent-spawner-clearance.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

for (const forbidden of [
  "compileExactSpawnerAdmission", "compileInertSeed", "transitionInertSeed", "resolveCanonicalGlobalGovernanceProjection",
  "compileOperationalGlobalGovernanceContext", "compileAllOperationalGlobalGovernanceContexts", "appendAuthorizedGlobalGovernanceMemoryEvent",
  "compileGlobalGovernanceMemoryEvent", "compileGlobalGovernanceMemoryReadback", "readGlobalGovernanceMemory", "replayGlobalGovernanceMemory", "validateGlobalGovernanceMemoryReadback", "globalGovernanceMemory",
  "compileAgentSpawnerGovernedAdmission", "spawnerBootstrapGovernance", "independentSpawnerClearance", "globalGovernanceBootstrap", "globalGovernanceOperationalContext",
  "ecoModelPolicy",
]) assert.equal(Object.hasOwn(agentos, forbidden), false, `public facade exposes authority-bearing surface: ${forbidden}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-public-hostile-surface-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot: root});
  const packageResolution = prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation();
  assert.equal(packageResolution.hostile_evaluation.status, "PASS");
  assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /separately provisioned reviewer|external review/iu);
  assert.throws(() => resolveCanonicalSpawnerBootstrapPackage({authorityRoot: root}), /Caller-supplied package roots/iu);
  assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.PUBLIC.ROOT.SUBSTITUTION", authorityRoot: root, globalGovernanceAuthorityStore: governance.authorityStore}), /Caller-supplied package roots|authority objects/iu);
  assert.throws(() => resolveCanonicalGlobalGovernanceProjection({authorityRoot: root, bootstrapSha256: governance.bootstrap.bootstrap_sha256, roleClass: "SPAWNER"}), /Caller-supplied global governance roots/iu);
  assert.throws(() => verifyIndependentSpawnerClearance({receiptSha256: "a".repeat(64), authorityRoot: root, registry: {}, anchor: {}, expectedCandidate: {}, usedReceipts: [], nowUtc: "2026-08-18T16:30:00.000Z"}), /Caller-supplied clearance authority/iu);
  assert.throws(() => compileInertSeed({admission: {status: "PASS"}}), /Direct seed compilation/iu);
  assert.throws(() => transitionInertSeed({seed_sha256: "a".repeat(64)}, {transition: "CLONE_TO_WORKER"}), /Direct seed transition/iu);
  const serializedCapability = JSON.parse(JSON.stringify(governance.authorityStore));
  assert.throws(() => resolveCanonicalGlobalGovernanceProjection({authorityStore: serializedCapability, roleClass: "SPAWNER"}), /sealed global-governance authority capability/iu);
  assert.equal(fs.realpathSync.native(path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")), fs.realpathSync.native(process.cwd()));
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS Spawner public authority surface: promotion roots, registries, anchors, projections, PASS claims, raw seeds, and serialized capabilities are unavailable or fail closed");
