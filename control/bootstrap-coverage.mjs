#!/usr/bin/env node

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {BOOTSTRAP_OUTPUT_DEFINITIONS} from "./bootstrap-output-definitions.mjs";
import {projectLifeContractNeedsOwner} from "./project-life-contract.mjs";

export {BOOTSTRAP_OUTPUT_DEFINITIONS};

export const BOOTSTRAP_COVERAGE_SCHEMA = "agentos.bootstrap_coverage.v1";
export const BOOTSTRAP_COVERAGE_STATUSES = Object.freeze([
  "DISCOVERED",
  "OWNER_CONFIRMED",
  "DEFAULTED",
  "DERIVED",
  "DEFERRED_NONBLOCKING",
  "NOT_APPLICABLE_WITH_PROOF",
  "OWNER_REQUIRED",
  "DEPENDENCY_PENDING",
  "CONFLICT",
]);
export const BOOTSTRAP_COVERAGE_SOURCE_KINDS = Object.freeze([
  "DISCOVERY",
  "OWNER_INPUT",
  "PORTABLE_DEFAULT",
  "DERIVED_OUTPUT",
  "NOT_APPLICABLE_PROOF",
  "DEPENDENCY",
  "UNRESOLVED_OWNER_BOUNDARY",
]);

export const BOOTSTRAP_REQUIRED_OUTPUT_GROUPS = Object.freeze([
  "PROJECT_DEFINITION",
  "PROJECT_IMPORT",
  "SOURCE_PRESERVATION",
  "NORMALIZATION_POLICY",
  "STANDARDS_REGISTRY",
  "NORTH_STAR",
  "FIRST_USEFUL_WORKFLOW",
  "DEVELOPMENT_PLAN",
  "PROJECT_LIFE_CONTRACT",
  "FUNCTION_REQUIREMENTS",
  "TECHNICAL_BASELINE",
  "DELIVERY_POLICY",
  "DELIVERY_TARGET",
  "DESIGN_BIBLE",
  "SECURITY_BASELINE",
  "AUTHORITY_BOUNDARIES",
  "BOUNDARY_CONTRACT",
  "AUTHORITY_CORPUS",
  "MODEL_POLICY",
  "GLOBAL_POLICY_STATE",
  "CONTROLLER_SUPERVISION",
  "BOOTSTRAP_SAFETY_ANALYSIS",
  "OWNER_REVIEW",
  "PERSISTENT_RUNTIME",
  "FIRST_CAMPAIGN",
  "EXACT_CREATION_PLAN",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

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
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

export {canonicalDigest};

function answerPresent(answers, id) {
  return Object.hasOwn(answers, id) && answers[id] !== undefined;
}

function answerHasValue(answer, fields) {
  return isRecord(answer) && fields.some((field) => answer[field] !== undefined && answer[field] !== null);
}

function factIds(discovery, pattern, statuses = ["OBSERVED_FACT"]) {
  return discovery
    .filter((fact) => fact && typeof fact.fact_id === "string" && pattern.test(fact.fact_id) && statuses.includes(fact.status))
    .map((fact) => fact.fact_id)
    .sort(compareUtf8);
}

function hasSignal(discovery, pattern) {
  return factIds(discovery, pattern).length > 0;
}

function hasConflict(discovery, pattern = /.*/u) {
  return discovery.some((fact) => fact && pattern.test(fact.fact_id ?? "") && ["CONFLICT", "UNKNOWN"].includes(fact.status));
}

function hasTechnicalEvidence(discovery) {
  return hasSignal(discovery, /^(?:project\.marker\.|stack\.)/u);
}

function hasDataAnswer(answer) {
  return answerHasValue(answer, ["data", "storage", "backup_and_recovery", "migrations", "database"]);
}

function hasAuthenticationAnswer(answer) {
  return answerHasValue(answer, ["authentication", "auth", "identity", "authorization"]);
}

function deliveryAnswerGaps(answer, finishAnswer = undefined) {
  if (!isRecord(answer)) return ["DELIVERY_POLICY_OWNER_INPUT", ...(finishAnswer === undefined ? ["DELIVERY_FINISH_OWNER_CHOICE"] : [])];
  const runner = answer.ci_runner ?? answer.runner ?? {};
  const deployment = answer.deployment ?? {};
  const cost = answer.cost_boundaries ?? {};
  const finish = answer.finish ?? finishAnswer;
  const runnerRoute = runner.route ?? runner.runner_route;
  const deploymentRoute = deployment.route ?? deployment.hosting_route;
  const gaps = [];
  if (!runnerRoute || runnerRoute === "PROJECT_DEFINED") gaps.push("CI_RUNNER_ROUTE");
  if (["HOSTED", "VPS"].includes(runnerRoute) && !runner.provider_id) gaps.push("CI_RUNNER_PROVIDER_BINDING");
  if (!deploymentRoute || deploymentRoute === "PROJECT_DEFINED") gaps.push("DEPLOYMENT_ROUTE");
  if (["MANAGED", "VPS"].includes(deploymentRoute) && !deployment.provider_id) gaps.push("DEPLOYMENT_PROVIDER_BINDING");
  if (!Array.isArray(deployment.environment_ids) || deployment.environment_ids.length === 0) gaps.push("DEPLOYMENT_ENVIRONMENT_BINDING");
  if ((runner.weekly_minutes_budget ?? cost.weekly_runner_minutes) === undefined) gaps.push("RUNNER_MINUTES_BOUNDARY");
  if (finish === undefined || finish === null) gaps.push("DELIVERY_FINISH_OWNER_CHOICE");
  return gaps;
}

function runtimeBound(answer) {
  return isRecord(answer)
    && typeof answer.session_id === "string" && answer.session_id.trim().length > 0
    && typeof answer.environment_identity === "string" && answer.environment_identity.trim().length > 0;
}

function isBlocking(status) {
  return ["OWNER_REQUIRED", "DEPENDENCY_PENDING", "CONFLICT"].includes(status);
}

function rowBase(definitionRecord, overrides = {}) {
  return {
    output_id: definitionRecord.output_id,
    category: definitionRecord.category,
    required: definitionRecord.required,
    applicability: definitionRecord.applicability,
    source_kind: overrides.source_kind ?? "DEPENDENCY",
    source_refs: overrides.source_refs ?? [],
    discovery_inputs: overrides.discovery_inputs ?? [],
    status: overrides.status ?? "DEPENDENCY_PENDING",
    safe_default: definitionRecord.safe_default,
    probe_required: definitionRecord.probe_required,
    owner_decision_required: overrides.owner_decision_required ?? definitionRecord.owner_decision_required,
    unavailable_behavior: definitionRecord.unavailable_behavior,
    reopen_triggers: definitionRecord.reopen_triggers,
    dependency_output_ids: definitionRecord.dependency_output_ids,
    question_ids: definitionRecord.question_ids,
    compiled_field_paths: definitionRecord.compiled_field_paths,
    blocking: overrides.blocking ?? isBlocking(overrides.status ?? "DEPENDENCY_PENDING"),
    reason: overrides.reason ?? "DEPENDENCY_NOT_COMPILED",
  };
}

function ownerRow(definitionRecord, answerId, answers, reason, gaps = []) {
  const present = answerPresent(answers, answerId);
  return rowBase(definitionRecord, {
    source_kind: present ? "OWNER_INPUT" : "UNRESOLVED_OWNER_BOUNDARY",
    source_refs: [answerId],
    status: present && gaps.length === 0 ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
    blocking: !present || gaps.length > 0,
    reason: present && gaps.length === 0 ? "OWNER_INPUT_BOUND" : (gaps.join("+") || reason),
    owner_decision_required: true,
  });
}

function projectImportSignal(discovery) {
  return hasSignal(discovery, /^(?:project\.marker\.|authority-corpus\.candidate\.|design-authority\.candidate\.|delivery\.marker\.)/u);
}

function projectImportGaps(answer) {
  if (!isRecord(answer)) return ["PROJECT_IMPORT_OWNER_INPUT"];
  const mode = answer.mode;
  const gaps = [];
  if (!["ADOPT_IN_PLACE", "CLEAN_COPY", "NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(mode)) gaps.push("PROJECT_IMPORT_MODE");
  if (typeof answer.source_root !== "string" || answer.source_root.trim().length === 0) gaps.push("PROJECT_IMPORT_SOURCE_ROOT");
  if (mode !== "ADOPT_IN_PLACE" && (typeof answer.destination_root !== "string" || answer.destination_root.trim().length === 0)) gaps.push("PROJECT_IMPORT_DESTINATION_ROOT");
  return gaps;
}

function compileRows(discovery, answers) {
  const technicalAnswer = answers["project.technical_baseline"];
  const deliveryAnswer = answers["project.delivery_policy"];
  const deliveryFinishAnswer = answers["project.delivery_finish"];
  const authorityAnswer = answers["authority-corpus.source"];
  const visibleSurface = hasSignal(discovery, /(?:ui|view|route|design|visual|browser)/iu);
  const technicalConflict = hasConflict(discovery, /^(?:project\.marker\.|stack\.)/u);
  const technicalKnown = hasTechnicalEvidence(discovery) && !technicalConflict;
  const dataSignal = hasDataAnswer(technicalAnswer) || hasSignal(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu);
  const authSignal = hasAuthenticationAnswer(technicalAnswer) || hasSignal(discovery, /(?:auth|identity|permission|session|security)/iu);
  const rows = [];

  const discoveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DISCOVERY_PERMISSION");
  rows.push(ownerRow(discoveryDefinition, "bootstrap.discovery.mode", answers, "DISCOVERY_PERMISSION_OWNER_INPUT"));

  for (const outputId of ["PROJECT_DEFINITION"]) {
    const definitionRecord = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === outputId);
    const answerId = definitionRecord.question_ids[0];
    rows.push(ownerRow(definitionRecord, answerId, answers, `${outputId}_OWNER_INPUT`));
  }
  const importDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "PROJECT_IMPORT");
  const importAnswer = answers["project.import"];
  const importSignal = projectImportSignal(discovery) || answerPresent(answers, "project.import");
  const importGaps = projectImportGaps(importAnswer);
  rows.push(rowBase(importDefinition, importSignal
    ? {
      source_kind: answerPresent(answers, "project.import") ? "OWNER_INPUT" : "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.import"],
      discovery_inputs: factIds(discovery, /^(?:project\.marker\.|authority-corpus\.candidate\.|design-authority\.candidate\.|delivery\.marker\.)/u),
      status: importGaps.length === 0 ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
      blocking: importGaps.length > 0,
      reason: importGaps.length === 0 ? "PROJECT_IMPORT_MODE_AND_SEPARATE_SOURCE_CONTEXT_BOUND" : importGaps.join("+"),
      owner_decision_required: true,
    }
    : {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["NO_EXISTING_PROJECT_SIGNAL"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_EXISTING_PROJECT_MARKER_OR_AUTHORITY_SIGNAL_REQUIRES_IMPORT_MODE",
    }));
  const importRow = rows.find((row) => row.output_id === "PROJECT_IMPORT");
  const preservationDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "SOURCE_PRESERVATION");
  rows.push(rowBase(preservationDefinition, !importSignal
    ? {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["PROJECT_IMPORT_NOT_APPLICABLE"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_PROJECT_IMPORT_MEANS_NO_SOURCE_MIGRATION_ARCHIVE",
    }
    : importRow?.blocking === false
      ? {
        source_kind: "DERIVED_OUTPUT",
        source_refs: ["PROJECT_IMPORT"],
        status: "DERIVED",
        blocking: false,
        reason: "SOURCE_PRESERVATION_REQUIRED_BEFORE_ANY_IMPORT_BUILD_OR_REFACTOR",
      }
      : {
        source_kind: "DEPENDENCY",
        source_refs: ["PROJECT_IMPORT"],
        status: "DEPENDENCY_PENDING",
        blocking: true,
        reason: "PROJECT_IMPORT_MODE_AND_SOURCE_ROOT_REQUIRED_BEFORE_SOURCE_PRESERVATION",
      }));
  const normalizationDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "NORMALIZATION_POLICY");
  rows.push(rowBase(normalizationDefinition, importRow?.blocking === false
    ? {
      source_kind: importSignal ? "DERIVED_OUTPUT" : "PORTABLE_DEFAULT",
      source_refs: importSignal ? ["PROJECT_IMPORT"] : ["AGENTOS_NAMING_NORMALIZATION_V1"],
      status: importSignal ? "DERIVED" : "DEFAULTED",
      blocking: false,
      reason: importSignal ? "COMPATIBILITY_FIRST_NORMALIZATION_POLICY_DERIVED_FROM_IMPORT_MODE" : "INTERNAL_AND_NEW_SURFACE_NORMALIZATION_DEFAULTED",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["PROJECT_IMPORT"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "NORMALIZATION_POLICY_WAITS_FOR_PROJECT_IMPORT_MODE",
    }));
  const standardsDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "STANDARDS_REGISTRY");
  rows.push(rowBase(standardsDefinition, {
    source_kind: "PORTABLE_DEFAULT",
    source_refs: ["schemas/standards-registry.v1.json", "VERSION_PINNED_PORTABLE_STANDARDS"],
    status: "DEFAULTED",
    blocking: false,
    reason: "VERSION_PINNED_PORTABLE_STANDARDS_REGISTRY_DEFAULTED;_PROJECT_OVERLAYS_REMAIN_STRICTLY_TYPED",
  }));
  for (const outputId of ["NORTH_STAR", "FIRST_USEFUL_WORKFLOW"]) {
    const definitionRecord = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === outputId);
    const answerId = definitionRecord.question_ids[0];
    rows.push(ownerRow(definitionRecord, answerId, answers, `${outputId}_OWNER_INPUT`));
  }
  const developmentDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DEVELOPMENT_PLAN");
  rows.push(rowBase(developmentDefinition, answerPresent(answers, "project.development_mode")
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["project.development_mode"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "OWNER_SELECTED_DEVELOPMENT_MODE_BOUND_TO_PHASE_PLAN",
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["RAPID_PROTOTYPING_DEFAULT"],
      status: "DEFAULTED",
      blocking: false,
      reason: "RAPID_PROTOTYPING_DEFAULTS_TO_A_SMALL_WORKING_VERSION_BEFORE_ITERATION",
    }));
  const lifeDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "PROJECT_LIFE_CONTRACT");
  if (answerPresent(answers, "project.life_contract")) {
    rows.push(ownerRow(lifeDefinition, "project.life_contract", answers, "PROJECT_LIFE_CONTRACT_OWNER_INPUT"));
  } else if (projectLifeContractNeedsOwner({answer: undefined, discovery, deliveryAnswer, technicalAnswer})) {
    rows.push(rowBase(lifeDefinition, {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.life_contract", ...factIds(discovery, /(?:public|production|beta|hosting|deployment|database|storage|migration|auth|identity|domain|persistent)/iu)],
      discovery_inputs: factIds(discovery, /(?:public|production|beta|hosting|deployment|database|storage|migration|auth|identity|domain|persistent)/iu),
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "PROJECT_LIFE_CONTRACT_REQUIRED_FOR_MATERIAL_MATURITY_AUDIENCE_DATA_OR_LIFETIME_SIGNAL",
      owner_decision_required: true,
    }));
  } else {
    rows.push(rowBase(lifeDefinition, {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["PRIVATE_PROTOTYPE_SAFE_DEFAULT"],
      status: "DEFAULTED",
      blocking: false,
      reason: "NO_MATERIAL_LIFE_CONTRACT_SIGNAL;_PRIVATE_PROTOTYPE_DEFAULTED",
    }));
  }
  const authorityDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "AUTHORITY_BOUNDARIES");
  rows.push(ownerRow(authorityDefinition, "project.protected_boundaries", answers, "AUTHORITY_BOUNDARIES_OWNER_INPUT"));
  const authorityCorpusDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "AUTHORITY_CORPUS");
  rows.push(ownerRow(authorityCorpusDefinition, "authority-corpus.source", answers, "AUTHORITY_CORPUS_OWNER_INPUT"));
  const authorityRow = rows.find((row) => row.output_id === "AUTHORITY_CORPUS");
  if (authorityRow && answerPresent(answers, "authority-corpus.source")) {
    const operation = authorityAnswer?.operation;
    if (!["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW"].includes(operation)) {
      authorityRow.status = "OWNER_REQUIRED";
      authorityRow.blocking = true;
      authorityRow.reason = "AUTHORITY_CORPUS_OPERATION_MUST_BE_CREATE_IMPORT_OR_REFACTOR";
    } else if (["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(operation)
      && (typeof authorityAnswer.source_root !== "string" || authorityAnswer.source_root.trim().length === 0)) {
      authorityRow.status = "OWNER_REQUIRED";
      authorityRow.blocking = true;
      authorityRow.reason = "IMPORTED_OR_REFACTORED_AUTHORITY_CORPUS_REQUIRES_READ_ONLY_SOURCE_ROOT";
    }
  }

  const designDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DESIGN_BIBLE");
  if (answerPresent(answers, "project.design")) {
    rows.push(ownerRow(designDefinition, "project.design", answers, "DESIGN_BIBLE_OWNER_INPUT"));
  } else if (visibleSurface) {
    rows.push(rowBase(designDefinition, {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: factIds(discovery, /(?:ui|view|route|design|visual|browser)/iu),
      discovery_inputs: factIds(discovery, /(?:ui|view|route|design|visual|browser)/iu),
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_REQUIRES_OWNER_DESIGN_CONTEXT",
      owner_decision_required: true,
    }));
  } else {
    rows.push(rowBase(designDefinition, {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["NO_VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_SIGNAL"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_SIGNAL",
    }));
  }

  const securityDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "SECURITY_BASELINE");
  rows.push(rowBase(securityDefinition, answerPresent(answers, "security.baseline")
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["security.baseline"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "SECURITY_STANDARD_BOUND_FROM_PROJECT_CONTEXT",
      owner_decision_required: false,
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["agentos.security-baseline.v1"],
      status: "DEFAULTED",
      blocking: false,
      reason: "PORTABLE_SECURITY_STANDARD_IDENTITY_AND_REQUIREMENTS_DEFAULTED",
    }));

  const technicalDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "TECHNICAL_BASELINE");
  if (answerPresent(answers, "project.technical_baseline")) {
    rows.push(ownerRow(technicalDefinition, "project.technical_baseline", answers, "TECHNICAL_BASELINE_OWNER_INPUT"));
  } else if (technicalKnown) {
    rows.push(rowBase(technicalDefinition, {
      source_kind: "DISCOVERY",
      source_refs: factIds(discovery, /^(?:project\.marker\.|stack\.)/u),
      discovery_inputs: factIds(discovery, /^(?:project\.marker\.|stack\.)/u),
      status: "DISCOVERED",
      blocking: false,
      reason: "TECHNICAL_MARKERS_DISCOVERED_WITHOUT_CONFLICT",
    }));
  } else {
    rows.push(rowBase(technicalDefinition, {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.technical_baseline"],
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "TECHNICAL_BASELINE_NOT_DISCOVERED_OR_HAS_CONFLICT",
      owner_decision_required: true,
    }));
  }

  const dataDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DATA_AND_MIGRATION_POLICY");
  rows.push(rowBase(dataDefinition, dataSignal
    ? {
      source_kind: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "OWNER_INPUT" : "DISCOVERY",
      source_refs: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? ["project.technical_baseline"] : factIds(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu),
      discovery_inputs: factIds(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu),
      status: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
      blocking: !answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]),
      reason: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "DATA_POLICY_BOUND" : "DATA_SIGNAL_REQUIRES_TYPED_POLICY",
      owner_decision_required: !answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]),
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["NO_DATA_OR_MIGRATION_SIGNAL"],
      status: "DEFERRED_NONBLOCKING",
      blocking: false,
      reason: "NO_DATA_OR_MIGRATION_SIGNAL",
    }));

  const authDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "AUTHENTICATION_AND_ACCESS");
  rows.push(rowBase(authDefinition, authSignal
    ? {
      source_kind: hasAuthenticationAnswer(technicalAnswer) ? "OWNER_INPUT" : "DISCOVERY",
      source_refs: hasAuthenticationAnswer(technicalAnswer) ? ["project.technical_baseline"] : factIds(discovery, /(?:auth|identity|permission|session|security)/iu),
      discovery_inputs: factIds(discovery, /(?:auth|identity|permission|session|security)/iu),
      status: hasAuthenticationAnswer(technicalAnswer) ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
      blocking: !hasAuthenticationAnswer(technicalAnswer),
      reason: hasAuthenticationAnswer(technicalAnswer) ? "AUTHENTICATION_POLICY_BOUND" : "AUTHENTICATION_SIGNAL_REQUIRES_TYPED_POLICY",
      owner_decision_required: !hasAuthenticationAnswer(technicalAnswer),
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["NO_AUTHENTICATION_OR_ACCESS_SIGNAL"],
      status: "DEFERRED_NONBLOCKING",
      blocking: false,
      reason: "NO_AUTHENTICATION_OR_ACCESS_SIGNAL",
    }));

  const deliveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DELIVERY_POLICY");
  const deliveryGaps = deliveryAnswerGaps(deliveryAnswer, deliveryFinishAnswer);
  const deliveryOwnerGap = deliveryGaps.includes("DELIVERY_FINISH_OWNER_CHOICE");
  const deliveryDependentGaps = deliveryGaps.filter((gap) => gap !== "DELIVERY_FINISH_OWNER_CHOICE");
  rows.push(rowBase(deliveryDefinition, {
    source_kind: answerPresent(answers, "project.delivery_policy") || answerPresent(answers, "project.delivery_finish") ? "OWNER_INPUT" : "UNRESOLVED_OWNER_BOUNDARY",
    source_refs: ["project.delivery_policy", "project.delivery_finish"],
    discovery_inputs: factIds(discovery, /^(?:delivery\.|repositories\.|tool\.)/u),
    status: deliveryOwnerGap ? "OWNER_REQUIRED" : deliveryDependentGaps.length === 0 ? "OWNER_CONFIRMED" : "DEFERRED_NONBLOCKING",
    blocking: deliveryOwnerGap,
    reason: deliveryOwnerGap ? "DELIVERY_FINISH_OWNER_CHOICE" : deliveryDependentGaps.length === 0 ? "DELIVERY_POLICY_BOUND" : `DELIVERY_FINISH_BOUND_WITH_DEPENDENT_GAPS:${deliveryDependentGaps.join("+")}`,
    owner_decision_required: true,
  }));

  const lifeRow = rows.find((row) => row.output_id === "PROJECT_LIFE_CONTRACT");
  const technicalRow = rows.find((row) => row.output_id === "TECHNICAL_BASELINE");
  const authorityBoundariesRow = rows.find((row) => row.output_id === "AUTHORITY_BOUNDARIES");
  const targetDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DELIVERY_TARGET");
  const targetReady = !deliveryOwnerGap && lifeRow?.blocking === false;
  const targetAnswerPresent = isRecord(deliveryAnswer) && answerPresent(deliveryAnswer, "delivery_target");
  rows.push(rowBase(targetDefinition, targetReady
    ? {
      source_kind: targetAnswerPresent ? "OWNER_INPUT" : "DERIVED_OUTPUT",
      source_refs: targetAnswerPresent ? ["project.delivery_policy.delivery_target"] : ["DELIVERY_POLICY", "PROJECT_LIFE_CONTRACT"],
      status: targetAnswerPresent ? "OWNER_CONFIRMED" : "DERIVED",
      blocking: false,
      reason: targetAnswerPresent ? "DELIVERY_TARGET_BOUND_FROM_OWNER_INPUT" : "DELIVERY_TARGET_DERIVED_FROM_ROUTE_AND_LIFE_CONTRACT",
      owner_decision_required: targetAnswerPresent,
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["DELIVERY_POLICY", "PROJECT_LIFE_CONTRACT"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "DELIVERY_POLICY_AND_PROJECT_LIFE_CONTRACT_REQUIRED_BEFORE_TARGET_COMPILATION",
    }));

  const boundaryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "BOUNDARY_CONTRACT");
  const boundaryReady = authorityBoundariesRow?.blocking === false
    && lifeRow?.blocking === false
    && technicalRow?.blocking === false
    && !deliveryOwnerGap;
  rows.push(rowBase(boundaryDefinition, boundaryReady
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["AUTHORITY_BOUNDARIES", "PROJECT_LIFE_CONTRACT", "TECHNICAL_BASELINE", "DELIVERY_POLICY", "DELIVERY_TARGET"],
      status: "DERIVED",
      blocking: false,
      reason: "BOUNDARY_CONTRACT_DERIVED_WITH_IMMUTABLE_CONSTITUTIONAL_RULES_AND_TYPED_OWNER_LIMITS",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["AUTHORITY_BOUNDARIES", "PROJECT_LIFE_CONTRACT", "TECHNICAL_BASELINE", "DELIVERY_POLICY", "DELIVERY_TARGET"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "BOUNDARY_CONTRACT_DEPENDENCIES_REMAIN_UNBOUND",
    }));

  const probeDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DELIVERY_PROBES");
  rows.push(rowBase(probeDefinition, !deliveryOwnerGap
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["DELIVERY_POLICY", "PROJECT_DEFINITION"],
      status: "DERIVED",
      blocking: false,
      reason: "READ_ONLY_PROBE_PLAN_DERIVED_FROM_BOUND_POLICY",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["DELIVERY_POLICY"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "DELIVERY_POLICY_MUST_BE_BOUND_BEFORE_PROBES",
    }));

  const modelDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "MODEL_POLICY");
  rows.push(ownerRow(modelDefinition, "project.model_economics", answers, "MODEL_POLICY_OWNER_INPUT"));

  const policyDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "GLOBAL_POLICY_STATE");
  rows.push(rowBase(policyDefinition, {
    source_kind: "DERIVED_OUTPUT",
    source_refs: ["MODEL_POLICY", "BOUNDARY_CONTRACT", "PROJECT_LIFE_CONTRACT"],
    status: "DERIVED",
    blocking: false,
    reason: "DECLARED_CONTENT_ADDRESSED_POLICY_VARIABLES_DERIVED_WITH_DEPENDENCY_IMPACT",
  }));

  const supervisionDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "CONTROLLER_SUPERVISION");
  rows.push(rowBase(supervisionDefinition, answerPresent(answers, "project.audit_interval")
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["project.audit_interval", "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "OWNER_AUDIT_INTERVAL_BOUND_TO_PERSISTENT_CONTROLLER_WORKFLOW_POLICY",
      owner_decision_required: true,
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["OPERATIONS.HEARTBEAT_INTERVAL_MINUTES", "PERSISTENT_CONTROLLER", "PERSISTENT_PRODUCT_OWNER"],
      status: "DEFAULTED",
      blocking: false,
      reason: "SEPARATE_PERSISTENT_CONTROLLER_AND_PRODUCT_OWNER_15_MINUTE_DEFAULTS_BOUND",
    }));

  const safetyDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "BOOTSTRAP_SAFETY_ANALYSIS");
  rows.push(rowBase(safetyDefinition, {
    source_kind: "DERIVED_OUTPUT",
    source_refs: ["AUTHORITY_BOUNDARIES", "DELIVERY_POLICY", "PROJECT_LIFE_CONTRACT"],
    status: "DERIVED",
    blocking: false,
    reason: "JSA_SCOPE_AND_PROTECTED_ACTIVATION_BOUNDARIES_DERIVED_FROM_BOUND_PROJECT_CONDITIONS",
  }));

  const reviewDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "OWNER_REVIEW");
  rows.push(rowBase(reviewDefinition, {
    source_kind: "PORTABLE_DEFAULT",
    source_refs: ["REVIEW.USER_REVIEW_MODE", "PRIVATE_MARKDOWN", "PROJECT_ONLY_MEMORY"],
    status: "DEFAULTED",
    blocking: false,
    reason: "OWNER_REVIEW_RECOMMENDED_FOR_SUBSTANTIAL_OR_AMBIGUOUS_CAMPAIGNS",
  }));

  const runtimeDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "PERSISTENT_RUNTIME");
  rows.push(rowBase(runtimeDefinition, runtimeBound(answers["project.runtime"])
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["project.runtime"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "PERSISTENT_RUNTIME_AND_ENVIRONMENT_BOUND",
      owner_decision_required: true,
    }
    : {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.runtime"],
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "EXACT_RUNTIME_SESSION_AND_ENVIRONMENT_BINDING_REQUIRED",
      owner_decision_required: true,
    }));

  const functionDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "FUNCTION_REQUIREMENTS");
  const intentReady = answerPresent(answers, "project.north_star") && answerPresent(answers, "project.first_workflow");
  rows.push(rowBase(functionDefinition, intentReady
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["NORTH_STAR", "FIRST_USEFUL_WORKFLOW"],
      status: "DERIVED",
      blocking: false,
      reason: "ATOMIC_FUNCTION_CLAUSE_DERIVED_FROM_OWNER_INTENT",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["NORTH_STAR", "FIRST_USEFUL_WORKFLOW"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "OWNER_INTENT_AND_FIRST_USEFUL_WORKFLOW_REQUIRED",
    }));

  const firstCampaignDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "FIRST_CAMPAIGN");
  rows.push(rowBase(firstCampaignDefinition, intentReady && runtimeBound(answers["project.runtime"])
    ? {
      source_kind: answerPresent(answers, "project.first_campaign") ? "OWNER_INPUT" : "DERIVED_OUTPUT",
      source_refs: answerPresent(answers, "project.first_campaign") ? ["project.first_campaign"] : ["NORTH_STAR", "FIRST_USEFUL_WORKFLOW"],
      status: answerPresent(answers, "project.first_campaign") ? "OWNER_CONFIRMED" : "DEFAULTED",
      blocking: false,
      reason: answerPresent(answers, "project.first_campaign") ? "FIRST_CAMPAIGN_CONTEXT_BOUND" : "MINIMAL_CAMPAIGN_DERIVED_FROM_FIRST_USEFUL_WORKFLOW",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["NORTH_STAR", "FIRST_USEFUL_WORKFLOW", "PERSISTENT_RUNTIME"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "FIRST_CAMPAIGN_REQUIRES_INTENT_WORKFLOW_AND_RUNTIME",
    }));

  const recoveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "RECOVERY_AND_ROLLBACK");
  rows.push(rowBase(recoveryDefinition, !deliveryOwnerGap && runtimeBound(answers["project.runtime"])
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["DELIVERY_POLICY", "PERSISTENT_RUNTIME"],
      status: "DERIVED",
      blocking: false,
      reason: "EXACT_ROLLBACK_IDENTITY_DERIVED_FROM_DELIVERY_AND_RUNTIME_BOUNDARIES",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["DELIVERY_POLICY", "PERSISTENT_RUNTIME"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "DELIVERY_AND_RUNTIME_BINDINGS_REQUIRED_FOR_RECOVERY",
    }));

  const observabilityDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "OBSERVABILITY_AND_RETENTION");
  rows.push(rowBase(observabilityDefinition, {
    source_kind: answerHasValue(technicalAnswer, ["observability"]) ? "OWNER_INPUT" : "PORTABLE_DEFAULT",
    source_refs: answerHasValue(technicalAnswer, ["observability"]) ? ["project.technical_baseline"] : ["PORTABLE_EVENT_LOG_AND_RETENTION_DEFAULT"],
    status: "DEFAULTED",
    blocking: false,
    reason: answerHasValue(technicalAnswer, ["observability"]) ? "OBSERVABILITY_CONTEXT_BOUND" : "PORTABLE_OBSERVABILITY_AND_RETENTION_DEFAULT",
  }));

  const legacyDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "LEGACY_PRESERVATION");
  const operation = authorityAnswer?.operation;
  const legacySourceBound = typeof authorityAnswer?.source_root === "string" && authorityAnswer.source_root.trim().length > 0;
  rows.push(rowBase(legacyDefinition, operation === "CREATE_NEW"
    ? {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["authority-corpus.source.operation=CREATE_NEW"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_IMPORTED_OR_REFACTORED_CORPUS_REQUIRES_LEGACY_ARCHIVE",
    }
    : (operation === "IMPORT" || operation === "REFACTOR_PREVIOUS_GOVERNANCE") && legacySourceBound
      ? {
        source_kind: "OWNER_INPUT",
        source_refs: ["authority-corpus.source"],
        status: "OWNER_CONFIRMED",
        blocking: false,
        reason: "LEGACY_ARCHIVE_GATE_REQUIRED_BEFORE_REPLACEMENT_WRITES",
      }
      : (operation === "IMPORT" || operation === "REFACTOR_PREVIOUS_GOVERNANCE")
        ? {
          source_kind: "UNRESOLVED_OWNER_BOUNDARY",
          source_refs: ["authority-corpus.source.source_root"],
          status: "OWNER_REQUIRED",
          blocking: true,
          reason: "IMPORTED_OR_REFACTORED_AUTHORITY_REQUIRES_A_READ_ONLY_SOURCE_ROOT",
          owner_decision_required: true,
        }
      : {
        source_kind: "DEPENDENCY",
        source_refs: ["AUTHORITY_CORPUS"],
        status: "DEPENDENCY_PENDING",
        blocking: true,
        reason: "AUTHORITY_CORPUS_OPERATION_MUST_BE_BOUND_BEFORE_LEGACY_GATE_CAN_BE_RESOLVED",
      }));

  for (const outputId of ["BOOTSTRAP_PROOF", "PROJECT_CONTEXT_SEPARATION", "ACTIVATION_BOUNDARY"]) {
    const definitionRecord = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === outputId);
    rows.push(rowBase(definitionRecord, {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: [outputId === "ACTIVATION_BOUNDARY" ? "PREPARED_NOT_ACTIVATED" : "PORTABLE_KERNEL"],
      status: "DEFAULTED",
      blocking: false,
      reason: outputId === "ACTIVATION_BOUNDARY" ? "ACTIVATION_REMAINS_EXPLICIT_OWNER_DECISION" : "PORTABLE_GOVERNANCE_PROOF_RULE",
    }));
  }

  const exactDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "EXACT_CREATION_PLAN");
  const unresolvedRows = rows.filter((row) => row.blocking);
  rows.push(rowBase(exactDefinition, unresolvedRows.length === 0
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: rows.map((row) => row.output_id),
      status: "DERIVED",
      blocking: false,
      reason: "ALL_REQUIRED_MATERIAL_OUTPUTS_HAVE_BOUND_PROVENANCE_AND_STATUS",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: unresolvedRows.map((row) => row.output_id),
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "MATERIAL_OUTPUT_GAPS_REMAIN",
    }));
  return rows;
}

export function compileBootstrapCoverage({discovery = [], answers = {}} = {}) {
  assert(Array.isArray(discovery), "Bootstrap coverage discovery must be an array");
  requireRecord(answers, "Bootstrap coverage answers");
  const discoveryDigest = canonicalDigest(discovery);
  const answersDigest = canonicalDigest(answers);
  const outputs = compileRows(discovery, answers);
  const pendingQuestionIds = [...new Set(outputs.filter((row) => row.blocking).flatMap((row) => row.question_ids))];
  const materialGaps = outputs.filter((row) => row.blocking).map((row) => ({
    output_id: row.output_id,
    status: row.status,
    reason: row.reason,
    question_ids: row.question_ids,
    dependency_output_ids: row.dependency_output_ids,
  }));
  const body = {
    schema: BOOTSTRAP_COVERAGE_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: materialGaps.length === 0 ? "READY_TO_COMPILE" : "QUESTION_PENDING",
    discovery_digest_sha256: discoveryDigest,
    answers_sha256: answersDigest,
    required_output_groups: BOOTSTRAP_REQUIRED_OUTPUT_GROUPS,
    output_count: outputs.length,
    outputs,
    pending_question_ids: pendingQuestionIds,
    material_gaps: materialGaps,
    question_rule: "ASK_ONLY_THE_EARLIEST_MATERIAL_GAP_NOT_SETTLED_BY_DISCOVERY_DEFAULT_DERIVATION_OR_EXISTING_OWNER_INPUT",
  };
  const coverage = {...body, coverage_sha256: canonicalDigest(body)};
  validateBootstrapCoverage(coverage);
  return coverage;
}

export function validateBootstrapCoverage(coverage) {
  requireRecord(coverage, "Bootstrap coverage");
  assert(coverage.schema === BOOTSTRAP_COVERAGE_SCHEMA && coverage.version === 1 && coverage.governance_version === "2.1rc", "Bootstrap coverage identity is invalid");
  assert(["READY_TO_COMPILE", "QUESTION_PENDING"].includes(coverage.status), "Bootstrap coverage status is invalid");
  requireSha(coverage.discovery_digest_sha256, "Bootstrap coverage discovery digest");
  requireSha(coverage.answers_sha256, "Bootstrap coverage answers digest");
  assert(Array.isArray(coverage.required_output_groups)
    && JSON.stringify(coverage.required_output_groups) === JSON.stringify(BOOTSTRAP_REQUIRED_OUTPUT_GROUPS), "Bootstrap coverage output groups are invalid");
  assert(Number.isSafeInteger(coverage.output_count) && coverage.output_count === BOOTSTRAP_OUTPUT_DEFINITIONS.length, "Bootstrap coverage output count is invalid");
  assert(Array.isArray(coverage.outputs) && coverage.outputs.length === BOOTSTRAP_OUTPUT_DEFINITIONS.length, "Bootstrap coverage outputs are invalid");
  for (const [index, row] of coverage.outputs.entries()) {
    const expected = BOOTSTRAP_OUTPUT_DEFINITIONS[index];
    requireRecord(row, `Bootstrap coverage output ${index}`);
    assert(row.output_id === expected.output_id, `Bootstrap coverage output order is invalid at ${index}`);
    assert(BOOTSTRAP_COVERAGE_STATUSES.includes(row.status), `Bootstrap coverage status is invalid for ${row.output_id}`);
    assert(["REQUIRED", "CONDITIONAL"].includes(row.applicability), `Bootstrap coverage applicability is invalid for ${row.output_id}`);
    assert(typeof row.required === "boolean" && typeof row.blocking === "boolean", `Bootstrap coverage flags are invalid for ${row.output_id}`);
    assert(BOOTSTRAP_COVERAGE_SOURCE_KINDS.includes(row.source_kind), `Bootstrap coverage source kind is invalid for ${row.output_id}`);
    assert(Array.isArray(row.source_refs) && Array.isArray(row.discovery_inputs), `Bootstrap coverage provenance is invalid for ${row.output_id}`);
    for (const reference of [...row.source_refs, ...row.discovery_inputs]) requireString(reference, `Bootstrap coverage provenance reference for ${row.output_id}`);
    assert(Array.isArray(row.question_ids) && row.question_ids.every((id) => QUESTION_ID.test(id)), `Bootstrap coverage question IDs are invalid for ${row.output_id}`);
    assert(Array.isArray(row.dependency_output_ids) && row.dependency_output_ids.every((id) => SAFE_ID.test(id)), `Bootstrap coverage dependencies are invalid for ${row.output_id}`);
    assert(Array.isArray(row.compiled_field_paths) && row.compiled_field_paths.every((field) => typeof field === "string" && field.length > 0), `Bootstrap coverage field paths are invalid for ${row.output_id}`);
    requireString(row.safe_default, `Bootstrap coverage safe default for ${row.output_id}`);
    requireString(row.unavailable_behavior, `Bootstrap coverage unavailable behavior for ${row.output_id}`);
    assert(Array.isArray(row.reopen_triggers) && row.reopen_triggers.length > 0, `Bootstrap coverage reopen triggers are missing for ${row.output_id}`);
    requireString(row.reason, `Bootstrap coverage reason for ${row.output_id}`);
    assert(row.blocking === isBlocking(row.status), `Bootstrap coverage blocking flag does not match status for ${row.output_id}`);
    assert(JSON.stringify(row.question_ids) === JSON.stringify(expected.question_ids), `Bootstrap coverage question mapping changed for ${row.output_id}`);
    assert(JSON.stringify(row.dependency_output_ids) === JSON.stringify(expected.dependency_output_ids), `Bootstrap coverage dependencies changed for ${row.output_id}`);
    assert(JSON.stringify(row.compiled_field_paths) === JSON.stringify(expected.compiled_field_paths), `Bootstrap coverage field mapping changed for ${row.output_id}`);
  }
  assert(Array.isArray(coverage.pending_question_ids), "Bootstrap coverage pending questions are invalid");
  assert(Array.isArray(coverage.material_gaps), "Bootstrap coverage material gaps are invalid");
  const expectedPendingQuestionIds = [...new Set(coverage.outputs.filter((row) => row.blocking).flatMap((row) => row.question_ids))];
  assert(JSON.stringify(coverage.pending_question_ids) === JSON.stringify(expectedPendingQuestionIds), "Bootstrap coverage pending questions are not derived from blocking rows");
  const expectedMaterialGaps = coverage.outputs.filter((row) => row.blocking).map((row) => ({
    output_id: row.output_id,
    status: row.status,
    reason: row.reason,
    question_ids: row.question_ids,
    dependency_output_ids: row.dependency_output_ids,
  }));
  assert(JSON.stringify(coverage.material_gaps) === JSON.stringify(expectedMaterialGaps), "Bootstrap coverage material gaps are not derived from blocking rows");
  assert((coverage.status === "READY_TO_COMPILE") === (coverage.material_gaps.length === 0), "Bootstrap coverage readiness does not match material gaps");
  const body = structuredClone(coverage);
  delete body.coverage_sha256;
  requireSha(coverage.coverage_sha256, "Bootstrap coverage digest");
  assert(coverage.coverage_sha256 === canonicalDigest(body), "Bootstrap coverage is not content-addressed");
  return coverage;
}

export function coverageForQuestion(coverage, questionId) {
  validateBootstrapCoverage(coverage);
  return coverage.outputs.filter((row) => row.question_ids.includes(questionId));
}
