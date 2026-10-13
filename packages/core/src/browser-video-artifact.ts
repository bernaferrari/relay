import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Video } from "playwright-core";

/** The Playwright handle owns only its new source recording. Delete it after
 * the finalized Run copy is durable, preserving that source on any copy failure. */
export async function saveBrowserVideoArtifact(
  video: Video,
  output: string,
): Promise<string | undefined> {
  const source = await video.path();
  await video.saveAs(output);
  const file = await open(output, "r");
  try {
    if ((await file.stat()).size === 0) throw new Error("Browser video copy is empty");
    await file.sync();
  } finally {
    await file.close();
  }
  // Windows does not support opening a directory for fsync. The finalized
  // file itself is still flushed before releasing the Playwright source.
  if (process.platform !== "win32") {
    const directory = await open(dirname(output), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  // An explicit caller can request the source path itself. It is then the
  // retained artifact, so removing the handle would remove the only copy.
  if (resolve(source) !== resolve(output)) {
    try {
      await video.delete();
    } catch {
      return "Run video was saved, but its temporary browser source could not be removed.";
    }
  }
  return undefined;
}
