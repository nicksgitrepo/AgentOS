#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileNormalizationPolicy,
  canonicalDigest,
  classifyRename,
  validateNormalizationPolicy,
} from "../control/normalization-policy.mjs";

const policy = compileNormalizationPolicy({
  importMode: "NORMALIZE_AND_AUDIT",
  projectGlossary: ["WellSight", "JobSight"],
  protectedContracts: ["GET /public-record", "users.email"],
  frameworkConventions: {router: "official-framework"},
});
const repeated = compileNormalizationPolicy({
  importMode: "NORMALIZE_AND_AUDIT",
  projectGlossary: ["JobSight", "WellSight"],
  protectedContracts: ["users.email", "GET /public-record"],
  frameworkConventions: {router: "official-framework"},
});
assert.deepEqual(policy, repeated, "normalization policy is not deterministic across input order");
assert.equal(policy.scope, "FULL_WITH_COMPATIBILITY");
assert.equal(policy.precedence[0], "EXTERNAL_PERSISTED_OR_PUBLIC_CONTRACT");
assert.equal(classifyRename({surface: "route", published: true}), "ALIAS_THEN_MIGRATE");
assert.equal(classifyRename({surface: "database", persisted: true, compatibilityAvailable: false}), "PRESERVE_EXTERNAL");
assert.equal(classifyRename({surface: "internal-helper"}), "RENAME_INTERNAL");
assert.equal(classifyRename({surface: "glossary-conflict", conflictsWithAcceptedGlossary: true}), "OWNER_REQUIRED_ON_CONFLICT");
validateNormalizationPolicy(policy);

const weakened = structuredClone(policy);
weakened.precedence = [...weakened.precedence].reverse();
delete weakened.normalization_sha256;
weakened.normalization_sha256 = "0".repeat(64);
assert.throws(() => validateNormalizationPolicy(weakened), /precedence is weakened/u);
assert.throws(() => compileNormalizationPolicy({importMode: "NORMALIZE_AND_AUDIT", additionalRules: {allow_silent_public_rename: "yes"}}), /cannot override/u);

const changedPortableRule = structuredClone(policy);
changedPortableRule.rules.directory = "anything";
delete changedPortableRule.normalization_sha256;
changedPortableRule.normalization_sha256 = canonicalDigest(changedPortableRule);
assert.throws(() => validateNormalizationPolicy(changedPortableRule), /portable normalization rule was modified/u);

console.log("PASS AgentOS Normalization Policy (precedence, compatibility classification, deterministic input normalization, and hostile weakening coverage)");
