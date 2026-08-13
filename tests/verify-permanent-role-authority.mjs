#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH,
  CANONICAL_PERMANENT_ROLE_IDS,
  PERMANENT_ROLE_ACTION_REQUEST_SCHEMA,
  PERMANENT_ROLE_AUTHORITY_SHA256,
  PERMANENT_ROLE_MIGRATION_MAP,
  compilePermanentRoleActionAdmission,
  compilePermanentRoleRoster,
  normalizePermanentRoleReference,
  permanentRoleActionRequestDigest,
  permanentRoleById,
  validatePermanentRoleAuthorityGraph,
  validatePermanentRoleMigrationMap,
  validatePermanentRoleRoster,
} from "../control/permanent-role-authority.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function addressed(body, digestField) {
  const value = {...body, [digestField]: null};
  value[digestField] = canonicalDigest(value);
  return value;
}

const bindings = CANONICAL_PERMANENT_ROLE_IDS.map((roleId, index) => ({
  role_id: roleId,
  identity_id: `ROLE-IDENTITY-${index + 1}`,
  appointment: {
    requester_identity: `APPOINTMENT-REQUESTER-${index + 1}`,
    compiler_identity: `APPOINTMENT-COMPILER-${index + 1}`,
    acceptor_identity: `APPOINTMENT-ACCEPTOR-${index + 1}`,
    appointing_identity: `APPOINTING-AUTHORITY-${index + 1}`,
  },
}));
const roster = compilePermanentRoleRoster({bindings});
const identityFor = (roleId) => roster.bindings.find((binding) => binding.role_id === roleId).identity_id;

function acceptedManifest({acceptedBy = "MANIFEST-ACCEPTOR-1"} = {}) {
  return addressed({
    schema: "agentos.accepted_role_context_manifest.v1",
    version: 1,
    status: "ACCEPTED",
    manifest_sha256: canonicalDigest({fixture: "accepted-role-context"}),
    compiled_by_identity: identityFor("AGENT_SPAWNER_COMPILER"),
    accepted_by_identity: acceptedBy,
  }, "receipt_sha256");
}

function boundCapability({roleId = "RUNTIME", authorizedBy = "CAPABILITY-AUTHORIZER-1"} = {}) {
  return addressed({
    schema: "agentos.bound_capability_receipt.v1",
    version: 1,
    status: "BOUND",
    capability_id: "CAPABILITY-1",
    granted_to_identity: identityFor(roleId),
    authorized_by_identity: authorizedBy,
  }, "capability_sha256");
}

function protectedDecision({decidedBy = "PROTECTED-DECIDER-1"} = {}) {
  return addressed({
    schema: "agentos.protected_decision_receipt.v1",
    version: 1,
    status: "ACCEPTED",
    decision_id: "DECISION-1",
    decided_by_identity: decidedBy,
  }, "decision_sha256");
}

function requestFor({roleId, authority, modelDuty = null, manifest = null, capability = null, decision = null, reviewer = "INDEPENDENT-REVIEWER-1"}) {
  const request = {
    schema: PERMANENT_ROLE_ACTION_REQUEST_SCHEMA,
    version: 1,
    request_id: `REQUEST-${roleId}`,
    authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
    roster_sha256: roster.roster_sha256,
    actor_role: roleId,
    actor_identity: identityFor(roleId),
    model_duty: modelDuty ?? permanentRoleById(roleId).model_duty,
    requested_authority: [...authority].sort(),
    independent_review: null,
    accepted_manifest: manifest,
    capability,
    protected_decision: decision,
  };
  request.independent_review = addressed({
    schema: "agentos.permanent_role_independent_review.v1",
    version: 1,
    status: "ACCEPTED",
    reviewer_identity: reviewer,
    reviewed_request_sha256: permanentRoleActionRequestDigest(request),
  }, "review_sha256");
  return request;
}

validatePermanentRoleAuthorityGraph(CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH, {requireCanonicalDigest: true});
validatePermanentRoleMigrationMap(PERMANENT_ROLE_MIGRATION_MAP);
validatePermanentRoleRoster(roster);
assert.deepEqual(CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH.roles.map((role) => role.role_id), CANONICAL_PERMANENT_ROLE_IDS);
assert.equal(new Set(CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH.roles.flatMap((role) => role.allowed_authority)).size,
  CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH.roles.flatMap((role) => role.allowed_authority).length,
  "permanent-role authority actions overlap");
assert(Object.values(CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH.runtime_effects).every((effect) => effect === false));
assert.equal(roster.activation, "OFF");
assert.equal(roster.host_sessions_bound, false);
assert.equal(new Set(roster.bindings.map((binding) => binding.identity_id)).size, 5);

const controllerAdmission = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "CONTROLLER", authority: ["OBSERVE_LIFECYCLE_STATE", "RECONCILE_LIFECYCLE_15_MINUTES"]}),
});
assert.equal(controllerAdmission.status, "SHAPE_ACCEPTED_NOT_ACTIVATED");
assert.equal(controllerAdmission.execution_authorized, false);

const spawnAdmission = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "AGENT_SPAWNER_COMPILER", authority: ["SPAWN_HOST_SESSION_AFTER_ACCEPTED_MANIFEST"], manifest: acceptedManifest()}),
});
assert.equal(spawnAdmission.status, "SHAPE_ACCEPTED_NOT_ACTIVATED");
assert.equal(spawnAdmission.host_spawn_wired, false);

const schedulerAdmission = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "SCHEDULER", authority: ["CUSTODY_PROCESSES", "CUSTODY_WORKTREES"], manifest: acceptedManifest()}),
});
assert.equal(schedulerAdmission.status, "SHAPE_ACCEPTED_NOT_ACTIVATED");

const runtimeAdmission = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({
    roleId: "RUNTIME",
    authority: ["DEPLOY_AT_PROTECTED_BOUNDARY"],
    capability: boundCapability(),
    decision: protectedDecision(),
  }),
});
assert.equal(runtimeAdmission.status, "SHAPE_ACCEPTED_NOT_ACTIVATED");
assert.equal(runtimeAdmission.execution_authorized, false);

const migratedController = normalizePermanentRoleReference({
  role_id: "AGENTOS_CONTROLLER",
  source_schema: "agentos.controller_state.v1",
  source_governance_version: "2.1rc",
  public_name: "AgentOS Controller",
  legacy_semantics: "INTENT_SCOPE_AND_PROTECTED_DECISION_ROUTING",
  authority_graph_sha256: null,
});
assert.equal(migratedController.canonical_role_id, "INTENT_REGULATOR");
assert.notEqual(migratedController.canonical_role_id, "CONTROLLER");
assert.equal(migratedController.mutation, "NONE");

const migratedSpawner = normalizePermanentRoleReference({
  role_id: "AGENT_SPAWNER_GOVERNANCE_COMPILER",
  source_schema: "agentos.audit_first_import_procedure.v1",
  source_governance_version: "2.1rc",
  public_name: null,
  legacy_semantics: "ROLE_CONTEXT_COMPILATION",
  authority_graph_sha256: null,
});
assert.equal(migratedSpawner.canonical_role_id, "AGENT_SPAWNER_COMPILER");

const currentController = normalizePermanentRoleReference({
  role_id: "CONTROLLER",
  source_schema: "agentos.permanent_role_roster.v1",
  source_governance_version: "3.0",
  public_name: "Controller",
  legacy_semantics: null,
  authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
});
assert.equal(currentController.status, "CURRENT_REFERENCE");

const overlapGraph = structuredClone(CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH);
const overlapScheduler = overlapGraph.roles.find((role) => role.role_id === "SCHEDULER");
overlapScheduler.prohibited_authority = overlapScheduler.prohibited_authority.filter((action) => action !== "INTERPRET_OWNER_INTENT");
overlapScheduler.allowed_authority.push("INTERPRET_OWNER_INTENT");
overlapScheduler.allowed_authority.sort();
overlapGraph.graph_sha256 = canonicalDigest({...overlapGraph, graph_sha256: null});
assert.throws(() => validatePermanentRoleAuthorityGraph(overlapGraph), (error) => error?.code === "AUTHORITY_OVERLAP");

const wrongDuty = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "CONTROLLER", authority: ["OBSERVE_LIFECYCLE_STATE"], modelDuty: permanentRoleById("INTENT_REGULATOR").model_duty}),
});
assert(wrongDuty.denial_codes.includes("MODEL_DUTY_MISMATCH"));

const crossRole = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "INTENT_REGULATOR", authority: ["RECONCILE_LIFECYCLE_15_MINUTES"]}),
});
assert(crossRole.denial_codes.includes("AUTHORITY_OVERLAP"));

const productWrite = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "INTENT_REGULATOR", authority: ["WRITE_PRODUCT"]}),
});
assert(productWrite.denial_codes.includes("PROHIBITED_AUTHORITY"));

const selfAppointmentAction = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "CONTROLLER", authority: ["APPOINT_PERMANENT_ROLE"]}),
});
assert(selfAppointmentAction.denial_codes.includes("SELF_APPOINTMENT"));

const missingManifest = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "AGENT_SPAWNER_COMPILER", authority: ["SPAWN_HOST_SESSION_AFTER_ACCEPTED_MANIFEST"]}),
});
assert(missingManifest.denial_codes.includes("ACCEPTED_MANIFEST_REQUIRED"));

const missingCapability = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "RUNTIME", authority: ["DEPLOY_AT_PROTECTED_BOUNDARY"]}),
});
assert(missingCapability.denial_codes.includes("BOUND_CAPABILITY_REQUIRED"));
assert(missingCapability.denial_codes.includes("PROTECTED_DECISION_REQUIRED"));

const selfReviewed = compilePermanentRoleActionAdmission({
  roster,
  request: requestFor({roleId: "CONTROLLER", authority: ["OBSERVE_LIFECYCLE_STATE"], reviewer: identityFor("CONTROLLER")}),
});
assert(selfReviewed.denial_codes.includes("REVIEWER_IDENTITY_CONFLATION"));

const selfAppointedBindings = structuredClone(bindings);
selfAppointedBindings[0].appointment.requester_identity = selfAppointedBindings[0].identity_id;
assert.throws(() => compilePermanentRoleRoster({bindings: selfAppointedBindings}), (error) => error?.code === "SELF_APPOINTMENT");

const conflatedBindings = structuredClone(bindings);
conflatedBindings[1].identity_id = conflatedBindings[0].identity_id;
assert.throws(() => compilePermanentRoleRoster({bindings: conflatedBindings}), (error) => error?.code === "ROLE_IDENTITY_CONFLATION");
assert.throws(() => compilePermanentRoleRoster({bindings: bindings.filter((binding) => ["INTENT_REGULATOR", "RUNTIME"].includes(binding.role_id))}), (error) => error?.code === "ROLE_SET_INCOMPLETE");

assert.throws(() => normalizePermanentRoleReference({
  role_id: "AGENTOS_CONTROLLER",
  source_schema: "agentos.controller_state.v1",
  source_governance_version: "2.1rc",
  public_name: "AgentOS Controller",
  legacy_semantics: null,
  authority_graph_sha256: null,
}), (error) => error?.code === "LEGACY_ROLE_EVIDENCE_MISSING");
assert.throws(() => normalizePermanentRoleReference({
  role_id: "AGENTOS_CONTROLLER_WITH_LIFECYCLE_DUTY",
  source_schema: "agentos.controller_state.v1",
  source_governance_version: "2.1rc",
  public_name: null,
  legacy_semantics: "LIFECYCLE_STATE_SUPERVISION_AND_RECOVERY",
  authority_graph_sha256: null,
}), (error) => error?.code === "ROLE_REFERENCE_AMBIGUOUS");
assert.throws(() => normalizePermanentRoleReference({
  role_id: "CONTROLLER",
  source_schema: "legacy.controller.v1",
  source_governance_version: "2.1rc",
  public_name: "Controller",
  legacy_semantics: null,
  authority_graph_sha256: null,
}), (error) => error?.code === "CANONICAL_REFERENCE_UNBOUND");

const schema = readJson("schemas/permanent-role-authority.v1.json");
assert.equal(schema.$id, "agentos.permanent_role_authority.v1");
assert.equal(schema.type, "object");
assert.equal(schema.oneOf.length, 6);
assert.deepEqual(schema.$defs.roleId.enum, CANONICAL_PERMANENT_ROLE_IDS);
const kernel = readJson("schemas/kernel.v1.json");
assert.deepEqual(kernel.permanent_role_authority.canonical_roles, CANONICAL_PERMANENT_ROLE_IDS);
assert.equal(kernel.agentos_controller.canonical_target, "INTENT_REGULATOR");
assert.equal(kernel.agentos_controller.never_target, "CONTROLLER");
const naming = readJson("schemas/naming-and-terminology.v1.json");
assert.equal(naming.compatibility_aliases.AGENTOS_CONTROLLER, "INTENT_REGULATOR");
assert.equal(naming.canonical_terms.CONTROLLER.public_name, "Controller");
assert.equal(naming.canonical_terms.INTENT_REGULATOR.public_name, "Intent Regulator");
assert(read("governance/3.0/permanent-role-authority.md").includes("It never means `CONTROLLER`"));

console.log("PASS permanent-role authority: five distinct roles, content addressing, independent identities, legacy migration, hostile overlap/duty/self-appointment denial, and inactive effects");
