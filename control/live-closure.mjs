import {assert, digestWithout} from "./canonical-json.mjs";
import {validateDeliveryChoice} from "./delivery-closure.mjs";
import {assertOpaqueReference, isOpaqueReference, opaqueReference, sessionReference} from "./opaque-reference.mjs";

export const CHECKPOINT_SCHEMA = "agentos.repository_checkpoint.v1";
export const DEPLOYMENT_RECEIPT_SCHEMA = "agentos.live_deployment_receipt.v1";
export const LIVE_AUDIT_RECEIPT_SCHEMA = "agentos.independent_live_audit_receipt.v1";
export const LIVE_CLOSURE_SCHEMA = "agentos.accepted_live_closure.v1";

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const METHODS = Object.freeze(["GIT_READBACK", "PROVIDER_READBACK", "ARTIFACT_READBACK"]);

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function stable(value, label) {
  nonempty(value, label);
  assert(ID.test(value), `${label} is invalid`);
}

function source(value, label) {
  assert(COMMIT.test(value), `${label} must be a commit/tree identity`);
}

function digest(value, label) {
  assert(DIGEST.test(value), `${label} must be a SHA-256 digest`);
}

function time(value, label) {
  assert(typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} is invalid`);
}

const CHECKPOINT_FIELDS = ["schema", "version", "worktree_id", "commit", "tree", "remote_commit", "remote_tree", "clean", "pushed", "observed_by_role", "observed_by_session", "observed_at_utc", "verification_method", "digest"];

export function validateCheckpoint(proof, expected = {}) {
  exactKeys(proof, CHECKPOINT_FIELDS, "repository checkpoint proof");
  assert(proof.schema === CHECKPOINT_SCHEMA && proof.version === 1, "repository checkpoint identity is invalid");
  stable(proof.worktree_id, "checkpoint worktree_id");
  source(proof.commit, "checkpoint commit");
  source(proof.tree, "checkpoint tree");
  nonempty(proof.remote_commit, "checkpoint remote_commit");
  nonempty(proof.remote_tree, "checkpoint remote_tree");
  assert(typeof proof.clean === "boolean" && typeof proof.pushed === "boolean", "checkpoint flags are invalid");
  stable(proof.observed_by_role, "checkpoint observed_by_role");
  assertOpaqueReference(proof.observed_by_session, "session", "checkpoint observed_by_session");
  time(proof.observed_at_utc, "checkpoint observed_at_utc");
  assert(METHODS.includes(proof.verification_method), "checkpoint verification_method is invalid");
  if (proof.pushed) {
    assert(proof.clean === true, "a pushed checkpoint must be clean");
    assert(COMMIT.test(proof.remote_commit) && COMMIT.test(proof.remote_tree), "a pushed checkpoint must identify its remote commit/tree");
    assert(proof.commit === proof.remote_commit && proof.tree === proof.remote_tree, "pushed checkpoint is not remote-equal");
  }
  for (const field of ["worktree_id", "commit", "tree", "remote_commit", "remote_tree"]) if (expected[field] !== undefined) assert(proof[field] === expected[field], `checkpoint ${field} differs from expected identity`);
  digest(proof.digest, "checkpoint digest");
  assert(proof.digest === digestWithout(proof, "digest"), "checkpoint digest does not match content");
  return proof;
}

export function compileCheckpoint({worktree_id, commit, tree, remote_commit, remote_tree, clean, pushed, observed_by_role, observed_by_session, observed_at_utc, verification_method = "GIT_READBACK"}) {
  const publicObserver = isOpaqueReference(observed_by_session, "session")
    ? observed_by_session
    : sessionReference(observed_by_session, {source_commit: commit, source_tree: tree, worktree_id});
  const proof = {schema: CHECKPOINT_SCHEMA, version: 1, worktree_id, commit, tree, remote_commit, remote_tree, clean, pushed, observed_by_role, observed_by_session: publicObserver, observed_at_utc, verification_method, digest: null};
  proof.digest = digestWithout(proof, "digest");
  return validateCheckpoint(proof);
}

const DEPLOYMENT_FIELDS = ["schema", "version", "final_candidate_commit", "final_candidate_tree", "deployed_identity", "rollback_identity", "runtime_session_id", "deployed_at_utc", "digest"];

export function validateDeploymentReceipt(receipt, expected = {}) {
  exactKeys(receipt, DEPLOYMENT_FIELDS, "deployment receipt");
  assert(receipt.schema === DEPLOYMENT_RECEIPT_SCHEMA && receipt.version === 1, "deployment receipt identity is invalid");
  source(receipt.final_candidate_commit, "deployment final_candidate_commit");
  source(receipt.final_candidate_tree, "deployment final_candidate_tree");
  stable(receipt.deployed_identity, "deployment deployed_identity");
  stable(receipt.rollback_identity, "deployment rollback_identity");
  assertOpaqueReference(receipt.runtime_session_id, "session", "deployment runtime_session_id");
  time(receipt.deployed_at_utc, "deployment deployed_at_utc");
  for (const field of ["final_candidate_commit", "final_candidate_tree", "deployed_identity", "runtime_session_id"]) if (expected[field] !== undefined) assert(receipt[field] === expected[field], `deployment ${field} differs from expected identity`);
  digest(receipt.digest, "deployment digest");
  assert(receipt.digest === digestWithout(receipt, "digest"), "deployment digest does not match content");
  return receipt;
}

export function compileDeploymentReceipt({final_candidate_commit, final_candidate_tree, deployed_identity, rollback_identity, runtime_session_id, deployed_at_utc}) {
  const publicRuntimeSession = isOpaqueReference(runtime_session_id, "session")
    ? runtime_session_id
    : opaqueReference("session", runtime_session_id, `${final_candidate_commit}:${final_candidate_tree}:runtime`);
  const receipt = {schema: DEPLOYMENT_RECEIPT_SCHEMA, version: 1, final_candidate_commit, final_candidate_tree, deployed_identity, rollback_identity, runtime_session_id: publicRuntimeSession, deployed_at_utc, digest: null};
  receipt.digest = digestWithout(receipt, "digest");
  return validateDeploymentReceipt(receipt);
}

const LIVE_AUDIT_FIELDS = ["schema", "version", "final_candidate_commit", "final_candidate_tree", "deployed_identity", "independent_audit_identity", "audited_at_utc", "digest"];

export function validateLiveAuditReceipt(receipt, expected = {}) {
  exactKeys(receipt, LIVE_AUDIT_FIELDS, "live audit receipt");
  assert(receipt.schema === LIVE_AUDIT_RECEIPT_SCHEMA && receipt.version === 1, "live audit receipt identity is invalid");
  source(receipt.final_candidate_commit, "live audit final_candidate_commit");
  source(receipt.final_candidate_tree, "live audit final_candidate_tree");
  stable(receipt.deployed_identity, "live audit deployed_identity");
  stable(receipt.independent_audit_identity, "live audit independent_audit_identity");
  assert(receipt.independent_audit_identity !== receipt.deployed_identity, "live audit must be independent of deployment identity");
  time(receipt.audited_at_utc, "live audit audited_at_utc");
  for (const field of ["final_candidate_commit", "final_candidate_tree", "deployed_identity"]) if (expected[field] !== undefined) assert(receipt[field] === expected[field], `live audit ${field} differs from expected identity`);
  digest(receipt.digest, "live audit digest");
  assert(receipt.digest === digestWithout(receipt, "digest"), "live audit digest does not match content");
  return receipt;
}

export function compileLiveAuditReceipt({final_candidate_commit, final_candidate_tree, deployed_identity, independent_audit_identity, audited_at_utc}) {
  const receipt = {schema: LIVE_AUDIT_RECEIPT_SCHEMA, version: 1, final_candidate_commit, final_candidate_tree, deployed_identity, independent_audit_identity, audited_at_utc, digest: null};
  receipt.digest = digestWithout(receipt, "digest");
  return validateLiveAuditReceipt(receipt);
}

const CLOSURE_FIELDS = ["schema", "version", "delivery_choice_digest", "accepted_result_digest", "final_audit_digest", "final_candidate_commit", "final_candidate_tree", "deployment_receipt", "live_audit_receipt", "closed_at_utc", "digest"];

export function validateAcceptedLiveClosure(receipt, {delivery_choice = null, runtime_session_id = null} = {}) {
  exactKeys(receipt, CLOSURE_FIELDS, "accepted live closure");
  assert(receipt.schema === LIVE_CLOSURE_SCHEMA && receipt.version === 1, "accepted live closure identity is invalid");
  digest(receipt.delivery_choice_digest, "accepted live closure delivery_choice_digest");
  digest(receipt.accepted_result_digest, "accepted live closure accepted_result_digest");
  digest(receipt.final_audit_digest, "accepted live closure final_audit_digest");
  source(receipt.final_candidate_commit, "accepted live closure final_candidate_commit");
  source(receipt.final_candidate_tree, "accepted live closure final_candidate_tree");
  validateDeploymentReceipt(receipt.deployment_receipt, {final_candidate_commit: receipt.final_candidate_commit, final_candidate_tree: receipt.final_candidate_tree, runtime_session_id: runtime_session_id ?? undefined});
  validateLiveAuditReceipt(receipt.live_audit_receipt, {final_candidate_commit: receipt.final_candidate_commit, final_candidate_tree: receipt.final_candidate_tree, deployed_identity: receipt.deployment_receipt.deployed_identity});
  time(receipt.closed_at_utc, "accepted live closure closed_at_utc");
  if (delivery_choice) {
    validateDeliveryChoice(delivery_choice);
    assert(["DEPLOY", "RELEASE"].includes(delivery_choice.mode), "live closure requires DEPLOY or RELEASE delivery");
    assert(receipt.delivery_choice_digest === delivery_choice.digest, "live closure delivery choice differs");
    assert(receipt.accepted_result_digest === delivery_choice.accepted_result_digest && receipt.final_audit_digest === delivery_choice.final_audit_digest, "live closure accepted proof differs from delivery choice");
    assert(receipt.final_candidate_commit === delivery_choice.source_commit && receipt.final_candidate_tree === delivery_choice.source_tree, "live closure candidate differs from delivery source");
  }
  digest(receipt.digest, "accepted live closure digest");
  assert(receipt.digest === digestWithout(receipt, "digest"), "accepted live closure digest does not match content");
  return receipt;
}

export function compileAcceptedLiveClosure({delivery_choice, deployment_receipt, live_audit_receipt, closed_at_utc}) {
  validateDeliveryChoice(delivery_choice);
  assert(["DEPLOY", "RELEASE"].includes(delivery_choice.mode), "accepted live closure requires DEPLOY or RELEASE delivery");
  validateDeploymentReceipt(deployment_receipt, {final_candidate_commit: delivery_choice.source_commit, final_candidate_tree: delivery_choice.source_tree});
  validateLiveAuditReceipt(live_audit_receipt, {final_candidate_commit: delivery_choice.source_commit, final_candidate_tree: delivery_choice.source_tree, deployed_identity: deployment_receipt.deployed_identity});
  const receipt = {
    schema: LIVE_CLOSURE_SCHEMA,
    version: 1,
    delivery_choice_digest: delivery_choice.digest,
    accepted_result_digest: delivery_choice.accepted_result_digest,
    final_audit_digest: delivery_choice.final_audit_digest,
    final_candidate_commit: delivery_choice.source_commit,
    final_candidate_tree: delivery_choice.source_tree,
    deployment_receipt: structuredClone(deployment_receipt),
    live_audit_receipt: structuredClone(live_audit_receipt),
    closed_at_utc,
    digest: null,
  };
  receipt.digest = digestWithout(receipt, "digest");
  return validateAcceptedLiveClosure(receipt, {delivery_choice});
}
