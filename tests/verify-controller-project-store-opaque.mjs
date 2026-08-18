#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  disposeEphemeralControllerProjectStoreForTest,
  inspectControllerProjectStoreForTest,
  openControllerProjectStore,
  prepareEphemeralControllerProjectStoreForTest,
  readControllerProjectState as readFixtureControllerProjectState,
  reattachEphemeralControllerProjectStoreForTest,
  writeControllerProjectStateCompareAndSwap as writeFixtureControllerProjectStateCompareAndSwap,
} from "./helpers/controller-project-store-fixture.mjs";
import * as productionStore from "../control/controller-project-store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-project-store-test-"));
const alternate = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-project-store-alternate-"));
const provision = prepareEphemeralControllerProjectStoreForTest();
const state = {state_sha256: "a".repeat(64), value: "opaque"};
try {
  const originalEntry = process.argv[1];
  process.argv[1] = `${path.sep}tests${path.sep}verify-controller-project-store-opaque.mjs`;
  try {
    assert.equal(Object.hasOwn(productionStore, "prepareEphemeralControllerProjectStoreForTest"), false, "argv spoof must not expose production provisioning");
    assert.equal(Object.hasOwn(productionStore, "openControllerProjectStore"), false, "argv spoof must not expose production open");
    assert.equal(Object.hasOwn(productionStore, "resolveControllerProjectStore"), false, "production must not expose hidden-root resolution");
  } finally {
    process.argv[1] = originalEntry;
  }
  assert.throws(() => productionStore.readControllerProjectState({}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.throws(() => productionStore.writeControllerProjectStateCompareAndSwap({}, {state}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.throws(() => productionStore.consumeControllerProjectEventOnce({}, {}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.throws(() => openControllerProjectStore({authorityRoot: root}), /rejects caller roots|capability/u);
  const storeA = openControllerProjectStore({projectControlStoreCapability: provision});
  assert.throws(() => readFixtureControllerProjectState(JSON.parse(JSON.stringify(storeA))), /opaque|capability/u);
  writeFixtureControllerProjectStateCompareAndSwap(storeA, {state, validateState: (value) => assert.equal(value.state_sha256, state.state_sha256)});
  assert.equal(readFixtureControllerProjectState(storeA).value, "opaque");
  assert.equal(fs.readdirSync(alternate).length, 0);
  assert.throws(() => openControllerProjectStore({projectControlStoreCapability: provision}), /one-use|consumed|stale/u);
  const nextProvision = reattachEphemeralControllerProjectStoreForTest(provision);
  assert.throws(() => readFixtureControllerProjectState(storeA), /stale|revoked/u);
  const storeB = openControllerProjectStore({projectControlStoreCapability: nextProvision});
  assert.equal(readFixtureControllerProjectState(storeB).value, "opaque");
  const inspection = inspectControllerProjectStoreForTest(storeB);
  assert.equal(inspection.attachment_generation, 2);
  assert.equal(Object.hasOwn(inspection, "root"), false, "inspection must not return hidden root");
  assert.equal(Object.hasOwn(inspection, "target"), false, "inspection must not return hidden target");
  assert.throws(() => readFixtureControllerProjectState({}), /opaque|capability/u);
} finally {
  disposeEphemeralControllerProjectStoreForTest(provision);
  fs.rmSync(root, {recursive: true, force: true});
  fs.rmSync(alternate, {recursive: true, force: true});
}
console.log("PASS Controller project-store fixture isolation: test-only hidden-root/generation checks plus production fail-closed provisioning surface");
