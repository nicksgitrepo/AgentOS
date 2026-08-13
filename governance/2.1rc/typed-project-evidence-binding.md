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
