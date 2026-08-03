#!/usr/bin/env node

import fs from "node:fs";

const path = new URL(
  "../schemas/browser-runtime-lifecycle.v1.json",
  import.meta.url,
);
const source = JSON.parse(fs.readFileSync(path, "utf8"));
let hostileRejected = 0;
const failures = [];

function validate(registry) {
  if (registry.schema !== "governance.portable_browser_runtime_lifecycle.v1"
      || registry.status !== "PREPARED_NOT_ACTIVATED") {
    throw new Error("registry identity or activation boundary is invalid");
  }
  if (registry.browser.interactive_browser !== "CONFIGURATION_SNAPSHOT_SELECTED"
      || !registry.browser.open_instruction.includes("user-selected interactive browser")
      || registry.browser.unavailable_status !== "SELECTED_BROWSER_CONTROL_UNAVAILABLE") {
    throw new Error("selected browser is not configuration-bound");
  }
  const forbidden = new Set(registry.browser.forbidden);
  for (const value of [
    "OPERATING_SYSTEM_DEFAULT_BROWSER", "GENERIC_OPEN_URL",
    "UNCONFIGURED_FALLBACK_BROWSER",
  ]) {
    if (!forbidden.has(value)) throw new Error(`missing forbidden browser route: ${value}`);
  }
  if (registry.automation.framework !== "CONFIGURATION_SNAPSHOT_SELECTED"
      || registry.automation.browser_project !== "EXPLICIT_USER_SELECTED_PROJECT"
      || registry.automation.profile !== "ISOLATED_AUTOMATION_PROFILE"
      || registry.automation.owner_profile_forbidden !== true
      || registry.automation.implicit_session_inheritance_forbidden !== true
      || registry.automation.authentication_source
        !== "CONFIGURATION_SNAPSHOT_SELECTED_AUTH_ROUTE") {
    throw new Error("automation isolation or authentication binding is invalid");
  }
  const blocker = registry.provider_auth_blocker;
  const exactBlockerFields = [
    "provider", "environment", "reason", "official_authorization_url",
    "selected_browser_required", "sensitive_link", "resume_check", "resume_goal_id",
  ];
  if (blocker.class !== "UNAVAILABLE_CREDENTIAL_OR_EXTERNAL_ACCESS"
      || blocker.required_fields.join("\0") !== exactBlockerFields.join("\0")
      || blocker.official_url_scheme !== "https"
      || blocker.selected_browser_required !== true
      || blocker.secret_retention_forbidden !== true
      || blocker.persisted_sensitive_link !== false
      || blocker.url_credentials_query_fragment_forbidden !== true
      || blocker.campaign_status !== "TRUE_BLOCKER_SUSPENDED"
      || blocker.goal_status !== "SUSPENDED_TRUE_BLOCKER"
      || blocker.timer_status !== "STOPPED"
      || blocker.watcher !== "ONE_BLOCKER_RESOLUTION_WATCHER"
      || blocker.resume !== "MECHANICAL_CHECK_RESUMES_SAME_GOAL_AND_TIMER") {
    throw new Error("provider-auth suspension contract is incomplete");
  }
  const lifecycle = registry.agent_lifecycle;
  if (lifecycle.persistent_roles.join(",") !== "GLOBAL_RUNTIME"
      || lifecycle.fresh_campaign_roles.join(",")
        !== "GLOBAL_ORCHESTRATOR,INDEPENDENT_AUDITOR,FEATURE_AGENT"
      || lifecycle.on_demand_roles.join(",") !== "PLATFORM_AGENT"
      || lifecycle.campaign_display_name
        !== "<OneWordRole> <CampaignVersion> <GovernanceVersion>"
      || lifecycle.runtime_display_name !== "Runtime Persistent 2.1rc"
      || lifecycle.current_identity_cardinality
        !== "EXACTLY_ONE_ORCHESTRATOR_ONE_AUDITOR_ONE_RUNTIME_AND_ONE_FEATURE_PER_DEPENDENCY_OWNER"
      || lifecycle.successor_identity_rule
        !== "PAIRWISE_DISTINCT_ROLES_AND_SESSIONS_DISJOINT_FROM_CURRENT_ROSTER"
      || lifecycle.successor_creation_trigger !== "TERMINAL_HANDOFF_TO_RUNTIME"
      || lifecycle.successor_pre_live_scope !== "ORIENTATION_AND_BLUEPRINT_ONLY"
      || lifecycle.successor_product_lease
        !== "HELD_UNTIL_PREDECESSOR_ACCEPTED_LIVE"
      || lifecycle.closing_auditor !== "REMAINS_PINNED_THROUGH_EXACT_LIVE_AUDIT") {
    throw new Error("campaign-scoped lifecycle is invalid");
  }
  const seam = registry.seam_review;
  if (seam.trigger !== "SUBSTANTIAL_PUSHED_CHECKPOINT"
      || seam.always_required.join(",") !== "SECURITY"
      || seam.reviewer_mode !== "FRESH_PINNED_READ_ONLY_ON_DEMAND"
      || seam.reviewer_identity_binding
        !== "EXACT_CURRENT_CAMPAIGN_PLATFORM_AGENT_SESSION_ROLE_AND_MATERIAL_SEAM"
      || seam.root_progress !== "CONTINUES_WHERE_SAFE"
      || seam.severity.CATASTROPHIC !== "HOLD_AFFECTED_HANDOFF_IMMEDIATELY"
      || seam.severity.MATERIAL
        !== "RETURN_CURRENT_ROOT_TO_ORIGINATING_FEATURE_AT_NEXT_STABLE_HANDOFF"
      || seam.severity.NONCRITICAL !== "NEXT_CAMPAIGN_BACKLOG"
      || seam.severity.PASS !== "NO_CORRECTION_CUSTODY"
      || seam.rejection_never_reverts_product !== true) {
    throw new Error("seam review workflow is invalid");
  }
  for (const surface of [
    "UI", "AUTHENTICATED_UI", "BACKEND_API", "DATABASE_SCHEMA",
    "PROVIDER_INTEGRATION", "RUNTIME_CONFIG",
  ]) {
    if (!Array.isArray(seam.surface_map[surface]) || seam.surface_map[surface].length === 0) {
      throw new Error(`surface review mapping is missing: ${surface}`);
    }
  }
}

validate(source);

const hostiles = [
  ["default browser", (d) => { d.browser.interactive_browser = "DEFAULT_BROWSER"; }],
  ["generic URL allowed", (d) => { d.browser.forbidden = d.browser.forbidden.filter((x) => x !== "GENERIC_OPEN_URL"); }],
  ["implicit automation browser", (d) => { d.automation.browser_project = "DEFAULT"; }],
  ["owner browser profile", (d) => { d.automation.owner_profile_forbidden = false; }],
  ["implicit auth inheritance", (d) => { d.automation.implicit_session_inheritance_forbidden = false; }],
  ["provider URL not HTTPS", (d) => { d.provider_auth_blocker.official_url_scheme = "any"; }],
  ["persisted sensitive provider link", (d) => { d.provider_auth_blocker.persisted_sensitive_link = true; }],
  ["provider URL secret material allowed", (d) => {
    d.provider_auth_blocker.url_credentials_query_fragment_forbidden = false;
  }],
  ["provider blocker does not stop timer", (d) => { d.provider_auth_blocker.timer_status = "RUNNING"; }],
  ["provider blocker creates new goal", (d) => { d.provider_auth_blocker.resume = "CREATE_NEW_GOAL"; }],
  ["persistent Orchestrator", (d) => { d.agent_lifecycle.persistent_roles.push("GLOBAL_ORCHESTRATOR"); }],
  ["duplicate current authorities allowed", (d) => { d.agent_lifecycle.current_identity_cardinality = "ONE_OR_MORE"; }],
  ["successor identities may overlap", (d) => { d.agent_lifecycle.successor_identity_rule = "DECLARED_ONLY"; }],
  ["successor starts after closure", (d) => { d.agent_lifecycle.successor_creation_trigger = "AFTER_ACCEPTED_LIVE"; }],
  ["successor writes before accepted live", (d) => { d.agent_lifecycle.successor_product_lease = "ACTIVE"; }],
  ["closing Auditor depinned early", (d) => { d.agent_lifecycle.closing_auditor = "UNPIN_AT_RUNTIME_HANDOFF"; }],
  ["platform wave pre-spawned", (d) => { d.agent_lifecycle.on_demand_roles = []; }],
  ["Security not always reviewed", (d) => { d.seam_review.always_required = []; }],
  ["reviewer session not roster-bound", (d) => { d.seam_review.reviewer_identity_binding = "SELF_ATTESTED"; }],
  ["material finding blocks immediately", (d) => { d.seam_review.severity.MATERIAL = "HOLD_NOW"; }],
  ["material finding changes owner", (d) => { d.seam_review.severity.MATERIAL = "SEND_TO_ORCHESTRATOR"; }],
  ["review reverts Product", (d) => { d.seam_review.rejection_never_reverts_product = false; }],
];

for (const [label, mutate] of hostiles) {
  const draft = structuredClone(source);
  mutate(draft);
  try {
    validate(draft);
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}

console.log(
  `PASS Governance 2.1rc browser/runtime/lifecycle: selected browser; isolated `
  + `automation; provider-auth suspension; campaign-scoped agents; parallel seam `
  + `reviews; ${hostileRejected} hostile cases rejected`,
);
