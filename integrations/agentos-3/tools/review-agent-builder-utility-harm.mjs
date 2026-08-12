import { createHash } from "node:crypto";
import { compileGovernanceCandidate, denySideEffect, validateCandidateFixtures } from "../agent-builder-adapter.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const base = () => ({
  role_id: "role.rust-backend-ai-search-builder",
  role_name: "Rust Backend AI Search Builder",
  purpose: "Compile a bounded governance context candidate for a synthetic target task",
  scope: { include: ["ai-search", "backend", "rust"], exclude: ["deployment", "production-write"] },
  source_refs: ["source:nist-ai-rmf-1.0", "source:rust-style-guide"],
  budget: { max_tokens: 2400, projected_tokens: 980 },
  version: "1.0.0",
  unknown_fields: [], contradictions: [], omissions: [], stale_source: false,
});

const cases = [
  ["focused_context_utility", "PASS", (value) => compileGovernanceCandidate(value)],
  ["deterministic_projection", "PASS", (value) => JSON.stringify(compileGovernanceCandidate(value)) === JSON.stringify(compileGovernanceCandidate(structuredClone(value))) || (() => { throw new Error("NONDETERMINISTIC"); })()],
  ["unknown_context_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, unknown_fields: ["jurisdiction"] })],
  ["contradiction_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, contradictions: ["write and read-only"] })],
  ["omission_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, omissions: ["rollback"] })],
  ["stale_source_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, stale_source: true })],
  ["overstuffed_context_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, budget: { max_tokens: 2400, projected_tokens: 2401 } })],
  ["mismatched_scope_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, scope: { include: ["rust"], exclude: ["rust"] } })],
  ["duplicate_provenance_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, source_refs: [value.source_refs[0], value.source_refs[0]] })],
  ["malformed_digest_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, source_refs: ["sha256:not-a-digest"] })],
  ["semver_ambiguity_denial", "DENY", (value) => compileGovernanceCandidate({ ...value, version: "01.0.0" })],
  ["authority_effect_non_grant", "PASS", (value) => { const result = compileGovernanceCandidate(value); if (result.authority_effect_grants.length || result.admission !== "NOT_ADMITTED" || result.activation !== "NOT_ACTIVATED") throw new Error("AUTHORITY_GAIN"); return result; }],
  ["capability_lease_external", "PASS", (value) => { const result = compileGovernanceCandidate(value); if (result.activation_package.capability_lease !== "EXTERNAL_TYPED_LEASE_REQUIRED") throw new Error("LEASE_GAIN"); return result; }],
  ["side_effect_denial", "DENY", () => denySideEffect("synthetic-deploy")],
];

export function reviewAgentBuilderUtilityHarm() {
  const staticProof = validateCandidateFixtures();
  const results = cases.map(([case_id, expected, run]) => {
    let observed = "PASS";
    let error = null;
    try { run(base()); } catch (caught) { observed = "DENY"; error = String(caught.message); }
    if (observed !== expected) throw new Error(`AGENT_BUILDER_INDEPENDENT_REVIEW_FAILED:${case_id}:${expected}:${observed}`);
    return { case_id, expected, observed, error_class: error?.split(":")[0] ?? null };
  });
  const candidateReceipt = JSON.parse(readFileSync(join(ROOT, "contracts", "agent-builder-candidate-receipt.json"), "utf8"));
  const body = {
    schema: "agentos.agent_builder_independent_utility_harm_clearance.v1",
    version: 1,
    candidate_sha256: candidateReceipt.current_state_sha256,
    reviewer: { reviewer_id: "agentos.release-independent-agent-builder-reviewer", role: "INDEPENDENT_RELEASE_AUDITOR", separate_from_author: true },
    authority: "READ_ONLY_INDEPENDENT_REVIEW;_NO_ADMISSION_ACTIVATION_DEPLOYMENT_OR_RELEASE_AUTHORITY",
    status: "PASS_FOR_INACTIVE_TEST_BUILD_INTAKE",
    static_task_ir: staticProof.task_ir.match(/RESULT PASS 7\/7/u) ? "PASS_7_OF_7" : "FAIL",
    static_context_blocks: staticProof.context_blocks.match(/RESULT PASS 13\/13/u) ? "PASS_13_OF_13" : "FAIL",
    cases_reviewed: results.length,
    pass_verdicts: results.filter((item) => item.observed === "PASS").length,
    deny_verdicts: results.filter((item) => item.observed === "DENY").length,
    cases_sha256: digest(results),
    evidence_ceiling: "DETERMINISTIC_COMPILER_UTILITY_AND_HARM;_NO_MODEL_QUALITY_DOMAIN_CERTIFICATION_OR_RUNTIME_ACTIVATION_CLAIM",
    residuals: ["Provider/model quality evaluation remains activation-time work.", "Admission, activation, deployment, migration, publication, and release promotion remain OFF."],
  };
  return { ...body, clearance_sha256: digest(body) };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(reviewAgentBuilderUtilityHarm(), null, 2)}\n`);
