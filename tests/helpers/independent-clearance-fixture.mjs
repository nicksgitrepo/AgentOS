import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

export const CANONICAL_FIXTURE_RECEIPT_SHA256 = "be24556276d410d030de1f4be81f5400e96b82627289351e5d963d1b69a4c85b";

export function prepareCanonicalIndependentClearanceFixture() {
  const workspaceRoot = path.resolve(new URL("../..", import.meta.url).pathname);
  const root = fs.mkdtempSync(path.join(workspaceRoot, ".agentos-independent-clearance-canonical-"));
  const repositoryRoot = path.join(root, "repository");
  const authorityRoot = path.join(root, "authority");
  fs.cpSync(new URL("../fixtures/independent-clearance/repository/", import.meta.url), repositoryRoot, {recursive: true});
  fs.cpSync(new URL("../fixtures/independent-clearance/authority/", import.meta.url), authorityRoot, {recursive: true});
  execFileSync("git", ["init", "-q"], {cwd: repositoryRoot});
  execFileSync("git", ["config", "user.name", "Independent Fixture Evaluator"], {cwd: repositoryRoot});
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {cwd: repositoryRoot});
  execFileSync("git", ["add", "."], {cwd: repositoryRoot});
  execFileSync("git", ["commit", "-q", "-m", "Canonical independent clearance fixture"], {
    cwd: repositoryRoot,
    env: {...process.env, GIT_AUTHOR_DATE: "2026-08-18T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-18T00:00:00Z"},
  });
  return {root, repositoryRoot, authorityRoot, receiptSha256: CANONICAL_FIXTURE_RECEIPT_SHA256};
}
