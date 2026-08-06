import {assert} from "./canonical-json.mjs";
import {createCampaignAdmissionRoute} from "./campaign-admission.mjs";
import {spawnVisibleWorker} from "./native-session.mjs";
import {opaqueReference} from "./opaque-reference.mjs";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function validatePreparedAdmission(prepared) {
  exactKeys(prepared, ["admission", "host_worker_boundary"], "prepared Bootstrap admission");
  assert(prepared.admission && typeof prepared.admission === "object" && !Array.isArray(prepared.admission), "prepared admission is required");
  assert(prepared.host_worker_boundary && typeof prepared.host_worker_boundary === "object" && !Array.isArray(prepared.host_worker_boundary), "prepared host worker boundary is required");
  return prepared;
}

/**
 * Production Bootstrap route: an accepted owner answer immediately prepares
 * and spawns the first release/control worker through the visible host path.
 * Product-lane workers use the control-managed campaign runner instead.
 */
export function createBootstrapRuntime({host, admitCampaign}) {
  assert(host && typeof host === "object", "Bootstrap host is required");
  assert(typeof admitCampaign === "function", "Bootstrap admission callback is required");
  const admissionRoute = createCampaignAdmissionRoute({
    admit: async (resume_request) => {
      const prepared = validatePreparedAdmission(await admitCampaign({...resume_request}));
      const session = await spawnVisibleWorker(host, prepared.admission, prepared.host_worker_boundary);
      nonempty(session.host_id, "visible worker host_id");
      return {status: "ADMITTED", admission_id: opaqueReference("admission", session.host_id, resume_request.digest), request_digest: resume_request.digest};
    },
  });

  return Object.freeze({
    async recordOwnerAnswer(record, answer) {
      return admissionRoute.recordOwnerAnswer(record, answer);
    },
  });
}
