import crypto from "node:crypto";

export const ROOTS = ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"];
export const DISPOSITIONS = [
  "YES_WITH_EVIDENCE",
  "NO",
  "UNKNOWN",
  "NOT_APPLICABLE_WITH_PROOF",
  "EXCEPTION_REQUESTED",
  "AUTHORIZED_EXCEPTION",
  "BLOCKED_AUTHORITY_BOUNDARY",
];
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
  YES_WITH_EVIDENCE: "EVALUATE_DEPENDENT_CHILDREN",
  NO: "CREATE_TARGETED_REPAIR_CONTINUE_UNRELATED",
  UNKNOWN: "ACQUIRE_EVIDENCE_AUTONOMOUSLY",
  NOT_APPLICABLE_WITH_PROOF: "PRESERVE_APPLICABILITY_PROOF",
  EXCEPTION_REQUESTED: "ROUTE_TO_NAMED_GRANTING_AUTHORITY",
  AUTHORIZED_EXCEPTION: "ENFORCE_SCOPE_CONTROL_EXPIRY_AND_REEVALUATION",
  BLOCKED_AUTHORITY_BOUNDARY: "PAUSE_AFFECTED_SCOPE_CONTINUE_UNRELATED",
};

const HEX64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID = /^[A-Z0-9][A-Z0-9._:-]*$/;
const FORBIDDEN_SCORE_KEYS = new Set(["confidence", "score", "weight", "mostly_compliant"]);
const EVIDENCE_FIELDS = [
  "evidence_id", "kind", "sha256", "commit_sha", "worktree_id",
  "build_identity", "environment_id", "observed_at_utc", "question_tree_version",
];
const EXCEPTION_FIELDS = [
  "granting_authority", "scope", "rationale", "compensating_control",
  "expires_at_utc", "reevaluation_trigger", "commit_sha", "build_identity",
  "environment_id", "authorization_sha256",
];

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
      Object.keys(value).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex");
}

function rejectScores(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_SCORE_KEYS.has(key.toLowerCase()), `${path}.${key} is a forbidden aggregate or confidence field`);
    rejectScores(child, `${path}.${key}`);
  }
}

function validateEvidence(item, version) {
  assert(item && typeof item === "object" && !Array.isArray(item), "evidence binding must be an object");
  for (const field of EVIDENCE_FIELDS) assert(nonempty(item[field]), `evidence.${field} is required`);
  assert(HEX64.test(item.sha256), "evidence.sha256 must be lowercase SHA-256");
  assert(UTC.test(item.observed_at_utc) && !Number.isNaN(Date.parse(item.observed_at_utc)), "evidence timestamp must be UTC");
  assert(item.question_tree_version === version, "evidence question-tree version mismatch");
}

function validateEvaluationBinding(binding, version) {
  assert(binding && typeof binding === "object" && !Array.isArray(binding), "evaluation binding is required");
  for (const field of [
    "commit_sha", "worktree_id", "build_identity", "environment_id",
    "question_tree_version",
  ]) assert(nonempty(binding[field]), `evaluation_binding.${field} is required`);
  assert(Array.isArray(binding.relevant_hashes) && binding.relevant_hashes.length > 0, "evaluation binding requires relevant hashes");
  assert(binding.relevant_hashes.every((digest) => HEX64.test(digest)), "evaluation binding hash is invalid");
  assert(binding.question_tree_version === version, "evaluation binding tree version mismatch");
}

function validateException(item, evaluationTime) {
  assert(item && typeof item === "object" && !Array.isArray(item), "authorized exception is required");
  for (const field of EXCEPTION_FIELDS) assert(nonempty(item[field]), `exception.${field} is required`);
  assert(HEX64.test(item.authorization_sha256), "exception authorization must be content-addressed");
  assert(UTC.test(item.expires_at_utc) && Date.parse(item.expires_at_utc) > Date.parse(evaluationTime), "exception is expired or malformed");
}

function validateQuestion(question, version, ids) {
  assert(question && typeof question === "object" && !Array.isArray(question), "question must be an object");
  for (const field of [
    "question_id", "root", "source_authority", "applicability", "question",
    "required_evidence", "allowed_answers", "branches", "repair_owner_role",
    "invalidation_conditions", "blocking_scope", "exception_policy",
  ]) assert(Object.hasOwn(question, field), `${question.question_id ?? "question"}.${field} is required`);
  assert(ID.test(question.question_id), "question_id is invalid");
  assert(!ids.has(question.question_id), `duplicate question ${question.question_id}`);
  ids.add(question.question_id);
  assert(ROOTS.includes(question.root), `${question.question_id} has invalid root`);
  const expectedPrefix = question.root === "FUNCTION_REQUIREMENTS" ? "FR-"
    : question.root === "DESIGN_BIBLE" ? "DB-" : "SEC-";
  assert(question.question_id.startsWith(expectedPrefix), `${question.question_id} does not match its root family`);
  assert(question.parent_question_id === null || ID.test(question.parent_question_id), `${question.question_id} parent is invalid`);
  assert(nonempty(question.question) && question.question.trim().endsWith("?"), `${question.question_id} must be an exact question`);
  assert(question.source_authority && nonempty(question.source_authority.authority_id), `${question.question_id} authority id is required`);
  assert(nonempty(question.source_authority.version), `${question.question_id} authority version is required`);
  assert(HEX64.test(question.source_authority.sha256), `${question.question_id} authority digest is invalid`);
  assert(question.applicability && ID.test(question.applicability.predicate_id), `${question.question_id} applicability predicate is invalid`);
  assert(nonempty(question.applicability.question) && question.applicability.question.endsWith("?"), `${question.question_id} applicability question is invalid`);
  assert(Array.isArray(question.required_evidence) && question.required_evidence.length > 0, `${question.question_id} requires evidence kinds`);
  assert(new Set(question.required_evidence).size === question.required_evidence.length, `${question.question_id} has duplicate evidence kinds`);
  assert(Array.isArray(question.allowed_answers) && question.allowed_answers.length > 0, `${question.question_id} allowed answers are required`);
  const expectedAnswers = question.exception_policy?.allowed
    ? DISPOSITIONS
    : DISPOSITIONS.filter((answer) => !["EXCEPTION_REQUESTED", "AUTHORIZED_EXCEPTION"].includes(answer));
  assert(canonicalJson(question.allowed_answers) === canonicalJson(expectedAnswers), `${question.question_id} allowed answers are not exact`);
  assert(question.branches && typeof question.branches === "object", `${question.question_id} branches are required`);
  assert(
    canonicalJson(question.branches)
      === canonicalJson(Object.fromEntries(expectedAnswers.map((answer) => [answer, BRANCHES[answer]]))),
    `${question.question_id} deterministic branches are not exact`,
  );
  assert(nonempty(question.repair_owner_role), `${question.question_id} repair owner is required`);
  assert(Array.isArray(question.invalidation_conditions) && question.invalidation_conditions.length > 0, `${question.question_id} invalidation conditions are required`);
  assert(new Set(question.invalidation_conditions).size === question.invalidation_conditions.length, `${question.question_id} invalidation conditions duplicate`);
  assert(nonempty(question.blocking_scope), `${question.question_id} blocking scope is required`);
  assert(typeof question.exception_policy?.allowed === "boolean", `${question.question_id} exception policy is invalid`);
  assert(Array.isArray(question.exception_policy.granting_authority_ids), `${question.question_id} exception authorities are required`);
  assert(new Set(question.exception_policy.granting_authority_ids).size === question.exception_policy.granting_authority_ids.length, `${question.question_id} exception authorities duplicate`);
  if (question.exception_policy.allowed) {
    assert(question.exception_policy.granting_authority_ids.length > 0, `${question.question_id} lacks an exception authority`);
    assert(question.exception_policy.granting_authority_ids.every(nonempty), `${question.question_id} exception authority is invalid`);
    assert(nonempty(question.exception_policy.scope), `${question.question_id} exception scope is required`);
  } else {
    assert(question.exception_policy.granting_authority_ids.length === 0 && question.exception_policy.scope === null, `${question.question_id} forbidden exception retains authority`);
  }
  assert(question.exception_policy.allowed || !question.allowed_answers.includes("AUTHORIZED_EXCEPTION"), `${question.question_id} forbids exceptions but allows authorization`);
  assert(version === "2.1rc", "unsupported question-tree version");
}

function assertAcyclic(questions) {
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  for (const question of questions) {
    if (question.parent_question_id !== null) {
      assert(byId.has(question.parent_question_id), `${question.question_id} parent is missing`);
      assert(byId.get(question.parent_question_id).root === question.root, `${question.question_id} parent crosses acceptance roots`);
    }
    const seen = new Set();
    let cursor = question;
    while (cursor.parent_question_id !== null) {
      assert(!seen.has(cursor.question_id), `cycle at ${cursor.question_id}`);
      seen.add(cursor.question_id);
      cursor = byId.get(cursor.parent_question_id);
    }
  }
}

export function validateQuestionTree(tree) {
  assert(tree?.schema === "governance.compiled_question_tree.v1", "question-tree schema mismatch");
  assert(tree.question_tree_version === "2.1rc", "question-tree version mismatch");
  assert(nonempty(tree.campaign_id), "campaign_id is required");
  assert(Array.isArray(tree.roots) && canonicalJson(tree.roots) === canonicalJson(ROOTS), "exact ordered acceptance roots are required");
  assert(tree.selection?.schema === "governance.question_slice_selection.v1", "question-slice selection is required");
  assert(Array.isArray(tree.selection.changed_surfaces) && tree.selection.changed_surfaces.length > 0, "changed surfaces are required");
  assert(tree.selection.changed_surfaces.every(nonempty), "changed surface is invalid");
  assert(new Set(tree.selection.changed_surfaces).size === tree.selection.changed_surfaces.length, "changed surfaces duplicate");
  assert(HEX64.test(tree.selection.change_manifest_sha256), "change manifest digest is invalid");
  assert(Array.isArray(tree.selection.selected_question_ids), "selected question IDs are required");
  assert(tree.selection.root_non_applicability && typeof tree.selection.root_non_applicability === "object", "root non-applicability map is required");
  assert(canonicalJson(Object.keys(tree.selection.root_non_applicability)) === canonicalJson(ROOTS), "root non-applicability keys are not exact");
  assert(Array.isArray(tree.questions), "questions are required");
  rejectScores(tree);
  const ids = new Set();
  for (const question of tree.questions) validateQuestion(question, tree.question_tree_version, ids);
  assertAcyclic(tree.questions);
  const selected = tree.questions.map((question) => question.question_id);
  assert(canonicalJson(tree.selection.selected_question_ids) === canonicalJson(selected), "selected question inventory mismatch");
  for (const root of ROOTS) {
    const hasQuestions = tree.questions.some((question) => question.root === root);
    const proof = tree.selection.root_non_applicability[root];
    if (hasQuestions) {
      assert(proof === null, `${root} cannot be active and non-applicable`);
    } else {
      assert(HEX64.test(proof), `${root} requires compact non-applicability proof`);
    }
  }
  return tree;
}

export function compileQuestionTree(input) {
  assert(input?.schema === "governance.question_tree_source_clauses.v1", "question source schema mismatch");
  assert(nonempty(input.campaign_id), "campaign_id is required");
  assert(input.question_tree_version === "2.1rc", "question-tree version mismatch");
  assert(input.change_manifest?.schema === "governance.changed_surface_manifest.v1", "changed-surface manifest is required");
  const {manifest_sha256: manifestSha, ...manifestBody} = input.change_manifest;
  assert(HEX64.test(manifestSha) && sha256(manifestBody) === manifestSha, "change manifest identity is invalid");
  assert(Array.isArray(input.change_manifest.changed_surfaces)
    && input.change_manifest.changed_surfaces.length > 0, "changed surfaces are required");
  assert(input.change_manifest.changed_surfaces.every(nonempty), "changed surface is invalid");
  assert(Array.isArray(input.change_manifest.changed_paths)
    && input.change_manifest.changed_paths.length > 0, "changed paths are required");
  assert(Array.isArray(input.clauses) && input.clauses.length > 0, "source clauses are required");
  const changed = new Set(input.change_manifest.changed_surfaces);
  const applicableClauses = input.clauses.filter((clause) => {
    assert(Array.isArray(clause.applies_to_surfaces) && clause.applies_to_surfaces.length > 0, "source clause surface triggers are required");
    return clause.applies_to_surfaces.includes("ALWAYS")
      || clause.applies_to_surfaces.some((surface) => changed.has(surface));
  });
  const questions = applicableClauses.map((clause) => {
    assert(clause?.materiality === "MATERIAL_PRODUCT_ACCEPTANCE", "nonmaterial clause cannot become a Product gate");
    assert(nonempty(clause.clause_id), "source clause ID is required");
    assert(nonempty(clause.atomic_question) && clause.atomic_question.endsWith("?"), "source clause must provide one atomic question");
    return {
      question_id: clause.question_id,
      root: clause.root,
      parent_question_id: clause.parent_question_id,
      source_authority: structuredClone(clause.source_authority),
      applicability: structuredClone(clause.applicability),
      question: clause.atomic_question,
      required_evidence: [...clause.required_evidence],
      allowed_answers: clause.exception_policy.allowed
        ? [...DISPOSITIONS]
        : DISPOSITIONS.filter((answer) => !["EXCEPTION_REQUESTED", "AUTHORIZED_EXCEPTION"].includes(answer)),
      branches: Object.fromEntries(
        (clause.exception_policy.allowed
          ? DISPOSITIONS
          : DISPOSITIONS.filter((answer) => !["EXCEPTION_REQUESTED", "AUTHORIZED_EXCEPTION"].includes(answer)))
          .map((answer) => [answer, BRANCHES[answer]]),
      ),
      repair_owner_role: clause.repair_owner_role,
      invalidation_conditions: [...clause.invalidation_conditions],
      blocking_scope: clause.blocking_scope,
      exception_policy: structuredClone(clause.exception_policy),
    };
  }).sort((a, b) => {
    const rootOrder = ROOTS.indexOf(a.root) - ROOTS.indexOf(b.root);
    return rootOrder || Buffer.from(a.question_id).compare(Buffer.from(b.question_id));
  });
  const tree = {
    schema: "governance.compiled_question_tree.v1",
    question_tree_version: input.question_tree_version,
    campaign_id: input.campaign_id,
    roots: [...ROOTS],
    questions,
    selection: {
      schema: "governance.question_slice_selection.v1",
      changed_surfaces: [...input.change_manifest.changed_surfaces],
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
  validateQuestionTree(tree);
  return tree;
}

export function evaluateQuestion(question, observation, version = "2.1rc") {
  assert(observation?.question_id === question.question_id, "observation question mismatch");
  assert(UTC.test(observation.evaluated_at_utc) && !Number.isNaN(Date.parse(observation.evaluated_at_utc)), "evaluation time is invalid");
  validateEvaluationBinding(observation.evaluation_binding, version);
  assert(typeof observation.applicable === "boolean", "applicability must be boolean");
  assert(Array.isArray(observation.applicability_evidence), "applicability evidence is required");
  for (const item of observation.applicability_evidence) validateEvidence(item, version);

  if (!observation.applicable) {
    assert(observation.applicability_evidence.length > 0, "N/A requires applicability proof");
    assert(observation.disposition === "NOT_APPLICABLE_WITH_PROOF", "inapplicable question must be N/A with proof");
    return { question_id: question.question_id, disposition: observation.disposition, action: "PRESERVE_PROOF", evaluation_binding: observation.evaluation_binding };
  }

  assert(question.allowed_answers.includes(observation.disposition), "disposition is not allowed for question");
  if (observation.disposition === "YES_WITH_EVIDENCE") {
    assert(Array.isArray(observation.evidence), "YES requires evidence");
    for (const item of observation.evidence) validateEvidence(item, version);
    const kinds = new Set(observation.evidence.map((item) => item.kind));
    for (const kind of question.required_evidence) assert(kinds.has(kind), `missing required evidence kind ${kind}`);
    return { question_id: question.question_id, disposition: observation.disposition, action: "EVALUATE_CHILDREN", evaluation_binding: observation.evaluation_binding };
  }
  if (observation.disposition === "NO") {
    assert(Array.isArray(observation.evidence) && observation.evidence.length > 0, "NO requires observed evidence");
    for (const item of observation.evidence) validateEvidence(item, version);
    return {
      question_id: question.question_id,
      disposition: observation.disposition,
      action: "TARGETED_REPAIR",
      repair_owner_role: question.repair_owner_role,
      blocking_scope: question.blocking_scope,
      evaluation_binding: observation.evaluation_binding,
    };
  }
  if (observation.disposition === "UNKNOWN") {
    assert(Array.isArray(observation.missing_evidence) && observation.missing_evidence.length > 0, "UNKNOWN must name missing evidence");
    assert(observation.missing_evidence.every(nonempty), "UNKNOWN missing-evidence entries are invalid");
    return { question_id: question.question_id, disposition: observation.disposition, action: "ACQUIRE_EVIDENCE_AUTONOMOUSLY", evaluation_binding: observation.evaluation_binding };
  }
  if (observation.disposition === "EXCEPTION_REQUESTED") {
    assert(question.exception_policy.allowed, "exception is forbidden for question");
    assert(observation.exception_request?.granting_authority
      && question.exception_policy.granting_authority_ids.includes(observation.exception_request.granting_authority),
    "exception request authority is not admitted");
    assert(observation.exception_request.scope === question.exception_policy.scope, "exception request scope mismatch");
    assert(nonempty(observation.exception_request.rationale), "exception request rationale is required");
    return { question_id: question.question_id, disposition: observation.disposition, action: "ROUTE_EXCEPTION_AUTHORITY", evaluation_binding: observation.evaluation_binding };
  }
  if (observation.disposition === "AUTHORIZED_EXCEPTION") {
    assert(question.exception_policy.allowed, "exception is forbidden for question");
    validateException(observation.authorized_exception, observation.evaluated_at_utc);
    assert(question.exception_policy.granting_authority_ids.includes(observation.authorized_exception.granting_authority), "exception granting authority is not admitted");
    assert(observation.authorized_exception.scope === question.exception_policy.scope, "exception scope mismatch");
    assert(observation.authorized_exception.commit_sha === observation.evaluation_binding.commit_sha, "exception commit scope mismatch");
    assert(observation.authorized_exception.build_identity === observation.evaluation_binding.build_identity, "exception build scope mismatch");
    assert(observation.authorized_exception.environment_id === observation.evaluation_binding.environment_id, "exception environment scope mismatch");
    return { question_id: question.question_id, disposition: observation.disposition, action: "PASS_WITH_SCOPED_EXCEPTION", evaluation_binding: observation.evaluation_binding };
  }
  if (observation.disposition === "BLOCKED_AUTHORITY_BOUNDARY") {
    assert(OWNER_BOUNDARIES.includes(observation.owner_boundary_class), "invalid owner boundary class");
    assert(nonempty(observation.authority_boundary_id), "authority boundary identity is required");
    assert(HEX64.test(observation.blocker_evidence_sha256), "owner blocker evidence is invalid");
    assert(nonempty(observation.smallest_owner_action), "smallest owner action is required");
    assert(Array.isArray(observation.attempted_safe_alternatives) && observation.attempted_safe_alternatives.length > 0, "safe alternatives are required");
    assert(nonempty(observation.unaffected_work), "unaffected work is required");
    return { question_id: question.question_id, disposition: observation.disposition, action: "PAUSE_AFFECTED_SCOPE_CONTINUE_UNRELATED", evaluation_binding: observation.evaluation_binding };
  }
  throw new Error("unhandled disposition");
}

export function compileAcceptance(tree, observations) {
  validateQuestionTree(tree);
  assert(Array.isArray(observations), "observations are required");
  const byQuestion = new Map();
  for (const observation of observations) {
    assert(!byQuestion.has(observation.question_id), `duplicate observation ${observation.question_id}`);
    const question = tree.questions.find((item) => item.question_id === observation.question_id);
    assert(question, `unknown observation ${observation.question_id}`);
    byQuestion.set(observation.question_id, evaluateQuestion(question, observation, tree.question_tree_version));
  }
  const questionsById = new Map(tree.questions.map((question) => [question.question_id, question]));
  for (const [questionId, result] of byQuestion) {
    const parentId = questionsById.get(questionId).parent_question_id;
    if (parentId !== null) {
      const parent = byQuestion.get(parentId);
      assert(parent, `${questionId} was evaluated before its parent`);
      assert(["YES_WITH_EVIDENCE", "AUTHORIZED_EXCEPTION"].includes(parent.disposition),
        `${questionId} was evaluated while its parent was not admitted`);
    }
  }
  const statuses = {};
  for (const root of ROOTS) {
    const results = tree.questions.filter((question) => question.root === root).map((question) => byQuestion.get(question.question_id));
    if (results.length === 0) {
      statuses[root] = "PASS";
    } else if (root === "DESIGN_BIBLE" && statuses.FUNCTION_REQUIREMENTS !== "PASS") {
      statuses[root] = "PENDING_ADMISSION";
    } else if (root === "SECURITY" && (statuses.FUNCTION_REQUIREMENTS !== "PASS" || statuses.DESIGN_BIBLE !== "PASS")) {
      statuses[root] = "PENDING_ADMISSION";
    } else if (results.some((result) => result?.disposition === "BLOCKED_AUTHORITY_BOUNDARY")) {
      statuses[root] = "BLOCKED";
    } else if (results.every((result) => ["YES_WITH_EVIDENCE", "NOT_APPLICABLE_WITH_PROOF", "AUTHORIZED_EXCEPTION"].includes(result?.disposition))) {
      statuses[root] = "PASS";
    } else {
      statuses[root] = "OPEN_REPAIR";
    }
  }
  return {
    schema: "governance.question_tree_acceptance.v1",
    campaign_id: tree.campaign_id,
    question_tree_sha256: sha256(tree),
    observations_sha256: sha256(observations),
    roots: statuses,
    RC_READY: ROOTS.every((root) => statuses[root] === "PASS"),
    OPEN_QUESTION_IDS: [...byQuestion.values()]
      .filter((result) => !["YES_WITH_EVIDENCE", "NOT_APPLICABLE_WITH_PROOF", "AUTHORIZED_EXCEPTION"].includes(result.disposition))
      .map((result) => result.question_id)
      .sort((a, b) => Buffer.from(a).compare(Buffer.from(b))),
    AUTHORIZED_EXCEPTION_IDS: [...byQuestion.values()]
      .filter((result) => result.disposition === "AUTHORIZED_EXCEPTION")
      .map((result) => result.question_id)
      .sort((a, b) => Buffer.from(a).compare(Buffer.from(b))),
    TRUE_OWNER_BLOCKERS: [...byQuestion.values()].filter((result) => result.disposition === "BLOCKED_AUTHORITY_BOUNDARY").map((result) => result.question_id),
  };
}

export function compileCriticalFreeze(finding) {
  assert(finding?.schema === "governance.critical_surface_finding.v1", "critical finding schema mismatch");
  assert(["SECURITY", "HUMAN_SAFETY"].includes(finding.domain), "critical finding domain is invalid");
  assert(finding.severity === "CRITICAL", "only a critical finding can freeze a surface");
  assert(nonempty(finding.finding_id) && HEX64.test(finding.evidence_sha256), "critical finding identity is invalid");
  assert(nonempty(finding.auditor_session_id) && HEX64.test(finding.auditor_roster_receipt_sha256), "critical freeze requires exact Auditor identity");
  assert(Array.isArray(finding.affected_surfaces) && finding.affected_surfaces.length > 0, "affected surfaces are required");
  assert(new Set(finding.affected_surfaces).size === finding.affected_surfaces.length, "affected surfaces duplicate");
  assert(typeof finding.global_impact === "boolean", "global impact must be explicit");
  if (finding.global_impact) {
    assert(HEX64.test(finding.global_impact_evidence_sha256), "global freeze requires exact global-impact evidence");
  } else {
    assert(!Object.hasOwn(finding, "global_impact_evidence_sha256"), "local freeze cannot carry global-impact authority");
  }
  return {
    action: finding.global_impact ? "FREEZE_ALL_PRODUCT_WRITES" : "FREEZE_AFFECTED_SURFACES_ONLY",
    affected_surfaces: finding.affected_surfaces,
    continue_unaffected_work: !finding.global_impact,
    finding_sha256: sha256(finding),
  };
}

export function compileRepairPacket(tree, observations) {
  const results = observations.map((observation) => {
    const question = tree.questions.find((item) => item.question_id === observation.question_id);
    assert(question, `unknown question ${observation.question_id}`);
    return { question, observation, result: evaluateQuestion(question, observation, tree.question_tree_version) };
  }).filter(({ result }) => ["TARGETED_REPAIR", "ACQUIRE_EVIDENCE_AUTONOMOUSLY"].includes(result.action));
  return results.map(({ question, observation, result }) => ({
    question_id: question.question_id,
    observed_evidence: observation.evidence ?? observation.applicability_evidence,
    disposition: result.disposition,
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
  assert(nonempty(observation.causal_root_id), "repair requires a causal root");
  assert(nonempty(observation.implementation_route_id), "repair requires an implementation route");
  const sameCause = priorRepairs.filter((repair) =>
    repair.question_id === observation.question_id
    && repair.causal_root_id === observation.causal_root_id);
  if (sameCause.length === 0) {
    return {
      action: result.action,
      question_id: observation.question_id,
      causal_root_id: observation.causal_root_id,
      implementation_route_id: observation.implementation_route_id,
      repair_owner_role: question.repair_owner_role,
      bounded_writable_scope: question.blocking_scope,
    };
  }
  const routeChanged = sameCause.every((repair) =>
    repair.implementation_route_id !== observation.implementation_route_id);
  const evidenceChanged = sameCause.every((repair) =>
    repair.evidence_state_sha256 !== observation.evidence_state_sha256);
  if (routeChanged || evidenceChanged) {
    assert(HEX64.test(observation.evidence_state_sha256), "changed repair evidence state must be content-addressed");
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
    supervisor_role: "GLOBAL_ORCHESTRATOR",
  };
}

export function compileEvidencePlan(tree, cacheEntries, current) {
  validateQuestionTree(tree);
  assert(Array.isArray(cacheEntries), "evidence cache entries are required");
  assert(current && typeof current === "object", "current evidence binding is required");
  assert(Array.isArray(current.invalidated_question_ids), "invalidated question IDs are required");
  assert(current.question_relevant_hashes && typeof current.question_relevant_hashes === "object", "current relevant hashes are required");
  assert(nonempty(current.build_identity) && nonempty(current.environment_id), "current build and environment are required");
  const invalid = new Set(current.invalidated_question_ids);
  const cacheByQuestion = new Map();
  for (const entry of cacheEntries) {
    assert(nonempty(entry.question_id) && !cacheByQuestion.has(entry.question_id), "evidence cache question is invalid or duplicate");
    assert(["YES_WITH_EVIDENCE", "NOT_APPLICABLE_WITH_PROOF", "AUTHORIZED_EXCEPTION"].includes(entry.disposition), "cache may retain only admitted answers");
    assert(HEX64.test(entry.result_sha256), "cached result is not content-addressed");
    assert(Array.isArray(entry.relevant_hashes) && entry.relevant_hashes.every((item) => HEX64.test(item)), "cached relevant hashes are invalid");
    assert(entry.question_tree_version === tree.question_tree_version, "cached question-tree version is stale");
    assert(["SOURCE_STABLE", "BUILD_ENVIRONMENT_BOUND"].includes(entry.reuse_scope), "cached reuse scope is invalid");
    assert(nonempty(entry.build_identity) && nonempty(entry.environment_id), "cached build or environment is missing");
    cacheByQuestion.set(entry.question_id, entry);
  }
  const reused = [];
  const acquire = [];
  for (const question of tree.questions) {
    const entry = cacheByQuestion.get(question.question_id);
    const currentHashes = current.question_relevant_hashes[question.question_id];
    assert(Array.isArray(currentHashes) && currentHashes.every((item) => HEX64.test(item)), `current relevant hashes missing for ${question.question_id}`);
    if (entry
        && !invalid.has(question.question_id)
        && canonicalJson(entry.relevant_hashes) === canonicalJson(currentHashes)
        && (entry.reuse_scope === "SOURCE_STABLE"
          || (entry.build_identity === current.build_identity
            && entry.environment_id === current.environment_id))) {
      reused.push(question.question_id);
    } else {
      acquire.push(question.question_id);
    }
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
  assert(Array.isArray(change.conditions) && change.conditions.length > 0, "change conditions are required");
  const invalid = new Set(
    tree.questions
      .filter((question) => question.invalidation_conditions.some((condition) => change.conditions.includes(condition)))
      .map((question) => question.question_id),
  );
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
    ? { ...result, disposition: "UNKNOWN", invalidated_by: change.change_id }
    : result);
}
