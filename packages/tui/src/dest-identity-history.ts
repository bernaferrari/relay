import { projectCaptureReviewDestIdentity, planCaptureReviewScreenLabel } from "@relay/protocol";

/** Dest wait-for caption for TUI history. Leftover Close / Run saved Test /
 * Transition executed / Inspect setup skipped cannot fill dest. Opener before ·
 * Tap cannot fill dest beside those leftovers either. Strip bare `step:…:`
 * engine ids so Model selector SuperGrok matches Plan Gallery / Run report. */
export function destIdentityHistoryCaption(
  destIdentity: Array<{ path?: string; caption?: string }> | undefined,
): string | undefined {
  if (!destIdentity?.length) return undefined;
  const candidates = projectCaptureReviewDestIdentity(
    [],
    [],
    destIdentity.flatMap((item) => {
      const caption = item.caption?.trim();
      const path = item.path?.trim() || caption;
      return path ? [{ path, ...(caption ? { caption } : {}) }] : [];
    }),
  );
  const dest = candidates[0];
  const caption = dest?.caption?.trim();
  if (caption) {
    const labeled = planCaptureReviewScreenLabel({ caption });
    if (labeled) return labeled;
  }
  return dest?.path?.trim() || undefined;
}
