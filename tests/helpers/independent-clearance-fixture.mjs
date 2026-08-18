import {generateKeyPairSync, randomUUID, sign} from "node:crypto";
import {canonicalDigest} from "../../control/content-addressing.mjs";
import {INDEPENDENT_CLEARANCE_SCOPE, verifyIndependentSpawnerClearance} from "../../control/independent-spawner-clearance.mjs";

export function independentlyVerifyTestCandidate(candidate, {nowUtc = "2026-08-18T12:00:00.000Z", mutateReceipt = null, mutateRegistry = null, usedReceiptSha256s = []} = {}) {
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const registry = {
    schema: "agentos.independent_evaluator_registry.v1", version: 1, registry_id: "REGISTRY.INDEPENDENT.EVALUATORS.TEST",
    evaluators: [{
      issuer_id: "EVALUATOR.INDEPENDENT.TEST", role_id: "AGENT.INDEPENDENT_EVALUATOR", status: "ADMITTED",
      admission_receipt_sha256: canonicalDigest({admission: "independently-admitted-test-evaluator"}),
      public_key_pem: publicKey.export({type: "spki", format: "pem"}),
      separated_from_roles: ["AGENT.BUILDER", "AGENT.CONTROLLER", "AGENT.SPAWNER_COMPILER"],
      valid_from_utc: "2026-08-17T00:00:00.000Z", expires_at_utc: "2026-08-25T00:00:00.000Z",
    }], registry_sha256: null,
  };
  if (mutateRegistry) mutateRegistry(registry);
  registry.registry_sha256 = canonicalDigest({...registry, registry_sha256: null});
  const receipt = {
    schema: "agentos.independent_spawner_clearance.v1", version: 1, receipt_id: "CLEARANCE.SPAWNER.TEST",
    issuer_id: "EVALUATOR.INDEPENDENT.TEST", issuer_role: "AGENT.INDEPENDENT_EVALUATOR", subject_role: "AGENT.SPAWNER_COMPILER", result: "PASS",
    candidate: structuredClone(candidate), scope: [...INDEPENDENT_CLEARANCE_SCOPE],
    custody: {worktree_id: "WORKTREE.INDEPENDENT.TEST", detached: true, clean: true, source_preserved: true, builder_separated: true},
    issued_at_utc: "2026-08-18T11:00:00.000Z", expires_at_utc: "2026-08-19T11:00:00.000Z",
    nonce_sha256: canonicalDigest({nonce: randomUUID()}), receipt_sha256: null, signature_base64: null,
  };
  if (mutateReceipt) mutateReceipt(receipt);
  receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null, signature_base64: null});
  receipt.signature_base64 = sign(null, Buffer.from(receipt.receipt_sha256, "hex"), privateKey).toString("base64");
  return {clearance: verifyIndependentSpawnerClearance({receipt, registry, trustedRegistrySha256: registry.registry_sha256, expectedCandidate: candidate, nowUtc, usedReceiptSha256s}), receipt, registry};
}
