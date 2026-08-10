# Shared hybrid scheduler

The project uses one scheduler boundary for every governed build, verification, runtime, database, and artifact operation. Platform agents, feature agents, Auditors, the Controller, and local worker sessions submit typed candidate-level plans to this boundary. They do not start heavyweight work directly.

The scheduler is mechanical. It does not decide whether Product work is correct. The Controller and independent Auditor retain that authority. The scheduler owns admission, bounded resource capacity, durable queue state, resource leases, candidate revalidation immediately before dispatch, secret-safe terminal diagnostics, and interruption classification.

The default policy admits one `AGENT_BUILD` holder and one holder for every heavyweight resource class. Parallelism is increased only through an explicit policy revision backed by measured resource evidence. Child process parallelism is bounded independently from lane parallelism.

Every request binds the repository, opaque worktree reference, candidate commit or content digest, toolchain, command argument vector, proof class, coverage, and expected proof. A candidate that changes before dispatch is cancelled as stale. A dirty or preliminary candidate is diagnostic-only and is never silently reused as release proof.

Scheduler records contain no absolute worktree paths, credentials, environment dumps, or raw command output. The host-local scheduler root is supplied at runtime and is not persisted in project records. Queue state moves through `SUBMITTED`, `VALIDATING`, `QUEUED`, `RUNNING`, and a terminal state. `QUEUED` and `RUNNING` are not proof of completion.

After a process crash or resource interruption, the scheduler preserves the last durable bytes, reaps only leases whose owner is no longer alive, converts an unfinished running job to `INTERRUPTED` with `UNTESTED` proof, and never silently retries it. The Intent Regulator exposes scheduler inspection on its continuous review loop so capacity, active holders, queue depth, stale candidates, duplicate plans, and bypasses remain observable.
