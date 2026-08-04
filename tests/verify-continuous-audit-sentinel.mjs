#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  archiveContinuousAuditSentinel,
  compileContinuousAuditSentinel,
  validateContinuousAuditSentinel,
} from "../control/continuous-audit-sentinel.mjs";

const sentinel = compileContinuousAuditSentinel({
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  logicalLineageId: "LINE-1",
  auditorSessionId: "SESSION-AUDITOR",
  startedAtUtc: "2026-01-01T00:00:00.000Z",
});
assert.equal(sentinel.status, "ACTIVE");
assert.equal(sentinel.read_only, true);
assert.equal(sentinel.pinned, true);
validateContinuousAuditSentinel(sentinel, {campaignId: "CAMPAIGN-1", campaignVersion: "v1", logicalLineageId: "LINE-1", auditorSessionId: "SESSION-AUDITOR"});

const archived = archiveContinuousAuditSentinel(sentinel, {
  archivedAtUtc: "2026-01-01T01:00:00.000Z",
  reason: "ACCEPTED_LIVE_CLOSURE",
});
assert.equal(archived.status, "ARCHIVED_UNPINNED");
assert.equal(archived.pinned, false);
assert.throws(() => archiveContinuousAuditSentinel(archived, {archivedAtUtc: "2026-01-01T02:00:00.000Z"}), /already archived/u);
assert.throws(() => validateContinuousAuditSentinel({...sentinel, auditor_session_id: "SESSION-OTHER"}), /digest|Auditor|content-addressed/u);
assert.throws(() => validateContinuousAuditSentinel({...sentinel, status: "ARCHIVED_UNPINNED"}), /pin|archive|digest/u);

console.log("PASS AgentOS continuous audit sentinel: campaign lifetime pinning, Auditor binding, and closure archive boundary verified");
