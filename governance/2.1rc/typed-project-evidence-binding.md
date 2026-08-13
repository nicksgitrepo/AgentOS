# Typed project-context evidence binding

Project-specific facts, source paths, dirty-state observations, provider
identities, and checkpoint readbacks are evidence, not portable AgentOS
authority. They are bound under `typed_project_evidence` with an exact file
digest, `TYPED_PROJECT_CONTEXT_EVIDENCE` classification, and
`current_portable_kernel_input: false`.

The canonical verifier reads and hashes these entries but does not run the
portable-authority scan over their content. This preserves evidence without
allowing a consumer identity or private path to become a kernel rule. A
project-context evidence change invalidates only the dependent project plan or
manifest; it cannot silently alter normative bindings. Promotion into the
portable kernel requires a new generic, source-backed contract and independent
acceptance.

`control/typed-project-evidence-binding.mjs` is the fail-closed selector. It
requires an exact digest, classification, non-authority declaration, safe
repository-relative path, and separation from every normative path. It emits a
content-addressed receipt governed by
`schemas/typed-project-evidence-receipt.v1.json`; the portability verifier may
exclude only the exact paths in that validated receipt. A receipt with a
changed status, hidden exclusion, duplicate path, overlap, stale digest, or
authority escalation is rejected.

The deterministic decision tree is
`gates/typed-project-evidence-binding.gate`. Changes to an evidence path,
digest, classification, selector rule, or portable-path set invalidate the
receipt and dependent project manifests. Existing evidence bytes remain
preserved. Migration requires regenerating and independently verifying the
receipt; it never promotes project evidence into portable authority.
