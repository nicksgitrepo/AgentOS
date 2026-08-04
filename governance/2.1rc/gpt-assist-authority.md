# 1241 — V1 Governance 2.1rc GPT_ASSIST Project-Status Authority

Status: `RELEASE CANDIDATE — PORTABLE, NOT ACTIVATED`

## Purpose

`GPT_ASSIST` is an optional operating mode selected during Bootstrap. It gives
the user one compact, portable project-status brief suitable for a ChatGPT
conversation using text, voice, research, scenarios, comparisons, or
specialized models.

It is separate from the optional Bootstrap Interview Markdown exchange.
`GPT_ASSIST` operates during development campaigns.

## Production and custody

While designing or updating a campaign, the independent Auditor compiles a
read-only content-addressed status packet. The packet binds the exact authority
snapshot, source commit/tree, campaign progress, Auditor session/report, and
release identity.

The Campaign Orchestrator remains the only canonical authority-corpus writer. It
may publish the Auditor packet into the current campaign tree as
`06-gpt-assist-project-status.md`. The Auditor and ChatGPT receive no Product,
authority-corpus, campaign, release, Runtime, or provider custody.

## Required status

The brief contains:

1. completed work with evidence;
2. work in progress;
3. work not done;
4. work needing planning;
5. every audit finding and whether it is open, checkpoint-fixed, deferred, or
   awaiting an owner decision;
6. missing context and its impact;
7. explicit user decisions;
8. open questions with a safe deferred default;
9. current campaign goal, owner, progress identity, and next action.

Raw test logs, screenshots, credentials, private records, and evidence packets
remain outside the brief and are referenced only by safe digests.

## ChatGPT interaction

ChatGPT asks exactly one question and waits. It may help the user understand
the project, explore edge cases, conduct research, compare alternatives,
answer the user's questions, and clarify intent.

When every listed material question has an explicit owner answer or is
explicitly deferred, ChatGPT stops asking questions and returns one concise
response Markdown bound to the source brief. It does not add a new
questionnaire. Only explicit owner answers are eligible for use. New research
or inferred context remains a candidate requiring owner confirmation.
ChatGPT is not expected to compute a digest. The response Markdown contains
exactly one canonical JSON payload and no separate authoritative prose. The
source Auditor parses that payload directly; it may not supply a parallel
extraction object. Contradictory or unparsed prose fails closed.

ChatGPT cannot:

- mark a defect fixed;
- change a gate or campaign status;
- write canonical authority;
- transfer custody;
- claim deployment, acceptance, or live truth;
- retain credentials or raw private evidence.

## Auditor return, next campaign, and promotion

The response Markdown returns to the exact Auditor that produced the status
brief. The Auditor validates the package binding, uses the owner-confirmed
answers to correct or complete the next-campaign candidate, and hands off:

- the content-addressed next-campaign candidate;
- a content-addressed work-in-progress authority update candidate; and
- the source status and response identities

to a later admitted next Campaign Orchestrator. The Auditor remains
read-only and never writes the authority corpus. No successor Orchestrator,
Auditor, Feature Agent, or Product writer lease is created at this handoff.
After admission, the next Campaign Orchestrator is the sole writer: it validates
the handoff, updates the work-in-progress campaign authority, and starts the
next release.

The status source commit and tree are mechanically read back from the admitted
repository. Status generation strictly precedes response completion, and the
handoff cannot predate completion. The handoff binds the exact source response
Markdown digest, normalized response digest, next-campaign digest,
authority-update candidate digest, and current roster receipt. The successor
roster receipt is `null` until a later admission creates it. A later
next-campaign transition consumes that exact handoff digest; the candidate
packet does not itself create a successor session.

Standard numbered articles remain the last accepted-live release. They are
not rewritten merely because ChatGPT answered a question or the Auditor
prepared a future campaign.

At accepted-live closure, the Orchestrator promotes only the changed accepted
truth into the affected standard articles. Unresolved questions remain in the
next-campaign input.

## Recovery

The Markdown status and content-addressed status packet are sufficient to
restart the conversation on another computer without private chat history.
The response Markdown is sufficient to resume the Auditor handoff. Archived
release evidence remains separately packaged and selectively readable.
