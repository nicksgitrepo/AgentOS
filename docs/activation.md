# AgentOS 2.1rc Activation Boundary

This package is `PREPARED_NOT_ACTIVATED`. Publishing a branch or pull request
does not activate Governance 2.1rc and does not rebind any consuming project
or active campaign.

Activation requires an explicit owner decision after the exact source mapping,
portable verification, independent source review, and target integration are
recorded. Activation must establish a project-specific context separately,
select providers and deployment bindings, and create the generation-open
record in the consuming project. No activation, Product merge, deployment,
promotion, or campaign rebind is performed by this extraction.

This candidate supplies the portable contract and fail-closed controller
boundaries. It does not pretend to include a universal model host, agent or
worktree spawner, hosted deployment connector, or live-browser driver. Those
capabilities must be supplied and independently read back by the consuming
project's typed adapters before a real campaign can be admitted as executable.

The project-level `AGENTOS_CONTROLLER` is distinct from the campaign-scoped
`CAMPAIGN_ORCHESTRATOR`. The Controller Agent handles judgment and routing;
the Controller Runtime handles deterministic event processing, persistent
state, timers, and compare-and-swap writes. Neither layer can claim an
external action succeeded without the corresponding project-bound adapter
readback.
