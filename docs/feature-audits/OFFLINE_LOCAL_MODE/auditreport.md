# OFFLINE_LOCAL_MODE audit report

Feature: `OFFLINE_LOCAL_MODE` — Offline and Local-First Operation  
Audit status: `INITIAL_AUDIT_COMPLETE / REPAIR_IN_PROGRESS`  
Audit date: `2026-08-07`  
Activation status: `PREPARED_NOT_ACTIVATED`

This is an append-only audit and builder record. The authoritative accepted
merge content was read from the current accepted merge checkout before any
write in this isolated worktree. No provider, credential, private path, chat
link, or product identity is recorded here.

## Scope and source readback

The inventory entry identifies exactly these feature sources:

- `schemas/offline-policy.v1.json`
- `control/private-offline-mode.mjs`
- `docs/roadmap.md`

The complete roadmap was read, including the product-boundary rules, the
local-first capability promise and its done criteria, Phases 0–6, deferred
capabilities, and the status-change law. The supporting documentation intent
was cross-read from:

- `docs/rapid-foundations/01-intent-and-scope.md`
- `docs/rapid-foundations/02-bootstrap-and-context.md`
- `docs/rapid-foundations/09-security-and-privacy.md`
- `docs/architecture.md`
- `docs/release-promotion.md`
- `docs/user-guide.md`

The schema and implementation were read together with the adjacent emitted
authorization schema and the private-control hostile-test slice in the
authoritative merge. The authoritative source files were read directly from
the accepted merge worktree; their observed content digests were:

| Source | SHA-256 |
| --- | --- |
| `docs/roadmap.md` | `2d53cd7fc5618d05039edb5549a55b533337051af57ffcbcc2db3edb3cc0f77d` |
| `schemas/offline-policy.v1.json` | `bf0f8a6e3222da7d26b27df39d2e18765a8f4a7da2759086096559b27e6e3442` |
| `control/private-offline-mode.mjs` | `ccb841c736a4090d8fec8e82af0f82af34942b6d2a05aac847f537688d641071` |
| `docs/rapid-foundations/09-security-and-privacy.md` | `37619471720f2863f5602f25611a0143aac3fd84b7845885c4db5714908865d8` |

The source checkout was a dirty accepted-merge worktree, so the hashes above
are content evidence rather than a claim that the merge worktree is a clean
release. The feature inventory marks this lane `NOT_STARTED`; no prior
feature audit report was found.

No feature-specific research record was present in the public source catalog.
The inventory's `research-records-linked-by-owner` marker is not a readable
repository path. This is an evidence unknown, not a blocker for the bounded
policy audit because the roadmap, typed schema, security foundation, and
implementation define the current intent. An owner-linked research record is
still required if later work relies on research-specific claims.

## Intended behavior

The roadmap promises a local-first operation that does not require a provider,
uses checked adapters rather than machine assumptions, and fails safely at
workspace, provider, mismatch, detached, and partial-failure boundaries. The
offline policy is the narrow connectivity boundary for that promise:

1. `OFFLINE_ENFORCED` is the safe default. Local reads, local Git reads,
   control-plane storage, export/import, governance preservation/reset, and
   release-candidate verification may proceed without network, authentication,
   or external writes.
2. Network access is never inferred from a caller claim. A transition to
   `ONLINE_READ_ONLY` requires an explicit owner decision and permits only
   host catalog/read capability.
3. `ONLINE_ACTIONS` requires both owner decision evidence and host capability
   evidence before authentication or external writes can be authorized.
4. A policy's mode, status, booleans, discovery mode, action lists, and
   evidence fields are one coherent contract. A valid digest does not make a
   contradictory policy safe.
5. A prohibited network attempt while offline produces a real `HARD_STOP`.
   No action, including a local action, is authorized while hard-stopped.
   Recovery is an explicit, separately evidenced owner decision.
6. Transitions are state-bound: offline → read-only review → bound online
   actions, or a safe return to offline. A caller cannot skip the review state
   or clear a hard stop without the required authority.
7. Records remain portable and deterministic. They contain opaque references
   and digests only, never resolved machine paths, provider identities,
   credentials, runtime identities, or raw private evidence.

## Actual implementation in the authoritative merge

`control/private-offline-mode.mjs` provides a useful bounded slice:

- `compileOfflinePolicy` emits the three modes, action allow/deny lists,
  workspace binding digest, optional owner/capability digests, and a content
  digest.
- `validateOfflinePolicy` checks exact keys, identity, basic enums, digest
  shape/content, action-list uniqueness, and portable-record hygiene.
- `authorizeOfflineAction` rejects denied or absent actions and returns a
  digest-bound authorization record.
- `transitionOfflinePolicy` supports return-offline, request-online,
  bind-online-actions, and a network-attempted-offline hard-stop event.

The schema requires the policy fields and constrains action names, digests,
mode, and status. The authoritative hostile-test slice exercises the default
offline policy, denial of `NETWORK_READ`, the happy-path online transitions,
workspace binding, and public-record hygiene. It does not exercise malformed
cross-field policies, omitted owner evidence, hard-stop authorization, or
invalid transition predecessors.

## Initial findings

### F-001 — Cross-field policy validation is fail-open

Severity: `P1_SECURITY_BOUNDARY`  
Status: `OPEN`

`validateOfflinePolicy` validates the three booleans independently and only
requires a nonempty `provider_discovery_mode`. It does not require the exact
mode/status/flag/action-list combinations emitted by the compiler. A
recomputed-digest record can therefore claim `ONLINE_READ_ONLY` while carrying
authentication or external-write capability, or claim `ONLINE_ACTIONS` while
carrying restrictive flags and still list protected actions as allowed.

Why it matters: content addressing detects accidental mutation, but it does
not establish that a newly compiled policy obeys the governance contract. A
consumer trusting the record can cross the very boundary the offline feature
exists to protect.

Evidence: `control/private-offline-mode.mjs`, especially the flag check and
mode-specific branches around lines 124–151; the schema leaves
`provider_discovery_mode` as an arbitrary nonempty string.

Builder action: enforce exact mode/status/flag/discovery/action-list/evidence
relationships in the runtime validator and express the provider-discovery and
authorization action constraints in the schemas.

### F-002 — Network read can be enabled without owner evidence

Severity: `P1_OWNER_BOUNDARY`  
Status: `OPEN`

`compileOfflinePolicy` permits `ONLINE_READ_ONLY` with a null
`owner_decision_digest`, and `REQUEST_ONLINE` forwards that optional value.
That allows network access without the explicit owner boundary required by the
security foundation.

Why it matters: network access is an external boundary even when the action is
read-only. The roadmap and security intent require owner choices to remain
explicit; a safe default cannot silently widen connectivity.

Evidence: `control/private-offline-mode.mjs`, lines 81–91 and 179–184;
`docs/rapid-foundations/09-security-and-privacy.md`, intended behavior and
unavailable behavior.

Builder action: require an owner decision digest for `ONLINE_READ_ONLY` and
make `REQUEST_ONLINE` fail closed when it is absent. Capability evidence must
remain absent until `ONLINE_ACTIONS`.

### F-003 — `HARD_STOP` does not stop authorization

Severity: `P1_FAIL_CLOSED`  
Status: `OPEN`

`NETWORK_ATTEMPTED_OFFLINE` changes the policy status to `HARD_STOP`, but
`authorizeOfflineAction` only checks the action lists. The resulting policy
still authorizes local actions such as `LOCAL_READ` and `CONTROL_WRITE`.

Why it matters: the status is presented as a hard stop, while the enforcement
path treats it as ordinary offline mode. This violates fail-closed behavior and
can allow work to continue after the boundary has been crossed without a
freshly reviewed recovery.

Evidence: `control/private-offline-mode.mjs`, lines 156–176 and 185–188;
`docs/rapid-foundations/09-security-and-privacy.md`, fail-closed and hostile
case rules.

Builder action: reject every action while `HARD_STOP`; require an explicit
owner-evidenced recovery before returning to active offline mode.

### F-004 — Transition predecessors are not enforced

Severity: `P1_STATE_INTEGRITY`  
Status: `OPEN`

`REQUEST_ONLINE` and `BIND_ONLINE_ACTIONS` are accepted from any valid policy,
so a caller can skip `ONLINE_REVIEW`. `RETURN_OFFLINE` also clears a hard stop
without an owner decision. The implementation has event names but not a
complete state-bound transition contract.

Why it matters: state-machine bypasses defeat the explicit review and custody
boundaries even when each individual resulting record is well formed.

Evidence: `control/private-offline-mode.mjs`, lines 179–190; the roadmap's
status-change law and the intent foundation's owner-decision law.

Builder action: restrict predecessors to `OFFLINE_ACTIVE → REQUEST_ONLINE`,
`ONLINE_REVIEW → BIND_ONLINE_ACTIONS`, and active online/offline modes → safe
return. A hard stop may recover only through an owner-evidenced return.

### F-005 — Schema consumers can accept under-constrained action records

Severity: `P2_SCHEMA_HYGIENE`  
Status: `OPEN`

`schemas/offline-action-authorization.v1.json` describes `action` as any
nonempty string, rather than the controlled action vocabulary used by the
runtime. The runtime is stricter than the schema, so independent schema
consumers can accept an authorization for an unknown action.

Why it matters: schema/runtime parity is part of the portable contract. A
weaker consumer can become an accidental policy bypass.

Evidence: `schemas/offline-action-authorization.v1.json`, line 11, compared
with `CONTROL_ACTIONS` in `control/private-offline-mode.mjs`.

Builder action: bind the emitted authorization action to the shared controlled
action enum and add focused hostile fixtures for unknown actions and malformed
policy combinations.

### F-006 — Focused hostile coverage is incomplete

Severity: `P2_REGRESSION`  
Status: `OPEN`

The authoritative private-control test checks the happy path and one offline
network denial, but not the four security/state findings above. No focused
offline-only verifier is wired for this feature lane.

Why it matters: the roadmap requires hostile cases, independent evidence, and
regression protection. Without these fixtures the repaired boundary can regress
silently.

Builder action: add a standalone portable verifier covering the mode matrix,
owner requirement, hard-stop denial/recovery, transition predecessor rules,
schema identity, determinism, and absence of private values. Do not run it in
this task; functional tests remain pending by instruction.

## Production readiness and cross-cutting audit

| Lens | Initial result | Required disposition |
| --- | --- | --- |
| Functional intent | Partial bounded policy exists | Repair the four state/authority gaps; keep remote delivery deferred |
| Quality | Deterministic helpers and exact-key checks are present; one unused import is present | Remove dead import and keep the change narrow |
| Hygiene/minimality | Portable records and opaque references are the right shape; feature source is isolated | Add only the required dependency, schemas, verifier, and report |
| Security | Fail-closed intent is present but contradicted by F-001–F-003 | No production candidate until repaired |
| Privacy | `assertPortableRecord` rejects resolved paths, runtime identities, private links, environment values, and secret-like strings | Preserve and test this boundary |
| Durability | Content digests are deterministic; transition history is not persisted by this narrow policy record | Treat the policy as a state receipt; durable event history remains adjacent control-plane work |
| Regression | Happy-path coverage exists; hostile coverage is missing | F-006 |
| Custody | The module emits no filesystem/network/provider side effects; action execution remains an external adapter boundary | Keep execution outside the portable kernel |
| Boundary | Network/auth/external-write flags are typed, but state transitions can bypass review | F-002–F-004 |
| Intent | Owner decision law is documented but not enforced for read-only network access | F-002 |

The bounded offline policy can become a production candidate pending focused
functional tests and independent clearance. It must not be described as a
certified provider adapter, a release activation, a remote-delivery feature, or
a general production-security assessment. `2.1rc` remains prepared and
inactive.

## True blockers and exact recovery

No genuine external blocker is present. The missing feature files in this
isolated checkout are an ordinary builder setup gap, not an unavailable host
capability or an authority/custody boundary. The required recovery is:

1. port the authoritative portable dependency and feature schema/module into
   this worktree;
2. apply only F-001 through F-006;
3. perform a source self-audit and re-audit the changed files;
4. leave functional tests pending, then have an independent checker run the
   focused verifier on the exact candidate; and
5. keep activation and any external provider action pending explicit owner
   authority.

## Builder pass 1 plan

- Add the authoritative portable common primitives required by the feature,
  without importing unrelated accepted-merge changes.
- Repair `control/private-offline-mode.mjs` for exact policy semantics,
  owner-bound online review, hard-stop enforcement, and state-bound recovery.
- Tighten `schemas/offline-policy.v1.json` and
  `schemas/offline-action-authorization.v1.json` to match the runtime.
- Add a focused verifier as regression evidence, but do not execute functional
  tests in this task.
- Append the self-audit and re-audit results below after the repair pass.

## Self-audit after builder pass 1

The builder changed only the feature slice, its required portable primitive,
the named roadmap source, the focused verifier, the canonical verifier's
focused-test list, and this append-only report:

- `control/private-control-common.mjs` — copied byte-for-byte from the
  authoritative accepted feature dependency; it contains only portable
  primitives and host-bound helpers, with no project context.
- `control/private-offline-mode.mjs` — repaired F-001 through F-004 and
  removed the unused `requireRecord` import.
- `schemas/offline-policy.v1.json` — repaired F-001 and F-005 with enum and
  mode-condition constraints.
- `schemas/offline-action-authorization.v1.json` — repaired F-005 by binding
  `action` to the controlled vocabulary.
- `docs/roadmap.md` — copied the authoritative named roadmap source so the
  candidate carries the intent it implements.
- `tests/verify-offline-local-mode.mjs` — added hostile, transition,
  determinism, schema, owner-boundary, and hard-stop coverage for F-006.
- `tests/verify-all.mjs` — added the focused verifier to the existing suite
  list; no unrelated test behavior was changed.
- `docs/feature-audits/OFFLINE_LOCAL_MODE/auditreport.md` — this report.

The self-audit found one maintainability issue in the first repair draft: the
compiler still duplicated the mode flag/discovery mapping after introducing
the single `MODE_CONTRACTS` table. That was corrected immediately so emitted
records and validation share one contract source.

Static evidence completed without executing functional tests:

- `node --check` passed for the new common primitive, repaired policy module,
  and focused verifier.
- JSON parsing passed for both changed schemas.
- `git diff --check` passed with no whitespace errors.
- The copied roadmap and common primitive match the authoritative content
  digests recorded above.
- A changed-file scan found no resolved machine paths, private links,
  credentials, provider tokens, or product-specific identities. Regex source
  used by the portable secret/path guard is policy code, not secret material.
- No command used `npm`; no network, authentication, provider, filesystem,
  or external-write action was performed by the feature code during this
  audit.

Functional tests are intentionally `PENDING` by task instruction. Static
evidence is not being promoted to a functional pass.

## Re-audit after builder pass 1

### Finding disposition

| Finding | Re-audit result | Evidence |
| --- | --- | --- |
| F-001 cross-field fail-open validation | `RESOLVED_PENDING_TEST` | `MODE_CONTRACTS`, exact status/flags/discovery/action sets in `validateOfflinePolicy`, and three schema `allOf` branches |
| F-002 ownerless online read | `RESOLVED_PENDING_TEST` | `ONLINE_READ_ONLY` requires an owner digest in compile, validation, schema, and `REQUEST_ONLINE` |
| F-003 ineffective hard stop | `RESOLVED_PENDING_TEST` | `authorizeOfflineAction` rejects every action for `HARD_STOP`, including local actions |
| F-004 transition predecessor bypass | `RESOLVED_PENDING_TEST` | `REQUEST_ONLINE`, `BIND_ONLINE_ACTIONS`, and offline network-attempt transitions check exact predecessors; hard-stop return requires owner evidence |
| F-005 schema/runtime action mismatch | `RESOLVED_PENDING_TEST` | Provider discovery enum and mode constraints are explicit; authorization action uses `#/$defs/action` |
| F-006 missing hostile coverage | `COVERAGE_ADDED_PENDING_EXECUTION` | `tests/verify-offline-local-mode.mjs` covers malformed records, owner omission, hard stop, invalid predecessors, determinism, and schemas; it is in `tests/verify-all.mjs` |

The re-audit reread the repaired module, both schemas, the focused verifier,
the changed canonical test list, the copied roadmap, and the complete report.
The implementation now matches the bounded intended behavior recorded above:

- offline is the default and has no network, authentication, or external
  writes;
- online read-only is review-bound and cannot carry capability evidence;
- online actions are both owner- and capability-bound;
- hard-stop is enforced at the authorization point;
- state transitions cannot skip review or clear a hard stop silently; and
- content-addressed records remain portable and project-agnostic.

### Remaining findings and limits

1. `FUNCTIONAL_TESTS_PENDING` — the focused verifier and existing broader
   private-control verifier have not been run, per instruction. Exact recovery
   is to run `node tests/verify-offline-local-mode.mjs` and the relevant
   canonical suite on the exact candidate, then record independent evidence.
2. `INDEPENDENT_CLEARANCE_PENDING` — this auditor/builder cannot self-accept
   the candidate. A fresh read-only checker must verify source identity,
   hostile behavior, schema/runtime parity, portability, and no external
   effects.
3. `ROADMAP_SCOPE_PARTIAL` — logical workspace adapters, provider
   certification, portable-instance migration, synchronization, and remote
   delivery remain partial or deferred exactly as the roadmap states. This
   slice does not claim those capabilities.
4. `ACTION_SPECIFIC_AUTHORITY_DEFERRED` — `ONLINE_ACTIONS` is a connectivity
   gate over the controlled action vocabulary, not certification of a real
   provider or a substitute for action-specific delivery authority. Remote
   publication, deployment, authentication, spending, and rollback remain
   owner-bound and deferred.
5. `TRANSITION_HISTORY_ADJACENT` — the policy is a deterministic state
   receipt, not a durable event ledger. A surrounding private control plane
   must retain transition/event evidence if operational recovery requires a
   full history; this is outside the three inventory sources and is not
   silently added here.

None of these is a genuine external blocker. The bounded feature is now a
production candidate pending functional tests and independent clearance, not
an activated release. `2.1rc` remains prepared and inactive.

## Final handoff pending tests

Changed files are limited to the feature source, its portable dependency and
schemas, the named roadmap, focused regression coverage, the canonical test
list, and this report. Evidence available now is static syntax, JSON, diff
hygiene, source-digest parity for copied authoritative inputs, and the
append-only finding history above. Remaining findings are explicitly
`PENDING`, `DEFERRED_SCOPE`, or `INDEPENDENT_CLEARANCE_PENDING`; no finding is
represented as passed merely by narration.

Next action: an independent checker runs the focused verifier and relevant
canonical checks on this exact candidate, records results and any new finding
in a fresh append-only audit pass, and leaves activation to an explicit owner
decision.
