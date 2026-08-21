#!/usr/bin/env node

/*
 * Project-less owner-intake lifecycle for the admitted Repair role.
 *
 * This is deliberately separate from project lifecycle custody: before an
 * owner names a project and mode, Repair receives no project, worktree, data,
 * deployment, or mutation authority.  The only durable state is a small
 * AgentOS control-plane handoff in the sealed Git common directory.
 */

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";
import {assertRepairAdmissionReceipt} from "./repair-governed-admission.mjs";

const TASK_REF = /^[0-9a-f]{8,64}(?:-[0-9a-f]{4,64}){0,4}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const GIT = /^[0-9a-f]{40}$/u;
const CONTROL_DIR = "agentos-spawner-control/repair-intake";

function fail(message, code = "REPAIR_OWNER_INTAKE_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function git(root, args) { try { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); } catch { fail("Repair owner-intake Git custody readback failed", "REPAIR_OWNER_INTAKE_CUSTODY_REQUIRED"); } }
function rootForAuthority(sealedAuthority) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  const common = git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  assert(path.isAbsolute(common), "Repair owner-intake Git common directory is not absolute", "REPAIR_OWNER_INTAKE_CUSTODY_REQUIRED");
  const real = fs.realpathSync.native(common);
  assert(real === common && fs.lstatSync(common).isDirectory(), "Repair owner-intake Git common directory is not canonical", "REPAIR_OWNER_INTAKE_CUSTODY_REQUIRED");
  const root = path.join(common, CONTROL_DIR);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  assert(fs.realpathSync.native(root) === root && !fs.lstatSync(root).isSymbolicLink(), "Repair owner-intake control directory is not canonical", "REPAIR_OWNER_INTAKE_CUSTODY_REQUIRED");
  return root;
}
function appendOnce(root, event) {
  const ledger = path.join(root, "events.jsonl");
  const lock = `${ledger}.lock`;
  let fd;
  try {
    fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(fd, `${canonicalJson({schema: "agentos.repair_owner_intake_lock.v1", pid: process.pid})}\n`);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (error.code === "EEXIST") fail("Repair owner-intake lifecycle is concurrently locked", "REPAIR_OWNER_INTAKE_CONCURRENT");
    throw error;
  }
  try {
    const prior = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    assert(!prior.some((entry) => entry.admission_receipt_sha256 === event.admission_receipt_sha256 || entry.spawn_request_id === event.spawn_request_id), "Repair owner-intake request was already recorded", "REPAIR_OWNER_INTAKE_REPLAY");
    const next = {...event, sequence: prior.length, prior_event_sha256: prior.at(-1)?.event_sha256 ?? null, event_sha256: null};
    next.event_sha256 = canonicalDigest(next);
    fs.appendFileSync(ledger, `${canonicalJson(next)}\n`, {mode: 0o600});
    const readback = fs.openSync(ledger, "r"); try { fs.fsyncSync(readback); } finally { fs.closeSync(readback); }
    return Object.freeze(next);
  } finally { try { fs.unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

export function prepareRepairOwnerIntake(options = {}) {
  assert(options && typeof options === "object" && !Array.isArray(options), "Repair owner-intake input must be an object");
  assert(JSON.stringify(Object.keys(options).sort()) === JSON.stringify(["admissionReceipt", "ownerTaskRef", "sealedAuthority"].sort()), "Repair owner-intake accepts only sealed authority, admitted receipt, and owner reference", "REPAIR_OWNER_INTAKE_CALLER_AUTHORITY_FORBIDDEN");
  const {sealedAuthority, admissionReceipt, ownerTaskRef} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  const admitted = assertRepairAdmissionReceipt(admissionReceipt, sealedAuthority);
  assert(typeof ownerTaskRef === "string" && TASK_REF.test(ownerTaskRef), "Repair owner task reference is invalid", "REPAIR_OWNER_INTAKE_OWNER_REF_INVALID");
  assert(admissionReceipt.owner_intake_ref.endsWith(ownerTaskRef), "Repair admission is bound to another owner intake", "REPAIR_OWNER_INTAKE_OWNER_REF_MISMATCH");
  assert(GIT.test(admissionReceipt.candidate_commit) && GIT.test(admissionReceipt.candidate_tree) && SHA.test(admissionReceipt.receipt_sha256), "Repair admission identity is incomplete", "REPAIR_OWNER_INTAKE_ADMISSION_INVALID");
  const root = rootForAuthority(sealedAuthority);
  const spawnRequestId = `REQUEST.REPAIR.OWNER_INTAKE.${canonicalDigest({receipt: admissionReceipt.receipt_sha256, owner: ownerTaskRef}).slice(0, 32)}`;
  const taskIdentity = canonicalDigest({role_id: admissionReceipt.role_id, candidate_commit: admissionReceipt.candidate_commit, candidate_tree: admissionReceipt.candidate_tree, admission_receipt_sha256: admissionReceipt.receipt_sha256, owner_task_ref: ownerTaskRef});
  const event = appendOnce(root, {schema: "agentos.repair_owner_intake_spawn.v1", version: 1, status: "SPAWN_REQUEST_RECORDED", role_id: "AGENTOS.REPAIR", role_class: "REPAIR", admission_receipt_sha256: admissionReceipt.receipt_sha256, clearance_sha256: admissionReceipt.clearance_sha256, candidate_commit: admissionReceipt.candidate_commit, candidate_tree: admissionReceipt.candidate_tree, owner_task_ref: ownerTaskRef, spawn_request_id: spawnRequestId, task_identity_sha256: taskIdentity, project_authority: "NONE_BEFORE_OWNER_INTAKE", mode: "UNSELECTED", project_context: "NONE", worktree_authority: "NONE", deployment_authority: "NONE", created_at_utc: new Date().toISOString()});
  return Object.freeze({schema: "agentos.repair_owner_intake_spawn.v1", version: 1, status: "SPAWN_REQUEST_RECORDED", role_id: "AGENTOS.REPAIR", role_class: "REPAIR", admission_receipt_sha256: admissionReceipt.receipt_sha256, clearance_sha256: admissionReceipt.clearance_sha256, candidate_commit: admissionReceipt.candidate_commit, candidate_tree: admissionReceipt.candidate_tree, owner_task_ref: ownerTaskRef, spawn_request_id: spawnRequestId, task_identity_sha256: taskIdentity, event_sha256: event.event_sha256, control_ledger: "EXTERNAL_AGENTOS_CONTROL_PLANE", project_authority: "NONE_BEFORE_OWNER_INTAKE", mode: "UNSELECTED", project_context: "NONE", worktree_authority: "NONE", deployment_authority: "NONE", evaluator_state: admitted.external.status});
}
