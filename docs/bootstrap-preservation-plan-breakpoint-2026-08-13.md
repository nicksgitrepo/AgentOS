# Source-preservation plan breakpoint

Status: `VERIFIED_PLAN` / execution `NOT_AUTHORIZED`

The generic controller now compiles a per-root external archive/manifest plan
for the composed clients/platform/data import. Each repository receives exact
commit/tree/branch/remotes, dirty and untracked ownership, worktree and
submodule coverage, explicit historical-worktree and secret exclusions, five
content-addressed artifact identities, and a restore procedure. The plan binds
to the composed import plan and a distinct external control-plane root.

The plan proves source mutation `DENY`, destination mutation `DENY`, archive
creation `NOT_PERFORMED`, activation `OFF`, independent review required, and
consumer byte-for-byte/zero-trace verification. No archive, manifest, source
copy, destination write, import, spawn, activation, deployment, publication,
authentication, or protected action occurred.

Focused hostile verification passed for missing artifacts, destination/root
collision, weak exclusions, source mutation, and unbound historical worktrees.
The next breakpoint is an owner-bound preservation policy decision for the
observed dirty/untracked state, followed only then by archive creation and
independent readback.
