/**
 * A bounded, evidence-first capture of a long native viewport.
 *
 * This is deliberately not a blind “full page screenshot”: every stitched
 * section retains the exact original PNG and accessibility snapshot that
 * produced it. When the page, seam, or accessibility tree becomes uncertain,
 * collection stops and returns the reason instead of continuing to scroll.
 */
import {
  IosMutationOutcomeUnknownError,
  rethrowIosMutationOutcomeUnknown,
} from "./ios-mutation-policy.js";
import { createScrollableSurveyTargetCaptureAdapter } from "./scrollable-survey-target.js";
import { surveyPixelsSettled, verticalScrollSeam } from "./scrollable-survey-seams.js";
import {
  surveyExtent,
  surveyHasHiddenContentBelow,
  surveyShouldAttemptScroll,
  surveyShouldKeepScrolledFrame,
} from "./scrollable-survey-advance.js";
import {
  surveyLooksLikePaywall,
  surveyPaywallFirstFrame,
  surveyPaywallFirstFrameMessage,
} from "./scrollable-survey-settle.js";
import {
  composeScrollSurveyFrames,
  mergeScrollSurfaceNodes,
  sameSurveySurface,
  startViewportMatches,
  surveySurfaceIsIdentifiable,
} from "./scrollable-survey-compose.js";
import {
  documentOriginIssuanceFor,
  recordValidatedDocumentOriginIssuance,
  type ValidatedDocumentOriginIssuance,
} from "./document-origin-survey-issuance.js";
import { isMintedValidatedFrozenDocumentOrigin } from "./frozen-document-origin-capability.js";

import type {
  ScrollSurveyCapture,
  ScrollSurveyDriver,
  ScrollSurveyFrame,
  ScrollSurveyOptions,
  ScrollSurveyResult,
  ScrollSurveyStopReason,
} from "./scrollable-survey-types.js";

export type {
  ScrollSurveyCapture,
  ScrollSurveyDriver,
  ScrollSurveyFrame,
  ScrollSurveyOptions,
  ScrollSurveyResult,
  ScrollSurveyStopReason,
  ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey-types.js";
export { verticalScrollSeam } from "./scrollable-survey-seams.js";
export { composeScrollSurveyFrames, mergeScrollSurfaceNodes } from "./scrollable-survey-compose.js";
export {
  scrollSurveyFastRestoreGesture,
  scrollSurveyGesture,
  type ScrollSurveyTargetDependencies,
  type ScrollSurveyTargetInput,
} from "./scrollable-survey-target.js";

/**
 * A scroll command may have moved an iOS viewport even when XCTest lost its
 * acknowledgement. These raw frames are deliberately retained with the
 * terminal error so a reviewer can inspect the last proven viewport without
 * issuing a compensating scroll.
 */
export type ScrollSurveyOutcomeUnknownDiagnostic = {
  schemaVersion: 1;
  status: "interrupted";
  reason: "ios-mutation-outcome-unknown";
  message: string;
  frames: ScrollSurveyFrame[];
  diagnosticFrames: ScrollSurveyFrame[];
  restoredStartViewport: false;
  restoration: {
    attempted: false;
    reason: "iOS mutation outcome is unknown";
  };
};

const outcomeUnknownDiagnostics = new WeakMap<object, ScrollSurveyOutcomeUnknownDiagnostic>();

function attachScrollSurveyOutcomeUnknownDiagnostic(
  error: unknown,
  frames: ScrollSurveyFrame[],
  diagnosticFrames: ScrollSurveyFrame[],
): void {
  if (!(error instanceof IosMutationOutcomeUnknownError)) return;
  outcomeUnknownDiagnostics.set(error, {
    schemaVersion: 1,
    status: "interrupted",
    reason: "ios-mutation-outcome-unknown",
    message:
      "An iOS scroll may already have moved the viewport. Relay retained the captured frames and did not attempt restoration.",
    frames: structuredClone(frames),
    diagnosticFrames: structuredClone(diagnosticFrames),
    restoredStartViewport: false,
    restoration: {
      attempted: false,
      reason: "iOS mutation outcome is unknown",
    },
  });
}

/** Returns raw, decomposable survey evidence attached to an uncertain iOS scroll. */
export function scrollSurveyOutcomeUnknownDiagnostic(
  error: unknown,
): ScrollSurveyOutcomeUnknownDiagnostic | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const diagnostic = outcomeUnknownDiagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
}

function result(
  frames: ScrollSurveyFrame[],
  status: ScrollSurveyResult["status"],
  reason: ScrollSurveyStopReason,
  message: string,
  restoredStartViewport: boolean,
  diagnosticFrames: ScrollSurveyFrame[] = [],
  documentOriginIssuance?: ValidatedDocumentOriginIssuance,
  omitStitch = false,
): ScrollSurveyResult {
  const composition = composeScrollSurveyFrames(frames);
  const composedFrames = composition?.frames ?? frames;
  const stitched = reason === "seam-ambiguous" || omitStitch ? undefined : composition?.stitched;
  const documentOriginValidated =
    documentOriginIssuance &&
    status === "completed" &&
    reason === "end-of-content" &&
    restoredStartViewport;
  const output: ScrollSurveyResult = {
    status,
    reason,
    frames: composedFrames,
    diagnosticFrames,
    ...(stitched ? { stitched } : {}),
    mergedNodes: composition?.mergedNodes ?? mergeScrollSurfaceNodes(frames),
    restoredStartViewport,
    ...(documentOriginValidated ? { documentOriginProven: true as const } : {}),
    message,
  };
  if (documentOriginValidated) {
    // The facts are a value-only frozen snapshot of the exact raw evidence
    // before the result leaves this module. Persistence compares them to its
    // newly written CAS objects, so a caller cannot mutate a marked result and
    // mint a proof for different pixels/tree/terminal facts.
    recordValidatedDocumentOriginIssuance(output, documentOriginIssuance);
  }
  return output;
}

const PAYWALL_SETTLE_ATTEMPTS = 6;

async function settlePaywallOpening(
  driver: ScrollSurveyDriver,
  first: ScrollSurveyCapture,
  rejected: ScrollSurveyFrame[],
  enabled: boolean,
): Promise<
  | { ok: true; capture: ScrollSurveyCapture }
  | { ok: false; capture: ScrollSurveyCapture; message: string }
> {
  if (!enabled || !surveyLooksLikePaywall(first.snapshot)) return { ok: true, capture: first };
  let current = first;
  let previous: ScrollSurveyCapture | undefined;
  for (let attempt = 0; attempt < PAYWALL_SETTLE_ATTEMPTS; attempt += 1) {
    const verdict = surveyPaywallFirstFrame(current.snapshot);
    if (verdict.kind === "mixed-plans" || verdict.kind === "plan-mismatch") {
      rejected.push(candidateFrame(current, rejected.length, 0));
    } else if (previous) {
      const pixels = surveyPixelsSettled(
        Buffer.from(previous.screenshot.base64, "base64"),
        Buffer.from(current.screenshot.base64, "base64"),
      );
      if (pixels) return { ok: true, capture: current };
    }
    previous = current;
    if (attempt === PAYWALL_SETTLE_ATTEMPTS - 1) break;
    try {
      await driver.settle();
      current = await driver.capture();
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      return {
        ok: false,
        capture: current,
        message:
          "The paywall card mixed or contradicted the selected plan, and Relay could not recapture a settled frame.",
      };
    }
  }
  return {
    ok: false,
    capture: current,
    message: surveyPaywallFirstFrameMessage(surveyPaywallFirstFrame(current.snapshot)),
  };
}

export async function captureScrollableSurvey(
  driver: ScrollSurveyDriver,
  options: ScrollSurveyOptions = {},
): Promise<ScrollSurveyResult> {
  const maxScrolls = Math.max(1, Math.min(12, options.maxScrolls ?? 3));
  const shouldRestore = options.restore !== false;

  // Type assertions do not survive JavaScript callers. Only the evidence
  // loader's in-process capability can make this survey eligible for either a
  // fast restore or a durable document-origin issuance.
  const frozenDocumentOrigin = isMintedValidatedFrozenDocumentOrigin(options.frozenDocumentOrigin)
    ? options.frozenDocumentOrigin
    : undefined;
  // A cached expect-screen checkpoint can show the correct screen while the
  // physical list has since moved. It remains useful evidence for ordinary
  // collection, but cannot be used to authorize a high-distance origin
  // restore: ask the device for one fresh PNG/tree pair first.
  let first = frozenDocumentOrigin
    ? await driver.capture()
    : (options.initialCapture ?? (await driver.capture()));
  const rejectedUnsettled: ScrollSurveyFrame[] = [];
  const opening = await settlePaywallOpening(
    driver,
    first,
    rejectedUnsettled,
    options.surfaceExpectation?.kind === "grok-paywall",
  );
  if (!opening.ok) {
    return result(
      [candidateFrame(opening.capture, 0, 0)],
      "stopped",
      "extent-unproven",
      opening.message,
      true,
      rejectedUnsettled,
      undefined,
      true,
    );
  }
  first = opening.capture;
  const initial: ScrollSurveyFrame = {
    index: 0,
    offsetY: 0,
    screenshot: {
      base64: first.screenshot.base64,
      width: first.screenshot.width ?? 0,
      height: first.screenshot.height ?? 0,
      capturedAt: first.screenshot.capturedAt,
    },
    snapshot: first.snapshot,
    appendedHeight: 0,
  };
  const frames = [initial];
  const diagnosticFrames: ScrollSurveyFrame[] = [...rejectedUnsettled];
  const frozenOriginMatched = frozenDocumentOrigin
    ? startViewportMatches(frozenDocumentOrigin, first)
    : undefined;
  // A fast restore is allowed only after this same live first frame proved the
  // immutable origin. At the terminal proof, require both identities again:
  // matching the run's first frame alone must not paper over a weak/non-
  // transitive semantic match to the frozen document origin.
  const startingViewportMatches = (candidate: ScrollSurveyCapture): boolean =>
    startViewportMatches(first, candidate) &&
    (frozenOriginMatched !== true ||
      Boolean(frozenDocumentOrigin && startViewportMatches(frozenDocumentOrigin, candidate)));
  if (!first.snapshot.inspectable) {
    return result(
      frames,
      "stopped",
      "inspection-unavailable",
      "Accessibility is unavailable; no scroll survey was started.",
      true,
    );
  }
  if (!surveySurfaceIsIdentifiable(first.snapshot)) {
    return result(
      frames,
      "stopped",
      "missing-page-anchor",
      "The visible page has no stable accessibility structure, so Relay did not scroll it.",
      true,
    );
  }
  let restored = true;
  let owedMovements = 0;
  // Fast restoration is only safe after every outstanding down gesture was
  // accepted as a positive, same-surface seam. An uncertain handoff or seam
  // may still receive an exact inverse attempt, but never an origin fling.
  let acceptedScrollMovements = 0;
  let fastRestoreEligible = true;
  let attemptedScroll = false;
  let lastPostAttemptCapture: ScrollSurveyCapture | undefined;
  let provedRestoration: ScrollSurveyCapture | undefined;
  let terminalOriginProof: ScrollSurveyCapture | undefined;
  let restorationStarted = false;
  let restorationFailure: string | undefined;
  const rejectedRestorationFrames: ScrollSurveyFrame[] = [];
  const restoreOnce = async () => {
    if (!shouldRestore) return;
    if (restorationStarted) return;
    restorationStarted = true;

    if (
      owedMovements > 0 &&
      owedMovements === acceptedScrollMovements &&
      fastRestoreEligible &&
      frozenOriginMatched === true &&
      driver.scrollUpFast
    ) {
      // Three strong Android flings cover the current longest surveyed
      // product surfaces while remaining bounded. Each is followed by an
      // exact origin proof, so a changed layout can never silently look
      // restored just because a gesture settled.
      for (let index = 0; index < 3; index += 1) {
        try {
          await driver.scrollUpFast();
          await driver.settle();
          const candidate = await driver.capture();
          if (startingViewportMatches(candidate)) {
            provedRestoration = candidate;
            owedMovements = 0;
            return;
          }
          // The candidate is real raw evidence, but it must never become a
          // composited viewport or an implicit new starting position.
          rejectedRestorationFrames.push(
            candidateFrame(
              candidate,
              frames.length + diagnosticFrames.length + rejectedRestorationFrames.length,
              frames.at(-1)?.offsetY ?? 0,
            ),
          );
        } catch (error) {
          rethrowIosMutationOutcomeUnknown(error);
          restored = false;
          diagnosticFrames.push(...rejectedRestorationFrames);
          restorationFailure =
            "The bounded Android origin restore could not be observed after a restoration gesture.";
          return;
        }
      }
      restored = false;
      diagnosticFrames.push(...rejectedRestorationFrames);
      restorationFailure =
        "The bounded Android origin restore did not reproduce the exact starting viewport after three attempts; rejected restoration viewports were retained for review.";
      return;
    }
    for (let index = 0; index < owedMovements; index += 1) {
      try {
        await driver.scrollUp();
      } catch (error) {
        fastRestoreEligible = false;
        rethrowIosMutationOutcomeUnknown(error);
        restored = false;
        continue;
      }
      try {
        await driver.settle();
      } catch (error) {
        fastRestoreEligible = false;
        rethrowIosMutationOutcomeUnknown(error);
        restored = false;
      }
    }
  };
  let decision: {
    status: ScrollSurveyResult["status"];
    reason: ScrollSurveyStopReason;
    message: string;
  } = {
    status: "stopped",
    reason: "limit-reached",
    message:
      "Relay reached the configured survey limit; inspect the saved viewports before collecting more.",
  };
  let unexpected: unknown;
  let hasUnexpected = false;
  try {
    if (!surveyShouldAttemptScroll(first.snapshot)) {
      const extent = surveyExtent(first.snapshot);
      decision =
        extent.kind === "complete"
          ? {
              status: "completed",
              reason: "end-of-content",
              message: "Captured the complete visible list and restored the original viewport.",
            }
          : {
              status: "stopped",
              reason: "extent-unproven",
              message:
                extent.kind === "unknown"
                  ? `Relay did not scroll further, but it cannot prove the list is complete. ${extent.reason}.`
                  : `Relay stopped without claiming complete content. ${extent.reason}.`,
            };
    }
    for (let index = 0; index < maxScrolls && decision.reason === "limit-reached"; index += 1) {
      try {
        attemptedScroll = true;
        await driver.scrollDown();
        // The target may have moved as soon as the driver resolves. From this
        // point every exit owes exactly one inverse movement.
        owedMovements += 1;
        await driver.settle();
      } catch (error) {
        fastRestoreEligible = false;
        rethrowIosMutationOutcomeUnknown(error);
        decision = {
          status: "stopped",
          reason: "scroll-failed",
          message: "Scrolling failed; original captured viewports were retained.",
        };
        break;
      }

      let next: Awaited<ReturnType<ScrollSurveyDriver["capture"]>>;
      try {
        next = await driver.capture();
        lastPostAttemptCapture = next;
      } catch (error) {
        fastRestoreEligible = false;
        rethrowIosMutationOutcomeUnknown(error);
        decision = {
          status: "stopped",
          reason: "scroll-failed",
          message: "Capturing the scrolled viewport failed; Relay restored the starting viewport.",
        };
        break;
      }
      const previous = frames.at(-1)!;
      if (!sameSurveySurface(first.snapshot, next.snapshot)) {
        fastRestoreEligible = false;
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "screen-changed",
          message:
            "The scroll changed to a different screen; Relay stopped before stitching unrelated content.",
        };
        break;
      }
      const width = next.screenshot.width ?? 0;
      const height = next.screenshot.height ?? 0;
      if (width !== previous.screenshot.width || height !== previous.screenshot.height) {
        fastRestoreEligible = false;
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "dimension-changed",
          message:
            "The viewport dimensions changed while scrolling; Relay stopped before stitching.",
        };
        break;
      }
      const seam = verticalScrollSeam(
        Buffer.from(previous.screenshot.base64, "base64"),
        Buffer.from(next.screenshot.base64, "base64"),
        previous.snapshot,
        next.snapshot,
      );
      if (!seam) {
        // Semantic stationary hints are intentionally not enough to discharge
        // a physical down gesture. Sticky controls can be descendants of the
        // scroll container while unlabeled rows move underneath; keeping the
        // owed exact inverse is safer than certifying an end position.
        fastRestoreEligible = false;
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "seam-ambiguous",
          message:
            "Relay could not verify the visual overlap between scroll viewports; review the original frames before continuing.",
        };
        break;
      }
      if (seam.shiftY === 0) {
        owedMovements -= 1;
        const extent = surveyExtent(next.snapshot);
        decision =
          extent.kind === "complete"
            ? {
                status: "completed",
                reason: "end-of-content",
                message: "Captured the complete visible list and restored the original viewport.",
              }
            : {
                status: "stopped",
                reason: "extent-unproven",
                message:
                  extent.kind === "unknown"
                    ? `Zero observed movement is not proof the list is complete. ${extent.reason}.`
                    : `Relay stopped without claiming complete content. ${extent.reason}.`,
              };
        break;
      }
      if (!surveyShouldKeepScrolledFrame(previous.snapshot, next.snapshot)) {
        // Chrome-only motion is not a new viewport. Stop only when the helper
        // also agrees nothing remains; otherwise keep flinging from here.
        const extent = surveyExtent(next.snapshot);
        if (extent.kind === "complete") {
          owedMovements -= 1;
          decision = {
            status: "completed",
            reason: "end-of-content",
            message: "Captured the complete visible list and restored the original viewport.",
          };
          break;
        }
        if (surveyHasHiddenContentBelow(next.snapshot)) continue;
        owedMovements -= 1;
        decision = {
          status: "stopped",
          reason: "extent-unproven",
          message: `Relay stopped without claiming complete content. ${extent.reason}.`,
        };
        break;
      }
      const offsetY = previous.offsetY + seam.shiftY;
      frames.push({
        index: frames.length,
        offsetY,
        screenshot: {
          base64: next.screenshot.base64,
          width,
          height,
          capturedAt: next.screenshot.capturedAt,
        },
        snapshot: next.snapshot,
        appendedHeight: seam.shiftY,
      });
      acceptedScrollMovements += 1;
    }
  } catch (error) {
    unexpected = error;
    hasUnexpected = true;
  } finally {
    if (unexpected instanceof IosMutationOutcomeUnknownError) {
      attachScrollSurveyOutcomeUnknownDiagnostic(unexpected, frames, diagnosticFrames);
    } else {
      try {
        await restoreOnce();
      } catch (error) {
        attachScrollSurveyOutcomeUnknownDiagnostic(error, frames, diagnosticFrames);
        unexpected = error;
        hasUnexpected = true;
      }
    }
  }
  if (hasUnexpected) throw unexpected;
  if (!shouldRestore) {
    return result(
      frames,
      decision.status,
      decision.reason,
      `${decision.message.replace(" and restored the original viewport", "")} Restore skipped.`,
      false,
      diagnosticFrames,
    );
  }

  if (!restored) {
    return result(
      frames,
      "stopped",
      "restore-failed",
      restorationFailure ??
        "Relay stopped safely, but could not restore every captured scroll movement.",
      false,
      diagnosticFrames,
    );
  }
  if (attemptedScroll) {
    try {
      const proved = provedRestoration
        ? provedRestoration
        : owedMovements > 0 || !lastPostAttemptCapture
          ? await driver.capture()
          : lastPostAttemptCapture;
      if (!startingViewportMatches(proved)) {
        diagnosticFrames.push(
          candidateFrame(
            proved,
            frames.length + diagnosticFrames.length,
            frames.at(-1)?.offsetY ?? 0,
          ),
        );
        return result(
          frames,
          decision.status,
          decision.reason,
          `${decision.message} Starting viewport was not proven after restore.`,
          false,
          diagnosticFrames,
        );
      }
      terminalOriginProof = proved;
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        attachScrollSurveyOutcomeUnknownDiagnostic(error, frames, diagnosticFrames);
        throw error;
      }
      return result(
        frames,
        decision.status,
        decision.reason,
        `${decision.message} Starting viewport could not be recaptured after restore.`,
        false,
        diagnosticFrames,
      );
    }
  }
  const originWarning =
    frozenOriginMatched === false
      ? " The live viewport did not match the frozen document origin, so Relay used exact inverse restoration and retained this capture only as review evidence."
      : "";
  if (frozenOriginMatched === false) {
    return result(
      frames,
      "stopped",
      "start-viewport-unproven",
      `${decision.message}${originWarning}`,
      true,
      diagnosticFrames,
    );
  }
  const documentOriginIssuance =
    frozenDocumentOrigin &&
    frozenOriginMatched === true &&
    attemptedScroll &&
    decision.status === "completed" &&
    decision.reason === "end-of-content" &&
    terminalOriginProof
      ? documentOriginIssuanceFor(initial, terminalOriginProof)
      : undefined;
  return result(
    frames,
    decision.status,
    decision.reason,
    `${decision.message}${originWarning}`,
    true,
    diagnosticFrames,
    documentOriginIssuance,
  );
}

function candidateFrame(
  capture: ScrollSurveyCapture,
  index: number,
  offsetY: number,
): ScrollSurveyFrame {
  return {
    index,
    offsetY,
    appendedHeight: 0,
    screenshot: {
      base64: capture.screenshot.base64,
      width: capture.screenshot.width ?? 0,
      height: capture.screenshot.height ?? 0,
      capturedAt: capture.screenshot.capturedAt,
    },
    snapshot: capture.snapshot,
  };
}

/**
 * Public local-device entry point. Its target effects live in the injected
 * adapter module; this module supplies only the pure survey algorithm.
 */
export const captureScrollableSurveyForTarget =
  createScrollableSurveyTargetCaptureAdapter(captureScrollableSurvey);
