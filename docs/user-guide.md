# Governance 2.1rc — User Guide

## What this package does

Governance 2.1rc turns a normal project directory into a portable,
self-documenting agent workspace. Its Bootstrap creates or aligns the project
authority corpus, Design Bible, and feature intent, records changeable preferences, builds deterministic development
campaigns, passes one cumulative worktree through the required Feature Agents,
creates Platform Agents only when needed, audits changes as they move, and
hands the completed, finalizer-verified milestone to Runtime for merge and
deployment. For substantial work, the canonical path is: first-pass build,
four-lens audit, one bounded Campaign Finalizer, delta-only retest, then the
three ordered acceptance roots.

The governance package is project-agnostic. Your project’s identity, goals,
features, providers, design language, and deployment rules live in the authority corpus
created during setup.

## Before you start

1. Create the folder that will be the project root, if it does not already
   exist.
2. Put this Governance 2.1rc package in that folder. If you already have a
   authority corpus, put it in or below the same project root, or be ready to give
   Bootstrap its path. Bootstrap creates and verifies a `legacy.zip` snapshot
   and companion manifest, index, and receipt before it writes a replacement
   authority corpus.
3. Start a capable general agent with the project folder as its working
   directory.
4. Give it the start instruction below.

## Start instruction

Copy this exactly:

> You are the Governance 2.1rc Bootstrap agent for this project. Treat your
> current working directory as the project root. Open and follow
> `bootstrap/start-here.md` from this directory and verify
> its exact machine binding before consequential work. Rename this task
> `Bootstrap 2.1rc` and pin it if the host supports task pinning. Ask me first
> whether Bootstrap may perform safe read-only discovery. If I permit it, run
> only the canonical Bootstrap Discovery inside the project root, then ask me
> exactly one unresolved material setup question at a time. Persist each
> answer through the Bootstrap Interview and governed state transition. Do not infer import, refactor, creation,
> publication, provider, deployment, retention, model, or cost choices.
> Bootstrap itself must create or align the authority corpus, Design Bible, and feature
> intent. Create only one fresh read-only setup Auditor after those outputs are
> complete. Never request or retain secrets in
> chat or project files. Continue until the setup snapshot is sealed and the
> first campaign is ready to open, or until one true owner blocker requires my
> answer.

## What Bootstrap asks

Bootstrap discovers what it safely can, then asks one question at a time. The
questions cover:

- project boundary and north-star outcome;
- first proving workflow and delivery boundary;
- protected and true-blocker boundaries;
- authority-corpus source, including legacy preservation;
- only unresolved Design Bible or technology constraints;
- model economics and the completion-reliability floor;
- a final compiled-plan confirmation.

Source, stack, provider, testing, authentication, deployment, and retention
facts are discovered or given safe defaults whenever they do not change the
first route. They are not repeated as a whole-tree questionnaire.

Every preference remains changeable. Changes have an effective boundary such
as immediate, next handoff, next campaign, migration required, or owner
confirmation.

Model recommendations use current available models. Recommended means only as
strong as needed to deliver the intended project reliably. `ECO_CONTINUOUS`
represents a 24/7 week with up to twenty work slots; `STANDARD_WORKWEEK`
represents 40 hours; `PERFORMANCE` minimizes elapsed time; and `CUSTOM` uses
typed conditions. Eco minimizes
expected total completion cost, including retries and rework, so a model that
costs one-fifth per attempt but needs twenty times as many attempts is not
economical. Candidates below the completion floor are excluded even when
cheap. Light high-reasoning models are preferred for bounded building;
Orchestrators and Feature Agents move to stronger models near the best-value
point when coordination complexity justifies it. Model names are discovered,
not embedded in governance. The policy also checks context, tools, reasoning,
privacy, deadline, and expected accepted cost including supervision, repair,
and integration. If no model clears the floor or budget, Bootstrap fails closed
instead of recommending a likely-to-fail cheap option.

## Optional Markdown exchange during setup

Bootstrap can emit one compact question package at a time as a plain Markdown
prompt plus canonical JSON manifest. Give both to ChatGPT if desired. ChatGPT
asks one question and waits for one response, may use scenarios, comparisons,
and edge cases only where they can change the route, and returns the completed
Markdown prompt plus response JSON. Bootstrap accepts only schema-valid JSON bound to the
exact package, then performs the work. ChatGPT never receives secrets or
repository/provider custody.

Bootstrap itself performs one of three authority corpus operations:

- `IMPORT`: adopt an existing compatible authority corpus;
- `REFACTOR_PREVIOUS_GOVERNANCE`: preserve the source and produce a normalized
  2.1rc tree plus a mapping;
- `CREATE_NEW`: build a new authority tree from the setup answers.

The Design Bible follows the same model, with an additional explicit defer
option. Bootstrap audits each output for gaps and walks you through only
material unresolved findings, one question at a time. A distinct read-only
setup Auditor performs the final independent inspection.

## Optional GPT_ASSIST during campaigns

`GPT_ASSIST` is separate from the Bootstrap Interview. When enabled, the current
Auditor produces one compact `06-gpt-assist-project-status.md` containing
verified status, open findings, missing context, decisions, and only the
material questions the Auditor actually needs answered.

Give that Markdown file to ChatGPT. ChatGPT must:

- refer only to the brief, the user's answers, scenarios, stated intent, and
  clearly labelled research;
- ask exactly one listed question at a time;
- use scenarios to clarify intent instead of expanding the questionnaire;
- never invent project truth or mark a finding fixed; and
- stop asking when every listed question is answered or explicitly deferred,
  then return one concise response Markdown bound to the source brief.

Return the response Markdown to the same Auditor. The Auditor uses the
owner-confirmed answers to finish or correct the next-campaign candidate, then
hands that candidate and a proposed work-in-progress authority corpus update to the fresh
next Campaign Orchestrator. The Auditor never writes the authority corpus. The new
Orchestrator validates the handoff, updates the campaign authority corpus, and begins the
next release. Standard numbered articles remain the last accepted-live truth
until accepted-live closure.

The generated authority corpus uses stable numeric blocks: `000` for
Bootstrap, `0001–0099` for governance, `0100–0199` for shared project
context, and `0200–0299`, `0300–0399`, and later 100-number blocks for
individual features. A content-addressed allocation registry prevents
renumbering. A full feature block receives a linked extension block.
Extension chains must be acyclic and terminate at that feature's one primary
block.

Every numbered Markdown article has a small common header—article, title,
status, owner, applicability, accepted release, source commit, supersession,
and update time—and a purpose-specific body. Active campaigns stay under a
separate campaign tree until accepted-live closure promotes their resulting
truth into the numbered standard articles.

When setup is sealed, Bootstrap asks:

> `<ProjectName>'s 2.1rc environment is ready for launch. Proceed?`

If you proceed, Bootstrap starts and pins the first independent Auditor using
your selected model rules. That session must be fresh, distinct from
Bootstrap and the setup Auditor, and the working observation must name the
same activated session. Bootstrap then thanks you, completes its goal,
and unpins itself. The Auditor creates and pins the new campaign Orchestrator
only after the campaign is coherent.

## Day-to-day development

An idea, misalignment, or accepted audit finding becomes a campaign input. The
Auditor identifies intended outcomes and dependency gaps. The Orchestrator
compiles a logical dependency chain. By default, one cumulative worktree moves
through that chain:

```text
dependency A -> dependency B -> feature C -> terminal checkpoint
             -> Runtime merge/release/deploy -> live Auditor -> closure
```

Each Feature Agent receives the current checkpoint, completes one substantial
stage goal, commits and pushes a clean checkpoint, and hands the same root to
the next Feature Agent. Platform Agents are created only for database/RLS,
backend/API, UI/UX, shell/navigation, accessibility, security, integration,
runtime, recovery, or another material seam actually touched.

For a substantial campaign, the checkpoint cascade is:

```text
first-pass Feature / Platform build
    -> immutable FIRST_PASS_CANDIDATE
    -> Functionality + Design/UI/Shell/Navigation + Security + Code Quality/Hygiene
    -> fresh Campaign Finalizer on the exact candidate
    -> one correction batch
    -> delta-only audit and at most one targeted repair pass
    -> FUNCTION_REQUIREMENTS -> DESIGN_BIBLE -> SECURITY -> RC_READY
    -> Runtime integration, deployment, and live audit
```

The first-pass candidate must have a coherent intended path, passing affected
checks, coherent interfaces, disclosed critical defects, safe operations, and
a clean pushed checkpoint. Catastrophic, wrong-direction, foundational, or
critical safety/security findings return immediately to the first-pass owner.
The Campaign Finalizer receives only consolidated ordinary findings in a
fresh exclusive worktree. It cannot change intent, grant exceptions, accept
itself, merge, or deploy. Unaffected question evidence is reused during delta
audits; the complete question corpus is not restarted ceremonially.

The campaign is also a living record inside that worktree. Each admitted
agent appends only its own short event file in an independent session stream.
The Orchestrator records the sessions it creates; the active Feature Agent
records each on-demand Platform Agent session it creates. At progress checks
and handoffs, the Orchestrator deterministically compiles those events into
the current campaign view. This avoids a shared-file write race and keeps
session lineage, progress, findings, checkpoints, and next action beside the
code being handed forward.

Ordinary failures are work, not blockers. The responsible agent finds the root
cause, tries one supervisor-selected reframe when the route is stuck, and
fixes the issue. Only a true authority, safety, credential, irreversible
production, unexpected cost, stack-replacement, or irresolvable shared-writer
boundary pauses the campaign for the user.

## Browser and authentication testing

- Bootstrap asks which interactive browser, if any, to use.
- Open that exact browser explicitly; never use the operating-system default
  or an unconfigured fallback.
- Bootstrap separately asks which automation framework and isolated-profile
  policy to use.
- Bootstrap separately asks how builders, Auditors, and Runtime authenticate
  in each environment.
- Use only the selected project-auth route; portable governance never assumes
  a project-specific development-auth system.
- Provider authentication and application authentication are separate.
- Never store tokens, cookies, signed links, or credentials in the authority corpus,
  prompts, logs, screenshots, or receipts.

## Recovery

The active campaign article is the recovery record. It contains the exact
root, branch, checkpoint, active owner, goal, lease, dependency position,
aggregate event-ledger digest, per-session writer heads, exact agent sessions,
blocker, and next action. The standard authority corpus describes the last accepted live
release. If a machine or task is lost, a fresh agent loads the package,
standard authority corpus, and active campaign record, verifies Git reality, and resumes
from the last accepted checkpoint.

After closure, raw release evidence is packaged at the configured retention
boundary into a verified ZIP in the historical evidence library. The archive
and prior task/session identities remain available for later questions.
