# Owner-feedback backlog

This is a project-agnostic record of user-visible roughness found during
governed development. Items remain open until a later bounded campaign records
the repair and its evidence. The repeatable control-plane loop may schedule
the named follow-up campaign as a control-plane task; campaign activation,
Product work, and agent spawning still require their separate boundaries.

| ID | User-visible symptom | Expected behavior | Follow-up campaign | Status |
| --- | --- | --- | --- | --- |
| `FEEDBACK-001` | The system stopped at an inactive gate without explaining the exact boundary in the user flow. | Explain the specific inactive boundary and the safe next action in plain language. | `CAMPAIGN-CONTROLLER-INACTIVE-EXPLANATION` | `OPEN` |
| `FEEDBACK-002` | A completed task was still shown as not started. | Reconcile task status and user-facing progress so a completed task is shown as completed. | `CAMPAIGN-CONTROLLER-STATUS-RECONCILIATION` | `OPEN` |
| `FEEDBACK-003` | A completion record hit a stale-digest failure. | Bind completion records to the current parent, report the mismatch clearly, and preserve the original evidence. | `CAMPAIGN-CONTROLLER-DIGEST-REPAIR` | `OPEN` |
| `FEEDBACK-004` | The Controller spent several minutes planning without visible progress. | Show a concise progress state and the next bounded action while planning continues. | `CAMPAIGN-CONTROLLER-PROGRESS-RECEIPTS` | `OPEN` |
| `FEEDBACK-005` | Continuing required a manually supplied exact task instead of the Controller choosing the next safe task. | Select one validated next control-plane task from the queued candidates without requiring a new manual task declaration. | `CAMPAIGN-CONTROLLER-AUTOMATIC-CONTINUATION` | `OPEN` |
| `FEEDBACK-006` | There is no working path yet from safe preparation to real campaign execution with agents. | Define and verify the separate owner-authorized transition from inactive preparation to campaign execution, including the required agent and Product boundaries. | `CAMPAIGN-CONTROLLER-EXECUTION-BOUNDARY` | `OPEN` |
| `FEEDBACK-007` | The checks needed repair during the task. | Make check failures visible, preserve their evidence, and repair the check path before claiming a clean handoff. | `CAMPAIGN-CONTROLLER-CHECK-REPAIR` | `OPEN` |
| `FEEDBACK-008` | The ongoing Controller conversation was presented with the Bootstrap identity. | Identify the ongoing project-persistent role as AgentOS Controller (`AGENTOS_CONTROLLER`) and reserve Bootstrap for discovery and setup. | `CAMPAIGN-CONTROLLER-ROLE-DISPLAY` | `OPEN` |

No item in this record authorizes a campaign start, Product write, agent
spawn, deployment, release, push, merge, sterile-copy change, secret access,
or destructive action.
