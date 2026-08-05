#!/usr/bin/env node

import assert from "node:assert/strict";
import {authorizeRuntimeRequest, validateRuntimeRequest} from "../control/runtime-authority.mjs";
import {createPersistentRole} from "../control/persistent-role.mjs";

const common = {project_id: "PROJECT-001", environment_id: "ENV-001", source_commit: "a".repeat(40), source_tree: "b".repeat(40), governance_digest: "c".repeat(64), created_at_utc: "2026-01-01T00:00:00.000Z"};
const intent = createPersistentRole({...common, role_id: "INTENT_REGULATOR", host_session_id: "INTENT-SESSION-001"});
const runtime = createPersistentRole({...common, role_id: "RUNTIME", host_session_id: "RUNTIME-SESSION-001"});
assert.equal(intent.lifetime, "PERSISTENT");
assert.equal(runtime.model, "gpt-5.6-luna");
const request = authorizeRuntimeRequest(runtime, {request_id: "REQUEST-001", action: "DEPLOY", project_id: "PROJECT-001", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "The owner selected deployment as the finish.", requested_at_utc: "2026-01-01T00:10:00.000Z"});
assert.equal(validateRuntimeRequest(request, {runtimeRole: runtime}).authority_role, "RUNTIME");
assert.throws(() => authorizeRuntimeRequest(intent, {request_id: "REQUEST-002", action: "DEPLOY", project_id: "PROJECT-001", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "bad", requested_at_utc: "2026-01-01T00:10:00.000Z"}), /only Runtime/u);
assert.throws(() => authorizeRuntimeRequest(runtime, {request_id: "REQUEST-003", action: "UNKNOWN_ACTION", project_id: "PROJECT-001", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "bad", requested_at_utc: "2026-01-01T00:10:00.000Z"}), /protected or recognized/u);
assert.throws(() => authorizeRuntimeRequest(runtime, {request_id: "REQUEST-004", action: "DEPLOY", project_id: "OTHER-PROJECT", environment_id: "ENV-001", campaign_id: "CAMPAIGN-001", goal_id: "GOAL-001", scope_digest: "d".repeat(64), reason: "bad", requested_at_utc: "2026-01-01T00:10:00.000Z"}), /project differs/u);
assert.throws(() => validateRuntimeRequest({...request, authority_digest: "0".repeat(64), digest: "0".repeat(64)}, {runtimeRole: runtime}), /authority differs|digest does not match/u);
console.log(JSON.stringify({status: "PASS", persistent_roles: [intent.role_id, runtime.role_id], action: request.action}));
