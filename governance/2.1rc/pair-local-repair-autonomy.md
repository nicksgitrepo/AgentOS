# Pair-local Repair/Auditor autonomy

An admitted Repair/Auditor pair has standing authority for serial work inside
its bound lane, worktree, branch, test boundary, and product intent. Ordinary
work never waits for Controller, Orchestrator, Spawner, Sentinel, or the
Project Owner.

The normal loop is direct:

1. The Auditor maintains one evidence-complete READY seam.
2. Repair owns exactly one issue and produces the smallest root-cause change.
3. Repair freezes one immutable candidate and sends identical bytes directly
   to the bound Auditor.
4. A bounded FAIL returns directly to the same Repair task. Repair may create
   serial successor candidates without fresh central approval.
5. PASS routes the immutable candidate to Runtime for delivery.
6. While Repair is legitimately waiting on an external dependency, the
   Auditor may research the next READY seam without releasing it early.

Evidence corrections, receipt-digest corrections, test setup inside the
admitted boundary, successor candidates, bounded audit failures, and the next
READY seam are pair-local transitions. Fail-closed handling preserves custody
and continues locally; it does not create a permission checkpoint.

A true blocker is limited to an evidence-complete condition that standing lane
authority cannot resolve and that requires a concrete external decision:

- unavailable host capability;
- external dependency authority;
- destructive or ambiguous custody conflict; or
- a genuine product-intent choice.

One blocked seam never stops unrelated lanes. Sentinel observes and
deduplicates; Controller handles true workflow or host blockers; Orchestrator
and Spawner handle lifecycle boundaries; Runtime alone delivers accepted
candidates. None of those roles intermediates ordinary pair traffic.
