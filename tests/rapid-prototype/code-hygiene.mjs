#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CODE_HYGIENE_ALLOWED_PATHS,
  compileHygieneResult,
  EXACT_LANE_PATHS,
  HYGIENE_HANDOFF_SCHEMA,
  validateChangedPaths,
} from "../../control/rapid-prototype/code-hygiene.mjs";

const exactPaths = [...EXACT_LANE_PATHS];
const reversedPaths = [...exactPaths].reverse();

const clean = compileHygieneResult({changedPaths: reversedPaths, allowedPaths: [...CODE_HYGIENE_ALLOWED_PATHS]});
const repeatedClean = compileHygieneResult({changedPaths: exactPaths, allowedPaths: [...CODE_HYGIENE_ALLOWED_PATHS].reverse()});
assert.equal(clean.status, "CLEAN", "the exact module and focused test paths must be clean");
assert.equal(clean.decision, "CLEAN", "the typed decision must mirror the clean status");
assert.equal(clean.exact_lane_scope, true, "the exact lane allowlist must be proven");
assert.deepEqual(clean.path_validation.accepted_paths, [...exactPaths].sort(), "accepted paths must be deterministic");
assert.equal(clean.handoff.schema, HYGIENE_HANDOFF_SCHEMA, "the portable handoff schema must be explicit");
assert.equal(clean.handoff.independent_check, "REQUESTED", "the producer must leave independent review requested");
assert.equal(clean.handoff.clearance, "NOT_CLAIMED", "the producer must not self-clear");
assert.equal(clean.handoff.next_handoff, "INDEPENDENT_AUDITOR", "the next reviewer must be named");
assert.equal(clean.handoff.evidence.validation_sha256, clean.path_validation.validation_sha256, "handoff evidence must bind to path validation");
assert.equal(clean.handoff.delegated_checks.length, 5, "delegated boundaries must be explicit");
assert.deepEqual(clean, repeatedClean, "path order must not change the typed result or digest");

const traversal = compileHygieneResult({
  changedPaths: [...exactPaths, "../tests/rapid-prototype/other.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(traversal.status, "HARD_STOP", "path traversal must hard stop the lane");
assert.ok(traversal.path_validation.findings.some((finding) => finding.code === "PATH_TRAVERSAL"));

const siblingLane = compileHygieneResult({
  changedPaths: [...exactPaths, "control/rapid-prototype/functionality.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(siblingLane.status, "HARD_STOP", "a sibling implementation lane must be rejected");
assert.ok(siblingLane.path_validation.findings.some((finding) => finding.code === "SIBLING_LANE_PATH"));

const docsOnly = compileHygieneResult({
  changedPaths: ["docs/rapid-foundations/08-code-hygiene.md"],
  allowedPaths: exactPaths,
});
assert.equal(docsOnly.status, "SOFT_REVIEW", "documentation-only changes need a scope review");
assert.ok(docsOnly.path_validation.findings.some((finding) => finding.code === "DOCS_ONLY_PATH"));

const undeclared = validateChangedPaths(["control/other-module.mjs"], exactPaths);
assert.equal(undeclared.status, "SOFT_REVIEW", "a non-protected undeclared path must not be accepted as clean");
assert.ok(undeclared.findings.some((finding) => finding.code === "UNDECLARED_PATH"));

const shared = compileHygieneResult({
  changedPaths: ["control/rapid-prototype/index.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(shared.status, "HARD_STOP", "the shared assembler path must be rejected");
assert.ok(shared.path_validation.findings.some((finding) => finding.code === "SHARED_PATH"));

const absolute = compileHygieneResult({
  changedPaths: ["/synthetic/absolute-record.json"],
  allowedPaths: exactPaths,
});
assert.equal(absolute.status, "HARD_STOP", "absolute paths must hard stop the lane");
assert.ok(absolute.path_validation.findings.some((finding) => finding.code === "ABSOLUTE_PATH"));
assert.equal(JSON.stringify(absolute).includes("/synthetic/absolute-record.json"), false, "absolute path evidence must not be echoed");

const privatePath = compileHygieneResult({
  changedPaths: ["private/synthetic-record.json"],
  allowedPaths: exactPaths,
});
assert.equal(privatePath.status, "HARD_STOP", "private paths must hard stop the lane");
assert.ok(privatePath.path_validation.findings.some((finding) => finding.code === "PRIVATE_PATH"));
assert.equal(JSON.stringify(privatePath).includes("private/synthetic-record.json"), false, "private path evidence must not be echoed");

const generated = compileHygieneResult({
  changedPaths: ["dist/synthetic-output.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(generated.status, "HARD_STOP", "generated paths must hard stop the lane");
assert.ok(generated.path_validation.findings.some((finding) => finding.code === "GENERATED_PATH"));
assert.equal(JSON.stringify(generated).includes("dist/synthetic-output.mjs"), false, "generated path evidence must not be echoed");

const temporary = compileHygieneResult({
  changedPaths: ["tmp/synthetic-output.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(temporary.status, "HARD_STOP", "temporary paths must hard stop the lane");
assert.ok(temporary.path_validation.findings.some((finding) => finding.code === "TEMPORARY_PATH"));

const malformedRelative = compileHygieneResult({
  changedPaths: ["src/synthetic output.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(malformedRelative.status, "HARD_STOP", "unsafe relative paths must hard stop the lane");
assert.ok(malformedRelative.path_validation.findings.some((finding) => finding.code === "INVALID_PATH"));

const scopeMismatch = compileHygieneResult({changedPaths: exactPaths, allowedPaths: [...exactPaths, "README.md"]});
assert.equal(scopeMismatch.status, "HARD_STOP", "an expanded allowlist must hard stop the lane");
assert.equal(scopeMismatch.exact_lane_scope, false, "an expanded allowlist must not prove exact scope");
assert.ok(scopeMismatch.path_validation.findings.some((finding) => finding.code === "LANE_SCOPE_MISMATCH"));

const invalidAllowlist = compileHygieneResult({changedPaths: exactPaths, allowedPaths: null});
assert.equal(invalidAllowlist.status, "HARD_STOP", "an explicitly invalid allowlist must hard stop the lane");
assert.ok(invalidAllowlist.path_validation.findings.some((finding) => finding.code === "INVALID_ALLOWLIST"));

const externalReference = compileHygieneResult({
  changedPaths: ["https://example.invalid/synthetic-output.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(externalReference.status, "HARD_STOP", "external references must hard stop the lane");
assert.ok(externalReference.path_validation.findings.some((finding) => finding.code === "EXTERNAL_REFERENCE"));
assert.equal(JSON.stringify(externalReference).includes("https://example.invalid/synthetic-output.mjs"), false, "external path evidence must not be echoed");

const backslashPath = compileHygieneResult({
  changedPaths: ["control\\rapid-prototype\\other.mjs"],
  allowedPaths: exactPaths,
});
assert.equal(backslashPath.status, "HARD_STOP", "backslash paths must hard stop the lane");
assert.ok(backslashPath.path_validation.findings.some((finding) => finding.code === "BACKSLASH_PATH"));
assert.equal(JSON.stringify(backslashPath).includes("control\\rapid-prototype\\other.mjs"), false, "ambiguous path evidence must not be echoed");

const duplicatePath = compileHygieneResult({
  changedPaths: [exactPaths[0], exactPaths[0]],
  allowedPaths: exactPaths,
});
assert.equal(duplicatePath.status, "HARD_STOP", "duplicate changed paths must hard stop the lane");
assert.ok(duplicatePath.path_validation.findings.some((finding) => finding.code === "DUPLICATE_PATH"));

const invalidChangedList = compileHygieneResult({changedPaths: null, allowedPaths: exactPaths});
assert.equal(invalidChangedList.status, "HARD_STOP", "an invalid changed-path list must hard stop the lane");
assert.ok(invalidChangedList.path_validation.findings.some((finding) => finding.code === "INVALID_CHANGED_PATHS"));
assert.equal(JSON.stringify(invalidChangedList).includes("null"), false, "invalid changed-path evidence must not be echoed as input");

const emptyObservation = compileHygieneResult({changedPaths: [], allowedPaths: exactPaths});
assert.equal(emptyObservation.status, "SOFT_REVIEW", "an empty observation must remain non-clean");
assert.ok(emptyObservation.path_validation.findings.some((finding) => finding.code === "NO_CHANGED_PATHS"));

console.log("PASS portable changed-path hygiene (exact scope, deterministic results, soft review, and hostile path rejection)");
