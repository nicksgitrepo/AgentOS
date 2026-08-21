#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectCanonicalRepairCandidate, prepareRepairAdmissionAuthority, resolveRepairAdmission} from "../control/repair-governed-admission.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const candidate = inspectCanonicalRepairCandidate();
assert.equal(candidate.status, "PREPARED_INACTIVE");
assert.equal(candidate.candidate.role_id, "AGENTOS.REPAIR");
assert.equal(candidate.candidate.package_path, "specialist-blocks/wave-07/repair");
assert.equal(candidate.candidate.gates.length, 12);
assert.equal(candidate.candidate.fixtures.length, 19);
assert.equal(candidate.package_qualified, true);
assert.equal(candidate.independent_clearance_available, false);
assert.equal(candidate.acceptance_record.receipt_sha256, null);
assert.throws(() => inspectCanonicalRepairCandidate({root: "/tmp"}), (error) => error.code === "REPAIR_CALLER_AUTHORITY_FORBIDDEN");

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-repair-admission-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot, nowUtc: new Date().toISOString()});
  const authority = prepareRepairAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore});
  assert.throws(() => prepareRepairAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore, root: "/tmp"}), (error) => error.code === "REPAIR_CALLER_AUTHORITY_FORBIDDEN");
  assert.throws(() => resolveRepairAdmission({authority: {}, admissionReceiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/WAIT"}), (error) => error.code === "REPAIR_ADMISSION_AUTHORITY_REQUIRED");
  assert.throws(() => resolveRepairAdmission({authority, admissionReceiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/WAIT", pass: true}), (error) => error.code === "REPAIR_CALLER_AUTHORITY_FORBIDDEN");
  assert.throws(() => resolveRepairAdmission({authority, admissionReceiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/019fab2f-c6a8-7232-bb19-93a316cdc15c"}), (error) => ["REPAIR_CANDIDATE_NOT_FROZEN", "REPAIR_INDEPENDENT_CLEARANCE_REQUIRED", "REPAIR_EXTERNAL_REVIEW_PROVISIONING_REQUIRED"].includes(error.code));
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

assert.throws(() => resolveRepairAdmission({authority: {}, admissionReceiptRef: "ref:temporary-role-review/not-a-digest", requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/WAIT"}), /opaque sealed capability/u);
for (const schema of ["repair-governed-admission.v1.json", "reusable-agent-roster.v1.json", "reusable-agent-acceptance-ledger.v1.json"]) JSON.parse(fs.readFileSync(path.join("schemas", schema), "utf8"));
console.log("PASS Repair governed admission: canonical package is independently resolved, inert seed remains closed, caller authority is rejected, and missing signed clearance fails closed");
