import {assert, digestWithout} from "./canonical-json.mjs";

export const SNAPSHOT_SCHEMA = "agentos.campaign_snapshot.v1";
export const AUDIT_SCHEMA = "agentos.intent_regulator_audit.v1";
export const AUDIT_DECISIONS = Object.freeze([
  "CONTINUE_CAMPAIGN",
  "STOP_HARD_BOUNDARY",
  "REASSESS_AND_REPLACE_GOAL",
  "ORCHESTRATOR_REVIEW",
  "REPLACE_STALLED_WORKER",
  "AWAIT_ACCEPTANCE",
]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function bool(value, label) { assert(typeof value === "boolean", `${label} must be boolean`); }

export function validateCampaignSnapshot(snapshot) {
  exactKeys(snapshot, ["schema", "version", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256", "source_commit", "source_tree", "progress_status", "scope_changed", "intent_changed", "conditions_changed", "hard_boundary_detected", "soft_boundary_detected", "evidence_identity_ok", "roster_exact", "acceptance_status"], "campaign snapshot");
  assert(snapshot.schema === SNAPSHOT_SCHEMA && snapshot.version === 1, "campaign snapshot identity is invalid");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) assert(ID.test(snapshot[field]), `campaign snapshot ${field} is invalid`);
  assert(DIGEST.test(snapshot.goal_sha256), "campaign snapshot goal digest is invalid");
  assert(COMMIT.test(snapshot.source_commit) && COMMIT.test(snapshot.source_tree), "campaign snapshot source identity is invalid");
  assert(["OPEN", "PROGRESS_RECORDED", "STALLED", "CLOSED"].includes(snapshot.progress_status), "campaign snapshot progress status is invalid");
  for (const field of ["scope_changed", "intent_changed", "conditions_changed", "hard_boundary_detected", "soft_boundary_detected", "evidence_identity_ok", "roster_exact"]) bool(snapshot[field], `campaign snapshot ${field}`);
  assert(["NONE", "CANDIDATE", "ACCEPTED"].includes(snapshot.acceptance_status), "campaign snapshot acceptance status is invalid");
  return snapshot;
}

export function auditCampaignSnapshot(snapshot, observed_at_utc, interval_minutes = 15) {
  validateCampaignSnapshot(snapshot);
  assert(typeof observed_at_utc === "string" && UTC.test(observed_at_utc), "audit observed_at_utc is invalid");
  assert(Number.isInteger(interval_minutes) && interval_minutes > 0 && interval_minutes <= 240, "audit interval must be between 1 and 240 minutes");
  let decision = "CONTINUE_CAMPAIGN";
  const reasons = [];
  if (snapshot.hard_boundary_detected) { decision = "STOP_HARD_BOUNDARY"; reasons.push("HARD_BOUNDARY_DETECTED"); }
  else if (snapshot.scope_changed || snapshot.intent_changed || snapshot.conditions_changed) { decision = "REASSESS_AND_REPLACE_GOAL"; reasons.push("LIVING_GOAL_CHANGED"); }
  else if (!snapshot.evidence_identity_ok || !snapshot.roster_exact) { decision = "STOP_HARD_BOUNDARY"; reasons.push("CONTROL_STATE_MISMATCH"); }
  else if (snapshot.soft_boundary_detected) { decision = "ORCHESTRATOR_REVIEW"; reasons.push("SOFT_BOUNDARY_REVIEW_REQUIRED"); }
  else if (snapshot.progress_status === "STALLED") { decision = "REPLACE_STALLED_WORKER"; reasons.push("MEANINGFUL_PROGRESS_WINDOW_MISSED"); }
  else if (snapshot.acceptance_status === "CANDIDATE") { decision = "AWAIT_ACCEPTANCE"; reasons.push("INDEPENDENT_ACCEPTANCE_REQUIRED"); }
  const audit = {
    schema: AUDIT_SCHEMA,
    version: 1,
    regulator_role: "INTENT_REGULATOR",
    lifetime: "PERSISTENT",
    project_id: snapshot.project_id,
    campaign_id: snapshot.campaign_id,
    campaign_version: snapshot.campaign_version,
    goal_id: snapshot.goal_id,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    interval_minutes,
    observed_at_utc,
    decision,
    reasons,
    digest: null,
  };
  audit.digest = digestWithout(audit, "digest");
  return audit;
}

export function createAbortableSleep() {
  return (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("AUDIT_LOOP_ABORTED")); return; }
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new Error("AUDIT_LOOP_ABORTED")); };
    signal?.addEventListener("abort", abort, {once: true});
  });
}

export async function runIntentRegulatorLoop({readSnapshot, onAudit, interval_minutes = 15, signal, sleep = createAbortableSleep(), max_iterations = null}) {
  assert(typeof readSnapshot === "function" && typeof onAudit === "function", "Intent Regulator loop callbacks are required");
  assert(Number.isInteger(interval_minutes) && interval_minutes > 0 && interval_minutes <= 240, "audit interval must be between 1 and 240 minutes");
  if (max_iterations !== null) assert(Number.isInteger(max_iterations) && max_iterations > 0, "max_iterations must be positive");
  let iterations = 0;
  while (!signal?.aborted && (max_iterations === null || iterations < max_iterations)) {
    const snapshot = await readSnapshot();
    const observed = new Date().toISOString();
    const audit = auditCampaignSnapshot(snapshot, observed, interval_minutes);
    await onAudit(audit);
    iterations += 1;
    if (max_iterations !== null && iterations >= max_iterations) break;
    await sleep(interval_minutes * 60_000, signal);
  }
  return {iterations, stopped: Boolean(signal?.aborted)};
}

