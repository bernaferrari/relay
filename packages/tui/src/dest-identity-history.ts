import { isCaptureReviewLeftoverCaption } from "@relay/protocol";

/** Dest wait-for caption for TUI history. Leftover Close / Run saved Test /
 * Transition executed / Inspect setup skipped cannot fill dest. */
export function destIdentityHistoryCaption(
  destIdentity: Array<{ path?: string; caption?: string }> | undefined,
): string | undefined {
  const dest = destIdentity?.find((item) => {
    const caption = item.caption?.trim() ?? "";
    if (isCaptureReviewLeftoverCaption(caption)) return false;
    return Boolean(caption || item.path?.trim());
  });
  const caption = dest?.caption?.trim();
  return caption || dest?.path?.trim() || undefined;
}
