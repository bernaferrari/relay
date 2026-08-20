/**
 * Private in-process bridge between survey capture and persistence.
 *
 * `documentOriginProven` is intentionally only a diagnostic field on the
 * serializable survey result. Durable origin receipts additionally require
 * these immutable facts, which are never exported through the public core
 * barrel and cannot be recreated from a hand-authored result object.
 */
import { createHash } from "node:crypto";
import type {
  ScrollSurveyCapture,
  ScrollSurveyFrame,
  ScrollSurveyResult,
} from "./scrollable-survey-types.js";

export type ValidatedDocumentOriginIssuance = {
  firstViewport: {
    index: 0;
    offsetY: 0;
    appendedHeight: 0;
    capturedAt: number;
    width: number;
    height: number;
    screenshotSha256: string;
    accessibilityTreeSha256: string;
  };
  terminalViewport: {
    capturedAt: number;
    width: number;
    height: number;
    screenshotSha256: string;
    accessibilityTreeSha256: string;
  };
};

const validatedDocumentOriginRestorations = new WeakMap<
  ScrollSurveyResult,
  ValidatedDocumentOriginIssuance
>();

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Build immutable facts from the exact first and terminal raw captures.
 * It is private because only a survey that holds a minted frozen-origin
 * capability may place these facts in the issuance WeakMap. */
export function documentOriginIssuanceFor(
  first: ScrollSurveyFrame,
  terminal: ScrollSurveyCapture,
): ValidatedDocumentOriginIssuance | undefined {
  const firstWidth = first.screenshot.width;
  const firstHeight = first.screenshot.height;
  const terminalWidth = terminal.screenshot.width ?? 0;
  const terminalHeight = terminal.screenshot.height ?? 0;
  if (
    first.index !== 0 ||
    first.offsetY !== 0 ||
    first.appendedHeight !== 0 ||
    !Number.isSafeInteger(first.screenshot.capturedAt) ||
    !Number.isSafeInteger(firstWidth) ||
    !Number.isSafeInteger(firstHeight) ||
    firstWidth <= 0 ||
    firstHeight <= 0 ||
    !Number.isSafeInteger(terminal.screenshot.capturedAt) ||
    !Number.isSafeInteger(terminalWidth) ||
    !Number.isSafeInteger(terminalHeight) ||
    terminalWidth <= 0 ||
    terminalHeight <= 0
  ) {
    return undefined;
  }
  try {
    const firstViewport = Object.freeze({
      index: 0 as const,
      offsetY: 0 as const,
      appendedHeight: 0 as const,
      capturedAt: first.screenshot.capturedAt,
      width: firstWidth,
      height: firstHeight,
      screenshotSha256: sha256(Buffer.from(first.screenshot.base64, "base64")),
      accessibilityTreeSha256: sha256(JSON.stringify(first.snapshot)),
    });
    const terminalViewport = Object.freeze({
      capturedAt: terminal.screenshot.capturedAt,
      width: terminalWidth,
      height: terminalHeight,
      screenshotSha256: sha256(Buffer.from(terminal.screenshot.base64, "base64")),
      accessibilityTreeSha256: sha256(JSON.stringify(terminal.snapshot)),
    });
    return Object.freeze({ firstViewport, terminalViewport });
  } catch {
    return undefined;
  }
}

export function recordValidatedDocumentOriginIssuance(
  result: ScrollSurveyResult,
  issuance: ValidatedDocumentOriginIssuance,
): void {
  validatedDocumentOriginRestorations.set(result, issuance);
}

export function validatedDocumentOriginIssuance(
  result: ScrollSurveyResult,
): ValidatedDocumentOriginIssuance | undefined {
  const issuance = validatedDocumentOriginRestorations.get(result);
  return issuance ? structuredClone(issuance) : undefined;
}
