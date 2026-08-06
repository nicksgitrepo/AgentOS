# Native campaign runtime

AgentOS 3.0 has one campaign entry path for the software-development profile:

```text
Bootstrap plan
    ↓
versioned named lane workers
    ↓
lane gates and host-attested evidence
    ↓
independent phase Auditor
    ↓
typed handoff
    ↓
unpin → archive → roster verification
```

The entry point is `control/campaign-runtime.mjs`:

```js
const outcome = await runNativeCampaign({
  root: releaseRoot,
  bootstrap_plan,
  goal,
  campaign_id,
  campaign_version: "v3.0.3-tb-03",
  source,
  host,
  authority_secret,
  evidence_secret,
  intent_regulator: {
    readSnapshot,
    onAudit,
    interval_minutes: 15,
  },
});
```

The normal Bootstrap path is `control/agentos-3.mjs`. A prepared owner
continuation is passed to `createAgentOS3BootstrapRuntime`; when the owner
chooses the launch value, the bridge verifies that the goal, campaign version,
source, and bound release root still match Bootstrap, then calls the full
campaign runtime. The result can be read from the bridge by its owner-request
digest. A different owner choice, missing host, invalid attachment, or failed
host load blocks the continuation and does not create a worker. The bridge also
requires the Intent Regulator callbacks; if no interval is supplied, it uses
the fifteen-minute default rather than running unwatched.

When the host adapter is supplied as an external module, use
`runConfiguredNativeCampaign`. The module URL and attachment are runtime
inputs only. They are never included in the campaign outcome.

`host` is supplied by the surrounding runtime through
`control/native-host-loader.mjs`. The release does not contain a provider
adapter, credentials, machine paths, or provider-specific identities. Secrets
are passed to the run in memory for attestation and never become part of the
campaign plan, result, handoff, or Git records.

The returned outcome is complete only when every lane has a meaningful result,
every phase has an independent Auditor decision bound to the exact worker
result digests, every typed handoff is preserved, and the active roster is
empty. `UNKNOWN` and missing evidence cannot reach completion.

The Intent Regulator audit starts with the campaign and defaults to a
fifteen-minute window. Its callback receives the decision record so the
surrounding persistent Controller can continue, request review, replace a
stalled worker, reassess a changed goal, or stop at a hard boundary.
