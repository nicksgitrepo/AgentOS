import { canonicalBytes, canonicalJson, MemoryError, RECORD_FAMILIES, sha256Ref } from "./memory-m2/src/index.mjs";
import { MEMORY_RECORD_TYPES } from "./main-core/control/project-memory-records.mjs";

export const CANONICAL_MEMORY_TYPES = Object.freeze([
  "EPISODIC",
  "SEMANTIC",
  "PROCEDURAL",
  "GOVERNANCE",
  "WORKING_TASK",
]);

export const MEMORY_CATEGORY_MAPPING_SCHEMA = "agentos.memory.category_mapping.v1";
export const MEMORY_CATEGORY_MAP_VERSION = "agentos.memory.category-map.v1";
export const MEMORY_AUTHORITY_BINDING_SCHEMA = "agentos.memory.authority_binding.v1";
export const MEMORY_AUTHORITY_BINDING_VERSION = 1;
export const MEMORY_AUTHORITY_EVENT = "MEMORY_AUTHORITY_BOUND";
export const MEMORY_AUTHORITIES = Object.freeze(["LEGACY_PROJECT_MEMORY", "MEMORY_M2"]);

const OPAQUE_REF = /^ref_[a-z0-9]{32}$/u;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

const LEGACY_CATEGORY_MAP = Object.freeze({
  PROJECT_CONTEXT: "SEMANTIC",
  GOAL: "WORKING_TASK",
  DECISION: "GOVERNANCE",
  REPOSITORY_MAP_REF: "SEMANTIC",
  HANDOFF: "WORKING_TASK",
  POLICY_REF: "GOVERNANCE",
  INVALIDATION: "GOVERNANCE",
  CONFLICT: "GOVERNANCE",
});

const M2_CATEGORY_MAP = Object.freeze({
  decision: "GOVERNANCE",
  fact: "SEMANTIC",
  procedure: "PROCEDURAL",
  lesson: "SEMANTIC",
  evidence: "EPISODIC",
  reference: "SEMANTIC",
});

const SOURCE_MAPS = Object.freeze({
  LEGACY_PROJECT_MEMORY: LEGACY_CATEGORY_MAP,
  MEMORY_M2: M2_CATEGORY_MAP,
});

export const MEMORY_MIGRATION_RULES = Object.freeze({
  current_mode: "NONE",
  planner_status: "FAIL_CLOSED_NOT_IMPLEMENTED",
  required_future_sequence: Object.freeze([
    "FREEZE_SOURCE_READ_ONLY",
    "MAP_EVERY_SOURCE_CATEGORY_AND_PRESERVE_SOURCE_IDENTITY",
    "VERIFY_ZERO_UNMAPPED_ZERO_LOSSY_ZERO_CONFLICT",
    "INVALIDATE_SOURCE_DERIVED_PROJECTIONS",
    "OWNER_AUTHORIZES_SINGLE_AUTHORITY_SWITCH",
    "ACTIVATE_TARGET_ONLY_AFTER_SOURCE_IS_NON_AUTHORITATIVE",
  ]),
  forbidden: Object.freeze(["DUAL_WRITE", "PARTIAL_SWITCH", "INFERRED_CATEGORY", "SILENT_DROP"]),
});

export const MEMORY_INVALIDATION_RULES = Object.freeze({
  source_record_invalidated: "INVALIDATE_DESCENDANT_CLOSURE_AND_REBUILD_DERIVED_PROJECTIONS",
  category_map_changed: "INVALIDATE_ALL_MAPPED_PROJECTIONS_AND_REQUIRE_EXPLICIT_RECLASSIFICATION",
  authority_binding_changed: "STOP_WRITES_AND_REQUIRE_A_NEW_EXCLUSIVE_BINDING_EPOCH",
  migration_aborted: "TARGET_REMAINS_NON_AUTHORITATIVE_AND_STAGED_OUTPUT_IS_INVALIDATED",
  unknown_or_conflicting_input: "FAIL_CLOSED_WITHOUT_WRITING",
});

function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new MemoryError(code, message, details);
}

function exactKeys(value, expected, code, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), code, `${label} must be an object`);
  invariant(canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort()), code,
    `${label} has missing or unsupported fields`);
}

function sortedEqual(left, right) {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function assertMappingCoverage() {
  invariant(sortedEqual(Object.keys(LEGACY_CATEGORY_MAP), MEMORY_RECORD_TYPES), "LEGACY_CATEGORY_MAP_INCOMPLETE",
    "legacy project-memory category mapping must be total and exact");
  invariant(sortedEqual(Object.keys(M2_CATEGORY_MAP), RECORD_FAMILIES), "M2_CATEGORY_MAP_INCOMPLETE",
    "Memory M2 category mapping must be total and exact");
  for (const type of [...Object.values(LEGACY_CATEGORY_MAP), ...Object.values(M2_CATEGORY_MAP)]) {
    invariant(CANONICAL_MEMORY_TYPES.includes(type), "INVALID_CANONICAL_MEMORY_TYPE",
      `${type} is not in the canonical memory taxonomy`);
  }
}

assertMappingCoverage();

export const MEMORY_MAPPING_COVERAGE = Object.freeze({
  schema: "agentos.memory.category_mapping_coverage.v1",
  mapping_version: MEMORY_CATEGORY_MAP_VERSION,
  canonical_types: CANONICAL_MEMORY_TYPES,
  legacy_project_memory: Object.freeze([...MEMORY_RECORD_TYPES]),
  memory_m2: Object.freeze([...RECORD_FAMILIES]),
  policy: "TOTAL_SOURCE_MAPPING_WITH_SOURCE_CATEGORY_PRESERVED;_UNKNOWN_FAILS_CLOSED",
});

export function mapMemoryCategory(sourceSystem, sourceCategory) {
  invariant(typeof sourceSystem === "string" && Object.hasOwn(SOURCE_MAPS, sourceSystem),
    "UNKNOWN_MEMORY_SOURCE", "memory source is not recognized");
  invariant(typeof sourceCategory === "string" && Object.hasOwn(SOURCE_MAPS[sourceSystem], sourceCategory),
    "UNMAPPED_MEMORY_CATEGORY", `${sourceSystem} category is not explicitly mapped`, { source_category: sourceCategory });
  return Object.freeze({
    schema: MEMORY_CATEGORY_MAPPING_SCHEMA,
    version: 1,
    mapping_version: MEMORY_CATEGORY_MAP_VERSION,
    source_system: sourceSystem,
    source_category: sourceCategory,
    canonical_type: SOURCE_MAPS[sourceSystem][sourceCategory],
    preservation: "SOURCE_SYSTEM_AND_CATEGORY_RETAINED_LOSSLESSLY",
  });
}

export function mapLegacyProjectMemoryType(recordType) {
  return mapMemoryCategory("LEGACY_PROJECT_MEMORY", recordType);
}

export function mapM2RecordFamily(family) {
  return mapMemoryCategory("MEMORY_M2", family);
}

export function recoverMappedSource(mapping) {
  exactKeys(mapping, ["schema", "version", "mapping_version", "source_system", "source_category", "canonical_type", "preservation"],
    "INVALID_CATEGORY_MAPPING", "category mapping");
  const expected = mapMemoryCategory(mapping.source_system, mapping.source_category);
  invariant(canonicalJson(mapping) === canonicalJson(expected), "INVALID_CATEGORY_MAPPING",
    "category mapping is not the canonical lossless mapping");
  return Object.freeze({ source_system: mapping.source_system, source_category: mapping.source_category });
}

function authorityStates(selectedAuthority) {
  invariant(MEMORY_AUTHORITIES.includes(selectedAuthority), "UNKNOWN_MEMORY_AUTHORITY", "memory authority is not recognized");
  return selectedAuthority === "MEMORY_M2"
    ? { legacy_project_memory: "DISABLED", memory_m2: "AUTHORITATIVE" }
    : { legacy_project_memory: "AUTHORITATIVE", memory_m2: "DISABLED" };
}

export function compileMemoryAuthorityBinding({
  project_ref: projectRef,
  control_plane_ref: controlPlaneRef,
  memory_project_id: memoryProjectId,
  selected_authority: selectedAuthority,
  authority_epoch: authorityEpoch = 1,
} = {}) {
  invariant(OPAQUE_REF.test(projectRef), "INVALID_PROJECT_REF", "authority binding requires an opaque project_ref");
  invariant(OPAQUE_REF.test(controlPlaneRef), "INVALID_CONTROL_PLANE_REF",
    "authority binding requires an opaque control_plane_ref");
  invariant(PROJECT_ID.test(memoryProjectId), "INVALID_PROJECT_ID", "authority binding memory_project_id is invalid");
  invariant(Number.isSafeInteger(authorityEpoch) && authorityEpoch >= 1, "INVALID_AUTHORITY_EPOCH",
    "authority epoch must be a positive safe integer");
  const authorities = Object.freeze(authorityStates(selectedAuthority));
  const migration = Object.freeze({
    mode: "NONE",
    source_authority: null,
    source_head_ref: null,
    target_head_ref: null,
    unmapped_categories: Object.freeze([]),
    invalidation_status: "NOT_REQUIRED",
  });
  const body = {
    schema: MEMORY_AUTHORITY_BINDING_SCHEMA,
    version: MEMORY_AUTHORITY_BINDING_VERSION,
    project_ref: projectRef,
    control_plane_ref: controlPlaneRef,
    memory_project_id: memoryProjectId,
    authority_epoch: authorityEpoch,
    selected_authority: selectedAuthority,
    authorities,
    mapping_version: MEMORY_CATEGORY_MAP_VERSION,
    migration,
    activation: "TEST_ONLY",
    authority_effect: "ONE_PROJECT_ONE_MEMORY_AUTHOR",
  };
  return Object.freeze({
    ...body,
    binding_digest: sha256Ref("agentos.memory.authority-binding.v1", canonicalBytes(body)),
  });
}

export function assertMemoryAuthorityBinding(binding, expected = {}) {
  exactKeys(binding, [
    "schema", "version", "project_ref", "control_plane_ref", "memory_project_id", "authority_epoch",
    "selected_authority", "authorities", "mapping_version", "migration", "activation", "authority_effect",
    "binding_digest",
  ], "INVALID_MEMORY_AUTHORITY_BINDING", "memory authority binding");
  exactKeys(binding.authorities, ["legacy_project_memory", "memory_m2"],
    "INVALID_MEMORY_AUTHORITY_BINDING", "memory authority states");
  exactKeys(binding.migration, [
    "mode", "source_authority", "source_head_ref", "target_head_ref", "unmapped_categories", "invalidation_status",
  ], "INVALID_MEMORY_AUTHORITY_BINDING", "memory migration state");
  const canonical = compileMemoryAuthorityBinding({
    project_ref: binding.project_ref,
    control_plane_ref: binding.control_plane_ref,
    memory_project_id: binding.memory_project_id,
    selected_authority: binding.selected_authority,
    authority_epoch: binding.authority_epoch,
  });
  invariant(canonicalJson(binding) === canonicalJson(canonical), "MEMORY_COAUTHORITY_FORBIDDEN",
    "memory authority binding must select exactly one author and cannot carry migration state in this slice");
  for (const [field, value] of Object.entries(expected)) {
    invariant(binding[field] === value, "MEMORY_AUTHORITY_BINDING_MISMATCH",
      `memory authority binding ${field} does not match the caller`);
  }
  return binding;
}

export function assertM2ExclusiveAuthority(binding, expected = {}) {
  assertMemoryAuthorityBinding(binding, expected);
  invariant(binding.selected_authority === "MEMORY_M2"
    && binding.authorities.memory_m2 === "AUTHORITATIVE"
    && binding.authorities.legacy_project_memory === "DISABLED",
  "MEMORY_M2_NOT_EXCLUSIVE", "Memory M2 requires legacy project-memory to be disabled for the same project");
  return binding;
}

function authorityEventMetadata(binding) {
  return {
    authority_binding_digest: binding.binding_digest,
    selected_authority: binding.selected_authority,
    legacy_project_memory: binding.authorities.legacy_project_memory,
    memory_m2: binding.authorities.memory_m2,
    authority_epoch: binding.authority_epoch,
  };
}

export async function verifyM2AuthorityBinding(project, expectedBinding) {
  assertM2ExclusiveAuthority(expectedBinding, { memory_project_id: project.config.project_id });
  const { events } = await project.verifyEvents();
  const bindings = events.filter((event) => event.body.action === MEMORY_AUTHORITY_EVENT);
  invariant(bindings.length === 1, bindings.length === 0 ? "MEMORY_AUTHORITY_BINDING_MISSING" : "MEMORY_AUTHORITY_CONFLICT",
    "Memory M2 ledger must contain exactly one signed authority binding");
  const event = bindings[0];
  invariant(event.body.subject_ref === `memory-authority:${project.config.project_id}` && event.body.object_ref !== null,
    "MEMORY_AUTHORITY_EVENT_MISMATCH", "memory authority event identity is invalid");
  const stored = await project.getJson(event.body.object_ref);
  assertM2ExclusiveAuthority(stored, { memory_project_id: project.config.project_id });
  invariant(canonicalJson(event.body.metadata) === canonicalJson(authorityEventMetadata(stored)),
    "MEMORY_AUTHORITY_EVENT_MISMATCH", "memory authority event metadata does not match its binding");
  invariant(canonicalJson(stored) === canonicalJson(expectedBinding), "MEMORY_AUTHORITY_BINDING_MISMATCH",
    "stored memory authority differs from the externally verified binding");
  return Object.freeze({ binding: stored, object_ref: event.body.object_ref, event_sequence: event.body.sequence });
}

export async function bindM2Authority(project, binding, { actor = "controller" } = {}) {
  assertM2ExclusiveAuthority(binding, { memory_project_id: project.config.project_id });
  const { events } = await project.verifyEvents();
  const existing = events.filter((event) => event.body.action === MEMORY_AUTHORITY_EVENT);
  if (existing.length > 0) return verifyM2AuthorityBinding(project, binding);
  const objectRef = await project.putJson(binding);
  await project.commit({
    actor,
    action: MEMORY_AUTHORITY_EVENT,
    subjectRef: `memory-authority:${project.config.project_id}`,
    objectRef,
    metadata: authorityEventMetadata(binding),
  });
  return verifyM2AuthorityBinding(project, binding);
}

export function requestMemoryMigration() {
  throw new MemoryError("MEMORY_MIGRATION_NOT_IMPLEMENTED",
    "memory migration is plan-only and cannot run in the inactive P0 authority slice");
}
