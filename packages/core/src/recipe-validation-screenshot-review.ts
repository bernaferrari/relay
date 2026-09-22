import type { CaptureSequencePhase, RecipeStep } from "@relay/protocol";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  sequenceAfterIsPlaceholder,
} from "@relay/protocol";
import { isNumber, isObject, isString, stepErr } from "./recipe-validation-support.js";

const STEP_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function parseScreenshotReview(
  raw: unknown,
  index: number,
): Extract<RecipeStep, { kind: "screenshot" }>["review"] {
  if (!isObject(raw)) {
    throw stepErr(index, "screenshot.review must be an object");
  }
  assertKnownReviewKeys(
    raw,
    ["mode", "lookFor", "policy", "phase", "phases", "checkpointId", "caption"],
    index,
    "screenshot.review",
  );
  if (raw.mode !== "later") {
    throw stepErr(index, "screenshot.review.mode must be later");
  }
  if (raw.lookFor !== undefined && !isString(raw.lookFor)) {
    throw stepErr(index, "screenshot.review.lookFor must be a string");
  }
  const policy = raw.policy;
  if (policy !== undefined && policy !== "fast" && policy !== "stable" && policy !== "sequence") {
    throw stepErr(index, "screenshot.review.policy must be fast, stable, or sequence");
  }
  const identityPhase =
    raw.phase === CAPTURE_REVIEW_DEST_PHASE || raw.phase === CAPTURE_REVIEW_LEFTOVER_PHASE;
  const hasSequenceFields =
    (raw.phase !== undefined && !identityPhase) ||
    raw.phases !== undefined ||
    raw.checkpointId !== undefined;
  if (hasSequenceFields && policy !== "sequence") {
    throw stepErr(index, "screenshot.review named phases require policy sequence");
  }
  let checkpointId: string | undefined;
  if (raw.checkpointId !== undefined) {
    if (!isString(raw.checkpointId) || !STEP_IDENTITY.test(raw.checkpointId)) {
      throw stepErr(
        index,
        "screenshot.review.checkpointId must use letters, numbers, hyphens, and underscores only",
      );
    }
    checkpointId = raw.checkpointId;
  }
  let phase: string | undefined;
  if (raw.phase !== undefined) {
    if (!isString(raw.phase) || !STEP_IDENTITY.test(raw.phase)) {
      throw stepErr(
        index,
        "screenshot.review.phase must use letters, numbers, hyphens, and underscores only",
      );
    }
    phase = raw.phase;
  }
  let phases: CaptureSequencePhase[] | undefined;
  if (raw.phases !== undefined) {
    if (!Array.isArray(raw.phases) || raw.phases.length === 0) {
      throw stepErr(index, "screenshot.review.phases must be a non-empty array of named phases");
    }
    const seen = new Set<string>();
    phases = raw.phases.map((item, phaseIndex) => {
      if (!isObject(item)) {
        throw stepErr(index, `screenshot.review.phases[${phaseIndex}] must be an object`);
      }
      assertKnownReviewKeys(
        item,
        ["id", "caption", "lookFor", "intervalMs"],
        index,
        `screenshot.review.phases[${phaseIndex}]`,
      );
      if (!isString(item.id) || !STEP_IDENTITY.test(item.id)) {
        throw stepErr(index, `screenshot.review.phases[${phaseIndex}].id is required`);
      }
      if (seen.has(item.id)) {
        throw stepErr(index, `screenshot.review.phases[${phaseIndex}].id is duplicated`);
      }
      seen.add(item.id);
      if (item.caption !== undefined && !isString(item.caption)) {
        throw stepErr(index, `screenshot.review.phases[${phaseIndex}].caption must be a string`);
      }
      if (item.lookFor !== undefined && !isString(item.lookFor)) {
        throw stepErr(index, `screenshot.review.phases[${phaseIndex}].lookFor must be a string`);
      }
      if (item.intervalMs !== undefined) {
        if (
          !isNumber(item.intervalMs) ||
          !Number.isInteger(item.intervalMs) ||
          item.intervalMs <= 0
        ) {
          throw stepErr(
            index,
            `screenshot.review.phases[${phaseIndex}].intervalMs must be a positive integer`,
          );
        }
      }
      return {
        id: item.id,
        ...(isString(item.caption) && item.caption.trim() ? { caption: item.caption.trim() } : {}),
        ...(isString(item.lookFor) && item.lookFor.trim() ? { lookFor: item.lookFor.trim() } : {}),
        ...(typeof item.intervalMs === "number" ? { intervalMs: item.intervalMs } : {}),
      };
    });
  }
  if (policy === "sequence" && !phase && !phases) {
    throw stepErr(index, "screenshot.review.policy sequence requires named phases");
  }
  const lookFor = isString(raw.lookFor) && raw.lookFor.trim() ? raw.lookFor.trim() : undefined;
  const caption = isString(raw.caption) && raw.caption.trim() ? raw.caption.trim() : undefined;
  if (
    sequenceAfterIsPlaceholder({
      ...(phase ? { phase } : {}),
      ...(lookFor ? { lookFor } : {}),
      ...(caption ? { caption } : {}),
      ...(phases ? { phases } : {}),
    })
  ) {
    throw stepErr(index, "Sequence after cannot be a loading placeholder");
  }
  return {
    mode: "later",
    ...(lookFor ? { lookFor } : {}),
    ...(policy === "fast" || policy === "stable" || policy === "sequence" ? { policy } : {}),
    ...(checkpointId ? { checkpointId } : {}),
    ...(phase ? { phase } : {}),
    ...(phases ? { phases } : {}),
  };
}

function assertKnownReviewKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  index: number,
  field: string,
): void {
  const known = new Set<string>(allowed);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw stepErr(index, `${field} unknown field: ${key}`);
  }
}
