# Memory verification repair candidate

Status: `READY_FOR_OWNER_REVIEW`

## Declaration

- Authorities checked: repository `AGENTS.md`, Project Memory public API,
  canonical record and replay contracts, file-store transport, privacy public
  projection and reconciliation, Bootstrap binding, and affected tests.
- Task classification: portable Memory and verification repair.
- Bounded outcome: repair the three failures exposed by the adaptive Bootstrap
  audit without activating Memory, importing private control data, or changing
  consumer projects.
- Authority boundary: portable AgentOS source, tests, binding digests, and this
  handoff only.
- Non-goals: Rapid Prototype repair, release activation, private payload export,
  provider work, migration, deployment, and public release.
- Stop condition: the three failed checks and their adjacent Memory, privacy,
  Bootstrap, architecture, portability, and source-hygiene suites pass from a
  clean content-addressed candidate.
- Source inspected: Bootstrap candidate commit
  `abca401e4c7b6ba7762feb4ebdfa5ca6932ec6bd`, exact affected modules, schemas,
  public projection records, reconciliation record, and historical blame.
- Preserved work: adaptive Bootstrap, Specialist Block Library, Agent Builder,
  release, consumer-project integrations, and private control payloads.

## Repairs

1. Project Memory store now imports its SHA-256 validator from the shared
   Memory validation module that actually owns and exports it. The public
   Project Memory facade remains limited to the documented public API.
2. Explicit conflict records may retain digest references to divergent
   candidates that were never appended to the canonical ledger. If either
   referenced record is present, logical-key validation remains fail-closed.
   A hostile mismatched-key fixture proves that boundary.
3. Portable privacy verification no longer requires the sibling private
   control repository to exist. It always validates the public projection and
   hash-bound reconciliation. When the private manifest is available, it also
   performs exact raw-digest, semantic-digest, count, and payload-digest
   readback. No private payload is copied into the portable repository.
4. The Memory capsule hostile assertion now matches the current, clearer
   disjoint-scope diagnostic.

## Verification

Passed:

- persisted-record privacy bounded scan with zero findings;
- private-control portability and hostile boundaries;
- Project Memory replay, schema, store, snapshots, capsules, invalidation,
  conflicts, privacy, CAS, restart, and hostile cases;
- map/Memory contracts;
- all Bootstrap verification suites;
- portability;
- source hygiene;
- architecture hygiene;
- exact normative binding readback; and
- whitespace checks.

The repository-wide runner now advances beyond all three repaired failures.
Its next failure is the inherited Rapid Prototype verifier expecting
`UNAVAILABLE` while the current role-routing contract returns `HARD_STOP` for
an identity lacking the newly required real host-readback fields. That exact
failure reproduces unchanged at source commit
`abca401e4c7b6ba7762feb4ebdfa5ca6932ec6bd` and is outside this Memory repair
slice. No whole-repository or release clearance is claimed.

## Disposition

`READY_FOR_OWNER_REVIEW`

The three requested failures are repaired within their stated evidence
ceiling. Memory remains prepared and inactive.
