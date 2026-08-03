#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/;
const CAMPAIGN_STATUSES = new Set([
  "DESIGNING", "ACTIVE", "OWNER_BLOCKED", "READY_FOR_RUNTIME",
  "DEPLOYING", "LIVE_AUDIT", "ACCEPTED_LIVE_CLOSED",
]);
const FINDING_STATUSES = new Set([
  "OPEN", "FIXED_WITH_CHECKPOINT", "DEFERRED_NEXT_CAMPAIGN",
  "OWNER_DECISION_REQUIRED",
]);

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
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields mismatch`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireSha(value, label) {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  if (!value.endsWith("Z") || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be valid UTC`);
  }
}

function validateSecretFreeText(value, label) {
  requireString(value, label);
  if (/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(value)
      || /https?:\/\/[^/\s]+[/?#][^\s]*(?:token|secret|key|signature)=/iu.test(value)) {
    throw new Error(`${label} appears to contain retained secret material`);
  }
}

function runGit(repositoryRoot, args, label) {
  const root = fs.realpathSync(repositoryRoot);
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`${label} is not readable from admitted Git`);
  return result.stdout.trim();
}

export function verifyGptAssistSourceGit(source, repositoryRoot) {
  exactKeys(source, ["commit", "tree"], "status source");
  if (!GIT_OBJECT.test(source.commit) || !GIT_OBJECT.test(source.tree)) {
    throw new Error("status source Git identity is not exact");
  }
  const root = fs.realpathSync(repositoryRoot);
  if (!fs.statSync(root).isDirectory()
      || runGit(root, ["rev-parse", "--show-toplevel"], "Git root") !== root
      || runGit(root, ["cat-file", "-t", source.commit], "source commit") !== "commit"
      || runGit(root, ["show", "-s", "--format=%T", source.commit], "source tree")
        !== source.tree
      || runGit(root, ["cat-file", "-t", source.tree], "source tree object") !== "tree") {
    throw new Error("status source commit/tree reality is invalid");
  }
  return {repository_root: root, commit: source.commit, tree: source.tree};
}

function validateStatusItem(item, section) {
  exactKeys(item, [
    "item_id", "summary", "owner", "evidence_sha256", "next_action",
  ], `${section} item`);
  requireString(item.item_id, `${section} item ID`);
  validateSecretFreeText(item.summary, `${section} summary`);
  requireString(item.owner, `${section} owner`);
  if (item.evidence_sha256 !== null) requireSha(item.evidence_sha256, `${section} evidence`);
  if (section === "completed" && item.evidence_sha256 === null) {
    throw new Error("completed work lacks evidence");
  }
  validateSecretFreeText(item.next_action, `${section} next action`);
}

function validateQuestion(question) {
  exactKeys(question, [
    "question_id", "category", "prompt", "why_it_matters", "blocking",
    "default_if_deferred", "status", "answer_sha256",
  ], "GPT_ASSIST question");
  requireString(question.question_id, "question ID");
  requireString(question.category, "question category");
  validateSecretFreeText(question.prompt, "question prompt");
  validateSecretFreeText(question.why_it_matters, "question rationale");
  if (typeof question.blocking !== "boolean") throw new Error("question blocking flag invalid");
  validateSecretFreeText(question.default_if_deferred, "question safe default");
  if (question.status !== "OPEN" || question.answer_sha256 !== null) {
    throw new Error("status brief may contain only unresolved open questions");
  }
}

export function validateGptAssistStatusInput(input) {
  exactKeys(input, [
    "mode", "project_id", "campaign_id", "release_id", "governance_version",
    "authority_snapshot_sha256", "source", "generated_at", "auditor",
    "campaign", "work", "findings", "context_gaps", "decisions", "questions",
    "secret_free",
  ], "GPT_ASSIST status input");
  if (input.mode !== "GPT_ASSIST") throw new Error("GPT_ASSIST mode is not enabled");
  for (const field of ["project_id", "campaign_id", "release_id"]) {
    requireString(input[field], field);
  }
  if (input.governance_version !== "2.1rc") throw new Error("governance version mismatch");
  requireSha(input.authority_snapshot_sha256, "authority snapshot");
  requireUtc(input.generated_at, "status generation time");
  if (input.secret_free !== true) throw new Error("GPT_ASSIST input is not secret-free");

  exactKeys(input.source, ["commit", "tree"], "status source");
  if (!GIT_OBJECT.test(input.source.commit) || !GIT_OBJECT.test(input.source.tree)) {
    throw new Error("status source Git identity is not exact");
  }
  exactKeys(input.auditor, [
    "session_id", "report_sha256", "read_only",
  ], "status Auditor");
  requireString(input.auditor.session_id, "Auditor session");
  requireSha(input.auditor.report_sha256, "Auditor report");
  if (input.auditor.read_only !== true) throw new Error("status Auditor is not read-only");

  exactKeys(input.campaign, [
    "status", "active_goal_id", "active_owner", "checkpoint_sha256",
    "progress_sha256", "next_action",
  ], "campaign status");
  if (!CAMPAIGN_STATUSES.has(input.campaign.status)) {
    throw new Error("campaign status invalid");
  }
  if (input.campaign.active_goal_id !== null) {
    requireString(input.campaign.active_goal_id, "active goal ID");
  }
  requireString(input.campaign.active_owner, "active owner");
  if (input.campaign.checkpoint_sha256 !== null) {
    requireSha(input.campaign.checkpoint_sha256, "campaign checkpoint");
  }
  requireSha(input.campaign.progress_sha256, "campaign progress");
  validateSecretFreeText(input.campaign.next_action, "campaign next action");

  exactKeys(input.work, [
    "completed", "in_progress", "not_done", "needs_planning",
  ], "project work status");
  for (const section of Object.keys(input.work)) {
    if (!Array.isArray(input.work[section])) throw new Error(`${section} must be an array`);
    input.work[section].forEach((item) => validateStatusItem(item, section));
  }

  if (!Array.isArray(input.questions)) throw new Error("questions must be an array");
  input.questions.forEach(validateQuestion);
  const questionIds = input.questions.map((question) => question.question_id);
  if (new Set(questionIds).size !== questionIds.length) {
    throw new Error("question IDs are not unique");
  }
  const questions = new Set(questionIds);

  if (!Array.isArray(input.findings)) throw new Error("findings must be an array");
  const findingIds = new Set();
  for (const finding of input.findings) {
    exactKeys(finding, [
      "finding_id", "summary", "status", "evidence_sha256",
      "fix_checkpoint_sha256", "question_ids",
    ], "audit finding");
    requireString(finding.finding_id, "finding ID");
    if (findingIds.has(finding.finding_id)) throw new Error("duplicate finding ID");
    findingIds.add(finding.finding_id);
    validateSecretFreeText(finding.summary, "finding summary");
    if (!FINDING_STATUSES.has(finding.status)) throw new Error("finding status invalid");
    requireSha(finding.evidence_sha256, "finding evidence");
    if (finding.status === "FIXED_WITH_CHECKPOINT") {
      requireSha(finding.fix_checkpoint_sha256, "finding fix checkpoint");
    } else if (finding.fix_checkpoint_sha256 !== null) {
      throw new Error("unfixed finding carries a fix checkpoint");
    }
    if (!Array.isArray(finding.question_ids)
        || finding.question_ids.some((id) => !questions.has(id))) {
      throw new Error("finding question references are invalid");
    }
    if (finding.status === "OWNER_DECISION_REQUIRED"
        && finding.question_ids.length === 0) {
      throw new Error("owner-decision finding lacks a question");
    }
  }

  if (!Array.isArray(input.context_gaps)) throw new Error("context gaps must be an array");
  for (const gap of input.context_gaps) {
    exactKeys(gap, [
      "gap_id", "summary", "impact", "status", "question_id",
      "resolution_sha256",
    ], "context gap");
    requireString(gap.gap_id, "gap ID");
    validateSecretFreeText(gap.summary, "gap summary");
    validateSecretFreeText(gap.impact, "gap impact");
    if (!["OPEN", "RESOLVED"].includes(gap.status)) throw new Error("gap status invalid");
    if (gap.status === "OPEN") {
      if (!questions.has(gap.question_id) || gap.resolution_sha256 !== null) {
        throw new Error("open context gap lacks its unresolved question");
      }
    } else {
      if (gap.question_id !== null) throw new Error("resolved gap retains an open question");
      requireSha(gap.resolution_sha256, "gap resolution");
    }
  }

  if (!Array.isArray(input.decisions)) throw new Error("decisions must be an array");
  for (const decision of input.decisions) {
    exactKeys(decision, [
      "decision_id", "prompt", "why_it_matters", "options",
      "recommended_option", "status", "question_id", "decision_sha256",
    ], "owner decision");
    requireString(decision.decision_id, "decision ID");
    validateSecretFreeText(decision.prompt, "decision prompt");
    validateSecretFreeText(decision.why_it_matters, "decision rationale");
    if (!Array.isArray(decision.options) || decision.options.length < 2
        || decision.options.some((option) =>
          typeof option !== "string" || option.trim().length === 0)
        || new Set(decision.options).size !== decision.options.length) {
      throw new Error("decision options invalid");
    }
    if (decision.recommended_option !== null
        && !decision.options.includes(decision.recommended_option)) {
      throw new Error("decision recommendation is not an option");
    }
    if (decision.status === "USER_DECISION_REQUIRED") {
      if (!questions.has(decision.question_id) || decision.decision_sha256 !== null) {
        throw new Error("open decision lacks its question");
      }
    } else if (decision.status === "RESOLVED") {
      if (decision.question_id !== null) throw new Error("resolved decision retains a question");
      requireSha(decision.decision_sha256, "resolved decision");
    } else {
      throw new Error("decision status invalid");
    }
  }
  const referencedQuestionIds = new Set([
    ...input.findings.flatMap((finding) => finding.question_ids),
    ...input.context_gaps
      .filter((gap) => gap.question_id !== null)
      .map((gap) => gap.question_id),
    ...input.decisions
      .filter((decision) => decision.question_id !== null)
      .map((decision) => decision.question_id),
  ]);
  for (const questionId of questionIds) {
    if (!referencedQuestionIds.has(questionId)) {
      throw new Error("status brief contains an ungrounded extra question");
    }
  }
}

function sortedStatusInput(input) {
  const copy = structuredClone(input);
  for (const section of Object.keys(copy.work)) {
    copy.work[section].sort((left, right) => compareUtf8(left.item_id, right.item_id));
  }
  copy.findings.sort((left, right) => compareUtf8(left.finding_id, right.finding_id));
  copy.context_gaps.sort((left, right) => compareUtf8(left.gap_id, right.gap_id));
  copy.decisions.sort((left, right) => compareUtf8(left.decision_id, right.decision_id));
  copy.questions.sort((left, right) => compareUtf8(left.question_id, right.question_id));
  return copy;
}

export function compileGptAssistStatus(input, repositoryRoot) {
  validateGptAssistStatusInput(input);
  verifyGptAssistSourceGit(input.source, repositoryRoot);
  const normalized = sortedStatusInput(input);
  const body = {
    schema: "governance.gpt_assist_project_status.v1",
    ...normalized,
    chatgpt_instructions: {
      cadence: "ASK_EXACTLY_ONE_QUESTION_THEN_WAIT",
      capabilities: [
        "conversation", "voice", "research", "specialized models", "scenario exploration",
      ],
      objective: "Use only this brief, the user's answers, scenarios, and stated intent to resolve its material questions without inventing project truth or expanding the questionnaire.",
      stop_rule: "When every listed material question is answered or explicitly deferred, ask no more questions and mint the response Markdown.",
      authority_boundary: "Advisory only. Never mark a finding fixed, mutate the project, alter custody, or promote accepted-live truth.",
      return_format: "One deterministic plain Markdown response bound to this package when the listed questions are complete.",
    },
  };
  return {...body, package_sha256: digest(body)};
}

function section(markdown, title, items) {
  markdown.push(`## ${title}`, "");
  if (items.length === 0) {
    markdown.push("NONE", "");
    return;
  }
  for (const item of items) markdown.push(`- ${item.item_id}: ${item.summary}`);
  markdown.push("");
}

export function renderGptAssistMarkdown(packet) {
  const body = structuredClone(packet);
  delete body.package_sha256;
  if (digest(body) !== packet.package_sha256) throw new Error("GPT_ASSIST packet digest mismatch");
  validateGptAssistStatusInput(Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "schema" && key !== "chatgpt_instructions"),
  ));
  const markdown = [
    `# ${packet.project_id} — Project status`,
    "",
    `Campaign: \`${packet.campaign_id}\``,
    `Release: \`${packet.release_id}\``,
    `Status: \`${packet.campaign.status}\``,
    `Package: \`${packet.package_sha256}\``,
    "",
    "Use this as a portable project-context brief. You may use conversation, voice,",
    "research, specialized models, scenarios, and comparisons. Ask exactly one",
    "listed question at a time and wait. Rely on scenarios and stated intent;",
    "do not invent truth or expand into speculative questioning. Help the user",
    "ask their own questions too. Once every listed material question is answered",
    "or deferred, ask no more questions and mint the response Markdown.",
    "Do not claim that code is fixed, write project authority, change custody, or",
    "promote release truth. Those remain Orchestrator and Runtime responsibilities.",
    "",
  ];
  section(markdown, "Done", packet.work.completed);
  section(markdown, "In progress", packet.work.in_progress);
  section(markdown, "Not done", packet.work.not_done);
  section(markdown, "Needs planning", packet.work.needs_planning);
  markdown.push("## Audit findings", "");
  for (const finding of packet.findings) {
    markdown.push(`- ${finding.finding_id} [${finding.status}]: ${finding.summary}`);
  }
  if (packet.findings.length === 0) markdown.push("NONE");
  markdown.push("", "## Missing context", "");
  for (const gap of packet.context_gaps) markdown.push(`- ${gap.gap_id} [${gap.status}]: ${gap.summary}`);
  if (packet.context_gaps.length === 0) markdown.push("NONE");
  markdown.push("", "## User decisions", "");
  for (const decision of packet.decisions) {
    markdown.push(`- ${decision.decision_id} [${decision.status}]: ${decision.prompt}`);
  }
  if (packet.decisions.length === 0) markdown.push("NONE");
  markdown.push("", "## Questions", "");
  for (const question of packet.questions) {
    markdown.push(
      `### ${question.question_id}`,
      "",
      question.prompt,
      "",
      `Category: \`${question.category}\``,
      `Why it matters: ${question.why_it_matters}`,
      `Blocking: \`${question.blocking}\``,
      `Safe result if deferred: ${question.default_if_deferred}`,
      "",
    );
  }
  if (packet.questions.length === 0) markdown.push("NONE");
  markdown.push("", "When the listed questions are complete, return one response Markdown", "bound to this package. Do not create additional questions.", "");
  return markdown.join("\n");
}

function parseGptAssistResponseMarkdown(markdown, packet) {
  validateSecretFreeText(markdown, "GPT_ASSIST source response Markdown");
  if (Buffer.byteLength(markdown, "utf8") > 65_536
      || !markdown.startsWith("# GPT_ASSIST response\n")
      || !markdown.includes(`source_package_sha256: \`${packet.package_sha256}\``)) {
    throw new Error("GPT_ASSIST source response Markdown lacks its exact package binding");
  }
  const matches = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (matches.length !== 1) {
    throw new Error("GPT_ASSIST response must contain exactly one canonical JSON payload");
  }
  const outside = markdown.replace(matches[0][0], "").trim();
  const expectedOutside = [
    "# GPT_ASSIST response",
    "",
    `source_package_sha256: \`${packet.package_sha256}\``,
    "",
    "The JSON block is the complete owner response. No unbound prose is authoritative.",
  ].join("\n");
  if (outside !== expectedOutside) {
    throw new Error("GPT_ASSIST response contains unparsed or contradictory prose");
  }
  let parsed;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("GPT_ASSIST response JSON is invalid");
  }
  exactKeys(parsed, [
    "completed_at", "answers", "user_questions", "new_context",
  ], "GPT_ASSIST canonical Markdown payload");
  return parsed;
}

export function renderGptAssistOwnerResponseMarkdown(packet, responseContent) {
  const packetBody = structuredClone(packet);
  delete packetBody.package_sha256;
  if (digest(packetBody) !== packet.package_sha256) {
    throw new Error("GPT_ASSIST source packet is invalid");
  }
  exactKeys(responseContent, [
    "completed_at", "answers", "user_questions", "new_context",
  ], "GPT_ASSIST owner response content");
  return [
    "# GPT_ASSIST response",
    "",
    `source_package_sha256: \`${packet.package_sha256}\``,
    "",
    "The JSON block is the complete owner response. No unbound prose is authoritative.",
    "",
    "```json",
    JSON.stringify(canonicalize(responseContent), null, 2),
    "```",
    "",
  ].join("\n");
}

export function compileGptAssistResponseImport(markdown, packet) {
  const packetBody = structuredClone(packet);
  delete packetBody.package_sha256;
  if (digest(packetBody) !== packet.package_sha256) {
    throw new Error("GPT_ASSIST source packet is invalid");
  }
  const parsed = parseGptAssistResponseMarkdown(markdown, packet);
  const body = {
    schema: "governance.gpt_assist_response.v1",
    package_sha256: packet.package_sha256,
    source_markdown_sha256: crypto.createHash("sha256")
      .update(markdown, "utf8").digest("hex"),
    completed_at: parsed.completed_at,
    imported_by_auditor_session_id: packet.auditor.session_id,
    answers: parsed.answers,
    user_questions: parsed.user_questions,
    new_context: parsed.new_context,
  };
  const response = {...body, response_sha256: digest(body)};
  validateGptAssistResponse(response, packet);
  return response;
}

export function validateGptAssistResponse(response, packet) {
  const packetBody = structuredClone(packet);
  delete packetBody.package_sha256;
  if (digest(packetBody) !== packet.package_sha256) {
    throw new Error("GPT_ASSIST source packet is invalid");
  }
  exactKeys(response, [
    "schema", "package_sha256", "source_markdown_sha256", "completed_at",
    "imported_by_auditor_session_id", "answers", "user_questions",
    "new_context", "response_sha256",
  ], "GPT_ASSIST response");
  if (response.schema !== "governance.gpt_assist_response.v1"
      || response.package_sha256 !== packet.package_sha256) {
    throw new Error("GPT_ASSIST response package mismatch");
  }
  requireSha(response.source_markdown_sha256, "GPT_ASSIST source response Markdown");
  if (response.imported_by_auditor_session_id !== packet.auditor.session_id) {
    throw new Error("GPT_ASSIST response was not imported by its source Auditor");
  }
  requireUtc(response.completed_at, "GPT_ASSIST response time");
  if (new Date(response.completed_at) <= new Date(packet.generated_at)) {
    throw new Error("GPT_ASSIST response predates or equals its generated status packet");
  }
  const questionIds = new Set(packet.questions.map((question) => question.question_id));
  if (!Array.isArray(response.answers)) throw new Error("GPT_ASSIST answers invalid");
  const answered = new Set();
  for (const answer of response.answers) {
    exactKeys(answer, [
      "question_id", "status", "answer", "answered_by", "citations",
    ], "GPT_ASSIST answer");
    if (!questionIds.has(answer.question_id) || answered.has(answer.question_id)) {
      throw new Error("GPT_ASSIST answer question is unknown or duplicated");
    }
    answered.add(answer.question_id);
    if (!["OWNER_ANSWERED", "DEFERRED"].includes(answer.status)
        || answer.answered_by !== "OWNER") {
      throw new Error("GPT_ASSIST answer lacks owner authority");
    }
    validateSecretFreeText(answer.answer, "GPT_ASSIST answer");
    if (!Array.isArray(answer.citations)
        || answer.citations.some((citation) =>
          typeof citation !== "string" || citation.trim().length === 0)) {
      throw new Error("GPT_ASSIST answer citations invalid");
    }
  }
  if (answered.size !== questionIds.size) {
    throw new Error("GPT_ASSIST response does not resolve every listed question");
  }
  if (!Array.isArray(response.user_questions)) throw new Error("user questions invalid");
  for (const question of response.user_questions) {
    exactKeys(question, ["question", "answer", "asked_by"], "user question");
    if (question.asked_by !== "OWNER") {
      throw new Error("side question was not asked by the owner");
    }
    validateSecretFreeText(question.question, "user question");
    if (question.answer !== null) validateSecretFreeText(question.answer, "user answer");
  }
  if (!Array.isArray(response.new_context)) throw new Error("new context invalid");
  for (const context of response.new_context) {
    exactKeys(context, [
      "summary", "source", "confidence", "owner_confirmation_required",
    ], "new context");
    validateSecretFreeText(context.summary, "new context summary");
    validateSecretFreeText(context.source, "new context source");
    if (!["HIGH", "MEDIUM", "LOW"].includes(context.confidence)
        || context.owner_confirmation_required !== true) {
      throw new Error("new context cannot self-admit");
    }
  }
  const body = structuredClone(response);
  delete body.response_sha256;
  if (digest(body) !== response.response_sha256) {
    throw new Error("GPT_ASSIST response digest mismatch");
  }
}

function validateRosterReceipt(receipt, label) {
  exactKeys(receipt, [
    "schema", "campaign_id", "release_id", "governance_version",
    "campaign_state_sha256", "agents", "agents_sha256",
    "evidence_sha256", "receipt_sha256",
  ], label);
  if (receipt.schema !== "governance.campaign_roster_receipt.v1"
      || receipt.governance_version !== "2.1rc") {
    throw new Error(`${label} schema or governance mismatch`);
  }
  requireString(receipt.campaign_id, `${label} campaign`);
  requireString(receipt.release_id, `${label} release`);
  requireSha(receipt.campaign_state_sha256, `${label} campaign state`);
  requireSha(receipt.evidence_sha256, `${label} evidence`);
  if (!Array.isArray(receipt.agents) || receipt.agents.length === 0) {
    throw new Error(`${label} agents missing`);
  }
  requireSha(receipt.agents_sha256, `${label} agents`);
  if (receipt.agents_sha256 !== digest(receipt.agents)) {
    throw new Error(`${label} agent inventory digest mismatch`);
  }
  const sessions = new Set();
  for (const agent of receipt.agents) {
    exactKeys(agent, [
      "session_id", "role", "release_id", "governance_version",
      "fresh", "pinned",
    ], `${label} agent`);
    requireString(agent.session_id, `${label} agent session`);
    requireString(agent.role, `${label} agent role`);
    if (sessions.has(agent.session_id)
        || agent.release_id !== receipt.release_id
        || agent.governance_version !== "2.1rc"
        || agent.fresh !== true
        || agent.pinned !== true) {
      throw new Error(`${label} agent identity is stale, duplicate, or unpinned`);
    }
    sessions.add(agent.session_id);
  }
  const body = structuredClone(receipt);
  delete body.receipt_sha256;
  if (digest(body) !== receipt.receipt_sha256) {
    throw new Error(`${label} digest mismatch`);
  }
  return receipt;
}

export function compileGptAssistRosterReceipt(fields) {
  const body = {
    schema: "governance.campaign_roster_receipt.v1",
    ...structuredClone(fields),
    agents_sha256: digest(fields.agents),
  };
  const receipt = {...body, receipt_sha256: digest(body)};
  validateRosterReceipt(receipt, "campaign roster receipt");
  return receipt;
}

export function renderGptAssistResponseMarkdown(response, packet) {
  validateGptAssistResponse(response, packet);
  const markdown = [
    "# GPT_ASSIST response",
    "",
    `source_package_sha256: \`${packet.package_sha256}\``,
    `source_markdown_sha256: \`${response.source_markdown_sha256}\``,
    `response_sha256: \`${response.response_sha256}\``,
    `imported_by_auditor_session_id: \`${response.imported_by_auditor_session_id}\``,
    `completed_at: \`${response.completed_at}\``,
    "",
    "All listed material questions are complete or deferred. Ask no more",
    "questions in this exchange; return this response to the source Auditor.",
    "",
    "## Answers",
    "",
  ];
  for (const answer of response.answers) {
    markdown.push(
      `### ${answer.question_id}`,
      "",
      `status: \`${answer.status}\``,
      "",
      answer.answer,
      "",
    );
  }
  markdown.push("## User questions", "");
  if (response.user_questions.length === 0) markdown.push("NONE", "");
  for (const question of response.user_questions) {
    markdown.push(`- ${question.question}${question.answer === null ? "" : ` — ${question.answer}`}`);
  }
  markdown.push("", "## Context candidates", "");
  if (response.new_context.length === 0) markdown.push("NONE", "");
  for (const context of response.new_context) {
    markdown.push(`- [${context.confidence}] ${context.summary} — ${context.source}`);
  }
  markdown.push(
    "",
    "This response is advisory until the source Auditor validates it and binds",
    "the updated next-campaign and authority-update candidate handoff.",
    "",
  );
  return markdown.join("\n");
}

export function compileGptAssistNextCampaignHandoff(response, packet, handoff) {
  validateGptAssistResponse(response, packet);
  exactKeys(handoff, [
    "auditor_session_id", "next_campaign_sha256",
    "authority_update_candidate_sha256", "next_release_id",
    "current_roster_receipt", "successor_roster_receipt",
    "handed_off_at",
  ], "GPT_ASSIST next-campaign handoff");
  if (handoff.auditor_session_id !== packet.auditor.session_id) {
    throw new Error("only the source Auditor may bind the next-campaign handoff");
  }
  requireSha(handoff.next_campaign_sha256, "next campaign candidate");
  requireSha(handoff.authority_update_candidate_sha256, "authority update candidate");
  requireString(handoff.next_release_id, "next release ID");
  if (handoff.next_release_id === packet.release_id) {
    throw new Error("next release handoff reuses the current release");
  }
  const currentRoster = validateRosterReceipt(
    handoff.current_roster_receipt, "current campaign roster receipt",
  );
  const successorRoster = validateRosterReceipt(
    handoff.successor_roster_receipt, "successor campaign roster receipt",
  );
  const currentAuditor = currentRoster.agents.filter((agent) =>
    agent.role === "INDEPENDENT_AUDITOR"
    && agent.session_id === packet.auditor.session_id);
  const nextOrchestrator = successorRoster.agents.filter((agent) =>
    agent.role === "GLOBAL_ORCHESTRATOR"
    && agent.release_id === handoff.next_release_id);
  const currentSessions = new Set(currentRoster.agents.map((agent) => agent.session_id));
  if (currentRoster.campaign_id !== packet.campaign_id
      || currentRoster.release_id !== packet.release_id
      || currentRoster.campaign_state_sha256 !== packet.authority_snapshot_sha256
      || successorRoster.release_id !== handoff.next_release_id
      || successorRoster.campaign_state_sha256 !== handoff.next_campaign_sha256
      || currentAuditor.length !== 1
      || nextOrchestrator.length !== 1
      || successorRoster.agents.some((agent) => currentSessions.has(agent.session_id))) {
    throw new Error("GPT_ASSIST handoff is not bound to distinct validated rosters");
  }
  if (nextOrchestrator[0].session_id === handoff.auditor_session_id) {
    throw new Error("Auditor cannot become the next release Orchestrator");
  }
  requireUtc(handoff.handed_off_at, "next-campaign handoff time");
  if (new Date(handoff.handed_off_at) < new Date(response.completed_at)) {
    throw new Error("next-campaign handoff predates the completed owner response");
  }
  const body = {
    schema: "governance.gpt_assist_next_campaign_handoff.v1",
    package_sha256: packet.package_sha256,
    response_sha256: response.response_sha256,
    source_response_markdown_sha256: response.source_markdown_sha256,
    normalized_response_markdown_sha256: crypto.createHash("sha256")
      .update(renderGptAssistResponseMarkdown(response, packet), "utf8").digest("hex"),
    ...structuredClone(handoff),
    disposition: "NEXT_RELEASE_ORCHESTRATOR_AUTHORITY_UPDATE_AND_CAMPAIGN_START",
    auditor_updated_next_campaign: true,
    auditor_writes_authority: false,
    next_orchestrator_writes_campaign_authority: true,
    start_next_release_after_authority_update: true,
    fixed_finding_ids: [],
    standard_authority_promotion: false,
  };
  return {...body, handoff_sha256: digest(body)};
}
