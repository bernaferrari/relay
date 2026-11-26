import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureIosPngViaGoIos, pixelEvidenceFingerprint } from "./ios-app-launch.js";

/**
 * Cheap pixel identity for the assisted second look. Capture failures stay
 * `undefined`: missing evidence must stop the re-dispatch, never fake a match.
 */
export async function captureIosPixelFingerprint(
  serial: string,
  input: {
    run?: (
      file: string,
      args: readonly string[],
      timeoutMs: number,
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  } = {},
): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-second-look-"));
  const path = join(directory, "frame.png");
  try {
    await captureIosPngViaGoIos(serial, path, input.run ? { run: input.run } : {});
    const bytes = await readFile(path);
    return pixelEvidenceFingerprint(bytes);
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
