/** Typed companion to task-ir.schema.json. */

export type RequiredBefore =
  | "routing"
  | "seed_compile"
  | "tool_use"
  | "side_effect"
  | "acceptance"
  | "closure";

export type FieldClass =
  | "owner_supplied"
  | "registry_resolved"
  | "compiler_derived"
  | "agent_discoverable"
  | "prohibited_to_infer";

export type FieldStatus = "unresolved" | "resolved" | "blocked" | "superseded";

export type InferencePolicy =
  | "accept_owner_value"
  | "resolve_registry"
  | "derive_deterministically"
  | "research_agent"
  | "ask_owner"
  | "observe_runtime"
  | "must_not_infer";

export interface TaskPacket {
  identity: {
    taskId: string;
    requester: string;
    taskFamily: string;
    createdAt?: string;
  };
  objective: string;
  reason?: string;
  target?: string;
  scope: {
    include: string[];
    exclude: string[];
    project?: string;
    jurisdictions?: string[];
    technologies?: string[];
    versions?: string[];
  };
  exclusions: string[];
  currentState: string;
  desiredState?: string;
  acceptanceCriteria: string[];
  requiredOutputs: string[];
  requiredEvidence: string[];
  preservedInvariants: string[];
  stopConditions: string[];
  escalationConditions: string[];
  handoff: {
    recipient: string;
    requiredFields: string[];
    closure: string;
  };
  closureRequirements: string[];
}

export interface TaskField {
  fieldId: string;
  name: string;
  type: string;
  sourceClass: FieldClass;
  status: FieldStatus;
  requiredBefore: RequiredBefore;
  inferencePolicy: InferencePolicy;
  protected: boolean;
  value?: unknown;
  sourceRefs?: string[];
  owner?: string;
  notes?: string;
}

export interface ConditionalRule {
  ruleId: string;
  when: {
    fieldId: string;
    equals?: unknown;
    notEquals?: unknown;
    exists?: boolean;
  };
  then: {
    requireFields?: string[];
    forbidFields?: string[];
    requireApprovals?: string[];
    forbidActions?: string[];
    requireBlocks?: string[];
  };
  else?: {
    requireFields?: string[];
    forbidFields?: string[];
    requireApprovals?: string[];
    forbidActions?: string[];
    requireBlocks?: string[];
  };
}

export interface Contradiction {
  contradictionId: string;
  leftRef: string;
  rightRef: string;
  status: "unresolved" | "resolved" | "accepted_conflict" | "rejected";
  resolution?: "owner_decision" | "official_precedence" | "constraint_intersection" | "qualified_review" | "not_applicable";
  resolutionRef?: string;
}

export interface AuthorityCeiling {
  allowedActions: string[];
  forbiddenActions: string[];
  allowedOutputPaths?: string[];
  maxContextTokens: number;
  approvalRefs?: string[];
}

export interface TaskConstraints {
  requiredFields: string[];
  forbiddenActions: string[];
  conditionalRules: ConditionalRule[];
  contradictions: Contradiction[];
  authorityCeiling: AuthorityCeiling;
}

export interface SelectedBlock {
  blockId: string;
  blockDigest: string;
  status: "current" | "stale" | "superseded" | "missing" | "quarantined";
  sourceStatus: "current" | "superseded" | "withdrawn" | "unverified" | "unresolved";
  authorityEffectGrants: string[];
  projectedTokens?: number;
}

export interface CompilationState {
  status: "draft" | "blocked" | "compile_ready" | "quarantined" | "rejected";
  stage: RequiredBefore;
  selectedBlocks: SelectedBlock[];
  projectedContextTokens: number;
  maxContextTokens: number;
  requestedActions: string[];
  unresolvedFields: string[];
  constraintResolutionRefs?: string[];
  compiledAt?: string;
}

export interface TaskIR {
  schemaVersion: "task-ir.v0.1";
  taskPacket: TaskPacket;
  fieldLedger: TaskField[];
  constraints: TaskConstraints;
  compilation: CompilationState;
  provenance: {
    ownerIntentRef: string;
    sourceRefs: string[];
    compilerVersion: string;
    taskDigest: string;
    derivationRefs?: string[];
  };
  lifecycle: {
    state: "draft" | "candidate" | "evaluated" | "quarantined" | "admitted" | "suspended" | "retired" | "archived";
    admission: "not_admitted" | "recommended" | "admitted" | "rejected";
    activation: "not_activated" | "prepared" | "active" | "suspended" | "retired";
    refreshTriggers: string[];
    archiveConditions: string[];
  };
}

export interface ConstraintResolution {
  ruleId: string;
  condition: "true" | "false" | "unknown" | "conflict";
  requiredFields: string[];
  forbiddenFields: string[];
  requiredApprovals: string[];
  forbiddenActions: string[];
  result: "satisfied" | "blocked" | "escalate";
  evidenceRefs: string[];
}

export interface TaskIRHandoff {
  kind: "task_ir_handoff";
  taskRef: string;
  compilationRef: string;
  unresolvedFields: Array<{
    fieldId: string;
    sourceClass: "prohibited_to_infer" | "agent_discoverable";
    requiredBefore: RequiredBefore;
    escalation: "research" | "owner_decision" | "qualified_review" | "runtime_observation";
  }>;
  nextRole: string;
  closureCondition: string;
}
