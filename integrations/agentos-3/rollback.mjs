import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export async function rollbackTestBuild(targetRoot) {
  await rm(resolve(targetRoot), { recursive: true, force: true });
  return { rollback: "AGENTOS_3_TEST_BUILD_ROLLBACK", target_root: resolve(targetRoot), released: false };
}
