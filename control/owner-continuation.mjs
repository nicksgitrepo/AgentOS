import {assert, digestWithout, sha256} from "./canonical-json.mjs";

export const OWNER_CONTINUATION_SCHEMA = "agentos.owner_continuation.v1";
export const OWNER_RESUME_REQUEST_SCHEMA = "agentos.owner_resume_request.v1";

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const STATUSES = new Set(["WAITING_OWNER", "RESUME_PENDING", "RESUMED", "REJECTED", "BLOCKED"]);
const PROTECTED_ACTIONS = new Set([
  "PUBLISH", "PUSH", "MERGE", "DEPLOY", "ROLLBACK", "SPEND", "AUTHENTICATE", "REVEAL_SECRET", "DELETE_ACCEPTED_WORK",
]);

const CONTINUATION_FIELDS = [
  "schema", "version", "status", "activation_id", "project_id", "campaign_id", "campaign_version", "goal_id",
  "question_id", "expected_value", "protected_actions", "owner_answer", "resume_request", "admission", "failure", "digest",
];

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function identity(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }

function expectedValue(value, label) {
  assert((typeof value === "string" && value.length > 0) || typeof value === "boolean", `${label} must be a string or boolean`);
}

function validateProtectedActions(actions) {
  assert(Array.isArray(actions) && actions.length > 0, "protected_actions must not be empty");
  assert(actions.every((action) => typeof action === "string" && PROTECTED_ACTIONS.has(action)), "protected_actions contains an unknown action");
  assert(new Set(actions).size === actions.length, "protected_actions contains duplicates");
}

function validateOwnerAnswer(answer) {
  exactKeys(answer, ["question_id", "answer", "value"], "owner answer");
  identity(answer.question_id, "owner answer question_id");
  nonempty(answer.answer, "owner answer answer");
  expectedValue(answer.value, "owner answer value");
}

function validateResumeRequest(request) {
  exactKeys(request, ["schema", "version", "activation_id", "project_id", "campaign_id", "campaign_version", "goal_id", "question_id", "owner_answer", "protected_actions", "digest"], "owner resume request");
  assert(request.schema === OWNER_RESUME_REQUEST_SCHEMA && request.version === 1, "owner resume request identity is invalid");
  for (const [field, label] of [["activation_id", "activation_id"], ["project_id", "project_id"], ["campaign_id", "campaign_id"], ["campaign_version", "campaign_version"], ["goal_id", "goal_id"], ["question_id", "question_id"]]) identity(request[field], label);
  validateOwnerAnswer(request.owner_answer);
  validateProtectedActions(request.protected_actions);
  assert(DIGEST.test(request.digest) && request.digest === digestWithout(request, "digest"), "owner resume request digest does not match content");
  return request;
}

function seal(value) {
  const sealed = {...value, digest: null};
  sealed.digest = digestWithout(sealed, "digest");
  return validateOwnerContinuation(sealed);
}

export function ownerAnswerDigest(answer) {
  validateOwnerAnswer(answer);
  return sha256(answer);
}

export function createOwnerContinuation({activation_id, project_id, campaign_id, campaign_version, goal_id, question_id, expected_value, protected_actions}) {
  for (const [field, value] of [["activation_id", activation_id], ["project_id", project_id], ["campaign_id", campaign_id], ["campaign_version", campaign_version], ["goal_id", goal_id], ["question_id", question_id]]) identity(value, field);
  expectedValue(expected_value, "expected_value");
  validateProtectedActions(protected_actions);
  return seal({
    schema: OWNER_CONTINUATION_SCHEMA,
    version: 1,
    status: "WAITING_OWNER",
    activation_id,
    project_id,
    campaign_id,
    campaign_version,
    goal_id,
    question_id,
    expected_value,
    protected_actions: [...protected_actions],
    owner_answer: null,
    resume_request: null,
    admission: null,
    failure: null,
    digest: null,
  });
}

export function validateOwnerContinuation(record) {
  exactKeys(record, CONTINUATION_FIELDS, "owner continuation");
  assert(record.schema === OWNER_CONTINUATION_SCHEMA && record.version === 1, "owner continuation identity is invalid");
  assert(STATUSES.has(record.status), "owner continuation status is invalid");
  for (const [field, value] of [["activation_id", record.activation_id], ["project_id", record.project_id], ["campaign_id", record.campaign_id], ["campaign_version", record.campaign_version], ["goal_id", record.goal_id], ["question_id", record.question_id]]) identity(value, field);
  expectedValue(record.expected_value, "expected_value");
  validateProtectedActions(record.protected_actions);
  if (record.owner_answer !== null) validateOwnerAnswer(record.owner_answer);
  if (record.resume_request !== null) validateResumeRequest(record.resume_request);
  if (record.admission !== null) {
    exactKeys(record.admission, ["status", "admission_id", "request_digest"], "admission receipt");
    assert(record.admission.status === "ADMITTED", "admission receipt status is invalid");
    nonempty(record.admission.admission_id, "admission receipt admission_id");
    assert(DIGEST.test(record.admission.request_digest), "admission receipt request_digest is invalid");
  }
  if (record.failure !== null) {
    exactKeys(record.failure, ["code", "message"], "continuation failure");
    nonempty(record.failure.code, "continuation failure code");
    nonempty(record.failure.message, "continuation failure message");
  }
  if (record.status === "WAITING_OWNER") {
    assert(record.owner_answer === null && record.resume_request === null && record.admission === null && record.failure === null, "waiting owner continuation must be unresolved");
  } else if (record.status === "RESUME_PENDING") {
    assert(record.owner_answer !== null && record.resume_request !== null && record.admission === null && record.failure === null, "pending owner continuation must carry a resume request");
  } else if (record.status === "RESUMED") {
    assert(record.owner_answer !== null && record.resume_request !== null && record.admission !== null && record.failure === null, "resumed owner continuation is incomplete");
    assert(record.admission.request_digest === record.resume_request.digest, "admission receipt is not bound to the resume request");
  } else if (record.status === "REJECTED") {
    assert(record.owner_answer !== null && record.resume_request === null && record.admission === null && record.failure !== null, "rejected owner continuation is incomplete");
  } else if (record.status === "BLOCKED") {
    assert(record.owner_answer !== null && record.resume_request !== null && record.admission === null && record.failure !== null, "blocked owner continuation is incomplete");
  }
  assert(DIGEST.test(record.digest) && record.digest === digestWithout(record, "digest"), "owner continuation digest does not match content");
  return record;
}

export function acceptOwnerAnswer(record, answer) {
  validateOwnerContinuation(record);
  if (record.status !== "WAITING_OWNER") return record;
  validateOwnerAnswer(answer);
  if (answer.question_id !== record.question_id || answer.value !== record.expected_value) {
    return seal({
      ...record,
      status: "REJECTED",
      owner_answer: {...answer},
      resume_request: null,
      admission: null,
      failure: {code: "OWNER_ANSWER_MISMATCH", message: "The recorded answer does not match the prepared in-scope choice."},
      digest: null,
    });
  }
  const resume_request = {
    schema: OWNER_RESUME_REQUEST_SCHEMA,
    version: 1,
    activation_id: record.activation_id,
    project_id: record.project_id,
    campaign_id: record.campaign_id,
    campaign_version: record.campaign_version,
    goal_id: record.goal_id,
    question_id: record.question_id,
    owner_answer: {...answer},
    protected_actions: [...record.protected_actions],
    digest: null,
  };
  resume_request.digest = digestWithout(resume_request, "digest");
  validateResumeRequest(resume_request);
  return seal({
    ...record,
    status: "RESUME_PENDING",
    owner_answer: {...answer},
    resume_request,
    admission: null,
    failure: null,
    digest: null,
  });
}

function adapterReceipt(receipt, requestDigest) {
  exactKeys(receipt, ["status", "admission_id", "request_digest"], "admission receipt");
  assert(receipt.status === "ADMITTED" && typeof receipt.admission_id === "string" && receipt.admission_id.length > 0, "admission adapter did not return an admitted receipt");
  assert(receipt.request_digest === requestDigest, "admission receipt is bound to a different resume request");
  return {...receipt};
}

export function createOwnerContinuationRunner({admit}) {
  assert(typeof admit === "function", "admit must be a function");
  const inFlight = new Map();

  async function resumeAfterOwnerAnswer(record, answer = null) {
    validateOwnerContinuation(record);
    if (["RESUMED", "REJECTED", "BLOCKED"].includes(record.status)) return record;
    const pending = record.status === "WAITING_OWNER" ? acceptOwnerAnswer(record, answer) : record;
    if (pending.status !== "RESUME_PENDING") return pending;
    const key = pending.resume_request.digest;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      try {
        const receipt = adapterReceipt(await admit({...pending.resume_request}), pending.resume_request.digest);
        return seal({...pending, status: "RESUMED", admission: receipt, failure: null, digest: null});
      } catch (error) {
        return seal({
          ...pending,
          status: "BLOCKED",
          admission: null,
          failure: {code: "ADMISSION_RESUME_FAILED", message: error instanceof Error ? error.message : String(error)},
          digest: null,
        });
      }
    })();
    inFlight.set(key, operation);
    try { return await operation; }
    finally { inFlight.delete(key); }
  }

  return Object.freeze({resumeAfterOwnerAnswer});
}
