# Preserved platform handoff: 12-delivery-and-closure


## Audit section 5 — Cycle 1 platform-foundation handoff

This section is the Delivery and Closure platform handoff for the Controller.
It is appended after the audit and builder history above; it does not replace,
clear, or rewrite any earlier finding.

### HANDOFF IDENTITY AND DISPOSITION

- **Cycle:** `Cycle 1`
- **Lane:** `Delivery and Closure`
- **Audit date:** `2026-08-07`
- **Baseline source commit:** `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- **Baseline Git tree:** `f1b358d87e6a969fb9631e202a3d478540edd4d`
- **Source posture:** `BOUND_TO_BASELINE_WITH_DIRTY_WORKTREE`. The current
  checkout contains pre-existing campaign changes and the direct source
  readback classifies the checkpoint as `CONFLICT`; this handoff does not
  claim a clean or merge-ready tree.
- **Handoff result:** `PRODUCTION_CANDIDATE_PENDING_TESTS` for the repaired
  local/typed Delivery and Closure capability only.
- **External delivery result:** `BLOCKED_EXTERNAL_AUTHORITY` until the exact
  host removal/readback capability, explicit activation, persistent Runtime
  readback, provider actions, live audit, and rollback evidence exist.
- **Independent clearance:** `REQUIRED_NOT_CLAIMED`.
- **Feature-lane release gate:** `HOLD`. The Controller must wait for every
  platform handoff, independently audit the candidate platform trees, merge
  one selected platform tree, and only then release feature lanes.
- **Custody:** The authoritative comparison worktree was inspected read-only;
  no authoritative worktree, control repository, release folder, or other
  lane was edited.

### SHARED SKELETON

The shared platform skeleton for this lane is the portable AgentOS governance
kernel plus project-bound typed context:

1. `control/` owns executable governance authorities and host seams.
2. `schemas/` owns versioned contract descriptions and binding identities.
3. `governance/2.1rc/` records the prepared, inactive release-candidate
   policy; it is not an activation authority.
4. `docs/rapid-foundations/` owns portable intent, boundary, audit, and
   handoff records.
5. `tests/` owns direct Node-based focused and hostile checks.
6. Project configuration and the authority corpus supply product-specific
   scope, target, provider, environment, and owner decisions as typed inputs;
   they are not copied into this portable kernel.

Delivery and Closure is a platform capability at the boundary between a
bounded campaign result and its owner-facing handoff. The repaired local
route is:

`typed choice -> CAS delivery state -> Runtime authority readback when needed -> action receipt -> live audit -> rollback evidence when needed -> validated temporary closure -> final handoff`.

The local prepared route may record `PREPARED_NO_DELIVERY`; it must not be
interpreted as push, merge, deployment, release, availability, rollback, or a
production result. No product feature implementation is included in this
handoff.

### DIRECTORY AND CUSTODY BOUNDARIES

| Boundary | Delivery and Closure ownership | Explicit non-ownership |
| --- | --- | --- |
| Executable control | `control/delivery-closure-*.mjs`, `control/rapid-prototype/delivery-closure*.mjs`, `control/delivery-policy.mjs`, `control/delivery-target.mjs`, and the public `control/agentos.mjs` façade | Product feature code, provider clients, deployment drivers, release automation, credentials, and private control-plane records |
| Shared contracts | `schemas/delivery-*.json`, `schemas/runtime-delivery-*.json`, and the directly affected binding entries in `schemas/bootstrap-binding.v1.json` | Unrelated lane contracts, product schemas, generated application models, or an activation decision |
| Normative intent | `docs/rapid-foundations/12-delivery-and-closure.md` and the prepared `governance/2.1rc/delivery-*.md` records | Product-specific policy, provider/account identity, remote repository policy, and release authorization |
| Evidence and checks | The direct Delivery and Closure tests plus this append-only audit/handoff record | Synthetic fixtures promoted to live proof, self-clearance, raw session evidence, or a clean-checkpoint claim |
| Worktree custody | This isolated lane worktree until the Controller independently selects and merges a platform tree | The authoritative merge worktree, feature roots, release folders, control repositories, and unrelated lanes |

The shared-contract rule is one primary writer for a materially shared
contract or schema. A feature lane may consume this capability through the
typed handoff but may not silently fork, weaken, or independently complete the
Delivery and Closure authority. Any cross-lane contract conflict returns to
the Controller for primary-owner selection.

### TECHNOLOGY-STACK FACTS AND RECOMMENDATIONS

**Observed facts**

- `package.json` declares an ESM package (`"type": "module"`) with a Node
  `>=20` engine. The lane uses native Node modules, including `node:crypto`,
  `node:fs`, `node:path`, and read-only child-process probes.
- Content-addressed records use SHA-256 and canonical JSON. The repaired
  Delivery and Closure paths sort object keys by unsigned UTF-8 byte order and
  preserve governed array order.
- Contract files in `schemas/` are descriptive versioned records; executable
  validators and exact-key/state invariants remain in `control/`. Direct
  implementation-to-contract hashes are recorded in the bootstrap binding.
- Focused verification is run directly with `node` and syntax checks with
  `node --check`. No npm command or external provider action was used for this
  lane.
- The portable kernel intentionally has no provider-specific model host,
  remote repository client, deployment connector, live-site driver, or
  credential reader.

**Recommendations for the shared platform tree**

1. Retain the direct Node/ESM/native-crypto baseline for this governance
   capability; do not add a framework or provider dependency merely to cross
   the missing external boundary.
2. Keep one complete, versioned public Delivery and Closure façade and route
   every caller through the same validators. Do not expose parallel completion
   authorities that can drift.
3. Admit host, Runtime, and provider adapters only as typed, identity-bound
   seams with real failure, live-audit, rollback, and recovery tests.
4. Preserve `2.1rc` as `PREPARED_NOT_ACTIVATED` until an explicit owner
   activation decision is recorded outside the portable defaults.

### ROUTING AND FEATURE BOUNDARIES

- This lane owns delivery choice, source/checkpoint evidence, Runtime
  authorization gates, action receipt semantics, live-audit/rollback gates,
  final handoff, and temporary-work closure.
- The canonical campaign currently provides a deliberately review-only local
  projection. It must not independently claim the same completion as the
  typed delivery state machine. The Controller must select one completion
  authority or install an explicit adapter contract before external completion
  is considered durable.
- `PREPARED_NOT_ACTIVATED` routes to local review or a typed no-external-action
  closure. `ACTIVATED` routes through a real persistent Runtime readback before
  any external request. `FAILED`, `UNKNOWN`, `IN_FLIGHT`, missing readback,
  stale source, dirty checkpoint, or incomplete closure routes to hold,
  reconciliation, or owner review; none routes to success.
- Feature lanes do not receive permission from this handoff to push, merge,
  deploy, release, roll back, authenticate, spend, or publish. They remain
  blocked from feature release until the Controller has completed the
  platform-foundation gate described above.
- The later feature-facing exchange must carry the selected platform source
  identity, changed paths/contracts, verification status, unresolved seams,
  custody release, and the exact next owner. It must not carry private paths,
  credentials, raw rosters, or unverified completion prose.

### SHARED CONTRACTS

| Contract | Current source | Required boundary |
| --- | --- | --- |
| Delivery choice | `schemas/delivery-choice.v2.json` and `control/delivery-closure-records.mjs` | Exact outcome/action/target fields; external choices require explicit `ACTIVATED` status; prepared defaults remain safe. |
| Delivery state | `schemas/delivery-state.v1.json` and `control/delivery-closure-transitions.mjs` | CAS revision/digest, bounded statuses, activation status, and completion only after a selected result or prepared/no-delivery closure. |
| Runtime request and authority | `schemas/runtime-delivery-request.v1.json`, `schemas/runtime-delivery-authority-readback.v1.json`, and `control/delivery-closure-records.mjs` | An active persistent `RUNTIME` readback with opaque reference, `ACTIVATED` status, and matching digest is required; caller role text is insufficient. |
| Action receipt | `schemas/delivery-receipt.v1.json` | Source, request, choice, environment, Runtime, result, error, and evidence identities must match; in-flight, failed, and unknown states cannot claim external success. |
| Live audit and rollback | `schemas/delivery-live-audit-receipt.v1.json`, `schemas/delivery-final-handoff.v1.json`, and the typed record validators | External outcomes need independent live evidence; rollback targets and receipts remain explicit and content-addressed. |
| Temporary closure | `schemas/delivery-closure.v1.json` plus `control/rapid-prototype/delivery-closure.mjs` | Preserve first, then identity-bound unpin/archive/removal and zero-active readback; the actual validated closure receipt, not a caller digest alone, is required. |
| Rapid typed handoff | `control/rapid-prototype/delivery-closure-contract.mjs`, `control/rapid-prototype/delivery-closure.mjs`, and `control/rapid-prototype/index.mjs` | Exact public keys, source object formats, relative changed paths, recursive privacy checks, and digest-backed independent results. |
| Delivery policy and target | `control/delivery-policy.mjs`, `control/delivery-target.mjs`, `governance/2.1rc/delivery-policy.md`, and `governance/2.1rc/delivery-target.md` | Dirty checkpoints are `CONFLICT`; stronger target claims require typed supported scope, operating envelope, rollback identity, and evidence digest. |

All shared records remain project-agnostic. Product scope, environment,
provider, and owner choices are supplied through typed project context and
host adapters rather than embedded in the contract or public handoff.

### UI AND DESIGN DIRECTION

No product UI was implemented or cleared in this lane. The platform-facing
surface should be a view of the typed authority, never a second authority:

- Put the current outcome, state, responsible public role, limitation, and
  next action ahead of detail.
- Use stable plain-language states such as `READY`, `WORKING`, `WAITING_FOR_A_DECISION`,
  `BLOCKED`, `UNAVAILABLE`, `CONFLICT`, `UNPROVEN`, and `COMPLETE`; for this
  handoff, external delivery is `BLOCKED` and the local typed capability is a
  candidate `PENDING_TESTS`.
- Make external, approval-dependent, irreversible, and unavailable actions
  visibly distinct. Never use a spinner, disabled control, or optimistic label
  to imply a provider or host result that lacks readback.
- Keep public content limited to safe status, compact evidence summaries, and
  bounded next actions. Do not render credentials, private paths, raw
  sessions, provider accounts, or active-roster details.
- A Markdown/plain-text fallback is valid for this platform handoff. Any later
  rendered surface must separately prove keyboard access, visible focus,
  labels, text alternatives, contrast, zoom/reflow, long-content handling, and
  unavailable/error states. Those checks are currently `UNPROVEN`, not passed.
- No product branding, design system, or feature layout is selected by the
  portable kernel; project design intent owns those later decisions.

### SECURITY, PRIVACY, AND BOUNDARIES

- No secret, credential, private path, provider account, deployment identity,
  raw task/session identity, or host roster is copied into this public
  handoff. Host-local authorities retain private values and return only typed
  status, opaque references, and content digests.
- The portable code does not authenticate, read credentials, contact a
  provider, spend, push, merge, deploy, release, publish, or roll back. Those
  are protected host/Runtime boundaries and remain unavailable here.
- A missing host readback is failure or `UNAVAILABLE`, never a successful
  no-op. Temporary closure requires explicit active-roster removal and a
  post-removal readback; failure results do not echo the raw caller roster.
- Independent checking must be performed by a distinct admitted checker. The
  lane writer does not clear its own candidate.
- The audit report remains append-only. Historical synthetic evidence is
  preserved as history and is not promoted to live proof.
- The current dirty worktree is not a merge/production checkpoint. The
  Controller must independently form and audit one clean platform tree before
  releasing feature lanes.
- `2.1rc` remains prepared and inactive. No activation or production claim
  was introduced by this handoff.

### QUALITY, HYGIENE, MINIMALITY, AND EVIDENCE

The repaired implementation is limited to the recorded DC-AUD-01 through
DC-AUD-10 findings and their direct contracts/tests. The rapid closure
controller remains below its focused module-size budget after extracting the
shared public-contract/privacy helper. The direct lane checks passed:

- `node tests/rapid-prototype/delivery-closure.mjs`
- `node tests/verify-rapid-prototype.mjs`
- `node tests/verify-delivery-closure-state.mjs`
- `node tests/verify-delivery-policy.mjs`
- `node tests/verify-delivery-target.mjs`
- `node tests/verify-bootstrap-contract-bindings.mjs`
- `node tests/verify-bootstrap-delivery-finish.mjs`
- `node tests/verify-architecture-hygiene.mjs`
- `node tests/verify-source-hygiene.mjs`
- direct `node --check` for the repaired modules and façade

The direct delivery probe classified the current dirty checkout as
`CONFLICT` with `worktree_clean=false`, so no clean-checkpoint evidence is
claimed. The repository-wide verifier was not accepted as lane evidence: it
stopped first on an unrelated pre-existing binding mismatch outside this lane.
That verifier must be rerun after its owning repair; this lane did not repair
that mismatch.

The following relative-file SHA-256 values bind the repaired lane surface to
the source snapshot used for this handoff. They are evidence of the current
files, not a commit or independent-clearance claim:

| File | SHA-256 |
| --- | --- |
| `control/agentos.mjs` | `2bb1f59e8082ddbba47561e8869585f6bf847bb896424fbb9a8aa53254d877fe` |
| `control/delivery-closure-foundation.mjs` | `4d310c04bb1f58ca9251be82aa3ef578ee29747afcf13acf24a743bb66963bc7` |
| `control/delivery-closure-records.mjs` | `7c1d362b3346e6fc04a3bcd8525c01c9169c19f53e55a923f8759f7995573b8f` |
| `control/delivery-closure-state.mjs` | `54ed08a4e55b76117fdf3bf072816b9d94ebfe6ace994c9ac81ea52f53a891d2` |
| `control/delivery-closure-transitions.mjs` | `20c48b64129c3e2cb336c4479049197f478e0fea075c0f58bb1c110ff3728ac7` |
| `control/delivery-policy.mjs` | `387d1ffa8a492aecd2f0602e3c67c65391c6d5602a783c041079620992566b9d` |
| `control/delivery-target.mjs` | `845ab7513f811896feac4bb9de19238d04b5491969d80f6afff1f9c6cf545634` |
| `control/rapid-prototype/delivery-closure-contract.mjs` | `cc2b81ab680afa122098fc9554d072a5e9eaa18f8793bee444548842b92d5cd3` |
| `control/rapid-prototype/delivery-closure.mjs` | `4f269207fa2d55bcb38936f0787649b70cd4766323f19a598fabd88727535270` |
| `control/rapid-prototype/index.mjs` | `95aac22f7d4d744f90774d0924af93327c5f760fcdf5adef01225f0107a82bc8` |
| `governance/2.1rc/delivery-policy.md` | `067365b04b05e5a10d5fab434c3215c785e95fe5180a14f0b1d1101737799269` |
| `governance/2.1rc/delivery-target.md` | `38d9cd3d1422dbe50c2e81d434a2609c7aa9fb28a61e14314bdbb9e077815a6b` |
| `schemas/bootstrap-binding.v1.json` | `344a437de26538977145e7718dfce8ee153e99294d7f257779c85fc8159d0838` |
| `schemas/delivery-choice.v2.json` | `6f7cf24609b1d89d113f4d06e3206ebca5a40f1489223d100a450cf648feae3a` |
| `schemas/delivery-closure.v1.json` | `1495d3993f75933bd14b2ca364da75568c92945a96a2b3dd640193ca62e298ed` |
| `schemas/delivery-receipt.v1.json` | `49eb24124a8dc74c3669a8304e42d5499549c5351c41b25524a4b907ed66de78` |
| `schemas/delivery-state.v1.json` | `9cc3ff52e513ba25ea331e630f8ac398d74cf405b4a8f14864ed8ebf4907bca6` |
| `schemas/delivery-target.v1.json` | `409d05bc5b28cf08bef373a84400d551e5991d7119a0e1f8d5c102aea6da3fc3` |
| `schemas/runtime-delivery-authority-readback.v1.json` | `666e916bea0f66069dd129e174c66692b4d2b2ef8a458a99dc06cedb0facfad6` |
| `schemas/runtime-delivery-request.v1.json` | `3b4a1207adb306d24104e98cac7f02f61b5eef878b112178a3c459210ec2d2e4` |
| `tests/rapid-prototype/delivery-closure.mjs` | `707caab37f4e91a44f6476592304850506c7ec1557f40f2947ec886f6dd42268` |
| `tests/verify-bootstrap-contract-bindings.mjs` | `b6b94b77463419e95a709da3ea7989a4b485f0b991c1298fb34f65dc33eb3e9c` |
| `tests/verify-bootstrap-delivery-finish.mjs` | `cb4744f5afe8861054c09548250019f6ab0da1139a5ff33c5565b55a4fd86378` |
| `tests/verify-delivery-closure-state.mjs` | `e07e978e1db5ca740c33d2e4430ff94c2954be23d429f0c53f5771a5fddec531` |
| `tests/verify-delivery-policy.mjs` | `6da63e73382915769e5edaa437d94dd31033f95608539d8df7fbad5a89dd79e9` |
| `tests/verify-delivery-target.mjs` | `712aa43efff2cb01d6acd90ef460e0c432e912e4d8d3a5827070d83eec35b2a` |
| `tests/verify-rapid-prototype.mjs` | `733371cbe420760675f7726e69c470f23cd3be78b6f1533370086d92266fc67e` |

### BLOCKERS AND EXACT RECOVERY NEEDED

1. **Host custody blocker:** provide a real host
   `remove_from_active_roster` operation accepting the worker and host
   identity and returning an identity-bound `roster_removed: true` readback;
   provide the matching post-removal `list_threads` readback. Add a
   non-synthetic adapter test and rerun closure checks.
2. **Activation and Runtime blocker:** record an explicit owner-approved
   activation decision, provide an active persistent Runtime authority
   readback with `ACTIVATED`, and keep all credentials/provider values
   host-local.
3. **Provider/live-evidence blocker:** run real push/merge/deploy/release or
   rollback actions only through the approved adapter, with independent live
   audit, rollback, and failure-recovery receipts. No synthetic fixture clears
   this item.
4. **Single-authority integration blocker:** the owner/Controller must choose
   whether canonical campaign closure adapts to the typed delivery authority
   or remains an explicitly review-only projection. Both paths must not claim
   completion independently.
5. **Checkpoint/verifier blocker:** the Controller must independently assemble
   a clean platform tree and rerun the repository-wide verifier after the
   unrelated binding mismatch is repaired by its owning lane.

### UNRESOLVED OWNER QUESTIONS

- Who owns the explicit activation decision, and what exact project-bound
  record is authoritative for moving beyond `PREPARED_NOT_ACTIVATED`?
- Which host adapter contract and environment provide identity-bound active
  roster removal and post-removal readback?
- Which single completion authority is canonical: the typed Delivery and
  Closure state machine, or the canonical campaign projection behind an
  explicit adapter?
- Which provider/environment test fixtures can produce real action, live-audit,
  rollback, and failure-recovery evidence without exposing credentials or
  private paths?
- What exact supported scope, operating envelope, rollback ide

