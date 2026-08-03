#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  ROOT_VARIABLES,
  applyCorpusPlan,
  canonicalCompactJson,
  compareUtf8,
  compileCorpusPlan,
  validateCorpusInputs,
} from "../control/authority-corpus.mjs";
import {
  EVIDENCE_LIBRARY_LAYOUT,
  archiveReleaseEvidence,
  compileEvidenceArchivePlan,
  verifyEvidenceArchive,
} from "../control/evidence-library.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingPath = path.join(root, "schemas/bootstrap-binding.v1.json");
const errors = [];

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readBytes = (relativePath) => fs.readFileSync(path.join(root, relativePath));
const readText = (relativePath) => readBytes(relativePath).toString("utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const normalizeText = (value) => value.replace(/\s+/g, " ").trim();

const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
const bootstrap = readText(binding.bootstrap.path);
const kernelArticle = readText(binding.portable_kernel.article_path);
const workflowArticle = readText(binding.portable_workflow.article_path);
const kernel = readJson(binding.portable_kernel.registry_path);
const workflow = readJson(binding.portable_workflow.registry_path);
const context = readJson(binding.project_context_fixture.path);
const contextTemplate = readJson(binding.project_context_template.path);
const corpusCompilerSource = readText(binding.authority_corpus_compiler.path);
const evidenceLibraryCompilerSource = readText(binding.evidence_library_compiler.path);
const campaignControllerSource = readText(binding.campaign_controller.path);
const acceptanceBridgeSource = readText(binding.acceptance_bridge.path);
const campaignControllerVerifierSource = readText(binding.campaign_controller_verifier.path);
const browserRuntimeLifecycle = readJson(binding.browser_runtime_lifecycle.path);
const browserRuntimeLifecycleVerifierSource =
  readText(binding.browser_runtime_lifecycle_verifier.path);
const dynamicBootstrapArticle = readText(binding.dynamic_bootstrap.article_path);
const dynamicBootstrap = readJson(binding.dynamic_bootstrap.registry_path);
const dynamicBootstrapControllerSource = readText(binding.dynamic_bootstrap_controller.path);
const dynamicBootstrapVerifierSource = readText(binding.dynamic_bootstrap_verifier.path);
const namingArticle = readText(binding.naming_and_terminology.article_path);
const namingRegistry = readJson(binding.naming_and_terminology.registry_path);
const bootstrapInterview = readJson(binding.bootstrap_interview.registry_path);
const bootstrapInterviewControllerSource = readText(binding.bootstrap_interview.controller_path);
const bootstrapDiscovery = readJson(binding.bootstrap_discovery.registry_path);
const bootstrapDiscoveryControllerSource = readText(binding.bootstrap_discovery.controller_path);
const legacyPreservation = readJson(binding.legacy_preservation.registry_path);
const legacyPreservationControllerSource = readText(binding.legacy_preservation.controller_path);
const deterministicZipControllerSource = readText(binding.legacy_preservation.zip_controller_path);
const bootstrapNamingMigration = readJson(binding.bootstrap_naming_migration.path);
const guidedBootstrap = readJson(binding.guided_bootstrap.registry_path);
const guidedBootstrapControllerSource = readText(binding.guided_bootstrap.controller_path);
const guidedBootstrapVerifierSource = readText(binding.guided_bootstrap.verifier_path);
const gptAssistArticle = readText(binding.gpt_assist.article_path);
const gptAssist = readJson(binding.gpt_assist.registry_path);
const gptAssistControllerSource = readText(binding.gpt_assist.controller_path);
const gptAssistVerifierSource = readText(binding.gpt_assist.verifier_path);
const questionTree = readJson(binding.question_tree.registry_path);
const questionTreeArticle = readText(binding.question_tree.article_path);
const questionTreeControllerSource = readText(binding.question_tree.controller_path);
const questionTreeVerifierSource = readText(binding.question_tree.verifier_path);
const portableAuthorityFormat = readText(binding.portable_authority_format.path);
const portabilityVerifierSource = readText(binding.portability_verifier.path);

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

function requireExactFile(entry, label) {
  requireCondition(fs.existsSync(path.join(root, entry.path)), `${label} path missing`);
  if (fs.existsSync(path.join(root, entry.path))) {
    requireCondition(sha256(readBytes(entry.path)) === entry.sha256, `${label} SHA mismatch`);
  }
}

function requireEmbeddedDigest(article, fileName, expectedDigest, label) {
  const escapedName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = article.match(new RegExp(
    `\\\`${escapedName}\\\`[^\\\`]*\\\`([0-9a-f]{64})\\\``,
    "s",
  ));
  requireCondition(Boolean(match), `${label} embedded machine-authority digest missing`);
  if (match) {
    requireCondition(match[1] === expectedDigest, `${label} embedded machine-authority digest mismatch`);
  }
}

function sampleReframeLenses(failureRootId, firstAdmittedFailedEvidenceSha256, catalog) {
  if (typeof failureRootId !== "string" || failureRootId.length === 0) {
    throw new Error("failure_root_id must be a nonempty UTF-8 string");
  }
  if (!/^[0-9a-f]{64}$/.test(firstAdmittedFailedEvidenceSha256)) {
    throw new Error("first_admitted_failed_evidence_sha256 must be 64 lowercase hexadecimal characters");
  }
  if (!Array.isArray(catalog) || catalog.length !== new Set(catalog).size) {
    throw new Error("lens catalog must contain unique identifiers");
  }
  const seedSha256 = sha256(Buffer.from(JSON.stringify([
    "governance.reframe.lens-seed.v1",
    failureRootId,
    firstAdmittedFailedEvidenceSha256,
  ]), "utf8"));
  return catalog
    .map((lens) => ({
      lens,
      rank: sha256(Buffer.from(JSON.stringify([
        "governance.reframe.lens-rank.v1",
        seedSha256,
        lens,
      ]), "utf8")),
    }))
    .sort((left, right) => compareUtf8(left.rank, right.rank) || compareUtf8(left.lens, right.lens))
    .slice(0, 1)
    .map(({lens}) => lens);
}

function validatePortableContextInstance(projectContext, template, baselineCapabilityIds) {
  const instance = projectContext.portable_template_instance;
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    throw new Error("portable_template_instance missing");
  }
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  const nonempty = (value) => typeof value === "string" && value.length > 0;
  for (const [group, requiredFields] of Object.entries(template.required)) {
    if (group === "repositories") continue;
    if (!isRecord(instance[group])) throw new Error(`portable context group missing: ${group}`);
    for (const field of requiredFields) {
      if (group === "authority_corpus_activation") continue;
      if (!(field in instance[group])) throw new Error(`portable context field missing: ${group}.${field}`);
    }
  }
  if (!Number.isInteger(instance.project_identity.context_version)
      || instance.project_identity.context_version < 1
      || !nonempty(instance.project_identity.project_name)
      || !/^[0-9a-f]{64}$/.test(instance.project_identity.exact_context_digest)) {
    throw new Error("portable project identity invalid");
  }
  const digestInput = structuredClone(instance);
  delete digestInput.project_identity.exact_context_digest;
  const expectedDigest = sha256(Buffer.from(canonicalCompactJson(digestInput), "utf8"));
  if (instance.project_identity.exact_context_digest !== expectedDigest) {
    throw new Error("portable project context digest mismatch");
  }
  if (!nonempty(instance.authority.authority_repository)
      || !/^[0-9a-f]{40}$/.test(instance.authority.exact_admitted_commit)
      || !nonempty(instance.authority.charter)
      || !Array.isArray(instance.authority.project_context_articles)
      || instance.authority.project_context_articles.length === 0
      || !instance.authority.project_context_articles.every(nonempty)
      || !Array.isArray(instance.authority.authority_order)
      || instance.authority.authority_order.length === 0
      || !instance.authority.authority_order.every(nonempty)) {
    throw new Error("portable authority binding invalid");
  }
  const corpusContext = {
    authority_corpus_roots: instance.authority_corpus_roots,
    authority_corpus_entities: instance.authority_corpus_entities,
  };
  validateCorpusInputs(corpusContext, workflow);
  const numbering = instance.authority_article_numbering;
  if (numbering.bootstrap_article !== "000"
      || numbering.governance_start !== 1
      || numbering.governance_end_exclusive !== 100
      || numbering.project_start !== 100
      || numbering.project_end_exclusive !== 200
      || numbering.feature_block_size !== 100
      || numbering.first_feature_start !== 200
      || !Array.isArray(numbering.existing_feature_blocks)
      || !nonempty(numbering.registry_path)) {
    throw new Error("portable authority article numbering invalid");
  }
  const numberingStarts = new Set();
  const numberingPrimaries = new Set();
  for (const block of numbering.existing_feature_blocks) {
    if (!isRecord(block)
        || !nonempty(block.feature_id)
        || !Number.isInteger(block.start)
        || block.start < 200
        || block.start % 100 !== 0
        || !["PRIMARY", "EXTENSION"].includes(block.kind)
        || numberingStarts.has(block.start)
        || (block.kind === "PRIMARY" && block.extends_start !== null)
        || (block.kind === "EXTENSION"
          && (!Number.isInteger(block.extends_start)
            || block.extends_start < 200
            || block.extends_start % 100 !== 0))) {
      throw new Error("portable feature article block invalid");
    }
    if (block.kind === "PRIMARY") {
      if (numberingPrimaries.has(block.feature_id)) {
        throw new Error("portable feature has duplicate primary article blocks");
      }
      numberingPrimaries.add(block.feature_id);
    }
    numberingStarts.add(block.start);
  }
  for (const block of numbering.existing_feature_blocks) {
    if (block.kind === "EXTENSION"
        && !numbering.existing_feature_blocks.some((candidate) =>
          candidate.feature_id === block.feature_id
            && candidate.start === block.extends_start)) {
      throw new Error("portable feature extension lacks a same-feature parent");
    }
  }
  for (const featureId of instance.authority_corpus_entities.feature_ids) {
    if (!numberingPrimaries.has(featureId)) {
      throw new Error("portable feature entity lacks a primary article block");
    }
  }
  const activation = instance.authority_corpus_activation.PREPARED_NOT_ACTIVATED_or_ACTIVATED;
  if (!["PREPARED_NOT_ACTIVATED", "ACTIVATED"].includes(activation)) {
    throw new Error("portable authority-corpus activation invalid");
  }
  if (!Array.isArray(instance.repositories) || instance.repositories.length === 0) {
    throw new Error("portable repositories missing");
  }
  const repositoryIds = [];
  for (const repository of instance.repositories) {
    if (!isRecord(repository)) throw new Error("portable repository record invalid");
    for (const field of template.required.repositories) {
      if (!(field in repository)) throw new Error(`portable repository field missing: ${field}`);
    }
    if (!nonempty(repository.repository_id)
        || !nonempty(repository.remote)
        || !nonempty(repository.default_branch)
        || !nonempty(repository.ownership)
        || !Array.isArray(repository.protected_paths)
        || !repository.protected_paths.every(nonempty)) {
      throw new Error("portable repository field type invalid");
    }
    repositoryIds.push(repository.repository_id);
  }
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    throw new Error("portable repository IDs duplicate");
  }
  for (const role of template.required.roles) {
    if (!nonempty(instance.roles[role])) throw new Error(`portable role invalid: ${role}`);
  }
  if (!Number.isInteger(instance.resources.maximum_parallel_writer_lanes)
      || instance.resources.maximum_parallel_writer_lanes < 1
      || !Array.isArray(instance.resources.worktree_roots)
      || instance.resources.worktree_roots.length === 0
      || !instance.resources.worktree_roots.every(nonempty)) {
    throw new Error("portable resource binding invalid");
  }
  for (const field of ["branch_namespace", "migration_namespaces", "shared_resource_namespaces"]) {
    if (!nonempty(instance.resources[field])) throw new Error(`portable resource field invalid: ${field}`);
  }
  for (const interval of template.required.operational_intervals) {
    if (!Number.isInteger(instance.operational_intervals[interval])
        || instance.operational_intervals[interval] < 1) {
      throw new Error(`portable interval invalid: ${interval}`);
    }
  }
  for (const field of template.required.release) {
    if (!nonempty(instance.release[field])) throw new Error(`portable release field invalid: ${field}`);
  }
  for (const field of template.required.protected_boundaries) {
    if (!nonempty(instance.protected_boundaries[field])) {
      throw new Error(`portable protected boundary invalid: ${field}`);
    }
  }
  const admittedCapabilities = instance.capabilities.enabled_baseline_capability_ids;
  if (!Array.isArray(admittedCapabilities)
      || new Set(admittedCapabilities).size !== admittedCapabilities.length
      || JSON.stringify([...admittedCapabilities].sort(compareUtf8))
        !== JSON.stringify([...baselineCapabilityIds].sort(compareUtf8))) {
    throw new Error("portable baseline capability binding invalid");
  }
  const extensions = instance.capabilities.typed_project_capability_extensions;
  if (!Array.isArray(extensions)) throw new Error("portable capability extensions invalid");
  for (const extension of extensions) {
    if (!isRecord(extension)) throw new Error("portable capability extension record invalid");
    for (const field of template.extension_schema.required_fields) {
      if (!(field in extension)) throw new Error(`portable capability extension field missing: ${field}`);
    }
  }
  for (const field of template.required.context_elicitation) {
    const value = instance.context_elicitation[field];
    if (field.endsWith("_extensions")) {
      if (!Array.isArray(value) || !value.every(nonempty)) {
        throw new Error(`portable context elicitation field invalid: ${field}`);
      }
    } else if (!nonempty(value)) {
      throw new Error(`portable context elicitation field invalid: ${field}`);
    }
  }
  return true;
}

function resealPortableContextInstance(projectContext) {
  const digestInput = structuredClone(projectContext.portable_template_instance);
  delete digestInput.project_identity.exact_context_digest;
  projectContext.portable_template_instance.project_identity.exact_context_digest =
    sha256(Buffer.from(canonicalCompactJson(digestInput), "utf8"));
}

requireCondition(binding.schema === "governance.governance_2_1rc_bootstrap_binding.v1", "wrong binding schema");
requireCondition(binding.release_candidate === "2.1rc", "wrong release candidate");
requireCondition(binding.status === "PREPARED_NOT_ACTIVATED", "binding is not held");
requireExactFile(binding.bootstrap, "bootstrap");
requireExactFile(binding.user_readme, "user README");
requireExactFile({
  path: binding.portable_kernel.article_path,
  sha256: binding.portable_kernel.article_sha256,
}, "kernel article");
requireExactFile({
  path: binding.portable_kernel.registry_path,
  sha256: binding.portable_kernel.registry_sha256,
}, "kernel registry");
requireExactFile({
  path: binding.portable_workflow.article_path,
  sha256: binding.portable_workflow.article_sha256,
}, "workflow article");
requireExactFile({
  path: binding.portable_workflow.registry_path,
  sha256: binding.portable_workflow.registry_sha256,
}, "workflow registry");
requireExactFile(binding.project_context_template, "project-context template");
requireExactFile(binding.project_context_fixture, "project-context fixture");
requireExactFile(binding.authority_corpus_compiler, "authority-corpus compiler");
requireExactFile(binding.evidence_library_compiler, "evidence-library compiler");
requireExactFile(binding.campaign_controller, "campaign controller");
requireExactFile(binding.acceptance_bridge, "Product-acceptance compiler bridge");
requireExactFile(binding.campaign_controller_verifier, "campaign-controller verifier");
requireExactFile(binding.browser_runtime_lifecycle, "browser/runtime/lifecycle registry");
requireExactFile(
  binding.browser_runtime_lifecycle_verifier,
  "browser/runtime/lifecycle verifier",
);
requireExactFile({
  path: binding.dynamic_bootstrap.article_path,
  sha256: binding.dynamic_bootstrap.article_sha256,
}, "dynamic Bootstrap article");
requireExactFile({
  path: binding.dynamic_bootstrap.registry_path,
  sha256: binding.dynamic_bootstrap.registry_sha256,
}, "dynamic Bootstrap registry");
requireExactFile(binding.dynamic_bootstrap_controller, "dynamic Bootstrap controller");
requireExactFile(binding.dynamic_bootstrap_verifier, "dynamic Bootstrap verifier");
requireExactFile({
  path: binding.naming_and_terminology.article_path,
  sha256: binding.naming_and_terminology.article_sha256,
}, "naming article");
requireExactFile({
  path: binding.naming_and_terminology.registry_path,
  sha256: binding.naming_and_terminology.registry_sha256,
}, "naming registry");
requireExactFile({
  path: binding.bootstrap_interview.registry_path,
  sha256: binding.bootstrap_interview.registry_sha256,
}, "Bootstrap Interview registry");
requireExactFile({
  path: binding.bootstrap_interview.controller_path,
  sha256: binding.bootstrap_interview.controller_sha256,
}, "Bootstrap Interview controller");
requireExactFile({
  path: binding.bootstrap_discovery.registry_path,
  sha256: binding.bootstrap_discovery.registry_sha256,
}, "Bootstrap Discovery registry");
requireExactFile({
  path: binding.bootstrap_discovery.controller_path,
  sha256: binding.bootstrap_discovery.controller_sha256,
}, "Bootstrap Discovery controller");
requireExactFile({
  path: binding.legacy_preservation.registry_path,
  sha256: binding.legacy_preservation.registry_sha256,
}, "legacy-preservation registry");
requireExactFile({
  path: binding.legacy_preservation.controller_path,
  sha256: binding.legacy_preservation.controller_sha256,
}, "legacy-preservation controller");
requireExactFile({
  path: binding.legacy_preservation.zip_controller_path,
  sha256: binding.legacy_preservation.zip_controller_sha256,
}, "deterministic ZIP controller");
requireExactFile(binding.bootstrap_naming_migration, "Bootstrap naming migration");
requireExactFile(binding.bootstrap_alignment_verifier, "Bootstrap alignment verifier");
requireExactFile({
  path: binding.guided_bootstrap.registry_path,
  sha256: binding.guided_bootstrap.registry_sha256,
}, "guided Bootstrap registry");
requireExactFile({
  path: binding.guided_bootstrap.controller_path,
  sha256: binding.guided_bootstrap.controller_sha256,
}, "guided Bootstrap controller");
requireExactFile({
  path: binding.guided_bootstrap.verifier_path,
  sha256: binding.guided_bootstrap.verifier_sha256,
}, "guided Bootstrap verifier");
requireExactFile({
  path: binding.gpt_assist.article_path,
  sha256: binding.gpt_assist.article_sha256,
}, "GPT_ASSIST article");
requireExactFile({
  path: binding.gpt_assist.registry_path,
  sha256: binding.gpt_assist.registry_sha256,
}, "GPT_ASSIST registry");
requireExactFile({
  path: binding.gpt_assist.controller_path,
  sha256: binding.gpt_assist.controller_sha256,
}, "GPT_ASSIST controller");
requireExactFile({
  path: binding.gpt_assist.verifier_path,
  sha256: binding.gpt_assist.verifier_sha256,
}, "GPT_ASSIST verifier");
requireExactFile({
  path: binding.question_tree.article_path,
  sha256: binding.question_tree.article_sha256,
}, "question-tree article");
requireExactFile({
  path: binding.question_tree.registry_path,
  sha256: binding.question_tree.registry_sha256,
}, "question-tree registry");
requireExactFile({
  path: binding.question_tree.controller_path,
  sha256: binding.question_tree.controller_sha256,
}, "question-tree controller");
requireExactFile({
  path: binding.question_tree.verifier_path,
  sha256: binding.question_tree.verifier_sha256,
}, "question-tree verifier");
requireExactFile(binding.portable_authority_format, "portable authority format");
requireExactFile(binding.portability_verifier, "portability verifier");
requireEmbeddedDigest(
  kernelArticle,
  binding.portable_kernel.registry_path,
  binding.portable_kernel.registry_sha256,
  "kernel article",
);
requireEmbeddedDigest(
  workflowArticle,
  binding.portable_workflow.registry_path,
  binding.portable_workflow.registry_sha256,
  "workflow article",
);
const expectedBoundPayloadPaths = [
  binding.bootstrap.path,
  binding.user_readme.path,
  binding.portable_kernel.article_path,
  binding.portable_workflow.article_path,
  "schemas/bootstrap-binding.v1.json",
  binding.portable_workflow.registry_path,
  binding.portable_kernel.registry_path,
  binding.project_context_template.path,
  binding.project_context_fixture.path,
  binding.authority_corpus_compiler.path,
  binding.evidence_library_compiler.path,
  binding.campaign_controller.path,
  binding.acceptance_bridge.path,
  binding.campaign_controller_verifier.path,
  binding.browser_runtime_lifecycle.path,
  binding.browser_runtime_lifecycle_verifier.path,
  binding.dynamic_bootstrap.article_path,
  binding.dynamic_bootstrap.registry_path,
  binding.dynamic_bootstrap_controller.path,
  binding.dynamic_bootstrap_verifier.path,
  binding.naming_and_terminology.article_path,
  binding.naming_and_terminology.registry_path,
  binding.bootstrap_interview.registry_path,
  binding.bootstrap_interview.controller_path,
  binding.bootstrap_discovery.registry_path,
  binding.bootstrap_discovery.controller_path,
  binding.legacy_preservation.registry_path,
  binding.legacy_preservation.controller_path,
  binding.legacy_preservation.zip_controller_path,
  binding.bootstrap_naming_migration.path,
  binding.bootstrap_alignment_verifier.path,
  binding.guided_bootstrap.registry_path,
  binding.guided_bootstrap.controller_path,
  binding.guided_bootstrap.verifier_path,
  binding.gpt_assist.article_path,
  binding.gpt_assist.registry_path,
  binding.gpt_assist.controller_path,
  binding.gpt_assist.verifier_path,
  binding.question_tree.article_path,
  binding.question_tree.registry_path,
  binding.question_tree.controller_path,
  binding.question_tree.verifier_path,
  binding.portable_authority_format.path,
  binding.portability_verifier.path,
];
requireCondition(
  expectedBoundPayloadPaths.length === 44
    && new Set(expectedBoundPayloadPaths).size === 44,
  "portable payload inventory is not exact",
);

requireCondition(kernel.schema === "governance.portable_kernel.v1", "wrong portable-kernel schema");
requireCondition(kernel.release_candidate === "2.1rc", "kernel is not 2.1rc");
requireCondition(workflow.schema === "governance.portable_capability_worktree_registry.v1", "wrong workflow schema");
requireCondition(workflow.release_candidate === "2.1rc", "workflow is not 2.1rc");
requireCondition(context.schema === "governance.project_context_fixture.v1", "wrong project-context fixture schema");
requireCondition(contextTemplate.schema === "governance.project_context_template.v1", "wrong project-context template schema");
requireCondition(context.kernel?.override_allowed === false, "project context can override kernel");
requireCondition(
  dynamicBootstrap.schema === "governance.dynamic_bootstrap_contract.v1"
    && dynamicBootstrap.status
      === "RETAINED_COMPATIBILITY_DISCOVERY_ONLY_NOT_SETUP_AUTHORITY"
    && dynamicBootstrap.bootstrap_role.display_name === "Bootstrap 2.1rc"
    && dynamicBootstrap.bootstrap_role.question_cardinality === 1
    && dynamicBootstrap.bootstrap_role.discovery_before_questions === true
    && dynamicBootstrap.history.current_preferences_mutable === true
    && dynamicBootstrap.history.sealed_release_snapshots_mutable === false
    && dynamicBootstrap.history.preference_history.includes("APPEND_ONLY")
    && dynamicBootstrap.history.snapshot_transition.includes("PREFIX_PRESERVED")
    && dynamicBootstrap.discovery.repository_boundary.includes("GIT_TOP_LEVEL")
    && dynamicBootstrap.discovery.remote_url.includes("REJECT_CREDENTIAL")
    && dynamicBootstrap.discovery.detected_sources.includes("NEVER_AUTOMATIC")
    && dynamicBootstrap.preference_schema.value_type === "STABLE_PER_GROUP_AND_KEY"
    && dynamicBootstrap.setup_execution.sole_writer === "BOUND_BOOTSTRAP_SESSION"
    && dynamicBootstrap.setup_execution.normative_controller
      === "control/guided-bootstrap.mjs"
    && dynamicBootstrap.setup_execution.legacy_controller_authority
      === "DISCOVERY_PREFERENCE_HISTORY_AND_SNAPSHOT_COMPATIBILITY_ONLY"
    && dynamicBootstrap.setup_execution.separate_authority_corpus_worker === false
    && dynamicBootstrap.setup_execution.separate_design_bible_worker === false
    && dynamicBootstrap.setup_execution.separate_intent_worker === false
    && dynamicBootstrap.provider_auth.browser === "CONFIGURATION_SNAPSHOT_SELECTED"
    && dynamicBootstrap.setup_execution.independent_audit.includes("DISTINCT")
    && normalizeText(dynamicBootstrapArticle).includes("one unresolved material question at a time")
    && dynamicBootstrapControllerSource.includes("nextBootstrapQuestion")
    && dynamicBootstrapVerifierSource.includes("chained snapshots"),
  "dynamic Bootstrap configurator authority is incomplete",
);
requireCondition(
  guidedBootstrap.schema === "governance.guided_bootstrap_contract.v1"
    && guidedBootstrap.status === "RETAINED_COMPATIBILITY_ONLY"
    && guidedBootstrap.canonical_contract === "schemas/bootstrap-interview.v1.json"
    && guidedBootstrap.sole_writer === "BOOTSTRAP"
    && guidedBootstrap.first_question.prompt
      === "Do you want to use ChatGPT (recommended), or work with Bootstrap directly?"
    && guidedBootstrap.chatgpt_role.authority === "ADVISORY_ONLY"
    && guidedBootstrap.chatgpt_role.custody === "NONE"
    && guidedBootstrap.execution.separate_authority_corpus_worker === false
    && guidedBootstrap.execution.separate_design_bible_worker === false
    && guidedBootstrap.source_inputs.read_only === true
    && guidedBootstrap.source_inputs.operation_consistency.IMPORT_OR_ALIGN
      === "REQUIRES_EXACT_NON_NONE_SOURCE"
    && guidedBootstrap.execution.phase_output.includes("APPEND_ONLY_CANONICAL_SHA256")
    && guidedBootstrap.execution.setup_audit
      === "DISTINCT_AUDITOR_CANONICAL_SHA256"
    && guidedBootstrap.execution.launch_states
      === "STRICT_CONVERSES_REJECT_PREMATURE_LATER_EVIDENCE"
    && guidedBootstrap.portable_article_numbering.bootstrap === "000"
    && guidedBootstrap.portable_article_numbering.governance === "[0001,0100)"
    && guidedBootstrap.portable_article_numbering.general_project_context
      === "[0100,0200)"
    && guidedBootstrap.portable_article_numbering.feature_block_size === 100
    && guidedBootstrap.portable_article_numbering.identity === "IMMUTABLE_NO_RENUMBER"
    && guidedBootstrap.portable_article_numbering.feature_slots.length === 23
    && guidedBootstrap.portable_article_numbering.article_header.length === 9
    && guidedBootstrap.portable_article_numbering.gate_schema
      .lifecycle_and_evidence_are_separate === true
    && guidedBootstrap.portable_article_numbering.gate_schema.dependency_graph
      === "EXACT_REFERENCES_AND_ACYCLIC"
    && guidedBootstrapControllerSource.includes("compilePortableArticleNumbering")
    && normalizeText(portableAuthorityFormat).includes("immutable half-open numeric article blocks")
    && normalizeText(portableAuthorityFormat).includes("Active campaign files live under")
    && normalizeText(portableAuthorityFormat).includes("Common article header")
    && guidedBootstrap.completion.first_auditor.model
      === "RESOLVED_FROM_USER_MODEL_RULES"
    && guidedBootstrap.completion.Bootstrap_exit.unpin === true
    && guidedBootstrapControllerSource.includes("compileFirstAuditActivation")
    && guidedBootstrapControllerSource.includes("completeGuidedBootstrapExit")
    && guidedBootstrapControllerSource.includes("renderChatGptExchangeMarkdown")
    && guidedBootstrapVerifierSource.includes("guided Bootstrap PASS")
    && guidedBootstrap.exchange_artifacts.human === "PLAIN_MARKDOWN_PROMPT",
  "guided Bootstrap authority is incomplete",
);
requireCondition(
  namingRegistry.schema === "agentos.naming_and_terminology.v1"
    && namingRegistry.status === "PREPARED_NOT_ACTIVATED"
    && namingRegistry.compatibility_aliases["guided-bootstrap"] === "bootstrap-interview"
    && namingRegistry.compatibility_aliases["dynamic-bootstrap"] === "bootstrap-discovery"
    && namingRegistry.compatibility_aliases.ECO === "ECO_CONTINUOUS"
    && namingRegistry.compatibility_aliases.successor_wave === "next_campaign_candidate"
    && namingRegistry.canonical_paths.bootstrap_discovery_contract
      === "schemas/bootstrap-discovery.v1.json"
    && normalizeText(namingArticle).includes("one canonical name")
    && normalizeText(namingArticle).includes("Next-Campaign Candidate")
    && normalizeText(namingArticle).includes("compatibility aliases")
    && bootstrapNamingMigration.schema === "agentos.bootstrap_naming_migration.v1"
    && bootstrapNamingMigration.campaign_aliases.successor_wave
      === "next_campaign_candidate"
    && bootstrapNamingMigration.status === "PREPARED_NOT_ACTIVATED",
  "naming and terminology authority is incomplete",
);
requireCondition(
  bootstrapInterview.schema === "agentos.bootstrap_interview_contract.v1"
    && bootstrapInterview.status === "PREPARED_NOT_ACTIVATED"
    && bootstrapInterview.discovery_permission.question_id === "bootstrap.discovery.mode"
    && bootstrapInterview.discovery_permission.recommended === "RECOMMENDED"
    && bootstrapInterview.legacy_preservation.required_before_build === true
    && bootstrapInterview.model_profiles.ECO_CONTINUOUS.work_slots === 20
    && bootstrapInterview.model_profiles.STANDARD_WORKWEEK.window_hours === 40
    && bootstrapInterviewControllerSource.includes("planBootstrapInterview")
    && bootstrapInterviewControllerSource.includes("BELOW_COMPLETION_FLOOR")
    && bootstrapDiscoveryControllerSource.includes("discoverProject"),
  "Bootstrap Interview authority is incomplete",
);
requireCondition(
  bootstrapDiscovery.schema === "agentos.bootstrap_discovery_contract.v1"
    && bootstrapDiscovery.status === "PREPARED_NOT_ACTIVATED"
    && bootstrapDiscovery.permission.required_before_execution === true
    && bootstrapDiscovery.result.schema === "agentos.bootstrap_discovery_result.v1"
    && bootstrapDiscovery.fact_states.includes("OBSERVED_FACT")
    && bootstrapDiscovery.fact_states.includes("CANDIDATE_INTERPRETATION")
    && bootstrapDiscovery.fact_states.includes("CONFLICT")
    && bootstrapDiscovery.fact_states.includes("UNKNOWN")
    && bootstrapDiscovery.operations.authentication_attempted === false
    && bootstrapDiscovery.inspection.forbidden.includes("provider login or auth-status commands")
    && bootstrapDiscoveryControllerSource.includes("authentication_attempted: false")
    && !bootstrapDiscoveryControllerSource.includes("auth\", \"status\""),
  "Bootstrap Discovery authority is incomplete",
);
requireCondition(
  legacyPreservation.schema === "agentos.legacy_preservation_contract.v1"
    && legacyPreservation.status === "PREPARED_NOT_ACTIVATED"
    && legacyPreservation.artifacts.archive === "legacy.zip"
    && legacyPreservation.artifacts.manifest === "legacy.manifest.json"
    && legacyPreservation.rejection.some((item) => item.includes("symbolic links"))
    && legacyPreservationControllerSource.includes("preserved_before_build")
    && legacyPreservationControllerSource.includes("parseStoredZip")
    && deterministicZipControllerSource.includes("buildStoredZip"),
  "legacy-preservation authority is incomplete",
);
requireCondition(
  gptAssist.schema === "governance.gpt_assist_authority.v1"
    && gptAssist.status === "PREPARED_NOT_ACTIVATED"
    && gptAssist.bootstrap_preference.question_id === "workflow.gpt_assist_mode"
    && gptAssist.chatgpt.cadence === "ONE_QUESTION_THEN_WAIT"
    && gptAssist.chatgpt.question_source === "ONLY_THE_AUDITOR_STATUS_MARKDOWN"
    && gptAssist.chatgpt.sufficiency_rule.includes("STOP_WHEN_EVERY_LISTED")
    && gptAssist.next_campaign_handoff.auditor_writes_authority === false
    && gptAssist.next_campaign_handoff.response_import
      .includes("EXACTLY ONE CANONICAL JSON PAYLOAD")
    && gptAssist.next_campaign_handoff.chronology
      .includes("STATUS_GENERATED_AT_STRICTLY_PRECEDES")
    && gptAssist.next_campaign_handoff.git_reality.includes("COMMIT_TO_TREE")
    && gptAssist.next_campaign_handoff.next_release_orchestrator_action
      === "VALIDATE_HANDOFF_UPDATE_WORK_IN_PROGRESS_AUTHORITY_AND_BEGIN_NEXT_RELEASE"
    && gptAssist.next_campaign_handoff.standard_article_promotion
      === "FORBIDDEN_BEFORE_ACCEPTED_LIVE_CLOSURE"
    && normalizeText(gptAssistArticle).includes("The Auditor remains read-only")
    && normalizeText(gptAssistArticle).includes("next Campaign Orchestrator")
    && gptAssistControllerSource.includes("compileGptAssistStatus")
    && gptAssistControllerSource.includes("compileGptAssistResponseImport")
    && gptAssistControllerSource.includes("verifyGptAssistSourceGit")
    && gptAssistControllerSource.includes("compileGptAssistRosterReceipt")
    && gptAssistControllerSource.includes("renderGptAssistResponseMarkdown")
    && gptAssistControllerSource.includes("compileGptAssistNextCampaignHandoff")
    && gptAssistVerifierSource.includes("GPT_ASSIST PASS"),
  "GPT_ASSIST campaign-context authority is incomplete",
);

const genericForbiddenTokens = [
  ["/", "Users", "/"].join(""),
  "REPOSITORY_OWNER_SENTINEL",
  "PRIVATE_PROVIDER_ACCOUNT_SENTINEL",
  "PROJECT_SPECIFIC_SENTINEL",
  "PRIVATE_HOST_PATH_SENTINEL",
  "PRIVATE_URL_SENTINEL",
];
const kernelBytes = JSON.stringify(kernel);
const workflowBytes = JSON.stringify(workflow);
const contextTemplateBytes = JSON.stringify(contextTemplate);
const gptAssistBytes = JSON.stringify(gptAssist);
const containsPortableContextLeak = (payload) =>
  genericForbiddenTokens.some((token) => payload.includes(token));
for (const token of genericForbiddenTokens) {
  requireCondition(!kernelBytes.includes(token), `portable kernel leaks project context token: ${token}`);
  requireCondition(!kernelArticle.includes(token), `portable kernel article leaks project context token: ${token}`);
  requireCondition(!workflowBytes.includes(token), `portable workflow leaks project context token: ${token}`);
  requireCondition(!workflowArticle.includes(token), `portable workflow article leaks project context token: ${token}`);
  requireCondition(!contextTemplateBytes.includes(token), `project-context template leaks project context token: ${token}`);
  requireCondition(!corpusCompilerSource.includes(token), `authority-corpus compiler leaks project context token: ${token}`);
  requireCondition(!evidenceLibraryCompilerSource.includes(token), `evidence-library compiler leaks project context token: ${token}`);
  requireCondition(!campaignControllerSource.includes(token), `campaign controller leaks project context token: ${token}`);
  requireCondition(!campaignControllerVerifierSource.includes(token), `campaign-controller verifier leaks project context token: ${token}`);
  requireCondition(!gptAssistArticle.includes(token), `GPT_ASSIST article leaks project context token: ${token}`);
  requireCondition(!gptAssistBytes.includes(token), `GPT_ASSIST registry leaks project context token: ${token}`);
  requireCondition(!gptAssistControllerSource.includes(token), `GPT_ASSIST controller leaks project context token: ${token}`);
  requireCondition(!gptAssistVerifierSource.includes(token), `GPT_ASSIST verifier leaks project context token: ${token}`);
}
let portabilityHostileRejected = 0;
for (const [label, payload] of [
  ["kernel article project identity", `${kernelArticle}\nPROJECT_SPECIFIC_SENTINEL`],
  ["kernel registry provider identity", `${kernelBytes} PRIVATE_PROVIDER_ACCOUNT_SENTINEL`],
  ["workflow article private path", `${workflowArticle}\nPRIVATE_HOST_PATH_SENTINEL`],
  ["workflow registry private URL", `${workflowBytes} PRIVATE_URL_SENTINEL`],
  ["context template repository owner", `${contextTemplateBytes} REPOSITORY_OWNER_SENTINEL`],
  ["authority-corpus compiler project identity", `${corpusCompilerSource} PROJECT_SPECIFIC_SENTINEL`],
  ["evidence-library compiler private path", `${evidenceLibraryCompilerSource} PRIVATE_HOST_PATH_SENTINEL`],
  ["campaign controller provider identity", `${campaignControllerSource} PRIVATE_PROVIDER_ACCOUNT_SENTINEL`],
  ["campaign-controller verifier project identity", `${campaignControllerVerifierSource} PROJECT_SPECIFIC_SENTINEL`],
  ["GPT_ASSIST article private URL", `${gptAssistArticle} PRIVATE_URL_SENTINEL`],
  ["GPT_ASSIST registry project identity", `${gptAssistBytes} PROJECT_SPECIFIC_SENTINEL`],
  ["GPT_ASSIST controller private path", `${gptAssistControllerSource} PRIVATE_HOST_PATH_SENTINEL`],
  ["GPT_ASSIST verifier provider identity", `${gptAssistVerifierSource} PRIVATE_PROVIDER_ACCOUNT_SENTINEL`],
]) {
  if (containsPortableContextLeak(payload)) {
    portabilityHostileRejected += 1;
  } else {
    errors.push(`portability hostile mutation accepted: ${label}`);
  }
}
requireCondition(context.project_name === "Portable Fixture", "project-context fixture identity changed");

const expectedGateStates = [
  "PASS_WITH_EVIDENCE",
  "FAIL_ACTIVE_REPAIR",
  "UNPROVEN_ACTIVE_EVIDENCE",
  "NOT_APPLICABLE_WITH_EXACT_AUTHORITY",
  "OWNER_ONLY",
];
requireCondition(
  JSON.stringify(kernel.control_plane_gate_states) === JSON.stringify(expectedGateStates),
  "control-plane gate states changed",
);
requireCondition(
  JSON.stringify(kernel.product_question_dispositions) === JSON.stringify([
    "YES_WITH_EVIDENCE", "NO", "UNKNOWN", "NOT_APPLICABLE_WITH_PROOF",
    "EXCEPTION_REQUESTED", "AUTHORIZED_EXCEPTION", "BLOCKED_AUTHORITY_BOUNDARY",
  ]),
  "product question dispositions changed",
);
requireCondition(
  JSON.stringify(kernel.macro_stages) === JSON.stringify([
    "BLUEPRINT", "BUILD", "LAUNCH", "LIVE_AUDIT", "IMPROVE",
  ]),
  "macro stages changed",
);

const requiredLaws = [
  "authority_source",
  "governance_context_separation",
  "machine_first_governance",
  "authority_corpus_lifecycle",
  "compact_context_and_evidence_library",
  "portable_campaign_control_and_recovery",
  "context_elicitation_and_blockers",
  "governance_value_and_causality",
  "dynamic_bootstrap_configurator",
  "portable_authority_format",
  "gpt_assist_campaign_context",
  "executable_question_tree_acceptance",
  "execution_autonomy_and_communication",
  "reframing",
  "root_cause",
  "failure_reframe",
  "case_evaluation",
  "single_goal",
  "materiality_filter",
  "blueprint_budget",
  "delegated_stage_transition",
  "audit_deployment_boundary",
  "authority_reality_split",
  "draft_and_seal",
  "mechanical_receipts",
  "proportionality",
  "owner_only_filter",
  "handoff",
];
for (const law of requiredLaws) {
  requireCondition(Boolean(kernel.laws?.[law]), `missing kernel law ${law}`);
}

requireCondition(kernel.laws.single_goal.retained_2_0rc_behavior === true, "single-goal law not retained");
requireCondition(
  kernel.laws.machine_first_governance.normative_rule.includes("normative operational authority")
    && kernel.laws.machine_first_governance.pseudocode_role.includes("mechanically equivalent")
    && kernel.laws.machine_first_governance.conflict.includes("fails closed"),
  "machine-first governance law changed",
);
requireCondition(
  kernel.laws.authority_corpus_lifecycle.rule.includes("authority-corpus compiler")
    && kernel.laws.authority_corpus_lifecycle.generation.includes("never invent facts")
    && kernel.laws.authority_corpus_lifecycle.maintenance.includes("refresh only affected current pages")
    && kernel.laws.authority_corpus_lifecycle.platform_context.includes("pseudocode")
    && kernel.laws.authority_corpus_lifecycle.boundary.includes("grants no Product"),
  "authority-corpus lifecycle law changed",
);
requireCondition(
  kernel.feature_progress_states.length === 7
    && kernel.gate_audit_states.length === 6
    && kernel.laws.compact_context_and_evidence_library.gate_register.includes("Independent Auditor")
    && kernel.laws.compact_context_and_evidence_library.archive.includes("deterministic content-addressed ZIP")
    && kernel.laws.compact_context_and_evidence_library.preservation.includes("never deleted as information")
    && kernel.laws.compact_context_and_evidence_library.historical_read.includes("selectively"),
  "compact context or evidence-library law changed",
);
requireCondition(
  kernel.laws.context_elicitation_and_blockers.rule.includes("one material question at a time")
    && kernel.laws.context_elicitation_and_blockers.fill.includes("mechanical runtime evidence")
    && kernel.laws.context_elicitation_and_blockers.stop.includes("first bounded batch")
    && kernel.laws.context_elicitation_and_blockers.continuity.includes("unaffected")
    && kernel.laws.context_elicitation_and_blockers.anti_interrogation.includes("Exhaustive questioning"),
  "context elicitation or blocker law changed",
);
requireCondition(
  kernel.mission.includes("least necessary owner attention")
    && kernel.north_star_rule.includes("greatest verified forward")
    && kernel.governance_value_test.includes("ADVANCE_VERIFIED_PRODUCT_PROGRESS")
    && kernel.laws.governance_value_and_causality.repair.includes("One causal root")
    && kernel.laws.governance_value_and_causality.continuity.includes("dependent scope")
    && kernel.laws.governance_value_and_causality.owner_boundary.includes("Ordinary tests"),
  "mission, governance value, or causal autonomy law changed",
);
requireCondition(
  kernel.laws.dynamic_bootstrap_configurator.rule.includes("discovers")
    && kernel.laws.dynamic_bootstrap_configurator.rule.includes("one unresolved material question")
    && kernel.laws.dynamic_bootstrap_configurator.rule.includes("inherited parent repositories")
    && kernel.laws.dynamic_bootstrap_configurator.preferences.includes("changeable")
    && kernel.laws.dynamic_bootstrap_configurator.preferences.includes("append-only digest chain")
    && kernel.laws.dynamic_bootstrap_configurator.preferences.includes("schema migration")
    && kernel.laws.dynamic_bootstrap_configurator.environment.includes("verified permission")
    && kernel.laws.dynamic_bootstrap_configurator.execution.includes("sole setup writer")
    && kernel.laws.dynamic_bootstrap_configurator.execution.includes("ChatGPT-guided")
    && kernel.laws.dynamic_bootstrap_configurator.execution.includes("actively building the initial campaign")
    && kernel.laws.dynamic_bootstrap_configurator.completion.includes("private chat context")
    && kernel.laws.dynamic_bootstrap_configurator.boundary.includes("rewrite sealed history"),
  "dynamic Bootstrap configurator law changed",
);
requireCondition(
  kernel.laws.gpt_assist_campaign_context.rule.includes("independent Auditor")
    && kernel.laws.gpt_assist_campaign_context.interaction
      .includes("exactly one listed question")
    && kernel.laws.gpt_assist_campaign_context.interaction
      .includes("adds no questionnaire")
    && kernel.laws.gpt_assist_campaign_context.interaction
      .includes("stops when every listed material question")
    && kernel.laws.gpt_assist_campaign_context.authority
      .includes("canonical JSON payload")
    && kernel.laws.gpt_assist_campaign_context.authority
      .includes("next Campaign Orchestrator")
    && kernel.laws.gpt_assist_campaign_context.authority
      .includes("accepted-live only")
    && kernel.laws.gpt_assist_campaign_context.portability
      .includes("without private chat history"),
  "GPT_ASSIST campaign-context law changed",
);
requireCondition(
  kernel.laws.executable_question_tree_acceptance.rule.includes("exactly three ordered roots")
    && kernel.laws.executable_question_tree_acceptance.dispositions.includes("YES_WITH_EVIDENCE")
    && kernel.laws.executable_question_tree_acceptance.dispositions.includes("weighted aggregates")
    && kernel.laws.executable_question_tree_acceptance.autonomy.includes("UNKNOWN")
    && kernel.laws.executable_question_tree_acceptance.parallelism.includes("affected surface")
    && kernel.laws.executable_question_tree_acceptance.control_plane.includes("rather than additional"),
  "executable question-tree law changed",
);
requireCondition(
  JSON.stringify(questionTree.acceptance_roots)
    === JSON.stringify(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"])
    && questionTree.final_admission.includes("FUNCTION_REQUIREMENTS_PASS")
    && questionTree.admission_proof.schema === "governance.product_acceptance_proof.v1"
    && questionTree.admission_proof.required_inputs.includes("auditor_attestation")
    && questionTree.admission_proof.rule.includes("recomputes")
    && questionTree.dispositions.length === 7
    && questionTree.question_contract.question_rules.some((rule) => rule.includes("Confidence scores"))
    && questionTree.minimum_live_rc.required_demonstrations.length >= 9,
  "question-tree registry contract changed",
);
requireCondition(
  questionTreeArticle.includes("exactly three ordered Product-acceptance roots")
    && questionTreeControllerSource.includes("compileAcceptance")
    && questionTreeVerifierSource.includes("hostile cases"),
  "question-tree article/controller/verifier binding changed",
);
requireCondition(
  kernel.laws.portable_campaign_control_and_recovery.rule
    .includes("living worktree-carried record")
    && kernel.laws.portable_campaign_control_and_recovery.rule
      .includes("exclusive no-follow creation")
    && kernel.laws.portable_campaign_control_and_recovery.rule
      .includes("Platform returns bind their exact spawn event")
    && kernel.laws.portable_campaign_control_and_recovery.dependency_handoff
      .includes("append-only campaign ledger")
    && kernel.laws.portable_campaign_control_and_recovery.portability
      .includes("pushed cumulative root carries")
    && kernel.laws.portable_campaign_control_and_recovery.boundary
      .includes("not Product custody"),
  "living campaign record or handoff law changed",
);
requireCondition(
  kernel.laws.execution_autonomy_and_communication.rule.includes("technical puzzles autonomously")
    && kernel.laws.execution_autonomy_and_communication.communication_budget.includes("one consolidated")
    && kernel.laws.execution_autonomy_and_communication.local_problem_rule.includes("remain local")
    && kernel.laws.execution_autonomy_and_communication.real_blocker_threshold.includes("safe in-scope alternatives are exhausted")
    && kernel.laws.execution_autonomy_and_communication.continuity.includes("dependent outcome")
    && kernel.laws.execution_autonomy_and_communication.forbidden.includes("scope expansion"),
  "specialist execution autonomy or communication budget changed",
);
requireCondition(
  kernel.laws.case_evaluation.self_tightening.includes("materially distinct"),
  "self-tightening case mechanism was weakened",
);
requireCondition(
  kernel.laws.failure_reframe.owner.includes("direct supervising agent"),
  "failure reframe is not supervisor-owned",
);
requireCondition(
  kernel.laws.failure_reframe.trigger.includes("same mechanism fails twice")
    && kernel.laws.failure_reframe.trigger.includes("governed progress interval"),
  "failure reframe trigger threshold changed",
);
requireCondition(
  kernel.laws.failure_reframe.non_trigger.includes("localized failure")
    && kernel.laws.failure_reframe.non_trigger.includes("builder fixes"),
  "bounded builder correction path missing",
);
requireCondition(
  kernel.laws.failure_reframe.lens_selection.selected_lens_count === 1,
  "failure reframe lens count changed",
);
requireCondition(
  kernel.laws.failure_reframe.rule.includes("exactly one reproducibly selected reframing lens")
    && !/\bmultiple\b|\blenses\b/.test(kernel.laws.failure_reframe.rule),
  "failure reframe machine rule permits plural-lens ceremony",
);
requireCondition(
  kernel.laws.failure_reframe.lens_selection.lenses.length === 9,
  "failure reframe lens catalog changed",
);
requireCondition(
  kernel.laws.failure_reframe.lens_selection.algorithm.includes("governance.reframe.lens-seed.v1")
    && kernel.laws.failure_reframe.lens_selection.algorithm.includes("governance.reframe.lens-rank.v1")
    && kernel.laws.failure_reframe.lens_selection.algorithm.includes("first_admitted_failed_evidence_sha256")
    && kernel.laws.failure_reframe.lens_selection.algorithm.includes("Later evidence attaches without reseeding"),
  "failure reframe lens selection is not reproducible",
);
requireCondition(
  kernel.laws.failure_reframe.supervisor_liveness.continuity.includes("same-role continuity deputy")
    && kernel.laws.failure_reframe.supervisor_liveness.boundary.includes("no broader custody"),
  "supervisor continuity boundary missing",
);
requireCondition(
  kernel.laws.failure_reframe.technical_advice.includes("one bounded technical recommendation")
    && kernel.laws.failure_reframe.technical_advice.includes("does not transfer"),
  "bounded technical-advice rule missing",
);
requireCondition(
  kernel.laws.failure_reframe.builder_feasibility_objection.includes("one evidence-backed feasibility objection")
    && kernel.laws.failure_reframe.builder_feasibility_objection.includes("once"),
  "bounded builder objection missing",
);
requireCondition(
  kernel.laws.failure_reframe.required_steps.some((step) => step.includes("builder freezes")),
  "builder failure-preservation boundary missing",
);
requireCondition(
  kernel.laws.failure_reframe.required_steps.some((step) => step.includes("direct supervisor returns")),
  "supervisor route-decision boundary missing",
);
requireCondition(
  kernel.laws.failure_reframe.loop_control.includes("may not repeatedly self-reframe"),
  "builder self-reframe loop is not prohibited",
);
requireCondition(
  kernel.laws.materiality_filter.nonblocking_rule.includes("continue the active stage"),
  "nonmaterial discrepancies can block",
);
requireCondition(
  kernel.laws.materiality_filter.blocking_dimensions.length === 8,
  "materiality dimensions changed",
);
requireCondition(
  kernel.laws.blueprint_budget.forbidden.includes("future checkpoint evidence"),
  "future checkpoint can become a Blueprint prerequisite",
);
requireCondition(
  kernel.laws.delegated_stage_transition.central_required_only_for.length === 7,
  "Central boundary changed",
);
requireCondition(
  kernel.laws.delegated_stage_transition.central_forbidden.includes("routine per-stage reviewer"),
  "Central bottleneck prohibition missing",
);

const exactDeploymentBlockers = [
  "RUNTIME_ENVIRONMENT_EXECUTION_FAILURE",
  "RELEASE_ARTIFACT_IDENTITY_OR_INTEGRITY_MISMATCH",
  "TARGET_OR_ROLLBACK_AUTHORITY_UNAVAILABLE",
  "HIGHER_AUTHORITY_EMERGENCY",
];
requireCondition(
  JSON.stringify(kernel.laws.audit_deployment_boundary.deployment_blockers)
    === JSON.stringify(exactDeploymentBlockers),
  "deployment blockers differ from exact four-class law",
);
requireCondition(
  kernel.laws.audit_deployment_boundary.nongate_findings.includes("maps to no applicable")
    && kernel.laws.audit_deployment_boundary.applicable_question_failures.includes("prevents RC_READY")
    && kernel.laws.audit_deployment_boundary.rule.includes("only after the applicable three-root slice is RC_READY"),
  "Product question failures and non-gate backlog findings are conflated",
);
requireCondition(
  kernel.laws.authority_reality_split.rule.includes("currently exists"),
  "authority/reality split missing",
);
requireCondition(
  kernel.laws.draft_and_seal.draft_rule.includes("must not receive authoritative content-addressed identities"),
  "drafts may be prematurely sealed",
);
requireCondition(
  kernel.laws.draft_and_seal.overwrite_forbidden === "Sealed records are never overwritten.",
  "sealed records may be overwritten",
);
requireCondition(
  kernel.laws.mechanical_receipts.manual_claim.includes("cannot override contrary machine readback"),
  "manual claims can override machine state",
);
requireCondition(
  JSON.stringify(Object.keys(kernel.laws.proportionality.profiles)) === JSON.stringify(["LOW", "MEDIUM", "HIGH"]),
  "proportionality profiles changed",
);
requireCondition(
  kernel.laws.owner_only_filter.safe_default.includes("reversible in-scope route"),
  "owner-only filter lacks safe default",
);
requireCondition(
  JSON.stringify(kernel.owner_only_classes) === JSON.stringify([
    "NEW_OR_INCREASED_UNAPPROVED_COST",
    "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE",
    "GOVERNED_STACK_OR_CONSTITUTIONAL_ARCHITECTURE_CHANGE",
    "REPOSITORY_AUTHORITY_TOPOLOGY_CHANGE",
    "DELETION_OF_ACCEPTED_OR_PROTECTED_WORK_OR_PRODUCTION_DATA",
    "UNRESOLVED_MATERIAL_PRODUCT_INTENT_CONTRADICTION",
    "OTHER_IRREVERSIBLE_ACTION_OUTSIDE_DELEGATED_AUTHORITY",
  ]),
  "owner-only classes changed",
);
const expectedContextProtections = [
  "materiality filter",
  "blueprint budget",
  "delegated stage transition",
  "audit/deployment boundary",
  "authority/reality split",
  "draft/seal law",
  "mechanical receipt law",
  "proportionality",
  "owner-only filter",
  "single-goal law",
  "root-cause deduplication",
  "handoff law",
  "failure reframing",
  "feature/platform worktree topology",
  "single-lane/multi-lane campaign compiler",
  "context capsule",
  "lease recovery",
  "checkpoint-only topology amendment",
  "machine-first governance representation",
  "authority-corpus lifecycle",
  "context elicitation and blocker continuity",
  "specialist execution autonomy and communication budget",
];
requireCondition(
  JSON.stringify(context.binding_law.may_not_override) === JSON.stringify(expectedContextProtections),
  "project context override protections changed",
);
requireCondition(context.release_context.release_operator_is_exclusive === true, "release operator is not exclusive");
requireCondition(context.release_context.local_product_browser_testing_forbidden === true, "local browser testing enabled");
requireCondition(
  context.release_context.immutable_rapid_development_evidence_retention_days
    === "BOOTSTRAP_VARIABLE",
  "retention is not a Bootstrap variable",
);
requireCondition(
  context.operational_intervals.concrete_progress_minutes === 15
    && context.operational_intervals.supervisor_reframe_response_minutes === 15
    && context.operational_intervals.lease_recovery_inspection_minutes === 15,
  "project operational intervals changed",
);
requireCondition(
  Array.isArray(context.capability_extensions) && context.capability_extensions.length === 0,
  "unexpected prepared capability extension",
);
requireCondition(
  contextTemplate.required.operational_intervals.includes("supervisor_reframe_response_interval")
    && contextTemplate.required.capabilities.includes("typed_project_capability_extensions")
    && contextTemplate.required.authority_corpus_roots.includes("authority_root")
    && contextTemplate.required.authority_corpus_roots.includes("features_root")
    && contextTemplate.required.authority_article_numbering
      .includes("existing_feature_blocks")
    && contextTemplate.authority_corpus_binding.numbering_rule
      .includes("linked extensions")
    && contextTemplate.required.context_elicitation.includes("context_blocker_owner_routes")
    && contextTemplate.authority_corpus_binding.bootstrap_rule.includes("empty project")
    && contextTemplate.elicitation_binding.completion.includes("Reasonable sufficiency"),
  "portable project-context template is incomplete",
);
requireCondition(
  contextTemplate.concrete_instance_binding?.field === "portable_template_instance"
    && contextTemplate.concrete_instance_binding.digest_rule.includes("unsigned UTF-8 byte order")
    && contextTemplate.concrete_instance_binding.rule.includes("conform exactly"),
  "portable concrete-instance binding is incomplete",
);

const expectedRoles = [
  "GLOBAL_ORCHESTRATOR",
  "FEATURE_LEAD",
  "PLATFORM_AGENT",
  "INDEPENDENT_AUDITOR",
  "GLOBAL_RUNTIME",
];
const expectedAuthorityRootVariables = [
  "authority_root",
  "authority_index_path",
  "project_context_root",
  "project_goals_root",
  "design_system_root",
  "features_root",
  "platform_capabilities_root",
  "campaigns_root",
  "decisions_root",
  "cases_root",
  "evidence_index_root",
  "archive_root",
  "evidence_library_root",
];
requireCondition(
  JSON.stringify(ROOT_VARIABLES) === JSON.stringify(expectedAuthorityRootVariables),
  "authority-corpus executable root variables differ from registry verifier",
);
requireCondition(
  JSON.stringify(workflow.roles.map((role) => role.role_id)) === JSON.stringify(expectedRoles),
  "portable role roster changed",
);
try {
  validatePortableContextInstance(
    context,
    contextTemplate,
    workflow.generic_web_capabilities.map((capability) => capability.capability_id),
  );
} catch (error) {
  errors.push(`portable project context does not instantiate template: ${error.message}`);
}
let portableContextHostileRejected = 0;
for (const [label, mutate, reseal = true] of [
  ["missing authority group", (draft) => { delete draft.portable_template_instance.authority; }],
  ["missing article-numbering group", (draft) => {
    delete draft.portable_template_instance.authority_article_numbering;
  }],
  ["overlapping article-number ranges", (draft) => {
    draft.portable_template_instance.authority_article_numbering.project_start = 99;
  }],
  ["wrong context version type", (draft) => {
    draft.portable_template_instance.project_identity.context_version = "1";
  }],
  ["wrong exact context digest", (draft) => {
    draft.portable_template_instance.project_identity.exact_context_digest = "0".repeat(64);
  }, false],
  ["missing repository ownership", (draft) => {
    delete draft.portable_template_instance.repositories[0].ownership;
  }],
  ["duplicate repository identity", (draft) => {
    draft.portable_template_instance.repositories[1].repository_id =
      draft.portable_template_instance.repositories[0].repository_id;
  }],
  ["invalid writer lane count", (draft) => {
    draft.portable_template_instance.resources.maximum_parallel_writer_lanes = 0;
  }],
  ["missing runtime role", (draft) => {
    delete draft.portable_template_instance.roles.global_runtime;
  }],
  ["missing migration namespace", (draft) => {
    draft.portable_template_instance.resources.migration_namespaces = "";
  }],
  ["invalid interval", (draft) => {
    draft.portable_template_instance.operational_intervals.concrete_progress_interval = 0;
  }],
  ["missing protected boundary", (draft) => {
    delete draft.portable_template_instance.protected_boundaries.production_promotion;
  }],
  ["missing baseline capability", (draft) => {
    draft.portable_template_instance.capabilities.enabled_baseline_capability_ids.pop();
  }],
  ["untyped capability extension", (draft) => {
    draft.portable_template_instance.capabilities.typed_project_capability_extensions = [{}];
  }],
  ["missing context blocker route", (draft) => {
    delete draft.portable_template_instance.context_elicitation.context_blocker_owner_routes;
  }],
]) {
  const draft = structuredClone(context);
  mutate(draft);
  if (reseal && draft.portable_template_instance?.project_identity) {
    resealPortableContextInstance(draft);
  }
  try {
    validatePortableContextInstance(
      draft,
      contextTemplate,
      workflow.generic_web_capabilities.map((capability) => capability.capability_id),
    );
    errors.push(`portable project-context hostile mutation accepted: ${label}`);
  } catch {
    portableContextHostileRejected += 1;
  }
}
requireCondition(
  JSON.stringify(workflow.authority_corpus_system.root_variables)
    === JSON.stringify(expectedAuthorityRootVariables),
  "authority-corpus root-variable contract changed",
);
requireCondition(
  workflow.authority_corpus_system.tree_template.per_feature.length === 9
    && workflow.authority_corpus_system.tree_template.per_platform_capability.length === 7
    && workflow.authority_corpus_system.tree_template.per_release.length === 1
    && workflow.authority_corpus_system.tree_template.corpus_indexes.length === 4
    && workflow.authority_corpus_system.page_contract.required_metadata.length === 10
    && workflow.authority_corpus_system.page_contract.platform_context_rule.includes("pseudocode")
    && workflow.authority_corpus_system.page_contract.build_log_rule.includes("append-only")
    && workflow.authority_corpus_system.page_contract.overview_rule.includes("ten recent substantial events")
    && workflow.authority_corpus_system.page_contract.gate_ownership_rule.includes("Independent Auditor")
    && workflow.authority_corpus_system.compiler.idempotency.includes("not rewritten")
    && workflow.authority_corpus_system.compiler.refusal.includes("symbolic-link traversal")
    && workflow.authority_corpus_system.compiler.refusal.includes("ancestor/descendant corpus roots"),
  "authority-corpus compiler contract changed",
);
requireCondition(
  workflow.evidence_library_system.active_window_days === "${evidence_retention_days}"
    && workflow.evidence_library_system.archive_requirements.length === 14
    && workflow.evidence_library_system.loose_evidence_rule.includes("never deleted as information")
    && workflow.evidence_library_system.historical_read_rule.includes("selectively extract")
    && workflow.evidence_library_system.failure_rule.includes("preserves the active dossier"),
  "evidence-library workflow contract changed",
);
requireCondition(
  JSON.stringify(workflow.question_tree_system.acceptance_roots)
    === JSON.stringify(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"])
    && workflow.question_tree_system.routing.includes("without serial approval")
    && workflow.question_tree_system.critical_freeze.includes("Unrelated work continues")
    && workflow.question_tree_system.compact_exchange.includes("question IDs")
    && workflow.question_tree_system.admission.includes("all three roots"),
  "question-tree workflow contract changed",
);
requireCondition(
  workflow.context_elicitation.owner === "GLOBAL_ORCHESTRATOR"
    && workflow.context_elicitation.mode === "SEMI_SCRIPTED_DRILL_ME"
    && Object.keys(workflow.context_elicitation.subject_scripts).join(",")
      === "PROJECT_GOALS,DESIGN_SYSTEM,FEATURE"
    && workflow.context_elicitation.question_selection.includes("earliest unanswered question")
    && workflow.context_elicitation.agent_fill_rule.includes("does not ask the human to repeat")
    && workflow.context_elicitation.stop_when.length === 7
    && workflow.context_elicitation.must_not.includes("interrogate for exhaustive certainty"),
  "semi-scripted context elicitation changed",
);
requireCondition(
  workflow.context_blocker_system.states.length === 8
    && workflow.context_blocker_system.required_record.length === 11
    && workflow.context_blocker_system.continuity.includes("dependent outcome")
    && workflow.context_blocker_system.closure.includes("indexes"),
  "context blocker system changed",
);
requireCondition(
  workflow.specialist_execution_autonomy.default_posture === "WORK_SILENTLY_TO_DONE"
    && workflow.specialist_execution_autonomy.allowed_local_actions.length === 6
    && workflow.specialist_execution_autonomy.report_only_when.length === 7
    && workflow.specialist_execution_autonomy.communication.ordinary.includes("No step narration")
    && workflow.specialist_execution_autonomy.communication.completion.includes("One consolidated return")
    && workflow.specialist_execution_autonomy.boundary.includes("never permits silent scope expansion"),
  "specialist execution-autonomy workflow changed",
);
requireCondition(
  Object.keys(context.authority_corpus_roots).filter((key) => expectedAuthorityRootVariables.includes(key)).length
    === expectedAuthorityRootVariables.length
    && context.authority_corpus_roots.status === "PROPOSED_2_1RC_TREE_NOT_CREATED"
    && context.context_elicitation.mode === "SEMI_SCRIPTED_DRILL_ME"
    && context.context_elicitation.status === "PREPARED_NOT_RUNNING",
  "project authority-corpus/context-elicitation binding changed",
);
requireCondition(
  context.authority_corpus_activation === "PREPARED_NOT_ACTIVATED"
    && context.authority_corpus_entities.feature_ids.length === 0
    && context.authority_corpus_entities.capability_ids.length === 0
    && context.authority_corpus_entities.campaign_ids.length === 0
    && context.authority_corpus_entities.release_ids.length === 0,
  "prepared authority-corpus entity or activation hold changed",
);

const preparedCorpusPlan = compileCorpusPlan(context, workflow);
requireCondition(
  preparedCorpusPlan.pages.length
    === workflow.authority_corpus_system.tree_template.project.length
      + workflow.authority_corpus_system.tree_template.corpus_indexes.length
    && preparedCorpusPlan.plan_sha256.length === 64,
  "prepared authority-corpus plan is not deterministic or exact",
);
const syntheticCorpusContext = structuredClone(context);
syntheticCorpusContext.project_name = "Portable Test Project";
syntheticCorpusContext.authority_corpus_entities = {
  feature_ids: ["accounts", "work-items"],
  capability_ids: ["backend-api", "database-rls"],
  campaign_ids: ["first-release"],
  release_ids: ["release-1.0.0"],
};
const firstSyntheticPlan = compileCorpusPlan(syntheticCorpusContext, workflow);
const secondSyntheticPlan = compileCorpusPlan(syntheticCorpusContext, workflow);
requireCondition(
  firstSyntheticPlan.pages.length === 49
    && firstSyntheticPlan.plan_sha256 === secondSyntheticPlan.plan_sha256
    && JSON.stringify(firstSyntheticPlan) === JSON.stringify(secondSyntheticPlan),
  "authority-corpus compiler is not deterministic or complete",
);
const unicodeCorpusContext = structuredClone(context);
unicodeCorpusContext.project_name = "Unicode Determinism";
unicodeCorpusContext.authority_corpus_entities = {
  feature_ids: ["zeta", "alpha"],
  capability_ids: [],
  campaign_ids: [],
  release_ids: [],
};
Object.assign(unicodeCorpusContext.authority_corpus_roots, {
  features_root: "authority/é-features",
  platform_capabilities_root: "authority/é-capabilities",
  project_context_root: "authority/ß-project",
  project_goals_root: "authority/Ω-goals",
  design_system_root: "authority/中-design",
  campaigns_root: "authority/å-campaigns",
  decisions_root: "authority/δ-decisions",
  cases_root: "authority/č-cases",
  evidence_index_root: "authority/ñ-evidence",
  archive_root: "authority/ø-archive",
  evidence_library_root: "evidence/历史-library",
  authority_index_path: "authority/í-index.json",
});
const unicodePlan = compileCorpusPlan(unicodeCorpusContext, workflow);
requireCondition(
  unicodePlan.plan_sha256.length === 64
    && unicodePlan.plan_sha256
      === compileCorpusPlan(structuredClone(unicodeCorpusContext), workflow).plan_sha256
    && ["é", "é", "ß", "Ω", "中"].sort(compareUtf8).join("|") === "é|ß|é|Ω|中",
  "authority-corpus UTF-8 byte ordering or compact canonical SHA changed",
);
let corpusHostileRejected = 0;
for (const [label, mutate] of [
  ["missing root variable", (draft) => { delete draft.authority_corpus_roots.features_root; }],
  ["root path escape", (draft) => { draft.authority_corpus_roots.features_root = "../features"; }],
  ["equal corpus roots", (draft) => {
    draft.authority_corpus_roots.features_root =
      draft.authority_corpus_roots.platform_capabilities_root;
  }],
  ["ancestor corpus roots", (draft) => {
    draft.authority_corpus_roots.features_root = "authority/context";
    draft.authority_corpus_roots.platform_capabilities_root = "authority/context/platform";
  }],
  ["authority index inside corpus root", (draft) => {
    draft.authority_corpus_roots.authority_index_path = "authority/features/index.json";
  }],
  ["duplicate feature identity", (draft) => { draft.authority_corpus_entities.feature_ids = ["same", "same"]; }],
  ["unsafe feature identity", (draft) => { draft.authority_corpus_entities.feature_ids = ["../../escape"]; }],
  ["missing entity inventory", (draft) => { delete draft.authority_corpus_entities; }],
]) {
  const draft = structuredClone(syntheticCorpusContext);
  mutate(draft);
  try {
    compileCorpusPlan(draft, workflow);
    errors.push(`authority-corpus hostile mutation accepted: ${label}`);
  } catch {
    corpusHostileRejected += 1;
  }
}
let inactiveApplyRefused = false;
const inactiveApplyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-corpus-inactive-"));
try {
  applyCorpusPlan(inactiveApplyRoot, context, workflow);
} catch {
  inactiveApplyRefused = true;
} finally {
  fs.rmSync(inactiveApplyRoot, {recursive: true, force: true});
}
requireCondition(inactiveApplyRefused, "authority-corpus apply accepted nonactivated context");

const symlinkApplyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-corpus-symlink-root-"));
const symlinkExternalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-corpus-symlink-external-"));
try {
  fs.mkdirSync(path.join(symlinkApplyRoot, "authority"), {recursive: true});
  fs.symlinkSync(symlinkExternalRoot, path.join(symlinkApplyRoot, "authority/features"), "dir");
  const activatedContext = structuredClone(syntheticCorpusContext);
  activatedContext.authority_corpus_activation = "ACTIVATED";
  let refused = false;
  try {
    applyCorpusPlan(symlinkApplyRoot, activatedContext, workflow);
  } catch {
    refused = true;
  }
  requireCondition(refused, "authority-corpus apply followed symlinked page ancestor");
  requireCondition(
    !fs.existsSync(path.join(symlinkExternalRoot, "accounts/intent.md")),
    "authority-corpus apply wrote page bytes outside admitted root",
  );
} finally {
  fs.rmSync(symlinkApplyRoot, {recursive: true, force: true});
  fs.rmSync(symlinkExternalRoot, {recursive: true, force: true});
}

const symlinkIndexRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-index-symlink-root-"));
const symlinkIndexExternal = fs.mkdtempSync(path.join(os.tmpdir(), "governance-index-symlink-external-"));
try {
  fs.mkdirSync(path.join(symlinkIndexRoot, "authority"), {recursive: true});
  fs.symlinkSync(symlinkIndexExternal, path.join(symlinkIndexRoot, "authority/index-link"), "dir");
  const activatedContext = structuredClone(syntheticCorpusContext);
  activatedContext.authority_corpus_activation = "ACTIVATED";
  activatedContext.authority_corpus_roots.authority_index_path = "authority/index-link/index.json";
  let refused = false;
  try {
    applyCorpusPlan(symlinkIndexRoot, activatedContext, workflow);
  } catch {
    refused = true;
  }
  requireCondition(refused, "authority-corpus apply followed symlinked index ancestor");
  requireCondition(
    !fs.existsSync(path.join(symlinkIndexExternal, "index.json")),
    "authority-corpus apply wrote index bytes outside admitted root",
  );
} finally {
  fs.rmSync(symlinkIndexRoot, {recursive: true, force: true});
  fs.rmSync(symlinkIndexExternal, {recursive: true, force: true});
}

const corpusApplyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-corpus-apply-"));
try {
  const activatedContext = structuredClone(syntheticCorpusContext);
  activatedContext.authority_corpus_activation = "ACTIVATED";
  const applied = applyCorpusPlan(corpusApplyRoot, activatedContext, workflow);
  const indexPath = path.join(corpusApplyRoot, applied.plan.authority_index_path);
  requireCondition(
    applied.index.entries.length === 49
      && applied.index_sha256.length === 64
      && applied.index_sha256 === sha256(fs.readFileSync(indexPath))
      && fs.existsSync(indexPath),
    "authority-corpus apply did not create exact skeleton/index set",
  );
  const firstIndexBytes = fs.readFileSync(indexPath);
  const reapplied = applyCorpusPlan(corpusApplyRoot, activatedContext, workflow);
  requireCondition(
    firstIndexBytes.equals(fs.readFileSync(indexPath))
      && reapplied.index_sha256 === applied.index_sha256,
    "authority-corpus apply is not idempotent",
  );
} finally {
  fs.rmSync(corpusApplyRoot, {recursive: true, force: true});
}

let evidenceLibraryHostileRejected = 0;
const evidenceLibraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-evidence-library-"));
try {
  const releaseId = "release-1.0.0";
  const activeRoot = path.join(evidenceLibraryRoot, EVIDENCE_LIBRARY_LAYOUT.active, releaseId);
  fs.mkdirSync(path.join(activeRoot, "agents/search"), {recursive: true});
  fs.mkdirSync(path.join(activeRoot, "agents/auditor"), {recursive: true});
  fs.mkdirSync(path.join(activeRoot, "agents/runtime"), {recursive: true});
  fs.writeFileSync(path.join(activeRoot, "agents/search/checkpoint.json"), "{\"ok\":true}\n");
  fs.writeFileSync(path.join(activeRoot, "agents/auditor/live.md"), "live audit\n");
  fs.writeFileSync(path.join(activeRoot, "agents/runtime/deployment.json"), "{\"version\":\"1.0.0\"}\n");
  const releaseRecord = {
    schema: "governance.release_evidence_record.v1",
    release_id: releaseId,
    disposition: "ACCEPTED_LIVE_CLOSED",
    closed_at: "2026-01-01T00:00:00.000Z",
    archive_after_days: 37,
    source_identity: "source-sha256:source",
    artifact_identity: "artifact-sha256:artifact",
    deployment_identity: "deployment:1.0.0",
    rollback_identity: "rollback:0.9.0",
    audit_identity: "audit-sha256:audit",
    agent_evidence_owners: ["runtime", "search", "auditor"],
  };
  const firstPlan = compileEvidenceArchivePlan(
    evidenceLibraryRoot,
    releaseRecord,
    "2026-02-07T00:00:00.000Z",
  );
  const secondPlan = compileEvidenceArchivePlan(
    evidenceLibraryRoot,
    releaseRecord,
    "2026-02-07T00:00:00.000Z",
  );
  requireCondition(
    firstPlan.eligible
      && firstPlan.archive_sha256 === secondPlan.archive_sha256
      && firstPlan.manifest_sha256 === secondPlan.manifest_sha256
      && firstPlan.archive_bytes.equals(secondPlan.archive_bytes)
      && firstPlan.manifest.payload.length === 3,
    "release evidence archive plan is not deterministic and complete",
  );
  const appliedArchive = archiveReleaseEvidence(
    evidenceLibraryRoot,
    releaseRecord,
    "2026-02-07T00:00:00.000Z",
  );
  const archiveBytes = fs.readFileSync(path.join(
    evidenceLibraryRoot,
    appliedArchive.plan.archive_relative_path,
  ));
  const manifestBytes = fs.readFileSync(path.join(
    evidenceLibraryRoot,
    appliedArchive.plan.manifest_relative_path,
  ));
  const checksumBytes = fs.readFileSync(path.join(
    evidenceLibraryRoot,
    appliedArchive.plan.checksum_relative_path,
  ));
  const archiveBasename = path.posix.basename(appliedArchive.plan.archive_relative_path);
  const verification = verifyEvidenceArchive(
    archiveBytes,
    manifestBytes,
    checksumBytes,
    archiveBasename,
  );
  requireCondition(
    verification.status === "VERIFIED_EXACT"
      && verification.payload_files === 3
      && fs.existsSync(activeRoot)
      && appliedArchive.loose_evidence_disposition.includes("PRESERVED"),
    "release evidence archive apply/readback did not preserve exact evidence",
  );
  for (const [label, run] of [
    ["early archive", () => archiveReleaseEvidence(
      evidenceLibraryRoot,
      releaseRecord,
      "2026-02-06T23:59:59.999Z",
    )],
    ["unclosed release", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, disposition: "DRAFT"},
      "2026-02-07T00:00:00.000Z",
    )],
    ["duplicate agent owner", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, agent_evidence_owners: ["search", "search"]},
      "2026-02-07T00:00:00.000Z",
    )],
    ["omitted participating owner", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, agent_evidence_owners: ["search", "auditor"]},
      "2026-02-07T00:00:00.000Z",
    )],
    ["extra participating owner", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, agent_evidence_owners: ["search", "auditor", "runtime", "ghost"]},
      "2026-02-07T00:00:00.000Z",
    )],
    ["retention below configured bounds", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, archive_after_days: 0},
      "2026-02-07T00:00:00.000Z",
    )],
    ["retention above configured bounds", () => compileEvidenceArchivePlan(
      evidenceLibraryRoot,
      {...releaseRecord, archive_after_days: 3651},
      "2026-02-07T00:00:00.000Z",
    )],
    ["tampered archive", () => {
      const tampered = Buffer.from(archiveBytes);
      tampered[40] ^= 1;
      verifyEvidenceArchive(tampered, manifestBytes, checksumBytes, archiveBasename);
    }],
    ["tampered manifest", () => verifyEvidenceArchive(
      archiveBytes,
      Buffer.from(manifestBytes.toString("utf8").replace("live.md", "other.md"), "utf8"),
      checksumBytes,
      archiveBasename,
    )],
    ["tampered checksum digest", () => verifyEvidenceArchive(
      archiveBytes,
      manifestBytes,
      Buffer.from(`${"0".repeat(64)}  ${archiveBasename}\n`, "utf8"),
      archiveBasename,
    )],
    ["tampered checksum name", () => verifyEvidenceArchive(
      archiveBytes,
      manifestBytes,
      Buffer.from(`${sha256(archiveBytes)}  wrong.evidence.zip\n`, "utf8"),
      archiveBasename,
    )],
    ["central mode mismatch", () => {
      const tampered = Buffer.from(archiveBytes);
      let centralOffset = tampered.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      let changed = false;
      while (centralOffset >= 0 && centralOffset + 46 <= tampered.length) {
        const nameLength = tampered.readUInt16LE(centralOffset + 28);
        const extraLength = tampered.readUInt16LE(centralOffset + 30);
        const commentLength = tampered.readUInt16LE(centralOffset + 32);
        const nameStart = centralOffset + 46;
        const name = tampered.subarray(nameStart, nameStart + nameLength).toString("utf8");
        if (name.startsWith(`${EVIDENCE_LIBRARY_LAYOUT.payload_prefix}/`)) {
          tampered.writeUInt32LE(0, centralOffset + 38);
          changed = true;
          break;
        }
        centralOffset = nameStart + nameLength + extraLength + commentLength;
        if (tampered.readUInt32LE(centralOffset) !== 0x02014b50) break;
      }
      if (!changed) throw new Error("test setup did not locate payload central entry");
      const digest = sha256(tampered);
      verifyEvidenceArchive(
        tampered,
        manifestBytes,
        Buffer.from(`${digest}  ${archiveBasename}\n`, "utf8"),
        archiveBasename,
      );
    }],
    ["duplicate manifest payload path", () => {
      const malformed = JSON.parse(manifestBytes.toString("utf8"));
      malformed.payload.push({...malformed.payload[0]});
      verifyEvidenceArchive(
        archiveBytes,
        Buffer.from(`${canonicalCompactJson(malformed)}\n`, "utf8"),
        checksumBytes,
        archiveBasename,
      );
    }],
    ["malformed manifest payload record", () => {
      const malformed = JSON.parse(manifestBytes.toString("utf8"));
      malformed.payload[0].mode = "0444";
      verifyEvidenceArchive(
        archiveBytes,
        Buffer.from(`${canonicalCompactJson(malformed)}\n`, "utf8"),
        checksumBytes,
        archiveBasename,
      );
    }],
  ]) {
    try {
      run();
      errors.push(`release evidence hostile accepted: ${label}`);
    } catch {
      evidenceLibraryHostileRejected += 1;
    }
  }
  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governance-evidence-symlink-"));
  try {
    const symlinkActive = path.join(
      symlinkRoot,
      EVIDENCE_LIBRARY_LAYOUT.active,
      releaseId,
    );
    fs.mkdirSync(symlinkActive, {recursive: true});
    fs.symlinkSync("/tmp", path.join(symlinkActive, "escape"), "dir");
    try {
      compileEvidenceArchivePlan(
        symlinkRoot,
        releaseRecord,
        "2026-02-07T00:00:00.000Z",
      );
      errors.push("release evidence hostile accepted: symbolic-link payload");
    } catch {
      evidenceLibraryHostileRejected += 1;
    }
  } finally {
    fs.rmSync(symlinkRoot, {recursive: true, force: true});
  }
} finally {
  fs.rmSync(evidenceLibraryRoot, {recursive: true, force: true});
}
requireCondition(
  deterministicZipControllerSource.includes("deterministic UTF-8 stored data")
    && evidenceLibraryCompilerSource.includes("PRESERVED_UNTIL_CALLER_MECHANICALLY_CONFIRMS_ARCHIVE"),
  "release evidence compiler source boundary changed",
);

requireCondition(
  new Set(workflow.generic_web_capabilities.map((capability) => capability.capability_id)).size === 15
    && workflow.generic_web_capabilities.length === 15,
  "generic capability roster is not exact and unique",
);
requireCondition(
  new Set(workflow.worktree_modes.map((mode) => mode.mode_id)).size === 7
    && workflow.worktree_modes.length === 7,
  "worktree mode roster is not exact and unique",
);
requireCondition(
  workflow.platform_agent_capsule.reuse_forbidden.includes("never reused"),
  "platform agents may be reused",
);
requireCondition(
  workflow.context_capsule.required_fields.length === 12
    && workflow.context_capsule.budget.includes("only context material"),
  "context capsule law changed",
);
requireCondition(
  workflow.lease_recovery.required_fields.length === 11
    && workflow.lease_recovery.recovery.includes("freeze writes")
    && workflow.lease_recovery.safety.includes("never creates a second simultaneous writer"),
  "lease-recovery law changed",
);
requireCondition(
  workflow.capability_extension_law.baseline.includes("not an exhaustive universal roster")
    && workflow.capability_extension_law.cannot_override.length === 6,
  "capability-extension law changed",
);
requireCondition(
  workflow.feature_workflow.length === 10,
  "feature workflow changed",
);
const expectedMultiLanePredicates = [
  "two or more dependency-independent feature sequences exist",
  "each lane has an exact disjoint primary ownership boundary",
  "shared contracts have explicit producer and consumer versions",
  "one exclusive writer lease per lane can be guaranteed",
  "a finite Runtime convergence order can be compiled",
  "measured or source-backed expected parallelism materially reduces milestone time relative to one cumulative root",
  "bounded reconciliation, migration, rollback, and proof cost is lower than the expected parallelism benefit",
];
requireCondition(
  workflow.campaign_compiler.topology_selection.default
    === "SINGLE_LANE_ONLY_FOR_2_1RC_ACTIVATION",
  "campaign compiler no longer defaults unconditionally to one cumulative root",
);
requireCondition(
  workflow.campaign_compiler.topology_selection.lane_count_rule.includes("exactly one cumulative root")
    && workflow.campaign_compiler.topology_selection.lane_count_rule.includes("cannot mint a second writer root")
    && JSON.stringify(workflow.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all)
      === JSON.stringify(expectedMultiLanePredicates),
  "campaign compiler multi-lane exception is not exact and evidence-backed",
);
requireCondition(
  workflow.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.admission.includes("DESIGN_ONLY_NOT_ACTIVATABLE_IN_2_1RC")
    && workflow.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.admission
      .includes("executable per-lane state"),
  "multi-lane admission evidence law changed",
);
requireCondition(
  workflow.campaign_compiler.topology_selection.failure_default.includes("fails closed to one cumulative root"),
  "campaign compiler lacks a fail-closed single-root default",
);
requireCondition(
  workflow.campaign_compiler.topology_selection.SINGLE_LANE.checkpoint_rule.includes("substantial usable batch")
    && workflow.campaign_compiler.topology_selection.SINGLE_LANE.integration_rule.includes("not individually merged"),
  "single-root sequential checkpoint law changed",
);
requireCondition(
  workflow.campaign_compiler.milestone_release_policy.feature_checkpoint.includes("do not merge, mint, or deploy")
    && workflow.campaign_compiler.milestone_release_policy.terminal_sequence.length === 7
    && workflow.campaign_compiler.milestone_release_policy.milestone_definition.includes("end-to-end user outcome"),
  "milestone integration/deployment law changed",
);
requireCondition(
  workflow.campaign_compiler.cross_lane_contract_law.rule.includes("never cherry-picks"),
  "cross-lane code-copy boundary missing",
);
requireCondition(
  workflow.campaign_compiler.topology_amendment.allowed_only_when.length === 5
    && workflow.campaign_compiler.topology_amendment.forbidden.length === 5,
  "topology-amendment boundary changed",
);
requireCondition(
  workflow.campaign_compiler.autonomy.global_orchestrator_must_not.some((rule) => rule.includes("require approval")),
  "Campaign Orchestrator can become a routine stage gate",
);
requireCondition(
  workflow.failure_reframe_workflow.owner.includes("direct supervising agent"),
  "workflow failure reframe is not supervisor-owned",
);
requireCondition(
  workflow.failure_reframe_workflow.trigger.automatic_when.length === 6
    && workflow.failure_reframe_workflow.trigger.rule.includes("before another retry"),
  "workflow reframe trigger changed",
);
requireCondition(
  workflow.failure_reframe_workflow.trigger.not_for.includes("localized failure"),
  "workflow lacks bounded builder correction path",
);
requireCondition(
  workflow.failure_reframe_workflow.supervisor_liveness.continuity.includes("same-role deputy")
    && workflow.failure_reframe_workflow.supervisor_liveness.boundary.includes("no broader custody"),
  "workflow supervisor continuity missing",
);
requireCondition(
  workflow.failure_reframe_workflow.lens_sampler.selected_lens_count === 1
    && workflow.failure_reframe_workflow.lens_sampler.catalog.length === 9,
  "workflow reframe lens sampler changed",
);
const fixedSamplerCases = [
  ["root-a", "0".repeat(64), ["PHILOSOPHY_OR_FIRST_PRINCIPLES"]],
  ["root-b", "1".repeat(64), ["PROJECT_CONTEXT"]],
  ["root-a", "2".repeat(64), ["PROJECT_CONTEXT"]],
];
for (const [failureRootId, evidenceSha, expected] of fixedSamplerCases) {
  const first = sampleReframeLenses(
    failureRootId,
    evidenceSha,
    workflow.failure_reframe_workflow.lens_sampler.catalog,
  );
  const second = sampleReframeLenses(
    failureRootId,
    evidenceSha,
    workflow.failure_reframe_workflow.lens_sampler.catalog,
  );
  requireCondition(JSON.stringify(first) === JSON.stringify(expected), `sampler fixed case drift: ${failureRootId}`);
  requireCondition(JSON.stringify(second) === JSON.stringify(first), `sampler nondeterministic: ${failureRootId}`);
  requireCondition(first.length === 1, `sampler output is not exactly one lens: ${failureRootId}`);
}
requireCondition(
  JSON.stringify(fixedSamplerCases[0][2]) !== JSON.stringify(fixedSamplerCases[1][2]),
  "sampler fixed seeds do not demonstrate diversity",
);
for (const malformed of [
  ["", "0".repeat(64)],
  ["root", ""],
  ["root", "A".repeat(64)],
  ["root", "0".repeat(63)],
]) {
  let refused = false;
  try {
    sampleReframeLenses(malformed[0], malformed[1], workflow.failure_reframe_workflow.lens_sampler.catalog);
  } catch {
    refused = true;
  }
  requireCondition(refused, "sampler accepted malformed seed input");
}
requireCondition(
  workflow.failure_reframe_workflow.steps.length === 12,
  "workflow failure reframe steps changed",
);
requireCondition(
  workflow.failure_reframe_workflow.anti_loop.includes("cannot self-reframe"),
  "workflow allows builder self-reframe loops",
);
requireCondition(
  workflow.failure_reframe_workflow.technical_advice.includes("one bounded technical recommendation")
    && workflow.failure_reframe_workflow.builder_feasibility_objection.includes("one evidence-backed feasibility objection"),
  "workflow bounded advice/objection law missing",
);

for (const requiredText of [
  "record the discrepancy additively and continue the active stage",
  "Applying high-risk ceremony to low-risk reversible work is a governance failure",
  "Central becoming a routine per-stage reviewer",
  "Audit is not a predeployment repair campaign",
  "Draft records are temporary, mutable, and nonauthoritative",
  "Manual claims cannot override contrary machine readback",
  "safe default",
  "generic governance is separated from project context",
  "direct supervising agent owns the reframe",
  "answers exactly one sampled lens",
  "same-role continuity deputy",
  "one evidence-backed feasibility objection",
  "Structured registries, state machines, schemas, and executable hostile tests are the normative operational authority",
  "Governance 2.1rc is one portable package with five connected duties",
  "SEMI_SCRIPTED_DRILL_ME",
  "Reasonable sufficiency",
  "Specialists default to",
  "Report one exact blocker only after safe in-scope alternatives are exhausted",
]) {
  requireCondition(normalizeText(kernelArticle).includes(requiredText), `kernel article omits required law: ${requiredText}`);
}
for (const requiredText of [
  "one cumulative single-root development",
  "Multi-lane predicates are retained as later design material",
  "Feature checkpoints are not merged individually",
  "one serialized integration, artifact mint, deployment",
  "builder does not approve its own alternate route",
  "samples exactly one lens",
  "portable baseline, not a universal ceiling",
  "compact context capsule",
  "future unstarted feature order may change only at an immutable pushed checkpoint",
  "one evidence-backed feasibility objection",
  "registry is normative for operational transitions",
  "Authority-corpus compiler and live maintainer",
  "Scripted context intake",
  "asks one compact material question",
  "Platform Agents work autonomously inside their capsule",
  "one consolidated completion/handoff packet",
]) {
  requireCondition(normalizeText(workflowArticle).includes(requiredText), `workflow article omits required law: ${requiredText}`);
}
for (const forbiddenActivation of [
  "does not activate or globally adopt Governance 2.1rc",
  "does not rebind an active campaign or release",
  "does not create a Product task",
]) {
  requireCondition(bootstrap.includes(forbiddenActivation), `bootstrap activation hold missing: ${forbiddenActivation}`);
}

const hostileMutations = [
  ["kernel project-name leak", (draft) => { draft.project_name = "Example"; }],
  ["kernel repository leak", (draft) => { draft.repository_path = "/tmp/project"; }],
  ["remove materiality", (draft) => { delete draft.laws.materiality_filter; }],
  ["remove machine-first law", (draft) => { delete draft.laws.machine_first_governance; }],
  ["prose creates transitions", (draft) => {
    draft.laws.machine_first_governance.prose_role = "General text may create transitions.";
  }],
  ["remove authority-corpus lifecycle", (draft) => { delete draft.laws.authority_corpus_lifecycle; }],
  ["corpus invents facts", (draft) => {
    draft.laws.authority_corpus_lifecycle.generation = "Invent missing facts.";
  }],
  ["corpus overwrites all pages", (draft) => {
    draft.laws.authority_corpus_lifecycle.maintenance = "Rewrite the full tree.";
  }],
  ["platform comments become authority", (draft) => {
    draft.laws.authority_corpus_lifecycle.platform_context = "Comments are independent authority.";
  }],
  ["remove evidence library", (draft) => {
    delete draft.laws.compact_context_and_evidence_library;
  }],
  ["builder self-verifies gate", (draft) => {
    draft.laws.compact_context_and_evidence_library.gate_register =
      "Builders define and verify their own gates.";
  }],
  ["delete release evidence", (draft) => {
    draft.laws.compact_context_and_evidence_library.preservation =
      "Delete evidence after 14 days.";
  }],
  ["load whole archive context", (draft) => {
    draft.laws.compact_context_and_evidence_library.historical_read =
      "Load every archive into every task.";
  }],
  ["remove context elicitation", (draft) => { delete draft.laws.context_elicitation_and_blockers; }],
  ["exhaustive context interview", (draft) => {
    draft.laws.context_elicitation_and_blockers.anti_interrogation = "Ask until exhaustive certainty.";
  }],
  ["block all work on context gap", (draft) => {
    draft.laws.context_elicitation_and_blockers.continuity = "Stop all work.";
  }],
  ["remove dynamic Bootstrap", (draft) => {
    delete draft.laws.dynamic_bootstrap_configurator;
  }],
  ["Bootstrap rewrites release history", (draft) => {
    draft.laws.dynamic_bootstrap_configurator.preferences =
      "Preferences rewrite every historical release.";
  }],
  ["Bootstrap asks discoverable facts", (draft) => {
    draft.laws.dynamic_bootstrap_configurator.rule =
      "Ask every setup question without discovery.";
  }],
  ["remove GPT_ASSIST campaign context", (draft) => {
    delete draft.laws.gpt_assist_campaign_context;
  }],
  ["GPT_ASSIST invents project truth", (draft) => {
    draft.laws.gpt_assist_campaign_context.interaction =
      "ChatGPT invents answers and expands the questionnaire.";
  }],
  ["GPT_ASSIST keeps questioning", (draft) => {
    draft.laws.gpt_assist_campaign_context.interaction =
      "Continue asking questions after the listed questions are complete.";
  }],
  ["Auditor writes campaign authority", (draft) => {
    draft.laws.gpt_assist_campaign_context.authority =
      "The Auditor writes standard authority directly.";
  }],
  ["GPT_ASSIST requires old private chat", (draft) => {
    draft.laws.gpt_assist_campaign_context.portability =
      "Recovery requires the complete private chat.";
  }],
  ["remove specialist execution autonomy", (draft) => {
    delete draft.laws.execution_autonomy_and_communication;
  }],
  ["report every technical puzzle", (draft) => {
    draft.laws.execution_autonomy_and_communication.local_problem_rule =
      "Report every technical puzzle.";
  }],
  ["allow routine permission chatter", (draft) => {
    draft.laws.execution_autonomy_and_communication.communication_budget =
      "Ask permission and report every step.";
  }],
  ["autonomy broadens scope", (draft) => {
    draft.laws.execution_autonomy_and_communication.forbidden =
      "Silent scope expansion is allowed.";
  }],
  ["allow metadata blocker", (draft) => { draft.laws.materiality_filter.nonblocking_rule = "Stop."; }],
  ["require final checkpoint in Blueprint", (draft) => { draft.laws.blueprint_budget.forbidden = "None."; }],
  ["Central every stage", (draft) => { draft.laws.delegated_stage_transition.central_required_only_for.push("every stage"); }],
  ["Product finding blocks deploy", (draft) => { draft.laws.audit_deployment_boundary.deployment_blockers.push("ORDINARY_PRODUCT_FINDING"); }],
  ["remove runtime blocker", (draft) => { draft.laws.audit_deployment_boundary.deployment_blockers.shift(); }],
  ["merge authority and reality", (draft) => { draft.laws.authority_reality_split.rule = "Authority defines reality."; }],
  ["seal drafts", (draft) => { draft.laws.draft_and_seal.draft_rule = "Hash every draft."; }],
  ["overwrite sealed", (draft) => { draft.laws.draft_and_seal.overwrite_forbidden = "Allowed."; }],
  ["manual overrides machine", (draft) => { draft.laws.mechanical_receipts.manual_claim = "Manual wins."; }],
  ["remove LOW proportionality", (draft) => { delete draft.laws.proportionality.profiles.LOW; }],
  ["remove safe default", (draft) => { draft.laws.owner_only_filter.safe_default = "Ask owner."; }],
  ["add owner class", (draft) => { draft.owner_only_classes.push("ORDINARY_FAILURE"); }],
  ["remove single goal", (draft) => { delete draft.laws.single_goal; }],
  ["disable self tightening", (draft) => { draft.laws.case_evaluation.self_tightening = "Disabled."; }],
  ["allow campaign override", (draft) => { draft.laws.case_evaluation.campaign_override = "ALLOWED"; }],
  ["remove root dedupe", (draft) => { delete draft.laws.root_cause; }],
  ["remove handoff", (draft) => { delete draft.laws.handoff; }],
  ["remove failure reframe", (draft) => { delete draft.laws.failure_reframe; }],
  ["builder owns reframe", (draft) => { draft.laws.failure_reframe.owner = "The builder owns it."; }],
  ["ambiguous lens seed", (draft) => {
    draft.laws.failure_reframe.lens_selection.algorithm = "Hash concatenated values.";
  }],
  ["duplicate lens", (draft) => {
    draft.laws.failure_reframe.lens_selection.lenses.push("ELI5");
  }],
  ["zero lenses", (draft) => { draft.laws.failure_reframe.lens_selection.selected_lens_count = 0; }],
  ["plural lens ceremony", (draft) => {
    draft.laws.failure_reframe.rule =
      "The supervisor samples multiple distinct reframing lenses.";
  }],
  ["random route authority", (draft) => {
    draft.laws.failure_reframe.lens_selection.selection_is_not_authority = "Randomness selects the final route.";
  }],
  ["allow builder self reframe", (draft) => { draft.laws.failure_reframe.loop_control = "Repeat freely."; }],
  ["reframe every first failure", (draft) => { draft.laws.failure_reframe.trigger = "Any failure."; }],
  ["remove local correction path", (draft) => { draft.laws.failure_reframe.non_trigger = "None."; }],
  ["broaden continuity deputy", (draft) => {
    draft.laws.failure_reframe.supervisor_liveness.boundary = "Deputy may broaden custody.";
  }],
  ["reseed on later evidence", (draft) => {
    draft.laws.failure_reframe.lens_selection.algorithm =
      draft.laws.failure_reframe.lens_selection.algorithm.replace(
        "Later evidence attaches without reseeding the root.",
        "Later evidence reseeds the root.",
      );
  }],
  ["unbounded builder objections", (draft) => {
    draft.laws.failure_reframe.builder_feasibility_objection = "Builder may object repeatedly.";
  }],
  ["remove portable campaign control", (draft) => {
    delete draft.laws.portable_campaign_control_and_recovery;
  }],
  ["allow Auditor authority writes", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.rule =
      "The Campaign Orchestrator and Auditor write the authority corpus.";
  }],
  ["promote merged work before accepted live", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.authority_layers =
      "Standard authority describes merged work.";
  }],
  ["close feature goal before handoff", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.dependency_handoff =
      "Close a feature goal when its implementation is locally complete.";
  }],
  ["pre-spawn platform wave", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.agent_lifecycle =
      "Spawn every Platform Agent at campaign start.";
  }],
  ["depin Auditor without successor plan", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.auditor_handoff =
      "Depin immediately after live audit.";
  }],
  ["replace Product work with evidence ceremony", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.fix_first =
      "Write a formal evidence packet before each correction.";
  }],
  ["make old chat required for recovery", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.portability =
      "Recovery requires every prior chat session.";
  }],
  ["remove living campaign event ledger", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.rule =
      "Only the Orchestrator keeps a private campaign plan.";
  }],
  ["allow event append to become Product custody", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.boundary =
      "Event append grants Product and authority custody.";
  }],
  ["drop ledger from handoff", (draft) => {
    draft.laws.portable_campaign_control_and_recovery.dependency_handoff =
      "Handoff only Product bytes.";
  }],
];

function validatesKernel(draft) {
  const laws = draft.laws ?? {};
  if (draft.project_name || draft.repository_path) return false;
  if (requiredLaws.some((law) => !laws[law])) return false;
  if (!laws.machine_first_governance.normative_rule.includes("normative operational authority")) return false;
  if (!laws.machine_first_governance.pseudocode_role.includes("mechanically equivalent")) return false;
  if (!laws.machine_first_governance.prose_role.includes("does not invent")) return false;
  if (!laws.authority_corpus_lifecycle.rule.includes("authority-corpus compiler")) return false;
  if (!laws.authority_corpus_lifecycle.generation.includes("never invent facts")) return false;
  if (!laws.authority_corpus_lifecycle.maintenance.includes("refresh only affected current pages")) return false;
  if (!laws.authority_corpus_lifecycle.platform_context.includes("neither is independent authority")) return false;
  if (!laws.compact_context_and_evidence_library.gate_register.includes("Independent Auditor")) return false;
  if (!laws.compact_context_and_evidence_library.archive.includes("deterministic content-addressed ZIP")) return false;
  if (!laws.compact_context_and_evidence_library.preservation.includes("never deleted as information")) return false;
  if (!laws.compact_context_and_evidence_library.historical_read.includes("selectively")) return false;
  if (!laws.portable_campaign_control_and_recovery.rule.includes("sole authority-corpus writer")) return false;
  if (!laws.portable_campaign_control_and_recovery.rule.includes("living worktree-carried record")) return false;
  if (!laws.portable_campaign_control_and_recovery.rule.includes("on-demand Platform Agent session")) return false;
  if (!laws.portable_campaign_control_and_recovery.authority_layers.includes("last accepted live release")) return false;
  if (!laws.portable_campaign_control_and_recovery.dependency_handoff.includes("topologically orders")) return false;
  if (!laws.portable_campaign_control_and_recovery.dependency_handoff.includes("append-only campaign ledger")) return false;
  if (!laws.portable_campaign_control_and_recovery.agent_lifecycle.includes("Runtime alone persists")) return false;
  if (!laws.portable_campaign_control_and_recovery.agent_lifecycle.includes("only on demand")) return false;
  if (!laws.portable_campaign_control_and_recovery.auditor_handoff.includes("next-campaign candidate")) return false;
  if (!laws.portable_campaign_control_and_recovery.fix_first.includes("fixed, checked, committed, and handed off")) return false;
  if (!laws.portable_campaign_control_and_recovery.portability.includes("optional provenance")) return false;
  if (!laws.portable_campaign_control_and_recovery.portability.includes("pushed cumulative root carries")) return false;
  if (!laws.portable_campaign_control_and_recovery.boundary.includes("not Product custody")) return false;
  if (!laws.context_elicitation_and_blockers.rule.includes("one material question at a time")) return false;
  if (!laws.context_elicitation_and_blockers.stop.includes("first bounded batch")) return false;
  if (!laws.context_elicitation_and_blockers.continuity.includes("unaffected")) return false;
  if (!laws.context_elicitation_and_blockers.anti_interrogation.includes("Exhaustive questioning")) return false;
  if (!laws.dynamic_bootstrap_configurator.rule.includes("one unresolved material question")) return false;
  if (!laws.dynamic_bootstrap_configurator.rule.includes("inherited parent repositories")) return false;
  if (!laws.dynamic_bootstrap_configurator.preferences.includes("changeable")) return false;
  if (!laws.dynamic_bootstrap_configurator.preferences.includes("append-only digest chain")) return false;
  if (!laws.dynamic_bootstrap_configurator.preferences.includes("schema migration")) return false;
  if (!laws.dynamic_bootstrap_configurator.environment.includes("verified permission")) return false;
  if (!laws.dynamic_bootstrap_configurator.boundary.includes("rewrite sealed history")) return false;
  if (!laws.portable_authority_format.rule.includes("000 Bootstrap")) return false;
  if (!laws.portable_authority_format.allocation.includes("never renumber")) return false;
  if (!laws.portable_authority_format.campaign_boundary.includes("last accepted-live truth")) return false;
  if (!laws.portable_authority_format.evidence_boundary.includes("release-scoped evidence library")) return false;
  if (!laws.gpt_assist_campaign_context.rule.includes("independent Auditor")) return false;
  if (!laws.gpt_assist_campaign_context.interaction.includes("exactly one listed question")) return false;
  if (!laws.gpt_assist_campaign_context.interaction.includes("adds no questionnaire")) return false;
  if (!laws.gpt_assist_campaign_context.interaction.includes("stops when every listed material question")) return false;
  if (!laws.gpt_assist_campaign_context.authority.includes("next-campaign candidate")) return false;
  if (!laws.gpt_assist_campaign_context.authority.includes("next Campaign Orchestrator")) return false;
  if (!laws.gpt_assist_campaign_context.authority.includes("accepted-live only")) return false;
  if (!laws.gpt_assist_campaign_context.portability.includes("without private chat history")) return false;
  if (!laws.execution_autonomy_and_communication.rule.includes("technical puzzles autonomously")) return false;
  if (!laws.execution_autonomy_and_communication.communication_budget.includes("one consolidated")) return false;
  if (!laws.execution_autonomy_and_communication.local_problem_rule.includes("remain local")) return false;
  if (!laws.execution_autonomy_and_communication.real_blocker_threshold.includes("safe in-scope alternatives are exhausted")) return false;
  if (!laws.execution_autonomy_and_communication.forbidden.includes("Silence never authorizes scope expansion")) return false;
  if (!laws.materiality_filter.nonblocking_rule.includes("continue the active stage")) return false;
  if (!laws.blueprint_budget.forbidden.includes("future checkpoint evidence")) return false;
  if (laws.delegated_stage_transition.central_required_only_for.length !== 7) return false;
  if (JSON.stringify(laws.audit_deployment_boundary.deployment_blockers) !== JSON.stringify(exactDeploymentBlockers)) return false;
  if (!laws.authority_reality_split.rule.includes("currently exists")) return false;
  if (!laws.draft_and_seal.draft_rule.includes("must not receive authoritative content-addressed identities")) return false;
  if (laws.draft_and_seal.overwrite_forbidden !== "Sealed records are never overwritten.") return false;
  if (!laws.mechanical_receipts.manual_claim.includes("cannot override contrary machine readback")) return false;
  if (JSON.stringify(Object.keys(laws.proportionality.profiles)) !== JSON.stringify(["LOW", "MEDIUM", "HIGH"])) return false;
  if (!laws.owner_only_filter.safe_default.includes("reversible in-scope route")) return false;
  if (JSON.stringify(draft.owner_only_classes) !== JSON.stringify([
    "NEW_OR_INCREASED_UNAPPROVED_COST",
    "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE",
    "GOVERNED_STACK_OR_CONSTITUTIONAL_ARCHITECTURE_CHANGE",
    "REPOSITORY_AUTHORITY_TOPOLOGY_CHANGE",
    "DELETION_OF_ACCEPTED_OR_PROTECTED_WORK_OR_PRODUCTION_DATA",
    "UNRESOLVED_MATERIAL_PRODUCT_INTENT_CONTRADICTION",
    "OTHER_IRREVERSIBLE_ACTION_OUTSIDE_DELEGATED_AUTHORITY",
  ])) return false;
  if (laws.single_goal.retained_2_0rc_behavior !== true) return false;
  if (!laws.case_evaluation.self_tightening.includes("materially distinct")) return false;
  if (laws.case_evaluation.campaign_override !== "FORBIDDEN") return false;
  if (!laws.failure_reframe.owner.includes("direct supervising agent")) return false;
  if (!laws.failure_reframe.trigger.includes("same mechanism fails twice")) return false;
  if (!laws.failure_reframe.trigger.includes("governed progress interval")) return false;
  if (!laws.failure_reframe.non_trigger.includes("localized failure")) return false;
  if (!laws.failure_reframe.rule.includes("exactly one reproducibly selected reframing lens")) return false;
  if (/\bmultiple\b|\blenses\b/.test(laws.failure_reframe.rule)) return false;
  if (laws.failure_reframe.lens_selection.selected_lens_count !== 1) return false;
  if (laws.failure_reframe.lens_selection.lenses.length !== 9) return false;
  if (new Set(laws.failure_reframe.lens_selection.lenses).size !== 9) return false;
  if (!laws.failure_reframe.lens_selection.algorithm.includes("governance.reframe.lens-seed.v1")) return false;
  if (!laws.failure_reframe.lens_selection.algorithm.includes("governance.reframe.lens-rank.v1")) return false;
  if (!laws.failure_reframe.lens_selection.algorithm.includes("Later evidence attaches without reseeding")) return false;
  if (!laws.failure_reframe.lens_selection.selection_is_not_authority.includes("never chooses")) return false;
  if (!laws.failure_reframe.loop_control.includes("may not repeatedly self-reframe")) return false;
  if (!laws.failure_reframe.supervisor_liveness.boundary.includes("no broader custody")) return false;
  if (!laws.failure_reframe.technical_advice.includes("one bounded technical recommendation")) return false;
  if (!laws.failure_reframe.builder_feasibility_objection.includes("one evidence-backed feasibility objection")) return false;
  return true;
}

let hostileRejected = 0;
for (const [label, mutate] of hostileMutations) {
  const draft = structuredClone(kernel);
  mutate(draft);
  if (validatesKernel(draft)) {
    errors.push(`hostile mutation accepted: ${label}`);
  } else {
    hostileRejected += 1;
  }
}

const workflowHostileMutations = [
  ["remove Feature Lead", (draft) => {
    draft.roles = draft.roles.filter((role) => role.role_id !== "FEATURE_LEAD");
  }],
  ["reuse platform agent", (draft) => { draft.platform_agent_capsule.reuse_forbidden = "Reuse allowed."; }],
  ["two feature-root writers", (draft) => {
    draft.worktree_modes.find((mode) => mode.mode_id === "FEATURE_ROOT_EXCLUSIVE").writers = 2;
  }],
  ["force three lanes", (draft) => { draft.campaign_compiler.topology_selection.default = "THREE_LANES"; }],
  ["remove single-root exception rule", (draft) => {
    draft.campaign_compiler.topology_selection.lane_count_rule = "Use as many lanes as possible.";
  }],
  ["multi-lane without time benefit", (draft) => {
    draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all =
      draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all
        .filter((rule) => !rule.includes("milestone time"));
  }],
  ["multi-lane without cost benefit", (draft) => {
    draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all =
      draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all
        .filter((rule) => !rule.includes("reconciliation"));
  }],
  ...expectedMultiLanePredicates.map((predicate, index) => [
    `replace multi-lane predicate ${index + 1}`,
    (draft) => {
      draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all[index] =
        `${predicate} by convenience`;
    },
  ]),
  ["multi-lane admission drops evidence", (draft) => {
    draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.admission =
      "Multiple lanes are preferred.";
  }],
  ["remove fail-closed single-root fallback", (draft) => {
    draft.campaign_compiler.topology_selection.failure_default =
      "Choose any topology when evidence is missing.";
  }],
  ["merge every feature checkpoint", (draft) => {
    draft.campaign_compiler.topology_selection.SINGLE_LANE.integration_rule =
      "Merge every feature checkpoint to the shared default branch.";
  }],
  ["deploy every feature checkpoint", (draft) => {
    draft.campaign_compiler.milestone_release_policy.feature_checkpoint =
      "Mint and deploy every feature checkpoint.";
  }],
  ["milestone becomes task count", (draft) => {
    draft.campaign_compiler.milestone_release_policy.milestone_definition =
      "Deploy after five tasks.";
  }],
  ["allow cross-lane cherry-pick", (draft) => {
    draft.campaign_compiler.cross_lane_contract_law.rule = "Cherry-picks allowed.";
  }],
  ["Central approves every stage", (draft) => {
    draft.campaign_compiler.autonomy.global_orchestrator_must_not =
      draft.campaign_compiler.autonomy.global_orchestrator_must_not
        .filter((rule) => !rule.includes("require approval"));
  }],
  ["Runtime decides semantics", (draft) => {
    draft.roles.find((role) => role.role_id === "GLOBAL_RUNTIME").does_not_own =
      draft.roles.find((role) => role.role_id === "GLOBAL_RUNTIME").does_not_own
        .filter((boundary) => !boundary.includes("semantic merge-conflict"));
  }],
  ["Auditor becomes Product writer", (draft) => {
    draft.roles.find((role) => role.role_id === "INDEPENDENT_AUDITOR").writer_authority = "Product writer";
  }],
  ["builder owns workflow reframe", (draft) => {
    draft.failure_reframe_workflow.owner = "The builder.";
  }],
  ["ambiguous workflow lens seed", (draft) => {
    draft.failure_reframe_workflow.lens_sampler.seed = "Hash concatenated values.";
  }],
  ["duplicate workflow lens", (draft) => {
    draft.failure_reframe_workflow.lens_sampler.catalog.push("ELI5");
  }],
  ["repeat self reframe", (draft) => { draft.failure_reframe_workflow.anti_loop = "Repeat."; }],
  ["workflow reframes every first failure", (draft) => {
    draft.failure_reframe_workflow.trigger.automatic_when = ["any first failure"];
  }],
  ["workflow removes local correction", (draft) => {
    draft.failure_reframe_workflow.trigger.not_for = "Nothing.";
  }],
  ["context capsule becomes whole corpus", (draft) => {
    draft.context_capsule.budget = "Copy the whole authority corpus.";
  }],
  ["lease recovery permits second writer", (draft) => {
    draft.lease_recovery.safety = "Second writer allowed.";
  }],
  ["capability extension overrides kernel", (draft) => {
    draft.capability_extension_law.cannot_override = [];
  }],
  ["topology changes active lane", (draft) => {
    draft.campaign_compiler.topology_amendment.forbidden = [];
  }],
  ["workflow deputy broadens custody", (draft) => {
    draft.failure_reframe_workflow.supervisor_liveness.boundary = "Broader custody allowed.";
  }],
  ["workflow repeated objections", (draft) => {
    draft.failure_reframe_workflow.builder_feasibility_objection = "Object repeatedly.";
  }],
  ["remove authority-corpus roots", (draft) => {
    draft.authority_corpus_system.root_variables = [];
  }],
  ["authority tree escapes root", (draft) => {
    draft.authority_corpus_system.compiler.refusal = "Allow all paths.";
  }],
  ["rewrite unchanged authority pages", (draft) => {
    draft.authority_corpus_system.compiler.idempotency = "Rewrite every page.";
  }],
  ["build log becomes current authority", (draft) => {
    draft.authority_corpus_system.page_contract.build_log_rule =
      "Build log is the current-state authority.";
  }],
  ["overview becomes evidence dump", (draft) => {
    draft.authority_corpus_system.page_contract.overview_rule =
      "Copy every receipt and test log into the overview.";
  }],
  ["archive before release closure", (draft) => {
    draft.evidence_library_system.archive_trigger = "Archive any draft immediately.";
  }],
  ["delete loose evidence without readback", (draft) => {
    draft.evidence_library_system.loose_evidence_rule = "Delete loose files after ZIP write.";
  }],
  ["archive failure deletes active dossier", (draft) => {
    draft.evidence_library_system.failure_rule = "Delete the active dossier on failure.";
  }],
  ["platform comments claim authority", (draft) => {
    draft.authority_corpus_system.page_contract.platform_context_rule =
      "Comments establish authority.";
  }],
  ["human repeats discoverable context", (draft) => {
    draft.context_elicitation.agent_fill_rule = "Ask the human for every fact.";
  }],
  ["remove elicitation stop rule", (draft) => {
    draft.context_elicitation.stop_when = [];
  }],
  ["context blocker stops everything", (draft) => {
    draft.context_blocker_system.continuity = "Stop every lane.";
  }],
  ["context blocker omits safe default", (draft) => {
    draft.context_blocker_system.required_record =
      draft.context_blocker_system.required_record.filter((field) => field !== "safe_default");
  }],
  ["specialist narrates every step", (draft) => {
    draft.specialist_execution_autonomy.communication.ordinary = "Report every step.";
  }],
  ["specialist escalates every puzzle", (draft) => {
    draft.specialist_execution_autonomy.report_only_when = ["any puzzle"];
  }],
  ["specialist autonomy permits scope expansion", (draft) => {
    draft.specialist_execution_autonomy.boundary = "Broaden scope silently.";
  }],
  ["campaign authority has two writers", (draft) => {
    draft.portable_campaign_controller.authority_writer.role = "GLOBAL_ORCHESTRATOR_AND_AUDITOR";
  }],
  ["campaign heartbeat loses configuration binding", (draft) => {
    draft.portable_campaign_controller.heartbeat.interval_source = "HARDCODED";
  }],
  ["campaign pre-spawns platform wave", (draft) => {
    draft.portable_campaign_controller.agent_lifecycle.platform_agents =
      "Pre-spawn every Platform Agent.";
  }],
  ["campaign treats failing test as owner blocker", (draft) => {
    draft.portable_campaign_controller.true_blocker.classes.push("FAILING_TEST");
  }],
  ["campaign promotes standard authority on merge", (draft) => {
    draft.portable_campaign_controller.authority_writer.promotion_trigger = "MERGED";
  }],
  ["campaign depins without successor record", (draft) => {
    draft.portable_campaign_controller.agent_lifecycle.depin_precondition = [];
  }],
  ["campaign removes living record", (draft) => {
    delete draft.portable_campaign_controller.authority_writer.living_campaign;
  }],
  ["campaign lets agents rewrite events", (draft) => {
    draft.portable_campaign_controller.authority_writer.living_campaign
      .event_write = "Agents rewrite the shared current file.";
  }],
  ["campaign omits Platform spawn sessions", (draft) => {
    draft.portable_campaign_controller.authority_writer.living_campaign
      .feature_spawn_binding = "Platform sessions are not recorded.";
  }],
  ["campaign drops living record at handoff", (draft) => {
    draft.portable_campaign_controller.authority_writer.living_campaign
      .handoff = "Discard the campaign ledger at handoff.";
  }],
];

function validatesWorkflow(draft) {
  if (JSON.stringify(draft.roles.map((role) => role.role_id)) !== JSON.stringify(expectedRoles)) return false;
  if (draft.generic_web_capabilities.length !== 15) return false;
  if (new Set(draft.generic_web_capabilities.map((item) => item.capability_id)).size !== 15) return false;
  if (draft.worktree_modes.length !== 7) return false;
  if (new Set(draft.worktree_modes.map((item) => item.mode_id)).size !== 7) return false;
  if (!draft.platform_agent_capsule.reuse_forbidden.includes("never reused")) return false;
  if (!draft.context_capsule.budget.includes("only context material")) return false;
  if (!draft.lease_recovery.safety.includes("never creates a second simultaneous writer")) return false;
  if (draft.capability_extension_law.cannot_override.length !== 6) return false;
  const featureRoot = draft.worktree_modes.find((mode) => mode.mode_id === "FEATURE_ROOT_EXCLUSIVE");
  if (featureRoot.writers !== 1) return false;
  if (draft.campaign_compiler.topology_selection.default !== "SINGLE_LANE_ONLY_FOR_2_1RC_ACTIVATION") return false;
  if (!draft.campaign_compiler.topology_selection.lane_count_rule.includes("exactly one cumulative root")) return false;
  if (!draft.campaign_compiler.topology_selection.lane_count_rule.includes("cannot mint a second writer root")) return false;
  if (JSON.stringify(draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.choose_when_all)
      !== JSON.stringify(expectedMultiLanePredicates)) return false;
  if (!draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.admission.includes("DESIGN_ONLY_NOT_ACTIVATABLE_IN_2_1RC")) return false;
  if (!draft.campaign_compiler.topology_selection.MULTI_LANE_CASCADE.admission.includes("executable per-lane state")) return false;
  if (!draft.campaign_compiler.topology_selection.failure_default.includes("fails closed to one cumulative root")) return false;
  if (!draft.campaign_compiler.topology_selection.SINGLE_LANE.checkpoint_rule.includes("substantial usable batch")) return false;
  if (!draft.campaign_compiler.topology_selection.SINGLE_LANE.integration_rule.includes("not individually merged")) return false;
  if (!draft.campaign_compiler.milestone_release_policy.feature_checkpoint.includes("do not merge, mint, or deploy")) return false;
  if (draft.campaign_compiler.milestone_release_policy.terminal_sequence.length !== 7) return false;
  if (!draft.campaign_compiler.milestone_release_policy.milestone_definition.includes("end-to-end user outcome")) return false;
  if (!draft.campaign_compiler.cross_lane_contract_law.rule.includes("never cherry-picks")) return false;
  if (draft.campaign_compiler.topology_amendment.forbidden.length !== 5) return false;
  if (!draft.campaign_compiler.autonomy.global_orchestrator_must_not.some((rule) => rule.includes("require approval"))) return false;
  const runtime = draft.roles.find((role) => role.role_id === "GLOBAL_RUNTIME");
  if (!runtime.does_not_own.some((boundary) => boundary.includes("semantic merge-conflict"))) return false;
  const auditor = draft.roles.find((role) => role.role_id === "INDEPENDENT_AUDITOR");
  if (!auditor.writer_authority.includes("never Product")) return false;
  if (!draft.failure_reframe_workflow.owner.includes("direct supervising agent")) return false;
  if (draft.failure_reframe_workflow.trigger.automatic_when.length !== 6) return false;
  if (!draft.failure_reframe_workflow.trigger.not_for.includes("localized failure")) return false;
  if (draft.failure_reframe_workflow.lens_sampler.selected_lens_count !== 1) return false;
  if (draft.failure_reframe_workflow.lens_sampler.catalog.length !== 9) return false;
  if (new Set(draft.failure_reframe_workflow.lens_sampler.catalog).size !== 9) return false;
  if (!draft.failure_reframe_workflow.lens_sampler.seed.includes("governance.reframe.lens-seed.v1")) return false;
  if (!draft.failure_reframe_workflow.lens_sampler.selection.includes("governance.reframe.lens-rank.v1")) return false;
  if (!draft.failure_reframe_workflow.anti_loop.includes("cannot self-reframe")) return false;
  if (!draft.failure_reframe_workflow.supervisor_liveness.boundary.includes("no broader custody")) return false;
  if (!draft.failure_reframe_workflow.technical_advice.includes("one bounded technical recommendation")) return false;
  if (!draft.failure_reframe_workflow.builder_feasibility_objection.includes("one evidence-backed feasibility objection")) return false;
  if (JSON.stringify(draft.authority_corpus_system.root_variables)
      !== JSON.stringify(expectedAuthorityRootVariables)) return false;
  if (!draft.authority_corpus_system.compiler.refusal.includes("symbolic-link traversal")) return false;
  if (!draft.authority_corpus_system.compiler.refusal.includes("ancestor/descendant corpus roots")) return false;
  if (!draft.authority_corpus_system.compiler.idempotency.includes("not rewritten")) return false;
  if (!draft.authority_corpus_system.page_contract.build_log_rule.includes("append-only")) return false;
  if (!draft.authority_corpus_system.page_contract.overview_rule.includes("ten recent substantial events")) return false;
  if (draft.evidence_library_system.active_window_days !== 14) return false;
  if (!draft.evidence_library_system.archive_trigger.includes("ACCEPTED_LIVE_CLOSED")) return false;
  if (!draft.evidence_library_system.loose_evidence_rule.includes("never deleted as information")) return false;
  if (!draft.evidence_library_system.failure_rule.includes("preserves the active dossier")) return false;
  if (!draft.authority_corpus_system.page_contract.platform_context_rule.includes("not executable authority")) return false;
  if (draft.context_elicitation.owner !== "GLOBAL_ORCHESTRATOR") return false;
  if (draft.context_elicitation.mode !== "SEMI_SCRIPTED_DRILL_ME") return false;
  if (!draft.context_elicitation.agent_fill_rule.includes("does not ask the human to repeat")) return false;
  if (draft.context_elicitation.stop_when.length !== 7) return false;
  if (!draft.context_elicitation.must_not.includes("interrogate for exhaustive certainty")) return false;
  if (draft.context_blocker_system.required_record.length !== 11) return false;
  if (!draft.context_blocker_system.required_record.includes("safe_default")) return false;
  if (!draft.context_blocker_system.continuity.includes("dependent outcome")) return false;
  if (draft.specialist_execution_autonomy.default_posture !== "WORK_SILENTLY_TO_DONE") return false;
  if (draft.specialist_execution_autonomy.report_only_when.length !== 7) return false;
  if (!draft.specialist_execution_autonomy.communication.ordinary.includes("No step narration")) return false;
  if (!draft.specialist_execution_autonomy.communication.completion.includes("One consolidated return")) return false;
  if (!draft.specialist_execution_autonomy.boundary.includes("never permits silent scope expansion")) return false;
  const controller = draft.portable_campaign_controller;
  if (controller.schema !== "governance.portable_campaign_state.v1") return false;
  if (controller.authority_writer.role !== "GLOBAL_ORCHESTRATOR") return false;
  if (controller.authority_writer.standard_articles !== "LAST_ACCEPTED_LIVE_RELEASE_ONLY") return false;
  if (controller.authority_writer.promotion_trigger !== "ACCEPTED_LIVE_CLOSED") return false;
  if (!controller.authority_writer.living_campaign.event_write.includes("APPEND_ONLY")) return false;
  if (!controller.authority_writer.living_campaign.orchestrator_spawn_binding
    .includes("EVERY_AGENT_SESSION")) return false;
  if (!controller.authority_writer.living_campaign.feature_spawn_binding
    .includes("ON_DEMAND_PLATFORM_AGENT_SESSION")) return false;
  if (!controller.authority_writer.living_campaign.handoff
    .includes("AGGREGATE_LEDGER_DIGEST_PER_SESSION_WRITER_HEADS_AND_COMPILED_VIEW")) return false;
  if (!controller.authority_writer.living_campaign.parallelism
    .includes("PER_SESSION_CHAINS")) return false;
  if (!controller.authority_writer.living_campaign.forbidden
    .includes("rewriting or deleting a prior event")) return false;
  if (controller.heartbeat.interval_source !== "SEALED_CONFIGURATION_SNAPSHOT"
      || controller.heartbeat.minimum_minutes !== 1
      || controller.heartbeat.maximum_minutes !== 1440) return false;
  if (!controller.dependency_execution.compile.includes("deterministic topological order")) return false;
  if (!controller.dependency_execution.goal_rule.includes("same-root handoff")) return false;
  if (!controller.agent_lifecycle.platform_agents.includes("only on demand")) return false;
  if (controller.agent_lifecycle.depin_precondition.length !== 5) return false;
  if (controller.agent_lifecycle.persistent.join(",") !== "GLOBAL_RUNTIME") return false;
  if (!controller.agent_lifecycle.campaign_start[0].includes("campaign-scoped Campaign Orchestrator")) return false;
  if (controller.true_blocker.classes.includes("FAILING_TEST")) return false;
  if (!controller.true_blocker.effect.includes("SUSPENDED_TRUE_BLOCKER")) return false;
  if (!controller.recovery.fresh_machine.includes("Old chat access is optional")) return false;
  if (!campaignControllerSource.includes("compileLivingCampaignEvent")
      || !campaignControllerSource.includes("compileLivingCampaignView")
      || !campaignControllerSource.includes("validateLivingCampaignLedger")
      || !campaignControllerSource.includes("appendLivingCampaignEvent")
      || !campaignControllerSource.includes("readLivingCampaignLedger")
      || !campaignControllerVerifierSource.includes("living campaign record")) return false;
  if (!campaignControllerSource.includes("verifyProductAcceptanceProof")
      || !acceptanceBridgeSource.includes("compileAcceptance")
      || !acceptanceBridgeSource.includes("governance.product_acceptance_proof.v1")) return false;
  if (browserRuntimeLifecycle.browser.interactive_browser
      !== "CONFIGURATION_SNAPSHOT_SELECTED") return false;
  if (browserRuntimeLifecycle.automation.framework !== "CONFIGURATION_SNAPSHOT_SELECTED"
      || browserRuntimeLifecycle.automation.profile !== "ISOLATED_AUTOMATION_PROFILE") return false;
  if (browserRuntimeLifecycle.agent_lifecycle.persistent_roles.join(",") !== "GLOBAL_RUNTIME") return false;
  if (browserRuntimeLifecycle.seam_review.always_required.join(",") !== "SECURITY") return false;
  if (!browserRuntimeLifecycleVerifierSource.includes("OPERATING_SYSTEM_DEFAULT_BROWSER")) return false;
  return true;
}

let workflowHostileRejected = 0;
for (const [label, mutate] of workflowHostileMutations) {
  const draft = structuredClone(workflow);
  mutate(draft);
  if (validatesWorkflow(draft)) {
    errors.push(`workflow hostile mutation accepted: ${label}`);
  } else {
    workflowHostileRejected += 1;
  }
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

const controllerVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.campaign_controller_verifier.path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  controllerVerifier.status === 0
    && controllerVerifier.stdout.includes("PASS Governance 2.1rc portable campaign controller"),
  `campaign-controller verifier failed: ${controllerVerifier.stderr || controllerVerifier.stdout}`,
);
const browserRuntimeVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.browser_runtime_lifecycle_verifier.path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  browserRuntimeVerifier.status === 0
    && browserRuntimeVerifier.stdout.includes(
      "PASS Governance 2.1rc browser/runtime/lifecycle",
    ),
  `browser/runtime/lifecycle verifier failed: ${
    browserRuntimeVerifier.stderr || browserRuntimeVerifier.stdout
  }`,
);
const dynamicBootstrapVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.dynamic_bootstrap_verifier.path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  dynamicBootstrapVerifier.status === 0
    && dynamicBootstrapVerifier.stdout.includes("PASS Governance 2.1rc dynamic Bootstrap"),
  `dynamic Bootstrap verifier failed: ${
    dynamicBootstrapVerifier.stderr || dynamicBootstrapVerifier.stdout
  }`,
);
const bootstrapAlignmentVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.bootstrap_alignment_verifier.path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  bootstrapAlignmentVerifier.status === 0
    && bootstrapAlignmentVerifier.stdout.includes("PASS AgentOS Bootstrap alignment"),
  `Bootstrap alignment verifier failed: ${
    bootstrapAlignmentVerifier.stderr || bootstrapAlignmentVerifier.stdout
  }`,
);
const guidedBootstrapVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.guided_bootstrap.verifier_path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  guidedBootstrapVerifier.status === 0
    && guidedBootstrapVerifier.stdout.includes("Governance 2.1rc guided Bootstrap PASS"),
  `guided Bootstrap verifier failed: ${
    guidedBootstrapVerifier.stderr || guidedBootstrapVerifier.stdout
  }`,
);
const gptAssistVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.gpt_assist.verifier_path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  gptAssistVerifier.status === 0
    && gptAssistVerifier.stdout.includes("Governance 2.1rc GPT_ASSIST PASS"),
  `GPT_ASSIST verifier failed: ${
    gptAssistVerifier.stderr || gptAssistVerifier.stdout
  }`,
);
const questionTreeVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.question_tree.verifier_path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  questionTreeVerifier.status === 0
    && questionTreeVerifier.stdout.includes("Governance 2.1rc question-tree PASS"),
  `question-tree verifier failed: ${
    questionTreeVerifier.stderr || questionTreeVerifier.stdout
  }`,
);
const portabilityVerifier = spawnSync(
  process.execPath,
  [path.join(root, binding.portability_verifier.path)],
  {cwd: root, encoding: "utf8"},
);
requireCondition(
  portabilityVerifier.status === 0
    && portabilityVerifier.stdout.includes("PASS AgentOS 2.1rc portability"),
  `portability verifier failed: ${portabilityVerifier.stderr || portabilityVerifier.stdout}`,
);

if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(
  `PASS Governance 2.1rc portable kernel/context separation; `
  + `${requiredLaws.length} laws; ${workflow.generic_web_capabilities.length} capabilities; `
  + `${workflow.worktree_modes.length} worktree modes; `
  + `${hostileRejected + workflowHostileRejected + portabilityHostileRejected
    + corpusHostileRejected + portableContextHostileRejected
    + evidenceLibraryHostileRejected + 3} hostile mutations rejected`,
);
