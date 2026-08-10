#!/usr/bin/env node

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const FEATURE_MAP_SCHEMA = "governance.feature_map.v1";
export const AUDITOR_REPORT_SCHEMA = "governance.auditor_completeness_report.v1";
export const AUDITOR_SEED_SCHEMA = "governance.auditor_seed.v1";
export const AUDITOR_SEED_BINDING_SCHEMA = "governance.auditor_seed_binding.v1";
export const INVENTORY_COVERAGE_SCHEMA = "governance.inventory_coverage_plan.v1";
export const FEATURE_INVENTORY_SCHEMA = "governance.feature_inventory.v1";
export const CONTRACT_STATUS = "PREPARED_NOT_ACTIVATED";
export const CONTROL_SPACE = "CONTROL_SPACE";
export const PUBLIC_SPACE = "PUBLIC";
export const FEATURE_STATUSES = Object.freeze([
  "BUILT_AND_CHECKED",
  "PARTLY_BUILT",
  "NOT_BUILT",
  "WAITING_FOR_OWNER_CHOICE",
  "NOT_NEEDED",
]);
export const STATUS_ROUTES = Object.freeze({
  BUILT_AND_CHECKED: "NO_FOLLOW_UP",
  PARTLY_BUILT: "CAMPAIGN_ORCHESTRATOR",
  NOT_BUILT: "CAMPAIGN_ORCHESTRATOR",
  WAITING_FOR_OWNER_CHOICE: "OWNER",
  NOT_NEEDED: "NO_FOLLOW_UP",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PRIVATE_REFERENCE_TOKEN = /(?:^|[._-])(?:secret|secrets|credential|credentials)(?:[._-]|$)/iu;
const PRIVATE_REFERENCE_SEGMENT = /^(?:\.git|\.env|tmp|var|home|root)$/iu;
const CHAT_REFERENCE_TOKEN = /(?:^[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:^|\/)(?:chat|conversation|thread)(?:\/|$))/iu;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const PROTECTED_PUBLIC_SUMMARY = /(?:\/(?:Users|home|private|tmp|var|root|etc)\/|[A-Za-z]:[\\/](?:Users|home|private|tmp|var|root)[\\/]|(?:api|access|secret|auth|private)[ _-]?(?:key|token|credential)\s*[:=]|(?:access|refresh|bearer|session|auth)[ _-]?token\s*[:=]|(?:chat|conversation|thread)[\/:_ -]|019f[a-f0-9-]{20,})/iu;

const FEATURE_MAP_KEYS = [
  "schema", "version", "contract_status", "visibility", "map_id", "project_id", "campaign_id", "build_id",
  "source_commit", "source_tree", "project_governance_sha256", "features", "feature_map_sha256",
];
const FEATURE_KEYS = ["feature_id", "label"];
const REPORT_KEYS = [
  "schema", "version", "contract_status", "visibility", "report_id", "feature_map_sha256", "source_commit", "source_tree",
  "auditor", "work", "classifications", "report_sha256",
];
const AUDITOR_KEYS = ["auditor_id", "role"];
const WORK_KEYS = ["builder_id", "accepted_by"];
const CLASSIFICATION_KEYS = ["feature_id", "status", "route", "evidence"];
const EVIDENCE_KEYS = [
  "evidence_id", "kind", "summary", "path", "link", "source_commit", "source_tree", "evidence_sha256",
];
const SEED_KEYS = ["schema", "version", "contract_status", "visibility", "seed_id", "binding", "check", "seed_sha256"];
const SEED_BINDING_KEYS = [
  "project_id", "campaign_id", "build_id", "source_commit", "source_tree", "project_governance_sha256", "feature_map_sha256",
];
const SEED_CHECK_KEYS = ["status", "checked_by_role", "evidence_sha256"];
const AUDITOR_BINDING_KEYS = [
  "schema", "version", "contract_status", "visibility", "seed_sha256", "auditor_id", "role", "fresh", "binding", "binding_sha256",
];
const INVENTORY_KEYS = [
  "schema", "version", "contract_status", "authority", "source_catalog", "coverage_rule",
  "expected_feature_count", "expected_governance_lane_count", "expected_platform_lane_count", "expected_auditor_count", "expected_report_count", "expected_goal_count",
  "goal_rule", "features", "governance_lanes", "parity", "platform_domains", "platform_lanes", "platform_phase",
];
const INVENTORY_FEATURE_KEYS = ["feature_id", "name", "kind", "sources", "report_path", "auditor_task_id", "worktree_id", "status"];
const INVENTORY_LANE_KEYS = ["lane_id", "name", "report_path", "auditor_task_id", "worktree_id", "status"];
const COVERAGE_KEYS = [
  "schema", "version", "contract_status", "inventory_schema", "feature_count", "governance_lane_count",
  "auditor_count", "report_count", "feature_map_sha256", "report_paths", "coverage_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function validatePublicSummary(value, label) {
  requireString(value, label);
  assert(!PROTECTED_PUBLIC_SUMMARY.test(value), `${label} contains private, credential-like, or chat-bound content`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} must be a portable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireCurrentSource(currentSourceCommit, currentSourceTree) {
  requireGitObject(currentSourceCommit, "current source commit");
  requireGitObject(currentSourceTree, "current source tree");
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function sortedUnique(values, label, key = (value) => value) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  const keys = values.map(key);
  keys.forEach((value) => requireIdentifier(value, `${label} identifier`));
  const sorted = [...keys].sort(compareUtf8);
  assert(new Set(keys).size === keys.length, `${label} contains duplicates`);
  assert(JSON.stringify(keys) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
}

function uniqueIdentifiers(values, label, key = (value) => value) {
  assert(Array.isArray(values), `${label} must be an array`);
  const keys = values.map(key);
  keys.forEach((value) => requireIdentifier(value, `${label} identifier`));
  assert(new Set(keys).size === keys.length, `${label} contains duplicates`);
}

function normalizeFeatureInput(value, index) {
  requireRecord(value, `feature ${index}`);
  const allowed = new Set(["feature_id", "featureId", "label"]);
  assert(Object.keys(value).every((key) => allowed.has(key)), `feature ${index} input fields mismatch`);
  assert(!(Object.hasOwn(value, "feature_id") && Object.hasOwn(value, "featureId")), `feature ${index} has duplicate ID fields`);
  const featureId = value.feature_id ?? value.featureId;
  requireIdentifier(featureId, `feature ${index} ID`);
  requireString(value.label, `feature ${featureId} label`);
  return {feature_id: featureId, label: value.label};
}

function validateFeature(feature, index) {
  exactKeys(feature, FEATURE_KEYS, `feature ${index}`);
  requireIdentifier(feature.feature_id, `feature ${index} ID`);
  requireString(feature.label, `feature ${feature.feature_id} label`);
}

function validateSourcePair(record, sourceCommit, sourceTree, label) {
  requireGitObject(record.source_commit, `${label} source commit`);
  requireGitObject(record.source_tree, `${label} source tree`);
  assert(record.source_commit === sourceCommit, `${label} source commit is stale`);
  assert(record.source_tree === sourceTree, `${label} source tree is stale`);
}

export function validateFeatureMap(featureMap, {currentSourceCommit, currentSourceTree} = {}) {
  exactKeys(featureMap, FEATURE_MAP_KEYS, "feature map");
  assert(featureMap.schema === FEATURE_MAP_SCHEMA, "feature map schema mismatch");
  assert(featureMap.version === 1, "feature map version mismatch");
  assert(featureMap.contract_status === CONTRACT_STATUS, "feature map is active or has an invalid contract status");
  assert(featureMap.visibility === CONTROL_SPACE, "feature map must remain in control space");
  for (const field of ["map_id", "project_id", "campaign_id", "build_id"]) requireIdentifier(featureMap[field], `feature map ${field}`);
  requireSha(featureMap.project_governance_sha256, "feature map project governance");
  requireCurrentSource(currentSourceCommit, currentSourceTree);
  validateSourcePair(featureMap, currentSourceCommit, currentSourceTree, "feature map");
  assert(Array.isArray(featureMap.features) && featureMap.features.length > 0, "feature map must contain features");
  for (const [index, feature] of featureMap.features.entries()) validateFeature(feature, index);
  sortedUnique(featureMap.features, "feature map features", (feature) => feature.feature_id);
  requireSha(featureMap.feature_map_sha256, "feature map digest");
  assert(featureMap.feature_map_sha256 === digestWithout(featureMap, "feature_map_sha256"), "feature map digest mismatch");
  return featureMap;
}

export function compileFeatureMap({
  mapId,
  projectId,
  campaignId,
  buildId,
  projectGovernanceSha256,
  sourceCommit,
  sourceTree,
  features,
}) {
  requireCurrentSource(sourceCommit, sourceTree);
  const normalizedFeatures = features.map(normalizeFeatureInput).sort((left, right) => compareUtf8(left.feature_id, right.feature_id));
  const featureMap = {
    schema: FEATURE_MAP_SCHEMA,
    version: 1,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    map_id: mapId,
    project_id: projectId,
    campaign_id: campaignId,
    build_id: buildId,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    project_governance_sha256: projectGovernanceSha256,
    features: normalizedFeatures,
    feature_map_sha256: null,
  };
  featureMap.feature_map_sha256 = digestWithout(featureMap, "feature_map_sha256");
  return validateFeatureMap(featureMap, {currentSourceCommit: sourceCommit, currentSourceTree: sourceTree});
}

export function routeForFeatureStatus(status) {
  assert(FEATURE_STATUSES.includes(status), `unknown feature status: ${status}`);
  return STATUS_ROUTES[status];
}

export function validatePublicReference(value, label = "public reference") {
  requireString(value, label);
  assert(!value.includes("\\"), `${label} must use project-relative paths`);
  assert(!value.startsWith("/") && !value.startsWith("~") && !/^[A-Za-z]:/u.test(value), `${label} must be project-relative`);
  assert(!SCHEME.test(value), `${label} must not be an absolute link`);
  const segments = value.split("/");
  const pathSegments = value.endsWith("/") ? segments.slice(0, -1) : segments;
  assert(pathSegments.length > 0 && pathSegments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} leaves the project`);
  assert(!pathSegments.some((segment) => PRIVATE_REFERENCE_SEGMENT.test(segment) || PRIVATE_REFERENCE_TOKEN.test(segment)), `${label} contains a private path`);
  assert(!CHAT_REFERENCE_TOKEN.test(value), `${label} contains a chat link`);
  return value;
}

function validateNullablePublicReference(value, label) {
  assert(value === null || typeof value === "string", `${label} must be null or a project-relative reference`);
  if (value !== null) validatePublicReference(value, label);
}

function normalizeEvidenceInput(value, index) {
  requireRecord(value, `evidence ${index}`);
  const allowed = new Set(["evidence_id", "evidenceId", "kind", "summary", "path", "link"]);
  assert(Object.keys(value).every((key) => allowed.has(key)), `evidence ${index} input fields mismatch`);
  assert(!(Object.hasOwn(value, "evidence_id") && Object.hasOwn(value, "evidenceId")), `evidence ${index} has duplicate ID fields`);
  const evidenceId = value.evidence_id ?? value.evidenceId;
  requireIdentifier(evidenceId, `evidence ${index} ID`);
  requireIdentifier(value.kind, `evidence ${evidenceId} kind`);
  validatePublicSummary(value.summary, `evidence ${evidenceId} summary`);
  const pathValue = value.path ?? null;
  const linkValue = value.link ?? null;
  validateNullablePublicReference(pathValue, `evidence ${evidenceId} path`);
  validateNullablePublicReference(linkValue, `evidence ${evidenceId} link`);
  return {evidence_id: evidenceId, kind: value.kind, summary: value.summary, path: pathValue, link: linkValue};
}

function validateEvidence(evidence, index, sourceCommit, sourceTree) {
  exactKeys(evidence, EVIDENCE_KEYS, `evidence ${index}`);
  requireIdentifier(evidence.evidence_id, `evidence ${index} ID`);
  requireIdentifier(evidence.kind, `evidence ${evidence.evidence_id} kind`);
  validatePublicSummary(evidence.summary, `evidence ${evidence.evidence_id} summary`);
  validateNullablePublicReference(evidence.path, `evidence ${evidence.evidence_id} path`);
  validateNullablePublicReference(evidence.link, `evidence ${evidence.evidence_id} link`);
  validateSourcePair(evidence, sourceCommit, sourceTree, `evidence ${evidence.evidence_id}`);
  requireSha(evidence.evidence_sha256, `evidence ${evidence.evidence_id} digest`);
  assert(evidence.evidence_sha256 === digestWithout(evidence, "evidence_sha256"), `evidence ${evidence.evidence_id} digest mismatch`);
}

function normalizeClassificationInput(value, index) {
  requireRecord(value, `classification ${index}`);
  const allowed = new Set(["feature_id", "featureId", "status", "evidence"]);
  assert(Object.keys(value).every((key) => allowed.has(key)), `classification ${index} input fields mismatch`);
  assert(!(Object.hasOwn(value, "feature_id") && Object.hasOwn(value, "featureId")), `classification ${index} has duplicate ID fields`);
  const featureId = value.feature_id ?? value.featureId;
  requireIdentifier(featureId, `classification ${index} feature ID`);
  assert(FEATURE_STATUSES.includes(value.status), `classification ${featureId} has an unknown status`);
  assert(Array.isArray(value.evidence) && value.evidence.length > 0, `classification ${featureId} requires evidence`);
  const evidence = value.evidence.map(normalizeEvidenceInput).sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  return {feature_id: featureId, status: value.status, evidence};
}

function validateClassification(classification, index, sourceCommit, sourceTree) {
  exactKeys(classification, CLASSIFICATION_KEYS, `classification ${index}`);
  requireIdentifier(classification.feature_id, `classification ${index} feature ID`);
  assert(FEATURE_STATUSES.includes(classification.status), `classification ${classification.feature_id} has an unknown feature status`);
  assert(classification.route === routeForFeatureStatus(classification.status), `classification ${classification.feature_id} route mismatch`);
  assert(Array.isArray(classification.evidence) && classification.evidence.length > 0, `classification ${classification.feature_id} requires evidence`);
  for (const [evidenceIndex, evidence] of classification.evidence.entries()) validateEvidence(evidence, evidenceIndex, sourceCommit, sourceTree);
  sortedUnique(classification.evidence, `classification ${classification.feature_id} evidence`, (evidence) => evidence.evidence_id);
}

function validateClassificationCoverage(classifications, featureMap) {
  assert(Array.isArray(classifications) && classifications.length === featureMap.features.length, "feature classifications must cover every mapped feature exactly once");
  const expected = featureMap.features.map((feature) => feature.feature_id);
  const actual = classifications.map((classification) => classification.feature_id);
  assert(new Set(actual).size === actual.length, "feature classifications contain duplicates");
  const expectedSorted = [...expected].sort(compareUtf8);
  const actualSorted = [...actual].sort(compareUtf8);
  assert(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted), "feature classifications contain an unknown or missing feature");
  assert(JSON.stringify(actual) === JSON.stringify([...actual].sort(compareUtf8)), "feature classifications must be UTF-8 sorted");
}

export function validateAuditorCompletenessReport(
  report,
  {featureMap, currentSourceCommit, currentSourceTree} = {},
) {
  requireRecord(featureMap, "auditor report feature map");
  validateFeatureMap(featureMap, {currentSourceCommit, currentSourceTree});
  exactKeys(report, REPORT_KEYS, "Auditor completeness report");
  assert(report.schema === AUDITOR_REPORT_SCHEMA, "Auditor report schema mismatch");
  assert(report.version === 1, "Auditor report version mismatch");
  assert(report.contract_status === CONTRACT_STATUS, "Auditor report is active or has an invalid contract status");
  assert(report.visibility === PUBLIC_SPACE, "Auditor completeness report must be public space");
  requireIdentifier(report.report_id, "Auditor report ID");
  requireSha(report.feature_map_sha256, "Auditor report feature map digest");
  assert(report.feature_map_sha256 === featureMap.feature_map_sha256, "Auditor report feature map binding mismatch");
  validateSourcePair(report, currentSourceCommit, currentSourceTree, "Auditor report");
  exactKeys(report.auditor, AUDITOR_KEYS, "Auditor identity");
  requireIdentifier(report.auditor.auditor_id, "Auditor identity");
  assert(report.auditor.role === "INDEPENDENT_AUDITOR", "Auditor report role is not independent");
  exactKeys(report.work, WORK_KEYS, "Audited work identity");
  requireIdentifier(report.work.builder_id, "audited work builder");
  assert(report.work.accepted_by === null || typeof report.work.accepted_by === "string", "audited work acceptor must be null or a string");
  if (report.work.accepted_by !== null) requireIdentifier(report.work.accepted_by, "audited work acceptor");
  assert(report.auditor.auditor_id !== report.work.builder_id, "Auditor cannot be the builder of the audited work");
  assert(report.work.accepted_by === null || report.auditor.auditor_id !== report.work.accepted_by, "Auditor cannot accept its own work");
  validateClassificationCoverage(report.classifications, featureMap);
  for (const [index, classification] of report.classifications.entries()) validateClassification(classification, index, currentSourceCommit, currentSourceTree);
  requireSha(report.report_sha256, "Auditor report digest");
  assert(report.report_sha256 === digestWithout(report, "report_sha256"), "Auditor report digest mismatch");
  return report;
}

export function compileAuditorCompletenessReport({
  reportId,
  featureMap,
  sourceCommit,
  sourceTree,
  auditorId,
  builderId,
  acceptedBy = null,
  classifications,
}) {
  validateFeatureMap(featureMap, {currentSourceCommit: sourceCommit, currentSourceTree: sourceTree});
  const normalizedClassifications = classifications
    .map(normalizeClassificationInput)
    .sort((left, right) => compareUtf8(left.feature_id, right.feature_id))
    .map((classification) => ({
      ...classification,
      route: routeForFeatureStatus(classification.status),
      evidence: classification.evidence.map((evidence) => ({
        ...evidence,
        source_commit: sourceCommit,
        source_tree: sourceTree,
        evidence_sha256: null,
      })).map((evidence) => ({...evidence, evidence_sha256: digestWithout(evidence, "evidence_sha256")})),
    }));
  const report = {
    schema: AUDITOR_REPORT_SCHEMA,
    version: 1,
    contract_status: CONTRACT_STATUS,
    visibility: PUBLIC_SPACE,
    report_id: reportId,
    feature_map_sha256: featureMap.feature_map_sha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    auditor: {auditor_id: auditorId, role: "INDEPENDENT_AUDITOR"},
    work: {builder_id: builderId, accepted_by: acceptedBy},
    classifications: normalizedClassifications,
    report_sha256: null,
  };
  report.report_sha256 = digestWithout(report, "report_sha256");
  return validateAuditorCompletenessReport(report, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree});
}

function validateSeedBinding(binding, label) {
  exactKeys(binding, SEED_BINDING_KEYS, label);
  for (const field of ["project_id", "campaign_id", "build_id"]) requireIdentifier(binding[field], `${label} ${field}`);
  requireGitObject(binding.source_commit, `${label} source commit`);
  requireGitObject(binding.source_tree, `${label} source tree`);
  requireSha(binding.project_governance_sha256, `${label} project governance`);
  requireSha(binding.feature_map_sha256, `${label} feature map digest`);
}

function assertSeedMatchesFeatureMap(seed, featureMap) {
  const expected = {
    project_id: featureMap.project_id,
    campaign_id: featureMap.campaign_id,
    build_id: featureMap.build_id,
    source_commit: featureMap.source_commit,
    source_tree: featureMap.source_tree,
    project_governance_sha256: featureMap.project_governance_sha256,
    feature_map_sha256: featureMap.feature_map_sha256,
  };
  assert(canonicalDigest(seed.binding) === canonicalDigest(expected), "Auditor seed binding differs from the feature map");
}

export function validateAuditorSeed(
  seed,
  {featureMap, currentSourceCommit, currentSourceTree} = {},
) {
  exactKeys(seed, SEED_KEYS, "Auditor seed");
  assert(seed.schema === AUDITOR_SEED_SCHEMA, "Auditor seed schema mismatch");
  assert(seed.version === 1, "Auditor seed version mismatch");
  assert(seed.contract_status === CONTRACT_STATUS, "Auditor seed is active or has an invalid contract status");
  assert(seed.visibility === CONTROL_SPACE, "Auditor seed must remain in control space");
  requireIdentifier(seed.seed_id, "Auditor seed ID");
  validateSeedBinding(seed.binding, "Auditor seed binding");
  exactKeys(seed.check, SEED_CHECK_KEYS, "Auditor seed check");
  assert(seed.check.status === "CHECKED", "Auditor seed must be CHECKED");
  assert(seed.check.checked_by_role === "CAMPAIGN_ORCHESTRATOR", "Auditor seed must be checked by the Campaign Orchestrator");
  requireSha(seed.check.evidence_sha256, "Auditor seed check evidence");
  if (currentSourceCommit !== undefined || currentSourceTree !== undefined) {
    requireCurrentSource(currentSourceCommit, currentSourceTree);
    assert(seed.binding.source_commit === currentSourceCommit, "Auditor seed source commit is stale");
    assert(seed.binding.source_tree === currentSourceTree, "Auditor seed source tree is stale");
  }
  if (featureMap !== undefined) {
    const mapCommit = currentSourceCommit ?? featureMap.source_commit;
    const mapTree = currentSourceTree ?? featureMap.source_tree;
    validateFeatureMap(featureMap, {currentSourceCommit: mapCommit, currentSourceTree: mapTree});
    assertSeedMatchesFeatureMap(seed, featureMap);
  }
  requireSha(seed.seed_sha256, "Auditor seed digest");
  assert(seed.seed_sha256 === digestWithout(seed, "seed_sha256"), "Auditor seed digest mismatch");
  return seed;
}

export function compileAuditorSeed({seedId, featureMap, sourceCommit, sourceTree, checkedEvidenceSha256}) {
  validateFeatureMap(featureMap, {currentSourceCommit: sourceCommit, currentSourceTree: sourceTree});
  const seed = {
    schema: AUDITOR_SEED_SCHEMA,
    version: 1,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    seed_id: seedId,
    binding: {
      project_id: featureMap.project_id,
      campaign_id: featureMap.campaign_id,
      build_id: featureMap.build_id,
      source_commit: featureMap.source_commit,
      source_tree: featureMap.source_tree,
      project_governance_sha256: featureMap.project_governance_sha256,
      feature_map_sha256: featureMap.feature_map_sha256,
    },
    check: {
      status: "CHECKED",
      checked_by_role: "CAMPAIGN_ORCHESTRATOR",
      evidence_sha256: checkedEvidenceSha256,
    },
    seed_sha256: null,
  };
  seed.seed_sha256 = digestWithout(seed, "seed_sha256");
  return validateAuditorSeed(seed, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree});
}

export function validateAuditorSeedBinding(
  auditorBinding,
  {seed, featureMap, currentSourceCommit, currentSourceTree} = {},
) {
  requireRecord(seed, "Auditor seed binding seed");
  validateAuditorSeed(seed, {featureMap, currentSourceCommit, currentSourceTree});
  exactKeys(auditorBinding, AUDITOR_BINDING_KEYS, "fresh Auditor seed binding");
  assert(auditorBinding.schema === AUDITOR_SEED_BINDING_SCHEMA, "fresh Auditor seed binding schema mismatch");
  assert(auditorBinding.version === 1, "fresh Auditor seed binding version mismatch");
  assert(auditorBinding.contract_status === CONTRACT_STATUS, "fresh Auditor seed binding is active or has an invalid contract status");
  assert(auditorBinding.visibility === CONTROL_SPACE, "fresh Auditor seed binding must remain in control space");
  requireSha(auditorBinding.seed_sha256, "fresh Auditor seed digest");
  assert(auditorBinding.seed_sha256 === seed.seed_sha256, "fresh Auditor was not created from this seed");
  requireIdentifier(auditorBinding.auditor_id, "fresh Auditor ID");
  assert(auditorBinding.role === "INDEPENDENT_AUDITOR", "fresh Auditor role is not independent");
  assert(auditorBinding.fresh === true, "Auditor seed binding is not fresh");
  validateSeedBinding(auditorBinding.binding, "fresh Auditor binding");
  assert(canonicalDigest(auditorBinding.binding) === canonicalDigest(seed.binding), "fresh Auditor binding differs from its seed");
  requireSha(auditorBinding.binding_sha256, "fresh Auditor binding digest");
  assert(auditorBinding.binding_sha256 === digestWithout(auditorBinding, "binding_sha256"), "fresh Auditor binding digest mismatch");
  return auditorBinding;
}

export function createFreshAuditorBinding({
  seed,
  auditorId,
  featureMap,
  currentSourceCommit,
  currentSourceTree,
}) {
  assert(typeof currentSourceCommit === "string" && typeof currentSourceTree === "string", "fresh Auditor creation requires current source identity");
  validateAuditorSeed(seed, {featureMap, currentSourceCommit, currentSourceTree});
  const auditorBinding = {
    schema: AUDITOR_SEED_BINDING_SCHEMA,
    version: 1,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    seed_sha256: seed.seed_sha256,
    auditor_id: auditorId,
    role: "INDEPENDENT_AUDITOR",
    fresh: true,
    binding: structuredClone(seed.binding),
    binding_sha256: null,
  };
  auditorBinding.binding_sha256 = digestWithout(auditorBinding, "binding_sha256");
  return validateAuditorSeedBinding(auditorBinding, {seed, featureMap, currentSourceCommit, currentSourceTree});
}

function validateInventoryFeature(feature, index) {
  exactKeys(feature, INVENTORY_FEATURE_KEYS, `inventory feature ${index}`);
  requireIdentifier(feature.feature_id, `inventory feature ${index} ID`);
  requireString(feature.name, `inventory feature ${feature.feature_id} name`);
  assert(["ROADMAP_CAPABILITY", "NAMED_CAPABILITY"].includes(feature.kind), `inventory feature ${feature.feature_id} kind is invalid`);
  assert(Array.isArray(feature.sources) && feature.sources.length > 0, `inventory feature ${feature.feature_id} sources are required`);
  feature.sources.forEach((source, sourceIndex) => validatePublicReference(source, `inventory feature ${feature.feature_id} source ${sourceIndex}`));
  validatePublicReference(feature.report_path, `inventory feature ${feature.feature_id} report path`);
  assert(feature.auditor_task_id === null || typeof feature.auditor_task_id === "string", `inventory feature ${feature.feature_id} auditor task is invalid`);
  assert(feature.worktree_id === null || typeof feature.worktree_id === "string", `inventory feature ${feature.feature_id} worktree is invalid`);
  requireIdentifier(feature.status, `inventory feature ${feature.feature_id} status`);
}

function validateInventoryLane(lane, index) {
  exactKeys(lane, INVENTORY_LANE_KEYS, `inventory lane ${index}`);
  requireIdentifier(lane.lane_id, `inventory lane ${index} ID`);
  requireString(lane.name, `inventory lane ${lane.lane_id} name`);
  validatePublicReference(lane.report_path, `inventory lane ${lane.lane_id} report path`);
  requireString(lane.auditor_task_id, `inventory lane ${lane.lane_id} auditor task`);
  requireString(lane.worktree_id, `inventory lane ${lane.lane_id} worktree`);
  requireIdentifier(lane.status, `inventory lane ${lane.lane_id} status`);
}

function validateInventoryPlatformProjection(inventory) {
  assert(Array.isArray(inventory.platform_domains), "feature inventory platform domains are invalid");
  assert(Array.isArray(inventory.platform_lanes), "feature inventory platform lanes are invalid");
  assert(inventory.platform_lanes.length === inventory.expected_platform_lane_count, "feature inventory platform lane count mismatch");
  for (const [index, lane] of inventory.platform_lanes.entries()) {
    requireIdentifier(lane.lane_id, `platform lane ${index} ID`);
    requireString(lane.name, `platform lane ${index} name`);
    assert(Array.isArray(lane.domain_ids) && lane.domain_ids.length > 0, `platform lane ${index} domain binding is required`);
    assert(Array.isArray(lane.source_refs) && lane.source_refs.length > 0, `platform lane ${index} source binding is required`);
    lane.source_refs.forEach((source, sourceIndex) => validatePublicReference(source, `platform lane ${index} source ${sourceIndex}`));
    validatePublicReference(lane.report_path, `platform lane ${index} report`);
    requireIdentifier(lane.auditor_task_id, `platform lane ${index} auditor task`);
    requireIdentifier(lane.worktree_id, `platform lane ${index} worktree`);
    requireIdentifier(lane.status, `platform lane ${index} status`);
  }
  exactKeys(inventory.platform_phase, ["platform_roster_source", "required_outputs", "feature_admission"], "feature inventory platform phase");
  requireString(inventory.platform_phase.platform_roster_source, "feature inventory platform roster source");
  assert(Array.isArray(inventory.platform_phase.required_outputs) && inventory.platform_phase.required_outputs.length > 0, "feature inventory platform outputs are required");
  inventory.platform_phase.required_outputs.forEach((value, index) => requireString(value, `feature inventory platform output ${index}`));
  requireString(inventory.platform_phase.feature_admission, "feature inventory platform admission");
}

export function validateFeatureInventory(inventory) {
  exactKeys(inventory, INVENTORY_KEYS, "feature inventory");
  assert(inventory.schema === FEATURE_INVENTORY_SCHEMA, "feature inventory schema mismatch");
  assert(inventory.version === 1, "feature inventory version mismatch");
  assert(inventory.contract_status === CONTRACT_STATUS, "feature inventory is active or has an invalid contract status");
  assert(inventory.authority === "CURRENT_ACCEPTED_MERGE", "feature inventory authority mismatch");
  assert(Array.isArray(inventory.source_catalog) && inventory.source_catalog.length > 0, "feature inventory source catalog is required");
  inventory.source_catalog.forEach((source, index) => validatePublicReference(source, `feature inventory source catalog ${index}`));
  requireString(inventory.coverage_rule, "feature inventory coverage rule");
  for (const field of ["expected_feature_count", "expected_governance_lane_count", "expected_platform_lane_count", "expected_auditor_count", "expected_report_count", "expected_goal_count"]) {
    assert(Number.isSafeInteger(inventory[field]) && inventory[field] >= 0, `feature inventory ${field} is invalid`);
  }
  assert(inventory.expected_feature_count === 37, "feature inventory must contain the authoritative 37 capabilities");
  assert(inventory.expected_governance_lane_count === 12, "feature inventory must contain the authoritative 12 governance lanes");
  assert(Array.isArray(inventory.features) && inventory.features.length === inventory.expected_feature_count, "feature inventory feature count mismatch");
  assert(Array.isArray(inventory.governance_lanes) && inventory.governance_lanes.length === inventory.expected_governance_lane_count, "feature inventory governance lane count mismatch");
  validateInventoryPlatformProjection(inventory);
  requireString(inventory.goal_rule, "feature inventory goal rule");
  for (const [index, feature] of inventory.features.entries()) validateInventoryFeature(feature, index);
  for (const [index, lane] of inventory.governance_lanes.entries()) validateInventoryLane(lane, index);
  uniqueIdentifiers(inventory.features, "feature inventory features", (feature) => feature.feature_id);
  uniqueIdentifiers(inventory.governance_lanes, "feature inventory governance lanes", (lane) => lane.lane_id);
  const reportPaths = [...inventory.features, ...inventory.governance_lanes, ...inventory.platform_lanes].map((entry) => entry.report_path);
  assert(new Set(reportPaths).size === reportPaths.length, "feature inventory report paths contain duplicates");
  // Platform lanes are domain projections over existing feature custody. They
  // contribute handoff reports, not additional visible tasks, worktrees, or
  // persistent lane goals.
  const expectedAuditors = inventory.expected_feature_count + inventory.expected_governance_lane_count;
  assert(inventory.expected_auditor_count === expectedAuditors, "feature inventory auditor count does not cover features and lanes");
  assert(inventory.expected_report_count === expectedAuditors, "feature inventory report count does not cover features and lanes");
  assert(inventory.expected_goal_count === expectedAuditors, "feature inventory goal count does not cover features and lanes");
  exactKeys(inventory.parity, ["feature_tasks_created", "feature_reports_present", "governance_tasks_created", "governance_reports_present", "platform_tasks_created", "platform_reports_present", "goal_records_compiled", "parity_status"], "feature inventory parity");
  for (const field of ["feature_tasks_created", "feature_reports_present", "governance_tasks_created", "governance_reports_present", "platform_tasks_created", "platform_reports_present", "goal_records_compiled"]) {
    assert(Number.isSafeInteger(inventory.parity[field]) && inventory.parity[field] >= 0, `feature inventory ${field} parity is invalid`);
  }
  assert(inventory.parity.platform_tasks_created === 0, "feature inventory platform lanes may not create duplicate tasks");
  assert(inventory.parity.platform_reports_present === inventory.expected_platform_lane_count, "feature inventory platform report count does not match expected lanes");
  assert(inventory.parity.feature_tasks_created === inventory.expected_feature_count, "feature inventory feature task count does not match expected capabilities");
  assert(inventory.parity.feature_reports_present === inventory.expected_feature_count, "feature inventory feature report count does not match expected capabilities");
  assert(inventory.parity.governance_tasks_created === inventory.expected_governance_lane_count, "feature inventory governance task count does not match expected lanes");
  assert(inventory.parity.governance_reports_present === inventory.expected_governance_lane_count, "feature inventory governance report count does not match expected lanes");
  assert(inventory.parity.goal_records_compiled === inventory.expected_goal_count, "feature inventory goal records do not match expected goals");
  requireIdentifier(inventory.parity.parity_status, "feature inventory parity status");
  return inventory;
}

export function compileFeatureMapFromInventory({inventory, mapId, projectId, campaignId, buildId, projectGovernanceSha256, sourceCommit, sourceTree}) {
  validateFeatureInventory(inventory);
  return compileFeatureMap({
    mapId,
    projectId,
    campaignId,
    buildId,
    projectGovernanceSha256,
    sourceCommit,
    sourceTree,
    features: inventory.features.map((feature) => ({feature_id: feature.feature_id, label: feature.name})),
  });
}

export function validateInventoryCoveragePlan(plan, {inventory, featureMap} = {}) {
  exactKeys(plan, COVERAGE_KEYS, "inventory coverage plan");
  assert(plan.schema === INVENTORY_COVERAGE_SCHEMA, "inventory coverage plan schema mismatch");
  assert(plan.version === 1, "inventory coverage plan version mismatch");
  assert(plan.contract_status === CONTRACT_STATUS, "inventory coverage plan is active or has an invalid contract status");
  assert(plan.inventory_schema === FEATURE_INVENTORY_SCHEMA, "inventory coverage inventory schema mismatch");
  if (inventory !== undefined) validateFeatureInventory(inventory);
  if (featureMap !== undefined) {
    validateFeatureMap(featureMap, {currentSourceCommit: featureMap.source_commit, currentSourceTree: featureMap.source_tree});
    assert(plan.feature_map_sha256 === featureMap.feature_map_sha256, "inventory coverage feature map binding mismatch");
  }
  for (const field of ["feature_count", "governance_lane_count", "auditor_count", "report_count"]) {
    assert(Number.isSafeInteger(plan[field]) && plan[field] >= 0, `inventory coverage ${field} is invalid`);
  }
  assert(Array.isArray(plan.report_paths) && plan.report_paths.length === plan.report_count, "inventory coverage report paths are incomplete");
  plan.report_paths.forEach((value, index) => validatePublicReference(value, `inventory coverage report path ${index}`));
  sortedUnique(plan.report_paths, "inventory coverage report paths");
  requireSha(plan.feature_map_sha256, "inventory coverage feature map digest");
  requireSha(plan.coverage_sha256, "inventory coverage digest");
  assert(plan.coverage_sha256 === digestWithout(plan, "coverage_sha256"), "inventory coverage digest mismatch");
  return plan;
}

export function compileInventoryCoveragePlan({inventory, mapId, projectId, campaignId, buildId, projectGovernanceSha256, sourceCommit, sourceTree}) {
  validateFeatureInventory(inventory);
  const featureMap = compileFeatureMapFromInventory({inventory, mapId, projectId, campaignId, buildId, projectGovernanceSha256, sourceCommit, sourceTree});
  const reportPaths = [...inventory.features, ...inventory.governance_lanes, ...inventory.platform_lanes]
    .map((entry) => entry.report_path)
    .sort(compareUtf8);
  const plan = {
    schema: INVENTORY_COVERAGE_SCHEMA,
    version: 1,
    contract_status: CONTRACT_STATUS,
    inventory_schema: FEATURE_INVENTORY_SCHEMA,
    feature_count: inventory.expected_feature_count,
    governance_lane_count: inventory.expected_governance_lane_count,
    auditor_count: inventory.expected_auditor_count,
    report_count: inventory.expected_report_count,
    feature_map_sha256: featureMap.feature_map_sha256,
    report_paths: reportPaths,
    coverage_sha256: null,
  };
  plan.coverage_sha256 = digestWithout(plan, "coverage_sha256");
  return {plan: validateInventoryCoveragePlan(plan, {inventory, featureMap}), featureMap};
}
