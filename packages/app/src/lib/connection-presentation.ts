import type { RecipeStep } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";

/** Ordinary single taps and unrecorded routes are already communicated by the
 * path treatment and inspector. Keep labels for behavior that the line alone
 * cannot explain: gestures, waits, and multi-step paths. */
export function connectionLabelMode(
  connection: CanvasConnection,
  steps: readonly RecipeStep[],
): "always" | "hidden" {
  if (connection.state === "needs-recording") return "hidden";
  // The recorder keeps meaningful human pauses as editable sleep steps. They
  // do not turn an otherwise ordinary tap into a visually complex gesture.
  const meaningfulSteps = steps.filter((step) => step.kind !== "sleep");
  if (meaningfulSteps.length !== 1) return "always";
  const step = meaningfulSteps[0];
  if (step?.kind !== "tap") return "always";
  if ((step.gesture ?? "single") !== "single" || (step.tapCount ?? 1) > 1) return "always";
  return "hidden";
}

export function checkedTargetsLabel(
  targets: readonly { targetId: string; targetName?: string }[] | undefined,
  status?: NonNullable<CanvasConnection["review"]>["status"],
): string {
  if (!targets?.length) {
    if (status === "verified") return "Last try reached this screen";
    if (status === "failed") return "Last try didn’t match";
    return "Not tried on a device yet";
  }
  if (targets.length === 1) return `Tried on ${targets[0]!.targetName ?? "this device"}`;
  return `Tried on ${targets.length} devices`;
}

export function connectionStatusLabel(connection: CanvasConnection): string {
  if (connection.state === "needs-recording") return "Needs steps";
  if (connection.review?.status === "verified") return "Works";
  if (connection.review?.status === "failed") return "Needs a fix";
  if (connection.takeId || connection.videoTakeId) return "Ready to try";
  return "Not tried yet";
}
