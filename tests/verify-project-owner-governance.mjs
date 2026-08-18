#!/usr/bin/env node

import assert from "node:assert/strict";
import {authorizeAgentDespawn, authorizeAgentSpawn, requiredAuditorCloseout} from "../control/agent-lifecycle-custody.mjs";
import {compileProjectOwnerResponse, compileStandardOwnerQuestion, explanationLevelForChoice} from "../control/project-owner-conversation.mjs";
import {compileControllerProgressTick, compileProjectOwnerBootstrap, compileProjectOwnerMonitorTick, compileWorkflowChoiceQuestion} from "../control/project-owner-bootstrap.mjs";

const owner = compileProjectOwnerResponse({message: "The team is moving and nothing needs your attention."});
assert.equal(owner.speaker_role, "AGENTOS.PROJECT_OWNER"); assert.equal(owner.explanation_level, "SIMPLE"); assert.equal(owner.technical_details_hidden, true);
assert.throws(() => compileProjectOwnerResponse({message: "Use commit 59736bdef6bf5142c05ca13e10be98fc4971d669."}), /codes|hashes|debugging/iu);
assert.throws(() => compileProjectOwnerResponse({message: "Read `/var/example/private/file`."}), /codes|paths|debugging/iu);
assert.equal(compileStandardOwnerQuestion({message: "Should the team continue?"}).choices.length, 5);
assert.equal(explanationLevelForChoice("3"), "ELABORATE"); assert.equal(explanationLevelForChoice("d"), "ADVANCED"); assert.equal(explanationLevelForChoice("1"), "SIMPLE");
assert.equal(compileWorkflowChoiceQuestion().choices[1].label, "Collaborative audit");

const bootstrap = compileProjectOwnerBootstrap({agentosHomeRef: "opaque:agentos-home:clean", siblingProjectRefs: ["opaque:sibling-project:one"], environmentSummaryRef: "opaque:environment:local", projectName: "Example", discoveryComplete: true, interviewComplete: true, workflow: "COLLABORATIVE_AUDIT"});
assert.equal(bootstrap.bootstrap_role_after, "AGENTOS.PROJECT_OWNER"); assert.equal(bootstrap.bootstrap_may_spawn_again, false); assert.equal(bootstrap.project_owner_monitor_minutes, 15); assert(bootstrap.spawner_roster_request.requested_roles.includes("AGENTOS.CONTROLLER")); assert.equal(bootstrap.spawner_roster_request.requested_roles.includes("AGENTOS.SPAWNER"), false); assert.deepEqual(bootstrap.spawner_roster_request.existing_roles, ["AGENTOS.SPAWNER"]); assert.equal(bootstrap.spawner_roster_request.exactly_one_spawner, true);
assert.throws(() => compileProjectOwnerBootstrap({agentosHomeRef: "opaque:agentos-home:clean", siblingProjectRefs: [], environmentSummaryRef: "opaque:environment:local", projectName: "Example", discoveryComplete: true, interviewComplete: true, spawnerStarted: true}), /Only Bootstrap may start the first Spawner/iu);
assert.throws(() => authorizeAgentSpawn({issuerRole: "AGENTOS.CONTROLLER", requestedRole: "AGENTOS.BUILDER", worktreeRef: "opaque:worktree:x", partnerAuditorIds: ["AUDITOR.1", "AUDITOR.2", "AUDITOR.3", "AUDITOR.4", "AUDITOR.5", "AUDITOR.6"]}), /only.*Spawner/iu);
assert.throws(() => authorizeAgentSpawn({issuerRole: "AGENTOS.SPAWNER", requestedRole: "AGENTOS.BUILDER", partnerAuditorIds: ["AUDITOR.1", "AUDITOR.2", "AUDITOR.3", "AUDITOR.4", "AUDITOR.5", "AUDITOR.6"]}), /worktree/iu);
assert.throws(() => authorizeAgentDespawn({issuerRole: "AGENTOS.CONTROLLER", agentId: "AUDITOR.1", roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The report was accepted."}), /Only Spawner/iu);
assert.throws(() => authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: "AUDITOR.1", roleKind: "AUDITOR", handoffAccepted: false, scopeClosed: true, evidencePreserved: true, worktreeReferenced: false, activeCustodyRefs: [], reason: "The report was accepted."}), /handoff/iu);
assert.throws(() => authorizeAgentDespawn({issuerRole: "AGENTOS.SPAWNER", agentId: "AUDITOR.1", roleKind: "AUDITOR", handoffAccepted: true, scopeClosed: true, evidencePreserved: true, worktreeReferenced: true, activeCustodyRefs: [], reason: "The report was accepted."}), /still referenced/iu);
assert.equal(requiredAuditorCloseout({handoffAccepted: true}), "SPAWNER_DESPAWN_REQUIRED_NOW");
assert.equal(compileProjectOwnerMonitorTick({minutesSinceLastCheck: 15, intentAligned: true, usefulProgressObserved: false}).status, "CONTROLLER_WORKFLOW_REPAIR_REQUIRED");
assert.equal(compileProjectOwnerMonitorTick({minutesSinceLastCheck: 15, intentAligned: true, usefulProgressObserved: true, unresolvedUserQuestion: true}).status, "ASK_USER_IN_SIMPLE_LANGUAGE");
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: true, claimedBlocker: false, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerProgressTick({minutesSinceUsefulProgress: 16, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: true}).status, "TRUE_BLOCKER");
console.log("PASS Project Owner governance: simple human responses, bounded choices, one-time Bootstrap-to-Spawner start, Spawner-only lifecycle, safe despawn, and 15-minute intent/progress checks");
