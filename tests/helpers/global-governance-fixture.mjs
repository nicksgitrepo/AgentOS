import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../../control/content-addressing.mjs";
import {selectEcoModelRoute} from "../../control/eco-model-policy.mjs";
import {compileGlobalGovernanceBootstrap, requireGlobalGovernanceRoleProjection} from "../../control/global-governance-bootstrap.mjs";
import {GLOBAL_GOVERNANCE_MEMORY_GENESIS, compileGlobalGovernanceMemoryEvent, compileGlobalGovernanceMemoryReadback} from "../../control/global-governance-memory.mjs";

export function compileTestGlobalGovernance({nowUtc = "2026-08-18T16:30:00.000Z"} = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
  snapshot.status = "ACCEPTED_ACTIVE"; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null});
  const event = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.TEST", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: nowUtc});
  const events = [event];
  const readback = compileGlobalGovernanceMemoryReadback({events, historicalActivationReceiptSha256: canonicalDigest({receipt: "historical-test-activation"}), observedAtUtc: nowUtc});
  const route = selectEcoModelRoute({snapshot, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE", "TOOLS"], nowUtc});
  const bootstrap = compileGlobalGovernanceBootstrap({events, readback, workerRoute: route, observedAtUtc: nowUtc});
  const context = {bootstrap, events, readback, observedAtUtc: nowUtc};
  return {snapshot, route, ...context, projection: (roleClass) => requireGlobalGovernanceRoleProjection({...context, roleClass})};
}
