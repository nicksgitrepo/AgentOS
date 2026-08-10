#!/usr/bin/env node

/* Explicit connectivity policy for the external control-plane slice. */

import {
  assertPortableRecord,
  canonicalDigest,
  digestWithout,
  exactKeys,
  invariant,
  requireDigest,
  requireString,
} from "./private-control-common.mjs";

export const OFFLINE_POLICY_SCHEMA = "agentos.offline_policy.v1";
export const OFFLINE_MODES = Object.freeze(["OFFLINE_ENFORCED", "ONLINE_READ_ONLY", "ONLINE_ACTIONS"]);
export const OFFLINE_STATUSES = Object.freeze(["OFFLINE_ACTIVE", "ONLINE_REVIEW", "ONLINE_BOUND", "HARD_STOP"]);
export const CONTROL_ACTIONS = Object.freeze([
  "LOCAL_READ",
  "LOCAL_GIT_READ",
  "CONTROL_WRITE",
  "CONTROL_EXPORT",
  "CONTROL_IMPORT",
  "RELEASE_CANDIDATE_VERIFY",
  "GOVERNANCE_PRESERVE",
  "GOVERNANCE_RESET",
  "NETWORK_READ",
  "AUTHENTICATE",
  "PROVIDER_ACTION",
  "PUBLISH",
  "PUSH",
  "MERGE",
  "DEPLOY",
  "SPEND",
  "DELETE",
]);

const FIELDS = [
  "schema", "version", "status", "mode", "network_allowed", "authentication_allowed", "external_writes_allowed",
  "provider_discovery_mode", "allowed_actions", "denied_actions", "workspace_binding_digest", "owner_decision_digest",
  "capability_digest", "digest",
];

const OFFLINE_ALLOWED = Object.freeze([
  "CONTROL_EXPORT",
  "CONTROL_IMPORT",
  "CONTROL_WRITE",
  "GOVERNANCE_PRESERVE",
  "GOVERNANCE_RESET",
  "LOCAL_GIT_READ",
  "LOCAL_READ",
  "RELEASE_CANDIDATE_VERIFY",
]);

const OFFLINE_DENIED = Object.freeze([
  "AUTHENTICATE",
  "DELETE",
  "DEPLOY",
  "MERGE",
  "NETWORK_READ",
  "PROVIDER_ACTION",
  "PUBLISH",
  "PUSH",
  "SPEND",
]);

const READ_ONLY_ALLOWED = Object.freeze([...OFFLINE_ALLOWED, "NETWORK_READ"].sort());
const READ_ONLY_DENIED = Object.freeze([
  "AUTHENTICATE", "DELETE", "DEPLOY", "MERGE", "PROVIDER_ACTION", "PUBLISH", "PUSH", "SPEND",
].sort());
const HARD_STOP_DENIED = Object.freeze([...CONTROL_ACTIONS].sort());

const MODE_CONTRACTS = Object.freeze({
  OFFLINE_ENFORCED: Object.freeze({
    status: "OFFLINE_ACTIVE",
    network_allowed: false,
    authentication_allowed: false,
    external_writes_allowed: false,
    provider_discovery_mode: "LOCAL_CATALOG_ONLY",
    allowed_actions: OFFLINE_ALLOWED,
    denied_actions: OFFLINE_DENIED,
  }),
  ONLINE_READ_ONLY: Object.freeze({
    status: "ONLINE_REVIEW",
    network_allowed: true,
    authentication_allowed: false,
    external_writes_allowed: false,
    provider_discovery_mode: "HOST_CATALOG_READ_ONLY",
    allowed_actions: READ_ONLY_ALLOWED,
    denied_actions: READ_ONLY_DENIED,
  }),
  ONLINE_ACTIONS: Object.freeze({
    status: "ONLINE_BOUND",
    network_allowed: true,
    authentication_allowed: true,
    external_writes_allowed: true,
    provider_discovery_mode: "HOST_ATTESTED_CAPABILITIES",
    allowed_actions: Object.freeze([...CONTROL_ACTIONS].sort()),
    denied_actions: Object.freeze([]),
  }),
});

const HARD_STOP_CONTRACT = Object.freeze({
  mode: "OFFLINE_ENFORCED",
  status: "HARD_STOP",
  network_allowed: false,
  authentication_allowed: false,
  external_writes_allowed: false,
  provider_discovery_mode: "LOCAL_CATALOG_ONLY",
  allowed_actions: Object.freeze([]),
  denied_actions: HARD_STOP_DENIED,
});

function sortedUnique(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  invariant(values.every((value) => typeof value === "string"), `${label} contains a non-string action`);
  const result = [...new Set(values)].sort();
  invariant(result.length === values.length, `${label} contains duplicate actions`);
  return result;
}

function exactSortedActions(actual, expected, label) {
  const sorted = sortedUnique(actual, label);
  invariant(JSON.stringify(actual) === JSON.stringify(sorted), `${label} must be sorted`);
  invariant(JSON.stringify(sorted) === JSON.stringify(expected), `${label} does not match the selected policy mode`);
}

function statusForMode(mode) {
  return MODE_CONTRACTS[mode].status;
}

function expectedContract(policy) {
  if (policy.status === "HARD_STOP") return HARD_STOP_CONTRACT;
  return MODE_CONTRACTS[policy.mode];
}

function validateEvidence(policy) {
  if (policy.mode === "ONLINE_READ_ONLY") {
    requireDigest(policy.owner_decision_digest, "online read-only owner decision digest");
    invariant(policy.capability_digest === null, "online read-only policy cannot carry capability evidence");
  } else if (policy.mode === "ONLINE_ACTIONS") {
    requireDigest(policy.owner_decision_digest, "online action owner decision digest");
    requireDigest(policy.capability_digest, "online action capability digest");
  } else {
    invariant(policy.capability_digest === null, "offline policy cannot carry capability evidence");
  }
}

export function compileOfflinePolicy({
  mode = "OFFLINE_ENFORCED",
  workspaceBindingDigest,
  ownerDecisionDigest = null,
  capabilityDigest = null,
} = {}) {
  invariant(OFFLINE_MODES.includes(mode), "offline mode is invalid");
  requireDigest(workspaceBindingDigest, "workspace binding digest");
  if (ownerDecisionDigest !== null) requireDigest(ownerDecisionDigest, "owner decision digest");
  if (capabilityDigest !== null) requireDigest(capabilityDigest, "capability digest");
  if (mode === "ONLINE_READ_ONLY") requireDigest(ownerDecisionDigest, "online read-only owner decision digest", "ONLINE_AUTHORITY_REQUIRED");
  if (mode === "ONLINE_ACTIONS") {
    invariant(ownerDecisionDigest !== null && capabilityDigest !== null, "online actions require owner and capability evidence", "ONLINE_AUTHORITY_REQUIRED");
  }
  if (mode !== "ONLINE_ACTIONS") invariant(capabilityDigest === null, "capability evidence is only valid for online actions", "CAPABILITY_EVIDENCE_UNEXPECTED");
  const contract = MODE_CONTRACTS[mode];
  const body = {
    schema: OFFLINE_POLICY_SCHEMA,
    version: 1,
    status: statusForMode(mode),
    mode,
    network_allowed: contract.network_allowed,
    authentication_allowed: contract.authentication_allowed,
    external_writes_allowed: contract.external_writes_allowed,
    provider_discovery_mode: contract.provider_discovery_mode,
    allowed_actions: [...contract.allowed_actions],
    denied_actions: [...contract.denied_actions],
    workspace_binding_digest: workspaceBindingDigest,
    owner_decision_digest: ownerDecisionDigest,
    capability_digest: capabilityDigest,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateOfflinePolicy(body);
}

export function validateOfflinePolicy(policy) {
  exactKeys(policy, FIELDS, "offline policy");
  invariant(policy.schema === OFFLINE_POLICY_SCHEMA && policy.version === 1, "offline policy identity is invalid");
  invariant(OFFLINE_STATUSES.includes(policy.status), "offline policy status is invalid");
  invariant(OFFLINE_MODES.includes(policy.mode), "offline policy mode is invalid");
  const contract = expectedContract(policy);
  invariant(policy.mode === contract.mode || policy.mode === (policy.status === "HARD_STOP" ? "OFFLINE_ENFORCED" : policy.mode), "offline policy mode is inconsistent with status");
  invariant(policy.network_allowed === contract.network_allowed
    && policy.authentication_allowed === contract.authentication_allowed
    && policy.external_writes_allowed === contract.external_writes_allowed, "offline policy capability flags do not match its status");
  invariant(policy.provider_discovery_mode === contract.provider_discovery_mode, "offline policy provider discovery mode does not match its status");
  exactSortedActions(policy.allowed_actions, contract.allowed_actions, "offline policy allowed actions");
  exactSortedActions(policy.denied_actions, contract.denied_actions, "offline policy denied actions");
  invariant(policy.allowed_actions.every((action) => CONTROL_ACTIONS.includes(action)), "offline policy contains an unknown allowed action");
  invariant(policy.denied_actions.every((action) => CONTROL_ACTIONS.includes(action)), "offline policy contains an unknown denied action");
  invariant(policy.allowed_actions.every((action) => !policy.denied_actions.includes(action)), "offline policy allows and denies the same action");
  requireDigest(policy.workspace_binding_digest, "offline policy workspace binding digest");
  if (policy.owner_decision_digest !== null) requireDigest(policy.owner_decision_digest, "offline policy owner decision digest");
  if (policy.status !== "HARD_STOP") validateEvidence(policy);
  else invariant(policy.mode === "OFFLINE_ENFORCED", "hard-stop policy must be offline-enforced");
  if (policy.status === "HARD_STOP") invariant(policy.capability_digest === null, "hard-stop policy cannot carry capability evidence");
  requireDigest(policy.digest, "offline policy digest");
  invariant(policy.digest === digestWithout(policy, "digest"), "offline policy digest does not match content");
  assertPortableRecord(policy, "offline policy");
  return policy;
}

export function authorizeOfflineAction(policy, action) {
  validateOfflinePolicy(policy);
  requireString(action, "control action");
  invariant(CONTROL_ACTIONS.includes(action), "control action is unknown", "ACTION_UNKNOWN");
  if (policy.status === "HARD_STOP") {
    const error = new Error("all actions are denied while the offline policy is hard-stopped");
    error.name = "OfflineHardStopError";
    error.code = "OFFLINE_HARD_STOP";
    error.action = action;
    error.policy_digest = policy.digest;
    throw error;
  }
  if (policy.denied_actions.includes(action) || !policy.allowed_actions.includes(action)) {
    const error = new Error(`action ${action} is denied by ${policy.mode}`);
    error.name = "OfflineActionDeniedError";
    error.code = "OFFLINE_ACTION_DENIED";
    error.action = action;
    error.policy_digest = policy.digest;
    throw error;
  }
  return {
    schema: "agentos.offline_action_authorization.v1",
    version: 1,
    status: "ALLOWED",
    action,
    policy_digest: policy.digest,
    workspace_binding_digest: policy.workspace_binding_digest,
    digest: canonicalDigest({action, policy_digest: policy.digest, workspace_binding_digest: policy.workspace_binding_digest}),
  };
}

export function transitionOfflinePolicy(policy, {event, ownerDecisionDigest = null, capabilityDigest = null} = {}) {
  validateOfflinePolicy(policy);
  requireString(event, "offline policy event");
  if (event === "RETURN_OFFLINE") {
    if (policy.status === "HARD_STOP") requireDigest(ownerDecisionDigest, "hard-stop recovery owner decision digest", "OWNER_RECOVERY_REQUIRED");
    return compileOfflinePolicy({mode: "OFFLINE_ENFORCED", workspaceBindingDigest: policy.workspace_binding_digest, ownerDecisionDigest});
  }
  if (event === "REQUEST_ONLINE") {
    invariant(policy.mode === "OFFLINE_ENFORCED" && policy.status === "OFFLINE_ACTIVE", "online review can only start from active offline mode", "INVALID_OFFLINE_PREDECESSOR");
    requireDigest(ownerDecisionDigest, "online review owner decision digest", "ONLINE_AUTHORITY_REQUIRED");
    return compileOfflinePolicy({mode: "ONLINE_READ_ONLY", workspaceBindingDigest: policy.workspace_binding_digest, ownerDecisionDigest});
  }
  if (event === "BIND_ONLINE_ACTIONS") {
    invariant(policy.mode === "ONLINE_READ_ONLY" && policy.status === "ONLINE_REVIEW", "online actions require online review", "INVALID_OFFLINE_PREDECESSOR");
    return compileOfflinePolicy({mode: "ONLINE_ACTIONS", workspaceBindingDigest: policy.workspace_binding_digest, ownerDecisionDigest, capabilityDigest});
  }
  if (event === "NETWORK_ATTEMPTED_OFFLINE") {
    invariant(policy.mode === "OFFLINE_ENFORCED" && policy.status === "OFFLINE_ACTIVE", "offline network attempt requires active offline mode", "INVALID_OFFLINE_PREDECESSOR");
    const next = {
      ...policy,
      status: "HARD_STOP",
      allowed_actions: [],
      denied_actions: [...HARD_STOP_DENIED],
      digest: null,
    };
    next.digest = digestWithout(next, "digest");
    return validateOfflinePolicy(next);
  }
  invariant(false, `offline policy event is not valid from ${policy.mode}/${policy.status}`, "INVALID_OFFLINE_TRANSITION");
}
