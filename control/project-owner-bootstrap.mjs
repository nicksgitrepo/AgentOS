#!/usr/bin/env node

/* Bootstrap discovery, one-time Spawner start, permanent roster request, and Project Owner transition. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {compileProjectOwnerResponse} from "./project-owner-conversation.mjs";

export const PROJECT_OWNER_BOOTSTRAP_SCHEMA = "agentos.project_owner_bootstrap.v1";
export const PROJECT_MONITOR_INTERVAL_MINUTES = 15;
export const PERMANENT_PROJECT_ROLES = Object.freeze(["AGENTOS_CONTROLLER", "AGENTOS.MEMORY", "AGENTOS.ORCHESTRATOR", "AGENTOS.PRODUCT_OWNER", "AGENTOS.RUNTIME", "AGENTOS.SCHEDULER", "AGENTOS.SPAWNER"]);
export const SPAWNER_CREATED_PERMANENT_ROLES = Object.freeze(PERMANENT_PROJECT_ROLES.filter((role) => role !== "AGENTOS.SPAWNER"));
export const DEVELOPMENT_WORKFLOWS = Object.freeze(["PYRAMID", "COLLABORATIVE_AUDIT"]);

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function body(value) { return {...structuredClone(value), bootstrap_sha256: null}; }

export function compileProjectOwnerBootstrap({agentosHomeRef, siblingProjectRefs = [], environmentSummaryRef, projectName, discoveryComplete, interviewComplete, spawnerStarted = false, workflow = null} = {}) {
  assert(typeof agentosHomeRef === "string" && /^opaque:agentos-home:/u.test(agentosHomeRef), "Bootstrap requires an opaque clean AgentOS home reference");
  assert(Array.isArray(siblingProjectRefs) && siblingProjectRefs.every((value) => /^opaque:sibling-project:/u.test(value)), "Bootstrap sibling discovery references are invalid");
  assert(typeof environmentSummaryRef === "string" && /^opaque:environment:/u.test(environmentSummaryRef), "Bootstrap environment discovery is incomplete");
  assert(typeof projectName === "string" && PROJECT_NAME.test(projectName), "Project display name is invalid");
  assert(discoveryComplete === true && interviewComplete === true, "Bootstrap discovery and user interview must finish before Spawner starts");
  if (workflow !== null) assert(DEVELOPMENT_WORKFLOWS.includes(workflow), "Development workflow is invalid");
  assert(spawnerStarted === false, "Bootstrap cannot issue another Spawner request after the one-time start is recorded");
  const spawnerSpawnRequest = {schema: "agentos.bootstrap_spawner_start_request.v1", version: 1, requested_role: "AGENTOS.SPAWNER", exactly_one: true, status: "PREPARED_NOT_EXECUTED"};
  const ownerName = `Project Owner ${projectName}`;
  const value = {
    schema: PROJECT_OWNER_BOOTSTRAP_SCHEMA, version: 1, authority_status: "NON_AUTHORITATIVE_PLAN", status: workflow === null ? "WAITING_FOR_WORKFLOW_CHOICE" : "READY_FOR_GOVERNED_BOOTSTRAP_EXECUTION",
    agentos_home_ref: agentosHomeRef, sibling_project_refs: [...siblingProjectRefs].sort(compareUtf8), environment_summary_ref: environmentSummaryRef,
    discovery_complete: true, interview_complete: true, bootstrap_role_before: "AGENTOS.BOOTSTRAP", bootstrap_role_after: "AGENTOS.PRODUCT_OWNER",
    bootstrap_sequence: ["DISCOVERY_AND_INTERVIEW_COMPLETE", "START_EXACTLY_ONE_SPAWNER", "REQUEST_PERMANENT_ROSTER_FROM_SPAWNER", "TRANSITION_BOOTSTRAP_TO_PRODUCT_OWNER"],
    owner_display_name: ownerName, human_facing_role: "AGENTOS.PRODUCT_OWNER", default_explanation_level: "SIMPLE",
    spawner_start_request_template_sha256: canonicalDigest(spawnerSpawnRequest), spawner_start_receipt_ref: null, bootstrap_may_spawn_again: false,
    spawner_roster_request: {existing_roles: ["AGENTOS.BOOTSTRAP", "AGENTOS.SPAWNER"], requested_roles: SPAWNER_CREATED_PERMANENT_ROLES.filter((role) => role !== "AGENTOS.PRODUCT_OWNER"), bootstrap_transitions_to_product_owner_after_request: true, exactly_one_spawner: true, creation_authority: "AGENTOS.SPAWNER", ordinary_agent_spawn_authority: "AGENTOS.SPAWNER", all_despawn_authority: "AGENTOS.SPAWNER"},
    development_workflow: workflow, project_owner_monitor_minutes: PROJECT_MONITOR_INTERVAL_MINUTES, controller_progress_monitor_minutes: PROJECT_MONITOR_INTERVAL_MINUTES,
    bootstrap_sha256: null,
  };
  value.bootstrap_sha256 = canonicalDigest(body(value)); return Object.freeze(value);
}

export function compileWorkflowChoiceQuestion() {
  return compileProjectOwnerResponse({message: "How would you like the team to build and check the project?", choices: [
    {key: "1", label: "Pyramid", meaning: "Build in layers, with each layer checked before the next one starts."},
    {key: "2", label: "Collaborative audit", meaning: "Use six focused checkers at a time, then one builder fixes their combined list."},
    {key: "3", label: "Explain more", meaning: "Show a simple comparison with pros and cons."},
    {key: "4", label: "Advanced details", meaning: "Show the full workflow and technical controls."},
    {key: "n", label: "Not sure", meaning: "Recommend one after looking at the project."},
  ]});
}

export function compileProjectOwnerMonitorTick({minutesSinceLastCheck, intentAligned, unresolvedUserQuestion = false} = {}) {
  assert(Number.isFinite(minutesSinceLastCheck) && minutesSinceLastCheck >= PROJECT_MONITOR_INTERVAL_MINUTES, "Project Owner intent check is not due yet");
  assert(typeof intentAligned === "boolean" && typeof unresolvedUserQuestion === "boolean", "Project Owner monitor evidence is incomplete");
  if (unresolvedUserQuestion) return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "ASK_USER_IN_SIMPLE_LANGUAGE", next_action: "PROJECT_OWNER_ASK_ONE_BOUNDED_QUESTION", timer_minutes: 15});
  if (!intentAligned) return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "INTENT_REVIEW_REQUIRED", next_action: "PROJECT_OWNER_RECONCILE_USER_INTENT", timer_minutes: 15});
  return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "INTENT_ALIGNED", next_action: "HANDOFF_INTENT_ALIGNMENT_TO_CONTROLLER", timer_minutes: 15});
}
