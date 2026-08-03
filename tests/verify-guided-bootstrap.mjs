#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyGuidedAnswer,
  allocatePortableFeatureExtension,
  completeGuidedBootstrapExit,
  compileChatGptExchange,
  compileFirstAuditActivation,
  compilePortableArticleNumbering,
  computePortableContentSha256,
  confirmGuidedBootstrapLaunch,
  createGuidedBootstrapState,
  importChatGptResponse,
  nextGuidedQuestion,
  recordPhaseOutput,
  recordFirstAuditActivation,
  recordFirstAuditWorking,
  renderChatGptExchangeMarkdown,
  resolveModelRule,
  sealGuidedBootstrap,
  validateChatGptResponse,
  validateGuidedBootstrapState,
  verifyGuidedImportSource,
} from "../control/guided-bootstrap.mjs";

const failures = [];
let hostiles = 0;

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(utf8Compare).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function expectRejected(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostiles += 1;
  }
}

function answer(questionId, value, minute, status = "USER_CONFIRMED", facts = []) {
  const body = {
    question_id: questionId,
    value,
    status,
    answered_by: "owner",
    answered_at: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
    discovery_fact_ids: facts,
    rationale: "Owner confirmed after reviewing the discovery and consequences.",
  };
  return {...body, answer_sha256: digest(body)};
}

const projectRoot = fs.realpathSync(process.cwd());
const fixturePaths = {
  INDEX: "bootstrap/start-here.md",
  CONTEXT: "governance/2.1rc/portable-kernel.md",
  MAPPING: "schemas/kernel.v1.json",
  VERIFICATION: "schemas/capability-and-worktree-registry.v1.json",
};
const fixtureArtifactFiles = Object.entries(fixturePaths).map(([role, filePath]) => {
  const bytes = fs.readFileSync(path.join(projectRoot, filePath));
  return {
    role,
    path: filePath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
});
const fixtureRoleDigests = Object.fromEntries(
  fixtureArtifactFiles.map((entry) => [entry.role, entry.sha256]),
);

function phaseOutput(phase) {
  const source = phase === "AUTHORITY_CORPUS"
    ? values["authority_corpus.source"]
    : phase === "DESIGN_BIBLE"
      ? values["design.source"]
      : null;
  return {
    phase,
    operation: phase === "FOUNDATION"
      ? "CREATE_OR_ALIGN_PROJECT_CONFIGURATION"
      : phase === "AUTHORITY_CORPUS"
        ? "CREATE_NEW"
        : phase === "DESIGN_BIBLE"
          ? "CREATE_NEW"
          : "CREATE_OR_ALIGN_FEATURE_INTENT",
    source_identity: source === null
      ? "owner-confirmed-guided-bootstrap"
      : `sha256:${digest(source)}`,
    artifact_root: ".",
    identity_kind: "LOCAL_CONTENT",
    repository: null,
    commit: null,
    tree: null,
    index_sha256: fixtureRoleDigests.INDEX,
    context_sha256: fixtureRoleDigests.CONTEXT,
    mapping_sha256: fixtureRoleDigests.MAPPING,
    artifact_files: fixtureArtifactFiles,
    local_content_sha256: digest(fixtureArtifactFiles),
    verification_sha256: digest({
      identity_kind: "LOCAL_CONTENT",
      repository: null,
      commit: null,
      tree: null,
      artifact_files: fixtureArtifactFiles,
      local_content_sha256: digest(fixtureArtifactFiles),
    }),
    status: "VERIFIED",
    writer_session_id: "bootstrap-session-001",
    unavailable_reason: null,
  };
}

const modelRules = [
  {
    rule_id: "feature-map-backend",
    scope: "EXACT_FEATURE_AND_ROLE",
    match: {feature: "map", role: "backend"},
    model: "model-strong",
    reasoning: "high",
    cost_mode: "RECOMMENDED",
    economics: {
      estimated_success_probability: 0.95,
      estimated_attempts: 1.05,
      relative_unit_cost: 5,
      expected_completion_cost: 5.25,
      value_rationale: "Strong enough for coordination with low expected rework.",
    },
    source: "HOST_AND_EXTERNAL_COMPARISON",
    source_observed_at: "2026-01-01T00:00:00.000Z",
    source_digest_sha256: "a".repeat(64),
  },
  {
    rule_id: "role-backend",
    scope: "ROLE",
    match: {role: "backend"},
    model: "model-balanced",
    reasoning: "medium",
    cost_mode: "ECO",
    economics: {
      estimated_success_probability: 0.85,
      estimated_attempts: 1.18,
      relative_unit_cost: 2,
      expected_completion_cost: 2.36,
      value_rationale: "High-value role model near the reliability/cost knee.",
    },
    source: "HOST_AND_EXTERNAL_COMPARISON",
    source_observed_at: "2026-01-01T00:00:00.000Z",
    source_digest_sha256: "b".repeat(64),
  },
  {
    rule_id: "global-default",
    scope: "GLOBAL_DEFAULT",
    match: {},
    model: "model-economical",
    reasoning: "medium",
    cost_mode: "ECO",
    economics: {
      estimated_success_probability: 0.75,
      estimated_attempts: 1.33,
      relative_unit_cost: 1,
      expected_completion_cost: 1.33,
      value_rationale: "Light high-reasoning default for bounded builder work.",
    },
    source: "HOST_AND_EXTERNAL_COMPARISON",
    source_observed_at: "2026-01-01T00:00:00.000Z",
    source_digest_sha256: "c".repeat(64),
  },
];

const values = {
  "setup.interaction_mode": "CHATGPT_GUIDED",
  "project.name": "Example Project",
  "project.outcome": "Help a defined user complete a repeated workflow.",
  "project.users": ["operator", "administrator"],
  "project.non_goals": ["unsupported physical control"],
  "project.lifecycle": "NEW",
  "repositories.topology": "SINGLE_REPOSITORY",
  "project.sensitivity": ["account-private data"],
  "providers.capability_map": [
    {
      capability: "source_control",
      environment: "project",
      provider: "provider-a",
      account_label: "primary",
      auth_method: "provider CLI or browser selected by owner",
      auth_status: "IDENTITY_AND_PERMISSION_VERIFIED",
      permission_status: "VERIFIED",
    },
    {
      capability: "hosting",
      environment: "production",
      provider: "provider-b",
      account_label: "production",
      auth_method: "provider-defined interactive login",
      auth_status: "NOT_CONFIGURED",
      permission_status: "NOT_CHECKED",
    },
  ],
  "deployment.policy": {
    deployment_enabled: true,
    environments: ["development", "production"],
    merge_strategy: "single cumulative campaign root merged at milestone",
    release_strategy: "content-addressed milestone release",
    promotion_authority: "owner-selected Runtime policy",
    rollback_strategy: "previous accepted artifact",
    spend_policy: "ask before unexpected paid resources",
  },
  "testing.interactive_browser": "USER_SELECTED_BROWSER",
  "testing.browser_automation": "USER_SELECTED_AUTOMATION",
  "testing.authentication": [
    {
      actor: "builder",
      environment: "development",
      auth_route: "project-defined non-browser test identity",
      credential_handling: "runtime-only",
      unavailable_behavior: "skip authenticated claim",
    },
    {
      actor: "auditor",
      environment: "production",
      auth_route: "owner-selected test identity",
      credential_handling: "runtime-only",
      unavailable_behavior: "report authentication blocker",
    },
    {
      actor: "runtime",
      environment: "production",
      auth_route: "provider-specific login",
      credential_handling: "runtime-only",
      unavailable_behavior: "suspend deployment goal",
    },
  ],
  "security.acceptance_baselines": {
    standards: [
      {
        standard_id: "WEB_APPLICATION_SECURITY",
        version: "OWNER_SELECTED_CURRENT_VERSION",
        applicability: "web applications and APIs",
      },
      {
        standard_id: "MOBILE_APPLICATION_SECURITY",
        version: "OWNER_SELECTED_CURRENT_VERSION",
        applicability: "only when a mobile client exists",
      },
    ],
    project_overlays: [
      "tenant and account isolation",
      "privacy and secret handling",
      "release and deployment integrity",
    ],
    update_policy: "review versions during Bootstrap and at each release planning boundary",
  },
  "evidence.active_window_days": 30,
  "workflow.progress_interval_minutes": 20,
  "workflow.agent_lifecycle": {
    pin_when_supported: [
      "AUDITOR", "ORCHESTRATOR", "FEATURE_AGENT", "PLATFORM_AGENT", "RUNTIME",
    ],
    persistent_roles: ["RUNTIME"],
    completed_sessions: "ARCHIVE_UNPIN_KEEP_SESSION_ID",
    naming_template: "{role} {release} {governance}",
    handoff_event_log: true,
  },
  "workflow.campaign_topology": {
    default_mode: "SINGLE_CUMULATIVE_ROOT",
    maximum_parallel_lanes: 1,
    handoff_policy: "CLEAN_PUSHED_CHECKPOINT_TO_NEXT_DEPENDENCY_OWNER",
    milestone_integration: "RUNTIME_AFTER_TERMINAL_CHECKPOINT",
  },
  "workflow.gpt_assist_mode": "GPT_ASSIST",
  "models.rules": modelRules,
  "authority_corpus.operation": "CREATE_NEW",
  "authority_corpus.source": {
    kind: "NONE",
    path: null,
    source_governance_version: null,
    content_sha256: null,
    read_only: true,
  },
  "authority_corpus.structure": {
    authority_root: "authority",
    authority_index_path: "authority/index.json",
    campaigns_root: "authority/campaigns",
    design_bible_root: "authority/design",
    evidence_library_root: "evidence-library",
    publication: "PRIVATE_REPOSITORY",
    numbering: {
      bootstrap_article: 0,
      governance_start: 1,
      governance_end_exclusive: 100,
      project_start: 100,
      project_end_exclusive: 200,
      feature_block_size: 100,
      first_feature_start: 200,
      existing_feature_blocks: [],
      registry_path: "authority/article-numbering.json",
    },
  },
  "authority_corpus.terminology": {terms: ["project", "feature", "capability"]},
  "design.operation": "CREATE_NEW",
  "design.source": {
    kind: "NONE",
    path: null,
    source_governance_version: null,
    content_sha256: null,
    read_only: true,
  },
  "design.system": {accessibility: "required", protected_surfaces: []},
  "intent.features": [{
    feature_id: "feature-a",
    outcome: "complete workflow",
    users: ["operator"],
    owned_truth: "feature-local workflow state",
    dependencies: [],
    unavailable_behavior: "show unavailable without stale residue",
  }],
  "intent.gates": [{
    gate_id: "gate-a",
    feature_id: "feature-a",
    intent: "operator completes the workflow",
    owner: "feature-a-owner",
    lifecycle_status: "PLANNED",
    evidence_disposition: "UNPROVEN_ACTIVE_EVIDENCE",
    dependencies: [],
    done_when: "the affected workflow proof passes",
    proof_expectation: "affected deterministic workflow test",
    failure_behavior: "remain honestly unavailable",
    accepted_live_closure: null,
  }],
};

try {
  const discovery = [{
    fact_id: "environment.project_root",
    value: projectRoot,
    confidence: "HIGH",
    source_kind: "FILESYSTEM",
    source_locator: "bootstrap-working-directory",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  }, {
    fact_id: "repositories.topology.detected",
    value: "SINGLE_REPOSITORY",
    confidence: "HIGH",
    source_kind: "GIT",
    source_locator: "project-root",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  }, {
    fact_id: "models.rules.spawnable",
    value: [
      {model: "model-strong", reasoning_levels: ["high"]},
      {model: "model-balanced", reasoning_levels: ["medium"]},
      {model: "model-economical", reasoning_levels: ["medium"]},
    ],
    confidence: "HIGH",
    source_kind: "HOST_MODEL_INVENTORY",
    source_locator: "current-host",
    observed_at: "2026-01-01T00:00:00.000Z",
    secret_free: true,
  }];
  let state = createGuidedBootstrapState(
    discovery, "2026-01-01T00:00:00.000Z", "bootstrap-session-001",
    "9".repeat(64),
  );
  if (nextGuidedQuestion(state)?.question_id !== "setup.interaction_mode") {
    failures.push("first question is not interaction mode");
  }
  state = applyGuidedAnswer(state, answer(
    "setup.interaction_mode", "CHATGPT_GUIDED", 1,
  ));
  const foundationReadyState = structuredClone(state);
  const foundation = compileChatGptExchange(
    state, "FOUNDATION", "exchange-foundation-001",
    "2026-01-01T00:02:00.000Z",
  );
  if (foundation.question_cadence !== "EXACTLY_ONE_QUESTION_THEN_WAIT"
      || foundation.model_research.source_url !== "https://artificialanalysis.ai/models") {
    failures.push("ChatGPT exchange lacks cadence or advisory model source");
  }
  const markdown = renderChatGptExchangeMarkdown(foundation);
  if (!markdown.includes("starting point to riff from")
      || !markdown.includes(foundation.package_sha256)
      || !markdown.includes("Do not hardcode model names")) {
    failures.push("Markdown exchange prompt is incomplete");
  }
  let minute = 3;
  const foundationAnswers = foundation.questions.map((question) =>
    answer(question.question_id, values[question.question_id], minute++));
  const responseBody = {
    schema: "governance.chatgpt_bootstrap_response.v1",
    package_id: foundation.package_id,
    package_sha256: foundation.package_sha256,
    completed_at: "2026-01-01T00:30:00.000Z",
    answers: foundationAnswers,
    remaining_material_questions: [],
    deferred_nonmaterial_questions: [],
  };
  const response = {...responseBody, response_sha256: digest(responseBody)};
  validateChatGptResponse(response, foundation);
  state = importChatGptResponse(state, foundation, response);
  if (nextGuidedQuestion(state) !== null) {
    failures.push("question flow advanced before Foundation output");
  }
  const foundationOutputReadyState = structuredClone(state);
  state = recordPhaseOutput(
    state, phaseOutput("FOUNDATION"), "2026-01-01T00:31:00.000Z",
  );
  minute = 32;
  const phaseReadyStates = {};
  for (const phase of ["AUTHORITY_CORPUS", "DESIGN_BIBLE", "INTENT"]) {
    while (nextGuidedQuestion(state)?.phase === phase) {
      const question = nextGuidedQuestion(state);
      state = applyGuidedAnswer(
        state, answer(question.question_id, values[question.question_id], minute++),
      );
    }
    phaseReadyStates[phase] = structuredClone(state);
    state = recordPhaseOutput(
      state, phaseOutput(phase),
      `2026-01-01T00:${String(minute++).padStart(2, "0")}:00.000Z`,
    );
  }
  if (nextGuidedQuestion(state) !== null) failures.push("question flow did not converge");
  state = sealGuidedBootstrap(state, {
    auditor_session_id: "audit-session-001",
    report_sha256: "1".repeat(64),
    disposition: "ACCEPTED",
    audited_at: "2026-01-01T01:10:00.000Z",
  }, "2026-01-01T01:11:00.000Z");
  validateGuidedBootstrapState(state);
  if (state.sealed_snapshot.progress_interval_minutes !== 20
      || state.sealed_snapshot.evidence_active_window_days !== 30) {
    failures.push("sealed snapshot lost user-selected intervals");
  }
  if (state.sealed_snapshot.article_numbering.feature_blocks[0]?.start !== 200
      || state.sealed_snapshot.article_numbering.feature_blocks[0]
        ?.articles.release_history.number !== "0220"
      || state.sealed_snapshot.article_numbering.governance_core[0]
        ?.relative_path !== "0001-governance-index-and-constitution.md"
      || state.sealed_snapshot.article_numbering.project_core.at(-1)
        ?.relative_path !== "0123-project-change-log.md") {
    failures.push("portable article numbering is not deterministic");
  }
  if (state.launch.question !== "Example Project's 2.1rc environment is ready for launch. Proceed?") {
    failures.push("launch question is not exact");
  }
  state = confirmGuidedBootstrapLaunch(
    state, "PROCEED", "owner", "2026-01-01T01:12:00.000Z",
  );
  const confirmedLaunchState = structuredClone(state);
  const activation = compileFirstAuditActivation(
    state, "first-auditor-session", "2026-01-01T01:13:00.000Z",
  );
  state = recordFirstAuditActivation(state, activation, "2026-01-01T01:13:00.000Z");
  const activatedLaunchState = structuredClone(state);
  state = recordFirstAuditWorking(state, {
    session_id: "first-auditor-session",
    pinned: true,
    working_state: "ACTIVE_CAMPAIGN_DESIGN",
    progress_evidence_sha256: "2".repeat(64),
    observed_at: "2026-01-01T01:14:00.000Z",
  });
  state = completeGuidedBootstrapExit(state, "2026-01-01T01:15:00.000Z");
  if (state.launch.status !== "BOOTSTRAP_EXITED"
      || state.launch.bootstrap_exit.unpin_bootstrap !== true) {
    failures.push("Bootstrap did not exit after proving first Auditor progress");
  }

  const exact = resolveModelRule(modelRules, {feature: "map", role: "backend"});
  const role = resolveModelRule(modelRules, {feature: "other", role: "backend"});
  const fallback = resolveModelRule(modelRules, {feature: "other", role: "ui"});
  if (exact.rule_id !== "feature-map-backend"
      || role.rule_id !== "role-backend"
      || fallback.rule_id !== "global-default") {
    failures.push("model rule precedence is incorrect");
  }

  expectRejected("invalid interaction mode", () =>
    applyGuidedAnswer(
      createGuidedBootstrapState(
        discovery, "2026-01-01T00:00:00.000Z", "bootstrap-session-002",
        "9".repeat(64),
      ),
      answer("setup.interaction_mode", "AUTOMATIC_GUESS", 1),
    ));
  expectRejected("secret-bearing discovery", () =>
    createGuidedBootstrapState([{...discovery[0], secret_free: false}],
      "2026-01-01T00:00:00.000Z", "bootstrap-session-003", "9".repeat(64)));
  expectRejected("discovery fact postdates Bootstrap creation", () =>
    createGuidedBootstrapState([{
      ...discovery[0],
      observed_at: "2026-01-01T00:01:00.000Z",
    }], "2026-01-01T00:00:00.000Z", "bootstrap-session-003b", "9".repeat(64)));
  const rootAliasParent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "g21-guided-root-")),
  );
  const rootAlias = path.join(rootAliasParent, "project-alias");
  fs.symlinkSync(projectRoot, rootAlias);
  expectRejected("discovered project root is a symlink alias", () => {
    const aliasedDiscovery = structuredClone(discovery);
    aliasedDiscovery.find((fact) =>
      fact.fact_id === "environment.project_root").value = rootAlias;
    createGuidedBootstrapState(
      aliasedDiscovery, "2026-01-01T00:00:00.000Z", "bootstrap-session-003c",
      "9".repeat(64),
    );
  });
  fs.rmSync(rootAliasParent, {recursive: true, force: true});
  expectRejected("stale exchange replay", () =>
    importChatGptResponse(state, foundation, response));
  expectRejected("compact exchange receipt tamper", () => {
    const tampered = structuredClone(state);
    tampered.imported_exchange_receipts[0].response_sha256 = "0".repeat(64);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("deferred context lacks imported response", () => {
    const tampered = structuredClone(state);
    const deferred = {
      phase: "FOUNDATION",
      items: ["optional later preference"],
      response_sha256: "0".repeat(64),
    };
    tampered.deferred_context.push({
      ...deferred,
      deferred_sha256: digest(deferred),
    });
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("response changed question order", () => {
    const changed = structuredClone(response);
    changed.answers.reverse();
    const body = structuredClone(changed);
    delete body.response_sha256;
    changed.response_sha256 = digest(body);
    validateChatGptResponse(changed, foundation);
  });
  expectRejected("response package mismatch", () =>
    validateChatGptResponse({...response, package_id: "other"}, foundation));
  expectRejected("response answer occurs after completion", () => {
    const changed = structuredClone(response);
    changed.answers.at(-1).answered_at = "2026-01-01T00:31:00.000Z";
    const answerBody = structuredClone(changed.answers.at(-1));
    delete answerBody.answer_sha256;
    changed.answers.at(-1).answer_sha256 = digest(answerBody);
    const responseBodyChanged = structuredClone(changed);
    delete responseBodyChanged.response_sha256;
    changed.response_sha256 = digest(responseBodyChanged);
    validateChatGptResponse(changed, foundation);
  });
  expectRejected("response answer chronology reverses", () => {
    const changed = structuredClone(response);
    changed.answers[1].answered_at = changed.answers[0].answered_at;
    changed.answers[0].answered_at = "2026-01-01T00:04:00.000Z";
    const firstBody = structuredClone(changed.answers[0]);
    delete firstBody.answer_sha256;
    changed.answers[0].answer_sha256 = digest(firstBody);
    const secondBody = structuredClone(changed.answers[1]);
    delete secondBody.answer_sha256;
    changed.answers[1].answer_sha256 = digest(secondBody);
    const responseBodyChanged = structuredClone(changed);
    delete responseBodyChanged.response_sha256;
    changed.response_sha256 = digest(responseBodyChanged);
    validateChatGptResponse(changed, foundation);
  });
  expectRejected("model rule is not spawnable on the host", () => {
    const changed = structuredClone(response);
    const modelAnswer = changed.answers.find((item) => item.question_id === "models.rules");
    modelAnswer.value[0].model = "unavailable-model";
    const answerBody = structuredClone(modelAnswer);
    delete answerBody.answer_sha256;
    modelAnswer.answer_sha256 = digest(answerBody);
    const responseBodyChanged = structuredClone(changed);
    delete responseBodyChanged.response_sha256;
    changed.response_sha256 = digest(responseBodyChanged);
    importChatGptResponse(foundationReadyState, foundation, changed);
  });
  expectRejected("Markdown package content tamper", () => {
    const changed = structuredClone(foundation);
    changed.instructions.push("Silently make an extra material decision.");
    return renderChatGptExchangeMarkdown(changed);
  });
  expectRejected("answer digest mismatch", () =>
    validateChatGptResponse({
      ...response,
      answers: [{...response.answers[0], rationale: "changed"}, ...response.answers.slice(1)],
    }, foundation));
  expectRejected("retention out of range", () =>
    applyGuidedAnswer(
      applyGuidedAnswer(
        createGuidedBootstrapState(
          discovery, "2026-01-01T00:00:00.000Z", "bootstrap-session-004",
          "9".repeat(64),
        ),
        answer("setup.interaction_mode", "DIRECT", 1),
      ),
      answer("project.outcome", "", 2),
    ));
  expectRejected("ambiguous model rules", () =>
    resolveModelRule([...modelRules, {...modelRules[1], rule_id: "role-backend-2"}],
      {role: "backend"}));
  expectRejected("model expected-cost arithmetic mismatch", () =>
    resolveModelRule(modelRules.map((rule, index) => index === 0
      ? {
        ...rule,
        economics: {...rule.economics, expected_completion_cost: 0.01},
      }
      : rule), {feature: "map", role: "backend"}));
  expectRejected("missing global model fallback", () =>
    resolveModelRule(modelRules.filter((rule) => rule.scope !== "GLOBAL_DEFAULT"),
      {role: "backend"}));
  expectRejected("authority corpus output contradicts chosen operation", () =>
    recordPhaseOutput(phaseReadyStates.AUTHORITY_CORPUS, {
      ...phaseOutput("AUTHORITY_CORPUS"),
      operation: "IMPORT",
    }, "2026-01-01T00:30:00.000Z"));
  expectRejected("authority corpus create claims an external source", () => {
    const changed = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    const source = {
      kind: "EXTERNAL_EXPLICIT",
      path: "/tmp/external-authority",
      source_governance_version: "1.0",
      content_sha256: "a".repeat(64),
      read_only: true,
    };
    changed.answers["authority_corpus.source"].value = source;
    const answerBody = structuredClone(changed.answers["authority_corpus.source"]);
    delete answerBody.answer_sha256;
    changed.answers["authority_corpus.source"].answer_sha256 = digest(answerBody);
    return recordPhaseOutput(changed, {
      ...phaseOutput("AUTHORITY_CORPUS"),
      source_identity: `sha256:${digest(source)}`,
    }, "2026-01-01T00:30:00.000Z");
  });
  expectRejected("authority corpus source path escapes project", () => {
    const changed = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    const source = {
      kind: "PROJECT_RELATIVE",
      path: "../outside",
      source_governance_version: "1.0",
      content_sha256: "a".repeat(64),
      read_only: true,
    };
    changed.answers["authority_corpus.source"].value = source;
    const answerBody = structuredClone(changed.answers["authority_corpus.source"]);
    delete answerBody.answer_sha256;
    changed.answers["authority_corpus.source"].answer_sha256 = digest(answerBody);
    validateGuidedBootstrapState(changed);
  });
  const importFixtureRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "g21-guided-import-")),
  );
  const importFixturePath = path.join(importFixtureRoot, "authority.md");
  fs.writeFileSync(importFixturePath, "accepted authority bytes\n", {encoding: "utf8"});
  const importSource = {
    kind: "EXTERNAL_EXPLICIT",
    path: importFixturePath,
    source_governance_version: "1.0",
    content_sha256: computePortableContentSha256(importFixturePath),
    read_only: true,
  };
  verifyGuidedImportSource(importSource, projectRoot);
  expectRejected("import source digest is self-asserted", () =>
    verifyGuidedImportSource(
      {...importSource, content_sha256: "0".repeat(64)}, projectRoot,
    ));
  expectRejected("import source does not exist", () =>
    verifyGuidedImportSource(
      {...importSource, path: path.join(importFixtureRoot, "missing.md")}, projectRoot,
    ));
  const symlinkPath = path.join(importFixtureRoot, "authority-link.md");
  fs.symlinkSync(importFixturePath, symlinkPath);
  expectRejected("import source traverses a symbolic link", () =>
    verifyGuidedImportSource({...importSource, path: symlinkPath}, projectRoot));
  const realImportDirectory = path.join(importFixtureRoot, "real");
  const aliasImportDirectory = path.join(importFixtureRoot, "alias");
  fs.mkdirSync(realImportDirectory);
  const nestedImportPath = path.join(realImportDirectory, "nested.md");
  fs.writeFileSync(nestedImportPath, "nested authority\n", {encoding: "utf8"});
  fs.symlinkSync(realImportDirectory, aliasImportDirectory);
  expectRejected("external import traverses a symlinked parent", () =>
    verifyGuidedImportSource({
      ...importSource,
      path: path.join(aliasImportDirectory, "nested.md"),
      content_sha256: computePortableContentSha256(nestedImportPath),
    }, projectRoot));
  fs.writeFileSync(importFixturePath, "changed after confirmation\n", {encoding: "utf8"});
  expectRejected("import source changed after confirmation", () =>
    verifyGuidedImportSource(importSource, projectRoot));
  fs.rmSync(importFixtureRoot, {recursive: true, force: true});
  expectRejected("phase output cites a nonexistent Git commit", () => {
    const changed = phaseOutput("FOUNDATION");
    changed.commit = "0".repeat(40);
    changed.verification_sha256 = digest({
      identity_kind: changed.identity_kind,
      repository: changed.repository,
      commit: changed.commit,
      tree: changed.tree,
      artifact_files: changed.artifact_files,
      local_content_sha256: changed.local_content_sha256,
    });
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("phase output artifact digest disagrees with Git bytes", () => {
    const changed = phaseOutput("FOUNDATION");
    const index = changed.artifact_files.find((entry) => entry.role === "INDEX");
    index.sha256 = "0".repeat(64);
    changed.index_sha256 = index.sha256;
    changed.verification_sha256 = digest({
      identity_kind: changed.identity_kind,
      repository: changed.repository,
      commit: changed.commit,
      tree: changed.tree,
      artifact_files: changed.artifact_files,
      local_content_sha256: changed.local_content_sha256,
    });
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("phase output artifact root does not exist at the Git commit", () => {
    const changed = phaseOutput("FOUNDATION");
    changed.artifact_root = "authority/missing-root";
    changed.artifact_files = changed.artifact_files.map((entry) => ({
      ...entry,
      path: `authority/missing-root/${entry.role.toLowerCase()}.md`,
    }));
    changed.verification_sha256 = digest({
      identity_kind: changed.identity_kind,
      repository: changed.repository,
      commit: changed.commit,
      tree: changed.tree,
      artifact_files: changed.artifact_files,
      local_content_sha256: changed.local_content_sha256,
    });
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("phase output artifact escapes its declared root", () => {
    const changed = phaseOutput("FOUNDATION");
    changed.artifact_root = "schemas/subtree";
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("phase output roles reuse one artifact path", () => {
    const changed = phaseOutput("FOUNDATION");
    const sharedPath = fixtureArtifactFiles[0].path;
    const sharedSha = fixtureArtifactFiles[0].sha256;
    changed.artifact_files = changed.artifact_files.map((entry) => ({
      ...entry,
      path: sharedPath,
      sha256: sharedSha,
    }));
    changed.index_sha256 = sharedSha;
    changed.context_sha256 = sharedSha;
    changed.mapping_sha256 = sharedSha;
    changed.verification_sha256 = digest({
      identity_kind: changed.identity_kind,
      repository: changed.repository,
      commit: changed.commit,
      tree: changed.tree,
      artifact_files: changed.artifact_files,
      local_content_sha256: changed.local_content_sha256,
    });
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("phase output role path is a Git tree instead of a file blob", () => {
    const changed = phaseOutput("FOUNDATION");
    changed.artifact_root = ".";
    const context = changed.artifact_files.find((entry) => entry.role === "CONTEXT");
    context.path = "schemas";
    changed.context_sha256 = context.sha256;
    changed.verification_sha256 = digest({
      identity_kind: changed.identity_kind,
      repository: changed.repository,
      commit: changed.commit,
      tree: changed.tree,
      artifact_files: changed.artifact_files,
      local_content_sha256: changed.local_content_sha256,
    });
    recordPhaseOutput(
      foundationOutputReadyState, changed, "2026-01-01T00:21:00.000Z",
    );
  });
  expectRejected("unverified phase output", () =>
    recordPhaseOutput(state, {
      phase: "FOUNDATION",
      operation: "CREATE_OR_ALIGN_PROJECT_CONFIGURATION",
      source_identity: "owner-confirmed-guided-bootstrap",
      artifact_root: "authority",
      repository: "repo",
      commit: "commit",
      tree: "tree",
      index_sha256: "d".repeat(64),
      context_sha256: "e".repeat(64),
      mapping_sha256: "a".repeat(64),
      verification_sha256: "f".repeat(64),
      status: "UNVERIFIED",
      writer_session_id: "bootstrap-session-001",
      unavailable_reason: null,
    }, "2026-01-01T01:12:00.000Z"));
  expectRejected("duplicate phase output rewrite", () =>
    recordPhaseOutput(state, {
      ...state.phase_outputs.FOUNDATION,
      recorded_at: undefined,
    }, "2026-01-01T01:12:00.000Z"));
  expectRejected("phase output path escape", () => {
    const unsealed = structuredClone(state);
    unsealed.setup_audit = null;
    unsealed.sealed_snapshot = null;
    delete unsealed.phase_outputs.INTENT;
    return recordPhaseOutput(unsealed, {
      ...state.phase_outputs.INTENT,
      artifact_root: "../../outside",
      recorded_at: undefined,
    }, "2026-01-01T01:12:00.000Z");
  });
  expectRejected("typed provider policy drift", () => {
    const initial = createGuidedBootstrapState(
      discovery, "2026-01-01T00:00:00.000Z", "bootstrap-session-005",
      "9".repeat(64),
    );
    let partial = applyGuidedAnswer(initial, answer(
      "setup.interaction_mode", "DIRECT", 1,
    ));
    for (const id of [
      "project.outcome", "project.users", "project.non_goals", "project.lifecycle",
      "repositories.topology", "project.sensitivity",
    ]) partial = applyGuidedAnswer(partial, answer(id, values[id], partial.revision + 1));
    return applyGuidedAnswer(partial, answer(
      "providers.capability_map", {hosting: "self-asserted"}, partial.revision + 1,
    ));
  });
  expectRejected("version-controlled project lacks source-control provider", () => {
    const tampered = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    tampered.answers["providers.capability_map"].value =
      tampered.answers["providers.capability_map"].value
        .filter((binding) => binding.capability !== "source_control");
    const body = structuredClone(tampered.answers["providers.capability_map"]);
    delete body.answer_sha256;
    tampered.answers["providers.capability_map"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("enabled deployment lacks deployment provider", () => {
    const tampered = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    tampered.answers["providers.capability_map"].value =
      tampered.answers["providers.capability_map"].value
        .filter((binding) => binding.capability === "source_control");
    const body = structuredClone(tampered.answers["providers.capability_map"]);
    delete body.answer_sha256;
    tampered.answers["providers.capability_map"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("agent lifecycle hides active Platform Agents", () => {
    const tampered = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    const changed = structuredClone(values["workflow.agent_lifecycle"]);
    changed.pin_when_supported = changed.pin_when_supported
      .filter((role) => role !== "PLATFORM_AGENT");
    tampered.answers["workflow.agent_lifecycle"].value = changed;
    const body = structuredClone(tampered.answers["workflow.agent_lifecycle"]);
    delete body.answer_sha256;
    tampered.answers["workflow.agent_lifecycle"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("single-root topology claims multiple lanes", () => {
    const tampered = structuredClone(phaseReadyStates.AUTHORITY_CORPUS);
    const changed = structuredClone(values["workflow.campaign_topology"]);
    changed.maximum_parallel_lanes = 3;
    tampered.answers["workflow.campaign_topology"].value = changed;
    const body = structuredClone(tampered.answers["workflow.campaign_topology"]);
    delete body.answer_sha256;
    tampered.answers["workflow.campaign_topology"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("article-number range overlaps governance and project", () => {
    const changed = structuredClone(values["authority_corpus.structure"]);
    changed.numbering.project_start = 99;
    compilePortableArticleNumbering(changed, values["intent.features"]);
  });
  expectRejected("feature article blocks collide", () => {
    const changed = structuredClone(values["authority_corpus.structure"]);
    changed.numbering.existing_feature_blocks = [
      {feature_id: "feature-a", start: 200, kind: "PRIMARY", extends_start: null},
      {feature_id: "feature-b", start: 200, kind: "PRIMARY", extends_start: null},
    ];
    compilePortableArticleNumbering(changed, values["intent.features"]);
  });
  const preservedNumbering = compilePortableArticleNumbering({
    ...values["authority_corpus.structure"],
    numbering: {
      ...values["authority_corpus.structure"].numbering,
      existing_feature_blocks: [{
        feature_id: "feature-z",
        start: 200,
        kind: "PRIMARY",
        extends_start: null,
      }],
    },
  }, [
    ...values["intent.features"],
    {
      feature_id: "feature-z",
      outcome: "preserve prior allocation",
      users: ["operator"],
      owned_truth: "feature-local truth",
      dependencies: [],
      unavailable_behavior: "remain unavailable",
    },
  ]);
  if (preservedNumbering.feature_blocks.find((block) =>
    block.feature_id === "feature-z")?.start !== 200
      || preservedNumbering.feature_blocks.find((block) =>
        block.feature_id === "feature-a")?.start !== 300) {
    failures.push("existing article blocks were renumbered");
  }
  const extendedStructure = allocatePortableFeatureExtension({
    ...values["authority_corpus.structure"],
    numbering: {
      ...values["authority_corpus.structure"].numbering,
      existing_feature_blocks: [{
        feature_id: "feature-a",
        start: 200,
        kind: "PRIMARY",
        extends_start: null,
      }],
    },
  }, "feature-a");
  const extension = extendedStructure.numbering.existing_feature_blocks
    .find((block) => block.kind === "EXTENSION");
  if (extension?.start !== 300 || extension.extends_start !== 200) {
    failures.push("feature extension allocation is not deterministic");
  }
  expectRejected("feature extension lacks same-feature parent", () => {
    const changed = structuredClone(values["authority_corpus.structure"]);
    changed.numbering.existing_feature_blocks = [{
      feature_id: "feature-a",
      start: 300,
      kind: "EXTENSION",
      extends_start: 200,
    }];
    compilePortableArticleNumbering(changed, values["intent.features"]);
  });
  expectRejected("feature extension chain cycles", () => {
    const changed = structuredClone(values["authority_corpus.structure"]);
    changed.numbering.existing_feature_blocks = [
      {feature_id: "feature-a", start: 200, kind: "PRIMARY", extends_start: null},
      {feature_id: "feature-a", start: 300, kind: "EXTENSION", extends_start: 400},
      {feature_id: "feature-a", start: 400, kind: "EXTENSION", extends_start: 300},
    ];
    compilePortableArticleNumbering(changed, values["intent.features"]);
  });
  expectRejected("feature extension allocation has no primary root", () => {
    const changed = structuredClone(values["authority_corpus.structure"]);
    changed.numbering.existing_feature_blocks = [
      {feature_id: "feature-a", start: 300, kind: "EXTENSION", extends_start: 400},
      {feature_id: "feature-a", start: 400, kind: "EXTENSION", extends_start: 300},
    ];
    compilePortableArticleNumbering(changed, values["intent.features"]);
  });
  expectRejected("model rule invents scope keys", () =>
    resolveModelRule(modelRules.map((rule, index) => index === 2
      ? {...rule, match: {role: "auditor"}}
      : rule), {role: "auditor"}));
  expectRejected("gate references unknown feature", () => {
    const tampered = structuredClone(phaseReadyStates.INTENT);
    tampered.answers["intent.gates"].value[0].feature_id = "missing-feature";
    const body = structuredClone(tampered.answers["intent.gates"]);
    delete body.answer_sha256;
    tampered.answers["intent.gates"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("feature dependency graph cycles", () => {
    const tampered = structuredClone(phaseReadyStates.INTENT);
    tampered.answers["intent.features"].value = [
      {
        feature_id: "feature-a",
        outcome: "A",
        users: ["operator"],
        owned_truth: "A truth",
        dependencies: ["feature-b"],
        unavailable_behavior: "unavailable",
      },
      {
        feature_id: "feature-b",
        outcome: "B",
        users: ["operator"],
        owned_truth: "B truth",
        dependencies: ["feature-a"],
        unavailable_behavior: "unavailable",
      },
    ];
    const body = structuredClone(tampered.answers["intent.features"]);
    delete body.answer_sha256;
    tampered.answers["intent.features"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("accepted-live gate lacks passing evidence", () => {
    const tampered = structuredClone(phaseReadyStates.INTENT);
    tampered.answers["intent.gates"].value[0].lifecycle_status = "ACCEPTED_LIVE";
    const body = structuredClone(tampered.answers["intent.gates"]);
    delete body.answer_sha256;
    tampered.answers["intent.gates"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("accepted-live gate lacks closure transaction", () => {
    const tampered = structuredClone(phaseReadyStates.INTENT);
    tampered.answers["intent.gates"].value[0].lifecycle_status = "ACCEPTED_LIVE";
    tampered.answers["intent.gates"].value[0].evidence_disposition = "PASS_WITH_EVIDENCE";
    const body = structuredClone(tampered.answers["intent.gates"]);
    delete body.answer_sha256;
    tampered.answers["intent.gates"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("accepted-live gate uses non-content-addressed release identities", () => {
    const tampered = structuredClone(phaseReadyStates.INTENT);
    const gate = tampered.answers["intent.gates"].value[0];
    gate.lifecycle_status = "ACCEPTED_LIVE";
    gate.evidence_disposition = "PASS_WITH_EVIDENCE";
    gate.accepted_live_closure = {
      deployed: {identity_sha256: "x", receipt_sha256: "1".repeat(64)},
      rollback: {identity_sha256: "y", receipt_sha256: "2".repeat(64)},
      audit_report_sha256: "3".repeat(64),
      closure_receipt_sha256: "4".repeat(64),
    };
    const body = structuredClone(tampered.answers["intent.gates"]);
    delete body.answer_sha256;
    tampered.answers["intent.gates"].answer_sha256 = digest(body);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("snapshot tamper", () => {
    const tampered = structuredClone(state);
    tampered.sealed_snapshot.progress_interval_minutes = 5;
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("stored phase-output digest tamper", () => {
    const tampered = structuredClone(state);
    tampered.phase_outputs.AUTHORITY_CORPUS.context_sha256 = "0".repeat(64);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("stored setup-audit digest tamper", () => {
    const tampered = structuredClone(state);
    tampered.setup_audit.report_sha256 = "0".repeat(64);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("append-only revision mismatch", () => {
    const tampered = structuredClone(state);
    tampered.revision += 1;
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("updated_at drifts from latest event", () => {
    const tampered = structuredClone(state);
    tampered.updated_at = "2026-01-01T01:16:00.000Z";
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("CONFIRMED launch carries future evidence", () => {
    const tampered = structuredClone(state);
    tampered.launch.status = "CONFIRMED";
    tampered.launch.auditor_started = null;
    tampered.launch.bootstrap_exit = null;
    const launchBody = structuredClone(tampered.launch);
    delete launchBody.launch_sha256;
    tampered.launch.launch_sha256 = digest(launchBody);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("AUDITOR_ACTIVATED carries future working evidence", () => {
    const tampered = structuredClone(state);
    tampered.launch.status = "AUDITOR_ACTIVATED";
    tampered.launch.bootstrap_exit = null;
    const launchBody = structuredClone(tampered.launch);
    delete launchBody.launch_sha256;
    tampered.launch.launch_sha256 = digest(launchBody);
    validateGuidedBootstrapState(tampered);
  });
  expectRejected("launch before owner confirmation", () => {
    const ready = structuredClone(state);
    ready.launch.status = "READY_TO_ASK";
    ready.launch.owner_decision = null;
    ready.launch.decision_at = null;
    ready.launch.auditor_activation = null;
    ready.launch.auditor_started = null;
    ready.launch.bootstrap_exit = null;
    const launchBody = structuredClone(ready.launch);
    delete launchBody.launch_sha256;
    ready.launch.launch_sha256 = digest(launchBody);
    compileFirstAuditActivation(
      ready, "first-auditor-session-2", "2026-01-01T01:16:00.000Z",
    );
  });
  expectRejected("Bootstrap exits before Auditor working", () => {
    const activated = structuredClone(state);
    activated.launch.status = "AUDITOR_ACTIVATED";
    activated.launch.auditor_started = null;
    activated.launch.bootstrap_exit = null;
    const launchBody = structuredClone(activated.launch);
    delete launchBody.launch_sha256;
    activated.launch.launch_sha256 = digest(launchBody);
    completeGuidedBootstrapExit(activated, "2026-01-01T01:16:00.000Z");
  });
  expectRejected("first Auditor reuses Bootstrap session", () => {
    compileFirstAuditActivation(
      confirmedLaunchState, "bootstrap-session-001", "2026-01-01T01:16:00.000Z",
    );
  });
  expectRejected("first Auditor working proof uses another session", () => {
    recordFirstAuditWorking(activatedLaunchState, {
      session_id: "different-session",
      pinned: true,
      working_state: "ACTIVE_CAMPAIGN_DESIGN",
      progress_evidence_sha256: "2".repeat(64),
      observed_at: "2026-01-01T01:16:00.000Z",
    });
  });
} catch (error) {
  failures.push(error.stack ?? error.message);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Governance 2.1rc guided Bootstrap PASS (${hostiles} hostile cases)\n`);
