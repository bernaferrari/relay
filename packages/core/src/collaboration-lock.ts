import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stealStaleLock(lockPath: string): Promise<void> {
  try {
    const pid = Number((await readFile(lockPath, "utf8")).trim());
    if (!pidIsAlive(pid)) await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

/** Exclusive cross-process lock for collaboration.json read-modify-write. */
export async function withCollaborationLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = join(stateRoot, "collaboration.lock");
  await mkdir(stateRoot, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      );
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
      } finally {
        await handle.close();
      }
      try {
        return await operation();
      } finally {
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the collaboration state lock");
      }
      await stealStaleLock(lockPath);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}
