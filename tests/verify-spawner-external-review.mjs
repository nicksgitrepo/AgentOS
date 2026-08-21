#!/usr/bin/env node

import assert from "node:assert/strict";
import {resolveCanonicalSpawnerBootstrapPackage} from "../control/spawner-bootstrap-governance.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "../control/protected-spawner-review-provisioning.mjs";
import {installExternalSpawnerReviewStore} from "../control/spawner-external-review.mjs";

const sealedAuthority = getSealedCanonicalAuthority();
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /not provisioned|handoff|required/iu);
assert.throws(() => prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot: "/tmp/attacker"}), /caller-selected external review roots are forbidden/iu);
assert.throws(() => installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning: Object.freeze({})}), /forged|reconstructed|provisioning/iu);
console.log("PASS external Spawner review: canonical fixed-root provisioning is required; caller-selected stores and forged capabilities fail closed");
