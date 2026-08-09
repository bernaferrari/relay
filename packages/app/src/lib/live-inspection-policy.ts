/**
 * Accessibility on a physical Apple device is a full XCTest round trip, not a
 * cheap local DOM read. A five-second background cadence keeps hover metadata
 * useful while post-interaction refreshes still happen immediately.
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
) {
  return {
    pollSnapshot: interacting && !captureSuspended,
    pollFallbackFrame: interacting && videoFailed && !captureSuspended,
  };
}
