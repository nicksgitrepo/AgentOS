# Central intake preservation manifest — proof acceptance — 2026-08-09

This manifest preserves the central bytes before the ROADMAP_07 proof and
inventory intake. The visible task completed its repair/re-audit cycle on
`codex/roadmap-07-proof-acceptance`; no downstream consumption is implied.

## Source and custody

- Feature: `ROADMAP_07_PROOF_ACCEPTANCE`
- Candidate handoff commit: `aacda08b9e925af05cc1ed0d1cd8a92a9d9f3c2e`
- Candidate handoff tree: `a2b5bde38200febc25e0396ef94784b0f8886533`
- Report commit: `ebf5743d5cea75b86845b2d115c7413c9f01885d`
- Candidate branch: `codex/roadmap-07-proof-acceptance`
- Downstream consumed before intake: `false`
- Platform lanes: `0`; no source-backed cross-feature platform seam was proven.

## Central pre-intake and candidate readbacks

| Path | Central before | Candidate after | Intake decision |
| --- | --- | --- | --- |
| `control/feature-completeness.mjs` | `0e1ef8055cabe7c869d50200f22cfda3bb03aa3a41d8acb3a71edc53a72de7f2` | `017bae247b28bc2a5e967b9a0a1e9df96ae80088caf565322ea9662ce12c2d02` | Apply additive inventory/coverage validators and trailing-directory compatibility; preserve current privacy guard and existing feature behavior. |
| `tests/verify-feature-completeness.mjs` | `e8108189ca8025d4ebd8ebc2e5e09fed5582189211df2d14f7c9ffff113a17d6` | `9f70d0eb8de9c123d1828009511dccdc98f33fca7c75b516b5cd3908cdade7b6` | Apply additive 37/12/49/zero-platform inventory and coverage assertions; preserve exhaustive hostile and stale-source tests. |
| `control/proof-carrying-work.mjs` | absent | `009ec6f9eb4fe634a6b1f21aad624109edeb2ed68e617986122babe4898624d7` | Add inactive proof capsule controller with source, generation, seam, invalidation, and false downstream custody binding. |
| `schemas/proof-carrying-work.v1.json` | absent | `e9e3c71718c5c2e81c33ce3a3356f4898d553d0013281177a9b1a51c220b94e7` | Add matching inactive contract. |
| `tests/verify-proof-carrying-work.mjs` | absent | `ee4bd8a4da20295f3da0dbc1a0b66850450c2b3ce12247b14377be306aeb9100` | Add focused static/hostile verifier fixture; functional execution remains pending. |

The candidate also carried exact central bytes for
`control/content-addressing.mjs`, `control/persisted-record-privacy.mjs`,
`schemas/feature-completeness.v1.json`, `schemas/digest-bound-checkpoint.v1.json`,
and `schemas/repair-receipt.v1.json`; those paths are not replaced by this
intake. The central binding was
`ecfb4cc390e5c7a34fad5ba98420cd3810a955f501721eda7263cb811dbc922c` before
the additive binding entries.

## Proof boundary

The visible lane performed static syntax, JSON, diff-hygiene, privacy, and
inventory-shape checks only. Functional focused verifiers, clean-checkout
reproduction, independent acceptance, cumulative compatibility, commits to
central, pushes, activation, release, deployment, and archive actions remain
pending. The candidate is not downstream-consumed and no true blocker was
found.
