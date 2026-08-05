import crypto from "node:crypto";

function compareKeys(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareKeys).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function digestWithout(value, field) {
  return sha256({...value, [field]: null});
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function sortedUniqueStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid string`);
  const sorted = [...value].sort(compareKeys);
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
  assert(JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted`);
  return value;
}

