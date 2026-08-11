#!/usr/bin/env node

/*
 * Executable governance for the local AgentOS campaign.  The owner-facing
 * conversation remains friendly elsewhere; this module is the precise
 * behind-the-scenes reasoning tree used by the Orchestrator and Controller.
 */

import {controllerDigest} from "./agentos-controller.mjs";
import {
  TASK_GATE_ANSWER_VALUES,
  TASK_GATE_APPLICABILITY_EVIDENCE_KEY,
  TASK_GATE_CATALOG_SHA256,
  TASK_GATE_CONTEXTS,
  TASK_GATE_QUESTIONS,
  taskGateQuestionIds,
  taskGateQuestionsFor,
  validateTaskGateQuestionCatalog,
} from "./task-gate-questions.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ROOTS = Object.freeze([
  "FUNCTIONALITY",
  "DESIGN_UI_SHELL_NAVIGATION",
  "CODE_QUALITY_HYGIENE",
  "SECURITY",
]);
const CLASSIFICATIONS = Object.freeze([
  "OWNER_OR_HARD_BLOCKER",
  "REPAIRABLE_ENGINEERING_PUZZLE",
  "SOFT_BOUNDARY_REVIEW",
].sort());
const ANSWER_TYPES = Object.freeze(["BOOLEAN"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function sortedUniqueStrings(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort();
  assert(new Set(sorted).size === sorted.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function defaultGateDefinitions(featureFiles) {
  const files = [...featureFiles].sort();
  const gates = [
    {
      gate_id: "G-FUNCTIONALITY-ROOT",
      root: "FUNCTIONALITY",
      kind: "ROOT",
      answer_type: "BOOLEAN",
      question: "Does evaluateGovernanceDecisionTree visit the four required roots in the exact declared order for this source?",
      feature_files: files,
      evidence_requirements: ["source_commit", "source_tree", "root_order_trace", "focused_functionality_result"],
      yes_subgates: ["G-FUNCTIONALITY-TYPED-ANSWERS", "G-FUNCTIONALITY-EXACT-RECHECK"],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-FUNCTIONALITY-TYPED-ANSWERS",
      root: "FUNCTIONALITY",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does the evaluator reject ambiguous or untyped answers before any root advances?",
      feature_files: ["control/governance-decision-tree.mjs", "tests/verify-governance-decision-tree.mjs"],
      evidence_requirements: ["ambiguous_answer_hostile_result", "typed_answer_result"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-FUNCTIONALITY-EXACT-RECHECK",
      root: "FUNCTIONALITY",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does every repairable NO require its named exact re-check before the evaluator reports PASS?",
      feature_files: ["control/governance-decision-tree.mjs", "control/controller-supervisor.mjs", "tests/verify-controller-supervisor.mjs"],
      evidence_requirements: ["repair_route_trace", "exact_recheck_trace"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-DESIGN-ROOT",
      root: "DESIGN_UI_SHELL_NAVIGATION",
      kind: "ROOT",
      answer_type: "BOOLEAN",
      question: "Does the governance tree stay behind the friendly owner conversation while its internal questions remain precise and feature-specific?",
      feature_files: ["control/bootstrap-compiler.mjs", "control/governance-decision-tree.mjs", "tests/verify-bootstrap-delivery-finish.mjs"],
      evidence_requirements: ["source_commit", "owner_surface_term_check", "one_question_trace", "design_bible_result"],
      yes_subgates: ["G-DESIGN-OWNER-SURFACE", "G-DESIGN-NO-GENERIC-GATES"],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-DESIGN-OWNER-SURFACE",
      root: "DESIGN_UI_SHELL_NAVIGATION",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does the owner projection avoid exposing schema, policy, campaign, adapter, commit, branch, or exact-plan vocabulary?",
      feature_files: ["control/bootstrap-compiler.mjs", "control/bootstrap-coverage.mjs", "tests/verify-bootstrap-delivery-finish.mjs"],
      evidence_requirements: ["owner_surface_term_check", "friendly_finish_question_check"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-DESIGN-NO-GENERIC-GATES",
      root: "DESIGN_UI_SHELL_NAVIGATION",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does every gate name the actual feature file and required evidence instead of using a generic governance statement?",
      feature_files: ["control/governance-decision-tree.mjs", "tests/verify-governance-decision-tree.mjs"],
      evidence_requirements: ["feature_path_trace", "specific_question_trace"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-CODE-QUALITY-ROOT",
      root: "CODE_QUALITY_HYGIENE",
      kind: "ROOT",
      answer_type: "BOOLEAN",
      question: "Is this the smallest secure and functional implementation of the decision tree and local admission bridge?",
      feature_files: ["control/governance-decision-tree.mjs", "control/local-campaign-admission.mjs", "control/local-agent-runtime.mjs"],
      evidence_requirements: ["source_commit", "changed_surface_trace", "full_check_result", "portability_result"],
      yes_subgates: ["G-CODE-NO-DYNAMIC-EVAL", "G-CODE-READBACK"],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-CODE-NO-DYNAMIC-EVAL",
      root: "CODE_QUALITY_HYGIENE",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does the evaluator use declared gates and typed records without dynamic code execution or hidden fallback behavior?",
      feature_files: ["control/governance-decision-tree.mjs", "tests/verify-governance-decision-tree.mjs"],
      evidence_requirements: ["static_source_check", "hostile_fallback_check"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-CODE-READBACK",
      root: "CODE_QUALITY_HYGIENE",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Are authorization, admission, spawn, and activation records written atomically and validated again after readback?",
      feature_files: ["control/local-campaign-admission.mjs", "control/local-agent-runtime.mjs", "tests/verify-local-campaign-admission.mjs"],
      evidence_requirements: ["atomic_write_result", "json_readback_result", "identity_readback_result"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-SECURITY-ROOT",
      root: "SECURITY",
      kind: "ROOT",
      answer_type: "BOOLEAN",
      question: "Does the local campaign reject every external side effect and every identity, boundary, or evidence mismatch?",
      feature_files: ["control/local-campaign-admission.mjs", "control/local-agent-runtime.mjs", "control/agentos-controller.mjs"],
      evidence_requirements: ["source_commit", "boundary_matrix", "hostile_security_result", "spawn_identity_trace"],
      yes_subgates: ["G-SECURITY-BOUNDARY", "G-SECURITY-SPAWN-IDENTITY"],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-SECURITY-BOUNDARY",
      root: "SECURITY",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Do local permissions remain limited to AgentOS development writes and local worker spawning while external actions stay false?",
      feature_files: ["control/local-campaign-admission.mjs", "tests/verify-local-campaign-admission.mjs"],
      evidence_requirements: ["boundary_matrix", "external_action_rejection_trace"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
    {
      gate_id: "G-SECURITY-SPAWN-IDENTITY",
      root: "SECURITY",
      kind: "SUBGATE",
      answer_type: "BOOLEAN",
      question: "Does each local worker readback prove the real process, role, worktree, source, campaign, and exit status without accepting a stub identity?",
      feature_files: ["control/local-agent-runtime.mjs", "tests/verify-local-agent-runtime.mjs"],
      evidence_requirements: ["spawn_identity_trace", "duplicate_spawn_rejection", "crash_readback_result"],
      yes_subgates: [],
      failure_tree: {
        classifications: [...CLASSIFICATIONS],
        requires_repair_path: true,
        requires_exact_recheck: true,
      },
    },
  ];
  for (const gate of gates) {
    gate.feature_files = [...gate.feature_files].sort();
    gate.evidence_requirements = [...gate.evidence_requirements].sort();
    gate.yes_subgates = [...gate.yes_subgates].sort();
    gate.failure_tree.classifications = [...gate.failure_tree.classifications].sort();
  }
  return gates;
}

function validateGate(gate, allIds) {
  exactKeys(gate, ["gate_id", "root", "kind", "answer_type", "question", "feature_files", "evidence_requirements", "yes_subgates", "failure_tree"], "governance gate");
  assert(typeof gate.gate_id === "string" && gate.gate_id.startsWith("G-"), "governance gate ID is invalid");
  assert(ROOTS.includes(gate.root), "governance gate root is invalid");
  assert(["ROOT", "SUBGATE"].includes(gate.kind), "governance gate kind is invalid");
  assert(ANSWER_TYPES.includes(gate.answer_type), "governance gate answer type is invalid");
  requireString(gate.question, `${gate.gate_id} question`);
  sortedUniqueStrings(gate.feature_files, `${gate.gate_id} feature files`);
  sortedUniqueStrings(gate.evidence_requirements, `${gate.gate_id} evidence requirements`);
  assert(Array.isArray(gate.yes_subgates), `${gate.gate_id} YES sub-gates are required`);
  gate.yes_subgates.forEach((id) => assert(allIds.has(id), `${gate.gate_id} references an unknown YES sub-gate`));
  exactKeys(gate.failure_tree, ["classifications", "requires_repair_path", "requires_exact_recheck"], `${gate.gate_id} failure tree`);
  assert(JSON.stringify(gate.failure_tree.classifications) === JSON.stringify([...CLASSIFICATIONS]), `${gate.gate_id} failure classifications are incomplete`);
  assert(gate.failure_tree.requires_repair_path === true && gate.failure_tree.requires_exact_recheck === true, `${gate.gate_id} failure tree is not fail-closed`);
}

export function validateGovernanceDecisionTree(tree) {
  exactKeys(tree, ["schema", "version", "status", "source_commit", "source_tree", "owner_intent_sha256", "scope_sha256", "task_gate_catalog_sha256", "task_gate_questions", "task_gate_question_ids_by_context", "ordered_roots", "gates", "ambiguity_rule", "yes_rule", "no_rule", "tree_sha256"], "governance decision tree");
  assert(tree.schema === "agentos.governance_decision_tree.v1" && tree.version === 1, "governance decision tree schema mismatch");
  assert(tree.status === "EXECUTABLE", "governance decision tree is not executable");
  requireGitObject(tree.source_commit, "governance tree source commit");
  requireGitObject(tree.source_tree, "governance tree source tree");
  requireSha(tree.owner_intent_sha256, "governance tree owner intent");
  requireSha(tree.scope_sha256, "governance tree scope");
  requireSha(tree.task_gate_catalog_sha256, "governance tree task-gate catalog");
  assert(tree.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, "governance tree task-gate catalog binding differs");
  validateTaskGateQuestionCatalog(tree.task_gate_questions);
  assert(JSON.stringify(tree.task_gate_questions) === JSON.stringify(TASK_GATE_QUESTIONS), "governance tree task-gate questions differ from the canonical catalog");
  exactKeys(tree.task_gate_question_ids_by_context, TASK_GATE_CONTEXTS, "governance tree task-gate context map");
  for (const context of TASK_GATE_CONTEXTS) assert(JSON.stringify(tree.task_gate_question_ids_by_context[context]) === JSON.stringify(taskGateQuestionIds(context)), `${context} task-gate question map is incomplete or reordered`);
  assert(JSON.stringify(tree.ordered_roots) === JSON.stringify(ROOTS), "governance tree root order is invalid");
  assert(Array.isArray(tree.gates) && tree.gates.length >= ROOTS.length, "governance tree gates are required");
  const ids = new Set(tree.gates.map((gate) => gate.gate_id));
  assert(ids.size === tree.gates.length, "governance tree gate IDs are duplicated");
  for (const gate of tree.gates) validateGate(gate, ids);
  for (const root of ROOTS) {
    const rootGate = tree.gates.find((gate) => gate.root === root && gate.kind === "ROOT");
    assert(rootGate, `${root} root gate is missing`);
    assert(rootGate.yes_subgates.every((id) => tree.gates.find((gate) => gate.gate_id === id)?.root === root), `${root} YES sub-gate crosses roots`);
  }
  requireString(tree.ambiguity_rule, "governance tree ambiguity rule");
  requireString(tree.yes_rule, "governance tree YES rule");
  requireString(tree.no_rule, "governance tree NO rule");
  requireSha(tree.tree_sha256, "governance tree digest");
  assert(tree.tree_sha256 === digestWithout(tree, "tree_sha256"), "governance tree digest mismatch");
  return tree;
}

export function compileGovernanceDecisionTree({sourceCommit, sourceTree, ownerIntentSha256, scopeSha256, featureFiles}) {
  requireGitObject(sourceCommit, "governance tree source commit");
  requireGitObject(sourceTree, "governance tree source tree");
  requireSha(ownerIntentSha256, "governance tree owner intent");
  requireSha(scopeSha256, "governance tree scope");
  sortedUniqueStrings(featureFiles, "governance tree feature files");
  const tree = {
    schema: "agentos.governance_decision_tree.v1",
    version: 1,
    status: "EXECUTABLE",
    source_commit: sourceCommit,
    source_tree: sourceTree,
    owner_intent_sha256: ownerIntentSha256,
    scope_sha256: scopeSha256,
    task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
    task_gate_questions: structuredClone(TASK_GATE_QUESTIONS),
    task_gate_question_ids_by_context: Object.fromEntries(TASK_GATE_CONTEXTS.map((context) => [context, taskGateQuestionIds(context)])),
    ordered_roots: [...ROOTS],
    gates: defaultGateDefinitions(featureFiles),
    ambiguity_rule: "Only explicit YES/NO or the declared typed answer advances a gate; any ambiguity stops the dependent outcome.",
    yes_rule: "YES must carry every required evidence item and complete every declared sub-gate before the next root.",
    no_rule: "NO must classify the finding, choose owner/hard blocker, soft-boundary review, or repairable puzzle, name the repair path, and bind the exact re-check.",
    tree_sha256: null,
  };
  tree.tree_sha256 = digestWithout(tree, "tree_sha256");
  return validateGovernanceDecisionTree(tree);
}

function normalizeBoolean(value, label) {
  if (value === true || value === "YES") return true;
  if (value === false || value === "NO") return false;
  throw new Error(`${label} requires explicit YES or NO`);
}

function validateEvidenceRecord(value, key, label, tree) {
  exactKeys(value, ["schema", "version", "evidence_key", "source_commit", "source_tree", "check_id", "observed", "result_sha256", "evidence_sha256"], label);
  assert(value.schema === "agentos.governance_gate_evidence.v1" && value.version === 1, label + " schema mismatch");
  assert(value.evidence_key === key, label + " key mismatch");
  requireGitObject(value.source_commit, label + " source commit");
  requireGitObject(value.source_tree, label + " source tree");
  assert(value.source_commit === tree.source_commit && value.source_tree === tree.source_tree, label + " source binding differs from the tested tree");
  requireString(value.check_id, label + " check ID");
  assert(!value.check_id.includes("PLACEHOLDER") && !value.check_id.includes("}"), label + " uses generic evidence");
  exactKeys(value.observed, ["command", "exit_code", "stdout_sha256", "stderr_sha256", "status"], label + " observation");
  requireString(value.observed.command, label + " command");
  assert(Number.isSafeInteger(value.observed.exit_code) && value.observed.exit_code === 0, label + " command did not pass");
  assert(value.observed.status === "PASS", label + " observation is not a passing check");
  requireSha(value.observed.stdout_sha256, label + " stdout digest");
  requireSha(value.observed.stderr_sha256, label + " stderr digest");
  requireSha(value.result_sha256, label + " result digest");
  assert(value.result_sha256 === controllerDigest(value.observed), label + " result digest does not match the observation");
  requireSha(value.evidence_sha256, label + " evidence digest");
  assert(value.evidence_sha256 === digestWithout(value, "evidence_sha256"), label + " evidence digest mismatch");
}

function validateEvidence(evidence, required, label, tree) {
  requireRecord(evidence, label);
  const actual = Object.keys(evidence).sort();
  const expected = [...required].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), label + " must contain exactly the declared evidence");
  for (const key of required) validateEvidenceRecord(evidence[key], key, label + "." + key, tree);
}


function inspectAnswer(gate, answer, answers, traces) {
  requireRecord(answer, `${gate.gate_id} answer`);
  exactKeys(answer, ["answer", "evidence", "failure", "recheck"], `${gate.gate_id} answer`);
  const yes = normalizeBoolean(answer.answer, `${gate.gate_id} answer`);
  if (yes) {
    assert(answer.failure === null && answer.recheck === null, `${gate.gate_id} YES cannot carry a failure or recheck`);
    validateEvidence(answer.evidence, gate.evidence_requirements, gate.gate_id + " evidence", answers._tree);
    traces.push({gate_id: gate.gate_id, answer: "YES", evidence: structuredClone(answer.evidence)});
    return {status: "PASS"};
  }
  assert(answer.failure !== null && answer.recheck !== null, `${gate.gate_id} NO requires a failure tree and exact re-check`);
  exactKeys(answer.failure, ["classification", "reason", "repair_path", "required_recheck_gate_id"], `${gate.gate_id} failure`);
  assert(CLASSIFICATIONS.includes(answer.failure.classification), `${gate.gate_id} failure classification is invalid`);
  for (const field of ["reason", "repair_path", "required_recheck_gate_id"]) requireString(answer.failure[field], `${gate.gate_id} failure ${field}`);
  exactKeys(answer.recheck, ["gate_id", "answer", "evidence"], `${gate.gate_id} re-check`);
  assert(answer.recheck.gate_id === answer.failure.required_recheck_gate_id, `${gate.gate_id} re-check does not match failure tree`);
  assert(normalizeBoolean(answer.recheck.answer, `${gate.gate_id} re-check`) === true, `${gate.gate_id} exact re-check must be YES`);
  const recheckGate = answers._tree.gates.find((candidate) => candidate.gate_id === answer.recheck.gate_id);
  assert(recheckGate, `${gate.gate_id} exact re-check names an unknown gate`);
  validateEvidence(answer.recheck.evidence, recheckGate.evidence_requirements, gate.gate_id + " re-check evidence", answers._tree);
  traces.push({gate_id: gate.gate_id, answer: "NO", failure: structuredClone(answer.failure), recheck: structuredClone(answer.recheck)});
  if (answer.failure.classification === "REPAIRABLE_ENGINEERING_PUZZLE") return {status: "REPAIRED"};
  return {status: answer.failure.classification};
}

const TASK_GATE_EVIDENCE_FIELDS = [
  "evidence_key", "question_id", "source_commit", "source_tree", "worktree_id",
  "session_id", "goal_id", "goal_sha256", "build_identity", "environment_id", "observed_at_utc", "result_sha256", "status",
];

const TASK_GATE_IDENTITY_FIELDS = ["source_commit", "source_tree", "worktree_id", "session_id", "goal_id", "goal_sha256", "build_identity", "environment_id"];

function validateTaskGateEvidence(evidence, question, evidenceKey, label) {
  exactKeys(evidence, TASK_GATE_EVIDENCE_FIELDS, label);
  assert(evidence.evidence_key === evidenceKey, `${label} evidence key differs`);
  assert(evidence.question_id === question.question_id, `${label} question identity differs`);
  requireGitObject(evidence.source_commit, `${label} source commit`);
  requireGitObject(evidence.source_tree, `${label} source tree`);
  for (const field of ["worktree_id", "session_id", "goal_id", "build_identity", "environment_id"]) requireString(evidence[field], `${label} ${field}`);
  requireSha(evidence.goal_sha256, `${label} goal digest`);
  requireUtc(evidence.observed_at_utc, `${label} observed time`);
  requireSha(evidence.result_sha256, `${label} result digest`);
  assert(evidence.status === "PASS", `${label} status is not PASS`);
}

function validateTaskGateFailure(failure, question, label) {
  exactKeys(failure, ["classification", "reason", "route", "recheck_question_id"], label);
  assert(CLASSIFICATIONS.includes(failure.classification), `${label} classification is invalid`);
  requireString(failure.reason, `${label} reason`);
  requireString(failure.route, `${label} route`);
  assert(failure.recheck_question_id === question.question_id, `${label} must name its own exact re-check question`);
}

function inspectTaskGateAnswer(question, answer, context, traces) {
  requireRecord(answer, `${question.question_id} task answer`);
  exactKeys(answer, ["answer", "evidence", "failure", "recheck"], `${question.question_id} task answer`);
  assert(TASK_GATE_ANSWER_VALUES.includes(answer.answer), `${question.question_id} requires explicit YES, NO, UNKNOWN, or NOT_APPLICABLE`);
  requireRecord(answer.evidence, `${question.question_id} task evidence`);
  const actualEvidenceKeys = Object.keys(answer.evidence).sort();
  const expectedEvidenceKeys = [...question.required_evidence, ...(answer.answer === "NOT_APPLICABLE" ? [TASK_GATE_APPLICABILITY_EVIDENCE_KEY] : [])].sort();
  assert(JSON.stringify(actualEvidenceKeys) === JSON.stringify(expectedEvidenceKeys), `${question.question_id} evidence does not match its exact requirements`);
  for (const evidenceKey of question.required_evidence) validateTaskGateEvidence(answer.evidence[evidenceKey], question, evidenceKey, `${question.question_id}.${evidenceKey}`);
  if (answer.answer === "NOT_APPLICABLE") {
    validateTaskGateEvidence(answer.evidence[TASK_GATE_APPLICABILITY_EVIDENCE_KEY], question, TASK_GATE_APPLICABILITY_EVIDENCE_KEY, `${question.question_id}.${TASK_GATE_APPLICABILITY_EVIDENCE_KEY}`);
    assert(answer.failure === null && answer.recheck === null, `${question.question_id} NOT_APPLICABLE requires applicability evidence, not a failure route`);
    traces.push({question_id: question.question_id, context, answer: answer.answer, applicability_evidence: TASK_GATE_APPLICABILITY_EVIDENCE_KEY});
    return "PASS";
  }
  const passed = answer.answer === question.pass_answer;
  if (passed) {
    assert(answer.failure === null && answer.recheck === null, `${question.question_id} ${question.pass_answer} cannot carry a failure or re-check`);
    traces.push({question_id: question.question_id, context, answer: answer.answer, evidence: structuredClone(answer.evidence)});
    return "PASS";
  }
  assert(answer.failure !== null, `${question.question_id} ${answer.answer} requires a failure route`);
  validateTaskGateFailure(answer.failure, question, `${question.question_id} failure`);
  if (answer.recheck !== null) {
    requireRecord(answer.recheck, `${question.question_id} re-check`);
    exactKeys(answer.recheck, ["answer", "evidence"], `${question.question_id} re-check`);
    assert(answer.recheck.answer === question.pass_answer, `${question.question_id} re-check must be ${question.pass_answer}`);
    requireRecord(answer.recheck.evidence, `${question.question_id} re-check evidence`);
    const recheckKeys = Object.keys(answer.recheck.evidence).sort();
    assert(JSON.stringify(recheckKeys) === JSON.stringify(expectedEvidenceKeys), `${question.question_id} re-check evidence is incomplete`);
    for (const evidenceKey of question.required_evidence) validateTaskGateEvidence(answer.recheck.evidence[evidenceKey], question, evidenceKey, `${question.question_id}.recheck.${evidenceKey}`);
  }
  traces.push({question_id: question.question_id, context, answer: answer.answer, failure: structuredClone(answer.failure), recheck: answer.recheck === null ? null : structuredClone(answer.recheck)});
  if (answer.recheck !== null) return "PASS";
  if (answer.failure.classification === "REPAIRABLE_ENGINEERING_PUZZLE") return "REPAIR_REQUIRED";
  return "BLOCKED";
}

export function evaluateTaskGateQuestions({tree, context, answers, expectedBinding = null}) {
  validateGovernanceDecisionTree(tree);
  assert(TASK_GATE_CONTEXTS.includes(context), `unknown task-gate context: ${context}`);
  requireRecord(answers, `${context} task-gate answers`);
  const questions = taskGateQuestionsFor(context);
  const questionIds = new Set(questions.map((question) => question.question_id));
  const suppliedIds = Object.keys(answers);
  suppliedIds.forEach((questionId) => assert(questionIds.has(questionId), `${context} task-gate answers contain an inapplicable question: ${questionId}`));
  const traces = [];
  let observedBinding = null;
  for (const question of questions) {
    const answer = answers[question.question_id];
    if (answer === undefined) {
      return {
        schema: "agentos.task_gate_evaluation.v1",
        version: 1,
        tree_sha256: tree.tree_sha256,
        context,
        status: "BLOCKED",
        blocked_question_id: question.question_id,
        traces,
        evaluation_sha256: digestWithout({tree_sha256: tree.tree_sha256, context, status: "BLOCKED", blocked_question_id: question.question_id, traces}, "evaluation_sha256"),
      };
    }
    const status = inspectTaskGateAnswer(question, answer, context, traces);
    const evidenceItems = Object.values(answer.evidence);
    const currentBinding = Object.fromEntries(TASK_GATE_IDENTITY_FIELDS.map((field) => [field, evidenceItems[0][field]]));
    for (const evidenceItem of evidenceItems) {
      for (const field of TASK_GATE_IDENTITY_FIELDS) assert(evidenceItem[field] === currentBinding[field], `${context} task-gate evidence identity differs within ${question.question_id}.${field}`);
    }
    if (observedBinding === null) observedBinding = currentBinding;
    else for (const field of TASK_GATE_IDENTITY_FIELDS) assert(currentBinding[field] === observedBinding[field], `${context} task-gate evidence identity differs at ${question.question_id}.${field}`);
    assert(currentBinding.source_commit === tree.source_commit && currentBinding.source_tree === tree.source_tree, `${context} task-gate evidence source differs from the decision tree`);
    if (expectedBinding !== null) for (const field of TASK_GATE_IDENTITY_FIELDS) assert(currentBinding[field] === expectedBinding[field], `${context} task-gate evidence differs from expected ${field}`);
    if (status !== "PASS") {
      const evaluation = {tree_sha256: tree.tree_sha256, context, status, blocked_question_id: question.question_id, traces};
      return {
        schema: "agentos.task_gate_evaluation.v1",
        version: 1,
        ...evaluation,
        evaluation_sha256: digestWithout({...evaluation, evaluation_sha256: null}, "evaluation_sha256"),
      };
    }
  }
  const evaluation = {tree_sha256: tree.tree_sha256, context, status: "PASS", blocked_question_id: null, traces};
  return {
    schema: "agentos.task_gate_evaluation.v1",
    version: 1,
    ...evaluation,
    evaluation_sha256: digestWithout({...evaluation, evaluation_sha256: null}, "evaluation_sha256"),
  };
}

export function evaluateGovernanceDecisionTree({tree, answers, taskGateAnswers = null, artifactContext = null, artifactAnswers = null}) {
  validateGovernanceDecisionTree(tree);
  requireRecord(answers, "governance tree answers");
  let taskGateEvaluation = null;
  let artifactGateEvaluation = null;
  if (taskGateAnswers !== null) {
    taskGateEvaluation = evaluateTaskGateQuestions({tree, context: "TASK_START", answers: taskGateAnswers});
    if (taskGateEvaluation.status !== "PASS") return compileEvaluation({tree, status: taskGateEvaluation.status, classification: taskGateEvaluation.status === "BLOCKED" ? "OWNER_OR_HARD_BLOCKER" : "REPAIRABLE_ENGINEERING_PUZZLE", completedRoots: [], traces: [], blocked_gate_id: taskGateEvaluation.blocked_question_id, reason: "A required task-start question did not pass.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: null});
  }
  if (artifactContext !== null || artifactAnswers !== null) {
    assert(typeof artifactContext === "string" && artifactContext !== "TASK_START", "artifact context is required for artifact gate evaluation");
    artifactGateEvaluation = evaluateTaskGateQuestions({tree, context: artifactContext, answers: artifactAnswers});
    if (artifactGateEvaluation.status !== "PASS") return compileEvaluation({tree, status: artifactGateEvaluation.status, classification: artifactGateEvaluation.status === "BLOCKED" ? "OWNER_OR_HARD_BLOCKER" : "REPAIRABLE_ENGINEERING_PUZZLE", completedRoots: [], traces: [], blocked_gate_id: artifactGateEvaluation.blocked_question_id, reason: "A required artifact or closure question did not pass.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
  }
  const gateIds = new Set(tree.gates.map((gate) => gate.gate_id));
  for (const key of Object.keys(answers)) assert(gateIds.has(key), `governance tree answer names an unknown gate: ${key}`);
  const supplied = structuredClone(answers);
  supplied._tree = tree;
  const traces = [];
  const completedRoots = [];
  for (const root of tree.ordered_roots) {
    const rootGate = tree.gates.find((gate) => gate.root === root && gate.kind === "ROOT");
    const rootAnswer = supplied[rootGate.gate_id];
    if (!rootAnswer) return compileEvaluation({tree, status: "BLOCKED", classification: "OWNER_OR_HARD_BLOCKER", completedRoots, traces, blocked_gate_id: rootGate.gate_id, reason: "A root gate answer is missing.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
    const rootResult = inspectAnswer(rootGate, rootAnswer, supplied, traces);
    if (rootResult.status !== "PASS" && rootResult.status !== "REPAIRED") return compileEvaluation({tree, status: rootResult.status === "SOFT_BOUNDARY_REVIEW" ? "SOFT_BOUNDARY_REVIEW" : "BLOCKED", classification: rootResult.status, completedRoots, traces, blocked_gate_id: rootGate.gate_id, reason: "A root gate did not pass.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
    for (const subgateId of rootGate.yes_subgates) {
      const subgate = tree.gates.find((gate) => gate.gate_id === subgateId);
      const subAnswer = supplied[subgateId];
      if (!subAnswer) return compileEvaluation({tree, status: "BLOCKED", classification: "OWNER_OR_HARD_BLOCKER", completedRoots, traces, blocked_gate_id: subgateId, reason: "A required YES sub-gate answer is missing.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
      const subResult = inspectAnswer(subgate, subAnswer, supplied, traces);
      if (subResult.status !== "PASS" && subResult.status !== "REPAIRED") return compileEvaluation({tree, status: subResult.status === "SOFT_BOUNDARY_REVIEW" ? "SOFT_BOUNDARY_REVIEW" : "BLOCKED", classification: subResult.status, completedRoots, traces, blocked_gate_id: subgateId, reason: "A required YES sub-gate did not pass.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
    }
    completedRoots.push(root);
  }
  return compileEvaluation({tree, status: "PASS", classification: null, completedRoots, traces, blocked_gate_id: null, reason: "All four roots and required sub-gates passed.", task_gate_evaluation: taskGateEvaluation, artifact_gate_evaluation: artifactGateEvaluation});
}

function compileEvaluation({tree, status, classification, completedRoots, traces, blocked_gate_id, reason, task_gate_evaluation = null, artifact_gate_evaluation = null}) {
  const evaluation = {
    schema: "agentos.governance_decision_tree_evaluation.v1",
    version: 1,
    tree_sha256: tree.tree_sha256,
    status,
    classification,
    completed_roots: [...completedRoots],
    blocked_gate_id,
    reason,
    traces,
    task_gate_evaluation,
    artifact_gate_evaluation,
    evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = digestWithout(evaluation, "evaluation_sha256");
  return evaluation;
}

export {CLASSIFICATIONS, ROOTS};


export function compileFeatureAgentRepairReceipt({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_BD1F53BA56DEF151({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_B41C1548F3525474({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_AE5621EDB8B4A433({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_378C8D7711730E32({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_DE7E3C905191F92C({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_371FD03F5C8F5AB0({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_F4441553AD49E23D({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_976C58FC57726D29({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_03BA0DC79BEE4A8C({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_D869489A7BE7BBE7({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_420741E014FEFDA6({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}


export function compileFeatureAgentTaskReceipt_TASK_CAMPAIGN_PROGRESS_C2DD681A8271F402({campaignId, candidateSha256, sourceCommit, sourceTree, changedPaths, focusedChecks}) {
  if (typeof campaignId !== "string" || typeof candidateSha256 !== "string" || typeof sourceCommit !== "string" || typeof sourceTree !== "string") throw new Error("Feature Agent repair receipt identity is incomplete");
  if (!Array.isArray(changedPaths) || !changedPaths.includes("control/governance-decision-tree.mjs")) throw new Error("Feature Agent repair receipt lacks the governance-tree code change");
  if (!Array.isArray(focusedChecks) || focusedChecks.length === 0) throw new Error("Feature Agent repair receipt lacks focused checks");
  return {schema: "agentos.feature_agent_repair_receipt.v1", version: 1, campaign_id: campaignId, candidate_sha256: candidateSha256, source_commit: sourceCommit, source_tree: sourceTree, changed_paths: [...changedPaths].sort(), focused_checks: [...focusedChecks].sort()};
}
