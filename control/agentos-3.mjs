import {assert} from "./canonical-json.mjs";
import path from "node:path";
import {validateBootstrapPlan} from "./bootstrap-plan.mjs";
import {createCampaignAdmissionRoute} from "./campaign-admission.mjs";
import {validateGoal} from "./campaign-state.mjs";
import {validateCampaignVersion} from "./campaign-names.mjs";
import {runNativeCampaign} from "./campaign-runtime.mjs";
import {validateHostAdapter} from "./native-session.mjs";
import {loadNativeHostAdapter} from "./native-host-loader.mjs";
import {validateHostAttachment} from "./native-host-attachment.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {resolveWorkspaceRoot} from "./workspace-boundary.mjs";

export const AGENTOS3_RUNTIME_SCHEMA = "agentos.3_runtime.v1";

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function validateSourceBinding(plan, source) {
  assert(source && typeof source === "object" && !Array.isArray(source), "AgentOS 3 source binding is required");
  const expected = plan.source_binding;
  for (const field of ["source_commit", "source_tree", "worktree_id", "environment_id"]) {
    assert(source[field] === expected[field], `AgentOS 3 source ${field} differs from Bootstrap`);
  }
  assert(COMMIT.test(source.source_commit) && COMMIT.test(source.source_tree), "AgentOS 3 source commit/tree is invalid");
  return source;
}

function validateRuntimeInputs({root, bootstrap_plan, goal, campaign_id, campaign_version, source, authority_secret, evidence_secret}) {
  nonempty(root, "AgentOS 3 release root");
  validateBootstrapPlan(bootstrap_plan);
  assert(path.resolve(root) === path.resolve(resolveWorkspaceRoot(bootstrap_plan.workspace_boundary, "release_root")), "AgentOS 3 root is not the bound release root");
  validateGoal(goal);
  assert(goal.status === "ACTIVE", "AgentOS 3 requires an active goal");
  assert(typeof campaign_id === "string" && ID.test(campaign_id), "AgentOS 3 campaign_id is invalid");
  validateCampaignVersion(campaign_version, "AgentOS 3 campaign_version");
  validateSourceBinding(bootstrap_plan, source);
  assert(typeof authority_secret === "string" && authority_secret.length >= 32, "AgentOS 3 authority attestation is required in memory");
  assert(typeof evidence_secret === "string" && evidence_secret.length >= 32, "AgentOS 3 evidence attestation is required in memory");
}

function validateRequestBinding(request, {bootstrap_plan, goal, campaign_id, campaign_version, source}) {
  assert(request.project_id === bootstrap_plan.project_id, "owner request project differs from Bootstrap");
  assert(request.campaign_id === campaign_id, "owner request campaign differs from the active campaign");
  assert(request.campaign_version === campaign_version, "owner request version differs from the active campaign");
  assert(request.goal_id === goal.goal_id, "owner request goal differs from the active goal");
  assert(request.owner_answer && request.owner_answer.question_id === request.question_id, "owner request answer is not bound to its question");
  assert(source.source_commit === bootstrap_plan.source_binding.source_commit && source.source_tree === bootstrap_plan.source_binding.source_tree, "owner request source is not bound");
}

function requireIntentRegulator(intent_regulator) {
  assert(intent_regulator && typeof intent_regulator === "object" && !Array.isArray(intent_regulator), "AgentOS 3 Intent Regulator is required");
  assert(typeof intent_regulator.readSnapshot === "function", "AgentOS 3 Intent Regulator readSnapshot is required");
  assert(typeof intent_regulator.onAudit === "function", "AgentOS 3 Intent Regulator onAudit is required");
  return {...intent_regulator, interval_minutes: intent_regulator.interval_minutes ?? 15};
}

async function resolveHost({host, host_module_url, host_attachment}) {
  if (!((host && !host_module_url) || (!host && host_module_url))) throw runtimeError("HOST_ADAPTER_UNAVAILABLE", "No bound outside connection was supplied.");
  if (host) {
    try {
      validateHostAdapter(host);
    } catch {
      throw runtimeError("HOST_ADAPTER_INVALID", "The supplied outside connection does not provide the required actions.");
    }
    return host;
  }
  try {
    validateHostAttachment(host_attachment);
  } catch {
    throw runtimeError("HOST_ATTACHMENT_INVALID", "The outside connection is not bound to a valid project environment.");
  }
  try {
    return await loadNativeHostAdapter(host_module_url, host_attachment);
  } catch {
    throw runtimeError("HOST_ADAPTER_LOAD_FAILED", "The configured outside connection could not be loaded.");
  }
}

/**
 * The normal 3.0 Bootstrap-to-campaign path. The owner answer is the only
 * launch choice. After it matches the prepared continuation, this route runs
 * the complete native campaign and keeps the outcome in memory for the
 * persistent host/controller to record through its own safe storage boundary.
 */
export function createAgentOS3BootstrapRuntime({
  root,
  bootstrap_plan,
  goal,
  campaign_id,
  campaign_version,
  source,
  host = null,
  host_module_url = null,
  host_attachment = null,
  authority_secret,
  evidence_secret,
  role_library = null,
  intent_regulator = null,
  launch_answer_value = "START_LOCAL_CAMPAIGN",
}) {
  validateRuntimeInputs({root, bootstrap_plan, goal, campaign_id, campaign_version, source, authority_secret, evidence_secret});
  assert((typeof launch_answer_value === "string" && launch_answer_value.length > 0) || typeof launch_answer_value === "boolean", "AgentOS 3 launch answer value is invalid");
  const configuredIntentRegulator = requireIntentRegulator(intent_regulator);
  if (host_attachment !== null) {
    validateHostAttachment(host_attachment);
    assert(host_attachment.project_id === bootstrap_plan.project_id, "native host attachment project differs from Bootstrap");
    assert(host_attachment.environment_id === source.environment_id, "native host attachment environment differs from Bootstrap");
  }
  const outcomes = new Map();
  let hostPromise = null;
  const getHost = async () => {
    if (hostPromise === null) hostPromise = resolveHost({host, host_module_url, host_attachment});
    return hostPromise;
  };
  const route = createCampaignAdmissionRoute({
    admit: async (request) => {
      validateRequestBinding(request, {bootstrap_plan, goal, campaign_id, campaign_version, source});
      if (request.owner_answer.value !== launch_answer_value) throw runtimeError("OWNER_LAUNCH_NOT_AUTHORIZED", "The owner answer did not authorize this campaign.");
      const outcome = await runNativeCampaign({
        root,
        bootstrap_plan,
        goal,
        campaign_id,
        campaign_version,
        source,
        host: await getHost(),
        authority_secret,
        evidence_secret,
        role_library,
        intent_regulator: configuredIntentRegulator,
      });
      assertPortableRecord(outcome, "AgentOS 3 campaign outcome");
      outcomes.set(request.digest, outcome);
      return {
        status: "ADMITTED",
        admission_id: `CAMPAIGN_${campaign_id}_${campaign_version.replaceAll(".", "_").replaceAll("-", "_")}`,
        request_digest: request.digest,
      };
    },
  });
  return Object.freeze({
    async recordOwnerAnswer(record, answer) {
      return route.recordOwnerAnswer(record, answer);
    },
    campaignOutcome(request_digest) {
      nonempty(request_digest, "owner request digest");
      return outcomes.get(request_digest) ?? null;
    },
  });
}

export async function runAgentOS3Campaign(options) {
  validateRuntimeInputs(options);
  const configuredIntentRegulator = requireIntentRegulator(options.intent_regulator);
  const resolvedHost = await resolveHost(options);
  return runNativeCampaign({...options, host: resolvedHost, intent_regulator: configuredIntentRegulator});
}
