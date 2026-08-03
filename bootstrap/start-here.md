# Governance 2.1rc Bootstrap — Start Here

Status: `RELEASE CANDIDATE — LAUNCH READINESS`

Governance 2.1rc is a portable project bootstrap, authority-corpus maintainer,
campaign controller, specialist handoff protocol, audit workflow, evidence
library, and release lifecycle. It contains no project identity or domain
policy. Those enter only through the project context created or imported
during Bootstrap.

The exact files and SHA-256 identities for this release candidate are in
`schemas/bootstrap-binding.v1.json`. That machine binding is the
only digest inventory. This article does not duplicate a recursively stale
hash table.

## Start

1. Treat the directory containing this file as the admitted project root.
2. Name the current task `Bootstrap 2.1rc`.
3. Pin the task when the host supports pinning.
4. Read the exact bootstrap binding and verify every bound file.
5. Run read-only environment discovery inside the project root.
6. Resume an existing valid Bootstrap state or create a new one.
7. Ask exactly one unresolved material question at a time.
8. Persist every answer through the Bootstrap controller.
9. In direct mode, continue the same Bootstrap task. In ChatGPT-guided mode,
   export the exact phase Markdown prompt plus its canonical JSON manifest and import only
   a schema-valid response bound to that package.
10. Bootstrap itself imports, aligns/refactors, or creates the authority corpus, Design
    Bible, and intent pages. It never delegates those writes to another agent.
11. Do not open a development campaign until authority corpus, Design Bible, configuration,
    and independent setup-audit completion are sealed.
12. Ask whether ongoing campaigns use `GPT_ASSIST` or `DIRECT_ONLY`.

Missing, ambiguous, stale, copied, or mismatched authority is `UNPROVEN` and
fails consequential work closed.

## First-run choices

Bootstrap detects authority and design sources but never chooses for the user.
The authority-corpus path is one of:

- `IMPORT`;
- `REFACTOR_PREVIOUS_GOVERNANCE`;
- `CREATE_NEW`.

The Design Bible path is independently one of:

- `IMPORT`;
- `REFACTOR_PREVIOUS_GOVERNANCE`;
- `CREATE_NEW`;
- `DEFER_WITH_EXPLICIT_UNAVAILABLE_STATE`.

Import and refactor preserve the source. The same `Bootstrap 2.1rc` task
performs the selected operations, builds the normalized authority tree and
indexes, checks consistency, and records exact phase outputs. A fresh
read-only setup Auditor inspects the completed result; Bootstrap remains the
sole setup writer.

## First interaction

After secret-safe read-only discovery, the first question is exactly:

> Do you want to use ChatGPT (recommended), or work with Bootstrap directly?

`DIRECT` keeps the one-question flow in Bootstrap. `CHATGPT_GUIDED` creates
one phase package at a time for Foundation, authority corpus, Design Bible, and Intent.
Each package contains a plain Markdown prompt that names its canonical JSON
manifest identity. The Markdown is deliberately simple: instructions,
questions, discovery guesses, and a point to riff from. ChatGPT is an optional
discovery and elicitation partner only: it
has no repository, provider, authority, goal, or custody rights.

This initial `CHATGPT_GUIDED` choice is separate from
`workflow.gpt_assist_mode`. The latter controls ongoing campaigns:

- `GPT_ASSIST`: the Auditor emits one compact status/question Markdown; ChatGPT
  asks only its listed questions one at a time, stops when they are answered
  or deferred, and returns one bound response Markdown; the Auditor then
  corrects the next-campaign candidate and hands it plus an authority-corpus update
  candidate to the fresh next-release Orchestrator.
- `DIRECT_ONLY`: owner context is collected through the configured direct
  project workflow without a ChatGPT handoff.

In both modes the Auditor is read-only, the next-release Orchestrator is the
only work-in-progress authority corpus writer, and standard articles remain the last
accepted-live release until accepted-live closure.

Foundation model recommendations use current host spawnability plus an
optional current comparison source. `RECOMMENDED` means the least expensive
model strong enough to reach project intent reliably. `ECO` minimizes expected
total completion cost, including retries, rework, coordination, and failure
risk—not token price alone. It prefers light high-reasoning builders where
that remains cheaper, and promotes Orchestrators and Feature Agents near the
value knee when stronger reasoning lowers total cost. Governance never
hardcodes a model name.

## Portable authority numbering

Bootstrap uses stable, non-overlapping half-open article blocks:

- `000`: Bootstrap and recovery entry;
- `0001–0099`: portable governance;
- `0100–0199`: shared project context and documentation;
- `0200–0299`: the first allocated feature;
- every later 100-number block: one additional feature.

Each feature block has fixed compact slots for its index, intent, gates,
workflows, ownership, dependencies, contracts, data/RLS, backend/API,
UI/views, shell/navigation, integrations, security, runtime/recovery, tests,
unavailable behavior, implementation map, event log, handoffs, decisions,
release history, open questions, and deferred work. Accepted IDs never move.
Adding a feature uses the next free block; overflow uses a linked extension
block rather than renumbering old authority. Filenames are
`<number>-<short-stable-slug>.md`.

Active campaign records remain in a separate work-in-progress tree. Standard
numbered articles describe the last accepted live release and are promoted
only after accepted-live closure.

## Browser, automation, and authentication

Bootstrap never assumes a browser, automation framework, or authentication
route. It asks the user to select each applicable route and seals those
choices in the configuration snapshot.

1. Open the exact configured interactive browser through its admitted control
   surface. Never invoke an operating-system default browser, generic
   `open URL` action, or unconfigured fallback.
2. Use only the configured automation framework and explicit browser project
   with an isolated automation profile. Never attach automation to the
   owner’s everyday browser profile.
3. Use only the configured builder, Auditor, and Runtime authentication route
   for that environment. A project-specific development-auth system is
   context, not portable governance.
4. Treat provider login and application login as separate boundaries.
5. Keep tokens, cookies, tickets, nonces, signed links, credentials, and
   protected payloads runtime-only.
6. If selected browser control is unavailable, return
   `SELECTED_BROWSER_CONTROL_UNAVAILABLE`.
   Never substitute another browser.

## Provider access

Bootstrap discovers common version-control, cloud, hosting, routing, database,
container, and infrastructure tools and permits a user-defined list of
additional providers. Installed tooling, authenticated identity, and required
permission are separate facts.

When Runtime lacks required external access, it returns
`UNAVAILABLE_CREDENTIAL_OR_EXTERNAL_ACCESS` with:

- provider and environment;
- a public, non-sensitive HTTPS authorization origin/path;
- an instruction to open the exact configured browser explicitly;
- the mechanical resume check;
- the exact suspended goal.

The Orchestrator suspends the same goal and progress timer during that true
blocker. It resumes both only after the access check succeeds. Sensitive or
signed authorization links are never stored.

## Deterministic question and action loop

```text
state := load_or_create_bootstrap_state(project_root)

while state is not sealed:
  verify(state)
  discovery := read_only_discovery(project_root)

  if discovery materially differs:
    reconcile_discovery_without_retaining_secrets()

  question := next_deterministic_unresolved_question(state)
  if question exists:
    ask_exactly_one(question)
    persist_answer_atomically()
    continue

  if current_phase_context_is_complete_and_output_is_missing:
    Bootstrap_imports_aligns_or_creates_the_phase_output()
    read_back_import_bytes_and_real_git_or_typed_local_output_identity()
    verify_and_content_address_phase_output()
    append_phase_output_atomically()
    continue

  if Bootstrap_findings_need_owner_intent:
    ask_exactly_one_material_question()
    persist_answer_atomically()
    continue

  if independent_setup_audit_is_due:
    spawn_fresh_pinned_read_only_auditor()
    bind_report_and_reconcile_material_findings()
    continue

  seal_append_only_configuration_snapshot()
```

Question order, answer types, allowed choices, effects, and next-question
selection are machine validated. Freeform answers cannot bypass an enumerated
choice or typed custom-value rule.

## Setup launch

After every phase output and the independent setup audit are sealed,
Bootstrap asks exactly:

> `<ProjectName>'s 2.1rc environment is ready for launch. Proceed?`

Only `PROCEED` advances. Bootstrap resolves the user-configured Auditor model,
emits one fresh pinned first-Auditor activation, and verifies an exact session
distinct from both Bootstrap and the setup Auditor is actively designing the
initial campaign. The working observation must name the exact activated
session. The first Auditor is read-only:
it turns authority and current source into one dependency-ordered campaign,
then creates and pins that campaign’s fresh Orchestrator from the configured
model rules. Only after working-state proof does Bootstrap thank the user,
complete its setup goal, and unpin itself.

## Campaign operation

After setup, the Global Orchestrator compiles one deterministic dependency
order. A single cumulative campaign root is the default. Multi-lane execution
requires explicit evidence that the lanes are genuinely independent.

Each dependency owner receives:

- one fresh pinned Feature Agent;
- the same cumulative root when its predecessor hands off;
- one host goal with exact instruction and `DONE WHEN` digests;
- one exclusive lease;
- the compact project context needed for that dependency.

Platform specialists are created on demand only for material seams. They work
within the Feature Agent’s root and authority, solve ordinary puzzles
autonomously, and report only a compact result. Changed surfaces determine the
required read-only seam reviews; Security is always included. Findings bind
the exact checkpoint and return material corrections to the originating
Feature Agent at the next stable handoff. A rejection never erases accepted
work.

At the configured progress interval, except during a recorded true blocker, the Orchestrator
compares the authority snapshot with local and remote Git, goal, lease,
checkpoint, agent, Auditor, Runtime, deployed, and rollback reality. It writes
only semantic changes. No progress triggers immediate broken-chain recovery.

## Evidence and retention

Active authority contains compact status, gates, decisions, paths, symbols,
current checkpoint, blocker, and next action. Raw logs, screenshots, research,
test output, and receipts live in the release evidence dossier.

The evidence active-window length is a Bootstrap preference. At the configured
boundary, the exact release dossier becomes a deterministic verified ZIP in
the historical evidence library. Historical archives are not deleted.

## Launch boundary

Feature agents build and fix bugs until their terminal checkpoint is ready.
Only Runtime receives the completed campaign root for merge, release, and
deployment. The independent Auditor verifies the exact deployed identity.
Standard authority is updated only after accepted-live closure; the campaign
article remains the recovery source until then.

Governance 2.1rc is launch-ready only when the binding, controllers, portable
articles, README, direct tests, hostile tests, and retained compatibility
tests all pass from the exact candidate.

Until an explicit generation-open record exists, this candidate:

- does not activate or globally adopt Governance 2.1rc;
- does not rebind an active campaign or release;
- does not create a Product task, goal, worktree, lease, or deployment;
- does not infer or replace project-specific authority.
