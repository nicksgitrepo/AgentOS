#!/usr/bin/env node

import assert from "node:assert/strict";
import {authorizeRuntimeRequest, validateRuntimeRequest} from "../control/runtime-authority.mjs";
import {createPersistentRole} from "../control/persistent-role.mjs";
import {digestWithout} from "../control/canonical-json.mjs";

const common = {project_id: "PROJECT-001", environment_id: "ENV-001", source_commit: "a".repeat(40), source_tree: "b".repeat(40), governance_digest: "c".repeat(64), created_at_utc: "2026-01-01T00:00:00.000Z"};
const intent = createPersistentRole({...common, role_id: "INTENT_REGULATOR", host_session_id: "INTENT-SESSION-001"});
const runtime = createPersistentRole({...common, role_id: "RUNTIME", host_session_id: "RUNTIME-SESSION-001"});
assert.equal(intent.lifetime, "PERSISTENT");
assert.equal(runtime.model, "gpt-5.6-luna");
const approval = {decision_id: "DECISION-001", decision: "APPROVE", actor_digest: "a".repeat(64), accepted_result_digest: "b".repeat(64), final_audit_digest: "c".repeat(64), decided_at_utc: "2026-01-01T00:09:00.000Z", digest: null};
approval.digest = digestWithout(approval, "digest");
const request = authorizeRuntimeRequest(runtime, {request_id: "REQUEST-001", action: "DEPLOY", project_id: "PROJECT-001", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "The owner selected deployment as the finish.", requested_at_utc: "2026-01-01T00:10:00.000Z", owner_approval: approval});
assert.equal(validateRuntimeRequest(request, {runtimeRole: runtime}).authority_role, "RUNTIME");
const requestInput = {request_id: "REQUEST-002", action: "DEPLOY", project_id: "PROJECT-001", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "bad", requested_at_utc: "2026-01-01T00:10:00.000Z", owner_approval: approval};
assert.throws(() => authorizeRuntimeRequest(intent, requestInput), /only Runtime/u);
assert.throws(() => authorizeRuntimeRequest(runtime, {...requestInput, request_id: "REQUEST-003", action: "UNKNOWN_ACTION"}), /protected or recognized/u);
assert.throws(() => authorizeRuntimeRequest(runtime, {...requestInput, request_id: "REQUEST-004", project_id: "OTHER-PROJECT"}), /project differs/u);
assert.throws(() => authorizeRuntimeRequest(runtime, {...requestInput, request_id: "REQUEST-005", owner_approval: {...approval, decision: "REJECT"}}), /decision is not APPROVE/u);
assert.throws(() => validateRuntimeRequest({...request, authority_digest: "0".repeat(64), digest: "0".repeat(64)}, {runtimeRole: runtime}), /authority differs|digest does not match/u);
console.log(JSON.stringify({status: "PASS", persistent_roles: [intent.role_id, runtime.role_id], action: request.action}));
