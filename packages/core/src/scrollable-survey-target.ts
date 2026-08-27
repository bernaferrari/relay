/**
 * Local-target adapter for the otherwise pure scroll-survey algorithm.
 *
 * This is the only survey module allowed to discover a device, capture a
 * temporary PNG/tree pair, or issue a scroll gesture. Keeping those effects
 * behind a small injected boundary lets the survey algorithm remain usable for
 * frozen evidence and guarantees that transient screenshots are disposed as
 * soon as their base64 evidence crosses the boundary.
 */
import { interact } from "./workspace-interact.js";
import { devicePlatformForSerial } from "./workspace-devices.js";
import { captureScreenshot, captureSnapshot, cleanupScreenshot } from "./workspace-capture.js";
import type {
  ScrollSurveyCapture,
  ScrollSurveyDriver,
  ScrollSurveyOptions,
  ScrollSurveyResult,
  ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey-types.js";

export type ScrollSurveyTargetInput = {
  serial: string;
  maxScrolls?: number;
  restore?: boolean;
  initialCapture?: ScrollSurveyCapture;
  frozenDocumentOrigin?: ValidatedFrozenDocumentOrigin;
};

/**
 * Target effects are injected as a deliberately small contract. The optional
 * cleanup/sleep hooks keep focused tests fast without making the pure survey
 * algorithm aware of device commands or temporary filesystem paths.
 */
export type ScrollSurveyTargetDependencies = {
  devicePlatformForSerial: typeof devicePlatformForSerial;
  captureScreenshot: typeof captureScreenshot;
  captureSnapshot: typeof captureSnapshot;
  interact: typeof interact;
  cleanupScreenshot?: typeof cleanupScreenshot;
  sleep?: (durationMs: number) => Promise<void>;
};

const defaultTargetDependencies: ScrollSurveyTargetDependencies = {
  devicePlatformForSerial,
  captureScreenshot,
  captureSnapshot,
  interact,
};

export type ScrollSurveyAlgorithm = (
  driver: ScrollSurveyDriver,
  options?: ScrollSurveyOptions,
) => Promise<ScrollSurveyResult>;

export function scrollSurveyGesture(
  platform: "android" | "ios",
  bounds: { width: number; height: number },
  direction: "down" | "up",
) {
  // Android flings a *fast* half-screen swipe (Settings once skipped 1857px).
  // Keep the drag slow (800ms) so it stays a drag, but travel ~45% of the
  // viewport — a quarter-screen move wasted four scrolls on SuperGrok-length
  // pages and still left >70% overlap unused. Seam matching needs overlap,
  // not a crawl. iOS XCTest does not share the fling, so it can travel more.
  const lower = platform === "android" ? 0.8 : 0.78;
  const upper = platform === "android" ? 0.34 : 0.28;
  const fromY = bounds.height * (direction === "down" ? lower : upper);
  const toY = bounds.height * (direction === "down" ? upper : lower);
  return {
    kind: "swipe" as const,
    from: { x: bounds.width * 0.5, y: fromY },
    to: { x: bounds.width * 0.5, y: toY },
    durationMs: platform === "android" ? 800 : 360,
  };
}

/** A single Android restoration fling. It is intentionally separate from the
 * overlap-heavy capture drag: collection needs a small, seam-friendly move;
 * returning to a proven document origin benefits from distance. */
export function scrollSurveyFastRestoreGesture(
  platform: "android",
  bounds: { width: number; height: number },
) {
  return {
    kind: "swipe" as const,
    from: { x: bounds.width * 0.5, y: bounds.height * 0.86 },
    to: { x: bounds.width * 0.5, y: bounds.height * 0.14 },
    durationMs: 180,
  };
}

/**
 * Builds the target-backed public capture adapter around a supplied pure
 * algorithm. Inverting this dependency avoids a circular import while making
 * it impossible for the pure survey to acquire a target implicitly.
 */
export function createScrollableSurveyTargetCaptureAdapter(algorithm: ScrollSurveyAlgorithm) {
  return async function captureScrollableSurveyForTarget(
    input: ScrollSurveyTargetInput,
    dependencies: ScrollSurveyTargetDependencies = defaultTargetDependencies,
  ): Promise<ScrollSurveyResult> {
    const platform = await dependencies.devicePlatformForSerial(input.serial);
    if (platform !== "android" && platform !== "ios") {
      throw new Error(`Target ${input.serial} is not an available Android or iOS device.`);
    }
    let bounds = { width: 1080, height: 2340 };
    const sleep =
      dependencies.sleep ??
      ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
    const settle = () => sleep(platform === "ios" ? 700 : 350);
    const disposeScreenshot = dependencies.cleanupScreenshot ?? cleanupScreenshot;
    return algorithm(
      {
        capture: async () => {
          let screenshot: Awaited<ReturnType<typeof captureScreenshot>> | undefined;
          try {
            screenshot = await dependencies.captureScreenshot({
              serial: input.serial,
              ephemeral: true,
              includeScreenMatch: false,
            });
            const snapshot = await dependencies.captureSnapshot({ serial: input.serial });
            if (snapshot.bounds) bounds = snapshot.bounds;
            return { screenshot, snapshot };
          } finally {
            // A survey keeps only base64 plus decoded dimensions in its raw
            // frames. The screenshot path is never returned or persisted, so
            // dispose this private capture after every viewport transfer—even
            // if AX capture, seam analysis, or restoration later fails.
            if (screenshot) await disposeScreenshot(screenshot.path).catch(() => undefined);
          }
        },
        scrollDown: async () => {
          await dependencies.interact(scrollSurveyGesture(platform, bounds, "down"), {
            serial: input.serial,
          });
        },
        scrollUp: async () => {
          await dependencies.interact(scrollSurveyGesture(platform, bounds, "up"), {
            serial: input.serial,
          });
        },
        ...(platform === "android"
          ? {
              scrollUpFast: async () => {
                await dependencies.interact(scrollSurveyFastRestoreGesture("android", bounds), {
                  serial: input.serial,
                });
              },
            }
          : {}),
        settle,
      },
      {
        maxScrolls: input.maxScrolls,
        ...(input.restore === false ? { restore: false } : {}),
        ...(input.initialCapture ? { initialCapture: input.initialCapture } : {}),
        ...(input.frozenDocumentOrigin ? { frozenDocumentOrigin: input.frozenDocumentOrigin } : {}),
      },
    );
  };
}
