import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export async function readFrameFile(runDir: string, relPath: string): Promise<Buffer | null> {
  // prevent path escape
  const safe = basename(relPath.includes("/") ? relPath.split("/").pop()! : relPath);
  const abs = join(runDir, "frames", safe);
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export function runArtifactFile(runDir: string, area: "video", file: string): string | null {
  const safe = basename(file);
  if (!safe || safe !== file || !/\.(mp4|webm)$/i.test(safe)) return null;
  return join(runDir, area, safe);
}
