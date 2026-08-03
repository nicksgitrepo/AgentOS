# Delivery Policy

Status: `PREPARED_NOT_ACTIVATED`

Delivery choices are a first-class Bootstrap output. They are project context,
not hidden technical trivia and not portable provider authority.

## One compact owner decision

Bootstrap asks `project.delivery_policy` when exact discovery does not provide
an admitted policy. The answer covers the material choices together:

- how local commits and substantial checkpoints are pushed;
- who owns serialized merge and branch protection;
- whether CI uses a hosted route, VPS, local host, hybrid, or remains
  project-defined;
- how runner concurrency, minutes, network, and secret boundaries are set;
- whether deployment uses a managed route, VPS, local route, hybrid, or a
  project-defined target;
- which environments, provider bindings, preview behavior, cost ceilings, and
  owner spending boundaries apply;
- how exact deployment and rollback identities are retained.

Discovery can inspect repository shape, delivery markers, local Git readback,
and installed tool presence. It cannot infer owner preference, authenticate,
read credentials, contact a provider, spend, push, merge, create a preview,
deploy, or roll back.

## Safe defaults

The portable defaults are:

```text
substantial checkpoint -> clean push -> remote-equal proof before handoff
merge                 -> central serialized integration
auto-merge            -> disabled unless explicitly admitted
deployment            -> Runtime after central acceptance of the exact commit
artifact              -> exact commit, tree, and production build identity
rollback              -> exact last accepted deployment identity
rollback test         -> required
```

Runner and hosting route classes remain `PROJECT_DEFINED` until a project
binds the route, provider, environment, quota, and cost boundary. A route
recommendation is `CANDIDATE_ONLY`; it is not permission to use a provider.

## Cost, speed, and continuity

Bootstrap may compare route classes against the owner’s stated priority:
`COST`, `BALANCED`, `SPEED`, or `RELIABILITY`. The recommendation records its
reason and unresolved bindings. Local routes do not imply continuous
availability. VPS routes require explicit host maintenance and isolation.
Hosted or managed routes require explicit provider quota, spending, network,
secret, and rollback bindings. No route is recommended solely because it is
cheap if its completion or availability assumptions are unproven.

## Reversible probes

The canonical probe controller plans only:

```text
local Git readback
local marker readback
local tool-availability readback
```

Remote authentication, push, merge, provider quota, spending, preview
creation, deployment, and rollback are `NOT_RUN_OWNER_BOUNDARY`. Results are
bound to the exact Bootstrap plan SHA-256, delivery-policy digest, discovery
digest, and canonical project root. Raw command output is reduced to
secret-free typed observations and digests.

Project extensions may add stricter delivery requirements and provider facts,
but cannot weaken clean checkpoint custody, serialized merge authority,
Runtime deployment authority, exact rollback identity, or probe prohibitions.
