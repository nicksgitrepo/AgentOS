#!/usr/bin/env node

import assert from "node:assert/strict";
import {resolveAddressedRecordConflict} from "../control/local-self-development-supervisor-adapter.mjs";

const existing = {schema: "agentos.controller_completion_record.v1", record_sha256: "a".repeat(64), parent_handoff_sha256: "1".repeat(64), source_commit: "2".repeat(40), source_tree: "3".repeat(40)};
const replacement = {...existing, record_sha256: "b".repeat(64), parent_handoff_sha256: "4".repeat(64), source_commit: "5".repeat(40), source_tree: "6".repeat(40)};
const conflict = resolveAddressedRecordConflict({recordName: "autonomous-supervisor-lifecycle-resolutions/FINDING.json", digestField: "record_sha256", existingRecord: existing, replacementRecord: replacement});
assert.equal(conflict.action, "PRESERVE_AND_REPLACE");
assert.equal(conflict.original_digest, existing.record_sha256);
assert.equal(conflict.replacement_digest, replacement.record_sha256);
assert.match(conflict.reason, /stale parent/u);
assert.equal(resolveAddressedRecordConflict({recordName: "same.json", digestField: "record_sha256", existingRecord: existing, replacementRecord: existing}).action, "KEEP_EXISTING");
assert.throws(() => resolveAddressedRecordConflict({recordName: "bad.json", digestField: "record_sha256", existingRecord: {...existing, record_sha256: "bad"}, replacementRecord: replacement}), /SHA-256/u);
console.log("PASS owner feedback completion records preserve stale evidence and classify current-parent replacement");
