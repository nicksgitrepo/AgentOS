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
