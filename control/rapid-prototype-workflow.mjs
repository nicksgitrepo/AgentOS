#!/usr/bin/env node

/*
 * Compatibility name for the canonical rapid-prototype entry point.
 *
 * The old feature-first workflow no longer owns orchestration.  All exports
 * below come from the audit-driven integration pyramid so Bootstrap, the
 * Intent Regulator, and callers using the historical module name execute the
 * same platform foundation -> feature -> central state machine.
 */

export * from "./audit-driven-integration-pyramid.mjs";

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("rapid-prototype workflow is the audit-driven integration pyramid\n");
