# Current platform receipt byte-preservation record — 2026-08-11

This append-only record preserves the exact source-bound Gate and Native
receipt identities consumed by the ordinary AgentOS controller. It contains
opaque digests and public custody facts only; it does not export task/session
identities, private paths, credentials, provider tokens, or external project
context.

## Binding

- Current Central publication: `ccb235d046b9d3d5ce902180457599bfd904fced` /
  `2e800a51f469c47ad76ecfa8afd03cc1ba6a7a38`.
- Prior clean Central publication supplied for rebind: `73c7c84293755a2da88343ec8fbb46098773b9f1` /
  `6021358adc39381a2e7ab8f85cf46d637983209f`.
- Product/feature candidate: `15254f79096be8c5da58afdc4837456f6952d9f8` /
  `a3c38f7a6eb33926f59fd771653abf14ea12148c`.
- Source baseline: `d885e73382df26da596848d70dbb402d6a9cf8b8` /
  `5f6ed007168ba660ca6f224e632b1dedd02202a5`.

## Gate receipt

- Owner receipt commit/tree: `48c8fe499da60fa181236bad7c237e67459e06a8` /
  `48d0e65ba340ca7381fae4d62cfe1fe4910f764d`.
- Exact report SHA-256: `493df163c54d82c16a9b42236d97b3a2a88505cc00af43b469d226aa30bdf620`.
- Exact handoff SHA-256: `4b98bda22bcb314e777640e3bfc4df7ecbac6dd4655a204f38b4e116a517ce68`.
- Canonical paths: `docs/platform-audits/PLATFORM_GATE_RESPONSE/auditreport.md`;
  `docs/platform-handoffs/gate-catalog-response-platform-handoff.md`.
- Read-only owner-byte verification: `PASS`.

## Native receipt

- Owner receipt commit/tree: `98db27f63f9440e23768f28673fb8059704e90fd` /
  `9f0a2b7b91e5d1297656774722e1109ea189d653`.
- Exact report SHA-256: `5e18be26c2b38490762acecac27917596974c3d4dded1d4afbb3c844059499a6`.
- Exact handoff SHA-256: `e79a3740a27d54e42338c598b90d1ca9a63824ba879ac8e60afd9cc06aadcc3d`.
- Canonical paths: `docs/platform-audits/PLATFORM_NATIVE_SESSION_EVIDENCE/auditreport.md`;
  `docs/platform-handoffs/native-session-evidence-platform-handoff.md`.
- Read-only owner-byte verification: `PASS`.

## Custody and proof boundary

The Central canonical report/handoff paths retain prior append-only historical
bytes; this record is the current exact digest projection and preservation
reference. It does not claim that the old independent HOLD is current
clearance, and it does not transfer feature consumption, Platform clearance,
independent clearance, downstream consumption, or Controller slot release.
All ordinary cursors remain `FEATURE_CURSOR_000`; five ordinary slots and zero
Memory slots remain. The next action is to consume only fresh current-bound
typed proof receipts. Deferred real-host/provider proof remains an evidence
ceiling rather than a local development pass.
