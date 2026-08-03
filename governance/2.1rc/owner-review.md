# User Review Campaign

`USER REVIEW CAMPAIGN` is the recommended owner-facing planning route for a new feature, ambiguous intent, a change in project course, a migration, or a substantial campaign. Its machine type is `PRE_CAMPAIGN_OWNER_REVIEW`.

The Campaign Orchestrator mints a read-only packet from the current project truth, policy epoch, source commit/tree, and next-campaign candidate. The owner may discuss it in ordinary Chat or Voice, preferably inside one project-scoped conversation. The conversation is economical and natural; it is not a Product worker and it does not own authority.

The six questions are:

```text
ORIENTATION       Is the current summary accurate?
INTENT            What outcome matters, for whom, and why now?
DESIRED_CHANGES  What should change, stay, be removed, or wait?
CAMPAIGN_SHAPE   What is the smallest complete proving workflow?
MODEL_PLAN       Which review level and campaign role classes fit cost, time, and risk?
REVIEW_SUMMARY   Did the owner confirm the mirrored plan and unresolved boundaries?
```

The return contains one canonical JSON payload. Narrative is advisory. Memory can supply continuity, but it cannot override the current packet, source, policy epoch, or owner boundary.

The Orchestrator then classifies the return, compiles any policy amendment, creates a Canon/project-context delta, recalculates affected question roots, and presents one exact approval packet. A conversational “yes” is not activation. A shared link is never an approval route. Only authenticated exact approval over the exact candidate digest can admit the next campaign. After admission, the ordinary Orchestrator controls the normal roster and custody; the review module itself creates no Product agents and writes no Product code.
