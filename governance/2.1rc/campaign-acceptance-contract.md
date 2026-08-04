# Complete Campaign Acceptance Contract

The campaign contract comes before implementation. It contains the ordered Function Requirements, Design Bible, and Security roots; a complete question inventory for each root; operational and evidence requirements; owner intent; hard rules; non-goals; policy snapshot; and the exact stop condition.

“Smallest” means the smallest implementation that satisfies this complete contract. It never means deleting a required function, design, security, operational, or evidence obligation.

Every added implementation surface must be traceable to one of four bases:

```text
required by acceptance
required by a hard rule or material present risk
required to resolve an observed blocker
explicitly authorized by the owner
```

Auditors remain read-only and investigate broadly inside their domain. The Campaign Finalizer repairs confirmed failures at their owning boundary. A rebuild is allowed only when evidence shows targeted repair cannot make the retained architecture pass. Once every required gate passes, adjacent improvements become next-campaign ledger items.
