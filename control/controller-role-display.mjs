#!/usr/bin/env node

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const AGENTOS_CONTROLLER_ROLE = "AGENTOS_CONTROLLER";
export const AGENTOS_CONTROLLER_DISPLAY_NAME = "Intent Regulator";
export const LEGACY_CONTROLLER_DISPLAY_NAMES = Object.freeze(["AgentOS Controller"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

export function controllerDisplayTitle(taskId) {
  requireString(taskId, "Controller task ID");
  assert(IDENTIFIER.test(taskId), "Controller task ID is not a stable identifier");
  return `${AGENTOS_CONTROLLER_DISPLAY_NAME} — ${taskId}`;
}

export function validateControllerRoleDisplay({controllerRole, controllerDisplayName, displayTitle = null}, {taskId = null, label = "Controller role display"} = {}) {
  assert(controllerRole === AGENTOS_CONTROLLER_ROLE, `${label} must use AGENTOS_CONTROLLER`);
  assert(controllerDisplayName === AGENTOS_CONTROLLER_DISPLAY_NAME || LEGACY_CONTROLLER_DISPLAY_NAMES.includes(controllerDisplayName), `${label} must use Intent Regulator`);
  if (displayTitle !== null) {
    requireString(displayTitle, `${label} title`);
    assert(!displayTitle.includes("Bootstrap"), `${label} must not present Bootstrap as the ongoing role`);
    if (taskId !== null) assert(displayTitle === controllerDisplayTitle(taskId), `${label} title does not match the Controller task`);
    else assert(displayTitle.startsWith(`${AGENTOS_CONTROLLER_DISPLAY_NAME} — `) || LEGACY_CONTROLLER_DISPLAY_NAMES.some((name) => displayTitle.startsWith(`${name} — `)), `${label} title does not identify Intent Regulator`);
  }
  return {controllerRole, controllerDisplayName, ...(displayTitle === null ? {} : {displayTitle})};
}

export function compileControllerRoleDisplay({taskId = null, displayTitle = null} = {}) {
  const result = {
    controllerRole: AGENTOS_CONTROLLER_ROLE,
    controllerDisplayName: AGENTOS_CONTROLLER_DISPLAY_NAME,
  };
  if (taskId !== null) result.displayTitle = controllerDisplayTitle(taskId);
  else if (displayTitle !== null) result.displayTitle = displayTitle;
  return validateControllerRoleDisplay(result, {taskId});
}
