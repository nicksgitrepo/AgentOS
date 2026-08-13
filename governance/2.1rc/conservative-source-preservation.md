# Conservative source-preservation policy

Status: `PREPARED_NOT_ACTIVATED`.

This portable policy resolves routine preservation choices without waiting for
an owner when the choice is reversible, no-cost, and non-destructive:

1. Preserve every tracked file, tracked modification, and untracked user-owned
   file byte-for-byte.
2. Exclude Git administrative internals only.
3. Exclude a directory only when it is explicitly ignored, reproducible, has no
   tracked descendant, and is named by the current policy.
4. Preserve ambiguous ignored content and all sensitive user content in
   external custody. No file suffix is excluded by default.
5. List every exclusion in the manifest and independently verify it against the
   source observation and archive.

The project overlay may add only typed, content-addressed reproducible
directory names and a project-context digest. It may not add secret, path,
provider, or file-suffix rules. A policy or overlay digest change invalidates
dependent manifests with
`DEPENDENT_MANIFEST_INVALIDATED_POLICY_DIGEST_CHANGED`; those manifests must
be rebuilt and independently accepted before use.

This package is a policy and decision tree only. It does not activate import,
create an archive, alter a source repository, or admit a permanent role.
