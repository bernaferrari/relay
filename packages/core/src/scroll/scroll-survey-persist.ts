import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { presentPersistedSnapshot } from "@relay/protocol";

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

export class SurveyPersistError extends Error {
  readonly code: "validation" | "conflict";

  constructor(message: string, code: "validation" | "conflict" = "validation") {
    super(message);
    this.name = "SurveyPersistError";
    this.code = code;
  }
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message: string, code: "validation" | "conflict" = "validation"): never {
  throw new SurveyPersistError(message, code);
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

function decodePng(screenshot: Record<string, unknown>, label: string): Buffer {
  if (typeof screenshot.base64 !== "string" || screenshot.base64.length === 0) {
    fail(`Could not decode ${label} PNG: missing base64`);
  }
  if (screenshot.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.base64)) {
    fail(`Could not decode ${label} PNG: invalid base64`);
  }
  const png = Buffer.from(screenshot.base64, "base64");
  if (png.byteLength < pngSignature.byteLength || !png.subarray(0, 8).equals(pngSignature)) {
    fail(`Could not decode ${label} PNG: invalid PNG signature`);
  }
  return png;
}

/** Write each original viewport as sibling 00.png / 00.json files. The JSON
 * is a review tree (defaults + overrides); callers keep a digest. */
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
      fail(`Survey directory is not empty: ${root}. Use --force to overwrite it.`, "conflict");
    }
    if (existing.length > 0 && options.force) {
      await rm(root, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof SurveyPersistError) throw error;
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
    const png = decodePng(screenshot, `survey frame ${index}`);
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
      await writeFile(fullPng, decodePng(stitched, "full-page survey"));
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
      if (error instanceof SurveyPersistError) throw error;
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
