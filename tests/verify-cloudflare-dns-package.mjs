#!/usr/bin/env node

/* Focused deterministic QA for the Cloudflare DNS candidate. */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateCloudflareDnsBoundary, CLOUDFLARE_DNS_BOUNDARY_SCHEMA} from "../control/cloudflare-dns-boundary-gate.mjs";
import {evaluateCloudflareDnsPackage} from "../control/cloudflare-dns-package-evaluator.mjs";
import {resolveCloudflareDnsCanonicalAuthority} from "../control/cloudflare-dns-authority-binding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/cloudflare-dns");
const assert = (value, message) => { if (!value) throw new Error(message); };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertNoPersonalPathLiterals() {
  const slash = String.fromCharCode(47);
  const personalRoots = [`${slash}${String.fromCharCode(85, 115, 101, 114, 115)}${slash}`, `${slash}${String.fromCharCode(104, 111, 109, 101)}${slash}`];
  const files = [
    "control/cloudflare-dns-boundary-gate.mjs",
    "control/cloudflare-dns-authority-binding.mjs",
    "control/cloudflare-dns-package-evaluator.mjs",
    "tests/verify-cloudflare-dns-package.mjs",
    "schemas/cloudflare-dns-gate-execution.v1.json",
  ];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert(!personalRoots.some((prefix) => text.includes(prefix)), `${relative} contains a personal filesystem path literal`);
  }
}

const beforeModel = fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"));
const authority = resolveCloudflareDnsCanonicalAuthority();
assert(authority.status === "BLOCKED_EXACT", "protected model policy did not fail closed");
assert(authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "stale policy receipt is not preserved");
assert(authority.context.memory_binding === "TYPED_CONTEXT_INVALIDATION_V1", "memory/context invalidation binding is missing");
assert(authority.context.receipt_sha256 === canonicalDigest({
  block_sha256: authority.candidate.block_sha256,
  source_manifest_sha256: authority.candidate.source_manifest_sha256,
  standard_block_sha256: authority.standard.block_sha256,
  standard_source_manifest_sha256: authority.standard.source_manifest_sha256,
  authority_scope: "CLOUDFLARE_DNS",
  scope: "NARROW",
  custody_ref: "opaque:CLOUDFLARE.DNS.CUSTODY",
  operation_identity: "OPERATION.CLOUDFLARE_DNS",
  operation_version: "1",
  router_file_sha256: authority.upstream_router.file_sha256,
  router_result_sha256: authority.upstream_router.result_sha256,
  model_snapshot_sha256: authority.model_policy.snapshot_sha256,
  memory_binding: "TYPED_CONTEXT_INVALIDATION_V1",
  lifecycle_revision: "1.0.0",
}), "context receipt is not exact");

const packageEvaluation = await evaluateCloudflareDnsPackage();
assert(packageEvaluation.status === "BLOCKED_EXACT", "package evaluator did not preserve protected blocker");
assert(packageEvaluation.local_status === "PASS_LOCAL_ONLY", "local executable QA did not pass");
assert(packageEvaluation.ready_for_admission === false, "package exposed a ready label");
assert(packageEvaluation.fixture_results.length === 17, "not all hostile fixtures executed");
assert(packageEvaluation.gate_execution.executions.length === 12, "not all deterministic gates executed");
assert(packageEvaluation.mutation_sensitivity.mutation_detected === true, "hostile mutation proof did not detect weakening");

const fixtureDirectory = path.join(PACKAGE, "fixtures");
for (const name of fs.readdirSync(fixtureDirectory).filter((entry) => entry.endsWith(".json")).sort()) {
  const fixture = readJson(path.join(fixtureDirectory, name));
  assert(fixture.vector.input.schema === CLOUDFLARE_DNS_BOUNDARY_SCHEMA, `${name} input schema is not canonical`);
  const actual = evaluateCloudflareDnsBoundary(fixture.vector.input);
  const expected = fixture.vector.expected_readback;
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${name} direct public readback differs`);
  assert(actual.acceptance_allowed === false && Object.values(actual.external_side_effects).every((value) => value === 0), `${name} has side effects or acceptance authority`);
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${name} result digest is not self-consistent`);
}

const routeFixture = readJson(path.join(fixtureDirectory, "routing.json"));
const unknownFieldInput = structuredClone(routeFixture.vector.input);
unknownFieldInput.evidence.unexpected = true;
let rejectedUnknown = false;
try { evaluateCloudflareDnsBoundary(unknownFieldInput); } catch (error) { rejectedUnknown = error.code === "CLOUDFLARE_DNS_UNKNOWN_FIELD"; }
assert(rejectedUnknown, "boundary accepted an unknown evidence field");

assert(Buffer.compare(beforeModel, fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))) === 0, "local DNS QA mutated protected model policy");
assertNoPersonalPathLiterals();
process.stdout.write(`${JSON.stringify({status: "PASS_LOCAL_ONLY", protected_dependency: authority.model_policy, hostile_fixtures: 17, deterministic_gates: 12, mutation_detected: true, ready_for_admission: false}, null, 2)}\n`);
