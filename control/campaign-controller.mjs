#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {verifyProductAcceptanceProof} from "./acceptance-bridge.mjs";
import {
  validateAcceptedLiveCascadeBinding,
  validateCascadeState,
} from "./campaign-cascade.mjs";

const CAMPAIGN_STATUSES = new Set([
  "OPEN", "TRUE_BLOCKER_SUSPENDED", "MERGED_NOT_ACCEPTED_LIVE",
  "ACCEPTED_LIVE_CLOSED",
]);
const AGENT_KINDS = new Set([
  "GLOBAL_ORCHESTRATOR", "GLOBAL_RUNTIME", "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER", "CAMPAIGN_FINALIZER",
]);
const TRUE_BLOCKER_CLASSES = new Set([
  "NEW_OR_INCREASED_UNAPPROVED_COST",
  "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE",
  "GOVERNED_STACK_OR_CONSTITUTIONAL_ARCHITECTURE_CHANGE",
  "REPOSITORY_AUTHORITY_TOPOLOGY_CHANGE",
  "DELETION_OF_ACCEPTED_OR_PROTECTED_WORK_OR_PRODUCTION_DATA",
  "UNRESOLVED_MATERIAL_PRODUCT_INTENT_CONTRADICTION",
  "OTHER_IRREVERSIBLE_ACTION_OUTSIDE_DELEGATED_AUTHORITY",
]);
const COMPACT_EVENT_FIELDS = [
  "schema", "event_id", "campaign_id", "snapshot_sequence", "recorded_at",
  "session_id", "root_id", "branch", "event", "role", "goal", "result",
  "commit", "tree", "changed_surfaces", "checks", "blocker", "next",
  "previous_event_sha256", "evidence_pointer_sha256",
];
const LIVING_EVENT_FIELDS = [
  "schema", "event_id", "campaign_id", "campaign_version", "writer_sequence",
  "recorded_at", "writer_session_id", "writer_role_id", "writer_kind",
  "event_type", "root_id", "branch", "goal_id", "dependency_node_id",
  "summary", "next", "related_agent", "checkpoint_sha256",
  "authority_snapshot_sequence", "writer_lease_id", "material_seam",
  "spawn_event_sha256", "evidence_pointer_sha256",
  "previous_writer_event_sha256",
];
const LIVING_EVENT_TYPES = new Set([
  "CAMPAIGN_OPENED", "ROSTER_BOUND", "WORK_STARTED", "PROGRESS",
  "PLATFORM_AGENT_SPAWNED", "PLATFORM_AGENT_RETURNED",
  "AUDIT_FINDING", "GPT_ASSIST_STATUS_UPDATED", "NEXT_CAMPAIGN_DRAFTED",
  "CORRECTION_QUEUED", "CHECKPOINT_CREATED", "HANDOFF_REQUESTED",
  "HANDOFF_ACCEPTED", "TRUE_BLOCKER", "RESUMED", "DEPLOYMENT",
  "ROLLBACK", "LIVE_HEALTH", "SNAPSHOT_COMPILED",
]);
const SHA256 = /^[0-9a-f]{64}$/;
const CAMPAIGN_AGENT_NAME = /^[A-Za-z][A-Za-z0-9_-]* [A-Za-z0-9._-]+ 2\.1rc$/;
const GOAL_STATUSES = new Set(["ACTIVE", "SUSPENDED_TRUE_BLOCKER", "COMPLETE"]);
const GOAL_STAGES = new Set(["BLUEPRINT", "BUILD", "LAUNCH", "LIVE_AUDIT", "IMPROVE"]);
const REVIEW_SEVERITIES = new Set(["PASS", "NONCRITICAL", "MATERIAL", "CATASTROPHIC"]);
const PROGRESS_KINDS = new Set([
  "PRODUCT_COMMIT", "CHECKPOINT", "GOAL_COMPLETION", "PRODUCT_ACCEPTANCE",
  "AUDIT", "DEPLOYMENT", "ROLLBACK",
]);
const GPT_ASSIST_MODES = new Set(["GPT_ASSIST", "DIRECT_ONLY"]);
const SURFACE_REVIEW_MAP = new Map([
  ["UI", ["UI_UX", "SHELL_NAVIGATION", "ACCESSIBILITY"]],
  ["AUTHENTICATED_UI", ["UI_UX", "SHELL_NAVIGATION", "ACCESSIBILITY", "IDENTITY_ACCESS"]],
  ["BACKEND_API", ["BACKEND_API"]],
  ["DATABASE_SCHEMA", ["DATABASE_RLS", "RECOVERY"]],
  ["PROVIDER_INTEGRATION", ["INTEGRATION", "RUNTIME"]],
  ["RUNTIME_CONFIG", ["RUNTIME"]],
]);

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireSha(value, label) {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields mismatch`);
  }
}

function requireIso(value, label) {
  requireString(value, label);
  if (!Number.isFinite(new Date(value).getTime())) throw new Error(`${label} is not ISO time`);
}

function validateSecretFreeSummary(value, label) {
  requireString(value, label);
  if (/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(value)
      || /https?:\/\/[^/\s]+[/?#][^\s]*(?:token|secret|key|signature)=/iu.test(value)) {
    throw new Error(`${label} contains retained secret material`);
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

const digest = (value) => crypto.createHash("sha256")
  .update(JSON.stringify(canonicalize(value))).digest("hex");
export const campaignDigest = digest;

function sortedUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0
      || values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`${label} must be a nonempty string array`);
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length
      || JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must be unique and deterministically sorted`);
  }
  return sorted;
}

export function deriveChangedSurfaces(changedPaths) {
  const paths = sortedUniqueStrings(changedPaths, "changed paths");
  const surfaces = new Set();
  for (const changedPath of paths) {
    if (changedPath.startsWith("/") || changedPath.includes("..")
        || changedPath.includes("\\") || changedPath.includes("\0")) {
      throw new Error("changed path is unsafe");
    }
    const lower = changedPath.toLowerCase();
    let matched = false;
    if (/(^|\/)(migrations?|schema|database|db)(\/|$)|\.sql$|rls/.test(lower)) {
      surfaces.add("DATABASE_SCHEMA"); matched = true;
    }
    if (/(^|\/)(api|backend|server|services?|routes?|controllers?)(\/|$)/
      .test(lower) || /\.(rs|go|java|kt|py)$/.test(lower)) {
      surfaces.add("BACKEND_API"); matched = true;
    }
    if (/(^|\/)(pages?|views?|components?|ui|shell|navigation)(\/|$)/
      .test(lower) || /\.(tsx|jsx|css|scss|html)$/.test(lower)) {
      surfaces.add(/auth|session|identity|account/.test(lower) ? "AUTHENTICATED_UI" : "UI");
      matched = true;
    }
    if (/(^|\/)(infra|runtime|deploy|hosting|providers?|integrations?)(\/|$)/
      .test(lower) || /dockerfile|compose|terraform|\.tf$/.test(lower)) {
      surfaces.add(/providers?|integrations?/.test(lower)
        ? "PROVIDER_INTEGRATION" : "RUNTIME_CONFIG");
      matched = true;
    }
    if (!matched && !/(^|\/)(tests?|docs?|authority)(\/|$)|\.(md|txt|json)$/
      .test(lower)) {
      throw new Error(`changed path has no registered material surface: ${changedPath}`);
    }
  }
  if (surfaces.size === 0) throw new Error("change set has no material surface");
  return [...surfaces].sort();
}

export function compileChangeManifest(root, checkpointId, ownerRoleId, changedPaths) {
  const paths = sortedUniqueStrings(changedPaths, "changed paths");
  const manifest = {
    schema: "governance.changed_surface_manifest.v1",
    checkpoint_id: checkpointId,
    originating_owner_role_id: ownerRoleId,
    root_id: root.root_id,
    branch: root.branch,
    commit: root.commit,
    tree: root.tree,
    changed_paths: paths,
    changed_surfaces: deriveChangedSurfaces(paths),
  };
  return {...manifest, manifest_sha256: digest(manifest)};
}

function validateTrueBlocker(blocker, label) {
  requireRecord(blocker, label);
  if (!TRUE_BLOCKER_CLASSES.has(blocker.class)) {
    throw new Error(`${label} does not cross the true-blocker boundary`);
  }
  const common = [
    "class", "reason", "authority_boundary_id", "blocker_evidence_sha256",
    "exact_owner_question", "smallest_owner_action", "attempted_safe_alternatives",
    "unaffected_work", "blocked_scope", "resumption_condition",
  ];
  requireString(blocker.reason, `${label} reason`);
  requireString(blocker.authority_boundary_id, `${label} authority boundary`);
  requireSha(blocker.blocker_evidence_sha256, `${label} evidence`);
  requireString(blocker.exact_owner_question, `${label} owner question`);
  requireString(blocker.smallest_owner_action, `${label} smallest owner action`);
  sortedUniqueStrings(blocker.attempted_safe_alternatives, `${label} attempted safe alternatives`);
  requireString(blocker.unaffected_work, `${label} unaffected work`);
  requireString(blocker.blocked_scope, `${label} blocked scope`);
  requireString(blocker.resumption_condition, `${label} resumption condition`);
  if (blocker.class === "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE"
      && Object.hasOwn(blocker, "official_authorization_url")) {
    exactKeys(blocker, [
      ...common,
      "provider", "environment", "official_authorization_url",
      "selected_browser_required", "sensitive_link", "resume_check", "resume_goal_id",
    ], label);
    for (const field of [
      "provider", "environment", "official_authorization_url",
      "resume_check", "resume_goal_id",
    ]) requireString(blocker[field], `${label} ${field}`);
    let authorizationUrl;
    try {
      authorizationUrl = new URL(blocker.official_authorization_url);
    } catch {
      throw new Error(`${label} provider authorization URL is invalid`);
    }
    if (authorizationUrl.protocol !== "https:"
        || authorizationUrl.username !== ""
        || authorizationUrl.password !== ""
        || authorizationUrl.search !== ""
        || authorizationUrl.hash !== ""
        || blocker.selected_browser_required !== true
        || blocker.sensitive_link !== false) {
      throw new Error(`${label} provider authorization must use an official HTTPS selected-browser route`);
    }
  } else {
    exactKeys(blocker, common, label);
  }
}

export function classifyRequiredSeamReviews(changedSurfaces) {
  if (!Array.isArray(changedSurfaces) || changedSurfaces.length === 0) {
    throw new Error("changed surfaces must be a nonempty array");
  }
  const required = new Set(["SECURITY"]);
  for (const surface of changedSurfaces) {
    requireString(surface, "changed surface");
    const roles = SURFACE_REVIEW_MAP.get(surface);
    if (!roles) throw new Error(`unknown changed surface: ${surface}`);
    for (const role of roles) required.add(role);
  }
  return [...required].sort();
}

export function validateSeamReviewBatch(batch, campaignState) {
  validateCampaignState(campaignState);
  exactKeys(batch, [
    "checkpoint_id", "originating_owner_role_id", "root_id", "branch",
    "commit", "tree", "changed_paths", "changed_surfaces",
    "change_manifest_sha256", "required_review_roles", "reviews", "handoff_state",
  ], "seam review batch");
  requireString(batch.checkpoint_id, "seam review checkpoint");
  requireString(batch.originating_owner_role_id, "seam review originating owner");
  if (batch.originating_owner_role_id !== campaignState.active_goal.owner_role_id
      || batch.root_id !== campaignState.root.root_id
      || batch.branch !== campaignState.root.branch
      || batch.commit !== campaignState.root.commit
      || batch.tree !== campaignState.root.tree) {
    throw new Error("seam review does not bind the active owner and exact root");
  }
  const manifest = compileChangeManifest(
    campaignState.root,
    batch.checkpoint_id,
    batch.originating_owner_role_id,
    batch.changed_paths,
  );
  if (JSON.stringify(batch.changed_surfaces) !== JSON.stringify(manifest.changed_surfaces)
      || batch.change_manifest_sha256 !== manifest.manifest_sha256) {
    throw new Error("seam review changed surfaces are not source-derived");
  }
  const expected = classifyRequiredSeamReviews(manifest.changed_surfaces);
  if (!Array.isArray(batch.required_review_roles)
      || expected.join("\0") !== [...batch.required_review_roles].sort().join("\0")) {
    throw new Error("seam review roles do not match changed surfaces");
  }
  if (!Array.isArray(batch.reviews)) throw new Error("seam reviews must be an array");
  const seen = new Set();
  const seenSessions = new Set();
  for (const review of batch.reviews) {
    exactKeys(review, [
      "reviewer_role_id", "session_id", "pinned", "read_only", "severity",
      "reviewed_question_ids", "failed_question_ids", "question_observations_sha256",
      "correction_owner_role_id", "report_sha256",
    ], "seam review");
    requireString(review.reviewer_role_id, "seam reviewer role");
    requireString(review.session_id, "seam reviewer session");
    requireSha(review.report_sha256, "seam review report");
    const admittedReviewer = campaignState.agents.find((agent) =>
      agent.kind === "AUDIT_WORKER"
      && agent.role_id === review.reviewer_role_id
      && agent.session_id === review.session_id
      && agent.campaign_id === campaignState.campaign_id
      && agent.campaign_version === campaignState.campaign_version
      && agent.pinned === true
      && agent.state === "CAMPAIGN_ACTIVE"
      && agent.spawn_reason.includes("ON_DEMAND")
      && agent.material_seam === review.reviewer_role_id);
    if (!expected.includes(review.reviewer_role_id) || seen.has(review.reviewer_role_id)
        || seenSessions.has(review.session_id) || !admittedReviewer
        || review.pinned !== true || review.read_only !== true
        || !REVIEW_SEVERITIES.has(review.severity)
        || !Array.isArray(review.reviewed_question_ids)
        || review.reviewed_question_ids.length === 0
        || !Array.isArray(review.failed_question_ids)
        || review.reviewed_question_ids.some((id) => !/^(FR|DB|SEC)-[A-Z0-9._:-]+$/.test(id))
        || review.failed_question_ids.some((id) => !review.reviewed_question_ids.includes(id))
        || review.question_observations_sha256 !== campaignState.product_acceptance.observations_sha256) {
      throw new Error("seam review identity or boundary is invalid");
    }
    if ((review.severity === "MATERIAL") !== (review.failed_question_ids.length > 0)) {
      throw new Error("material seam severity must match exact failed question IDs");
    }
    if (review.severity === "MATERIAL"
        && review.correction_owner_role_id !== batch.originating_owner_role_id) {
      throw new Error("material finding must return to the originating Feature Agent");
    }
    if (["PASS", "NONCRITICAL"].includes(review.severity)
        && review.correction_owner_role_id !== null) {
      throw new Error("pass or noncritical finding cannot create correction custody");
    }
    seen.add(review.reviewer_role_id);
    seenSessions.add(review.session_id);
  }
  if (expected.some((role) => !seen.has(role))) {
    throw new Error("required seam review is missing");
  }
  const severities = batch.reviews.map((review) => review.severity);
  const expectedState = severities.includes("CATASTROPHIC")
    ? "HELD_CATASTROPHIC"
    : severities.includes("MATERIAL")
      ? "QUEUED_RETURN_TO_ORIGINATING_OWNER_AT_STABLE_HANDOFF"
      : "CONTINUE";
  if (batch.handoff_state !== expectedState) {
    throw new Error("seam review handoff state does not match severity");
  }
}

export function validateCompactEvent(event) {
  exactKeys(event, COMPACT_EVENT_FIELDS, "compact event");
  if (event.schema !== "governance.compact_campaign_event.v1") {
    throw new Error("compact event schema mismatch");
  }
  for (const field of [
    "campaign_id", "session_id", "root_id", "branch", "event", "role", "goal",
    "result", "commit", "tree", "next",
  ]) {
    requireString(event[field], `compact event ${field}`);
  }
  requireIso(event.recorded_at, "compact event time");
  if (!Number.isSafeInteger(event.snapshot_sequence) || event.snapshot_sequence < 0) {
    throw new Error("compact event snapshot sequence is invalid");
  }
  requireSha(event.previous_event_sha256, "compact event previous digest");
  if (event.evidence_pointer_sha256 !== null) {
    requireSha(event.evidence_pointer_sha256, "compact event evidence pointer");
  }
  if (!Array.isArray(event.changed_surfaces) || event.changed_surfaces.length > 20
      || !Array.isArray(event.checks) || event.checks.length > 20) {
    throw new Error("compact event arrays may contain at most 20 entries");
  }
  if (event.blocker !== null && typeof event.blocker !== "string") {
    throw new Error("compact event blocker must be null or a string");
  }
  const body = structuredClone(event);
  delete body.event_id;
  if (event.event_id !== digest(body)) {
    throw new Error("compact event identity does not bind its exact content");
  }
  const serialized = JSON.stringify(event);
  if (serialized.length > 8_192
      || /(step[-_ ]?by[-_ ]?step|test output|screenshot bytes|raw receipt|narrat)/i.test(serialized)) {
    throw new Error("compact event contains chatty or raw-evidence narration");
  }
}

export function compileCompactEvent(fields) {
  requireRecord(fields, "compact event input");
  const event = {
    schema: "governance.compact_campaign_event.v1",
    event_id: "",
    ...fields,
  };
  const body = structuredClone(event);
  delete body.event_id;
  event.event_id = digest(body);
  validateCompactEvent(event);
  return event;
}

function livingEventTypesForKind(kind) {
  return {
    GLOBAL_ORCHESTRATOR: new Set([
      "CAMPAIGN_OPENED", "ROSTER_BOUND", "CORRECTION_QUEUED",
      "HANDOFF_ACCEPTED", "RESUMED", "SNAPSHOT_COMPILED",
    ]),
    FEATURE_AGENT: new Set([
      "WORK_STARTED", "PROGRESS", "PLATFORM_AGENT_SPAWNED",
      "CORRECTION_QUEUED", "CHECKPOINT_CREATED", "HANDOFF_REQUESTED",
      "TRUE_BLOCKER",
    ]),
    PLATFORM_AGENT: new Set(["PLATFORM_AGENT_RETURNED"]),
    INDEPENDENT_AUDITOR: new Set([
      "AUDIT_FINDING", "GPT_ASSIST_STATUS_UPDATED", "NEXT_CAMPAIGN_DRAFTED",
    ]),
    GLOBAL_RUNTIME: new Set(["DEPLOYMENT", "ROLLBACK", "LIVE_HEALTH"]),
  }[kind] ?? new Set();
}

function validateLivingCampaignEventShape(event) {
  exactKeys(event, LIVING_EVENT_FIELDS, "living campaign event");
  if (event.schema !== "governance.living_campaign_event.v1") {
    throw new Error("living campaign event schema mismatch");
  }
  for (const field of [
    "campaign_id", "campaign_version", "writer_session_id", "writer_role_id",
    "writer_kind", "event_type", "root_id", "branch", "goal_id",
    "dependency_node_id", "summary", "next",
  ]) {
    requireString(event[field], `living campaign event ${field}`);
  }
  if (!AGENT_KINDS.has(event.writer_kind)
      || !LIVING_EVENT_TYPES.has(event.event_type)
      || !livingEventTypesForKind(event.writer_kind).has(event.event_type)) {
    throw new Error("living campaign event writer or event type is invalid");
  }
  if (!Number.isSafeInteger(event.writer_sequence) || event.writer_sequence < 1) {
    throw new Error("living campaign writer sequence is invalid");
  }
  requireIso(event.recorded_at, "living campaign event time");
  if (!Number.isSafeInteger(event.authority_snapshot_sequence)
      || event.authority_snapshot_sequence < 0) {
    throw new Error("living campaign event authority snapshot is invalid");
  }
  validateSecretFreeSummary(event.summary, "living campaign event summary");
  validateSecretFreeSummary(event.next, "living campaign event next");
  requireSha(event.previous_writer_event_sha256, "living campaign prior writer event");
  if (event.evidence_pointer_sha256 !== null) {
    requireSha(event.evidence_pointer_sha256, "living campaign evidence pointer");
  }
  const evidenceRequired = new Set([
    "AUDIT_FINDING", "GPT_ASSIST_STATUS_UPDATED", "NEXT_CAMPAIGN_DRAFTED",
    "PLATFORM_AGENT_RETURNED", "CHECKPOINT_CREATED", "DEPLOYMENT",
    "ROLLBACK", "LIVE_HEALTH",
  ]);
  if (evidenceRequired.has(event.event_type)
      !== (event.evidence_pointer_sha256 !== null)) {
    throw new Error("living campaign event evidence binding does not match its type");
  }
  if (event.checkpoint_sha256 !== null) {
    requireSha(event.checkpoint_sha256, "living campaign checkpoint");
  }
  if (event.event_type === "CHECKPOINT_CREATED"
      && event.checkpoint_sha256 === null) {
    throw new Error("checkpoint event lacks checkpoint identity");
  }
  if (event.event_type !== "CHECKPOINT_CREATED"
      && event.checkpoint_sha256 !== null) {
    throw new Error("non-checkpoint event carries checkpoint authority");
  }
  if (event.event_type === "PLATFORM_AGENT_SPAWNED") {
    requireRecord(event.related_agent, "spawned Platform Agent");
    if (event.related_agent.kind !== "PLATFORM_AGENT"
        || event.related_agent.spawn_reason
          !== `ON_DEMAND_BY_${event.writer_role_id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
        || event.related_agent.pinned !== true
        || event.related_agent.state !== "CAMPAIGN_ACTIVE") {
      throw new Error("spawned Platform Agent identity is not exact and on demand");
    }
    validateAgent(event.related_agent, event.campaign_id, event.campaign_version);
    if (event.writer_lease_id === null || event.material_seam !== event.related_agent.material_seam
        || event.spawn_event_sha256 !== null) {
      throw new Error("Platform Agent spawn lacks its exact goal/lease/seam binding");
    }
  } else if (event.event_type === "PLATFORM_AGENT_RETURNED") {
    if (event.related_agent !== null
        || event.writer_lease_id !== null
        || event.material_seam === null
        || event.spawn_event_sha256 === null) {
      throw new Error("Platform Agent return lacks its exact spawn binding");
    }
    requireSha(event.spawn_event_sha256, "Platform Agent spawn event");
  } else if (event.related_agent !== null) {
    throw new Error("non-spawn event carries a related agent");
  }
  if (event.writer_kind === "FEATURE_AGENT" && event.writer_lease_id === null) {
    throw new Error("Feature Agent event lacks its active writer lease");
  }
  if (!["FEATURE_AGENT"].includes(event.writer_kind)
      && event.event_type !== "PLATFORM_AGENT_RETURNED"
      && event.writer_lease_id !== null) {
    throw new Error("non-Feature event carries Product writer lease authority");
  }
  if (!["PLATFORM_AGENT_SPAWNED", "PLATFORM_AGENT_RETURNED"].includes(event.event_type)
      && (event.material_seam !== null || event.spawn_event_sha256 !== null)) {
    throw new Error("non-Platform lifecycle event carries a Platform spawn binding");
  }
  const body = structuredClone(event);
  delete body.event_id;
  if (event.event_id !== digest(body)) {
    throw new Error("living campaign event identity does not bind its exact content");
  }
  const serialized = JSON.stringify(event);
  if (serialized.length > 8_192
      || /(step[-_ ]?by[-_ ]?step|test output|screenshot bytes|raw receipt|narrat)/i.test(serialized)) {
    throw new Error("living campaign event is chatty or contains raw evidence");
  }
}

export function validateLivingCampaignLedger(state, events, options = {}) {
  validateCampaignState(state, {
    product_acceptance_proof: options.product_acceptance_proof ?? null,
  });
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("living campaign ledger is empty");
  }
  const knownSessions = new Map(state.agents.map((agent) => [agent.session_id, agent]));
  const ordered = [...events].sort((left, right) =>
    new Date(left.recorded_at) - new Date(right.recorded_at)
      || compareUtf8(left.event_id, right.event_id));
  const writerHeads = new Map();
  let opened = false;
  const spawnedPlatformSessions = new Set();
  const platformSpawns = new Map();
  for (const event of ordered) {
    validateLivingCampaignEventShape(event);
    const writerHead = writerHeads.get(event.writer_session_id)
      ?? {sequence: 0, event_id: "0".repeat(64), recorded_at: null};
    if (event.writer_sequence !== writerHead.sequence + 1
        || event.previous_writer_event_sha256 !== writerHead.event_id
        || (writerHead.recorded_at !== null
          && new Date(event.recorded_at) <= new Date(writerHead.recorded_at))
        || event.campaign_id !== state.campaign_id
        || event.campaign_version !== state.campaign_version
        || event.root_id !== state.root.root_id
        || event.branch !== state.root.branch) {
      throw new Error("living campaign event chronology or campaign/root binding is invalid");
    }
    const writer = knownSessions.get(event.writer_session_id);
    if (!writer || writer.role_id !== event.writer_role_id
        || writer.kind !== event.writer_kind) {
      throw new Error("living campaign event writer is not roster-bound");
    }
    if (event.event_type === "CAMPAIGN_OPENED") {
      if (opened || event.writer_kind !== "GLOBAL_ORCHESTRATOR"
          || event.writer_sequence !== 1) {
        throw new Error("living campaign ledger has an invalid campaign-open event");
      }
      opened = true;
    } else if (!opened) {
      throw new Error("living campaign ledger starts before its Orchestrator open event");
    }
    if (event.writer_kind === "FEATURE_AGENT"
        && event.authority_snapshot_sequence === state.snapshot_sequence) {
      const active = state.agents.filter((agent) =>
        agent.kind === "FEATURE_AGENT"
        && agent.role_id === state.active_goal.owner_role_id
        && agent.session_id === event.writer_session_id
        && agent.pinned
        && agent.spawn_reason === "FRESH_CAMPAIGN");
      if (active.length !== 1
          || event.goal_id !== state.active_goal.goal_id
          || event.dependency_node_id !== state.active_goal.dependency_node_id
          || event.writer_lease_id !== state.lease.lease_id
          || state.active_goal.status !== "ACTIVE"
          || state.lease.status !== "ACTIVE"
          || event.authority_snapshot_sequence !== state.snapshot_sequence) {
        throw new Error("living Feature event is not bound to the active owner/goal/lease");
      }
    }
    if (event.writer_kind === "PLATFORM_AGENT"
        && !spawnedPlatformSessions.has(event.writer_session_id)) {
      throw new Error("Platform Agent event lacks its prior Feature Agent spawn event");
    }
    if (event.event_type === "PLATFORM_AGENT_RETURNED") {
      const spawn = platformSpawns.get(event.writer_session_id);
      if (!spawn || event.spawn_event_sha256 !== spawn.event_id
          || event.goal_id !== spawn.goal_id
          || event.dependency_node_id !== spawn.dependency_node_id
          || event.material_seam !== spawn.material_seam
          || event.authority_snapshot_sequence !== spawn.authority_snapshot_sequence
          || (event.authority_snapshot_sequence === state.snapshot_sequence
            && (state.active_goal.status !== "ACTIVE"
              || state.lease.status !== "ACTIVE"
              || event.goal_id !== state.active_goal.goal_id
              || event.dependency_node_id !== state.active_goal.dependency_node_id))) {
        throw new Error("Platform Agent return does not match its exact spawn event");
      }
    }
    if (event.related_agent !== null) {
      if (spawnedPlatformSessions.has(event.related_agent.session_id)) {
        throw new Error("Platform Agent session is recorded as spawned more than once");
      }
      const existing = knownSessions.get(event.related_agent.session_id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(event.related_agent)) {
        throw new Error("spawned Platform Agent conflicts with an existing session");
      }
      knownSessions.set(event.related_agent.session_id, event.related_agent);
      spawnedPlatformSessions.add(event.related_agent.session_id);
      platformSpawns.set(event.related_agent.session_id, event);
    }
    writerHeads.set(event.writer_session_id, {
      sequence: event.writer_sequence,
      event_id: event.event_id,
      recorded_at: event.recorded_at,
    });
  }
  if (!opened) throw new Error("living campaign ledger lacks its campaign-open event");
  const orderedEventIds = ordered.map((event) => event.event_id);
  const result = {
    event_count: events.length,
    ledger_sha256: digest({
      schema: "governance.living_campaign_ledger.v1",
      ordered_event_ids: orderedEventIds,
    }),
    writer_heads: Object.fromEntries(
      [...writerHeads.entries()]
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([sessionId, head]) => [sessionId, head.event_id]),
    ),
    agents: [...knownSessions.values()]
      .sort((left, right) =>
        compareUtf8(left.role_id, right.role_id)
          || compareUtf8(left.session_id, right.session_id)),
    ordered_events: ordered,
  };
  if (options.enforce_state_binding !== false) {
    const expected = state.living_record;
    if (expected.event_count !== result.event_count
        || expected.ledger_sha256 !== result.ledger_sha256
        || JSON.stringify(expected.writer_heads) !== JSON.stringify(result.writer_heads)) {
      throw new Error("living campaign ledger does not match the authority snapshot binding");
    }
  }
  return result;
}

export function compileLivingCampaignEvent(fields, state, priorEvents, options = {}) {
  const ledger = priorEvents.length === 0
    ? {event_count: 0, writer_heads: {}, ordered_events: []}
    : validateLivingCampaignLedger(state, priorEvents, {
      enforce_state_binding: false,
      product_acceptance_proof: options.product_acceptance_proof ?? null,
    });
  requireRecord(fields, "living campaign event input");
  const event = {
    schema: "governance.living_campaign_event.v1",
    event_id: "",
    ...fields,
    authority_snapshot_sequence:
      fields.authority_snapshot_sequence ?? state.snapshot_sequence,
    writer_lease_id: fields.writer_lease_id
      ?? (fields.writer_kind === "FEATURE_AGENT" ? state.lease.lease_id : null),
    material_seam: fields.material_seam
      ?? (fields.event_type === "PLATFORM_AGENT_SPAWNED"
        ? fields.related_agent?.material_seam ?? null : null),
    spawn_event_sha256: fields.spawn_event_sha256 ?? null,
    evidence_pointer_sha256: fields.evidence_pointer_sha256 ?? null,
    writer_sequence: ledger.ordered_events
      .filter((prior) => prior.writer_session_id === fields.writer_session_id)
      .length + 1,
    previous_writer_event_sha256:
      ledger.writer_heads[fields.writer_session_id] ?? "0".repeat(64),
  };
  if (event.campaign_id !== state.campaign_id
      || event.campaign_version !== state.campaign_version
      || event.root_id !== state.root.root_id
      || event.branch !== state.root.branch) {
    throw new Error("living campaign event input does not match current campaign root");
  }
  const writer = state.agents.find((agent) => agent.session_id === event.writer_session_id)
    ?? priorEvents
      .filter((prior) => prior.related_agent !== null)
      .map((prior) => prior.related_agent)
      .find((agent) => agent.session_id === event.writer_session_id);
  if (!writer || writer.role_id !== event.writer_role_id
      || writer.kind !== event.writer_kind) {
    throw new Error("living campaign event writer is not admitted");
  }
  if (writer.kind === "FEATURE_AGENT"
      && (writer.role_id !== state.active_goal.owner_role_id
        || writer.session_id !== state.agents.find((agent) =>
          agent.kind === "FEATURE_AGENT"
          && agent.role_id === state.active_goal.owner_role_id
          && agent.pinned)?.session_id)) {
    throw new Error("only the current Feature Agent may append feature work events");
  }
  if (writer.kind === "FEATURE_AGENT"
      && (state.active_goal.status !== "ACTIVE" || state.lease.status !== "ACTIVE")) {
    throw new Error("Feature Agent cannot append work after goal or lease closure");
  }
  if (event.authority_snapshot_sequence !== state.snapshot_sequence) {
    throw new Error("living campaign event does not bind the current authority snapshot");
  }
  if (writer.kind === "FEATURE_AGENT" && event.writer_lease_id !== state.lease.lease_id) {
    throw new Error("living campaign Feature event does not bind the active lease");
  }
  const body = structuredClone(event);
  delete body.event_id;
  event.event_id = digest(body);
  validateLivingCampaignEventShape(event);
  const writerPath = crypto.createHash("sha256")
    .update(event.writer_session_id, "utf8").digest("hex");
  const relativePath = `campaigns/${state.campaign_id}/events/${writerPath}/${
    String(event.writer_sequence).padStart(6, "0")
  }-${event.event_id}.json`;
  return {event, relative_path: relativePath};
}

export function compileLivingCampaignView(state, events, options = {}) {
  const ledger = validateLivingCampaignLedger(
    state, events, {
      enforce_state_binding: false,
      product_acceptance_proof: options.product_acceptance_proof ?? null,
    },
  );
  const lines = [
    `# Campaign ${state.campaign_id}`,
    "",
    `Status: \`${state.status}\``,
    `Root: \`${state.root.root_id}\` on \`${state.root.branch}\``,
    `Commit: \`${state.root.commit}\``,
    `Tree: \`${state.root.tree}\``,
    `Active goal: \`${state.active_goal.goal_id}\``,
    `Active owner: \`${state.active_goal.owner_role_id}\``,
    `Ledger digest: \`${ledger.ledger_sha256}\``,
    "",
    "## Agent sessions",
    "",
  ];
  for (const agent of ledger.agents) {
    lines.push(`- ${agent.role_id} [${agent.kind}]: \`${agent.session_id}\``);
  }
  lines.push("", "## Current events", "");
  for (const event of ledger.ordered_events.slice(-20)) {
    lines.push(`- ${event.writer_role_id}#${event.writer_sequence} ${event.event_type} — ${event.summary} Next: ${event.next}`);
  }
  lines.push("");
  const markdown = lines.join("\n");
  return {
    schema: "governance.living_campaign_view.v1",
    event_count: ledger.event_count,
    ledger_sha256: ledger.ledger_sha256,
    writer_heads: ledger.writer_heads,
    markdown,
    markdown_sha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"),
  };
}

function ensureNoSymlinkAncestors(root, target) {
  const canonicalRoot = fs.realpathSync(root);
  const relative = path.relative(canonicalRoot, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("living campaign path escapes its admitted root");
  }
  let cursor = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error("living campaign path traverses a symlink");
    }
  }
  return canonicalRoot;
}

export function appendLivingCampaignEvent(authorityRoot, relativePath, event) {
  validateLivingCampaignEventShape(event);
  const canonicalRoot = fs.realpathSync(authorityRoot);
  const target = path.resolve(canonicalRoot, relativePath);
  ensureNoSymlinkAncestors(canonicalRoot, target);
  fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
  ensureNoSymlinkAncestors(canonicalRoot, target);
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
    | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(target, flags, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(canonicalize(event))}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(target, 0o400);
  return target;
}

export function readLivingCampaignLedger(authorityRoot, state) {
  const canonicalRoot = fs.realpathSync(authorityRoot);
  const currentViewPath = path.resolve(canonicalRoot, state.living_record.current_view_path);
  ensureNoSymlinkAncestors(canonicalRoot, currentViewPath);
  const currentViewBytes = fs.readFileSync(currentViewPath);
  if (!fs.statSync(currentViewPath).isFile()
      || crypto.createHash("sha256").update(currentViewBytes).digest("hex")
        !== state.living_record.current_view_sha256) {
    throw new Error("living campaign current view does not match its authority binding");
  }
  const eventsRoot = path.resolve(
    canonicalRoot, `campaigns/${state.campaign_id}/events`,
  );
  ensureNoSymlinkAncestors(canonicalRoot, path.join(eventsRoot, "_sentinel"));
  if (!fs.statSync(eventsRoot).isDirectory()) {
    throw new Error("living campaign events root is missing");
  }
  const events = [];
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("living campaign ledger contains a symlink");
      if (entry.isDirectory()) scan(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const event = JSON.parse(fs.readFileSync(entryPath, "utf8"));
        validateLivingCampaignEventShape(event);
        const writerPath = crypto.createHash("sha256")
          .update(event.writer_session_id, "utf8").digest("hex");
        const expected = path.join(
          eventsRoot,
          writerPath,
          `${String(event.writer_sequence).padStart(6, "0")}-${event.event_id}.json`,
        );
        if (entryPath !== expected) throw new Error("living campaign event path is not canonical");
        events.push(event);
      } else {
        throw new Error("living campaign ledger contains an unexpected filesystem entry");
      }
    }
  };
  scan(eventsRoot);
  const ledger = validateLivingCampaignLedger(
    state, events, {enforce_state_binding: true},
  );
  const compiledView = compileLivingCampaignView(state, events);
  if (currentViewBytes.toString("utf8") !== compiledView.markdown
      || compiledView.markdown_sha256 !== state.living_record.current_view_sha256) {
    throw new Error("living campaign current view is not the deterministic compiled view");
  }
  return ledger;
}

function validateAgent(agent, campaignId, campaignVersion) {
  exactKeys(agent, [
    "role_id", "kind", "session_id", "predecessor_session_id", "campaign_id",
    "campaign_version", "governance_version", "display_name", "pinned", "state",
    "spawn_reason", "material_seam",
  ], "campaign agent");
  requireString(agent.role_id, "campaign agent role_id");
  requireString(agent.session_id, "campaign agent session_id");
  if (!AGENT_KINDS.has(agent.kind)) throw new Error("campaign agent kind is invalid");
  if (agent.governance_version !== "2.1rc") {
    throw new Error("campaign agent governance version is stale");
  }
  if (agent.kind === "GLOBAL_RUNTIME") {
    if (agent.display_name !== "Runtime Persistent 2.1rc"
        || agent.spawn_reason !== "PERSISTENT"
        || agent.campaign_version !== "PERSISTENT") {
      throw new Error("Runtime must be the one persistent named agent");
    }
  } else if (!CAMPAIGN_AGENT_NAME.test(agent.display_name)
      || agent.display_name !== `${agent.role_id} ${agent.campaign_version} 2.1rc`
      || agent.campaign_id !== campaignId
      || agent.campaign_version !== campaignVersion) {
    throw new Error("campaign agent name or campaign binding is invalid");
  }
  if (agent.campaign_id !== campaignId && agent.kind !== "GLOBAL_RUNTIME") {
    throw new Error("campaign agent is not bound to the current campaign");
  }
  if (agent.pinned !== true && !["ARCHIVED_UNPINNED", "REPLACED_UNPINNED"].includes(agent.state)) {
    throw new Error("active campaign agent must be pinned");
  }
  if (["GLOBAL_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"].includes(agent.kind)
      && agent.spawn_reason !== "FRESH_CAMPAIGN") {
    throw new Error("campaign Orchestrator, Auditor, and Feature Agents must be fresh");
  }
  if (agent.kind === "CAMPAIGN_FINALIZER") {
    if (!agent.spawn_reason.includes("ON_DEMAND_FINALIZATION")) {
      throw new Error("Campaign Finalizer must be created on demand after terminal first pass");
    }
    if (agent.material_seam !== null) {
      throw new Error("Campaign Finalizer cannot claim a platform seam");
    }
  }
  if (["PLATFORM_AGENT", "AUDIT_WORKER"].includes(agent.kind)) {
    requireString(agent.spawn_reason, "platform agent spawn_reason");
    requireString(agent.material_seam, "platform agent material_seam");
    if (!agent.spawn_reason.includes("ON_DEMAND")) {
      throw new Error("platform and audit workers may be created only on demand");
    }
  } else if (agent.material_seam !== null) {
    throw new Error("only platform agents bind a material_seam");
  }
  if (["INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER"].includes(agent.kind)
      && agent.predecessor_session_id === agent.session_id) {
    throw new Error("campaign agent cannot replace itself");
  }
}

export function compileDependencyOrder(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("dependency_nodes must be nonempty");
  }
  const byId = new Map();
  for (const node of nodes) {
    exactKeys(node, ["node_id", "owner_role_id", "depends_on"], "dependency node");
    requireString(node.node_id, "dependency node_id");
    requireString(node.owner_role_id, "dependency owner_role_id");
    if (!Array.isArray(node.depends_on)) throw new Error("depends_on must be an array");
    if (byId.has(node.node_id)) throw new Error("duplicate dependency node");
    byId.set(node.node_id, node);
  }
  for (const node of nodes) {
    if (new Set(node.depends_on).size !== node.depends_on.length
        || node.depends_on.includes(node.node_id)
        || node.depends_on.some((dependency) => !byId.has(dependency))) {
      throw new Error(`invalid dependency edge: ${node.node_id}`);
    }
  }
  const remaining = new Map(nodes.map((node) => [node.node_id, new Set(node.depends_on)]));
  const order = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([nodeId]) => nodeId)
      .sort();
    if (ready.length === 0) {
      throw new Error("dependency cycle requires one orchestrator-owned shared-contract checkpoint");
    }
    for (const nodeId of ready) {
      order.push(nodeId);
      remaining.delete(nodeId);
      for (const dependencies of remaining.values()) dependencies.delete(nodeId);
    }
  }
  return order;
}

function validateCheckpointHandoff(state, order, nodesById) {
  if (state.active_goal.status !== "COMPLETE") {
    if (state.checkpoint_handoff !== null) {
      throw new Error("active goal cannot carry an accepted handoff");
    }
    return;
  }
  exactKeys(state.checkpoint_handoff, [
    "kind", "checkpoint_id", "root_id", "branch", "commit", "tree",
    "remote_commit", "remote_tree", "lease_id", "from_owner_role_id",
    "from_goal_id", "to_owner_role_id", "to_goal_id", "status",
    "living_record", "product_acceptance_sha256",
  ], "checkpoint handoff");
  const handoff = state.checkpoint_handoff;
  for (const field of [
    "checkpoint_id", "root_id", "branch", "commit", "tree", "remote_commit",
    "remote_tree", "lease_id", "from_owner_role_id", "from_goal_id",
    "to_owner_role_id", "to_goal_id",
  ]) requireString(handoff[field], `checkpoint handoff ${field}`);
  if (handoff.status !== "ACCEPTED") throw new Error("checkpoint handoff is not accepted");
  requireSha(handoff.product_acceptance_sha256, "checkpoint Product acceptance");
  if (handoff.product_acceptance_sha256 !== digest(state.product_acceptance)) {
    throw new Error("checkpoint handoff does not bind the exact Product-acceptance tree state");
  }
  validateLivingRecordBinding(handoff.living_record, "checkpoint living record");
  if (JSON.stringify(handoff.living_record) !== JSON.stringify(state.living_record)) {
    throw new Error("checkpoint handoff does not bind the exact living campaign record");
  }
  if (handoff.root_id !== state.root.root_id || handoff.branch !== state.root.branch
      || handoff.commit !== state.root.commit || handoff.tree !== state.root.tree
      || handoff.remote_commit !== state.root.remote_commit
      || handoff.remote_tree !== state.root.remote_tree
      || handoff.lease_id !== state.lease.lease_id
      || handoff.from_owner_role_id !== state.active_goal.owner_role_id
      || handoff.from_goal_id !== state.active_goal.goal_id) {
    throw new Error("checkpoint handoff identity does not match root, lease, and goal");
  }
  const nodeIndex = order.indexOf(state.active_goal.dependency_node_id);
  if (nodeIndex < 0) throw new Error("active goal dependency node is missing");
  if (nodeIndex === order.length - 1) {
    if (handoff.kind !== "TERMINAL_TO_RUNTIME"
        || handoff.to_owner_role_id !== "GLOBAL_RUNTIME"
        || handoff.to_goal_id !== "RUNTIME_INTEGRATION_AND_DEPLOYMENT") {
      throw new Error("terminal checkpoint must hand the root to Runtime");
    }
    if (!state.product_acceptance.rc_ready) {
      throw new Error("terminal Runtime handoff requires all three Product-acceptance roots");
    }
  } else {
    const expectedNextOwner = nodesById.get(order[nodeIndex + 1]).owner_role_id;
    if (handoff.kind !== "FEATURE_TO_FEATURE"
        || handoff.to_owner_role_id !== expectedNextOwner) {
      throw new Error("checkpoint recipient does not match the compiled dependency tail");
    }
  }
}

function validateProductAcceptance(acceptance, state, productAcceptanceProof = null) {
  exactKeys(acceptance, [
    "question_tree_sha256", "change_manifest_sha256", "observations_sha256",
    "evidence_cache_sha256", "acceptance_compiler_result_sha256",
    "auditor_attestation_sha256", "acceptance_receipt_sha256",
    "open_question_ids", "authorized_exception_ids", "roots", "rc_ready",
    "auditor_session_id", "evaluated_at_utc", "critical_freezes",
  ], "Product acceptance");
  requireSha(acceptance.question_tree_sha256, "question tree");
  requireSha(acceptance.change_manifest_sha256, "question-tree change manifest");
  requireSha(acceptance.observations_sha256, "question observations");
  requireSha(acceptance.evidence_cache_sha256, "question evidence cache");
  requireSha(acceptance.acceptance_compiler_result_sha256, "question compiler result");
  requireSha(acceptance.auditor_attestation_sha256, "Auditor acceptance attestation");
  requireSha(acceptance.acceptance_receipt_sha256, "question acceptance receipt");
  const acceptanceReceiptBody = structuredClone(acceptance);
  delete acceptanceReceiptBody.acceptance_receipt_sha256;
  if (digest(acceptanceReceiptBody) !== acceptance.acceptance_receipt_sha256) {
    throw new Error("Product-acceptance receipt is not bound to its exact result");
  }
  for (const [label, ids] of [
    ["open question IDs", acceptance.open_question_ids],
    ["authorized exception IDs", acceptance.authorized_exception_ids],
  ]) {
    if (!Array.isArray(ids)
        || ids.some((id) => !/^(FR|DB|SEC)-[A-Z0-9._:-]+$/.test(id))
        || new Set(ids).size !== ids.length
        || [...ids].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))).join("\0") !== ids.join("\0")) {
      throw new Error(`${label} are not exact and deterministic`);
    }
  }
  exactKeys(acceptance.roots, [
    "FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY",
  ], "Product acceptance roots");
  const allowed = new Set(["PASS", "OPEN_REPAIR", "BLOCKED", "PENDING_ADMISSION"]);
  for (const [root, status] of Object.entries(acceptance.roots)) {
    if (!allowed.has(status)) throw new Error(`${root} Product-acceptance status is invalid`);
  }
  if (typeof acceptance.rc_ready !== "boolean"
      || acceptance.rc_ready !== Object.values(acceptance.roots).every((status) => status === "PASS")) {
    throw new Error("RC_READY does not equal the exact three-root conjunction");
  }
  if (acceptance.rc_ready && acceptance.open_question_ids.length !== 0) {
    throw new Error("RC_READY cannot retain an open applicable question");
  }
  requireString(acceptance.auditor_session_id, "Product-acceptance Auditor session");
  requireIso(acceptance.evaluated_at_utc, "Product-acceptance time");
  if (new Date(acceptance.evaluated_at_utc) > new Date(state.snapshot_at)) {
    throw new Error("Product acceptance postdates its campaign snapshot");
  }
  if (!Array.isArray(acceptance.critical_freezes)) {
    throw new Error("critical-freeze state is missing");
  }
  for (const freeze of acceptance.critical_freezes) {
    exactKeys(freeze, [
      "finding_sha256", "scope", "global", "status", "clear_evidence_sha256",
    ], "critical freeze");
    requireSha(freeze.finding_sha256, "critical finding");
    requireString(freeze.scope, "critical freeze scope");
    if (typeof freeze.global !== "boolean" || !["ACTIVE", "CLEARED"].includes(freeze.status)) {
      throw new Error("critical freeze state is invalid");
    }
    if ((freeze.status === "CLEARED") !== (freeze.clear_evidence_sha256 !== null)) {
      throw new Error("critical freeze clearance evidence is inconsistent");
    }
    if (freeze.clear_evidence_sha256 !== null) requireSha(freeze.clear_evidence_sha256, "critical freeze clearance");
  }
  if (acceptance.critical_freezes.some((freeze) => freeze.status === "ACTIVE")
      && acceptance.rc_ready) {
    throw new Error("active critical freeze cannot be RC_READY");
  }
  if (acceptance.rc_ready && productAcceptanceProof === null) {
    throw new Error("RC_READY requires the exact question-tree compiler proof");
  }
  if (productAcceptanceProof !== null) {
    verifyProductAcceptanceProof(acceptance, productAcceptanceProof, state.campaign_id);
  }
  const auditor = state.agents.find((agent) =>
    agent.kind === "INDEPENDENT_AUDITOR"
    && agent.session_id === acceptance.auditor_session_id
    && agent.pinned);
  if (!auditor) throw new Error("Product acceptance does not bind the active pinned Auditor");
}

function validateSuccessorBinding(binding, expectedKind, successorWave, currentSessionIds) {
  exactKeys(binding, [
    "role_id", "kind", "session_id", "campaign_id", "campaign_version",
    "governance_version", "display_name", "pinned", "spawn_reason",
  ], `successor ${expectedKind} binding`);
  for (const field of [
    "role_id", "session_id", "campaign_id", "campaign_version",
    "governance_version", "display_name", "spawn_reason",
  ]) requireString(binding[field], `successor ${expectedKind} ${field}`);
  if (binding.kind !== expectedKind
      || binding.campaign_id !== successorWave.successor_campaign_id
      || binding.campaign_version !== successorWave.successor_campaign_version
      || binding.governance_version !== "2.1rc"
      || binding.display_name !== `${binding.role_id} ${binding.campaign_version} 2.1rc`
      || !CAMPAIGN_AGENT_NAME.test(binding.display_name)
      || binding.pinned !== true
      || binding.spawn_reason !== "FRESH_CAMPAIGN"
      || currentSessionIds.has(binding.session_id)) {
    throw new Error(`successor ${expectedKind} must be fresh, pinned, named, and disjoint`);
  }
}

function validateSuccessorWave(state, currentSessionIds) {
  exactKeys(state.successor_wave, [
    "status", "disposition_identity", "candidate_digest_sha256",
    "gpt_assist_handoff_sha256",
    "successor_campaign_id", "successor_campaign_version",
    "successor_orchestrator_binding", "successor_auditor_binding",
    "successor_feature_agent_bindings", "product_writer_lease_status",
  ], "successor wave");
  if (state.successor_wave.status === "PENDING") {
    if (state.successor_wave.disposition_identity !== null
        || state.successor_wave.candidate_digest_sha256 !== null
        || state.successor_wave.gpt_assist_handoff_sha256 !== null
        || state.successor_wave.successor_campaign_id !== null
        || state.successor_wave.successor_campaign_version !== null
        || state.successor_wave.successor_orchestrator_binding !== null
        || state.successor_wave.successor_auditor_binding !== null
        || state.successor_wave.successor_feature_agent_bindings.length !== 0
        || state.successor_wave.product_writer_lease_status !== "NOT_CREATED") {
      throw new Error("pending successor wave contains invented identity");
    }
    return;
  }
  if (state.successor_wave.status === "CANDIDATE_RECORDED") {
    if (state.successor_wave.disposition_identity !== "NEXT_CAMPAIGN_CANDIDATE"
        || !SHA256.test(state.successor_wave.candidate_digest_sha256)
        || state.successor_wave.successor_campaign_id !== null
        || state.successor_wave.successor_campaign_version !== null
        || state.successor_wave.successor_orchestrator_binding !== null
        || state.successor_wave.successor_auditor_binding !== null
        || state.successor_wave.successor_feature_agent_bindings.length !== 0
        || state.successor_wave.product_writer_lease_status !== "NOT_CREATED"
        || !["MERGED_NOT_ACCEPTED_LIVE", "ACCEPTED_LIVE_CLOSED"].includes(state.status)) {
      throw new Error("candidate-only successor record contains a speculative roster or invalid status");
    }
    if (state.gpt_assist_mode === "GPT_ASSIST") {
      requireSha(state.successor_wave.gpt_assist_handoff_sha256, "GPT_ASSIST candidate handoff");
    } else if (state.successor_wave.gpt_assist_handoff_sha256 !== null) {
      throw new Error("DIRECT_ONLY candidate cannot claim a GPT_ASSIST handoff");
    }
    return;
  }
  requireString(state.successor_wave.disposition_identity, "successor disposition identity");
  requireSha(state.successor_wave.candidate_digest_sha256, "successor candidate digest");
  if (!Array.isArray(state.successor_wave.successor_feature_agent_bindings)) {
    throw new Error("successor feature bindings must be an array");
  }
  if (state.successor_wave.disposition_identity === "NO_NEXT_CAMPAIGN_REQUIRED") {
    if (state.status !== "ACCEPTED_LIVE_CLOSED"
        || state.successor_wave.status !== "RECORDED"
        || state.successor_wave.successor_campaign_id !== null
        || state.successor_wave.gpt_assist_handoff_sha256 !== null
        || state.successor_wave.successor_campaign_version !== null
        || state.successor_wave.successor_orchestrator_binding !== null
        || state.successor_wave.successor_auditor_binding !== null
        || state.successor_wave.successor_feature_agent_bindings.length !== 0
        || state.successor_wave.product_writer_lease_status !== "NOT_APPLICABLE") {
      throw new Error("no-next-campaign disposition cannot claim successor sessions");
    }
    return;
  }
  if (state.gpt_assist_mode === "GPT_ASSIST") {
    requireSha(state.successor_wave.gpt_assist_handoff_sha256, "GPT_ASSIST successor handoff");
  } else if (state.successor_wave.gpt_assist_handoff_sha256 !== null) {
    throw new Error("DIRECT_ONLY successor wave cannot claim a GPT_ASSIST handoff");
  }
  requireString(state.successor_wave.successor_campaign_id, "successor campaign ID");
  requireString(state.successor_wave.successor_campaign_version, "successor campaign version");
  const dependencyOwners = new Set(
    state.dependency_nodes.map((node) => node.owner_role_id),
  );
  if (state.successor_wave.successor_campaign_id === state.campaign_id
      || state.successor_wave.successor_campaign_version === state.campaign_version
      || state.successor_wave.successor_feature_agent_bindings.length
        !== dependencyOwners.size) {
    throw new Error("successor campaign identity must be new");
  }
  validateSuccessorBinding(
    state.successor_wave.successor_orchestrator_binding,
    "GLOBAL_ORCHESTRATOR",
    state.successor_wave,
    currentSessionIds,
  );
  validateSuccessorBinding(
    state.successor_wave.successor_auditor_binding,
    "INDEPENDENT_AUDITOR",
    state.successor_wave,
    currentSessionIds,
  );
  if (state.successor_wave.successor_orchestrator_binding.role_id
        === state.successor_wave.successor_auditor_binding.role_id
      || state.successor_wave.successor_orchestrator_binding.session_id
        === state.successor_wave.successor_auditor_binding.session_id) {
    throw new Error("successor Orchestrator and Auditor identities must be distinct");
  }
  if (state.status === "ACCEPTED_LIVE_CLOSED") {
    if (state.successor_wave.status !== "RECORDED"
        || state.successor_wave.product_writer_lease_status
          !== "RELEASED_AFTER_ACCEPTED_LIVE") {
      throw new Error("accepted-live closure must release the oriented successor lease");
    }
  } else if (state.active_goal.status !== "COMPLETE"
      || state.checkpoint_handoff?.kind !== "TERMINAL_TO_RUNTIME"
      || state.successor_wave.status !== "ORIENTED_HELD"
      || state.successor_wave.product_writer_lease_status
        !== "HELD_PENDING_ACCEPTED_LIVE") {
    throw new Error("successor wave may orient only at terminal Runtime handoff");
  }
  const roles = new Set([
    state.successor_wave.successor_orchestrator_binding.role_id,
    state.successor_wave.successor_auditor_binding.role_id,
  ]);
  const sessions = new Set([
    state.successor_wave.successor_orchestrator_binding.session_id,
    state.successor_wave.successor_auditor_binding.session_id,
  ]);
  for (const binding of state.successor_wave.successor_feature_agent_bindings) {
    if (!dependencyOwners.has(binding.role_id)) {
      throw new Error("successor Feature Agent is not in the admitted dependency roster");
    }
    validateSuccessorBinding(
      binding, "FEATURE_AGENT", state.successor_wave, currentSessionIds,
    );
    if (roles.has(binding.role_id)
        || sessions.has(binding.session_id)) {
      throw new Error("successor roster contains duplicate identity");
    }
    roles.add(binding.role_id);
    sessions.add(binding.session_id);
  }
}

function validateLivingRecordBinding(binding, label = "living campaign record") {
  exactKeys(binding, [
    "events_root", "current_view_path", "event_count", "ledger_sha256",
    "writer_heads", "current_view_sha256",
  ], label);
  for (const field of ["events_root", "current_view_path"]) {
    requireString(binding[field], `${label} ${field}`);
    if (path.isAbsolute(binding[field]) || binding[field].split("/").includes("..")) {
      throw new Error(`${label} path is not project-relative`);
    }
  }
  if (!Number.isSafeInteger(binding.event_count) || binding.event_count < 1) {
    throw new Error(`${label} event count is invalid`);
  }
  requireSha(binding.ledger_sha256, `${label} ledger`);
  requireSha(binding.current_view_sha256, `${label} current view`);
  requireRecord(binding.writer_heads, `${label} writer heads`);
  for (const [sessionId, head] of Object.entries(binding.writer_heads)) {
    requireString(sessionId, `${label} writer session`);
    requireSha(head, `${label} writer head`);
  }
}

export function validateCampaignState(state, options = {}) {
  exactKeys(state, [
    "schema", "campaign_id", "campaign_version", "governance_version", "status",
    "snapshot_sequence", "snapshot_at",
    "configuration_snapshot_sha256", "progress_interval_minutes", "gpt_assist_mode",
    "authority_writer_role", "standard_authority",
    "active_campaign_article", "topology", "dependency_nodes", "dependency_order",
    "root", "active_goal", "lease", "checkpoint_handoff", "agents", "auditor",
    "runtime", "accepted_live", "last_progress", "open_owner_questions", "blocker",
    "next_action", "standard_promotion", "successor_wave", "living_record", "cascade",
    "product_acceptance",
  ], "campaign state");
  if (state.schema !== "governance.portable_campaign_state.v1") {
    throw new Error("campaign state schema mismatch");
  }
  requireString(state.campaign_id, "campaign_id");
  requireString(state.campaign_version, "campaign_version");
  if (state.governance_version !== "2.1rc") throw new Error("campaign governance version mismatch");
  if (!CAMPAIGN_STATUSES.has(state.status)) throw new Error("campaign status is invalid");
  if (!Number.isSafeInteger(state.snapshot_sequence) || state.snapshot_sequence < 0) {
    throw new Error("snapshot_sequence is invalid");
  }
  requireIso(state.snapshot_at, "snapshot_at");
  requireSha(state.configuration_snapshot_sha256, "configuration snapshot");
  if (!Number.isSafeInteger(state.progress_interval_minutes)
      || state.progress_interval_minutes < 1
      || state.progress_interval_minutes > 1440) {
    throw new Error("progress interval must come from the admitted configuration snapshot");
  }
  if (!GPT_ASSIST_MODES.has(state.gpt_assist_mode)) {
    throw new Error("GPT_ASSIST mode is invalid");
  }
  if (state.authority_writer_role !== "GLOBAL_ORCHESTRATOR") {
    throw new Error("only the Campaign Orchestrator may write authority");
  }
  exactKeys(state.standard_authority, ["release_identity", "meaning"], "standard authority");
  requireString(state.standard_authority.release_identity, "standard release identity");
  if (state.standard_authority.meaning !== "LAST_ACCEPTED_LIVE_RELEASE") {
    throw new Error("standard authority must describe the last accepted live release");
  }
  requireString(state.active_campaign_article, "active campaign article");
  validateLivingRecordBinding(state.living_record);
  if (state.living_record.events_root
        !== `campaigns/${state.campaign_id}/events`
      || state.living_record.current_view_path !== state.active_campaign_article) {
    throw new Error("living campaign paths do not bind the active campaign article");
  }
  if (state.topology !== "SINGLE_CUMULATIVE_ROOT") {
    throw new Error("2.1rc activation admits exactly one cumulative workstream");
  }
  const order = compileDependencyOrder(state.dependency_nodes);
  if (!Array.isArray(state.dependency_order)
      || order.join("\0") !== state.dependency_order.join("\0")) {
    throw new Error("dependency_order is not deterministic");
  }
  const nodesById = new Map(state.dependency_nodes.map((node) => [node.node_id, node]));

  exactKeys(state.root, [
    "root_id", "branch", "commit", "tree", "remote_commit", "remote_tree",
    "clean", "pushed",
  ], "campaign root");
  for (const field of ["root_id", "branch", "commit", "tree", "remote_commit", "remote_tree"]) {
    requireString(state.root[field], `root ${field}`);
  }
  if (state.root.pushed
      && (state.root.commit !== state.root.remote_commit || state.root.tree !== state.root.remote_tree)) {
    throw new Error("pushed root is not remote-equal");
  }
  exactKeys(state.active_goal, [
    "goal_id", "goal_system_id", "stage", "owner_role_id", "dependency_node_id",
    "status", "instruction_sha256", "done_when_sha256", "started_at",
    "completion_receipt_sha256",
  ], "active goal");
  requireString(state.active_goal.goal_id, "active goal ID");
  requireString(state.active_goal.goal_system_id, "active goal system ID");
  if (!GOAL_STAGES.has(state.active_goal.stage)) {
    throw new Error("active goal stage is invalid");
  }
  requireSha(state.active_goal.instruction_sha256, "active goal instruction");
  requireSha(state.active_goal.done_when_sha256, "active goal done-when");
  requireIso(state.active_goal.started_at, "active goal start");
  if (!GOAL_STATUSES.has(state.active_goal.status)) {
    throw new Error("active goal status is invalid");
  }
  requireString(state.active_goal.owner_role_id, "active goal owner");
  if (nodesById.get(state.active_goal.dependency_node_id)?.owner_role_id
      !== state.active_goal.owner_role_id) {
    throw new Error("active goal does not match its dependency owner");
  }
  exactKeys(state.lease, ["lease_id", "holder_role_id", "root_id", "status"], "campaign lease");
  if (state.lease.root_id !== state.root.root_id
      || state.lease.holder_role_id !== state.active_goal.owner_role_id) {
    throw new Error("goal, lease, and root custody mismatch");
  }
  if (state.active_goal.status === "COMPLETE"
      && !(state.root.clean && state.root.pushed && state.lease.status === "RELEASED")) {
    throw new Error("goal cannot close before clean pushed checkpoint and lease release");
  }
  if ((state.active_goal.status === "COMPLETE")
      !== (state.active_goal.completion_receipt_sha256 !== null)) {
    throw new Error("goal completion and completion receipt must agree");
  }
  if (state.active_goal.completion_receipt_sha256 !== null) {
    requireSha(state.active_goal.completion_receipt_sha256, "goal completion receipt");
  }
  validateCheckpointHandoff(state, order, nodesById);

  if (!Array.isArray(state.agents)) throw new Error("campaign agent roster is missing");
  const sessionIds = new Set();
  for (const agent of state.agents) {
    validateAgent(agent, state.campaign_id, state.campaign_version);
    if (sessionIds.has(agent.session_id)) throw new Error("duplicate campaign session");
    sessionIds.add(agent.session_id);
  }
  for (const kind of ["GLOBAL_ORCHESTRATOR", "GLOBAL_RUNTIME", "INDEPENDENT_AUDITOR"]) {
    const matching = state.agents.filter((agent) => agent.kind === kind && agent.pinned);
    if (matching.length !== 1) {
      throw new Error(`exactly one required pinned role is required: ${kind}`);
    }
  }
  const dependencyOwners = new Set(state.dependency_nodes.map((node) => node.owner_role_id));
  for (const owner of dependencyOwners) {
    const matching = state.agents.filter((agent) =>
      agent.kind === "FEATURE_AGENT" && agent.role_id === owner && agent.pinned
      && agent.spawn_reason === "FRESH_CAMPAIGN");
    if (matching.length !== 1) {
      throw new Error(`exactly one fresh pinned Feature Agent is required: ${owner}`);
    }
  }
  const activeOwnerAgents = state.agents.filter((agent) =>
    agent.kind === "FEATURE_AGENT"
    && agent.role_id === state.active_goal.owner_role_id
    && agent.campaign_id === state.campaign_id
    && agent.pinned
    && agent.spawn_reason === "FRESH_CAMPAIGN");
  if (activeOwnerAgents.length !== 1) {
    throw new Error("active goal must bind exactly one fresh pinned Feature Agent");
  }
  const [activeOwnerAgent] = activeOwnerAgents;
  validateProductAcceptance(
    state.product_acceptance,
    state,
    options.product_acceptance_proof ?? null,
  );
  validateCascadeState(state.cascade, {productAcceptance: state.product_acceptance});
  if (state.cascade.audit_reconciliation !== null) {
    for (const report of state.cascade.audit_reconciliation.reports) {
      if (report.auditor_session_id !== state.auditor.session_id) {
        throw new Error("cascade audit report is bound to a different Auditor session");
      }
      const auditWorker = state.agents.find((agent) =>
        agent.kind === "AUDIT_WORKER"
        && agent.session_id === report.worker_session_id
        && agent.campaign_id === state.campaign_id
        && agent.campaign_version === state.campaign_version
        && agent.material_seam === report.discipline
        && agent.spawn_reason.includes("ON_DEMAND")
        && ["CAMPAIGN_ACTIVE", "ARCHIVED_UNPINNED", "REPLACED_UNPINNED"].includes(agent.state));
      if (!auditWorker) {
        throw new Error("cascade audit report is not bound to a real campaign audit worker");
      }
    }
  }
  if (state.cascade.finalizer !== null) {
    const finalizerAgent = state.agents.find((agent) =>
      agent.kind === "CAMPAIGN_FINALIZER"
      && agent.session_id === state.cascade.finalizer.session_id
      && agent.campaign_id === state.campaign_id
      && agent.campaign_version === state.campaign_version
      && agent.pinned === true);
    if (!finalizerAgent) {
      throw new Error("cascade Finalizer is not bound to the real pinned campaign roster");
    }
  }

  exactKeys(state.auditor, [
    "session_id", "pinned", "findings_state", "intent_questions_state",
    "audit_state_identity", "next_campaign_candidate",
  ], "auditor state");
  const auditorAgent = state.agents.find((agent) =>
    agent.kind === "INDEPENDENT_AUDITOR"
    && agent.session_id === state.auditor.session_id
    && agent.pinned);
  if (!state.auditor.pinned || !auditorAgent) {
    throw new Error("active Auditor must be pinned and present");
  }
  requireString(state.auditor.audit_state_identity, "Auditor state identity");
  exactKeys(state.runtime, [
    "session_id", "state_identity", "deployed_identity", "rollback_identity",
  ], "Runtime state");
  for (const field of ["session_id", "state_identity", "deployed_identity", "rollback_identity"]) {
    requireString(state.runtime[field], `Runtime ${field}`);
  }
  const runtimeAgent = state.agents.find((agent) =>
    agent.kind === "GLOBAL_RUNTIME"
    && agent.session_id === state.runtime.session_id
    && agent.pinned);
  if (!runtimeAgent) throw new Error("Runtime state must bind the pinned Runtime");

  const acceptedLiveKeys = state.accepted_live.status === "VERIFIED"
    ? [
      "status", "deployed_identity", "rollback_identity",
      "independent_audit_identity", "closure_receipt_sha256",
      "cascade_state_sha256",
    ]
    : [
      "status", "deployed_identity", "rollback_identity",
      "independent_audit_identity", "closure_receipt_sha256",
    ];
  exactKeys(state.accepted_live, acceptedLiveKeys, "accepted live");
  exactKeys(state.last_progress, ["at", "kind", "identity"], "last progress");
  requireIso(state.last_progress.at, "last progress at");
  requireString(state.last_progress.kind, "last progress kind");
  requireString(state.last_progress.identity, "last progress identity");
  if (!Array.isArray(state.open_owner_questions)) throw new Error("owner questions must be an array");

  if ((state.status === "TRUE_BLOCKER_SUSPENDED") !== (state.blocker !== null)
      || (state.active_goal.status === "SUSPENDED_TRUE_BLOCKER") !== (state.blocker !== null)) {
    throw new Error("true-blocker suspension, goal suspension, and blocker presence must agree");
  }
  if (state.blocker !== null) {
    validateTrueBlocker(state.blocker, "campaign blocker");
  }
  requireString(state.next_action, "next action");
  exactKeys(state.standard_promotion, ["status", "source_campaign_id"], "standard promotion");
  if (state.standard_promotion.source_campaign_id !== state.campaign_id) {
    throw new Error("standard promotion source mismatch");
  }
  if (state.standard_promotion.status === "APPLIED"
      && state.status !== "ACCEPTED_LIVE_CLOSED") {
    throw new Error("work in progress cannot enter standard authority");
  }
  if (state.status === "ACCEPTED_LIVE_CLOSED") {
    if (state.accepted_live.status !== "VERIFIED"
        || state.accepted_live.deployed_identity !== state.runtime.deployed_identity
        || state.accepted_live.rollback_identity !== state.runtime.rollback_identity
        || state.accepted_live.independent_audit_identity !== state.auditor.audit_state_identity
        || state.standard_authority.release_identity !== state.runtime.deployed_identity
        || state.standard_promotion.status !== "APPLIED"
        || state.auditor.next_campaign_candidate !== "RECORDED_FOR_ORCHESTRATOR") {
      throw new Error("accepted-live closure identities are incomplete or inconsistent");
    }
    if (state.active_goal.status !== "COMPLETE"
        || state.checkpoint_handoff?.kind !== "TERMINAL_TO_RUNTIME"
        || state.checkpoint_handoff?.status !== "ACCEPTED"
        || state.lease.status !== "RELEASED"
        || !state.root.clean
        || !state.root.pushed
        || state.blocker !== null
        || state.open_owner_questions.length !== 0) {
      throw new Error("accepted-live closure requires terminal clean root and no unresolved owner hold");
    }
    if (!state.product_acceptance.rc_ready) {
      throw new Error("accepted-live closure requires all three Product-acceptance roots");
    }
    const cascadeFinalCommit = state.cascade.finalizer?.final_commit ?? state.cascade.first_pass.commit;
    const cascadeFinalTree = state.cascade.finalizer?.final_tree ?? state.cascade.first_pass.tree;
    if (state.cascade.stage !== "READY_FOR_ACCEPTANCE"
        || state.cascade.acceptance.final_candidate_commit !== cascadeFinalCommit
        || state.cascade.acceptance.final_candidate_tree !== cascadeFinalTree
        || state.root.commit !== cascadeFinalCommit
        || state.root.tree !== cascadeFinalTree
        || state.root.remote_commit !== cascadeFinalCommit
        || state.root.remote_tree !== cascadeFinalTree) {
      throw new Error("accepted-live closure does not bind the exact final cascade candidate");
    }
    requireString(state.accepted_live.independent_audit_identity, "independent audit identity");
    requireSha(state.accepted_live.closure_receipt_sha256, "closure receipt");
    validateAcceptedLiveCascadeBinding({
      cascade: state.cascade,
      acceptedLive: state.accepted_live,
      productAcceptance: state.product_acceptance,
    });
  } else if (state.accepted_live.status !== "PENDING") {
    throw new Error("accepted-live state cannot verify before closure");
  }
  validateSuccessorWave(state, sessionIds);
  return {activeOwnerSessionId: activeOwnerAgent?.session_id ?? null};
}

export function applyCampaignTransition(previous, next, actor, livingProof) {
  exactKeys(livingProof, [
    "previous_events", "next_events", "previous_view_sha256",
    "next_view_sha256", "consumed_gpt_assist_handoff_sha256",
    "previous_product_acceptance_proof", "next_product_acceptance_proof",
  ], "living campaign transition proof");
  const previousProductAcceptanceProof = livingProof.previous_product_acceptance_proof;
  const nextProductAcceptanceProof = livingProof.next_product_acceptance_proof;
  const previousDerived = validateCampaignState(previous, {
    product_acceptance_proof: previousProductAcceptanceProof,
  });
  validateCampaignState(next, {
    product_acceptance_proof: nextProductAcceptanceProof,
  });
  exactKeys(actor, ["role", "session_id"], "transition actor");
  if (actor.role !== "GLOBAL_ORCHESTRATOR") {
    throw new Error("only the Campaign Orchestrator may apply authority transitions");
  }
  const admittedActor = previous.agents.find((agent) =>
    agent.kind === "GLOBAL_ORCHESTRATOR" && agent.session_id === actor.session_id && agent.pinned);
  if (!admittedActor) throw new Error("transition actor is not the admitted pinned Orchestrator");
  if (next.campaign_id !== previous.campaign_id
      || next.campaign_version !== previous.campaign_version
      || next.governance_version !== previous.governance_version
      || next.snapshot_sequence !== previous.snapshot_sequence + 1
      || new Date(next.snapshot_at) <= new Date(previous.snapshot_at)) {
    throw new Error("campaign transition sequence or identity is invalid");
  }
  const previousLedger = validateLivingCampaignLedger(
    previous, livingProof.previous_events, {
      enforce_state_binding: true,
      product_acceptance_proof: previousProductAcceptanceProof,
    },
  );
  const nextLedger = validateLivingCampaignLedger(
    next, livingProof.next_events, {
      enforce_state_binding: true,
      product_acceptance_proof: nextProductAcceptanceProof,
    },
  );
  const previousView = compileLivingCampaignView(previous, livingProof.previous_events, {
    product_acceptance_proof: previousProductAcceptanceProof,
  });
  const nextView = compileLivingCampaignView(next, livingProof.next_events, {
    product_acceptance_proof: nextProductAcceptanceProof,
  });
  if (previousView.markdown_sha256 !== previous.living_record.current_view_sha256
      || nextView.markdown_sha256 !== next.living_record.current_view_sha256
      || livingProof.previous_view_sha256 !== previous.living_record.current_view_sha256
      || livingProof.next_view_sha256 !== next.living_record.current_view_sha256
      || nextLedger.ordered_events.length < previousLedger.ordered_events.length
      || previousLedger.ordered_events.some((event, index) =>
        nextLedger.ordered_events[index]?.event_id !== event.event_id)) {
    throw new Error("living campaign transition rewrites, deletes, or reorders prior history");
  }
  for (const [sessionId, head] of Object.entries(previousLedger.writer_heads)) {
    const matchingIndex = nextLedger.ordered_events.findIndex((event) =>
      event.writer_session_id === sessionId && event.event_id === head);
    if (matchingIndex < 0) throw new Error("living campaign writer head is not preserved");
  }
  const previousOwnerSession = previousDerived.activeOwnerSessionId;
  for (const event of nextLedger.ordered_events.slice(previousLedger.ordered_events.length)) {
    if (event.authority_snapshot_sequence !== previous.snapshot_sequence) {
      throw new Error("new living event does not bind the authority snapshot it extends");
    }
    if (new Date(event.recorded_at) <= new Date(previous.snapshot_at)
        || new Date(event.recorded_at) > new Date(next.snapshot_at)) {
      throw new Error("new living event falls outside its authority transition interval");
    }
    if (event.writer_kind === "FEATURE_AGENT"
        && (event.writer_session_id !== previousOwnerSession
          || event.writer_role_id !== previous.active_goal.owner_role_id
          || event.goal_id !== previous.active_goal.goal_id
          || event.dependency_node_id !== previous.active_goal.dependency_node_id
          || event.writer_lease_id !== previous.lease.lease_id)) {
      throw new Error("inactive Feature Agent forged a living campaign event");
    }
  }
  for (const field of ["topology", "active_campaign_article"]) {
    if (next[field] !== previous[field]) {
      throw new Error(`campaign transition changed immutable ${field}`);
    }
  }
  if (next.gpt_assist_mode !== previous.gpt_assist_mode) {
    throw new Error("campaign transition changed immutable GPT_ASSIST mode");
  }
  if (JSON.stringify(next.dependency_nodes) !== JSON.stringify(previous.dependency_nodes)
      || JSON.stringify(next.dependency_order) !== JSON.stringify(previous.dependency_order)
      || next.root.root_id !== previous.root.root_id
      || next.root.branch !== previous.root.branch) {
    throw new Error("campaign transition changed immutable graph or root topology");
  }
  for (const kind of ["GLOBAL_ORCHESTRATOR", "GLOBAL_RUNTIME", "INDEPENDENT_AUDITOR"]) {
    const before = previous.agents.find((agent) => agent.kind === kind && agent.pinned);
    const after = next.agents.find((agent) => agent.kind === kind && agent.pinned);
    if (!before || !after || before.session_id !== after.session_id
        || before.role_id !== after.role_id) {
      throw new Error(`campaign transition replaced persistent ${kind} identity`);
    }
  }
  for (const node of previous.dependency_nodes) {
    const before = previous.agents.find((agent) =>
      agent.kind === "FEATURE_AGENT" && agent.role_id === node.owner_role_id && agent.pinned);
    const after = next.agents.find((agent) =>
      agent.kind === "FEATURE_AGENT" && agent.role_id === node.owner_role_id && agent.pinned);
    if (!before || !after || before.session_id !== after.session_id) {
      throw new Error(`campaign transition replaced Feature Agent ${node.owner_role_id}`);
    }
  }
  if (previousDerived.activeOwnerSessionId === null) {
    throw new Error("previous active owner session is not bound");
  }
  if (previous.active_goal.status === "COMPLETE") {
    const handoff = previous.checkpoint_handoff;
    if (handoff.kind === "FEATURE_TO_FEATURE") {
      const previousNodeIndex = previous.dependency_order.indexOf(
        previous.active_goal.dependency_node_id,
      );
      const expectedNextNodeId = previous.dependency_order[previousNodeIndex + 1];
      const nextNode = next.dependency_nodes.find((node) =>
        node.node_id === expectedNextNodeId
        && node.owner_role_id === handoff.to_owner_role_id);
      if (!nextNode
          || next.active_goal.dependency_node_id !== expectedNextNodeId
          || next.active_goal.goal_id !== handoff.to_goal_id
          || next.active_goal.owner_role_id !== handoff.to_owner_role_id
          || next.active_goal.status !== "ACTIVE"
          || next.lease.root_id !== previous.root.root_id
          || next.lease.holder_role_id !== handoff.to_owner_role_id
          || next.lease.status !== "ACTIVE"
          || next.lease.lease_id === previous.lease.lease_id
          || next.checkpoint_handoff !== null
          || next.root.root_id !== previous.root.root_id
          || next.root.branch !== previous.root.branch
          || next.root.commit !== handoff.commit
          || next.root.tree !== handoff.tree
          || next.root.remote_commit !== handoff.remote_commit
          || next.root.remote_tree !== handoff.remote_tree
          || !next.root.clean
          || !next.root.pushed) {
        throw new Error("next snapshot does not consume the accepted feature handoff");
      }
    } else if (handoff.kind === "TERMINAL_TO_RUNTIME") {
      if (!["MERGED_NOT_ACCEPTED_LIVE", "ACCEPTED_LIVE_CLOSED"].includes(next.status)
          || next.checkpoint_handoff?.checkpoint_id !== handoff.checkpoint_id
          || next.root.root_id !== previous.root.root_id
          || next.root.branch !== handoff.branch
          || next.root.commit !== handoff.commit
          || next.root.tree !== handoff.tree
          || next.root.remote_commit !== handoff.remote_commit
          || next.root.remote_tree !== handoff.remote_tree) {
        throw new Error("terminal handoff does not advance into Runtime/release state");
      }
      const expectedGptHandoff = next.gpt_assist_mode === "GPT_ASSIST"
        ? next.successor_wave.gpt_assist_handoff_sha256 : null;
      if (expectedGptHandoff !== null
          ? livingProof.consumed_gpt_assist_handoff_sha256 !== expectedGptHandoff
          : livingProof.consumed_gpt_assist_handoff_sha256 !== null) {
        throw new Error("next campaign transition did not consume the exact GPT_ASSIST handoff");
      }
    }
  }
  return next;
}

export function writeStateCompareAndSwap(targetPath, expectedBytes, state) {
  const absolute = path.resolve(targetPath);
  const lockPath = `${absolute}.lock`;
  const temporary = `${absolute}.tmp-${process.pid}`;
  let lockFd;
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error("authority state target cannot be a symlink");
    }
    lockFd = fs.openSync(lockPath, "wx", 0o600);
    const currentBytes = fs.readFileSync(absolute, "utf8");
    if (currentBytes !== expectedBytes) {
      throw new Error("authority state changed since transition validation");
    }
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8", mode: 0o600, flag: "wx",
    });
    const tempFd = fs.openSync(temporary, "r");
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    fs.renameSync(temporary, absolute);
    fs.fsyncSync(lockFd);
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

export function decideHeartbeatAction(state, observation, nowIso) {
  const derived = validateCampaignState(state);
  exactKeys(observation, [
    "root_id", "root_branch", "root_commit", "root_tree", "remote_commit",
    "remote_tree", "root_clean", "root_pushed", "active_session_id",
    "active_goal_id", "active_dependency_node_id", "lease_id",
    "lease_holder_role_id", "checkpoint_id", "runtime_session_id",
    "runtime_state_identity", "deployed_identity", "rollback_identity",
    "auditor_session_id", "auditor_state_identity", "material_progress",
    "progress_kind", "progress_identity", "true_blocker",
  ], "campaign observation");
  const now = new Date(nowIso);
  if (!Number.isFinite(now.getTime())) throw new Error("heartbeat time is invalid");
  if (observation.true_blocker !== null) {
    validateTrueBlocker(observation.true_blocker, "observed true blocker");
    if (state.status === "TRUE_BLOCKER_SUSPENDED") {
      return {
        action: "WAIT_FOR_BLOCKER_RESOLUTION_NO_PROGRESS_TIMER",
        authority_write: false,
        writer: "GLOBAL_ORCHESTRATOR",
      };
    }
    return {
      action: "SUSPEND_SAME_GOAL_STOP_PROGRESS_TIMER_AND_ASK_OWNER",
      authority_write: true,
      writer: "GLOBAL_ORCHESTRATOR",
    };
  }
  if (state.status === "TRUE_BLOCKER_SUSPENDED") {
    return {
      action: "RESUME_SAME_GOAL_AND_RESTART_PROGRESS_TIMER",
      authority_write: true,
      writer: "GLOBAL_ORCHESTRATOR",
    };
  }
  const expectedCheckpoint = state.checkpoint_handoff?.checkpoint_id ?? null;
  const realityChanged = observation.root_id !== state.root.root_id
    || observation.root_branch !== state.root.branch
    || observation.root_commit !== state.root.commit
    || observation.root_tree !== state.root.tree
    || observation.remote_commit !== state.root.remote_commit
    || observation.remote_tree !== state.root.remote_tree
    || observation.root_clean !== state.root.clean
    || observation.root_pushed !== state.root.pushed
    || observation.active_session_id !== derived.activeOwnerSessionId
    || observation.active_goal_id !== state.active_goal.goal_id
    || observation.active_dependency_node_id !== state.active_goal.dependency_node_id
    || observation.lease_id !== state.lease.lease_id
    || observation.lease_holder_role_id !== state.lease.holder_role_id
    || observation.checkpoint_id !== expectedCheckpoint
    || observation.runtime_session_id !== state.runtime.session_id
    || observation.runtime_state_identity !== state.runtime.state_identity
    || observation.deployed_identity !== state.runtime.deployed_identity
    || observation.rollback_identity !== state.runtime.rollback_identity
    || observation.auditor_session_id !== state.auditor.session_id
    || observation.auditor_state_identity !== state.auditor.audit_state_identity;
  if (observation.material_progress) {
    requireString(observation.progress_kind, "progress kind");
    requireString(observation.progress_identity, "progress identity");
    if (!PROGRESS_KINDS.has(observation.progress_kind)) {
      throw new Error("material progress kind is not mechanically admitted");
    }
    const expectedProgressIdentity = {
      PRODUCT_COMMIT: state.root.commit,
      CHECKPOINT: expectedCheckpoint,
      GOAL_COMPLETION: state.active_goal.completion_receipt_sha256,
      PRODUCT_ACCEPTANCE: digest(state.product_acceptance),
      AUDIT: state.auditor.audit_state_identity,
      DEPLOYMENT: state.runtime.deployed_identity,
      ROLLBACK: state.runtime.rollback_identity,
    }[observation.progress_kind];
    if (expectedProgressIdentity === null
        || observation.progress_identity !== expectedProgressIdentity) {
      throw new Error("material progress identity is not bound to current reality");
    }
  } else if (observation.progress_kind !== null || observation.progress_identity !== null) {
    throw new Error("non-progress heartbeat cannot carry a progress claim");
  }
  if (observation.material_progress || realityChanged) {
    return {
      action: "RECONCILE_AND_WRITE_CAMPAIGN_SNAPSHOT",
      authority_write: true,
      writer: "GLOBAL_ORCHESTRATOR",
    };
  }
  const elapsed = now.getTime() - new Date(state.last_progress.at).getTime();
  if (elapsed >= state.progress_interval_minutes * 60_000) {
    return {
      action: "REPAIR_BROKEN_CHAIN_THEN_WRITE_CAMPAIGN_SNAPSHOT",
      authority_write: true,
      writer: "GLOBAL_ORCHESTRATOR",
    };
  }
  return {
    action: "NO_SEMANTIC_CHANGE_NO_AUTHORITY_COMMIT",
    authority_write: false,
    writer: "GLOBAL_ORCHESTRATOR",
  };
}

function main() {
  const [command, firstPath, secondPath, thirdPath] = process.argv.slice(2);
  if (!command || !firstPath) {
    throw new Error("usage: campaign-controller <validate|heartbeat|transition|apply-transition|event|seam-review> ...");
  }
  const firstBytes = fs.readFileSync(firstPath, "utf8");
  const first = JSON.parse(firstBytes);
  if (command === "validate") {
    validateCampaignState(first);
    process.stdout.write('{"status":"VALID"}\n');
  } else if (command === "heartbeat") {
    if (!secondPath || !thirdPath) throw new Error("heartbeat requires observation and time");
    const observation = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    process.stdout.write(`${JSON.stringify(decideHeartbeatAction(first, observation, thirdPath))}\n`);
  } else if (command === "transition") {
    if (!secondPath || !thirdPath) throw new Error("transition requires next state and actor");
    const next = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    const actor = JSON.parse(fs.readFileSync(thirdPath, "utf8"));
    applyCampaignTransition(first, next, actor);
    process.stdout.write('{"status":"APPLIED_BY_ADMITTED_ORCHESTRATOR"}\n');
  } else if (command === "apply-transition") {
    if (!secondPath) throw new Error("apply-transition requires next state");
    const next = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    const sessionId = process.env.GOVERNANCE_ORCHESTRATOR_SESSION_ID;
    requireString(sessionId, "host-bound Orchestrator session");
    applyCampaignTransition(first, next, {
      role: "GLOBAL_ORCHESTRATOR", session_id: sessionId,
    });
    writeStateCompareAndSwap(firstPath, firstBytes, next);
    process.stdout.write('{"status":"PERSISTED_BY_ADMITTED_ORCHESTRATOR"}\n');
  } else if (command === "event") {
    validateCompactEvent(first);
    process.stdout.write('{"status":"VALID_COMPACT_EVENT"}\n');
  } else if (command === "seam-review") {
    if (!secondPath) throw new Error("seam-review requires campaign state");
    const campaignState = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    validateSeamReviewBatch(first, campaignState);
    process.stdout.write('{"status":"VALID_SEAM_REVIEW_BATCH"}\n');
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
