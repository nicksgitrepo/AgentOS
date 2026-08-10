# Project Memory Ledger Central Intake Preservation Manifest

- authority: `pyramiddevelopment.md`
- authority_sha256: `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- candidate_handoff_sha256: `1bd062459462b039d93f575b7adecb9ec7166ae42ea37d4908fa3b81aacd81e6`
- central_intake: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`
- downstream_consumed: `false`
- functional_proof: `PENDING_BY_INSTRUCTION`

The central versions below were preserved before candidate-backed deltas were
applied. The candidate hashes are the exact bytes now present in the central
worktree. No reset, delete, clean, archive, commit, push, release, deployment,
or functional test was performed.

| Path | Preserved pre-integration SHA-256 | Candidate SHA-256 now in central |
| --- | --- | --- |
| `control/project-memory-records.mjs` | `8aece82abe93a7ee7cede6a0a0f727727513952ed0ca433341dc0bb459dddd78` | `b61eb054c58b13540ca2ac2fe50a8153b07289a80c501c82c355f79070aca707` |
| `control/project-memory-projections.mjs` | `88591a680516c59ca704c44b24acd2e74e61f54d43d0f5145a96d0c76ffd8501` | `c3fa6ebb72f09d1e2a70140b78d93ed222fdaa4ba879d0f5535f29f3ec2f45d6` |
| `control/project-memory-store.mjs` | `59e5fa07ecdd566840481f20fbccd67cd3ff77adf68ba2a11692ce34b56fe138` | `363179d45f41f55fbf588d0ea899978f49c74c19bf1f441f931c2c56a0850cd9` |
| `control/persisted-record-privacy.mjs` | `3673f941dbd87bcee8ea70bd430799ff242ca62db8cea84b002bc14e77b48467` | `a8253a94dd904067fe56a3ce5924e85b3ffffc973aa79913e355987437b1b1dc` |
| `schemas/project-memory.v1.json` | `5a647ef272a7e83333fd40fac767779cf0f6cdbb49755d749e40aaef3a4fe781` | `813540f8125457b36ea6c62375903948bfb21482d731956d74cae841d504fef0` |
| `tests/verify-project-memory.mjs` | `e4253c75ee3554d3a97e13a2236a6338ab16bcf971faba8dd2873854bbbd6590` | `cc8dbaea1a0ca287aea6b0a52cc8b51fa38e26c1f60134d7cea263e663791581` |
| `tests/verify-project-memory-replay.mjs` | `55a1e65a6f10a1c84124ddd161a82814d92329451391106171bef9a542294e6b` | `908c9be9fb7702e1b739fe9b75704bb330fa6a7ad5f35f7d42baac1d3d8733c7` |
| `tests/verify-project-memory-schema.mjs` | `62b8983209f97263b1bbf7aea76957ceebb37666d9ed56d5adbffb3abe28aad1` | `9f0900649d97b98e67ceb200b5f86b3da368c3b95fe1dd6504b7becc7df88998` |

Identical candidate-backed files were retained without replacement. The
feature report remains append-only and records the source-bound handoff and
static proof ceiling.
