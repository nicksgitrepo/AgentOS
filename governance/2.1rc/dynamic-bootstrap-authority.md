# 1236 — V1 Governance 2.1rc Dynamic Bootstrap Configurator Authority

Status: `RELEASE CANDIDATE — PORTABLE, NOT ACTIVATED`

## 1. Purpose

`Bootstrap <GovernanceVersion>` is the user-facing project configurator for a
Governance 2.1rc project. It discovers the current environment, fills typed
variables, recommends reversible defaults, asks exactly one unresolved
material question at a time, and resumes from its last durable checkpoint.

Bootstrap is not the project constitution and does not invent Product intent.
The portable governance kernel supplies stable behavior. Project
configuration supplies changeable preferences. Project context supplies
Product meaning. Campaign state supplies work in progress. Sealed release
snapshots preserve what each accepted release actually used.

Machine authority:

- `schemas/dynamic-bootstrap.v1.json`
- `schemas/guided-bootstrap.v1.json`
- `control/guided-bootstrap.mjs`
- `tests/verify-guided-bootstrap.mjs`

`control/dynamic-bootstrap.mjs` and its verifier are retained
only as a compatibility engine for earlier discovery, preference-history, and
snapshot records. Its former temporary-worker execution path is not setup
authority. New 2.1rc setup must use the guided controller above, even when the
user selects direct interaction.

## 2. Startup and discovery

The first admitted agent is named `Bootstrap 2.1rc`. It starts in the
user-selected project directory and performs read-only discovery before asking
questions:

- authority corpus or prior authority corpus-compatible tree;
- project name, Git repository, remotes, default branch, and worktree state;
- package/build/deployment metadata;
- installed common provider tools plus user-named additional providers;
- verified provider identity and separately verified required permission;
- existing Design Bible or design-system sources;
- existing bootstrap state and incomplete legacy setup records.

Installed tooling, present credentials, verified authentication, and verified
permission are four distinct states. Bootstrap never reports successful
authentication merely because a command exists.

Discovery does not search outside the admitted project root except for
explicit provider-tool identity checks. It never reads or persists tokens,
cookies, credential files, signed authorization links, or secret values.
An inherited parent Git repository is not the selected project repository:
the discovered Git top-level must equal the canonical admitted project root
unless a later explicit contained-repository model is chosen. A remote is
persisted only after rejecting credentials, query parameters, and fragments.
Standard `git@host:path` SSH syntax is normalized to a credential-free
`ssh://host/path` value before persistence. Other user-information forms are
rejected rather than copied into Bootstrap state.

Detected authority and design paths are read-only candidates. Their existence
never selects `IMPORT`, `REFACTOR_PREVIOUS_GOVERNANCE`, or any other material
choice for the user.

## 3. One-question interaction

Bootstrap asks only when discovery and admitted authority cannot safely choose.
Every turn contains:

1. the currently detected fact;
2. one material question;
3. a recommended answer;
4. two or more bounded choices;
5. the consequence of each choice;
6. `accept recommendation` when safe.

Known or irrelevant questions are skipped. Answers are checkpointed
immediately. Restarting Bootstrap resumes from the next unresolved question.

The initial authority-corpus choice is exactly:

- `IMPORT`;
- `REFACTOR_PREVIOUS_GOVERNANCE`;
- `CREATE_NEW`.

Import and refactor are non-destructive. The source remains unchanged.
Bootstrap produces a mapping and destination plan before the same bound
Bootstrap session writes the new authority corpus.

The Design Bible choice is independently:

- `IMPORT`;
- `REFACTOR_PREVIOUS_GOVERNANCE`;
- `CREATE_NEW`;
- `DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE`.

Design elicitation may begin after the Foundation phase. Bootstrap cannot
write Design Bible authority until the minimal project identity, goals,
repository, privacy, and path configuration is sealed.

## 4. Mutable configuration

Every preference is changeable through the same Bootstrap interface. Each
preference records:

- typed value;
- provenance: `DETECTED`, `RECOMMENDED`, `USER_SELECTED`, or `IMPORTED`;
- confidence;
- last-changed timestamp and actor;
- effective boundary;
- required revalidation.

Track choices and their source paths are preferences under the same rules.
Every preference change appends a content-addressed event with its prior value
digest and prior-event digest. Actors are nonempty, timestamps are valid UTC,
values match their declared types, confidence/effect values are enumerated,
and revalidation dependencies are nonempty strings. History is monotonic and
cannot be deleted, reordered, or rewritten. Once a preference key has a
declared value type, later ordinary changes must preserve it; changing that
type requires a separately admitted schema migration.

Changes are classified:

- `IMMEDIATE`;
- `NEXT_HANDOFF`;
- `NEXT_CAMPAIGN`;
- `REQUIRES_MIGRATION`;
- `OWNER_CONFIRMATION`.

Changing current configuration never rewrites a sealed campaign or release
snapshot. Path, provider, visibility, public publication, paid resource, DNS,
destructive, credential, or production changes receive an explicit preview
and the required owner confirmation.

## 5. Provider and environment readiness

Bootstrap supports multiple provider-neutral selections for version control,
repository hosting, local-only execution, managed hosting, VPS, containers,
serverless systems, DNS/routing, databases, object storage, maps, and other
APIs.

When authentication is missing, Bootstrap asks whether to configure it now,
skip the provider, or choose another provider. `CONFIGURE_NOW` creates one
true external-access blocker containing only an admitted public HTTPS
authorization origin/path. The owner opens the exact configured interactive
browser explicitly.
Sensitive or signed links and all credentials remain runtime-only.

Bootstrap resumes the same setup goal after a mechanical identity and
permission check succeeds.

Evidence active-window retention, progress intervals, model policies, paths,
publication, merge/release behavior, deployment providers, pinning, archival,
and topology defaults are typed Bootstrap preferences rather than fixed
project assumptions.

## 6. Setup execution and optional ChatGPT guidance

The bound Bootstrap session is the sole setup writer. It imports,
aligns/refactors, or creates the authority corpus, Design Bible, project context, and
feature intent. It records an immutable verified phase output before moving
to the next phase. Imported project-relative or explicitly external sources
are read back from canonical paths with no symlink component and their real
bytes are hashed before admission. The persisted project root must itself be
canonical, not an alias. A phase output binds a real artifact directory and
four distinct in-directory role files. It binds either an existing Git
commit/tree plus four exact regular-file blobs and their bytes at that commit,
or a typed
local-content manifest whose files are read back. Self-declared paths,
commits, trees, or digests are not completion evidence. It never spawns authority corpus,
Design Bible, or intent workers.

The user chooses `DIRECT` or `CHATGPT_GUIDED` in the first interaction.
ChatGPT-guided mode exchanges a plain Markdown prompt plus canonical JSON manifest for
each phase. ChatGPT may help elicit scenarios, comparisons, and edge cases,
but it has no repository, provider, authority, goal, or custody rights.
Bootstrap accepts only schema-valid answers bound to the exact package and
remains the actor that performs every write.

Bootstrap separately asks the typed preference
`workflow.gpt_assist_mode = GPT_ASSIST | DIRECT_ONLY`. `GPT_ASSIST` governs
ongoing campaigns, not setup. The Auditor emits the compact project-status and
material-question Markdown. ChatGPT asks only those listed questions one at a
time, invents no project truth, and stops when every question is answered or
explicitly deferred. Its bound response Markdown returns to the Auditor. The
Auditor uses confirmed answers to complete the next-campaign candidate and
hands that candidate plus a work-in-progress authority corpus-update candidate to the
fresh next-release Orchestrator. The Auditor remains read-only; the
next-release Orchestrator is the sole authority corpus writer and begins the next release.
Standard articles remain last accepted-live truth until closure.

The authority corpus uses stable half-open article blocks: `000` Bootstrap,
`0001–0099` governance, `0100–0199` shared project context, and one
100-number block per feature beginning at `0200`. A content-addressed
allocation registry preserves existing feature blocks. New features use the
next free block; overflow uses a linked extension block without renumbering.
Every extension chain is acyclic and terminates at the one primary block for
that feature.
Active campaign records remain separate work-in-progress authority until
accepted-live closure promotes their resulting truth.

Bootstrap performs bounded self-consistency checks as it writes. These checks
are not independent acceptance. After Bootstrap reconciles material findings
with the owner one question at a time, one fresh independent Auditor inspects
the resulting setup before the first development campaign. The Auditor
session must be distinct from Bootstrap and binds one exact report digest.
The later first-campaign Auditor is also an exact fresh session, distinct
from both Bootstrap and the setup Auditor; Bootstrap exits only when the
working observation names that same activated session.

## 7. Completion

Bootstrap completes only when:

- project identity and paths are valid;
- versioning and repository policy are explicit;
- applicable provider readiness is verified or honestly deferred;
- authority corpus output and compact findings are reconciled and bound to Bootstrap;
- Design Bible output is complete or explicitly deferred and bound to Bootstrap;
- mutable configuration is valid;
- one sealed configuration snapshot is reproducible;
- restart/resume from the durable state is verified;
- independent audit is accepted or its material corrections are reconciled;
- the first campaign can bootstrap without private chat context.

Bootstrap retains its compact task/session identity and the setup Auditor
identity. Raw evidence belongs in the release evidence library, not in the
active handoff.

Sealing is an append-only state transition, not a detached receipt. Every
snapshot carries a unique release identity, monotonic UTC seal time, previous
snapshot digest, exact configuration and track choices, exact phase outputs
(including any explicit Design Bible defer identity), independent audit
report, and a recomputed canonical digest. The exact distinct Bootstrap and
Auditor session identities are sealed beside those evidence digests. Earlier snapshot prefixes
cannot be deleted, reordered, or rewritten.

## 8. Non-goals

Bootstrap does not:

- build Product;
- infer domain policy;
- create a campaign before setup completion;
- silently publish a public repository;
- accept unexpected cost;
- replace a technology stack;
- deploy production;
- request secrets in chat;
- rewrite imported authority;
- turn every preference change into a governance amendment.
