# PROVIDER_DISCOVERY audit report

This is an append-only audit and repair record for **Provider Discovery and
Capability Attestation**. It contains only portable relative references,
digests, and typed findings. No secrets, credentials, provider tokens, private
machine paths, or chat links are recorded.

## Audit pass 1 — initial audit of the accepted baseline

### Baseline and authority

- Inventory entry: `PROVIDER_DISCOVERY`, status `NOT_STARTED`.
- Accepted-merge source identity: commit `590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The accepted source was dirty and the feature candidate was present as
  uncommitted files. The clean builder worktree started at the same commit,
  so the feature must be materialized here before it can be handed off.
- Relevant accepted-source file digests:
  - `control/private-provider-discovery.mjs` — `1a180a630b80f808366aa28e11dc1f827606ec785a559264300848a1369651f8`
  - `schemas/provider-discovery.v1.json` — `f01e349aec3d9f177179fff38c162bc1a8f0c74e2ed44e22ccd3a1fabe7fab47`
  - `schemas/host-capability-catalog.v1.json` — `5621e950c5082673cf8fd56714ed55c4a0393422b79c61272e6df84a0b572d3c`

### Intended behavior reconstructed from the source corpus

The roadmap promises a project-agnostic, local-first adapter boundary. It
must be usable offline, must not require a provider, must select only typed
capabilities, and must fail closed on unavailable, mismatched, or unverified
host/provider conditions. Capability evidence must be bound to the intended
workspace and exact source/capability readback. Provider certification remains
partial in the roadmap; the portable kernel must not contain provider accounts,
credentials, deployment identities, or product-specific policy.

The inventory names these direct sources:

- `schemas/provider-discovery.v1.json` — portable provider entry and operation
  contract;
- `schemas/host-capability-catalog.v1.json` — host readback catalog contract;
- `control/private-provider-discovery.mjs` — executable authority.

Related intent was also checked in `docs/roadmap.md`,
`docs/architecture.md`, `docs/release-promotion.md`, the rapid-foundation
security/evidence/recovery documents, and the offline policy/schema references
in the accepted source. No linked research record for this feature is present
in the accepted source catalog; that is recorded as an unknown, not invented
as a requirement.

### Actual implementation observed

The accepted candidate exports `compileProviderNeutralDiscovery`,
`validateProviderNeutralDiscovery`, and `findOfflineUsableAdapters`. It:

- accepts a caller-supplied array of provider-neutral entries;
- binds the result to an offline-policy workspace digest;
- chooses local/read-only/attested status from the policy mode;
- computes a catalog and record digest;
- hard-codes all network, authentication, spending, and external-write
  operation flags to `false`; and
- applies a portable-record scan to the provider record.

The host-capability schema describes a host-attested model catalog, but the
provider module neither validates it nor accepts its digest. The only focused
test is embedded in the broader uncommitted private-control slice and covers a
local happy path plus one extra-key rejection; it does not cover attestation,
host-catalog tampering, mode cross-contamination, duplicate adapters, or
capability/flag contradictions.

### Findings

#### PD-F01 — host attestation is not evidence-bound (critical)

`compileProviderNeutralDiscovery` can receive `trust_status:
CAPABILITY_ATTESTED` and can emit `HOST_ATTESTED_CAPABILITIES` without a host
catalog, host readback digest, or attachment binding. The separate host schema
is otherwise unused by this feature. A caller can therefore turn an ordinary
assertion into capability evidence, which can route work toward an
unavailable or unauthorized provider.

Why it matters: this violates the named attestation intent, the roadmap's
fail-closed adapter boundary, and custody separation between a portable record
and a host authority.

Evidence: `control/private-provider-discovery.mjs` compiles status from the
policy only; `schemas/host-capability-catalog.v1.json` is not imported or
validated by that module.

Repair action: add deterministic host-catalog compile/validation, bind
non-local discovery to the host catalog digest and attachment reference, and
reject attested entries without that evidence. Keep live host I/O outside the
portable kernel.

#### PD-F02 — mode and status can be contradictory (high)

The schema permits `EMPTY` as `provider_discovery_mode`, even though the
offline policy has three operational modes and `EMPTY` is a catalog result.
The runtime validator also accepts an arbitrary provider mode rather than
deriving it from the offline mode. This permits a record that claims a host
attestation while carrying offline-only policy state.

Why it matters: downstream routing can mistake an empty result or a read-only
catalog for an action-authorized host.

Repair action: separate operational discovery modes from the empty result and
enforce the offline-mode-to-discovery-mode relationship in code and schema.

#### PD-F03 — capability flags do not fully describe capabilities (high)

The candidate only checks positive `network_required` and
`authentication_required` claims. It does not reject a dangerous capability
with a false requirement flag, does not make entries canonical, and does not
reject duplicate adapter identities. Consumers that rely on flags or encounter
ambiguous adapters can make unsafe choices.

Repair action: enforce capability-to-flag implications, reject duplicate
adapter identities, canonicalize entry ordering without mutating caller data,
and constrain `UNAVAILABLE` entries.

#### PD-F04 — schema/runtime parity and hostile coverage are incomplete (medium)

The schemas do not express several runtime invariants (canonical ordering,
host-catalog model identity uniqueness, and attestation linkage), and no
provider-specific verifier exercises those invariants. The broad private
control test is uncommitted in the accepted baseline and is not a substitute
for an independent focused verifier.

Repair action: update both schemas to the repaired contract, add a focused
hostile verifier, and leave functional execution pending as instructed.

#### PD-F05 — production boundary remains external, not a builder blocker

The portable feature does not and must not perform provider authentication,
network discovery, spending, publication, merge, deployment, or other
external writes. A real host adapter must supply a host readback before
non-local attestation is accepted. This is an intentional custody boundary;
it is not a reason to stop the local compiler/validator repair. The exact
recovery for a missing host capability is: return `UNAVAILABLE`, preserve the
local evidence/digest, and request a fresh host readback from the admitted
host authority before enabling the affected route.

### Cross-cutting audit lenses

| Lens | Initial result | Finding / required posture |
| --- | --- | --- |
| Quality | Repair required | Cross-field invariants and focused hostile cases are missing. |
| Hygiene | Repair required | The accepted feature files are uncommitted; the builder must hand off a minimal, explicit feature slice. |
| Minimality | Partial | The candidate is small, but the host schema is dead to this feature until bound. |
| Security | Not ready | Self-asserted attestation and weak flag semantics are unsafe. |
| Privacy | Partial | Provider records use opaque refs and no operations; host catalog validation/scanning is absent. |
| Durability | Repair required | Digests exist, but host evidence is not linked and canonical order is not enforced. |
| Regression | Pending | No focused feature verifier has been executed; functional tests remain pending. |
| Custody | Repair required | Host authority and provider record authority are not separated by a typed evidence binding. |
| Boundary | Partial | External actions are denied by record flags, but mode claims can cross the intended boundary. |
| Intent | Partial | Local-first intent is represented; capability attestation intent is not yet implemented. |

### Production readiness and blockers

Initial disposition: **REPAIR_REQUIRED; not a production candidate**.

There is no genuine external blocker for the scoped repair. Functional tests
remain pending by instruction. Live host/provider readback is an external
authority boundary, with the exact recovery described in PD-F05; the repaired
portable slice will not pretend to replace it.

### Builder actions admitted by this audit

1. Repair only PD-F01 through PD-F04 in the isolated worktree.
2. Keep the public contract project-agnostic and secret-free.
3. Add no provider-specific adapter, credential, network, or external-action
   implementation.
4. Add a focused hostile verifier but do not claim its functional execution
   as complete; run only non-functional syntax/contract checks if needed.
5. Append every repair and re-audit result to this report without rewriting
   resolved history.

## Repair pass 1 — builder result and self-audit

### Changed files

- `control/private-provider-discovery.mjs`
- `schemas/provider-discovery.v1.json`
- `schemas/host-capability-catalog.v1.json`
- `tests/verify-provider-discovery.mjs`
- `docs/feature-audits/PROVIDER_DISCOVERY/auditreport.md`

No unrelated source, product, release, or external-control files were changed.

### Repairs applied

- Added host capability catalog compilation and validation with canonical model
  ordering, unique model/reasoning identities, typed numeric/permission/tool
  fields, UTC observation time, attachment digest, content digest, and
  portable-record scanning.
- Added a required nullable `host_capability_catalog_digest` binding to the
  provider record. Local mode requires `null`; read-only and host-attested
  modes require a supplied, validated host readback whose digest matches the
  record. Missing host capability returns `HOST_CAPABILITY_UNAVAILABLE`.
- Restricted operational discovery modes to the three connectivity modes and
  derived their relationship from the offline policy. `EMPTY` is now a result
  status only.
- Made offline policy validation fail closed on policy identity, status,
  connectivity flags, action allow/deny overlap, owner/capability evidence for
  online actions, and policy digest mismatch.
- Made provider entries canonical and unambiguous: sorted capabilities and
  entries, duplicate adapter identity rejection, exact capability-to-network,
  authentication, and external-write flag semantics, and empty/unavailable
  constraints.
- Prevented local/read-only records from claiming capability attestation and
  required every usable entry in host-attested mode to carry the attested
  trust status.
- Added schema parity for the new binding, mode distinction, and unique typed
  arrays, plus focused hostile coverage for tampering, missing host readback,
  flag contradiction, duplicate identity, and cross-mode trust claims.

### Self-audit evidence

- `node --check` passed for the repaired module and focused verifier.
- JSON parsing passed for both repaired schemas.
- `git diff --check` passed.
- A changed-scope/status readback shows only the five feature/report paths
  listed above in this worktree.
- A targeted portability scan found no private machine path, credential,
  provider token, chat link, or external endpoint in the changed feature
  payloads. Schema declaration URLs are documentation identifiers only.
- Functional verifier execution was intentionally not run; functional tests
  remain pending as instructed. No test result is claimed from syntax or JSON
  parsing.

## Re-audit pass 1

### Finding disposition

| Finding | Re-audit result | Evidence |
| --- | --- | --- |
| PD-F01 | Resolved for the portable boundary | Host catalog validation, digest binding, mode gating, and missing-readback failure are in `control/private-provider-discovery.mjs`. |
| PD-F02 | Resolved | Both schemas and runtime validation separate `EMPTY` from operational modes and enforce connectivity/mode correspondence. |
| PD-F03 | Resolved | Provider entry canonicalization, duplicate identity rejection, exact capability flags, and trust-state gating are enforced before digesting. |
| PD-F04 | Resolved pending execution | Schema parity and a focused hostile verifier are present; functional execution remains explicitly pending. |
| PD-F05 | Intentional boundary remains | The module accepts host-issued typed readbacks but performs no live host/provider I/O. A missing host capability remains `UNAVAILABLE` with the recovery recorded in the initial audit. |

### Production readiness

Disposition after repair: **PRODUCTION CANDIDATE PENDING FUNCTIONAL TESTS** for
the portable compiler/validator slice. The candidate is not an authorization
to authenticate, spend, publish, merge, deploy, activate, or deliver. Live
host/provider authority remains outside this portable module and must provide
the typed readback required by the contract.

### Remaining findings and next action

- Functional execution of `tests/verify-provider-discovery.mjs` and the wider
  accepted-merge suites remains pending by instruction.
- The host readback's real authority is an external custody concern; if the
  host cannot supply a fresh readback, preserve the record and return
  `HOST_CAPABILITY_UNAVAILABLE`, then retry only after a fresh admitted host
  binding. This is not a blocker for the offline/local candidate.
- Next action: independent functional verification in a test-authorized
  environment, followed by a fresh source/digest readback before merge custody.

## Cycle closeout

Status: **FINISHED — production candidate pending functional tests**.

The audit → repair → self-audit → re-audit cycle is complete in this isolated
worktree. Changed-file readback is limited to the feature module, its two
schemas, its focused verifier, and this append-only report. The next owner is
the independent functional verifier; no release activation or external
provider action is authorized by this handoff.
