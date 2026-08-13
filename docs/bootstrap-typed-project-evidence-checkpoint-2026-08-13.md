# Typed project-context evidence binding checkpoint — 2026-08-13

Status: `TYPED_PROJECT_EVIDENCE_BOUND; PORTABLE_SCAN_REPAIRED`.

The canonical verifier found that a preservation and import checkpoint was
evidence rather than portable authority but was still listed under the
normative binding. The portable repair moves such checkpoint readbacks into
the generic `typed_project_evidence` binding, requires an exact digest and
classification, and asserts `current_portable_kernel_input: false`. The
verifier hashes and reads these records while intentionally excluding their
consumer-specific content from the portable-authority scan.

The repair is generic; no consumer identity is embedded in the kernel. The
focused binding readback, synthetic Spawner round trip, spawn-preparation,
context-intake, and preservation-intake tests pass. No source or destination
was mutated and no role was spawned or activated.

The evidence ceiling is local binding and hostile-fixture verification. The
canonical full verifier was previously stopped after exposing this exact
classification defect; the focused replacement proof is recorded above. The
next breakpoint is a fresh canonical verifier run and then independent review
of the permanent Spawner admission gate.
