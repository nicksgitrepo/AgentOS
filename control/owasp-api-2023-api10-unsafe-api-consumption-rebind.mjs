#!/usr/bin/env node

/* Rebind the local API10 evaluator readback without changing admission. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {OWASP_API10_BLOCK_ID, OWASP_API10_PACKAGE_PATH, OWASP_API10_READBACK_PATH} from "./owasp-api-2023-api10-unsafe-api-consumption-authority-binding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, OWASP_API10_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
function fail(message, code = "OWASP_API10_REBIND_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function without(value, field) { return {...structuredClone(value), [field]: null}; }

export function rebindOwaspApi10OperationalReadback() {
  const blockPath = path.join(PACKAGE, "block.json"); const evaluationPath = path.join(PACKAGE, "evaluation.json"); const handoffPath = path.join(PACKAGE, "handoff.json"); const inventoryPath = path.join(ROOT, "specialist-blocks/registry/atomic-inventory.v1.json"); const readbackPath = path.join(ROOT, OWASP_API10_READBACK_PATH);
  const block = read(blockPath); assert(block.schema === "agentos.specialist_block.v1" && block.block_id === OWASP_API10_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === canonicalDigest(without(block, "block_sha256")), "API10 candidate state or digest is invalid", "OWASP_API10_REBIND_BLOCK_INVALID");
  assert(fs.existsSync(readbackPath), "API10 evaluator readback is missing", "OWASP_API10_EVALUATOR_READBACK_MISSING"); const readback = read(readbackPath);
  assert(readback.schema === "agentos.owasp_api10_operational_readback.v1" && readback.status === "PASS" && readback.block_id === block.block_id && readback.candidate_digest === block.block_sha256, "API10 evaluator readback is stale", "OWASP_API10_EVALUATOR_READBACK_STALE");
  assert(SHA256.test(readback.readback_sha256) && readback.readback_sha256 === canonicalDigest(without(readback, "readback_sha256")), "API10 evaluator readback digest is invalid", "OWASP_API10_EVALUATOR_READBACK_INVALID"); assert(readback.fixture_count === 17 && readback.gate_count === 12 && readback.mutation_detected === true && readback.invalidation_status === "PASS" && readback.shared_registry_verdict === "ALIGNED" && readback.workspace_custody_status === "MATCHED", "API10 evaluator readback proof is incomplete", "OWASP_API10_EVALUATOR_READBACK_INVALID");
  const evaluation = read(evaluationPath); assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.block_id === block.block_id && evaluation.candidate_digest === block.block_sha256, "API10 evaluation dossier is not bound to the candidate", "OWASP_API10_REBIND_EVALUATION_INVALID"); evaluation.disposition = "EXECUTED_REVIEW_REQUIRED"; evaluation.operational_readback = {path: OWASP_API10_READBACK_PATH, required: true, file_sha256: sha(readbackPath), readback_sha256: readback.readback_sha256}; write(evaluationPath, evaluation);
  const handoff = read(handoffPath); handoff.changed_paths = [...new Set([...(handoff.changed_paths ?? []), `${OWASP_API10_PACKAGE_PATH}/context.json`, `${OWASP_API10_PACKAGE_PATH}/model-route.json`, `${OWASP_API10_PACKAGE_PATH}/gates/execution.json`, `${OWASP_API10_PACKAGE_PATH}/evaluation.json`, `${OWASP_API10_READBACK_PATH}`])].sort(); handoff.proof = [...new Set([...(handoff.proof ?? []), "executable-boundary-hostile-regression", "operational-evaluator-readback", "runtime-workspace-custody"])].sort(); handoff.residuals = [...new Set([...(handoff.residuals ?? []), "external reviewer provisioning and Luna audit remain required", "external admission remains BLOCKED_EXACT"])].sort(); handoff.next_action = "Preserve activation OFF; route the exact candidate through the external independent reviewer after fresh authority and read-only Luna audit are available."; write(handoffPath, handoff);
  const inventory = read(inventoryPath); const entry = inventory.atomic_specialists?.find((item) => item.block_id === block.block_id); assert(entry, "API10 atomic inventory entry is missing", "OWASP_API10_REBIND_REGISTRY_INVALID"); entry.evaluator_status = "EXECUTED_REVIEW_REQUIRED"; entry.evaluator_receipt = "specialist-eval.owasp-api-2023-api10-unsafe-api-consumption.v1"; write(inventoryPath, inventory);
  return Object.freeze({status: "PASS_LOCAL_REPAIR_EXTERNAL_ADMISSION_BLOCKED_EXACT", block_id: block.block_id, candidate_digest: block.block_sha256, disposition: evaluation.disposition, external_admission: "BLOCKED_EXACT:SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED", readback_path: OWASP_API10_READBACK_PATH, readback_sha256: readback.readback_sha256, readback_file_sha256: sha(readbackPath)});
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(rebindOwaspApi10OperationalReadback(), null, 2)}\n`);
