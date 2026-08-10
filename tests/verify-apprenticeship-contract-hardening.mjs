#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  APPRENTICESHIP_MODE,
  HARDENED_SCHEMA_FILES,
  STATE_TRANSITION_SCHEMA,
  compileApprenticeshipAdmission,
  compileApprenticeshipRecordEnvelope,
  compileApprenticeshipStateTransition,
  compileEvidenceAttestation,
  compileProvenance,
  validateApprenticeshipAdmission,
  validateApprenticeshipRecordEnvelope,
  validateApprenticeshipStateTransition,
  validateEvidenceAttestation,
  validateStrictSchemaBundle,
} from "../control/apprenticeship-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const sourceRef = `sha1:${"1".repeat(40)}`;
const treeRef = `sha1:${"2".repeat(40)}`;
const ref = (value) => `ref:${value}`;
const time = (minute) => `2026-08-06T13:${String(minute).padStart(2, "0")}:00.000Z`;

function provenance(overrides = {}) {
  return compileProvenance({
    projectRef: ref("project"),
    campaignRef: ref("campaign"),
    goalRef: ref("goal"),
    sourceRef,
    treeRef,
    workspaceRef: ref("workspace"),
    environmentRef: ref("environment"),
    workerRef: ref("worker"),
    workerSessionRef: ref("worker-session"),
    orchestratorRef: ref("orchestrator"),
    orchestratorSessionRef: ref("orchestrator-session"),
    learnerRef: ref("worker"),
    learnerSessionRef: ref("worker-session"),
    auditorRef: ref("workflow-auditor"),
    auditorSessionRef: ref("workflow-auditor-session"),
    reproductionRef: null,
    reproductionSessionRef: null,
    reviewerRef: ref("independent-auditor"),
    reviewerSessionRef: ref("independent-auditor-session"),
    modelRef: ref("model"),
    predecessorHandoffRef: ref("predecessor"),
    ...overrides,
  });
}

const schemaDocuments = HARDENED_SCHEMA_FILES.map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")));
validateStrictSchemaBundle(schemaDocuments);

const hostAttestation = compileEvidenceAttestation({
  attestationId: "ATTEST-HOST-001",
  attestationType: "HOST_READBACK",
  authority: "EXTERNAL_HOST",
  subjectRef: ref("worker"),
  subjectSessionRef: ref("worker-session"),
  operation: "READ",
  resultStatus: "SUCCEEDED",
  evidenceRef: ref("host-readback-evidence"),
  evidenceSha256: SHA_A,
  attestorRef: ref("external-host"),
  attestorSessionRef: ref("external-host-session"),
  provenance: provenance(),
  sourceMatch: true,
  scopeMatch: true,
  identityMatch: true,
  boundaryDecision: "IN_SCOPE",
  observedAt: time(1),
});
validateEvidenceAttestation(hostAttestation);

const auditorAttestation = compileEvidenceAttestation({
  attestationId: "ATTEST-AUDITOR-001",
  attestationType: "AUDITOR_ASSERTION",
  authority: "WORKFLOW_AUDITOR",
  subjectRef: ref("worker"),
  subjectSessionRef: ref("worker-session"),
  operation: "COMPARE",
  resultStatus: "SUCCEEDED",
  evidenceRef: ref("auditor-evidence"),
  evidenceSha256: SHA_B,
  attestorRef: ref("workflow-auditor"),
  attestorSessionRef: ref("workflow-auditor-session"),
  provenance: provenance(),
  sourceMatch: true,
  scopeMatch: true,
  identityMatch: true,
  boundaryDecision: "IN_SCOPE",
  observedAt: time(2),
});
validateEvidenceAttestation(auditorAttestation);

const preparedAdmission = compileApprenticeshipAdmission({
  admissionId: "ADMISSION-001",
  status: "PREPARED",
  planRef: ref("plan"),
  ownerIntentRef: ref("owner-intent"),
  provenance: provenance(),
  allowedScope: ["CONTROL_PLANE"],
  createdAt: time(3),
});
validateApprenticeshipAdmission(preparedAdmission);

const admittedAdmission = compileApprenticeshipAdmission({
  admissionId: "ADMISSION-002",
  status: "ADMITTED",
  planRef: ref("plan"),
  ownerIntentRef: ref("owner-intent"),
  provenance: provenance(),
  allowedScope: ["CONTROL_PLANE"],
  hostCapabilityRef: ref("host-capability"),
  hostAttestationRef: `digest:${hostAttestation.digest}`,
  hostAttestation,
  createdAt: time(4),
});
validateApprenticeshipAdmission(admittedAdmission);

const envelope = compileApprenticeshipRecordEnvelope({
  recordId: "RECORD-001",
  recordType: "OBSERVATION",
  state: "OWNER_BOUND",
  payloadSchema: "agentos.apprenticeship_observation.v1",
  payloadDigest: SHA_A,
  provenance: provenance(),
  evidenceAttestationRefs: [`digest:${hostAttestation.digest}`, `digest:${auditorAttestation.digest}`],
  actorRef: ref("worker"),
  actorSessionRef: ref("worker-session"),
  actorRole: "APPRENTICESHIP_WORKER",
  createdAt: time(5),
});
validateApprenticeshipRecordEnvelope(envelope);

const transition = compileApprenticeshipStateTransition({
  transitionId: "TRANSITION-001",
  recordRef: `digest:${envelope.digest}`,
  fromState: "DRAFT",
  toState: "OWNER_BOUND",
  reasonCode: "OWNER_BOUND",
  authority: "APPRENTICESHIP_WORKER",
  actorRef: ref("worker"),
  actorSessionRef: ref("worker-session"),
  provenance: provenance(),
  evidenceAttestationRefs: [`digest:${hostAttestation.digest}`],
  observedAt: time(6),
});
assert.equal(transition.schema, STATE_TRANSITION_SCHEMA);
validateApprenticeshipStateTransition(transition);

assert.equal(preparedAdmission.mode, APPRENTICESHIP_MODE);
assert.equal(preparedAdmission.activation_allowed, false);
assert.equal(envelope.activation_allowed, false);
assert.equal(transition.activation_allowed, false);

assert.throws(() => compileEvidenceAttestation({
  attestationId: "ATTEST-HOST-HOSTILE-001",
  attestationType: "HOST_READBACK",
  authority: "EXTERNAL_HOST",
  subjectRef: ref("worker"),
  operation: "READ",
  resultStatus: "SUCCEEDED",
  evidenceRef: ref("host-readback-evidence"),
  evidenceSha256: SHA_A,
  attestorRef: ref("external-host"),
  attestorSessionRef: ref("external-host-session"),
  provenance: provenance(),
  sourceMatch: false,
  scopeMatch: true,
  identityMatch: true,
  boundaryDecision: "IN_SCOPE",
  observedAt: time(7),
}), /source binding/u, "successful evidence cannot ignore source binding");

assert.throws(() => compileEvidenceAttestation({
  attestationId: "ATTEST-AUDITOR-HOSTILE-001",
  attestationType: "AUDITOR_ASSERTION",
  authority: "WORKFLOW_AUDITOR",
  subjectRef: ref("worker"),
  operation: "COMPARE",
  resultStatus: "SUCCEEDED",
  evidenceRef: ref("auditor-evidence"),
  evidenceSha256: SHA_B,
  attestorRef: ref("not-the-auditor"),
  attestorSessionRef: ref("not-the-auditor-session"),
  provenance: provenance(),
  sourceMatch: true,
  scopeMatch: true,
  identityMatch: true,
  boundaryDecision: "IN_SCOPE",
  observedAt: time(8),
}), /provenance-bound/u, "auditor evidence must be identity-bound");

assert.throws(() => compileApprenticeshipAdmission({
  admissionId: "ADMISSION-HOSTILE-001",
  status: "ADMITTED",
  planRef: ref("plan"),
  ownerIntentRef: ref("owner-intent"),
  provenance: provenance(),
  allowedScope: ["CONTROL_PLANE"],
  createdAt: time(9),
}), /host capability reference/u, "admission cannot be admitted without host capability");

const unsafeEnvelope = structuredClone(envelope);
unsafeEnvelope.actor_ref = "/private/worker";
assert.throws(() => validateApprenticeshipRecordEnvelope(unsafeEnvelope), /opaque or content-addressed reference|provenance-bound|absolute path/u, "private actor paths cannot enter an envelope");

const activatingEnvelope = structuredClone(envelope);
activatingEnvelope.activation_allowed = true;
assert.throws(() => validateApprenticeshipRecordEnvelope(activatingEnvelope), /allow activation/u, "envelopes cannot activate");

assert.throws(() => compileApprenticeshipStateTransition({
  transitionId: "TRANSITION-HOSTILE-001",
  recordRef: ref("record"),
  fromState: "DRAFT",
  toState: "ARCHIVED",
  reasonCode: "SKIP",
  authority: "RUNTIME",
  actorRef: ref("orchestrator"),
  actorSessionRef: ref("orchestrator-session"),
  provenance: provenance(),
  observedAt: time(10),
}), /invalid apprenticeship transition/u, "state transitions cannot skip lifecycle states");

assert.throws(() => compileApprenticeshipStateTransition({
  transitionId: "TRANSITION-HOSTILE-002",
  recordRef: ref("record"),
  fromState: "OWNER_REVIEW_REQUIRED",
  toState: "OWNER_APPROVED_PENDING_ACTIVATION",
  reasonCode: "OWNER_APPROVAL",
  authority: "RUNTIME",
  actorRef: ref("orchestrator"),
  actorSessionRef: ref("orchestrator-session"),
  provenance: provenance(),
  observedAt: time(11),
}), /owner decision reference/u, "owner approval state requires a separate owner decision");

const schemaWithExtraProperty = structuredClone(schemaDocuments[1]);
schemaWithExtraProperty.additionalProperties = true;
assert.throws(() => validateStrictSchemaBundle([schemaWithExtraProperty]), /additional properties/u, "strict schemas must reject additional properties");

console.log(JSON.stringify({
  status: "PASS",
  phase: "CONTRACT_HARDENING",
  strict_schemas: schemaDocuments.length,
  attestations: 2,
  admissions: 2,
  envelopes: 1,
  transitions: 1,
  hostile_cases: 8,
  live_host_evidence: false,
}));
