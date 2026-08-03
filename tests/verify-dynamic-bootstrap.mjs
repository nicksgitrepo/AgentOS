#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {
  applyBootstrapAnswer,
  applyAuditTransition,
  applyWorkerTransition,
  appendConfigurationSnapshot,
  changePreference,
  compileWorkerActivation,
  createBootstrapState,
  discoverEnvironment,
  nextBootstrapHostAction,
  nextBootstrapQuestion,
  validateBootstrapTransition,
  validateBootstrapState,
} from "../control/dynamic-bootstrap.mjs";

const failures = [];
let hostileRejected = 0;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-bootstrap-"));

const answer = (questionId, choice, minute) => ({
  question_id: questionId,
  choice,
  answered_by: "owner",
  answered_at: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
});

const preferenceChange = (overrides = {}) => ({
  group: "project",
  key: "name",
  value: "Portable Project",
  value_type: "STRING",
  source: "USER_SELECTED",
  confidence: "HIGH",
  changed_by: "owner",
  changed_at: "2026-01-01T00:10:00.000Z",
  effective_from: "IMMEDIATE",
  requires_revalidation: [],
  ...overrides,
});

const workerBinding = (displayName, sessionId) => ({
  session_id: sessionId,
  display_name: displayName,
  governance_version: "2.1rc",
  model_policy: "user-selected-compatible-model",
  model: "model-fixture",
  reasoning: "medium",
  pinned: true,
  spawn_reason: "FRESH_BOOTSTRAP_SETUP",
});

const auditorBinding = (sessionId = "session-auditor") => ({
  session_id: sessionId,
  display_name: "Auditor 2.1rc",
  governance_version: "2.1rc",
  pinned: true,
  spawn_reason: "FRESH_BOOTSTRAP_AUDIT",
});

function expectRejected(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostileRejected += 1;
  }
}

try {
  fs.mkdirSync(path.join(temporaryRoot, "authority"));
  fs.mkdirSync(path.join(temporaryRoot, "design-system"));
  const discovery = discoverEnvironment(temporaryRoot);
  if (discovery.project_root !== fs.realpathSync(temporaryRoot)
      || discovery.secret_values_read_or_retained !== false
      || discovery.authority_candidates.join(",") !== "authority"
      || discovery.design_candidates.join(",") !== "design-system") {
    failures.push("environment discovery is not bounded and deterministic");
  }

  let state = createBootstrapState(discovery, "2026-01-01T00:00:00.000Z");
  validateBootstrapState(state);
  if (nextBootstrapQuestion(state)?.question_id !== "authority_corpus_choice"
      || state.tracks.authority_corpus.choice !== null
      || state.tracks.design_bible.choice !== null) {
    failures.push("discovery improperly selected a material track choice");
  }
  if (nextBootstrapHostAction(state).action !== "ASK_ONE_QUESTION") {
    failures.push("host action did not begin with the deterministic question");
  }

  let minute = 1;
  state = applyBootstrapAnswer(state, answer("authority_corpus_choice", "IMPORT", minute++));
  if (nextBootstrapQuestion(state)?.question_id !== "authority_corpus_source_path") {
    failures.push("import choice did not request an explicit detected source");
  }
  state = applyBootstrapAnswer(state, answer("authority_corpus_source_path", "authority", minute++));
  while (nextBootstrapQuestion(state) !== null) {
    const question = nextBootstrapQuestion(state);
    const choice = question.question_id === "project_name"
      ? "Portable Project"
      : question.question_id === "provider_inventory"
        ? ["CUSTOM_PROVIDER", "GITHUB"]
        : question.question_id === "evidence_retention_days"
          ? 37
      : question.question_id === "design_bible_choice"
        ? "IMPORT"
        : question.question_id === "design_bible_source_path"
          ? "design-system"
          : question.recommended_choice;
    state = applyBootstrapAnswer(
      state, answer(question.question_id, choice, minute++),
    );
  }
  if (nextBootstrapQuestion(state) !== null
      || state.preference_history.length < 18
      || state.preference_history_head_sha256.length !== 64
      || state.configuration.version_control.providers.value.length !== 2
      || state.configuration.evidence.active_days.value !== 37) {
    failures.push("one-question flow or preference history did not converge");
  }
  const modelResolutionAction = nextBootstrapHostAction(state);
  if (modelResolutionAction.action !== "RESOLVE_MODEL_POLICY"
      || modelResolutionAction.recipient !== "AUTHORITY_CORPUS") {
    failures.push("host action did not request model resolution before worker spawn");
  }
  const spawnAction = nextBootstrapHostAction(state, {
    model: "model-fixture",
    reasoning: "medium",
    policy: "user-selected-compatible-model",
  });
  if (spawnAction.action !== "SPAWN_AND_PIN_TEMPORARY_WORKER"
      || spawnAction.activation.worker_kind !== "AUTHORITY_CORPUS") {
    failures.push("host action did not compile the exact temporary authority corpus worker");
  }

  const authorityCorpusActivation = compileWorkerActivation(state, "AUTHORITY_CORPUS", {
    model: "model-fixture",
    reasoning: "medium",
    policy: "user-selected-compatible-model",
  });
  const designActivation = compileWorkerActivation(state, "DESIGN_BIBLE", {
    model: "model-fixture",
    reasoning: "medium",
    policy: "user-selected-compatible-model",
  });
  if (authorityCorpusActivation.source_mode !== "IMPORT" || authorityCorpusActivation.source_path !== "authority"
      || designActivation.source_path !== "design-system"
      || authorityCorpusActivation.source_mutation_forbidden !== true) {
    failures.push("worker activation did not bind the explicit source choice");
  }

  const complete = structuredClone(state);
  complete.tracks.authority_corpus.worker_status = "RECONCILED";
  complete.tracks.authority_corpus.worker_binding = workerBinding("authority corpus 2.1rc", "session-authority");
  complete.tracks.authority_corpus.findings_digest_sha256 = "a".repeat(64);
  complete.tracks.design_bible.worker_status = "ARCHIVED";
  complete.tracks.design_bible.worker_binding = workerBinding(
    "DesignBible 2.1rc", "session-design",
  );
  complete.tracks.design_bible.findings_digest_sha256 = "b".repeat(64);
  complete.audit = {
    status: "ACCEPTED",
    auditor_binding: auditorBinding(),
    report_digest_sha256: "c".repeat(64),
  };
  validateBootstrapState(complete);

  let transitioned = structuredClone(state);
  const authorityCorpusIdentity = workerBinding("authority corpus 2.1rc", "session-authority-transition");
  transitioned = applyWorkerTransition(transitioned, {
    worker_kind: "AUTHORITY_CORPUS",
    from_status: "NOT_READY",
    to_status: "READY_TO_SPAWN",
    worker_binding: null,
    findings_digest_sha256: null,
    changed_by: "bootstrap",
    changed_at: "2026-01-01T00:40:00.000Z",
  });
  transitioned = applyWorkerTransition(transitioned, {
    worker_kind: "AUTHORITY_CORPUS",
    from_status: "READY_TO_SPAWN",
    to_status: "ACTIVE",
    worker_binding: authorityCorpusIdentity,
    findings_digest_sha256: null,
    changed_by: "bootstrap",
    changed_at: "2026-01-01T00:41:00.000Z",
  });
  transitioned = applyWorkerTransition(transitioned, {
    worker_kind: "AUTHORITY_CORPUS",
    from_status: "ACTIVE",
    to_status: "RETURNED_FINDINGS",
    worker_binding: authorityCorpusIdentity,
    findings_digest_sha256: "d".repeat(64),
    changed_by: "bootstrap",
    changed_at: "2026-01-01T00:42:00.000Z",
  });
  const auditIdentity = auditorBinding("session-auditor-transition");
  transitioned = applyAuditTransition(transitioned, {
    from_status: "NOT_READY",
    to_status: "ACTIVE",
    auditor_binding: auditIdentity,
    report_digest_sha256: null,
    changed_by: "bootstrap",
    changed_at: "2026-01-01T00:43:00.000Z",
  });
  transitioned = applyAuditTransition(transitioned, {
    from_status: "ACTIVE",
    to_status: "RETURNED",
    auditor_binding: auditIdentity,
    report_digest_sha256: "e".repeat(64),
    changed_by: "bootstrap",
    changed_at: "2026-01-01T00:44:00.000Z",
  });
  validateBootstrapState(transitioned);

  const sealedOnce = appendConfigurationSnapshot(
    complete, "release-001", "2026-01-01T01:00:00.000Z",
  );
  const sealedTwice = appendConfigurationSnapshot(
    sealedOnce, "release-002", "2026-01-02T01:00:00.000Z",
  );
  if (sealedTwice.sealed_snapshots.length !== 2
      || sealedTwice.sealed_snapshots[1].previous_snapshot_sha256
        !== sealedTwice.sealed_snapshots[0].snapshot_sha256) {
    failures.push("sealed configuration history is not append-only and chained");
  }
  const changed = changePreference(sealedTwice, preferenceChange({
    group: "evidence",
    key: "active_days",
    value: 30,
    value_type: "INTEGER",
    changed_at: "2026-01-03T00:00:00.000Z",
    effective_from: "NEXT_CAMPAIGN",
    requires_revalidation: ["EVIDENCE_POLICY"],
  }));
  if (changed.sealed_snapshots[0].configuration.evidence.active_days.value !== 37
      || changed.configuration.evidence.active_days.value !== 30) {
    failures.push("mutable preference rewrote sealed snapshot history");
  }

  const parentRepo = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-parent-repo-"));
  const child = path.join(parentRepo, "selected-child");
  fs.mkdirSync(child);
  spawnSync("git", ["init", "-q"], {cwd: parentRepo});
  try {
    const inherited = discoverEnvironment(child);
    if (inherited.version_control.repository_verified !== false
        || inherited.version_control.parent_repository_rejected !== true) {
      failures.push("parent repository inheritance was not rejected");
    }
  } finally {
    fs.rmSync(parentRepo, {recursive: true, force: true});
  }

  const secretRepo = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-secret-repo-"));
  spawnSync("git", ["init", "-q"], {cwd: secretRepo});
  spawnSync("git", [
    "remote", "add", "origin",
    `https://${["user", "password"].join(":")}@example.invalid/repo.git?${["token", "secret"].join("=")}#credential`,
  ], {cwd: secretRepo});
  try {
    const secretDiscovery = discoverEnvironment(secretRepo);
    const retained = JSON.stringify(secretDiscovery);
    if (secretDiscovery.version_control.remote !== null
        || secretDiscovery.version_control.remote_secret_material_rejected !== true
        || /user|password|token|credential/.test(retained)) {
      failures.push("credential-bearing Git remote left persisted secret residue");
    }
  } finally {
    fs.rmSync(secretRepo, {recursive: true, force: true});
  }

  const residuePatterns = new RegExp([
    ["synthetic", "-", "secret"].join(""),
    ["password", "@example"].join(""),
    ["token", "=", "secret"].join(""),
  ].join("|"));
  for (const hostileRemote of [
    `user:${["synthetic", "-", "secret"].join("")}@example.invalid:repo.git`,
    `user:${["password"].join("")}@example.invalid:path?${["token", "secret"].join("=")}#fragment`,
  ]) {
    const scpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-scp-repo-"));
    spawnSync("git", ["init", "-q"], {cwd: scpRepo});
    spawnSync("git", ["remote", "add", "origin", hostileRemote], {cwd: scpRepo});
    try {
      const scpDiscovery = discoverEnvironment(scpRepo);
      const serialized = JSON.stringify(scpDiscovery);
      if (scpDiscovery.version_control.remote !== null
          || scpDiscovery.version_control.remote_secret_material_rejected !== true
          || serialized.includes(hostileRemote)
          || residuePatterns.test(serialized)) {
        failures.push(`non-URL remote retained unsafe user information: ${hostileRemote}`);
      }
    } finally {
      fs.rmSync(scpRepo, {recursive: true, force: true});
    }
  }
  const ordinarySshRepo = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-ssh-repo-"));
  spawnSync("git", ["init", "-q"], {cwd: ordinarySshRepo});
  spawnSync("git", [
    "remote", "add", "origin", "git@example.invalid:team/repo.git",
  ], {cwd: ordinarySshRepo});
  try {
    const sshDiscovery = discoverEnvironment(ordinarySshRepo);
    if (sshDiscovery.version_control.remote
          !== "ssh://example.invalid/team/repo.git"
        || sshDiscovery.version_control.remote_secret_material_rejected !== false) {
      failures.push("ordinary SSH Git remote was not normalized without user information");
    }
  } finally {
    fs.rmSync(ordinarySshRepo, {recursive: true, force: true});
  }

  const rejectState = (label, source, mutate) => expectRejected(label, () => {
    const draft = structuredClone(source);
    mutate(draft);
    validateBootstrapState(draft);
  });

  rejectState("empty preference actor", state, (d) => {
    d.configuration.project.name.changed_by = "";
  });
  rejectState("invalid preference timestamp", state, (d) => {
    d.configuration.project.name.last_changed_at = "yesterday";
  });
  rejectState("invalid preference confidence", state, (d) => {
    d.configuration.project.name.confidence = "CERTAIN";
  });
  rejectState("mismatched preference type", state, (d) => {
    d.configuration.project.name.value_type = "BOOLEAN";
  });
  rejectState("non-string revalidation item", state, (d) => {
    d.configuration.project.name.requires_revalidation = [42];
  });
  rejectState("tampered preference history", state, (d) => {
    d.preference_history[0].key = "tampered";
  });
  rejectState("stale active question", state, (d) => {
    d.active_question_id = "authority_corpus_choice";
  });
  rejectState("tampered answer choice", state, (d) => {
    d.answers.project_name.choice = "Different Project";
  });
  rejectState("unknown answer", state, (d) => {
    d.answers.attacker_question = structuredClone(d.answers.project_name);
  });
  rejectState("discovery changed without digest", state, (d) => {
    d.discovery.deployment_markers.push("attacker-marker");
  });
  rejectState("arbitrary sealed snapshot", complete, (d) => {
    d.sealed_snapshots = [{tampered: true}];
  });
  rejectState("snapshot body tamper", sealedOnce, (d) => {
    d.sealed_snapshots[0].release_identity = "rewritten";
  });
  expectRejected("snapshot deletion transition", () => {
    const draft = structuredClone(changed);
    draft.sealed_snapshots.pop();
    validateBootstrapTransition(sealedTwice, draft);
  });
  expectRejected("snapshot reorder transition", () => {
    const draft = structuredClone(changed);
    draft.sealed_snapshots.reverse();
    validateBootstrapTransition(sealedTwice, draft);
  });
  expectRejected("snapshot prefix rewrite transition", () => {
    const draft = structuredClone(changed);
    draft.sealed_snapshots[0].snapshot_sha256 = "f".repeat(64);
    validateBootstrapTransition(sealedTwice, draft);
  });
  rejectState("reconciled worker without identity", complete, (d) => {
    d.tracks.authority_corpus.worker_binding = null;
  });
  rejectState("reconciled worker without findings", complete, (d) => {
    d.tracks.authority_corpus.findings_digest_sha256 = null;
  });
  rejectState("accepted audit without identity", complete, (d) => {
    d.audit.auditor_binding = null;
  });
  rejectState("accepted audit without report", complete, (d) => {
    d.audit.report_digest_sha256 = null;
  });
  rejectState("auditor reuses worker session", complete, (d) => {
    d.audit.auditor_binding.session_id = "session-authority";
  });
  rejectState("workers reuse one session", complete, (d) => {
    d.tracks.design_bible.worker_binding.session_id = "session-authority";
  });
  rejectState("sealed snapshot loses worker identity", sealedOnce, (d) => {
    d.sealed_snapshots[0].authority_corpus_worker_session_id = "";
  });

  for (const [label, hostile] of [
    ["empty actor", preferenceChange({changed_by: ""})],
    ["bad timestamp", preferenceChange({changed_at: "not-utc"})],
    ["bad confidence", preferenceChange({confidence: "ABSOLUTE"})],
    ["bad typed value", preferenceChange({value: {}, value_type: "STRING"})],
    ["existing key type drift", preferenceChange({value: {}, value_type: "JSON"})],
    ["bad revalidation", preferenceChange({requires_revalidation: [42]})],
  ]) {
    expectRejected(`preference mutation ${label}`, () => changePreference(state, hostile));
  }

  expectRejected("duplicate release identity", () => appendConfigurationSnapshot(
    sealedOnce, "release-001", "2026-01-02T01:00:00.000Z",
  ));
  expectRejected("non-monotonic snapshot time", () => appendConfigurationSnapshot(
    sealedOnce, "release-002", "2026-01-01T00:30:00.000Z",
  ));
  expectRejected("snapshot before evidence", () => appendConfigurationSnapshot(
    state, "release-hostile", "2026-01-02T00:00:00.000Z",
  ));
} finally {
  fs.rmSync(temporaryRoot, {recursive: true, force: true});
}

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}

console.log(
  `PASS Governance 2.1rc dynamic Bootstrap: explicit discovery choices, `
  + `typed append-only preferences, retained compatibility completion records, chained snapshots; `
  + `${hostileRejected} hostile cases rejected`,
);
