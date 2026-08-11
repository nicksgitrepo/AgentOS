// Local Feature Agent evidence-repair receipt; held in the isolated campaign worktree.
export const FEATURE_AGENT_EVIDENCE_REPAIR = Object.freeze({
  "task_id": "TASK-GOVERNANCE-EVIDENCE-D321D00F5A0B8651",
  "task_kind": "GOVERNANCE_EVIDENCE_REPAIR",
  "campaign_id": "CAMPAIGN-AGENTOS-SELF-DEVELOPMENT-1",
  "campaign_version": "v1",
  "candidate_sha256": "63c4fe2d64fb7e6c7af14f3e6cdb8f0ad3fcd349f4c31be4d593fc152d0ba070",
  "source_commit": "8a8615beef4ac8673124e1f819d383c03f6f5045",
  "source_tree": "e718d7f6eeceb01dcf5b220d472fe5325854200b",
  "custody_status": "FEATURE_AGENT_CUSTODY",
  "changed_by_repair": [
    "control/governance-decision-tree.mjs",
    "control/governance-evidence.mjs",
    "control/local-agent-worker.mjs",
    "tests/verify-governance-decision-tree.mjs"
  ]
});
