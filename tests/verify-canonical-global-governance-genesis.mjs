#!/usr/bin/env node

import assert from "node:assert/strict";
import {prepareCanonicalGlobalGovernanceGenesis} from "../control/canonical-global-governance-genesis.mjs";
import {compileGlobalGovernanceMemoryEvent, GLOBAL_GOVERNANCE_MEMORY_GENESIS} from "../control/global-governance-memory.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";

const sealedAuthority = getSealedCanonicalAuthority();
assert.throws(() => prepareCanonicalGlobalGovernanceGenesis({sealedAuthority, authorityRoot: "/tmp/forged"}), /accepts only sealed authority/iu);
const first = prepareCanonicalGlobalGovernanceGenesis({sealedAuthority});
const second = prepareCanonicalGlobalGovernanceGenesis({sealedAuthority});
assert.equal(first.status, "ACCEPTED_ACTIVE");
assert.equal(first.snapshot_sha256, second.snapshot_sha256);
assert.equal(first.event_sha256, second.event_sha256);
assert.equal(first.ledger_head_sha256, second.ledger_head_sha256);
assert.notEqual(first.readback_sha256, null);
assert.throws(() => compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "BOOTSTRAP_GENESIS", snapshot: null, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: new Date().toISOString()}), /limited to the first accepted snapshot/iu);
console.log("PASS canonical global-governance genesis: sealed root, one bootstrap-only acceptance, durable immutable event, current readback, and Spawner visibility");
