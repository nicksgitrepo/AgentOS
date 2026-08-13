#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest} from "../control/specialist-block-compiler.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const audit = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/release-audit.v1.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/specialist-library-audit.v1.json"), "utf8"));

assert.equal(audit.schema, schema.properties.schema.const);
assert.equal(audit.activation, "OFF");
assert.equal(audit.audit_sha256, canonicalDigest({...audit, audit_sha256: null}));
assert.equal(execFileSync("git", ["rev-parse", `${audit.audited_candidate.commit}^{tree}`], {cwd: root, encoding: "utf8"}).trim(), audit.audited_candidate.tree);
assert.equal(new Set(audit.findings.map((finding) => finding.finding_id)).size, audit.findings.length);
const findingIds = new Set(audit.findings.map((finding) => finding.finding_id));
for (const finding of audit.findings) for (const dependency of finding.depends_on) assert(findingIds.has(dependency), `${finding.finding_id} has unknown dependency ${dependency}`);
assert(audit.findings.some((finding) => finding.status === "OPEN" || finding.status === "REPAIR_ACTIVE"), "an active build audit cannot hide all remaining work");
assert.equal(audit.inventory.compileable_recipes + audit.inventory.planned_noncompileable_recipes + audit.inventory.protected_not_applicable_recipes, audit.inventory.role_addresses);
const text = JSON.stringify(audit);
assert(!/(?:\/Users\/|consumer product name|credential|api[_-]?key)/iu.test(text), "portable audit contains private or credential-like context");

console.log(`PASS specialist release audit: ${audit.findings.length} findings, fail-closed status ${audit.status}, activation OFF`);
