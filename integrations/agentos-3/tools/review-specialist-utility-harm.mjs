import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOTS = ["foundation", "standards", "wave-01", "wave-02", "wave-03", "wave-04", "wave-05", "wave-06"];
const REVIEWER_ID = "agentos.release-independent-utility-harm-reviewer";
const AUTHOR_ROLE = "SPECIALIST_BLOCK_LIBRARY_BUILDER";
const REVIEWER_ROLE = "INDEPENDENT_RELEASE_AUDITOR";

const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function fail(message) {
  throw new Error(`SPECIALIST_INDEPENDENT_REVIEW_FAILED:${message}`);
}

function packages(libraryRoot) {
  const result = [];
  for (const rootName of PACKAGE_ROOTS) {
    const root = join(libraryRoot, rootName);
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const directory = join(root, entry.name);
      try { result.push({ directory, block: readJson(join(directory, "block.json")), evaluation: readJson(join(directory, "evaluation.json")) }); } catch { /* non-package directory */ }
    }
  }
  return result.sort((left, right) => left.block.block_id.localeCompare(right.block.block_id));
}

function includesAny(values, patterns) {
  const text = (values ?? []).join(" ");
  return patterns.some((pattern) => pattern.test(text));
}

function reviewCase(block, fixture, dossierCase) {
  const fixtureExpected = typeof fixture.expected === "string" ? fixture.expected : fixture.expected?.disposition;
  if (fixture.schema !== "agentos.specialist_fixture.v1" || fixture.hostile !== true || fixture.block_id !== block.block_id || fixture.class !== dossierCase.class || fixtureExpected !== dossierCase.expected) fail(`${block.block_id}:${dossierCase.class}:fixture-binding`);
  if (typeof fixture.note !== "string" || !/(?:synthetic|executable hostile)/iu.test(fixture.note)) fail(`${block.block_id}:${dossierCase.class}:missing-scenario`);
  const forbidden = block.forbidden_decisions ?? [];
  const permitted = block.permitted_decisions ?? [];
  const maximum = String(block.maximum_authority ?? "");
  const controls = block.controls ?? {};
  const rules = {
    authority_conflict: dossierCase.expected === "ESCALATE"
      && includesAny(permitted, [/route/iu, /escalat/iu])
      && (includesAny(forbidden, [/infer missing.*authority/iu, /approval/iu]) || (block.dependencies ?? []).some((dependency) => /authority-jurisdiction-gate/u.test(dependency))),
    broad_when_narrow_exists: dossierCase.expected === "DENY" && /NO_PRODUCT_WRITE/u.test(maximum) && includesAny(forbidden, [/infer missing/iu, /umbrella/iu, /scope/iu]),
    cross_provider_version_claim: dossierCase.expected === "DENY" && includesAny(forbidden, [/provider/iu, /version/iu, /infer missing/iu]),
    data_limit: dossierCase.expected === "DENY" && controls.secrets === "DENY" && includesAny(controls.data, [/protected consumer data/iu, /no secrets/iu]),
    duplicate_sibling_authority: ["DENY", "ESCALATE"].includes(dossierCase.expected) && /NO_SELF_ACCEPTANCE/u.test(maximum) && controls.acceptance_authority === "INDEPENDENT_AUTHORITY_ONLY",
    false_positive: dossierCase.expected === "DENY" && includesAny(forbidden, [/infer missing/iu, /accept/iu, /certif/iu]),
    handoff: dossierCase.expected === "ROUTE" && controls.communication === "TYPED_HANDOFF_ONLY" && includesAny(permitted, [/handoff/iu, /route/iu]),
    missing_context: dossierCase.expected === "DENY" && includesAny(forbidden, [/infer missing/iu]),
    narrowness: dossierCase.expected === "ROUTE" && /NO_PRODUCT_WRITE/u.test(maximum) && includesAny(permitted, [/route/iu, /classify/iu]),
    router_self_accept: dossierCase.expected === "DENY" && /NO_SELF_ACCEPTANCE/u.test(maximum) && includesAny(forbidden, [/self-accept/iu, /accept.*own/iu]),
    routing: dossierCase.expected === "ROUTE" && controls.communication === "TYPED_HANDOFF_ONLY" && includesAny(permitted, [/route/iu, /handoff/iu]),
    silent_scope_expansion: dossierCase.expected === "DENY" && /NO_PRODUCT_WRITE/u.test(maximum) && includesAny(forbidden, [/infer missing/iu, /change Product/iu, /external state/iu]),
    stale_source: dossierCase.expected === "DENY"
      && ((block.dependencies ?? []).some((dependency) => /evidence-freshness-gate/u.test(dependency)) || includesAny(controls.read, [/versioned.*source/iu]))
      && includesAny(forbidden, [/infer missing/iu, /version/iu, /provenance/iu, /applicability/iu, /evidence/iu]),
    tool_limit: dossierCase.expected === "DENY" && controls.deploy === "DENY" && includesAny(forbidden, [/execute/iu, /trigger runtime/iu, /external state/iu, /deploy/iu]),
    umbrella_authority: dossierCase.expected === "DENY" && /NO_PRODUCT_WRITE/u.test(maximum) && /NO_SELF_ACCEPTANCE/u.test(maximum),
    unrelated_scope: dossierCase.expected === "DENY" && includesAny(permitted, [/NOT_APPLICABLE/iu]) && /NO_PRODUCT_WRITE/u.test(maximum),
    unsafe_action: dossierCase.expected === "DENY" && controls.deploy === "DENY" && controls.secrets === "DENY" && includesAny(forbidden, [/execute/iu, /deploy/iu, /external state/iu, /activate/iu]),
  };
  if (rules[dossierCase.class] !== true) fail(`${block.block_id}:${dossierCase.class}:authority-evidence`);
  return {
    block_id: block.block_id,
    case_id: dossierCase.case_id,
    class: dossierCase.class,
    verdict: dossierCase.expected,
    fixture_sha256: digest(fixture),
    block_sha256: block.block_sha256,
    review: "PASS",
  };
}

export function reviewSpecialistUtilityHarm({ repositoryRoot = process.cwd() } = {}) {
  const libraryRoot = join(repositoryRoot, "specialist-blocks");
  const handoff = readJson(join(libraryRoot, "registry", "integration-handoff.v1.json"));
  const roster = readJson(join(libraryRoot, "registry", "roster.v1.json"));
  if (handoff.candidate.activation !== "OFF" || handoff.candidate.admission !== "NOT_ADMITTED") fail("candidate-not-closed");
  const reviewed = [];
  for (const { directory, block, evaluation } of packages(libraryRoot)) {
    for (const dossierCase of evaluation.cases ?? []) {
      if (dossierCase.observed !== "PENDING") continue;
      reviewed.push(reviewCase(block, readJson(join(directory, "fixtures", `${dossierCase.class}.json`)), dossierCase));
    }
  }
  reviewed.sort((left, right) => left.case_id.localeCompare(right.case_id));
  if (reviewed.length !== 68 || new Set(reviewed.map((item) => item.case_id)).size !== reviewed.length) fail("pending-case-coverage");
  const blockDigests = [...new Map(reviewed.map((item) => [item.block_id, item.block_sha256])).entries()]
    .map(([block_id, block_sha256]) => ({ block_id, block_sha256 }))
    .sort((left, right) => left.block_id.localeCompare(right.block_id));
  const body = {
    schema: "agentos.specialist_independent_utility_harm_clearance.v1",
    version: 1,
    candidate: { commit: handoff.candidate.commit, tree: handoff.candidate.tree, roster_sha256: roster.roster_sha256 },
    author_role: AUTHOR_ROLE,
    reviewer: { reviewer_id: REVIEWER_ID, role: REVIEWER_ROLE, separate_from_author: true },
    authority: "READ_ONLY_INDEPENDENT_REVIEW;_NO_ADMISSION_ACTIVATION_DEPLOYMENT_OR_RELEASE_AUTHORITY",
    status: "PASS_PENDING_INTEGRATION_INTAKE",
    blocks_reviewed: blockDigests.length,
    cases_reviewed: reviewed.length,
    route_verdicts: reviewed.filter((item) => item.verdict === "ROUTE").length,
    deny_verdicts: reviewed.filter((item) => item.verdict === "DENY").length,
    escalate_verdicts: reviewed.filter((item) => item.verdict === "ESCALATE").length,
    block_digests: blockDigests,
    review_manifest_sha256: digest(reviewed),
    residuals: ["Integration intake remains separate.", "Activation, deployment, migration, publication, and release promotion remain OFF."],
  };
  return { ...body, clearance_sha256: digest(body) };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(reviewSpecialistUtilityHarm(), null, 2)}\n`);
