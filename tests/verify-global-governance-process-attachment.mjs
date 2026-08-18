#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import {issueGlobalGovernanceProcessAttachment, resolveCanonicalGlobalGovernanceProjection} from "../control/global-governance-bootstrap.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-attachment-"));
const alternate = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-attachment-alternate-"));
const fixture = materializeTestGlobalGovernanceStore({authorityRoot: root});
const moduleUrl = new URL("../control/global-governance-bootstrap.mjs", import.meta.url).href;
const sealedUrl = new URL("../control/sealed-canonical-authority.mjs", import.meta.url).href;
const childSource = `const a=JSON.parse(Buffer.from(process.env.ATTACHMENT,'base64').toString()); const g=await import(${JSON.stringify(moduleUrl)}); const s=await import(${JSON.stringify(sealedUrl)}); const store=g.reattachGlobalGovernanceAuthorityStore({sealedAuthority:s.getSealedCanonicalAuthority(),attachment:a,secretBase64:process.env.SECRET,expectedConsumerRole:'SESSION'}); console.log(g.inspectGlobalGovernanceAuthorityStore(store).bootstrap_sha256);`;
function run(issued, {attachment = issued.attachment, secret = issued.secret_base64, cwd = alternate} = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {cwd, encoding: "utf8", env: {...process.env, ATTACHMENT: Buffer.from(JSON.stringify(attachment)).toString("base64"), SECRET: secret}});
}

const valid = issueGlobalGovernanceProcessAttachment({authorityStore: fixture.authorityStore, consumerRole: "SESSION"});
const accepted = run(valid);
assert.equal(accepted.status, 0, accepted.stderr);
assert.equal(accepted.stdout.trim(), fixture.bootstrap.bootstrap_sha256);
const replay = run(valid);
assert.notEqual(replay.status, 0);
assert.match(replay.stderr, /already consumed|unknown/iu);

const tampered = issueGlobalGovernanceProcessAttachment({authorityStore: fixture.authorityStore, consumerRole: "SESSION"});
const changedRoot = structuredClone(tampered.attachment); changedRoot.authority_root = alternate;
const substitution = run(tampered, {attachment: changedRoot});
assert.notEqual(substitution.status, 0); assert.match(substitution.stderr, /MAC differs/iu);

const forged = issueGlobalGovernanceProcessAttachment({authorityStore: fixture.authorityStore, consumerRole: "SESSION"});
const copied = run(forged, {secret: randomBytes(32).toString("base64")});
assert.notEqual(copied.status, 0); assert.match(copied.stderr, /MAC differs/iu);

const clonedCapability = structuredClone(fixture.authorityStore);
assert.throws(() => resolveCanonicalGlobalGovernanceProjection({authorityStore: clonedCapability, roleClass: "SPAWNER"}), /sealed global-governance authority capability/iu);
fs.rmSync(root, {recursive: true, force: true}); fs.rmSync(alternate, {recursive: true, force: true});
console.log("PASS global-governance process attachment: parent-bound MAC, alternate-cwd reattachment, one-use durable replay denial, cross-root substitution denial, and opaque capability non-clonability");
