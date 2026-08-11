import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readFile, readdir, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite, fsyncDir } from "./io.mjs";

export const STORAGE_PROFILE_SCHEMA = "agentos.memory.storage-profile.v1";
export const STORAGE_RECEIPT_SCHEMA = "agentos.memory.storage-conformance-receipt.v1";

export const REQUIRED_STORAGE_CHECKS = Object.freeze([
  "atomic_replacement",
  "create_only_publication",
  "directory_durability",
  "fault_boundary_receipts",
  "immutable_authority_publication",
  "private_no_follow_custody"
]);

export const LOCAL_FAULT_BOUNDARY_EVIDENCE_DIGEST = sha256Ref(
  "agentos.memory.storage-fault-boundary-contract.v1",
  canonicalBytes({
    transitions: ["dual_control_recovery", "revocation", "rotation"],
    outcomes: ["fail_closed", "finalize_intended", "retain_prior"],
    boundary_case_count: 42
  })
);

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const LOCAL_FILESYSTEM_STORAGE_PROFILE = deepFreeze({
  schema: STORAGE_PROFILE_SCHEMA,
  profile_id: "local-filesystem-single-host-v1",
  scope: "single_host",
  publication: {
    create_only: "exclusive_create_file_sync_directory_sync",
    immutable_authority: "create_only_collision_reject"
  },
  replacement: {
    atomic: "same_directory_temp_file_sync_rename_directory_sync"
  },
  deletion: {
    durable: "unlink_directory_sync"
  },
  custody: {
    directories: "real_private_0700",
    files: "real_private_0600_no_symbolic_link"
  },
  fault_receipts: {
    mode: "explicit_named_durable_boundary",
    outcomes: ["fail_closed", "finalize_intended", "retain_prior"]
  }
});

const DIGEST = /^sha256:[a-z2-7]{52}$/;

export function storageProfileDigest(profile = LOCAL_FILESYSTEM_STORAGE_PROFILE) {
  assertStorageProfile(profile);
  return sha256Ref("agentos.memory.storage-profile.v1", canonicalBytes(profile));
}

export function assertStorageProfile(profile) {
  invariant(profile !== null && typeof profile === "object" && !Array.isArray(profile),
    "INVALID_STORAGE_PROFILE", "storage profile must be an object");
  invariant(profile.schema === STORAGE_PROFILE_SCHEMA, "UNSUPPORTED_STORAGE_PROFILE",
    "storage profile schema is not supported");
  invariant(canonicalJson(profile) === canonicalJson(LOCAL_FILESYSTEM_STORAGE_PROFILE),
    "UNSUPPORTED_STORAGE_PROFILE", "storage profile is not the admitted local filesystem contract");
  return profile;
}

export function createStorageConformanceReceipt({
  profile = LOCAL_FILESYSTEM_STORAGE_PROFILE,
  checks
}) {
  assertStorageProfile(profile);
  invariant(Array.isArray(checks), "INVALID_STORAGE_CHECKS", "storage conformance checks must be an array");
  const normalized = checks.map((check) => {
    invariant(check !== null && typeof check === "object" && !Array.isArray(check),
      "INVALID_STORAGE_CHECK", "each storage conformance check must be an object");
    invariant(Object.keys(check).sort().join(",") === "evidence_digest,name,status",
      "INVALID_STORAGE_CHECK", "storage conformance check fields must be exact");
    invariant(typeof check.name === "string", "INVALID_STORAGE_CHECK", "check name must be a string");
    invariant(check.status === "passed", "STORAGE_CONFORMANCE_FAILED", `storage check ${check.name} did not pass`);
    invariant(typeof check.evidence_digest === "string" && DIGEST.test(check.evidence_digest),
      "INVALID_STORAGE_CHECK", `storage check ${check.name} has an invalid evidence digest`);
    return { name: check.name, status: check.status, evidence_digest: check.evidence_digest };
  }).sort((left, right) => left.name.localeCompare(right.name));

  invariant(new Set(normalized.map(({ name }) => name)).size === normalized.length,
    "DUPLICATE_STORAGE_CHECK", "storage conformance checks must be unique");
  invariant(canonicalJson(normalized.map(({ name }) => name)) === canonicalJson(REQUIRED_STORAGE_CHECKS),
    "INCOMPLETE_STORAGE_CONFORMANCE", "storage conformance checks must match the required set exactly");

  const receipt = {
    schema: STORAGE_RECEIPT_SCHEMA,
    profile_id: profile.profile_id,
    profile_digest: storageProfileDigest(profile),
    checks: normalized,
    status: "admitted"
  };
  return Object.freeze(receipt);
}

export function verifyStorageConformanceReceipt(receipt, profile = LOCAL_FILESYSTEM_STORAGE_PROFILE) {
  invariant(receipt !== null && typeof receipt === "object" && !Array.isArray(receipt),
    "INVALID_STORAGE_RECEIPT", "storage conformance receipt must be an object");
  invariant(Object.keys(receipt).sort().join(",") === "checks,profile_digest,profile_id,schema,status",
    "INVALID_STORAGE_RECEIPT", "storage conformance receipt fields must be exact");
  invariant(receipt.schema === STORAGE_RECEIPT_SCHEMA && receipt.status === "admitted",
    "INVALID_STORAGE_RECEIPT", "storage conformance receipt is not admitted");
  invariant(receipt.profile_id === profile.profile_id && receipt.profile_digest === storageProfileDigest(profile),
    "STORAGE_PROFILE_MISMATCH", "storage conformance receipt does not bind the expected profile");
  const rebuilt = createStorageConformanceReceipt({ profile, checks: receipt.checks });
  invariant(canonicalJson(receipt) === canonicalJson(rebuilt), "INVALID_STORAGE_RECEIPT",
    "storage conformance receipt is not canonical");
  return true;
}

async function createOnly(path, bytes) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fsyncDir(dirname(path));
}

async function assertPrivateRegularFile(path) {
  const info = await lstat(path);
  invariant(info.isFile() && !info.isSymbolicLink(), "STORAGE_NO_FOLLOW_FAILED",
    "storage file must be a real regular file");
  invariant((info.mode & 0o077) === 0, "STORAGE_PRIVATE_CUSTODY_FAILED",
    "storage file must not be accessible by group or other users");
}

const probeEvidence = (name, observation) => sha256Ref(
  "agentos.memory.storage-conformance-evidence.v1", canonicalBytes({ name, observation })
);

export async function probeLocalFilesystemStorage({ root, fault_boundary_evidence_digest: faultDigest }) {
  invariant(typeof root === "string" && root.length > 0, "INVALID_STORAGE_PROBE_ROOT",
    "storage probe root must be a non-empty path");
  invariant(typeof faultDigest === "string" && DIGEST.test(faultDigest), "INVALID_STORAGE_FAULT_EVIDENCE",
    "storage probe requires a valid fault-boundary evidence digest");
  const rootInfo = await lstat(root);
  invariant(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), "INVALID_STORAGE_PROBE_ROOT",
    "storage probe root must be a real directory");
  const probe = await mkdtemp(join(root, ".agentos-storage-probe-"));
  const observations = new Map();
  try {
    const probeInfo = await lstat(probe);
    invariant((probeInfo.mode & 0o077) === 0, "STORAGE_PRIVATE_CUSTODY_FAILED",
      "storage probe directory must be private");
    await fsyncDir(probe);
    observations.set("directory_durability", { directory_mode: "0700", directory_sync: true });

    const createPath = join(probe, "create-only");
    await createOnly(createPath, Buffer.from("first"));
    let collision = null;
    try { await createOnly(createPath, Buffer.from("second")); } catch (error) { collision = error.code; }
    invariant(collision === "EEXIST" && (await readFile(createPath, "utf8")) === "first",
      "STORAGE_CREATE_ONLY_FAILED", "exclusive publication did not preserve the first value");
    observations.set("create_only_publication", { collision: "EEXIST", preserved: true });

    const replacePath = join(probe, "replace");
    await atomicWrite(replacePath, Buffer.from("prior"));
    await atomicWrite(replacePath, Buffer.from("intended"));
    invariant((await readFile(replacePath, "utf8")) === "intended", "STORAGE_ATOMIC_REPLACE_FAILED",
      "atomic replacement did not expose the intended value");
    invariant(!(await readdir(probe)).some((name) => name.endsWith(".tmp")), "STORAGE_TEMP_RESIDUE",
      "atomic replacement left unpublished temporary custody");
    observations.set("atomic_replacement", { intended_visible: true, temp_residue: false });

    const privatePath = join(probe, "private");
    await atomicWrite(privatePath, Buffer.from("private"), 0o600);
    await assertPrivateRegularFile(privatePath);
    const linkPath = join(probe, "private-link");
    await symlink(privatePath, linkPath);
    let noFollowCode = null;
    try { await assertPrivateRegularFile(linkPath); } catch (error) { noFollowCode = error.code; }
    invariant(noFollowCode === "STORAGE_NO_FOLLOW_FAILED", "STORAGE_NO_FOLLOW_FAILED",
      "symbolic-link custody was not rejected");
    observations.set("private_no_follow_custody", { file_mode: "0600", symbolic_link_rejected: true });

    const authorityPath = join(probe, "authority-event");
    await createOnly(authorityPath, Buffer.from("authority-v1"));
    let authorityCollision = null;
    try { await createOnly(authorityPath, Buffer.from("authority-v2")); } catch (error) { authorityCollision = error.code; }
    invariant(authorityCollision === "EEXIST" && (await readFile(authorityPath, "utf8")) === "authority-v1",
      "STORAGE_IMMUTABILITY_FAILED", "authority publication was overwritten after collision");
    observations.set("immutable_authority_publication", { collision: "EEXIST", preserved: true });
    observations.set("fault_boundary_receipts", { evidence_digest: faultDigest });

    return createStorageConformanceReceipt({ checks: REQUIRED_STORAGE_CHECKS.map((name) => ({
      name,
      status: "passed",
      evidence_digest: probeEvidence(name, observations.get(name))
    })) });
  } finally {
    await rm(probe, { recursive: true, force: true });
    await fsyncDir(root);
  }
}
