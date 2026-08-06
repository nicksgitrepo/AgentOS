import {assert} from "./canonical-json.mjs";

const LOWER_ID = /^[a-z][a-z0-9._-]*$/u;
export const CAMPAIGN_VERSION = /^(?:v\d+\.\d+\.\d+(?:-(?:tb|rc)-\d+)?|[A-Z][A-Z0-9._-]*)$/u;

function words(value) {
  return value.toLowerCase().split("-").map((part) => part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

export function workerDisplayName(laneId, campaignVersion) {
  assert(typeof laneId === "string" && LOWER_ID.test(laneId), "worker lane ID is invalid");
  assert(typeof campaignVersion === "string" && campaignVersion.length > 0, "worker campaign version is required");
  return `${words(laneId)} Worker ${campaignVersion}`;
}

export function validateCampaignVersion(value, label = "campaign_version") {
  assert(typeof value === "string" && CAMPAIGN_VERSION.test(value), `${label} is invalid`);
  return value;
}

export function auditorDisplayName(phaseId, campaignVersion) {
  assert(typeof phaseId === "string" && phaseId.length > 0, "auditor phase ID is required");
  assert(typeof campaignVersion === "string" && campaignVersion.length > 0, "auditor campaign version is required");
  return `${words(phaseId.replace(/^RAPID_/u, ""))} Auditor ${campaignVersion}`;
}
