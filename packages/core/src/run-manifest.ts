import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const previousRunManifest = ".run.previous.json";

/** A single bounded journal keeps the committed generation readable while
 * run.json and its digest marker are being replaced. Never accept an unverified
 * newer manifest merely because publication was interrupted. */
export async function readCommittedRunManifest(dir: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const path = join(dir, "run.json");
    const raw = await readFile(path, "utf8");
    if (Number(JSON.parse(raw).schemaVersion ?? 0) < 5) return { raw, path };
    const marker = JSON.parse(await readFile(join(dir, ".complete"), "utf8"));
    for (const candidate of [path, join(dir, previousRunManifest)]) {
      const content = candidate === path ? raw : await readFile(candidate, "utf8").catch(() => "");
      if (marker.digest === createHash("sha256").update(content).digest("hex"))
        return { raw: content, path: candidate };
    }
    // A subsequent writer may have advanced both generations between reads.
  }
  throw new Error("Run commit marker digest mismatch");
}

/** Call inside the Run write transaction before replacing either commit file. */
export async function preserveCommittedRunManifest(dir: string) {
  let committed;
  try {
    committed = await readCommittedRunManifest(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const temp = join(dir, `.run.previous.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, committed.raw, { flag: "wx", mode: 0o600 });
    await syncRunPath(temp);
    await rename(temp, join(dir, previousRunManifest));
    await syncRunPath(dir);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function syncRunPath(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
