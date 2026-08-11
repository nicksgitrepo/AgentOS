import { canonicalBytes, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { uuidv7 } from "./uuidv7.mjs";

export const RECORD_FAMILIES = Object.freeze(["decision", "fact", "procedure", "lesson", "evidence", "reference"]);
export const TERMINAL_STATES = Object.freeze(["REJECTED", "TOMBSTONED"]);

const TRANSITIONS = Object.freeze({
  RECORD_PROPOSED: [null],
  RECORD_VERIFIED: ["PROPOSED"],
  RECORD_ACCEPTED: ["VERIFIED"],
  RECORD_REJECTED: ["PROPOSED", "VERIFIED"],
  RECORD_INVALIDATED: ["ACCEPTED"],
  RECORD_TOMBSTONED: ["PROPOSED", "VERIFIED", "REJECTED", "ACCEPTED", "INVALIDATED"]
});

const ACTION_STATE = Object.freeze({
  RECORD_PROPOSED: "PROPOSED",
  RECORD_VERIFIED: "VERIFIED",
  RECORD_ACCEPTED: "ACCEPTED",
  RECORD_REJECTED: "REJECTED",
  RECORD_INVALIDATED: "INVALIDATED",
  RECORD_TOMBSTONED: "TOMBSTONED"
});

const DEFAULT_AUTHORITY = Object.freeze({
  RECORD_PROPOSED: ["owner", "controller", "runner", "researcher"],
  RECORD_VERIFIED: ["owner", "controller", "reviewer"],
  RECORD_ACCEPTED: ["owner", "controller"],
  RECORD_REJECTED: ["owner", "controller", "reviewer"],
  RECORD_INVALIDATED: ["owner", "controller", "reviewer"],
  RECORD_TOMBSTONED: ["owner", "controller", "maintainer"],
  HOLD_PLACED: ["owner", "controller", "privacy_officer"],
  HOLD_RELEASED: ["owner", "privacy_officer"]
});

function actorRole(actor) {
  invariant(typeof actor === "string" && actor.length > 0, "INVALID_ACTOR", "actor is required");
  return actor.includes(":") ? actor.slice(0, actor.indexOf(":")) : actor.includes(".") ? actor.slice(0, actor.indexOf(".")) : actor;
}

function authorize(action, actor) {
  const allowed = DEFAULT_AUTHORITY[action];
  invariant(allowed?.includes(actorRole(actor)), "UNAUTHORIZED", `${actor} may not perform ${action}`);
}

function tokenize(text) {
  return [...new Set(text.normalize("NFC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) ?? [])].sort();
}

function validateRecordInput(input) {
  invariant(input && typeof input === "object" && !Array.isArray(input), "INVALID_RECORD", "record input must be an object");
  invariant(RECORD_FAMILIES.includes(input.family), "INVALID_RECORD_FAMILY", `family must be one of ${RECORD_FAMILIES.join(", ")}`);
  invariant(typeof input.statement === "string" && input.statement.length > 0, "INVALID_STATEMENT", "statement is required");
  invariant(input.statement.normalize("NFC") === input.statement, "NON_CANONICAL_UNICODE", "statement must be NFC");
  const evidenceRefs = input.evidence_refs ?? [];
  invariant(Array.isArray(evidenceRefs) && evidenceRefs.every((ref) => typeof ref === "string"), "INVALID_EVIDENCE_REFS", "evidence_refs must be strings");
  const sourceRefs = input.source_refs ?? [];
  invariant(Array.isArray(sourceRefs) && sourceRefs.every((ref) => typeof ref === "string"), "INVALID_SOURCE_REFS", "source_refs must be strings");
  const supersedes = input.supersedes ?? [];
  const contradicts = input.contradicts ?? [];
  invariant(Array.isArray(supersedes) && supersedes.every((ref) => typeof ref === "string" && ref.startsWith("memory:")), "INVALID_SUPERSEDES", "supersedes must contain memory record references");
  invariant(Array.isArray(contradicts) && contradicts.every((ref) => typeof ref === "string" && ref.startsWith("memory:")), "INVALID_CONTRADICTS", "contradicts must contain memory record references");
  const role = input.role ?? null;
  const lane = input.lane ?? null;
  invariant(role === null || (typeof role === "string" && role.length > 0), "INVALID_ROLE", "role must be null or a non-empty string");
  invariant(lane === null || (typeof lane === "string" && lane.length > 0), "INVALID_LANE", "lane must be null or a non-empty string");
  return {
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    sourceRefs: [...new Set(sourceRefs)].sort(),
    supersedes: [...new Set(supersedes)].sort(),
    contradicts: [...new Set(contradicts)].sort(),
    role,
    lane
  };
}

function validateStoredRecord(record, projectId) {
  invariant(record && typeof record === "object" && !Array.isArray(record), "INVALID_RECORD", "stored record must be an object");
  invariant(record.schema === "agentos.memory.record.v1", "INVALID_RECORD_SCHEMA", "stored record has unsupported schema");
  invariant(typeof record.record_id === "string" && /^memory:[a-zA-Z0-9._:-]+$/.test(record.record_id),
    "INVALID_RECORD_ID", "stored record id is invalid");
  invariant(RECORD_FAMILIES.includes(record.family), "INVALID_RECORD_FAMILY", "stored record family is invalid");
  invariant(typeof record.statement === "string" && record.statement.length > 0 && record.statement.normalize("NFC") === record.statement,
    "INVALID_STATEMENT", "stored record statement is invalid");
  const sortedStrings = (value, code, label, predicate = () => true) => {
    invariant(Array.isArray(value) && value.every((item) => typeof item === "string" && predicate(item)), code, `${label} is invalid`);
    invariant(canonicalBytes(value).equals(canonicalBytes([...new Set(value)].sort())), code, `${label} must be unique and sorted`);
  };
  sortedStrings(record.evidence_refs, "INVALID_EVIDENCE_REFS", "stored evidence_refs");
  sortedStrings(record.source_refs, "INVALID_SOURCE_REFS", "stored source_refs");
  invariant(record.relations && typeof record.relations === "object" && !Array.isArray(record.relations),
    "INVALID_RELATIONS", "stored relations are invalid");
  sortedStrings(record.relations.supersedes, "INVALID_SUPERSEDES", "stored supersedes", (ref) => ref.startsWith("memory:"));
  sortedStrings(record.relations.contradicts, "INVALID_CONTRADICTS", "stored contradicts", (ref) => ref.startsWith("memory:"));
  invariant(![...record.relations.supersedes, ...record.relations.contradicts].includes(record.record_id),
    "SELF_RELATION", "a stored record cannot relate to itself");
  invariant(record.scope && canonicalBytes(record.scope).equals(canonicalBytes({
    project_id: projectId,
    role: record.scope.role ?? null,
    lane: record.scope.lane ?? null
  })), "RECORD_SCOPE_MISMATCH", "stored record scope is invalid or belongs to another project");
  invariant(record.scope.role === null || (typeof record.scope.role === "string" && record.scope.role.length > 0),
    "INVALID_ROLE", "stored role is invalid");
  invariant(record.scope.lane === null || (typeof record.scope.lane === "string" && record.scope.lane.length > 0),
    "INVALID_LANE", "stored lane is invalid");
  sortedStrings(record.keywords, "INVALID_KEYWORDS", "stored keywords", (word) => word.normalize("NFC") === word);
  invariant(tokenize(record.statement).every((word) => record.keywords.includes(word)), "INVALID_KEYWORDS",
    "stored keywords must include every statement token");
  invariant(typeof record.created_at_utc === "string" && Number.isFinite(Date.parse(record.created_at_utc))
    && new Date(Date.parse(record.created_at_utc)).toISOString() === record.created_at_utc,
    "INVALID_RECORD_TIMESTAMP", "stored record timestamp is invalid");
  const expected = {
    schema: "agentos.memory.record.v1",
    record_id: record.record_id,
    family: record.family,
    statement: record.statement,
    scope: record.scope,
    evidence_refs: record.evidence_refs,
    source_refs: record.source_refs,
    relations: { supersedes: record.relations.supersedes, contradicts: record.relations.contradicts },
    keywords: record.keywords,
    created_at_utc: record.created_at_utc
  };
  invariant(canonicalBytes(record).equals(canonicalBytes(expected)), "INVALID_RECORD", "stored record contains unsupported fields");
  return record;
}

export class MemoryService {
  constructor(project) {
    this.project = project;
  }

  async projectState() {
    const { events } = await this.project.verifyEvents();
    const records = new Map();
    const holds = new Map();
    for (const event of events) {
      const { action, subject_ref: subjectRef, object_ref: objectRef, actor, sequence, recorded_at_utc: recordedAt } = event.body;
      if (action in ACTION_STATE) {
        authorize(action, actor);
        const prior = records.get(subjectRef) ?? null;
        const allowed = TRANSITIONS[action];
        invariant(allowed.includes(prior?.state ?? null), "INVALID_TRANSITION", `${action} is invalid from ${prior?.state ?? "NONE"}`);
        if (action === "RECORD_PROPOSED") {
          invariant(objectRef !== null, "MISSING_RECORD_OBJECT", "proposal must reference a record object");
          const record = validateStoredRecord(await this.project.getJson(objectRef), this.project.config.project_id);
          invariant(record.record_id === subjectRef, "SUBJECT_MISMATCH", "record object id does not match event subject");
          invariant(canonicalBytes(event.body.metadata).equals(canonicalBytes({
            family: record.family,
            role: record.scope.role,
            lane: record.scope.lane
          })), "RECORD_EVENT_MISMATCH", "proposal event metadata does not match its record");
          for (const relatedId of [...record.relations.supersedes, ...record.relations.contradicts]) {
            const related = records.get(relatedId);
            invariant(related, "UNKNOWN_RELATION", `related record ${relatedId} did not exist when proposed`);
            invariant(related.state === "ACCEPTED", "RELATION_NOT_ACCEPTED",
              `related record ${relatedId} was not accepted when proposed`);
          }
          records.set(subjectRef, {
            record,
            object_ref: objectRef,
            state: "PROPOSED",
            sequence,
            recorded_at_utc: recordedAt,
            proposed_by: actor,
            verified_by: null,
            accepted_by: null
          });
        } else {
          invariant(prior !== null, "UNKNOWN_RECORD", `${subjectRef} does not exist`);
          invariant(objectRef === prior.object_ref, "RECORD_OBJECT_MISMATCH",
            "record transition must retain the proposal object reference");
          invariant(event.body.metadata && canonicalBytes(event.body.metadata).equals(canonicalBytes({
            reason: event.body.metadata.reason ?? null
          })), "RECORD_EVENT_MISMATCH", "record transition metadata is invalid");
          invariant(event.body.metadata.reason === null || typeof event.body.metadata.reason === "string",
            "INVALID_REASON", "record transition reason must be null or a string");
          if (action === "RECORD_VERIFIED") invariant(actor !== prior.proposed_by, "INDEPENDENCE_REQUIRED", "record verifier must differ from proposer");
          if (action === "RECORD_ACCEPTED") invariant(actor !== prior.verified_by, "INDEPENDENCE_REQUIRED", "record accepter must differ from verifier");
          if (action === "RECORD_ACCEPTED") {
            for (const relatedId of [...prior.record.relations.supersedes, ...prior.record.relations.contradicts]) {
              invariant(records.get(relatedId)?.state === "ACCEPTED", "RELATION_NOT_ACCEPTED",
                `related record ${relatedId} was not accepted at acceptance time`);
            }
          }
          records.set(subjectRef, {
            ...prior,
            state: ACTION_STATE[action],
            sequence,
            recorded_at_utc: recordedAt,
            verified_by: action === "RECORD_VERIFIED" ? actor : prior.verified_by,
            accepted_by: action === "RECORD_ACCEPTED" ? actor : prior.accepted_by
          });
        }
      } else if (action === "HOLD_PLACED") {
        authorize(action, actor);
        invariant(!holds.has(subjectRef), "HOLD_EXISTS", `${subjectRef} already has a hold`);
        holds.set(subjectRef, { state: "ACTIVE", sequence, reason: event.body.metadata.reason });
      } else if (action === "HOLD_RELEASED") {
        authorize(action, actor);
        invariant(holds.get(subjectRef)?.state === "ACTIVE", "NO_ACTIVE_HOLD", `${subjectRef} has no active hold`);
        holds.set(subjectRef, { ...holds.get(subjectRef), state: "RELEASED", released_sequence: sequence });
      }
    }
    for (const current of records.values()) {
      current.effective_state = current.state;
      current.superseded_by = [];
    }
    for (const [recordId, current] of records) {
      if (current.state !== "ACCEPTED") continue;
      for (const supersededId of current.record.relations?.supersedes ?? []) {
        const target = records.get(supersededId);
        invariant(target, "UNKNOWN_RELATION", `${recordId} supersedes missing record ${supersededId}`);
        if (target.state === "ACCEPTED") {
          target.effective_state = "SUPERSEDED";
          target.superseded_by.push(recordId);
          target.superseded_by.sort();
        }
      }
      for (const contradictedId of current.record.relations?.contradicts ?? []) {
        invariant(records.has(contradictedId), "UNKNOWN_RELATION", `${recordId} contradicts missing record ${contradictedId}`);
      }
    }
    return { records, holds, head_sequence: events.length };
  }

  async propose(input, { actor = "owner" } = {}) {
    authorize("RECORD_PROPOSED", actor);
    const { evidenceRefs, sourceRefs, supersedes, contradicts, role, lane } = validateRecordInput(input);
    const recordId = input.record_id ?? `memory:${uuidv7()}`;
    invariant(/^memory:[a-zA-Z0-9._:-]+$/.test(recordId), "INVALID_RECORD_ID", "invalid record id");
    const state = await this.projectState();
    invariant(!state.records.has(recordId), "RECORD_EXISTS", `${recordId} already exists`);
    for (const relatedId of [...supersedes, ...contradicts]) {
      invariant(relatedId !== recordId, "SELF_RELATION", "a record cannot relate to itself");
      const related = state.records.get(relatedId);
      invariant(related, "UNKNOWN_RELATION", `related record ${relatedId} does not exist`);
      invariant(related.state === "ACCEPTED", "RELATION_NOT_ACCEPTED", `related record ${relatedId} is not accepted`);
    }
    const record = {
      schema: "agentos.memory.record.v1",
      record_id: recordId,
      family: input.family,
      statement: input.statement,
      scope: { project_id: this.project.config.project_id, role, lane },
      evidence_refs: evidenceRefs,
      source_refs: sourceRefs,
      relations: { supersedes, contradicts },
      keywords: tokenize(`${input.statement} ${(input.keywords ?? []).join(" ")}`),
      created_at_utc: new Date().toISOString()
    };
    const objectRef = await this.project.putJson(record);
    const event = await this.project.commit({
      actor,
      action: "RECORD_PROPOSED",
      subjectRef: recordId,
      objectRef,
      metadata: { family: record.family, role, lane }
    });
    return { record, object_ref: objectRef, event };
  }

  async transition(recordId, action, { actor = "owner", reason = null } = {}) {
    invariant(action in ACTION_STATE && action !== "RECORD_PROPOSED", "INVALID_ACTION", "unsupported record transition");
    authorize(action, actor);
    const state = await this.projectState();
    const current = state.records.get(recordId);
    invariant(current, "UNKNOWN_RECORD", `${recordId} does not exist`);
    invariant(TRANSITIONS[action].includes(current.state), "INVALID_TRANSITION", `${action} is invalid from ${current.state}`);
    if (action === "RECORD_VERIFIED") invariant(actor !== current.proposed_by, "INDEPENDENCE_REQUIRED", "record verifier must differ from proposer");
    if (action === "RECORD_ACCEPTED") invariant(actor !== current.verified_by, "INDEPENDENCE_REQUIRED", "record accepter must differ from verifier");
    if (action === "RECORD_ACCEPTED") {
      for (const relatedId of [...(current.record.relations?.supersedes ?? []), ...(current.record.relations?.contradicts ?? [])]) {
        const related = state.records.get(relatedId);
        invariant(related?.state === "ACCEPTED", "RELATION_NOT_ACCEPTED", `related record ${relatedId} is no longer accepted`);
      }
    }
    if (action === "RECORD_TOMBSTONED") {
      invariant(state.holds.get(recordId)?.state !== "ACTIVE", "HOLD_PRECEDENCE", `${recordId} is under an active hold`);
    }
    return this.project.commit({ actor, action, subjectRef: recordId, objectRef: current.object_ref, metadata: { reason } });
  }

  async placeHold(recordId, reason, { actor = "owner" } = {}) {
    authorize("HOLD_PLACED", actor);
    invariant(typeof reason === "string" && reason.length > 0, "INVALID_REASON", "hold reason is required");
    const state = await this.projectState();
    invariant(state.records.has(recordId), "UNKNOWN_RECORD", `${recordId} does not exist`);
    invariant(state.holds.get(recordId)?.state !== "ACTIVE", "HOLD_EXISTS", `${recordId} already has a hold`);
    return this.project.commit({ actor, action: "HOLD_PLACED", subjectRef: recordId, metadata: { reason } });
  }

  async releaseHold(recordId, { actor = "owner", reason = null } = {}) {
    authorize("HOLD_RELEASED", actor);
    const state = await this.projectState();
    invariant(state.holds.get(recordId)?.state === "ACTIVE", "NO_ACTIVE_HOLD", `${recordId} has no active hold`);
    return this.project.commit({ actor, action: "HOLD_RELEASED", subjectRef: recordId, metadata: { reason } });
  }

  async search(query, options = {}) {
    invariant(typeof query === "string", "INVALID_QUERY", "query must be a string");
    const { role = null, lane = null, families = RECORD_FAMILIES, limit = 20, includeProject = true } = options;
    invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, "INVALID_LIMIT", "limit must be between 1 and 1000");
    const queryTokens = tokenize(query);
    const state = await this.projectState();
    const candidates = new Map();
    for (const current of state.records.values()) {
      if (current.effective_state !== "ACCEPTED" || !families.includes(current.record.family)) continue;
      const scope = current.record.scope;
      const scopeMatch = (role !== null && scope.role === role ? 2 : 0) + (lane !== null && scope.lane === lane ? 2 : 0);
      if (!includeProject && scope.role === null && scope.lane === null) continue;
      if (scope.role !== null && role !== scope.role) continue;
      if (scope.lane !== null && lane !== scope.lane) continue;
      const tokenSet = new Set(current.record.keywords);
      const overlap = queryTokens.filter((token) => tokenSet.has(token)).length;
      const exact = current.record.record_id === query || current.record.source_refs.includes(query) ? 1000 : 0;
      if (exact === 0 && queryTokens.length > 0 && overlap === 0) continue;
      const score = exact + scopeMatch * 100 + overlap * 10;
      candidates.set(current.record.record_id, {
        record_id: current.record.record_id,
        family: current.record.family,
        statement: current.record.statement,
        evidence_refs: current.record.evidence_refs,
        scope,
        score,
        match_reason: exact > 0 ? "EXACT_REFERENCE" : queryTokens.length === 0 ? "SCOPE_ENUMERATION" : "KEYWORD_OVERLAP",
        accepted_sequence: current.sequence,
        object_ref: current.object_ref,
        relations: current.record.relations ?? { supersedes: [], contradicts: [] }
      });
    }
    const direct = [...candidates.values()];
    const reverseContradictions = new Map();
    for (const current of state.records.values()) {
      if (current.effective_state !== "ACCEPTED") continue;
      for (const target of current.record.relations?.contradicts ?? []) {
        if (!reverseContradictions.has(target)) reverseContradictions.set(target, []);
        reverseContradictions.get(target).push(current.record.record_id);
      }
    }
    for (const hit of direct) {
      const relatedIds = [...new Set([...hit.relations.contradicts, ...(reverseContradictions.get(hit.record_id) ?? [])])].sort();
      for (const relatedId of relatedIds) {
        if (candidates.has(relatedId)) continue;
        const current = state.records.get(relatedId);
        if (!current || current.effective_state !== "ACCEPTED" || !families.includes(current.record.family)) continue;
        const scope = current.record.scope;
        if (!includeProject && scope.role === null && scope.lane === null) continue;
        if ((scope.role !== null && role !== scope.role) || (scope.lane !== null && lane !== scope.lane)) continue;
        candidates.set(relatedId, {
          record_id: current.record.record_id,
          family: current.record.family,
          statement: current.record.statement,
          evidence_refs: current.record.evidence_refs,
          scope,
          score: 1,
          match_reason: "EXPLICIT_CONTRADICTION",
          accepted_sequence: current.sequence,
          object_ref: current.object_ref,
          relations: current.record.relations ?? { supersedes: [], contradicts: [] }
        });
      }
    }
    const hits = [...candidates.values()];
    hits.sort((a, b) => b.score - a.score || b.accepted_sequence - a.accepted_sequence || a.record_id.localeCompare(b.record_id, "en"));
    return {
      query,
      query_tokens: queryTokens,
      head_sequence: state.head_sequence,
      hits: hits.slice(0, limit),
      omissions: hits.slice(limit).map((hit) => ({ record_id: hit.record_id, reason: "RESULT_LIMIT", match_reason: hit.match_reason }))
    };
  }

  async contextPacket(query, options = {}) {
    const budgetBytes = options.budget_bytes ?? 16_384;
    invariant(Number.isSafeInteger(budgetBytes) && budgetBytes >= 512, "INVALID_BUDGET", "budget_bytes must be an integer of at least 512");
    const result = await this.search(query, options);
    const included = [];
    const omitted = [...result.omissions];
    let used = 0;
    for (const hit of result.hits) {
      const bytes = canonicalBytes(hit).length;
      if (used + bytes <= budgetBytes) {
        included.push(hit);
        used += bytes;
      } else {
        omitted.push({ record_id: hit.record_id, reason: "BYTE_BUDGET_EXCEEDED", required_bytes: bytes });
      }
    }
    const packet = {
      schema: "agentos.memory.context_packet.v1",
      project_id: this.project.config.project_id,
      ledger_head_sequence: result.head_sequence,
      query,
      retrieval_profile: "exact-keyword-scope-v1",
      budget: { unit: "canonical_utf8_bytes", maximum: budgetBytes, used },
      records: included,
      omissions: omitted
    };
    return { ...packet, packet_digest: sha256Ref("agentos.memory.context-packet.v1", canonicalBytes(packet)) };
  }

  async compileSeed({ role, lane, query = "", budget_bytes = 24_576 }) {
    invariant(typeof role === "string" && role.length > 0, "INVALID_ROLE", "seed role is required");
    invariant(typeof lane === "string" && lane.length > 0, "INVALID_LANE", "seed lane is required");
    const packet = await this.contextPacket(query, { role, lane, budget_bytes, limit: 1000 });
    const seed = {
      schema: "agentos.memory.seed_capsule.v1",
      project_id: this.project.config.project_id,
      role,
      lane,
      source_head_sequence: packet.ledger_head_sequence,
      context_packet_digest: packet.packet_digest,
      records: packet.records,
      omissions: packet.omissions
    };
    return { ...seed, capsule_digest: sha256Ref("agentos.memory.seed-capsule.v1", canonicalBytes(seed)) };
  }

  async descendantClosure(recordId) {
    const state = await this.projectState();
    const root = state.records.get(recordId);
    invariant(root, "UNKNOWN_RECORD", `${recordId} does not exist`);
    const bySource = new Map();
    for (const [candidateId, current] of state.records) {
      for (const source of current.record.source_refs) {
        if (!bySource.has(source)) bySource.set(source, []);
        bySource.get(source).push(candidateId);
      }
    }
    const queue = [recordId, root.object_ref];
    const visitedRefs = new Set(queue);
    const descendants = new Set();
    for (let offset = 0; offset < queue.length; offset += 1) {
      const source = queue[offset];
      for (const candidateId of (bySource.get(source) ?? []).sort()) {
        if (descendants.has(candidateId)) continue;
        descendants.add(candidateId);
        const candidate = state.records.get(candidateId);
        for (const next of [candidateId, candidate.object_ref]) {
          if (!visitedRefs.has(next)) { visitedRefs.add(next); queue.push(next); }
        }
      }
    }
    return {
      root_record_id: recordId,
      closure_head_sequence: state.head_sequence,
      descendants: [...descendants].sort().map((id) => ({ record_id: id, state: state.records.get(id).state, object_ref: state.records.get(id).object_ref }))
    };
  }

  async invalidateClosure(recordId, { actor = "reviewer:repair", reason = "source invalidated" } = {}) {
    authorize("RECORD_INVALIDATED", actor);
    const closure = await this.descendantClosure(recordId);
    const state = await this.projectState();
    const targets = [recordId, ...closure.descendants.map((item) => item.record_id)]
      .filter((id) => state.records.get(id)?.state === "ACCEPTED");
    const invalidated = [];
    for (const id of targets) {
      await this.transition(id, "RECORD_INVALIDATED", { actor, reason });
      invalidated.push(id);
    }
    const final = await this.projectState();
    return {
      schema: "agentos.memory.repair_closure_receipt.v1",
      project_id: this.project.config.project_id,
      root_record_id: recordId,
      declared_closure: [recordId, ...closure.descendants.map((item) => item.record_id)],
      invalidated,
      final_head_sequence: final.head_sequence,
      proof_scope: "declared ledger records and authorized retrieval projection only"
    };
  }
}
