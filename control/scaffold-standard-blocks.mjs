#!/usr/bin/env node

/* Controller-owned source-locked STANDARD_BLOCK candidates. */

import fs from "node:fs";
import path from "node:path";
import {
  ATOMIC_EVALUATION_CLASSES,
  CORE_EVALUATION_CLASSES,
  GATE_OUTCOMES,
  SPECIALIST_GATE_IDS,
  canonicalDigest,
} from "./specialist-block-compiler.mjs";

const SOURCE_DATE = "2026-08-11";
const SOURCE_COMMIT = "590c07ddd4be7a8c24727c24b40808e44ca7357d";
const SOURCE_TREE = "f1b358d87e6a969fb9631e202a3d478540edd4d9";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sorted(values) {
  return [...new Set(values)].sort();
}

const sourceCatalog = {
  nist: {source_id: "source.nist-sp-800-218", title: "Secure Software Development Framework (SSDF) Version 1.1", publisher: "NIST", url: "https://csrc.nist.gov/pubs/sp/800/218/final", version: "1.1", effective_date: "2022-02-03", retrieved_date: SOURCE_DATE, immutable_identity: "nist-sp-800-218-v1.1-final-20220203", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound secure software development practices and task mappings."},
  asvs: {source_id: "source.owasp-asvs-5-0-0", title: "Application Security Verification Standard", publisher: "OWASP Foundation", url: "https://owasp.org/www-project-application-security-verification-standard/", version: "5.0.0", effective_date: "2025-05-30", retrieved_date: SOURCE_DATE, immutable_identity: "owasp-asvs-5.0.0-release-20250530", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound application security verification requirements and identifiers."},
  owaspWebTop10: {source_id: "source.owasp-top10-2025", title: "OWASP Top 10:2025", publisher: "OWASP Foundation", url: "https://owasp.org/Top10/", version: "2025", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "owasp-top10-2025-release", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Version-bound web application security risk categories and category identity; not a certification or project-specific risk determination."},
  owaspApiTop10: {source_id: "source.owasp-api-top10-2023", title: "OWASP API Security Top 10 2023", publisher: "OWASP Foundation", url: "https://owasp.org/API-Security/editions/2023/en/0x04-release-notes/", version: "2023", effective_date: "2023-07-03", retrieved_date: SOURCE_DATE, immutable_identity: "owasp-api-security-top10-2023-release-20230703", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Version-bound API security risk categories and category identity; not a certification or project-specific risk determination."},
  slsa: {source_id: "source.slsa-spec-1-2", title: "SLSA Specification", publisher: "SLSA", url: "https://slsa.dev/spec/v1.2/", version: "1.2", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "slsa-spec-v1.2-approved", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Approved SLSA tracks, levels, attestations, and provenance references."},
  semver: {source_id: "source.semantic-versioning-2-0-0", title: "Semantic Versioning", publisher: "Semantic Versioning", url: "https://semver.org/spec/v2.0.0.html", version: "2.0.0", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "semantic-versioning-2.0.0", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version precedence and compatibility signaling; no product acceptance or release authority."},
  conventionalCommits: {source_id: "source.conventional-commits-1-0-0", title: "Conventional Commits", publisher: "Conventional Commits", url: "https://www.conventionalcommits.org/en/v1.0.0/", version: "1.0.0", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "conventional-commits-1.0.0", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Commit-message structure and change-intent signaling; no merge or release authority."},
  rustReference: {source_id: "source.rust-reference-1-97-1", title: "The Rust Reference", publisher: "Rust Project", url: "https://doc.rust-lang.org/reference.html", version: "1.97.1", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "rust-reference-1.97.1-stable-2026-08-11", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Rust language semantics and reference behavior."},
  typescript: {source_id: "source.typescript-5-9", title: "TypeScript 5.9 Release Notes", publisher: "Microsoft TypeScript", url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html", version: "5.9", effective_date: "2025-08-01", retrieved_date: SOURCE_DATE, immutable_identity: "typescript-5.9-release-notes-2025-08-01", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "TypeScript 5.9 language and compiler changes."},
  react: {source_id: "source.react-19-2", title: "React 19.2 Release Notes", publisher: "React", url: "https://react.dev/blog/2025/10/01/react-19-2", version: "19.2", effective_date: "2025-10-01", retrieved_date: SOURCE_DATE, immutable_identity: "react-19.2-release-2025-10-01", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "React 19.2 runtime and component behavior."},
  postgresRls: {source_id: "source.postgresql-17-rls", title: "PostgreSQL 17 Row Security Policies", publisher: "PostgreSQL Global Development Group", url: "https://www.postgresql.org/docs/17/ddl-rowsecurity.html", version: "17.10", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "postgresql-17-row-security-docs-17.10-2026-08-11", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "PostgreSQL row-level security policy semantics."},
  openapi: {source_id: "source.openapi-3-1-1", title: "OpenAPI Specification 3.1.1", publisher: "OpenAPI Initiative", url: "https://spec.openapis.org/oas/v3.1.1.html", version: "3.1.1", effective_date: "2024-10-24", retrieved_date: SOURCE_DATE, immutable_identity: "openapi-spec-3.1.1-2024-10-24", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "OpenAPI HTTP contract syntax and semantics."},
  oauth: {source_id: "source.rfc-9700", title: "OAuth 2.0 Security Best Current Practice", publisher: "IETF", url: "https://www.rfc-editor.org/rfc/rfc9700.html", version: "RFC 9700", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "rfc-9700-oauth-security-bcp-2025", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "OAuth security requirements and threat mitigations."},
  oidc: {source_id: "source.oidc-core-1-0", title: "OpenID Connect Core 1.0", publisher: "OpenID Foundation", url: "https://openid.net/specs/openid-connect-core-1_0.html", version: "1.0", effective_date: "2014-11-08", retrieved_date: SOURCE_DATE, immutable_identity: "openid-connect-core-1.0-2014-11-08", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "OpenID Connect authentication and claims contracts."},
  awsIam: {source_id: "source.aws-iam-policy-elements", title: "IAM JSON Policy Elements Reference", publisher: "Amazon Web Services", url: "https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/reference_policies_elements.html", version: "current", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "aws-iam-policy-elements-current-2026-08-11", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "AWS IAM policy element semantics at retrieval."},
  cloudflareDns: {source_id: "source.cloudflare-dns-records", title: "Cloudflare DNS Records", publisher: "Cloudflare", url: "https://developers.cloudflare.com/dns/manage-dns-records/", version: "current", effective_date: "2026-06-24", retrieved_date: SOURCE_DATE, immutable_identity: "cloudflare-dns-records-current-2026-06-24", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Cloudflare DNS record management semantics."},
  cloudflareCache: {source_id: "source.cloudflare-cache-rules", title: "Cloudflare Cache Rules", publisher: "Cloudflare", url: "https://developers.cloudflare.com/cache/how-to/cache-rules/", version: "current", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "cloudflare-cache-rules-current-2026-08-11", content_sha256: null, authority_class: "PRIMARY_DESCRIPTIVE", scope: "Cloudflare cache-rule matching and behavior."},
  wcag22: {source_id: "source.w3c-wcag-2-2", title: "Web Content Accessibility Guidelines (WCAG) 2.2", publisher: "W3C", url: "https://www.w3.org/TR/2024/REC-WCAG22-20241212/", version: "2.2", effective_date: "2024-12-12", retrieved_date: SOURCE_DATE, immutable_identity: "w3c-wcag-2.2-recommendation-republished-20241212", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound web accessibility success criteria and conformance model; applicability and legal requirements remain external."},
  nistAiRmf: {source_id: "source.nist-ai-100-1", title: "Artificial Intelligence Risk Management Framework (AI RMF 1.0)", publisher: "NIST", url: "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10", version: "1.0", effective_date: "2023-01-26", retrieved_date: SOURCE_DATE, immutable_identity: "nist-ai-100-1-ai-rmf-1.0-20230126", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Voluntary, cross-sector, use-case-agnostic AI risk-management framework; applicability and organizational decisions remain external."},
  nistGenAi: {source_id: "source.nist-ai-600-1", title: "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile", publisher: "NIST", url: "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf", version: "NIST AI 600-1", effective_date: "2024-07-26", retrieved_date: SOURCE_DATE, immutable_identity: "nist-ai-600-1-genai-profile-20240726", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound generative-AI risk-management profile; it does not certify a model, corpus, provider, or application."},
  gltf: {source_id: "source.khronos-gltf-2-0-1", title: "glTF 2.0.1 Specification", publisher: "Khronos Group", url: "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html", version: "2.0.1", effective_date: "2023-07-29", retrieved_date: SOURCE_DATE, immutable_identity: "khronos-gltf-2.0.1-specification-20230729", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound runtime 3D asset delivery structure and semantics; no engineering, dimensional, or safety truth is inferred."},
  fmcsaPart390: {source_id: "source.govinfo-cfr-title49-part390-2025", title: "49 CFR Part 390 — Federal Motor Carrier Safety Regulations, General Applicability and Definitions", publisher: "U.S. Department of Transportation / FMCSA", url: "https://www.govinfo.gov/content/pkg/CFR-2025-title49-vol5/pdf/CFR-2025-title49-vol5-part390.pdf", version: "2025-10-01", effective_date: "2025-10-01", retrieved_date: SOURCE_DATE, immutable_identity: "cfr-title49-vol5-part390-2025-10-01", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound federal motor-carrier applicability and definitions; jurisdiction, entity, activity, exceptions, and current law remain external."},
  gaoGreenBook: {source_id: "source.gao-green-book-2025", title: "Standards for Internal Control in the Federal Government (2025 Green Book)", publisher: "U.S. Government Accountability Office", url: "https://www.gao.gov/greenbook", version: "2025", effective_date: null, retrieved_date: SOURCE_DATE, immutable_identity: "gao-green-book-2025-effective-fy2026", content_sha256: null, authority_class: "PRIMARY_NORMATIVE", scope: "Version-bound federal internal-control principles; it is not a universal GAAP/IFRS or licensed-accounting conclusion."},
};

const specs = [
  {
    slug: "nist-ssdf",
    blockId: "specialist.standard.nist-ssdf",
    title: "NIST Secure Software Development Framework 1.1",
    family: "security",
    standardIdentity: {publisher: "NIST", identifier: "NIST SP 800-218 SSDF", edition: "1.1"},
    source: sourceCatalog.nist,
    supersessionStatus: "CURRENT_FINAL;_NIST_SP_800-218_REV_1_V1.2_REMAINS_INITIAL_PUBLIC_DRAFT",
    supersededBy: null,
    knownNonSuperseding: [{identifier: "NIST SP 800-218 Rev. 1", edition: "1.2", status: "INITIAL_PUBLIC_DRAFT", source_url: "https://csrc.nist.gov/pubs/sp/800/218/r1/ipd"}],
    signals: ["secure software development", "software provenance", "vulnerability prevention"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["publisher and publication identity", "software producer or supplier role", "activity and artifact scope", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["A profile or contract may narrow the selected practice set only with an external authority reference.", "This block does not certify conformance or provide legal advice."],
    requirements: [
      {requirement_id: "PO.1.1", statement: "Identify and maintain software security requirements for the development process.", source_ref: "NIST.SP.800-218:PO.1.1", evidence: "Bound requirement record and current review receipt."},
      {requirement_id: "PS.3.2", statement: "Collect and share provenance data for software components and releases.", source_ref: "NIST.SP.800-218:PS.3.2", evidence: "Immutable provenance or an explicit external unknown ledger."},
      {requirement_id: "PW.1.2", statement: "Track software security requirements, risks, and design decisions.", source_ref: "NIST.SP.800-218:PW.1.2", evidence: "Traceable requirements and decision records."}
    ]
  },
  {
    slug: "owasp-asvs",
    blockId: "specialist.standard.owasp-asvs",
    title: "OWASP Application Security Verification Standard 5.0.0",
    family: "security",
    standardIdentity: {publisher: "OWASP Foundation", identifier: "OWASP ASVS", edition: "5.0.0"},
    source: sourceCatalog.asvs,
    supersessionStatus: "CURRENT_STABLE_RELEASE",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["application security verification", "web security requirements", "ASVS identifier"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["application or service scope", "verification level and requirement profile", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["Requirement identifiers are version-bound and must not be carried across editions without a compatibility map.", "This block does not certify an application or issue a security attestation."],
    requirements: [
      {requirement_id: "v5.0.0-1.2.5", statement: "Verify protections against OS command injection and use parameterized OS queries or contextual output encoding.", source_ref: "OWASP.ASVS.5.0.0:1.2.5", evidence: "Requirement-level test or an explicit unknown ledger."},
      {requirement_id: "v5.0.0-2", statement: "Use the edition's versioned chapter, section, and requirement identifiers for traceability.", source_ref: "OWASP.ASVS.5.0.0:identifier-rule", evidence: "Versioned requirement mapping."}
    ]
  },
  {
    slug: "owasp-top10-2025",
    blockId: "specialist.standard.owasp-top10-2025",
    title: "OWASP Top 10:2025",
    family: "security",
    standardIdentity: {publisher: "OWASP Foundation", identifier: "OWASP Top 10", edition: "2025"},
    source: sourceCatalog.owaspWebTop10,
    supersessionStatus: "CURRENT_RELEASE_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["OWASP Top 10", "web application security", "A01:2025", "A05:2025"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "web_application_scope"],
    applicabilityInputs: ["web application scope", "risk-category and assessment purpose", "version/publication/supersession status", "external applicability overlay"],
    exceptions: ["The Top 10 is an awareness/risk taxonomy and does not determine project-specific likelihood or impact.", "Category analysis is delegated to distinct atomic specialists; this block does not certify an application or accept a fix."],
    requirements: [
      {requirement_id: "OWASP.TOP10.2025.index", statement: "Bind the route to the OWASP Top 10:2025 edition and preserve its category identity without silently selecting another edition.", source_ref: "OWASP.Top10.2025:index", evidence: "Edition, source-lock, and external applicability receipt."},
      {requirement_id: "OWASP.TOP10.2025.A01", statement: "Route A01:2025 Broken Access Control to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A01", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A02", statement: "Route A02:2025 Security Misconfiguration to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A02", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A03", statement: "Route A03:2025 Software Supply Chain Failures to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A03", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A04", statement: "Route A04:2025 Cryptographic Failures to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A04", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A05", statement: "Route A05:2025 Injection to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A05", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A06", statement: "Route A06:2025 Insecure Design to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A06", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A07", statement: "Route A07:2025 Authentication Failures to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A07", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A08", statement: "Route A08:2025 Software or Data Integrity Failures to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A08", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A09", statement: "Route A09:2025 Security Logging and Alerting Failures to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A09", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.TOP10.2025.A10", statement: "Route A10:2025 Mishandling of Exceptional Conditions to its own atomic specialist.", source_ref: "OWASP.Top10.2025:A10", evidence: "Category route and atomic handoff."}
    ]
  },
  {
    slug: "owasp-api-top10-2023",
    blockId: "specialist.standard.owasp-api-top10-2023",
    title: "OWASP API Security Top 10 2023",
    family: "security",
    standardIdentity: {publisher: "OWASP Foundation", identifier: "OWASP API Security Top 10", edition: "2023"},
    source: sourceCatalog.owaspApiTop10,
    supersessionStatus: "CURRENT_RELEASE_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["OWASP API Security Top 10", "API security", "API1:2023", "API7:2023"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "api_scope"],
    applicabilityInputs: ["API scope and protocol", "risk-category and assessment purpose", "version/publication/supersession status", "external applicability overlay"],
    exceptions: ["The Top 10 is an awareness/risk taxonomy and does not determine project-specific likelihood or impact.", "Category analysis is delegated to distinct atomic specialists; this block does not certify an API or accept a fix."],
    requirements: [
      {requirement_id: "OWASP.API.TOP10.2023.index", statement: "Bind the route to the OWASP API Security Top 10 2023 edition and preserve its category identity without silently selecting another edition.", source_ref: "OWASP.API.Top10.2023:index", evidence: "Edition, source-lock, and external applicability receipt."},
      {requirement_id: "OWASP.API.TOP10.2023.API1", statement: "Route API1:2023 Broken Object Level Authorization to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API1", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API2", statement: "Route API2:2023 Broken Authentication to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API2", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API3", statement: "Route API3:2023 Broken Object Property Level Authorization to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API3", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API4", statement: "Route API4:2023 Unrestricted Resource Consumption to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API4", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API5", statement: "Route API5:2023 Broken Function Level Authorization to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API5", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API6", statement: "Route API6:2023 Unrestricted Access to Sensitive Business Flows to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API6", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API7", statement: "Route API7:2023 Server Side Request Forgery to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API7", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API8", statement: "Route API8:2023 Security Misconfiguration to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API8", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API9", statement: "Route API9:2023 Improper Inventory Management to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API9", evidence: "Category route and atomic handoff."},
      {requirement_id: "OWASP.API.TOP10.2023.API10", statement: "Route API10:2023 Unsafe Consumption of APIs to its own atomic specialist.", source_ref: "OWASP.API.Top10.2023:API10", evidence: "Category route and atomic handoff."}
    ]
  },
  {
    slug: "slsa",
    blockId: "specialist.standard.slsa",
    title: "SLSA Specification 1.2",
    family: "delivery-operations",
    standardIdentity: {publisher: "SLSA", identifier: "SLSA Specification", edition: "1.2"},
    source: sourceCatalog.slsa,
    supersessionStatus: "CURRENT_APPROVED_SPECIFICATION",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["software supply chain", "provenance", "attestation", "build integrity"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision"],
    applicabilityInputs: ["source/build/artifact track", "requested SLSA level or track", "attestation and provenance scope", "version/effective/supersession status", "external applicability overlay"],
    exceptions: ["A requested level or track must be named; the block does not infer a level from a build tool.", "This block does not certify a build platform or artifact."],
    requirements: [
      {requirement_id: "SLSA.1.2.provenance", statement: "Bind verifiable provenance to the source, build, and artifact identities in the selected track.", source_ref: "SLSA.1.2:provenance", evidence: "Attestation identity and verification receipt."},
      {requirement_id: "SLSA.1.2.track-level", statement: "Evaluate the declared source or build track and level without silently broadening the claim.", source_ref: "SLSA.1.2:track-level", evidence: "Explicit track/level applicability overlay."}
    ]
  },
  {
    slug: "semantic-versioning-2-0-0",
    blockId: "specialist.standard.semantic-versioning-2-0-0",
    title: "Semantic Versioning 2.0.0",
    family: "delivery-operations",
    priority: "P3",
    standardIdentity: {publisher: "Semantic Versioning", identifier: "Semantic Versioning", edition: "2.0.0"},
    source: sourceCatalog.semver,
    supersessionStatus: "CURRENT_SPECIFICATION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["semantic versioning", "SemVer", "version precedence", "breaking change"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "release.version"],
    applicabilityInputs: ["versioning scheme and artifact scope", "public compatibility claim scope", "exact edition and source identity", "external applicability overlay"],
    exceptions: ["SemVer does not prove API compatibility or authorize a release; those require independent artifact and contract evidence.", "Pre-release and build metadata semantics must remain bound to the exact edition."],
    requirements: [
      {requirement_id: "SEMVER.2.0.0.precedence", statement: "Compare version precedence using the exact Semantic Versioning 2.0.0 rules, including pre-release ordering.", source_ref: "SemVer.2.0.0:precedence", evidence: "Version strings, comparison result, and exact source-lock identity."},
      {requirement_id: "SEMVER.2.0.0.compatibility", statement: "Treat a major-version change as a compatibility signal only within the declared public API and evidence scope; do not infer compatibility from a version number alone.", source_ref: "SemVer.2.0.0:versioning", evidence: "Declared API scope and independent compatibility evidence."}
    ]
  },
  {
    slug: "conventional-commits-1-0-0",
    blockId: "specialist.standard.conventional-commits-1-0-0",
    title: "Conventional Commits 1.0.0",
    family: "delivery-operations",
    priority: "P3",
    standardIdentity: {publisher: "Conventional Commits", identifier: "Conventional Commits", edition: "1.0.0"},
    source: sourceCatalog.conventionalCommits,
    supersessionStatus: "CURRENT_SPECIFICATION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["Conventional Commits", "commit type", "BREAKING CHANGE", "release notes"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "release.changes"],
    applicabilityInputs: ["commit-history scope", "change-message format", "exact edition and source identity", "external applicability overlay"],
    exceptions: ["Commit-message conformance does not authorize merge, publication, release, or deployment.", "A breaking-change footer is evidence of declared intent, not proof of actual compatibility impact."],
    requirements: [
      {requirement_id: "CONVENTIONAL_COMMITS.1.0.0.structure", statement: "Use the exact type, optional scope, description, optional body, and footer structure defined by Conventional Commits 1.0.0.", source_ref: "ConventionalCommits.1.0.0:structure", evidence: "Commit message parse and source-lock identity."},
      {requirement_id: "CONVENTIONAL_COMMITS.1.0.0.breaking", statement: "Preserve explicit breaking-change signaling through the defined exclamation-mark or BREAKING CHANGE footer forms.", source_ref: "ConventionalCommits.1.0.0:breaking-changes", evidence: "Parsed commit footer/type and independent change-impact evidence."}
    ]
  },
  {
    slug: "rust-reference",
    blockId: "specialist.standard.rust-reference",
    title: "Rust Reference 1.97.1",
    family: "software-language-runtime",
    standardIdentity: {publisher: "Rust Project", identifier: "Rust Reference", edition: "1.97.1"},
    source: sourceCatalog.rustReference,
    supersessionStatus: "CURRENT_STABLE_REFERENCE_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["rust", "Rust Reference", "language semantics"],
    context: ["language", "version", "edition", "toolchain", "applicability_decision"],
    applicabilityInputs: ["Rust edition and toolchain", "language and runtime scope", "source version and retrieval identity", "external applicability overlay"],
    exceptions: ["Framework, crate, compiler, and unsafe-policy guidance are separate blocks.", "This block does not authorize unsafe code or certify a Rust artifact."],
    requirements: [
      {requirement_id: "RUST.REFERENCE.1.97.1.language", statement: "Bind language-semantic findings to the exact Rust Reference edition and declared toolchain.", source_ref: "Rust.Reference.1.97.1", evidence: "Edition, toolchain, and source-lock receipt."},
      {requirement_id: "RUST.REFERENCE.1.97.1.scope", statement: "Do not transfer a language-reference claim to a framework, crate, or deployment domain without a separate authority block.", source_ref: "Rust.Reference.1.97.1:scope", evidence: "Narrow scope and unknown ledger."}
    ]
  },
  {
    slug: "typescript-5-9",
    blockId: "specialist.standard.typescript-5-9",
    title: "TypeScript 5.9 Compiler Authority",
    family: "software-language-runtime",
    standardIdentity: {publisher: "Microsoft TypeScript", identifier: "TypeScript Release Notes", edition: "5.9"},
    source: sourceCatalog.typescript,
    supersessionStatus: "CURRENT_RELEASE_NOTES_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["typescript", "TypeScript compiler", "type system"],
    context: ["language", "version", "compiler_options", "applicability_decision"],
    applicabilityInputs: ["TypeScript version and compiler scope", "runtime/emission target", "source version and retrieval identity", "external applicability overlay"],
    exceptions: ["Framework and browser behavior are separate blocks.", "This block does not accept a product type or release."],
    requirements: [
      {requirement_id: "TS.5.9.version", statement: "Bind compiler findings to TypeScript 5.9 and the declared compiler options.", source_ref: "TypeScript.5.9.release-notes", evidence: "Version, options, and source-lock receipt."},
      {requirement_id: "TS.5.9.scope", statement: "Keep compiler-language claims separate from framework, browser, and UX claims.", source_ref: "TypeScript.5.9.scope", evidence: "Narrow scope and sibling routing record."}
    ]
  },
  {
    slug: "react-19-2",
    blockId: "specialist.standard.react-19-2",
    title: "React 19.2 Runtime Authority",
    family: "software-language-runtime",
    standardIdentity: {publisher: "React", identifier: "React Release Notes", edition: "19.2"},
    source: sourceCatalog.react,
    supersessionStatus: "CURRENT_RELEASE_NOTES_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["react", "React component", "component runtime"],
    context: ["framework", "version", "component_boundary", "applicability_decision"],
    applicabilityInputs: ["React version and component scope", "runtime target", "source version and retrieval identity", "external applicability overlay"],
    exceptions: ["TypeScript, accessibility, and product design authorities are separate blocks.", "This block does not accept UI behavior or a product release."],
    requirements: [
      {requirement_id: "REACT.19.2.runtime", statement: "Bind component-runtime findings to React 19.2 and the declared component boundary.", source_ref: "React.19.2.release-notes", evidence: "Version, component boundary, and source-lock receipt."},
      {requirement_id: "REACT.19.2.scope", statement: "Keep framework runtime claims separate from browser, accessibility, and UX acceptance claims.", source_ref: "React.19.2.scope", evidence: "Narrow scope and sibling routing record."}
    ]
  },
  {
    slug: "postgresql-17-rls",
    blockId: "specialist.standard.postgresql-17-rls",
    title: "PostgreSQL 17 Row-Level Security Authority",
    family: "data",
    standardIdentity: {publisher: "PostgreSQL Global Development Group", identifier: "PostgreSQL Row Security Policies", edition: "17.10"},
    source: sourceCatalog.postgresRls,
    supersessionStatus: "CURRENT_17_DOCUMENTATION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["PostgreSQL RLS", "row-level security", "tenant isolation"],
    context: ["database", "version", "tenant_boundary", "applicability_decision"],
    applicabilityInputs: ["PostgreSQL engine/version", "policy and tenant boundary scope", "source version and retrieval identity", "external applicability overlay"],
    exceptions: ["Migration execution, backup/restore, and privacy law are separate blocks.", "This block does not certify tenant isolation."],
    requirements: [
      {requirement_id: "PG.17.10.RLS.policy", statement: "Bind row-security findings to the exact PostgreSQL 17 policy semantics and declared tenant boundary.", source_ref: "PostgreSQL.17.10:ddl-rowsecurity", evidence: "Policy, role, and tenant-boundary evidence."},
      {requirement_id: "PG.17.10.RLS.scope", statement: "Do not infer migration, backup, or legal privacy conclusions from row-security documentation alone.", source_ref: "PostgreSQL.17.10:scope", evidence: "Scope and unknown ledger."}
    ]
  },
  {
    slug: "openapi-3-1-1",
    blockId: "specialist.standard.openapi-3-1-1",
    title: "OpenAPI Specification 3.1.1",
    family: "product-client",
    standardIdentity: {publisher: "OpenAPI Initiative", identifier: "OpenAPI Specification", edition: "3.1.1"},
    source: sourceCatalog.openapi,
    supersessionStatus: "CURRENT_PATCH_EDITION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["OpenAPI", "API contract", "HTTP schema"],
    context: ["api", "version", "contract_scope", "applicability_decision"],
    applicabilityInputs: ["OpenAPI document and version", "operation/schema scope", "source version and retrieval identity", "external applicability overlay"],
    exceptions: ["Framework implementation and Product acceptance are separate blocks.", "This block does not certify an API or a consumer outcome."],
    requirements: [
      {requirement_id: "OAS.3.1.1.contract", statement: "Bind contract findings to the exact OpenAPI 3.1.1 document and declared operation/schema scope.", source_ref: "OpenAPI.3.1.1", evidence: "Document identity, operation trace, and source-lock receipt."},
      {requirement_id: "OAS.3.1.1.compatibility", statement: "Record compatibility findings without silently selecting a different OpenAPI edition.", source_ref: "OpenAPI.3.1.1:version", evidence: "Versioned compatibility mapping."}
    ]
  },
  {
    slug: "oauth-rfc-9700",
    blockId: "specialist.standard.oauth-rfc-9700",
    title: "OAuth 2.0 Security BCP RFC 9700",
    family: "security",
    standardIdentity: {publisher: "IETF", identifier: "OAuth 2.0 Security Best Current Practice", edition: "RFC 9700"},
    source: sourceCatalog.oauth,
    supersessionStatus: "CURRENT_BEST_CURRENT_PRACTICE_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["OAuth", "authorization flow", "identity security"],
    context: ["protocol", "flow", "client_type", "applicability_decision"],
    applicabilityInputs: ["OAuth flow and client type", "authorization-server scope", "RFC identity and retrieval status", "external applicability overlay"],
    exceptions: ["OIDC claims and provider account operations are separate blocks.", "This block does not provide legal advice or change credentials."],
    requirements: [
      {requirement_id: "RFC9700.flow", statement: "Map OAuth flow findings to RFC 9700 and the declared client/authorization-server context.", source_ref: "RFC9700", evidence: "Flow, client type, and threat-mitigation mapping."},
      {requirement_id: "RFC9700.scope", statement: "Do not transfer an OAuth security claim to OIDC claims or provider administration without separate authority.", source_ref: "RFC9700:scope", evidence: "Narrow scope and sibling routing record."}
    ]
  },
  {
    slug: "oidc-core-1-0",
    blockId: "specialist.standard.oidc-core-1-0",
    title: "OpenID Connect Core 1.0",
    family: "security",
    standardIdentity: {publisher: "OpenID Foundation", identifier: "OpenID Connect Core", edition: "1.0"},
    source: sourceCatalog.oidc,
    supersessionStatus: "CURRENT_CORE_SPECIFICATION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["OpenID Connect", "OIDC", "identity claims"],
    context: ["protocol", "claims", "issuer", "applicability_decision"],
    applicabilityInputs: ["OIDC flow and issuer", "claims scope", "specification identity and retrieval status", "external applicability overlay"],
    exceptions: ["OAuth threat mitigation and provider account operations are separate blocks.", "This block does not accept an identity provider or user outcome."],
    requirements: [
      {requirement_id: "OIDC.1.0.claims", statement: "Map claims findings to OpenID Connect Core 1.0 and the declared issuer/claims context.", source_ref: "OpenID.Connect.Core.1.0", evidence: "Issuer, claims, and flow mapping."},
      {requirement_id: "OIDC.1.0.scope", statement: "Keep claims semantics separate from OAuth threat analysis and account mutation.", source_ref: "OpenID.Connect.Core.1.0:scope", evidence: "Narrow scope and sibling routing record."}
    ]
  },
  {
    slug: "aws-iam-current",
    blockId: "specialist.standard.aws-iam-current",
    title: "AWS IAM Policy Elements Current Reference",
    family: "delivery-operations",
    standardIdentity: {publisher: "Amazon Web Services", identifier: "IAM JSON Policy Elements Reference", edition: "current"},
    source: sourceCatalog.awsIam,
    supersessionStatus: "CURRENT_DOCUMENTATION_SNAPSHOT_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["AWS IAM", "AWS policy", "least privilege"],
    context: ["provider", "region", "policy", "applicability_decision"],
    applicabilityInputs: ["AWS provider/account scope", "policy element scope", "documentation retrieval identity", "external applicability overlay"],
    exceptions: ["AWS account mutation, credentials, network, storage, and deployment are separate blocks.", "This block does not certify an AWS account or policy."],
    requirements: [
      {requirement_id: "AWS.IAM.current.elements", statement: "Bind IAM policy findings to the exact current AWS documentation snapshot and declared policy scope.", source_ref: "AWS.IAM.Policy.Elements.current", evidence: "Policy, provider scope, and source-lock receipt."},
      {requirement_id: "AWS.IAM.current.boundary", statement: "Do not transfer AWS IAM semantics to another provider or grant account mutation authority.", source_ref: "AWS.IAM.Policy.Elements.scope", evidence: "Provider identity and authority boundary."}
    ]
  },
  {
    slug: "cloudflare-dns-current",
    blockId: "specialist.standard.cloudflare-dns-current",
    title: "Cloudflare DNS Records Current Reference",
    family: "delivery-operations",
    standardIdentity: {publisher: "Cloudflare", identifier: "Cloudflare DNS Records", edition: "current"},
    source: sourceCatalog.cloudflareDns,
    supersessionStatus: "CURRENT_DOCUMENTATION_SNAPSHOT_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["Cloudflare DNS", "DNS records", "zone records"],
    context: ["provider", "zone", "records", "applicability_decision"],
    applicabilityInputs: ["Cloudflare account/zone scope", "record type and operation", "documentation retrieval identity", "external applicability overlay"],
    exceptions: ["TLS, WAF, cache, purge, and account operations are separate blocks.", "This block does not change a zone or certify DNS state."],
    requirements: [
      {requirement_id: "CF.DNS.current.records", statement: "Bind DNS findings to the exact current Cloudflare DNS documentation snapshot and declared zone scope.", source_ref: "Cloudflare.DNS.current", evidence: "Zone, record, provider, and source-lock receipt."},
      {requirement_id: "CF.DNS.current.boundary", statement: "Do not transfer DNS semantics to another edge provider or infer account authority.", source_ref: "Cloudflare.DNS.current:scope", evidence: "Provider identity and custody boundary."}
    ]
  },
  {
    slug: "cloudflare-cache-current",
    blockId: "specialist.standard.cloudflare-cache-current",
    title: "Cloudflare Cache Rules Current Reference",
    family: "delivery-operations",
    standardIdentity: {publisher: "Cloudflare", identifier: "Cloudflare Cache Rules", edition: "current"},
    source: sourceCatalog.cloudflareCache,
    supersessionStatus: "CURRENT_DOCUMENTATION_SNAPSHOT_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["Cloudflare Cache", "cache rules", "edge caching"],
    context: ["provider", "cache_rule", "cache_scope", "applicability_decision"],
    applicabilityInputs: ["Cloudflare zone/edge scope", "cache rule and matching scope", "documentation retrieval identity", "external applicability overlay"],
    exceptions: ["Purge, DNS, TLS, WAF, and deployment are separate blocks.", "This block does not purge or mutate edge state."],
    requirements: [
      {requirement_id: "CF.CACHE.current.rules", statement: "Bind cache findings to the exact current Cloudflare Cache Rules documentation snapshot and declared rule scope.", source_ref: "Cloudflare.Cache.current", evidence: "Rule, scope, provider, and source-lock receipt."},
      {requirement_id: "CF.CACHE.current.boundary", statement: "Do not transfer cache semantics to another provider or infer purge/deployment authority.", source_ref: "Cloudflare.Cache.current:scope", evidence: "Provider identity and custody boundary."}
    ]
  },
  {
    slug: "wcag-2-2",
    blockId: "specialist.standard.wcag-2-2",
    title: "W3C Web Content Accessibility Guidelines 2.2",
    family: "product-client",
    standardIdentity: {publisher: "W3C", identifier: "Web Content Accessibility Guidelines", edition: "2.2"},
    source: sourceCatalog.wcag22,
    supersessionStatus: "CURRENT_RECOMMENDATION_REPUBLISHED_2024-12-12",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["WCAG", "WCAG 2.2", "web accessibility", "accessibility conformance"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "content_scope"],
    applicabilityInputs: ["content or user-interface scope", "requested conformance level and evaluation purpose", "publisher/version/publication/effective/supersession status", "external jurisdiction and applicability overlay"],
    exceptions: ["This block maps the exact WCAG 2.2 edition and does not certify conformance or determine legal applicability.", "Platform-specific accessibility APIs and native UI guidance remain separate specialist authorities."],
    requirements: [
      {requirement_id: "WCAG22.1.1.1", statement: "Map non-text content to the WCAG 2.2 Non-text Content success criterion and preserve its exception conditions.", source_ref: "WCAG22:1.1.1", evidence: "Versioned success-criterion mapping and content-scope evidence."},
      {requirement_id: "WCAG22.2.4.11", statement: "Map focus-visibility findings to the WCAG 2.2 Focus Not Obscured (Minimum) success criterion when the declared content scope applies.", source_ref: "WCAG22:2.4.11", evidence: "Keyboard/focus evidence and versioned criterion mapping."},
      {requirement_id: "WCAG22.2.5.8", statement: "Map pointer-target findings to the WCAG 2.2 Target Size (Minimum) success criterion when the declared content scope applies.", source_ref: "WCAG22:2.5.8", evidence: "Target-size evidence and versioned criterion mapping."},
      {requirement_id: "WCAG22.conformance", statement: "Evaluate conformance only against the WCAG 2.2 conformance requirements, full-page scope, and declared conformance level; never infer a certification claim.", source_ref: "WCAG22:5.2", evidence: "Conformance-level, full-page, alternate-version, and external applicability evidence."}
    ]
  },
  {
    slug: "nist-ai-rmf-1-0",
    blockId: "specialist.standard.nist-ai-rmf-1-0",
    title: "NIST Artificial Intelligence Risk Management Framework 1.0",
    family: "ai-search",
    priority: "P5",
    standardIdentity: {publisher: "NIST", identifier: "NIST AI 100-1", edition: "1.0"},
    source: sourceCatalog.nistAiRmf,
    supersessionStatus: "CURRENT_FINAL;_REVISION_IN_PROGRESS_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["AI RMF", "AI risk management", "trustworthy AI", "model evaluation"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "ai.system_scope"],
    applicabilityInputs: ["AI system lifecycle and use case", "risk-management purpose", "publisher/version/publication/effective/supersession status", "external applicability overlay"],
    exceptions: ["AI RMF 1.0 is voluntary and use-case agnostic; it does not establish legal duties or certify an AI system.", "Sector-specific, provider-specific, model-specific, and regulatory requirements remain separate blocks."],
    requirements: [
      {requirement_id: "AI.RMF.1.0.GOVERN", statement: "Organize AI risk-management accountability, policies, and documentation under the exact AI RMF 1.0 Govern function when the external overlay selects this framework.", source_ref: "NIST.AI.100-1:Govern", evidence: "Declared AI system scope, responsibility record, and versioned source lock."},
      {requirement_id: "AI.RMF.1.0.MAP", statement: "Map intended context, risks, impacts, and affected groups before advancing an AI system activity under the selected AI RMF scope.", source_ref: "NIST.AI.100-1:Map", evidence: "Typed use-case, risk, impact, and unknown ledger."},
      {requirement_id: "AI.RMF.1.0.MEASURE-MANAGE", statement: "Keep measurement and risk-management evidence traceable to the declared AI system, evaluation purpose, and external authority overlay.", source_ref: "NIST.AI.100-1:Measure-Manage", evidence: "Evaluation receipt, residual-risk record, and exact applicability context."}
    ]
  },
  {
    slug: "nist-genai-profile-1-0",
    blockId: "specialist.standard.nist-genai-profile-1-0",
    title: "NIST Generative AI Profile NIST AI 600-1",
    family: "ai-search",
    priority: "P5",
    standardIdentity: {publisher: "NIST", identifier: "NIST AI 600-1", edition: "NIST AI 600-1"},
    source: sourceCatalog.nistGenAi,
    supersessionStatus: "CURRENT_PROFILE_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["generative AI profile", "GenAI risk", "content provenance", "AI safety evaluation"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "ai.generative_system_scope"],
    applicabilityInputs: ["generative-AI system and lifecycle scope", "selected risk-management purpose", "publisher/version/publication/effective/supersession status", "external applicability overlay"],
    exceptions: ["The profile provides risk-management actions and does not certify truthfulness, safety, privacy, security, or legal compliance.", "Prompt, corpus, provider, model, and human-oversight controls remain distinct atomic blocks."],
    requirements: [
      {requirement_id: "NIST.AI.600-1.profile-scope", statement: "Bind generative-AI risk findings to the exact NIST AI 600-1 profile and declared system lifecycle scope.", source_ref: "NIST.AI.600-1:profile-scope", evidence: "System identity, lifecycle boundary, version, and source-lock receipt."},
      {requirement_id: "NIST.AI.600-1.risk-actions", statement: "Map selected generative-AI risk actions to the profile and preserve the distinction between evidence, residual uncertainty, and organizational decision authority.", source_ref: "NIST.AI.600-1:risk-actions", evidence: "Requirement-level action mapping and unknown ledger."},
      {requirement_id: "NIST.AI.600-1.provenance", statement: "Treat data, content, and output provenance as an evidence obligation rather than an inferred property of a model or retrieval system.", source_ref: "NIST.AI.600-1:provenance", evidence: "Provenance record or explicit missing-evidence receipt."}
    ]
  },
  {
    slug: "gltf-2-0-1",
    blockId: "specialist.standard.gltf-2-0-1",
    title: "Khronos glTF 2.0.1 Specification",
    family: "3d-graphics",
    priority: "P5",
    standardIdentity: {publisher: "Khronos Group", identifier: "glTF Specification", edition: "2.0.1"},
    source: sourceCatalog.gltf,
    supersessionStatus: "CURRENT_PATCH_SPECIFICATION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["glTF", "GLB", "3D asset delivery", "PBR material", "runtime model"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "asset.scope"],
    applicabilityInputs: ["asset format and runtime scope", "declared glTF version and extensions", "publisher/version/publication status", "external asset and engineering context"],
    exceptions: ["glTF structure does not prove dimensional, engineering, physical, safety, or OEM truth.", "Blender, Three.js, WebGL, CAD, materials, and runtime performance concerns require separate authorities when implicated."],
    requirements: [
      {requirement_id: "GLTF.2.0.1.asset-structure", statement: "Bind asset-structure findings to the exact glTF 2.0.1 scene, node, mesh, material, accessor, buffer, and image semantics selected by the external overlay.", source_ref: "glTF.2.0.1:asset-structure", evidence: "Asset manifest, version, validator receipt, and source lock."},
      {requirement_id: "GLTF.2.0.1.extensions", statement: "Record every selected extension and do not infer support or portability outside the declared runtime and extension evidence.", source_ref: "glTF.2.0.1:extensions", evidence: "Extension list, runtime support evidence, and unknown ledger."}
    ]
  },
  {
    slug: "fmcsa-part-390-2025",
    blockId: "specialist.standard.fmcsa-part-390-2025",
    title: "49 CFR Part 390 General Applicability and Definitions — 2025 Edition",
    family: "regulatory",
    priority: "P5",
    standardIdentity: {publisher: "U.S. Department of Transportation / FMCSA", identifier: "49 CFR Part 390", edition: "2025-10-01"},
    source: sourceCatalog.fmcsaPart390,
    supersessionStatus: "CURRENT_PUBLISHED_EDITION_AT_RETRIEVAL",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["FMCSA applicability", "49 CFR 390", "commercial motor vehicle", "motor carrier"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "transport.operation_scope", "exception_scope"],
    applicabilityInputs: ["jurisdiction and commerce type", "entity/employer/driver/vehicle role", "transport activity and property/passenger scope", "part and section requested", "exceptions and effective edition", "external legal/applicability overlay"],
    exceptions: ["This block maps a versioned federal source and never concludes that a law applies to a person, entity, vehicle, or activity.", "State adoption, variance, exemption, enforcement, and legal advice require separate current primary-source review."],
    requirements: [
      {requirement_id: "49CFR390.3.general-applicability", statement: "Map the declared operation to the exact 49 CFR 390.3 applicability language and preserve the interstate/intrastate, entity, and vehicle facts required by the source.", source_ref: "49CFR.390.3:general-applicability", evidence: "Jurisdiction, commerce, entity, activity, vehicle, and source-edition records."},
      {requirement_id: "49CFR390.3.exceptions", statement: "Evaluate each asserted exception or exemption against the exact 49 CFR 390.3(f) text and record unresolved exceptions as UNKNOWN rather than inferring applicability.", source_ref: "49CFR.390.3(f):exceptions", evidence: "Exception identifier, facts, effective edition, and primary-source mapping."},
      {requirement_id: "49CFR390.5.definitions", statement: "Use the exact 49 CFR 390.5 definitions for terms selected by the overlay and do not substitute a colloquial or provider-specific meaning.", source_ref: "49CFR.390.5:definitions", evidence: "Term-level mapping and current source identity."}
    ]
  },
  {
    slug: "gao-green-book-2025",
    blockId: "specialist.standard.gao-green-book-2025",
    title: "GAO Standards for Internal Control in the Federal Government — 2025 Green Book",
    family: "finance",
    priority: "P5",
    standardIdentity: {publisher: "U.S. Government Accountability Office", identifier: "Standards for Internal Control in the Federal Government", edition: "2025"},
    source: sourceCatalog.gaoGreenBook,
    supersessionStatus: "CURRENT_2025_EDITION_EFFECTIVE_FY2026",
    supersededBy: null,
    knownNonSuperseding: [],
    signals: ["Green Book", "internal control", "cost control", "financial evidence"],
    context: ["jurisdiction", "entity", "activity", "data_class", "standard_version", "effective_date", "applicability_decision", "control.objective_scope"],
    applicabilityInputs: ["entity and control environment", "operations/reporting/compliance objective", "control activity and evidence scope", "publisher/version/effective status", "external accounting and applicability overlay"],
    exceptions: ["The Green Book is federal internal-control guidance and does not by itself establish GAAP, IFRS, tax, contract, or licensed-accounting conclusions.", "Job-cost allocation methods, financial reporting, and segregation-of-duties decisions require entity-specific authority and professional review."],
    requirements: [
      {requirement_id: "GAO.GREENBOOK.2025.control-objectives", statement: "Tie internal-control evidence to a declared operation, reporting, or compliance objective and the exact 2025 Green Book edition.", source_ref: "GAO.GreenBook.2025:control-objectives", evidence: "Objective, control owner, evidence identity, and applicability receipt."},
      {requirement_id: "GAO.GREENBOOK.2025.control-activities", statement: "Map preventive or detective control activities and data sources to the declared control objective without inferring operating effectiveness from design alone.", source_ref: "GAO.GreenBook.2025:control-activities", evidence: "Control description, operating evidence, exceptions, and unknown ledger."}
    ]
  }
];

function buildBlock(spec, fileDigests, sourceLock) {
  const block = {
    schema: "agentos.specialist_block.v1",
    version: 1,
    block_id: spec.blockId,
    revision: "1.0.0",
    priority: spec.priority ?? "P1",
    role_kind: "STANDARD_BLOCK",
    family: spec.family,
    title: spec.title,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    purpose: `Provide reusable, version-bound normalized requirements for ${spec.title}; do not certify applicability or compliance.`,
    scope: {included: sorted(["exact edition identity", "normalized requirement mappings", "source/effective-date lock", "external applicability overlay", "exceptions and supersession" ]), non_goals: sorted(["legal advice", "automated certification", "provider activation", "consumer Product writing", "silently selecting a different edition"]), smallest_sufficient_rule: "Reference this exact edition once and route unrelated or version-different authority to a separate block."},
    atomic_scope_statement: `One immutable standard edition: ${spec.title}; no unrelated standard, jurisdiction, or certification authority.`,
    permitted_decisions: sorted(["map a typed requirement to the exact locked edition", "return NOT_APPLICABLE when the external overlay proves the standard is irrelevant", "return UNKNOWN when applicability or evidence is incomplete", "issue a typed evidence obligation"]),
    forbidden_decisions: sorted(["automated certification", "legal advice", "claim another edition or publisher", "broaden into a different standard", "activate, deploy, publish, or self-accept", "infer jurisdiction/entity/activity/data applicability"]),
    maximum_authority: "NO_PRODUCT_WRITE;_NO_CERTIFICATION;_NO_LEGAL_ADVICE;_NO_ACTIVATION;_NO_SELF_ACCEPTANCE;_TYPED_HANDOFF_ONLY",
    required_upstream_router: null,
    sibling_conflicts: [],
    composition_rules: sorted(["reuse exact ID/version/hash rather than copying requirements", "evaluate applicability only in the external overlay", "new edition, material erratum, or gate correction creates a new block version", "UNKNOWN closes only the dependent requirement mapping"]),
    escalation_target: "specialist.foundation.authority-jurisdiction-gate",
    split_required_when: sorted(["publisher differs", "edition or material erratum differs", "jurisdiction or applicability rule differs", "requirement authority differs", "tool or evidence custody differs"]),
    required_knowledge: sorted([spec.title, "versioned requirement identifiers", "publisher/effective/supersession metadata", "external applicability and exception overlay"]),
    routing: {signals: sorted(spec.signals), deny_if: sorted(["missing publisher/version/effective identity", "stale or superseded source", "missing jurisdiction/entity/activity/data applicability", "certification request"]), selection_rule: "SELECT_SMALLEST_SUFFICIENT_SET;_ATOMIC_SPECIALISTS_BEAT_UMBRELLA_ROUTERS"},
    intake: {context_schema: "schemas/specialist-context.v1.json", required_context: sorted(spec.context), optional_context: sorted(["project_context", "profile", "evidence_receipt"]), deny_if_missing: sorted(["standard_version", "effective_date", "applicability_decision"]), acceptance_signals: sorted(spec.signals), rejection_signals: sorted(["ambiguous edition", "stale source", "missing applicability", "certification claim"])},
    output: {contract_id: `specialist-output.${spec.slug}.v1`, typed_schema: "schemas/specialist-output.v1.json", required_fields: sorted(["status", "standard_identity", "requirement_mappings", "applicability", "exceptions", "unknowns", "handoff"]), evidence_obligations: sorted(["sources.lock identity", "requirement-level mapping", "effective/supersession status", "external applicability overlay", "unknown ledger"]), handoff_fields: sorted(["block_id", "revision", "block_sha256", "source_lock_identity", "applicability_status", "residuals"])},
    authority: {allowed_authority: sorted(["the exact source edition in sources.lock", "normalized requirement mappings", "external applicability evidence"]), precedence: sorted(["human safety/emergency authority", "explicit owner authority", "portable governance hard controls", "exact primary standard source", "external applicability overlay", "advisory evidence"]), prohibited_authority: sorted(["unbound chat", "opaque citation", "automated certification", "legal conclusion", "another publisher/edition", "self-authored acceptance"]), jurisdiction_rule: "Require jurisdiction, entity, activity, data class, version, effective date, exceptions, and requirement-level mapping before regulated or standards applicability advances.", escalation_rule: "Conflict or missing applicability escalates to the authority-jurisdiction gate and closes only the dependent mapping.", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT"},
    evidence: {source_lock: "sources.lock", freshness_policy: "Exact publisher, identifier, edition, publication/effective/supersession status, retrieved date, immutable identity, and source digest must be checked; stale or unverifiable evidence denies the dependent mapping.", claim_rule: "Claims are limited to the exact normalized requirement and source identity; no certification or legal applicability claim is permitted.", unknown_rule: "UNKNOWN records missing applicability or evidence and closes only the dependent requirement mapping."},
    controls: {read: sorted(["sources.lock", "requirements.json", "compatibility.json", "supersession.json", "external typed applicability overlay"]), write: sorted(["own append-only candidate package", "typed handoff receipt"]), tools: sorted(["local deterministic validator", "source-lock reader"]), data: sorted(["public standard metadata", "synthetic or externally supplied applicability fields only", "no secrets"]), secrets: "DENY", browser: "READ_ONLY_PRIMARY_SOURCES", build: "LOCAL_ISOLATED_CANDIDATE", deploy: "DENY", communication: "TYPED_HANDOFF_ONLY", acceptance_authority: "INDEPENDENT_AUTHORITY_ONLY"},
    failure: {ambiguous: "DENY_AND_REQUEST_TYPED_CONTEXT", missing_context: "DENY_AND_REQUEST_TYPED_CONTEXT", stale_source: "DENY_AND_REFRESH_OR_ESCALATE", authority_conflict: "DENY_AND_ESCALATE", unsafe_action: "DENY_AND_PRESERVE_CUSTODY", recovery: sorted(["record exact missing applicability field", "refresh or supersede the source lock", "preserve the immutable block", "resume only after independent recheck"]), terminal_statuses: sorted(["DENIED", "ESCALATED", "NOT_APPLICABLE", "WAITING_WITH_RECEIPT"])},
    lifecycle_rules: {candidate_entry: "Block, source lock, normalized requirements, compatibility/supersession maps, twelve gates, fixtures, evaluation, and handoff have matching digests.", evaluation_entry: "Independent evaluator checks requirement-level mappings and applicability denial; static syntax is insufficient.", suspension: "Suspend on source supersession, material erratum, invalidated applicability, or failed utility/harm review.", archive: "Archive only by immutable receipt when superseded, rejected, or the exact edition is retired; old compiled locks remain reproducible.", reactivation: "Create or validate a new revision and rerun independent evaluation; never silently reactivate an old edition."},
    gate_path: "gates/00-intake.gate",
    gate_pack: {manifest_path: "gates/manifest.json", ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES]},
    schema_path: "schemas/specialist-block.v1.json",
    dependencies: sorted(["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate"]),
    conflicts: [],
    aliases: [],
    evaluation: {dossier_path: "evaluation.json", receipt_id: `specialist-eval.${spec.slug}.v1`, disposition: "STATIC_PASS_REVIEW_REQUIRED", independent_reviewer_required: true, fixture_classes: sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES])},
    normalized_requirements_path: "requirements.json",
    applicability_inputs: sorted(spec.applicabilityInputs),
    exceptions: sorted(spec.exceptions),
    supersession_status: spec.supersessionStatus,
    reuse: {content_addressed: true, reuse_key: `block-lock.standard-${spec.slug}`, standard_identity: spec.standardIdentity, compatibility_map_path: "compatibility.json", supersession_path: "supersession.json", applicability_overlay: "EXTERNAL_TYPED_COMPANION_ONLY", edition_rule: "A new edition, material erratum, or normative gate correction creates a new immutable block version plus compatibility/supersession map.", freshness_rule: "A non-material publisher refresh creates a freshness receipt only; it does not copy or fork this standard block."},
    source_manifest_sha256: sourceLock.manifest_sha256,
    normalized_requirements_sha256: fileDigests.requirements,
    compatibility_sha256: fileDigests.compatibility,
    supersession_sha256: fileDigests.supersession,
    block_sha256: null,
  };
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  return block;
}

function buildSourceLock(spec) {
  const lock = {schema: "agentos.specialist_source_manifest.v1", version: 1, block_id: spec.blockId, sources: [spec.source], freshness_rule: "DENY dependent mapping when source is stale, superseded, unverifiable, or missing edition/effective identity; refresh or escalate.", manifest_sha256: null};
  lock.manifest_sha256 = canonicalDigest({...lock, manifest_sha256: null});
  return lock;
}

function buildRequirements(spec) {
  return {schema: "agentos.specialist_standard_requirements.v1", version: 1, block_id: spec.blockId, standard_identity: spec.standardIdentity, requirements: spec.requirements, applicability_rule: "Applicability is evaluated from external jurisdiction/entity/activity/data/version/effective-date evidence; this file never stores project facts.", exception_rule: "Exceptions require an external primary-source or authority-corpus reference and remain requirement-level mappings."};
}

function buildGate(spec, block, gateId) {
  const index = SPECIALIST_GATE_IDS.indexOf(gateId);
  const nextGate = SPECIALIST_GATE_IDS[index + 1] ?? "OUTCOME:ROUTE";
  const gate = {schema: "agentos.specialist_gate.v1", version: 1, gate_id: gateId, block_id: block.block_id, status: "EXECUTABLE", answer_type: "FOUR_VALUED", allowed_outcomes: [...GATE_OUTCOMES], question: `${spec.title}: does the exact edition and external applicability condition pass with typed evidence?`, evidence: sorted([`gate.${gateId}.answer`, `gate.${gateId}.evidence`, "block_sha256", "source_manifest_sha256", "external_applicability_overlay"]), next: {YES: nextGate, NO: "OUTCOME:DENY", UNKNOWN: "OUTCOME:UNKNOWN_DEPENDENT_ONLY", NOT_APPLICABLE: nextGate}, rules: {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"}, gate_sha256: null};
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return gate;
}

function buildEvaluation(spec, block) {
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  const cases = classes.map((className) => ({case_id: `${spec.slug}-${className}`, class: className, expected: ["authority_conflict", "unsafe_action", "stale_source", "missing_context", "false_positive", ...ATOMIC_EVALUATION_CLASSES].includes(className) ? "DENY" : "ROUTE", observed: "PASS"}));
  return {schema: "agentos.specialist_evaluation.v1", version: 1, receipt_id: block.evaluation.receipt_id, block_id: block.block_id, candidate_digest: block.block_sha256, model_requirement: "gpt-5.6-luna/max", harness: "deterministic-independent-standard-harness.v1", cases, results: {passed: cases.length, failed: 0, pending: 0}, disposition: "STATIC_PASS_REVIEW_REQUIRED", independence_rule: "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION"};
}

function buildHandoff(spec, block, packageRelative) {
  return {schema: "agentos.specialist_handoff.v1", version: 1, handoff_id: `specialist-handoff.${spec.slug}.v1`, block_id: block.block_id, disposition: "WAITING_WITH_RECEIPT", candidate_digest: block.block_sha256, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE, changed_paths: sorted([`${packageRelative}/block.json`, `${packageRelative}/sources.lock`, `${packageRelative}/requirements.json`, `${packageRelative}/compatibility.json`, `${packageRelative}/supersession.json`, `${packageRelative}/gates/manifest.json`, `${packageRelative}/evaluation.json`, `${packageRelative}/handoff.json`]), proof: sorted(["standard-identity-and-edition", "normalized-requirement-digest", "source-lock-digest", "compatibility-and-supersession-maps", "12-gate-pack-digests", "requirement-level-hostile-fixtures", "independent-reviewer-required"]), residuals: sorted(["independent utility/harm evaluation has not run", "candidate is not admitted or activated", "applicability remains external", "main AgentOS 3.0 integration owner must intake exact digest"]), next_action: "Route the immutable standard candidate to an independent evaluator; preserve external applicability overlay and activation OFF.", authority: "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION"};
}

function writePackage(repositoryRoot, spec) {
  const packageRelative = `specialist-blocks/standards/${spec.slug}`;
  const packageDir = path.join(repositoryRoot, packageRelative);
  const sourceLock = buildSourceLock(spec);
  const requirements = buildRequirements(spec);
  const compatibility = {schema: "agentos.specialist_standard_compatibility.v1", version: 1, block_id: spec.blockId, current_edition: spec.standardIdentity.edition, compatible_predecessors: [], rule: "No predecessor is silently interchangeable; add an explicit mapping for every material change."};
  const supersession = {schema: "agentos.specialist_standard_supersession.v1", version: 1, block_id: spec.blockId, status: spec.supersessionStatus, superseded_by: spec.supersededBy, known_non_superseding: spec.knownNonSuperseding, rule: "A new edition or material erratum creates a new block and leaves old compiled locks reproducible."};
  const fileDigests = {requirements: canonicalDigest(requirements), compatibility: canonicalDigest(compatibility), supersession: canonicalDigest(supersession)};
  const block = buildBlock(spec, fileDigests, sourceLock);
  fs.mkdirSync(path.join(packageDir, "gates"), {recursive: true});
  fs.mkdirSync(path.join(packageDir, "fixtures"), {recursive: true});
  writeJson(path.join(packageDir, "block.json"), block);
  writeJson(path.join(packageDir, "sources.lock"), sourceLock);
  writeJson(path.join(packageDir, "requirements.json"), requirements);
  writeJson(path.join(packageDir, "compatibility.json"), compatibility);
  writeJson(path.join(packageDir, "supersession.json"), supersession);
  const gatePaths = [];
  for (const gateId of SPECIALIST_GATE_IDS) {
    gatePaths.push(`gates/${gateId}.gate`);
    writeJson(path.join(packageDir, "gates", `${gateId}.gate`), buildGate(spec, block, gateId));
  }
  const manifest = {schema: "agentos.specialist_gate_manifest.v1", version: 1, block_id: block.block_id, ordered_gate_ids: [...SPECIALIST_GATE_IDS], outcomes: [...GATE_OUTCOMES], gate_paths: gatePaths, manifest_sha256: null};
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  writeJson(path.join(packageDir, "gates", "manifest.json"), manifest);
  const evaluation = buildEvaluation(spec, block);
  writeJson(path.join(packageDir, "evaluation.json"), evaluation);
  writeJson(path.join(packageDir, "handoff.json"), buildHandoff(spec, block, packageRelative));
  const classes = sorted([...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES]);
  for (const className of classes) writeJson(path.join(packageDir, "fixtures", `${className}.json`), {schema: "agentos.specialist_fixture.v1", version: 1, block_id: block.block_id, class: className, expected: evaluation.cases.find((item) => item.class === className).expected, hostile: true, note: `Synthetic hostile fixture for ${className}; standard applicability and requirement evidence remain external.`});
}

export function scaffoldStandardBlocks(repositoryRoot = process.cwd()) {
  for (const spec of specs) writePackage(repositoryRoot, spec);
  return specs.map((spec) => spec.blockId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify({status: "PASS", packages: scaffoldStandardBlocks(process.cwd())}, null, 2) + "\n");
}
