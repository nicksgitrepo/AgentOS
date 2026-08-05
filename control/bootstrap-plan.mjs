import {assert, digestWithout, sha256, sortedUniqueStrings} from "./canonical-json.mjs";
import {compileRoleLibrary} from "./role-library.mjs";
import {DEFAULT_MODEL, DEFAULT_REASONING_EFFORT} from "./native-session.mjs";

export const BOOTSTRAP_PLAN_SCHEMA = "agentos.bootstrap_plan.v1";
export const BOOTSTRAP_MODES = Object.freeze(["RAPID_PROTOTYPING", "ITERATION"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const LOWER_ID = /^[a-z][a-z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const LANES = Object.freeze([
  "bootstrap-context", "code-hygiene", "delivery-closure", "evidence-identity", "functionality", "intent-scope",
  "progress-health", "recovery-boundaries", "role-routing", "security-privacy", "ui-ux", "user-conversation",
]);

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function validateSourceBinding(binding) {
  exactKeys(binding, ["source_commit", "source_tree", "worktree_id", "bootstrap_session_id", "environment_id"], "bootstrap source binding");
  assert(COMMIT.test(binding.source_commit) && COMMIT.test(binding.source_tree), "bootstrap source binding commit/tree is invalid");
  for (const field of ["worktree_id", "bootstrap_session_id", "environment_id"]) nonempty(binding[field], `bootstrap source binding ${field}`);
}

function phase(phase_id, lane_ids, purpose) {
  assert(ID.test(phase_id), "bootstrap phase ID is invalid");
  lane_ids.forEach((lane) => assert(LOWER_ID.test(lane), `bootstrap phase lane ${lane} is invalid`));
  return {phase_id, lane_ids: [...lane_ids], purpose};
}

export async function compileBootstrapPlan(root, {project_id, owner_context, source_binding, rapid_prototyping = true}) {
  nonempty(project_id, "project_id");
  assert(ID.test(project_id), "project_id is invalid");
  assert(owner_context && typeof owner_context === "object" && !Array.isArray(owner_context), "owner_context must be an object");
  validateSourceBinding(source_binding);
  assert(rapid_prototyping === true, "this compiler currently requires Rapid Prototyping Mode");
  const roleLibrary = await compileRoleLibrary(root);
  const phases = [
    phase("RAPID_FOUNDATION", ["intent-scope", "bootstrap-context", "user-conversation", "role-routing", "progress-health"], "Turn the owner's plain-language intent into bounded, routed work."),
    phase("RAPID_BUILD", ["functionality", "ui-ux", "code-hygiene", "security-privacy"], "Build the smallest working prototype and check how people use it."),
    phase("RAPID_PROOF", ["evidence-identity", "recovery-boundaries"], "Check that the result is real, recoverable, and still inside intent."),
    phase("RAPID_CLOSE", ["delivery-closure"], "Finish the prototype the way the owner chose and close temporary work."),
  ];
  const phaseLanes = phases.flatMap((item) => item.lane_ids);
  assert(JSON.stringify([...phaseLanes].sort()) === JSON.stringify([...LANES].sort()), "Rapid Prototyping phases must cover every lane exactly once");
  assert(new Set(phaseLanes).size === LANES.length, "Rapid Prototyping lanes must not repeat");
  const plan = {
    schema: BOOTSTRAP_PLAN_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id,
    mode: "RAPID_PROTOTYPING",
    next_mode: "ITERATION",
    owner_context_sha256: sha256(owner_context),
    source_binding: {...source_binding},
    defaults: {model: DEFAULT_MODEL, reasoning_effort: DEFAULT_REASONING_EFFORT, progress_window_minutes: 15},
    conversation: {
      style: "FRIENDLY_ONE_SHORT_QUESTION",
      numeric_answers: true,
      boolean_answers: true,
      technical_terms_hidden: true,
      ask_only_when_owner_choice_is_real: true,
    },
    activation: {
      unchanged_in_scope_work: "CONTINUE_AFTER_JSA_REASSESSMENT",
      scope_or_intent_change: "CLOSE_GOAL_AND_MINT_REPLACEMENT",
      protected_actions_keep_exact_authority: true,
    },
    persistent_roles: ["INTENT_REGULATOR", "RUNTIME"],
    campaign_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"],
    lane_worker_role: "NAMED_LANE_WORKER",
    phases,
    role_library_digest: roleLibrary.digest,
    protected_actions: ["PUBLISH", "PUSH", "MERGE", "DEPLOY", "ROLLBACK", "SPEND", "AUTHENTICATE", "REVEAL_SECRET", "DELETE_ACCEPTED_WORK"],
    completion: {
      rapid_prototype_done_when: "A basic working result has passed the applicable lanes, independent audit, and temporary-agent closure.",
      iteration_entry: "The next scoped change starts a fresh campaign from the accepted prototype and current owner intent.",
    },
    digest: null,
  };
  plan.digest = digestWithout(plan, "digest");
  return validateBootstrapPlan(plan);
}

export function validateBootstrapPlan(plan) {
  exactKeys(plan, ["schema", "version", "status", "project_id", "mode", "next_mode", "owner_context_sha256", "source_binding", "defaults", "conversation", "activation", "persistent_roles", "campaign_roles", "lane_worker_role", "phases", "role_library_digest", "protected_actions", "completion", "digest"], "bootstrap plan");
  assert(plan.schema === BOOTSTRAP_PLAN_SCHEMA && plan.version === 1, "bootstrap plan identity is invalid");
  assert(plan.status === "PREPARED_NOT_ACTIVATED" && plan.mode === "RAPID_PROTOTYPING" && plan.next_mode === "ITERATION", "bootstrap mode is invalid");
  assert(typeof plan.project_id === "string" && ID.test(plan.project_id), "bootstrap project ID is invalid");
  assert(DIGEST.test(plan.owner_context_sha256) && DIGEST.test(plan.role_library_digest), "bootstrap plan digest binding is invalid");
  validateSourceBinding(plan.source_binding);
  exactKeys(plan.defaults, ["model", "reasoning_effort", "progress_window_minutes"], "bootstrap defaults");
  assert(plan.defaults.model === DEFAULT_MODEL && plan.defaults.reasoning_effort === DEFAULT_REASONING_EFFORT && plan.defaults.progress_window_minutes === 15, "bootstrap defaults are invalid");
  exactKeys(plan.conversation, ["style", "numeric_answers", "boolean_answers", "technical_terms_hidden", "ask_only_when_owner_choice_is_real"], "bootstrap conversation");
  assert(plan.conversation.style === "FRIENDLY_ONE_SHORT_QUESTION" && plan.conversation.numeric_answers === true && plan.conversation.boolean_answers === true && plan.conversation.technical_terms_hidden === true && plan.conversation.ask_only_when_owner_choice_is_real === true, "bootstrap conversation floor is invalid");
  exactKeys(plan.activation, ["unchanged_in_scope_work", "scope_or_intent_change", "protected_actions_keep_exact_authority"], "bootstrap activation");
  assert(plan.activation.unchanged_in_scope_work === "CONTINUE_AFTER_JSA_REASSESSMENT", "bootstrap launch rule is invalid");
  assert(plan.activation.scope_or_intent_change === "CLOSE_GOAL_AND_MINT_REPLACEMENT", "bootstrap reassessment rule is invalid");
  assert(plan.activation.protected_actions_keep_exact_authority === true, "protected action boundary is invalid");
  assert(JSON.stringify(plan.persistent_roles) === JSON.stringify(["INTENT_REGULATOR", "RUNTIME"]), "persistent role set is invalid");
  assert(JSON.stringify(plan.campaign_roles) === JSON.stringify(["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"]), "campaign role set is invalid");
  assert(plan.lane_worker_role === "NAMED_LANE_WORKER", "lane worker role is invalid");
  assert(Array.isArray(plan.phases) && plan.phases.length === 4, "bootstrap phase count is invalid");
  const lanes = plan.phases.flatMap((item) => item.lane_ids);
  sortedUniqueStrings([...new Set(lanes)].sort(), "bootstrap lanes");
  assert(JSON.stringify([...lanes].sort()) === JSON.stringify([...LANES].sort()), "bootstrap phases do not cover all lanes exactly once");
  assert(Array.isArray(plan.protected_actions) && plan.protected_actions.length > 0, "protected actions are missing");
  assert(plan.digest === digestWithout(plan, "digest"), "bootstrap plan digest does not match content");
  return plan;
}

