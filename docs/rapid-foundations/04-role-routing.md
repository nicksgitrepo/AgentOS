# Foundation: Role routing

Public lane: `Role routing`

This foundation defines how a thin governance prototype admits, names, routes,
and closes roles. It is a portable contract: project context, source identity,
session identity, capabilities, and evidence values are supplied by the
control plane at runtime and are not part of this public document.

## Boundary

In scope:

- admit only roles named by the recorded plan and current phase;
- keep the persistent coordinator, the persistent Runtime, temporary
  foundation siblings, later tailored roles, and audit roles distinct;
- route one bounded goal to one named owner with one bounded output;
- require host readback of identity, project binding, working directory,
  source commit, source tree, and capabilities before a role writes;
- preserve exact handoffs and classify puzzles, soft reviews, hard stops, and
  later Iteration work; and
- close temporary roles without carrying their roster into a later campaign.

Out of scope:

- product-specific role names, provider routes, authentication, remote work,
  spending, publication, deployment, release, or production operation;
- implementing the work owned by another foundation lane;
- broad worker pools, generic feature slots, recursive delegation, child
  roles, or shell stand-ins;
- using a legacy compatibility export as an admitted role; and
- independent clearance of this foundation. Clearance is a separate,
  evidence-only step after all foundation lanes are assembled.

## Admitted role map

The roster starts empty. A role is admitted only when its exact identifier,
public name, phase, bounded goal, output, source binding, and host readback are
present in the control plane. A caller assertion, display label, setup token,
or compatibility export is not an identity.

| Role kind | Public role or lane | Admission and routing rule |
| --- | --- | --- |
| Persistent coordinator | `Intent Regulator` | Coordinates the project-wide plan and routes admitted work. It is persistent control-plane state, not a temporary worker slot. |
| Persistent Runtime | Runtime for the current project | Provides the source-bound execution context. It is not a role, sibling, child, or substitute worker. |
| Foundation sibling | Each named foundation lane, including `Role routing` | Admit exactly one fresh, independent sibling per named lane. Route only that lane's bounded foundation output to it. |
| Foundation clearance | `Foundation Clearance Auditor` | Admit only after all foundation lane handoffs exist. It reads evidence and does not replace or self-clear a lane. |
| Tailored campaign | `Rapid Slice Builder` | Admit only after independent foundation clearance and only for the smallest approved thin-slice build. |
| Tailored campaign | `Independent Auditor` | Admit only after independent foundation clearance and only to inspect the exact builder result. It cannot accept its own work. |

The foundation register is a closed set of named lanes. Its role identifiers
are `FOUNDATION_INTENT_AND_SCOPE`, `FOUNDATION_BOOTSTRAP_AND_CONTEXT`,
`FOUNDATION_USER_CONVERSATION`, `FOUNDATION_ROLE_ROUTING`,
`FOUNDATION_PROGRESS_AND_HEALTH`, `FOUNDATION_FUNCTIONALITY`,
`FOUNDATION_UI_UX`, `FOUNDATION_CODE_HYGIENE`,
`FOUNDATION_SECURITY_AND_PRIVACY`, `FOUNDATION_EVIDENCE_AND_IDENTITY`,
`FOUNDATION_RECOVERY_AND_BOUNDARIES`, and
`FOUNDATION_DELIVERY_AND_CLOSURE`. These identifiers are admissions for the
named foundation lanes only; they do not authorize generic workers or any
other role.

The tailored roles are conditional, not pre-admitted. No role may be added
because a worker is convenient, unavailable, ambiguous, or able to create
another worker. A changed role map is a plan or condition change: close the
current goal, preserve evidence, and require a fresh source-bound goal.

## Intended behavior

1. The coordinator reads the recorded plan, confirms the current phase, and
   starts from an empty temporary roster. Old records are neither inherited
   nor counted.
2. The coordinator creates only the named role needed for the admitted phase.
   Foundation assembly uses independent siblings; it does not create a
   hierarchy. Each sibling receives one role, one bounded goal, and one lane
   output.
3. Before any lane file or other in-scope output is written, the host reads
   back the exact project binding, current working directory, source commit,
   source tree, real session identity, and required capabilities. Every value
   must match the saved source binding and the admitted packet.
4. A routine puzzle stays with its exact owner when it is bounded,
   deterministic, reversible, and inside scope. A soft review pauses only the
   affected non-protected choice. A hard stop preserves evidence and prevents
   narration from becoming a false completion.
5. Routing follows the named owner and lane boundary, not a vague request for
   a worker. The coordinator may route a focused repair, but may not silently
   widen the goal, swap in an unadmitted role, or create a child.
6. Each role returns a typed handoff with progress, result, hostile coverage,
   independent-check status, evidence digests, open risks, and its next
   handoff. Foundation readiness is not foundation clearance.
7. After all foundation lanes are independently cleared, the coordinator may
   derive only the two named tailored roles required for the thin slice. The
   tailored roster is temporary and closes at the review boundary.
8. The coordinator closes, archives, and removes temporary roles through the
   host, preserves their typed handoffs, and verifies a zero-active temporary
   roster before Iteration work is admitted.

## Unavailable behavior

Role routing is unavailable, and must fail closed, when any of the following
is true:

- the host cannot prove the exact project binding, working directory, source
  commit, source tree, real session identity, or required capability;
- the role packet is missing, stale, duplicated, inherited from an old roster,
  or does not match the current phase and source;
- a named role is unavailable and the proposed substitute is generic,
  recursive, a child, a shell stand-in, or otherwise unadmitted;
- the role map, owner intent, policy, or source condition changes during the
  goal;
- the required independent check, evidence readback, or temporary-role
  closure cannot be completed; or
- the requested action crosses the public prototype boundary into secrets,
  private context, authentication, spending, remote delivery, publication,
  deployment, release, or destructive change.

In an unavailable state, do not write the lane output, invent an identity,
repair the roster by inference, or report success. Preserve the exact failure
and evidence in the control plane, classify the outcome as a hard stop or
typed later work, and route the next decision to the coordinator or a fresh
source-bound goal as required.

## Hostile cases

| Hostile case | Required response |
| --- | --- |
| A caller supplies the expected project identity, but host readback is absent or differs. | Stop before writing; emit `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`; preserve the mismatch and accept no result. |
| The session starts in a sibling checkout, an unapproved worktree, or the wrong directory. | Stop before mutation. Do not “fix” the path by guessing or by copying the output elsewhere. |
| A legacy compatibility export is presented as an available role. | Reject it as non-admissible compatibility data; require a named role from the current plan. |
| A worker asks to create a child, generic worker, or shell stand-in to finish its goal. | Deny the topology change, preserve the request as evidence, and hard-stop the affected route if the goal cannot continue with its admitted owner. |
| Two packets claim the same lane, identity, or output, or one packet claims an unknown role. | Reject the duplicate or unknown admission; do not merge handoffs or choose by arrival order. |
| The plan changes after admission, or the source becomes stale before write. | Close the current goal safely and require a fresh source-bound goal; do not continue under the old packet. |
| The lane reports completion while the independent check or evidence readback is unavailable. | Keep the result `READY_FOR_INDEPENDENT_CLEARANCE` at most; never convert missing evidence into a pass or clearance. |
| A public handoff includes a secret, private path, external identity, or session record. | Do not publish it. Quarantine the unsafe handoff, record the boundary violation, and require a clean portable replacement. |

## Focused check ideas

These checks are intentionally narrow and can run without external services:

- **Closed admission set:** accept every named current-phase role; reject an
  unknown role, a duplicate lane, an inherited roster entry, a generic role,
  a child, and a compatibility export.
- **Pre-write binding gate:** feed matching and mismatching project, directory,
  session, commit, tree, and capability readbacks; only the all-matching case
  may write, and every mismatch must leave the target output absent.
- **Topology invariant:** prove that one admitted foundation lane maps to one
  independent sibling, with no parent-child edge, shell substitute, or second
  owner for the same output.
- **Phase gate:** reject `Foundation Clearance Auditor`, `Rapid Slice Builder`,
  and `Independent Auditor` before their stated phase; admit them only after
  the required foundation-clearance evidence exists.
- **Routing classification:** verify that a bounded deterministic defect is a
  puzzle, a non-protected choice is a soft review, and a source, identity,
  privacy, external-action, or closure failure is a hard stop.
- **Handoff shape:** validate the typed fields below, require hostile cases
  and evidence digests, and keep independent checking pending until a separate
  checker returns a decision.
- **Closure invariant:** after close/archive/remove, no temporary role remains
  active and every handoff remains preserved for the next coordinator.

## Typed handoff

The lane emits a public summary shaped like the following. Values marked as
control-plane readbacks are filled by the host and are not copied into public
authority when they contain private context. Digests may be published; raw
session records and environment details may not.

```json
{
  "schema": "agentos.foundation_handoff.v1",
  "phase": "ASSEMBLE_FOUNDATION_LANES",
  "role": "FOUNDATION_ROLE_ROUTING",
  "public_lane": "Role routing",
  "status": "READY_FOR_INDEPENDENT_CLEARANCE",
  "source": {
    "commit": "<exact source commit readback>",
    "tree": "<exact source tree readback>"
  },
  "task": "Define the portable governance foundation for role routing.",
  "scope": {
    "in": ["admission", "topology", "routing", "pre-write identity gate", "closure"],
    "out": ["implementation for other lanes", "external actions", "self-clearance"]
  },
  "progress": {
    "meaningful": true,
    "summary": "Role map, fail-closed behavior, hostile cases, and focused checks documented."
  },
  "result": "Foundation is ready for an independent evidence-only clearance check.",
  "hostile_coverage": [
    "source-binding mismatch",
    "wrong working directory",
    "compatibility export",
    "recursive or generic substitute",
    "duplicate or stale admission",
    "missing independent evidence"
  ],
  "independent_check": {
    "required": true,
    "status": "PENDING",
    "performed_by_current_lane": false
  },
  "evidence": {
    "digests": ["<available control-plane evidence digests>"]
  },
  "open_risks": [
    "Cross-lane consistency and independent clearance remain outstanding."
  ],
  "next_handoff": "FOUNDATION_CLEARANCE_AUDITOR",
  "classification": "READY_FOR_INDEPENDENT_CLEARANCE"
}
```

The typed handoff is a readiness record, not a clearance claim. The next
owner must independently verify the source binding, portability, role map,
hostile coverage, and evidence before accepting or routing later work.
