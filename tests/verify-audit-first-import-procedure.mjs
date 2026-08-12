#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUDIT_FIRST_IMPORT_PHASES,
  compileAuditFirstImportProcedure,
  validateAuditFirstImportProcedure,
} from "../control/audit-first-import-procedure.mjs";

const SHA = "a".repeat(64);
const ROSTER = "b".repeat(64);
const input = {
  standardsRegistrySha256: SHA,
  specialistRosterSha256: ROSTER,
  registryStandardIds: ["NIST_SSDF_1_1", "OWASP_ASVS_5_0_0"],
  discoveredStandardIds: ["OWASP_ASVS_5_0_0", "RUST_STYLE_CURRENT"],
  ownerDeclaredStandardIds: ["ISO_IEC_25010", "NIST_SSDF_1_1"],
};
const procedure = compileAuditFirstImportProcedure(input);
assert.deepEqual(procedure, compileAuditFirstImportProcedure(structuredClone(input)), "audit-first import procedure is not deterministic");
assert.deepEqual(procedure.phases, AUDIT_FIRST_IMPORT_PHASES);
assert.deepEqual(procedure.standards_inventory.map((entry) => entry.standard_id), ["ISO_IEC_25010", "NIST_SSDF_1_1", "OWASP_ASVS_5_0_0", "RUST_STYLE_CURRENT"]);
assert(procedure.standards_inventory.every((entry) => entry.applicability_outcome === "PENDING_APPLICABILITY"));
assert.equal(procedure.custody.maximum_concurrent_repair_clones, 6);
assert(procedure.seed_composition.separation_rules.includes("SEEDS_NEVER_WORK"));
assert(procedure.seed_composition.separation_rules.includes("NO_SUBAGENTS"));
assert(procedure.checkpoint_contract.missing_field_rule.includes("FAILED_INCOMPLETE_HANDOFF"));
assert(procedure.completion.blockers.includes("UNTESTED_REQUIRED_REAL_HOST_PROOF"));
validateAuditFirstImportProcedure(procedure);

assert.throws(() => compileAuditFirstImportProcedure({...input, maximumConcurrentRepairClones: 7}), /one through six/u);
assert.throws(() => compileAuditFirstImportProcedure({...input, registryStandardIds: ["unsafe id"]}), /invalid identifier/u);

const prejudged = structuredClone(procedure);
prejudged.standards_inventory[0].applicability_outcome = "APPLICABLE";
delete prejudged.procedure_sha256;
prejudged.procedure_sha256 = "0".repeat(64);
assert.throws(() => validateAuditFirstImportProcedure(prejudged), /must not pre-judge applicability/u);

const selfAcceptance = structuredClone(procedure);
selfAcceptance.seed_composition.separation_rules = selfAcceptance.seed_composition.separation_rules.filter((rule) => rule !== "NO_SELF_ACCEPTANCE");
delete selfAcceptance.procedure_sha256;
selfAcceptance.procedure_sha256 = "0".repeat(64);
assert.throws(() => validateAuditFirstImportProcedure(selfAcceptance), /seed separation is weakened/u);

console.log("PASS AgentOS canonical audit-first import procedure: standards inventory, applicability, traceability, identity separation, custody, checkpoints, and completion claims");
