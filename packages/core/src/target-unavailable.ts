/**
 * True only when the control target itself is no longer usable.
 *
 * This is deliberately narrower than the generic retry classifier: a missing
 * selector or an assertion that says "not found" is a product/authoring
 * failure, while ADB/XCTest reporting that the device disappeared is an
 * execution-boundary failure. Callers must stop issuing mutations for the
 * latter because every later screen assumption is necessarily stale.
 */
export function isTargetUnavailableError(error: unknown): boolean {
  if (error instanceof Error && error.cause && isTargetUnavailableError(error.cause)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return [
    /\badb(?:\.exe)?\b[\s\S]*\bdevice\s+(?:['"][^'"]+['"]\s+)?(?:not found|offline|unauthorized)\b/iu,
    /\berror:\s*device\s+['"][^'"]+['"]\s+not found\b/iu,
    /\bdevice\s+['"][^'"]+['"]\s+(?:is\s+)?(?:offline|unauthorized|disconnected)\b/iu,
    /\bno (?:android )?devices?(?:\/emulators?)? (?:found|connected|available)\b/iu,
    /\bmanaged browser missing\b/iu,
    /\bdevice missing:\s*\S+\s+is no longer connected\b/iu,
    /\bunknown serial\b/iu,
  ].some((pattern) => pattern.test(message));
}
