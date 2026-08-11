#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  REQUIRED_NATIVE_HOST_ACTIONS,
  bindNativeHost,
  compileNativeHostAttachment,
  validateNativeHostAttachment,
} from "../control/native-host-attachment.mjs";
import {loadNativeHostAdapter} from "../control/native-host-loader.mjs";
import {scanPersistedRecord} from "../control/persisted-record-privacy.mjs";

const NOW = "2026-08-06T12:00:00.000Z";
const attachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-HOST-1",
  hostId: "host-local-private",
  projectId: "public-project",
  environmentId: "local-test",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  attachedAtUtc: NOW,
});

assert.doesNotThrow(() => validateNativeHostAttachment(attachment));
assert.match(attachment.host_id, /^HOST_REF_[0-9a-f]{64}$/u);
assert(!JSON.stringify(attachment).includes("host-local-private"), "host-local identity leaked into the attachment");
assert.equal(scanPersistedRecord(attachment).safe, true, "host attachment is not portable");

const calls = [];
const threadId = ["00000000", "0000", "4000", "8000", "000000000001"].join("-");
const provider = Object.fromEntries(REQUIRED_NATIVE_HOST_ACTIONS.map((action) => [action, async (payload) => {
  calls.push([action, payload]);
  return action === "create_thread"
    ? {threadId, hostId: "host-local-private", projectId: "public-project"}
    : {ok: true};
}]));

const bound = bindNativeHost(provider, attachment);
const created = await bound.create_thread({identity: {project_id: "public-project", environment_id: "local-test"}});
assert.equal(created.thread_id, threadId);
assert.equal(created.host_id, "host-local-private");
assert.equal(calls[0][1].host_attachment.host_id, "host-local-private", "host-local identity was not available to the provider boundary");
assert.equal(calls[0][1].identity.project_id, "public-project");
assert.equal(calls[0][1].identity.environment_id, "local-test");
await assert.rejects(() => bound.list_threads({identity: {project_id: "other-project"}}), /project differs/u);

const moduleUrl = `data:text/javascript,${encodeURIComponent(`
  const actions = ${JSON.stringify(REQUIRED_NATIVE_HOST_ACTIONS)};
  export function createNativeHostAdapter() {
    return Object.fromEntries(actions.map((action) => [action, async () => ({ok: true})]));
  }
`)}`;
const loaded = await loadNativeHostAdapter({
  attachment,
  moduleUrl,
  runtimeIdentity: {host_id: "host-local-private"},
});
assert.equal(typeof loaded.wait_threads, "function");
assert.deepEqual(await loaded.list_threads({}), {ok: true});
assert.strictEqual(bindNativeHost(loaded, attachment, {runtimeIdentity: {host_id: "host-local-private"}}), loaded, "already-bound adapter was wrapped a second time");
const differentAttachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-HOST-2",
  hostId: "host-local-private",
  projectId: "public-project",
  environmentId: "local-test",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  attachedAtUtc: NOW,
});
assert.throws(
  () => bindNativeHost(loaded, differentAttachment, {runtimeIdentity: {host_id: "host-local-private"}}),
  /already bound to another attachment/u,
);
await assert.rejects(() => loadNativeHostAdapter({attachment: structuredClone(attachment), moduleUrl}), /runtime identity/u);

const invalidModuleUrl = `data:text/javascript,${encodeURIComponent("export default {};\n")}`;
await assert.rejects(() => loadNativeHostAdapter({attachment, moduleUrl: invalidModuleUrl, runtimeIdentity: {host_id: "host-local-private"}}), /NATIVE_HOST_ADAPTER_LOAD_FAILED/u);
const malformedProvider = Object.fromEntries(REQUIRED_NATIVE_HOST_ACTIONS.map((action) => [action, async () => null]));
const malformedBound = bindNativeHost(malformedProvider, attachment);
await assert.rejects(() => malformedBound.read_thread({}), /NATIVE_HOST_READBACK_INVALID/u);
await assert.rejects(() => bound.read_thread({identity: {host_id: "forged-host"}}), /payload host differs/u);

console.log("PASS native host attachment: opaque attachment, runtime-only provider identity, project binding, alias normalization, loader, and fail-closed adapter checks verified");
