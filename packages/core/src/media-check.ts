import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { findWorkspaceRoot } from "./workspace-root.js";

const execute = promisify(execFile);
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
  format: z.object({ duration: z.string().optional() }),
});
export type MediaFacts = {
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  hasAudio: boolean;
  hasVideo: boolean;
};
type MediaCheck = Extract<RecipeStep, { kind: "media-check" }>;

async function workspaceFile(file: string): Promise<string> {
  const root = await realpath(findWorkspaceRoot());
  const path = await realpath(resolve(root, file));
  const local = relative(root, path);
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    throw new Error("media-check: file must be inside the workspace");
  if (!(await stat(path)).isFile()) throw new Error("media-check: expected a regular file");
  return path;
}

export async function inspectMedia(file: string): Promise<MediaFacts> {
  const path = await workspaceFile(file);
  const info = await stat(path);
  if (info.size === 0) throw new Error("media-check: empty file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  let stdout: string;
  try {
    ({ stdout } = await execute(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    ));
    // Decode the entire output. Metadata alone cannot establish playability.
    await execute(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path,
        "-f",
        "null",
        "-",
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      throw new Error("media-check requires ffprobe and ffmpeg on PATH");
    throw new Error("media-check: media could not be decoded within 30 seconds", { cause: error });
  }
  const probe = probeSchema.parse(JSON.parse(stdout));
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const duration = Number(probe.format.duration);
  return {
    sha256: hash.digest("hex"),
    bytes: info.size,
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    ...(Number.isFinite(duration) && duration > 0
      ? { durationMs: Math.round(duration * 1000) }
      : {}),
    hasAudio: probe.streams.some((stream) => stream.codec_type === "audio"),
    hasVideo: Boolean(video),
  };
}

export function assertMediaFacts(step: MediaCheck, output: MediaFacts, source?: MediaFacts): void {
  if (step.media === "audio" ? !output.hasAudio : !output.hasVideo)
    throw new Error(`media-check: no ${step.media} stream`);
  if (step.media !== "image" && !output.durationMs)
    throw new Error("media-check: missing playable duration");
  for (const key of ["width", "height"] as const)
    if (step[key] !== undefined && output[key] !== step[key])
      throw new Error(`media-check: expected ${key} ${step[key]}, saw ${output[key]}`);
  if (step.minBytes && output.bytes < step.minBytes)
    throw new Error("media-check: file is too small");
  if (step.minDurationMs && (output.durationMs ?? 0) < step.minDurationMs)
    throw new Error("media-check: duration is too short");
  if (step.sourceFile && !source) throw new Error("media-check: source evidence missing");
  if (source) {
    if (source.sha256 === output.sha256)
      throw new Error("media-check: output is identical to source");
    if (
      step.relation === "upscaled" &&
      !(
        output.width &&
        output.height &&
        source.width &&
        source.height &&
        output.width > source.width &&
        output.height > source.height
      )
    )
      throw new Error("media-check: output dimensions did not increase");
    if (
      step.relation === "extended" &&
      !((output.durationMs ?? 0) > (source.durationMs ?? Infinity))
    )
      throw new Error("media-check: output duration did not increase");
  }
}

export async function runMediaCheckStep(step: MediaCheck, ctx: RecipeStepContext): Promise<void> {
  const output = await inspectMedia(step.file);
  const source = step.sourceFile ? await inspectMedia(step.sourceFile) : undefined;
  const artifact = {
    kind: "media-check",
    capturedAt: Date.now(),
    data: {
      stepId: step.id,
      file: step.file,
      output,
      ...(source ? { sourceFile: step.sourceFile, source, relation: step.relation } : {}),
    },
  };
  ctx.job?.artifacts.push(artifact);
  ctx.artifacts?.push(artifact);
  assertMediaFacts(step, output, source);
  ctx.log(`media-check: decoded ${step.media}, ${output.bytes} bytes`);
}
