#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {compileAuthorityRebindReceipt, validateAuthorityRebindReceipt} from "../control/authority-rebind-receipt.mjs";
import * as publicKernel from "../control/agentos.mjs";

const git = (char) => char.repeat(40);
const authority = {repository: "AgentOS", branch: "lane/authority-rebind", remote_ref: "refs/heads/lane/authority-rebind", commit: git("a"), tree: git("b"), parent: git("c"), remote_verified: true, worktree_clean: true};
const repair = {helper: "control/observed-dispatch-binding-gate.mjs:rebaseObservedDispatchPendingBinding", source_helper: "control/observed-dispatch-binding-gate.mjs:compileObservedDispatchSourceSuccessor", schema: "schemas/observed-dispatch-binding-gate.v1.json", rule: "Rebase the pending route onto a validated current source successor before dispatch."};
const custody = {execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW", controller_approval_required: false, control_plane_only: true, consumer_product_mutated: false, protected_action: false, provider_access: false, credential_access: false, spend: false, destructive_work: false, wave_activation: "OFF"};
const receipt = compileAuthorityRebindReceipt({
  receiptId: "RECEIPT.AGENTOS.AUTHORITY.REBIND.TEST",
  authority, repair, focusedChecks: ["node:test/observed-dispatch", "node:test/bootstrap-bindings"], custody,
  supersededHistory: [{commit: git("d"), tree: git("e"), status: "HISTORICAL", preserved: true}],
});
validateAuthorityRebindReceipt(receipt);
assert.equal(receipt.receipt_sha256.length, 64);
assert.equal(publicKernel.compileAuthorityRebindReceipt, compileAuthorityRebindReceipt);
assert.equal(publicKernel.validateAuthorityRebindReceipt, validateAuthorityRebindReceipt);
const hostile = (mutate, pattern) => { const candidate = structuredClone(receipt); mutate(candidate); assert.throws(() => validateAuthorityRebindReceipt(candidate), pattern); };
hostile((candidate) => { candidate.receipt_sha256 = null; }, /digest/u);
hostile((candidate) => { candidate.authority.remote_verified = false; }, /verified/u);
hostile((candidate) => { candidate.custody.controller_approval_required = true; }, /approval/u);
hostile((candidate) => { candidate.custody.execution_owner = "CONTROLLER"; }, /lane-owned/u);
hostile((candidate) => { candidate.superseded_history[0].preserved = false; }, /preserved/u);
const schema = JSON.parse(fs.readFileSync(new URL("../schemas/authority-rebind-receipt.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, "https://agentos.dev/schemas/authority-rebind-receipt.v1.json");
console.log("PASS authority rebind receipt: current remote authority is content-addressed, clean, lane-owned, and hostile null/boundary cases fail closed");
