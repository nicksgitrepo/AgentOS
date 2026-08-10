# Preserved platform handoff: 09-security-and-privacy


## Platform-foundation handoff — Security and Privacy

### HANDOFF STATUS

```yaml
schema: agentos.platform_foundation_handoff.v1
lane: SECURITY_AND_PRIVACY
source:
  commit: 590c07ddd4be7a8c24727c24b40808e44ca7357d
  tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
  working_tree: DIRTY
  authority_tree: READ_ONLY
result: PRODUCTION_CANDIDATE_PENDING_TESTS
platform_gate: HOLD_FEATURE_LANES
controller_action: WAIT_FOR_ALL_PLATFORM_HANDOFFS_THEN_INDEPENDENTLY_AUDIT_AND_MERGE_ONE_PLATFORM_TREE
feature_release: NOT_AUTHORIZED
acceptance: NOT_CLAIMED
activation: INACTIVE
```

This handoff is source-bound to the recorded commit/tree and the repaired
Security and Privacy files listed above. It is a platform-foundation input,
not product feature work, product acceptance, or permission to release a
feature lane.

### SHARED SKELETON

- Retain the portable Node.js ESM governance kernel and standard-library-only
  boundary helpers as the shared skeleton. The security boundary belongs before
  public serialization, evidence compilation, handoff publication, and any
  feature-facing summary.
- The minimal shared path is: typed private input → source/authority readback →
  safe structured projection → public privacy scan → typed evidence/handoff →
  final public-result scan → controller-owned gate. A feature must not bypass a
  stage by writing a public record directly.
- Keep the existing public contract directories (`docs/`, `schemas/`,
  `control/`, and `tests/`) project-agnostic. Exact project roots, runtime
  configuration, provider identity, session identity, and raw evidence belong
  only to the private control plane.
- The shared assembler remains a platform boundary. Feature lanes may supply
  typed behavior results and safe digests through admitted contracts; they may
  not widen the assembler’s public payload or change the security gate as a
  feature convenience.

### DIRECTORY BOUNDARIES

| Boundary | Admitted contents | Security rule |
| --- | --- | --- |
| `control/rapid-prototype/security-privacy.mjs` | Public text and structured-value scanner | No I/O, network, credentials, or raw-value echo; return typed status, violation codes, and digest only. |
| `control/persisted-record-privacy.mjs` and `control/content-addressing.mjs` | Redaction, safe serialization, content digests, and durable record custody | Use key-aware redaction/validation; write only outside the repository through the hardened atomic writer. |
| `control/rapid-prototype/index.mjs` | Shared thin-slice projection and evidence bridge | Keep exact host readback private; expose only opaque references, typed classifications, safe digests, and bounded summaries. |
| `schemas/persisted-record-privacy.v1.json` and related schemas | Versioned public contracts | Reject private-like metadata; protected actions remain false until a separate authority permits them. |
| `tests/` | Synthetic hostile fixtures and focused behavioral evidence | No real credentials, private paths, provider accounts, or copied session records. |
| `docs/rapid-foundations/` | Portable intent, audit history, and platform handoffs | No secrets or private paths; retain unresolved findings and owner questions. |
| Private control plane | Exact source/cwd/project identity, runtime configuration, raw evidence, retention records | Never copy into public docs, feature payloads, or portable schemas. |

The authoritative merge worktree is not a write target for this lane. The
platform controller must merge one independently audited platform tree before
any feature lane is released.

### TECHNOLOGY-STACK FACTS AND RECOMMENDATIONS

- Fact: the repaired lane runs as Node.js ESM and uses built-in `crypto`, `fs`,
  `path`, and `net` primitives; no package installation or network dependency
  is required for the platform boundary.
- Fact: privacy identity is content-addressed with SHA-256; public records use
  typed JSON-compatible values, opaque references, and explicit schema/version
  identifiers.
- Fact: durable writes use staged creation, restrictive modes, rename, target
  containment checks, symlink-parent rejection, and file/directory flushes.
- Recommendation: keep the shared skeleton on this dependency-light runtime
  until the platform controller records an explicit technology decision. Do not
  introduce a web framework, remote service, credential SDK, telemetry sink,
  or package install into the security boundary as part of feature work.
- Recommendation: any future serializer or validator must preserve canonical
  key ordering, deterministic digests, fail-closed unavailable states, and the
  existing schema/version compatibility contract. A replacement must pass the
  same hostile and custody checks before merge.
- Pending fact: crash interruption, concurrent replacement, and service-level
  timeout behavior still need evidence before the stack can be called durable
  production infrastructure.

### ROUTING AND FEATURE BOUNDARIES

- Security and Privacy owns public payload scanning, persisted privacy
  serialization, public/private evidence projection, custody checks, and the
  related focused tests.
- Evidence and Identity owns source/authority proof semantics; Security and
  Privacy consumes its typed readback and refuses to publish when it is absent,
  mismatched, or unverifiable.
- Recovery and Boundaries owns routing of `UNAVAILABLE`, `UNPROVEN`, and
  `HARD_STOP`; Security and Privacy supplies the security disposition but does
  not invent owner decisions or repair another lane.
- Delivery and Closure owns temporary-worker lifecycle and destructive-action
  boundaries; Security and Privacy requires those results before public
  closure evidence but does not operate the host lifecycle itself.
- Feature lanes must stay behind the platform gate. They may not add product
  fields to the public envelope, write exact source identity into handoffs,
  read credentials, perform network/authentication/publication/deployment, or
  treat a synthetic fixture or documentation assertion as acceptance.
- The controller must collect every platform handoff, independently audit the
  resulting platform tree, merge exactly one source-bound platform tree, and
  only then release feature lanes. A missing or unavailable platform handoff
  holds feature release; it does not become a pass through narration.

### SHARED CONTRACTS

- `agentos.public_payload_scan.v1`: deterministic `SAFE` or `HARD_STOP`,
  ordered violation codes, and `payload_sha256`; structured object keys and
  values are scanned before public use.
- `agentos.persisted_record_privacy.v1`: `REDACTED` status, fixed privacy
  categories, source/original/content digests, constrained schema and
  capability labels, disabled protected actions, and residual-scan proof.
- Public evidence envelope: exact source/cwd/project readback remains private;
  public evidence carries only opaque source/project references, source
  commit/tree facts, typed authority status, safe working-tree classification,
  and receipt digest.
- Source-bound handoff: commit, tree, dirty-state classification, exact
  changed-path list, focused-check status, unresolved findings, next action,
  and acceptance/activation status. No private identity or raw evidence.
- Failure law: unavailable scanner, classifier, redactor, source identity,
  authority, or serializer yields `UNAVAILABLE`, `UNPROVEN`, or `HARD_STOP`; it
  never yields `PASS`, `SAFE`, acceptance, or feature release.
- Lifecycle law: platform handoffs precede feature-lane admission; the
  controller’s merged platform tree is the sole source for the next phase.

### UI AND DESIGN DIRECTION

- Keep the shared owner-facing surface generic and state-driven: `READY`,
  one-question clarification, `PUZZLE`, `SOFT_REVIEW`, `UNAVAILABLE`, and
  `HARD_STOP`.
- Security states should show a short classification, disposition, and safe
  next action. They must never display the protected input, exact path,
  project/provider/session identity, raw evidence, or credential-shaped value.
- Use typed status badges, bounded summaries, and safe digests as the visual
  language for the platform shell. Product-specific colors, flows, copy, and
  domain data remain feature-owner decisions after platform merge.
- A blocked or unavailable state must remain visibly unaccepted and must not
  present a release, publication, or completion affordance.

### SECURITY, CUSTODY, AND BOUNDARY CONSTRAINTS

- No hidden tasks, subagents, shell stand-ins, npm, network, authentication,
  credential access, spending, publication, deployment, activation, or
  destructive cleanup are admitted in this platform handoff.
- Preserve the isolated worktree and read-only authoritative comparison.
  Feature work must not modify the authoritative tree or cross the exact
  changed-path boundary of its own lane.
- Keep `2.1rc` prepared but inactive. No platform handoff is a release,
  clearance, merge, or activation receipt.
- Keep exact host paths and project identity in private control-plane records;
  public records use opaque references or digests. Do not copy private values
  into owner questions, test failures, reports, or feature handoffs.
- Durable writes must remain outside the Git repository, reject target and
  parent symlinks, use restrictive permissions, and flush staged file and
  containing directory where durability is claimed.
- The control-space scan is currently unproven because its configured root
  yielded zero files. The controller must not treat that as complete custody
  evidence.

### UNRESOLVED OWNER QUESTIONS

1. Which private control-space root and authority record should the controller
   bind for the nonzero custody scan, and who is authorized to provide that
   readback without exposing its path publicly?
2. Who owns the service-level unavailable/timeout contract for scanner,
   classifier, redactor, and serializer dependencies, and what exact typed
   result must the platform receipt carry for each failure?
3. Which lifecycle owner supplies retention, archival, and deletion policy for
   persisted privacy records, and what is the approved retention duration or
   deletion trigger?
4. Who owns the current native-session identity/display-name failures and the
   canonical campaign source-binding failure that block the full platform
   verification, and what successor evidence will prove their repair?
5. Does the controller confirm Node.js ESM plus standard-library-only as the
   shared skeleton technology decision for the next phase, or is a versioned
   alternative required before feature-lane admission?
6. What exact receipt/schema name and merge authority will the controller use
   for the independently audited single platform tree before releasing feature
   lanes?

### PLATFORM NEXT ACTION

Hold all feature lanes. Collect every platform-foundation handoff, independently
audit the merged platform tree against the source-bound contracts above, resolve
or explicitly disposition the owner questions and remaining tests, and only
then issue the next source-bound feature-lane admission.

