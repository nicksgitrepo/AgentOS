# Typed semantic successor readback

The import Orchestrator must persist a semantic successor, not only a JSON
file whose self-digest happens to verify. `control/typed-successor-readback.mjs`
is the project-agnostic gate for that boundary.

Each successor atomically binds:

- the sorted queue snapshot and its digest;
- counts derived from the queue (current-authority accepted, collected, and
  released slots);
- the registered next action and handler;
- a non-null semantic readback digest; and
- the predecessor digest and transition sequence.

Validation fails closed when a caller reports counts that do not derive from
the queue, supplies a null or divergent readback, or repeats a transition with
no semantic change. `writeTypedSuccessorReadbackCompareAndSwap` writes a staged
record under an explicit control-plane authority root, fsyncs the file and
directory, and verifies the complete record after replacement. Historical
records are never rewritten: callers create a new successor path and bind its
predecessor digest.

This contract does not spawn workers, activate waves, access providers, mutate
consumer projects, or make release decisions. It only makes the next route
durable and auditable so the Controller can supervise the Orchestrator without
trusting commentary or stale queue state.
