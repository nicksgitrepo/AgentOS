#!/usr/bin/env node

import assert from "node:assert/strict";
import {prepareAgentSpawnerBootstrapAuthority} from "../control/spawner-bootstrap-preparation.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "../control/protected-spawner-review-provisioning.mjs";

const sealedAuthority = getSealedCanonicalAuthority();
assert.throws(() => prepareAgentSpawnerBootstrapAuthority({sealedAuthority}), /separately controlled evaluator handoff/iu);
assert.throws(() => prepareAgentSpawnerBootstrapAuthority({sealedAuthority, evaluatorProvisioning: Object.freeze({}), reviewProvisioning: Object.freeze({})}), /only sealed canonical authority|caller authority/iu);
assert.throws(() => prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot: "/tmp/attacker"}), /caller-selected external review roots are forbidden/iu);
console.log("PASS Spawner Bootstrap preparation: absent canonical handoff fails closed; caller-selected evaluator/review roots are rejected; no production signing key ships");
