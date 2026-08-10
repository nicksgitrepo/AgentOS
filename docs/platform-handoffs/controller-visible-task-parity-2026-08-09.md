# Controller-visible Task Parity Readback

- authority: UPDATED_AUDIT_DRIVEN_INTEGRATION_PYRAMID
- readback_kind: READ_ONLY_VISIBLE_TASK_PARITY
- task_ref: TASK_REF_NATIVE_HOST_ATTACHMENT
- inventory_entries: 37
- feature_report_paths_declared: 37
- feature_report_paths_present: 37
- central_report_files_missing: 0
- visible_report_refs_evidenced: 37
- missing_visible_report_refs: 0
- migration_targets: 37
- platform_domains: 3
- platform_lanes: 3
- visible_task_bindings: UNPROVEN
- concrete_visible_task_bindings: UNPROVEN
- exact_task_worktree_report_triples: UNPROVEN
- concrete_binding_target_match: UNPROVEN
- concrete_binding_status: SOURCE_BOUND_REPORT_HANDOFFS_PRESERVED_RUNTIME_MAPPING_UNPROVEN
- symbolic_visible_task_bindings: UNPROVEN
- missing_exact_visible_task_proof: UNPROVEN
- missing_target_ids: UNPROVEN
- restored_visible_task_records: 5
- restored_visible_worktrees: 5
- restored_report_handoffs: 5
- restored_task_status: COMPLETED_SOURCE_RECONCILIATION_GOALS_ACTIVE
- parity_after_restoration: SOURCE_BOUND_HANDOFFS_PRESERVED
- restored_target_refs:
  - ROADMAP_01_PORTABLE_KERNEL: TASK_REF_ROADMAP_01_VISIBLE / WORKTREE_REF_64C9 / REPORT_REF_ROADMAP_01_PENDING
  - ROADMAP_02_LAYERED_GOVERNANCE: TASK_REF_ROADMAP_02_VISIBLE / WORKTREE_REF_B155 / REPORT_REF_ROADMAP_02_PENDING
  - ROADMAP_03_CONTROLLER_INTENT: TASK_REF_ROADMAP_03_VISIBLE / WORKTREE_REF_32E9 / REPORT_REF_ROADMAP_03_PENDING
  - ROADMAP_04_TASK_ROUTING_CONTEXT: TASK_REF_ROADMAP_04_VISIBLE / WORKTREE_REF_EB85 / REPORT_REF_ROADMAP_04_PENDING
  - ROADMAP_05_LOCAL_ADAPTERS: TASK_REF_ROADMAP_05_VISIBLE / WORKTREE_REF_7F01 / REPORT_REF_ROADMAP_05_PENDING
- visible_extra_platform_lane_records: 7
- visible_extra_platform_lane_status: DORMANT_NOT_ADMITTED
- active_feature_auditors_evidenced: 0
- visible_codex_tasks_observed: 48
- visible_feature_auditor_title_tasks_observed: 14
- visible_feature_auditor_title_tasks_with_worktrees: 14
- visible_feature_auditor_title_tasks_active: 0
- inventory_targets_without_exact_visible_binding_proof: UNPROVEN
- exact_inventory_to_visible_task_parity: REPORT_HANDOFFS_PRESERVED_RUNTIME_TASK_PARITY_UNPROVEN
- feature_phase: NOT_ADMITTED
- admission_reason: Visible task and report parity is preserved. Feature lanes remain unadmitted because the cumulative platform foundation still lacks independent clearance and a source-bound merge receipt.
- host_snapshot: VISIBLE_HOST_SHOWS_IDLE_NATIVE_SESSION_TASK_ONLY
- custody: Existing task identities and worktrees remain preserved and unarchived.
- actions_taken: Restored five visible roadmap tasks with isolated worktrees. All five completed source-bound audit/repair cycles, created active persistent lane goals, and handed off their reports without archival. Their compatible changed-path candidates were ingested into the central dirty merge worktree; central static re-audit and 421-path binding refresh pass. No task archived; no functional tests/npm/commit/push/release/activation.
- completed_restored_handoffs: ROADMAP_01_PORTABLE_KERNEL, ROADMAP_02_LAYERED_GOVERNANCE, ROADMAP_03_CONTROLLER_INTENT, ROADMAP_04_TASK_ROUTING_CONTEXT, ROADMAP_05_LOCAL_ADAPTERS.
- completed_handoff_state: PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_TESTS
- active_persistent_goals: 5
- remaining_restored_handoffs: NONE
- next_action: Independently clear the three platform-domain handoffs, resolve remaining host/registry questions, and obtain a clean committed source-bound checkpoint before feature admission. Keep all restored tasks and worktrees unarchived until downstream preservation and stale-worktree closure are recorded.

## Authoritative parity correction (2026-08-09)

The earlier `37/37` task-binding values described preserved report and worktree
records, not a complete readback of the Codex task registry. They must not be
used as proof that every inventory target has a matching visible task. The
canonical runtime parity contract now covers all 52 admitted targets: 37
features, 12 governance lanes, and 3 platform lanes. The latest app snapshot
does not expose a complete 52-target mapping, and the five restored roadmap
tasks plus the three platform tasks are preserved without being reclassified
as proof of full parity.

- exact_target_to_visible_task_mapping: UNPROVEN
- required_target_count: 52
- latest_snapshot_scope: RECENT_VISIBLE_TASK_WINDOW_NOT_A_COMPLETE_REGISTRY
- governance_lane_task_parity: UNPROVEN
- platform_lane_task_parity: PRESERVED_HANDOFFS_PENDING_INDEPENDENT_CLEARANCE
- feature_admission: NOT_ADMITTED
- governance_lanes_not_observed_in_latest_snapshot:
  `LANE_08_CODE_HYGIENE`, `LANE_09_SECURITY_PRIVACY`,
  `LANE_10_EVIDENCE_IDENTITY`, `LANE_11_RECOVERY_BOUNDARIES`,
  `LANE_12_DELIVERY_CLOSURE`
- recovery: obtain a complete visible task readback from the existing tasks,
  bind each target to exactly one task/worktree/report/goal, and fail closed on
 duplicates or omissions. Do not create replacement tasks or archive any
 preserved task while this mapping is unresolved.

## App listing limitation correction — 2026-08-09

The Codex app listing endpoint accepts at most 50 recent thread records. A
current request returned 50 thread records plus pinned records; the five
unobserved governance lanes were not present in that bounded response. Their
absence from that response is therefore not proof that the tasks do not exist.
It is also not proof that they do exist. The parity state remains UNPROVEN
until the existing visible tasks can be identified with exact opaque task and
worktree references and reconciled one-to-one against the 52-entry inventory.
No synthetic task record may be substituted for that readback.

## Host-readback contract repair — 2026-08-09

The active parity gate now requires a
`agentos.visible_task_parity_readback.v1` receipt compiled from the host's
`list_threads` response. The receipt must bind the exact project and campaign
and must contain one visible, unarchived host task/worktree identity for every
runtime registry entry. A task may be idle or not loaded; visibility and
custody are the required parity facts, not a currently running turn. The runtime workflow stores only the
receipt digest and requires a fresh host-compiled receipt when it is resumed;
hand-authored or deserialized lookalikes are not accepted by the in-process
host-readback boundary. The current Codex listing exposes task ID, host,
status, and working directory but no authoritative goal, worktree, or target
fields, so the complete 52-target parity readback remains unproven.

## Latest bounded host observation — 2026-08-09

The current Codex host returned 50 recent records plus pinned records. After
deduplication, 34 records belonged to the AgentOS campaign project: 3 were
idle and 31 were not loaded. The records exposed `id`, `hostId`, `status`,
`cwd`, title, and summary, but no authoritative `goal_id`, `worktree_id`, or
`target_id` fields. A larger limit request was rejected by the host and is not
treated as a complete registry. The controller therefore retains the exact
52-target parity hold and does not infer the missing 18 targets or their
bindings.
