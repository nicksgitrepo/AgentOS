#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const source = JSON.parse(fs.readFileSync(new URL("../schemas/browser-runtime-lifecycle.v1.json", import.meta.url), "utf8"));

function validate(registry) {
  assert.equal(registry.schema, "governance.portable_browser_runtime_lifecycle.v1");
  assert.equal(registry.status, "PREPARED_NOT_ACTIVATED");
  assert.equal(registry.browser.interactive_browser, "CONFIGURATION_SNAPSHOT_SELECTED");
  assert.match(registry.browser.open_instruction, /user-selected interactive browser/u);
  assert.equal(registry.browser.unavailable_status, "SELECTED_BROWSER_CONTROL_UNAVAILABLE");
  for (const forbidden of ["OPERATING_SYSTEM_DEFAULT_BROWSER", "GENERIC_OPEN_URL", "UNCONFIGURED_FALLBACK_BROWSER"]) assert(registry.browser.forbidden.includes(forbidden));
  assert.equal(registry.automation.framework, "CONFIGURATION_SNAPSHOT_SELECTED");
  assert.equal(registry.automation.browser_project, "EXPLICIT_USER_SELECTED_PROJECT");
  assert.equal(registry.automation.profile, "ISOLATED_AUTOMATION_PROFILE");
  assert.equal(registry.automation.owner_profile_forbidden, true);
  assert.equal(registry.automation.implicit_session_inheritance_forbidden, true);
  assert.equal(registry.automation.authentication_source, "CONFIGURATION_SNAPSHOT_SELECTED_AUTH_ROUTE");
  const blocker = registry.provider_auth_blocker;
  assert.equal(blocker.class, "UNAVAILABLE_CREDENTIAL_OR_EXTERNAL_ACCESS");
  assert.deepEqual(blocker.required_fields, ["provider", "environment", "reason", "official_authorization_url", "selected_browser_required", "sensitive_link", "resume_check", "resume_goal_id"]);
  assert.equal(blocker.official_url_scheme, "https");
  assert.equal(blocker.selected_browser_required, true);
  assert.equal(blocker.secret_retention_forbidden, true);
  assert.equal(blocker.persisted_sensitive_link, false);
  assert.equal(blocker.url_credentials_query_fragment_forbidden, true);
  assert.equal(blocker.campaign_status, "ON_HOLD_DEPENDENT_OUTCOME");
  assert.equal(blocker.goal_status, "ON_HOLD_TRUE_BOUNDARY");
  assert.equal(blocker.timer_status, "STOPPED");
  assert.equal(blocker.watcher, "ONE_BLOCKER_RESOLUTION_WATCHER");
  assert.equal(blocker.resume, "MECHANICAL_CHECK_RESUMES_HELD_OUTCOME_AND_TIMER");
  const lifecycle = registry.agent_lifecycle;
  assert.deepEqual(lifecycle.persistent_roles, ["RUNTIME"]);
  assert.deepEqual(lifecycle.fresh_campaign_roles, ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT"]);
  assert.deepEqual(lifecycle.on_demand_roles, ["PLATFORM_AGENT"]);
  assert.equal(lifecycle.successor_creation_trigger, "CURRENT_AUDITOR_RELEASE_CLEARANCE_FOR_DEPLOYMENT");
  assert.equal(lifecycle.successor_pre_live_scope, "ORCHESTRATOR_ORIENTATION_ONLY");
  assert.equal(lifecycle.successor_roster_before_closure, "ORCHESTRATOR_ONLY_NO_AUDITOR_FEATURE_OR_PLATFORM_SESSION");
  assert.equal(lifecycle.successor_product_lease, "NONE_UNTIL_NEXT_CAMPAIGN_ADMISSION_AFTER_ACCEPTED_LIVE_CLOSURE");
  assert.equal(lifecycle.closing_auditor, "REMAINS_PINNED_THROUGH_EXACT_LIVE_AUDIT");
  const seam = registry.seam_review;
  assert.equal(seam.trigger, "CASCADE_COMPILED_APPLICABILITY_FOR_A_CHECKPOINT");
  assert.equal(seam.scheduler, "control/campaign-cascade.mjs");
  assert.deepEqual(seam.always_required, []);
  assert.equal(seam.surface_map, "NOT_A_SECOND_SCHEDULER; compatibility transport only");
  assert.equal(seam.reviewer_mode, "FRESH_PINNED_READ_ONLY_ON_DEMAND");
  assert.equal(seam.reviewer_identity_binding, "EXACT_CURRENT_CAMPAIGN_PLATFORM_AGENT_SESSION_ROLE_AND_MATERIAL_SEAM");
  assert.equal(seam.root_progress, "CONTINUES_WHERE_SAFE");
  assert.equal(seam.rejection_never_reverts_product, true);
}

validate(source);
const hostiles = [
  ["default browser", (draft) => { draft.browser.interactive_browser = "DEFAULT_BROWSER"; }],
  ["generic URL allowed", (draft) => { draft.browser.forbidden = draft.browser.forbidden.filter((value) => value !== "GENERIC_OPEN_URL"); }],
  ["implicit automation browser", (draft) => { draft.automation.browser_project = "DEFAULT"; }],
  ["owner browser profile", (draft) => { draft.automation.owner_profile_forbidden = false; }],
  ["provider URL not HTTPS", (draft) => { draft.provider_auth_blocker.official_url_scheme = "any"; }],
  ["persisted sensitive link", (draft) => { draft.provider_auth_blocker.persisted_sensitive_link = true; }],
  ["provider timer running", (draft) => { draft.provider_auth_blocker.timer_status = "RUNNING"; }],
  ["successor starts too early", (draft) => { draft.agent_lifecycle.successor_creation_trigger = "TERMINAL_HANDOFF_TO_RUNTIME"; }],
  ["successor roster pre-created", (draft) => { draft.agent_lifecycle.successor_roster_before_closure = "FULL_SUCCESSOR_WAVE"; }],
  ["successor writer lease", (draft) => { draft.agent_lifecycle.successor_product_lease = "ACTIVE"; }],
  ["security always required", (draft) => { draft.seam_review.always_required = ["SECURITY"]; }],
  ["second scheduler", (draft) => { draft.seam_review.surface_map = {}; }],
  ["self-attested reviewer", (draft) => { draft.seam_review.reviewer_identity_binding = "SELF_ATTESTED"; }],
  ["review reverts Product", (draft) => { draft.seam_review.rejection_never_reverts_product = false; }],
];
let rejected = 0;
for (const [label, mutate] of hostiles) {
  const draft = structuredClone(source);
  mutate(draft);
  assert.throws(() => validate(draft), undefined, label);
  rejected += 1;
}

console.log(`PASS Governance 2.1rc browser/runtime lifecycle (${rejected} hostile cases)`);
