#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  APPRENTICESHIP_NATIVE_RUN_SCHEMA,
  HARDENED_SCHEMA_FILES,
  compileApprenticeshipRolePacket,
  compileProvenance,
  runApprenticeshipNativeObservation,
  validateApprenticeshipRolePacket,
  validateStrictSchemaBundle,
} from "../control/apprenticeship-contracts.mjs";
import {
  compileNativeHostAttachment,
  validateNativeHostAttachment,
} from "../control/native-host-attachment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = (value) => `ref:${value}`;
const sourceRef = `sha1:${"3".repeat(40)}`;
const treeRef = `sha1:${"4".repeat(40)}`;
const time = "2026-08-06T14:00:00.000Z";

function provenance() {
  return compileProvenance({
    projectRef: ref("project"),
    campaignRef: ref("campaign"),
    goalRef: ref("goal"),
    sourceRef,
    treeRef,
    workspaceRef: ref("workspace"),
    environmentRef: ref("environment"),
    workerRef: ref("worker"),
    workerSessionRef: null,
    orchestratorRef: ref("orchestrator"),
    orchestratorSessionRef: ref("orchestrator-session"),
    learnerRef: null,
    learnerSessionRef: null,
    auditorRef: null,
    auditorSessionRef: null,
    reproductionRef: null,
    reproductionSessionRef: null,
    reviewerRef: null,
    reviewerSessionRef: null,
    modelRef: ref("model"),
    predecessorHandoffRef: null,
  });
}

const schemaDocuments = HARDENED_SCHEMA_FILES.map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")));
validateStrictSchemaBundle(schemaDocuments);

const packet = compileApprenticeshipRolePacket({
  packetId: "PACKET-NATIVE-001",
  provenance: provenance(),
  ownerIntentRef: ref("owner-intent"),
  taskRequestRef: ref("task-request"),
  taskPattern: "BOUNDED_REAL_TASK_OBSERVATION",
  boundedScope: ["CONTROL_PLANE"],
  doneWhen: "The worker returns a source-bound result, host-attested evidence, and typed handoff before closure.",
  predecessorHandoffRef: null,
  createdAt: time,
});
validateApprenticeshipRolePacket(packet);
assert.equal(packet.schema, "agentos.apprenticeship_role_packet.v1");
assert.equal(packet.status, "READY_FOR_NATIVE_OBSERVATION");
assert.equal(packet.host_contract.external_attachment_required, true);
assert.equal(packet.host_contract.real_bounded_work_required, true);
assert.equal(packet.host_contract.synthetic_receipts_allowed, false);
assert.equal(packet.activation_allowed, false);
assert.equal(Object.hasOwn(packet, "task_instruction"), false, "raw task instruction must remain runtime-only");
assert.equal(Object.hasOwn(packet, "source_binding"), false, "raw source binding must remain runtime-only");
assert.equal(Object.hasOwn(packet, "host_attachment"), false, "host attachment must remain runtime-only");

const revokedPacket = compileApprenticeshipRolePacket({
  packetId: "PACKET-NATIVE-REVOKED-001",
  provenance: provenance(),
  ownerIntentRef: ref("owner-intent"),
  taskRequestRef: ref("task-request"),
  taskPattern: "BOUNDED_REAL_TASK_OBSERVATION",
  boundedScope: ["CONTROL_PLANE"],
  doneWhen: "The revoked packet must never reach a host.",
  revocationStatus: "REVOKED",
  revocationRef: ref("revocation-001"),
  createdAt: time,
});
assert.equal(revokedPacket.status, "REVOKED");
await assert.rejects(() => runApprenticeshipNativeObservation({
  runId: "RUN-NATIVE-REVOKED-001",
  packet: revokedPacket,
}), /revoked apprenticeship role packet/u);

const attachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-001",
  hostId: "host-runtime",
  projectId: "PROJECT",
  environmentId: "ENVIRONMENT",
  attachedAtUtc: time,
});
validateNativeHostAttachment(attachment);
const unsafeAttachment = structuredClone(attachment);
unsafeAttachment.model = "password=leaked";
assert.throws(() => validateNativeHostAttachment(unsafeAttachment), /persisted record contains forbidden categories/u);

let hostCalls = 0;
const hostThatMustNotRun = new Proxy({}, {
  get() {
    hostCalls += 1;
    return () => { throw new Error("host must not be called without an attachment"); };
  },
});

await assert.rejects(() => runApprenticeshipNativeObservation({
  runId: "RUN-NATIVE-HOSTILE-001",
  packet,
  host: hostThatMustNotRun,
  hostAttachment: null,
  runtimeBinding: {
    project_id: "PROJECT",
    campaign_id: "CAMPAIGN",
    campaign_version: "VERSION",
    environment_id: "ENVIRONMENT",
    cwd: "HOST_RUNTIME_CWD",
    git_top_level: "HOST_RUNTIME_ROOT",
    source_commit: "SOURCE_COMMIT",
    source_tree: "SOURCE_TREE",
  },
  taskInstruction: "Perform the bounded task and return a typed handoff.",
  observedAt: time,
}), (error) => error?.code === "APPRENTICESHIP_HOST_ATTACHMENT_REQUIRED");
assert.equal(hostCalls, 0, "missing attachment must stop before host calls");

await assert.rejects(() => runApprenticeshipNativeObservation({
  runId: "RUN-NATIVE-HOSTILE-002",
  packet,
  host: null,
  runtimeBinding: {
    project_id: "PROJECT",
    campaign_id: "CAMPAIGN",
    campaign_version: "VERSION",
    environment_id: "ENVIRONMENT",
    cwd: "HOST_RUNTIME_CWD",
    git_top_level: "HOST_RUNTIME_ROOT",
    source_commit: "SOURCE_COMMIT",
    source_tree: "SOURCE_TREE",
  },
  taskInstruction: "Perform the bounded task and return a typed handoff.",
  observedAt: time,
}), (error) => error?.code === "APPRENTICESHIP_HOST_ADAPTER_REQUIRED");

const tampered = structuredClone(packet);
tampered.activation_allowed = true;
assert.throws(() => validateApprenticeshipRolePacket(tampered), /cannot allow activation/u);

const tamperedContract = structuredClone(packet);
tamperedContract.host_contract.synthetic_receipts_allowed = true;
assert.throws(() => validateApprenticeshipRolePacket(tamperedContract), /synthetic receipts/u);

assert.equal(APPRENTICESHIP_NATIVE_RUN_SCHEMA, "agentos.apprenticeship_native_observation_run.v1");
console.log(JSON.stringify({
  status: "PASS",
  phase: "NATIVE_OBSERVATION_BOUNDARY",
  strict_schemas: schemaDocuments.length,
  packet_status: packet.status,
  live_worker_run: false,
  host_calls_without_attachment: hostCalls,
  hostile_cases: 4,
}));
