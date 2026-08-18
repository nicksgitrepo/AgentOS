import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, canonicalJson} from "../../control/content-addressing.mjs";
import {selectEcoModelRoute} from "../../control/eco-model-policy.mjs";
import {compileGlobalGovernanceBootstrap, openGlobalGovernanceAuthorityStore, requireGlobalGovernanceRoleProjection} from "../../control/global-governance-bootstrap.mjs";
import {GLOBAL_GOVERNANCE_MEMORY_GENESIS, compileGlobalGovernanceMemoryEvent, compileGlobalGovernanceMemoryReadback} from "../../control/global-governance-memory.mjs";
import {getSealedCanonicalAuthority} from "../../control/sealed-canonical-authority.mjs";
import {prepareInstalledGlobalGovernanceProvisioning} from "../../control/installed-global-governance-provisioning.mjs";

export function compileTestGlobalGovernance({nowUtc = "2026-08-18T08:30:00.000Z"} = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
  snapshot.status = "ACCEPTED_ACTIVE"; snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null});
  const event = compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: nowUtc});
  const events = [event];
  const readback = compileGlobalGovernanceMemoryReadback({events, historicalActivationReceiptSha256: canonicalDigest({receipt: "historical-test-activation"}), observedAtUtc: nowUtc});
  const route = selectEcoModelRoute({snapshot, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE", "TOOLS"], nowUtc});
  const bootstrap = compileGlobalGovernanceBootstrap({events, readback, observedAtUtc: nowUtc});
  const context = {bootstrap, events, readback, observedAtUtc: nowUtc};
  return {snapshot, route, ...context, projection: (roleClass) => requireGlobalGovernanceRoleProjection({...context, roleClass})};
}

export function materializeTestGlobalGovernanceStore({authorityRoot, nowUtc = "2026-08-18T08:30:00.000Z"} = {}) {
  const fixture = compileTestGlobalGovernance({nowUtc});
  const directory = path.join(authorityRoot, "global-governance");
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, "model-policy-events.jsonl"), `${fixture.events.map((event) => canonicalJson(event)).join("\n")}\n`);
  fs.writeFileSync(path.join(directory, "current-readback.v1.json"), `${canonicalJson(fixture.readback)}\n`);
  fs.writeFileSync(path.join(directory, "current-bootstrap.v1.json"), `${canonicalJson(fixture.bootstrap)}\n`);
  const sealedAuthority = getSealedCanonicalAuthority();
  const storeProvisioning = prepareInstalledGlobalGovernanceProvisioning({sealedAuthority, installedStoreRoot: authorityRoot, bootstrapSha256: fixture.bootstrap.bootstrap_sha256});
  return {...fixture, authorityStore: openGlobalGovernanceAuthorityStore({sealedAuthority, storeProvisioning})};
}
