import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function loadCandidateContract() {
  return JSON.parse(await readFile(join(ROOT, "contracts", "agent-builder-candidate-receipt.json"), "utf8"));
}

export function validateCandidateFixtures() {
  const builder = join(ROOT, "agent-builder");
  const task = spawnSync("python3", [join(builder, "validate_task_ir.py")], { encoding: "utf8" });
  const context = spawnSync("python3", [join(builder, "validate_context_blocks.py")], { encoding: "utf8" });
  if (task.status !== 0 || context.status !== 0) {
    throw new Error(`AGENT_BUILDER_VALIDATION_FAILED:${task.stdout}${task.stderr}${context.stdout}${context.stderr}`);
  }
  return { task_ir: task.stdout.trim(), context_blocks: context.stdout.trim(), authority_effect_grants: [] };
}

export function denySideEffect(action) {
  throw new Error(`AGENT_BUILDER_SIDE_EFFECT_DENIED:${action}`);
}

const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`AGENT_BUILDER_${label}_SHAPE`);
};

export function compileGovernanceCandidate(request) {
  exactKeys(request, ["role_id", "role_name", "purpose", "scope", "source_refs", "budget", "version", "unknown_fields", "contradictions", "omissions", "stale_source"], "REQUEST");
  if (!/^role\.[a-z0-9._-]+$/u.test(request.role_id) || typeof request.role_name !== "string" || request.role_name.length === 0 || typeof request.purpose !== "string" || request.purpose.length === 0) throw new Error("AGENT_BUILDER_ROLE_INVALID");
  exactKeys(request.scope, ["include", "exclude"], "SCOPE");
  if (!Array.isArray(request.scope.include) || request.scope.include.length === 0 || !Array.isArray(request.scope.exclude)) throw new Error("AGENT_BUILDER_SCOPE_INVALID");
  if (!Array.isArray(request.source_refs) || request.source_refs.length === 0 || request.source_refs.some((ref) => typeof ref !== "string" || !/^(?:source:|sha256:)[a-zA-Z0-9._:-]+$/u.test(ref))) throw new Error("AGENT_BUILDER_PROVENANCE_INVALID");
  exactKeys(request.budget, ["max_tokens", "projected_tokens"], "BUDGET");
  if (!Number.isSafeInteger(request.budget.max_tokens) || request.budget.max_tokens <= 0 || !Number.isSafeInteger(request.budget.projected_tokens) || request.budget.projected_tokens < 0 || request.budget.projected_tokens > request.budget.max_tokens) throw new Error("AGENT_BUILDER_BUDGET_INVALID");
  if (!/^\d+\.\d+\.\d+$/u.test(request.version)) throw new Error("AGENT_BUILDER_VERSION_INVALID");
  if (!Array.isArray(request.unknown_fields) || !Array.isArray(request.contradictions) || !Array.isArray(request.omissions)) throw new Error("AGENT_BUILDER_LEDGER_INVALID");
  if (request.unknown_fields.length > 0) throw new Error("AGENT_BUILDER_UNKNOWN_FIELD");
  if (request.contradictions.length > 0) throw new Error("AGENT_BUILDER_CONTRADICTION");
  if (request.omissions.length > 0) throw new Error("AGENT_BUILDER_OMISSION");
  if (request.stale_source === true) throw new Error("AGENT_BUILDER_STALE_SOURCE");
  return {
    kind: "governance_context_candidate",
    schema: "agentos.integration.governance-candidate.v1",
    role_id: request.role_id,
    role_name: request.role_name,
    purpose: request.purpose,
    scope: { include: [...request.scope.include].sort(), exclude: [...request.scope.exclude].sort() },
    provenance: { source_refs: [...request.source_refs].sort(), version: request.version },
    budget: { max_tokens: request.budget.max_tokens, projected_tokens: request.budget.projected_tokens },
    authority_effect_grants: [],
    context_projection: { block_id: `block.${request.role_id.slice(5)}`, scope: { include: [...request.scope.include].sort(), exclude: [...request.scope.exclude].sort() }, loading: "bounded_progressive", security: { secrets_allowed: false, protected_data_allowed: false } },
    activation_package: { admission: "NOT_ADMITTED", activation: "NOT_ACTIVATED", capability_lease: "EXTERNAL_TYPED_LEASE_REQUIRED" },
    lifecycle: "CANDIDATE",
    admission: "NOT_ADMITTED",
    activation: "NOT_ACTIVATED",
    handoff: { kind: "typed_governance_handoff", required_fields: ["role_id", "scope", "provenance", "budget", "authority_effect_grants"], closure: "independent_evaluation_required" }
  };
}
