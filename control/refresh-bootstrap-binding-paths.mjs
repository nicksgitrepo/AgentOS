#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingPath = path.join(ROOT, "schemas/bootstrap-binding.v1.json");
const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
const requested = [...new Set(process.argv.slice(2))].sort();
if (requested.length === 0) throw new Error("usage: refresh-bootstrap-binding-paths <relative-path> [...]");

const index = new Map();
for (const sectionName of ["normative", "compatibility_only"]) {
  for (const [id, record] of Object.entries(binding[sectionName] ?? {})) {
    if (record && typeof record === "object" && typeof record.path === "string" && typeof record.sha256 === "string") {
      const list = index.get(record.path) ?? [];
      list.push({sectionName, id, record});
      index.set(record.path, list);
    }
  }
}

for (const relativePath of requested) {
  if (path.isAbsolute(relativePath) || relativePath.includes("..")) throw new Error(`unsafe binding path: ${relativePath}`);
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`binding source is not a file: ${relativePath}`);
  const records = index.get(relativePath);
  if (!records?.length) {
    console.log(`UNBOUND ${relativePath}`);
    continue;
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
  for (const {sectionName, id, record} of records) {
    record.sha256 = digest;
    console.log(`UPDATED ${sectionName}.${id} ${relativePath} ${digest}`);
  }
}

fs.writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
