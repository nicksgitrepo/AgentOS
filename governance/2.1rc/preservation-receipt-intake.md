# Preservation receipt intake and zero-trace gate

Status: `PREPARED_NOT_ACTIVATED`.

After external source-preservation artifacts exist, Bootstrap may perform a
read-only intake. It must independently read every archive, manifest, index,
exclusion record, and receipt; re-observe each source identity and compare the
source content and observation digests; and prove that the clean destination has
zero entries and no AgentOS control plane was created in it.

The intake emits only opaque source, custody, and destination references. It
does not copy, normalize, import, activate governance, or spawn a permanent
role. A policy digest, source commit/tree, source content digest, or artifact
receipt change invalidates the intake and all dependent manifests. The intake
status is not permission to write; it is the prerequisite evidence for the
audited Agent Spawner breakpoint.
