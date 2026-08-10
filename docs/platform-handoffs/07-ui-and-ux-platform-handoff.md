# Preserved platform handoff: 07-ui-and-ux


## Cycle 1 — platform-foundation handoff: UI/UX

This is a platform-foundation handoff, not product feature implementation. It
is source-bound to the baseline identity below and is intended for the
Controller's platform-tree audit and merge gate.

- `handoff_disposition`: `PRODUCTION_CANDIDATE_PENDING_TESTS` (candidate handoff only; not accepted-live, merged, released, deployed, or activated)
- `lane_readiness`: `CONTEXT_NEEDED` for shared-assembler authority and a rendered/accessibility host; no true external blocker confirmed
- `source_commit`: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- `source_tree`: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- `ui_module_sha256`: `d84d3250d0e477fdb615afcf0d15edb20552bb383dc6349fc7d6011c787bf209`
- `ui_focused_test_sha256`: `c1f1ffa352e1485435a819fabdca2ab0e90312ee17bf2b3371abb0dd2972827d`
- `custody_observation`: the lane module, focused test, and this report are untracked relative to the baseline; the worktree also contains unrelated pre-existing changes. Treat the hashes and admitted path set as the lane proof until the Controller establishes a clean merged tree.

### Shared skeleton

#### Confirmed platform facts

- The public architecture flows from Bootstrap through shared governance,
  role definitions and question projection, source-bound sessions, named
  rapid-prototype lanes, a thin working slice, and the persistent Intent
  Regulator/Runtime.
- The rapid prototype is divided into twelve named behavior lanes. The index
  assembles their public functions and is not a second copy of lane rules.
- The UI lane's current public surface is a dependency-free, native ESM
  plain-text renderer. It emits `agentos.owner_surface.v1` with a stable state,
  label, message, public role, evidence summary, limitation, question/options,
  next action, and text projection.
- No rendered HTML/DOM surface, browser host, or accessibility harness is
  present or proven in this lane. Plain-text/Markdown is the only implemented
  surface.

#### Platform recommendations

- Keep the shared skeleton view-driven: UI consumes typed intent/state/evidence/
  handoff data and never becomes acceptance, routing, role-admission, or
  source-authority logic.
- Retain a text-first fallback as the minimum host-independent surface. Add a
  rendered adapter only behind an admitted capability and the same typed
  contract; do not introduce product branding or provider-specific components
  into the portable kernel.
- Keep shared assembly after all twelve lane handoffs and independent focused
  checks. The Controller should merge one independently audited platform tree
  before releasing any feature lane.

### Directory and custody boundaries

- `docs/rapid-foundations/07-ui-ux.md` is the portable UI/UX foundation and
  normative public boundary.
- `docs/rapid-foundations/07-ui-and-ux-auditreport.md` is this lane's
  append-only audit, repair history, and platform handoff record.
- `control/rapid-prototype/ui-ux.mjs` and
  `tests/rapid-prototype/ui-ux.mjs` are the admitted UI implementation and
  focused-test paths for this lane.
- `control/rapid-prototype/index.mjs` and
  `tests/verify-rapid-prototype.mjs` are shared assembler paths. They are not
  UI-lane write paths and require explicit platform/assembler admission before
  any change.
- `schemas/` remains shared contract authority. The ignored `tmp/` area is
  external control-plane material and is not a public UI inventory.
- Product feature routes, product-specific workflows, branding, provider
  integrations, deployment/release files, and activation controls are outside
  this lane and must remain untouched.

### Technology-stack facts and recommendations

- `package.json` declares native ESM (`type: module`) and Node `>=20`; the
  current UI module has no imports, and its focused test uses Node's built-in
  assertion library. No UI framework, bundler, or runtime dependency is
  established for this lane.
- The repository exposes Node-based verification scripts, but this task used
  direct `node` invocations and did not use npm. The UI implementation remains
  deterministic, dependency-free, and host-independent.
- Recommendation: preserve native Node ESM for the platform kernel and keep
  rendering as a separately admitted adapter. A framework or browser runtime
  should be an owner-approved platform decision only after the rendered-host
  capability and directory custody are recorded.
- Recommendation: admit a machine-readable schema and digest-bound validator
  for `agentos.owner_surface.v1` before downstream feature lanes treat the
  surface as a durable integration contract.

### Routing and feature boundaries

- The UI surface may classify and display `READY`, `WORKING`, `WAITING`,
  `BLOCKED`, `ONE QUESTION`, `UNAVAILABLE`, `PUZZLE`, `SOFT REVIEW`,
  `HARD STOP`, `CONFLICT`, `UNPROVEN`, and `COMPLETE` states, including the
  recorded loading, pending, stale, partial, permission, offline, empty, and
  error aliases.
- Missing proof routes to `UNPROVEN` or `UNAVAILABLE`; contradictory state
  routes to `CONFLICT`; protected or unadmitted content routes to `HARD STOP`;
  `COMPLETE` requires explicit verified evidence. One-question surfaces keep a
  single owner question and a bounded, intact choice list.
- The UI does not create, admit, route, or supervise workers; select providers;
  decide functionality; perform external actions; or convert a handoff into
  acceptance. Feature lanes must call the shared contracts and retain their
  own behavior/acceptance authority.
- Product feature routing must not infer readiness from text alone. The shared
  assembler and evidence/closure owners must reconcile the visible state with
  functionality, source identity, handoff, independent-check, and closure
  status.

### Shared contracts and integration assumptions

- Current public contract: `agentos.owner_surface.v1`, version `1`, with the
  fields listed in the Shared skeleton section. Public role values require an
  explicit admission flag; evidence summaries are public-safe and only explicit
  `PASS`/`PASSED`/`VERIFIED` can verify them.
- The current shared projection still supplies only the legacy
  status/message/question/options/next-step shape. Its public-payload helper
  discards `functionality` and `handoffStatus`; it does not yet bind source
  readback, evidence digest, handoff identity, or closure state into the UI
  surface.
- Required platform integration recovery: explicitly admit the shared
  assembler paths, pass typed public role/evidence/limitation/handoff/source
  state into the projection, and add a regression assertion that visible state
  agrees with functionality, evidence, handoff, independent-check, and closure
  classification.
- Source/session/environment readbacks belong in control-plane receipts, not in
  public text. Public summaries must remain secret-free and must not expose
  paths, credentials, provider/account identifiers, session/thread records, or
  internal routing details.

### UI and design direction

- Put outcome and state first, followed by the admitted public owner, concise
  evidence, material limitation, and one bounded next action.
- Make working/waiting observable, failures recoverable, and unavailable
  capabilities explicit. Never use an endless spinner or disabled control as a
  substitute for a known limitation or evidence.
- When a rendered host is admitted, require semantic structure, keyboard
  operation, visible focus, meaningful labels, text alternatives, contrast,
  zoom/reflow, narrow layouts, long content, empty states, and status that is
  not conveyed by color alone. Until then, retain the text-only pending status
  and do not claim accessibility clearance.
- Keep visual language product-neutral and portable. Product-specific design
  tokens, branding, workflow labels, and feature affordances require a later
  product/design admission outside this platform lane.

### Security, privacy, and custody constraints

- The renderer fails closed for protected paths/URLs, credentials, private or
  raw control-plane records, provider/account/session/thread identifiers,
  internal routing prose, generic/unknown/legacy/unadmitted actors, child
  actors, and unadmitted public roles. It sanitizes markup-like text and does
  not echo hostile inputs in the hard-stop surface.
- No UI-lane code performs filesystem, network, publication, deployment,
  authentication, spending, custody, merge, or activation actions.
- The local lexical privacy patterns remain separate from the shared payload
  scanner; pattern drift is an integration risk. The platform should choose a
  canonical scanner/contract and test the same public payload at both seams.
- The Controller must not merge this handoff from the dirty/untracked working
  state as if it were a clean candidate. First establish exact path custody,
  source/tree proofs, and an independently audited platform tree. Preserve this
  report and the two lane files; do not copy private control-plane evidence into
  the public handoff.

### Unresolved owner questions

1. Does the platform owner explicitly admit `control/rapid-prototype/index.mjs`
   and `tests/verify-rapid-prototype.mjs` for the typed UI reconciliation, and
   who owns the final `owner_surface.v1` schema/digest?
2. Which rendered host and accessibility harness are allowed for the platform
   skeleton, and does text-only fallback qualify as a candidate pending those
   checks or remain `CONTEXT_NEEDED`?
3. Are the two UI lane paths and this append-only report to be tracked in the
   platform tree now? If so, what exact clean-tree/path-proof procedure does
   the Controller require before merge?
4. Which public evidence fields may be shown, and which control-plane source,
   handoff, independent-check, and closure fields must remain receipt-only?
5. Should the shared privacy scanner become the sole authority, or should the
   UI renderer receive an admitted shared pattern/schema contract to prevent
   drift?

### Exact Controller next action

Wait for every platform-foundation handoff, independently inspect this exact
source-bound lane record and the other platform lanes, merge one clean platform
tree under explicit custody, and only then release feature lanes. For UI/UX,
resolve the owner questions above (or preserve the exact `CONTEXT_NEEDED`
decision), then rerun the focused UI test, assembled rapid-prototype test,
public-payload/privacy checks, source/tree/path proofs, and any admitted
rendered accessibility checks. Do not convert this handoff into acceptance or
activation by narration.

