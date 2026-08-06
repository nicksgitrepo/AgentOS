import {assert} from "./canonical-json.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

function goalContext(goal, laneId) {
  const context = {
    goal_id: goal.goal_id,
    goal_sha256: goal.digest,
    lane_id: laneId,
    objective: goal.objective,
    scope: goal.scope,
    intent: goal.intent,
    boundaries: goal.boundaries,
  };
  assertPortableRecord(context, "campaign goal context");
  return JSON.stringify(context);
}

export function workerPrompt(goal, laneId) {
  assert(goal && typeof goal === "object", "campaign prompt goal is required");
  return `Work only on the admitted ${laneId} lane. The bounded goal context is ${goalContext(goal, laneId)}. Return meaningful progress and a typed handoff with evidence before the fifteen-minute window ends.`;
}

export function auditorPrompt(goal, phaseId) {
  assert(goal && typeof goal === "object", "Auditor prompt goal is required");
  return `Independently review every accepted result in ${phaseId} for goal ${goal.goal_id} (${goal.digest}). Do not accept work authored by your own session.`;
}
