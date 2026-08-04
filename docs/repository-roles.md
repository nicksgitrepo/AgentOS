# Repository roles

AgentOS and a Product are separate concerns. A Product repository should stay
clean enough for a professional release: it contains the source, build and
runtime configuration, tests, and documentation needed to build and run that
Product. It does not become the home for AgentOS conversations, governance
working notes, campaign state, or scratch work.

## AgentOS home

The AgentOS home is a separate repository or local folder. It is the
developer’s home for the wiki, governance, tools, agent notes, conversations,
handoffs, campaign state, evidence, and the durable context needed to work on
the Product. The owner chooses one of these storage styles:

- `LOCAL`: kept on the local machine without a Git history;
- `GIT`: kept as its own Git repository;
- `HYBRID`: kept as its own Git repository with local-only working material
  kept outside the release-facing subset.

The AgentOS home may be a public distribution, a private clone, or a local
private copy. Private project context and agent working material must not be
added to a public distribution.

## The three-repository maintainer layout

This layout exists only because AgentOS itself is being developed. It is not a
requirement or intent imposed on a consuming Product.

During AgentOS development, keep these roles distinct:

1. **Baseline/source repository** — the existing reference history and remote
   source. It is not the active work area.
2. **Development repository** — the isolated place where AgentOS changes are
   built, tested, and reviewed.
3. **Sterile release repository** — a clean copy made only from a verified
   development snapshot. It contains no development metadata, private notes,
   conversations, credentials, temporary work, or unrelated project files.

Only the sterile release repository is a candidate for public publication.
Product repositories and private work repositories are separate from all
three AgentOS maintainer roles.
