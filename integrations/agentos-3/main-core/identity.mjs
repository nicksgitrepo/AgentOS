import manifest from "./source-manifest.json" with {type: "json"};

const IDENTITY = Object.freeze({
  source_commit: manifest.source_commit,
  source_tree: manifest.source_tree,
  candidate_commit: manifest.candidate_commit,
  candidate_tree: manifest.candidate_tree,
});

export function mainCoreIdentity() { return { ...IDENTITY }; }
