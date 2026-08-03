export const LIVE_SNAPSHOT_INTERVAL_MS = 1_500;
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
