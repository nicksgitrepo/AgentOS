# Visible host readback — controller evidence

Audit date: 2026-08-09
Status: VISIBLE_HOST_ATTACHED_PARTIAL
Platform phase: PLATFORM_FOUNDATION
Feature phase: NOT_ADMITTED

## Read-only observations

- The Codex host returned 50 visible task summaries.
- All returned tasks were attached to the same opaque local host reference: HOST_REF_LOCAL.
- An existing visible native-session task was readable with host attachment and an idle terminal status.
- A bounded wait snapshot returned the existing task, its host attachment, and its latest completed turn without creating or changing a task.

## Capability boundary

The visible host currently proves list, read, and bounded wait observations for existing tasks. The controller has also used the existing visible-task message route during this campaign. No new task was created.

This is not proof that the project-native host adapter can perform create, pin, progress readback, typed handoff readback, unpin, archive, or active-roster removal. Those operations remain unexercised and must not be inferred from a visible Codex host attachment.

## Privacy and custody

This record stores only opaque host/task references, statuses, and capability classes. It stores no task UUID, private path, credential, provider token, raw session identity, or chat link. The existing visible task and its isolated worktree remain preserved and unarchived.

## Admission consequence

The host question is narrowed from host attachment to native lifecycle proof. Platform admission remains HELD until the authorized host adapter supplies source-bound create/read/progress/handoff/closure evidence or returns a typed unavailable result. Feature phase remains NOT_ADMITTED.

## Controller interpretation correction — 2026-08-09

The Codex app task is the active Controller host for this campaign. No
separate graphical interface is required. The Controller may use existing
visible task messaging and bounded waits as its coordination surface, and the
native-session route may use its explicit request-bound model/reasoning mode
when the host accepts the request but omits those fields from its response.

That does not turn a coordination observation into a native lifecycle receipt:
actual native campaign launch still requires the supplied host callbacks for
create, pin, send, wait, read, unpin, archive, and roster-absence proof. This
is a capability boundary, not a GUI blocker. The requested model and reasoning
profile may be accepted from the task request when the host omits those two
optional fields; that is request-bound acceptance, not invented host evidence.
