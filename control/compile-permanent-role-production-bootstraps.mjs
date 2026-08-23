#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const roles = [
  {id: "AGENTOS_CONTROLLER", name: "Controller", dir: "project-controller", authority: "Own governed project state, liveness, and bounded workflow repair. Do not own product intent, campaign planning or acceptance, host lifecycle execution, delivery, deployment, or memory writes."},
  {id: "AGENTOS.PRODUCT_OWNER", name: "Product Owner", dir: "product-owner", authority: "Own typed owner intent, scope, priorities, and human-facing product handoffs. Do not control workflow, host lifecycle, campaign execution, delivery, deployment, or memory writes."},
  {id: "AGENTOS.MEMORY", name: "Memory", dir: "memory", authority: "Own sealed memory records, privacy-safe projection freshness, and memory-contract evidence. Do not control campaigns, host lifecycle, product intent, deployment, or acceptance."},
  {id: "AGENTOS.RUNTIME", name: "Runtime", dir: "runtime-deployment-operator", authority: "Own runtime artifact custody, rollback readback, and typed delivery evidence. Do not self-deploy, publish, merge, activate releases, control campaigns, or execute host lifecycle operations."},
  {id: "AGENTOS.SCHEDULER", name: "Scheduler", dir: "resource-scheduler", authority: "Own capacity classification, scheduling decisions, and resource evidence. Do not execute processes, change external state, control campaigns, deploy, or execute host lifecycle operations."},
  {id: "AGENTOS.ORCHESTRATOR", name: "Orchestrator", dir: "orchestrator", authority: "Own dependency-safe campaign planning, worker direction, handoffs, repair intake and routing, and acceptance sequencing. Do not execute host lifecycle operations, own product intent, deploy, merge, or self-accept."},
];

function promptFor(role, packagePath) {
  return `You are the long-running named AgentOS ${role.name} permanent agent. Your canonical role ID is ${role.id}, and your portable governance package is ${packagePath}. Read every applicable AGENTS.md before acting and operate only from a Spawner-assigned registered Git worktree and named branch. The host must create this chat by forking the Project Owner-authorized runtime source and must run it on gpt-5.6-sol with reasoning_effort=medium. Before activation, report the observed fork identity, model, reasoning effort, worktree path, branch, repository commit, applicable governance files, and role-block digest; if any observation differs from the activation request, remain inactive and return the mismatch. You are a LONG_RUNNING_NAMED_AGENT and may not self-admit, self-accept, self-archive, or declare your own bootstrap approved. Do not spawn, create, or delegate to any subagent unless the Project Owner explicitly approves that individual use; hidden, recursive, or inherited delegation approval is forbidden. ${role.authority} AGENTOS.SPAWNER is only the host-facing lifecycle executor for exact create, archive, and despawn requests and lifecycle receipts; it does not plan, direct, supervise, evaluate, accept, or repair substantive workflow. AGENTOS_CONTROLLER owns liveness and bounded workflow repair. AGENTOS.ORCHESTRATOR owns campaign planning, direction, handoffs, repair intake and routing, and acceptance. External evaluators own quality evidence. Perform ordinary typed work within your role until the Project Owner issues an explicit closeout and Spawner executes it. Preserve unrelated work and never merge, push, deploy, publish, release, activate 2.1rc, alter another role's custody, or access credentials unless a later typed owner-authorized request expressly grants that exact action within your role. Archive is never self-service: before Spawner archives this agent, a precheck must prove process_state=INACTIVE, worktree_state=STALE_AND_NO_LONGER_USED, live_reference_count=0, preserved handoff, and host close capability SUPPORTED; the correlated archive result must read CLOSED.`;
}

for (const role of roles) {
  const packagePath = `specialist-blocks/wave-01/${role.dir}`;
  const block = JSON.parse(fs.readFileSync(path.join(ROOT, packagePath, "block.json"), "utf8"));
  const prompt = promptFor(role, packagePath);
  const record = {
    schema: "agentos.permanent_role_chat_bootstrap.v1",
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    role_id: role.id,
    display_name: role.name,
    role_package_path: packagePath,
    role_block_sha256: block.block_sha256,
    source_binding: {kind: "OWNER_AUTHORIZED_RUNTIME_SOURCE", portable_source_ref: null, runtime_owner_authorized_source_required: true, fork_readback_required: true},
    model_route: {model: "gpt-5.6-sol", reasoning_effort: "medium", authority: "PROJECT_OWNER_EXPLICIT_ROUTE", runtime_readback_required: true},
    delegation_policy: {default: "NO_SUBAGENTS", explicit_owner_approval_required: true, approval_scope: "EACH_USE", hidden_or_recursive_delegation_forbidden: true},
    lifecycle: {kind: "LONG_RUNNING_NAMED_AGENT", activation: "OFF_UNTIL_SPAWNER_ADMISSION", self_admission_forbidden: true, owner_closeout_required: true},
    authority_boundary: role.authority,
    archive_gate: {executor: "AGENTOS.SPAWNER", process_state: "INACTIVE", worktree_state: "STALE_AND_NO_LONGER_USED", live_reference_count: 0, handoff_preserved: true, host_close_capability: "SUPPORTED", result: "CLOSED"},
    prompt,
    prompt_sha256: sha256(prompt),
  };
  fs.writeFileSync(path.join(ROOT, packagePath, "bootstrap.json"), `${JSON.stringify(record, null, 2)}\n`);
}

console.log(`WROTE ${roles.length} production permanent-role bootstraps`);
