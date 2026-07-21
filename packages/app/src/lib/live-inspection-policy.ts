export const LIVE_SNAPSHOT_INTERVAL_MS = 1_500;
export const POST_INTERACTION_SNAPSHOT_DELAY_MS = 180;

/** Video and accessibility capture have independent lifecycles. */
export function liveInspectionPolicy(interacting: boolean, videoFailed: boolean) {
  return {
    pollSnapshot: interacting,
    pollFallbackFrame: interacting && videoFailed,
  };
}
