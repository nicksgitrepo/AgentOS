#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {BOOTSTRAP_QUESTIONS, planBootstrapQuestions} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";

const FORBIDDEN_OWNER_TERMS = [
  /technical setup/iu,
  /\bproves?\b/iu,
  /\bproving\b/iu,
  /\bstack\b/iu,
  /\bauthentication\b/iu,
  /\bobservability\b/iu,
  /\brepositor(?:y|ies)\b/iu,
  /\benvironments?\b/iu,
  /\bexternal systems?\b/iu,
  /\bauthority corpus\b/iu,
  /\bdesign bible\b/iu,
  /\boperating conditions?\b/iu,
  /\bpersistent runtime\b/iu,
  /\bCI runners?\b/iu,
  /\bprovider binding\b/iu,
];

const FORBIDDEN_REVIEW_OUTPUT = [
  "For the build itself, the current recommendation is",
  "The role recommendations are:",
  "This task is currently described as",
  "technical governance terms",
  "exact result for separate approval",
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owner-conversation-surface-"));
try {
  const ownerReviewSource = fs.readFileSync(new URL("../control/owner-review.mjs", import.meta.url), "utf8");
  for (const phrase of FORBIDDEN_REVIEW_OUTPUT) assert(!ownerReviewSource.includes(phrase), "Ongoing owner review exposes " + phrase);
  for (const question of BOOTSTRAP_QUESTIONS) {
    for (const pattern of FORBIDDEN_OWNER_TERMS) assert(!pattern.test(question.prompt), "Bootstrap owner prompt exposes " + pattern + ": " + question.id);
  }
  const discovery = discoverProject(root, "RECOMMENDED").facts;
  const plan = planBootstrapQuestions({discovery, answers: {"bootstrap.discovery.mode": "RECOMMENDED"}});
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.owner_questions.length, 1);
  assert.equal(plan.owner_questions[0].prompt, plan.questions[0].prompt);
  for (const pattern of FORBIDDEN_OWNER_TERMS) {
    assert(!pattern.test(plan.questions[0].prompt), "Bootstrap question exposes " + pattern);
    assert(!pattern.test(plan.owner_questions[0].prompt), "Bootstrap owner question exposes " + pattern);
  }
  console.log("PASS Bootstrap owner conversation surface stays casual and nontechnical");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
