import {
  persistScrollSurvey as persistScrollSurveyCapture,
  SurveyPersistError,
  type SurveyPersistDigest,
  type SurveyPersistFrame,
  type SurveyPersistFull,
  type SurveyPersistPath,
} from "@relay/core";
import { CliError, ExitCode } from "./errors.js";

export type { SurveyPersistDigest, SurveyPersistFrame, SurveyPersistFull, SurveyPersistPath };

export function scrollSurveyPersistDigest(result: unknown): SurveyPersistDigest | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const persist = (result as { persist?: unknown }).persist;
  if (!persist || typeof persist !== "object" || Array.isArray(persist)) return undefined;
  const body = persist as Partial<SurveyPersistDigest>;
  if (body.status !== "completed" && body.status !== "stopped") return undefined;
  if (typeof body.reason !== "string" || !body.reason.trim()) return undefined;
  if (typeof body.dir !== "string" || !body.dir.trim()) return undefined;
  if (typeof body.frameCount !== "number" || !Number.isInteger(body.frameCount)) return undefined;
  if (!Array.isArray(body.paths) || !Array.isArray(body.frames)) return undefined;
  return persist as SurveyPersistDigest;
}

/** Write each original viewport as sibling 00.png / 00.json files. The JSON
 * is a review tree (defaults + overrides); stdout stays a digest. */
export async function persistScrollSurvey(
  dir: string,
  result: unknown,
  options: { force?: boolean } = {},
): Promise<SurveyPersistDigest> {
  try {
    return await persistScrollSurveyCapture(dir, result, options);
  } catch (error) {
    if (error instanceof SurveyPersistError) {
      throw new CliError(
        error.message,
        error.code === "conflict" ? ExitCode.conflict : ExitCode.validation,
      );
    }
    throw error;
  }
}
