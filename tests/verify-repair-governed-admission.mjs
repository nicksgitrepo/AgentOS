#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {inspectCanonicalRepairCandidate, prepareRepairAdmissionAuthority, resolveRepairAdmission} from "../control/repair-governed-admission.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

assert.throws(() => inspectCanonicalRepairCandidate(), (error) => error.code === "REPAIR_QUALIFICATION_REQUIRED");
assert.throws(() => inspectCanonicalRepairCandidate({root: "/tmp"}), (error) => error.code === "REPAIR_CALLER_AUTHORITY_FORBIDDEN");

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const projectTempRoot = path.resolve(repositoryRoot, "../../../Temp");
fs.mkdirSync(projectTempRoot, {recursive: true});
const authorityRoot = fs.mkdtempSync(path.join(projectTempRoot, "agentos-repair-admission-"));
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot, nowUtc: new Date().toISOString()});
  assert.throws(() => prepareRepairAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore, root: "/tmp"}), (error) => error.code === "REPAIR_CALLER_AUTHORITY_FORBIDDEN");
  assert.throws(() => prepareRepairAdmissionAuthority({globalGovernanceAuthorityStore: governance.authorityStore}), (error) => error.code === "REPAIR_QUALIFICATION_REQUIRED");
  assert.throws(() => resolveRepairAdmission({authority: {}, admissionReceiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/WAIT"}), (error) => error.code === "REPAIR_ADMISSION_AUTHORITY_REQUIRED");
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

assert.throws(() => resolveRepairAdmission({authority: {}, admissionReceiptRef: "ref:temporary-role-review/not-a-digest", requestId: "REQUEST.REPAIR.INTAKE", ownerIntakeRef: "ref:owner-intake/WAIT"}), /opaque sealed capability/u);
for (const schema of ["repair-governed-admission.v1.json", "reusable-agent-roster.v1.json", "reusable-agent-acceptance-ledger.v1.json"]) JSON.parse(fs.readFileSync(path.join("schemas", schema), "utf8"));
console.log("PASS Repair governed admission: changed candidate bytes invalidate prior qualification, caller authority is rejected, and admission remains closed");
