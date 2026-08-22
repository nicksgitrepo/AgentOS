#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

function gitRoot() {
  return fs.realpathSync.native(execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim());
}

function configuredWorkspaceRoot(repositoryRoot) {
  const configured = process.env.AGENTOS_PROJECTS_ROOT;
  if (configured) return fs.realpathSync.native(path.resolve(configured));
  let current = repositoryRoot;
  while (true) {
    if (path.basename(current) === "Projects") return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function descendants(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, {withFileTypes: true}).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? descendants(root, path.relative(root, child)) : [child];
  });
}

const repositoryRoot = gitRoot();
const workspaceRoot = configuredWorkspaceRoot(repositoryRoot);
assert(workspaceRoot, "active checkout is not under a configured Projects workspace root");
const relative = path.relative(workspaceRoot, repositoryRoot);
assert(!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`), "task checkout escaped the configured Projects workspace root");

const files = [
  ...descendants(repositoryRoot, "control").filter((file) => /industrial-3d/u.test(path.basename(file))),
  ...descendants(repositoryRoot, "schemas").filter((file) => /industrial-3d/u.test(path.basename(file))),
  ...descendants(repositoryRoot, "specialist-blocks/wave-06/industrial-3d"),
];
const personalPathLiteral = /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Z]:[\\/]Users[\\/][A-Za-z0-9._-]+)/u;
const violations = files.flatMap((file) => {
  const text = fs.readFileSync(file, "utf8");
  return personalPathLiteral.test(text) || /nicholaspacheco/u.test(text) ? [path.relative(repositoryRoot, file)] : [];
});
assert.deepEqual(violations, [], `portable package surface contains user-specific path literals: ${violations.join(", ")}`);

const trackedRoster = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "specialist-blocks/registry/agent-roster.v1.json"), "utf8"));
const compilerProbe = `
  const {compileReusableAgentRoster} = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "control/reusable-agent-roster-compiler.mjs")).href)});
  const roster = compileReusableAgentRoster({repositoryRoot: process.env.AGENTOS_REPOSITORY_ROOT, writeGenerated: false});
  process.stdout.write(roster.roster_sha256);
`;
const compiledRosterSha = execFileSync(process.execPath, ["--input-type=module", "-e", compilerProbe], {cwd: workspaceRoot, env: {...process.env, AGENTOS_REPOSITORY_ROOT: repositoryRoot}, encoding: "utf8"}).trim();
assert.equal(compiledRosterSha, trackedRoster.roster_sha256, "shared roster compiler projection diverges when invoked from the Projects workspace root");

console.log(`PASS Industrial 3D portability: checkout is a descendant of the runtime-resolved Projects root; package surface contains no user/home path literal; shared roster compiler projection is portable (${files.length} files checked)`);
