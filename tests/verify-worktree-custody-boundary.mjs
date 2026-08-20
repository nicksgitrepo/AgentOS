#!/usr/bin/env node
import assert from "node:assert/strict";
import {evaluateWorktreeCustodyBoundary, WORKTREE_CUSTODY_BOUNDARY_SCHEMA} from "../control/worktree-custody-boundary-gate.mjs";

const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const baseEvidence = {authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.CONTROL_WORKTREE_CUSTODY", custody_ref: "ref:WORKTREE_CUSTODY/BOUND", source_status: "CURRENT", source_identity: "SOURCE.SLSA_PROVENANCE", source_version: "1.2", source_identities: ["SOURCE.ATOMIC_SPECIALIZATION_LAW", "SOURCE.GIT_WORKTREE", "SOURCE.SLSA_PROVENANCE"], candidate_identity: "CANDIDATE.AGENTOS.CURRENT", candidate_digest: digest, candidate_status: "CURRENT_CANDIDATE", worktree_identity: "ref:WORKTREE/CURRENT", worktree_base: "ref:WORKTREE/BASE", worktree_status: "BOUND", changed_paths_status: "BOUND", changed_paths_digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", changed_paths_count: 3, clean_readback_status: "CURRENT", remote_readback_status: "MATCHED", recovery_status: "CURRENT", requested_action: "VERIFY", signals: ["AGENT.WORKTREE_CUSTODY", "CLEAN_READBACK"], context_complete: true, handoff_ref: "ref:HANDOFF/WORKTREE_CUSTODY", model_policy_status: "CURRENT", model_task_class: "DETERMINISTIC_QA", model_route_status: "BOUND", standard_identities: ["SPECIALIST.STANDARD.NIST_SSDF", "SPECIALIST.STANDARD.SLSA"], requested_tools: ["READ_GIT_STATUS", "READ_WORKTREE_METADATA", "READ_CUSTODY_RECEIPT"], self_acceptance: false, scope_expanded: false, authority_conflict: false, project_data_present: false, secret_data_present: false, unbound_receipt: false, unreviewed_gate: false, unknown_context: false, destructive_action: false, authority_scope: "NARROW_WORKTREE_CUSTODY", sibling_authorities: ["WORKTREE_CUSTODY"]};
const input = (request_kind, evidence = {}) => ({schema: WORKTREE_CUSTODY_BOUNDARY_SCHEMA, version: 1, request_kind, evidence: {...baseEvidence, ...evidence}});
const denied = (request_kind, evidence, code) => { const out = evaluateWorktreeCustodyBoundary(input(request_kind, evidence)); assert.equal(out.disposition, "DENY"); assert.equal(out.error_code, code); assert.equal(out.acceptance_allowed, false); assert(Object.values(out.external_side_effects).every((v) => v === 0)); return out; };
for (const request of ["MERGE", "PUSH", "DELETE", "REMOVE_WORKTREE", "DEPLOY", "PUBLISH", "ACTIVATE", "APPROVE", "ACCEPT", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "CHANGE_SCOPE"]) denied(request, {}, "WORKTREE_CUSTODY_OPERATION_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {authority_conflict: true}, "WORKTREE_CUSTODY_AUTHORITY_CONFLICT");
denied("VERIFY_CLEAN_READBACK", {scope_expanded: true}, "WORKTREE_CUSTODY_SCOPE_EXPANSION_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {destructive_action: true}, "WORKTREE_CUSTODY_SCOPE_EXPANSION_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {project_data_present: true}, "WORKTREE_CUSTODY_PROTECTED_DATA_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {unbound_receipt: true}, "WORKTREE_CUSTODY_EVIDENCE_UNBOUND");
denied("VERIFY_CLEAN_READBACK", {authority_scope: "UMBRELLA"}, "WORKTREE_CUSTODY_UMBRELLA_AUTHORITY_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {sibling_authorities: ["WORKTREE_CUSTODY", "DUPLICATE"]}, "WORKTREE_CUSTODY_DUPLICATE_AUTHORITY");
assert.throws(() => evaluateWorktreeCustodyBoundary(input("VERIFY_CLEAN_READBACK", {candidate_digest: "f".repeat(64)})), (error) => error.code === "WORKTREE_CUSTODY_DIGEST_PLACEHOLDER");
denied("VERIFY_CLEAN_READBACK", {worktree_status: "MISSING"}, "WORKTREE_CUSTODY_BINDING_INVALID");
denied("VERIFY_CLEAN_READBACK", {clean_readback_status: "STALE"}, "WORKTREE_CUSTODY_READBACK_INCOMPLETE");
denied("VERIFY_CLEAN_READBACK", {model_policy_status: "STALE"}, "WORKTREE_CUSTODY_MODEL_ROUTE_INVALID");
denied("VERIFY_CLEAN_READBACK", {requested_tools: ["DELETE_WORKTREE"]}, "WORKTREE_CUSTODY_TOOL_SCOPE_FORBIDDEN");
denied("VERIFY_CLEAN_READBACK", {signals: ["UNKNOWN_SIGNAL"]}, "WORKTREE_CUSTODY_SIGNAL_UNSUPPORTED");
denied("VERIFY_CLEAN_READBACK", {standard_identities: ["SPECIALIST.STANDARD.SLSA", "SPECIALIST.STANDARD.OTHER"]}, "WORKTREE_CUSTODY_STANDARD_BINDING_INVALID");
const routed = evaluateWorktreeCustodyBoundary(input("VERIFY_CLEAN_READBACK")); assert.equal(routed.disposition, "ROUTE"); assert.equal(routed.route, "SPAWNER_CUSTODY_HANDOFF"); assert.equal(routed.error_code, "WORKTREE_CUSTODY_ROUTE_READY"); assert.equal(routed.selected_owner, "AGENTOS.SPAWNER"); assert.equal(routed.acceptance_allowed, false); assert(Object.values(routed.external_side_effects).every((v) => v === 0));
console.log("PASS Worktree/Custody boundary: typed custody vectors deny unsafe operations and route clean readback with zero side effects");
