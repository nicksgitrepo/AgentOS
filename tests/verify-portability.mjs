#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  applyCorpusPlan,
  canonicalCompactJson,
  compileCorpusPlan,
  validateCorpusInputs,
} from "../control/authority-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    // Runtime evidence is project context; portability inventories the kernel only.
    if (entry.name === ".git" || entry.name === "tmp") continue;
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      fail(`symbolic link exists in candidate: ${path.relative(root, absolute)}`);
    } else if (stat.isDirectory()) {
      result.push(...listFiles(absolute));
    } else if (stat.isFile()) {
      result.push(absolute);
    } else {
      fail(`unsupported candidate filesystem entry: ${path.relative(root, absolute)}`);
    }
  }
  return result;
}

function collectBoundPaths(value, output = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && (key === "path" || key.endsWith("_path"))) {
      output.push(child);
    }
    collectBoundPaths(child, output);
  }
  return output;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function expectRejected(action, message) {
  try {
    action();
    fail(message);
  } catch {
    // Expected hostile state.
  }
}

function bindPortableDigest(value) {
  const body = structuredClone(value.portable_template_instance);
  delete body.project_identity.exact_context_digest;
  value.portable_template_instance.project_identity.exact_context_digest = sha256(canonicalCompactJson(body));
  return value;
}

function canonicalPretty(value) {
  return `${JSON.stringify(JSON.parse(canonicalCompactJson(value)), null, 2)}\n`;
}

const files = listFiles(root);
const historicalCompatibility = readJson("docs/portability-historical-compatibility.v1.json");
const historicalCompatibilityBody = structuredClone(historicalCompatibility);
delete historicalCompatibilityBody.digest;
if (historicalCompatibility.status !== "PRESERVED_APPEND_ONLY_CUSTODY_EVIDENCE"
    || historicalCompatibility.selector_mode
      !== "PORTABLE_KERNEL_EXCLUDES_PROJECT_LOCAL_CUSTODY_RECORDS"
    || !Array.isArray(historicalCompatibility.records)
    || historicalCompatibility.records.length !== 18) {
  fail("historical compatibility selector is incomplete");
}
if (historicalCompatibility.digest !== sha256(canonicalCompactJson(historicalCompatibilityBody))) {
  fail("historical compatibility selector digest mismatch");
}
const projectLocalEvidencePaths = new Set();
for (const record of historicalCompatibility.records ?? []) {
  const relative = record.path;
  if (typeof relative !== "string" || path.isAbsolute(relative)
      || relative.includes("\\")
      || relative.split("/").some((segment) => segment === ".." || segment === "")) {
    fail(`unsafe historical compatibility path: ${relative}`);
    continue;
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    fail(`historical compatibility path is not a regular file: ${relative}`);
    continue;
  }
  if (sha256(fs.readFileSync(absolute)) !== record.sha256) {
    fail(`historical compatibility digest mismatch: ${relative}`);
  }
  if (record.current_portable_kernel_input !== false
      || !["HISTORICAL_NON_NORMATIVE_CUSTODY_EVIDENCE", "PROJECT_LOCAL_CUSTODY_RECORD_NOT_PORTABLE_KERNEL"]
        .includes(record.classification)
      || record.replacement_ref !== "typed-project-agnostic-portable-kernel-contracts") {
    fail(`historical compatibility record is not explicitly excluded: ${relative}`);
  }
  projectLocalEvidencePaths.add(relative);
}
const privacyProjection = readJson("docs/privacy-public-projection.v1.json");
if (privacyProjection.selector_mode !== "NORMATIVE_PUBLIC_OBJECTS_PLUS_OPAQUE_PRIVATE_DIGESTS") {
  fail("portability privacy selector is not bound to normative objects plus opaque private digests");
}
const privateRecordDigests = new Set([
  ...(privacyProjection.private_records ?? []).map((record) => record.record_digest_sha256),
  ...(privacyProjection.retained_payload_digest_extensions ?? []),
]);
for (const absolute of files.filter((entry) => entry.endsWith(".json"))) {
  try {
    JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${path.relative(root, absolute)} (${error.message})`);
  }
}
for (const absolute of files.filter((entry) => entry.endsWith(".mjs"))) {
  const checked = spawnSync(process.execPath, ["--check", absolute], {
    cwd: root,
    encoding: "utf8",
  });
  if (checked.status !== 0) {
    fail(`invalid JavaScript: ${path.relative(root, absolute)}: ${checked.stderr.trim()}`);
  }
}

const forbiddenProjectIdentityFixture = ["private", "-", "consumer"].join("");
const forbiddenAbsolutePath = ["/", "Users", "/"].join("");
const forbiddenRepositoryOwner = ["nicks", "git", "repo"].join("");
const forbiddenStrings = [
  forbiddenProjectIdentityFixture,
  forbiddenAbsolutePath,
  forbiddenRepositoryOwner,
];
const credentialUrl = /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu;
const accessKey = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u;
const tokenValue = /\b(?:ghp|github_pat|sk|rk)[_-][A-Za-z0-9_-]{20,}\b/u;
const taskUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const absoluteHostPath = new RegExp(`${["/", "private", "/"].join("")}(?:tmp|var|home|root|opt|Volumes)/`, "u");
const localOrPrivateUrl = new RegExp(`${["https", "://"].join("")}(?:localhost|127\\.0\\.0\\.1|[A-Za-z0-9.-]+\\.(?:internal|local|corp|private))(?:[/:?#]|$)`, "iu");
const cloudResource = new RegExp(`(?:${["arn", ":", "aws", ":"].join("")}|${["i", "-"].join("")}[0-9a-f]{8,}|${["ocid1", "\\."].join("")})`, "iu");
const numericBinding = /\b(?:account|subscription|project|tenant|deployment|resource)(?:[_-]?id)?\s*[:=]\s*["']?\d{8,}/iu;
const personalAbsolutePath = new RegExp([
  `${["/", "Users", "/"].join("")}[A-Za-z0-9._-]+(?:/|$)`,
  `${["/", "home", "/"].join("")}[A-Za-z0-9._-]+(?:/|$)`,
  `${["C:", "\\\\", "Users", "\\\\"].join("")}[A-Za-z0-9._-]+(?:\\\\|$)`,
].join("|"), "u");
const portableSurface = /^(?:control|schemas|governance|bootstrap|templates|specialist-blocks)\//u;
for (const absolute of files) {
  const text = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(root, absolute);
  if (projectLocalEvidencePaths.has(relative)) continue;
  if (privateRecordDigests.has(sha256(text))) continue;
  for (const token of forbiddenStrings) {
    if (text.includes(token)) fail(`forbidden product identity in ${relative}`);
  }
  if (credentialUrl.test(text)) fail(`credential-bearing URL in ${relative}`);
  if (accessKey.test(text)) fail(`cloud access key shape in ${relative}`);
  if (tokenValue.test(text)) fail(`API token shape in ${relative}`);
  if (taskUuid.test(text)) fail(`task/session UUID in ${relative}`);
  if (absoluteHostPath.test(text)) fail(`host-specific absolute path in ${relative}`);
  if (portableSurface.test(relative) && personalAbsolutePath.test(text)) fail(`personal absolute path in portable surface ${relative}`);
  if (localOrPrivateUrl.test(text)) fail(`private or local URL in ${relative}`);
  if (cloudResource.test(text)) fail(`cloud resource identity in ${relative}`);
  if (numericBinding.test(text)) fail(`numeric account or deployment identity in ${relative}`);
}

const syntheticPersonalPath = ["/", "Users", "/", "example", "/", "task"].join("");
if (!personalAbsolutePath.test(syntheticPersonalPath)) fail("portability regression does not detect a personal absolute path");
const syntheticPortableSource = `const taskRoot = ${JSON.stringify(syntheticPersonalPath)};`;
if (!personalAbsolutePath.test(syntheticPortableSource)) fail("portability regression does not inspect portable source text");

const binding = readJson("schemas/bootstrap-binding.v1.json");
const boundPaths = collectBoundPaths(binding);
for (const relative of boundPaths) {
  if (path.isAbsolute(relative)
      || relative.includes("\\")
      || relative.split("/").some((segment) => segment === ".." || segment === "")) {
    fail(`unsafe bound path: ${relative}`);
    continue;
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    fail(`bound path is not a regular file: ${relative}`);
  }
}

const context = readJson("examples/project-context-fixture.v1.json");
const workflow = readJson("schemas/capability-and-worktree-registry.v1.json");
if (context.kernel?.override_allowed !== false) {
  fail("project context does not explicitly forbid governance override");
}
const preparedPlan = compileCorpusPlan(context, workflow);
const repeatedPlan = compileCorpusPlan(structuredClone(context), structuredClone(workflow));
if (canonicalCompactJson(preparedPlan) !== canonicalCompactJson(repeatedPlan)
    || preparedPlan.plan_sha256 !== repeatedPlan.plan_sha256) {
  fail("repeated compilation is not deterministic");
}

const importedContext = structuredClone(context);
importedContext.portable_template_instance.authority.project_context_articles.push(
  "external-source/context.md",
);
expectRejected(
  () => compileCorpusPlan(importedContext, workflow),
  "stale portable context digest was accepted",
);
const reboundImportedContext = bindPortableDigest(importedContext);
const importedPlan = compileCorpusPlan(reboundImportedContext, workflow);
if (canonicalCompactJson(preparedPlan.pages) !== canonicalCompactJson(importedPlan.pages)
    || preparedPlan.context_identity.exact_context_digest
      === importedPlan.context_identity.exact_context_digest) {
  fail("rebound imported project context is not separate from the governed tree plan");
}

const wrapperOnlyContext = structuredClone(context);
wrapperOnlyContext.project_name = "Wrapper Metadata Only";
const wrapperOnlyPlan = compileCorpusPlan(wrapperOnlyContext, workflow);
if (wrapperOnlyPlan.context_identity.exact_context_digest !== preparedPlan.context_identity.exact_context_digest) {
  fail("wrapper metadata changed the portable context identity");
}

const rootEscapeContext = structuredClone(context);
rootEscapeContext.authority_corpus_roots.authority_root = "authority";
rootEscapeContext.portable_template_instance.authority_corpus_roots.authority_root = "authority";
rootEscapeContext.authority_corpus_roots.evidence_library_root = "outside/evidence-library";
rootEscapeContext.portable_template_instance.authority_corpus_roots.evidence_library_root = "outside/evidence-library";
bindPortableDigest(rootEscapeContext);
expectRejected(
  () => compileCorpusPlan(rootEscapeContext, workflow),
  "authority-root escape was accepted",
);

const windowsAbsoluteContext = structuredClone(context);
windowsAbsoluteContext.authority_corpus_roots.authority_root = "C:\\authority";
windowsAbsoluteContext.portable_template_instance.authority_corpus_roots.authority_root = "C:\\authority";
bindPortableDigest(windowsAbsoluteContext);
expectRejected(
  () => compileCorpusPlan(windowsAbsoluteContext, workflow),
  "Windows-style absolute authority root was accepted",
);

const rootOverlapContext = structuredClone(context);
rootOverlapContext.authority_corpus_roots.project_context_root = ".";
rootOverlapContext.portable_template_instance.authority_corpus_roots.project_context_root = ".";
bindPortableDigest(rootOverlapContext);
expectRejected(
  () => compileCorpusPlan(rootOverlapContext, workflow),
  "authority-root equality was accepted as a corpus root",
);

const projectionDriftContext = structuredClone(context);
projectionDriftContext.authority_corpus_roots.features_root = "authority/other-features";
expectRejected(
  () => compileCorpusPlan(projectionDriftContext, workflow),
  "wrapper root projection drift was accepted",
);

const overrideAttempt = structuredClone(context);
overrideAttempt.kernel.override_allowed = true;
expectRejected(
  () => validateCorpusInputs(overrideAttempt, workflow),
  "project-specific context extension overrode portable governance",
);

const staleDigestContext = structuredClone(context);
staleDigestContext.portable_template_instance.project_identity.exact_context_digest = "0".repeat(64);
expectRejected(
  () => compileCorpusPlan(staleDigestContext, workflow),
  "declared portable context digest mismatch was accepted",
);

const workflowEscape = structuredClone(workflow);
workflowEscape.authority_corpus_system.tree_template.project.push("../outside.md");
expectRejected(
  () => compileCorpusPlan(context, workflowEscape),
  "authority workflow page escape was accepted",
);

const authorityWorkflowEscapeContext = structuredClone(context);
authorityWorkflowEscapeContext.authority_corpus_roots.authority_root = "authority";
authorityWorkflowEscapeContext.portable_template_instance.authority_corpus_roots.authority_root = "authority";
authorityWorkflowEscapeContext.authority_corpus_roots.evidence_library_root = "authority/evidence-library";
authorityWorkflowEscapeContext.portable_template_instance.authority_corpus_roots.evidence_library_root = "authority/evidence-library";
bindPortableDigest(authorityWorkflowEscapeContext);
const authorityWorkflowEscape = structuredClone(workflow);
authorityWorkflowEscape.authority_corpus_system.tree_template.project.push("outside.md");
expectRejected(
  () => compileCorpusPlan(authorityWorkflowEscapeContext, authorityWorkflowEscape),
  "authority workflow page outside authority_root was accepted",
);

const emptyProject = structuredClone(context);
emptyProject.project_name = "Synthetic Empty Project";
emptyProject.authority_corpus_activation = "ACTIVATED";
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-empty-project-"));
try {
  const applied = applyCorpusPlan(emptyRoot, emptyProject, workflow);
  const repeatedAppliedPlan = compileCorpusPlan(emptyProject, workflow);
  if (applied.plan.plan_sha256 !== repeatedAppliedPlan.plan_sha256
      || !fs.existsSync(path.join(emptyRoot, emptyProject.authority_corpus_roots.authority_index_path))) {
    fail("empty synthetic project did not receive a deterministic authority corpus");
  }
  for (const page of applied.plan.pages) {
    if (!fs.existsSync(path.join(emptyRoot, page.relative_path))) {
      fail(`empty synthetic project missing page: ${page.relative_path}`);
    }
  }
} finally {
  fs.rmSync(emptyRoot, {recursive: true, force: true});
}

const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-symlink-root-"));
const symlinkExternal = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-symlink-external-"));
try {
  fs.mkdirSync(path.join(symlinkRoot, "authority"), {recursive: true});
  fs.symlinkSync(symlinkExternal, path.join(symlinkRoot, "authority/features"), "dir");
  const activated = structuredClone(emptyProject);
  activated.authority_corpus_entities.feature_ids = ["feature"];
  activated.portable_template_instance.authority_corpus_entities.feature_ids = ["feature"];
  bindPortableDigest(activated);
  let rejected = false;
  try {
    applyCorpusPlan(symlinkRoot, activated, workflow);
  } catch {
    rejected = true;
  }
  if (!rejected) fail("symlinked authority path was accepted");
  if (fs.readdirSync(symlinkExternal).length !== 0) {
    fail("symlinked authority path received writes outside the admitted root");
  }
} finally {
  fs.rmSync(symlinkRoot, {recursive: true, force: true});
  fs.rmSync(symlinkExternal, {recursive: true, force: true});
}

const casRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cas-root-"));
try {
  const first = applyCorpusPlan(casRoot, emptyProject, workflow);
  const indexPath = path.join(casRoot, emptyProject.authority_corpus_roots.authority_index_path);
  const originalIndexBytes = fs.readFileSync(indexPath);
  const replay = applyCorpusPlan(casRoot, emptyProject, workflow);
  if (replay.index_sha256 !== first.index_sha256 || !fs.readFileSync(indexPath).equals(originalIndexBytes)) {
    fail("unchanged authority corpus replay was not an exact no-op");
  }

  const tamperedIndex = structuredClone(first.index);
  tamperedIndex.context_identity.project_name = "Tampered Wrapper";
  fs.writeFileSync(indexPath, canonicalPretty(tamperedIndex));
  expectRejected(
    () => applyCorpusPlan(casRoot, emptyProject, workflow),
    "tampered authority index was silently overwritten without a parent digest",
  );
  fs.writeFileSync(indexPath, originalIndexBytes);

  const metadataPage = first.plan.pages[0];
  const metadataPath = path.join(casRoot, metadataPage.relative_path);
  const originalMetadataBytes = fs.readFileSync(metadataPath);
  fs.writeFileSync(metadataPath, originalMetadataBytes.toString("utf8").replace(
    `page_id: ${metadataPage.page_id}`,
    "page_id: tampered-page-id",
  ));
  expectRejected(
    () => applyCorpusPlan(casRoot, emptyProject, workflow, {expectedParentDigest: first.index_sha256}),
    "page-header/index parity drift was accepted",
  );
  fs.writeFileSync(metadataPath, originalMetadataBytes);

  const changedWorkflow = structuredClone(workflow);
  changedWorkflow.authority_corpus_system.tree_template.project.push(
    "${project_goals_root}/additional-roadmap.md",
  );
  const beforeStaleCas = fs.readFileSync(indexPath);
  expectRejected(
    () => applyCorpusPlan(casRoot, emptyProject, changedWorkflow, {expectedParentDigest: "0".repeat(64)}),
    "stale authority-index CAS parent was accepted",
  );
  if (!fs.readFileSync(indexPath).equals(beforeStaleCas)) fail("stale CAS rejection changed the authority index");
  const replaced = applyCorpusPlan(casRoot, emptyProject, changedWorkflow, {expectedParentDigest: first.index_sha256});
  if (replaced.index_sha256 === first.index_sha256
      || !fs.existsSync(path.join(casRoot, emptyProject.authority_corpus_roots.project_goals_root, "additional-roadmap.md"))) {
    fail("explicit authority-index CAS replacement did not read back the new identity");
  }
} finally {
  fs.rmSync(casRoot, {recursive: true, force: true});
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS AgentOS 2.1rc portability: ${files.length} files scanned; ${boundPaths.length} bound paths; JSON and script syntax verified; deterministic empty-project, portable-context identity, extension-boundary, root containment, CAS, page metadata, and symlink cases passed`);
}
