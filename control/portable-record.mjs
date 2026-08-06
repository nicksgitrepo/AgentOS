import {assert} from "./canonical-json.mjs";

const RAW_PATH_KEYS = new Set([
  "release_root", "projects_root", "project_root", "control_root", "projects_path", "control_path",
  "worktrees_root", "workspace_path", "git_top_level", "cwd", "working_directory", "home_directory",
]);
const SECRET_KEY = /(?:^|_)(?:secret|password|token|credential|api_key|private_key|access_key)(?:$|_)/iu;
const SECRET_VALUE = /(?:-----BEGIN|Bearer\s+[A-Za-z0-9._-]+|(?:sk|gh[opsu]|xox[baprs])-|(?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*\S+)/iu;

function isRawPath(value) {
  const slash = String.fromCharCode(47);
  const backslash = String.fromCharCode(92);
  const embeddedMarkers = [
    `${slash}Users`, `${slash}home`, `${slash}private`, `${slash}var`, `${slash}tmp`,
    `${backslash}Users`, `${backslash}home`, `${backslash}${backslash}`,
  ];
  return embeddedMarkers.some((marker) => value.includes(marker))
    || value.startsWith(slash)
    || value.startsWith(`~${slash}`)
    || value.startsWith(`..${slash}`)
    || (/^[A-Za-z]:/u.test(value) && (value[2] === slash || value[2] === backslash))
    || value.startsWith(`${backslash}${backslash}`);
}

function walk(value, label, secretValues, seen) {
  if (typeof value === "string") {
    assert(!isRawPath(value), `${label} contains a raw path`);
    assert(!SECRET_VALUE.test(value), `${label} contains a secret-like value`);
    assert(!secretValues.some((secret) => secret && value.includes(secret)), `${label} contains a runtime secret`);
    return;
  }
  if (!value || typeof value !== "object") return;
  assert(!seen.has(value), `${label} contains a cyclic record`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${label}[${index}]`, secretValues, seen));
  else for (const [key, child] of Object.entries(value)) {
    assert(!RAW_PATH_KEYS.has(key), `${label}.${key} is a raw path field; use an external environment reference`);
    assert(!SECRET_KEY.test(key), `${label}.${key} is a secret field; keep it outside persisted data`);
    walk(child, `${label}.${key}`, secretValues, seen);
  }
  seen.delete(value);
}

/**
 * Records crossing a repository or control-plane persistence boundary may
 * contain opaque references and digests, but never runtime paths or secrets.
 */
export function assertPortableRecord(record, label = "portable record", {secretValues = []} = {}) {
  assert(record && typeof record === "object" && !Array.isArray(record), `${label} must be an object`);
  walk(record, label, secretValues, new Set());
  return record;
}

export function isPortableRecord(record, options = {}) {
  try {
    assertPortableRecord(record, "portable record", options);
    return true;
  } catch {
    return false;
  }
}
