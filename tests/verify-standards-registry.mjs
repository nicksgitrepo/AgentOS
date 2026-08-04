#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PORTABLE_STANDARD_BASELINE,
  canonicalDigest,
  compileStandardsRegistry,
  validateStandardsRegistry,
} from "../control/standards-registry.mjs";

const baseline = compileStandardsRegistry();
const repeated = compileStandardsRegistry();
assert.deepEqual(baseline, repeated, "standards registry is not deterministic");
assert.deepEqual(
  baseline.standards.map((entry) => entry.standard_id),
  [...baseline.standards].map((entry) => entry.standard_id).sort(),
  "standards are not sorted by stable identity",
);
assert.equal(baseline.standards.length, PORTABLE_STANDARD_BASELINE.length);
assert(baseline.standards.some((entry) => entry.standard_id === "W3C_WCAG_2_2" && entry.gate_root === "DESIGN_BIBLE"));
assert(baseline.standards.some((entry) => entry.standard_id === "OWASP_ASVS_5_0_0" && entry.version === "5.0.0"));
assert(baseline.standards.some((entry) => entry.standard_id === "OPENAPI_3_1_2" && entry.version === "3.1.2"));
validateStandardsRegistry(baseline);

const overlay = compileStandardsRegistry({
  overlays: [{
    standard_id: "PROJECT_DATA_RULES",
    title: "Synthetic project data rules",
    authority: "PROJECT_CONTEXT",
    version: "1",
    source: "PROJECT_CONTEXT",
    applies_when: ["DURABLE_DATA"],
    gate_root: "SECURITY",
    requirement_identity_rule: "PROJECT-DATA-1-<requirement>",
    minimum_evidence: "BOUNDARY_AND_RECOVERY_PROOF",
    rule: "Add stricter project data retention and recovery requirements.",
  }],
});
assert.equal(overlay.overlay_ids[0], "PROJECT_DATA_RULES");
assert.equal(overlay.standards.find((entry) => entry.standard_id === "PROJECT_DATA_RULES").status, "PROJECT_BOUND");
assert.throws(() => compileStandardsRegistry({overlays: [{
  standard_id: "W3C_WCAG_2_2",
  title: "collision",
  authority: "PROJECT_CONTEXT",
  version: "1",
  source: "PROJECT_CONTEXT",
  applies_when: ["VISIBLE_WEB_CONTENT"],
  gate_root: "DESIGN_BIBLE",
  requirement_identity_rule: "COLLISION",
  minimum_evidence: "NONE",
  rule: "weaken",
}]}), /collides with portable/u);

const weakened = structuredClone(baseline);
weakened.extension_boundary = "PROJECT_CONTEXT_MAY_REMOVE_PINNED_BASELINE";
delete weakened.registry_sha256;
weakened.registry_sha256 = "0".repeat(64);
assert.throws(() => validateStandardsRegistry(weakened), /extension boundary is weakened/u);

const removedBaseline = structuredClone(baseline);
removedBaseline.standards = removedBaseline.standards.filter((entry) => entry.standard_id !== "W3C_WCAG_2_2");
delete removedBaseline.registry_sha256;
removedBaseline.registry_sha256 = canonicalDigest(removedBaseline);
assert.throws(() => validateStandardsRegistry(removedBaseline), /removed a portable baseline/u);

console.log(`PASS AgentOS Standards Registry (${baseline.standards.length} pinned standards, typed overlay boundary, deterministic digest, and hostile weakening coverage)`);
