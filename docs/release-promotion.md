# Development and release boundary

The active development checkout and the sterile release checkout are separate
roles. The development checkout may contain work in progress. The sterile
release checkout is not assumed to contain those changes.

`control/release-promotion-gate.mjs` compiles a small, content-addressed
promotion record from typed checkout identities and verification results. It
does not copy files, publish, push, merge, deploy, or activate anything.

The current record is
`docs/release-development-promotion-blocker.v1.json`. It is intentionally
blocked until the sterile release checkout has its own verified identity, the
exact changed paths have been reviewed, the required suites have been rerun
there, and the maintainer explicitly chooses promotion.

The additive release sequence is:

1. allocate a monotonic test-build identity;
2. build an exact artifact manifest from portable payload files, excluding VCS
   metadata and rejecting symlinks or private content;
3. bind each migration to its immutable source digest and classify its
   provenance as `JOURNALED`, `INTENTIONALLY_JOURNALESS`, or
   `MISSING_OR_UNPROVEN`; intentionally journal-less migrations require
   read-only fingerprints for load-bearing schema objects and failed or
   mismatched provenance stays blocked;
4. independently verify old/new/mixed-version behavior, failed and interrupted
   cutovers, reconciliation, and rollback;
5. replay governance decisions and model-check reachability, termination,
   bypass resistance, recovery, and owner control;
6. bind the passing release-safety gate to the sterile-verified candidate and
   retain the predecessor digest; and
7. require an explicit owner decision plus a host readback receipt for any
   replacement.

No portable record publishes, pushes, merges, deploys, or activates a release.
`2.1rc` remains prepared and inactive until the consuming control plane records
a separate explicit owner activation decision. Missing, stale, failed,
interrupted, or unavailable safety evidence keeps the candidate blocked.
