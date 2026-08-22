#!/usr/bin/env node

/*
 * Rebind the current operational evaluator readback into the Field Job
 * Workflow dossier and package registry.  This controller never changes
 * candidate lifecycle, activation, acceptance, or external-review state.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest} from "./content-addressing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "specialist-blocks/wave-06/field-job-workflow";
const BLOCK = path.join(ROOT, PACKAGE, "block.json");
const EVALUATION = path.join(ROOT, PACKAGE, "evaluation.json");
const REGISTRY = path.join(ROOT, PACKAGE, "registry-entry.json");
const READBACK_RELATIVE = "specialist-blocks/registry/field-job-workflow-operational-readback.v1.json";
const READBACK = path.join(ROOT, READBACK_RELATIVE);
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message, code = "FIELD_JOB_WORKFLOW_REBIND_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function write(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function shaFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function without(value, field) {
  return {...structuredClone(value), [field]: null};
}

function validateReadback(readback, block) {
  assert(readback?.schema === "agentos.field_job_workflow_operational_readback.v1" && readback.version === 1 && readback.status === "PASS", "Operational evaluator readback is not a PASS receipt", "FIELD_JOB_WORKFLOW_REBIND_READBACK_INVALID");
  assert(readback.block_id === block.block_id && readback.candidate_digest === block.block_sha256, "Operational evaluator readback targets another candidate", "FIELD_JOB_WORKFLOW_REBIND_READBACK_STALE");
  assert(SHA256.test(readback.readback_sha256) && readback.readback_sha256 === canonicalDigest(without(readback, "readback_sha256")), "Operational evaluator readback digest is invalid", "FIELD_JOB_WORKFLOW_REBIND_READBACK_INVALID");
  assert(readback.fixture_count === 17 && readback.gate_count === 12 && readback.mutation_detected === true && readback.invalidation_status === "PASS" && readback.workspace_custody_status === "MATCHED", "Operational evaluator readback proof is incomplete", "FIELD_JOB_WORKFLOW_REBIND_READBACK_INVALID");
  assert(typeof readback.observed_at_utc === "string" && Number.isFinite(Date.parse(readback.observed_at_utc)) && Date.parse(readback.observed_at_utc) <= Date.now(), "Operational evaluator readback time is invalid", "FIELD_JOB_WORKFLOW_REBIND_READBACK_INVALID");
}

export function rebindFieldJobWorkflowOperationalReadback() {
  const block = read(BLOCK);
  assert(block.schema === "agentos.specialist_block.v1" && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Field Job Workflow candidate is not inactive", "FIELD_JOB_WORKFLOW_REBIND_STATE_INVALID");
  assert(block.block_sha256 === canonicalDigest(without(block, "block_sha256")), "Field Job Workflow candidate digest is invalid", "FIELD_JOB_WORKFLOW_REBIND_BLOCK_INVALID");
  const readback = read(READBACK);
  validateReadback(readback, block);
  const readbackFileSha = shaFile(READBACK);

  const evaluation = read(EVALUATION);
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.block_id === block.block_id && evaluation.disposition === "EXECUTED_REVIEW_REQUIRED", "Field Job Workflow dossier is not review-gated", "FIELD_JOB_WORKFLOW_REBIND_STATE_INVALID");
  evaluation.operational_readback = {
    path: READBACK_RELATIVE,
    required: true,
    file_sha256: readbackFileSha,
  };
  write(EVALUATION, evaluation);

  const registry = read(REGISTRY);
  assert(registry.schema === "agentos.field_job_workflow_registry_entry.v1" && registry.block_id === block.block_id && registry.lifecycle === "CANDIDATE" && registry.activation === "OFF" && registry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION", "Field Job Workflow package registry is not candidate/off", "FIELD_JOB_WORKFLOW_REBIND_STATE_INVALID");
  registry.operational_readback = {
    path: READBACK_RELATIVE,
    evaluator_entrypoint: "control/field-job-workflow-package-evaluator.mjs#evaluateFieldJobWorkflowPackage",
    required: true,
    status: "PASS",
    file_sha256: readbackFileSha,
    readback_sha256: readback.readback_sha256,
  };
  registry.registry_sha256 = canonicalDigest(without(registry, "registry_sha256"));
  write(REGISTRY, registry);
  return Object.freeze({
    status: "PASS",
    candidate_lifecycle: block.lifecycle,
    activation: block.activation,
    external_admission: registry.evaluation.canonical_external_admission,
    readback_path: READBACK_RELATIVE,
    readback_sha256: readback.readback_sha256,
    readback_file_sha256: readbackFileSha,
    registry_sha256: registry.registry_sha256,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${JSON.stringify(rebindFieldJobWorkflowOperationalReadback(), null, 2)}\n`);
}
