# Audited merge review

Status: `PREPARED_NOT_ACTIVATED`

This worktree is the assembled merge candidate for the existing AgentOS agent results. The review kept the source worktree unchanged and carried the accepted tracked changes together with the corresponding control, schema, documentation, governance, and verifier files into this separate branch.

## Acceptance decisions

- Accepted the existing implementation set as one integrated candidate so the four-library governance work, native-session work, apprenticeship flow, persistent Intent Regulator/Runtime records, campaign lifecycle, rapid-prototype lanes, privacy boundary, release policy, and supporting contracts remain together.
- Excluded the untracked `package.json`. AgentOS has no npm runtime or release dependency. Product discovery may still recognize a product's own package manifest as a read-only project fact.
- Kept synthetic and hostile path/credential strings only where they are explicit verifier fixtures. They are not production records or runtime defaults.
- Kept legacy local-process compatibility code behind its existing explicit boundary. The active campaign path remains native-session based and does not silently fall back to local workers.

## Repairs applied in this merge candidate

- Product worktree commits now use the neutral `Project Worker` identity instead of an AgentOS-branded author or commit message.
- Legacy runtime and supervisor failure records redact subprocess, Git, path, and secret-like error text before persistence or user-facing rethrow.
- Runtime, supervisor, and campaign-record writers reject existing symlinked parent components before creating or replacing files.
- Existing content-addressed binding entries were refreshed after assembly, and the audited privacy/native-route files were added to the normative binding.
- The README and binding no longer advertise or require npm.

## Boundaries reviewed

- Product paths, worktree paths, environment values, session identities, private links, and secret-like values are handled through the persisted-record privacy boundary.
- External handoffs remain separate from the AgentOS repository and are expected to be supplied through host-local configuration or environment references rather than committed paths.
- Operational paths needed to execute a local campaign remain confined to the external runtime authority root; cross-boundary summaries expose opaque references instead of host paths.
- Native host acceptance may establish requested model/reasoning identity when the active host does not return those optional fields; explicit conflicting host values still fail closed. Source, session, progress, handoff, and closure evidence remain required.
- No activation, merge, push, release, deployment, or Product hosting was performed.

## Verification posture

The user requested implementation and audit work without running the test suite. Accordingly, this review performed static inventory, content/privacy scans, binding regeneration, and whitespace review only. Functional acceptance remains pending the user's later request to run verification.
