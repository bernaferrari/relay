import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

/** Decode recorded audio, then measure samples. A track or speaker icon is not evidence of sound. */
export async function measureAudioOutput(
  file: string,
): Promise<{ rms: number; durationMs: number }> {
  const { stdout } = await execute(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 30_000, maxBuffer: 3 * 1024 * 1024 },
  );
  const count = Math.floor(stdout.length / 4);
  if (!count || stdout.length % 4 !== 0)
    throw new Error("audio-record has no decoded audio samples");
  let squares = 0;
  for (let index = 0; index < count; index += 1) {
    const value = stdout.readFloatLE(index * 4);
    if (!Number.isFinite(value)) throw new Error("audio-record decoded invalid audio samples");
    squares += value * value;
  }
  return { rms: Math.sqrt(squares / count), durationMs: count / 16 };
}
