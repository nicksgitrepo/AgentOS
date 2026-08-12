# Bootstrap

The canonical setup controller is `control/bootstrap-compiler.mjs`. It combines
secret-free discovery, a compact question plan, complete creation-plan
compilation, exact digest approval, resumable staging, legacy preservation, and
independent setup audit. `bootstrap/start-here.md` is the human entrypoint.

`control/bootstrap-interview.mjs` and `control/guided-bootstrap.mjs` are
migration-only aliases. They cannot create setup state or own authority.

Bootstrap keeps its durable authority and state in the bound control plane.
The project root is the user’s source and delivery space. External control
storage is the default; an in-project control plane requires an explicit
`IN_PROJECT_OPT_IN` binding.

The owner conversation is adaptive rather than a fixed form. It asks the
project outcome and first useful result first, then the starting point, scope,
and a compact capability selection. Only selected capability branches become
required: visible surfaces, backend/API work, data, access, AI/search, integrations,
hardware/realtime, commerce, and safety/regulatory applicability each open
their own narrow questions. Changes to existing work must name behavior or
information that cannot regress, and every project binds technology and
operating constraints. Unselected branches compile as explicitly
`NOT_APPLICABLE`; they are never guessed. Revising a parent selection removes
now-inapplicable child answers before contract compilation.

The compiled project contract carries the normalized project profile, quality
priorities, acceptance condition, owner boundaries, delivery intent, and
content-addressed decision trail. This profile is project data; it does not
change or contaminate the portable AgentOS kernel.
