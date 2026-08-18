# Start an AgentOS project

This file is a simple guide. The typed AgentOS contracts remain the authority.

1. Start the Bootstrap agent in the clean AgentOS folder.
2. Ask it to evaluate this file.
3. Bootstrap safely checks the nearby folders and the local environment without importing another project's private memory.
4. Bootstrap asks one simple question at a time. Each choice includes **Yes**, **No**, **Explain more**, **Advanced details**, and **Not sure** when those choices fit.
5. Bootstrap starts exactly one Spawner. This is the only non-Spawner agent creation allowed.
6. Bootstrap asks the existing Spawner to create the rest of the permanent project team: Controller, Memory, Orchestrator, Runtime, and Scheduler. The roster keeps exactly one Spawner.
7. Bootstrap becomes **Project Owner _Project Name_**. The Project Owner is the person-facing agent and uses simple, natural language by default.
8. The Project Owner asks whether to use the Pyramid workflow or Collaborative Audit workflow.
9. The Project Owner checks project direction every 15 minutes. Controller checks every 15 minutes that useful work is really moving and repairs ordinary stalls automatically.
10. For each feature, a capability-strong planner writes a careful, complete,
    bounded plan before implementation starts. The plan avoids over-engineering,
    premature abstraction, and scope creep.
11. Economical, capable subagents implement the plan in an isolated work area
    using its detailed instructions. Implementers run the assigned tests, but
    they never review, judge, or accept their own work.
12. The Orchestrator independently reviews the plan, candidate, tests, and
    evidence. It accepts a complete result or returns detailed, issue-bound
    repair instructions until the result is accepted.
13. A model name in a plan (for example, `Luna xhigh`) is only a suggestion.
    The current canonical model policy chooses the actual model and any fallback.
14. Protected blockers remain governed. They hold only the dependent action and
    are never bypassed by a planner, implementer, model suggestion, or reviewer.

The reusable feature records are [`templates/feature-planning/FEATURE_PLAN.md`](templates/feature-planning/FEATURE_PLAN.md), [`templates/feature-planning/ORCHESTRATOR_REVIEW.md`](templates/feature-planning/ORCHESTRATOR_REVIEW.md), and [`docs/feature-planner-implementer-review-loop.md`](docs/feature-planner-implementer-review-loop.md). The typed AgentOS contracts and the selected workflow remain authoritative.

## Collaborative Audit in simple terms

- One builder gets one isolated work area.
- Six focused checkers inspect the work at the same time.
- Each checker writes one report. The Orchestrator combines them into `auditresults.md`, with one issue file per finding.
- After each report is safely handed off, Spawner closes that checker.
- The builder fixes the combined list. Fresh groups of six check the repairs.
- A problem gets three normal repair-and-check attempts. If it still fails, the original builder finishes the other items and Spawner creates a stronger fresh clone for the difficult item, but only when the model policy proves that model is available.
- When everything passes, Runtime performs the merge and only deploys when the owner's delivery choice allows it.
- Spawner closes temporary builders only after their handoff is safe and nothing still points to their work area.
