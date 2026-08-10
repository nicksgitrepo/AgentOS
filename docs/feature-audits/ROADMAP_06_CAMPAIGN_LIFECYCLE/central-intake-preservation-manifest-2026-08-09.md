# Central intake preservation manifest — governed campaign lifecycle — 2026-08-09

This manifest preserves the central bytes before the second lifecycle intake.
The visible lifecycle task repaired the stale shared-surface regressions and
returned a fresh source-bound handoff. No downstream task, release, or runtime
activation is implied by this intake.

## Source and custody

- Feature: `ROADMAP_06_CAMPAIGN_LIFECYCLE`
- Source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- Source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- Source observation: `8a7e356fdb0a3ae41f50472989d8be3e8cc2dd6efa1ed9ef1d8fcc3d14ea2c7c`
- Handoff: `8cba0022cfa6953029bbce4926fec59b6eacbc6eecba4c9657e104261f62a4a4`
- Downstream consumed before intake: `false`
- Platform domains: `0` because no source-backed cross-feature seam was proven.

## Central pre-intake and candidate readbacks

| Path | Central before | Candidate after | Intake decision |
| --- | --- | --- | --- |
| `control/README.md` | `babd9ad065c520c74720e5a5cc69e77518df9b0fef80da04b3e861351309b076` | `1f22c943fd4fb2bfb50c424e896aa2d620e0e5fc673bc0c98ab0bdccb5ad1ce0` | Apply one lifecycle documentation bullet; preserve all other central text. |
| `control/continuous-operating-loop.mjs` | `3cb46314d9cbf03e8b84460218847f028a24becb3d7b0bb2a234229e7df1f0dc` | `fa8a2ce698a03b30e330e8210fe3ab88deda522fb7b0f661ac9e277761a5540d` | Apply the privacy, source/intent, host-receipt, test-build, typed-model, durability, and blocker-boundary deltas. |
| `schemas/continuous-operating-loop.v1.json` | `c1779df8d9988df1e93912bdea03b33643f4f911d400183857bbc5d56a472b17` | `304c3c897a05f0ad0d251df81700924c73fd6e38bae0e7426020f0ffdf639711` | Apply the matching lifecycle contract deltas. |
| `tests/verify-continuous-operating-loop.mjs` | `8ff101eb36519be8a84c6646f7a8025ab5847916c6e02d82cfdf39ef489ae86d` | `0322082fa43a48e68b20ef76afd45c42d26d50682835fca6545b315d43cbc1ac` | Apply focused assertions for privacy, blockers, source binding, stale repair, and host receipts. |
| `tests/verify-all.mjs` | `177f7a35aa37f76b09023d3e7d4b28fbc5c10bdf4e1a6c69d3c94c2ccfe9284b` | `6e6aff4856cb96a3bb4dccc2ee2d2021cebacc6492091d65c13baf0be0696772` | Apply only the two lifecycle assertions; preserve dynamic discovery and current verifier coverage. |
| `schemas/bootstrap-binding.v1.json` | `1e935a57db40fb3a52c3262fd3e07de0fea7c683c6dfeab626d1ffba52a74135` | `cb1f612633eb1ff0515b61401c174d47f349890d15ff922a50063bac48aed82c` | Update only the six resulting file digests while retaining all 308 normative and 9 compatibility entries. |

The candidate also reported exact central equality for the campaign lifecycle,
controller, privacy primitive/schema/verifier, role naming, bootstrap contracts,
kernel, user guide, and naming documentation surfaces. Those bytes are not
replaced by this intake.

## Proof boundary

The lifecycle task performed static syntax, JSON, digest, diff-hygiene,
portability, privacy, and central-difference checks. Functional verifiers,
real host readbacks, concurrency, crash/power-loss durability, clean-source
proof, commits, pushes, release, deployment, and archive actions remain
pending. The central worktree must independently re-audit before this candidate
can be considered downstream-consumed.
