#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileControllerWorkflowMonitorTick} from "../control/controller-workflow-regulator.mjs";
import {compileProjectOwnerMonitorTick} from "../control/project-owner-bootstrap.mjs";
import {runContinuousOperatingLoopIteration} from "../control/continuous-operating-loop.mjs";

assert.throws(() => runContinuousOperatingLoopIteration({}), (error) => error.code === "RETIRED_ROLE_AUTHORITY_FORBIDDEN");
assert.equal(compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: false, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: true}).status, "TRUE_BLOCKER");
assert.equal(compileProjectOwnerMonitorTick({minutesSinceLastCheck: 15, intentAligned: true}).status, "INTENT_ALIGNED");
assert.throws(() => compileProjectOwnerMonitorTick({minutesSinceLastCheck: 0, intentAligned: true}), /not due yet/u);

console.log("PASS Controller intent hardening: retired combined loop is denied, Controller owns progress, and Product Owner owns due intent checks");
