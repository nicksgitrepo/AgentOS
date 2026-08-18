#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalPermanentRoleIds, loadCanonicalPermanentRoleRegistry, resolveCanonicalPermanentRole, validateCanonicalPermanentRoleSet} from "../control/permanent-role-registry.mjs";

const expected = [
  "AGENTOS_CONTROLLER",
  "AGENTOS.PRODUCT_OWNER",
  "AGENTOS.MEMORY",
  "AGENTOS.RUNTIME",
  "AGENTOS.SCHEDULER",
  "AGENTOS.ORCHESTRATOR",
];
const registry = loadCanonicalPermanentRoleRegistry();
assert.deepEqual(canonicalPermanentRoleIds(), expected);
assert.deepEqual(validateCanonicalPermanentRoleSet(expected), expected);
assert.equal(registry.bootstrap_predecessor, "AGENTOS.SPAWNER");
assert.equal(registry.activation, "OFF");
assert.equal(registry.roles.filter((role) => role.human_facing).length, 1);
assert.equal(resolveCanonicalPermanentRole("AGENTOS_CONTROLLER").responsibility, "WORKFLOW_REGULATION_ONLY");
assert.equal(resolveCanonicalPermanentRole("AGENTOS_CONTROLLER").monitor_minutes, 15);
assert.equal(resolveCanonicalPermanentRole("AGENTOS.PRODUCT_OWNER").responsibility, "USER_INTENT_AND_HUMAN_CONVERSATION_ONLY");
assert.equal(resolveCanonicalPermanentRole("AGENTOS.PRODUCT_OWNER").monitor_minutes, 15);
assert.throws(() => resolveCanonicalPermanentRole("AGENTOS.INTENT_REGULATOR"), /not canonical/u);
assert.throws(() => resolveCanonicalPermanentRole("AGENTOS.PROJECT_OWNER"), /not canonical/u);
assert.throws(() => validateCanonicalPermanentRoleSet([...expected].reverse()), /sealed canonical order/u);
assert.throws(() => validateCanonicalPermanentRoleSet([expected[0], expected[0], ...expected.slice(2)]), /sealed canonical order|duplicates/u);

const reconstructed = JSON.parse(JSON.stringify(registry));
reconstructed.roles[0].responsibility = "USER_INTENT";
assert.equal(resolveCanonicalPermanentRole("AGENTOS_CONTROLLER").responsibility, "WORKFLOW_REGULATION_ONLY", "caller reconstruction changed sealed registry authority");

console.log("PASS permanent role registry: sealed six-role order, separate Controller and Product Owner timers/responsibilities, retired Intent Regulator denial, and caller reconstruction isolation");
