import { createHash, createHmac } from "node:crypto";
import { MemoryError, invariant } from "./errors.mjs";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function assertString(value, path) {
  invariant(value.normalize("NFC") === value, "NON_CANONICAL_UNICODE", `${path} must already be NFC`);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      invariant(i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff,
        "INVALID_UNICODE", `${path} contains an unpaired high surrogate`);
      i += 1;
    } else {
      invariant(code < 0xdc00 || code > 0xdfff, "INVALID_UNICODE", `${path} contains an unpaired low surrogate`);
    }
  }
}

function encode(value, path = "$") {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "NON_FINITE_NUMBER", `${path} must be finite`);
    invariant(!Object.is(value, -0), "NEGATIVE_ZERO", `${path} must not be negative zero`);
    invariant(Number.isSafeInteger(value), "UNSAFE_NUMBER", `${path} must be a safe integer`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    invariant(prototype === Object.prototype || prototype === null, "UNSUPPORTED_OBJECT", `${path} must be a plain object`);
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => {
      assertString(key, `${path} key`);
      invariant(value[key] !== undefined, "UNDEFINED_VALUE", `${path}.${key} must not be undefined`);
      return `${JSON.stringify(key)}:${encode(value[key], `${path}.${key}`)}`;
    }).join(",")}}`;
  }
  throw new MemoryError("UNSUPPORTED_VALUE", `${path} contains unsupported type ${typeof value}`);
}

export function canonicalJson(value) {
  return encode(value);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}

export function base32(bytes) {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(accumulator << (5 - bits)) & 31];
  return output;
}

export function sha256Ref(domain, bytes) {
  assertString(domain, "domain");
  return `sha256:${base32(sha256(Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), bytes])))}`;
}

export function projectObjectRef(projectId, addressKey, bytes) {
  assertString(projectId, "projectId");
  invariant(Buffer.isBuffer(addressKey) && addressKey.length === 32, "INVALID_ADDRESS_KEY", "address key must be 32 bytes");
  const digest = createHmac("sha256", addressKey)
    .update("agentos.memory.object.v1\0", "utf8")
    .update(projectId, "utf8")
    .update("\0", "utf8")
    .update(bytes)
    .digest();
  return `obj_${base32(digest)}`;
}
