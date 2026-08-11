import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { atomicWrite } from "./io.mjs";

export class CurrentProjection {
  constructor(project, memory) {
    this.project = project;
    this.memory = memory;
  }

  async compile() {
    const state = await this.memory.projectState();
    const records = [...state.records.values()].map((current) => ({
      record_id: current.record.record_id,
      object_ref: current.object_ref,
      state: current.state,
      effective_state: current.effective_state,
      superseded_by: current.superseded_by,
      family: current.record.family,
      scope: current.record.scope,
      relations: current.record.relations ?? { supersedes: [], contradicts: [] },
      authority: {
        proposed_by: current.proposed_by,
        verified_by: current.verified_by,
        accepted_by: current.accepted_by
      },
      sequence: current.sequence
    })).sort((a, b) => a.record_id.localeCompare(b.record_id, "en"));
    const holds = [...state.holds.entries()].map(([recordId, hold]) => ({ record_id: recordId, ...hold }))
      .sort((a, b) => a.record_id.localeCompare(b.record_id, "en"));
    const body = {
      schema: "agentos.memory.current_projection.v1",
      project_id: this.project.config.project_id,
      source_head_sequence: state.head_sequence,
      records,
      holds
    };
    return { ...body, projection_digest: sha256Ref("agentos.memory.current-projection.v1", canonicalBytes(body)) };
  }

  async rebuild() {
    const projection = await this.compile();
    const path = join(this.project.root, "projections", "current.json");
    await atomicWrite(path, Buffer.from(`${canonicalJson(projection)}\n`));
    return projection;
  }

  async verify() {
    const path = join(this.project.root, "projections", "current.json");
    const expected = Buffer.from(`${canonicalJson(await this.compile())}\n`);
    const info = await lstat(path);
    invariant(info.isFile() && !info.isSymbolicLink(), "PROJECTION_FILE_INVALID", "current projection must be a real regular file");
    invariant((info.mode & 0o077) === 0, "PROJECTION_FILE_PERMISSIONS", "current projection must not be accessible by group or other users");
    const stored = await readFile(path);
    invariant(stored.equals(expected), "PROJECTION_MISMATCH", "stored current projection does not match deterministic replay");
    return { ok: true, byte_count: stored.length, projection_digest: JSON.parse(stored).projection_digest };
  }
}
