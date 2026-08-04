# User Review Campaign

`USER REVIEW CAMPAIGN` is the recommended owner-facing planning route for a new feature, unclear intent, a change in project direction, a migration, or a substantial campaign. Its internal type is `PRE_CAMPAIGN_OWNER_REVIEW`; that name stays in the machine packet and is not shown in the friendly handoff.

The Campaign Orchestrator creates a read-only packet from the current project context, policy state, source identity, typed question inventory, and next-campaign candidate. The owner may discuss it in ordinary Chat or Voice, preferably in one project-scoped conversation. The conversation is advisory: it cannot write Product files, spend money, publish, merge, deploy, or admit a campaign.

## Owner-facing conversation

Begin with an open invitation such as:

> Tell me about what you’re building. Who is it for, and what made you want it?

Let the owner explain the project in their own words. Reflect what they say,
then ask one short, natural follow-up at a time. The owner should never have to
translate their idea into governance language. The assistant quietly maps the
story, the needed follow-ups, and a friendly recap to the required fields; the
underlying field names are not user-facing.

Use only the prompts that are needed:

1. What would you love this to make easier?
2. What would you like the first version to do?
3. What should stay just as you imagine it, and what can wait?
4. Is there anything this should never touch, change, share, or do without you?
5. Should we keep it economical, move quickly, be extra careful, or should I recommend a balance?

These are prompts, not a checklist. Skip anything already clear from the packet
or the owner’s story. Ask a technical or operational question only when a real
boundary or lasting decision remains. Explain that decision in plain language,
with simple tradeoffs and a recommendation. If the owner says “do what you
recommend,” record that preference while preserving the later exact-approval
gate.

For a short choice, show the choices plainly as one-based numbered options and
accept only a single number against that exact question. For a genuinely yes/no
question, accept `y`, `yes`, `n`, or `no`. An optional boolean question may also
accept `skip` or `unanswered`, which remains unresolved rather than becoming
`no`. A number or letter without the matching question context is never owner
intent, and ambiguous input stays unresolved.

Do not ask the owner to rediscover facts already supplied in the packet. Keep
the packet, source binding, internal field names, hashes, and return contract in
the background. At the end, play back the plan in ordinary language and ask
whether it sounds right. The return contains one canonical JSON payload.
Narrative is advisory. Memory can supply continuity, but it cannot override the
current packet, source, policy epoch, or owner boundary.

The owner may return plain Markdown, a private file, an admitted Git handoff, or an authorized connected conversation. A structured return is an adapter option, not a user-facing checklist. The natural return is held when a material answer or confirmation is missing; it is never silently filled from the old packet. A structured return preserves the conversation, owner confirmations, and unresolved items.

## Machine reconciliation

The packet binds:

- the current project context and source commit/tree;
- the current policy epoch and digest;
- the complete question inventory under Function Requirements, Design Bible, and Security;
- the proposed task profile and per-level/per-role economy, speed, difficulty-fit, and reason guidance;
- the selected transport and its return identity.

The Orchestrator reconciles the return, compiles any policy or project-course amendment, derives exact affected question IDs, and creates a typed project-context/authority delta. A conversational “yes” is not activation. A shared link is never an approval route. Only authenticated exact approval over the exact candidate and approval-packet digests can admit the next campaign. After admission, the ordinary Orchestrator controls the roster and custody; the review module itself creates no Product agents and writes no Product code.

When the queued campaign has a separate audit-checkpoint wrapper, the approval packet also carries a content-addressed identity mapping. That mapping keeps the Controller candidate as the canonical campaign identity and records the audit candidate, source commit/tree, terminal audit plan, and settled reconciliation. A missing or mismatched mapping keeps the candidate queued and inactive.
