# Preserved platform handoff: 04-role-routing


## Platform-foundation handoff — Role Routing

### Disposition

`SOURCE-BOUND PRODUCTION-CANDIDATE-PENDING-TESTS`

This is a platform-foundation handoff, not a product-feature handoff. Role
Routing has not started product feature implementation and does not release any
feature lane. The Controller must collect all platform-foundation handoffs,
independently audit and merge one platform tree, and only then release feature
lanes.

### Source binding and evidence boundary

The audit and repair were performed against the recorded candidate snapshot:

- source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- Role Routing implementation: `control/rapid-prototype/role-routing.mjs`,
  SHA-256 `d00d64603d54f8bee0023db11d26ef5eb505b051979485c9f5f66ae96ffb0dcd`
- focused hostile test: `tests/rapid-prototype/role-routing.mjs`, SHA-256
  `e1803b3254de532db490cded03ae3a9fe17b9dde4f49edc7e02c9bcaf7b9b1be`
- foundation contract: `docs/rapid-foundations/04-role-routing.md`, SHA-256
  `806756c30d79093bb15b57e1f620fb8d7d5b5bd57f716edc65443865d0963d3a`

The candidate snapshot was observed dirty, and the two implementation paths
remain untracked in that snapshot. This is an explicit acceptance condition,
not a claim that the source is clean. The parent must create a fresh clean
exact snapshot and independently verify the hashes before merge or feature-lane
release.

### Shared skeleton and directory boundaries

Role Routing's platform boundary is the deterministic, project-agnostic ESM
admission helper and its focused test:

- owned by this lane: `control/rapid-prototype/role-routing.mjs`;
- owned by this lane: `tests/rapid-prototype/role-routing.mjs`;
- owned by this lane: this audit and handoff report;
- not owned by this lane: `control/rapid-prototype/index.mjs`,
  `tests/verify-rapid-prototype.mjs`, schemas, the public plan, other lane
  modules/tests, product files, or the authoritative merge worktree.

The shared skeleton/assembler remains the Rapid Slice Builder's integration
surface after platform handoffs; delivery/closure owns lifecycle custody. The
Role Routing lane supplies an admission decision and a redacted summary. It
must not grow a UI, product data layer, provider integration, feature module,
roster/archive implementation, or shared-index edit. No such feature work was
started in this task.

### Technology-stack facts and recommendations

Facts established from the source and direct checks:

- the implementation is Node ESM in `.mjs` files;
- the helper is deterministic and uses no filesystem, network, package, or
  provider dependency;
- the focused and assembled checks pass through direct `node` invocations;
- the contract already calls for `process.execPath` and a bounded direct-Node
  verification sequence;
- no npm command was used or added.

Recommendation: retain the built-in Node ESM baseline and direct, bounded
checks. Do not add a package manager dependency or infer a product technology
stack from this platform lane. The controller should record the supported Node
runtime in its clean-source acceptance receipt, then run source snapshot,
bounded scan, focused hostile tests, and the assembled platform test in that
order.

### Routing and feature boundaries

The implementation now admits only the canonical project-agnostic role
registry and role-to-phase map. It permits the independent-sibling topology
and rejects generic, compatibility, recursive, shell, unknown, and other
non-canonical substitutes. Phase and optional role-packet metadata are checked
against the canonical definition. Tailored roles remain unavailable until the
recorded gates allow them.

Role Routing is only the admission boundary. It does not choose product
features, implement feature behavior, or authorize a feature lane. The
assembler's separate native host-authority check remains the upstream source
gate. A direct helper result with `source_binding_status: "DELEGATED"` is an
explicit non-clearance and must never be promoted to `MATCH` without the
strict host-readback packet.

### Shared contracts for the platform merge

The stable public contract is:

- schema: `agentos.role_routing_admission.v1`;
- canonical exports: `ROLE_ROUTING_ROLES`, `ROLE_ROUTING_TOPOLOGIES`, and the
  typed `RoleRoutingError` code/status boundary;
- required admission inputs: canonical role request, expected project/cwd,
  structured positively verified session identity, and—when source-bound—the
  expected source plus authoritative host readback for project, cwd, Git top
  level, exact commit/tree, and required capabilities;
- optional role-packet inputs must agree on canonical role, public name, phase,
  bounded goal, and bounded output;
- successful output is a frozen redacted summary containing status, canonical
  role/phase/topology, identity status, source-binding status, and capability
  status, with no raw project, cwd, session, or private-path values.

The Controller should bind these fields to the public plan/schema and reject
role-ID, casing, phase, or status drift. `DELEGATED` is useful for the existing
assembler compatibility boundary, but it is not a platform clearance state.

### UI/design direction

Role Routing owns no UI or product surface. Any owner-facing platform surface
should expose only concise plain-language states derived from the safe summary:
admitted, unavailable, or hard stop, with evidence pending shown as pending.
It should not display raw session records, filesystem paths, credentials,
provider/account identifiers, or an apparent success when source evidence is
delegated or incomplete. The UI/design lane should choose presentation and
accessibility details; this lane supplies only the stable status boundary.

### Security, privacy, custody, and durability constraints

- Keep admission source-bound to native host readback for any clearance claim;
  compare exact project/cwd/Git top-level, commit, tree, and capabilities.
- Keep structured identity proof and role packets typed, bounded, and
  fail-closed; do not accept caller-list authority, plain session strings, or
  generic/recursive/shell substitutes.
- Keep raw identity, paths, session records, credentials, provider/account
  values, and private references out of returned summaries and handoffs.
- Preserve deterministic frozen results, stable schema/error codes, and
  direct hostile coverage; do not weaken the boundary for convenience.
- Preserve handoff custody and independent clearance. The Controller owns the
  platform merge gate; delivery/closure owns archive, removal, and zero-active
  lifecycle proof. Feature lanes remain held until that gate is complete.
- Do not clean, reset, overwrite, activate, merge, push, or release from this
  lane; the dirty/untracked state must be resolved by the parent through a
  fresh exact snapshot.

### Unresolved owner questions

1. Must every direct `admitRole` caller provide the strict native host-readback
   packet, or is assembler compatibility mode intentionally retained with
   `DELEGATED` plus a separate authority check? The answer determines whether
   delegated mode is transitional or part of the platform contract.
2. Which source is authoritative for canonical role IDs, public names, and
   phase mapping: this registry, the public plan/schema, or a native-session
   registry? The Controller should choose one source and add drift evidence.
3. Where are roster uniqueness, one-owner custody, typed cross-lane handoff,
   archive/removal, and zero-active closure enforced, and what shared handoff
   schema does the skeleton consume?
4. What exact platform-owned directory manifest and supported Node runtime will
   the Controller accept as the shared skeleton baseline?
5. How will UI/UX represent `DELEGATED`, unavailable, hard-stop, and pending
   evidence without exposing private references or implying clearance?
6. What independent acceptance test set and clean-source receipt are required
   before the Controller releases feature lanes?

### Exact next steps for the Controller and later same-lane owner

1. Hold feature-lane release; collect every platform-foundation handoff.
2. Create one fresh clean exact source snapshot, verify the recorded commit,
   tree, and implementation/test hashes, and preserve this report's repair
   history.
3. Independently audit and merge one platform tree. Run the direct syntax,
   focused hostile, and assembled platform checks; retain their output as
   evidence rather than treating this lane's self-check as clearance.
4. Resolve the six owner questions above, especially strict-vs-delegated
   source binding and canonical role-registry authority, before changing the
   public contract.
5. If a same-lane builder is later authorized, it may repair only findings
   recorded in this report, append a dated resolution entry, and repeat the
   re-audit. It must not edit the shared assembler, schemas, other lanes, or
   product features.
6. Release feature lanes only after the Controller records the independent
   platform merge decision, clean-source receipt, cross-lane handoff custody,
   and lifecycle/zero-active evidence.

### Platform handoff decision

`READY FOR CONTROLLER PLATFORM MERGE GATE — PRODUCTION CANDIDATE PENDING TESTS`

The Role Routing lane is complete for this platform gate, with the independent
clean-source and test evidence still pending. No feature lane is authorized by
this handoff. The exact next action is the Controller's independent platform
audit/merge of one clean tree, followed by the recorded acceptance checks and
only then feature-lane release.

