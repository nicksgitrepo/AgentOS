import {canonicalDigest} from "./content-addressing.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const OPAQUE_REFERENCE = /^opaque:[A-Za-z0-9:_-]+$/u;
const RECEIPT_KEYS = [
  "schema", "version", "status", "request_id", "candidate_commit", "candidate_tree",
  "candidate_generation", "effective_argv", "working_directory_ref", "dependency_closure_sha256",
  "runtime_closure_sha256", "execution_unit_id", "lane_cursor_ref", "queue_cursor_ref",
  "admission_sha256",
];

function assert(condition, message, code = "SCHEDULER_ADMISSION_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields are not canonical`);
}

export function validateSchedulerAdmissionReceipt(receipt, {candidateCommit = null, candidateTree = null, requestId = null} = {}) {
  assert(receipt !== null && typeof receipt === "object" && !Array.isArray(receipt), "scheduler admission receipt is required");
  exactKeys(receipt, RECEIPT_KEYS, "scheduler admission receipt");
  assert(receipt.schema === "agentos.scheduler_admission_receipt.v1" && receipt.version === 1 && receipt.status === "READY", "scheduler admission receipt status is invalid");
  if (requestId !== null) assert(receipt.request_id === requestId, "scheduler admission receipt request binding is stale", "SCHEDULER_ADMISSION_STALE");
  if (candidateCommit !== null) assert(receipt.candidate_commit === candidateCommit, "scheduler admission receipt commit binding is stale", "SCHEDULER_ADMISSION_STALE");
  if (candidateTree !== null) assert(receipt.candidate_tree === candidateTree, "scheduler admission receipt tree binding is stale", "SCHEDULER_ADMISSION_STALE");
  assert(GIT_OBJECT.test(receipt.candidate_commit) && GIT_OBJECT.test(receipt.candidate_tree), "scheduler admission candidate identity is invalid");
  assert(Number.isInteger(receipt.candidate_generation) && receipt.candidate_generation > 0, "scheduler admission generation is invalid");
  assert(Array.isArray(receipt.effective_argv) && receipt.effective_argv.length > 0 && receipt.effective_argv.every((entry) => typeof entry === "string" && entry.length > 0), "scheduler admission argv is invalid");
  assert(typeof receipt.working_directory_ref === "string" && OPAQUE_REFERENCE.test(receipt.working_directory_ref), "scheduler admission working-directory reference is not opaque");
  for (const field of ["dependency_closure_sha256", "runtime_closure_sha256", "admission_sha256"]) assert(SHA256.test(receipt[field]), `scheduler admission ${field} is invalid`);
  for (const field of ["execution_unit_id", "lane_cursor_ref", "queue_cursor_ref"]) assert(typeof receipt[field] === "string" && receipt[field].length > 0, `scheduler admission ${field} is required`);
  assert(receipt.admission_sha256 === canonicalDigest({...receipt, admission_sha256: null}), "scheduler admission digest is invalid");
  return receipt;
}

export function compileSchedulerAdmissionReceipt({requestId, candidateCommit, candidateTree, candidateGeneration, effectiveArgv, workingDirectoryRef, dependencyPreflight, runtimePreflight, executionUnitId, laneCursorRef, queueCursorRef} = {}) {
  assert(typeof requestId === "string" && requestId.length > 0, "scheduler admission request ID is required");
  const body = {
    schema: "agentos.scheduler_admission_receipt.v1",
    version: 1,
    status: "READY",
    request_id: requestId,
    candidate_commit: candidateCommit,
    candidate_tree: candidateTree,
    candidate_generation: candidateGeneration,
    effective_argv: [...(effectiveArgv ?? [])],
    working_directory_ref: workingDirectoryRef,
    dependency_closure_sha256: dependencyPreflight?.closure_sha256,
    runtime_closure_sha256: runtimePreflight?.closure_sha256,
    execution_unit_id: executionUnitId,
    lane_cursor_ref: laneCursorRef,
    queue_cursor_ref: queueCursorRef,
    admission_sha256: null,
  };
  body.admission_sha256 = canonicalDigest(body);
  return validateSchedulerAdmissionReceipt(body, {candidateCommit, candidateTree, requestId});
}
