import { createHash } from "node:crypto";

export const SPECIALIST_LIBRARY_INTAKE_SCHEMA = "agentos.specialist_library_intake_handoff.v1";
export const SPECIALIST_LIBRARY_READY_STATUS = "SPECIALIST_GATE_LIBRARY_READY_FOR_AGENTOS_INTAKE";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");

function assert(condition, code) {
  if (!condition) throw new Error(`SPECIALIST_LIBRARY_INTAKE_${code}`);
}

function exactKeys(value, expected, code) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT_REQUIRED`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${code}_FIELDS_INVALID`);
}

function safeRelativePath(value, code) {
  assert(typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0"), `${code}_PATH_INVALID`);
  assert(value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."), `${code}_PATH_INVALID`);
}

export function validateSpecialistLibraryIntake(handoff) {
  exactKeys(handoff, ["schema", "version", "status", "lifecycle", "activation", "candidate", "truth", "artifacts", "proof", "authority", "intake_sha256"], "HANDOFF");
  assert(handoff.schema === SPECIALIST_LIBRARY_INTAKE_SCHEMA && handoff.version === 1, "SCHEMA_INVALID");
  assert(handoff.status === SPECIALIST_LIBRARY_READY_STATUS, "STATUS_NOT_READY");
  assert(handoff.lifecycle === "CANDIDATE_INACTIVE" && handoff.activation === "OFF", "ACTIVATION_FORBIDDEN");

  exactKeys(handoff.candidate, ["commit", "tree", "manifest_sha256", "roster_sha256"], "CANDIDATE");
  assert(GIT_OBJECT.test(handoff.candidate.commit) && GIT_OBJECT.test(handoff.candidate.tree), "CANDIDATE_GIT_IDENTITY_INVALID");
  assert(SHA256.test(handoff.candidate.manifest_sha256) && SHA256.test(handoff.candidate.roster_sha256), "CANDIDATE_DIGEST_INVALID");

  exactKeys(handoff.truth, ["address_count", "compileable_count", "planned_count", "not_applicable_count", "dependency_complete"], "TRUTH");
  for (const field of ["address_count", "compileable_count", "planned_count", "not_applicable_count"]) {
    assert(Number.isSafeInteger(handoff.truth[field]) && handoff.truth[field] >= 0, `TRUTH_${field.toUpperCase()}_INVALID`);
  }
  assert(handoff.truth.address_count > 0
    && handoff.truth.compileable_count + handoff.truth.planned_count + handoff.truth.not_applicable_count === handoff.truth.address_count,
  "TRUTH_COUNT_MISMATCH");
  assert(handoff.truth.dependency_complete === true, "DEPENDENCY_CLOSURE_UNPROVEN");

  exactKeys(handoff.artifacts, ["manifest_path", "roster_path", "coverage_path", "migration_path", "invalidation_path"], "ARTIFACTS");
  for (const [field, value] of Object.entries(handoff.artifacts)) safeRelativePath(value, `ARTIFACTS_${field.toUpperCase()}`);

  exactKeys(handoff.proof, ["focused_tests_sha256", "independent_clearance_sha256", "remote_readback_commit", "remote_readback_tree"], "PROOF");
  assert(SHA256.test(handoff.proof.focused_tests_sha256) && SHA256.test(handoff.proof.independent_clearance_sha256), "PROOF_DIGEST_INVALID");
  assert(handoff.proof.remote_readback_commit === handoff.candidate.commit && handoff.proof.remote_readback_tree === handoff.candidate.tree, "REMOTE_READBACK_MISMATCH");

  exactKeys(handoff.authority, ["self_admission", "product_mutation", "activation", "merge"], "AUTHORITY");
  assert(handoff.authority.self_admission === false && handoff.authority.product_mutation === false
    && handoff.authority.activation === false && handoff.authority.merge === false, "AUTHORITY_ESCALATION");
  assert(SHA256.test(handoff.intake_sha256)
    && handoff.intake_sha256 === digest({...handoff, intake_sha256: null}), "DIGEST_MISMATCH");
  return Object.freeze(structuredClone(handoff));
}

export function compileSpecialistLibraryIntakeState(handoff = null) {
  if (handoff === null) return Object.freeze({
    status: "SPECIALIST_GATE_LIBRARY_EXTERNAL_CUSTODY",
    intake_status: "NOT_RECEIVED",
    admitted: false,
    activation: "OFF",
    accepted_candidate: null,
    roster_truth: null,
    authority_effect_grants: Object.freeze([]),
  });
  const accepted = validateSpecialistLibraryIntake(handoff);
  return Object.freeze({
    status: "SPECIALIST_GATE_LIBRARY_TYPED_HANDOFF_VERIFIED",
    intake_status: "PACKET_VERIFIED_PENDING_INDEPENDENT_AGENTOS_ADMISSION",
    admitted: false,
    activation: "OFF",
    accepted_candidate: Object.freeze({...accepted.candidate}),
    roster_truth: Object.freeze({...accepted.truth}),
    authority_effect_grants: Object.freeze([]),
  });
}

export function specialistLibraryIntakeDigest(value) { return digest(value); }
