# Bootstrap

The canonical setup controller is `control/bootstrap-compiler.mjs`. It combines
secret-free discovery, a compact question plan, complete creation-plan
compilation, exact digest approval, resumable staging, legacy preservation, and
independent setup audit. `bootstrap/start-here.md` is the human entrypoint.

`control/bootstrap-interview.mjs` and `control/guided-bootstrap.mjs` are
migration-only aliases. They cannot create setup state or own authority.
