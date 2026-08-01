import { writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { ScreenshotOutput } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import type { CliOutput } from "./output.js";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function screenshotRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("Malformed screenshot response: expected an object", ExitCode.validation);
  }
  return value as Record<string, unknown>;
}

export function screenshotPng(value: unknown): Buffer {
  const screenshot = screenshotRecord(value);
  if (screenshot.mime !== undefined && screenshot.mime !== "image/png") {
    throw new CliError("Malformed screenshot response: expected image/png", ExitCode.validation);
  }
  if (typeof screenshot.base64 !== "string" || screenshot.base64.length === 0) {
    throw new CliError("Screenshot response does not include PNG data", ExitCode.validation);
  }
  if (screenshot.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.base64)) {
    throw new CliError("Malformed screenshot response: invalid base64", ExitCode.validation);
  }
  const png = Buffer.from(screenshot.base64, "base64");
  if (png.byteLength < pngSignature.byteLength || !png.subarray(0, 8).equals(pngSignature)) {
    throw new CliError("Malformed screenshot response: invalid PNG signature", ExitCode.validation);
  }
  return png;
}

export async function emitScreenshot(
  operationId: string,
  result: unknown,
  destination: ScreenshotOutput,
  output: CliOutput,
): Promise<void> {
  if (destination.kind === "default") {
    output.result(operationId, result);
    return;
  }

  const png = screenshotPng(result);
  if (destination.kind === "binary") {
    output.binary(png);
    return;
  }

  try {
    await writeFile(destination.path, png, { flag: destination.force ? "w" : "wx" });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EEXIST"
    ) {
      throw new CliError(
        `Screenshot file already exists: ${destination.path}. Use --force to overwrite it.`,
        ExitCode.conflict,
      );
    }
    throw new CliError(
      `Could not write screenshot file ${destination.path}: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.validation,
    );
  }

  const source = screenshotRecord(result);
  output.result(operationId, {
    file: destination.path,
    bytes: png.byteLength,
    mime: "image/png",
    ...(typeof source.path === "string" ? { sourcePath: source.path } : {}),
  });
}
