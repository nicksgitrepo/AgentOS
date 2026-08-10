# PROJECT_MEMORY_LEDGER audit report

Status: `INITIAL_AUDIT_RECORDED; BUILDER_PENDING`

Feature: `Project Memory Ledger, Replay, and Projections`

This report is append-only for this task. The accepted merge worktree was read as
the authoritative baseline; this isolated worktree is the only writable scope.
The report contains portable summaries and relative repository references only.
No secrets, credentials, private machine paths, provider tokens, or chat links are
stored here.

## Initial audit — intended behavior

The inventory names `schemas/project-memory.v1.json`,
`control/project-memory.mjs`, `control/project-memory-store.mjs`, and
`control/project-memory-projections.mjs` as the feature authority. The roadmap
places this capability under structured memory, recovery, and portable project
capsules. Its intended behavior is:

- canonical project-memory records and append-only events are the rebuildable
  authority; snapshots, invalidations, maps, indexes, capsules, and wiki-like
  views remain derived and non-authoritative;
- every record and event is bound to project, campaign, goal, role, source
  commit/tree/snapshot, policy, and handoff digests;
- append is content-addressed, idempotent, compare-and-swap protected, ordered,
  restart-replayable, and explicit about conflicts and invalidation;
- projections are deterministic, scoped, uncertainty-aware, stale-aware, and
  unable to grant acceptance or activation;
- role capsules carry selected record digests and explicit allowed/prohibited
  scopes without transcripts or host-bound context;
- `2.1rc` remains `PREPARED_NOT_ACTIVATED` and inactive;
- private control storage stays outside the repository and rejects unsafe path,
  environment, secret-like, identity, and private-link material.

Roadmap evidence: `docs/roadmap.md:230-250` and `docs/roadmap.md:386-396`.
Contract evidence: `schemas/project-memory.v1.json:1-674`.
Cross-cutting documentation intent: the code-hygiene, security/privacy,
evidence/identity, recovery/boundary, progress/health, and delivery foundations
require deterministic checks, source binding, truthful unavailable states,
append-only correction, privacy separation, and independent clearance.

## Initial audit — actual implementation observed

The accepted merge contains a useful, project-agnostic implementation surface:

- `control/project-memory-records.mjs` compiles and validates eight record types,
  four event types, binding fields, digests, notices, lifecycle references,
  replay, and conflict descriptors;
- `control/project-memory-store.mjs` keeps JSONL events and JSON snapshots under
  an external authority root, uses a lock, append plus `fsync`, snapshot staging,
  rename, compare-and-swap, regular-file checks, and restart reconstruction;
- `control/project-memory-projections.mjs` compiles advisory snapshots, map/index
  bindings, invalidation status, and role-scoped capsules;
- `tests/verify-project-memory.mjs`,
  `tests/verify-project-memory-replay.mjs`,
  `tests/verify-project-memory-schema.mjs`, and
  `tests/verify-map-memory-contracts.mjs` provide substantial intended coverage;
- `tests/verify-all.mjs` discovers the feature verifiers, but the requested
  functional test run remains pending and no functional pass is claimed.

No feature-specific research record was present in the accepted tree despite the
inventory's `research-records-linked-by-owner` source label. No dedicated public
memory-lane operator or maintainer document was present; the roadmap and general
guides provide the surrounding intent only.

## Initial findings

### PM-001 — supersession event semantics cannot produce a current successor

Severity: `HIGH`; category: functionality, schema parity, regression, durability.

`schemas/project-memory.v1.json:527-529` requires a `RECORD_SUPERSEDED` event's
embedded record to have status `SUPERSEDED`. The runtime repeats that requirement
at `control/project-memory-records.mjs:569-570` and
`607-608`, while replay excludes `SUPERSEDED` records from current state at
`control/project-memory-records.mjs:751-753`. The lifecycle code simultaneously
treats that same record as the newer successor. A valid supersession therefore
cannot leave the successor current. Existing tests validate construction but do
not replay this exact event shape.

Why it matters: restart reconstruction can lose the latest decision/context and
projections can report stale or unavailable state after an otherwise valid
supersession.

Builder action: record the successor as current for a supersession event, align
schema/runtime/tests, and add a replay assertion for old-record exclusion and
successor retention.

### PM-002 — snapshot compilation can trust forged replay metadata

Severity: `HIGH`; category: security, privacy, durability, boundary, intent.

`control/project-memory-projections.mjs:42-55` validates ledger events only when
an optional `replay.events` array is supplied. The replay return at
`control/project-memory-records.mjs:755-765` does not carry those events, so a
caller can provide self-consistent `event_count`, `head_sha256`, current record
digests, and no conflicts without proving that they came from canonical events.

Why it matters: a derived READY snapshot could be manufactured from unverified
state and then used as selective context, weakening the canonical-authority and
source-binding boundary.

Builder action: require a replay event sequence, reconstruct it inside snapshot
compilation, and use the canonical reconstruction rather than caller-supplied
projection fields.

### PM-003 — ledger invalidations disappear unless the caller re-supplies them

Severity: `HIGH`; category: functionality, recovery, regression, intent.

`compileMemorySnapshot` defaults `invalidationRecords` to an empty list and only
uses that argument at `control/project-memory-projections.mjs:80-99`. An
invalidation event already present in the ledger is not derived from replay, so
omitting the optional argument can produce a READY snapshot over invalidated
context.

Why it matters: source/policy/handoff changes can silently leave stale context
eligible for role capsules after restart.

Builder action: derive active invalidation records from canonical replay, validate
any explicitly supplied records against that derived set, and keep stale status
and evidence visible.

### PM-004 — explicit conflicts do not prove the records they name

Severity: `HIGH`; category: security, boundary, regression, custody.

`conflictDescriptorFromRecord` and `validateReplayLifecycle` at
`control/project-memory-records.mjs:681-722` accept arbitrary distinct digests
and a caller-supplied key. The referenced records may be absent or may belong to
different logical keys. The accepted verifier even constructs a conflict whose
key names a goal while its left/right records are unrelated record types.

Why it matters: an unproven conflict can poison every projection and stop safe
work without a canonical contradiction.

Builder action: require both referenced records to exist in the ledger and prove
that both share the explicit conflict key; update fixtures to use two genuine
divergent records.

### PM-005 — supersession may point forward in the event stream

Severity: `MEDIUM`; category: replay, durability, regression.

`validateReplayLifecycle` builds `recordsByDigest` for the whole stream before
checking `supersedes_record_sha256` (`control/project-memory-records.mjs:690-719`).
A successor can therefore reference a record that appears later, making replay
depend on a future event rather than the prior canonical head.

Builder action: track event sequence by digest and reject a supersession target
whose event sequence is not earlier than the successor.

### PM-006 — context projection can resurrect a superseded context

Severity: `MEDIUM`; category: functionality, recovery, regression.

Snapshot compilation chooses context from `replay.latest_records` at
`control/project-memory-projections.mjs:87-90`, while supersession filtering is
performed only for `replay.current_records`. If the latest context version is
invalidated, the reverse scan can select an older context whose digest is already
superseded.

Builder action: choose context only from the canonical current-record set and
retain explicit uncertainty when no current context exists.

### PM-007 — store recovery and file-boundary checks are incomplete

Severity: `MEDIUM`; category: durability, security/privacy, hygiene.

`control/project-memory-store.mjs:122-133` filters blank JSONL lines instead of
validating every line. Append does not validate the existing ledger before the
idempotent fast path at `:187-204`, expected head values are not shape-validated,
broken symlinks can look absent through `existsSync`, and snapshot rename does
not fsync the parent directory. Lock descriptor cleanup is also not exception
safe.

Why it matters: crash remnants, malformed records, or a path race can be treated
as an empty/accepted authority, and a successful write may not survive restart.

Builder action: make line parsing strict, validate before any append result,
validate expected digests, use lstat-based absence checks, close lock descriptors
on all paths, and fsync the containing directory after atomic replacement.

### PM-008 — optional map/index bindings are under-scoped

Severity: `MEDIUM`; category: custody, boundary, intent, regression.

`control/project-memory-projections.mjs:56-70` checks only that a project map or
derived index has the same project reference. Campaign, goal, and role scope are
not checked for the map, allowing a valid projection from another campaign or
role to be attached to this snapshot.

Builder action: require campaign and goal equality and require the snapshot role
to be within the map role scope before accepting the dependency.

### PM-009 — role capsule scopes may contradict each other

Severity: `LOW`; category: boundary, security/privacy, hygiene.

`compileRoleContextCapsule` validates each scope list independently at
`control/project-memory-projections.mjs:221-224` but permits the same scope in
both allowed and prohibited lists.

Builder action: reject overlap deterministically and add a hostile boundary case.

### PM-010 — documentation and research evidence are incomplete

Severity: `MEDIUM`; category: documentation, evidence, production readiness.

The inventory points to owner-linked research records, but none were available
in the accepted source catalog. The general roadmap and guides describe memory
posture but do not document this API's replay, storage, projection, or recovery
contract. This is an evidence gap, not permission to invent owner research.

Builder action: add a project-agnostic feature document covering authority,
replay, storage boundaries, projection states, privacy, and unavailable behavior;
record research as unavailable rather than fabricating it.

### PM-011 — small hygiene/minimality debt

Severity: `LOW`; category: quality, hygiene, minimality.

The accepted memory support contains unused helpers (`requireBoolean` and
`categoryForText`) and redundant per-item notice validation. These do not change
authority but make the feature harder to audit and suggest untested branches.

Builder action: remove dead helpers and keep validation single-purpose while
preserving the public API.

## Initial production-readiness assessment

Disposition: `OPEN_REPAIR; NOT_PRODUCTION_READY`.

The candidate has a strong contract skeleton, privacy boundary, content-addressed
records, external storage root, CAS/idempotency intent, and non-authoritative
projections. It is not ready for production acceptance because PM-001 through
PM-008 affect correctness or custody, PM-010 leaves the documented intent and
research chain incomplete, and functional tests are explicitly pending. No
external authority, unavailable host capability, credential, or custody boundary
blocks the repairs.

## True blockers and exact recovery

No genuine external blocker is present. The missing owner-linked research is an
unknown that can be honestly recorded; it does not prevent a conservative
project-agnostic implementation. Functional verification is pending by explicit
task instruction. Recovery is: complete the recorded repairs, perform static
syntax/schema review without npm, then request the separately authorized
functional test run and independent clearance. Do not activate `2.1rc`.

## Builder actions for the next pass

1. Port only the memory feature and its minimal shared privacy/content-addressing
   and map/index validation dependencies into this isolated worktree.
2. Apply PM-001 through PM-011 without expanding into unrelated capabilities.
3. Add focused hostile/regression fixtures for supersession, forged replay,
   replay-derived invalidation, conflict provenance, path/line durability, map
   scope, and capsule scope overlap; leave execution pending.
4. Add the project-agnostic feature documentation and append a self-audit entry.
5. Re-audit every finding, preserve this section unchanged, and append resolved
   history, remaining findings, evidence, and the next action.

## Builder pass and self-audit

Status: `REPAIRED; RE-AUDIT_COMPLETE; PRODUCTION_CANDIDATE_PENDING_TESTS`

The isolated builder ported the memory feature and only the minimal shared
content-addressing/privacy and map/index validation dependencies required by its
projection API. It also wired the feature verifiers into the repository's
existing aggregate verifier without running them.

Changed files:

- `control/project-memory-records.mjs`, `control/project-memory-projections.mjs`,
  `control/project-memory-store.mjs`, and `control/project-memory.mjs`;
- `schemas/project-memory.v1.json`;
- `control/content-addressing.mjs`, `control/persisted-record-privacy.mjs`,
  `control/map-memory-common.mjs`, `control/project-map.mjs`, and
  `control/derived-index.mjs`, plus their four projection schemas;
- `docs/project-memory-ledger.md`, `docs/README.md`, and `control/README.md`;
- `tests/verify-project-memory.mjs`,
  `tests/verify-project-memory-replay.mjs`,
  `tests/verify-project-memory-schema.mjs`, and `tests/verify-all.mjs`;
- this append-only report.

## Re-audit of initial findings

| Finding | Re-audit result | Evidence and disposition |
| --- | --- | --- |
| PM-001 | `RESOLVED` | Supersession events now carry a `CURRENT` successor in `schemas/project-memory.v1.json:528` and `control/project-memory-records.mjs:560-599`; replay tests cover named supersession and successor retention. |
| PM-002 | `RESOLVED` | `control/project-memory-records.mjs:745-814` returns the event sequence; `control/project-memory-projections.mjs:40-60` requires it and rebuilds replay from events, ignoring forged projection fields. A missing event sequence is hostile-tested. |
| PM-003 | `RESOLVED` | `control/project-memory-projections.mjs:88-113` derives active invalidations from canonical current records, validates affected record references, and keeps the snapshot `STALE`; the stale test omits the optional invalidation argument. |
| PM-004 | `RESOLVED WITH EXPLICIT-UNKNOWN SIDE` | Available conflict references must match the declared logical key at `control/project-memory-records.mjs:719-739`; both-unavailable references raise `CONFLICT_REFERENCES_UNAVAILABLE`. A rejected candidate may be absent from the ledger, but remains an explicitly unresolved digest side rather than silently becoming truth. Fixtures now use a real known side plus a candidate digest. |
| PM-005 | `RESOLVED` | `control/project-memory-records.mjs:681-718` records first-seen event sequence and rejects future supersession targets with `SUPERSESSION_TARGET_NOT_PRIOR`; replay coverage includes the forward-reference hostile case. |
| PM-006 | `RESOLVED` | `control/project-memory-projections.mjs:109-113` selects context only from `current_records`; an invalidated successor cannot resurrect a superseded predecessor. A focused regression fixture expects `UNAVAILABLE`. |
| PM-007 | `RESOLVED AS TYPED BOUNDARY` | `control/project-memory-store.mjs:86-162` uses lstat-based file checks and strict line parsing; `:202-250` validates the existing ledger before idempotency and append; expected heads are SHA-validated; `:117-125` fsyncs directories after durable replacement; lock descriptors close on all paths. An existing live lock remains an explicit `LEDGER_LOCKED` conflict; host-local recovery must verify the writer before removing a transient lock and then re-read the head. |
| PM-008 | `RESOLVED` | `control/project-memory-projections.mjs:61-79` validates project, campaign, goal, and bound-role scope for map dependencies. |
| PM-009 | `RESOLVED` | `scopesOverlap` is enforced during both capsule compilation and validation at `control/project-memory-projections.mjs:243-251` and `:313-315`. |
| PM-010 | `RESOLVED FOR DOCUMENTATION; RESEARCH UNKNOWN PRESERVED` | `docs/project-memory-ledger.md` documents authority, replay, storage, projections, privacy, and unavailable behavior; the report still records that no owner-linked research record was available and makes no research claim. |
| PM-011 | `RESOLVED` | Redundant notice validation and the unused memory boolean helper were removed; the unused privacy categorizer was removed from the shared scanner while preserving its public scan/redaction behavior. |

## Self-audit quality and boundary lenses

- Functionality: record/event compilation, ordered replay, supersession,
  invalidation, conflict, snapshot, capsule, and store paths are represented;
  execution evidence remains pending.
- Quality/hygiene/minimality: public exports remain split between canonical
  records, projections, and storage; shared helpers are reused; no unrelated
  provider, product, or activation behavior was added.
- Security/privacy: canonical records, events, snapshots, and capsules remain
  `CONTROL_SPACE`, advisory projections cannot authorize acceptance, and the
  shared scanner rejects unsafe persisted content. The public feature document
  contains no machine-specific identity or host path.
- Durability/regression: strict JSONL parsing, sequence/head checks, pre-append
  validation, idempotency, CAS, staged snapshot replacement, file/directory
  fsync, readback validation, forward-supersession rejection, and re-audit
  fixtures are present.
- Custody/boundary/intent: external authority-root storage is separate from the
  repository, source/policy/handoff bindings are retained, maps are scope-bound,
  capsules have non-overlapping scopes, and `2.1rc` remains inactive.

## Evidence, unknowns, and remaining findings

Static evidence completed in this pass:

- `node --check` passed for all changed JavaScript modules and focused verifiers;
- JSON parsing passed for the memory and projection schemas;
- whitespace/diff hygiene passed with `git diff --check`;
- a repository scan found no secrets, credentials, private machine paths, or
  private links in the audit report, feature document, memory sources, or memory
  contract;
- focused hostile fixtures were added but deliberately not executed.

Functional verifiers remain `PENDING` by task instruction, as does independent
clearance. Owner-linked research remains `UNKNOWN` because no record was
available. The live-lock recovery route is intentionally a typed host-local
operational boundary, not an automatic deletion or success claim. These are
remaining evidence/operational qualifications, not implementation blockers.

## Final disposition and next action

Disposition: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS_AND_INDEPENDENT_CLEARANCE`.

No genuine external blocker exists. The exact next action is to run the three
feature verifiers and the aggregate verifier under the separately authorized
functional-test step, then obtain independent clearance against this report and
the same source tree. Do not activate, publish, merge, deploy, or rebind `2.1rc`
from this task.

## CURRENT STATE — central intake projection

- candidate source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- candidate source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d`
- source worktree: `HOST_WORKTREE_431F`; preserved dirty entry count: `23`
- handoff digest: `1bd062459462b039d93f575b7adecb9ec7166ae42ea37d4908fa3b81aacd81e6`
- central intake: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`
- current disposition: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS_AND_INDEPENDENT_CLEARANCE`
- integrated boundary: replay provenance, canonical invalidation derivation, conflict/supersession validation, scope isolation, privacy, lock and durability hardening, memory schemas, documentation, and focused verifier sources
- superseded identities: central pre-integration bytes are preserved under this feature custody directory
- unresolved material seams: functional verifiers remain unrun by instruction; owner-linked research remains unknown; exact visible-task and goal parity remains unverified
- proof ceiling: static source, schema, hygiene, and privacy review only; no functional or clean-candidate proof claimed
- downstream consumed: `false`
- immediate next action: central independently re-audit these candidate-backed deltas and update the binding projection before any task/worktree archival
