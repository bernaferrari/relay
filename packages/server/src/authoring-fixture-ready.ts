/** Fail-closed readiness for proof-mode captures that overlay a saved fixture. */

export type FixtureCaptureReadiness = "unhydrated" | "signed-out" | "ready" | "waiting";

const SIGNED_OUT_MARKERS = ["sign in", "log in", "continue with x", "continue with google"];
/** The app itself stating the signed-in identity — the role indicator every
 * signed-in surface carries. Grok's is its Library; other apps say who is
 * signed in ("Signed in as member"). Both prove the fixture hydrated. */
const SIGNED_IN_MARKERS = ["library", "signed in as"];

export function fixtureCaptureReadiness(labels: readonly string[]): FixtureCaptureReadiness {
  const hay = labels.map((label) => label.replace(/\s+/gu, " ").trim().toLocaleLowerCase());
  if (hay.some((label) => SIGNED_OUT_MARKERS.some((marker) => label.includes(marker)))) {
    return "signed-out";
  }
  if (hay.some((label) => SIGNED_IN_MARKERS.some((marker) => label.includes(marker)))) {
    return "ready";
  }
  const withoutSkip = hay.filter((label) => label && !label.includes("skip to"));
  if (withoutSkip.length === 0) return "unhydrated";
  return "waiting";
}
