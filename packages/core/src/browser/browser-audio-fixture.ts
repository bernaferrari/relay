import { inspectMedia } from "../media/media-check.js";
import { open } from "node:fs/promises";
import { resolveManagedFixtureFile } from "../managed-fixtures.js";

/** Chromium consumes a WAV fixture through its media input device. No host microphone is opened. */
export async function audioFixtureLaunchArguments(
  reference: string,
  projectId?: string,
): Promise<string[]> {
  if (!projectId) throw new Error("Audio input fixture requires an explicit project scope");
  if (!reference.startsWith("fixture:"))
    throw new Error("Audio input requires a managed fixture reference");
  const file = await resolveManagedFixtureFile(reference, projectId);
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    if (
      bytesRead !== 12 ||
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    )
      throw new Error("Audio input fixture must be a WAV file");
  } finally {
    await handle.close();
  }
  const facts = await inspectMedia(reference, projectId);
  if (!facts.hasAudio || !facts.durationMs)
    throw new Error("Audio input fixture has no playable audio");
  return ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${file}`];
}
