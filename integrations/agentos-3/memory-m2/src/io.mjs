import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { MemoryError, invariant } from "./errors.mjs";

export async function exists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function fsyncDir(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function atomicWrite(path, bytes, mode = 0o600) {
  await ensurePrivateDir(dirname(path));
  const temp = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try { await rename(temp, path); } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await chmod(path, mode);
  await fsyncDir(dirname(path));
}

export async function readJson(path) {
  let text;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") throw new MemoryError("NOT_FOUND", `missing ${path}`);
    throw error;
  }
  try { return JSON.parse(text); } catch (error) {
    throw new MemoryError("INVALID_JSON", `invalid JSON at ${path}`, { cause: error.message });
  }
}

function validWriterLock(lock) {
  return lock && typeof lock.owner === "string" && lock.owner.length > 0
    && Number.isSafeInteger(lock.pid) && lock.pid > 0
    && typeof lock.acquired_at === "string" && Number.isFinite(Date.parse(lock.acquired_at))
    && typeof lock.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(lock.token);
}

async function readWriterLock(path) {
  const info = await lstat(path);
  invariant(info.isFile() && !info.isSymbolicLink(), "INVALID_WRITER_LOCK_FILE", "writer lock must be a real regular file");
  invariant((info.mode & 0o077) === 0, "INSECURE_WRITER_LOCK", "writer lock must not be accessible by group or other users");
  return JSON.parse(await readFile(path, "utf8"));
}

export async function acquireWriterLock(root, owner, timeoutMs = 15_000) {
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "INVALID_TIMEOUT", "timeoutMs must be a positive integer");
  const path = join(root, "state", "writer.lock");
  await ensurePrivateDir(dirname(path));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      const token = randomBytes(32).toString("base64url");
      await handle.writeFile(JSON.stringify({ owner, pid: process.pid, acquired_at: new Date().toISOString(), token }));
      await handle.sync();
      await handle.close();
      await fsyncDir(dirname(path));
      let released = false;
      return async () => {
        if (released) return;
        let current;
        try { current = await readWriterLock(path); } catch (error) {
          throw new MemoryError("WRITER_LOCK_REPLACED", "writer lock disappeared or became unreadable before release", { cause: error.message });
        }
        invariant(current.owner === owner && current.pid === process.pid && current.token === token,
          "WRITER_LOCK_REPLACED", "writer lock identity changed before release");
        await rm(path, { force: true });
        await fsyncDir(dirname(path));
        released = true;
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lock = await readWriterLock(path);
        if (!validWriterLock(lock)) throw new MemoryError("INVALID_WRITER_LOCK", "writer lock record is malformed");
        const age = Date.now() - Date.parse(lock.acquired_at);
        let alive = true;
        try { process.kill(lock.pid, 0); } catch (probe) {
          if (probe.code === "ESRCH") alive = false;
        }
        if (!alive && Number.isFinite(age) && age >= 0) {
          const current = await readWriterLock(path);
          if (!validWriterLock(current) || current.owner !== lock.owner || current.pid !== lock.pid
            || current.acquired_at !== lock.acquired_at || current.token !== lock.token) continue;
          await rm(path, { force: true });
          await fsyncDir(dirname(path));
          continue;
        }
      } catch {
        // A malformed or partially readable lock is not removed automatically.
        // Failing closed is safer than fencing a writer whose identity is unknown.
      }
      if (Date.now() >= deadline) throw new MemoryError("WRITER_BUSY", "writer lock acquisition timed out");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
