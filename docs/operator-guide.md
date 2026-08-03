# AgentOS 2.1rc Operator Guide

AgentOS is a portable governance package. Before use, copy the package into
the admitted project root and provide a project-context instance derived from
`authority/templates/project-context.v1.json`.

The operator is responsible for confirming project identity, repository
ownership, provider and deployment choices, model policy, retention, and
protected boundaries. Bootstrap discovers facts read-only, asks one material
question at a time, and persists its typed state. It does not invent missing
project truth.

Run the portability verifier and the complete verifier before admitting a
project context. Keep the package `PREPARED_NOT_ACTIVATED` until the source,
context, independent review, and owner decision are recorded. Product work,
deployment, and promotion remain outside this repository.

`RC_READY` requires a content-addressed question-tree proof. The campaign
controller recomputes the result from the exact tree and observations, checks
the evidence-cache digest, and verifies the Auditor attestation is derived
from that result. A receipt alone is not an admission substitute.

GPT_ASSIST is optional Markdown exchange only. The canonical JSON payload,
source identity, chronology, and project context remain authoritative.
