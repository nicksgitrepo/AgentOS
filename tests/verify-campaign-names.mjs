#!/usr/bin/env node

import assert from "node:assert/strict";
import {auditorDisplayName, validateCampaignVersion, workerDisplayName} from "../control/campaign-names.mjs";

const version = "v3.0.3-tb-03";
assert.equal(validateCampaignVersion(version), version);
assert.equal(workerDisplayName("security-privacy", version), "Security Privacy Worker v3.0.3-tb-03");
assert.equal(auditorDisplayName("RAPID_BUILD", version), "Build Auditor v3.0.3-tb-03");
assert.throws(() => validateCampaignVersion("3.0.3-tb-03"), /invalid/u);

console.log(JSON.stringify({status: "PASS", worker: workerDisplayName("functionality", version), auditor: auditorDisplayName("RAPID_BUILD", version)}));
