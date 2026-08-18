#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileAllOperationalGlobalGovernanceContexts} from "../control/global-governance-operational-context.mjs";
import {inspectCanonicalPermanentRoleCandidate, preparePermanentRoleAdmissionAuthority, resolvePermanentRoleAdmission} from "../control/permanent-role-governed-admission.mjs";
import {prepareProductOwnerOperationalAuthority} from "../control/product-owner-operational.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const candidate = inspectCanonicalPermanentRoleCandidate({roleId: "AGENTOS.PRODUCT_OWNER"});
assert.equal(candidate.status, "PREPARED_INACTIVE");
assert.equal(candidate.role.role_class, "PRODUCT_OWNER");
assert.equal(candidate.gate_count, 12);
assert.equal(candidate.fixture_count, 17);
assert.equal(candidate.executed_fixture_results_complete, false);
assert.equal(new Set(candidate.gates.map((entry) => entry.gate_id)).size, 12);
assert.equal(new Set(candidate.gates.map((entry) => entry.file_sha256)).size, 12);
assert.equal(new Set(candidate.fixtures.map((entry) => entry.fixture_id)).size, 17);
assert(candidate.fixtures.every((entry) => /^[0-9a-f]{64}$/u.test(entry.file_sha256)));
assert.throws(() => inspectCanonicalPermanentRoleCandidate({roleId: "AGENTOS.INTENT_REGULATOR"}), /not canonical|Retired|unknown/u);
assert.throws(() => resolvePermanentRoleAdmission({authority: {}, receiptRef: "ref:role-review/product-owner", expectedRoleId: "AGENTOS.PRODUCT_OWNER"}), (error) => error.code === "PERMANENT_ROLE_ADMISSION_AUTHORITY_REQUIRED");
assert.throws(() => resolvePermanentRoleAdmission({authority: {}, receiptRef: "ref:role-review/product-owner", expectedRoleId: "AGENTOS.PRODUCT_OWNER", pass: true}), (error) => error.code === "PERMANENT_ROLE_CALLER_AUTHORITY_FORBIDDEN");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-permanent-role-admission-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: "2026-08-18T08:30:00.000Z"});
  const contexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: governance.authorityStore});
  const authority = preparePermanentRoleAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore});
  assert.throws(
    () => resolvePermanentRoleAdmission({authority, receiptRef: "ref:role-review/product-owner", expectedRoleId: "AGENTOS.PRODUCT_OWNER"}),
    (error) => error.code === "PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED",
  );
  assert.throws(
    () => prepareProductOwnerOperationalAuthority({permanentRoleAdmissionAuthority: authority, admissionReceiptRef: "ref:role-review/product-owner", intentContextRef: "ref:intent/current"}),
    (error) => error.code === "PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED",
  );
  assert.throws(() => preparePermanentRoleAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore, operationalContexts: contexts}), (error) => error.code === "PERMANENT_ROLE_CALLER_AUTHORITY_FORBIDDEN");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS governed permanent-role admission bridge: canonical package/gate/fixture bytes resolve independently, caller authority is denied, current model contexts bind internally, and pending external review fails closed");
