# AgentOS 2.1rc Operator Guide

Keep the package and its binding at `PREPARED_NOT_ACTIVATED` until an owner explicitly approves activation. A consuming project supplies its own typed Project Context; it does not modify the portable kernel.

Before setup, verify `schemas/bootstrap-binding.v1.json` against the exact files. Run `node tests/verify-portability.mjs` and `node tests/verify-all.mjs` from the candidate. Do not use a dirty convenience copy as authority.

Bootstrap is controlled by `control/bootstrap-compiler.mjs`:

```text
discover -> plan -> display exact digests -> APPROVE_EXACT_PLAN
        -> stage -> read back -> independent setup audit -> seal/promote
```

The setup Auditor must use a distinct session. Imported authority must have a verified `legacy.zip` before replacement writes. Generic `PROCEED` is not a valid approval.

At campaign runtime, `control/campaign-lifecycle.mjs` owns leases, custody, checkpoints, holds, append-only state, Runtime continuity, and next-campaign orientation. `control/campaign-cascade.mjs` owns applicable rolling audits, terminal settlement, Finalizer handoff, and delta scope. `control/question-tree.mjs` owns the exact three-root answer/lifecycle engine.

Runtime is the only merge/deployment executor. The Auditor is read-only. A successor release begins with an orientation-only Orchestrator after current Auditor release clearance; no successor roster or Product writer exists before accepted-live closure and explicit admission.

GPT_ASSIST is optional and advisory. Its source identity, chronology, current roster, exact questions, response JSON, and handoff digest are mechanically bound; it never writes authority or creates successor custody.
