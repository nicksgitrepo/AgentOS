#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  BLUEPRINT_RELEASE_SCHEMA,
  BLUEPRINT_NOTICE_SCHEMA,
  BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC,
  compileBlueprintRelease,
  validateBlueprintRelease,
  sealBlueprintRelease,
  correctBlueprintRelease,
  compileBlueprintIndex,
  validateBlueprintIndex,
  compileBlueprintProducerNotice,
  validateBlueprintProducerNotice,
  compileBlueprintRepairPreflight,
  validateBlueprintRepairPreflight,
  compileBlueprintReference,
  validateBlueprintReference,
  validateBlueprintLifecycleTraffic,
  consumeBlueprintRelease,
} from "../control/blueprint-release-governance.mjs";

const NOW = "2026-08-31T00:00:00.000Z";
const SHA = (character) => character.repeat(64);

const entry = {
  issue_id: "SOCIUNA-ISSUE-2026-1174",
  status: "READY",
  issue_sha256: SHA("1"),
  blueprint_path: "blueprints/SOCIUNA-ISSUE-2026-1174.md",
  blueprint_sha256: SHA("2"),
  source_hashes: [SHA("1"), SHA("2")],
  completeness: "COMPLETE",
  batch_links: [],
  recommended_order: 1,
};

const release = compileBlueprintRelease({
  releaseId: "BLUEPRINT.RELEASE.1174",
  releaseSequence: 1,
  publishedAtUtc: NOW,
  releasePath: "blueprints/BLUEPRINT.RELEASE.1174.json",
  entries: [entry],
  factualInputs: {
    evidence: ["ref:evidence/issue-1174"],
    rootCause: ["ref:root-cause/coordination"],
    constraints: ["no-product-mutation"],
    acceptanceCriteria: ["direct-file-consumption"],
  },
  advisoryInputs: {
    batchingSuggestions: ["batch-independent-ready-items"],
    implementationSuggestions: ["preserve-typed-evidence"],
  },
  producerNoticeId: "BLUEPRINT.NOTICE.1174",
});
assert.equal(release.schema, BLUEPRINT_RELEASE_SCHEMA);
assert.equal(release.status, "SEALED");
assert.equal(validateBlueprintRelease(release), release);
assert.equal(release.manifest.entry_count, 1);
assert.equal(release.issue_ids[0], entry.issue_id);
const releaseWithAckAlias = {...release, acknowledgementRequired: true, release_sha256: null};
releaseWithAckAlias.release_sha256 = canonicalDigest(releaseWithAckAlias);
assert.throws(() => validateBlueprintRelease(releaseWithAckAlias), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const releaseWithPerIssueAlias = {...release, per_issue: true, release_sha256: null};
releaseWithPerIssueAlias.release_sha256 = canonicalDigest(releaseWithPerIssueAlias);
assert.throws(() => validateBlueprintRelease(releaseWithPerIssueAlias), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const releaseWithUnknownCoordinationField = {...release, traffic: [], release_sha256: null};
releaseWithUnknownCoordinationField.release_sha256 = canonicalDigest(releaseWithUnknownCoordinationField);
assert.throws(() => validateBlueprintRelease(releaseWithUnknownCoordinationField), /INVALID_RELEASE/u);

// A sealed publication is idempotent only when the bytes are identical.
assert.equal(sealBlueprintRelease(release, {existingRelease: structuredClone(release)}).release_sha256, release.release_sha256);
const rewritten = structuredClone(release);
rewritten.factual_inputs.evidence = ["ref:evidence/rewritten"];
rewritten.release_sha256 = "0".repeat(64);
assert.throws(() => sealBlueprintRelease(rewritten, {existingRelease: release}), /SEALED_RELEASE_IMMUTABLE/u);
assert.throws(() => compileBlueprintRelease({releaseId: "BLUEPRINT.RELEASE.1174-CORRECTION", releaseSequence: 2, entries: [entry], correction: true, publishedAtUtc: NOW}), /CORRECTION_REQUIRES_SUPERSEDES/u);

const successor = correctBlueprintRelease(release, {
  releaseId: "BLUEPRINT.RELEASE.1174-CORRECTION",
  releaseSequence: 2,
  publishedAtUtc: "2026-08-31T00:01:00.000Z",
  entries: [{...entry, blueprint_sha256: SHA("3"), source_hashes: [SHA("1"), SHA("3")]}],
});
assert.equal(successor.supersedes.release_id, release.release_id);
assert.equal(successor.supersedes.release_sha256, release.release_sha256);
assert.notEqual(successor.release_id, release.release_id);
assert.throws(() => validateBlueprintRelease({...successor, supersedes: null}), /SUPERSEDES|DIGEST/u);

const index = compileBlueprintIndex({
  indexId: "BLUEPRINT.INDEX.1174",
  generatedAtUtc: NOW,
  releases: [release, successor],
  activeReleaseId: successor.release_id,
});
assert.equal(validateBlueprintIndex(index), index);
const badIndex = structuredClone(index);
badIndex.releases[0].release_sha256 = SHA("f");
badIndex.index_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintIndex(badIndex), /DIGEST|INDEX/u);

const preflight = compileBlueprintRepairPreflight({
  preflightId: "BLUEPRINT.PREFLIGHT.1174",
  releaseId: successor.release_id,
  indexSha256: index.index_sha256,
  checkedAtUtc: NOW,
  sourceBase: {commit: "a".repeat(40), tree: "b".repeat(40)},
  custody: {clean: true, unstaged_count: 0, untracked_count: 0, process_count: 0},
  collision: {target_preexisting: false, target_ref_preexisting: false, process_overlap: 0, active_writer_overlap: 0},
});
assert.equal(validateBlueprintRepairPreflight(preflight), preflight);
const reboundAliasIndex = structuredClone(index);
const reboundAliasRelease = {...successor, acknowledgementRequired: true, release_sha256: null};
reboundAliasRelease.release_sha256 = canonicalDigest(reboundAliasRelease);
reboundAliasIndex.releases.find((value) => value.release_id === reboundAliasRelease.release_id).release_sha256 = reboundAliasRelease.release_sha256;
reboundAliasIndex.index_sha256 = null;
reboundAliasIndex.index_sha256 = canonicalDigest(reboundAliasIndex);
assert.equal(validateBlueprintIndex(reboundAliasIndex), reboundAliasIndex);
const reboundAliasPreflight = {...preflight, index_sha256: reboundAliasIndex.index_sha256, preflight_sha256: null};
reboundAliasPreflight.preflight_sha256 = canonicalDigest(reboundAliasPreflight);
assert.equal(validateBlueprintRepairPreflight(reboundAliasPreflight), reboundAliasPreflight);
assert.throws(() => consumeBlueprintRelease({release: reboundAliasRelease, index: reboundAliasIndex, preflight: reboundAliasPreflight}), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const stalePreflight = structuredClone(preflight);
stalePreflight.index_sha256 = SHA("e"); stalePreflight.preflight_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintRepairPreflight(stalePreflight), /DIGEST_MISMATCH/u);
const dirtyPreflight = structuredClone(preflight);
dirtyPreflight.custody.clean = false; dirtyPreflight.preflight_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintRepairPreflight(dirtyPreflight), /CUSTODY_DIRTY/u);

const consumed = consumeBlueprintRelease({release: successor, index, preflight});
assert.equal(consumed.accepted, true);
assert.equal(consumed.status, "BLUEPRINT_READY_FOR_REPAIR");
assert.equal(consumed.consumed_via, "DIRECT_RELEASE_AND_INDEX_FILES");
assert.equal(consumed.blueprint_consumed_traffic, false);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight, traffic: {kind: "BLUEPRINT_CONSUMED"}}), /TRAFFIC_INVALID/u);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight, messages: {kind: "BLUEPRINT_CONSUMED"}}), /TRAFFIC_INVALID/u);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight, messages: [{kind: "BLUEPRINT_CONSUMED"}]}), /CONSUMED_TRAFFIC_FORBIDDEN/u);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight, acknowledgementRequired: true}), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const mismatched = structuredClone(preflight); mismatched.release_id = release.release_id; mismatched.preflight_sha256 = "0".repeat(64);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight: mismatched}), /DIGEST_MISMATCH|PREFLIGHT_RELEASE_MISMATCH/u);

const notice = compileBlueprintProducerNotice({
  noticeId: "BLUEPRINT.NOTICE.1174",
  releaseId: successor.release_id,
  issueIds: [entry.issue_id],
  sentAtUtc: NOW,
});
assert.equal(validateBlueprintProducerNotice(notice).schema, BLUEPRINT_NOTICE_SCHEMA);
assert.throws(() => compileBlueprintProducerNotice({noticeId: "BLUEPRINT.NOTICE.1174-SECOND", releaseId: successor.release_id, issueIds: [entry.issue_id], sentAtUtc: NOW, existingNotices: [notice]}), /DUPLICATE_NOTICE/u);
const ack = structuredClone(notice); ack.acknowledgement_required = true; ack.notice_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintProducerNotice(ack), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const perIssue = structuredClone(notice); perIssue.per_issue = true; perIssue.notice_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintProducerNotice(perIssue), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const camelNotice = {...notice, acknowledgementRequired: true, notice_sha256: null}; camelNotice.notice_sha256 = canonicalDigest(camelNotice);
assert.throws(() => validateBlueprintProducerNotice(camelNotice), /ACKNOWLEDGEMENT_FORBIDDEN/u);
const camelPerIssueNotice = {...notice, perIssue: true, notice_sha256: null}; camelPerIssueNotice.notice_sha256 = canonicalDigest(camelPerIssueNotice);
assert.throws(() => validateBlueprintProducerNotice(camelPerIssueNotice), /ACKNOWLEDGEMENT_FORBIDDEN/u);
assert.throws(() => validateBlueprintLifecycleTraffic({kind: "BLUEPRINT_CONSUMED"}), /CONSUMED_TRAFFIC_FORBIDDEN/u);
assert.throws(() => validateBlueprintLifecycleTraffic({kind: "PER_ISSUE_NOTICE", acknowledgement_required: true}), /ACKNOWLEDGEMENT_FORBIDDEN|TRAFFIC_FORBIDDEN/u);
const camelAcknowledgement = {kind: "ISSUE_STARTED", acknowledgementRequired: true};
assert.throws(() => validateBlueprintLifecycleTraffic(camelAcknowledgement), /ACKNOWLEDGEMENT_FORBIDDEN/u);
assert.throws(() => consumeBlueprintRelease({release: successor, index, preflight, traffic: [camelAcknowledgement]}), /ACKNOWLEDGEMENT_FORBIDDEN/u);
assert.throws(() => validateBlueprintLifecycleTraffic({kind: "ISSUE_STARTED", perIssue: true}), /PER_ISSUE_NOTICE_FORBIDDEN/u);
assert.throws(() => validateBlueprintLifecycleTraffic({kind: "ISSUE_STARTED", issueNotice: true}), /PER_ISSUE_NOTICE_FORBIDDEN/u);
for (const kind of BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC) assert.deepEqual(validateBlueprintLifecycleTraffic({kind}), {kind});

const reference = compileBlueprintReference({releaseId: successor.release_id, path: successor.release_path, sha256: successor.release_sha256});
assert.equal(validateBlueprintReference(reference), reference);
const embedded = {...reference, content: "forbidden"}; embedded.reference_sha256 = "0".repeat(64);
assert.throws(() => validateBlueprintReference(embedded), /EMBEDDED_CONTENT|REFERENCE_INVALID/u);
assert.throws(() => compileBlueprintReference({releaseId: successor.release_id, path: "../outside.json", sha256: successor.release_sha256}), /INVALID_REFERENCE/u);

process.stdout.write(`BLUEPRINT_RELEASE_GOVERNANCE_FOCUSED_PASS releases=2 entries=1 traffic=${BLUEPRINT_ALLOWED_LIFECYCLE_TRAFFIC.length}\n`);
