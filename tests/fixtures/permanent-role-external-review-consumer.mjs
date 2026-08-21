#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectCanonicalPermanentRoleCandidate, preparePermanentRoleAdmissionAuthority, resolvePermanentRoleAdmission, resolvePermanentRoleOperationalContext} from "../../control/permanent-role-governed-admission.mjs";
import {verifyTestOnlyProvisionedPermanentRoleReview} from "../../control/permanent-role-external-review-store.mjs";
import {resolveCanonicalPermanentRole} from "../../control/permanent-role-registry.mjs";
import {materializeTestGlobalGovernanceStore} from "../helpers/global-governance-fixture.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-external-review-consumer-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: new Date().toISOString()});
  const authority = preparePermanentRoleAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore});
  const receipt = process.argv[3] === "TEST_ONLY"
    ? verifyTestOnlyProvisionedPermanentRoleReview({receiptRef: process.argv[2], role: resolveCanonicalPermanentRole("AGENTOS.PRODUCT_OWNER"), candidate: inspectCanonicalPermanentRoleCandidate({roleId: "AGENTOS.PRODUCT_OWNER"}), operationalContext: resolvePermanentRoleOperationalContext({authority, expectedRoleId: "AGENTOS.PRODUCT_OWNER"})})
    : resolvePermanentRoleAdmission({authority, receiptRef: process.argv[2], expectedRoleId: "AGENTOS.PRODUCT_OWNER"});
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(`${error.code ?? "ERROR"}:${error.message}\n`); process.exitCode = 2;
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
