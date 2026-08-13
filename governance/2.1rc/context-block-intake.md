# External Context-Block Intake

AgentOS may consume context extracted by an independent source train only as a
typed external companion block. Raw wiki, notes, chat, or legacy documents are
never treated as AgentOS authority.

## Required identity and provenance

Every block uses `schemas/context-block-intake.v1.json` and carries a stable
semantic ID/revision, author identity, portable-versus-project-specific
classification, authority scope, deterministic digest, and one or more source
documents. Each source records publisher, locator, version, immutable identity,
content digest, extraction timestamp, and authority class.

Authoritative statements, inferences, and historical notes are separate arrays.
Every statement points to a source identity. A missing or contradictory source
is an explicit unknown; it cannot be silently converted into a claim.

## Narrow applicability and composition

The block declares one atomic scope, non-goals, dependencies, conflicts,
precedence, intended roles, applicability and non-applicability conditions, and
the smallest sufficient selection rule. Required context fields are explicit.
The four-valued gate mapping (`YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`) is
optional only for blocks that do not define a decision gate; unknown closes only
the dependent action.

The minimal context payload is a digest-bound field allowlist with a redaction
profile. Project-specific blocks remain in the side-by-side project control
plane. Portable blocks may not contain project identity, private paths,
credentials, or consumer policy.

## Authority, evidence, and lifecycle

Allowed and prohibited authority, escalation, acceptance authority, minimum
evidence, claim boundary, and unknown handling are mandatory. Raw secrets are
denied and redaction proof is required. At least five adversarial fixtures and a
separate evaluator receipt are required. The author cannot self-admit a block.

Freshness, expiry, revalidation triggers, supersession/migration metadata, and
rollback to the preserved legacy source are required. An accepted block enters
AgentOS only through a typed intake receipt; intake performs no source mutation,
activation, deployment, publication, or consumer adoption.

The independent wiki/context lane owns source preservation, completeness,
no-loss, provenance/link, duplicate/contradiction, rendering, and clean
candidate proof. AgentOS may verify and register only its accepted typed output.
