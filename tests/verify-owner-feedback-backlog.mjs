#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {parseOwnerFeedbackBacklogMarkdown} from "../control/local-self-development-supervisor-adapter.mjs";

const sample = [
  "| Item | What went wrong | What should happen | Follow-up | Status |",
  "|---|---|---|---|---|",
  "| `FEEDBACK-010` | Later choice. | Offer the choice later. | `CAMPAIGN-LATER` | OPEN |",
  "| `FEEDBACK-002` | Earlier choice. | Offer the choice now. | `CAMPAIGN-NOW` | RESOLVED |",
].join("\n");
const parsed = parseOwnerFeedbackBacklogMarkdown(sample);
assert.deepEqual(parsed.map((item) => item.id), ["FEEDBACK-002", "FEEDBACK-010"]);
assert.equal(parsed[0].expected_behavior, "Offer the choice now.");
assert.equal(parsed[1].status, "OPEN");
assert.throws(() => parseOwnerFeedbackBacklogMarkdown(`${sample}\n| \`FEEDBACK-002\` | Duplicate. | Duplicate. | \`CAMPAIGN-DUPLICATE\` | OPEN |`), /duplicated/u);

const backlog = fs.readFileSync(new URL("../docs/owner-feedback-backlog.md", import.meta.url), "utf8");
const current = parseOwnerFeedbackBacklogMarkdown(backlog);
assert(current.length >= 1);
assert(current.every((item) => /^FEEDBACK-\d+$/u.test(item.id)));
assert(current.every((item) => ["OPEN", "IN_PROGRESS", "RESOLVED", "DEFERRED"].includes(item.status)));
console.log(`PASS owner feedback backlog parser (${current.length} recorded items)`);
