#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

const boundary = json("schemas/agent-spawner-role-boundary.v1.json");
assert.equal(boundary.schema, "agentos.agent_spawner_role_boundary.v1");
assert.equal(boundary.role_id, "AGENTOS.SPAWNER");
assert.deepEqual(boundary.request_authorities, ["PROJECT_OWNER", "ORCHESTRATOR", "CONTROLLER"]);
assert.deepEqual(boundary.create.effects, [
  "CREATE_EXACTLY_ONE_AGENT",
  "REGISTER_ACTIVE_LIFECYCLE_IDENTITY",
  "RETURN_SPAWN_RECEIPT_OR_TYPED_PROVISIONING_FAILURE",
]);
assert.deepEqual(boundary.archive.effects, [
  "ARCHIVE_OR_DESPAWN_EXACT_AGENT",
  "REMOVE_ACTIVE_LIFECYCLE_IDENTITY",
  "RETURN_ARCHIVE_RECEIPT",
]);
assert.equal(boundary.archive.meaning, "ADMINISTRATIVE_LIFECYCLE_CLOSURE_NOT_WORK_ACCEPTANCE");

const storage = boundary.storage_and_worktree_boundary;
assert.equal(storage.rule, "AGENT_ARCHIVAL_DOES_NOT_IMPLY_STORAGE_DELETION");
assert.equal(storage.decision_authority, "REQUESTING_CUSTODY_OR_STORAGE_AUTHORITY");
assert(storage.rules.includes("AGE_OR_STORAGE_PRESSURE_IS_TRIAGE_EVIDENCE_NOT_DELETION_AUTHORITY"));
assert(storage.rules.includes("WORKTREE_REMOVAL_USES_THE_VERSION_CONTROL_WORKTREE_INTERFACE"));
for (const block of [
  "ACTIVE_AGENT_OR_PROCESS",
  "DIRTY_OR_UNPUSHED_WORK_WITHOUT_EXPLICIT_PRESERVATION",
  "LIVE_DATABASE_RUNTIME_OR_MOUNT",
  "UNVERIFIED_ARCHIVE_OR_BACKUP_COVERAGE",
  "OPERATING_SYSTEM_MANAGED_STORAGE",
]) assert(storage.hard_blocks.includes(block), `Spawner storage boundary lost hard block: ${block}`);

const requiredProhibitions = [
  "ACCEPT_OR_REJECT_AGENT_WORK",
  "COORDINATE_CAMPAIGN_EXECUTION",
  "DECIDE_PROJECT_PRIORITY",
  "DIRECT_AGENT_WORK",
  "EVALUATE_OR_REVIEW_AGENT_WORK",
  "INTEGRATE_MERGE_DEPLOY_OR_RELEASE",
  "MONITOR_OR_SUPERVISE_PROGRESS",
  "PLAN_ASSIGNMENTS_OR_WAVES",
  "ROUTE_REPAIRS_OR_FINDINGS",
];
assert.deepEqual(boundary.prohibited_responsibilities, requiredProhibitions);
assert.equal(boundary.authority_precedence.rule, "THIS_CONTRACT_SUPERSEDES_ANY_OLDER_SPAWNER_ARTIFACT_THAT_ASSIGNS_A_PROHIBITED_RESPONSIBILITY");
assert.equal(boundary.authority_precedence.legacy_behavior, "HISTORICAL_COMPATIBILITY_ONLY_NOT_CURRENT_ROLE_AUTHORITY");

const article = read("docs/agent-spawner-lifecycle.md");
for (const statement of [
  "does not decide what work should happen",
  "supersedes older Spawner artifacts",
  "does not\nplan the assignment",
  "Archival is\nadministrative and never means that the agent's work was accepted",
  "Agent archival is not storage-deletion authority",
  "infer deletion from\nage or storage pressure",
  "Operating-system-managed storage is\nnever a Spawner cleanup target",
]) assert(article.includes(statement), `Spawner lifecycle article lost boundary statement: ${statement}`);

const kernel = json("schemas/kernel.v1.json");
assert.equal(kernel.agentos_controller.agent_spawner_lifecycle.responsibility_contract, "schemas/agent-spawner-role-boundary.v1.json");
for (const term of ["does not plan", "monitor", "evaluate", "accept", "integrate", "deploy"]) {
  assert(kernel.agentos_controller.agent_spawner_lifecycle.rule.includes(term), `Kernel Spawner boundary lost ${term}`);
}

const planning = json("schemas/controller-import-planning.v1.json").spawner_boundary;
assert(planning.rule.includes("creates or archives the exact governed agent"));
assert(planning.background_rule.includes("no background wave preparation"));
assert(planning.invalidation_rule.includes("without repairing or evaluating"));

const loop = json("schemas/continuous-operating-loop.v1.json");
assert(loop.roles.orchestrator.responsibility.includes("direct admitted campaign workers"));
assert(loop.roles.orchestrator.responsibility.includes("executed only by the Spawner"));

const controller = json("schemas/agentos-controller.v1.json");
assert(controller.campaign_boundary.import_orchestrator_rule.includes("owns its liveness boundary"));
assert(controller.campaign_boundary.import_orchestrator_rule.includes("Spawner executes lifecycle operations only"));

const permanentRoster = json("schemas/permanent-role-roster.v1.json");
assert(permanentRoster.description.includes("does not audit, independently evaluate, direct, or accept"));

const spawnerBlock = json("specialist-blocks/control-plane/agent-spawner/block.json");
assert(spawnerBlock.authority.includes("Spawner is the sole host-facing executor for ordinary-agent create, archive, and despawn operations after Bootstrap creates the first Spawner."));
assert(spawnerBlock.authority.includes("Spawner never plans, prioritizes, directs, monitors, supervises, evaluates, reviews, accepts, repair-routes, integrates, merges, deploys, or releases agent work."));
assert(spawnerBlock.custody.includes("Agent archival does not imply storage deletion; cleanup requires a separate exact preserve-or-cleanup disposition from the requesting custody or storage authority."));
assert(spawnerBlock.custody.includes("Spawner may mechanically execute that exact disposition but never selects cleanup targets or infers deletion authority from age or storage pressure."));

console.log("PASS Agent Spawner role boundary: lifecycle-only execution and receipt-bound storage handling are separated from planning, judgment, supervision, acceptance, repair routing, and cleanup selection");
