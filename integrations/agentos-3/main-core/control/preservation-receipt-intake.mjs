#!/usr/bin/env node

/* Read-only intake for externally preserved source receipts and consumer zero-trace proof. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {inspectProjectSource, verifySourcePreservation} from "./project-import.mjs";
import {opaqueSchedulerWorktreeRef} from "./hybrid-scheduler.mjs";
import {validateConservativePreservationPolicy} from "./conservative-preservation-policy.mjs";

export const PRESERVATION_RECEIPT_INTAKE_SCHEMA = "agentos.preservation_receipt_intake.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT = /^[0-9a-f]{40}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be SHA-256`); }
function requireGit(value, label) { assert(typeof value === "string" && GIT.test(value), `${label} must be Git object`); }
function requireOpaque(value, label) { assert(typeof value === "string" && /^opaque:[a-z][a-z0-9._-]*:[0-9a-f]{64}$/u.test(value), `${label} must be opaque`); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function requireCanonicalDirectory(root, label) {
  assert(typeof root === "string" && path.isAbsolute(root), `${label} must be absolute`);
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a canonical directory`);
  const real = fs.realpathSync.native(root);
  const realStat = fs.lstatSync(real);
  assert(realStat.isDirectory() && !realStat.isSymbolicLink(), `${label} must resolve to a canonical directory`);
  return real;
}

function directoryInventory(root) {
  const entries = [];
  function visit(current, prefix = "") {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `zero-trace inventory encountered a symlink: ${relative}`);
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) entries.push({path: relative, kind: "FILE", size: stat.size, sha256: sha256(fs.readFileSync(absolute))});
      else throw new Error(`zero-trace inventory encountered an unsafe entry: ${relative}`);
    }
  }
  visit(root);
  return entries;
}

export function validatePreservationReceiptIntake(record) {
  requireRecord(record, "preservation receipt intake");
  assert(record.schema === PRESERVATION_RECEIPT_INTAKE_SCHEMA && record.version === 1, "preservation receipt intake schema is invalid");
  assert(record.status === "PRESERVATION_RECEIPTS_ACCEPTED_ZERO_TRACE", "preservation receipt intake status is invalid");
  requireOpaque(record.destination_ref, "preservation intake destination");
  requireOpaque(record.external_custody_ref, "preservation intake custody");
  requireSha(record.policy_sha256, "preservation intake policy");
  assert(Array.isArray(record.sources) && record.sources.length >= 2, "preservation intake requires all source roots");
  const ids = new Set();
  for (const [index, source] of record.sources.entries()) {
    requireRecord(source, `preservation intake source ${index}`);
    assert(typeof source.repository_id === "string" && source.repository_id.length > 0, `preservation intake source ${index} identity is invalid`);
    assert(!ids.has(source.repository_id), `preservation intake source ${source.repository_id} is duplicated`);
    ids.add(source.repository_id);
    requireOpaque(source.source_ref, `preservation intake source ${index} root`);
    requireGit(source.source_commit, `preservation intake source ${index} commit`);
    requireGit(source.source_tree, `preservation intake source ${index} tree`);
    requireSha(source.source_content_sha256, `preservation intake source ${index} content`);
    requireSha(source.source_observation_sha256, `preservation intake source ${index} observation`);
    requireSha(source.receipt_sha256, `preservation intake source ${index} receipt`);
    assert(source.verification_status === "VERIFIED_EXACT", `preservation intake source ${index} is not verified`);
  }
  assert(JSON.stringify([...ids].sort()) === JSON.stringify(record.sources.map((source) => source.repository_id)), "preservation intake sources must be sorted and unique");
  requireRecord(record.zero_trace, "preservation intake zero trace");
  assert(record.zero_trace.destination_entry_count === 0 && record.zero_trace.consumer_unchanged === true && record.zero_trace.control_plane_created === false, "preservation intake zero-trace proof failed");
  requireSha(record.zero_trace.destination_inventory_sha256, "preservation intake destination inventory");
  assert(record.independent_readback === true && record.source_mutation === "NOT_OBSERVED" && record.destination_mutation === "NOT_PERFORMED", "preservation intake custody is incomplete");
  requireSha(record.intake_sha256, "preservation intake digest");
  const body = structuredClone(record); delete body.intake_sha256;
  assert(record.intake_sha256 === canonicalDigest(body), "preservation intake digest is stale");
  return record;
}

export function intakePreservedSources({sources, destinationRoot, externalCustodyRoot, policy} = {}) {
  validateConservativePreservationPolicy(policy);
  assert(Array.isArray(sources) && sources.length >= 2, "preservation intake requires source descriptors");
  const destination = requireCanonicalDirectory(destinationRoot, "preservation intake destination");
  const custody = requireCanonicalDirectory(externalCustodyRoot, "preservation intake external custody root");
  const destinationEntries = directoryInventory(destination);
  assert(destinationEntries.length === 0, "preservation intake destination is not empty");
  const records = sources.map((descriptor, index) => {
    requireRecord(descriptor, `preservation intake descriptor ${index}`);
    assert(typeof descriptor.repositoryId === "string" && descriptor.repositoryId.length > 0, `preservation intake descriptor ${index} repository ID is invalid`);
    const sourceRoot = requireCanonicalDirectory(descriptor.sourceRoot, `preservation intake source ${descriptor.repositoryId}`);
    const artifactRoot = requireCanonicalDirectory(descriptor.artifactRoot, `preservation intake artifact ${descriptor.repositoryId}`);
    const verification = verifySourcePreservation(artifactRoot);
    const observed = inspectProjectSource(sourceRoot, {conservative: true, policy});
    const receipt = JSON.parse(fs.readFileSync(path.join(artifactRoot, "source-preservation.receipt.json"), "utf8"));
    assert(observed.source_commit === descriptor.expectedCommit && observed.source_tree === descriptor.expectedTree, `source identity changed for ${descriptor.repositoryId}`);
    assert(receipt.source_content_sha256 === observed.source_content_sha256 && receipt.source_observation_sha256 === observed.source_observation_sha256, `source receipt binding changed for ${descriptor.repositoryId}`);
    return {
      repository_id: descriptor.repositoryId,
      source_ref: opaqueSchedulerWorktreeRef(sourceRoot),
      source_commit: observed.source_commit,
      source_tree: observed.source_tree,
      source_content_sha256: observed.source_content_sha256,
      source_observation_sha256: observed.source_observation_sha256,
      receipt_sha256: receipt.receipt_sha256,
      verification_status: verification.status,
      included_files: verification.included_files,
      excluded_paths: verification.excluded_paths,
    };
  }).sort((left, right) => left.repository_id.localeCompare(right.repository_id));
  const body = {
    schema: PRESERVATION_RECEIPT_INTAKE_SCHEMA,
    version: 1,
    status: "PRESERVATION_RECEIPTS_ACCEPTED_ZERO_TRACE",
    destination_ref: opaqueSchedulerWorktreeRef(destination),
    external_custody_ref: opaqueSchedulerWorktreeRef(custody),
    policy_sha256: policy.policy_sha256,
    sources: records,
    zero_trace: {
      destination_entry_count: destinationEntries.length,
      destination_inventory_sha256: canonicalDigest(destinationEntries),
      consumer_unchanged: true,
      control_plane_created: false,
    },
    independent_readback: true,
    source_mutation: "NOT_OBSERVED",
    destination_mutation: "NOT_PERFORMED",
    manifest_invalidation_rule: "POLICY_OR_SOURCE_IDENTITY_CHANGE_INVALIDATES_THIS_INTAKE",
  };
  return validatePreservationReceiptIntake({...body, intake_sha256: canonicalDigest(body)});
}
