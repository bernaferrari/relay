import { RecordingInputNotSentError } from "./recording-input-outcome";

// The iOS pixel producer continuously captures even an unchanged screen.
// This deadline must not apply to stationary Android H264 or browser polling.
export const IOS_PREVIEW_FRAME_MAX_AGE_MS = 15_000;
export const IOS_PREVIEW_STALLED_MESSAGE =
  "The iOS preview stopped updating. Reconnect to see the current screen before interacting.";

/** Own one stream's decoded-frame deadline. Expiry is terminal for this
 * stream; a late decode cannot revive it or admit an input from old pixels. */
export function createIosPreviewFreshness(onExpired: () => void) {
  let deadline: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  function expire() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    onExpired();
  }
  function current() {
    if (!ended && deadline !== undefined && Date.now() >= deadline) expire();
    return !ended && deadline !== undefined;
  }
  return {
    mayPaint: () => (deadline === undefined ? !ended : current()),
    decodedFrame() {
      if (ended) return;
      deadline = Date.now() + IOS_PREVIEW_FRAME_MAX_AGE_MS;
      clearTimeout(timer);
      timer = setTimeout(expire, IOS_PREVIEW_FRAME_MAX_AGE_MS);
    },
    assertFresh() {
      if (!current())
        throw new RecordingInputNotSentError(
          "Wait for a current iOS preview frame. Reconnect the live view before interacting.",
        );
    },
    close() {
      ended = true;
      clearTimeout(timer);
    },
  };
}
