import crypto from "node:crypto";

export const ROOTS = ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"];
export const ANSWER_VALUES = ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "EXCEPTION_REQUESTED"];
export const LIFECYCLE_STATES = ["UNEVALUATED", "EVIDENCE_PENDING", "OPEN_REPAIR", "VERIFIED", "INVALIDATED"];
export const OWNER_BOUNDARIES = [
  "NEW_OR_INCREASED_UNAPPROVED_COST",
  "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE",
  "GOVERNED_STACK_OR_CONSTITUTIONAL_ARCHITECTURE_CHANGE",
  "REPOSITORY_AUTHORITY_TOPOLOGY_CHANGE",
  "DELETION_OF_ACCEPTED_OR_PROTECTED_WORK_OR_PRODUCTION_DATA",
  "UNRESOLVED_MATERIAL_PRODUCT_INTENT_CONTRADICTION",
  "OTHER_IRREVERSIBLE_ACTION_OUTSIDE_DELEGATED_AUTHORITY",
];

export const BRANCHES = {
  YES: "EVALUATE_DEPENDENT_CHILDREN",
  NO: "CREATE_TARGETED_REPAIR_CONTINUE_UNRELATED",
  UNKNOWN: "ACQUIRE_EVIDENCE_AUTONOMOUSLY",
  NOT_APPLICABLE: "PRESERVE_APPLICABILITY_PROOF",
  EXCEPTION_REQUESTED: "ROUTE_TO_NAMED_GRANTING_AUTHORITY",
};

const HEX64 = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ID = /^[A-Z0-9][A-Z0-9._:-]*$/u;
const EVIDENCE_FIELDS = [
  "evidence_id", "kind", "sha256", "commit_sha", "worktree_id",
  "build_identity", "environment_id", "observed_at_utc", "question_tree_version",
];
const EVALUATION_BINDING_FIELDS = [
  "commit_sha", "worktree_id", "relevant_hashes", "build_identity",
  "environment_id", "question_tree_version",
];
const EXCEPTION_FIELDS = [
  "granting_authority", "scope", "rationale", "compensating_control",
  "expires_at_utc", "reevaluation_trigger", "commit_sha", "build_identity",
  "environment_id", "authorization_sha256",
];
const ROOT_PREFIX = {
  FUNCTION_REQUIREMENTS: "FR-",
  DESIGN_BIBLE: "DB-",
  SECURITY: "SEC-",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value), "utf8")
    .digest("hex");
}

function exactKeys(value, expected, label, {allow = []} = {}) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const allowed = new Set([...expected, ...allow]);
  const actual = Object.keys(value);
  assert(actual.every((key) => allowed.has(key)), `${label} contains an unknown field`);
  assert(expected.every((key) => Object.hasOwn(value, key)), `${label} is missing a required field`);
}

function sortedUniqueStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every(nonempty), `${label} contains an empty value`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function requireString(value, label) {
  assert(nonempty(value), `${label} is required`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && HEX64.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be UTC`);
}

function validateEvidence(item, version) {
  exactKeys(item, EVIDENCE_FIELDS, "evidence binding");
  for (const field of EVIDENCE_FIELDS) requireString(item[field], `evidence.${field}`);
  requireSha(item.sha256, "evidence.sha256");
  requireUtc(item.observed_at_utc, "evidence.observed_at_utc");
  assert(item.question_tree_version === version, "evidence question-tree version mismatch");
}

function validateEvaluationBinding(binding, version) {
  exactKeys(binding, EVALUATION_BINDING_FIELDS, "evaluation binding");
  for (const field of ["commit_sha", "worktree_id", "build_identity", "environment_id", "question_tree_version"]) {
    requireString(binding[field], `evaluation_binding.${field}`);
  }
  sortedUniqueStrings(binding.relevant_hashes, "evaluation_binding.relevant_hashes");
  binding.relevant_hashes.forEach((value) => requireSha(value, "evaluation_binding.relevant_hashes"));
  assert(binding.question_tree_version === version, "evaluation binding tree version mismatch");
}

function validateException(exception, evaluatedAtUtc, question) {
  exactKeys(exception, EXCEPTION_FIELDS, "authorized exception");
  for (const field of EXCEPTION_FIELDS) requireString(exception[field], `exception.${field}`);
  requireSha(exception.authorization_sha256, "exception.authorization_sha256");
  requireUtc(exception.expires_at_utc, "exception.expires_at_utc");
  assert(Date.parse(exception.expires_at_utc) > Date.parse(evaluatedAtUtc), "exception is expired");
  assert(question.exception_policy.granting_authority_ids.includes(exception.granting_authority), "exception authority is not admitted");
  assert(exception.scope === question.exception_policy.scope, "exception scope mismatch");
}

function validateOwnerBlocker(blocker) {
  exactKeys(blocker, [
    "owner_boundary_class", "authority_boundary_id", "blocker_evidence_sha256",
    "smallest_owner_action", "attempted_safe_alternatives", "unaffected_work",
  ]);
  assert(OWNER_BOUNDARIES.includes(blocker.owner_boundary_class), "owner boundary class is invalid");
  requireString(blocker.authority_boundary_id, "owner boundary identity");
  requireSha(blocker.blocker_evidence_sha256, "owner blocker evidence");
  requireString(blocker.smallest_owner_action, "smallest owner action");
  sortedUniqueStrings(blocker.attempted_safe_alternatives, "owner safe alternatives");
  requireString(blocker.unaffected_work, "unaffected work");
}

function expectedAnswers(exceptionAllowed) {
  return exceptionAllowed ? [...ANSWER_VALUES] : ANSWER_VALUES.filter((value) => value !== "EXCEPTION_REQUESTED");
}

function validateQuestion(question, version, ids) {
  exactKeys(question, [
    "question_id", "root", "parent_question_id", "source_authority", "applicability",
    "question", "required_evidence", "allowed_answers", "branches", "repair_owner_role",
    "invalidation_conditions", "blocking_scope", "exception_policy",
  ], "question");
  assert(ID.test(question.question_id), "question ID is invalid");
  assert(!ids.has(question.question_id), `duplicate question ${question.question_id}`);
  ids.add(question.question_id);
  assert(ROOTS.includes(question.root), `${question.question_id} has invalid root`);
  assert(question.question_id.startsWith(ROOT_PREFIX[question.root]), `${question.question_id} does not match its root family`);
  assert(question.parent_question_id === null || ID.test(question.parent_question_id), `${question.question_id} parent is invalid`);
  requireString(question.question, `${question.question_id} question`);
  assert(question.question.trim().endsWith("?"), `${question.question_id} must be a question`);
  exactKeys(question.source_authority, ["authority_id", "version", "sha256"], `${question.question_id} source authority`);
  requireString(question.source_authority.authority_id, "source authority ID");
  requireString(question.source_authority.version, "source authority version");
  requireSha(question.source_authority.sha256, "source authority digest");
  exactKeys(question.applicability, ["predicate_id", "question"], `${question.question_id} applicability`);
  assert(ID.test(question.applicability.predicate_id), `${question.question_id} applicability ID is invalid`);
  requireString(question.applicability.question, `${question.question_id} applicability question`);
  assert(question.applicability.question.endsWith("?"), `${question.question_id} applicability must be a question`);
  sortedUniqueStrings(question.required_evidence, `${question.question_id} required evidence`);
  const allowedAnswers = expectedAnswers(question.exception_policy?.allowed === true);
  assert(canonicalJson(question.allowed_answers) === canonicalJson(allowedAnswers), `${question.question_id} allowed answers are not exact`);
  assert(canonicalJson(question.branches) === canonicalJson(Object.fromEntries(allowedAnswers.map((answer) => [answer, BRANCHES[answer]]))), `${question.question_id} branches are not exact`);
  requireString(question.repair_owner_role, `${question.question_id} repair owner`);
  sortedUniqueStrings(question.invalidation_conditions, `${question.question_id} invalidation conditions`);
  requireString(question.blocking_scope, `${question.question_id} blocking scope`);
  exactKeys(question.exception_policy, ["allowed", "granting_authority_ids", "scope"], `${question.question_id} exception policy`);
  assert(typeof question.exception_policy.allowed === "boolean", `${question.question_id} exception policy flag is invalid`);
  sortedUniqueStrings(question.exception_policy.granting_authority_ids, `${question.question_id} exception authorities`, {allowEmpty: !question.exception_policy.allowed});
  if (question.exception_policy.allowed) requireString(question.exception_policy.scope, `${question.question_id} exception scope`);
  else assert(question.exception_policy.scope === null, `${question.question_id} forbidden exception retains scope`);
  assert(version === "2.1rc", "unsupported question-tree version");
}

function assertAcyclic(questions) {
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  for (const question of questions) {
    if (question.parent_question_id === null) continue;
    assert(byId.has(question.parent_question_id), `${question.question_id} parent is missing`);
    assert(byId.get(question.parent_question_id).root === question.root, `${question.question_id} parent crosses acceptance roots`);
    const seen = new Set([question.question_id]);
    let cursor = question;
    while (cursor.parent_question_id !== null) {
      assert(!seen.has(cursor.parent_question_id), `question tree cycle at ${cursor.question_id}`);
      seen.add(cursor.parent_question_id);
      cursor = byId.get(cursor.parent_question_id);
      assert(cursor, "question tree parent is missing");
    }
  }
}

export function validateQuestionTree(tree) {
  assert(tree?.schema === "governance.compiled_question_tree.v1", "question-tree schema mismatch");
  assert(tree.question_tree_version === "2.1rc", "question-tree version mismatch");
  requireString(tree.campaign_id, "campaign ID");
  assert(canonicalJson(tree.roots) === canonicalJson(ROOTS), "ordered acceptance roots are not exact");
  exactKeys(tree.selection, ["schema", "changed_surfaces", "change_manifest_sha256", "selected_question_ids", "root_non_applicability"], "question slice selection");
  assert(tree.selection.schema === "governance.question_slice_selection.v1", "question-slice schema mismatch");
  sortedUniqueStrings(tree.selection.changed_surfaces, "changed surfaces");
  requireSha(tree.selection.change_manifest_sha256, "change manifest digest");
  sortedUniqueStrings(tree.selection.selected_question_ids, "selected question IDs", {allowEmpty: true});
  exactKeys(tree.selection.root_non_applicability, ROOTS, "root non-applicability map");
  assert(Array.isArray(tree.questions), "questions are required");
  const ids = new Set();
  tree.questions.forEach((question) => validateQuestion(question, tree.question_tree_version, ids));
  assertAcyclic(tree.questions);
  assert(canonicalJson(tree.selection.selected_question_ids) === canonicalJson(tree.questions.map((question) => question.question_id)), "selected question inventory mismatch");
  for (const root of ROOTS) {
    const active = tree.questions.some((question) => question.root === root);
    const proof = tree.selection.root_non_applicability[root];
    if (active) assert(proof === null, `${root} cannot be active and non-applicable`);
    else requireSha(proof, `${root} non-applicability proof`);
  }
  return tree;
}

export function compileQuestionTree(input) {
  assert(input?.schema === "governance.question_tree_source_clauses.v1", "question source schema mismatch");
  requireString(input.campaign_id, "campaign ID");
  assert(input.question_tree_version === "2.1rc", "question-tree version mismatch");
  assert(input.change_manifest?.schema === "governance.changed_surface_manifest.v1", "changed-surface manifest is required");
  const {manifest_sha256: manifestSha, ...manifestBody} = input.change_manifest;
  requireSha(manifestSha, "change manifest digest");
  assert(sha256(manifestBody) === manifestSha, "change manifest identity is invalid");
  sortedUniqueStrings(input.change_manifest.changed_surfaces, "changed surfaces");
  sortedUniqueStrings(input.change_manifest.changed_paths, "changed paths");
  assert(Array.isArray(input.clauses) && input.clauses.length > 0, "source clauses are required");
  const changed = new Set(input.change_manifest.changed_surfaces);
  const questions = input.clauses
    .filter((clause) => {
      sortedUniqueStrings(clause.applies_to_surfaces, "source clause surfaces");
      return clause.applies_to_surfaces.includes("ALWAYS") || clause.applies_to_surfaces.some((surface) => changed.has(surface));
    })
    .map((clause) => {
      assert(clause.materiality === "MATERIAL_PRODUCT_ACCEPTANCE", "nonmaterial clause cannot become an acceptance question");
      requireString(clause.clause_id, "source clause ID");
      requireString(clause.atomic_question, "source clause question");
      assert(clause.atomic_question.endsWith("?"), "source clause must be an exact question");
      const answers = expectedAnswers(clause.exception_policy?.allowed === true);
      return {
        question_id: clause.question_id,
        root: clause.root,
        parent_question_id: clause.parent_question_id,
        source_authority: structuredClone(clause.source_authority),
        applicability: structuredClone(clause.applicability),
        question: clause.atomic_question,
        required_evidence: [...clause.required_evidence],
        allowed_answers: answers,
        branches: Object.fromEntries(answers.map((answer) => [answer, BRANCHES[answer]])),
        repair_owner_role: clause.repair_owner_role,
        invalidation_conditions: [...clause.invalidation_conditions],
        blocking_scope: clause.blocking_scope,
        exception_policy: structuredClone(clause.exception_policy),
      };
    })
    .sort((left, right) => ROOTS.indexOf(left.root) - ROOTS.indexOf(right.root)
      || Buffer.from(left.question_id).compare(Buffer.from(right.question_id)));
  const tree = {
    schema: "governance.compiled_question_tree.v1",
    question_tree_version: input.question_tree_version,
    campaign_id: input.campaign_id,
    roots: [...ROOTS],
    questions,
    selection: {
      schema: "governance.question_slice_selection.v1",
      changed_surfaces: [...input.change_manifest.changed_surfaces].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
      change_manifest_sha256: manifestSha,
      selected_question_ids: questions.map((question) => question.question_id),
      root_non_applicability: Object.fromEntries(ROOTS.map((root) => [
        root,
        questions.some((question) => question.root === root)
          ? null
          : sha256({
            root,
            change_manifest_sha256: manifestSha,
            changed_surfaces: input.change_manifest.changed_surfaces,
            admitted_clause_library_sha256: sha256(input.clauses),
          }),
      ])),
    },
  };
  return validateQuestionTree(tree);
}

function resultIsVerified(result) {
  return result.lifecycle === "VERIFIED"
    && ["YES", "NOT_APPLICABLE", "EXCEPTION_REQUESTED"].includes(result.answer);
}

function evaluateQuestionInternal(question, observation, version) {
  exactKeys(observation, ["question_id", "answer", "lifecycle", "applicable", "applicability_evidence", "evaluated_at_utc", "evaluation_binding"], "question observation", {
    allow: ["evidence", "missing_evidence", "exception_request", "authorized_exception", "owner_blocker", "invalidated_by", "causal_root_id", "implementation_route_id", "evidence_state_sha256"],
  });
  assert(observation.question_id === question.question_id, "observation question mismatch");
  assert(ANSWER_VALUES.includes(observation.answer), "question answer is invalid");
  assert(LIFECYCLE_STATES.includes(observation.lifecycle), "question lifecycle is invalid");
  requireUtc(observation.evaluated_at_utc, "evaluation time");
  validateEvaluationBinding(observation.evaluation_binding, version);
  assert(typeof observation.applicable === "boolean", "applicability must be explicit");
  assert(Array.isArray(observation.applicability_evidence), "applicability evidence is required");
  observation.applicability_evidence.forEach((item) => validateEvidence(item, version));

  if (observation.lifecycle === "INVALIDATED") {
    requireString(observation.invalidated_by, "invalidated_by");
    return {question_id: question.question_id, answer: observation.answer, lifecycle: "INVALIDATED", action: "INVALIDATED", evaluation_binding: observation.evaluation_binding};
  }

  if (!observation.applicable) {
    assert(observation.answer === "NOT_APPLICABLE", "inapplicable question must answer NOT_APPLICABLE");
    assert(observation.applicability_evidence.length > 0, "NOT_APPLICABLE requires applicability evidence");
    assert(observation.lifecycle === "VERIFIED", "NOT_APPLICABLE must be VERIFIED");
    return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "PRESERVE_APPLICABILITY_PROOF", evaluation_binding: observation.evaluation_binding};
  }

  assert(question.allowed_answers.includes(observation.answer), "question answer is not allowed");
  assert(observation.applicability_evidence.length > 0, "applicable question requires applicability evidence");
  if (observation.answer === "YES") {
    assert(observation.lifecycle === "VERIFIED", "YES must be VERIFIED");
    assert(Array.isArray(observation.evidence), "YES requires evidence");
    observation.evidence.forEach((item) => validateEvidence(item, version));
    const kinds = new Set(observation.evidence.map((item) => item.kind));
    question.required_evidence.forEach((kind) => assert(kinds.has(kind), `missing required evidence kind ${kind}`));
    return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "EVALUATE_DEPENDENT_CHILDREN", evaluation_binding: observation.evaluation_binding};
  }
  if (observation.answer === "NO") {
    assert(observation.lifecycle === "OPEN_REPAIR", "NO must be OPEN_REPAIR");
    assert(Array.isArray(observation.evidence) && observation.evidence.length > 0, "NO requires observed evidence");
    observation.evidence.forEach((item) => validateEvidence(item, version));
    if (observation.owner_blocker) {
      validateOwnerBlocker(observation.owner_blocker);
      return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "PAUSE_AFFECTED_SCOPE_CONTINUE_UNRELATED", owner_blocker: true, evaluation_binding: observation.evaluation_binding};
    }
    return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "TARGETED_REPAIR", repair_owner_role: question.repair_owner_role, blocking_scope: question.blocking_scope, evaluation_binding: observation.evaluation_binding};
  }
  if (observation.answer === "UNKNOWN") {
    assert(observation.lifecycle === "EVIDENCE_PENDING" || observation.lifecycle === "OPEN_REPAIR", "UNKNOWN must be EVIDENCE_PENDING or OPEN_REPAIR");
    assert(Array.isArray(observation.missing_evidence) && observation.missing_evidence.length > 0, "UNKNOWN must name missing evidence");
    sortedUniqueStrings(observation.missing_evidence, "missing evidence");
    if (observation.owner_blocker) {
      validateOwnerBlocker(observation.owner_blocker);
      return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "PAUSE_AFFECTED_SCOPE_CONTINUE_UNRELATED", owner_blocker: true, evaluation_binding: observation.evaluation_binding};
    }
    return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "ACQUIRE_EVIDENCE_AUTONOMOUSLY", evaluation_binding: observation.evaluation_binding};
  }
  assert(question.exception_policy.allowed, "exception is not allowed for this question");
  if (observation.authorized_exception) {
    assert(observation.lifecycle === "VERIFIED", "authorized exception must be VERIFIED");
    validateException(observation.authorized_exception, observation.evaluated_at_utc, question);
    assert(observation.authorized_exception.commit_sha === observation.evaluation_binding.commit_sha, "exception commit scope mismatch");
    assert(observation.authorized_exception.build_identity === observation.evaluation_binding.build_identity, "exception build scope mismatch");
    assert(observation.authorized_exception.environment_id === observation.evaluation_binding.environment_id, "exception environment scope mismatch");
    return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "PASS_WITH_SCOPED_EXCEPTION", evaluation_binding: observation.evaluation_binding};
  }
  assert(observation.lifecycle === "OPEN_REPAIR", "exception request without authorization must be OPEN_REPAIR");
  exactKeys(observation.exception_request, ["granting_authority", "scope", "rationale"], "exception request");
  assert(question.exception_policy.granting_authority_ids.includes(observation.exception_request.granting_authority), "exception request authority is not admitted");
  assert(observation.exception_request.scope === question.exception_policy.scope, "exception request scope mismatch");
  requireString(observation.exception_request.rationale, "exception request rationale");
  return {question_id: question.question_id, answer: observation.answer, lifecycle: observation.lifecycle, action: "ROUTE_TO_NAMED_GRANTING_AUTHORITY", evaluation_binding: observation.evaluation_binding};
}

export function evaluateQuestion(question, observation, version = "2.1rc") {
  return evaluateQuestionInternal(question, observation, version);
}

function rootStatus(results) {
  if (results.length === 0) return "PASS";
  if (results.every(resultIsVerified)) return "PASS";
  if (results.some((result) => result.lifecycle === "OPEN_REPAIR")) return "OPEN_REPAIR";
  return "UNKNOWN";
}

export function compileAcceptance(tree, observations) {
  validateQuestionTree(tree);
  assert(Array.isArray(observations), "observations are required");
  assert(observations.length === tree.questions.length, "every selected question needs one current observation");
  const byQuestion = new Map();
  for (const observation of observations) {
    assert(!byQuestion.has(observation.question_id), `duplicate observation ${observation.question_id}`);
    const question = tree.questions.find((item) => item.question_id === observation.question_id);
    assert(question, `unknown observation ${observation.question_id}`);
    byQuestion.set(observation.question_id, evaluateQuestion(question, observation, tree.question_tree_version));
  }
  assert(byQuestion.size === tree.questions.length, "observation inventory does not match the selected slice");
  const questionsById = new Map(tree.questions.map((question) => [question.question_id, question]));
  for (const [questionId, result] of byQuestion) {
    const parentId = questionsById.get(questionId).parent_question_id;
    if (parentId !== null) {
      const parent = byQuestion.get(parentId);
      assert(parent, `${questionId} parent was not evaluated`);
      assert(resultIsVerified(parent), `${questionId} was evaluated before its parent was admitted`);
    }
  }
  const rawRoots = Object.fromEntries(ROOTS.map((root) => [root, rootStatus(
    tree.questions.filter((question) => question.root === root).map((question) => byQuestion.get(question.question_id)),
  )]));
  const roots = {
    FUNCTION_REQUIREMENTS: rawRoots.FUNCTION_REQUIREMENTS,
    DESIGN_BIBLE: rawRoots.FUNCTION_REQUIREMENTS === "PASS" ? rawRoots.DESIGN_BIBLE : "UNKNOWN",
    SECURITY: rawRoots.FUNCTION_REQUIREMENTS === "PASS" && rawRoots.DESIGN_BIBLE === "PASS" ? rawRoots.SECURITY : "UNKNOWN",
  };
  const results = [...byQuestion.values()];
  return {
    schema: "governance.question_tree_acceptance.v1",
    campaign_id: tree.campaign_id,
    question_tree_sha256: sha256(tree),
    observations_sha256: sha256(observations),
    question_states: results.map((result) => ({question_id: result.question_id, answer: result.answer, lifecycle: result.lifecycle})).sort((left, right) => Buffer.from(left.question_id).compare(Buffer.from(right.question_id))),
    roots,
    RC_READY: ROOTS.every((root) => roots[root] === "PASS"),
    OPEN_QUESTION_IDS: results.filter((result) => result.lifecycle !== "VERIFIED").map((result) => result.question_id).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    AUTHORIZED_EXCEPTION_IDS: results.filter((result) => result.answer === "EXCEPTION_REQUESTED" && result.lifecycle === "VERIFIED").map((result) => result.question_id).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    TRUE_OWNER_BLOCKERS: results.filter((result) => result.owner_blocker === true).map((result) => result.question_id),
  };
}

export function compileCriticalFreeze(finding) {
  assert(finding?.schema === "governance.critical_surface_finding.v1", "critical finding schema mismatch");
  assert(["SECURITY", "HUMAN_SAFETY"].includes(finding.domain), "critical finding domain is invalid");
  assert(finding.severity === "CRITICAL", "only critical findings can freeze a surface");
  requireString(finding.finding_id, "critical finding ID");
  requireSha(finding.evidence_sha256, "critical finding evidence");
  requireString(finding.auditor_session_id, "critical finding Auditor session");
  requireSha(finding.auditor_roster_receipt_sha256, "critical finding Auditor roster");
  sortedUniqueStrings(finding.affected_surfaces, "critical affected surfaces");
  assert(typeof finding.global_impact === "boolean", "critical global impact must be explicit");
  if (finding.global_impact) requireSha(finding.global_impact_evidence_sha256, "critical global-impact evidence");
  else assert(!Object.hasOwn(finding, "global_impact_evidence_sha256"), "local freeze cannot carry global-impact evidence");
  return {
    action: finding.global_impact ? "FREEZE_ALL_PRODUCT_WRITES" : "FREEZE_AFFECTED_SURFACES_ONLY",
    affected_surfaces: finding.affected_surfaces,
    continue_unaffected_work: !finding.global_impact,
    finding_sha256: sha256(finding),
  };
}

export function compileRepairPacket(tree, observations) {
  validateQuestionTree(tree);
  assert(Array.isArray(observations), "observations are required");
  return observations.map((observation) => {
    const question = tree.questions.find((item) => item.question_id === observation.question_id);
    assert(question, `unknown question ${observation.question_id}`);
    const result = evaluateQuestion(question, observation, tree.question_tree_version);
    return {question, observation, result};
  }).filter(({result}) => ["TARGETED_REPAIR", "ACQUIRE_EVIDENCE_AUTONOMOUSLY", "ROUTE_TO_NAMED_GRANTING_AUTHORITY"].includes(result.action))
    .map(({question, observation, result}) => ({
      question_id: question.question_id,
      answer: result.answer,
      lifecycle: result.lifecycle,
      observed_evidence: observation.evidence ?? observation.applicability_evidence,
      bounded_writable_scope: question.blocking_scope,
      repair_owner_role: question.repair_owner_role,
      required_evidence_for_pass: question.required_evidence,
    }));
}

export function compileRepairDecision(tree, observation, priorRepairs) {
  assert(Array.isArray(priorRepairs), "prior repair history is required");
  const question = tree.questions.find((item) => item.question_id === observation.question_id);
  assert(question, `unknown question ${observation.question_id}`);
  const result = evaluateQuestion(question, observation, tree.question_tree_version);
  assert(["TARGETED_REPAIR", "ACQUIRE_EVIDENCE_AUTONOMOUSLY"].includes(result.action), "only NO or UNKNOWN creates repair work");
  requireString(observation.causal_root_id, "repair causal root");
  requireString(observation.implementation_route_id, "repair implementation route");
  const sameCause = priorRepairs.filter((repair) => repair.question_id === observation.question_id && repair.causal_root_id === observation.causal_root_id);
  if (sameCause.length === 0) return {
    action: result.action,
    question_id: observation.question_id,
    causal_root_id: observation.causal_root_id,
    implementation_route_id: observation.implementation_route_id,
    repair_owner_role: question.repair_owner_role,
    bounded_writable_scope: question.blocking_scope,
  };
  const routeChanged = sameCause.every((repair) => repair.implementation_route_id !== observation.implementation_route_id);
  const evidenceChanged = sameCause.every((repair) => repair.evidence_state_sha256 !== observation.evidence_state_sha256);
  if (routeChanged || evidenceChanged) {
    requireSha(observation.evidence_state_sha256, "changed repair evidence state");
    return {
      action: "EXECUTE_MATERIALLY_DIFFERENT_REPAIR",
      question_id: observation.question_id,
      causal_root_id: observation.causal_root_id,
      implementation_route_id: observation.implementation_route_id,
      repair_owner_role: question.repair_owner_role,
      bounded_writable_scope: question.blocking_scope,
    };
  }
  return {
    action: "DIRECT_SUPERVISOR_ONE_REFRAME_NO_EQUIVALENT_RETRY",
    question_id: observation.question_id,
    causal_root_id: observation.causal_root_id,
    supervisor_role: "CAMPAIGN_ORCHESTRATOR",
  };
}

export function compileEvidencePlan(tree, cacheEntries, current) {
  validateQuestionTree(tree);
  assert(Array.isArray(cacheEntries), "evidence cache entries are required");
  exactKeys(current, ["invalidated_question_ids", "question_relevant_hashes", "build_identity", "environment_id"], "current evidence binding");
  sortedUniqueStrings(current.invalidated_question_ids, "invalidated question IDs", {allowEmpty: true});
  requireString(current.build_identity, "current build identity");
  requireString(current.environment_id, "current environment identity");
  const invalidated = new Set(current.invalidated_question_ids);
  const cacheByQuestion = new Map();
  for (const entry of cacheEntries) {
    exactKeys(entry, ["question_id", "answer", "lifecycle", "result_sha256", "relevant_hashes", "question_tree_version", "reuse_scope", "build_identity", "environment_id"], "evidence cache entry");
    requireString(entry.question_id, "cached question ID");
    assert(!cacheByQuestion.has(entry.question_id), "duplicate evidence cache question");
    assert(ANSWER_VALUES.includes(entry.answer) && entry.lifecycle === "VERIFIED", "cache may retain only verified answers");
    requireSha(entry.result_sha256, "cached result");
    sortedUniqueStrings(entry.relevant_hashes, "cached relevant hashes");
    entry.relevant_hashes.forEach((value) => requireSha(value, "cached relevant hash"));
    assert(entry.question_tree_version === tree.question_tree_version, "cached question-tree version is stale");
    assert(["SOURCE_STABLE", "BUILD_ENVIRONMENT_BOUND"].includes(entry.reuse_scope), "cached reuse scope is invalid");
    requireString(entry.build_identity, "cached build identity");
    requireString(entry.environment_id, "cached environment identity");
    cacheByQuestion.set(entry.question_id, entry);
  }
  const reused = [];
  const acquire = [];
  for (const question of tree.questions) {
    const entry = cacheByQuestion.get(question.question_id);
    const currentHashes = current.question_relevant_hashes?.[question.question_id];
    assert(Array.isArray(currentHashes) && currentHashes.length > 0, `current relevant hashes missing for ${question.question_id}`);
    currentHashes.forEach((value) => requireSha(value, "current relevant hash"));
    if (entry && !invalidated.has(question.question_id)
      && canonicalJson(entry.relevant_hashes) === canonicalJson(currentHashes)
      && (entry.reuse_scope === "SOURCE_STABLE" || (entry.build_identity === current.build_identity && entry.environment_id === current.environment_id))) reused.push(question.question_id);
    else acquire.push(question.question_id);
  }
  return {
    schema: "governance.question_evidence_plan.v1",
    question_tree_sha256: sha256(tree),
    evidence_cache_sha256: sha256(cacheEntries),
    reused_question_ids: reused,
    acquire_question_ids: acquire,
    reused_count: reused.length,
    new_evidence_count: acquire.length,
  };
}

export function invalidateQuestions(tree, acceptedResults, change) {
  validateQuestionTree(tree);
  assert(Array.isArray(acceptedResults), "accepted results are required");
  sortedUniqueStrings(change?.conditions, "invalidation conditions");
  requireString(change.change_id, "invalidation change ID");
  const invalid = new Set(tree.questions.filter((question) => question.invalidation_conditions.some((condition) => change.conditions.includes(condition))).map((question) => question.question_id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const question of tree.questions) {
      if (question.parent_question_id && invalid.has(question.parent_question_id) && !invalid.has(question.question_id)) {
        invalid.add(question.question_id);
        grew = true;
      }
    }
  }
  return acceptedResults.map((result) => invalid.has(result.question_id)
    ? {...result, lifecycle: "INVALIDATED", invalidated_by: change.change_id}
    : result);
}
