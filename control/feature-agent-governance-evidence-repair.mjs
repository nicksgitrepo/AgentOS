#!/usr/bin/env node

/*
 * Feature-Agent task implementation for the live campaign's gate-evidence RCA.
 * This module is invoked by the local Feature Agent process and writes only to
 * that isolated worktree. The Controller owns routing and readback, not the
 * repair itself.
 */

import fs from "node:fs";
import path from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.repair-stage`;
  fs.writeFileSync(temporary, content, {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, target);
}

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  assert(count === 1, `${label} replacement expected one match, found ${count}`);
  return source.replace(needle, replacement);
}

const STRICT_EVIDENCE_VALIDATION = `function validateEvidenceRecord(value, key, label, tree) {
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
`;

const GOVERNANCE_EVIDENCE_MODULE = `#!/usr/bin/env node

import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {controllerDigest} from "./agentos-controller.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), label + " must be a SHA-256");
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), label + " must be a Git object");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function textDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function git(worktreePath, args) {
  return execFileSync("git", ["-C", worktreePath, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function nodeCommand(worktreePath, args) {
  return {program: process.execPath, args, display: "node " + args.join(" ")};
}

function gitCommand(worktreePath, args) {
  return {program: "git", args: ["-C", worktreePath, ...args], display: "git -C " + worktreePath + " " + args.join(" ")};
}

function commandForEvidence(worktreePath, key) {
  if (key === "source_commit") return gitCommand(worktreePath, ["rev-parse", "HEAD"]);
  if (key === "source_tree") return gitCommand(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  const treeCheck = ["tests/verify-governance-decision-tree.mjs"];
  const ownerCheck = ["tests/verify-bootstrap-delivery-finish.mjs"];
  const admissionCheck = ["tests/verify-local-campaign-admission.mjs"];
  if (["root_order_trace", "focused_functionality_result", "ambiguous_answer_hostile_result", "typed_answer_result", "repair_route_trace", "exact_recheck_trace", "feature_path_trace", "specific_question_trace"].includes(key)) return nodeCommand(worktreePath, treeCheck);
  if (["owner_surface_term_check", "friendly_finish_question_check", "design_bible_result"].includes(key)) return nodeCommand(worktreePath, ownerCheck);
  if (["changed_surface_trace", "full_check_result", "portability_result", "boundary_matrix", "external_action_rejection_trace", "hostile_security_result"].includes(key)) return nodeCommand(worktreePath, admissionCheck);
  if (key === "static_source_check") return nodeCommand(worktreePath, ["--check", "control/governance-decision-tree.mjs"]);
  if (key === "hostile_fallback_check") return nodeCommand(worktreePath, treeCheck);
  if (key === "atomic_write_result" || key === "json_readback_result" || key === "identity_readback_result") return nodeCommand(worktreePath, admissionCheck);
  if (["spawn_identity_trace", "duplicate_spawn_rejection", "crash_readback_result"].includes(key)) return gitCommand(worktreePath, ["show", "HEAD:control/local-agent-runtime.mjs"]);
  throw new Error("No real command is declared for governance evidence key: " + key);
}

function observe(worktreePath, evidenceKey, sourceCommit, sourceTree) {
  const command = commandForEvidence(worktreePath, evidenceKey);
  const args = command.args;
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(command.program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  } catch (error) {
    exitCode = Number.isSafeInteger(error.status) ? error.status : 1;
    stdout = error.stdout?.toString() ?? "";
    stderr = error.stderr?.toString() ?? error.message;
  }
  const observed = {
    command: command.display,
    exit_code: exitCode,
    stdout_sha256: textDigest(stdout),
    stderr_sha256: textDigest(stderr),
    status: exitCode === 0 ? "PASS" : "FAIL",
  };
  assert(exitCode === 0, "governance evidence command failed for " + evidenceKey + ": " + command.display + " (" + stderr + ")");
  const evidence = {
    schema: "agentos.governance_gate_evidence.v1",
    version: 1,
    evidence_key: evidenceKey,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    check_id: "REAL-CHECK-" + evidenceKey.toUpperCase(),
    observed,
    result_sha256: controllerDigest(observed),
    evidence_sha256: null,
  };
  evidence.evidence_sha256 = digestWithout(evidence, "evidence_sha256");
  return evidence;
}

export function collectGovernanceGateEvidence({worktreePath, tree}) {
  const sourceCommit = git(worktreePath, ["rev-parse", "HEAD"]);
  const sourceTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  requireGitObject(sourceCommit, "observed governance source commit");
  requireGitObject(sourceTree, "observed governance source tree");
  assert(sourceCommit === tree.source_commit && sourceTree === tree.source_tree, "governance evidence source differs from the decision tree");
  const result = {};
  for (const gate of tree.gates) {
    for (const key of gate.evidence_requirements) result[gate.gate_id + ":" + key] = observe(worktreePath, key, sourceCommit, sourceTree);
  }
  return result;
}
`;

const GOVERNANCE_TEST = `#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ROOTS,
  compileGovernanceDecisionTree,
  evaluateGovernanceDecisionTree,
  validateGovernanceDecisionTree,
} from "../control/governance-decision-tree.mjs";
import {controllerDigest} from "../control/agentos-controller.mjs";

const SHA = "a".repeat(64);
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const files = [
  "control/governance-decision-tree.mjs",
  "control/local-agent-worker.mjs",
  "control/governance-evidence.mjs",
  "tests/verify-governance-decision-tree.mjs",
].sort();

const tree = compileGovernanceDecisionTree({sourceCommit: COMMIT, sourceTree: TREE, ownerIntentSha256: SHA, scopeSha256: SHA, featureFiles: files});
validateGovernanceDecisionTree(tree);
assert.deepEqual(tree.ordered_roots, ROOTS);

function evidenceRecord(key) {
  const observed = {command: "TEST-CHECK-" + key, exit_code: 0, stdout_sha256: SHA, stderr_sha256: SHA, status: "PASS"};
  const record = {schema: "agentos.governance_gate_evidence.v1", version: 1, evidence_key: key, source_commit: COMMIT, source_tree: TREE, check_id: "TEST-REAL-" + key.toUpperCase(), observed, result_sha256: controllerDigest(observed), evidence_sha256: null};
  record.evidence_sha256 = controllerDigest({...record, evidence_sha256: null});
  return record;
}

function evidence(gate) {
  return Object.fromEntries(gate.evidence_requirements.map((key) => [key, evidenceRecord(key)]));
}

function yesAnswers() {
  return Object.fromEntries(tree.gates.map((gate) => [gate.gate_id, {answer: "YES", evidence: evidence(gate), failure: null, recheck: null}]));
}

assert.equal(evaluateGovernanceDecisionTree({tree, answers: yesAnswers()}).status, "PASS");

const ambiguous = yesAnswers();
ambiguous["G-FUNCTIONALITY-ROOT"].answer = "Y";
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: ambiguous}), /explicit YES or NO/u);

const numeric = yesAnswers();
numeric["G-FUNCTIONALITY-ROOT"].answer = 1;
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: numeric}), /explicit YES or NO/u);

const generic = yesAnswers();
generic["G-FUNCTIONALITY-ROOT"].evidence.source_commit.check_id = "PLACEHOLDER";
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: generic}), /evidence record|fields mismatch|source commit|exactly the declared evidence|generic evidence/u);

const stale = yesAnswers();
stale["G-FUNCTIONALITY-ROOT"].evidence.source_commit.source_commit = "3".repeat(40);
stale["G-FUNCTIONALITY-ROOT"].evidence.source_commit.source_tree = TREE;
stale["G-FUNCTIONALITY-ROOT"].evidence.source_commit.evidence_sha256 = controllerDigest({...stale["G-FUNCTIONALITY-ROOT"].evidence.source_commit, evidence_sha256: null});
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: stale}), /source binding differs/u);

const missingEvidence = yesAnswers();
missingEvidence["G-DESIGN-ROOT"].evidence = {};
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: missingEvidence}), /exactly the declared evidence/u);

const missingFailureTree = yesAnswers();
missingFailureTree["G-CODE-QUALITY-ROOT"] = {answer: "NO", evidence: {}, failure: null, recheck: null};
assert.throws(() => evaluateGovernanceDecisionTree({tree, answers: missingFailureTree}), /failure tree and exact re-check/u);

const repairable = yesAnswers();
repairable["G-CODE-QUALITY-ROOT"] = {
  answer: "NO",
  evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-CODE-QUALITY-ROOT")),
  failure: {classification: "REPAIRABLE_ENGINEERING_PUZZLE", reason: "The focused check found one bounded implementation defect.", repair_path: "FEATURE_AGENT_REPAIR_AND_FOCUSED_CHECK", required_recheck_gate_id: "G-CODE-QUALITY-ROOT"},
  recheck: {gate_id: "G-CODE-QUALITY-ROOT", answer: "YES", evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-CODE-QUALITY-ROOT"))},
};
assert.equal(evaluateGovernanceDecisionTree({tree, answers: repairable}).status, "PASS");

const hardBlocker = yesAnswers();
hardBlocker["G-SECURITY-ROOT"] = {
  answer: "NO",
  evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-SECURITY-ROOT")),
  failure: {classification: "OWNER_OR_HARD_BLOCKER", reason: "The local adapter cannot prove the requested identity.", repair_path: "HOLD_AND_ESCALATE", required_recheck_gate_id: "G-SECURITY-ROOT"},
  recheck: {gate_id: "G-SECURITY-ROOT", answer: "YES", evidence: evidence(tree.gates.find((gate) => gate.gate_id === "G-SECURITY-ROOT"))},
};
assert.equal(evaluateGovernanceDecisionTree({tree, answers: hardBlocker}).status, "BLOCKED");

console.log("PASS executable four-root governance tree with real source-bound evidence and hostile generic/stale rejection");
`;

const AUDITOR_RECHECK_BRANCH = `} else if (role === "INDEPENDENT_AUDITOR") {
  artifactName = "auditor-observation.json";
  const initialProduct = {
    ...base,
    custody_status: "INDEPENDENT_AUDITOR_CUSTODY",
    audit_status: "INITIAL_AUDIT_READY",
    observation: "Inspect the actual Feature-Agent worktree and compare it with the exact candidate and gate evidence.",
  };
  if (taskKind === "GOVERNANCE_EVIDENCE_RECHECK") {
    assert(featureWorktree !== null && fs.existsSync(featureWorktree) && fs.statSync(featureWorktree).isDirectory(), "auditor Feature-Agent worktree is unavailable");
    assert(evidenceWorktree !== null && fs.existsSync(evidenceWorktree) && fs.statSync(evidenceWorktree).isDirectory(), "auditor evidence worktree is unavailable");
    assert(decisionTreePath !== null && fs.existsSync(decisionTreePath), "auditor decision tree is unavailable");
    const decisionTree = JSON.parse(fs.readFileSync(decisionTreePath, "utf8"));
    const evidencePlanPath = path.join(evidenceWorktree, "orchestrator-plan.json");
    assert(fs.existsSync(evidencePlanPath), "auditor orchestrator evidence plan is unavailable");
    const evidencePlan = JSON.parse(fs.readFileSync(evidencePlanPath, "utf8"));
    const {evaluateGovernanceDecisionTree} = await import(pathToFileURL(path.join(worktreePath, "control/governance-decision-tree.mjs")).href);
    const {controllerDigest} = await import(pathToFileURL(path.join(worktreePath, "control/agentos-controller.mjs")).href);
    const evaluation = evaluateGovernanceDecisionTree({tree: decisionTree, answers: evidencePlan.gate_answers});
    assert(evaluation.status === "PASS", "Auditor governance evidence re-check did not pass");
    assert(evidencePlan.gate_evaluation?.evaluation_sha256 === evaluation.evaluation_sha256, "Auditor observed a different governance evaluation");
    const auditedFeatureCommit = git(featureWorktree, ["rev-parse", "HEAD"]);
    const auditedFeatureTree = git(featureWorktree, ["rev-parse", "HEAD^{tree}"]);
    assert(auditedFeatureCommit === sourceCommit && auditedFeatureTree === sourceTree, "Auditor source differs from the repaired Feature-Agent checkpoint");
    assert(evidencePlan.source_commit === sourceCommit && evidencePlan.source_tree === sourceTree, "Auditor evidence plan source differs from the repaired checkpoint");
    const flattenedEvidence = {};
    for (const gate of decisionTree.gates) {
      const gateAnswer = evidencePlan.gate_answers?.[gate.gate_id];
      assert(gateAnswer?.answer === "YES", "Auditor evidence plan contains a non-YES gate answer");
      for (const key of gate.evidence_requirements) {
        const compositeKey = gate.gate_id + ":" + key;
        const record = evidencePlan.gate_evidence?.[compositeKey];
        assert(record && gateAnswer.evidence?.[key], "Auditor evidence plan is missing a declared gate record");
        assert(record.source_commit === sourceCommit && record.source_tree === sourceTree, "Auditor gate evidence source differs from the repaired checkpoint");
        assert(!record.check_id.includes("PLACEHOLDER") && !record.check_id.includes("}"), "Auditor accepted generic gate evidence");
        assert(controllerDigest(record) === controllerDigest(gateAnswer.evidence[key]), "Auditor gate evidence map differs from each gate answer");
        flattenedEvidence[compositeKey] = gateAnswer.evidence[key];
      }
    }
    assert(controllerDigest(flattenedEvidence) === controllerDigest(evidencePlan.gate_evidence), "Auditor gate evidence contains an undeclared or missing record");
    buildCommit = auditedFeatureCommit;
    buildTree = auditedFeatureTree;
    changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
    for (const requiredPath of ["control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs"]) assert(changedPaths.includes(requiredPath), "Auditor did not observe the complete Feature-Agent evidence repair");
    focusedChecks = runFocusedChecks(featureWorktree);
    buildStatus = "AUDIT_VERIFIED";
    product = {
      ...initialProduct,
      task_id: taskId,
      task_kind: taskKind,
      audit_status: "GOVERNANCE_EVIDENCE_VERIFIED",
      audited_feature_worktree: featureWorktree,
      audited_feature_commit: buildCommit,
      audited_feature_tree: buildTree,
      audited_feature_changed_paths: changedPaths,
      audited_feature_checks: focusedChecks,
      audited_gate_evidence: evidencePlan.gate_evidence,
      audited_gate_answers: evidencePlan.gate_answers,
      audited_gate_evaluation: evaluation,
      evidence_worktree: evidenceWorktree,
    };
  } else {
    product = initialProduct;
    if (featureWorktree !== null) {
      assert(fs.existsSync(featureWorktree) && fs.statSync(featureWorktree).isDirectory(), "auditor Feature-Agent worktree is unavailable");
      buildCommit = git(featureWorktree, ["rev-parse", "HEAD"]);
      buildTree = git(featureWorktree, ["rev-parse", "HEAD^{tree}"]);
      changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);
      assert(buildCommit !== sourceCommit && buildTree !== sourceTree, "Auditor did not observe a changed Feature-Agent checkpoint");
      assert(changedPaths.includes("control/governance-decision-tree.mjs"), "Auditor did not observe the required Feature-Agent code change");
      focusedChecks = runFocusedChecks(featureWorktree);
      buildStatus = "AUDIT_VERIFIED";
      product = {
        ...product,
        audit_status: "FEATURE_BUILD_VERIFIED",
        audited_feature_worktree: featureWorktree,
        audited_feature_commit: buildCommit,
        audited_feature_tree: buildTree,
        audited_feature_changed_paths: changedPaths,
        audited_feature_checks: focusedChecks,
      };
    }
  }
`;

export function applyGovernanceEvidenceRepair({worktreePath}) {
  const governancePath = path.join(worktreePath, "control/governance-decision-tree.mjs");
  const workerPath = path.join(worktreePath, "control/local-agent-worker.mjs");
  const testPath = path.join(worktreePath, "tests/verify-governance-decision-tree.mjs");
  assert(fs.existsSync(governancePath) && fs.existsSync(workerPath) && fs.existsSync(testPath), "Feature-Agent evidence repair source files are incomplete");

  let governance = fs.readFileSync(governancePath, "utf8");
  const oldEvidenceStart = "function validateEvidence(evidence, required, label) {";
  const oldEvidenceEnd = "\n}\n\nfunction inspectAnswer";
  const start = governance.indexOf(oldEvidenceStart);
  const end = governance.indexOf(oldEvidenceEnd, start);
  assert(start >= 0 && end > start, "Feature-Agent evidence validator source was not found");
  governance = governance.slice(0, start) + STRICT_EVIDENCE_VALIDATION + governance.slice(end + 2);
  governance = replaceOnce(governance, "validateEvidence(answer.evidence, gate.evidence_requirements, `${gate.gate_id} evidence`);", "validateEvidence(answer.evidence, gate.evidence_requirements, gate.gate_id + \" evidence\", answers._tree);", "YES evidence validation");
  governance = replaceOnce(governance, "validateEvidence(answer.recheck.evidence, recheckGate.evidence_requirements, `${gate.gate_id} re-check evidence`);", "validateEvidence(answer.recheck.evidence, recheckGate.evidence_requirements, gate.gate_id + \" re-check evidence\", answers._tree);", "re-check evidence validation");

  let worker = fs.readFileSync(workerPath, "utf8");
  worker = replaceOnce(worker, "const task = args.task;\n", "const task = args.task;\nconst taskId = args.task_id ?? \"INITIAL\";\nconst taskKind = args.task_kind ?? \"INITIAL\";\nconst evidenceWorktree = args.evidence_worktree ? path.resolve(args.evidence_worktree) : null;\n", "worker repair task context");
  worker = replaceOnce(worker, 'import {execFileSync} from "node:child_process";\n', 'import {execFileSync} from "node:child_process";\nimport {collectGovernanceGateEvidence} from "./governance-evidence.mjs";\n', "worker evidence import");
  worker = replaceOnce(worker, "const evidence = (gate) => Object.fromEntries(gate.evidence_requirements.map((key) => [key, `${gate.gate_id}:${key}`]));", "const gateEvidence = collectGovernanceGateEvidence({worktreePath, tree: decisionTree});\n  const evidence = (gate) => Object.fromEntries(gate.evidence_requirements.map((key) => [key, gateEvidence[gate.gate_id + \":\" + key]]));", "placeholder evidence branch");
  worker = replaceOnce(worker, "    gate_evaluation: gateEvaluation,", "    gate_evidence: gateEvidence,\n    gate_answers: gateAnswers,\n    gate_evaluation: gateEvaluation,", "gate evidence artifact");
  const initialAuditorBranch = `} else if (role === "INDEPENDENT_AUDITOR") {
  artifactName = "auditor-observation.json";
  product = {
    ...base,
    custody_status: "INDEPENDENT_AUDITOR_CUSTODY",
    audit_status: "INITIAL_AUDIT_READY",
    observation: "Inspect the actual Feature-Agent worktree and compare it with the exact candidate and gate evidence.",
  };
  if (featureWorktree !== null) {
    assert(fs.existsSync(featureWorktree) && fs.statSync(featureWorktree).isDirectory(), "auditor Feature-Agent worktree is unavailable");
    buildCommit = git(featureWorktree, ["rev-parse", "HEAD"]);
    buildTree = git(featureWorktree, ["rev-parse", "HEAD^{tree}"]);
    changedPaths = git(featureWorktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\\n").filter(Boolean);
    assert(buildCommit !== sourceCommit && buildTree !== sourceTree, "Auditor did not observe a changed Feature-Agent checkpoint");
    assert(changedPaths.includes("control/governance-decision-tree.mjs"), "Auditor did not observe the required Feature-Agent code change");
    focusedChecks = runFocusedChecks(featureWorktree);
    buildStatus = "AUDIT_VERIFIED";
    product = {
      ...product,
      audit_status: "FEATURE_BUILD_VERIFIED",
      audited_feature_worktree: featureWorktree,
      audited_feature_commit: buildCommit,
      audited_feature_tree: buildTree,
      audited_feature_changed_paths: changedPaths,
      audited_feature_checks: focusedChecks,
    };
  }
`;
  worker = replaceOnce(worker, initialAuditorBranch, AUDITOR_RECHECK_BRANCH, "auditor evidence re-check branch");

  writeFile(governancePath, governance);
  writeFile(workerPath, worker);
  writeFile(path.join(worktreePath, "control/governance-evidence.mjs"), GOVERNANCE_EVIDENCE_MODULE);
  writeFile(testPath, GOVERNANCE_TEST);
  return ["control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs"];
}
