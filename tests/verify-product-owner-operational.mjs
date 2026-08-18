#!/usr/bin/env node

import assert from "node:assert/strict";
import {prepareProductOwnerOperationalAuthority, runProductOwnerOperationalRequest} from "../control/product-owner-operational.mjs";

const forged = Object.freeze(Object.create(null));
assert.throws(() => runProductOwnerOperationalRequest({authority: forged, operation: "RESPOND_TO_USER", request: {message: "Hello."}}), (error) => error.code === "PRODUCT_OWNER_AUTHORITY_REQUIRED");
for (const forbidden of ["SPAWN_AGENT", "DESPAWN_AGENT", "ADVANCE_WORKFLOW", "WRITE_MEMORY", "DEPLOY", "MERGE", "RUN_CAMPAIGN"]) {
  assert.throws(() => runProductOwnerOperationalRequest({authority: forged, operation: forbidden, request: {}}), /opaque governed authority/u);
}
assert.throws(() => runProductOwnerOperationalRequest({authority: forged, operation: "RESPOND_TO_USER", request: {}, adapter: {deploy() { throw new Error("must not run"); }}}), /rejects caller authority/u);
assert.throws(() => prepareProductOwnerOperationalAuthority({authorityRoot: "/tmp/alternate", pass: true}), /rejects caller authority/u);

console.log("PASS Product Owner operational boundary: no conversation, timer, workflow, lifecycle, memory, merge, or deploy action runs without sealed admission and current model policy");
