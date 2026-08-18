#!/usr/bin/env node

/* Spawner-exclusive agent lifecycle and safe-despawn governance. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AGENT_LIFECYCLE_CUSTODY_SCHEMA = "agentos.agent_lifecycle_custody.v1";
export const SPAWN_AUTHORITIES = Object.freeze(["BOOTSTRAP_ONE_TIME_SPAWNER_START", "SPAWNER"]);
export const TEMPORARY_ROLE_KINDS = Object.freeze(["BUILDER", "AUDITOR", "VALIDATOR", "HOSTILE_CRITIC", "ESCALATION_BUILDER"]);

const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function body(value) { return {...structuredClone(value), receipt_sha256: null}; }

export function authorizeAgentSpawn({issuerRole, requestedRole, bootstrapSpawnerStarted = false, worktreeRef = null, partnerAuditorIds = []} = {}) {
  id(issuerRole, "spawn issuer"); id(requestedRole, "requested role");
  const bootstrapException = issuerRole === "AGENTOS.BOOTSTRAP" && requestedRole === "AGENTOS.SPAWNER" && bootstrapSpawnerStarted === false;
  const spawnerAuthority = issuerRole === "AGENTOS.SPAWNER";
  assert(bootstrapException || spawnerAuthority, "Only Bootstrap may start the first Spawner; after that only Spawner may create agents");
  if (requestedRole.includes("BUILDER")) {
    assert(typeof worktreeRef === "string" && /^opaque:worktree:/u.test(worktreeRef), "Builder spawn requires an attached isolated worktree");
    assert(Array.isArray(partnerAuditorIds) && partnerAuditorIds.length === 6 && new Set(partnerAuditorIds).size === 6, "Collaborative builder spawn requires six distinct partner auditors");
    partnerAuditorIds.forEach((value) => id(value, "partner auditor"));
  }
  const receipt = {schema: "agentos.agent_spawn_authorization.v1", version: 1, issuer_role: issuerRole, requested_role: requestedRole, authority: bootstrapException ? "BOOTSTRAP_ONE_TIME_SPAWNER_START" : "SPAWNER", bootstrap_spawner_started_after: bootstrapException || bootstrapSpawnerStarted, worktree_ref: worktreeRef, partner_auditor_ids: [...partnerAuditorIds].sort(compareUtf8), receipt_sha256: null};
  receipt.receipt_sha256 = canonicalDigest(body(receipt)); return Object.freeze(receipt);
}

export function authorizeAgentDespawn({issuerRole, agentId, roleKind, handoffAccepted, scopeClosed, evidencePreserved, worktreeReferenced, activeCustodyRefs = [], reason} = {}) {
  assert(issuerRole === "AGENTOS.SPAWNER", "Only Spawner may despawn an agent"); id(agentId, "despawn agent");
  assert(TEMPORARY_ROLE_KINDS.includes(roleKind), "Permanent roles cannot be despawned through the temporary lifecycle");
  assert(handoffAccepted === true, "Agent handoff must be accepted before despawn");
  assert(scopeClosed === true, "Agent work must be out of scope before despawn");
  assert(evidencePreserved === true, "Agent evidence must be preserved before despawn");
  assert(worktreeReferenced === false, "Agent worktree is still referenced");
  assert(Array.isArray(activeCustodyRefs) && activeCustodyRefs.length === 0, "Agent still has active custody references");
  assert(typeof reason === "string" && reason.trim().length >= 12, "Despawn reason is incomplete");
  const receipt = {schema: "agentos.agent_despawn_authorization.v1", version: 1, issuer_role: issuerRole, agent_id: agentId, role_kind: roleKind, handoff_accepted: true, scope_closed: true, evidence_preserved: true, worktree_referenced: false, active_custody_refs: [], reason, recoverability: "HANDOFF_AND_EVIDENCE_PRESERVED", receipt_sha256: null};
  receipt.receipt_sha256 = canonicalDigest(body(receipt)); return Object.freeze(receipt);
}

export function requiredAuditorCloseout({handoffAccepted} = {}) {
  assert(typeof handoffAccepted === "boolean", "auditor handoff status is required");
  return handoffAccepted ? "SPAWNER_DESPAWN_REQUIRED_NOW" : "PRESERVE_READ_ONLY_AUDITOR_UNTIL_HANDOFF";
}
