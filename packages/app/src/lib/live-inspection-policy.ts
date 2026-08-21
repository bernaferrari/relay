import type { DeviceInfo } from "./api-types";
import { targetIsPhysicalIos } from "./target-presentation";

/**
 * Accessibility is a full XCTest round trip on physical Apple hardware, not a
 * cheap local DOM read. Android retains a bounded background cadence; the
 * iPad Stage uses meaningful events (input, material pixel change, explicit
 * refresh, recovery) instead. A runtime capability cooldown suppresses any
 * automatic query after a real iOS failure.
 */
export const LIVE_SNAPSHOT_INTERVAL_MS = 5_000;
/**
 * Screenshot fallback is evidence-sized, not a video frame. Polling it at
 * video cadence queues PNG decodes in Chromium faster than they are reclaimed
 * when H.264 is unavailable.
 *
 * Android uses this only while recovering from a dead H.264 stream.
 * Physical iOS has no live H.264 path yet (scrcpy is Android-only), so this
 * cadence is the steady-state preview cost — keep it calm.
 */
export const LIVE_FALLBACK_FRAME_INTERVAL_MS = 2_500;
/** Physical iOS PNG preview: slower than Android recovery to avoid XCTest thrash. */
export const LIVE_IOS_FALLBACK_FRAME_INTERVAL_MS = 4_000;
export const POST_INTERACTION_SNAPSHOT_DELAY_MS = 180;

/**
 * The Stage needs only actionable geometry while it is live. Full/raw trees
 * remain an explicit Teach or evidence capture so physical iOS does not spend
 * an XCTest traversal budget redrawing hover affordances. Simulators and
 * every non-iOS target retain the existing full-snapshot request.
 */
export function liveStageSnapshotPollOptions(
  target: DeviceInfo | null | undefined,
): { interactiveOnly: true } | undefined {
  return targetIsPhysicalIos(target) ? { interactiveOnly: true } : undefined;
}

/** Video and accessibility capture have independent lifecycles.
 *
 * A physical iOS device currently records and observes through one XCTest
 * runner. Capturing a second screenshot or hierarchy while that runner owns a
 * video take can restart the session and corrupt the recording. Callers can
 * therefore suspend both polling paths while the take is active, keeping the
 * last good frame visible until recording stops.
 */
export function liveInspectionPolicy(
  interacting: boolean,
  videoFailed: boolean,
  captureSuspended = false,
  collectAccessibility = true,
  automaticSemanticProbeNeeded = true,
) {
  return {
    pollSnapshot:
      interacting && collectAccessibility && !captureSuspended && automaticSemanticProbeNeeded,
    pollFallbackFrame: interacting && videoFailed && !captureSuspended,
  };
}
