function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
}

/** Prefer the go-ios pixel failure over agent-device's browser "open first" copy. */
export function iosPixelsUnavailableMessage(goIosError: unknown, sdkError?: unknown): string {
  const goIos = errorText(goIosError).slice(0, 400);
  const sdk = sdkError ? errorText(sdkError) : "";
  if (/tunnel|ios 17|rsd|instruments/i.test(goIos)) {
    return `iOS pixels need an active go-ios tunnel (iOS 17+). ${goIos} Do not run target.open on a physical iPad.`;
  }
  if (/no active session|run open first/i.test(sdk)) {
    return `iOS screenshot failed via go-ios (${goIos}). XCTest is also down — that is not a failed screenshot. Do not run target.open on a physical iPad.`;
  }
  return `iOS screenshot failed via go-ios: ${goIos}`;
}
