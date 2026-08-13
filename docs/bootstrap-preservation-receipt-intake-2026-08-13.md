# Preservation receipt intake checkpoint

Classification: typed project-context evidence; no Product or consumer write.

Status: `PRESERVATION_RECEIPTS_ACCEPTED_ZERO_TRACE`

Intake digest:
`c01637874baf96a6ecaa088ea16e0a0a3669704f42223cc8ff856f53311e8c32`

Policy digest:
`02b704914b98fb9ecc8647745f95017506b72124a4f2e68bbcebe2d18c8bccf2`

Destination and external-custody references are opaque and distinct. The
destination inventory count is zero, its inventory digest is
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`, and the
intake records `consumer_unchanged=true`, `control_plane_created=false`,
`source_mutation=NOT_OBSERVED`, and `destination_mutation=NOT_PERFORMED`.

| repository | source commit | source tree | receipt | content | observation | files | exclusions |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| clients | `8391d30d1518113c2b074a128a6262e92649a278` | `7631dc717a4575435f5643128692c63af2e7a9b1` | `2c4013587b075eb244f8da72c67f341c5f1f9f98443fb47088fce9a682ea479a` | `7c224be3cbb29a960ae79ce4a14b1969499e3e53d6a1758ad63b94e2b9b82d6a` | `83b580dee130aea566693264c1a425e54b528f12cdf2f84bfdd666370b653a05` | 4514 | 5 |
| data | `384ad69501a6a0353d4242c13707334e3bea92f6` | `213a300de352026cc4834cf5c1f5d807ea7f59ee` | `b42eb10c9ad9d5b447b380c3ba5d0f4d8c3fdaa923f8f228169a975bb51a08f9` | `9c1978031349ff24ca830e50d232506ba3b91640bb17a23d9d81572d4a7b4814` | `2c9caed487a1323248a6c9db4ca055884dad4f3d7d68f67127b6d9738ac9dc39` | 1352 | 2 |
| platform | `81c2deb4244fc371af97d4da95a5f8e042224c18` | `4639b2fcf3625a90ec015777478c29048c58f255` | `f6352a7dbc1417e78b60d7f467a3ac49d9d769514a0d44c3f6a98fc64a40e4b1` | `ed2d48a441571a06ca8edd1cd078f184035f21a374814a6f9196ab20ac283f80` | `3c69790ca3f43a730a809cc8bc7b12e66f942705776a26ff37733fd66193f101` | 1319 | 2 |

The original data artifact remains preserved as historical evidence but was
invalidated because a migration exposed an obsolete no-symlink digest shape.
The versioned data replacement was created without overwriting or deleting the
old artifact and is the one admitted by this intake. The verifier now supports
both old no-symlink manifests and the current symlink-aware shape; dependent
manifests invalidate on policy or source-identity change.

Focused receipt-intake, conservative-preservation, composed-import, and
symlink hostile tests pass. This checkpoint does not spawn or admit the
permanent Agent Spawner/Compiler. The next breakpoint is the audited,
read-only Agent Spawner package-preparation synthetic round trip.
