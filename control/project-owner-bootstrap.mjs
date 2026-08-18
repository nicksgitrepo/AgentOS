#!/usr/bin/env node

/* Bootstrap discovery, one-time Spawner start, permanent roster request, and Project Owner transition. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {authorizeAgentSpawn} from "./agent-lifecycle-custody.mjs";
import {compileProjectOwnerResponse} from "./project-owner-conversation.mjs";

export const PROJECT_OWNER_BOOTSTRAP_SCHEMA = "agentos.project_owner_bootstrap.v1";
export const PROJECT_MONITOR_INTERVAL_MINUTES = 15;
export const PERMANENT_PROJECT_ROLES = Object.freeze(["AGENTOS.CONTROLLER", "AGENTOS.MEMORY", "AGENTOS.ORCHESTRATOR", "AGENTOS.RUNTIME", "AGENTOS.SCHEDULER", "AGENTOS.SPAWNER"]);
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
  const spawnerSpawn = authorizeAgentSpawn({issuerRole: "AGENTOS.BOOTSTRAP", requestedRole: "AGENTOS.SPAWNER", bootstrapSpawnerStarted: spawnerStarted});
  const ownerName = `Project Owner ${projectName}`;
  const value = {
    schema: PROJECT_OWNER_BOOTSTRAP_SCHEMA, version: 1, status: workflow === null ? "WAITING_FOR_WORKFLOW_CHOICE" : "READY_FOR_SPAWNER_ROSTER_REQUEST",
    agentos_home_ref: agentosHomeRef, sibling_project_refs: [...siblingProjectRefs].sort(compareUtf8), environment_summary_ref: environmentSummaryRef,
    discovery_complete: true, interview_complete: true, bootstrap_role_before: "AGENTOS.BOOTSTRAP", bootstrap_role_after: "AGENTOS.PROJECT_OWNER",
    owner_display_name: ownerName, human_facing_role: "AGENTOS.PROJECT_OWNER", default_explanation_level: "SIMPLE",
    spawner_spawn_receipt_sha256: spawnerSpawn.receipt_sha256, bootstrap_may_spawn_again: false,
    spawner_roster_request: {existing_roles: ["AGENTOS.SPAWNER"], requested_roles: [...SPAWNER_CREATED_PERMANENT_ROLES], exactly_one_spawner: true, creation_authority: "AGENTOS.SPAWNER", ordinary_agent_spawn_authority: "AGENTOS.SPAWNER", all_despawn_authority: "AGENTOS.SPAWNER"},
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

export function compileProjectOwnerMonitorTick({minutesSinceLastCheck, intentAligned, unresolvedUserQuestion = false, usefulProgressObserved} = {}) {
  assert(Number.isFinite(minutesSinceLastCheck) && minutesSinceLastCheck >= 0, "Project Owner monitor time is invalid");
  assert(typeof intentAligned === "boolean" && typeof unresolvedUserQuestion === "boolean" && typeof usefulProgressObserved === "boolean", "Project Owner monitor evidence is incomplete");
  if (unresolvedUserQuestion) return Object.freeze({status: "ASK_USER_IN_SIMPLE_LANGUAGE", next_action: "PROJECT_OWNER_ASK_ONE_BOUNDED_QUESTION", timer_minutes: 15});
  if (!intentAligned) return Object.freeze({status: "INTENT_REVIEW_REQUIRED", next_action: "PROJECT_OWNER_RECONCILE_USER_INTENT", timer_minutes: 15});
  return Object.freeze({status: usefulProgressObserved ? "ON_TRACK" : "CONTROLLER_WORKFLOW_REPAIR_REQUIRED", next_action: usefulProgressObserved ? "CONTINUE_AND_RECHECK" : "CONTROLLER_RESTORE_USEFUL_WORK", timer_minutes: 15});
}

export function compileControllerProgressTick({minutesSinceUsefulProgress, activeWorkInProgress, claimedBlocker, protectedBlockerProven} = {}) {
  assert(Number.isFinite(minutesSinceUsefulProgress) && minutesSinceUsefulProgress >= 0, "Controller progress age is invalid");
  assert(typeof activeWorkInProgress === "boolean" && typeof claimedBlocker === "boolean" && typeof protectedBlockerProven === "boolean", "Controller progress evidence is incomplete");
  if (claimedBlocker && protectedBlockerProven) return Object.freeze({status: "TRUE_BLOCKER", next_action: "PROJECT_OWNER_EXPLAIN_BLOCKER_TO_USER", timer_minutes: 15});
  if (minutesSinceUsefulProgress >= 15) return Object.freeze({status: "FALSE_STALL_REJECTED", next_action: "CONTROLLER_REPAIR_WORKFLOW_AND_START_USEFUL_SUCCESSOR", timer_minutes: 15});
  return Object.freeze({status: "MOVING", next_action: "CONTINUE_USEFUL_WORK", timer_minutes: 15});
}
