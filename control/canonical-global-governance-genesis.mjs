#!/usr/bin/env node

/*
 * Earliest Bootstrap-only global-governance genesis. The installed store path
 * is derived from sealed repository authority and is never caller supplied.
 */

import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson} from "./content-addressing.mjs";
import {compileGlobalGovernanceBootstrap, openGlobalGovernanceAuthorityStore, resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";
import {GLOBAL_GOVERNANCE_MEMORY_GENESIS, compileGlobalGovernanceMemoryEvent, compileGlobalGovernanceMemoryReadback} from "./global-governance-memory.mjs";
import {prepareInstalledGlobalGovernanceProvisioning} from "./installed-global-governance-provisioning.mjs";
import {assertSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityIdentity, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

const GENESIS_SCHEMA = "agentos.canonical_global_governance_genesis.v1";
function fail(message, code = "GLOBAL_GOVERNANCE_GENESIS_INVALID") { const error = new Error(message); error.code = code; throw error; }
function atomicJson(file, value) {
  const stage = `${file}.${process.pid}.stage`;
  fs.writeFileSync(stage, `${canonicalJson(value)}\n`, {mode: 0o600});
  const descriptor = fs.openSync(stage, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(stage, file);
}
function canonicalStoreRoot(sealedAuthority, snapshotSha256) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  const gitCommon = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  const realCommon = fs.realpathSync.native(gitCommon);
  const root = path.join(realCommon, "agentos-global-governance", snapshotSha256);
  fs.mkdirSync(path.join(root, "global-governance"), {recursive: true, mode: 0o700});
  const realRoot = fs.realpathSync.native(root);
  if (realRoot !== root || fs.lstatSync(root).isSymbolicLink()) fail("Canonical global-governance store root is unsafe");
  return root;
}

export function prepareCanonicalGlobalGovernanceGenesis(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) || JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(["sealedAuthority"])) fail("Canonical global-governance genesis accepts only sealed authority", "GLOBAL_GOVERNANCE_GENESIS_CALLER_AUTHORITY_FORBIDDEN");
  const {sealedAuthority} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  const prepared = structuredClone(readSealedAuthorityBinding(sealedAuthority, "initial_model_policy_snapshot_fixture").value);
  if (prepared.status !== "PREPARED_INACTIVE") fail("Canonical model-policy genesis is not prepared and inactive");
  prepared.status = "ACCEPTED_ACTIVE";
  prepared.snapshot_sha256 = canonicalDigest({...prepared, snapshot_sha256: null});
  const authority = sealedAuthorityIdentity(sealedAuthority);
  const storeRoot = canonicalStoreRoot(sealedAuthority, prepared.snapshot_sha256);
  const ledgerPath = path.join(storeRoot, "global-governance/model-policy-events.jsonl");
  let events;
  if (fs.existsSync(ledgerPath)) {
    const text = fs.readFileSync(ledgerPath, "utf8");
    events = text.trimEnd().split("\n").filter(Boolean).map(JSON.parse);
    if (events.length !== 1 || events[0].snapshot?.snapshot_sha256 !== prepared.snapshot_sha256 || events[0].writer_role !== "BOOTSTRAP_GENESIS") fail("Installed global-governance genesis differs from sealed authority", "GLOBAL_GOVERNANCE_GENESIS_DRIFT");
  } else {
    const observedAtUtc = new Date().toISOString();
    events = [compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "BOOTSTRAP_GENESIS", snapshot: prepared, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc})];
    fs.writeFileSync(ledgerPath, `${canonicalJson(events[0])}\n`, {mode: 0o600, flag: "wx"});
    const descriptor = fs.openSync(ledgerPath, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  const observedAtUtc = new Date().toISOString();
  const activationReceiptSha256 = canonicalDigest({schema: GENESIS_SCHEMA, authority_sha256: authority.authority_sha256, snapshot_sha256: prepared.snapshot_sha256, event_sha256: events[0].event_sha256});
  const readback = compileGlobalGovernanceMemoryReadback({events, historicalActivationReceiptSha256: activationReceiptSha256, observedAtUtc});
  const bootstrap = compileGlobalGovernanceBootstrap({events, readback, observedAtUtc});
  atomicJson(path.join(storeRoot, "global-governance/current-readback.v1.json"), readback);
  atomicJson(path.join(storeRoot, "global-governance/current-bootstrap.v1.json"), bootstrap);
  const provisioning = prepareInstalledGlobalGovernanceProvisioning({sealedAuthority, installedStoreRoot: storeRoot, bootstrapSha256: bootstrap.bootstrap_sha256});
  const authorityStore = openGlobalGovernanceAuthorityStore({sealedAuthority, storeProvisioning: provisioning});
  const projection = resolveCanonicalGlobalGovernanceProjection({authorityStore, roleClass: "SPAWNER"});
  return Object.freeze({schema: GENESIS_SCHEMA, status: "ACCEPTED_ACTIVE", authorityStore, snapshot_sha256: prepared.snapshot_sha256, event_sha256: events[0].event_sha256, activation_receipt_sha256: activationReceiptSha256, readback_sha256: readback.readback_sha256, bootstrap_sha256: bootstrap.bootstrap_sha256, spawner_projection_sha256: projection.projection.projection_sha256, ledger_head_sha256: projection.ledger_head_sha256});
}
