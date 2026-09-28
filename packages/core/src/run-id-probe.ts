import { open, readFile } from "node:fs/promises";
import { join } from "node:path";

const RUN_ID_PROBE_BYTES = 4096;
const PRETTY_TOP_LEVEL_ID = /\n {2}"id": "([^"\\]+)"/u;

/** The manifest's top-level id, read from its head when it is pretty-printed. */
export async function persistedRunIdAt(dir: string): Promise<string | null> {
  const path = join(dir, "run.json");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(RUN_ID_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, RUN_ID_PROBE_BYTES, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");
    const pretty = PRETTY_TOP_LEVEL_ID.exec(head)?.[1];
    if (pretty) return pretty;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}
