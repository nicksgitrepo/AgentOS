import {assert, digestWithout, compareUtf8} from "./canonical-json.mjs";
import {DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, REQUIRED_HOST_ACTIONS, validateHostAdapter} from "./native-session.mjs";

export const HOST_ATTACHMENT_SCHEMA = "agentos.native_host_attachment.v1";
const ID = /^[A-Z][A-Z0-9._-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function stable(value, label) {
  assert(typeof value === "string" && ID.test(value), `${label} is invalid`);
}

export function validateHostAttachment(attachment) {
  exactKeys(attachment, ["schema", "version", "status", "attachment_id", "host_id", "project_id", "environment_id", "capabilities", "model", "reasoning_effort", "attached_at_utc", "digest"], "native host attachment");
  assert(attachment.schema === HOST_ATTACHMENT_SCHEMA && attachment.version === 1 && attachment.status === "BOUND", "native host attachment identity is invalid");
  for (const [value, label] of [[attachment.attachment_id, "attachment_id"], [attachment.host_id, "host_id"], [attachment.project_id, "project_id"], [attachment.environment_id, "environment_id"]]) stable(value, `native host ${label}`);
  assert(Array.isArray(attachment.capabilities) && JSON.stringify(attachment.capabilities) === JSON.stringify([...REQUIRED_HOST_ACTIONS].sort(compareUtf8)), "native host capabilities do not match the required session actions");
  assert(attachment.model === DEFAULT_MODEL && attachment.reasoning_effort === DEFAULT_REASONING_EFFORT, "native host model defaults are invalid");
  assert(typeof attachment.attached_at_utc === "string" && UTC.test(attachment.attached_at_utc) && Number.isFinite(Date.parse(attachment.attached_at_utc)), "native host attached_at_utc is invalid");
  assert(/^[0-9a-f]{64}$/u.test(attachment.digest) && attachment.digest === digestWithout(attachment, "digest"), "native host attachment digest does not match content");
  return attachment;
}

export function compileHostAttachment({attachment_id, host_id, project_id, environment_id, attached_at_utc}) {
  const attachment = {
    schema: HOST_ATTACHMENT_SCHEMA,
    version: 1,
    status: "BOUND",
    attachment_id,
    host_id,
    project_id,
    environment_id,
    capabilities: [...REQUIRED_HOST_ACTIONS].sort(compareUtf8),
    model: DEFAULT_MODEL,
    reasoning_effort: DEFAULT_REASONING_EFFORT,
    attached_at_utc,
    digest: null,
  };
  attachment.digest = digestWithout(attachment, "digest");
  return validateHostAttachment(attachment);
}

export function bindNativeHost(host, attachment) {
  validateHostAttachment(attachment);
  validateHostAdapter(host);
  const context = {attachment_id: attachment.attachment_id, host_id: attachment.host_id, project_id: attachment.project_id, environment_id: attachment.environment_id};
  const bound = {};
  for (const action of REQUIRED_HOST_ACTIONS) {
    bound[action] = async (payload = {}) => {
      assert(payload && typeof payload === "object" && !Array.isArray(payload), `${action} payload must be an object`);
      const identity = payload.identity && typeof payload.identity === "object" ? payload.identity : payload;
      if (identity.project_id !== undefined) assert(identity.project_id === attachment.project_id, `${action} payload project differs from host attachment`);
      if (identity.environment_id !== undefined) assert(identity.environment_id === attachment.environment_id, `${action} payload environment differs from host attachment`);
      if (payload.host_attachment !== undefined) assert(JSON.stringify(payload.host_attachment) === JSON.stringify(context), `${action} payload host attachment differs`);
      return host[action]({...payload, host_attachment: context});
    };
  }
  return Object.freeze(bound);
}
