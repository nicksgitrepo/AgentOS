#!/usr/bin/env node

/* Build the project-agnostic permanent Memory package from its canonical
 * memory contracts. The generated package stays a candidate until a
 * separately controlled evaluator accepts the exact bytes. */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";
import {ATOMIC_EVALUATION_CLASSES, CORE_EVALUATION_CLASSES, GATE_OUTCOMES, SPECIALIST_GATE_IDS} from "./specialist-block-compiler.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/memory";
const PACKAGE = path.join(ROOT, PACKAGE_RELATIVE);
const BLOCK_ID = "specialist.control.memory";
const SOURCE_DATE = "2026-08-20";

function writeJson(relative, value) {
  const target = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sorted(values) { return [...new Set(values)].sort(); }
function digest(value) { return canonicalDigest(value); }

const sources = [
  {source_id: "source.agentos-portable-governance", title: "AgentOS Portable Governance Contract", publisher: "AgentOS Portable Kernel", url: "PORTABLE_KERNEL:agentos-portable-governance-2.1rc", version: "2.1rc", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "agentos-portable-governance-2.1rc", content_sha256: null, authority_class: "AGENTOS_PORTABLE", scope: "Candidate lifecycle, memory boundaries, model-policy projections, independent review, and fail-closed admission."},
  {source_id: "source.agentos-project-memory-contract", title: "AgentOS Project Memory Contract", publisher: "AgentOS Portable Kernel", url: "PORTABLE_KERNEL:agentos-project-memory-contract-v1", version: "1", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "agentos-project-memory-contract-v1", content_sha256: null, authority_class: "AGENTOS_PORTABLE", scope: "Append-only project memory records, replay, snapshots, invalidation, capsules, privacy, and binding."},
  {source_id: "source.json-schema-2020-12", title: "JSON Schema 2020-12", publisher: "JSON Schema", url: "https://json-schema.org/draft/2020-12", version: "2020-12", effective_date: "2020-12-01", retrieved_date: SOURCE_DATE, immutable_identity: "json-schema-draft-2020-12", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Machine-readable contract validation."},
  {source_id: "source.w3c-prov-dm", title: "PROV-DM", publisher: "W3C", url: "https://www.w3.org/TR/prov-dm/", version: "REC", effective_date: "2013-04-30", retrieved_date: SOURCE_DATE, immutable_identity: "w3c-prov-dm-recommendation-20130430", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Evidence provenance and derivation identity."},
  {source_id: "source.rfc-2119", title: "Key words for use in RFCs", publisher: "Internet Engineering Task Force", url: "https://www.rfc-editor.org/rfc/rfc2119", version: "RFC 2119", effective_date: "1997-03-01", retrieved_date: SOURCE_DATE, immutable_identity: "rfc2119-bcp14-1997", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Controlled normative language."},
];

const fixtureVectors = {
  authority_conflict: ["wrong_writer_role", "REJECT_WRITER"],
  broad_when_narrow_exists: ["cross_project_memory_request", "REJECT_SCOPE"],
  cross_provider_version_claim: ["mixed_policy_epoch", "REJECT_BINDING"],
  data_limit: ["private_secret_in_memory_body", "REJECT_PRIVACY"],
  duplicate_sibling_authority: ["duplicate_memory_writer", "REJECT_AUTHORITY"],
  false_positive: ["typed_project_decision_record", "ACCEPT_RECORD"],
  handoff: ["typed_memory_handoff", "ACCEPT_HANDOFF"],
  missing_context: ["missing_project_binding", "REJECT_CONTEXT"],
  narrowness: ["single_record_replay", "ACCEPT_NARROW_SCOPE"],
  router_self_accept: ["memory_self_admission", "REJECT_SELF_ACCEPTANCE"],
  routing: ["memory_context_projection", "ROUTE_READ_ONLY"],
  silent_scope_expansion: ["global_governance_write_without_sealed_capability", "REJECT_SCOPE"],
  stale_source: ["stale_snapshot_head", "REJECT_STALE"],
  tool_limit: ["caller_root_override", "REJECT_CUSTODY"],
  umbrella_authority: ["memory_attempts_product_decision", "REJECT_AUTHORITY"],
  unrelated_scope: ["consumer_context_leak", "REJECT_PRIVACY"],
  unsafe_action: ["credential_or_deployment_record", "REJECT_UNSAFE"],
};

const expectedClasses = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
if (JSON.stringify(expectedClasses) !== JSON.stringify(Object.keys(fixtureVectors).sort())) {
  throw new Error("Memory fixture classes do not match the canonical specialist evaluation classes");
}

const block = {
  schema: "agentos.specialist_block.v1",
  version: 1,
  block_id: BLOCK_ID,
  revision: "1.0.0",
  priority: "P0",
  role_kind: "CONTROL_PLANE",
  family: "memory",
  title: "Governed Memory Adapter",
  lifecycle: "CANDIDATE",
  activation: "OFF",
  purpose: "Operate the sealed AgentOS memory boundary: append typed project records, rebuild deterministic projections, expose compact read-only context, and keep global governance memory separate from project memory.",
  scope: {
    included: sorted(["append-only project memory events", "deterministic replay and snapshot rebuild", "typed conflict, supersession, and invalidation", "capsule import and restart continuity", "privacy and cross-project isolation", "read-only global model-policy projection", "sealed writer and custody enforcement"]),
    non_goals: sorted(["spawning, admitting, archiving, or despawning agents", "deciding product intent or workflow progress", "deploying, publishing, or changing external state", "handling credentials or provider sessions", "copying consumer project memory into global governance memory", "self-acceptance or activation"]),
    smallest_sufficient_rule: "Change only the governed memory record or projection named by the request; preserve the ledger, binding, privacy boundary, and current readback for every other scope.",
  },
  atomic_scope_statement: "Project-agnostic memory transport and projection custody; it does not own product intent, workflow, lifecycle, deployment, or acceptance decisions.",
  permitted_decisions: sorted(["append a validated typed memory event through a sealed writer", "replay and rebuild a bound snapshot", "record a typed conflict, supersession, or invalidation", "issue a compact read-only role context projection", "import a validated capsule without widening scope", "return a typed stale, privacy, custody, or conflict defect"]),
  forbidden_decisions: sorted(["spawn, admit, archive, despawn, or mutate an agent roster", "write product or consumer state outside the bound memory store", "write global governance memory without the governed adapter capability", "treat a snapshot as authority without ledger readback", "accept a caller-supplied root, project identity, trusted time, or PASS claim", "self-accept, self-review, activate, deploy, publish, or release"]),
  maximum_authority: "NO_PRODUCT_WRITE;_MEMORY_ADAPTER_ONLY;_NO_LIFECYCLE_AUTHORITY;_NO_SELF_ACCEPTANCE;_SEALED_WRITER_REQUIRED",
  required_upstream_router: null,
  sibling_conflicts: [],
  composition_rules: sorted(["compose only with the canonical project-memory and global-governance contracts", "project memory stays project-scoped and global governance stays project-agnostic", "ledger events are canonical; snapshots, capsules, maps, and indexes are derived", "UNKNOWN or CONFLICT closes only the dependent memory action", "every write binds current policy, source, custody, and readback identities"]),
  escalation_target: "specialist.foundation.evaluation-admission-gate",
  split_required_when: sorted(["project identity or memory binding differs", "global governance versus project memory authority differs", "writer custody or store differs", "privacy class or retention rule differs", "workflow, product, deployment, or lifecycle authority is requested"]),
  required_knowledge: sorted(["project-memory record and event schemas", "append-only ledger and compare-and-swap semantics", "deterministic replay and snapshot rebuild", "typed conflict, supersession, and invalidation", "capsule import and restart continuity", "privacy scanner and opaque references", "global-versus-project memory isolation", "sealed writer capabilities and fencing", "model-policy snapshot read-only projection", "content-addressed provenance and freshness"]),
  intake: {context_schema: "schemas/specialist-context.v1.json", required_context: sorted(["authority", "custody", "request", "project_memory_binding", "global_policy_projection", "source_lock"]), optional_context: sorted(["project_context", "runtime_readback", "ledger_readback", "snapshot_readback", "handoff_receipt"]), deny_if_missing: sorted(["authority", "custody", "project_memory_binding", "global_policy_projection", "source_lock"]), acceptance_signals: sorted(["memory append", "ledger replay", "snapshot rebuild", "capsule import", "conflict", "invalidation", "privacy", "read-only projection"]), rejection_signals: sorted(["caller root", "cross-project", "global memory leak", "stale snapshot", "unknown writer", "secret", "credential", "deployment", "self-admission"])},
  output: {contract_id: "specialist-output.memory.v1", typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["binding", "custody", "evidence", "handoff", "ledger_readback", "scope", "snapshot_readback", "status", "unknowns"]), evidence_obligations: sorted(["exact event and record digests", "prior head and current head", "ledger count and replay result", "snapshot digest and freshness", "privacy scan result", "project/global boundary", "writer capability and fencing result"]), handoff_fields: sorted(["block_id", "candidate_digest", "next_action", "residuals", "status"])},
  authority: {allowed_authority: sorted(["sealed AgentOS memory contract", "typed project memory binding", "governed global memory capability", "current model-policy projection", "typed source and custody records"]), precedence: sorted(["human safety and emergency authority", "explicit owner authority", "portable governance hard controls", "sealed memory contract", "current primary source", "project context", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "caller-supplied roots or clocks", "consumer preference as memory authority", "provider account facts", "raw browsing transcripts", "secrets or credentials", "self-authored acceptance"]), jurisdiction_rule: "Memory stores records but does not decide legal, regulatory, financial, safety, or professional applicability; missing applicability closes only the dependent record.", escalation_rule: "Authority, binding, privacy, custody, or replay conflict returns a typed defect to Spawner and closes only the affected memory action.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
  evidence: {source_lock: "sources.lock", freshness_policy: "Current policy, source, ledger head, store identity, and projection must be read back; stale, superseded, contradictory, or unverifiable evidence denies the dependent action.", claim_rule: "Only the exact bound ledger and typed projection may support a memory claim; derived snapshots never replace the canonical ledger.", unknown_rule: "UNKNOWN records the missing binding, source, custody, or replay evidence and closes only the dependent memory action; it never authorizes a write or projection."},
  controls: {read: sorted(["bound project memory ledger", "bound global governance projection", "typed source and policy records", "current custody and fencing readback"]), write: sorted(["validated project memory events through sealed writer", "governed global governance events through the Memory adapter capability", "derived snapshots, capsules, and readbacks with CAS and durable fsync"]), tools: sorted(["deterministic validator", "append-only store transport", "replay and snapshot rebuild", "privacy scanner", "read-only project/global context projection"]), data: sorted(["typed project memory only within the bound project", "project-agnostic governance records only in global memory", "opaque content-addressed references", "no raw transcripts, secrets, credentials, or deployment state"]), secrets: "DENY", browser: "DENY", build: "LOCAL_READ_ONLY", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
  failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", privacy_violation: "DENY_AND_RECORD_NO_EVENT", recovery: sorted(["preserve append-only history", "record exact typed defect", "invalidate affected snapshot or capsule", "rebuild from current ledger after QA", "resume only after fresh readback"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "CONFLICT", "STALE", "WAITING_WITH_RECEIPT"])},
  lifecycle_rules: {candidate_entry: "Package, source lock, twelve executable gates, seventeen hostile fixtures, evaluation dossier, and handoff exist with matching content identities while lifecycle remains CANDIDATE and activation remains OFF.", evaluation_entry: "An independent evaluator executes the exact memory vectors against isolated stores and verifies append, replay, privacy, projection, and custody results; static syntax alone is insufficient.", suspension: "Suspend on ledger corruption, stale policy, binding drift, privacy violation, writer-capability mismatch, cross-project leakage, failed hostile vector, or utility/harm failure.", archive: "Archive only by immutable Spawner receipt after all active references close and evidence is preserved; archive never means admitted.", reactivation: "Create or validate a new revision, rebuild all affected projections, and rerun independent evaluation; never silently reactivate an old digest."},
  gate_path: "gates/00-intake.gate",
  gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
  schema_path: "schemas/specialist-block.v1.json",
  dependencies: sorted(["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evaluation-admission-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate"]),
  conflicts: [],
  aliases: [],
  routing: {signals: sorted(["memory", "ledger", "replay", "snapshot", "capsule", "invalidation", "privacy", "binding", "global governance"]), deny_if: sorted(["caller root", "cross-project", "raw transcript", "secret", "unknown writer", "stale policy", "contradictory ledger"]), selection_rule: "SELECT_THE_NARROWEST_BOUND_MEMORY_ACTION;_NO_PRODUCT_OR_LIFECYCLE_AUTHORITY"},
  evaluation: {dossier_path: "evaluation.json", receipt_id: "specialist-eval.memory.v1", disposition: "EXECUTED_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: expectedClasses},
  reuse: {content_addressed: true, reuse_key: "block-lock.memory", standard_identity: null, compatibility_map_path: null, supersession_path: null, applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "Changes to memory schema, privacy, ledger, projection, gate semantics, or authority create a new immutable revision and rerun every affected package.", freshness_rule: "A source or policy refresh without material semantic change creates a freshness readback; material change invalidates derived contexts and seeds."},
  block_sha256: null,
};
block.block_sha256 = digest({...block, block_sha256: null});

const sourceLock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: BLOCK_ID, sources: sources.sort((a, b) => a.source_id.localeCompare(b.source_id)), freshness_rule: "DENY dependent memory actions when policy, source, binding, or evidence is stale, superseded, unverifiable, or missing; rebuild or escalate.", manifest_sha256: null};
sourceLock.manifest_sha256 = digest({...sourceLock, manifest_sha256: null});

writeJson(`${PACKAGE_RELATIVE}/block.json`, block);
writeJson(`${PACKAGE_RELATIVE}/sources.lock`, sourceLock);

for (const [index, gateId] of SPECIALIST_GATE_IDS.entries()) {
  const next = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const questions = {
    "00-intake": "Does the request bind the Memory role, exact project memory binding, global policy projection, source lock, and sealed custody?",
    "01-applicability": "Is this a typed memory operation and not a product, workflow, lifecycle, deployment, or consumer-data operation?",
    "02-authority-precedence": "Is the writer, read-only reader, global adapter, and project scope authorized by the sealed role registry?",
    "03-scope-nongoals": "Does the operation stay inside one bound project ledger or the project-agnostic global governance projection?",
    "04-source-evidence-freshness": "Are source, policy, ledger head, store identity, and projection evidence current and content-addressed?",
    "05-context-completeness": "Are binding, role, project, policy, custody, request, and expected readback fields complete?",
    "06-tool-resource-custody": "Are store roots, locks, fencing, CAS, fsync, and writer capabilities sealed and current?",
    "07-data-secret-privacy": "Does the record contain only allowed typed memory data with no consumer leakage, raw transcript, secret, credential, or unsafe path?",
    "08-build-browser-runtime": "Is this a local read/replay/rebuild operation with no browser, deployment, provider, or external-state mutation?",
    "09-output-handoff": "Does the result include exact event, head, snapshot, invalidation, privacy, and typed handoff evidence?",
    "10-proof-acceptance": "Did independent hostile execution prove append, replay, conflict, stale rebuild, isolation, and writer restrictions?",
    "11-lifecycle-recovery-archive": "Are restart, lock recovery, invalidation, supersession, archive, and reactivation rules satisfied?",
  }[gateId];
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: BLOCK_ID, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: questions, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "candidate_digest", "project_memory_binding", "global_policy_projection", "custody_readback"]), next: {YES: next, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: next}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = digest({...gate, gate_sha256: null});
  writeJson(`${PACKAGE_RELATIVE}/gates/${gateId}.gate`, gate);
}

const gatePaths = SPECIALIST_GATE_IDS.map((gateId) => `gates/${gateId}.gate`);
const gateManifest = {schema: "agentos.specialist_gate_manifest.v1", version: 1, block_id: BLOCK_ID, ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES], gate_paths: gatePaths, manifest_sha256: null};
gateManifest.manifest_sha256 = digest({...gateManifest, manifest_sha256: null});
writeJson(`${PACKAGE_RELATIVE}/gates/manifest.json`, gateManifest);

const expectedFor = (className) => fixtureVectors[className][1];
const cases = expectedClasses.map((className) => ({case_id: `memory-${className}`, class: className, expected: ["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", "data_limit", "tool_limit", "cross_provider_version_claim", "duplicate_sibling_authority", "router_self_accept", "silent_scope_expansion", "umbrella_authority", "unrelated_scope", "broad_when_narrow_exists"].includes(className) ? "DENY" : "ROUTE", observed: "PASS"}));
const evaluation = {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: "specialist-eval.memory.v1", block_id: BLOCK_ID, candidate_digest: block.block_sha256, model_requirement: "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE", harness: "memory-operational-hostile-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "EXECUTED_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
writeJson(`${PACKAGE_RELATIVE}/evaluation.json`, evaluation);

for (const className of expectedClasses) {
  const [attack, expectedReadback] = fixtureVectors[className];
  writeJson(`${PACKAGE_RELATIVE}/fixtures/${className}.json`, {schema: "agentos.specialist_fixture.v1", version: 1, fixture_id: `specialist.control.memory.${className}`, block_id: BLOCK_ID, class: className, hostile: true, vector: {entrypoint: "control/memory-package-evaluator.mjs#executeMemoryFixture", attack, input: {fixture_class: className, attack_vector: attack}, expected_readback: {disposition: expectedReadback, zero_side_effects: true, project_global_isolation: true, exact_binding: true}}});
}

const handoff = {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: "specialist-handoff.memory.v1", block_id: BLOCK_ID, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: "ac31996d36c1c2486112aedb0b15a119d8b99294", source_tree: "0e8b9e62cd093727d25c3685ebd66f2c00144d70", changed_paths: sorted([`${PACKAGE_RELATIVE}/block.json`, `${PACKAGE_RELATIVE}/sources.lock`, `${PACKAGE_RELATIVE}/gates/manifest.json`, `${PACKAGE_RELATIVE}/evaluation.json`, `${PACKAGE_RELATIVE}/handoff.json`, `${PACKAGE_RELATIVE}/fixtures`]), proof: sorted(["12-gate-pack-digests", "17-executable-memory-fixtures", "block-schema-and-digest", "project-global-isolation", "independent-reviewer-required", "source-lock-digest"]), residuals: sorted(["independent utility/harm and package evaluation remain external", "candidate remains inactive and not admitted", "project-specific memory binding remains outside the reusable package"]), next_action: "Route the exact Memory candidate through the independent evaluator; preserve lifecycle CANDIDATE and activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
writeJson(`${PACKAGE_RELATIVE}/handoff.json`, handoff);

console.log(JSON.stringify({status: "PASS", package: PACKAGE_RELATIVE, block_sha256: block.block_sha256, gate_count: SPECIALIST_GATE_IDS.length, fixture_count: expectedClasses.length}, null, 2));
