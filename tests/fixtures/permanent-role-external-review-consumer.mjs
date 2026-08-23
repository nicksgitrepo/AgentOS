#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {inspectCanonicalPermanentRoleCandidate, preparePermanentRoleAdmissionAuthority, resolvePermanentRoleAdmission, resolvePermanentRoleOperationalContext} from "../../control/permanent-role-governed-admission.mjs";
import {verifyTestOnlyProvisionedPermanentRoleReview} from "../../control/permanent-role-external-review-store.mjs";
import {resolveCanonicalPermanentRole} from "../../control/permanent-role-registry.mjs";
import {materializeTestGlobalGovernanceStore} from "../helpers/global-governance-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const rootSegments = repositoryRoot.split(path.sep), worktreesIndex = rootSegments.lastIndexOf("Worktrees");
if (worktreesIndex <= 0) throw new Error("test repository is not in the governed AgentOS Worktrees layout");
const tempParent = path.join(path.sep, ...rootSegments.slice(1, worktreesIndex), "Temp");
const tempParentExisted = fs.existsSync(tempParent); fs.mkdirSync(tempParent, {recursive: true});
const root = fs.mkdtempSync(path.join(tempParent, "external-review-consumer-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: process.env.AGENTOS_TEST_NOW_UTC ?? new Date().toISOString()});
  const authority = preparePermanentRoleAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore});
  const receipt = process.argv[3] === "TEST_ONLY"
    ? verifyTestOnlyProvisionedPermanentRoleReview({receiptRef: process.argv[2], role: resolveCanonicalPermanentRole("AGENTOS.PRODUCT_OWNER"), candidate: inspectCanonicalPermanentRoleCandidate({roleId: "AGENTOS.PRODUCT_OWNER"}), operationalContext: resolvePermanentRoleOperationalContext({authority, expectedRoleId: "AGENTOS.PRODUCT_OWNER"})})
    : resolvePermanentRoleAdmission({authority, receiptRef: process.argv[2], expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(`${error.code ?? "ERROR"}:${error.message}\n`); process.exitCode = 2;
} finally {
  fs.rmSync(root, {recursive: true, force: true});
  if (!tempParentExisted && fs.readdirSync(tempParent).length === 0) fs.rmdirSync(tempParent);
}
