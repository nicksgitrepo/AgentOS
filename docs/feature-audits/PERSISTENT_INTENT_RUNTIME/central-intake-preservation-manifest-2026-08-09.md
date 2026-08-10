# Central intake preservation manifest — Persistent Intent Runtime — 2026-08-09

This manifest records the dirty central bytes immediately before the first
source-compatible PIRT intake. No central file was replaced wholesale. The
candidate is source-bound to central commit
`590c07ddd4be7a8c24727c24b40808e44ca7357d` and tree
`f1b358d87e6a969fb9631e202a3d478540edd4d9`.

Candidate source observation: `ae39bf92ac5a869a467c3e99e6a3e5f6764dd97fbcef4cdc4f3d872e490385f3`  
Candidate handoff: `1a159f33674d98f592d0e178285b076b2765917c0b01fb1cabe06942e51fa857`  
Downstream consumed before intake: `false`

## Pre-integration central hashes

| Path | Central bytes before intake | Candidate bytes | Intake treatment |
|---|---|---|---|
| `control/agentos.mjs` | `14f020ee64f1d44b5754286a2cf5ce0aed9cda1de5d4f90a06f75f71a43e61c1` | `9cb9a1ec5458de7a1341702ab914e4903a333fca7c58d82c2f7b6dbc13bc549b` | preserve full central surface; add PIRT exports |
| `control/persistent-intent-runtime-contract.mjs` | `16a4e11d12a635a6f3bcae1e1816b34b63c7958d1d30220aec1d4fc86b893c8a` | `6d525e04615363676da64d69d129cb25a82cd5bdc477e89908a6909cc0983683` | apply additive PIRT contract/owner replacement deltas |
| `control/persistent-intent-runtime-storage.mjs` | `32af7b8f0da2df8148e2d82a185a230b446f3c6b121b50285fd62e3e813a6335` | `7c55d7f6998cede5515088791bf97c26b1ad8e34b9917d87ca37be162a93b2ef` | apply checkpoint/event durability deltas |
| `control/persistent-intent-runtime.mjs` | `860d8286cb654f2c37f51dedab7730e6f02fb20b9b7a12bc70a220708c67da30` | `18d8c6ffa14cec0c2553b100b686320925d26d2fe7e9fccbe52a2f3690eeb384` | apply additive runtime readback/replacement deltas |
| `schemas/persistent-intent-runtime.v1.json` | `6d9cc872fd6f22992845f06b244d5be984ed7a074439295dc8bacc0f4781a89f` | `0e39a258dbfaf8913d8fb027bda2333a4e7bb358810a519bbcbdb4db79178fea` | apply owner-replacement/event schema additions |
| `tests/verify-persistent-intent-runtime-schema-parity.mjs` | `8d87cb96b7a87b8ea62fae11b03a90971da9ca261db90127d7a83532d802fdc` | `b23319b382f28b525ef7fe65ee0e724d05d3147cc1cd65a21158d2bb1bfb46ab` | apply additive parity assertions |
| `schemas/bootstrap-binding.v1.json` | `32e61516131198fad1b1ab32895b3762dd7231dac656d3c5c2dbb1b61c2b7e00` | `33af7417af21a6e29429c9337d9cab74da7cc301b510e74929c86c5325099d0e` | retain all central entries; add PIRT entries and kernel digest |

The remaining PIRT candidate paths were either absent from the central tree or
already byte-identical to current central sources. This manifest is retained
as custody evidence; the visible PIRT task and worktree remain unarchived until
the independent central re-audit and downstream preservation boundary are
complete.
