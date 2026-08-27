import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { presentPersistedSnapshot } from "@relay/protocol";
import { CliError, ExitCode } from "./errors.js";
import { screenshotPng } from "./screenshot.js";

export type SurveyPersistPath = {
  png: string;
  json: string;
};

/** One manifest row per persisted frame: where it scrolled to, which files it
 * wrote, and how many labeled controls the review tree kept. */
export type SurveyPersistFrame = {
  index: number;
  offsetY?: number;
  labelCount: number;
  files: SurveyPersistPath;
};

export type SurveyPersistFull = {
  png: string;
  json: string;
  width: number;
  height: number;
  nodeCount: number;
};

export type SurveyPersistDigest = {
  status: "completed" | "stopped";
  reason: string;
  frameCount: number;
  dir: string;
  paths: SurveyPersistPath[];
  frames: SurveyPersistFrame[];
  full?: SurveyPersistFull;
};

function fail(message: string): never {
  throw new CliError(message, ExitCode.validation);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`Malformed scroll survey response: expected ${label}`);
  }
  return value as Record<string, unknown>;
}

function frameStem(index: number): string {
  return String(index).padStart(2, "0");
}

function framePng(screenshot: Record<string, unknown>, index: number): Buffer {
  try {
    return screenshotPng({ base64: screenshot.base64, mime: "image/png" });
  } catch (error) {
    fail(
      `Could not decode survey frame ${index} PNG: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Write each original viewport as sibling 00.png / 00.json files. The JSON
 * is a review tree (defaults + overrides); stdout stays a digest. */
export async function persistScrollSurvey(
  dir: string,
  result: unknown,
  options: { force?: boolean } = {},
): Promise<SurveyPersistDigest> {
  const requested = dir.trim();
  if (!requested) fail("Survey --dir must be a non-empty folder path");
  const root = isAbsolute(requested) ? requested : resolve(requested);
  const body = record(result, "an object");
  if (body.status !== "completed" && body.status !== "stopped") {
    fail("Malformed scroll survey response: expected status");
  }
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    fail("Malformed scroll survey response: expected reason");
  }
  if (!Array.isArray(body.frames) || body.frames.length === 0) {
    fail("Malformed scroll survey response: expected frames");
  }

  try {
    const existing = await readdir(root);
    if (existing.length > 0 && !options.force) {
      throw new CliError(
        `Survey directory is not empty: ${root}. Use --force to overwrite it.`,
        ExitCode.conflict,
      );
    }
    if (existing.length > 0 && options.force) {
      await rm(root, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const missing =
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    if (!missing) {
      fail(
        `Could not create survey directory ${root}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    fail(
      `Could not create survey directory ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const paths: SurveyPersistPath[] = [];
  const frames: SurveyPersistFrame[] = [];
  for (const [ordinal, value] of body.frames.entries()) {
    const frame = record(value, `frame ${ordinal}`);
    const index = Number.isInteger(frame.index) ? Number(frame.index) : ordinal;
    const screenshot = record(frame.screenshot, `frame ${index} screenshot`);
    const snapshot = record(frame.snapshot, `frame ${index} snapshot`);
    if (!Array.isArray(snapshot.nodes)) {
      fail(`Malformed scroll survey frame ${index}: snapshot.nodes must be an array`);
    }
    const png = framePng(screenshot, index);
    const stem = frameStem(index);
    const pngPath = join(root, `${stem}.png`);
    const jsonPath = join(root, `${stem}.json`);
    const presentable = presentPersistedSnapshot(snapshot);
    const jsonBody = {
      index,
      ...(typeof frame.offsetY === "number" ? { offsetY: frame.offsetY } : {}),
      ...(typeof frame.appendedHeight === "number" ? { appendedHeight: frame.appendedHeight } : {}),
      screenshot: {
        ...(typeof screenshot.width === "number" ? { width: screenshot.width } : {}),
        ...(typeof screenshot.height === "number" ? { height: screenshot.height } : {}),
        ...(typeof screenshot.capturedAt === "number" ? { capturedAt: screenshot.capturedAt } : {}),
      },
      snapshot: presentable,
    };
    try {
      await writeFile(pngPath, png);
      await writeFile(jsonPath, `${JSON.stringify(jsonBody, null, 2)}\n`);
    } catch (error) {
      fail(
        `Could not write survey frame ${stem} in ${root}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const files = { png: pngPath, json: jsonPath };
    paths.push(files);
    frames.push({
      index,
      ...(typeof frame.offsetY === "number" ? { offsetY: frame.offsetY } : {}),
      labelCount: presentable.nodes.filter(
        (node) => typeof node.label === "string" && node.label.trim().length > 0,
      ).length,
      files,
    });
  }

  let full: SurveyPersistFull | undefined;
  const stitched =
    body.stitched && typeof body.stitched === "object" && !Array.isArray(body.stitched)
      ? (body.stitched as Record<string, unknown>)
      : undefined;

  if (typeof stitched?.base64 === "string" && stitched.base64.length > 0) {
    const fullPng = join(root, "full.png");
    const fullJson = join(root, "full.json");
    const mergedNodes = Array.isArray(body.mergedNodes) ? body.mergedNodes : [];
    try {
      await writeFile(fullPng, screenshotPng({ base64: stitched.base64, mime: "image/png" }));
      await writeFile(
        fullJson,
        `${JSON.stringify(
          {
            width: typeof stitched.width === "number" ? stitched.width : undefined,
            height: typeof stitched.height === "number" ? stitched.height : undefined,
            nodeCount: mergedNodes.length,
            snapshot: presentPersistedSnapshot({ nodes: mergedNodes }),
          },

          null,
          2,
        )}\n`,
      );
    } catch (error) {
      fail(
        `Could not write full-page survey in ${root}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    full = {
      png: fullPng,
      json: fullJson,
      width: typeof stitched.width === "number" ? stitched.width : 0,
      height: typeof stitched.height === "number" ? stitched.height : 0,
      nodeCount: mergedNodes.length,
    };
  }

  return {
    status: body.status,
    reason: body.reason.trim(),
    frameCount: paths.length,
    dir: root,
    paths,
    frames,
    ...(full ? { full } : {}),
  };
}
