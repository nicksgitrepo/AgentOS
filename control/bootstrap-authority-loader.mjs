#!/usr/bin/env node

/*
 * Earliest-process authority loader. This module runs in a fresh Node process
 * with a scrubbed environment. It returns verified bytes, never a caller path.
 */

import {createHash} from "node:crypto";
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const BINDING_RELATIVE_PATH = "schemas/bootstrap-binding.v1.json";

function fail(message, code = "BOOTSTRAP_AUTHORITY_LOADER_INVALID") {
  const error = new Error(message); error.code = code; throw error;
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function safeFile(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || isAbsolute(relativePath) || relativePath.split(/[\\/]/u).some((part) => part === "" || part === "..")) fail("authority path is unsafe");
  const target = resolve(ROOT, relativePath);
  if (!target.startsWith(`${ROOT}${sep}`)) fail("authority path escaped installed root");
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync.native(target) !== target) fail("authority artifact is not a real regular file");
  return target;
}
function load() {
  const bindingBytes = readFileSync(safeFile(BINDING_RELATIVE_PATH));
  const binding = JSON.parse(bindingBytes.toString("utf8"));
  if (binding.schema !== "agentos.governance_2_1rc_bootstrap_binding.v2" || binding.version !== 2) fail("bootstrap binding identity differs");
  const entries = new Map();
  for (const section of ["normative", "compatibility_only"]) for (const [id, record] of Object.entries(binding[section] ?? {})) {
    if (!record?.path) continue;
    if (entries.has(id) || !/^[0-9a-f]{64}$/u.test(record.sha256)) fail(`invalid bootstrap binding ${id}`);
    const bytes = readFileSync(safeFile(record.path));
    if (sha256(bytes) !== record.sha256) fail(`bootstrap binding drift: ${id}`, "BOOTSTRAP_AUTHORITY_BINDING_DRIFT");
    entries.set(id, {binding_id: id, path: record.path, sha256: record.sha256});
  }
  const own = entries.get("bootstrap_authority_loader_controller");
  if (!own || own.path !== "control/bootstrap-authority-loader.mjs" || sha256(readFileSync(fileURLToPath(import.meta.url))) !== own.sha256) fail("authority loader is not pinned by bootstrap binding", "BOOTSTRAP_AUTHORITY_LOADER_UNPINNED");
  return {bindingBytes, binding, entries};
}

if (process.execArgv.some((arg) => /(?:--loader|--import|--require|-r(?:$|=))/u.test(arg)) || process.env.NODE_OPTIONS) fail("preload/custom loader conditions are forbidden", "BOOTSTRAP_AUTHORITY_RUNTIME_HOOK");
const loaded = load();
const command = process.argv[2] ?? "identity";
let output;
if (command === "identity") {
  const entries = [...loaded.entries.values()];
  output = {schema: "agentos.bootstrap_authority_loader_readback.v1", root: ROOT, binding_sha256: sha256(loaded.bindingBytes), entries, authority_sha256: sha256(Buffer.from(JSON.stringify(entries)))};
} else if (command === "read") {
  const entry = loaded.entries.get(process.argv[3]);
  if (!entry) fail("unknown authority binding");
  const bytes = readFileSync(safeFile(entry.path));
  output = {schema: "agentos.bootstrap_authority_artifact.v1", ...entry, bytes_base64: bytes.toString("base64")};
} else fail("unknown authority loader command");
process.stdout.write(`${JSON.stringify(output)}\n`);
