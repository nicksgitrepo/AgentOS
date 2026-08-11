/**
 * Readable companion to context-block.schema.json.
 *
 * This interface describes packaging and evidence. It is not an authority
 * model and it cannot issue a runtime capability lease.
 */

export type BlockClass =
  | "policy_governance"
  | "role_procedure"
  | "specialty_procedure"
  | "official_authority_pack"
  | "knowledge_reference"
  | "project_fact_snapshot"
  | "owner_decision"
  | "task_template"
  | "tool_runtime_adapter"
  | "evaluation_pack"
  | "handoff_evidence"
  | "lifecycle_invalidation"
  | "model_harness_profile";

export type LifecycleState =
  | "candidate"
  | "research_memo"
  | "evaluated"
  | "admitted"
  | "suspended"
  | "retired"
  | "archived";

export type EvidenceClass =
  | "OPR" // official primary source
  | "AET" // accepted engineering/domain truth
  | "PF"  // project fact
  | "OD"  // owner decision
  | "RTF" // runtime/tool fact
  | "EE"  // evaluation evidence
  | "DER" // derived claim
  | "PAI"; // prohibited-to-infer

export type EvidenceLabel =
  | "C0_UNVERIFIED"
  | "C1_CONTEXTUAL"
  | "C2_ACCEPTED_ENGINEERING"
  | "C3_OFFICIAL_SCOPED"
  | "C4_OWNER_AUTHORIZED"
  | "C5_RUNTIME_OBSERVED"
  | "C6_EVALUATED";

export type RequiredBefore =
  | "routing"
  | "seed_compile"
  | "tool_use"
  | "side_effect"
  | "acceptance"
  | "closure";

export type InferencePolicy =
  | "may_resolve_deterministically"
  | "must_research"
  | "must_ask_owner"
  | "must_observe_runtime"
  | "must_not_infer";

export type Identifier = string;
export type Digest = `sha256:${string}`;

export interface Reference {
  refId: Identifier;
  digest?: Digest;
  relation?:
    | "requires"
    | "derived_from"
    | "supports"
    | "conflicts_with"
    | "supersedes"
    | "superseded_by"
    | "evaluated_by"
    | "invalidated_by"
    | "projects_to";
}

export interface Scope {
  include: string[];
  exclude: string[];
  roles?: Identifier[];
  taskFamilies?: Identifier[];
  jurisdictions?: string[];
  technologies?: string[];
  validFrom?: string;
  validUntil?: string;
}

export interface BlockRevision {
  version: string;
  contentDigest: Digest;
  createdAt: string;
  createdBy?: Identifier;
  reviewedAt?: string;
  reviewReceipt?: Reference;
}

export interface BlockPurpose {
  summary: string;
  outcomes: string[];
  nonGoals: string[];
}

export interface Claim {
  claimId: Identifier;
  statement: string;
  status: "candidate" | "accepted" | "disputed" | "rejected" | "superseded";
  evidenceClass: EvidenceClass;
  evidenceLabel: EvidenceLabel;
  confidenceCeiling: EvidenceLabel;
  sourceRefs: Reference[];
  scope: Scope;
  requiredBefore?: RequiredBefore;
  prohibitedInference: string[];
  derivedFrom?: Identifier[];
}

export interface Requirement {
  requirementId: Identifier;
  text: string;
  level: "MUST" | "MUST_NOT" | "SHOULD" | "SHOULD_NOT" | "MAY" | "ADVISORY";
  evidenceRefs: Reference[];
  requiredBefore?: RequiredBefore;
}

export interface Prohibition {
  prohibitionId: Identifier;
  action: string;
  reason: string;
  evidenceRefs: Reference[];
  escalateTo?: Identifier;
}

export interface ContextField {
  fieldId: Identifier;
  type: string;
  description?: string;
  evidenceClass: EvidenceClass;
  requiredBefore: RequiredBefore;
  inferencePolicy: InferencePolicy;
  redaction?: "none" | "sensitive" | "secret" | "personal_data" | "regulated_data";
}

export interface HandoffContract {
  handoffId: Identifier;
  recipientRole: Identifier;
  requiredFields: Identifier[];
  ownership: "retain" | "transfer" | "shared_by_lease";
  allowedTransformations?: string[];
  closureCondition: string;
}

export interface AuthorityEffect {
  /** Always empty. A context block never grants a runtime capability. */
  grants: readonly [];
  restrictions: string[];
  obligations: string[];
  ceilingRefs?: Reference[];
}

export interface LoadingProfile {
  advertisedSummary: string;
  activationInstructions: string;
  lazyResources: Reference[];
  budget: {
    summaryTokens: number;
    instructionTokens: number;
    resourceTokens: number;
    maxTokens: number;
  };
}

export interface SourceRecord {
  sourceId: Identifier;
  authorityClass:
    | "owner_intent"
    | "official_primary"
    | "accepted_engineering"
    | "project_record"
    | "runtime_observation"
    | "evaluation_result"
    | "secondary_context"
    | "unresolved_artifact";
  title: string;
  publisher: string;
  uri?: string;
  version?: string;
  publicationDate?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  jurisdiction?: string;
  retrievedAt: string;
  digest: Digest;
  scope: Scope;
  status: "current" | "superseded" | "withdrawn" | "unverified" | "unresolved";
  supersedes?: Reference;
  license?: string;
  advisoryOnly?: boolean;
  extractionMethod?: string;
  signatureRef?: Reference;
}

export interface Derivation {
  derivationId: Identifier;
  derivedClaimId: Identifier;
  inputRefs: Reference[];
  rule: string;
  compilerVersion: string;
}

export interface Provenance {
  sourceRecords: SourceRecord[];
  derivations: Derivation[];
  generatedBy: Identifier;
  createdAt: string;
  reviewers?: Identifier[];
  attestationRef?: Reference;
}

export interface EvaluationProfile {
  status: "not_started" | "designed" | "running" | "passed" | "failed" | "quarantined";
  suiteId: Identifier;
  baseline: "no_block" | "current_admitted_block" | "task_specific_reference";
  conditions: Array<
    | "no_block"
    | "focused_block"
    | "overstuffed_block"
    | "stale_block"
    | "mismatched_block"
    | "self_authored_block"
    | "adversarial_block"
  >;
  requiredOracles: Array<
    | "utility"
    | "correctness"
    | "evidence"
    | "provenance"
    | "safety"
    | "privacy"
    | "security"
    | "authority_boundary"
    | "staleness"
    | "handoff"
    | "cost_latency"
  >;
  modelProfile?: Reference;
  resultRefs?: Reference[];
  admissionGate: string[];
}

export interface RefreshPolicy {
  policy: "event_and_schedule" | "event_only" | "schedule_only" | "manual_owner_review";
  cadence: string;
  triggers: string[];
  historicalPolicy: "immutable_revision" | "replace_before_use_only";
  lastCheckedAt?: string;
  nextDueAt?: string;
  watchRefs?: Reference[];
}

export interface SecurityProfile {
  dataClasses?: string[];
  /** Always false in a context block package. */
  secretsAllowed: false;
  redactionRules?: string[];
  integrityRequirements?: string[];
  auditRequirements?: string[];
}

export interface RegulatorySafetyProfile {
  applicable?: boolean;
  jurisdictions?: string[];
  /** Legal, regulatory, safety, medical, and certification content is advisory here. */
  advisoryOnly?: true;
  qualifiedReviewRequired?: boolean;
  /** Such content is always tied to a named version/date. */
  versionBound?: true;
  professionalBoundary?: string;
}

export interface ContextBlock {
  schemaVersion: "context-block.v0.1";
  blockId: Identifier;
  blockClass: BlockClass;
  revision: BlockRevision;
  lifecycleState: LifecycleState;
  purpose: BlockPurpose;
  scope: Scope;
  claims: Claim[];
  requirements?: Requirement[];
  prohibitions?: Prohibition[];
  terms?: Array<{
    termId: Identifier;
    preferred: string;
    aliases?: string[];
    definition: string;
    sourceRefs: Reference[];
  }>;
  procedures?: Array<{
    procedureId: Identifier;
    preconditions: string[];
    steps: string[];
    decisionRules?: string[];
    stopConditions: string[];
    evidenceOutput: Identifier[];
  }>;
  inputs?: ContextField[];
  outputs?: ContextField[];
  handoffs?: HandoffContract[];
  authorityEffect: AuthorityEffect;
  loading: LoadingProfile;
  resources?: Array<{
    resourceId: Identifier;
    uri?: string;
    mediaType: string;
    digest: Digest;
    loadPolicy: "eager" | "on_activation" | "on_demand" | "never_runtime";
    license?: string;
    redaction?: "none" | "sensitive" | "secret" | "personal_data" | "regulated_data";
  }>;
  provenance: Provenance;
  evaluation: EvaluationProfile;
  refresh: RefreshPolicy;
  security: SecurityProfile;
  regulatorySafety?: RegulatorySafetyProfile;
  dependencies?: Reference[];
  conflicts?: Reference[];
  invalidatedBy?: string[];
  supersedes?: Reference;
  supersededBy?: Reference;
  notes?: string[];
}

export interface ResearchHandoff {
  kind: "research_handoff";
  taskId: Identifier;
  blockId: Identifier;
  scope: Scope;
  claimLedgerRefs: Reference[];
  sourceRefs: Reference[];
  unresolved: Array<{
    fieldId: Identifier;
    class: "PAI";
    reason: string;
    requiredBefore: RequiredBefore;
    escalation: "research" | "owner_decision" | "qualified_review" | "runtime_observation";
  }>;
}

export interface EvaluationHandoff {
  kind: "evaluation_handoff";
  blockRef: Reference;
  suiteRef: Reference;
  modelProfileRef: Reference;
  harnessRef: Reference;
  resultRefs: Reference[];
  utilitySummary: string;
  harmSummary: string;
  recommendation: "iterate" | "quarantine" | "admission_review";
}

export interface OwnerDecisionRequest {
  kind: "owner_decision_request";
  decisionId: Identifier;
  question: string;
  alternatives: Array<{
    id: Identifier;
    consequenceSummary: string;
    affectedScope: string[];
  }>;
  requiredBefore: RequiredBefore;
  blockedActions: string[];
}

export interface InvalidationEvent {
  kind: "invalidation_event";
  eventId: Identifier;
  trigger: string;
  affectedRefs: Reference[];
  action: "recheck" | "quarantine" | "suspend" | "retire";
  detectedAt: string;
}
