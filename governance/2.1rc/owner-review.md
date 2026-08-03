# User Review Campaign

`USER REVIEW CAMPAIGN` is the recommended owner-facing planning route for a new feature, unclear intent, a change in project direction, a migration, or a substantial campaign. Its internal type is `PRE_CAMPAIGN_OWNER_REVIEW`; that name stays in the machine packet and is not shown in the friendly handoff.

The Campaign Orchestrator creates a read-only packet from the current project context, policy state, source identity, typed question inventory, and next-campaign candidate. The owner may discuss it in ordinary Chat or Voice, preferably in one project-scoped conversation. The conversation is advisory: it cannot write Product files, spend money, publish, merge, deploy, or admit a campaign.

## Owner-facing conversation

The Markdown handoff starts with one short natural question. The next question is chosen after the owner responds. The handoff does not expose phase names, field names, hashes, or a large technical checklist. It should feel like a thoughtful teammate asking one useful question at a time.

The conversation gradually covers:

- the outcome and the people it should help;
- what should change, stay familiar, or wait;
- the smallest complete result that would let the owner stop honestly;
- anything unsafe, private, costly, irreversible, or outside the boundary;
- the tradeoff between economy, speed, and reasoning strength;
- what remains unclear or needs correction.

The owner may return plain Markdown, a private file, an admitted Git handoff, or an authorized connected conversation. The natural return is held when a material answer or confirmation is missing; it is never silently filled from the old packet. A structured return preserves the conversation, owner confirmations, and unresolved items.

## Machine reconciliation

The packet binds:

- the current project context and source commit/tree;
- the current policy epoch and digest;
- the complete question inventory under Function Requirements, Design Bible, and Security;
- the proposed task profile and per-level/per-role economy, speed, difficulty-fit, and reason guidance;
- the selected transport and its return identity.

The Orchestrator reconciles the return, compiles any policy or project-course amendment, derives exact affected question IDs, and creates a typed project-context/authority delta. A conversational “yes” is not activation. A shared link is never an approval route. Only authenticated exact approval over the exact candidate and approval-packet digests can admit the next campaign. After admission, the ordinary Orchestrator controls the roster and custody; the review module itself creates no Product agents and writes no Product code.
