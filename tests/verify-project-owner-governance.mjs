#!/usr/bin/env node

import assert from "node:assert/strict";
import {authorizeAgentDespawn, authorizeAgentSpawn, requiredAuditorCloseout} from "../control/agent-lifecycle-custody.mjs";
import {compileProjectOwnerResponse, compileStandardOwnerQuestion, explanationLevelForChoice} from "../control/project-owner-conversation.mjs";
import {compileProjectOwnerBootstrap, compileProjectOwnerMonitorTick, compileWorkflowChoiceQuestion} from "../control/project-owner-bootstrap.mjs";
import {compileControllerProgressTick} from "../control/controller-workflow-regulator.mjs";

const owner = compileProjectOwnerResponse({message: "The team is moving and nothing needs your attention."});
assert.equal(owner.authority_status, "NON_AUTHORITATIVE_TEMPLATE"); assert.equal(owner.speaker_role, "AGENTOS.PRODUCT_OWNER"); assert.equal(owner.explanation_level, "SIMPLE"); assert.equal(owner.technical_details_hidden, true);
assert.throws(() => compileProjectOwnerResponse({message: "Use commit 59736bdef6bf5142c05ca13e10be98fc4971d669."}), /codes|hashes|debugging/iu);
assert.throws(() => compileProjectOwnerResponse({message: "The result is CONTROLLER_EVENT_FORBIDDEN."}), /codes|hashes|debugging/iu);
assert.throws(() => compileProjectOwnerResponse({message: "The role is AGENTOS_PRODUCT_OWNER."}), /codes|hashes|debugging/iu);
assert.throws(() => compileProjectOwnerResponse({message: "Read `/var/example/private/file`."}), /codes|paths|debugging/iu);
assert.equal(compileStandardOwnerQuestion({message: "Should the team continue?"}).choices.length, 5);
const privateHomePath = ["", "Use", "rs", "example", "private"].join("/");
assert.throws(() => compileProjectOwnerResponse({message: "Choose.", choices: [{key: "1", label: "Safe", meaning: `Use ${"a".repeat(64)} at ${privateHomePath}.`}]}), /meaning exposes codes|hashes|paths/u);
assert.throws(() => compileProjectOwnerResponse({message: "Choose.", choices: [{key: "1", label: "First", meaning: "First choice."}, {key: "1", label: "Again", meaning: "Duplicate choice."}]}), /unique ordered/u);
assert.equal(explanationLevelForChoice("3"), "ELABORATE"); assert.equal(explanationLevelForChoice("d"), "ADVANCED"); assert.equal(explanationLevelForChoice("1"), "SIMPLE");
assert.equal(compileWorkflowChoiceQuestion().choices[1].label, "Collaborative audit");

const bootstrap = compileProjectOwnerBootstrap({agentosHomeRef: "opaque:agentos-home:clean", siblingProjectRefs: ["opaque:sibling-project:one"], environmentSummaryRef: "opaque:environment:local", projectName: "Example", discoveryComplete: true, interviewComplete: true, workflow: "COLLABORATIVE_AUDIT"});
assert.equal(bootstrap.authority_status, "NON_AUTHORITATIVE_PLAN"); assert.equal(bootstrap.status, "READY_FOR_GOVERNED_BOOTSTRAP_EXECUTION"); assert.equal(bootstrap.spawner_start_receipt_ref, null); assert.equal(bootstrap.bootstrap_role_after, "AGENTOS.PRODUCT_OWNER"); assert.deepEqual(bootstrap.bootstrap_sequence, ["DISCOVERY_AND_INTERVIEW_COMPLETE", "START_EXACTLY_ONE_SPAWNER", "REQUEST_PERMANENT_ROSTER_FROM_SPAWNER", "TRANSITION_BOOTSTRAP_TO_PRODUCT_OWNER"]); assert.equal(bootstrap.bootstrap_may_spawn_again, false); assert.equal(bootstrap.project_owner_monitor_minutes, 15); assert(bootstrap.spawner_roster_request.requested_roles.includes("AGENTOS_CONTROLLER")); assert.equal(bootstrap.spawner_roster_request.requested_roles.includes("AGENTOS.SPAWNER"), false); assert.deepEqual(bootstrap.spawner_roster_request.existing_roles, ["AGENTOS.BOOTSTRAP", "AGENTOS.SPAWNER"]); assert.equal(bootstrap.spawner_roster_request.bootstrap_transitions_to_product_owner_after_request, true); assert.equal(bootstrap.spawner_roster_request.exactly_one_spawner, true);
assert.throws(() => compileProjectOwnerBootstrap({agentosHomeRef: "opaque:agentos-home:clean", siblingProjectRefs: [], environmentSummaryRef: "opaque:environment:local", projectName: "Example", discoveryComplete: true, interviewComplete: true, spawnerStarted: true}), /cannot issue another Spawner request/iu);
assert.throws(() => authorizeAgentSpawn({issuerRole: "AGENTOS_CONTROLLER", requestedRole: "AGENTOS.BUILDER", worktreeRef: "opaque:worktree:x", partnerAuditorIds: ["AUDITOR.1", "AUDITOR.2", "AUDITOR.3", "AUDITOR.4", "AUDITOR.5", "AUDITOR.6"]}), /rejects caller roots|opaque capability/iu);
assert.throws(() => authorizeAgentSpawn({issuerRole: "AGENTOS.SPAWNER", requestedRole: "AGENTOS.BUILDER", partnerAuditorIds: ["AUDITOR.1", "AUDITOR.2", "AUDITOR.3", "AUDITOR.4", "AUDITOR.5", "AUDITOR.6"]}), /rejects caller roots|opaque capability/iu);
assert.throws(() => authorizeAgentDespawn({issuerRole: "AGENTOS_CONTROLLER", agentId: "AUDITOR.1", roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The report was accepted."}), /rejects caller roots|opaque capability/iu);
assert.throws(() => requiredAuditorCloseout({handoffAccepted: true}), /rejects caller|eligibility/u);
assert.equal(compileProjectOwnerMonitorTick({minutesSinceLastCheck: 15, intentAligned: true}).status, "INTENT_ALIGNED");
assert.equal(compileProjectOwnerMonitorTick({minutesSinceLastCheck: 15, intentAligned: true, unresolvedUserQuestion: true}).status, "ASK_USER_IN_SIMPLE_LANGUAGE");
assert.throws(() => compileProjectOwnerMonitorTick({minutesSinceLastCheck: 0, intentAligned: true}), /not due yet/u);
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: true, claimedBlocker: false, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: true}).status, "TRUE_BLOCKER");
console.log("PASS Project Owner governance: simple human responses, bounded choices, one-time Bootstrap-to-Spawner start, Spawner-only lifecycle, safe despawn, and 15-minute intent/progress checks");
