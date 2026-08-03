#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {
  compileGptAssistNextCampaignHandoff,
  compileGptAssistRosterReceipt,
  compileGptAssistResponseImport,
  compileGptAssistStatus,
  renderGptAssistOwnerResponseMarkdown,
  renderGptAssistMarkdown,
  renderGptAssistResponseMarkdown,
  validateGptAssistResponse,
  validateGptAssistStatusInput,
} from "../control/gpt-assist.mjs";

const failures = [];
let hostiles = 0;
const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-gpt-assist-"));
function git(...args) {
  const result = spawnSync("git", ["-C", gitRoot, ...args], {encoding: "utf8"});
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
git("init", "-q");
git("config", "user.name", "Governance Test");
git("config", "user.email", "governance@example.invalid");
fs.writeFileSync(path.join(gitRoot, "README.md"), "portable test repository\n");
git("add", "README.md");
git("commit", "-qm", "fixture");
const sourceCommit = git("rev-parse", "HEAD");
const sourceTree = git("show", "-s", "--format=%T", "HEAD");

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}
function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}
function reject(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostiles += 1;
  }
}

const question = {
  question_id: "q-owner-1",
  category: "INTENT",
  prompt: "Should the workflow prefer speed or exhaustive detail?",
  why_it_matters: "This changes the first campaign route.",
  blocking: true,
  default_if_deferred: "Use the reversible minimal route.",
  status: "OPEN",
  answer_sha256: null,
};
const input = {
  mode: "GPT_ASSIST",
  project_id: "example-project",
  campaign_id: "campaign-001",
  release_id: "release-001",
  governance_version: "2.1rc",
  authority_snapshot_sha256: "1".repeat(64),
  source: {commit: sourceCommit, tree: sourceTree},
  generated_at: "2026-01-01T00:00:00.000Z",
  auditor: {
    session_id: "auditor-session-001",
    report_sha256: "4".repeat(64),
    read_only: true,
  },
  campaign: {
    status: "DESIGNING",
    active_goal_id: "goal-audit",
    active_owner: "auditor",
    checkpoint_sha256: null,
    progress_sha256: "5".repeat(64),
    next_action: "Compile the dependency-ordered campaign.",
  },
  work: {
    completed: [{
      item_id: "done-1",
      summary: "Project discovery completed.",
      owner: "auditor",
      evidence_sha256: "6".repeat(64),
      next_action: "Preserve as current evidence.",
    }],
    in_progress: [{
      item_id: "active-1",
      summary: "Campaign dependency design is active.",
      owner: "auditor",
      evidence_sha256: "7".repeat(64),
      next_action: "Finish dependency ordering.",
    }],
    not_done: [{
      item_id: "todo-1",
      summary: "No implementation checkpoint exists.",
      owner: "future feature owner",
      evidence_sha256: null,
      next_action: "Wait for campaign activation.",
    }],
    needs_planning: [{
      item_id: "plan-1",
      summary: "Authentication proof route needs planning.",
      owner: "auditor",
      evidence_sha256: "8".repeat(64),
      next_action: "Ask the owner which route to use.",
    }],
  },
  findings: [{
    finding_id: "finding-1",
    summary: "Authentication route is not selected.",
    status: "OWNER_DECISION_REQUIRED",
    evidence_sha256: "9".repeat(64),
    fix_checkpoint_sha256: null,
    question_ids: ["q-owner-1"],
  }],
  context_gaps: [{
    gap_id: "gap-1",
    summary: "Preferred workflow detail is unknown.",
    impact: "Campaign ordering may change.",
    status: "OPEN",
    question_id: "q-owner-1",
    resolution_sha256: null,
  }],
  decisions: [{
    decision_id: "decision-1",
    prompt: "Choose the workflow detail preference.",
    why_it_matters: "It controls campaign scope.",
    options: ["MINIMAL", "DETAILED"],
    recommended_option: "MINIMAL",
    status: "USER_DECISION_REQUIRED",
    question_id: "q-owner-1",
    decision_sha256: null,
  }],
  questions: [question],
  secret_free: true,
};

try {
  validateGptAssistStatusInput(input);
  const packet = compileGptAssistStatus(input, gitRoot);
  const repeated = compileGptAssistStatus(structuredClone(input), gitRoot);
  if (packet.package_sha256 !== repeated.package_sha256) {
    failures.push("GPT_ASSIST package is nondeterministic");
  }
  const markdown = renderGptAssistMarkdown(packet);
  for (const required of [
    "## Done", "## In progress", "## Not done", "## Needs planning",
    "## Audit findings", "## Missing context", "## User decisions",
    "Ask exactly one", "voice", "research", "Do not claim that code is fixed",
    "ask no more questions",
  ]) {
    if (!markdown.includes(required)) failures.push(`Markdown lacks ${required}`);
  }
  const responseContent = {
    completed_at: "2026-01-01T01:00:00.000Z",
    answers: [{
      question_id: "q-owner-1",
      status: "OWNER_ANSWERED",
      answer: "Prefer the minimal reversible route.",
      answered_by: "OWNER",
      citations: [],
    }],
    user_questions: [{
      question: "What is still unknown?",
      answer: "The implementation proof remains future work.",
      asked_by: "OWNER",
    }],
    new_context: [{
      summary: "The owner prefers a minimal reversible first pass.",
      source: "Owner answer in this GPT_ASSIST exchange.",
      confidence: "HIGH",
      owner_confirmation_required: true,
    }],
  };
  const responseSourceMarkdown =
    renderGptAssistOwnerResponseMarkdown(packet, responseContent);
  const response = compileGptAssistResponseImport(responseSourceMarkdown, packet);
  validateGptAssistResponse(response, packet);
  const responseMarkdown = renderGptAssistResponseMarkdown(response, packet);
  if (!responseMarkdown.includes(packet.package_sha256)
      || !responseMarkdown.includes("Ask no more")) {
    failures.push("GPT_ASSIST response Markdown is incomplete");
  }
  const currentRosterReceipt = compileGptAssistRosterReceipt({
    campaign_id: "campaign-001",
    release_id: "release-001",
    governance_version: "2.1rc",
    campaign_state_sha256: input.authority_snapshot_sha256,
    agents: [{
      session_id: "auditor-session-001",
      role: "INDEPENDENT_AUDITOR",
      release_id: "release-001",
      governance_version: "2.1rc",
      fresh: true,
      pinned: true,
    }],
    evidence_sha256: "c".repeat(64),
  });
  const successorRosterReceipt = compileGptAssistRosterReceipt({
    campaign_id: "campaign-002",
    release_id: "release-002",
    governance_version: "2.1rc",
    campaign_state_sha256: "a".repeat(64),
    agents: [{
      session_id: "orchestrator-session-002",
      role: "GLOBAL_ORCHESTRATOR",
      release_id: "release-002",
      governance_version: "2.1rc",
      fresh: true,
      pinned: true,
    }],
    evidence_sha256: "d".repeat(64),
  });
  const handoffInput = {
    auditor_session_id: "auditor-session-001",
    next_campaign_sha256: "a".repeat(64),
    authority_update_candidate_sha256: "b".repeat(64),
    next_release_id: "release-002",
    current_roster_receipt: currentRosterReceipt,
    successor_roster_receipt: successorRosterReceipt,
    handed_off_at: "2026-01-01T01:01:00.000Z",
  };
  const handoff = compileGptAssistNextCampaignHandoff(response, packet, handoffInput);
  if (handoff.disposition !== "NEXT_RELEASE_ORCHESTRATOR_AUTHORITY_UPDATE_AND_CAMPAIGN_START"
      || handoff.fixed_finding_ids.length !== 0
      || handoff.standard_authority_promotion !== false
      || handoff.auditor_writes_authority !== false
      || handoff.next_orchestrator_writes_campaign_authority !== true) {
    failures.push("GPT_ASSIST next-campaign handoff crosses its authority boundary");
  }
  const candidateOnlyHandoff = compileGptAssistNextCampaignHandoff(
    response,
    packet,
    {...handoffInput, successor_roster_receipt: null},
  );
  if (candidateOnlyHandoff.disposition !== "NEXT_CAMPAIGN_CANDIDATE_RECORDED"
      || candidateOnlyHandoff.candidate_only !== true
      || candidateOnlyHandoff.successor_roster_created !== false
      || candidateOnlyHandoff.next_orchestrator_writes_campaign_authority !== false) {
    failures.push("GPT_ASSIST candidate-only handoff created successor authority");
  }

  reject("GPT_ASSIST is disabled", () =>
    compileGptAssistStatus({...input, mode: "DIRECT_ONLY"}, gitRoot));
  reject("completed status lacks evidence", () => {
    const changed = structuredClone(input);
    changed.work.completed[0].evidence_sha256 = null;
    validateGptAssistStatusInput(changed);
  });
  reject("owner-decision finding lacks a question", () => {
    const changed = structuredClone(input);
    changed.findings[0].question_ids = [];
    validateGptAssistStatusInput(changed);
  });
  reject("status brief includes an already answered question", () => {
    const changed = structuredClone(input);
    changed.questions[0].status = "ANSWERED";
    changed.questions[0].answer_sha256 = "f".repeat(64);
    validateGptAssistStatusInput(changed);
  });
  reject("status brief adds an ungrounded question", () => {
    const changed = structuredClone(input);
    changed.questions.push({
      ...structuredClone(question),
      question_id: "q-extra",
      prompt: "Tell me anything else.",
    });
    validateGptAssistStatusInput(changed);
  });
  reject("fixed finding lacks checkpoint", () => {
    const changed = structuredClone(input);
    changed.findings[0].status = "FIXED_WITH_CHECKPOINT";
    changed.findings[0].question_ids = [];
    validateGptAssistStatusInput(changed);
  });
  reject("unfixed finding claims checkpoint", () => {
    const changed = structuredClone(input);
    changed.findings[0].fix_checkpoint_sha256 = "a".repeat(64);
    validateGptAssistStatusInput(changed);
  });
  reject("open context gap lacks question", () => {
    const changed = structuredClone(input);
    changed.context_gaps[0].question_id = "missing";
    validateGptAssistStatusInput(changed);
  });
  reject("decision recommendation is invented", () => {
    const changed = structuredClone(input);
    changed.decisions[0].recommended_option = "OTHER";
    validateGptAssistStatusInput(changed);
  });
  reject("source identity is not exact", () =>
    validateGptAssistStatusInput({...input, source: {commit: "x", tree: "y"}}));
  reject("source tree is invented", () =>
    compileGptAssistStatus({
      ...input, source: {commit: sourceCommit, tree: "3".repeat(40)},
    }, gitRoot));
  reject("Auditor is not read-only", () =>
    validateGptAssistStatusInput({
      ...input, auditor: {...input.auditor, read_only: false},
    }));
  reject("secret material retained", () => {
    const changed = structuredClone(input);
    changed.work.not_done[0].summary = "api_key=synthetic-secret";
    validateGptAssistStatusInput(changed);
  });
  reject("Markdown packet is tampered", () =>
    renderGptAssistMarkdown({...packet, release_id: "changed"}));
  reject("response binds wrong packet", () =>
    validateGptAssistResponse({...response, package_sha256: "0".repeat(64)}, packet));
  reject("response Markdown names the wrong package", () =>
    compileGptAssistResponseImport(
      responseSourceMarkdown.replace(packet.package_sha256, "0".repeat(64)),
      packet,
    ));
  reject("response prose contradicts its parsed answer", () =>
    compileGptAssistResponseImport(
      responseSourceMarkdown.replace(
        "The JSON block is the complete owner response.",
        "The owner rejects the minimal reversible route.",
      ),
      packet,
    ));
  reject("response predates its status packet", () =>
    compileGptAssistResponseImport(
      renderGptAssistOwnerResponseMarkdown(packet, {
        ...responseContent, completed_at: "2025-12-31T23:59:00.000Z",
      }),
      packet,
    ));
  reject("response answers unknown question", () => {
    const changed = structuredClone(response);
    changed.answers[0].question_id = "unknown";
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateGptAssistResponse(changed, packet);
  });
  reject("response duplicates an answer", () => {
    const changed = structuredClone(response);
    changed.answers.push(structuredClone(changed.answers[0]));
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateGptAssistResponse(changed, packet);
  });
  reject("response stops before every listed question is resolved", () => {
    const packetWithTwo = compileGptAssistStatus({
      ...input,
      questions: [
        question,
        {...question, question_id: "q-owner-2", prompt: "Choose a second material boundary."},
      ],
    }, gitRoot);
    const incomplete = structuredClone(response);
    incomplete.package_sha256 = packetWithTwo.package_sha256;
    const body = structuredClone(incomplete);
    delete body.response_sha256;
    incomplete.response_sha256 = digest(body);
    validateGptAssistResponse(incomplete, packetWithTwo);
  });
  reject("ChatGPT claims owner authority", () => {
    const changed = structuredClone(response);
    changed.answers[0].answered_by = "CHATGPT";
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateGptAssistResponse(changed, packet);
  });
  reject("ChatGPT response attempts to mark finding fixed", () => {
    const changed = structuredClone(response);
    changed.fixed_finding_ids = ["finding-1"];
    validateGptAssistResponse(changed, packet);
  });
  reject("new context self-admits without confirmation", () => {
    const changed = structuredClone(response);
    changed.new_context[0].owner_confirmation_required = false;
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateGptAssistResponse(changed, packet);
  });
  reject("ChatGPT invents a side question", () => {
    const changed = structuredClone(response);
    changed.user_questions[0].asked_by = "CHATGPT";
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateGptAssistResponse(changed, packet);
  });
  reject("Auditor hands off as next Orchestrator", () => {
    const reused = structuredClone(handoffInput);
    reused.successor_roster_receipt = compileGptAssistRosterReceipt({
      campaign_id: "campaign-002",
      release_id: "release-002",
      governance_version: "2.1rc",
      campaign_state_sha256: "a".repeat(64),
      agents: [{
        session_id: "auditor-session-001",
        role: "GLOBAL_ORCHESTRATOR",
        release_id: "release-002",
        governance_version: "2.1rc",
        fresh: true,
        pinned: true,
      }],
      evidence_sha256: "d".repeat(64),
    });
    compileGptAssistNextCampaignHandoff(response, packet, reused);
  });
  reject("next Orchestrator roster is stale or unpinned", () => {
    const stale = structuredClone(handoffInput);
    stale.successor_roster_receipt.agents[0].fresh = false;
    compileGptAssistNextCampaignHandoff(response, packet, stale);
  });
  reject("current roster receipt belongs to another campaign", () => {
    const wrongCampaign = structuredClone(handoffInput);
    wrongCampaign.current_roster_receipt = compileGptAssistRosterReceipt({
      campaign_id: "campaign-other",
      release_id: "release-001",
      governance_version: "2.1rc",
      campaign_state_sha256: input.authority_snapshot_sha256,
      agents: currentRosterReceipt.agents,
      evidence_sha256: "c".repeat(64),
    });
    compileGptAssistNextCampaignHandoff(response, packet, wrongCampaign);
  });
  reject("successor roster receipt binds another campaign-state candidate", () => {
    const wrongState = structuredClone(handoffInput);
    wrongState.successor_roster_receipt = compileGptAssistRosterReceipt({
      campaign_id: "campaign-002",
      release_id: "release-002",
      governance_version: "2.1rc",
      campaign_state_sha256: "e".repeat(64),
      agents: successorRosterReceipt.agents,
      evidence_sha256: "d".repeat(64),
    });
    compileGptAssistNextCampaignHandoff(response, packet, wrongState);
  });
  reject("handoff predates response completion", () =>
    compileGptAssistNextCampaignHandoff(response, packet, {
      ...handoffInput, handed_off_at: "2026-01-01T00:59:00.000Z",
    }));
  reject("next campaign reuses the current release identity", () =>
    compileGptAssistNextCampaignHandoff(response, packet, {
      ...handoffInput, next_release_id: "release-001",
    }));
} catch (error) {
  failures.push(error.stack ?? error.message);
}
fs.rmSync(gitRoot, {recursive: true, force: true});

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Governance 2.1rc GPT_ASSIST PASS (${hostiles} hostile cases)\n`);
