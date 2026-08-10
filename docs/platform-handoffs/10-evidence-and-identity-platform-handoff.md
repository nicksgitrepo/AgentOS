# Preserved platform handoff: 10-evidence-and-identity


## Platform-foundation handoff — Cycle 1

Audit date: `2026-08-07`

Platform lane: `Evidence and Identity`

Handoff state: `PRODUCTION_CANDIDATE_PENDING_TESTS`

Lane state: `CONTEXT_NEEDED`

Controller admission state: `BLOCKED_PENDING_CLEAN_PUSHED_PLATFORM_CHECKPOINT`

This is a source-bound platform handoff packet for the Controller's platform
foundation gate. It is not a `HANDOFF_READY` lifecycle transition, independent
clearance, merge approval, feature release, activation, or production claim.
The Controller must wait for every platform handoff, independently audit and
merge one platform tree, and release feature lanes only after that merged
platform checkpoint is accepted by the platform gate.

### Baseline identity and source custody

- Committed baseline: `HEAD 590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- Committed baseline tree: `HEAD^{tree} f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- Working-tree state: `DIRTY`; the repaired platform artifacts are untracked
  relative to that baseline. No clean, pushed, remote-equal, merged, or
  activated checkpoint exists in this handoff.
- The newest authoritative merge worktree was inspected read-only at the same
  commit/tree. It does not contain a committed repaired platform checkpoint.
- Repaired local source hashes are recorded below. They bind the candidate
  files to this observed worktree, not to the committed baseline.

### COMPLETE

- The portable shared skeleton is identified: `control/` contains the ESM
  governance kernel and adapters; `schemas/` contains machine contracts;
  `tests/` contains direct and assembled checks; `docs/rapid-foundations/`
  contains public foundation intent and audit history; and `governance/2.1rc/`
  contains the prepared-but-inactive platform workflow.
- The rapid shared integration seam is identified as
  `control/rapid-prototype/index.mjs` plus `tests/verify-rapid-prototype.mjs`.
  It consumes the Evidence-and-Identity contract before exposing the public
  assembled result and before temporary-worker closure.
- The Evidence-and-Identity implementation boundary is explicit in
  `EVIDENCE_LANE_SCOPES`: the contract engine, stable entrypoint, public
  receipt helper, focused test, and receipt schema are the direct lane capsule.
  The shared assembler and assembled test are integration-seam files and must
  remain under one Controller-selected platform owner.
- The repaired contract provides deterministic canonical digests, public
  redaction, source and host-attestation binding, fixed changed-path scope,
  typed result/check states, bounded inputs, hostile H-01 through H-08
  coverage, handoff/closure digests, and fail-closed missing-evidence paths.
- The state transition is explicit: source/actor pre-write match -> bounded
  scope observation -> write/readback -> source recheck and executed-check
  binding -> public receipt -> preserved typed handoff -> independent review.
  `FAIL`, `BLOCKED`, `UNAVAILABLE`, and `NOT_YET_RUN` remain non-accepting
  states; no state transition silently converts them to acceptance.
- No product feature implementation was started by this platform handoff. No
  hidden task, child worker, generic worker, shell stand-in, external action,
  authentication, network access, publication, deployment, merge, push, or
  `2.1rc` activation was attempted.

### MISSING

- A clean, pushed, remote-equal platform checkpoint and its mechanical
  repository proof are missing. The campaign lifecycle explicitly rejects a
  platform handoff without those facts.
- The local focused and assembled tests use controlled host/source fixtures.
  Real native-session source, actor, scope, check, and closure readbacks are
  still required for production evidence.
- A standards-compliant JSON Schema validator has not been run; the focused
  test checks the receipt schema's declared shape without installing packages.
- The adjacent native-session integration check remains red in both local and
  authoritative baselines at the unchanged `Functionality v1` versus
  `Functionality` display-name assertion. It is outside this lane.
- The Controller has not yet supplied the final platform-tree manifest,
  primary owner for shared seams, all peer platform handoffs, or the merged
  checkpoint to audit. Feature lanes therefore remain unreleased.

### PRODUCTION READINESS

`PRODUCTION_CANDIDATE_PENDING_TESTS` only. The candidate is suitable for the
Controller to inspect as platform input, pending real source-bound tests,
clean/pushed custody, independent audit, and the adjacent baseline decision.
It is not production-ready, accepted, merged, released, deployed, or active.

### WHY

The local contract and focused checks now cover the recorded pure-contract
findings, but the current source is an uncommitted dirty worktree and the
remaining runtime proof is fixture-based. The platform gate must establish one
durable, content-addressed shared tree before any feature lane can depend on
the receipt, assembler, schema, or directory boundaries.

### EVIDENCE

| Source-bound artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `control/rapid-prototype/evidence-identity.mjs` | 90 | `ead5faaccb31dd3e4f02883b7cbae3a90b0488196a05d579dc7631796963d32b` |
| `control/rapid-prototype/evidence-identity-contract.mjs` | 600 | `01c503e7cf7324c2feea87d6eb64988e1633fdfd115373af48c7b5fbdee4548b` |
| `control/rapid-prototype/evidence-identity-receipt.mjs` | 267 | `3436dcc4dcbb08ef0643a3c6360cf735a775599511af677a28b9a348298d3783` |
| `control/rapid-prototype/index.mjs` | 897 | `dc3a02dbc38181b6bb4c35a350fdd14130e470b95915eef5219831be585f4d71` |
| `tests/rapid-prototype/evidence-identity.mjs` | 314 | `b002800022e45382b1eae850cb201879fe04d351bd92c369f9c5f8e171dd5ec6` |
| `tests/verify-rapid-prototype.mjs` | 329 | `85bdb2023247f793a4ae1ba6e71e61ab3b1a20f9f38d11970cdeaa7c855d0c5b` |
| `schemas/rapid-prototype-evidence-receipt.v2.json` | 539 | `a7bbf2f3846051cb3668eab32eb3255884697615e2bf936f87237e9a37d31bb5` |

Confirmed local results: the direct Evidence-and-Identity test, assembled
rapid test, canonical rapid lane runner, security/privacy test, code-hygiene
test, source-hygiene check, bootstrap contract bindings, architecture hygiene,
and syntax checks pass. The native-session-team check fails identically in the
local and authoritative baselines at the recorded display-name mismatch.
These results are evidence of the isolated worktree only; they are not a
clean-checkpoint or independent-clearance receipt.

### QUALITY / HYGIENE / MINIMALITY

- Technology facts: production control code is Node ESM (`.mjs`) using the
  built-in `node:crypto` dependency and local ESM imports. It has no runtime
  package dependency, filesystem write, network, provider, or process-spawn
  requirement. Tests use Node's built-in assertions and read the local schema;
  no npm operation was used.
- The public contract is JSON and closed-shape by design. Keep the schema and
  contract versioned together; do not introduce a second receipt shape for a
  feature lane.
- Recommendation: retain the small ESM/built-in implementation and keep
  native host/session adapters in the private control plane. Project-specific
  values should arrive through typed project context, never by adding product
  names, paths, provider identities, or policy to the portable kernel.
- Recommendation: treat `index.mjs`, the assembled test, the receipt schema,
  and any shared generated surface as one Controller-selected primary seam.
  Freeze competing writers and rebind feature consumers after the platform
  checkpoint is merged.
- The architecture split passed the current budget, but the 600-line contract
  engine and 267-line public helper remain a review surface. Any later change
  must be minimal, preserve the fixed scope, and add a focused hostile test.

### SECURITY / PRIVACY / BOUNDARIES

- Public receipts and handoffs may expose classifications, relative admitted
  paths, and content digests only. Exact project roots, Git top levels, actor
  identities, session/thread/host records, raw logs, credentials, and private
  evidence remain control-plane data.
- The platform tree must have one writer, one exact allowlist, one source
  checkpoint, and one content-addressed handoff. A Platform Agent may not
  broaden a lease, edit a feature root, select acceptance, deploy, publish,
  merge, push, or activate a prepared release.
- Feature lanes may consume the published contract and safe receipt summary,
  but may not bypass the source/identity gate, copy private control data into a
  UI or product artifact, or edit shared platform files without Controller
  custody.
- The owner-facing surface should use plain-language states such as
  `Candidate — tests pending`, `Blocked — source evidence required`, and
  `Unavailable — host readback required`. It should not display raw paths,
  session records, credentials, or internal authority labels. No product UI is
  owned or implemented by this lane.
- Keep `2.1rc` `PREPARED_NOT_ACTIVATED` until an explicit activation decision
  is separately recorded.

### BLOCKERS and exact recovery needed

| Blocker | Exact recovery |
| --- | --- |
| Untracked repaired artifacts and broad dirty source | In the isolated platform branch, stage and commit only the admitted platform capsule and directly required shared seam; refresh commit/tree and every path/result/handoff digest. Do not stage unrelated dirty work. |
| No clean/pushed/remote-equal platform proof | Have the Controller read back the exact committed platform checkpoint with `clean: true`, `pushed: true`, matching remote commit/tree, and a content-addressed repository proof before marking the platform lifecycle handoff ready. |
| Controlled fixtures instead of native evidence | Run the direct and assembled checks from that exact checkpoint with real native host/source/actor/scope/check/closure readbacks; preserve typed unavailable/failure results. |
| Schema validator evidence absent | Run the later-approved standards-compliant validator without weakening the no-npm constraint, or record an independently reproducible validator result supplied by the campaign environment. |
| Shared seam ownership is unresolved | Controller selects one primary platform owner and freezes competing writers for `index.mjs`, the assembled test, the receipt schema, and any shared generated contract. Feature lanes wait for the merged checkpoint. |
| EID-08 adjacent regression | The owning native-session path reconciles the versioned display-name contract and reruns `verify-native-session-team`; Evidence and Identity must not repair it. |

### Routing and feature-boundary handoff

1. The Controller waits until every platform capability has submitted its
   source-bound handoff. A partial platform set is not a release signal.
2. The Controller independently audits the exact source, allowlists, shared
   contracts, hostile evidence, UI/privacy boundary, and repository proof.
3. The Controller selects and merges one platform tree as the sole shared
   contract primary. Conflicting platform writers are frozen; consumers are
   rebound to the merged commit/tree.
4. The Controller reruns the platform checks, verifies that the merged public
   payload remains secret-free, and records the independent platform decision.
5. Only after that decision may feature lanes be released. Feature lanes then
   write only their own product roots and focused tests, consume the stable
   platform contract, and route any shared seam back to the Controller.
6. If any step is unavailable or fails, preserve the evidence, keep feature
   lanes held, and route one exact repair or owner decision. Do not substitute a
   feature implementation, stale handoff, or narration for platform clearance.

### Unresolved owner questions

- Which exact files are admitted to the single Cycle 1 platform tree: only the
  Evidence-and-Identity capsule, or also the shared assembler, assembled test,
  and receipt schema? The Controller must publish one allowlist and one primary
  writer before merging.
- Which native host/session readback and which no-npm schema-validation route
  are authoritative for the production-candidate test pass?
- Will the Controller treat the existing `Functionality v1` versus
  `Functionality` failure as a baseline hold for the whole platform gate, and
  which owning lane will reconcile that display-name contract?
- What exact merged platform commit/tree and independent-auditor receipt will
  be the source binding supplied to the later feature lanes?

### Next handoff

Recipient: `CAMPAIGN_CONTROLLER / INDEPENDENT_PLATFORM_AUDITOR`.

Action: wait for all platform handoffs; independently audit and merge one
clean, pushed, source-bound platform tree; rerun the platform checks; resolve or
route the listed owner questions; and only then release feature lanes.

No feature lane is released by this handoff. The honest campaign outcome is
`CONTEXT_NEEDED`: a production candidate exists in the isolated worktree, but
the platform gate remains pending tests, durable source custody, independent
clearance, and the separately owned adjacent regression decision.

