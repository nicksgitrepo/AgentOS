# Delivery Target

Status: `PREPARED_NOT_ACTIVATED`

The Delivery Target describes what kind of Product the owner wants to put in
front of users. It is separate from source-control, CI-runner, hosting, and
rollback mechanics so Bootstrap does not choose infrastructure before it knows
whether the outcome is a prototype or a real but deliberately limited Product.

The target records:

- family: local workspace, managed site, managed app, VPS, cloud, hybrid, or
  project-defined;
- mode: prototype, limited product, private beta, public beta, or standard
  production;
- audience, data posture, authentication route, custom-domain choice, and
  explicit limitations;
- for every non-prototype target, the supported scope, operating envelope, and
  exact `EXACT_LAST_ACCEPTED_DEPLOYMENT` rollback path;
- an optional project-context adapter ID and its profiled capabilities.

`MANAGED_SITE` is a first-class low-setup option. The portable kernel offers a
generic profile for `PROTOTYPE` or `LIMITED_PRODUCT` use; a project may bind a
concrete adapter outside the kernel. That adapter selection does not provide an account, credential, quota, data guarantee,
authentication guarantee, production claim, or deployment authority. Those
facts must remain project-context bindings with their own evidence.

Prototype targets are owner-oriented or selected-user trial routes and use
synthetic or explicitly admitted data. Limited products must name the
supported scope, audience, operating envelope, data posture, and rollback
identity. Standard production requires a matching Project Life Contract and
the exact acceptance, deployment, and rollback chain.

The target is content-addressed by `target_sha256` and is bound into the
Delivery Policy, exact creation plan, and typed Project Context.
