/* Compile the project-agnostic reusable AgentOS agent roster from real blocks. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";
import {auditModelPolicyEvidenceStore} from "./eco-model-policy.mjs";
import {assertSpawnerPortableInputs, resolveSpawnerWorkspaceCustody} from "./spawner-workspace-custody.mjs";

const MODEL_TASKS = Object.freeze({
  SIMPLE_EXTRACTION: {minimum_capability: 35, required_capabilities: ["TEXT"]},
  DETERMINISTIC_QA: {minimum_capability: 45, required_capabilities: ["TEXT", "TOOLS"]},
  NARROW_CODING: {minimum_capability: 49, required_capabilities: ["CODE", "TOOLS"]},
  BROAD_ARCHITECTURE: {minimum_capability: 55, required_capabilities: ["CODE", "LONG_CONTEXT", "TOOLS"]},
  SECURITY_REVIEW: {minimum_capability: 59, required_capabilities: ["CODE", "SECURITY", "TOOLS"]},
  LONG_CONTEXT_SYNTHESIS: {minimum_capability: 55, required_capabilities: ["LONG_CONTEXT", "TEXT", "TOOLS"]},
  FINAL_INTEGRATION: {minimum_capability: 59, required_capabilities: ["CODE", "LONG_CONTEXT", "TOOLS"]},
});

const PERMANENT_ROLES = Object.freeze({
  "AGENTOS.SPAWNER": {display_name: "Agent Spawner", package_path: "specialist-blocks/control-plane/agent-spawner", family: "control-plane", task_class: "BROAD_ARCHITECTURE", reason: "Already admitted; it remains the only lifecycle and governance compiler."},
  AGENTOS_CONTROLLER: {display_name: "Controller", package_path: "specialist-blocks/wave-01/project-controller", family: "permanent-governance-control", task_class: "DETERMINISTIC_QA", reason: "First unaccepted permanent role and the workflow gate for later roles."},
  "AGENTOS.PRODUCT_OWNER": {display_name: "Product Owner", package_path: "specialist-blocks/wave-01/product-owner", family: "permanent-governance-control", task_class: "SIMPLE_EXTRACTION", reason: "Sole human-facing intent role; it follows Controller separation."},
  "AGENTOS.MEMORY": {display_name: "Memory", package_path: "specialist-blocks/wave-01/memory", family: "memory", task_class: "DETERMINISTIC_QA", reason: "Required governed memory adapter package is not present yet."},
  "AGENTOS.RUNTIME": {display_name: "Runtime", package_path: "specialist-blocks/wave-01/runtime-deployment-operator", family: "delivery-operations", task_class: "FINAL_INTEGRATION", reason: "Delivery and rollback custody follows governance and memory."},
  "AGENTOS.SCHEDULER": {display_name: "Scheduler", package_path: "specialist-blocks/wave-01/resource-scheduler", family: "resource-scheduling", task_class: "DETERMINISTIC_QA", reason: "Scheduling follows Controller and memory custody."},
  "AGENTOS.ORCHESTRATOR": {display_name: "Orchestrator", package_path: "specialist-blocks/wave-01/orchestrator", family: "plan-coordination", task_class: "BROAD_ARCHITECTURE", reason: "Plan coordination and acceptance package is not present yet."},
});

// AGENTOS.REPAIR is a reusable campaign role, not a permanent identity.  It
// is nevertheless a first-class platform entry so the queue cannot hide it
// behind a generic wave-07/block alias.  The package remains candidate-only
// until the sealed Spawner consumes an independent review.
const CAMPAIGN_ROLES = Object.freeze({
  "AGENTOS.REPAIR": {display_name: "Repair", package_path: "specialist-blocks/wave-07/repair", family: "control-plane-repair", task_class: "BROAD_ARCHITECTURE", tier: "PLATFORM_AGENTS", reason: "Owner-prioritized campaign builder; it follows accepted permanent governance and never deploys."},
});

const GATE_IDS = Object.freeze(["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"]);
const PRIORITY_SCORE = Object.freeze({P0: 98, P1: 86, P2: 74, P3: 62, P4: 50, P5: 36, P6: 24});
const ACCEPTANCE_LEDGER_PATH = "specialist-blocks/registry/accepted-agent-receipts.v1.json";
const SHA256 = /^[0-9a-f]{64}$/u;

function readJson(root, relativePath) { return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")); }
function exists(root, relativePath) { return fs.existsSync(path.join(root, relativePath)); }
function fileSha(root, relativePath) { return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex"); }
function loadAcceptanceLedger(root) {
  if (!exists(root, ACCEPTANCE_LEDGER_PATH)) return new Map();
  const ledger = readJson(root, ACCEPTANCE_LEDGER_PATH);
  if (ledger.schema !== "agentos.reusable_agent_acceptance_ledger.v1" || ledger.version !== 1 || ledger.status !== "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" || ledger.project_agnostic !== true) return new Map();
  if (ledger.provenance?.evaluator_identity !== "AGENTOS.INDEPENDENT_EVALUATOR" || ledger.provenance?.activation_allowed !== false || ledger.provenance?.spawn_authority !== "SEALED_SPAWNER_ONLY") return new Map();
  if (ledger.ledger_sha256 !== canonicalDigest({...ledger, ledger_sha256: null})) return new Map();
  return new Map((ledger.entries ?? [])
    .filter((entry) => entry.independent_status === "PASS"
      && typeof entry.stable_agent_id === "string"
      && typeof entry.package_path === "string"
      && /^specialist-blocks\/[A-Za-z0-9._/-]+$/u.test(entry.package_path)
      && entry.receipt_ref === `INDEPENDENT_EVALUATOR_HANDOFF/${entry.candidate_commit}`
      && ((entry.readback_scope === "EXACT_RECEIPT_RETAINED" && /^[0-9a-f]{64}$/u.test(entry.receipt_sha256 ?? ""))
        || (entry.readback_scope === "READBACK_SUMMARY_ONLY" && entry.receipt_sha256 === null)))
    .map((entry) => [entry.stable_agent_id, entry]));
}
function acceptanceMatchesCurrentAuthority(root, acceptance) {
  if (!acceptance || !/^[0-9a-f]{40}$/u.test(acceptance.candidate_commit ?? "") || !/^[0-9a-f]{40}$/u.test(acceptance.candidate_tree ?? "")) return false;
  try {
    const tree = execFileSync("git", ["rev-parse", `${acceptance.candidate_commit}^{tree}`], {cwd: root, encoding: "utf8"}).trim();
    if (tree !== acceptance.candidate_tree) return false;
    if (acceptance.receipt_ref !== `INDEPENDENT_EVALUATOR_HANDOFF/${acceptance.candidate_commit}`) return false;
    if (path.isAbsolute(acceptance.package_path) || acceptance.package_path.split("/").some((part) => part === ".." || part === "")) return false;
    // A reusable acceptance pin must still belong to the current authority
    // chain.  Exact package bytes alone are insufficient: an old continuation
    // commit can otherwise survive a rebind as a stale pin.
    execFileSync("git", ["merge-base", "--is-ancestor", acceptance.candidate_commit, "HEAD"], {cwd: root, stdio: "ignore"});
    execFileSync("git", ["diff", "--quiet", acceptance.candidate_commit, "--", acceptance.package_path], {cwd: root, stdio: "ignore"});
    return true;
  } catch { return false; }
}
export function validateReusableAgentAcceptancePin({repositoryRoot = process.cwd(), acceptance} = {}) {
  return acceptanceMatchesCurrentAuthority(repositoryRoot, acceptance);
}
function asArray(value) { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }
function text(value) { if (value === undefined || value === null) return ""; if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" "); return JSON.stringify(value); }
function normalize(value) { return String(value).toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, ""); }
function walkPackages(root, directory = "specialist-blocks") {
  const full = path.join(root, directory);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, {withFileTypes: true}).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkPackages(root, relative);
    return entry.name === "block.json" ? [path.dirname(relative).split(path.sep).join("/")] : [];
  });
}
function roleForPath(relativePath) {
  const all = {...PERMANENT_ROLES, ...CAMPAIGN_ROLES};
  return Object.entries(all).find(([, role]) => role.package_path === relativePath)?.[0] ?? null;
}
function packageRole(relativePath, block) {
  const id = roleForPath(relativePath);
  if (!id) return null;
  const role = PERMANENT_ROLES[id] ?? CAMPAIGN_ROLES[id];
  return {id, ...role};
}
function tierFor(relativePath, block, role) {
  if (role?.tier) return role.tier;
  if (role) return "PERMANENT_AGENTOS_ROLES";
  if (block.lifecycle === "ARCHIVED") return "LEGACY_ARCHIVE";
  if (relativePath.includes("/wave-02/") || relativePath.includes("/wave-04/") || relativePath.includes("/wave-05/") || relativePath.endsWith("/wave-01/agent-bootstrap")) return "PLATFORM_AGENTS";
  if (relativePath.includes("/wave-01/independent-auditor") || relativePath.includes("/wave-03/") || relativePath.includes("/wave-06/")) return "SPECIALIST_AUDITORS";
  return "REUSABLE_BLOCK_LIBRARY";
}
function entryType(relativePath, block, role) {
  if (block.lifecycle === "ARCHIVED") return "LEGACY_ARCHIVE";
  if (role || relativePath.includes("/wave-") || relativePath.includes("/control-plane/agent-spawner")) return "AGENT_ROLE";
  return relativePath.includes("/standards/") ? "REUSABLE_STANDARD_BLOCK" : "REUSABLE_GOVERNANCE_BLOCK";
}
function familyFor(block, role) { return String(role?.family ?? block.family ?? block.block_id.split(".")[1] ?? "unclassified"); }
function resolveManifestGatePath(relativePath, manifestPath, declaredPath) {
  if (typeof declaredPath !== "string" || declaredPath.length === 0 || declaredPath.includes("\\") || path.posix.isAbsolute(declaredPath)) return null;
  const segments = declaredPath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return null;
  const candidate = (declaredPath.startsWith("gates/")
    ? path.posix.join(relativePath, declaredPath)
    : path.posix.join(path.posix.dirname(manifestPath), declaredPath));
  return candidate === relativePath || candidate.startsWith(`${relativePath}/`) ? candidate : null;
}
function gateInventory(root, relativePath, block) {
  const manifestPath = path.join(relativePath, block.gate_pack?.manifest_path ?? "gates/manifest.json").split(path.sep).join("/");
  if (!exists(root, manifestPath)) return {status: "MISSING_GATE_MANIFEST", manifest_path: manifestPath, gates: []};
  const manifest = readJson(root, manifestPath);
  const hasCanonicalEntries = Object.prototype.hasOwnProperty.call(manifest, "entries");
  const declaredEntries = hasCanonicalEntries
    ? (Array.isArray(manifest.entries) ? manifest.entries.map((entry) => ({gate_id: entry?.gate_id, path: entry?.path, file_sha256: entry?.file_sha256})) : [])
    : (manifest.ordered_gate_ids ?? manifest.gate_ids ?? GATE_IDS).map((gateId) => ({
      gate_id: gateId,
      path: (manifest.gate_paths ?? []).find((candidate) => candidate.endsWith(`${gateId}.gate`)) ?? `gates/${gateId}.gate`,
      file_sha256: null,
    }));
  const gateIds = declaredEntries.map((entry) => entry.gate_id);
  const uniqueGateIds = new Set(gateIds);
  const gates = declaredEntries.flatMap((entry) => {
    if (typeof entry.gate_id !== "string" || entry.gate_id.length === 0 || (entry.file_sha256 !== null && !SHA256.test(entry.file_sha256))) return [];
    const gatePath = resolveManifestGatePath(relativePath, manifestPath, entry.path);
    if (gatePath === null || !exists(root, gatePath)) return [];
    const actualSha256 = fileSha(root, gatePath);
    if (entry.file_sha256 !== null && entry.file_sha256 !== actualSha256) return [];
    return [{gate_id: entry.gate_id, path: gatePath, file_sha256: actualSha256}];
  });
  const complete = declaredEntries.length > 0 && uniqueGateIds.size === declaredEntries.length && gates.length === declaredEntries.length;
  return {status: complete ? "BOUND" : "INCOMPLETE", manifest_path: manifestPath, gates};
}
function fixtureInventory(root, relativePath, block) {
  const manifestPath = path.join(relativePath, "hostile-fixtures.manifest.json").split(path.sep).join("/");
  if (exists(root, manifestPath)) {
    const manifest = readJson(root, manifestPath);
    const declared = manifest.entries ?? [];
    const fixtures = declared.flatMap((entry) => {
      const fixturePath = path.join(relativePath, entry.path).split(path.sep).join("/");
      return exists(root, fixturePath) ? [{fixture_id: entry.fixture_id, path: fixturePath, file_sha256: fileSha(root, fixturePath), expected_outcome: entry.expected_outcome ?? entry.expected ?? "DENY"}] : [];
    });
    return {status: fixtures.length === declared.length ? "BOUND" : "INCOMPLETE", fixtures};
  }
  const fixtureDirectory = path.join(root, relativePath, "fixtures");
  if (!fs.existsSync(fixtureDirectory)) return {status: "NO_DIRECT_FIXTURES;_EVALUATOR_MUST_BIND_EXACT_NEGATIVE_VECTORS", fixtures: []};
  const fixtures = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const fixturePath = path.join(relativePath, "fixtures", name).split(path.sep).join("/");
    const fixture = readJson(root, fixturePath);
    // The executable vector is the authority for the expected disposition.
    // Keep legacy top-level fields as compatibility fallbacks, but never
    // replace a canonical nested readback with the generic DENY default.
    const expectedOutcome = fixture.vector?.expected_readback?.disposition
      ?? fixture.expected_readback?.disposition
      ?? fixture.expected
      ?? fixture.expected_outcome
      ?? "DENY";
    return {fixture_id: fixture.fixture_id ?? `${block.block_id}.${normalize(name.replace(/\.json$/u, ""))}`, path: fixturePath, file_sha256: fileSha(root, fixturePath), expected_outcome: expectedOutcome};
  });
  return {status: fixtures.length ? "BOUND" : "NO_DIRECT_FIXTURES", fixtures};
}
function modelRoute(block, role, tier) {
  let taskClass = role?.task_class;
  const family = String(role?.family ?? block.family ?? "").toLowerCase();
  if (!taskClass) taskClass = tier === "SPECIALIST_AUDITORS" && (family.includes("security") || family.includes("privacy")) ? "SECURITY_REVIEW" : block.role_kind === "STANDARD_BLOCK" ? "LONG_CONTEXT_SYNTHESIS" : block.role_kind === "ROUTER" || block.role_kind === "CONTROL_PLANE" ? "DETERMINISTIC_QA" : "NARROW_CODING";
  return {task_class: taskClass, ...MODEL_TASKS[taskClass], route_source: "GLOBAL_MODEL_POLICY_SNAPSHOT"};
}
function likelyConsumers(family, tier) {
  if (tier === "PERMANENT_AGENTOS_ROLES") return ["AgentOS bootstrap", "Agent Spawner", "Controller", "Product Owner", "Memory", "Runtime", "Scheduler", "Orchestrator"];
  const value = family.toLowerCase();
  if (value.includes("security") || value.includes("privacy")) return ["API services", "web and mobile clients", "runtime and release", "independent assurance"];
  if (value.includes("product-client")) return ["web clients", "mobile clients", "desktop clients", "UX and product review"];
  if (value.includes("software-language")) return ["frontend and client builds", "backend and API builds", "tooling and release"];
  if (value.includes("data")) return ["backend and API services", "database and tenant-isolation review", "runtime"];
  if (value.includes("delivery") || value.includes("platform")) return ["infrastructure and cloud integrations", "runtime and release", "operations"];
  if (value.includes("assurance")) return ["independent auditors", "Orchestrator acceptance", "release integration"];
  if (value.includes("domain") || value.includes("finance") || value.includes("regulatory") || value.includes("graphics") || value.includes("ai")) return ["consumer project overlays", "Orchestrator planning", "independent audit lanes"];
  return ["AgentOS compiler", "governance and acceptance lanes", "consumer project overlays"];
}
function priorityFor(block, tier) { return tier === "PERMANENT_AGENTOS_ROLES" ? "P0" : block.priority ?? tier === "PLATFORM_AGENTS" ? "P1" : tier === "SPECIALIST_AUDITORS" ? "P2" : "P1"; }
function score(block, tier, role) {
  const priority = priorityFor(block, tier); const frequency = PRIORITY_SCORE[priority] ?? 30;
  const centrality = role?.id === "AGENTOS.SPAWNER" ? 100 : role ? 94 : block.role_kind === "ROUTER" ? 78 : block.role_kind === "CONTROL_PLANE" ? 82 : block.role_kind === "STANDARD_BLOCK" ? 62 : 55;
  const reuse = tier === "REUSABLE_BLOCK_LIBRARY" ? 96 : tier === "PERMANENT_AGENTOS_ROLES" ? 92 : tier === "PLATFORM_AGENTS" ? 78 : 68;
  const risk = priority === "P0" ? 98 : String(block.family).includes("security") ? 92 : priority === "P1" ? 82 : priority === "P2" ? 78 : 60;
  const coverage = tier === "PERMANENT_AGENTOS_ROLES" ? 100 : ["security", "data", "delivery-operations", "product-client", "software-language-runtime"].includes(block.family) ? 90 : 72;
  const finishCost = role && !exists(process.cwd(), role.package_path + "/block.json") ? 95 : block.role_kind === "STANDARD_BLOCK" ? 35 : 45;
  const total = Number((frequency * .25 + centrality * .2 + reuse * .2 + risk * .2 + coverage * .1 + (100 - finishCost) * .05).toFixed(2));
  return {total, expected_frequency: frequency, dependency_centrality: centrality, cross_project_reuse: reuse, risk_reduction: risk, architecture_coverage: coverage, finish_cost: finishCost, rationale: `${priority} priority combines ${tier.toLowerCase()} centrality, cross-project reuse, risk reduction, and completion cost; ${role?.reason ?? `the ${familyFor(block, role)} dependency graph determines the score`}.`};
}
function compileEntry(root, relativePath, acceptanceById = new Map(), reuseAllowed = true) {
  const block = readJson(root, `${relativePath}/block.json`); const role = packageRole(relativePath, block); const tier = tierFor(relativePath, block, role); const type = entryType(relativePath, block, role); const archived = block.lifecycle === "ARCHIVED";
  const family = familyFor(block, role); const stableId = role?.id ?? (archived ? "LEGACY.INTENT_REGULATOR" : `${type === "AGENT_ROLE" ? "AGENT" : "BLOCK"}.${normalize(block.block_id.replace(/^specialist\./u, ""))}`);
  const sourcePath = exists(root, `${relativePath}/sources.lock`) ? `${relativePath}/sources.lock` : null; const sourceIds = sourcePath ? asArray(readJson(root, sourcePath).sources).map((source) => source.source_id ?? source.identity ?? source.id).filter(Boolean) : [];
  const evaluationPath = exists(root, `${relativePath}/evaluation.json`) ? `${relativePath}/evaluation.json` : null; const evaluation = evaluationPath ? readJson(root, evaluationPath) : null; const handoffPath = exists(root, `${relativePath}/handoff.json`) ? `${relativePath}/handoff.json` : null;
  const gates = gateInventory(root, relativePath, block); const fixtures = fixtureInventory(root, relativePath, block); const dependencies = [...new Set([...(block.dependencies ?? []), ...(block.required_upstream_router ? [block.required_upstream_router] : [])].filter(Boolean))].sort();
  const triggers = [...(block.routing?.signals ?? []), ...(block.intake?.required_context ?? []), ...(block.applicability_inputs ?? [])].map(text).filter(Boolean).slice(0, 20); const knowledge = [...(block.required_knowledge ?? []), ...(block.intake?.required_context ?? []), ...sourceIds].map(text).filter(Boolean);
  const stops = [...asArray(block.stop_conditions), ...asArray(block.failure?.stop_conditions), ...asArray(block.failure?.deny_if), ...asArray(block.lifecycle_rules)].map(text).filter(Boolean); if (!stops.length) stops.push("Stop and return a typed handoff when authority, scope, evidence, custody, freshness, or applicability is missing.");
  const forbidden = [...asArray(block.forbidden_decisions), ...asArray(block.authority?.forbidden)].map(text).filter(Boolean); if (!forbidden.length) forbidden.push("Do not self-admit, widen scope, mutate consumer state, or cross the declared authority boundary.");
  const purpose = text(block.purpose) || `Narrow ${block.block_id} governance or evidence role.`; const authority = [text(block.maximum_authority), text(block.authority)].filter(Boolean); const missing = role && !exists(root, `${role.package_path}/block.json`);
  const acceptance = acceptanceById.get(stableId) ?? null;
  const acceptedReadback = Boolean(reuseAllowed && acceptance && acceptance.package_path === relativePath && acceptanceMatchesCurrentAuthority(root, acceptance));
  const buildState = role?.id === "AGENTOS.SPAWNER" ? "ACCEPTED_ADMITTED" : acceptedReadback ? "ACCEPTED_QUALIFIED" : archived ? "ARCHIVED_LEGACY" : missing ? "PLANNED_MISSING_PACKAGE" : type === "REUSABLE_GOVERNANCE_BLOCK" || type === "REUSABLE_STANDARD_BLOCK" ? "REUSABLE_BLOCK_READY" : "CANDIDATE_READY_FOR_QUALIFICATION";
  const qaState = role?.id === "AGENTOS.SPAWNER" || acceptedReadback ? "COMPLETE_QA_PASS" : missing ? "MISSING_PACKAGE" : evaluation?.disposition ?? "STATIC_PASS_REVIEW_REQUIRED"; const independentState = role?.id === "AGENTOS.SPAWNER" ? "ACCEPTED_CLEARANCE_BOUND" : acceptedReadback ? "INDEPENDENT_PASS_READBACK" : archived ? "RETIRED_READ_ONLY" : evaluation?.disposition ?? "PENDING_EXTERNAL_REVIEW";
  const links = ["supersession.json", "compatibility.json", "evaluation.json"].filter((file) => exists(root, `${relativePath}/${file}`)).map((file) => `${relativePath}/${file}`);
  return {stable_agent_id: stableId, display_name: role?.display_name ?? block.title ?? block.block_id.split(".").at(-1).replace(/-/gu, " "), entry_type: type, tier, canonical_block_id: block.block_id, package_path: relativePath, family, exact_narrow_purpose: purpose, applicability_triggers: triggers.length ? triggers : ["A typed request names this exact role or block, or its declared upstream route."], authority: authority.length ? authority : ["Only the exact declared control-plane or advisory boundary."], forbidden_actions: forbidden, stop_conditions: stops, required_blocks: dependencies, knowledge_context_inputs: knowledge, deterministic_gates: gates, hostile_fixtures: {status: fixtures.fixtures.length ? "BOUND" : "NO_DIRECT_FIXTURES;_EVALUATOR_MUST_BIND_EXACT_NEGATIVE_VECTORS", fixtures: fixtures.fixtures}, required_evidence_handoff: {evidence_fields: Object.keys(block.evidence ?? {}), handoff_path: handoffPath, handoff_file_sha256: handoffPath ? fileSha(root, handoffPath) : null, independent_review_required: Boolean(evaluation?.independent_reviewer_required ?? type === "AGENT_ROLE"), receipt_id: evaluation?.receipt_id ?? null}, lifecycle: {kind: tier === "PERMANENT_AGENTOS_ROLES" ? "PERMANENT_ROLE" : type === "REUSABLE_GOVERNANCE_BLOCK" || type === "REUSABLE_STANDARD_BLOCK" ? "REUSABLE_BLOCK" : archived ? "LEGACY_READ_ONLY" : stableId.includes("INDEPENDENT_AUDITOR") ? "TEMPORARY_AUDITOR" : "SEED_TO_WORKER", build_rules: asArray(block.lifecycle_rules).map(text), seed_rule: type === "AGENT_ROLE" ? "Only the sealed Spawner may create an immutable inert seed; the seed never performs work." : "No seed; inject this entry only through the immutable compiler.", worker_rule: type === "AGENT_ROLE" ? "Clone to a worker only after current admission, model projection, custody, and handoff checks pass; workers return typed defects to Spawner." : "Not a worker; use only through the canonical compiler.", permanent_rule: tier === "PERMANENT_AGENTOS_ROLES" ? "One canonical permanent identity, admitted once by Spawner and held under its lifecycle custody." : "Not a permanent identity.", archive_rule: "Archive or supersede only through Spawner after scope closure, evidence preservation, zero references, and durable readback."}, model_route: modelRoute(block, role, tier), dependency_predecessors: dependencies, likely_consumers: likelyConsumers(family, tier), reuse_likelihood: score(block, tier, role), risk: {criticality: tier === "PERMANENT_AGENTOS_ROLES" || family.includes("security") ? "CRITICAL" : priorityFor(block, tier) === "P1" ? "HIGH" : priorityFor(block, tier) === "P2" ? "MEDIUM" : "LOW", reason: `${tier} entry covers ${family}; impact is bounded by its narrow authority and independent admission requirement.`}, build_state: buildState, qa_state: qaState, independent_evaluation_state: independentState, supersession_invalidation: {links, invalidate_when: ["block semantic digest changes", "source lock or authoritative evidence changes", "gate or hostile fixture bytes change", "global model-policy snapshot or permanent-role registry changes"], rebuild_rule: "Invalidate dependent compiled contexts and seeds, preserve history, resolve current bytes, re-run deterministic gates, then obtain a new independent receipt before reuse."}};
}
function missingPermanentEntry(id, role) {
  const task = MODEL_TASKS[role.task_class]; return {stable_agent_id: id, display_name: role.display_name, entry_type: "AGENT_ROLE", tier: "PERMANENT_AGENTOS_ROLES", canonical_block_id: `AGENTOS.${id}.PACKAGE`, package_path: role.package_path, family: role.family, exact_narrow_purpose: `Permanent ${role.display_name} role: ${role.reason}`, applicability_triggers: ["Bootstrap resolves this role from the sealed permanent-role registry."], authority: ["Only the narrowly declared permanent role responsibility; Agent Spawner retains lifecycle authority."], forbidden_actions: ["Do not spawn, admit, archive, despawn, or mutate another role unless sealed governance explicitly assigns it.", "Do not self-admit, self-review, or write consumer state."], stop_conditions: ["Stop when the package, required gate tree, current model route, or independent review is missing.", "Return a typed defect to Agent Spawner for contradictions, stale evidence, or invalid handoffs."], required_blocks: ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evaluation-admission-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate"], knowledge_context_inputs: ["sealed permanent-role registry", `canonical package path: ${role.package_path}`, "current global model-policy snapshot", "project-scoped typed context only"], deterministic_gates: {status: "MISSING_PACKAGE", manifest_path: null, gates: []}, hostile_fixtures: {status: "MISSING_PACKAGE", fixtures: []}, required_evidence_handoff: {evidence_fields: ["complete canonical package", "executed deterministic gates", "hostile fixtures", "independent review and one-use admission"], handoff_path: null, handoff_file_sha256: null, independent_review_required: true, receipt_id: null}, lifecycle: {kind: "PERMANENT_ROLE", build_rules: ["Build and qualify exactly one permanent role package at a time."], seed_rule: "Permanent roles use governed admission and never perform work from an inert seed.", worker_rule: "Permanent work begins only after Spawner admission and current context readback.", permanent_rule: "The sealed registry owns the canonical permanent identity.", archive_rule: "Only Spawner may archive or supersede the role after durable handoff and zero references."}, model_route: {task_class: role.task_class, ...task, route_source: "GLOBAL_MODEL_POLICY_SNAPSHOT"}, dependency_predecessors: id === "AGENTOS_CONTROLLER" ? ["AGENTOS.SPAWNER"] : ["AGENTOS.SPAWNER", "AGENTOS_CONTROLLER"], likely_consumers: ["AgentOS bootstrap", "Agent Spawner", "project workflow"], reuse_likelihood: score({priority: "P0", role_kind: "CONTROL_PLANE", family: role.family}, "PERMANENT_AGENTOS_ROLES", role), risk: {criticality: "CRITICAL", reason: "Permanent role authority affects every later project workflow and requires independent admission."}, build_state: "PLANNED_MISSING_PACKAGE", qa_state: "MISSING_PACKAGE", independent_evaluation_state: "PENDING_PACKAGE_BUILD", supersession_invalidation: {links: [], invalidate_when: ["permanent-role registry changes", "package or gate bytes change", "global model-policy snapshot changes"], rebuild_rule: "Spawner must create the package, bind exact files, execute gates and fixtures, then obtain independent acceptance before admission."}};
}

export function rosterCompileIsComplete(entries) {
  return Array.isArray(entries) && entries.length > 0 && entries.every((entry) =>
    !["INCOMPLETE", "MISSING_GATE_MANIFEST"].includes(entry?.deterministic_gates?.status)
    && entry?.hostile_fixtures?.status !== "INCOMPLETE");
}

export function compileReusableAgentRoster({repositoryRoot = process.cwd(), writeGenerated = false} = {}) {
  resolveSpawnerWorkspaceCustody({taskRoot: repositoryRoot, taskLabel: "reusable roster compiler checkout"});
  assertSpawnerPortableInputs({repositoryRoot});
  const snapshot = readJson(repositoryRoot, "fixtures/model-policy-snapshot.initial.v1.json");
  let modelPolicyFresh = true;
  try {
    auditModelPolicyEvidenceStore(snapshot, {authorityRoot: repositoryRoot, evidenceManifestPath: "fixtures/model-policy-evidence/manifest.json", nowUtc: new Date().toISOString(), requireActive: false});
  } catch {
    modelPolicyFresh = false;
  }
  const acceptanceById = loadAcceptanceLedger(repositoryRoot); const packagePaths = walkPackages(repositoryRoot); const entries = packagePaths.map((relativePath) => compileEntry(repositoryRoot, relativePath, acceptanceById, modelPolicyFresh));
  for (const [id, role] of Object.entries(PERMANENT_ROLES)) if (!entries.some((entry) => entry.stable_agent_id === id)) entries.push(missingPermanentEntry(id, role));
  const aliases = entries.flatMap((entry) => {
    if (!entry.package_path || !exists(repositoryRoot, `${entry.package_path}/block.json`)) return [];
    const block = readJson(repositoryRoot, `${entry.package_path}/block.json`);
    return asArray(block.aliases).map((alias) => ({alias, canonical_id: entry.stable_agent_id, reason: "Declared package alias resolves to one canonical content-addressed entry."}));
  });
  if (!aliases.some((alias) => alias.alias === "AGENTOS.INTENT_REGULATOR")) aliases.push({alias: "AGENTOS.INTENT_REGULATOR", canonical_id: "LEGACY.INTENT_REGULATOR", reason: "Historical decoder only; never a current roster identity or spawn target."});
  entries.sort((left, right) => left.stable_agent_id.localeCompare(right.stable_agent_id)); aliases.sort((left, right) => left.alias.localeCompare(right.alias) || left.canonical_id.localeCompare(right.canonical_id));
  const permanentOrder = Object.keys(PERMANENT_ROLES);
  const campaignOrder = Object.keys(CAMPAIGN_ROLES);
  const agents = entries.filter((entry) => entry.entry_type === "AGENT_ROLE");
  const orderedAgents = [
    ...permanentOrder.map((id) => entries.find((entry) => entry.stable_agent_id === id)).filter(Boolean),
    ...campaignOrder.map((id) => entries.find((entry) => entry.stable_agent_id === id)).filter(Boolean),
    ...agents.filter((entry) => !permanentOrder.includes(entry.stable_agent_id) && !campaignOrder.includes(entry.stable_agent_id)).sort((left, right) => right.reuse_likelihood.total - left.reuse_likelihood.total || left.stable_agent_id.localeCompare(right.stable_agent_id)),
  ];
  const acceptedIds = new Set(orderedAgents.filter((entry) => entry.build_state === "ACCEPTED_ADMITTED" || entry.build_state === "ACCEPTED_QUALIFIED").map((entry) => entry.stable_agent_id));
  const permanentReady = permanentOrder.every((id) => id === "AGENTOS.SPAWNER" || acceptedIds.has(id));
  const completeCompile = rosterCompileIsComplete(entries);
  const nextEligible = modelPolicyFresh && completeCompile ? orderedAgents.find((entry) => {
    if (entry.build_state !== "CANDIDATE_READY_FOR_QUALIFICATION") return false;
    if (entry.tier === "PERMANENT_AGENTOS_ROLES") {
      const index = permanentOrder.indexOf(entry.stable_agent_id);
      return index >= 0 && permanentOrder.slice(0, index).every((id) => id === "AGENTOS.SPAWNER" || acceptedIds.has(id));
    }
    if (campaignOrder.includes(entry.stable_agent_id)) return permanentReady;
    return permanentReady;
  })?.stable_agent_id ?? null : null;
  const build_queue = orderedAgents.map((entry, index) => ({rank: index + 1, stable_agent_id: entry.stable_agent_id, tier: entry.tier, eligible: entry.stable_agent_id === nextEligible, priority_score: entry.reuse_likelihood.total, reason: !modelPolicyFresh ? "Blocked until the current model-policy snapshot and evidence store are fresh; no package may advance." : !completeCompile ? "Blocked until every compiled package gate and declared hostile fixture is present." : entry.build_state === "ACCEPTED_ADMITTED" || entry.build_state === "ACCEPTED_QUALIFIED" ? "Already independently accepted; reuse its exact receipt until invalidated." : entry.stable_agent_id === nextEligible ? "Highest eligible unaccepted package after dependency-safe predecessors." : entry.build_state === "PLANNED_MISSING_PACKAGE" ? "Blocked until the canonical package is built and qualified." : entry.tier === "PERMANENT_AGENTOS_ROLES" ? "Waits for dependency-safe permanent-role predecessors." : "Queued after permanent roles and platform prerequisites."}));
  const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.entry_type))].map((type) => [type, entries.filter((entry) => entry.entry_type === type).length]));
  const registry = {schema: "agentos.reusable_agent_roster.v1", version: 1, status: "COMPILED_CANDIDATE", governance_version: "2.1rc", project_agnostic: true, source_inventory: {canonical_library_roster: "specialist-blocks/registry/roster.v1.json", master_inventory: "specialist-blocks/registry/master-inventory.v1.json", permanent_role_registry: "specialist-blocks/registry/permanent-role-registry.v1.json", package_count: packagePaths.length, current_package_count: packagePaths.filter((relativePath) => readJson(repositoryRoot, `${relativePath}/block.json`).lifecycle !== "ARCHIVED").length, archived_package_count: packagePaths.filter((relativePath) => readJson(repositoryRoot, `${relativePath}/block.json`).lifecycle === "ARCHIVED").length, entry_type_counts: counts}, policy: {one_package_at_a_time: true, permanent_before_platform: true, platform_before_auditor: true, seed_is_inert: true, auditor_closeout: "Spawner despawns temporary auditors only after accepted handoff, closed scope, preserved evidence, and zero worktree or custody references.", acceptance_rule: "A package is built only after exact blocks, gates, hostile fixtures, model route, lifecycle, handoff, deterministic QA, and one independent evaluation are current and consumed through sealed admission.", model_names_are_advisory: true}, model_policy: {snapshot_path: "fixtures/model-policy-snapshot.initial.v1.json", snapshot_sha256: snapshot.snapshot_sha256, observed_at_utc: snapshot.observed_at_utc, expires_at_utc: snapshot.expires_at_utc, task_classes: snapshot.task_classes.map((task) => task.task_class)}, tiers: [{tier: "PERMANENT_AGENTOS_ROLES", rule: "Spawner first; then Controller, Product Owner, Memory, Runtime, Scheduler, and Orchestrator in dependency-safe canonical order. Only one package may be active.", order: permanentOrder}, {tier: "PLATFORM_AGENTS", rule: "Reusable integration and ownership roles follow accepted permanent foundations and cover client, backend/API, data, infrastructure/cloud, release, assurance, and delivery.", order: entries.filter((entry) => entry.tier === "PLATFORM_AGENTS").map((entry) => entry.stable_agent_id)}, {tier: "SPECIALIST_AUDITORS", rule: "Narrow standards, security, quality, regulatory, scientific, operational, and domain auditors follow platform prerequisites and one-at-a-time qualification.", order: entries.filter((entry) => entry.tier === "SPECIALIST_AUDITORS").map((entry) => entry.stable_agent_id)}], aliases, entries, build_queue, roster_sha256: null};
  registry.roster_sha256 = canonicalDigest({...registry, roster_sha256: null});
  if (writeGenerated) fs.writeFileSync(path.join(repositoryRoot, "specialist-blocks/registry/agent-roster.v1.json"), `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = compileReusableAgentRoster({writeGenerated: true});
  process.stdout.write(`${JSON.stringify({status: "PASS", entries: registry.entries.length, package_count: registry.source_inventory.package_count, roster_sha256: registry.roster_sha256}, null, 2)}\n`);
}
