#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PUBLIC_PAYLOAD_SCAN_SCHEMA,
  scanPublicPayload,
} from "../../control/rapid-prototype/security-privacy.mjs";

function assertViolation(result, code) {
  assert.equal(result.safe, false);
  assert.equal(result.status, "HARD_STOP");
  assert(result.violations.includes(code), `missing ${code} violation`);
}

const cleanPayload = [
  "Typed outcomes keep the public surface portable.",
  "The implementation lives in control/rapid-prototype/security-privacy.mjs.",
  "Focused checks live in tests/rapid-prototype/security-privacy.mjs.",
].join("\n");
const clean = scanPublicPayload(cleanPayload, [], true);
assert.equal(clean.schema, PUBLIC_PAYLOAD_SCAN_SCHEMA);
assert.equal(clean.safe, true);
assert.equal(clean.status, "SAFE");
assert.deepEqual(clean.violations, []);
assert.match(clean.payload_sha256, /^[0-9a-f]{64}$/u);

const cleanObjectCall = scanPublicPayload({
  text: "Portable content may use ./docs/guide.md and src/feature.mjs.",
  forbiddenTerms: ["outside-project"],
  allowRelativePaths: true,
});
assert.equal(cleanObjectCall.safe, true);

const credentialValue = ["synthetic", "credential", "value"].join("-");
const credential = scanPublicPayload(`authorization: Bearer ${credentialValue}`);
assertViolation(credential, "CREDENTIAL");
assert.equal(JSON.stringify(credential).includes(credentialValue), false);

const redactedCredential = scanPublicPayload("token: [REDACTED]");
assert.equal(redactedCredential.safe, true);
assert.equal(redactedCredential.status, "SAFE");
assert.deepEqual(redactedCredential.violations, []);

const absolutePath = ["", "Users", "synthetic-project", "private.txt"].join("/");
const absolutePathResult = scanPublicPayload(`read from ${absolutePath}`);
assertViolation(absolutePathResult, "ABSOLUTE_LOCAL_PATH");

const accountIdentifier = ["account_id: ", "123", "456", "789"].join("");
const accountResult = scanPublicPayload(accountIdentifier);
assertViolation(accountResult, "PROVIDER_OR_ACCOUNT_IDENTIFIER");
assert.equal(JSON.stringify(accountResult).includes(accountIdentifier), false);

const sessionRecord = "session_id: opaque-record-value";
const sessionResult = scanPublicPayload(sessionRecord);
assertViolation(sessionResult, "SESSION_RECORD");
assert.equal(JSON.stringify(sessionResult).includes(sessionRecord), false);

const externalProject = ["outside", "project"].join("-");
const projectResult = scanPublicPayload(`handoff mentions ${externalProject}`, [externalProject], true);
assertViolation(projectResult, "EXTERNAL_PROJECT_NAME");
assert.equal(JSON.stringify(projectResult).includes(externalProject), false);

const chatLink = ["https://", "example.invalid", "/thread/placeholder"].join("");
const chatResult = scanPublicPayload(chatLink);
assertViolation(chatResult, "CHAT_LINK");

const unsafeUrl = ["http://", "example.invalid", "/endpoint"].join("");
const unsafeUrlResult = scanPublicPayload(unsafeUrl);
assertViolation(unsafeUrlResult, "UNSAFE_EXTERNAL_URL");

const traversalResult = scanPublicPayload("read ../outside/secret.txt", [], true);
assertViolation(traversalResult, "UNSAFE_RELATIVE_PATH");

const relativePathsDisabled = scanPublicPayload("control/rapid-prototype/security-privacy.mjs", [], false);
assertViolation(relativePathsDisabled, "RELATIVE_PATH_NOT_ALLOWED");

console.log("PASS public payload scanner: clean relative content, credentials, absolute paths, provider/account identifiers, session records, external project terms, chat links, unsafe URLs, and traversal boundaries covered without echoing protected values");
