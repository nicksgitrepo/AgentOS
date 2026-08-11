const IDENTITY = Object.freeze({
  source_commit: "5f6b68d4a55a0ae6b7a3009a0e659ec256b2ae1e",
  candidate_commit: "59860e96574416673c5a1dca19b6e06368f4de97",
  candidate_tree: "dd39662b87abec5d359863f6f1565d2792941d26",
  central_commit: "0b68f431d62bee662763e00cfe4bf496c815ab7e",
  central_tree: "9afbf4f9db7e3bd8c260ecc15be19066fc8deb9f"
});

export function mainCoreIdentity() { return { ...IDENTITY }; }
