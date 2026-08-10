# Private-context detector

`control/private-context-detector.mjs` is the project-agnostic public-context
boundary for release-bound records and governance output.

It rejects generic private shapes such as absolute machine paths, environment
references, secret-like assignments, private links, and raw host or session
identifiers. A caller may supply project identity terms from a typed runtime
context for a transient scan. Those terms are never compiled into the release,
returned in a match, or written into a public record.

The detector returns only a category and a digest of the matched text. Raw
private values are never part of its result. `assertPublicContext` fails closed
when any category is found.

This contract is a source-hygiene boundary, not an authorization system. It
must be applied before public documentation, handoffs, evidence, release
records, or generated governance are persisted.
